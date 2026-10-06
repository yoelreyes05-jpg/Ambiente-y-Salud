// routes/incidencias.js — Chinche / código rosa: verificación, protocolo y certificado
//
// Cuando el hotel reporta chinche (o código rosa) en una habitación se abre una
// incidencia. El caso pasa por:
//
//   1. Verificaciones  — checklist que se marca una por una (quién y cuándo).
//                        No se puede dar un resultado con verificaciones sin
//                        hacer: es lo que sostiene el certificado.
//   2. Resultado       — ¿hay chinche?
//        sí → se marcan las condiciones encontradas y el nivel, y el sistema
//             arma el protocolo (directrices con su fecha) a partir de la
//             plantilla. El protocolo se puede ajustar: agregar, quitar,
//             cambiar fechas y textos. Estado: en_tratamiento.
//             Al terminar el protocolo se hace la verificación final; si sale
//             negativa la habitación se libera (estado: cerrada).
//        no → estado: negativa.
//   3. Certificado     — solo con resultado negativo (negativa o cerrada), en
//                        español, en inglés o los dos.
//
// La plantilla (verificaciones, condiciones, directrices por nivel y datos de
// quien firma el certificado) vive en asa_config_sistema, clave
// 'protocolo_chinche', y se edita desde el panel.
//
// Quién hace qué:
//   oficina (admin/operaciones/comercial) — todo
//   técnico                               — verificaciones, resultado, marcar pasos
//   hotel (cliente_calidad)               — ver y descargar el certificado
import express from "express";
import crypto from "crypto";
import { supabase } from "../lib/supabaseClient.js";
import { logAccion } from "../lib/auditoria.js";
import { exigirSitioPermitido, filtrarPorSitio, puedeVerSitio, requireRol } from "../middleware/auth.js";
import { construirCertificado, CERTIFICADO_DEFECTO } from "../lib/certificadoPdf.js";

const router = express.Router();
const ESCRIBEN = requireRol("tecnico_plagas", "operaciones", "comercial");
const OFICINA = requireRol("operaciones", "comercial");

const id8 = () => crypto.randomUUID().slice(0, 8);
const ahora = () => new Date().toISOString();
const hoyRD = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
const sumarDias = (fecha, n) => {
  const d = new Date(fecha + "T12:00:00");
  d.setDate(d.getDate() + Number(n || 0));
  return d.toISOString().slice(0, 10);
};
const error500 = (res, e) => res.status(500).json({ error: true, mensaje: e.message || String(e) });

// ── Plantilla del protocolo ──────────────────────────────────────────────────
export const PROTOCOLO_DEFECTO = {
  verificaciones: [
    "Colchón: costuras, ribetes, etiquetas y esquinas",
    "Base / box spring y patas de la cama",
    "Cabecero (desmontado) y marco de la cama",
    "Mesas de noche, gavetas y muebles junto a la cama",
    "Zócalos, rodapiés, enchufes y marcos de cuadros",
    "Cortinas, sofá, sillas tapizadas y alfombra",
    "Closet, maletero y equipaje",
    "Lencería: sábanas, fundas y protector de colchón",
  ],
  condiciones: [
    { codigo: "vivas", texto: "Chinches vivas (adultos o ninfas)", peso: 2 },
    { codigo: "huevos", texto: "Huevos o mudas (exuvias)", peso: 2 },
    { codigo: "manchas", texto: "Manchas fecales o de sangre en colchón / lencería", peso: 1 },
    { codigo: "picaduras", texto: "Huésped con picaduras", peso: 1 },
    { codigo: "mobiliario", texto: "Presencia en muebles fuera de la cama", peso: 3 },
    { codigo: "adyacentes", texto: "Hallazgo en habitaciones vecinas (lados, arriba, abajo)", peso: 3 },
  ],
  // `dia` = días desde el resultado positivo. `niveles` vacío = aplica a todos.
  directrices: [
    { texto: "Bloquear la habitación (fuera de venta) hasta la liberación", dia: 0, niveles: [] },
    { texto: "Retirar lencería y cortinas en bolsas selladas; lavar y secar a 60 °C o más", dia: 0, niveles: [] },
    { texto: "Aspirado profundo de colchón, base, cabecero y zócalos; desechar la bolsa sellada", dia: 0, niveles: [] },
    { texto: "Tratamiento con vapor y producto residual en cama, muebles y zócalos", dia: 0, niveles: [] },
    { texto: "Inspeccionar las habitaciones vecinas (lados, arriba y abajo)", dia: 0, niveles: [] },
    { texto: "Encapsular colchón y base", dia: 0, niveles: ["moderado", "severo"] },
    { texto: "Retirar o tratar aparte los muebles tapizados afectados", dia: 0, niveles: ["severo"] },
    { texto: "Segundo tratamiento", dia: 7, niveles: [] },
    { texto: "Tercer tratamiento", dia: 14, niveles: ["severo"] },
    { texto: "Inspección de seguimiento", dia: 14, niveles: [] },
    { texto: "Verificación final y liberación de la habitación", dia: 21, niveles: [] },
  ],
  certificado: { ...CERTIFICADO_DEFECTO },
};

