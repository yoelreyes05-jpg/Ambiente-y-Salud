// ═════════════════════════════════════════════════════════════════════════
// routes/rastreo.js — Dónde está cada técnico y por dónde pasó (39_rastreo…)
//
// La app del técnico manda su ubicación cada 30–60 s MIENTRAS ESTÁ ABIERTA (es
// una app web: con la pantalla apagada o la app cerrada el navegador no da el
// GPS). Solo se guarda dentro del horario de trabajo configurado.
//
//   GET  /rastreo/config        — horario y frecuencia (la app lo lee al abrir)
//   PUT  /rastreo/config        — cambiarlos (admin)
//   POST /rastreo/ubicaciones   — la app manda un lote de ubicaciones
//   POST /rastreo/estado        — el teléfono dice cómo está su GPS (permiso, error)
//   GET  /rastreo/en-vivo       — última ubicación de cada técnico hoy (panel)
//   GET  /rastreo/recorrido     — el recorrido de un técnico en un día (panel)
// ═════════════════════════════════════════════════════════════════════════

import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { logAccion } from "../lib/auditoria.js";
import { requireRol, ROLES_EXTERNOS } from "../middleware/auth.js";
import { traerTodo } from "../lib/paginar.js";

const router = express.Router();
const OFICINA = requireRol("operaciones");

const CONFIG_DEFECTO = {
  activo: true,
  desde: "06:00",          // hora de RD
  hasta: "03:00",          // si es menor que "desde", cruza la medianoche (profundas)
  intervalo_seg: 45,
  dias: [0, 1, 2, 3, 4, 5, 6], // 0 = domingo
};

const TZ = "America/Santo_Domingo";
const fechaRD = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const horaRD = (d = new Date()) => d.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const diaSemanaRD = (d = new Date()) => new Date(`${fechaRD(d)}T12:00:00Z`).getUTCDay();

async function leerConfig() {
  const { data } = await supabase.from("asa_config_sistema").select("valor").eq("clave", "rastreo").maybeSingle();
  return { ...CONFIG_DEFECTO, ...(data?.valor && typeof data.valor === "object" ? data.valor : {}) };
}

// ¿Esta hora cae en el horario de trabajo? "06:00"–"03:00" cruza la medianoche:
// lo de la madrugada cuenta como parte del turno que empezó el día antes.
export function enHorario(cfg, d = new Date()) {
  if (!cfg.activo) return false;
  const h = horaRD(d);
  const cruza = cfg.hasta < cfg.desde;
  const dentro = cruza ? h >= cfg.desde || h < cfg.hasta : h >= cfg.desde && h < cfg.hasta;
  if (!dentro) return false;
  // De madrugada manda el día en que empezó el turno
  const dia = cruza && h < cfg.hasta ? (diaSemanaRD(d) + 6) % 7 : diaSemanaRD(d);
  return !Array.isArray(cfg.dias) || cfg.dias.includes(dia);
}

// Distancia en metros entre dos puntos (haversine)
export function metros(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Hoteles con su centro y radio. Si la planta no tiene lat/lng, se usa el
// centro del plano georreferenciado. Se guarda 10 minutos en memoria.
let HOTELES = { t: 0, lista: [] };
async function hoteles() {
  if (Date.now() - HOTELES.t < 10 * 60 * 1000) return HOTELES.lista;
  const [sitios, planos] = await Promise.all([
    supabase.from("asa_sitios").select("*"),
    supabase.from("asa_planos").select("sitio_id, geo_norte, geo_sur, geo_este, geo_oeste").not("geo_norte", "is", null),
  ]);
  const centroPlano = new Map();
  for (const p of planos.data || []) {
    if (centroPlano.has(p.sitio_id)) continue;
    const c = { lat: (Number(p.geo_norte) + Number(p.geo_sur)) / 2, lng: (Number(p.geo_este) + Number(p.geo_oeste)) / 2 };
    // radio: media diagonal del plano, mínimo 250 m
    const r = Math.max(250, metros({ lat: Number(p.geo_norte), lng: Number(p.geo_oeste) }, { lat: Number(p.geo_sur), lng: Number(p.geo_este) }) / 2);
    centroPlano.set(p.sitio_id, { ...c, radio: r });
  }
  const lista = [];
  for (const s of sitios.data || []) {
    if (s.activo === false) continue;
    const plano = centroPlano.get(s.id);
    const lat = s.lat != null ? Number(s.lat) : plano?.lat;
    const lng = s.lng != null ? Number(s.lng) : plano?.lng;
    if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) continue;
    lista.push({ id: s.id, nombre: s.nombre, lat, lng, radio: Number(s.radio_m) || plano?.radio || 400 });
  }
  HOTELES = { t: Date.now(), lista };
  return lista;
}
function hotelEn(lista, p) {
  let mejor = null;
  for (const h of lista) {
    const d = metros(h, p);
    if (d <= h.radio && (!mejor || d < mejor.d)) mejor = { h, d };
  }
  return mejor?.h || null;
}

