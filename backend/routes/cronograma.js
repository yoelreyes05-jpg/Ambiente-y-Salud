// routes/cronograma.js — Cronograma de trabajo (programación de servicios)
//
// Lo que hoy se baja en Excel como "PROG. SERVICIO": qué servicio, en qué
// planta, qué día, de qué hora a qué hora, con qué equipo y con qué nota. Aquí
// se sube ese mismo Excel, se corrige fila por fila (fecha, hora, título,
// planta, equipo, notas, estado), se borra, y se repite una semana en las
// siguientes. Lo ven:
//   oficina  — todo, y es quien lo edita
//   técnico  — en su app, la semana de su hotel
//   hotel    — en su portal, solo sus plantas (filtrarPorSitio)
//
// Las horas del Excel son hora de RD. Se guardan como timestamptz con -04:00
// (RD no cambia de horario), así que 09:00 en el Excel es 09:00 en pantalla.
import express from "express";
import crypto from "crypto";
import ExcelJS from "exceljs";
import { supabase } from "../lib/supabaseClient.js";
import { logAccion } from "../lib/auditoria.js";
import { exigirSitioPermitido, filtrarPorSitio, puedeVerSitio, requireRol } from "../middleware/auth.js";
import { traerTodo } from "../lib/paginar.js";

const router = express.Router();
const OFICINA = requireRol("operaciones", "comercial");
const ESTADOS = ["pendiente", "realizado", "cancelado", "reprogramado"];
const error500 = (res, e) => res.status(500).json({ error: true, mensaje: e.message || String(e) });

