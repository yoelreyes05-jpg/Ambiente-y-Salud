// routes/firmas.js — Órdenes del día y firmas de quien recibe el servicio
//
// Lo que sube un técnico en un hotel en un día es su ORDEN de ese día. Se
// puede firmar de una vez (todo) o POR PARTES: cada firma cubre los servicios
// que se escogieron (por área, o por el responsable que firma esas áreas).
//   En proceso          → ninguna firma
//   Firmada en parte    → hay firmas, pero quedan servicios sin firmar
//   Finalizada          → todo lo subido está cubierto por alguna firma
// (supabase/43_firmas_servicio.sql y 44_firmas_por_partes.sql)
//
//   GET    /firmas/ordenes?sitio_id=&desde=&hasta=   órdenes con su estado
//   GET    /firmas/orden?sitio_id=&fecha=&clave=     lo que hizo, por área, y sus firmas
//   GET    /firmas/mias?fecha=                       órdenes del técnico en sus hoteles (app)
//   POST   /firmas                                   firmar todo o una parte
//   DELETE /firmas/:id                               anular una firma (admin)
//   GET    /firmas/responsables?sitio_id=            quién firma cada área
//   PUT    /firmas/responsables?sitio_id=            guardarlo (oficina)
//
// Los responsables viven en asa_config_sistema, clave "firmas_responsables":
//   { sitio_id: [{ id, cargo, areas: [area_id, ...] }] }

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
  const faltaCol = /inspecciones|parte/.test(m) && /(column|schema cache)/i.test(m);
  res.status(st).json({
    error: true,
    mensaje: falta ? "Falta correr supabase/43_firmas_servicio.sql en Supabase."
      : faltaCol ? "Falta correr supabase/44_firmas_por_partes.sql en Supabase." : m,
  });
};

const COLS = "inspeccion_id, punto_id, fecha, fecha_local, sitio_id, planta, area_id, area, tecnico_id, tecnico, codigo_visible, punto_nombre, numero_habitacion, tipo_codigo, tipo_nombre, tipo_icono, estado_punto, nivel_actividad, no_realizado, motivo_no_realizado, plagas_total, fotos_total, notas";
async function serviciosDe(sitio_id, desde, hasta) {
  return traerTodo(() => supabase.from("asa_v_servicios_dia").select(COLS)
    .eq("sitio_id", sitio_id).gte("fecha_local", desde).lte("fecha_local", hasta)
    .order("fecha", { ascending: true }).order("inspeccion_id"));
}
const FIRMA_COLS = "id, sitio_id, fecha, clave, tecnico_nombre, firmante_nombre, firmante_cargo, comentario, origen, firmado_por_nombre, servicios, inspecciones, parte, created_at";
async function firmasDe(sitio_id, desde, hasta, conImagen = false) {
  const { data, error } = await supabase.from("asa_firmas_servicio").select(conImagen ? `${FIRMA_COLS}, firma` : FIRMA_COLS)
    .eq("sitio_id", sitio_id).gte("fecha", desde).lte("fecha", hasta).order("created_at");
  if (error) throw error;
  return data || [];
}

// Qué servicio cubre cada firma. Una firma vieja (de antes de firmar por
// partes) no trae la lista: cubre lo que se había subido hasta ese momento.
function cobertura(servicios, firmas) {
  const cubre = new Map();   // inspeccion_id → firma
  for (const f of firmas) {
    if (Array.isArray(f.inspecciones)) {
      for (const id of f.inspecciones) if (!cubre.has(String(id))) cubre.set(String(id), f);
    } else {
      const t = Date.parse(f.created_at);
      for (const s of servicios) if (!cubre.has(String(s.inspeccion_id)) && Date.parse(s.fecha) <= t) cubre.set(String(s.inspeccion_id), f);
    }
  }
  return cubre;
}

