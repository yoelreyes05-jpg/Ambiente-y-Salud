// routes/inspecciones.js — Lo que el técnico registra en cada punto de control
//
// Al guardar una inspección el punto queda "en verde" para el día, el hotel lo
// ve en su portal en tiempo real, y si alguna respuesta está marcada para
// generar hallazgo, se abre solo.
import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { logAccion } from "../lib/auditoria.js";
import { requireRol, filtrarPorSitio, exigirSitioPermitido, puedeVerSitio } from "../middleware/auth.js";
import { guardarFotos } from "../lib/evidencias.js";

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
      motivo_no_realizado, impedido_por,
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /inspecciones/dia?sitio_id=&fecha=&tipo=
//
// Todo lo que se subio en el dia, no solo habitaciones. ASA sube muchos mas
// servicios que habitaciones: recorridos de areas, cebaderos, lamparas,
// aplicaciones puntuales. El panel mostraba unicamente el tipo "habitacion" y
// el resto del trabajo del dia quedaba invisible.
//
// Devuelve tres listas, que son las tres pestanas del panel:
//   realizados    — lo que se hizo, agrupado por tipo de punto
//   no_realizados — lo que el tecnico intento y no pudo, con el motivo
//   pendientes    — lo que ni se toco y ya deberia estar hecho (vencidos)
//
// OJO: esta ruta va ARRIBA de GET /:id. Con /:id declarado primero,
// /inspecciones/dia entraria por ahi con id="dia".
// ─────────────────────────────────────────────────────────────────────────────
router.get("/dia", async (req, res) => {
  const { sitio_id, tipo } = req.query;
  if (!sitio_id) return res.status(400).json({ error: true, mensaje: "sitio_id es requerido" });
  if (!exigirSitioPermitido(req, res, sitio_id)) return;

  const dia = req.query.fecha || hoyRD();

  let qServicios = supabase
    .from("asa_v_servicios_dia")
    .select("*")
    .eq("sitio_id", sitio_id)
    .eq("fecha_local", dia)
    .order("fecha", { ascending: false });
  if (tipo) qServicios = qServicios.eq("tipo_codigo", tipo);

  const [servicios, puntos] = await Promise.all([
    qServicios,
    supabase.from("asa_v_puntos_estado").select("*").eq("sitio_id", sitio_id),
  ]);
  if (servicios.error) return res.status(500).json({ error: true, mensaje: servicios.error.message });

  const S = servicios.data || [];
  const realizados = S.filter((x) => !x.no_realizado);
  const noRealizados = S.filter((x) => x.no_realizado);

  // Pendiente = punto programable que hoy no tiene ningun registro (ni hecho ni
  // intentado) Y que ademas ya esta fuera de su frecuencia. Un cebadero mensual
  // que se reviso hace tres dias no es un pendiente de hoy.
  const conRegistro = new Set(S.map((x) => x.punto_id));
  const pendientes = (puntos.data || [])
    .filter((p) => p.frecuencia !== "por_orden" && !conRegistro.has(p.id) && p.vencido)
    .filter((p) => !tipo || p.tipo_codigo === tipo)
    .map((p) => ({
      punto_id: p.id,
      codigo_visible: p.codigo_visible,
      punto_nombre: p.punto_nombre,
      numero_habitacion: p.numero_habitacion,
      area: p.area_nombre,
      tipo_codigo: p.tipo_codigo,
      tipo_nombre: p.tipo_nombre,
      tipo_icono: p.tipo_icono,
      frecuencia: p.frecuencia,
      ultima_inspeccion: p.ultima_inspeccion,
      dias_sin_revisar: p.ultima_inspeccion
        ? Math.floor((Date.now() - new Date(p.ultima_inspeccion)) / 86400000)
        : null,
    }));

  // Resumen por tipo de servicio: es lo que va arriba de la pestana, para que
  // de un vistazo se vea que se trabajo hoy sin contar tarjetas a mano.
  const porTipo = new Map();
  for (const x of S) {
    const k = x.tipo_codigo || "otro";
    if (!porTipo.has(k)) {
      porTipo.set(k, { tipo_codigo: k, tipo_nombre: x.tipo_nombre, tipo_icono: x.tipo_icono, hechos: 0, no_realizados: 0, plagas: 0, fotos: 0 });
    }
    const t = porTipo.get(k);
    if (x.no_realizado) t.no_realizados++;
    else t.hechos++;
    t.plagas += x.plagas_total || 0;
    t.fotos += x.fotos_total || 0;
  }

  res.json({
    fecha: dia,
    total_registrado: S.length,
    realizados,
    no_realizados: noRealizados,
    pendientes,
    por_tipo: [...porTipo.values()].sort((a, b) => b.hechos - a.hechos),
    resumen: {
      hechos: realizados.length,
      no_realizados: noRealizados.length,
      pendientes: pendientes.length,
      con_actividad: realizados.filter((r) => r.nivel_actividad && r.nivel_actividad !== "ninguna").length,
      plagas_contadas: S.reduce((a, b) => a + (b.plagas_total || 0), 0),
      fotos: S.reduce((a, b) => a + (b.fotos_total || 0), 0),
      tecnicos: [...new Set(S.map((x) => x.tecnico).filter(Boolean))],
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /inspecciones/:id/desglose — TODO lo de un servicio, para la tarjeta que
// se abre al hacerle clic y para imprimirlo en PDF.
//
// Aparte de /:id porque trae mas cosas (capturas de plagas con su nombre, la
// planta y el area, el plano) y no tiene sentido cargarlas en cada listado.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:id/desglose", async (req, res) => {
  const { data: insp, error } = await supabase
    .from("asa_inspecciones")
    .select(`
      *,
      asa_puntos_control(codigo_visible, nombre, numero_habitacion, ubicacion_descripcion,
                         frecuencia, plano_id, asa_tipos_punto(codigo, nombre, icono, color)),
      asa_areas(nombre, codigo, nivel, descripcion),
      asa_sitios(nombre, direccion, asa_clientes(razon_social, nombre_contacto)),
      asa_empleados(nombre_completo, telefono)
    `)
    .eq("id", req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  if (!insp) return res.status(404).json({ error: true, mensaje: "Servicio no encontrado" });
  if (!puedeVerSitio(req, insp.sitio_id)) return res.status(403).json({ error: true, mensaje: "Sin acceso" });

  const [respuestas, capturas, hallazgos] = await Promise.all([
    supabase.from("asa_inspeccion_respuestas").select("*").eq("inspeccion_id", insp.id),
    supabase.from("asa_capturas").select("*, asa_plagas(codigo, nombre, nombre_cientifico, grupo, icono, color, umbral_alerta)").eq("inspeccion_id", insp.id),
    supabase.from("asa_hallazgos").select("id, titulo, descripcion, severidad, responsable, estado, fecha_limite").eq("inspeccion_id", insp.id),
  ]);

  const p = insp.asa_puntos_control || {};
  res.json({
    ...insp,
    punto: {
      codigo: p.codigo_visible,
      nombre: p.numero_habitacion ? `Habitacion ${p.numero_habitacion}` : p.nombre,
      numero_habitacion: p.numero_habitacion,
      ubicacion: p.ubicacion_descripcion,
      frecuencia: p.frecuencia,
      tipo: p.asa_tipos_punto?.nombre,
      tipo_codigo: p.asa_tipos_punto?.codigo,
      tipo_icono: p.asa_tipos_punto?.icono,
    },
    area: insp.asa_areas?.nombre || null,
    nivel: insp.asa_areas?.nivel || null,
    planta: insp.asa_sitios?.nombre || null,
    cliente: insp.asa_sitios?.asa_clientes?.razon_social || insp.asa_sitios?.asa_clientes?.nombre_contacto || null,
    tecnico: insp.asa_empleados?.nombre_completo || null,
    // Se ordenan como las contesto el tecnico, no alfabeticamente: asi el que
    // lee el reporte sigue el mismo recorrido que hizo en el punto.
    respuestas: (respuestas.data || []).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))),
    capturas: (capturas.data || []).map((c) => ({
      ...c,
      plaga: c.asa_plagas?.nombre || "Sin clasificar",
      grupo: c.asa_plagas?.grupo || null,
      icono: c.asa_plagas?.icono || null,
      color: c.asa_plagas?.color || null,
      sobre_umbral: c.asa_plagas?.umbral_alerta != null ? c.cantidad > c.asa_plagas.umbral_alerta : null,
    })),
    hallazgos: hallazgos.data || [],
  });
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

  const [respuestas, capturas] = await Promise.all([
    supabase.from("asa_inspeccion_respuestas").select("*").eq("inspeccion_id", data.id),
    supabase.from("asa_capturas").select("*, asa_plagas(nombre, grupo, icono, color)").eq("inspeccion_id", data.id),
  ]);

  res.json({ ...data, respuestas: respuestas.data || [], capturas: capturas.data || [] });
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
const MOTIVOS_NO_REALIZADO = [
  "permiso_denegado", "huesped_en_habitacion", "area_ocupada", "sin_llave",
  "en_mantenimiento", "punto_inaccesible", "evento_en_curso", "otro",
];

async function registrarInspeccion(req, cuerpo) {
  const { punto_id, respuestas = [], capturas = [], clave_local: _omit, ...resto } = cuerpo;
  if (!punto_id) return { error: true, codigo: 400, mensaje: "punto_id es requerido" };

  // ── No realizado: motivo obligatorio ──────────────────────────────────────
  // "No pude entrar" sin decir por que no sirve para nada en auditoria, y es
  // justo el caso que el hotel discute. Si el tecnico marca no_accesible, el
  // motivo es obligatorio; y si manda un motivo, el estado se corrige solo para
  // que no queden filas contradictorias (estado ok con motivo de no realizado).
  if (resto.motivo_no_realizado) {
    if (!MOTIVOS_NO_REALIZADO.includes(resto.motivo_no_realizado)) {
      return { error: true, codigo: 400, mensaje: `motivo_no_realizado no valido. Validos: ${MOTIVOS_NO_REALIZADO.join(", ")}` };
    }
    resto.estado_punto = "no_accesible";
    resto.nivel_actividad = "ninguna";
  } else if (resto.estado_punto === "no_accesible") {
    return {
      error: true, codigo: 400,
      mensaje: "Si el servicio no se pudo hacer, hay que decir por que (motivo_no_realizado).",
    };
  }

  const { data: punto } = await supabase
    .from("asa_puntos_control")
    .select("id, sitio_id, area_id, codigo_visible, activo")
    .eq("id", punto_id)
    .maybeSingle();

  if (!punto) return { error: true, codigo: 404, mensaje: "El punto de control no existe" };
  if (!punto.activo) return { error: true, codigo: 410, mensaje: `El punto ${punto.codigo_visible} está dado de baja` };
  if (!puedeVerSitio(req, punto.sitio_id)) return { error: true, codigo: 403, mensaje: "Sin acceso a este hotel" };

  // Las fotos llegan en base64 desde el celular; se suben al bucket y en la
  // tabla queda la URL. Ver lib/evidencias.js para el por que.
  const fotos = await guardarFotos(resto.fotos, `inspecciones/${punto.sitio_id}`);

  const { data: inspeccion, error } = await supabase
    .from("asa_inspecciones")
    .insert([
      {
        ...resto,
        fotos,
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
    const filas = await Promise.all(
      respuestas.map(async (r) => ({
        inspeccion_id: inspeccion.id,
        pregunta_id: r.pregunta_id ?? null,
        pregunta_texto: r.pregunta_texto || "(sin texto)",
        valor_texto: r.valor_texto ?? null,
        valor_numero: r.valor_numero ?? null,
        valor_bool: r.valor_bool ?? null,
        valor_opciones: r.valor_opciones ?? [],
        fotos: await guardarFotos(r.fotos, `respuestas/${punto.sitio_id}`),
      }))
    );
    const { error: errR } = await supabase.from("asa_inspeccion_respuestas").insert(filas);
    if (errR) console.warn("[ASA][inspecciones] respuestas no guardadas:", errR.message);
  }

  // ── Conteo de plagas ──────────────────────────────────────────────────────
  // Una fila por plaga encontrada. Las de cantidad 0 no se guardan: la ausencia
  // ya esta dicha por la inspeccion misma con nivel_actividad = 'ninguna', y
  // llenar la tabla de ceros arruina cualquier promedio.
  const capturasValidas = (capturas || []).filter((c) => c?.plaga_id && Number(c.cantidad) > 0);
  if (capturasValidas.length) {
    const { error: errC } = await supabase.from("asa_capturas").upsert(
      capturasValidas.map((c) => ({
        inspeccion_id: inspeccion.id,
        plaga_id: c.plaga_id,
        cantidad: Math.round(Number(c.cantidad)),
        metodo: c.metodo || "conteo",
        etapa: c.etapa || null,
        observacion: c.observacion || null,
      })),
      { onConflict: "inspeccion_id,plaga_id,etapa", ignoreDuplicates: false }
    );
    if (errC) console.warn("[ASA][inspecciones] capturas no guardadas:", errC.message);
  }

  await abrirHallazgosAutomaticos(inspeccion, punto, respuestas);

  logAccion(req, {
    accion: "crear",
    modulo: "inspecciones",
    registroId: inspeccion.id,
    descripcion: inspeccion.motivo_no_realizado
      ? `NO realizado en ${punto.codigo_visible} — ${inspeccion.motivo_no_realizado}${inspeccion.impedido_por ? ` (${inspeccion.impedido_por})` : ""}`
      : `Inspección de ${punto.codigo_visible} — ${inspeccion.estado_punto}/${inspeccion.nivel_actividad}`,
  });

  return { inspeccion };
}

// Una respuesta puede estar configurada para abrir un hallazgo sola
// (asa_preguntas.genera_hallazgo_si). También se abre uno si el punto quedó
// dañado, faltante o con actividad alta.
async function abrirHallazgosAutomaticos(inspeccion, punto, respuestas) {
  const hallazgos = [];

  // Un servicio que no se pudo hacer abre su propio hallazgo, con el
  // responsable correcto: si el hotel no autorizo o no aparecio la llave, el
  // pendiente es del hotel, no de ASA. Es la diferencia que se discute en
  // auditoria, y queda escrita desde el momento en que pasa.
  if (inspeccion.motivo_no_realizado) {
    const delHotel = ["permiso_denegado", "sin_llave", "huesped_en_habitacion", "area_ocupada", "evento_en_curso"];
    hallazgos.push({
      titulo: `Servicio no realizado en ${punto.codigo_visible}`,
      descripcion: [
        `Motivo: ${inspeccion.motivo_no_realizado.replace(/_/g, " ")}`,
        inspeccion.impedido_por ? `Informado por: ${inspeccion.impedido_por}` : null,
        inspeccion.notas || null,
      ].filter(Boolean).join(". "),
      severidad: inspeccion.motivo_no_realizado === "permiso_denegado" ? "alta" : "media",
      responsable: delHotel.includes(inspeccion.motivo_no_realizado) ? "cliente" : "asa",
    });
  }

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