// ── Configuración ────────────────────────────────────────────────────────
router.get("/config", async (req, res) => {
  try {
    const cfg = await leerConfig();
    res.json({ ...cfg, en_horario: enHorario(cfg) });
  } catch (e) {
    res.status(500).json({ error: true, mensaje: e.message });
  }
});

router.put("/config", requireRol("admin"), async (req, res) => {
  const b = req.body || {};
  const hhmm = (v, def) => (/^\d{2}:\d{2}$/.test(v || "") ? v : def);
  const valor = {
    activo: b.activo !== false,
    desde: hhmm(b.desde, CONFIG_DEFECTO.desde),
    hasta: hhmm(b.hasta, CONFIG_DEFECTO.hasta),
    intervalo_seg: Math.max(15, Math.min(Number(b.intervalo_seg) || CONFIG_DEFECTO.intervalo_seg, 600)),
    dias: Array.isArray(b.dias) ? b.dias.map(Number).filter((d) => d >= 0 && d <= 6) : CONFIG_DEFECTO.dias,
  };
  const { error } = await supabase
    .from("asa_config_sistema")
    .upsert([{ clave: "rastreo", valor, updated_at: new Date().toISOString() }], { onConflict: "clave" });
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  logAccion(req, { accion: "actualizar", modulo: "configuracion", descripcion: "Horario de ubicación de técnicos", detalle: valor });
  res.json(valor);
});