// Cuenta honesta: por PUNTO, no por registro. Si un punto se registró dos
// veces cuenta una; si primero "no se pudo" y luego se hizo, cuenta como
// hecho. "registros" dice cuántas filas subió.
function resumen(servicios) {
  const puntos = new Map();
  let desde = null, hasta = null;
  for (const s of servicios) {
    if (!desde || s.fecha < desde) desde = s.fecha;
    if (!hasta || s.fecha > hasta) hasta = s.fecha;
    const pk = s.punto_id || s.inspeccion_id;
    const ant = puntos.get(pk);
    const hecho = !s.no_realizado;
    puntos.set(pk, {
      hecho: (ant?.hecho || false) || hecho,
      actividad: (ant?.actividad || false) || (hecho && s.nivel_actividad && s.nivel_actividad !== "ninguna"),
      tipo: { codigo: s.tipo_codigo, nombre: s.tipo_nombre, icono: s.tipo_icono },
    });
  }
  const tipos = new Map();
  let hechos = 0, noRealizados = 0, conActividad = 0;
  for (const p of puntos.values()) {
    if (p.hecho) hechos++; else noRealizados++;
    if (p.actividad) conActividad++;
    const t = tipos.get(p.tipo.codigo) || { ...p.tipo, n: 0 };
    t.n++; tipos.set(p.tipo.codigo, t);
  }
  return { registros: servicios.length, puntos: puntos.size, hechos, no_realizados: noRealizados, con_actividad: conActividad, desde, hasta, tipos: [...tipos.values()].sort((a, b) => b.n - a.n) };
}
const puntosDistintos = (lista) => new Set(lista.map((s) => s.punto_id || s.inspeccion_id)).size;

const publica = (f) => f && ({
  id: f.id, firmante_nombre: f.firmante_nombre, firmante_cargo: f.firmante_cargo, comentario: f.comentario,
  origen: f.origen, firmado_por_nombre: f.firmado_por_nombre, servicios: f.servicios, parte: f.parte || null, created_at: f.created_at,
});

// Arma una orden: sus números, su estado y sus firmas
function armarOrden(servicios, firmas) {
  const cubre = cobertura(servicios, firmas);
  const pendientes = servicios.filter((s) => !cubre.has(String(s.inspeccion_id)));
  const usadas = firmas.filter((f) => [...cubre.values()].includes(f) || Array.isArray(f.inspecciones));
  const estado = !firmas.length ? "en_proceso" : pendientes.length ? "parcial" : "finalizada";
  return {
    ...resumen(servicios),
    fecha: servicios[0]?.fecha_local, clave: servicios[0] ? claveDe(servicios[0]) : null, tecnico: servicios[0]?.tecnico || "Sin técnico",
    sitio_id: servicios[0]?.sitio_id, planta: servicios[0]?.planta,
    estado, firmas: (usadas.length ? usadas : firmas).map((f) => ({ ...publica(f), puntos: puntosDistintos(servicios.filter((s) => cubre.get(String(s.inspeccion_id)) === f)) })),
    pendientes_registros: pendientes.length, pendientes_puntos: puntosDistintos(pendientes),
    _cubre: cubre, _pendientes: pendientes,
  };
}
const sinInternos = ({ _cubre, _pendientes, ...o }) => o;

// El técnico solo ve y hace firmar lo suyo, y solo de los hoteles que tiene
// asignados (un técnico de un hotel no ve lo que falta firmar en otro).
const esTecnico = (req) => req.usuario?.rol === "tecnico_plagas";
const esOficina = (req) => ["admin", "operaciones", "comercial"].includes(req.usuario?.rol);

// Los servicios del técnico que pregunta: los que subió con SU cuenta, más los
// que llevan su ficha de empleado. Antes se buscaba por el nombre, y si el de
// la cuenta no era idéntico al de la ficha no aparecía nada.
async function empleadoDe(req) {
  if (req.usuario.empleado_id) return req.usuario.empleado_id;
  const { data } = await supabase.from("asa_usuarios").select("empleado_id").eq("id", req.usuario.id).maybeSingle();
  return data?.empleado_id || null;
}
async function idsMios(req, desde, hasta, sitio_id = null) {
  const consulta = (col, val) => traerTodo(() => {
    let q = supabase.from("asa_inspecciones").select("id").eq(col, val).gte("fecha_local", desde).lte("fecha_local", hasta);
    if (sitio_id) q = q.eq("sitio_id", sitio_id);
    return q.order("id");
  });
  const emp = await empleadoDe(req);
  const [a, b] = await Promise.all([req.usuario.id ? consulta("usuario_id", req.usuario.id) : [], emp ? consulta("tecnico_id", emp) : []]);
  return new Set([...a, ...b].map((x) => String(x.id)));
}
const esMia = (req, s, ids) => (ids && ids.has(String(s.inspeccion_id))) || (req.usuario.empleado_id && String(s.tecnico_id) === String(req.usuario.empleado_id)) || (!!s.tecnico && s.tecnico === req.usuario.nombre);
async function hotelDelTecnico(req, res, sitio_id) {
  if (!esTecnico(req)) return true;
  const permitidos = await sitiosDelTecnico(req);
  if (permitidos && !permitidos.map(String).includes(String(sitio_id))) {
    res.status(403).json({ error: true, mensaje: "Ese hotel no está asignado a ti." });
    return false;
  }
  return true;
}

