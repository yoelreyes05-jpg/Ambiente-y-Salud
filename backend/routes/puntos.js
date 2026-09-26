// routes/puntos.js — Puntos de control (el corazón del sistema)
//
// Un punto de control es cualquier cosa que el técnico debe revisar: un
// cebadero, una lámpara de moscas, un dispensador de aerosol, una habitación.
// Cada uno lleva un QR cuyo token NUNCA cambia (lo garantiza un trigger en la
// base de datos), así que la calcomanía pegada en la pared sigue sirviendo
// aunque renombres el punto o lo muevas de área.
import express from "express";
import ExcelJS from "exceljs";
import { supabase } from "../lib/supabaseClient.js";
import { logAccion } from "../lib/auditoria.js";
import { requireRol, filtrarPorSitio, exigirSitioPermitido, puedeVerSitio } from "../middleware/auth.js";

const router = express.Router();

// La URL que se codifica en el QR: al escanear con cualquier cámara, el
// teléfono abre la app del técnico directo en ese punto.
const APP_TECNICO_URL = (process.env.APP_TECNICO_URL || "https://asa-tecnico.vercel.app").replace(/\/$/, "");
export const urlQR = (token) => `${APP_TECNICO_URL}/p/${token}`;

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo de tipos de punto
// ─────────────────────────────────────────────────────────────────────────────
const FRECUENCIAS_VALIDAS = ["diaria", "semanal", "quincenal", "mensual", "trimestral", "por_orden"];

router.get("/tipos", async (req, res) => {
  const { data, error } = await supabase
    .from("asa_tipos_punto")
    .select("*")
    .eq("activo", true)
    .order("orden");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

router.post("/tipos", requireRol("operaciones"), async (req, res) => {
  const { data, error } = await supabase.from("asa_tipos_punto").insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});

// PUT /puntos/tipos/:id — editar un tipo (sobre todo su frecuencia por defecto)
//
// El `codigo` no se acepta: los puntos ya creados y el importador lo usan como
// llave, así que cambiarlo rompería referencias silenciosamente. Para renombrar
// se edita `nombre`, que es lo que se muestra.
router.put("/tipos/:id", requireRol("operaciones"), async (req, res) => {
  const { id: _a, codigo: _b, created_at: _c, ...cambios } = req.body;

  if (cambios.frecuencia_default && !FRECUENCIAS_VALIDAS.includes(cambios.frecuencia_default)) {
    return res.status(400).json({
      error: true,
      mensaje: `frecuencia_default debe ser una de: ${FRECUENCIAS_VALIDAS.join(", ")}`,
    });
  }

  const { data, error } = await supabase
    .from("asa_tipos_punto")
    .update(cambios)
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: mensajeAmable(error) });

  logAccion(req, { accion: "actualizar", modulo: "tipos_punto", registroId: data.id, descripcion: data.nombre });
  res.json(data);
});

// ─────────────────────────────────────────────────────────────────────────────
// Qué lleva cada tipo de punto: sus estrategias y sus plagas
//
// Es la amarra que faltaba. Sin ella, la app no tenía forma de saber que en una
// lámpara no se cuentan chinches y que un aerosol no lleva el checklist de las
// habitaciones, así que lo mostraba todo en todos lados.
//
// Se guarda por reemplazo (borrar y volver a insertar) y no fila por fila: son
// listas de diez elementos y el panel manda la lista completa, así no quedan
// sobras de un guardado a medias.
// ─────────────────────────────────────────────────────────────────────────────

// GET /puntos/tipos/:id/config — lo que tiene el tipo y todo lo que puede tener
router.get("/tipos/:id/config", async (req, res) => {
  const tipoId = req.params.id;

  const [tipo, ligadasE, ligadasP, estrategias, plagas, preguntas] = await Promise.all([
    supabase.from("asa_tipos_punto").select("*").eq("id", tipoId).maybeSingle(),
    supabase.from("asa_tipo_punto_estrategias").select("estrategia_id, orden").eq("tipo_punto_id", tipoId),
    supabase.from("asa_tipo_punto_plagas").select("plaga_id, orden").eq("tipo_punto_id", tipoId),
    supabase.from("asa_estrategias").select("id, nombre, descripcion").eq("activo", true).order("nombre"),
    supabase.from("asa_plagas").select("id, codigo, nombre, grupo, icono, orden").eq("activo", true).order("orden"),
    // Cuántas preguntas tiene cada estrategia PARA ESTE TIPO. Es el dato que
    // hace falta al elegir: marcar una estrategia que no tiene ni una pregunta
    // de este tipo no cambia nada en la app, y sin este número no se nota.
    supabase.from("asa_preguntas").select("estrategia_id, tipo_punto_id").eq("activa", true),
  ]);

  if (!tipo.data) return res.status(404).json({ error: true, mensaje: "Ese tipo de punto no existe" });

  const conteo = {};
  for (const p of preguntas.data || []) {
    if (p.tipo_punto_id !== tipoId && p.tipo_punto_id !== null) continue;
    const c = (conteo[p.estrategia_id] = conteo[p.estrategia_id] || { propias: 0, generales: 0 });
    if (p.tipo_punto_id === tipoId) c.propias++;
    else c.generales++;
  }

  res.json({
    tipo: tipo.data,
    estrategias: (estrategias.data || []).map((e) => ({
      ...e,
      ligada: (ligadasE.data || []).some((x) => x.estrategia_id === e.id),
      preguntas_de_este_tipo: conteo[e.id]?.propias || 0,
      preguntas_generales: conteo[e.id]?.generales || 0,
    })),
    plagas: (plagas.data || []).map((p) => ({
      ...p,
      ligada: (ligadasP.data || []).some((x) => x.plaga_id === p.id),
    })),
  });
});

// PUT /puntos/tipos/:id/config — guardar las dos listas de una vez
// Body: { estrategias: [id, …], plagas: [id, …] }
router.put("/tipos/:id/config", requireRol("operaciones"), async (req, res) => {
  const tipoId = req.params.id;
  const limpiar = (v) => [...new Set((Array.isArray(v) ? v : []).filter(Boolean))];
  const estrategias = limpiar(req.body?.estrategias);
  const plagas = limpiar(req.body?.plagas);

  const { data: tipo } = await supabase.from("asa_tipos_punto").select("id, nombre").eq("id", tipoId).maybeSingle();
  if (!tipo) return res.status(404).json({ error: true, mensaje: "Ese tipo de punto no existe" });

  const borrarE = await supabase.from("asa_tipo_punto_estrategias").delete().eq("tipo_punto_id", tipoId);
  if (borrarE.error) return res.status(500).json({ error: true, mensaje: borrarE.error.message });
  if (estrategias.length) {
    const { error } = await supabase
      .from("asa_tipo_punto_estrategias")
      .insert(estrategias.map((id, i) => ({ tipo_punto_id: tipoId, estrategia_id: id, orden: i * 10 })));
    if (error) return res.status(500).json({ error: true, mensaje: error.message });
  }

  const borrarP = await supabase.from("asa_tipo_punto_plagas").delete().eq("tipo_punto_id", tipoId);
  if (borrarP.error) return res.status(500).json({ error: true, mensaje: borrarP.error.message });
  if (plagas.length) {
    const { error } = await supabase
      .from("asa_tipo_punto_plagas")
      .insert(plagas.map((id, i) => ({ tipo_punto_id: tipoId, plaga_id: id, orden: i * 10 })));
    if (error) return res.status(500).json({ error: true, mensaje: error.message });
  }

  logAccion(req, {
    accion: "actualizar",
    modulo: "tipos_punto",
    registroId: tipoId,
    descripcion: `${tipo.nombre}: ${estrategias.length} estrategias y ${plagas.length} plagas`,
    detalle: { estrategias, plagas },
  });

  res.json({ ok: true, estrategias: estrategias.length, plagas: plagas.length });
});