function normalizarProtocolo(v) {
  const p = v && typeof v === "object" ? v : {};
  const txt = (x, n = 300) => String(x ?? "").trim().slice(0, n);
  const verificaciones = (Array.isArray(p.verificaciones) ? p.verificaciones : PROTOCOLO_DEFECTO.verificaciones)
    .map((x) => txt(typeof x === "string" ? x : x?.texto))
    .filter(Boolean);
  const vistos = new Set();
  const condiciones = (Array.isArray(p.condiciones) ? p.condiciones : PROTOCOLO_DEFECTO.condiciones)
    .map((c) => {
      const texto = txt(c?.texto);
      let codigo = txt(c?.codigo || texto, 40).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      if (!codigo) return null;
      while (vistos.has(codigo)) codigo += "_";
      vistos.add(codigo);
      return { codigo, texto, peso: Math.max(0, Math.min(3, Number(c?.peso) || 1)) };
    })
    .filter((c) => c && c.texto);
  const NIV = ["leve", "moderado", "severo"];
  const directrices = (Array.isArray(p.directrices) ? p.directrices : PROTOCOLO_DEFECTO.directrices)
    .map((d) => ({
      texto: txt(d?.texto),
      dia: Math.max(0, Math.min(365, Math.round(Number(d?.dia) || 0))),
      niveles: (Array.isArray(d?.niveles) ? d.niveles : []).filter((n) => NIV.includes(n)),
    }))
    .filter((d) => d.texto)
    .sort((a, b) => a.dia - b.dia);
  const c = p.certificado && typeof p.certificado === "object" ? p.certificado : {};
  const certificado = Object.fromEntries(
    Object.keys(CERTIFICADO_DEFECTO).map((k) => [k, txt(c[k], 120) || CERTIFICADO_DEFECTO[k]])
  );
  return { verificaciones, condiciones, directrices, certificado };
}

export async function leerProtocolo() {
  const { data } = await supabase.from("asa_config_sistema").select("valor").eq("clave", "protocolo_chinche").maybeSingle();
  return normalizarProtocolo(data?.valor || PROTOCOLO_DEFECTO);
}

// Nivel sugerido según las condiciones marcadas: suma de pesos.
function nivelSugerido(codigos, plantilla) {
  const peso = plantilla.condiciones.filter((c) => codigos.includes(c.codigo)).reduce((s, c) => s + c.peso, 0);
  return peso >= 5 ? "severo" : peso >= 2 ? "moderado" : "leve";
}

function armarProtocolo(plantilla, nivel, desde) {
  return plantilla.directrices
    .filter((d) => !d.niveles.length || d.niveles.includes(nivel))
    .map((d) => ({ id: id8(), texto: d.texto, dia: d.dia, fecha: sumarDias(desde, d.dia), hecho: false, nota: "", por: null, at: null }));
}