// ── Responsables por área ────────────────────────────────────────────────────
const CLAVE_RESP = "firmas_responsables";
async function responsablesDe(sitio_id) {
  const { data, error } = await supabase.from("asa_config_sistema").select("valor").eq("clave", CLAVE_RESP).maybeSingle();
  if (error) throw error;
  const lista = data?.valor && typeof data.valor === "object" ? data.valor[sitio_id] : null;
  return Array.isArray(lista) ? lista : [];
}

router.get("/responsables", async (req, res) => {
  const { sitio_id } = req.query;
  if (!sitio_id) return err(res, new Error("sitio_id es requerido"), 400);
  if (!exigirSitioPermitido(req, res, sitio_id)) return;
  try { res.json(await responsablesDe(sitio_id)); } catch (e) { err(res, e); }
});

router.put("/responsables", async (req, res) => {
  const { sitio_id } = req.query;
  if (!sitio_id) return err(res, new Error("sitio_id es requerido"), 400);
  if (!["admin", "operaciones", "comercial"].includes(req.usuario.rol)) return err(res, new Error("Solo la oficina configura quién firma"), 403);
  const lista = Array.isArray(req.body) ? req.body : req.body?.responsables;
  if (!Array.isArray(lista)) return err(res, new Error("Lista inválida"), 400);
  const limpia = lista.filter((r) => String(r.cargo || "").trim() && Array.isArray(r.areas) && r.areas.length).map((r, i) => ({
    id: String(r.id || `r${Date.now().toString(36)}${i}`), cargo: String(r.cargo).trim().slice(0, 80), areas: [...new Set(r.areas.map(String))],
  }));
  try {
    const { data } = await supabase.from("asa_config_sistema").select("valor").eq("clave", CLAVE_RESP).maybeSingle();
    const todo = { ...(data?.valor && typeof data.valor === "object" ? data.valor : {}), [sitio_id]: limpia };
    const { error } = await supabase.from("asa_config_sistema").upsert([{ clave: CLAVE_RESP, valor: todo, updated_at: new Date().toISOString() }], { onConflict: "clave" });
    if (error) throw error;
    res.json(limpia);
  } catch (e) { err(res, e); }
});

// ── Órdenes ─────────────────────────────────────────────────────────────────
router.get("/ordenes", async (req, res) => {
  const { sitio_id } = req.query;
  if (!sitio_id) return err(res, new Error("sitio_id es requerido"), 400);
  if (!exigirSitioPermitido(req, res, sitio_id)) return;
  if (!(await hotelDelTecnico(req, res, sitio_id))) return;
  const hasta = fechaOk(req.query.hasta) ? req.query.hasta : hoyRD();
  const desde = fechaOk(req.query.desde) ? req.query.desde : sumarDias(hasta, -6);
  try {
    let [servicios, firmas] = await Promise.all([serviciosDe(sitio_id, desde, hasta), firmasDe(sitio_id, desde, hasta)]);
    if (esTecnico(req)) {
      const ids = await idsMios(req, desde, hasta, sitio_id);
      const claves = new Set(servicios.filter((x) => esMia(req, x, ids)).map((x) => `${x.fecha_local}|${claveDe(x)}`));
      servicios = servicios.filter((x) => claves.has(`${x.fecha_local}|${claveDe(x)}`));
    }
    const grupos = new Map();
    for (const s of servicios) {
      const k = `${s.fecha_local}|${claveDe(s)}`;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(s);
    }
    const ordenes = [...grupos.entries()].map(([k, lista]) => {
      const o = armarOrden(lista, firmas.filter((f) => `${f.fecha}|${f.clave}` === k));
      return { ...sinInternos(o), firma: o.firmas[o.firmas.length - 1] || null };
    }).sort((a, b) => b.fecha.localeCompare(a.fecha) || a.tecnico.localeCompare(b.tecnico, "es"));
    res.json({
      desde, hasta, ordenes,
      resumen: {
        total: ordenes.length,
        en_proceso: ordenes.filter((o) => o.estado === "en_proceso").length,
        parciales: ordenes.filter((o) => o.estado === "parcial").length,
        finalizadas: ordenes.filter((o) => o.estado === "finalizada").length,
      },
    });
  } catch (e) { err(res, e); }
});

