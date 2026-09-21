// routes/inspecciones.js — Lo que el técnico registra en cada punto de control
//
// Al guardar una inspección el punto queda "en verde" para el día, el hotel lo
// ve en su portal en tiempo real, y si alguna respuesta está marcada para
// generar hallazgo, se abre solo.
import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { logAccion } from "../lib/auditoria.js";
import { requireRol, filtrarPorSitio, exigirSitioPermitido, puedeVerSitio } from "../middleware/auth.js";

const router = express.Router();

const hoyRD = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });

// ─────────────────────────────────────────────────────────────────────────────
// Consulta
// ─────────────────────────────────────────────────────────────────────────────

// GET /inspecciones?sitio_id=&punto_id=&desde=&hasta=&tecnico_id=&area_id=
router.get("/", async (req, res) => {
  const { sitio_id, punto_id, desde, hasta, tecnico_id, area_id, limite = 200 } = req.query;

  let q = supabase
    .from("asa_inspecciones")
    .select(`
      id, fecha, fecha_local, estado_punto, nivel_actividad, requiere_accion,
      notas, fotos, metodo_acceso, sitio_id, area_id,
      asa_puntos_control(id, codigo_visible, nombre, numero_habitacion, asa_tipos_punto(nombre, icono, color)),
      asa_areas(nombre),
      asa_empleados(nombre_completo)
    `)
    .order("fecha", { ascending: false })
    .limit(Math.min(Number(limite) || 200, 1000));

  if (sitio_id) {
    if (!exigirSitioPermitido(req, res, sitio_id)) return;
    q = q.eq("sitio_id", sitio_id);
  } else {
    q = filtrarPorSitio(q, req);
  }
  if (punto_id) q = q.eq("punto_id", punto_id);
  if (area_id) q = q.eq("area_id", area_id);
  if (tecnico_id) q = q.eq("tecnico_id", tecnico_id);
  if (desde) q = q.gte("fecha_local", desde);
  if (hasta) q = q.lte("fecha_local", hasta);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// GET /inspecciones/:id — con las respuestas del checklist
router.get("/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("asa_inspecciones")
    .select(`
      *,
      asa_puntos_control(codigo_visible, nombre, numero_habitacion, asa_tipos_punto(nombre, icono)),
      asa_areas(nombre),
      asa_sitios(nombre),
      asa_empleados(nombre_completo)
    `)
    .eq("id", req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  if (!data) return res.status(404).json({ error: true, mensaje: "Inspección no encontrada" });
  if (!puedeVerSitio(req, data.sitio_id)) return res.status(403).json({ error: true, mensaje: "Sin acceso" });

  const { data: respuestas } = await supabase
    .from("asa_inspeccion_respuestas")
    .select("*")
    .eq("inspeccion_id", data.id);

  res.json({ ...data, respuestas: respuestas || [] });
});

// GET /inspecciones/avance/hoy?sitio_id= — los dos recuadros del panel
router.get("/avance/hoy", async (req, res) => {
  const { sitio_id, fecha } = req.query;
  if (!sitio_id) return res.status(400).json({ error: true, mensaje: "sitio_id es requerido" });
  if (!exigirSitioPermitido(req, res, sitio_id)) return;

  const dia = fecha || hoyRD();

  const [puntos, hechas] = await Promise.all([
    supabase.from("asa_v_puntos_estado").select("*").eq("sitio_id", sitio_id),
    supabase
      .from("asa_inspecciones")
      .select("punto_id, fecha, estado_punto, nivel_actividad, tecnico_id, asa_empleados(nombre_completo)")
      .eq("sitio_id", sitio_id)
      .eq("fecha_local", dia),
  ]);

  const porPunto = new Map();
  for (const i of hechas.data || []) porPunto.set(i.punto_id, i);

  const realizados = [];
  const pendientes = [];
  for (const p of puntos.data || []) {
    const insp = porPunto.get(p.punto_id);
    if (insp) realizados.push({ ...p, inspeccion: insp });
    else if (p.frecuencia !== "por_orden") pendientes.push(p);
  }

  res.json({
    fecha: dia,
    total: realizados.length + pendientes.length,
    realizados,
    pendientes,
    con_actividad: realizados.filter((r) => r.inspeccion.nivel_actividad !== "ninguna").length,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Registro
// ─────────────────────────────────────────────────────────────────────────────

// POST /inspecciones
// Body: { punto_id, estado_punto, nivel_actividad, notas, fotos, acciones,
//         metodo_acceso, lat, lng, orden_trabajo_id?,
//         respuestas: [{ pregunta_id, pregunta_texto, valor_texto,
//                        valor_numero, valor_bool, valor_opciones, fotos }] }
router.post("/", requireRol("tecnico_plagas", "operaciones"), async (req, res) => {
  const resultado = await registrarInspeccion(req, req.body);
  if (resultado.error) return res.status(resultado.codigo || 500).json({ error: true, mensaje: resultado.mensaje });
  res.status(201).json(resultado.inspeccion);
});

// POST /inspecciones/sincronizar — la cola offline de la app del técnico
//
// El técnico trabaja en sótanos y cuartos de máquinas sin señal. La app guarda
// las inspecciones localmente y las manda todas juntas al recuperar conexión.
// Cada una lleva un `clave_local` para que reintentar no duplique nada.
router.post("/sincronizar", requireRol("tecnico_plagas", "operaciones"), async (req, res) => {
  const { inspecciones = [] } = req.body;
  if (!Array.isArray(inspecciones) || !inspecciones.length) {
    return res.status(400).json({ error: true, mensaje: "Se esperaba una lista de inspecciones" });
  }

  const resultados = [];
  for (const entrada of inspecciones) {
    const r = await registrarInspeccion(req, { ...entrada, sincronizada_offline: true });
    resultados.push({
      clave_local: entrada.clave_local ?? null,
      ok: !r.error,
      id: r.inspeccion?.id ?? null,
      mensaje: r.mensaje ?? null,
    });
  }

  const ok = resultados.filter((r) => r.ok).length;
  res.json({ recibidas: inspecciones.length, guardadas: ok, fallidas: inspecciones.length - ok, resultados });
});

// ─────────────────────────────────────────────────────────────────────────────
async function registrarInspeccion(req, cuerpo) {
  const { punto_id, respuestas = [], clave_local: _omit, ...resto } = cuerpo;
  if (!punto_id) return { error: true, codigo: 400, mensaje: "punto_id es requerido" };

  const { data: punto } = await supabase
    .from("asa_puntos_control")
    .select("id, sitio_id, area_id, codigo_visible, activo")
    .eq("id", punto_id)
    .maybeSingle();

  if (!punto) return { error: true, codigo: 404, mensaje: "El punto de control no existe" };
  if (!punto.activo) return { error: true, codigo: 410, mensaje: `El punto ${punto.codigo_visible} está dado de baja` };
  if (!puedeVerSitio(req, punto.sitio_id)) return { error: true, codigo: 403, mensaje: "Sin acceso a este hotel" };

  const { data: inspeccion, error } = await supabase
    .from("asa_inspecciones")
    .insert([
      {
        ...resto,
        punto_id,
        sitio_id: punto.sitio_id,
        area_id: punto.area_id,
        usuario_id: req.usuario?.id ?? null,
        tecnico_id: resto.tecnico_id ?? req.usuario?.empleado_id ?? null,
      },
    ])
    .select()
    .single();
  if (error) return { error: true, mensaje: error.message };

  if (respuestas.length) {
    const { error: errR } = await supabase.from("asa_inspeccion_respuestas").insert(
      respuestas.map((r) => ({
        inspeccion_id: inspeccion.id,
        pregunta_id: r.pregunta_id ?? null,
        pregunta_texto: r.pregunta_texto || "(sin texto)",
        valor_texto: r.valor_texto ?? null,
        valor_numero: r.valor_numero ?? null,
        valor_bool: r.valor_bool ?? null,
        valor_opciones: r.valor_opciones ?? [],
        fotos: r.fotos ?? [],
      }))
    );
    if (errR) console.warn("[ASA][inspecciones] respuestas no guardadas:", errR.message);
  }

  await abrirHallazgosAutomaticos(inspeccion, punto, respuestas);

  logAccion(req, {
    accion: "crear",
    modulo: "inspecciones",
    registroId: inspeccion.id,
    descripcion: `Inspección de ${punto.codigo_visible} — ${inspeccion.estado_punto}/${inspeccion.nivel_actividad}`,
  });

  return { inspeccion };
}

// Una respuesta puede estar configurada para abrir un hallazgo sola
// (asa_preguntas.genera_hallazgo_si). También se abre uno si el punto quedó
// dañado, faltante o con actividad alta.
async function abrirHallazgosAutomaticos(inspeccion, punto, respuestas) {
  const hallazgos = [];

  if (["dañado", "faltante"].includes(inspeccion.estado_punto)) {
    hallazgos.push({
      titulo: `Punto ${punto.codigo_visible} ${inspeccion.estado_punto}`,
      descripcion: inspeccion.notas || null,
      severidad: "media",
      responsable: "asa",
    });
  }
  if (inspeccion.nivel_actividad === "alto") {
    hallazgos.push({
      titulo: `Actividad alta en ${punto.codigo_visible}`,
      descripcion: inspeccion.notas || null,
      severidad: "alta",
      responsable: "asa",
    });
  }

  const conRegla = respuestas.filter((r) => r.pregunta_id);
  if (conRegla.length) {
    const { data: preguntas } = await supabase
      .from("asa_preguntas")
      .select("id, texto, genera_hallazgo_si")
      .in("id", conRegla.map((r) => r.pregunta_id))
      .not("genera_hallazgo_si", "is", null);

    for (const p of preguntas || []) {
      const r = conRegla.find((x) => x.pregunta_id === p.id);
      if (!r) continue;
      const regla = p.genera_hallazgo_si || {};
      const valor = r.valor_bool ?? r.valor_texto ?? r.valor_numero;
      const dispara =
        (regla.igual !== undefined && String(valor) === String(regla.igual)) ||
        (regla.mayor_que !== undefined && Number(r.valor_numero) > Number(regla.mayor_que)) ||
        (regla.menor_que !== undefined && Number(r.valor_numero) < Number(regla.menor_que));
      if (dispara) {
        hallazgos.push({
          titulo: p.texto,
          descripcion: r.valor_texto || `Respuesta: ${valor}`,
          severidad: regla.severidad || "media",
          responsable: regla.responsable || "cliente",
        });
      }
    }
  }

  if (!hallazgos.length) return;

  await supabase.from("asa_hallazgos").insert(
    hallazgos.map((h) => ({
      ...h,
      sitio_id: punto.sitio_id,
      area_id: punto.area_id,
      punto_id: punto.id,
      inspeccion_id: inspeccion.id,
      fotos: inspeccion.fotos || [],
    }))
  );
}

export default router;