// GET /puntos/tipos/resumen — cuántas estrategias y plagas lleva cada tipo
// Se usa en el listado del panel para ver de un vistazo cuál quedó sin nada.
router.get("/tipos/resumen", async (req, res) => {
  const [tipos, ligadasE, ligadasP] = await Promise.all([
    supabase.from("asa_tipos_punto").select("id").eq("activo", true),
    supabase.from("asa_tipo_punto_estrategias").select("tipo_punto_id"),
    supabase.from("asa_tipo_punto_plagas").select("tipo_punto_id"),
  ]);

  const contar = (filas, id) => (filas || []).filter((x) => x.tipo_punto_id === id).length;
  res.json(
    (tipos.data || []).map((t) => ({
      id: t.id,
      estrategias: contar(ligadasE.data, t.id),
      plagas: contar(ligadasP.data, t.id),
    }))
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Listado y semáforo
// ─────────────────────────────────────────────────────────────────────────────

// GET /puntos?sitio_id=&area_id=&tipo=&estado=pendientes|realizados
//
// Devuelve los puntos con su última inspección y si están vencidos. El panel
// usa `estado` para armar los dos recuadros: lo hecho y lo que falta.
router.get("/", async (req, res) => {
  const { sitio_id, area_id, tipo, estado } = req.query;
  if (!sitio_id) return res.status(400).json({ error: true, mensaje: "sitio_id es requerido" });
  if (!exigirSitioPermitido(req, res, sitio_id)) return;

  let q = supabase.from("asa_v_puntos_estado").select("*").eq("sitio_id", sitio_id);
  if (area_id) q = q.eq("area_id", area_id);
  if (tipo) q = q.eq("tipo_codigo", tipo);

  const { data, error } = await q.order("area_nombre").order("codigo_visible");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
  const conHoy = (data || []).map((p) => ({
    ...p,
    url_qr: urlQR(p.qr_token),
    hecho_hoy: p.ultima_inspeccion
      ? new Date(p.ultima_inspeccion).toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" }) === hoy
      : false,
  }));

  if (estado === "realizados") return res.json(conHoy.filter((p) => p.hecho_hoy));
  if (estado === "pendientes") return res.json(conHoy.filter((p) => !p.hecho_hoy));

  res.json({
    total: conHoy.length,
    realizados: conHoy.filter((p) => p.hecho_hoy),
    pendientes: conHoy.filter((p) => !p.hecho_hoy),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /puntos/estado?sitio_id=&tipo=&area_id=
//
// El semáforo de la planta: cada punto en verde (hecho) o en rojo (por hacer),
// agrupable por área y filtrable por tipo, para que "habitaciones" muestre solo
// habitaciones y "cebaderos" solo cebaderos. Lo usan el panel (pestaña
// "Pendientes por área") y el portal del hotel ("Por hacer").
//
// Estados:
//   hecho_hoy     — tiene un servicio realizado hoy                    (verde)
//   al_dia        — no se tocó hoy, pero está dentro de su frecuencia  (verde)
//   no_realizado  — hoy se intentó y no se pudo (con motivo)           (rojo)
//   por_hacer     — ya pasó su frecuencia y no tiene servicio          (rojo)
//
// Los tipos y las áreas se cuentan ANTES de filtrar, para que los selectores
// siempre muestren todas las opciones con su total.
// ─────────────────────────────────────────────────────────────────────────────
async function traerTodo(armarConsulta) {
  // PostgREST corta en 1000 filas; una planta grande tiene más puntos que eso.
  const out = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await armarConsulta().range(desde, desde + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

router.get("/estado", async (req, res) => {
  const { sitio_id, tipo, area_id } = req.query;
  if (!sitio_id) return res.status(400).json({ error: true, mensaje: "sitio_id es requerido" });
  if (!exigirSitioPermitido(req, res, sitio_id)) return;

  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });

  let puntos, servicios;
  try {
    [puntos, servicios] = await Promise.all([
      traerTodo(() =>
        supabase.from("asa_v_puntos_estado")
          .select("id, codigo_visible, punto_nombre, numero_habitacion, area_id, area_nombre, tipo_codigo, tipo_nombre, tipo_icono, tipo_color, frecuencia, ultima_inspeccion, vencido")
          .eq("sitio_id", sitio_id)
          .order("area_nombre").order("codigo_visible")
      ),
      traerTodo(() =>
        supabase.from("asa_v_servicios_dia")
          .select("inspeccion_id, punto_id, fecha, no_realizado, motivo_no_realizado, tecnico, nivel_actividad")
          .eq("sitio_id", sitio_id)
          .eq("fecha_local", hoy)
          .order("fecha", { ascending: true })
      ),
    ]);
  } catch (e) {
    return res.status(500).json({ error: true, mensaje: e.message });
  }

  // Por punto: el último realizado de hoy manda sobre un no realizado de hoy
  // (si primero no lo dejaron entrar y después sí, el punto quedó hecho).
  const hechoHoy = new Map();
  const intentoHoy = new Map();
  for (const s of servicios) {
    if (s.no_realizado) intentoHoy.set(s.punto_id, s);
    else hechoHoy.set(s.punto_id, s);
  }

  const tipos = new Map();
  for (const p of puntos) {
    const k = p.tipo_codigo || "otro";
    if (!tipos.has(k)) tipos.set(k, { codigo: k, nombre: p.tipo_nombre, icono: p.tipo_icono, total: 0 });
    tipos.get(k).total++;
  }

  const filtrados = puntos.filter((p) => (!tipo || p.tipo_codigo === tipo) && (!area_id || p.area_id === area_id));

  const lista = filtrados.map((p) => {
    const h = hechoHoy.get(p.id);
    const n = intentoHoy.get(p.id);
    let estado;
    if (h) estado = "hecho_hoy";
    else if (n) estado = "no_realizado";
    else if (p.frecuencia === "por_orden") estado = "al_dia";
    else estado = p.vencido ? "por_hacer" : "al_dia";
    return {
      id: p.id,
      codigo_visible: p.codigo_visible,
      punto_nombre: p.punto_nombre,
      numero_habitacion: p.numero_habitacion,
      area_id: p.area_id,
      area_nombre: p.area_nombre || "Sin área",
      tipo_codigo: p.tipo_codigo,
      tipo_nombre: p.tipo_nombre,
      tipo_icono: p.tipo_icono,
      frecuencia: p.frecuencia,
      ultima_inspeccion: p.ultima_inspeccion,
      estado,
      inspeccion_id: (h || n)?.inspeccion_id || null,
      hora: (h || n)?.fecha || null,
      tecnico: (h || n)?.tecnico || null,
      motivo_no_realizado: !h && n ? n.motivo_no_realizado : null,
      nivel_actividad: h?.nivel_actividad || null,
    };
  });

  // Áreas del tipo elegido (no de toda la planta), con su conteo verde / rojo.
  const areas = new Map();
  for (const p of lista) {
    const k = p.area_id || "sin_area";
    if (!areas.has(k)) areas.set(k, { id: p.area_id, nombre: p.area_nombre, total: 0, hechos: 0, por_hacer: 0 });
    const a = areas.get(k);
    a.total++;
    if (p.estado === "hecho_hoy" || p.estado === "al_dia") a.hechos++;
    else a.por_hacer++;
  }

  const cuenta = (e) => lista.filter((p) => p.estado === e).length;
  res.json({
    fecha: hoy,
    tipos: [...tipos.values()].sort((a, b) => b.total - a.total),
    areas: [...areas.values()].sort((a, b) => b.por_hacer - a.por_hacer || String(a.nombre).localeCompare(String(b.nombre))),
    resumen: {
      total: lista.length,
      hechos_hoy: cuenta("hecho_hoy"),
      al_dia: cuenta("al_dia"),
      no_realizados: cuenta("no_realizado"),
      por_hacer: cuenta("por_hacer"),
    },
    puntos: lista,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ETIQUETAS QR ADICIONALES (31_etiquetas_qr.sql)
//
// Hay muchas etiquetas ya impresas y pegadas que no abren ningún punto. El QR
// principal de un punto no se puede cambiar, así que a un punto se le pueden
// colgar etiquetas EXTRA: escanear cualquiera abre el mismo punto.
//
//   asa_qr_impresos       — el grupo de etiquetas que ASA mandó a imprimir
//   asa_qr_etiquetas      — etiqueta extra → punto
//   asa_qr_no_reconocidos — lo que se escaneó y no abrió nada (para asignarlo)
// ─────────────────────────────────────────────────────────────────────────────

// Lo que venga en el QR, tal cual o como URL, reducido al código.
function tokenDesdeTexto(valor) {
  let t = String(valor || "").trim();
  try { t = decodeURIComponent(t); } catch {}
  const conP = t.match(/\/p\/([^/?#\s]+)/i);
  if (conP) t = conP[1];
  else if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      const param = ["qr", "code", "codigo", "id", "token", "c"].map((k) => u.searchParams.get(k)).find(Boolean);
      t = param || u.pathname.split("/").filter(Boolean).pop() || "";
    } catch {}
  }
  return normalizarQR(t);
}

// Devuelve el id del punto que abre ese código, o null. Busca en el QR
// principal (tal cual y en mayúsculas) y en las etiquetas adicionales.
async function puntoPorToken(valor) {
  const crudo = String(valor || "").trim();
  const token = tokenDesdeTexto(crudo);
  const candidatos = [...new Set([crudo, token].filter(Boolean))];
  const { data: principal, error } = await supabase
    .from("asa_puntos_control").select("id").in("qr_token", candidatos).limit(1);
  if (error) throw error;
  if (principal?.length) return { punto_id: principal[0].id, token, via: "principal" };
  const { data: extra, error: e2 } = await supabase
    .from("asa_qr_etiquetas").select("punto_id").eq("token", token).maybeSingle();
  if (e2 && e2.code !== "42P01") throw e2; // 42P01: aún no se corrió el SQL 31
  if (extra) return { punto_id: extra.punto_id, token, via: "etiqueta" };
  return { punto_id: null, token };
}

async function enLoteImpreso(token) {
  const { data, error } = await supabase.from("asa_qr_impresos").select("lote, archivo").eq("token", token).maybeSingle();
  if (error) return null;
  return data;
}

// GET /puntos/etiquetas/estado/:token — qué es este código
router.get("/etiquetas/estado/:token", async (req, res) => {
  try {
    const r = await puntoPorToken(req.params.token);
    const lote = await enLoteImpreso(r.token);
    let punto = null;
    if (r.punto_id) {
      const { data } = await supabase
        .from("asa_puntos_control")
        .select("id, codigo_visible, nombre, numero_habitacion, sitio_id, activo, asa_sitios(nombre), asa_areas(nombre)")
        .eq("id", r.punto_id).maybeSingle();
      if (data && puedeVerSitio(req, data.sitio_id)) punto = data;
    }
    res.json({ token: r.token, asignado: !!r.punto_id, via: r.via || null, punto, en_lote: !!lote, lote: lote?.lote || null, archivo: lote?.archivo || null });
  } catch (e) {
    res.status(500).json({ error: true, mensaje: mensajeAmable(e) });
  }
});

// GET /puntos/etiquetas/no-reconocidas?sitio_id= — escaneadas sin asignar
router.get("/etiquetas/no-reconocidas", async (req, res) => {
  let q = supabase.from("asa_qr_no_reconocidos").select("*, asa_sitios(nombre)").order("ultimo_escaneo", { ascending: false }).limit(500);
  if (req.query.sitio_id) {
    if (!exigirSitioPermitido(req, res, req.query.sitio_id)) return;
    q = q.eq("sitio_id", req.query.sitio_id);
  } else q = filtrarPorSitio(q, req);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: mensajeAmable(error) });
  const tokens = (data || []).map((x) => x.token);
  const { data: lote } = tokens.length
    ? await supabase.from("asa_qr_impresos").select("token, lote").in("token", tokens)
    : { data: [] };
  const deLote = new Map((lote || []).map((x) => [x.token, x.lote]));
  res.json((data || []).map((x) => ({ ...x, id: x.token, en_lote: deLote.has(x.token), lote: deLote.get(x.token) || null })));
});

// GET /puntos/etiquetas/impresos/resumen — cuántas hay por lote y cuántas libres
router.get("/etiquetas/impresos/resumen", async (req, res) => {
  const todas = [];
  for (let ini = 0; ; ini += 1000) {
    const { data, error } = await supabase.from("asa_qr_impresos").select("token, lote").range(ini, ini + 999);
    if (error) return res.status(500).json({ error: true, mensaje: mensajeAmable(error) });
    todas.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const lotes = new Map();
  for (const t of todas) {
    const k = t.lote || "Sin lote";
    lotes.set(k, (lotes.get(k) || 0) + 1);
  }
  res.json({ total: todas.length, lotes: [...lotes.entries()].map(([lote, total]) => ({ lote, total })) });
});

// POST /puntos/etiquetas/impresos — { tokens:[...], lote, archivo }
// Carga el grupo de etiquetas impresas. Repetidas se ignoran.
router.post("/etiquetas/impresos", requireRol("operaciones"), async (req, res) => {
  const { lote = null, archivo = null } = req.body || {};
  const tokens = [...new Set((req.body?.tokens || []).map(tokenDesdeTexto).filter((t) => FORMATO_QR.test(t)))];
  if (!tokens.length) return res.status(400).json({ error: true, mensaje: "No se encontró ningún código válido en la lista." });
  let nuevos = 0;
  for (let i = 0; i < tokens.length; i += 500) {
    const trozo = tokens.slice(i, i + 500).map((token) => ({ token, lote, archivo }));
    const { data, error } = await supabase.from("asa_qr_impresos").upsert(trozo, { onConflict: "token", ignoreDuplicates: true }).select("token");
    if (error) return res.status(500).json({ error: true, mensaje: mensajeAmable(error) });
    nuevos += (data || []).length;
  }
  logAccion(req, { accion: "crear", modulo: "etiquetas_qr", descripcion: `Lote ${lote || ""}: ${tokens.length} códigos (${nuevos} nuevos)` });
  res.json({ recibidos: tokens.length, nuevos, repetidos: tokens.length - nuevos });
});

// GET /puntos/:id/etiquetas — las etiquetas extra de un punto
router.get("/:id/etiquetas", async (req, res) => {
  const { data, error } = await supabase.from("asa_qr_etiquetas").select("*").eq("punto_id", req.params.id).order("created_at");
  if (error) return res.status(500).json({ error: true, mensaje: mensajeAmable(error) });
  res.json(data || []);
});

// POST /puntos/:id/etiquetas — { token, origen? } — colgarle una etiqueta al punto
router.post("/:id/etiquetas", requireRol("operaciones"), async (req, res) => {
  const token = tokenDesdeTexto(req.body?.token);
  if (!FORMATO_QR.test(token)) {
    return res.status(400).json({ error: true, mensaje: `"${req.body?.token || ""}" no parece un código de etiqueta válido.` });
  }
  const { data: punto } = await supabase.from("asa_puntos_control").select("id, codigo_visible, sitio_id, activo").eq("id", req.params.id).maybeSingle();
  if (!punto) return res.status(404).json({ error: true, mensaje: "Punto no encontrado" });
  if (!exigirSitioPermitido(req, res, punto.sitio_id)) return;
  if (!punto.activo) return res.status(409).json({ error: true, mensaje: "Ese punto está dado de baja." });

  try {
    const ya = await puntoPorToken(token);
    if (ya.punto_id) {
      const { data: otro } = await supabase.from("asa_puntos_control").select("codigo_visible, asa_sitios(nombre)").eq("id", ya.punto_id).maybeSingle();
      const mismo = ya.punto_id === punto.id;
      return res.status(409).json({
        error: true,
        mensaje: mismo
          ? `Esa etiqueta ya abre este mismo punto (${punto.codigo_visible}).`
          : `Esa etiqueta ya abre el punto ${otro?.codigo_visible || ""}${otro?.asa_sitios?.nombre ? ` en ${otro.asa_sitios.nombre}` : ""}.`,
      });
    }
  } catch (e) {
    return res.status(500).json({ error: true, mensaje: mensajeAmable(e) });
  }

  const origen = ["panel", "foto", "escaneo", "lote"].includes(req.body?.origen) ? req.body.origen : "panel";
  const { data, error } = await supabase
    .from("asa_qr_etiquetas")
    .insert([{ token, punto_id: punto.id, origen, creado_por: req.usuario?.id || null, creado_por_nombre: req.usuario?.nombre || null }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: mensajeAmable(error) });
  const lote = await enLoteImpreso(token);
  logAccion(req, { accion: "crear", modulo: "etiquetas_qr", registroId: punto.id, descripcion: `Etiqueta ${token} → ${punto.codigo_visible}${lote ? "" : " (fuera del lote impreso)"}` });
  res.status(201).json({ ...data, en_lote: !!lote, lote: lote?.lote || null });
});

// DELETE /puntos/etiquetas/:token — soltar una etiqueta extra (asignada por error)
router.delete("/etiquetas/:token", requireRol("operaciones"), async (req, res) => {
  const token = tokenDesdeTexto(req.params.token);
  const { data: et } = await supabase.from("asa_qr_etiquetas").select("id, punto_id, asa_puntos_control(sitio_id, codigo_visible)").eq("token", token).maybeSingle();
  if (!et) return res.status(404).json({ error: true, mensaje: "Esa etiqueta no está asignada como adicional." });
  if (!exigirSitioPermitido(req, res, et.asa_puntos_control?.sitio_id)) return;
  const { error } = await supabase.from("asa_qr_etiquetas").delete().eq("id", et.id);
  if (error) return res.status(500).json({ error: true, mensaje: mensajeAmable(error) });
  logAccion(req, { accion: "eliminar", modulo: "etiquetas_qr", registroId: et.punto_id, descripcion: `Etiqueta ${token} soltada de ${et.asa_puntos_control?.codigo_visible || ""}` });
  res.json({ ok: true });
});

// GET /puntos/buscar?q=&sitio_id= — respaldo cuando el QR está dañado o ilegible
// ─────────────────────────────────────────────────────────────────────────────
// GET /puntos/buscar?q=&sitio_id=
//
// El tecnico busca como habla, no como esta guardada la base. Escribe "cocina"
// y espera los puntos DE las cocinas; escribe "aerosol" y espera los
// dispensadores; escribe "4312" y espera esa habitacion. Antes solo se miraba
// el codigo, el nombre y el numero de habitacion, asi que buscar por area o por
// tipo no devolvia nada y parecia que el punto no existia.
//
// Como esta resuelto: area y tipo viven en OTRAS tablas, y PostgREST no filtra
// comodo por columnas de una tabla unida dentro de un `or`. Asi que primero se
// resuelven las areas y los tipos que coinciden con el texto, y despues se
// piden los puntos que sean de esas areas o de esos tipos, o cuyo propio texto
// coincida. Son dos viajes en vez de uno, y a cambio la busqueda encuentra lo
// que el tecnico tiene en la cabeza.
//
// Con UNA letra se buscan los que EMPIEZAN con ella ("c" no puede devolver
// medio hotel); desde dos letras, los que la contienen.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/buscar", async (req, res) => {
  const termino = (req.query.q || "").trim();
  if (!termino) return res.json([]);

  // Los comodines de ilike y los separadores del `or` de PostgREST rompen la
  // consulta si llegan tal cual desde el buscador.
  const limpio = termino.replace(/[%_,().*]/g, " ").trim();
  if (!limpio) return res.json([]);

  const patron = limpio.length === 1 ? `${limpio}%` : `%${limpio}%`;
  const sitio = req.query.sitio_id || null;

  // 1) Areas y tipos que coinciden con lo escrito
  let qAreas = supabase.from("asa_areas").select("id, nombre").eq("activo", true).ilike("nombre", patron);
  if (sitio) qAreas = qAreas.eq("sitio_id", sitio);

  const [areas, tipos] = await Promise.all([
    qAreas,
    supabase.from("asa_tipos_punto").select("id, nombre, codigo").eq("activo", true)
      .or(`nombre.ilike.${patron},codigo.ilike.${patron}`),
  ]);

  const idsArea = (areas.data || []).map((a) => a.id);
  const idsTipo = (tipos.data || []).map((t) => t.id);

  // 2) Puntos: por su propio texto, o por pertenecer a esas areas o tipos
  const condiciones = [
    `codigo_visible.ilike.${patron}`,
    `nombre.ilike.${patron}`,
    `numero_habitacion.ilike.${patron}`,
    `ubicacion_descripcion.ilike.${patron}`,
  ];
  if (idsArea.length) condiciones.push(`area_id.in.(${idsArea.join(",")})`);
  if (idsTipo.length) condiciones.push(`tipo_punto_id.in.(${idsTipo.join(",")})`);

  let q = supabase
    .from("asa_puntos_control")
    .select("id, qr_token, codigo_visible, nombre, numero_habitacion, ubicacion_descripcion, sitio_id, area_id, tipo_punto_id, asa_areas(nombre, nivel), asa_tipos_punto(nombre, icono, codigo), asa_sitios(nombre)")
    .eq("activo", true)
    .or(condiciones.join(","))
    .limit(120);

  if (sitio) q = q.eq("sitio_id", sitio);
  q = filtrarPorSitio(q, req);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  // 3) Orden: primero lo que empieza con lo escrito, despues lo que lo contiene,
  //    y al final lo que coincidio por area o por tipo. Buscar "410" tiene que
  //    poner la habitacion 410 arriba, no la de un area que se llame parecido.
  const t = limpio.toLowerCase();
  const empieza = (v) => String(v || "").toLowerCase().startsWith(t);
  const contiene = (v) => String(v || "").toLowerCase().includes(t);

  const puntuar = (p) => {
    if (empieza(p.codigo_visible) || empieza(p.numero_habitacion)) return 0;
    if (empieza(p.nombre)) return 1;
    if (contiene(p.codigo_visible) || contiene(p.numero_habitacion) || contiene(p.nombre)) return 2;
    if (contiene(p.ubicacion_descripcion)) return 3;
    if (contiene(p.asa_tipos_punto?.nombre)) return 4;
    return 5;   // coincidio por area
  };

  const conMotivo = (data || []).map((p) => ({
    ...p,
    // Por que salio: la app lo muestra para que el tecnico entienda el
    // resultado en vez de dudar de el.
    coincidio_por: puntuar(p) <= 3 ? "punto" : puntuar(p) === 4 ? "tipo" : "area",
    _orden: puntuar(p),
  }));

  conMotivo.sort((a, b) =>
    a._orden - b._orden ||
    String(a.asa_areas?.nombre || "").localeCompare(String(b.asa_areas?.nombre || "")) ||
    String(a.numero_habitacion || a.codigo_visible).localeCompare(String(b.numero_habitacion || b.codigo_visible), "es", { numeric: true })
  );

  res.json(conMotivo.map(({ _orden, ...p }) => p));
});

// GET /puntos/qr/:token — lo que ve el técnico al escanear
//
// Devuelve todo de una vez para que la app no tenga que hacer 4 llamadas en el
// sótano de un hotel sin señal: ficha, checklist que aplica y últimas visitas.
router.get("/qr/:token", async (req, res) => {
  // El código puede ser el QR principal del punto o una etiqueta adicional
  // (asa_qr_etiquetas), y puede venir en minúsculas o dentro de una URL.
  let resuelto;
  try {
    resuelto = await puntoPorToken(req.params.token);
  } catch (e) {
    return res.status(500).json({ error: true, mensaje: mensajeAmable(e) });
  }
  if (!resuelto.punto_id) {
    // Se anota para que la oficina la asigne desde el panel sin ir a buscarla.
    const sitioId = req.query.sitio_id && puedeVerSitio(req, req.query.sitio_id) ? req.query.sitio_id : null;
    const lote = await enLoteImpreso(resuelto.token);
    if (resuelto.token) {
      const { data: previo } = await supabase.from("asa_qr_no_reconocidos").select("veces").eq("token", resuelto.token).maybeSingle();
      await supabase.from("asa_qr_no_reconocidos").upsert([{
        token: resuelto.token,
        sitio_id: sitioId,
        veces: (previo?.veces || 0) + 1,
        ultimo_escaneo: new Date().toISOString(),
        ultimo_usuario_nombre: req.usuario?.nombre || null,
        texto_original: String(req.params.token).slice(0, 300),
      }], { onConflict: "token" }).then(() => {}, () => {});
    }
    return res.status(404).json({
      error: true,
      sin_asignar: true,
      token: resuelto.token,
      en_lote: !!lote,
      lote: lote?.lote || null,
      mensaje: lote
        ? `La etiqueta ${resuelto.token} es de las impresas por ASA, pero todavía no está asignada a ningún punto.`
        : `Ese código QR (${resuelto.token || "vacío"}) no corresponde a ningún punto de control. Búscalo por nombre.`,
    });
  }

  const { data: punto, error } = await supabase
    .from("asa_puntos_control")
    .select(`
      *,
      asa_areas(id, nombre, codigo, nivel),
      asa_tipos_punto(id, codigo, nombre, icono, color, requiere_foto),
      asa_sitios(id, nombre, direccion, cliente_id),
      asa_planos(id, nombre, imagen_url)
    `)
    .eq("id", resuelto.punto_id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  if (!punto) {
    return res.status(404).json({
      error: true,
      mensaje: "Ese código QR no corresponde a ningún punto de control. Búscalo por nombre.",
    });
  }
  if (!punto.activo) {
    return res.status(410).json({ error: true, mensaje: `El punto ${punto.codigo_visible} está dado de baja.` });
  }
  if (!puedeVerSitio(req, punto.sitio_id)) {
    return res.status(403).json({ error: true, mensaje: "No tienes acceso a este hotel" });
  }

  const [preguntas, plagas, historial] = await Promise.all([
    preguntasDelPunto(punto),
    // Las plagas viajan con la ficha del punto y no en una llamada aparte: la
    // app guarda esta respuesta completa en el telefono, asi que en un sotano
    // sin senal el tecnico sigue teniendo las plagas correctas de ESE punto.
    plagasDelTipo(punto.tipo_punto_id),
    supabase
      .from("asa_inspecciones")
      .select("id, fecha, estado_punto, nivel_actividad, notas, fotos")
      .eq("punto_id", punto.id)
      .order("fecha", { ascending: false })
      .limit(5),
  ]);

  res.json({
    ...punto,
    url_qr: urlQR(punto.qr_token),
    preguntas,
    plagas,
    // Para que la app pueda decir POR QUE no hay checklist en vez de callarse:
    // no es lo mismo "este punto no lleva preguntas" que "falta configurarlo".
    sin_estrategia: !punto.estrategia_id && !preguntas.length,
    historial: historial.data || [],
  });
});

// Checklist que aplica a un punto.
//
// Antes esto tenia una fuga grande: si el punto no traia estrategia asignada
// —y casi ningun punto importado del sistema anterior la traia— se usaban TODAS
// las estrategias del hotel o del cliente. El resultado era un dispensador de
// aerosol mostrando las preguntas generales de las nueve estrategias a la vez,
// incluida nueve veces "Observaciones".
//
// El orden ahora es estrecho y explicito:
//   1. La estrategia del propio punto, si la tiene. Manda siempre.
//   2. Si no, las estrategias de SU TIPO de punto (asa_tipo_punto_estrategias,
//      que se edita en el panel, en Tipos de punto).
//   3. Si su tipo no tiene ninguna, no hay checklist. Ni inventado ni prestado
//      de otro tipo: la app avisa y el punto se arregla desde el panel.
async function preguntasDelPunto(punto) {
  let estrategiaIds = [];

  if (punto.estrategia_id) {
    estrategiaIds = [punto.estrategia_id];
  } else if (punto.tipo_punto_id) {
    const { data } = await supabase
      .from("asa_tipo_punto_estrategias")
      .select("estrategia_id, asa_estrategias!inner(id, activo)")
      .eq("tipo_punto_id", punto.tipo_punto_id)
      .eq("asa_estrategias.activo", true)
      .order("orden");
    estrategiaIds = (data || []).map((x) => x.estrategia_id);
  }
  if (!estrategiaIds.length) return [];

  const { data } = await supabase
    .from("asa_preguntas")
    .select("*")
    .in("estrategia_id", estrategiaIds)
    .eq("activa", true)
    .or(`tipo_punto_id.eq.${punto.tipo_punto_id},tipo_punto_id.is.null`)
    .order("orden");

  // Una pregunta sin tipo ("Observaciones") existe en cada estrategia. Con dos
  // estrategias en el mismo tipo saldria repetida, y al tecnico dos casillas
  // identicas seguidas le parecen un error de la app — con razon.
  const vistas = new Set();
  return (data || []).filter((p) => {
    const clave = `${p.tipo_punto_id || "-"}|${String(p.texto || "").trim().toLowerCase()}`;
    if (vistas.has(clave)) return false;
    vistas.add(clave);
    return true;
  });
}

// Las plagas que se cuentan en un tipo de punto.
//
// Antes la app pedia el catalogo completo y pintaba las once plagas del sistema
// en cualquier punto: chinches de cama en una lampara de moscas, moscas en un
// cebadero. Ademas de ser ruido, ensucia el dato: una plaga que no se busca en
// ese punto no deberia poder contarse ahi.
//
// Si el tipo no tiene ninguna configurada se devuelve vacio a proposito, y la
// app no pinta el bloque. Un tipo nuevo no hereda la lista de nadie.
async function plagasDelTipo(tipoPuntoId) {
  if (!tipoPuntoId) return [];
  const { data } = await supabase
    .from("asa_tipo_punto_plagas")
    .select("orden, asa_plagas!inner(*)")
    .eq("tipo_punto_id", tipoPuntoId)
    .eq("asa_plagas.activo", true);

  return (data || [])
    .map((x) => ({ ...x.asa_plagas, orden: x.orden ?? x.asa_plagas.orden ?? 0 }))
    .sort((a, b) => (a.orden || 0) - (b.orden || 0) || String(a.nombre).localeCompare(String(b.nombre)));
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /puntos/exportar?sitio_id=&tipo=&area_id=
//
// Descarga en .xlsx TODOS los puntos de control activos: de una planta (con
// sitio_id) o de todas las plantas que el usuario puede ver (sin sitio_id).
// Sirve de respaldo y para trabajar la lista fuera del sistema.
//
// Las columnas llevan los mismos nombres que entiende POST /puntos/importar
// (Área, Código, Nombre, Habitación, Tipo, Estrategia, Frecuencia, Código QR),
// así que el mismo archivo se puede volver a subir sin reimprimir etiquetas:
// el Código QR es el token que ya está pegado en la pared.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/exportar", async (req, res) => {
  const { sitio_id, tipo, area_id } = req.query;
  if (sitio_id && !exigirSitioPermitido(req, res, sitio_id)) return;

  let puntos, sitios;
  try {
    puntos = await traerTodo(() => {
      let q = supabase.from("asa_v_puntos_estado").select("*");
      q = sitio_id ? q.eq("sitio_id", sitio_id) : filtrarPorSitio(q, req);
      if (tipo) q = q.eq("tipo_codigo", tipo);
      if (area_id) q = q.eq("area_id", area_id);
      return q.order("sitio_id").order("area_nombre").order("codigo_visible").order("id");
    });
    let qs = supabase.from("asa_sitios").select("id, nombre");
    qs = sitio_id ? qs.eq("id", sitio_id) : filtrarPorSitio(qs, req, "id");
    const r = await qs;
    if (r.error) throw r.error;
    sitios = r.data || [];
  } catch (e) {
    return res.status(500).json({ error: true, mensaje: e.message });
  }

  const nombreSitio = new Map(sitios.map((s) => [s.id, s.nombre]));
  const fmtFecha = (f) => (f ? new Date(f).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" }) : "");

  const wb = new ExcelJS.Workbook();
  wb.creator = "Ambiente y Salud RD (ASA SRL)";
  wb.created = new Date();
  const ws = wb.addWorksheet("Puntos de control");
  const columnas = [
    { header: "Planta", key: "planta", width: 28 },
    { header: "Área", key: "area", width: 32 },
    { header: "Código", key: "codigo", width: 14 },
    { header: "Nombre", key: "nombre", width: 28 },
    { header: "Habitación", key: "habitacion", width: 12 },
    { header: "Tipo", key: "tipo", width: 24 },
    { header: "Estrategia", key: "estrategia", width: 26 },
    { header: "Frecuencia", key: "frecuencia", width: 12 },
    { header: "Código QR", key: "qr", width: 22 },
    { header: "Enlace QR", key: "url", width: 44 },
    { header: "Última inspección", key: "ultima", width: 22 },
    { header: "Último resultado", key: "ult_estado", width: 18 },
    { header: "Último nivel", key: "ult_nivel", width: 14 },
    { header: "Al día", key: "al_dia", width: 9 },
  ];
  ws.columns = columnas;
  const VERDE = "FF16A34A";
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE } };
  ws.getRow(1).height = 22;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };

  for (const p of puntos) {
    const fila = ws.addRow({
      planta: nombreSitio.get(p.sitio_id) || "",
      area: p.area_nombre || "",
      codigo: p.codigo_visible || "",
      nombre: p.punto_nombre || "",
      habitacion: p.numero_habitacion || "",
      tipo: p.tipo_nombre || "",
      estrategia: p.estrategia_nombre || "",
      frecuencia: p.frecuencia || "",
      qr: p.qr_token || "",
      url: p.qr_token ? urlQR(p.qr_token) : "",
      ultima: fmtFecha(p.ultima_inspeccion),
      ult_estado: p.ultimo_estado || "",
      ult_nivel: p.ultimo_nivel || "",
      al_dia: p.vencido ? "No" : "Sí",
    });
    if (p.vencido) fila.getCell("al_dia").font = { color: { argb: "FFB91C1C" }, bold: true };
  }

  const base = sitio_id ? (nombreSitio.get(sitio_id) || "planta") : "todas-las-plantas";
  const archivo = `puntos-control-${base}`.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() + ".xlsx";

  logAccion(req, { accion: "exportar", modulo: "puntos", descripcion: `Excel de ${puntos.length} puntos (${base})` });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${archivo}"`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  await wb.xlsx.write(res);
  res.end();
});

// GET /puntos/:id
router.get("/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("asa_puntos_control")
    .select("*, asa_areas(nombre), asa_tipos_punto(*), asa_sitios(id, nombre, cliente_id)")
    .eq("id", req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  if (!data) return res.status(404).json({ error: true, mensaje: "Punto no encontrado" });
  if (!puedeVerSitio(req, data.sitio_id)) return res.status(403).json({ error: true, mensaje: "Sin acceso" });

  const { data: historial } = await supabase
    .from("asa_inspecciones")
    .select("*, asa_empleados(nombre_completo)")
    .eq("punto_id", data.id)
    .order("fecha", { ascending: false })
    .limit(50);

  res.json({ ...data, url_qr: urlQR(data.qr_token), historial: historial || [] });
});

// ─────────────────────────────────────────────────────────────────────────────
// QR ya impreso
//
// ASA tiene rollos de etiquetas impresas de antes. El QR de esas etiquetas
// codifica ÚNICAMENTE el código (ej. "C205050474718"), sin URL ni dominio, así
// que no está atado a ningún sistema: se puede reutilizar tal cual.
//
// Estas etiquetas se pegan primero y se asignan después, por eso el alta
// unitaria acepta un qr_token explícito. Una vez asignado no se puede cambiar
// (lo impide un trigger en la base de datos), así que vale la pena validarlo
// bien ANTES de insertar y dar un mensaje claro si ya está en uso.
// ─────────────────────────────────────────────────────────────────────────────
const FORMATO_QR = /^[A-Z0-9][A-Z0-9-]{5,63}$/;

function normalizarQR(valor) {
  return String(valor).trim().toUpperCase().replace(/\s+/g, "");
}

// Devuelve { ok:true, token } o { ok:false, status, mensaje }
async function validarQRImpreso(valor) {
  const token = normalizarQR(valor);

  if (!FORMATO_QR.test(token)) {
    return {
      ok: false,
      status: 400,
      mensaje:
        `"${valor}" no parece un código de etiqueta válido. Se esperan entre 6 y 64 ` +
        "caracteres, solo letras, números y guiones.",
    };
  }

  const { data: enUso, error } = await supabase
    .from("asa_puntos_control")
    .select("id, codigo_visible, activo, asa_sitios(nombre)")
    .eq("qr_token", token)
    .maybeSingle();

  if (error) return { ok: false, status: 500, mensaje: mensajeAmable(error) };

  if (!enUso) {
    const { data: extra } = await supabase
      .from("asa_qr_etiquetas")
      .select("asa_puntos_control(codigo_visible, asa_sitios(nombre))")
      .eq("token", token)
      .maybeSingle();
    if (extra) {
      const p = extra.asa_puntos_control || {};
      return {
        ok: false,
        status: 409,
        mensaje: `Esa etiqueta ya está asignada como etiqueta adicional del punto ${p.codigo_visible || ""}${p.asa_sitios?.nombre ? ` en ${p.asa_sitios.nombre}` : ""}.`,
      };
    }
  }

  if (enUso) {
    const donde = enUso.asa_sitios?.nombre ? ` en ${enUso.asa_sitios.nombre}` : "";
    return {
      ok: false,
      status: 409,
      mensaje:
        `Esa etiqueta ya está asignada al punto ${enUso.codigo_visible}${donde}` +
        (enUso.activo ? "." : " (desactivado). Un QR no se reutiliza aunque el punto se haya dado de baja."),
    };
  }

  return { ok: true, token };
}

// GET /puntos/qr/:token/disponible — la app escanea una etiqueta en blanco y
// pregunta si se puede usar, antes de abrir el formulario de alta.
router.get("/qr/:token/disponible", async (req, res) => {
  const r = await validarQRImpreso(req.params.token);
  if (r.ok) return res.json({ disponible: true, token: r.token });
  if (r.status === 500) return res.status(500).json({ error: true, mensaje: r.mensaje });
  res.json({ disponible: false, motivo: r.mensaje });
});

// ─────────────────────────────────────────────────────────────────────────────
// Alta: unitaria, masiva o desde Excel
// ─────────────────────────────────────────────────────────────────────────────

// POST /puntos — uno solo
router.post("/", requireRol("operaciones", "comercial"), async (req, res) => {
  const { sitio_id, tipo_punto_id, tipo_codigo, codigo_visible } = req.body;
  if (!sitio_id) return res.status(400).json({ error: true, mensaje: "sitio_id es requerido" });
  if (!exigirSitioPermitido(req, res, sitio_id)) return;

  const tipo = await resolverTipo({ tipo_punto_id, tipo_codigo });
  if (!tipo) return res.status(400).json({ error: true, mensaje: "Tipo de punto no válido" });

  const fila = {
    ...req.body,
    tipo_punto_id: tipo.id,
    codigo_visible: codigo_visible || (await siguienteCodigo(sitio_id, tipo)),
    frecuencia: req.body.frecuencia || tipo.frecuencia_default,
  };
  delete fila.tipo_codigo;

  // Si viene qr_token, es una etiqueta YA IMPRESA que se está reutilizando.
  // Se valida contra la base antes de insertar; si no viene, la base genera uno.
  delete fila.qr_token;
  if (req.body.qr_token) {
    const r = await validarQRImpreso(req.body.qr_token);
    if (!r.ok) return res.status(r.status).json({ error: true, mensaje: r.mensaje });
    fila.qr_token = r.token;
  }

  const { data, error } = await supabase.from("asa_puntos_control").insert([fila]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: mensajeAmable(error) });

  logAccion(req, { accion: "crear", modulo: "puntos", registroId: data.id, descripcion: data.codigo_visible });
  res.status(201).json({ ...data, url_qr: urlQR(data.qr_token) });
});

// POST /puntos/masivo — genera N puntos numerados de un tipo en un área
// Body: { sitio_id, area_id, tipo_codigo, cantidad, desde?, prefijo?, frecuencia?, nombre_base? }
router.post("/masivo", requireRol("operaciones"), async (req, res) => {
  const { sitio_id, area_id, tipo_punto_id, tipo_codigo, cantidad, desde = 1, prefijo, frecuencia, nombre_base } = req.body;

  if (!sitio_id || !cantidad) {
    return res.status(400).json({ error: true, mensaje: "sitio_id y cantidad son requeridos" });
  }
  if (!exigirSitioPermitido(req, res, sitio_id)) return;
  if (cantidad > 1000) {
    return res.status(400).json({ error: true, mensaje: "Máximo 1000 puntos por carga. Divídelo en varias." });
  }

  const tipo = await resolverTipo({ tipo_punto_id, tipo_codigo });
  if (!tipo) return res.status(400).json({ error: true, mensaje: "Tipo de punto no válido" });

  // Prefijo: el que mandes, o el del área, o el del tipo
  let pre = prefijo;
  if (!pre && area_id) {
    const { data: area } = await supabase.from("asa_areas").select("codigo").eq("id", area_id).maybeSingle();
    pre = area?.codigo || null;
  }
  pre = pre || tipo.prefijo_codigo || "PC";

  const filas = [];
  for (let i = 0; i < Number(cantidad); i++) {
    const n = Number(desde) + i;
    filas.push({
      sitio_id,
      area_id: area_id || null,
      tipo_punto_id: tipo.id,
      codigo_visible: `${pre}-${String(n).padStart(3, "0")}`,
      nombre: nombre_base ? `${nombre_base} ${n}` : null,
      numero_habitacion: tipo.codigo === "habitacion" ? String(n) : null,
      frecuencia: frecuencia || tipo.frecuencia_default,
    });
  }

  const { data, error } = await supabase.from("asa_puntos_control").insert(filas).select();
  if (error) return res.status(500).json({ error: true, mensaje: mensajeAmable(error) });

  logAccion(req, {
    accion: "crear",
    modulo: "puntos",
    registroId: sitio_id,
    descripcion: `${data.length} puntos de tipo ${tipo.nombre} (${pre}-...)`,
  });
  res.status(201).json({ creados: data.length, puntos: data.map((p) => ({ ...p, url_qr: urlQR(p.qr_token) })) });
});

// POST /puntos/importar — carga desde el Excel que ya tienes
//
// Body: { sitio_id, archivo_base64, hoja?, simular?, prefijo_area? }
//
// Está hecho para el export de "LISTA DE PUNTOS DE CONTROL" que ya usa ASA
// (columnas CÓDIGO, PERIODICIDAD, ESTRATEGIA, ÁREA, CONTRATO, ESTADO,
// CODIGO QR, INSPECCIONES), y también acepta hojas armadas a mano. El
// encabezado puede estar en cualquier orden y no distingue mayúsculas ni
// tildes. Columnas reconocidas:
//
//   codigo | punto | estacion    → código visible del punto
//   codigoqr | qr                → QR YA IMPRESO: se respeta tal cual
//   estrategia                   → estrategia (crea la que falte) y de ahí
//                                  se deduce el tipo de dispositivo
//   tipo | dispositivo           → tipo explícito, si la hoja lo trae
//   area | zona | ubicacion      → área (se crea sola si no existe)
//   contrato                     → código del contrato de origen
//   estado                       → Activo / Inactivo
//   habitacion | hab             → número de habitación
//   frecuencia | periodicidad    → diaria/semanal/quincenal/mensual/trimestral
//   nota | observacion           → notas
//
// LOS QR YA IMPRESOS SE CONSERVAN. Si la hoja trae la columna CODIGO QR, ese
// valor se usa como token del punto, así que las calcomanías pegadas en el
// hotel siguen funcionando sin reimprimir nada.
//
// Con simular:true no escribe nada: devuelve exactamente lo que haría, para
// revisarlo antes de confirmar.
router.post("/importar", requireRol("operaciones"), async (req, res) => {
  const { sitio_id, archivo_base64, hoja, simular = false, prefijo_area } = req.body;
  if (!sitio_id || !archivo_base64) {
    return res.status(400).json({ error: true, mensaje: "sitio_id y archivo_base64 son requeridos" });
  }
  if (!exigirSitioPermitido(req, res, sitio_id)) return;

  let filas;
  try {
    filas = await leerExcel(archivo_base64, hoja);
  } catch (e) {
    return res.status(400).json({ error: true, mensaje: `No se pudo leer el archivo: ${e.message}` });
  }
  if (!filas.length) {
    return res.status(400).json({ error: true, mensaje: "El archivo no tiene filas con datos." });
  }

  const [{ data: tipos }, { data: areasExistentes }, { data: estrategiasExistentes }, { data: sitio }] =
    await Promise.all([
      supabase.from("asa_tipos_punto").select("*").eq("activo", true),
      supabase.from("asa_areas").select("*").eq("sitio_id", sitio_id),
      supabase.from("asa_estrategias").select("*").eq("activo", true),
      supabase.from("asa_sitios").select("id, nombre, cliente_id").eq("id", sitio_id).maybeSingle(),
    ]);

  // Prefijo a recortar del nombre del área: el export trae el hotel repetido
  // en cada área ("Iberostar Coral Bavaro Cocina El Faro"), y guardarlo así
  // deja una lista ilegible en la app del técnico.
  const prefijos = (prefijo_area ? [prefijo_area] : [sitio?.nombre]).filter(Boolean).map(normalizar);

  const areasPorNombre = new Map((areasExistentes || []).map((a) => [normalizar(a.nombre), a]));
  const estrategiasPorNombre = new Map((estrategiasExistentes || []).map((e) => [normalizar(e.nombre), e]));
  const areasNuevas = [];
  const estrategiasNuevas = [];
  const puntos = [];
  const errores = [];
  const qrVistos = new Set();

  for (const [i, f] of filas.entries()) {
    const linea = i + 2; // +1 por el encabezado, +1 porque Excel empieza en 1
    const codigo = valor(f, ["codigo", "punto", "estacion", "id", "no", "num"]);
    const qr = valor(f, ["codigoqr", "qr", "codigoqrunico", "token"]);
    const estrategiaTexto = valor(f, ["estrategia", "servicio", "programa"]);
    const tipoTexto = valor(f, ["tipo", "tipopunto", "dispositivo", "equipo"]);
    const nombre = valor(f, ["nombre", "descripcion", "detalle"]);
    const hab = valor(f, ["habitacion", "hab", "cuarto", "room"]);
    const estado = valor(f, ["estado", "activo", "status"]);
    const contrato = valor(f, ["contrato", "codigocontrato"]);
    let nombreArea = valor(f, ["area", "zona", "ubicacion", "sector", "departamento"]);

    if (!codigo && !nombre && !hab && !qr) continue; // fila vacía o separadora

    // "Área Múltiple (A, B, C, ...)" del export viejo: nos quedamos con la
    // etiqueta, no con la lista completa de 30 áreas dentro del paréntesis.
    if (nombreArea && String(nombreArea).length > 80) {
      nombreArea = String(nombreArea).split("(")[0].trim() || "Área múltiple";
    }
    nombreArea = recortarPrefijo(nombreArea, prefijos);

    // El tipo de dispositivo sale del texto explícito, o se deduce de la
    // estrategia y del código ("H145" con estrategia de prevención = habitación).
    const tipo = emparejarTipo(tipoTexto || estrategiaTexto, tipos, hab, codigo, nombreArea);
    if (!tipo) {
      errores.push({ linea, mensaje: `No se pudo determinar el tipo de "${codigo}"` });
      continue;
    }

    // Estrategia: se crea la que no exista, ligada a este cliente
    let estrategia = null;
    if (estrategiaTexto) {
      const clave = normalizar(estrategiaTexto);
      estrategia = estrategiasPorNombre.get(clave);
      if (!estrategia) {
        estrategia = {
          _nueva: true,
          nombre: String(estrategiaTexto).trim(),
          descripcion: "Importada del sistema anterior. Agrégale sus preguntas.",
          cliente_id: sitio?.cliente_id ?? null,
        };
        estrategiasPorNombre.set(clave, estrategia);
        estrategiasNuevas.push(estrategia);
      }
    }

    if (nombreArea) {
      const clave = normalizar(nombreArea);
      if (!areasPorNombre.has(clave)) {
        const nueva = {
          _nueva: true,
          sitio_id,
          nombre: String(nombreArea).trim(),
          codigo: siglas(nombreArea),
          nivel: valor(f, ["nivel", "piso", "planta"]) || null,
          orden: areasPorNombre.size,
        };
        areasPorNombre.set(clave, nueva);
        areasNuevas.push(nueva);
      }
    }

    // El QR impreso manda; si la hoja no lo trae, la base de datos genera uno.
    let token = qr ? String(qr).trim() : null;
    if (token && qrVistos.has(token)) {
      errores.push({ linea, mensaje: `Código QR repetido en el archivo: ${token}` });
      token = null;
    }
    if (token) qrVistos.add(token);

    const esHabitacion = tipo.codigo === "habitacion";
    const numeroHab = hab
      ? String(hab).trim()
      : esHabitacion && codigo
        ? String(codigo).replace(/\D/g, "") || null
        : null;

    puntos.push({
      _area_nombre: nombreArea || null,
      _estrategia_nombre: estrategiaTexto ? String(estrategiaTexto).trim() : null,
      _tipo_nombre: tipo.nombre,
      sitio_id,
      tipo_punto_id: tipo.id,
      ...(token ? { qr_token: token } : {}),
      codigo_visible: String(codigo || hab || token || `${tipo.prefijo_codigo}-${linea}`).trim(),
      nombre: nombre ? String(nombre).trim() : null,
      numero_habitacion: numeroHab,
      ubicacion_descripcion: valor(f, ["ubicacionexacta", "referencia", "lugar"]) || null,
      frecuencia: normalizarFrecuencia(valor(f, ["frecuencia", "periodicidad"])) || tipo.frecuencia_default,
      codigo_contrato_origen: contrato ? String(contrato).trim() : null,
      notas: valor(f, ["nota", "notas", "observacion", "observaciones", "comentario"]) || null,
      activo: estado ? !/inactiv|baja|elimin/i.test(String(estado)) : true,
    });
  }

  // Códigos visibles repetidos: se desambiguan en vez de romper la carga,
  // porque el sistema anterior sí permitía repetirlos entre áreas.
  const usados = new Map();
  for (const p of puntos) {
    const base = p.codigo_visible;
    if (!usados.has(base)) {
      usados.set(base, 1);
    } else {
      const n = usados.get(base) + 1;
      usados.set(base, n);
      p.codigo_visible = `${base}-${n}`;
      errores.push({ linea: "-", mensaje: `Código repetido "${base}" → se guardó como "${p.codigo_visible}"` });
    }
  }

  const resumen = {
    filas_leidas: filas.length,
    puntos_a_crear: puntos.length,
    qr_conservados: qrVistos.size,
    areas_nuevas: areasNuevas.map((a) => a.nombre),
    estrategias_nuevas: estrategiasNuevas.map((e) => e.nombre),
    por_tipo: puntos.reduce((acc, p) => ({ ...acc, [p._tipo_nombre]: (acc[p._tipo_nombre] || 0) + 1 }), {}),
    advertencias: errores,
  };

  if (simular) {
    return res.json({
      simulado: true,
      ...resumen,
      muestra: puntos.slice(0, 15).map(({ _area_nombre, _estrategia_nombre, _tipo_nombre, ...p }) => ({
        ...p,
        area: _area_nombre,
        estrategia: _estrategia_nombre,
        tipo: _tipo_nombre,
      })),
    });
  }
  if (!puntos.length) {
    return res.status(400).json({ error: true, mensaje: "No se pudo interpretar ninguna fila", ...resumen });
  }

  // 1) Estrategias nuevas
  if (estrategiasNuevas.length) {
    const { data: creadas, error } = await supabase
      .from("asa_estrategias")
      .insert(estrategiasNuevas.map(({ _nueva, ...e }) => e))
      .select();
    if (error) return res.status(500).json({ error: true, mensaje: error.message });
    for (const e of creadas || []) estrategiasPorNombre.set(normalizar(e.nombre), e);
  }

  // 2) Áreas nuevas
  if (areasNuevas.length) {
    const { data: creadas, error } = await supabase
      .from("asa_areas")
      .upsert(areasNuevas.map(({ _nueva, ...a }) => a), { onConflict: "sitio_id,nombre" })
      .select();
    if (error) return res.status(500).json({ error: true, mensaje: error.message });
    for (const a of creadas || []) areasPorNombre.set(normalizar(a.nombre), a);
  }

  // 3) Puntos, resolviendo área y estrategia por nombre
  const aInsertar = puntos.map(({ _area_nombre, _estrategia_nombre, _tipo_nombre, ...p }) => ({
    ...p,
    area_id: _area_nombre ? areasPorNombre.get(normalizar(_area_nombre))?.id || null : null,
    estrategia_id: _estrategia_nombre ? estrategiasPorNombre.get(normalizar(_estrategia_nombre))?.id || null : null,
  }));

  const creados = [];
  for (let i = 0; i < aInsertar.length; i += 200) {
    const lote = aInsertar.slice(i, i + 200);
    const { data, error } = await supabase.from("asa_puntos_control").insert(lote).select();
    if (error) {
      return res.status(500).json({
        error: true,
        mensaje: mensajeAmable(error),
        creados_antes_del_error: creados.length,
        ...resumen,
      });
    }
    creados.push(...data);
  }

  logAccion(req, {
    accion: "crear",
    modulo: "puntos",
    registroId: sitio_id,
    descripcion: `Importación de ${creados.length} puntos desde Excel (${qrVistos.size} QR conservados)`,
  });

  res.status(201).json({
    ...resumen,
    creados: creados.length,
    puntos: creados.slice(0, 50).map((p) => ({ id: p.id, codigo_visible: p.codigo_visible, url_qr: urlQR(p.qr_token) })),
  });
});

// GET /puntos/etiquetas?sitio_id=&area_id= — datos para imprimir las calcomanías
router.get("/etiquetas/imprimir", async (req, res) => {
  const { sitio_id, area_id } = req.query;
  if (!sitio_id) return res.status(400).json({ error: true, mensaje: "sitio_id es requerido" });
  if (!exigirSitioPermitido(req, res, sitio_id)) return;

  let q = supabase
    .from("asa_puntos_control")
    .select("id, qr_token, codigo_visible, nombre, numero_habitacion, asa_areas(nombre), asa_tipos_punto(nombre, icono)")
    .eq("sitio_id", sitio_id)
    .eq("activo", true)
    .order("codigo_visible");
  if (area_id) q = q.eq("area_id", area_id);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const { data: sitio } = await supabase.from("asa_sitios").select("nombre").eq("id", sitio_id).maybeSingle();

  res.json({
    hotel: sitio?.nombre || "",
    total: (data || []).length,
    etiquetas: (data || []).map((p) => ({
      codigo: p.codigo_visible,
      nombre: p.nombre || p.asa_tipos_punto?.nombre || "",
      area: p.asa_areas?.nombre || "",
      habitacion: p.numero_habitacion,
      url_qr: urlQR(p.qr_token),
    })),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edición y baja
// ─────────────────────────────────────────────────────────────────────────────
router.put("/:id", requireRol("operaciones", "comercial"), async (req, res) => {
  const { id: _a, qr_token: _b, sitio_id: _c, created_at: _d, ...cambios } = req.body;
  const { data, error } = await supabase
    .from("asa_puntos_control")
    .update(cambios)
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: mensajeAmable(error) });
  logAccion(req, { accion: "actualizar", modulo: "puntos", registroId: req.params.id });
  res.json({ ...data, url_qr: urlQR(data.qr_token) });
});

// PATCH /puntos/frecuencia — cambiar la frecuencia de muchos puntos de golpe
//
// La frecuencia la decides tú por hotel: el Excel del sistema anterior trae
// PERIODICIDAD en 0 para todo, así que cada hotel se configura aquí.
//
// Body: { sitio_id, frecuencia, area_id?, tipo_codigo?, punto_ids? }
//   Sin filtros    → todos los puntos del hotel
//   area_id        → solo esa área
//   tipo_codigo    → solo ese tipo (ej. "habitacion")
//   punto_ids      → exactamente esos puntos
router.patch("/frecuencia", requireRol("operaciones", "comercial"), async (req, res) => {
  const { sitio_id, frecuencia, area_id, tipo_codigo, punto_ids } = req.body;

  if (!FRECUENCIAS_VALIDAS.includes(frecuencia)) {
    return res.status(400).json({ error: true, mensaje: `frecuencia debe ser una de: ${FRECUENCIAS_VALIDAS.join(", ")}` });
  }
  if (!sitio_id && !punto_ids?.length) {
    return res.status(400).json({ error: true, mensaje: "Indica sitio_id o una lista de punto_ids" });
  }
  if (sitio_id && !exigirSitioPermitido(req, res, sitio_id)) return;

  let q = supabase.from("asa_puntos_control").update({ frecuencia });
  if (punto_ids?.length) {
    q = q.in("id", punto_ids);
  } else {
    q = q.eq("sitio_id", sitio_id).eq("activo", true);
    if (area_id) q = q.eq("area_id", area_id);
    if (tipo_codigo) {
      const tipo = await resolverTipo({ tipo_codigo });
      if (!tipo) return res.status(400).json({ error: true, mensaje: `Tipo "${tipo_codigo}" no existe` });
      q = q.eq("tipo_punto_id", tipo.id);
    }
  }

  const { data, error } = await q.select("id");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  logAccion(req, {
    accion: "actualizar",
    modulo: "puntos",
    registroId: sitio_id ?? null,
    descripcion: `Frecuencia ${frecuencia} aplicada a ${data.length} punto(s)`,
  });
  res.json({ actualizados: data.length, frecuencia });
});


// ─────────────────────────────────────────────────────────────────────────────
// PATCH /puntos/area — mover puntos de un área a otra, en masa
//
// Renombrar un área ya se propaga sola a todos sus puntos (cuelgan de ella por
// id, no por texto). Esto es para el otro caso: cuando los puntos quedaron en
// el área equivocada y hay que moverlos sin tocarlos uno por uno.
//
// Body: { sitio_id, area_destino_id, area_origen_id?, tipo_codigo?, punto_ids? }
//   · con punto_ids  → mueve exactamente esos
//   · sin punto_ids  → mueve todos los del sitio que cumplan los filtros
//   · area_origen_id = "null" (texto) → los que no tienen área asignada
//
// Con simular:true devuelve cuántos movería sin tocar nada.
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/area", requireRol("operaciones", "comercial"), async (req, res) => {
  const { sitio_id, area_destino_id, area_origen_id, tipo_codigo, punto_ids, simular = false } = req.body;

  if (!sitio_id && !punto_ids?.length) {
    return res.status(400).json({ error: true, mensaje: "Indica sitio_id o una lista de punto_ids" });
  }
  if (area_destino_id === undefined) {
    return res.status(400).json({ error: true, mensaje: "area_destino_id es requerido (usa null para dejarlos sin área)" });
  }
  if (sitio_id && !exigirSitioPermitido(req, res, sitio_id)) return;

  // El área destino tiene que ser de la misma planta: un punto del Coral
  // Bávaro no puede quedar apuntando a un área de Comunes.
  if (area_destino_id) {
    const { data: destino } = await supabase
      .from("asa_areas")
      .select("id, sitio_id, nombre")
      .eq("id", area_destino_id)
      .maybeSingle();
    if (!destino) return res.status(400).json({ error: true, mensaje: "El área destino no existe" });
    if (sitio_id && destino.sitio_id !== sitio_id) {
      return res.status(400).json({ error: true, mensaje: "El área destino pertenece a otra planta" });
    }
  }

  let tipoResuelto = null;
  if (tipo_codigo) {
    tipoResuelto = await resolverTipo({ tipo_codigo });
    if (!tipoResuelto) return res.status(400).json({ error: true, mensaje: `Tipo "${tipo_codigo}" no existe` });
  }

  const filtrar = (q) => {
    if (punto_ids?.length) return q.in("id", punto_ids);
    q = q.eq("sitio_id", sitio_id).eq("activo", true);
    if (area_origen_id === "null" || area_origen_id === null) q = q.is("area_id", null);
    else if (area_origen_id) q = q.eq("area_id", area_origen_id);
    if (tipoResuelto) q = q.eq("tipo_punto_id", tipoResuelto.id);
    return q;
  };

  if (simular) {
    const { count, error } = await filtrar(
      supabase.from("asa_puntos_control").select("id", { count: "exact", head: true })
    );
    if (error) return res.status(500).json({ error: true, mensaje: error.message });
    return res.json({ moverian: count || 0, simulado: true });
  }

  const { data, error } = await filtrar(
    supabase.from("asa_puntos_control").update({ area_id: area_destino_id || null })
  ).select("id");
  if (error) return res.status(500).json({ error: true, mensaje: mensajeAmable(error) });

  logAccion(req, {
    accion: "actualizar",
    modulo: "puntos",
    registroId: sitio_id ?? null,
    descripcion: `${data.length} punto(s) movidos de área`,
  });
  res.json({ movidos: data.length });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /puntos/estrategia — asignar estrategia en masa
//
// Es lo que decide QUÉ PREGUNTAS ve el técnico al escanear. Un punto sin
// estrategia, o con una que no tiene preguntas para su tipo, le muestra al
// técnico solo estado y nivel de actividad.
//
// Body: { sitio_id?, estrategia_id, area_id?, tipo_codigo?, punto_ids?, simular? }
//   estrategia_id = null deja los puntos sin estrategia.
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/estrategia", requireRol("operaciones", "comercial"), async (req, res) => {
  const { sitio_id, estrategia_id, area_id, tipo_codigo, punto_ids, simular = false } = req.body;

  if (!sitio_id && !punto_ids?.length) {
    return res.status(400).json({ error: true, mensaje: "Indica sitio_id o una lista de punto_ids" });
  }
  if (estrategia_id === undefined) {
    return res.status(400).json({ error: true, mensaje: "estrategia_id es requerido (usa null para quitarla)" });
  }
  if (sitio_id && !exigirSitioPermitido(req, res, sitio_id)) return;

  if (estrategia_id) {
    const { data: est } = await supabase
      .from("asa_estrategias")
      .select("id, nombre")
      .eq("id", estrategia_id)
      .maybeSingle();
    if (!est) return res.status(400).json({ error: true, mensaje: "Esa estrategia no existe" });
  }

  let tipoResuelto = null;
  if (tipo_codigo) {
    tipoResuelto = await resolverTipo({ tipo_codigo });
    if (!tipoResuelto) return res.status(400).json({ error: true, mensaje: `Tipo "${tipo_codigo}" no existe` });
  }

  const filtrar = (q) => {
    if (punto_ids?.length) return q.in("id", punto_ids);
    q = q.eq("sitio_id", sitio_id).eq("activo", true);
    if (area_id) q = q.eq("area_id", area_id);
    if (tipoResuelto) q = q.eq("tipo_punto_id", tipoResuelto.id);
    return q;
  };

  if (simular) {
    const { count, error } = await filtrar(
      supabase.from("asa_puntos_control").select("id", { count: "exact", head: true })
    );
    if (error) return res.status(500).json({ error: true, mensaje: error.message });

    // Se informa cuántas preguntas quedarían activas para ese tipo: es el dato
    // que responde "¿esto le va a mostrar algo al técnico?"
    let preguntas = null;
    if (estrategia_id && tipoResuelto) {
      const { count: c } = await supabase
        .from("asa_preguntas")
        .select("id", { count: "exact", head: true })
        .eq("estrategia_id", estrategia_id)
        .eq("activa", true)
        .or(`tipo_punto_id.eq.${tipoResuelto.id},tipo_punto_id.is.null`);
      preguntas = c || 0;
    }
    return res.json({ cambiarian: count || 0, preguntas_para_ese_tipo: preguntas, simulado: true });
  }

  const { data, error } = await filtrar(
    supabase.from("asa_puntos_control").update({ estrategia_id: estrategia_id || null })
  ).select("id");
  if (error) return res.status(500).json({ error: true, mensaje: mensajeAmable(error) });

  logAccion(req, {
    accion: "actualizar",
    modulo: "puntos",
    registroId: sitio_id ?? null,
    descripcion: `Estrategia aplicada a ${data.length} punto(s)`,
  });
  res.json({ actualizados: data.length });
});

// PATCH /puntos/:id/plano — colocar el pin del punto sobre el plano
router.patch("/:id/plano", requireRol("operaciones"), async (req, res) => {
  const { plano_id, plano_x, plano_y } = req.body;
  const { data, error } = await supabase
    .from("asa_puntos_control")
    .update({ plano_id, plano_x, plano_y })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// DELETE /puntos/:id — baja lógica: el historial de inspecciones se conserva
// ─────────────────────────────────────────────────────────────────────────────
// POST /puntos/eliminar — baja masiva
//
// Va como POST y no como DELETE porque necesita cuerpo (filtros), y varios
// intermediarios descartan el cuerpo de un DELETE.
//
// Body: { sitio_id?, area_id?, tipo_codigo?, punto_ids?, simular? }
//
// Es BAJA LÓGICA, igual que la individual: el punto queda con activo=false.
// Borrarlo de verdad arrastraría en cascada sus inspecciones, y con ellas el
// historial que el hotel firma en auditoría. Un punto dado de baja desaparece
// de la ruta del técnico y de los reportes, que es lo que se busca.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/eliminar", requireRol("operaciones"), async (req, res) => {
  const { sitio_id, area_id, tipo_codigo, punto_ids, simular = false } = req.body;

  if (!punto_ids?.length && !sitio_id) {
    return res.status(400).json({ error: true, mensaje: "Indica punto_ids o sitio_id" });
  }
  // Un sitio_id suelto borraría la planta entera de un clic. Se exige al menos
  // un filtro que acote, o la lista explícita de puntos.
  if (!punto_ids?.length && !area_id && !tipo_codigo) {
    return res.status(400).json({
      error: true,
      mensaje: "Para una baja masiva filtra por área o por tipo. Sin filtro borrarías la planta completa.",
    });
  }
  if (sitio_id && !exigirSitioPermitido(req, res, sitio_id)) return;

  let tipoResuelto = null;
  if (tipo_codigo) {
    tipoResuelto = await resolverTipo({ tipo_codigo });
    if (!tipoResuelto) return res.status(400).json({ error: true, mensaje: `Tipo "${tipo_codigo}" no existe` });
  }

  const filtrar = (q) => {
    if (punto_ids?.length) return q.in("id", punto_ids);
    q = q.eq("sitio_id", sitio_id).eq("activo", true);
    if (area_id) q = q.eq("area_id", area_id);
    if (tipoResuelto) q = q.eq("tipo_punto_id", tipoResuelto.id);
    return q;
  };

  if (simular) {
    const { count, error } = await filtrar(
      supabase.from("asa_puntos_control").select("id", { count: "exact", head: true })
    );
    if (error) return res.status(500).json({ error: true, mensaje: error.message });
    return res.json({ eliminarian: count || 0, simulado: true });
  }

  const { data, error } = await filtrar(
    supabase.from("asa_puntos_control").update({ activo: false })
  ).select("id, codigo_visible");
  if (error) return res.status(500).json({ error: true, mensaje: mensajeAmable(error) });

  logAccion(req, {
    accion: "eliminar",
    modulo: "puntos",
    registroId: sitio_id ?? null,
    descripcion: `Baja de ${data.length} punto(s)`,
  });
  res.json({ eliminados: data.length });
});

// POST /puntos/:id/reactivar — deshacer una baja
//
// Existe porque la baja es lógica: si se borró por error, el punto y su QR
// siguen ahí y se pueden recuperar sin reimprimir la etiqueta.
router.post("/:id/reactivar", requireRol("operaciones"), async (req, res) => {
  const { data, error } = await supabase
    .from("asa_puntos_control")
    .update({ activo: true })
    .eq("id", req.params.id)
    .select("id, codigo_visible, qr_token")
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: mensajeAmable(error) });
  logAccion(req, { accion: "actualizar", modulo: "puntos", registroId: data.id, descripcion: "Reactivado" });
  res.json(data);
});

router.delete("/:id", requireRol("operaciones"), async (req, res) => {
  const { error } = await supabase.from("asa_puntos_control").update({ activo: false }).eq("id", req.params.id);
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  logAccion(req, { accion: "eliminar", modulo: "puntos", registroId: req.params.id });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────────────
async function resolverTipo({ tipo_punto_id, tipo_codigo }) {
  const q = supabase.from("asa_tipos_punto").select("*");
  const { data } = tipo_punto_id
    ? await q.eq("id", tipo_punto_id).maybeSingle()
    : await q.eq("codigo", tipo_codigo).maybeSingle();
  return data || null;
}

async function siguienteCodigo(sitio_id, tipo) {
  const pre = tipo.prefijo_codigo || "PC";
  const { data } = await supabase
    .from("asa_puntos_control")
    .select("codigo_visible")
    .eq("sitio_id", sitio_id)
    .like("codigo_visible", `${pre}-%`)
    .order("codigo_visible", { ascending: false })
    .limit(1);

  const ultimo = data?.[0]?.codigo_visible;
  const n = ultimo ? Number(String(ultimo).split("-").pop()) + 1 : 1;
  return `${pre}-${String(Number.isFinite(n) ? n : 1).padStart(3, "0")}`;
}

function mensajeAmable(error) {
  if (error.code === "23505" && /codigo_visible/.test(error.message || "")) {
    return "Ya existe un punto con ese código en este hotel. Los códigos no se pueden repetir dentro del mismo hotel.";
  }
  return error.message;
}

const normalizar = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

function valor(fila, claves) {
  for (const k of claves) {
    const encontrado = Object.keys(fila).find((col) => normalizar(col) === k);
    if (encontrado && fila[encontrado] !== null && String(fila[encontrado]).trim() !== "") {
      return fila[encontrado];
    }
  }
  return null;
}

function siglas(texto) {
  return String(texto)
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 4);
}

function normalizarFrecuencia(t) {
  const n = normalizar(t);
  if (!n) return null;
  if (n.startsWith("dia")) return "diaria";
  if (n.startsWith("sem")) return "semanal";
  if (n.startsWith("quin")) return "quincenal";
  if (n.startsWith("mens") || n.startsWith("mes")) return "mensual";
  if (n.startsWith("trim")) return "trimestral";
  if (n.includes("orden") || n.includes("demanda")) return "por_orden";
  return null;
}

// Empareja el texto del Excel con un tipo del catálogo, con tolerancia a las
// variantes y erratas del export real: "sebadero", "Matenimiento", "Lámpara
// ultravioletas atrapa moscas", etc.
//
// Cuando la estrategia no identifica un dispositivo (caso de "Prevención y
// Mantenimiento", que en el Excel de ASA cubre tanto habitaciones como
// restaurantes), se mira el código del punto y el nombre del área: un código
// "H145" o un área "Habitación huésped" es una habitación.
function emparejarTipo(texto, tipos, hab, codigo, area) {
  const n = normalizar(texto);
  const nCodigo = normalizar(codigo);
  const nArea = normalizar(area);
  const buscar = (c) => tipos.find((t) => t.codigo === c) || null;

  const exacto = tipos.find((t) => normalizar(t.codigo) === n || normalizar(t.nombre) === n);
  if (exacto) return exacto;

  const alias = [
    [["cebadero", "sebadero", "cebo", "roedor", "raton", "rata", "portacebo"], "cebadero_roedor"],
    [["lampara", "ultravioleta", "insectocutor", "atrapamoscas", "atrapainsectos", "luzuv"], "lampara_moscas"],
    [["aerosol", "dispensador", "difusor", "atomizador"], "dispensador_aerosol"],
    [["laminapegante", "pegajosa", "pegante", "glue", "feromona"], "trampa_pegajosa"],
    [["apertura", "sellado", "hermeticidad"], "apertura"],
    [["habitacion", "cuarto", "room", "hab"], "habitacion"],
    [["perimetral", "areasverdes", "jardin", "exterior"], "estacion_exterior"],
  ];
  for (const [palabras, codigoTipo] of alias) {
    if (palabras.some((p) => n.includes(p))) {
      const t = buscar(codigoTipo);
      if (t) return t;
    }
  }

  // Sin pista en la estrategia: deducir por el código y el área
  if (hab) return buscar("habitacion");
  if (/^h\d+$/.test(nCodigo) || nArea.includes("habitacion")) return buscar("habitacion");
  if (nCodigo.includes("cebadero") || nCodigo.includes("ccbavaro")) return buscar("cebadero_roedor");
  if (nCodigo.includes("lampara")) return buscar("lampara_moscas");
  if (nCodigo.includes("aerosol")) return buscar("dispensador_aerosol");
  if (nArea.includes("areasverdes") || nArea.includes("areaexterior")) return buscar("estacion_exterior");

  return buscar("area_general");
}

// Quita del nombre del área el nombre del hotel, que el export repite en cada
// fila: "Iberostar Coral Bavaro Cocina El Faro" → "Cocina El Faro".
function recortarPrefijo(area, prefijos) {
  if (!area) return area;
  let texto = String(area).trim();
  for (const pre of prefijos) {
    if (!pre) continue;
    const n = normalizar(texto);
    if (n.startsWith(pre) && n.length > pre.length) {
      // Recorta tantas palabras del inicio como tenga el prefijo
      const palabras = texto.split(/\s+/);
      let acumulado = "";
      let corte = 0;
      for (let i = 0; i < palabras.length; i++) {
        acumulado += normalizar(palabras[i]);
        corte = i + 1;
        if (acumulado === pre) break;
        if (!pre.startsWith(acumulado)) {
          corte = 0;
          break;
        }
      }
      if (corte > 0 && corte < palabras.length) {
        texto = palabras.slice(corte).join(" ").trim();
      }
    }
  }
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// Lee un .xlsx (o .csv) en base64 y devuelve [{encabezado: valor}, ...]
async function leerExcel(base64, nombreHoja) {
  const limpio = String(base64).replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(limpio, "base64");

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const ws = nombreHoja ? wb.getWorksheet(nombreHoja) : wb.worksheets[0];
  if (!ws) throw new Error(`No se encontró la hoja ${nombreHoja || "(la primera)"}`);

  // Encabezado: la fila con MÁS celdas llenas de las primeras 20.
  //
  // No sirve "la primera fila con 2 o más celdas": los export de ASA empiezan
  // con un título ("LISTA DE PUNTOS DE CONTROL"), una fila "DESCARGADO EL |
  // fecha" y varias de filtros. Esa segunda fila tiene 2 celdas y se colaría
  // como encabezado, dejando columnas llamadas "DESCARGADO EL" y la fecha.
  // La fila de encabezados real es la más ancha de todas.
  let filaEncabezado = 1;
  let mejorAncho = 0;
  const limite = Math.min(ws.rowCount, 20);
  for (let r = 1; r <= limite; r++) {
    const celdas = (ws.getRow(r).values || []).filter(
      (v) => v !== null && v !== undefined && String(v.text ?? v).trim() !== ""
    );
    if (celdas.length > mejorAncho) {
      mejorAncho = celdas.length;
      filaEncabezado = r;
    }
  }
  if (mejorAncho < 2) throw new Error("No se encontró una fila de encabezados con al menos dos columnas");

  const encabezados = [];
  ws.getRow(filaEncabezado).eachCell({ includeEmpty: true }, (celda, col) => {
    encabezados[col] = String(celda.value ?? "").trim();
  });

  const filas = [];
  for (let r = filaEncabezado + 1; r <= ws.rowCount; r++) {
    const fila = {};
    let tieneAlgo = false;
    ws.getRow(r).eachCell({ includeEmpty: false }, (celda, col) => {
      const clave = encabezados[col];
      if (!clave) return;
      let v = celda.value;
      if (v && typeof v === "object") v = v.text ?? v.result ?? v.hyperlink ?? String(v);
      if (v !== null && String(v).trim() !== "") tieneAlgo = true;
      fila[clave] = v;
    });
    if (tieneAlgo) filas.push(fila);
  }
  return filas;
}

export default router;

// Exportadas para scripts/probar-importacion.mjs (prueba del parser con los
// Excel reales de ASA, sin tocar la base de datos).
export { leerExcel, emparejarTipo, recortarPrefijo, normalizar, valor, normalizarFrecuencia, siglas };