async function bitacora(incidenciaId, req, accion, detalle = null) {
  await supabase.from("asa_incidencias_log").insert([{
    incidencia_id: incidenciaId,
    usuario_nombre: req.usuario?.nombre || "Sistema",
    accion,
    detalle,
  }]);
}

async function cargar(req, res, id) {
  const { data, error } = await supabase
    .from("asa_incidencias")
    .select("*, asa_sitios(nombre), asa_ordenes_trabajo(numero_orden)")
    .eq("id", id)
    .maybeSingle();
  if (error) { error500(res, error); return null; }
  if (!data) { res.status(404).json({ error: true, mensaje: "Incidencia no encontrada" }); return null; }
  if (!puedeVerSitio(req, data.sitio_id)) { res.status(403).json({ error: true, mensaje: "No tienes acceso a este hotel" }); return null; }
  return data;
}

const forma = (i) => ({
  ...i,
  planta: i.asa_sitios?.nombre || null,
  numero_orden: i.asa_ordenes_trabajo?.numero_orden || null,
  asa_sitios: undefined,
  asa_ordenes_trabajo: undefined,
  verificaciones_hechas: (i.verificaciones || []).filter((v) => v.hecho).length,
  verificaciones_total: (i.verificaciones || []).length,
  protocolo_hechos: (i.protocolo || []).filter((p) => p.hecho).length,
  protocolo_total: (i.protocolo || []).length,
  puede_certificar: ["negativa", "cerrada"].includes(i.estado),
});

