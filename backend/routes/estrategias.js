// routes/estrategias.js — Estrategia del cliente y preguntas del checklist
//
// Al dar de alta un cliente se define su estrategia de manejo de plagas. Las
// preguntas de esa estrategia se asocian a un tipo de punto de control, y son
// las que la app del técnico muestra al escanear.
import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { logAccion } from "../lib/auditoria.js";
import { requireRol } from "../middleware/auth.js";

const router = express.Router();

// GET /estrategias?cliente_id=&sitio_id=&plantillas=true
router.get("/", async (req, res) => {
  let q = supabase
    .from("asa_estrategias")
    .select("*, asa_clientes(nombre_contacto, razon_social), asa_sitios(nombre)")
    .eq("activo", true)
    .order("nombre");

  if (req.query.cliente_id) q = q.eq("cliente_id", req.query.cliente_id);
  if (req.query.sitio_id) q = q.eq("sitio_id", req.query.sitio_id);
  if (req.query.plantillas === "true") q = q.eq("es_plantilla", true);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const { data: preguntas } = await supabase
    .from("asa_preguntas")
    .select("estrategia_id")
    .eq("activa", true);
  const conteo = {};
  for (const p of preguntas || []) conteo[p.estrategia_id] = (conteo[p.estrategia_id] || 0) + 1;

  res.json((data || []).map((e) => ({ ...e, preguntas_total: conteo[e.id] || 0 })));
});

// ─────────────────────────────────────────────────────────────────────────────
// ORDEN DE LAS RUTAS — no reordenar
//
// Todo lo de /preguntas/... va ARRIBA de /:id. Express resuelve por orden de
// declaracion, asi que con /:id declarado primero, un
// PUT /estrategias/preguntas/<uuid> entraba por /:id con id="preguntas": la
// consulta buscaba una estrategia llamada "preguntas", no encontraba nada y la
// edicion de la pregunta se perdia sin dar error visible. Ese era el bug de
// "modifico la estrategia y no guarda".
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Preguntas
// ─────────────────────────────────────────────────────────────────────────────

// POST /estrategias/:id/preguntas — una, o varias de golpe
router.post("/:id/preguntas", requireRol("operaciones", "comercial"), async (req, res) => {
  const entrada = Array.isArray(req.body.preguntas) ? req.body.preguntas : [req.body];
  const filas = entrada
    .filter((p) => p && p.texto)
    .map((p, i) => ({ ...p, estrategia_id: req.params.id, orden: p.orden ?? i }));

  if (!filas.length) return res.status(400).json({ error: true, mensaje: "Se requiere al menos una pregunta con texto" });

  const { data, error } = await supabase.from("asa_preguntas").insert(filas).select();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});

