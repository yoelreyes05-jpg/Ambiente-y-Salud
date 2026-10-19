// routes/chat.js — Chat entre la oficina y cada técnico (42_chat_tecnicos.sql)
//
// Una conversación por técnico, para darle seguimiento a lo que sube: la
// oficina pregunta ("¿por qué marcaste ratas en la 5023?"), el técnico
// responde con texto o foto. Un mensaje puede ir amarrado a un servicio
// (inspeccion_id) y desde el mensaje se abre ese servicio.
//
//   GET  /chat/no-leidos                 → cuántos mensajes nuevos tengo
//   GET  /chat/conversaciones            → (oficina) técnicos con su último mensaje
//   GET  /chat/servicio/:inspeccionId    → (oficina) de qué técnico es un servicio
//   GET  /chat/:tecnicoId                → mensajes ("mio" = el técnico que pregunta)
//   POST /chat/:tecnicoId { texto, fotos?, inspeccion_id? }
//
// El técnico solo ve y escribe en SU conversación. Las cuentas del hotel no
// entran. Al abrir la conversación, lo del otro lado queda como leído.
import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { guardarFotos } from "../lib/evidencias.js";

const router = express.Router();

const OFICINA = ["admin", "operaciones", "comercial"];
const esOficina = (req) => OFICINA.includes(req.usuario?.rol);
const esTecnico = (req) => req.usuario?.rol === "tecnico_plagas";
const faltaTabla = (e) =>
  /asa_chat_mensajes/.test(e?.message || "") ? "Falta correr supabase/42_chat_tecnicos.sql" : e?.message;

router.use((req, res, next) => {
  if (esOficina(req) || esTecnico(req)) return next();
  res.status(403).json({ error: true, mensaje: "El chat es solo entre la oficina y los técnicos" });
});

// "mio" o el propio id = el técnico; la oficina puede abrir cualquiera
function conversacion(req, res) {
  const pedido = req.params.tecnicoId;
  if (esTecnico(req)) {
    if (pedido !== "mio" && pedido !== req.usuario.id) {
      res.status(403).json({ error: true, mensaje: "Solo puedes ver tu conversación" });
      return null;
    }
    return req.usuario.id;
  }
  if (pedido === "mio") {
    res.status(400).json({ error: true, mensaje: "Indica el técnico" });
    return null;
  }
  return pedido;
}

// Resumen del servicio para mostrarlo dentro del mensaje
async function resumenServicios(ids) {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return new Map();
  const { data } = await supabase
    .from("asa_v_servicios_dia")
    .select("inspeccion_id, fecha, planta, area, codigo_visible, numero_habitacion, punto_nombre, tipo_nombre, nivel_actividad, motivo_no_realizado")
    .in("inspeccion_id", unicos.slice(0, 200));
  return new Map((data || []).map((s) => [s.inspeccion_id, {
    id: s.inspeccion_id,
    fecha: s.fecha,
    planta: s.planta,
    area: s.area,
    punto: s.numero_habitacion ? `Habitación ${s.numero_habitacion}` : s.punto_nombre || s.codigo_visible,
    codigo: s.codigo_visible,
    tipo: s.tipo_nombre,
    nivel_actividad: s.nivel_actividad,
    no_realizado: !!s.motivo_no_realizado,
  }]));
}

// GET /chat/no-leidos
router.get("/no-leidos", async (req, res) => {
  let q = supabase.from("asa_chat_mensajes").select("id, tecnico_id");
  q = esTecnico(req)
    ? q.eq("tecnico_id", req.usuario.id).eq("de_oficina", true).eq("leido_tecnico", false)
    : q.eq("de_oficina", false).eq("leido_oficina", false);
  const { data, error } = await q.limit(1000);
  if (error) return res.json({ total: 0, aviso: faltaTabla(error) });
  const porTecnico = {};
  for (const m of data || []) porTecnico[m.tecnico_id] = (porTecnico[m.tecnico_id] || 0) + 1;
  res.json({ total: (data || []).length, por_tecnico: esTecnico(req) ? undefined : porTecnico });
});

// GET /chat/conversaciones — todos los técnicos activos, los que tienen
// mensajes nuevos primero, después los de conversación más reciente
router.get("/conversaciones", async (req, res) => {
  if (!esOficina(req)) return res.status(403).json({ error: true, mensaje: "Solo la oficina" });
  const [{ data: tecnicos, error: e1 }, { data: mensajes, error: e2 }] = await Promise.all([
    supabase.from("asa_usuarios").select("id, nombre_completo, email, ultimo_acceso").eq("rol", "tecnico_plagas").eq("activo", true).order("nombre_completo"),
    supabase.from("asa_chat_mensajes").select("tecnico_id, texto, fotos, de_oficina, leido_oficina, created_at, autor_nombre").order("created_at", { ascending: false }).limit(2000),
  ]);
  if (e1) return res.status(500).json({ error: true, mensaje: e1.message });
  if (e2) return res.status(500).json({ error: true, mensaje: faltaTabla(e2) });

  const ultimo = new Map();
  const nuevos = new Map();
  for (const m of mensajes || []) {
    if (!ultimo.has(m.tecnico_id)) ultimo.set(m.tecnico_id, m);
    if (!m.de_oficina && !m.leido_oficina) nuevos.set(m.tecnico_id, (nuevos.get(m.tecnico_id) || 0) + 1);
  }
  const lista = (tecnicos || []).map((t) => {
    const u = ultimo.get(t.id);
    return {
      tecnico_id: t.id,
      nombre: t.nombre_completo,
      ultimo_acceso: t.ultimo_acceso,
      no_leidos: nuevos.get(t.id) || 0,
      ultimo: u ? { texto: u.texto || (u.fotos?.length ? "📷 Foto" : ""), de_oficina: u.de_oficina, autor: u.autor_nombre, fecha: u.created_at } : null,
    };
  });
  lista.sort((a, b) =>
    (b.no_leidos > 0) - (a.no_leidos > 0) ||
    String(b.ultimo?.fecha || "").localeCompare(String(a.ultimo?.fecha || "")) ||
    a.nombre.localeCompare(b.nombre, "es"));
  res.json(lista);
});