// ── Fechas en hora de RD ─────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, "0");
// "2026-10-01" + "09:30" → "2026-10-01T09:30:00-04:00"
const aISO = (fecha, hora = "00:00") => `${fecha}T${hora.length === 5 ? hora + ":00" : hora}-04:00`;
const fechaRD = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
const sumarDias = (fecha, n) => {
  const d = new Date(fecha + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Lee una celda de fecha del Excel. Llega como texto "2026-10-01 09:00:00"
// (así lo exporta el sistema de hoy), como Date (si la celda tiene formato de
// fecha: exceljs la entrega en UTC con la hora "de pared") o como número de
// serie de Excel.
function leerFechaCelda(v) {
  if (v == null || v === "") return null;
  if (typeof v === "object" && v.result !== undefined) v = v.result;      // fórmula
  if (typeof v === "object" && v.text !== undefined && !(v instanceof Date)) v = v.text;
  if (v instanceof Date && !isNaN(v)) {
    return aISO(`${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`, `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`);
  }
  if (typeof v === "number") {
    const ms = Math.round((v - 25569) * 86400000);
    return leerFechaCelda(new Date(ms));
  }
  const t = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?/.exec(t);
  if (m) return aISO(`${m[1]}-${pad(m[2])}-${pad(m[3])}`, `${pad(m[4] || 0)}:${m[5] || "00"}`);
  // 01/10/2026 09:00 (día/mes/año, como se escribe en RD)
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(t);
  if (m) return aISO(`${m[3]}-${pad(m[2])}-${pad(m[1])}`, `${pad(m[4] || 0)}:${m[5] || "00"}`);
  return null;
}

const texto = (v) => {
  if (v == null) return "";
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return String(v.result);
  }
  return String(v);
};
const normal = (s) =>
  String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

function estadoDe(v) {
  const t = normal(v);
  if (/REALIZ|COMPLET|FINALIZ|EJECUT|CERRAD/.test(t)) return "realizado";
  if (/CANCEL|ANULAD/.test(t)) return "cancelado";
  if (/REPROGRAM/.test(t)) return "reprogramado";
  return "pendiente";
}

// ── Reconocer la planta del Excel contra las plantas del sistema ────────────
// Primero igual (sin acentos ni mayúsculas), después por palabras en común:
// "IBEROSTAR CORAL BAVARO" encuentra "Iberostar Bávaro".
export function sugerirPlanta(textoPlanta, sitios) {
  const n = normal(textoPlanta);
  if (!n) return null;
  const exacta = sitios.find((s) => normal(s.nombre) === n || (s.codigo && normal(s.codigo) === n));
  if (exacta) return { sitio: exacta, seguro: true };
  const pal = new Set(n.split(" "));
  let mejor = null;
  for (const s of sitios) {
    const ps = new Set(normal(s.nombre).split(" "));
    const comunes = [...ps].filter((p) => pal.has(p)).length;
    const union = new Set([...ps, ...pal]).size;
    const puntaje = union ? comunes / union : 0;
    // Todas las palabras de la planta del sistema tienen que estar en el texto
    const contenida = [...ps].every((p) => pal.has(p));
    if (comunes && (contenida || puntaje >= 0.5) && (!mejor || puntaje > mejor.puntaje)) mejor = { sitio: s, puntaje };
  }
  return mejor ? { sitio: mejor.sitio, seguro: false } : null;
}

export async function leerExcel(base64) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(String(base64).replace(/^data:[^,]+,/, ""), "base64"));
  const filas = [];
  const errores = [];

  for (const ws of wb.worksheets) {
    // La fila de títulos no siempre es la 1: el Excel de hoy trae arriba los
    // filtros con que se descargó. Se busca la que dice FECHA INICIO.
    let filaTitulos = null;
    const cols = {};
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (filaTitulos) return;
      const vals = row.values.map((v) => normal(texto(v)));
      if (vals.some((v) => v === "FECHA INICIO" || v === "FECHA" || v === "INICIO")) {
        filaTitulos = n;
        vals.forEach((v, i) => {
          if (!v) return;
          if (v === "PROG SERVICIO" || v === "TIPO") cols.tipo = i;
          else if (v === "CLIENTE") cols.cliente = i;
          else if (v === "PLANTA" || v === "HOTEL") cols.planta = i;
          else if (v === "CONTRATO") cols.contrato = i;
          else if (v === "TITULO" || v === "SERVICIO") cols.titulo = i;
          else if (v === "FECHA INICIO" || v === "FECHA" || v === "INICIO") cols.inicio = i;
          else if (v === "FECHA FIN" || v === "FIN") cols.fin = i;
          else if (v === "ESTADO") cols.estado = i;
          else if (v.startsWith("EQUIPO") || v === "TECNICOS" || v === "TECNICO ASIGNADO") cols.equipo = i;
          else if (v.startsWith("NOTAS") || v === "NOTA" || v === "OBSERVACIONES") cols.notas = i;
        });
      }
    });
    if (!filaTitulos || !cols.inicio) continue;

    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n <= filaTitulos) return;
      const v = (k) => (cols[k] ? row.getCell(cols[k]).value : null);
      const inicio = leerFechaCelda(v("inicio"));
      const tituloTxt = texto(v("titulo")).trim() || texto(v("contrato")).trim();
      const plantaTxt = texto(v("planta")).trim();
      if (!inicio && !tituloTxt && !plantaTxt) return;          // fila vacía
      if (!inicio) { errores.push(`Hoja "${ws.name}", fila ${n}: fecha de inicio no válida`); return; }
      let fin = leerFechaCelda(v("fin"));
      if (fin && new Date(fin) < new Date(inicio)) fin = null;
      filas.push({
        fila: n,
        tipo: texto(v("tipo")).trim() || "SERVICIO",
        cliente_texto: texto(v("cliente")).trim() || null,
        planta_texto: plantaTxt || null,
        contrato: texto(v("contrato")).trim() || null,
        titulo: tituloTxt || "Servicio",
        fecha_inicio: inicio,
        fecha_fin: fin,
        estado: estadoDe(texto(v("estado"))),
        equipo: texto(v("equipo")).replace(/\s+/g, " ").trim() || null,
        notas: texto(v("notas")).trim() || null,
      });
    });
    if (filas.length) break; // la primera hoja con datos manda
  }
  return { filas, errores };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /cronograma?sitio_id=&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// ─────────────────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const { sitio_id } = req.query;
  if (sitio_id && sitio_id !== "sin_planta" && !exigirSitioPermitido(req, res, sitio_id)) return;
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde || "") ? req.query.desde : fechaRD(new Date());
  const hasta = /^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta || "") ? req.query.hasta : sumarDias(desde, 6);
  try {
    const filas = await traerTodo(() => {
      let q = supabase
        .from("asa_cronograma")
        .select("*, asa_sitios(nombre)")
        .gte("fecha_inicio", aISO(desde))
        .lt("fecha_inicio", aISO(sumarDias(hasta, 1)))
        .order("fecha_inicio")
        .order("id");
      if (sitio_id === "sin_planta") return req.sitiosPermitidos === null ? q.is("sitio_id", null) : q.eq("id", "00000000-0000-0000-0000-000000000000");
      return sitio_id ? q.eq("sitio_id", sitio_id) : filtrarPorSitio(q, req);
    });
    res.json({
      desde,
      hasta,
      filas: filas.map((f) => ({ ...f, planta: f.asa_sitios?.nombre || f.planta_texto || "Sin planta", asa_sitios: undefined })),
    });
  } catch (e) { error500(res, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Alta, edición y borrado
// ─────────────────────────────────────────────────────────────────────────────
function validar(b, parcial = false) {
  const out = {};
  if (!parcial || "titulo" in b) {
    const t = String(b.titulo || "").trim();
    if (!t) throw Object.assign(new Error("El título es requerido"), { status: 400 });
    out.titulo = t.slice(0, 300);
  }
  if (!parcial || "fecha" in b || "hora_inicio" in b) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.fecha || "")) throw Object.assign(new Error("Fecha no válida"), { status: 400 });
    const hi = /^\d{2}:\d{2}$/.test(b.hora_inicio || "") ? b.hora_inicio : "00:00";
    out.fecha_inicio = aISO(b.fecha, hi);
    if (/^\d{2}:\d{2}$/.test(b.hora_fin || "")) {
      // Si la hora de fin es menor que la de inicio, termina al día siguiente
      // (los tratamientos nocturnos de 22:30 a 02:00).
      const fechaFin = b.hora_fin < hi ? sumarDias(b.fecha, 1) : b.fecha;
      out.fecha_fin = aISO(fechaFin, b.hora_fin);
    } else {
      out.fecha_fin = null;
    }
  }
  if ("sitio_id" in b) out.sitio_id = b.sitio_id || null;
  if ("estado" in b) out.estado = ESTADOS.includes(b.estado) ? b.estado : "pendiente";
  for (const k of ["equipo", "notas", "contrato", "tipo"]) if (k in b) out[k] = String(b[k] ?? "").trim() || (k === "tipo" ? "SERVICIO" : null);
  return out;
}