// ── La app manda sus ubicaciones ─────────────────────────────────────────
// Body: { puntos: [{ lat, lng, precision, velocidad, rumbo, bateria, t }] }
// Llegan en lote: si no hubo señal un rato, la app las guardó y las manda juntas.
router.post("/ubicaciones", async (req, res) => {
  if (ROLES_EXTERNOS.includes(req.usuario?.rol)) {
    return res.status(403).json({ error: true, mensaje: "Solo el personal de ASA" });
  }
  const lote = Array.isArray(req.body?.puntos) ? req.body.puntos.slice(0, 500) : [];
  if (!lote.length) return res.json({ guardados: 0 });

  const cfg = await leerConfig();
  if (!cfg.activo) return res.json({ guardados: 0, motivo: "rastreo apagado" });
  const lista = await hoteles().catch(() => []);
  const ahora = Date.now();

  const filas = [];
  for (const p of lote) {
    const lat = Number(p?.lat), lng = Number(p?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const precision = p.precision != null ? Number(p.precision) : null;
    if (precision != null && precision > 1500) continue; // ubicación inservible
    let t = new Date(p.t || ahora);
    if (Number.isNaN(t.getTime()) || t.getTime() > ahora + 5 * 60000) t = new Date(ahora);
    if (ahora - t.getTime() > 3 * 86400000) continue;  // más de 3 días: no sirve
    if (!enHorario(cfg, t)) continue;                    // fuera del horario de trabajo
    const hotel = hotelEn(lista, { lat, lng });
    filas.push({
      usuario_id: req.usuario.id,
      empleado_id: req.usuario.empleado_id || null,
      lat, lng,
      precision_m: precision,
      velocidad: p.velocidad != null && Number.isFinite(Number(p.velocidad)) ? Number(p.velocidad) : null,
      rumbo: p.rumbo != null && Number.isFinite(Number(p.rumbo)) ? Number(p.rumbo) : null,
      bateria: p.bateria != null && Number.isFinite(Number(p.bateria)) ? Number(p.bateria) : null,
      sitio_id: hotel?.id || null,
      registrado_at: t.toISOString(),
      fecha_local: fechaRD(t),
    });
  }
  if (!filas.length) return res.json({ guardados: 0 });

  const { error } = await supabase.from("asa_ubicaciones").insert(filas);
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json({ guardados: filas.length });
});

// ── El teléfono dice cómo está su GPS ────────────────────────────────────
// Si el técnico bloquea la ubicación, la app no puede mandar nada y el panel
// solo vería "no ha abierto la app" aunque esté subiendo servicios. Con esto
// el panel dice por qué. Se guarda en memoria: la app lo repite cada 10 min
// mientras está abierta, así que tras reiniciar el servidor se rellena solo.
const ESTADO_GPS = new Map();
router.post("/estado", (req, res) => {
  if (ROLES_EXTERNOS.includes(req.usuario?.rol)) return res.status(403).json({ error: true, mensaje: "Solo el personal de ASA" });
  const b = req.body || {};
  const corto = (v, n) => (v == null ? null : String(v).slice(0, n));
  ESTADO_GPS.set(req.usuario.id, {
    permiso: ["granted", "denied", "prompt"].includes(b.permiso) ? b.permiso : null,
    error: [1, 2, 3].includes(Number(b.error)) ? Number(b.error) : b.error === "sin_gps" ? "sin_gps" : null,
    gps_ok: !!b.gps_ok,
    en_horario: b.en_horario !== false,
    cola: Number.isFinite(Number(b.cola)) ? Number(b.cola) : 0,
    version: corto(b.version, 20),
    plataforma: corto(b.plataforma, 160),
    at: new Date().toISOString(),
  });
  res.json({ ok: true });
});

// Por qué un técnico no tiene ubicación (lo que se muestra en el panel)
export function motivoSinGps(est, servicios) {
  if (est) {
    if (est.permiso === "denied" || est.error === 1) return "Bloqueó el permiso de ubicación en el teléfono";
    if (est.error === "sin_gps") return "Su navegador no da la ubicación";
    if (est.error === 2) return "El GPS del teléfono está apagado o no da la ubicación";
    if (est.error === 3) return "El GPS no encuentra señal";
    if (est.en_horario === false) return "Su teléfono tiene la hora fuera del horario de trabajo";
    if (est.cola > 0) return `Tiene ${est.cola} ubicación(es) guardadas en el teléfono sin enviar`;
    if (est.permiso === "prompt") return "No ha aceptado el permiso de ubicación";
    return "Su teléfono tiene el GPS activo pero todavía no llega ninguna ubicación";
  }
  return servicios > 0
    ? "Su teléfono no reporta el GPS: puede tener la ubicación bloqueada o la app sin actualizar (que la cierre y la vuelva a abrir con señal)"
    : null;
}

// ── Panel: dónde está cada técnico ahora ─────────────────────────────────
router.get("/en-vivo", OFICINA, async (req, res) => {
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(req.query.fecha || "") ? req.query.fecha : fechaRD();
  try {
    const [ubic, usuarios, insp, lista] = await Promise.all([
      traerTodo(() =>
        supabase.from("asa_ubicaciones")
          .select("usuario_id, lat, lng, precision_m, bateria, sitio_id, registrado_at")
          .eq("fecha_local", fecha)
          .order("registrado_at", { ascending: false })
          .order("id", { ascending: false })
      ),
      supabase.from("asa_usuarios").select("id, nombre_completo, rol, activo").eq("rol", "tecnico_plagas"),
      traerTodo(() =>
        supabase.from("asa_inspecciones").select("id, usuario_id, motivo_no_realizado, sitio_id, fecha, lat, lng, sincronizada_offline").eq("fecha_local", fecha).order("id")
      ),
      hoteles().catch(() => []),
    ]);

    const ultima = new Map();
    const puntosDia = new Map();
    for (const u of ubic) {
      if (!ultima.has(u.usuario_id)) ultima.set(u.usuario_id, u);
      puntosDia.set(u.usuario_id, (puntosDia.get(u.usuario_id) || 0) + 1);
    }
    const servicios = new Map();
    const ultimoServicio = new Map();
    for (const i of insp) {
      if (!i.usuario_id) continue;
      const s = servicios.get(i.usuario_id) || { hechos: 0, no_realizados: 0, sin_senal: 0 };
      i.motivo_no_realizado ? s.no_realizados++ : s.hechos++;
      if (i.sincronizada_offline) s.sin_senal++;
      servicios.set(i.usuario_id, s);
      const u = ultimoServicio.get(i.usuario_id);
      if (!u || String(i.fecha) > String(u.fecha)) ultimoServicio.set(i.usuario_id, i);
    }
    const nombreHotel = new Map(lista.map((h) => [h.id, h.nombre]));
    // Nombres de hoteles que no tienen coordenadas pero aparecen
    const faltan = [...new Set([...ubic.map((u) => u.sitio_id), ...[...ultimoServicio.values()].map((i) => i.sitio_id)]
      .filter((id) => id && !nombreHotel.has(id)))];
    if (faltan.length) {
      const { data } = await supabase.from("asa_sitios").select("id, nombre").in("id", faltan);
      for (const s of data || []) nombreHotel.set(s.id, s.nombre);
    }

    const ids = new Set([...(usuarios.data || []).filter((u) => u.activo !== false).map((u) => u.id), ...ultima.keys()]);
    const nombres = new Map((usuarios.data || []).map((u) => [u.id, u.nombre_completo]));
    const sinNombre = [...ids].filter((id) => !nombres.has(id));
    if (sinNombre.length) {
      const { data } = await supabase.from("asa_usuarios").select("id, nombre_completo").in("id", sinNombre);
      for (const u of data || []) nombres.set(u.id, u.nombre_completo);
    }

    const ahora = Date.now();
    const esHoy = fecha === fechaRD();
    const centroHotel = new Map(lista.map((h) => [h.id, h]));
    const tecnicos = [...ids].map((id) => {
      const u = ultima.get(id);
      const min = u ? Math.floor((ahora - new Date(u.registrado_at)) / 60000) : null;
      const sv = servicios.get(id) || { hechos: 0, no_realizados: 0, sin_senal: 0 };
      const total = sv.hechos + sv.no_realizados;
      const us = ultimoServicio.get(id);
      // Dónde fue su último servicio: la ubicación que guardó la app con el
      // servicio, o si no, el centro del hotel
      const lugar = us ? (us.lat != null && us.lng != null ? { lat: Number(us.lat), lng: Number(us.lng), aprox: false }
        : centroHotel.has(us.sitio_id) ? { lat: centroHotel.get(us.sitio_id).lat, lng: centroHotel.get(us.sitio_id).lng, aprox: true } : null) : null;
      const est = esHoy ? ESTADO_GPS.get(id) || null : null;
      return {
        ultimo_servicio: us ? { hora: us.fecha, hotel: nombreHotel.get(us.sitio_id) || null, ...(lugar || {}) } : null,
        gps: est,
        motivo_gps: !u && total ? (esHoy ? motivoSinGps(est, total) : "Ese día su teléfono no mandó ubicación") : null,
        usuario_id: id,
        nombre: nombres.get(id) || "Técnico",
        ultima: u ? { lat: u.lat, lng: u.lng, precision_m: u.precision_m, hora: u.registrado_at } : null,
        minutos: min,
        estado: !u ? (total ? "sin_gps" : "sin_datos") : !esHoy ? "dia_pasado" : min <= 3 ? "en_linea" : min <= 20 ? "reciente" : "sin_senal",
        bateria: u?.bateria ?? null,
        hotel: u?.sitio_id ? nombreHotel.get(u.sitio_id) || null : null,
        puntos_gps: puntosDia.get(id) || 0,
        servicios: sv,
      };
    }).sort((a, b) => (a.minutos ?? 1e9) - (b.minutos ?? 1e9)
      || (b.servicios.hechos + b.servicios.no_realizados) - (a.servicios.hechos + a.servicios.no_realizados)
      || a.nombre.localeCompare(b.nombre, "es"));

    res.json({ fecha, tecnicos, hoteles: lista });
  } catch (e) {
    res.status(500).json({ error: true, mensaje: e.message });
  }
});

// ── Panel: el recorrido de un técnico en el día ──────────────────────────
// Devuelve la línea del recorrido, los km, y las visitas a cada hotel con la
// hora de llegada, de salida y cuántos servicios hizo ahí.
router.get("/recorrido", OFICINA, async (req, res) => {
  const { usuario_id } = req.query;
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(req.query.fecha || "") ? req.query.fecha : fechaRD();
  if (!usuario_id) return res.status(400).json({ error: true, mensaje: "usuario_id es requerido" });
  try {
    const [puntos, insp, lista] = await Promise.all([
      traerTodo(() =>
        supabase.from("asa_ubicaciones")
          .select("id, lat, lng, precision_m, velocidad, bateria, sitio_id, registrado_at")
          .eq("usuario_id", usuario_id)
          .eq("fecha_local", fecha)
          .order("registrado_at", { ascending: true })
          .order("id")
      ),
      traerTodo(() =>
        supabase.from("asa_inspecciones")
          .select("id, fecha, sitio_id, motivo_no_realizado, asa_puntos_control(codigo_visible, numero_habitacion)")
          .eq("usuario_id", usuario_id)
          .eq("fecha_local", fecha)
          .order("fecha", { ascending: true })
          .order("id")
      ),
      hoteles().catch(() => []),
    ]);

    // Se descartan los saltos imposibles del GPS (más de 150 km/h entre dos
    // lecturas o lecturas muy imprecisas) para que la línea no haga zigzag.
    const limpios = [];
    for (const p of puntos) {
      if (p.precision_m != null && p.precision_m > 150) continue;
      const prev = limpios[limpios.length - 1];
      if (prev) {
        const seg = (new Date(p.registrado_at) - new Date(prev.registrado_at)) / 1000;
        if (seg > 0 && metros(prev, p) / seg > 42) continue;
      }
      limpios.push(p);
    }
    let km = 0;
    for (let i = 1; i < limpios.length; i++) km += metros(limpios[i - 1], limpios[i]) / 1000;

    // Visitas: tramos seguidos dentro del mismo hotel (se perdonan huecos de
    // hasta 20 minutos, que es cuando el técnico está en un sótano sin señal).
    const nombreHotel = new Map(lista.map((h) => [h.id, h.nombre]));
    const visitas = [];
    for (const p of puntos) {
      if (!p.sitio_id) continue;
      const v = visitas[visitas.length - 1];
      if (v && v.sitio_id === p.sitio_id && new Date(p.registrado_at) - new Date(v.salida) <= 20 * 60000) {
        v.salida = p.registrado_at;
      } else {
        visitas.push({ sitio_id: p.sitio_id, hotel: nombreHotel.get(p.sitio_id) || "Hotel", llegada: p.registrado_at, salida: p.registrado_at });
      }
    }
    for (const v of visitas) {
      v.minutos = Math.round((new Date(v.salida) - new Date(v.llegada)) / 60000);
      const dentro = insp.filter((i) => i.sitio_id === v.sitio_id && i.fecha >= v.llegada && i.fecha <= new Date(new Date(v.salida).getTime() + 10 * 60000).toISOString());
      v.servicios = dentro.filter((i) => !i.motivo_no_realizado).length;
      v.no_realizados = dentro.filter((i) => i.motivo_no_realizado).length;
    }

    res.json({
      fecha,
      usuario_id,
      puntos: limpios.map((p) => ({ lat: p.lat, lng: p.lng, hora: p.registrado_at })),
      km: Math.round(km * 10) / 10,
      primera: puntos[0]?.registrado_at || null,
      ultima: puntos[puntos.length - 1]?.registrado_at || null,
      bateria: puntos[puntos.length - 1]?.bateria ?? null,
      visitas: visitas.filter((v) => v.minutos >= 2 || v.servicios),
      servicios: insp.map((i) => ({
        hora: i.fecha,
        sitio_id: i.sitio_id,
        punto: i.asa_puntos_control?.numero_habitacion ? `Hab. ${i.asa_puntos_control.numero_habitacion}` : i.asa_puntos_control?.codigo_visible || "",
        no_realizado: !!i.motivo_no_realizado,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: true, mensaje: e.message });
  }
});

// ── Panel: fijar dónde queda un hotel (tocando el mapa) ──────────────────
router.put("/hoteles/:id", OFICINA, async (req, res) => {
  const lat = Number(req.body?.lat), lng = Number(req.body?.lng);
  const radio = Math.max(50, Math.min(Number(req.body?.radio_m) || 400, 5000));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: true, mensaje: "Ubicación no válida" });
  const { error } = await supabase.from("asa_sitios").update({ lat, lng, radio_m: radio }).eq("id", req.params.id);
  if (error) {
    const falta = /lat|lng|radio_m|column/i.test(error.message);
    return res.status(500).json({ error: true, mensaje: falta ? "Falta correr supabase/39_rastreo_tecnicos.sql en Supabase." : error.message });
  }
  HOTELES = { t: 0, lista: [] }; // que se recalcule con la nueva ubicación
  logAccion(req, { accion: "actualizar", modulo: "sitios", registroId: req.params.id, descripcion: "Ubicación del hotel en el mapa", detalle: { lat, lng, radio } });
  res.json({ ok: true, lat, lng, radio_m: radio });
});

export default router;