router.get("/orden", async (req, res) => {
  const { sitio_id, fecha, clave } = req.query;
  if (!sitio_id || !fechaOk(fecha) || !clave) return err(res, new Error("sitio_id, fecha y clave son requeridos"), 400);
  if (!exigirSitioPermitido(req, res, sitio_id)) return;
  if (!(await hotelDelTecnico(req, res, sitio_id))) return;
  try {
    const [servicios, firmas, responsables] = await Promise.all([
      serviciosDe(sitio_id, fecha, fecha), firmasDe(sitio_id, fecha, fecha, true), responsablesDe(sitio_id),
    ]);
    const mios = servicios.filter((s) => claveDe(s) === clave);
    const deOrden = firmas.filter((f) => f.clave === clave);
    if (esTecnico(req) && mios.length) {
      const ids = await idsMios(req, fecha, fecha, sitio_id);
      if (!mios.some((s) => esMia(req, s, ids))) return err(res, new Error("Esa orden es de otro técnico"), 403);
    }
    if (!mios.length) return err(res, new Error("Esa orden no tiene servicios"), 404);
    const o = armarOrden(mios, deOrden);
    const imagenDe = new Map(deOrden.map((f) => [f.id, f.firma]));

    // Lo que falta firmar, por área
    const porArea = new Map();
    for (const s of o._pendientes) {
      const k = s.area_id || "sin_area";
      if (!porArea.has(k)) porArea.set(k, { area_id: s.area_id || null, area: s.area || "Sin área", inspecciones: [], lista: [] });
      const a = porArea.get(k);
      a.inspecciones.push(s.inspeccion_id); a.lista.push(s);
    }
    const areas = [...porArea.values()].map(({ lista, ...a }) => ({ ...a, puntos: puntosDistintos(lista) }))
      .sort((a, b) => a.area.localeCompare(b.area, "es"));
    // Grupos por responsable (opción 2), solo con lo que les queda por firmar
    const grupos = responsables.map((r) => {
      const suyas = areas.filter((a) => r.areas.includes(String(a.area_id)));
      return { id: r.id, cargo: r.cargo, areas: suyas.map((a) => a.area_id), nombres: suyas.map((a) => a.area),
        inspecciones: suyas.flatMap((a) => a.inspecciones), puntos: suyas.reduce((n, a) => n + a.puntos, 0) };
    }).filter((g) => g.inspecciones.length);

    res.json({
      ...sinInternos(o),
      firmas: o.firmas.map((f) => ({ ...f, imagen: imagenDe.get(f.id) || null })),
      firma: o.firmas.length ? { ...o.firmas[o.firmas.length - 1], imagen: imagenDe.get(o.firmas[o.firmas.length - 1].id) || null } : null,
      areas_pendientes: areas,
      grupos,
      servicios: mios.map((s) => ({
        inspeccion_id: s.inspeccion_id, hora: s.fecha, codigo: s.codigo_visible, punto: s.numero_habitacion ? `Habitación ${s.numero_habitacion}` : s.punto_nombre || s.codigo_visible,
        area_id: s.area_id, area: s.area, tipo: s.tipo_nombre, icono: s.tipo_icono, estado_punto: s.estado_punto, nivel_actividad: s.nivel_actividad,
        no_realizado: s.no_realizado, motivo: s.motivo_no_realizado, plagas: s.plagas_total, fotos: s.fotos_total, notas: s.notas,
        firma_id: o._cubre.get(String(s.inspeccion_id))?.id || null,
      })),
    });
  } catch (e) { err(res, e); }
});

