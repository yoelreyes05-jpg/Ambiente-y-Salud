// routes/firmas.js — Órdenes del día y firma de quien recibe el servicio
//
// Lo que sube un técnico en un hotel en un día es su ORDEN de ese día. Queda
// "En proceso" hasta que alguien del hotel revisa lo que hizo y firma; con la
// firma queda "Finalizada" (supabase/43_firmas_servicio.sql).
//
//   GET    /firmas/ordenes?sitio_id=&desde=&hasta=   órdenes con su estado
//   GET    /firmas/orden?sitio_id=&fecha=&clave=     lo que hizo + la firma
//   GET    /firmas/mia?sitio_id=                     la orden de hoy del técnico (app)
//   POST   /firmas                                   firmar (técnico, oficina u hotel)
//   DELETE /firmas/:id                               anular una firma (admin)
//
// Firma el técnico en su teléfono (la persona del hotel firma en la pantalla),
// la oficina, o el hotel en su portal (POST /firmas está en las escrituras que
// el middleware deja hacer a las cuentas del hotel).

import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { traerTodo } from "../lib/paginar.js";
import { exigirSitioPermitido, ROLES_EXTERNOS } from "../middleware/auth.js";
import { logAccion } from "../lib/auditoria.js";
import { sitiosDelTecnico } from "../lib/sitiosTecnico.js";

const router = express.Router();
const hoyRD = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
const sumarDias = (f, n) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fechaOk = (f) => /^\d{4}-\d{2}-\d{2}$/.test(String(f || ""));
const claveDe = (s) => (s.tecnico_id ? String(s.tecnico_id) : `n:${s.tecnico || "Sin técnico"}`);
const err = (res, e, st = 500) => {
  const m = e.message || String(e);
  const falta = /asa_firmas_servicio/.test(m) && /(does not exist|schema cache|not find)/i.test(m);
  res.status(st).json({ error: true, mensaje: falta ? "Falta correr supabase/43_firmas_servicio.sql en Supabase." : m });
};

async function serviciosDe(sitio_id, desde, hasta) {
  return traerTodo(() => supabase.from("asa_v_servicios_dia")
    .select("inspeccion_id, punto_id, fecha, fecha_local, tecnico_id, tecnico, codigo_visible, punto_nombre, numero_habitacion, area, tipo_codigo, tipo_nombre, tipo_icono, estado_punto, nivel_actividad, no_realizado, motivo_no_realizado, plagas_total, fotos_total, notas")
    .eq("sitio_id", sitio_id).gte("fecha_local", desde).lte("fecha_local", hasta)
    .order("fecha", { ascending: true }).order("inspeccion_id"));
}

// Cuenta honesta: por PUNTO, no por registro. Si un punto se registró dos
// veces cuenta una; si primero "no se pudo" y luego se hizo, cuenta como
// hecho (no como no realizado). "registros" dice cuántas filas subió.
function agrupar(servicios) {
  const ordenes = new Map();
  for (const s of servicios) {
    const k = `${s.fecha_local}|${claveDe(s)}`;
    if (!ordenes.has(k)) {
      ordenes.set(k, { fecha: s.fecha_local, clave: claveDe(s), tecnico: s.tecnico || "Sin técnico", registros: 0, desde: s.fecha, hasta: s.fecha, puntos: new Map() });
    }
    const o = ordenes.get(k);
    o.registros++;
    if (s.fecha < o.desde) o.desde = s.fecha;
    if (s.fecha > o.hasta) o.hasta = s.fecha;
    const pk = s.punto_id || s.inspeccion_id;
    const ant = o.puntos.get(pk);
    const hecho = !s.no_realizado;
    const actividad = hecho && s.nivel_actividad && s.nivel_actividad !== "ninguna";
    o.puntos.set(pk, {
      hecho: (ant?.hecho || false) || hecho,
      actividad: (ant?.actividad || false) || actividad,
      tipo: { codigo: s.tipo_codigo, nombre: s.tipo_nombre, icono: s.tipo_icono },
    });
  }
  return [...ordenes.values()].map(({ puntos, ...o }) => {
    const tipos = new Map();
    let hechos = 0, noRealizados = 0, conActividad = 0;
    for (const p of puntos.values()) {
      if (p.hecho) hechos++; else noRealizados++;
      if (p.actividad) conActividad++;
      const t = tipos.get(p.tipo.codigo) || { ...p.tipo, n: 0 };
      t.n++; tipos.set(p.tipo.codigo, t);
    }
    return { ...o, puntos: puntos.size, hechos, no_realizados: noRealizados, con_actividad: conActividad, tipos: [...tipos.values()].sort((a, b) => b.n - a.n) };
  });
}