// GET /chat/servicio/:inspeccionId — para "Comentar con el técnico" desde un servicio
router.get("/servicio/:inspeccionId", async (req, res) => {
  if (!esOficina(req)) return res.status(403).json({ error: true, mensaje: "Solo la oficina" });
  const { data: insp } = await supabase.from("asa_inspecciones").select("id, tecnico_id").eq("id", req.params.inspeccionId).maybeSingle();
  if (!insp) return res.status(404).json({ error: true, mensaje: "Servicio no encontrado" });
  if (!insp.tecnico_id) return res.status(404).json({ error: true, mensaje: "Ese servicio no tiene técnico registrado" });
  const { data: u } = await supabase
    .from("asa_usuarios").select("id, nombre_completo, activo").eq("empleado_id", insp.tecnico_id).eq("rol", "tecnico_plagas").limit(1).maybeSingle();
  if (!u) return res.status(404).json({ error: true, mensaje: "El técnico de ese servicio no tiene cuenta en la app" });
  res.json({ tecnico_id: u.id, nombre: u.nombre_completo, activo: u.activo });
});

// GET /chat/:tecnicoId?antes=fecha — los últimos 150 mensajes, de viejo a nuevo
router.get("/:tecnicoId", async (req, res) => {
  const tecnicoId = conversacion(req, res);
  if (!tecnicoId) return;
  let q = supabase.from("asa_chat_mensajes").select("*").eq("tecnico_id", tecnicoId).order("created_at", { ascending: false }).limit(150);
  if (req.query.antes) q = q.lt("created_at", req.query.antes);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: faltaTabla(error) });

  // Lo del otro lado queda leído
  const campo = esTecnico(req) ? "leido_tecnico" : "leido_oficina";
  const sinLeer = (data || []).filter((m) => (esTecnico(req) ? m.de_oficina : !m.de_oficina) && !m[campo]).map((m) => m.id);
  if (sinLeer.length) await supabase.from("asa_chat_mensajes").update({ [campo]: true }).in("id", sinLeer);

  const servicios = await resumenServicios((data || []).map((m) => m.inspeccion_id));
  const { data: tec } = await supabase.from("asa_usuarios").select("id, nombre_completo").eq("id", tecnicoId).maybeSingle();
  res.json({
    tecnico: tec ? { id: tec.id, nombre: tec.nombre_completo } : { id: tecnicoId, nombre: "" },
    mensajes: (data || []).reverse().map((m) => ({
      ...m,
      servicio: m.inspeccion_id ? servicios.get(m.inspeccion_id) || null : null,
      mio: m.autor_id === req.usuario.id,
    })),
  });
});

// POST /chat/:tecnicoId { texto, fotos?: [dataURL], inspeccion_id? }
router.post("/:tecnicoId", async (req, res) => {
  const tecnicoId = conversacion(req, res);
  if (!tecnicoId) return;
  const texto = String(req.body?.texto || "").trim().slice(0, 4000);
  // Solo fotos tomadas en el momento (data:image/…), nunca un enlace cualquiera
  const fotosIn = (Array.isArray(req.body?.fotos) ? req.body.fotos : [])
    .filter((f) => typeof f === "string" && /^data:image\/(jpeg|jpg|png|webp);base64,/.test(f) && f.length < 4_000_000)
    .slice(0, 4);
  if (!texto && !fotosIn.length) return res.status(400).json({ error: true, mensaje: "Escribe un mensaje o agrega una foto" });

  if (esOficina(req)) {
    const { data: t } = await supabase.from("asa_usuarios").select("id").eq("id", tecnicoId).eq("rol", "tecnico_plagas").maybeSingle();
    if (!t) return res.status(404).json({ error: true, mensaje: "Técnico no encontrado" });
  }
  let inspeccionId = req.body?.inspeccion_id || null;
  if (inspeccionId) {
    const { data: i } = await supabase.from("asa_inspecciones").select("id").eq("id", inspeccionId).maybeSingle();
    if (!i) inspeccionId = null;
  }

  let fotos = [];
  try {
    fotos = fotosIn.length ? await guardarFotos(fotosIn, `chat/${tecnicoId}`) : [];
  } catch (e) {
    return res.status(500).json({ error: true, mensaje: `No se pudo guardar la foto: ${e.message}` });
  }

  const deOficina = esOficina(req);
  const { data, error } = await supabase
    .from("asa_chat_mensajes")
    .insert([{
      tecnico_id: tecnicoId,
      autor_id: req.usuario.id,
      autor_nombre: req.usuario.nombre || (deOficina ? "Oficina" : "Técnico"),
      de_oficina: deOficina,
      texto: texto || null,
      fotos,
      inspeccion_id: inspeccionId,
      leido_tecnico: !deOficina,
      leido_oficina: deOficina,
    }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: faltaTabla(error) });
  const servicios = await resumenServicios([inspeccionId]);
  res.status(201).json({ ...data, servicio: inspeccionId ? servicios.get(inspeccionId) || null : null, mio: true });
});

export default router;