// Crea la incidencia. La usa la ruta POST y también solicitudes.js cuando el
// hotel reporta "Chinches" o "Código rosa" con número de habitación.
export async function crearIncidencia(req, { sitio_id, numero_habitacion, tipo = "chinche", reportado_por, dirigido_a, descripcion, orden_id, hotel_nombre }) {
  const hab = String(numero_habitacion || "").trim();
  if (!sitio_id || !hab) throw Object.assign(new Error("Planta y número de habitación son requeridos"), { status: 400 });
  const plantilla = await leerProtocolo();

  const { data: punto } = await supabase
    .from("asa_puntos_control")
    .select("id")
    .eq("sitio_id", sitio_id)
    .eq("activo", true)
    .eq("numero_habitacion", hab)
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("asa_incidencias")
    .insert([{
      sitio_id,
      punto_id: punto?.id || null,
      numero_habitacion: hab,
      tipo: tipo === "codigo_rosa" ? "codigo_rosa" : "chinche",
      orden_id: orden_id || null,
      reportado_por: reportado_por || null,
      dirigido_a: dirigido_a || null,
      hotel_nombre: hotel_nombre || null,
      descripcion: descripcion || null,
      verificaciones: plantilla.verificaciones.map((texto) => ({ id: id8(), texto, hecho: false, nota: "", por: null, at: null })),
      creado_por: req.usuario?.nombre || null,
    }])
    .select("*, asa_sitios(nombre), asa_ordenes_trabajo(numero_orden)")
    .single();
  if (error) throw error;
  await bitacora(data.id, req, "Incidencia abierta", `${data.tipo === "codigo_rosa" ? "Código rosa" : "Chinche"} · habitación ${hab}`);
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plantilla
// ─────────────────────────────────────────────────────────────────────────────
router.get("/protocolo", async (req, res) => {
  try { res.json(await leerProtocolo()); } catch (e) { error500(res, e); }
});

router.put("/protocolo", OFICINA, async (req, res) => {
  try {
    const valor = normalizarProtocolo(req.body);
    if (!valor.verificaciones.length) return res.status(400).json({ error: true, mensaje: "Deja al menos una verificación." });
    if (!valor.directrices.length) return res.status(400).json({ error: true, mensaje: "Deja al menos una directriz." });
    const { error } = await supabase.from("asa_config_sistema").upsert([{ clave: "protocolo_chinche", valor, updated_at: ahora() }], { onConflict: "clave" });
    if (error) throw error;
    logAccion(req, { accion: "actualizar", modulo: "incidencias", descripcion: "Plantilla del protocolo de chinche actualizada" });
    res.json(valor);
  } catch (e) { error500(res, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /incidencias?sitio_id=&estado=abiertas|cerradas|todas
// ─────────────────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const { sitio_id, estado = "todas" } = req.query;
  if (sitio_id && !exigirSitioPermitido(req, res, sitio_id)) return;
  let q = supabase
    .from("asa_incidencias")
    .select("*, asa_sitios(nombre), asa_ordenes_trabajo(numero_orden)")
    .order("fecha_reporte", { ascending: false })
    .limit(500);
  q = sitio_id ? q.eq("sitio_id", sitio_id) : filtrarPorSitio(q, req);
  if (estado === "abiertas") q = q.in("estado", ["abierta", "en_tratamiento"]);
  if (estado === "cerradas") q = q.in("estado", ["negativa", "cerrada", "cancelada"]);
  const { data, error } = await q;
  if (error) return error500(res, error);
  res.json((data || []).map(forma));
});

router.get("/:id", async (req, res) => {
  const i = await cargar(req, res, req.params.id);
  if (!i) return;
  const { data: log } = await supabase
    .from("asa_incidencias_log")
    .select("*")
    .eq("incidencia_id", i.id)
    .order("created_at", { ascending: true });
  res.json({ ...forma(i), log: log || [] });
});

router.post("/", OFICINA, async (req, res) => {
  const b = req.body || {};
  if (b.sitio_id && !exigirSitioPermitido(req, res, b.sitio_id)) return;
  try {
    const i = await crearIncidencia(req, b);
    logAccion(req, { accion: "crear", modulo: "incidencias", registroId: i.id, descripcion: `${i.numero} · habitación ${i.numero_habitacion}` });
    res.status(201).json(forma(i));
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: true, mensaje: e.message });
    error500(res, e);
  }
});

// PATCH /incidencias/:id — datos generales, verificaciones y pasos del protocolo.
//
// Las verificaciones y los pasos llegan como lista completa; el servidor pone
// quién y cuándo en lo que cambió a hecho, para que no lo invente el cliente.
router.patch("/:id", ESCRIBEN, async (req, res) => {
  const i = await cargar(req, res, req.params.id);
  if (!i) return;
  if (["cancelada"].includes(i.estado)) return res.status(409).json({ error: true, mensaje: "La incidencia está cancelada." });
  const b = req.body || {};
  const cambios = { updated_at: ahora() };
  const notas = [];
  const esTecnico = req.usuario?.rol === "tecnico_plagas";

  if (!esTecnico) {
    for (const k of ["dirigido_a", "hotel_nombre", "reportado_por", "descripcion", "notas", "numero_habitacion"]) {
      if (k in b) cambios[k] = String(b[k] ?? "").trim() || (k === "numero_habitacion" ? i.numero_habitacion : null);
    }
    if (b.tipo && ["chinche", "codigo_rosa"].includes(b.tipo)) cambios.tipo = b.tipo;
    if (b.nivel && ["leve", "moderado", "severo"].includes(b.nivel)) cambios.nivel = b.nivel;
    if (Array.isArray(b.condiciones)) cambios.condiciones = b.condiciones.map(String).slice(0, 40);
  } else if (typeof b.notas === "string") {
    cambios.notas = b.notas.trim() || null;
  }

  const marcar = (anterior, nueva, limpiarTexto) => {
    const previo = new Map((anterior || []).map((x) => [x.id, x]));
    return nueva.slice(0, 80).map((x) => {
      const viejo = previo.get(x.id) || {};
      const hecho = !!x.hecho;
      const out = {
        id: x.id || id8(),
        texto: limpiarTexto ? String(x.texto || "").trim().slice(0, 300) : viejo.texto ?? String(x.texto || "").trim().slice(0, 300),
        hecho,
        nota: String(x.nota ?? "").slice(0, 500),
        por: hecho ? (viejo.hecho ? viejo.por : req.usuario?.nombre || null) : null,
        at: hecho ? (viejo.hecho ? viejo.at : ahora()) : null,
      };
      if ("dia" in x || "fecha" in viejo || "fecha" in x) {
        out.dia = Number.isFinite(Number(x.dia)) ? Number(x.dia) : viejo.dia ?? 0;
        out.fecha = /^\d{4}-\d{2}-\d{2}$/.test(x.fecha || "") ? x.fecha : viejo.fecha || null;
      }
      if (hecho && !viejo.hecho) notas.push(`✔ ${out.texto}`);
      if (!hecho && viejo.hecho) notas.push(`✖ desmarcado: ${out.texto}`);
      return out;
    }).filter((x) => x.texto);
  };

  if (Array.isArray(b.verificaciones)) {
    // El técnico marca, pero no reescribe el texto de la plantilla.
    cambios.verificaciones = marcar(i.verificaciones, b.verificaciones, !esTecnico);
  }
  if (Array.isArray(b.protocolo)) {
    cambios.protocolo = marcar(i.protocolo, b.protocolo, !esTecnico);
    if (!esTecnico && b.protocolo.length !== (i.protocolo || []).length) notas.push("Directrices del protocolo ajustadas");
  }

  const { data, error } = await supabase
    .from("asa_incidencias")
    .update(cambios)
    .eq("id", i.id)
    .select("*, asa_sitios(nombre), asa_ordenes_trabajo(numero_orden)")
    .single();
  if (error) return error500(res, error);
  if (notas.length) await bitacora(i.id, req, "Actualización", notas.join(" · ").slice(0, 1000));
  res.json(forma(data));
});

// POST /incidencias/:id/resultado { resultado: 'positivo'|'negativo', condiciones?, nivel? }
router.post("/:id/resultado", ESCRIBEN, async (req, res) => {
  const i = await cargar(req, res, req.params.id);
  if (!i) return;
  const { resultado } = req.body || {};
  if (!["positivo", "negativo"].includes(resultado)) return res.status(400).json({ error: true, mensaje: "Indica si se encontró chinche (positivo) o no (negativo)." });
  if (["cerrada", "cancelada"].includes(i.estado)) return res.status(409).json({ error: true, mensaje: "La incidencia ya está cerrada." });

  const faltan = (i.verificaciones || []).filter((v) => !v.hecho);
  if (faltan.length) {
    return res.status(400).json({
      error: true,
      mensaje: `Faltan ${faltan.length} verificación(es) por hacer antes de dar el resultado: ${faltan.map((v) => v.texto).join("; ")}.`,
    });
  }

  const plantilla = await leerProtocolo();
  const cambios = { resultado, fecha_verificacion: ahora(), verificado_por: req.usuario?.nombre || null, updated_at: ahora() };
  let detalle;

  if (resultado === "positivo") {
    const condiciones = (Array.isArray(req.body.condiciones) ? req.body.condiciones : i.condiciones || []).map(String);
    if (!condiciones.length) return res.status(400).json({ error: true, mensaje: "Marca al menos una condición encontrada." });
    const nivel = ["leve", "moderado", "severo"].includes(req.body.nivel) ? req.body.nivel : nivelSugerido(condiciones, plantilla);
    cambios.condiciones = condiciones;
    cambios.nivel = nivel;
    cambios.estado = "en_tratamiento";
    // El protocolo se arma una sola vez; si ya existía (segunda verificación
    // positiva) se conserva lo hecho y se agregan los pasos que falten.
    const nuevo = armarProtocolo(plantilla, nivel, hoyRD());
    if ((i.protocolo || []).length) {
      const textos = new Set(i.protocolo.map((p) => p.texto));
      cambios.protocolo = [...i.protocolo, ...nuevo.filter((p) => !textos.has(p.texto))];
    } else {
      cambios.protocolo = nuevo;
    }
    const nombres = plantilla.condiciones.filter((c) => condiciones.includes(c.codigo)).map((c) => c.texto);
    detalle = `POSITIVO · nivel ${nivel} · ${nombres.join(", ")}`;
  } else {
    // Negativo. Si venía de tratamiento, es la verificación final: tienen que
    // estar hechos los pasos del protocolo para liberar la habitación.
    if (i.estado === "en_tratamiento") {
      const pendientes = (i.protocolo || []).filter((p) => !p.hecho && !/verificaci[oó]n final|liberaci[oó]n/i.test(p.texto));
      if (pendientes.length && !req.body.forzar) {
        return res.status(400).json({
          error: true,
          pendientes: pendientes.length,
          mensaje: `Quedan ${pendientes.length} paso(s) del protocolo sin marcar como hechos: ${pendientes.map((p) => p.texto).join("; ")}.`,
        });
      }
      cambios.estado = "cerrada";
      cambios.fecha_cierre = ahora();
      cambios.protocolo = (i.protocolo || []).map((p) =>
        !p.hecho && /verificaci[oó]n final|liberaci[oó]n/i.test(p.texto) ? { ...p, hecho: true, por: req.usuario?.nombre || null, at: ahora() } : p
      );
      detalle = "NEGATIVO en verificación final · habitación liberada";
    } else {
      cambios.estado = "negativa";
      cambios.fecha_cierre = ahora();
      detalle = "NEGATIVO · no se encontró chinche";
    }
  }

  const { data, error } = await supabase
    .from("asa_incidencias")
    .update(cambios)
    .eq("id", i.id)
    .select("*, asa_sitios(nombre), asa_ordenes_trabajo(numero_orden)")
    .single();
  if (error) return error500(res, error);
  await bitacora(i.id, req, "Resultado", detalle);

  // Negativo = el trabajo de la orden del hotel quedó hecho: la orden pasa a
  // completada (ejecutada) y el hotel ya puede bajar el certificado desde
  // Solicitudes. Positivo: la orden sigue abierta mientras dura el tratamiento.
  if (["negativa", "cerrada"].includes(data.estado) && i.orden_id) {
    const { data: orden } = await supabase.from("asa_ordenes_trabajo").select("id, estado").eq("id", i.orden_id).maybeSingle();
    if (orden && ["solicitada", "agendada", "en_ruta", "en_sitio"].includes(orden.estado)) {
      await supabase.from("asa_ordenes_trabajo")
        .update({ estado: "ejecutada", fecha_ejecucion: ahora(), updated_at: ahora() })
        .eq("id", orden.id);
      await supabase.from("asa_ordenes_trabajo_log").insert([{
        orden_id: orden.id,
        estado_anterior: orden.estado,
        estado_nuevo: "ejecutada",
        usuario_id: req.usuario?.id || null,
        usuario_nombre: req.usuario?.nombre || "Sistema",
        motivo: `Verificación de chinche negativa (${i.numero}): certificado disponible`,
      }]);
    }
  } else if (data.estado === "en_tratamiento" && i.orden_id) {
    const { data: orden } = await supabase.from("asa_ordenes_trabajo").select("id, estado").eq("id", i.orden_id).maybeSingle();
    if (orden && ["solicitada", "agendada", "en_ruta"].includes(orden.estado)) {
      await supabase.from("asa_ordenes_trabajo").update({ estado: "en_sitio", updated_at: ahora() }).eq("id", orden.id);
      await supabase.from("asa_ordenes_trabajo_log").insert([{
        orden_id: orden.id, estado_anterior: orden.estado, estado_nuevo: "en_sitio",
        usuario_id: req.usuario?.id || null, usuario_nombre: req.usuario?.nombre || "Sistema",
        motivo: `Chinche confirmada (${i.numero}): habitación en tratamiento`,
      }]);
    }
  }
  logAccion(req, { accion: "actualizar", modulo: "incidencias", registroId: i.id, descripcion: `${i.numero} · ${detalle}` });
  res.json(forma(data));
});

// POST /incidencias/:id/nueva-verificacion — vuelve a abrir el checklist (para
// la verificación final después del tratamiento).
router.post("/:id/nueva-verificacion", ESCRIBEN, async (req, res) => {
  const i = await cargar(req, res, req.params.id);
  if (!i) return;
  if (i.estado !== "en_tratamiento") return res.status(409).json({ error: true, mensaje: "Solo se repite la verificación durante el tratamiento." });
  const plantilla = await leerProtocolo();
  const { data, error } = await supabase
    .from("asa_incidencias")
    .update({
      verificaciones: plantilla.verificaciones.map((texto) => ({ id: id8(), texto, hecho: false, nota: "", por: null, at: null })),
      updated_at: ahora(),
    })
    .eq("id", i.id)
    .select("*, asa_sitios(nombre), asa_ordenes_trabajo(numero_orden)")
    .single();
  if (error) return error500(res, error);
  await bitacora(i.id, req, "Nueva verificación", "Checklist reiniciado para la verificación final");
  res.json(forma(data));
});

router.post("/:id/cancelar", OFICINA, async (req, res) => {
  const i = await cargar(req, res, req.params.id);
  if (!i) return;
  const { data, error } = await supabase
    .from("asa_incidencias")
    .update({ estado: "cancelada", updated_at: ahora(), notas: [i.notas, req.body?.motivo ? `Cancelada: ${req.body.motivo}` : null].filter(Boolean).join("\n") || null })
    .eq("id", i.id)
    .select("*, asa_sitios(nombre), asa_ordenes_trabajo(numero_orden)")
    .single();
  if (error) return error500(res, error);
  await bitacora(i.id, req, "Cancelada", req.body?.motivo || null);
  res.json(forma(data));
});

router.delete("/:id", requireRol("admin"), async (req, res) => {
  const i = await cargar(req, res, req.params.id);
  if (!i) return;
  const { error } = await supabase.from("asa_incidencias").delete().eq("id", i.id);
  if (error) return error500(res, error);
  logAccion(req, { accion: "eliminar", modulo: "incidencias", registroId: i.id, descripcion: `${i.numero} · habitación ${i.numero_habitacion}` });
  res.json({ ok: true });
});

// GET /incidencias/:id/certificado?idioma=es|en|ambos&fecha=YYYY-MM-DD
router.get("/:id/certificado", async (req, res) => {
  const i = await cargar(req, res, req.params.id);
  if (!i) return;
  if (!["negativa", "cerrada"].includes(i.estado)) {
    return res.status(409).json({ error: true, mensaje: "El certificado solo se emite cuando la verificación da negativo (no hay chinche)." });
  }
  try {
    const plantilla = await leerProtocolo();
    const idioma = ["es", "en", "ambos"].includes(req.query.idioma) ? req.query.idioma : "es";
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(req.query.fecha || "") ? req.query.fecha : i.fecha_cierre || i.fecha_verificacion || ahora();
    const pdf = await construirCertificado({
      habitacion: i.numero_habitacion,
      hotel: i.hotel_nombre || i.asa_sitios?.nombre || "",
      dirigido_a: i.dirigido_a || "",
      fecha,
      tipo: i.tipo,
      firma: plantilla.certificado,
    }, idioma);

    if (!i.certificado_at) {
      await supabase.from("asa_incidencias").update({ certificado_at: ahora() }).eq("id", i.id);
      await bitacora(i.id, req, "Certificado emitido", idioma === "ambos" ? "Español e inglés" : idioma === "en" ? "Inglés" : "Español");
    }
    const sufijo = idioma === "ambos" ? "es-en" : idioma;
    const nombre = `Certificado-${(i.hotel_nombre || i.asa_sitios?.nombre || "hotel").replace(/[^\w]+/g, "-")}-hab-${String(i.numero_habitacion).replace(/[^\w]+/g, "")}-${sufijo}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${nombre}"`);
    res.send(pdf);
  } catch (e) {
    error500(res, e);
  }
});

export default router;