// El técnico solo ve y hace firmar lo suyo, y solo de los hoteles que tiene
// asignados (un técnico de un hotel no ve lo que falta firmar en otro).
const esTecnico = (req) => req.usuario?.rol === "tecnico_plagas";
const esMia = (req, s) => (req.usuario.empleado_id && String(s.tecnico_id) === String(req.usuario.empleado_id)) || (!!s.tecnico && s.tecnico === req.usuario.nombre);
async function hotelDelTecnico(req, res, sitio_id) {
  if (!esTecnico(req)) return true;
  const permitidos = await sitiosDelTecnico(req);
  if (permitidos && !permitidos.map(String).includes(String(sitio_id))) {
    res.status(403).json({ error: true, mensaje: "Ese hotel no está asignado a ti." });
    return false;
  }
  return true;
}

const publica = (f) => f && ({
  id: f.id, firmante_nombre: f.firmante_nombre, firmante_cargo: f.firmante_cargo, comentario: f.comentario,
  origen: f.origen, firmado_por_nombre: f.firmado_por_nombre, servicios: f.servicios, created_at: f.created_at,
});

router.get("/ordenes", async (req, res) => {
  const { sitio_id } = req.query;
  if (!sitio_id) return err(res, new Error("sitio_id es requerido"), 400);
  if (!exigirSitioPermitido(req, res, sitio_id)) return;
  if (!(await hotelDelTecnico(req, res, sitio_id))) return;
  const hasta = fechaOk(req.query.hasta) ? req.query.hasta : hoyRD();
  const desde = fechaOk(req.query.desde) ? req.query.desde : sumarDias(hasta, -6);
  try {
    const [servicios, { data: firmas, error }] = await Promise.all([
      serviciosDe(sitio_id, desde, hasta),
      supabase.from("asa_firmas_servicio").select("id, fecha, clave, firmante_nombre, firmante_cargo, comentario, origen, firmado_por_nombre, servicios, created_at")
        .eq("sitio_id", sitio_id).gte("fecha", desde).lte("fecha", hasta),
    ]);
    if (error) throw error;
    const porClave = new Map((firmas || []).map((f) => [`${f.fecha}|${f.clave}`, f]));
    const ordenes = agrupar(esTecnico(req) ? servicios.filter((x) => esMia(req, x)) : servicios).map((o) => {
      const f = porClave.get(`${o.fecha}|${o.clave}`);
      return { ...o, estado: f ? "finalizada" : "en_proceso", firma: publica(f), nuevos_despues: f ? Math.max(0, o.registros - f.servicios) : 0 };
    }).sort((a, b) => b.fecha.localeCompare(a.fecha) || a.tecnico.localeCompare(b.tecnico, "es"));
    res.json({
      desde, hasta, ordenes,
      resumen: { total: ordenes.length, en_proceso: ordenes.filter((o) => o.estado === "en_proceso").length, finalizadas: ordenes.filter((o) => o.estado === "finalizada").length },
    });
  } catch (e) { err(res, e); }
});