router.post("/", OFICINA, async (req, res) => {
  try {
    const fila = validar(req.body || {});
    fila.origen = "manual";
    fila.creado_por = req.usuario?.nombre || null;
    const { data, error } = await supabase.from("asa_cronograma").insert([fila]).select("*, asa_sitios(nombre)").single();
    if (error) throw error;
    logAccion(req, { accion: "crear", modulo: "cronograma", registroId: data.id, descripcion: `${data.asa_sitios?.nombre || ""} · ${data.titulo} · ${data.fecha_inicio}` });
    res.status(201).json(data);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: true, mensaje: e.message });
    error500(res, e);
  }
});

router.put("/:id", OFICINA, async (req, res) => {
  try {
    const cambios = validar(req.body || {}, true);
    cambios.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from("asa_cronograma").update(cambios).eq("id", req.params.id).select("*, asa_sitios(nombre)").single();
    if (error) throw error;
    logAccion(req, { accion: "actualizar", modulo: "cronograma", registroId: data.id, descripcion: `${data.asa_sitios?.nombre || ""} · ${data.titulo}`, detalle: cambios });
    res.json(data);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: true, mensaje: e.message });
    error500(res, e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /cronograma/:id/horario-masivo
//   { hora_inicio, hora_fin?, alcance: "dia_semana" | "semana" | "todo", hora_original? }
//
// Cambia la hora de este servicio Y de sus "iguales": misma planta, mismo
// título y misma hora de inicio que tenía (así un servicio de la mañana no
// arrastra al de la noche). La fecha de cada uno no cambia, solo la hora.
//   dia_semana — el mismo día de la semana, de esta fecha en adelante (todos los lunes)
//   semana     — todos los días de esta semana (lunes a domingo)
//   todo       — todos los días, de esta fecha en adelante
// ─────────────────────────────────────────────────────────────────────────────
router.post("/:id/horario-masivo", OFICINA, async (req, res) => {
  const { hora_inicio, hora_fin, alcance } = req.body || {};
  if (!/^\d{2}:\d{2}$/.test(hora_inicio || "")) return res.status(400).json({ error: true, mensaje: "Hora de inicio no válida" });
  if (!["dia_semana", "semana", "todo"].includes(alcance)) return res.status(400).json({ error: true, mensaje: "Alcance no válido" });
  try {
    const { data: base, error } = await supabase.from("asa_cronograma").select("*").eq("id", req.params.id).maybeSingle();
    if (error) throw error;
    if (!base) return res.status(404).json({ error: true, mensaje: "Servicio no encontrado" });

    const horaRD = (iso) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "America/Santo_Domingo", hour: "2-digit", minute: "2-digit" });
    const fechaBase = fechaRD(base.fecha_inicio);
    const horaOriginal = /^\d{2}:\d{2}$/.test(req.body?.hora_original || "") ? req.body.hora_original : horaRD(base.fecha_inicio);
    const diaSemana = (f) => new Date(f + "T12:00:00Z").getUTCDay();
    const lunes = sumarDias(fechaBase, -((diaSemana(fechaBase) + 6) % 7));

    const desde = alcance === "semana" ? lunes : fechaBase;
    let q = supabase
      .from("asa_cronograma")
      .select("id, sitio_id, titulo, fecha_inicio")
      .gte("fecha_inicio", aISO(desde))
      .neq("estado", "cancelado")
      .order("fecha_inicio");
    if (alcance === "semana") q = q.lt("fecha_inicio", aISO(sumarDias(lunes, 7)));
    q = base.sitio_id ? q.eq("sitio_id", base.sitio_id) : q.is("sitio_id", null);
    const { data: candidatos, error: e2 } = await q.limit(2000);
    if (e2) throw e2;

    const iguales = (candidatos || []).filter((c) =>
      normal(c.titulo) === normal(base.titulo) &&
      (c.id === base.id || horaRD(c.fecha_inicio) === horaOriginal) &&
      (alcance !== "dia_semana" || diaSemana(fechaRD(c.fecha_inicio)) === diaSemana(fechaBase))
    );
    if (!iguales.some((c) => c.id === base.id)) iguales.push(base);

    let cambiados = 0;
    for (const c of iguales) {
      const f = fechaRD(c.fecha_inicio);
      const cambios = { fecha_inicio: aISO(f, hora_inicio), updated_at: new Date().toISOString() };
      if (/^\d{2}:\d{2}$/.test(hora_fin || "")) cambios.fecha_fin = aISO(hora_fin < hora_inicio ? sumarDias(f, 1) : f, hora_fin);
      else if (hora_fin === "" || hora_fin === null) cambios.fecha_fin = null;
      const { error: e3 } = await supabase.from("asa_cronograma").update(cambios).eq("id", c.id);
      if (e3) throw e3;
      cambiados++;
    }
    const texto = { dia_semana: "mismo día de la semana en adelante", semana: "toda la semana", todo: "todos los días en adelante" }[alcance];
    logAccion(req, { accion: "actualizar", modulo: "cronograma", registroId: base.id, descripcion: `Horario ${hora_inicio}${hora_fin ? `–${hora_fin}` : ""} aplicado a ${cambiados} servicio(s) (${texto}): ${base.titulo}` });
    res.json({ ok: true, cambiados });
  } catch (e) { error500(res, e); }
});