// Las órdenes del técnico que pregunta en un día, de sus hoteles, para que
// escoja en cuál pide la firma (GET /firmas/mias?fecha=)
router.get("/mias", async (req, res) => {
  const fecha = fechaOk(req.query.fecha) ? req.query.fecha : hoyRD();
  try {
    let servicios = [];
    if (esOficina(req)) {
      // La oficina ve las órdenes de TODOS los técnicos de ese día
      servicios = await traerTodo(() => supabase.from("asa_v_servicios_dia").select(COLS).eq("fecha_local", fecha).order("fecha").order("inspeccion_id"));
    } else {
      // El técnico: lo que subió con su cuenta o con su ficha de empleado
      const ids = [...(await idsMios(req, fecha, fecha))];
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await supabase.from("asa_v_servicios_dia").select(COLS).in("inspeccion_id", ids.slice(i, i + 200));
        if (error) throw error;
        servicios.push(...(data || []));
      }
      if (!servicios.length && req.usuario.nombre) {
        servicios = await traerTodo(() => supabase.from("asa_v_servicios_dia").select(COLS).eq("fecha_local", fecha).eq("tecnico", req.usuario.nombre).order("fecha").order("inspeccion_id"));
      }
      // Toda la orden de ese técnico en ese hotel (aunque parte la haya subido otra cuenta)
      const claves = new Set(servicios.map((s) => `${s.sitio_id}|${claveDe(s)}`));
      const sitios = [...new Set(servicios.map((s) => s.sitio_id))];
      servicios = [];
      for (const sid of sitios) {
        servicios.push(...(await serviciosDe(sid, fecha, fecha)).filter((s) => claves.has(`${s.sitio_id}|${claveDe(s)}`)));
      }
    }
    if (req.sitiosPermitidos) servicios = servicios.filter((s) => req.sitiosPermitidos.includes(s.sitio_id));
    const asignados = await sitiosDelTecnico(req);
    if (asignados) servicios = servicios.filter((s) => asignados.map(String).includes(String(s.sitio_id)));
    const porOrden = new Map();
    for (const s of servicios) {
      const k = `${s.sitio_id}|${claveDe(s)}`;
      if (!porOrden.has(k)) porOrden.set(k, []);
      porOrden.get(k).push(s);
    }
    const firmasPorSitio = new Map();
    const ordenes = [];
    for (const lista of porOrden.values()) {
      const sid = lista[0].sitio_id;
      if (!firmasPorSitio.has(sid)) firmasPorSitio.set(sid, await firmasDe(sid, fecha, fecha));
      ordenes.push(sinInternos(armarOrden(lista, firmasPorSitio.get(sid).filter((f) => f.clave === claveDe(lista[0])))));
    }
    ordenes.sort((a, b) => String(a.planta).localeCompare(String(b.planta), "es") || a.tecnico.localeCompare(b.tecnico, "es"));
    res.json({ fecha, oficina: esOficina(req), ordenes });
  } catch (e) { err(res, e); }
});

// Firmar: todo lo pendiente (sin "inspecciones") o solo lo escogido
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
    if (esTecnico(req)) {
      const ids = await idsMios(req, fecha, fecha, sitio_id);
      if (!servicios.some((s) => esMia(req, s, ids))) return err(res, new Error("Solo puedes pedir la firma de tus propios servicios"), 403);
    }
    const firmas = (await firmasDe(sitio_id, fecha, fecha)).filter((f) => f.clave === clave);
    const o = armarOrden(servicios, firmas);
    if (!o._pendientes.length) return err(res, new Error("Esta orden ya está firmada completa"), 409);

    let cubrir = o._pendientes;
    if (Array.isArray(b.inspecciones) && b.inspecciones.length) {
      const pedidas = new Set(b.inspecciones.map(String));
      cubrir = o._pendientes.filter((s) => pedidas.has(String(s.inspeccion_id)));
      if (!cubrir.length) return err(res, new Error("Lo que escogiste ya estaba firmado"), 409);
    }
    const areasNombres = [...new Set(cubrir.map((s) => s.area || "Sin área"))];
    const parte = String(b.parte || "").trim().slice(0, 200)
      || (cubrir.length === o._pendientes.length && !firmas.length ? "Todo el servicio" : areasNombres.join(", ").slice(0, 200));
    const origen = ROLES_EXTERNOS.includes(req.usuario.rol) ? "portal" : esTecnico(req) ? "tecnico" : "panel";
    const fila = {
      sitio_id, fecha, clave, tecnico_nombre: servicios[0].tecnico || null,
      firmante_nombre: nombre.slice(0, 120), firmante_cargo: String(b.firmante_cargo || "").trim().slice(0, 120) || null,
      firma, comentario: String(b.comentario || "").trim().slice(0, 1000) || null, origen,
      firmado_por: req.usuario.id || null, firmado_por_nombre: req.usuario.persona || req.usuario.nombre || null,
      servicios: cubrir.length, inspecciones: cubrir.map((s) => s.inspeccion_id), parte,
    };
    const { data, error } = await supabase.from("asa_firmas_servicio").insert([fila]).select("id, created_at").single();
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) return err(res, new Error("Falta correr supabase/44_firmas_por_partes.sql en Supabase (aún no deja varias firmas por orden)."), 409);
      throw error;
    }
    const quedan = o._pendientes.length - cubrir.length;
    logAccion(req, { accion: "firmar_orden", modulo: "firmas", registroId: data.id, descripcion: `Firma de ${fila.firmante_nombre} (${parte})`, detalle: { sitio_id, fecha, tecnico: fila.tecnico_nombre, firmante: fila.firmante_nombre, servicios: cubrir.length, quedan } });
    res.status(201).json({ ok: true, id: data.id, estado: quedan ? "parcial" : "finalizada", puntos: puntosDistintos(cubrir), quedan_puntos: puntosDistintos(o._pendientes.filter((s) => !cubrir.includes(s))), parte });
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