router.get("/orden", async (req, res) => {
  const { sitio_id, fecha, clave } = req.query;
  if (!sitio_id || !fechaOk(fecha) || !clave) return err(res, new Error("sitio_id, fecha y clave son requeridos"), 400);
  if (!exigirSitioPermitido(req, res, sitio_id)) return;
  if (!(await hotelDelTecnico(req, res, sitio_id))) return;
  try {
    const [servicios, { data: firma, error }] = await Promise.all([
      serviciosDe(sitio_id, fecha, fecha),
      supabase.from("asa_firmas_servicio").select("*").eq("sitio_id", sitio_id).eq("fecha", fecha).eq("clave", clave).maybeSingle(),
    ]);
    if (error) throw error;
    const mios = servicios.filter((s) => claveDe(s) === clave);
    if (esTecnico(req) && mios.length && !mios.some((s) => esMia(req, s))) return err(res, new Error("Esa orden es de otro técnico"), 403);
    if (!mios.length && !firma) return err(res, new Error("Esa orden no tiene servicios"), 404);
    const [o] = agrupar(mios);
    res.json({
      ...(o || { fecha, clave, tecnico: firma?.tecnico_nombre, hechos: 0, no_realizados: 0, tipos: [] }),
      estado: firma ? "finalizada" : "en_proceso",
      firma: firma ? { ...publica(firma), imagen: firma.firma } : null,
      servicios: mios.map((s) => ({
        inspeccion_id: s.inspeccion_id, hora: s.fecha, codigo: s.codigo_visible, punto: s.numero_habitacion ? `Habitación ${s.numero_habitacion}` : s.punto_nombre || s.codigo_visible,
        area: s.area, tipo: s.tipo_nombre, icono: s.tipo_icono, estado_punto: s.estado_punto, nivel_actividad: s.nivel_actividad,
        no_realizado: s.no_realizado, motivo: s.motivo_no_realizado, plagas: s.plagas_total, fotos: s.fotos_total, notas: s.notas,
      })),
    });
  } catch (e) { err(res, e); }
});

// Las órdenes del técnico que pregunta en un día, de TODOS sus hoteles, para
// que escoja en cuál pide la firma (GET /firmas/mias?fecha=)
router.get("/mias", async (req, res) => {
  const fecha = fechaOk(req.query.fecha) ? req.query.fecha : hoyRD();
  try {
    const cols = "inspeccion_id, punto_id, fecha, fecha_local, sitio_id, planta, tecnico_id, tecnico, tipo_codigo, tipo_nombre, tipo_icono, nivel_actividad, no_realizado";
    let servicios = [];
    if (req.usuario.empleado_id) {
      servicios = await traerTodo(() => supabase.from("asa_v_servicios_dia").select(cols).eq("fecha_local", fecha).eq("tecnico_id", req.usuario.empleado_id).order("fecha").order("inspeccion_id"));
    }
    if (!servicios.length && req.usuario.nombre) {
      servicios = await traerTodo(() => supabase.from("asa_v_servicios_dia").select(cols).eq("fecha_local", fecha).eq("tecnico", req.usuario.nombre).order("fecha").order("inspeccion_id"));
    }
    if (req.sitiosPermitidos) servicios = servicios.filter((s) => req.sitiosPermitidos.includes(s.sitio_id));
    const asignados = await sitiosDelTecnico(req);
    if (asignados) servicios = servicios.filter((s) => asignados.map(String).includes(String(s.sitio_id)));
    const porSitio = new Map();
    for (const s of servicios) {
      if (!porSitio.has(s.sitio_id)) porSitio.set(s.sitio_id, { sitio_id: s.sitio_id, planta: s.planta, lista: [] });
      porSitio.get(s.sitio_id).lista.push(s);
    }
    const ordenes = [];
    for (const g of porSitio.values()) {
      const [o] = agrupar(g.lista);
      const { data: firma, error } = await supabase.from("asa_firmas_servicio").select("*")
        .eq("sitio_id", g.sitio_id).eq("fecha", fecha).eq("clave", o.clave).maybeSingle();
      if (error) throw error;
      ordenes.push({ ...o, sitio_id: g.sitio_id, planta: g.planta, estado: firma ? "finalizada" : "en_proceso", firma: publica(firma) });
    }
    ordenes.sort((a, b) => a.desde.localeCompare(b.desde));
    res.json({ fecha, ordenes });
  } catch (e) { err(res, e); }
});