router.put("/preguntas/:preguntaId", requireRol("operaciones", "comercial"), async (req, res) => {
  const { id: _a, estrategia_id: _b, ...cambios } = req.body;
  const { data, error } = await supabase
    .from("asa_preguntas")
    .update(cambios)
    .eq("id", req.params.preguntaId)
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// Baja lógica: las inspecciones viejas guardan copia del texto de la pregunta,
// así que un reporte antiguo sigue mostrando lo que realmente se preguntó.
router.patch("/preguntas/:preguntaId", requireRol("operaciones", "comercial"), async (req, res) => {
  const { id: _a, estrategia_id: _b, ...cambios } = req.body;
  const { data, error } = await supabase
    .from("asa_preguntas")
    .update(cambios)
    .eq("id", req.params.preguntaId)
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

router.delete("/preguntas/:preguntaId", requireRol("operaciones", "comercial"), async (req, res) => {
  const { error } = await supabase.from("asa_preguntas").update({ activa: false }).eq("id", req.params.preguntaId);
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json({ ok: true });
});

// GET /estrategias/:id — con sus preguntas agrupadas por tipo de punto
router.get("/:id", async (req, res) => {
  const [estrategia, preguntas, tipos] = await Promise.all([
    supabase.from("asa_estrategias").select("*").eq("id", req.params.id).maybeSingle(),
    supabase.from("asa_preguntas").select("*").eq("estrategia_id", req.params.id).eq("activa", true).order("orden"),
    supabase.from("asa_tipos_punto").select("id, codigo, nombre, icono").eq("activo", true).order("orden"),
  ]);

  if (!estrategia.data) return res.status(404).json({ error: true, mensaje: "Estrategia no encontrada" });

  const porTipo = {};
  for (const p of preguntas.data || []) {
    const clave = p.tipo_punto_id || "general";
    (porTipo[clave] = porTipo[clave] || []).push(p);
  }

  res.json({
    ...estrategia.data,
    tipos: tipos.data || [],
    preguntas: preguntas.data || [],
    preguntas_por_tipo: porTipo,
  });
});

// POST /estrategias — { nombre, cliente_id?, contrato_id?, sitio_id?, preguntas?: [...] }
router.post("/", requireRol("operaciones", "comercial"), async (req, res) => {
  const { preguntas = [], copiar_de, ...estrategia } = req.body;
  if (!estrategia.nombre) return res.status(400).json({ error: true, mensaje: "nombre es requerido" });

  const { data, error } = await supabase.from("asa_estrategias").insert([estrategia]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  // Arrancar desde una plantilla existente
  let aInsertar = preguntas;
  if (copiar_de) {
    const { data: origen } = await supabase
      .from("asa_preguntas")
      .select("*")
      .eq("estrategia_id", copiar_de)
      .eq("activa", true);
    aInsertar = (origen || []).map(({ id, estrategia_id, created_at, ...p }) => p);
  }

  if (aInsertar.length) {
    const { error: errP } = await supabase
      .from("asa_preguntas")
      .insert(aInsertar.map((p, i) => ({ ...p, estrategia_id: data.id, orden: p.orden ?? i })));
    if (errP) return res.status(500).json({ error: true, mensaje: errP.message });
  }

  logAccion(req, { accion: "crear", modulo: "estrategias", registroId: data.id, descripcion: data.nombre });
  res.status(201).json({ ...data, preguntas_creadas: aInsertar.length });
});

async function actualizarEstrategia(req, res) {
  const { id: _omit, preguntas: _p, preguntas_total: _pt, asa_clientes: _c, asa_sitios: _s, ...cambios } = req.body;
  const { data, error } = await supabase
    .from("asa_estrategias")
    .update({ ...cambios, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .select();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  // .select() sin .single(): asi un id que no existe da 404 con mensaje, en vez
  // del error crudo de PostgREST "0 rows" que no le dice nada al usuario.
  if (!data || !data.length) {
    return res.status(404).json({ error: true, mensaje: "La estrategia no existe o ya fue dada de baja" });
  }
  logAccion(req, { accion: "actualizar", modulo: "estrategias", registroId: req.params.id, descripcion: data[0].nombre });
  res.json(data[0]);
}

router.put("/:id", requireRol("operaciones", "comercial"), actualizarEstrategia);
router.patch("/:id", requireRol("operaciones", "comercial"), actualizarEstrategia);

// DELETE /estrategias/:id — baja logica. Los puntos que la tenian asignada
// quedan sin estrategia, y las inspecciones viejas no se tocan: guardan copia
// del texto de cada pregunta, asi que un reporte de auditoria del ano pasado
// sigue mostrando lo que realmente se pregunto.
router.delete("/:id", requireRol("operaciones", "comercial"), async (req, res) => {
  const { data: enUso } = await supabase
    .from("asa_puntos_control")
    .select("id", { count: "exact", head: true })
    .eq("estrategia_id", req.params.id)
    .eq("activo", true);

  const { error } = await supabase
    .from("asa_estrategias")
    .update({ activo: false })
    .eq("id", req.params.id);
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  await supabase.from("asa_puntos_control").update({ estrategia_id: null }).eq("estrategia_id", req.params.id);
  logAccion(req, { accion: "eliminar", modulo: "estrategias", registroId: req.params.id });
  res.json({ ok: true, puntos_liberados: enUso ?? null });
});

// POST /estrategias/:id/duplicar — copia la estrategia con todas sus preguntas.
// Es la salida limpia cuando una estrategia ya se uso en inspecciones y quieres
// cambiarla sin tocar el historial: duplicas, ajustas la copia y reasignas.
router.post("/:id/duplicar", requireRol("operaciones", "comercial"), async (req, res) => {
  const { data: origen } = await supabase.from("asa_estrategias").select("*").eq("id", req.params.id).maybeSingle();
  if (!origen) return res.status(404).json({ error: true, mensaje: "Estrategia no encontrada" });

  const { id: _i, created_at: _c, updated_at: _u, ...base } = origen;
  const { data: copia, error } = await supabase
    .from("asa_estrategias")
    .insert([{ ...base, nombre: req.body.nombre || `${origen.nombre} (copia)` }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const { data: preguntas } = await supabase
    .from("asa_preguntas")
    .select("*")
    .eq("estrategia_id", req.params.id)
    .eq("activa", true);

  if (preguntas?.length) {
    await supabase.from("asa_preguntas").insert(
      preguntas.map(({ id, estrategia_id, created_at, ...p }) => ({ ...p, estrategia_id: copia.id }))
    );
  }
  logAccion(req, { accion: "crear", modulo: "estrategias", registroId: copia.id, descripcion: `Copia de ${origen.nombre}` });
  res.status(201).json({ ...copia, preguntas_copiadas: preguntas?.length || 0 });
});

// POST /estrategias/plantilla-base — crea la estrategia estándar de ASA
// con las preguntas típicas por tipo de punto. Punto de partida editable.
router.post("/plantilla-base", requireRol("operaciones"), async (req, res) => {
  const { data: tipos } = await supabase.from("asa_tipos_punto").select("id, codigo");
  const idDe = (c) => tipos?.find((t) => t.codigo === c)?.id ?? null;

  const { data: estrategia, error } = await supabase
    .from("asa_estrategias")
    .insert([{
      nombre: req.body.nombre || "Estrategia estándar ASA",
      descripcion: "Plantilla base de manejo integrado de plagas. Duplícala y ajústala por cliente.",
      es_plantilla: true,
      cliente_id: req.body.cliente_id ?? null,
    }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const P = [
    // Cebaderos de roedores
    ["cebadero_roedor", "¿La estación está en su lugar y en buen estado?", "si_no", null, { igual: "false", severidad: "media", responsable: "asa" }],
    ["cebadero_roedor", "Consumo de cebo", "seleccion", ["ninguno", "leve", "parcial", "total"], null],
    ["cebadero_roedor", "Capturas encontradas", "numero", null, { mayor_que: 0, severidad: "alta", responsable: "asa" }],
    ["cebadero_roedor", "¿Se repuso el cebo?", "si_no", null, null],
    // Lámparas de moscas
    ["lampara_moscas", "¿El tubo UV está encendido?", "si_no", null, { igual: "false", severidad: "media", responsable: "cliente" }],
    ["lampara_moscas", "Conteo de insectos en la lámina", "numero", null, null],
    ["lampara_moscas", "¿Se cambió la lámina adhesiva?", "si_no", null, null],
    // Dispensadores de aerosol
    ["dispensador_aerosol", "¿El equipo está funcionando?", "si_no", null, { igual: "false", severidad: "media", responsable: "asa" }],
    ["dispensador_aerosol", "Carga restante del cartucho (%)", "numero", null, { menor_que: 20, severidad: "baja", responsable: "asa" }],
    // Habitaciones
    ["habitacion", "¿Se realizó la aplicación?", "si_no", null, null],
    ["habitacion", "Producto aplicado", "texto", null, null],
    ["habitacion", "¿Se detectó evidencia de plagas?", "si_no", null, { igual: "true", severidad: "alta", responsable: "asa" }],
    ["habitacion", "Tipo de evidencia encontrada", "seleccion", ["ninguna", "chinches", "cucarachas", "hormigas", "roedores", "otra"], null],
    // General, para cualquier punto
    [null, "¿Hay condiciones que favorezcan plagas? (basura, humedad, accesos abiertos)", "si_no", null, { igual: "true", severidad: "media", responsable: "cliente" }],
    [null, "Observaciones del técnico", "texto", null, null],
  ];

  const { data: preguntas, error: errP } = await supabase.from("asa_preguntas").insert(
    P.map(([tipo, texto, tipo_respuesta, opciones, regla], i) => ({
      estrategia_id: estrategia.id,
      tipo_punto_id: tipo ? idDe(tipo) : null,
      texto,
      tipo_respuesta,
      opciones: opciones || [],
      genera_hallazgo_si: regla,
      obligatoria: tipo_respuesta !== "texto",
      orden: i,
    }))
  ).select();
  if (errP) return res.status(500).json({ error: true, mensaje: errP.message });

  res.status(201).json({ ...estrategia, preguntas: preguntas.length });
});

export default router;