// El técnico puede marcar como realizado lo de su planta (no editarlo).
router.patch("/:id/estado", requireRol("tecnico_plagas", "operaciones", "comercial"), async (req, res) => {
  const estado = req.body?.estado;
  if (!ESTADOS.includes(estado)) return res.status(400).json({ error: true, mensaje: "Estado no válido" });
  const { data, error } = await supabase
    .from("asa_cronograma")
    .update({ estado, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .select("*, asa_sitios(nombre)")
    .single();
  if (error) return error500(res, error);
  logAccion(req, { accion: "cambio_estado", modulo: "cronograma", registroId: data.id, descripcion: `${data.titulo} → ${estado}` });
  res.json(data);
});

router.delete("/:id", OFICINA, async (req, res) => {
  const { data, error } = await supabase.from("asa_cronograma").delete().eq("id", req.params.id).select("id, titulo, fecha_inicio").maybeSingle();
  if (error) return error500(res, error);
  logAccion(req, { accion: "eliminar", modulo: "cronograma", registroId: req.params.id, descripcion: data ? `${data.titulo} · ${data.fecha_inicio}` : "" });
  res.json({ ok: true });
});

// POST /cronograma/eliminar { ids: [...] } — borrar varios de una vez
router.post("/eliminar", OFICINA, async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length) return res.status(400).json({ error: true, mensaje: "No hay filas seleccionadas" });
  let borradas = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from("asa_cronograma").delete().in("id", ids.slice(i, i + 200)).select("id");
    if (error) return error500(res, error);
    borradas += (data || []).length;
  }
  logAccion(req, { accion: "eliminar", modulo: "cronograma", descripcion: `${borradas} servicio(s) del cronograma borrados` });
  res.json({ ok: true, borradas });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /cronograma/borrar-rango { desde, hasta, sitio_id?, solo_pendientes? }
//
// Borra lo programado entre dos fechas (inclusive): una semana, un mes o lo
// que se elija. Con solo_pendientes (por defecto) no toca lo ya realizado,
// que es historial del servicio.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/borrar-rango", OFICINA, async (req, res) => {
  const { desde, hasta, sitio_id } = req.body || {};
  const soloPendientes = req.body?.solo_pendientes !== false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde || "") || !/^\d{4}-\d{2}-\d{2}$/.test(hasta || "") || hasta < desde) {
    return res.status(400).json({ error: true, mensaje: "Rango de fechas no válido" });
  }
  if (sitio_id && sitio_id !== "sin_planta" && !puedeVerSitio(req, sitio_id)) return res.status(403).json({ error: true, mensaje: "Sin acceso a esa planta" });
  try {
    const filas = await traerTodo(() => {
      let q = supabase
        .from("asa_cronograma")
        .select("id")
        .gte("fecha_inicio", aISO(desde))
        .lt("fecha_inicio", aISO(sumarDias(hasta, 1)))
        .order("id");
      if (soloPendientes) q = q.neq("estado", "realizado");
      if (sitio_id === "sin_planta") return q.is("sitio_id", null);
      return sitio_id ? q.eq("sitio_id", sitio_id) : filtrarPorSitio(q, req);
    });
    const ids = filas.map((f) => f.id);
    let borradas = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabase.from("asa_cronograma").delete().in("id", ids.slice(i, i + 200)).select("id");
      if (error) throw error;
      borradas += (data || []).length;
    }
    logAccion(req, { accion: "eliminar", modulo: "cronograma", descripcion: `Cronograma del ${desde} al ${hasta} borrado: ${borradas} servicio(s)${soloPendientes ? " (sin tocar realizados)" : ""}` });
    res.json({ ok: true, borradas });
  } catch (e) { error500(res, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /cronograma/importar
//   { archivo: base64, vista_previa: true }                → qué trae el Excel
//   { archivo: base64, mapeo: {texto: sitio_id}, reemplazar } → lo guarda
// ─────────────────────────────────────────────────────────────────────────────
router.post("/importar", OFICINA, async (req, res) => {
  const { archivo, vista_previa, mapeo = {}, reemplazar = true, nombre_archivo } = req.body || {};
  if (!archivo) return res.status(400).json({ error: true, mensaje: "Falta el archivo de Excel" });

  let leido;
  try {
    leido = await leerExcel(archivo);
  } catch (e) {
    return res.status(400).json({ error: true, mensaje: `No se pudo leer el Excel: ${e.message}. Debe ser .xlsx.` });
  }
  const { filas, errores } = leido;
  if (!filas.length) {
    return res.status(400).json({
      error: true,
      mensaje: "No encontré servicios en el Excel. Tiene que traer una fila de títulos con FECHA INICIO (y PLANTA, TÍTULO, FECHA FIN…).",
      errores,
    });
  }

  try {
    const { data: sitios } = await supabase.from("asa_sitios").select("id, nombre, codigo").eq("activo", true).order("nombre");
    const fechas = filas.map((f) => f.fecha_inicio).sort();
    const desde = fechaRD(fechas[0]);
    const hasta = fechaRD(fechas[fechas.length - 1]);

    const porPlanta = new Map();
    for (const f of filas) {
      const k = f.planta_texto || "";
      if (!porPlanta.has(k)) porPlanta.set(k, 0);
      porPlanta.set(k, porPlanta.get(k) + 1);
    }

    if (vista_previa) {
      return res.json({
        filas: filas.length,
        desde,
        hasta,
        errores,
        sitios: sitios || [],
        plantas: [...porPlanta.entries()].map(([textoP, n]) => {
          const s = sugerirPlanta(textoP, sitios || []);
          return { texto: textoP, filas: n, sitio_id: s?.sitio.id || null, sitio_nombre: s?.sitio.nombre || null, seguro: !!s?.seguro };
        }),
        muestra: filas.slice(0, 12),
      });
    }

    // Guardar: cada texto de planta va a la planta que se eligió en la vista
    // previa. Una planta sin elegir se guarda sin planta (solo la ve la oficina).
    const validos = new Set((sitios || []).map((s) => s.id));
    const destino = (t) => (mapeo[t || ""] && validos.has(mapeo[t || ""]) ? mapeo[t || ""] : null);
    const lote = crypto.randomUUID();
    const nuevas = filas.map((f) => ({
      sitio_id: destino(f.planta_texto),
      planta_texto: f.planta_texto,
      cliente_texto: f.cliente_texto,
      contrato: f.contrato,
      tipo: f.tipo,
      titulo: f.titulo,
      fecha_inicio: f.fecha_inicio,
      fecha_fin: f.fecha_fin,
      estado: f.estado,
      equipo: f.equipo,
      notas: f.notas,
      origen: "excel",
      lote,
      creado_por: req.usuario?.nombre || null,
    }));

    // Reemplazar: lo que ya había en esas fechas, para esas mismas plantas,
    // se borra antes. Así subir el Excel corregido no duplica todo.
    let reemplazadas = 0;
    if (reemplazar) {
      const plantasDestino = [...new Set(nuevas.map((n) => n.sitio_id).filter(Boolean))];
      const rango = (q) => q.gte("fecha_inicio", aISO(desde)).lt("fecha_inicio", aISO(sumarDias(hasta, 1)));
      if (plantasDestino.length) {
        const { data, error } = await rango(supabase.from("asa_cronograma").delete().in("sitio_id", plantasDestino)).select("id");
        if (error) throw error;
        reemplazadas += (data || []).length;
      }
      const textosSinPlanta = [...new Set(nuevas.filter((n) => !n.sitio_id).map((n) => n.planta_texto).filter(Boolean))];
      if (textosSinPlanta.length) {
        const { data, error } = await rango(supabase.from("asa_cronograma").delete().is("sitio_id", null).in("planta_texto", textosSinPlanta)).select("id");
        if (error) throw error;
        reemplazadas += (data || []).length;
      }
    }

    for (let i = 0; i < nuevas.length; i += 500) {
      const { error } = await supabase.from("asa_cronograma").insert(nuevas.slice(i, i + 500));
      if (error) throw error;
    }

    logAccion(req, {
      accion: "crear",
      modulo: "cronograma",
      descripcion: `Cronograma importado de Excel${nombre_archivo ? ` (${nombre_archivo})` : ""}: ${nuevas.length} servicios del ${desde} al ${hasta}`,
      detalle: { lote, reemplazadas, sin_planta: nuevas.filter((n) => !n.sitio_id).length },
    });
    res.json({ ok: true, guardadas: nuevas.length, reemplazadas, sin_planta: nuevas.filter((n) => !n.sitio_id).length, desde, hasta, errores, lote });
  } catch (e) { error500(res, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /cronograma/repetir { semana: YYYY-MM-DD (lunes), semanas: N, sitio_id? }
//
// Toma los días y horas de los servicios de esa semana y los copia en las N
// semanas siguientes (mismo día de la semana, misma hora). No duplica: si ya
// existe el mismo servicio (planta, título y hora de inicio) se salta.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/repetir", OFICINA, async (req, res) => {
  let { semana, sitio_id } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(semana || "")) return res.status(400).json({ error: true, mensaje: "Semana no válida" });
  // Siempre desde el lunes de la semana elegida, aunque llegue otro día.
  const dSem = new Date(semana + "T12:00:00Z").getUTCDay();
  semana = sumarDias(semana, -((dSem + 6) % 7));
  // `hasta` (una fecha) manda sobre `semanas`: copia en todas las semanas
  // hasta esa fecha. Tope de un año.
  let semanas = Number(req.body?.semanas) || 1;
  if (/^\d{4}-\d{2}-\d{2}$/.test(req.body?.hasta || "")) {
    const dias = Math.round((Date.parse(req.body.hasta + "T12:00:00Z") - Date.parse(semana + "T12:00:00Z")) / 86400000);
    semanas = Math.floor(dias / 7);
    if (semanas < 1) return res.status(400).json({ error: true, mensaje: "La fecha hasta debe ser al menos una semana después de la semana que se copia." });
  }
  semanas = Math.min(Math.max(semanas, 1), 52);
  if (sitio_id && !puedeVerSitio(req, sitio_id)) return res.status(403).json({ error: true, mensaje: "Sin acceso a esa planta" });

  try {
    // Por páginas: una semana del Excel puede pasar de las 1000 filas que
    // devuelve Supabase de una vez.
    const base = await traerTodo(() => {
      const q = supabase
        .from("asa_cronograma")
        .select("*")
        .gte("fecha_inicio", aISO(semana))
        .lt("fecha_inicio", aISO(sumarDias(semana, 7)))
        .neq("estado", "cancelado")
        .order("fecha_inicio")
        .order("id");
      return sitio_id ? q.eq("sitio_id", sitio_id) : q;
    });
    if (!base.length) return res.status(400).json({ error: true, mensaje: `La semana del ${semana} no tiene servicios para copiar${sitio_id ? " en esa planta" : ""}.` });

    const hastaTotal = sumarDias(semana, 7 * (semanas + 1));
    // traerTodo necesita una consulta nueva por página: un builder no se reusa.
    const existentes = await traerTodo(() => {
      const qE = supabase
        .from("asa_cronograma")
        .select("id, sitio_id, titulo, fecha_inicio")
        .gte("fecha_inicio", aISO(sumarDias(semana, 7)))
        .lt("fecha_inicio", aISO(hastaTotal))
        .order("fecha_inicio")
        .order("id");
      return sitio_id ? qE.eq("sitio_id", sitio_id) : qE;
    });
    const clave = (s, t, f) => `${s || ""}|${normal(t)}|${new Date(f).getTime()}`;
    const ya = new Set(existentes.map((e) => clave(e.sitio_id, e.titulo, e.fecha_inicio)));

    const lote = crypto.randomUUID();
    const nuevas = [];
    for (let w = 1; w <= semanas; w++) {
      for (const b of base) {
        const corre = (iso) => (iso ? new Date(new Date(iso).getTime() + w * 7 * 86400000).toISOString() : null);
        const fi = corre(b.fecha_inicio);
        if (ya.has(clave(b.sitio_id, b.titulo, fi))) continue;
        nuevas.push({
          sitio_id: b.sitio_id, planta_texto: b.planta_texto, cliente_texto: b.cliente_texto, contrato: b.contrato,
          tipo: b.tipo, titulo: b.titulo, fecha_inicio: fi, fecha_fin: corre(b.fecha_fin), estado: "pendiente",
          equipo: b.equipo, notas: b.notas, origen: "repetido", lote, creado_por: req.usuario?.nombre || null,
        });
      }
    }
    for (let i = 0; i < nuevas.length; i += 500) {
      const { error: eI } = await supabase.from("asa_cronograma").insert(nuevas.slice(i, i + 500));
      if (eI) throw eI;
    }
    logAccion(req, { accion: "crear", modulo: "cronograma", descripcion: `Semana del ${semana} repetida ${semanas} vez/veces: ${nuevas.length} servicios` });
    res.json({ ok: true, creadas: nuevas.length, saltadas: base.length * semanas - nuevas.length, semanas, base: base.length, desde: sumarDias(semana, 7), hasta: sumarDias(semana, 7 * semanas + 6) });
  } catch (e) { error500(res, e); }
});

export default router;