// La orden de hoy del técnico que pregunta (para firmar en su teléfono)
router.get("/mia", async (req, res) => {
  const { sitio_id } = req.query;
  if (!sitio_id) return err(res, new Error("sitio_id es requerido"), 400);
  if (!exigirSitioPermitido(req, res, sitio_id)) return;
  if (!(await hotelDelTecnico(req, res, sitio_id))) return;
  const fecha = fechaOk(req.query.fecha) ? req.query.fecha : hoyRD();
  try {
    const servicios = (await serviciosDe(sitio_id, fecha, fecha)).filter((s) => esMia(req, s));
    if (!servicios.length) return res.json({ fecha, orden: null });
    const [o] = agrupar(servicios);
    const { data: firma, error } = await supabase.from("asa_firmas_servicio").select("*")
      .eq("sitio_id", sitio_id).eq("fecha", fecha).eq("clave", o.clave).maybeSingle();
    if (error) throw error;
    res.json({ fecha, orden: { ...o, estado: firma ? "finalizada" : "en_proceso", firma: publica(firma) } });
  } catch (e) { err(res, e); }
});

router.post("/", async (req, res) => {
  const b = req.body || {};
  const { sitio_id, fecha, clave } = b;
  if (!sitio_id || !fechaOk(fecha) || !clave) return err(res, new Error("sitio_id, fecha y clave son requeridos"), 400);
  if (!exigirSitioPermitido(req, res, sitio_id)) return;
  if (!(await hotelDelTecnico(req, res, sitio_id))) return;
  const nombre = String(b.firmante_nombre || "").trim();
  if (nombre.length < 3) return err(res, new Error("Escribe el nombre de quien recibe el servicio"), 400);
  const firma = String(b.firma || "");
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(firma) || firma.length < 800) return err(res, new Error("Falta la firma"), 400);
  if (firma.length > 600000) return err(res, new Error("La imagen de la firma es demasiado grande"), 400);
  try {
    const servicios = (await serviciosDe(sitio_id, fecha, fecha)).filter((s) => claveDe(s) === clave);
    if (!servicios.length) return err(res, new Error("Esa orden no tiene servicios para firmar"), 404);
    // El técnico solo hace firmar su propia orden
    if (esTecnico(req)) {
      if (!servicios.some((s) => esMia(req, s))) return err(res, new Error("Solo puedes pedir la firma de tus propios servicios"), 403);
    }
    const { data: ya } = await supabase.from("asa_firmas_servicio").select("id, firmante_nombre").eq("sitio_id", sitio_id).eq("fecha", fecha).eq("clave", clave).maybeSingle();
    if (ya) return err(res, new Error(`Esta orden ya la firmó ${ya.firmante_nombre}`), 409);
    const origen = ROLES_EXTERNOS.includes(req.usuario.rol) ? "portal" : req.usuario.rol === "tecnico_plagas" ? "tecnico" : "panel";
    const fila = {
      sitio_id, fecha, clave, tecnico_nombre: servicios[0].tecnico || null,
      firmante_nombre: nombre.slice(0, 120), firmante_cargo: String(b.firmante_cargo || "").trim().slice(0, 120) || null,
      firma, comentario: String(b.comentario || "").trim().slice(0, 1000) || null, origen,
      firmado_por: req.usuario.id || null, firmado_por_nombre: req.usuario.persona || req.usuario.nombre || null, servicios: servicios.length,
    };
    const { data, error } = await supabase.from("asa_firmas_servicio").insert([fila]).select("id, created_at").single();
    if (error) throw error;
    logAccion(req, { accion: "firmar_orden", modulo: "firmas", registroId: data.id, descripcion: `Orden firmada por ${fila.firmante_nombre}`, detalle: { sitio_id, fecha, tecnico: fila.tecnico_nombre, firmante: fila.firmante_nombre } });
    res.status(201).json({ ok: true, id: data.id, estado: "finalizada", firma: publica({ ...fila, ...data }) });
  } catch (e) { err(res, e); }
});

router.delete("/:id", async (req, res) => {
  if (req.usuario.rol !== "admin") return err(res, new Error("Solo un administrador puede anular una firma"), 403);
  try {
    const { data, error } = await supabase.from("asa_firmas_servicio").delete().eq("id", req.params.id).select("id, sitio_id, fecha, firmante_nombre");
    if (error) throw error;
    if (!data?.length) return err(res, new Error("Firma no encontrada"), 404);
    logAccion(req, { accion: "anular_firma", modulo: "firmas", registroId: req.params.id, descripcion: "Firma anulada", detalle: data[0] });
    res.json({ ok: true });
  } catch (e) { err(res, e); }
});

export default router;
