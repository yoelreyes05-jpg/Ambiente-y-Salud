// routes/flota.js — Flota y transportación de ASA
// ─────────────────────────────────────────────────────────────────────────────
// Traído del CRM del taller (donde vivía como routes/asa.mjs). Cambios al
// portarlo a este backend, y ninguno más:
//
//   · usa el cliente Supabase compartido de lib/supabaseClient.js
//   · la configuración vive en `asa_config_sistema` (aquí todo lleva prefijo)
//   · las rutas del conductor van en un router aparte (`publico`), porque este
//     backend sí exige token para todo lo demás
//   · las acciones del encargado quedan en la bitácora de auditoría
//
// MÓDULO DE FLOTA — Control de vehículos y transportación
//
// Dos públicos muy distintos comparten estas rutas:
//
//   EL CONDUCTOR   Abre /asa/chequeo en el celular, sin cuenta ni contraseña,
//                  y llena el parte del día a puros toques. Todo lo que usa
//                  esa pantalla vive bajo /asa/publico/*.
//
//   EL ENCARGADO   Entra al CRM y ve la flota: quién reportó, qué falla está
//                  abierta, cuánto lleva gastado cada unidad y cuál se está
//                  volviendo cara por kilómetro.
//
// La separación importa: si la pantalla del conductor exigiera login, o se
// pierde tiempo cada mañana, o alguien deja abierta la sesión del encargado
// en un celular que anda en la calle. Lo público solo puede leer catálogos y
// escribir su propio parte — no ve gastos ni puede borrar nada.
//
// Requiere: supabase/26_flota_transportacion.sql
//
// Montaje en server.mjs:
//     import flotaRouter, { publico as flotaPublico } from "./routes/flota.js";
//     app.use("/flota", flotaPublico);   // ANTES de requireAuth
//     app.use("/flota", flotaRouter);    // despues
// ─────────────────────────────────────────────────────────────────────────────

import express from "express";
import ExcelJS from "exceljs";
import { supabase } from "../lib/supabaseClient.js";
import { logAccion } from "../lib/auditoria.js";

const router = express.Router();

// Las cuatro rutas de la pantalla del conductor van en su propio router porque
// se montan ANTES de la puerta de autenticacion de server.mjs. En el CRM esto
// no hacia falta: alli el backend no exigia token. Aqui si, y el conductor no
// tiene cuenta a proposito (ver el comentario de arriba).
export const publico = express.Router();

const BUCKET = "asa-flota-fotos";

/** Express 4 no captura rechazos de async: sin esto la petición queda colgada. */
const ruta = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const fallo = (res, status, mensaje, extra = {}) =>
  res.status(status).json({ error: true, mensaje, ...extra });

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));

/**
 * Quién hace la acción.
 *
 * `auditHeaders()` del frontend manda el JSON codificado con
 * encodeURIComponent; el header crudo trae los acentos escapados. Se
 * decodifica antes de parsear o el nombre llega roto.
 */
function usuarioDe(req) {
  let cab = null;
  try {
    const raw = req.headers["x-usuario"];
    if (raw) cab = JSON.parse(decodeURIComponent(raw));
  } catch {
    try { cab = JSON.parse(req.headers["x-usuario"]); } catch { /* header inservible */ }
  }
  return {
    id: req.body?.usuario_id ?? cab?.id ?? null,
    nombre: req.body?.usuario_nombre ?? cab?.nombre ?? "Sistema",
  };
}

/** Fecha de hoy en República Dominicana (UTC-4), no la del servidor. */
function hoyRD() {
  const ahora = new Date(Date.now() - 4 * 60 * 60 * 1000);
  return ahora.toISOString().slice(0, 10);
}

async function leerConfig() {
  const { data } = await supabase
    .from("asa_config_sistema").select("valor").eq("clave", "asa_flota_config").maybeSingle();
  return data?.valor ?? {
    exigir_fotos: true,
    frecuencia_fotos: "DIARIA",
    angulos_requeridos: ["FRONTAL", "TRASERA", "LATERAL_IZQ", "LATERAL_DER", "TABLERO"],
    alerta_documentos_dias: 30,
    moneda: "RD$",
  };
}

/**
 * Sube una foto a Storage y devuelve { url, ruta, bytes }.
 *
 * Acepta un data URL (data:image/jpeg;base64,...). El navegador ya la
 * comprime antes de mandarla; aquí solo se valida el tamaño para que una foto
 * suelta no reviente el límite de 10mb del body parser.
 */
async function subirFoto(dataUrl, { vehiculo_id, angulo = "OTRO", fecha }) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    throw new Error("La foto no viene en el formato esperado.");
  }
  const coma = dataUrl.indexOf(",");
  const cabecera = dataUrl.slice(5, coma);              // image/jpeg;base64
  const ext = (cabecera.split("/")[1] || "jpeg").split(";")[0].replace("jpeg", "jpg");
  const buffer = Buffer.from(dataUrl.slice(coma + 1), "base64");

  if (buffer.length > 6 * 1024 * 1024) {
    throw new Error("La foto pesa más de 6MB. Vuelve a tomarla con menos calidad.");
  }

  const dia = fecha || hoyRD();
  const nombre = `${angulo.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const ruta = `vehiculo-${vehiculo_id}/${dia}/${nombre}`;

  const { error } = await supabase.storage.from(BUCKET).upload(ruta, buffer, {
    contentType: cabecera.split(";")[0],
    upsert: false,
  });
  if (error) throw new Error(`Storage: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(ruta);
  return { url: data.publicUrl, ruta, bytes: buffer.length };
}


// ═════════════════════════════════════════════════════════════════════════════
// PÚBLICO — LO QUE USA LA PANTALLA DEL CONDUCTOR
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /asa/publico/arranque
 *
 * Todo lo que la pantalla de chequeo necesita, en una sola petición: la
 * lista de conductores, la de vehículos, el checklist y el catálogo de
 * fallas. Una sola llamada y no cuatro porque esa pantalla se abre en el
 * patio, con la señal que haya.
 */
publico.get("/publico/arranque", ruta(async (req, res) => {
  const fecha = req.query.fecha || hoyRD();

  const [emp, veh, items, fallas, chequeosHoy, config] = await Promise.all([
    supabase.from("asa_flota_conductores")
      .select("id,nombre,cargo,color,foto_url")
      .eq("activo", true).order("orden").order("nombre"),
    supabase.from("asa_flota_vehiculos")
      .select("id,codigo,placa,marca,modelo,anio,color,tipo,combustible,km_actual,conductor_id,estado,requiere_fotos,foto_url")
      .eq("activo", true).in("estado", ["ACTIVO", "EN_TALLER"]).order("codigo"),
    supabase.from("asa_flota_checklist_items")
      .select("codigo,categoria,etiqueta,icono,critico,orden")
      .eq("activo", true).order("orden"),
    supabase.from("asa_flota_fallas_catalogo")
      .select("codigo,categoria,etiqueta,icono,severidad,detiene_vehiculo,orden")
      .eq("activo", true).order("orden"),
    supabase.from("asa_flota_chequeos")
      .select("id,vehiculo_id,turno,conductor_nombre,km,combustible_octavos,fotos_subidas")
      .eq("fecha", fecha),
    leerConfig(),
  ]);

  const err = emp.error || veh.error || items.error || fallas.error;
  if (err) return fallo(res, 500, err.message);

  res.json({
    error: false,
    fecha,
    conductores: emp.data || [],
    vehiculos: veh.data || [],
    checklist: items.data || [],
    fallas: fallas.data || [],
    chequeos_hoy: chequeosHoy.data || [],
    config,
  });
}));


/**
 * GET /asa/publico/vehiculo/:id/estado
 *
 * El km y el combustible con que quedó la última vez. La pantalla arranca la
 * flecha del combustible y el teclado del odómetro en ese punto, así el
 * conductor solo ajusta la diferencia en vez de partir de cero.
 */
publico.get("/publico/vehiculo/:id/estado", ruta(async (req, res) => {
  const id = Number(req.params.id);

  const [veh, ultimo, abiertas] = await Promise.all([
    supabase.from("asa_flota_vehiculos")
      .select("id,codigo,placa,marca,modelo,km_actual,requiere_fotos,conductor_id")
      .eq("id", id).maybeSingle(),
    supabase.from("asa_flota_chequeos")
      .select("id,fecha,turno,km,combustible_octavos,conductor_nombre")
      .eq("vehiculo_id", id).order("fecha", { ascending: false })
      .order("id", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("asa_flota_fallas_reportadas")
      .select("falla_codigo,falla_etiqueta,severidad,ultima_vez")
      .eq("vehiculo_id", id).in("estado", ["ABIERTA", "EN_REVISION", "EN_TALLER"]),
  ]);

  if (veh.error) return fallo(res, 500, veh.error.message);
  if (!veh.data) return fallo(res, 404, "Ese vehículo no existe.");

  res.json({
    error: false,
    vehiculo: veh.data,
    ultimo_chequeo: ultimo.data || null,
    km_sugerido: Number(ultimo.data?.km ?? veh.data.km_actual ?? 0),
    combustible_anterior: ultimo.data?.combustible_octavos ?? 4,
    fallas_abiertas: abiertas.data || [],
  });
}));


/**
 * POST /asa/publico/chequeo
 *
 * El parte del día. Cuerpo esperado:
 *   {
 *     vehiculo_id, conductor_id, turno: "SALIDA"|"ENTRADA",
 *     km, combustible_octavos,
 *     items_mal:  [{ codigo, valor }]      // solo lo que NO está bien
 *     fallas:     ["goma_baja", ...]       // códigos del catálogo
 *     fotos:      [{ angulo, dataUrl }]
 *     observacion, lat, lng
 *   }
 *
 * Si ya existe el parte de ese vehículo, día y turno, se REEMPLAZA en vez de
 * fallar: el conductor que toca dos veces "Guardar" porque no vio la señal no
 * debe terminar con dos partes ni con un error rojo.
 */
publico.post("/publico/chequeo", ruta(async (req, res) => {
  const b = req.body || {};
  const vehiculo_id = Number(b.vehiculo_id);
  const conductor_id = b.conductor_id ? Number(b.conductor_id) : null;
  const turno = (b.turno || "SALIDA").toUpperCase();
  const fecha = b.fecha || hoyRD();

  if (!vehiculo_id) return fallo(res, 400, "Falta el vehículo.");
  if (!conductor_id) return fallo(res, 400, "Falta escoger quién hace el chequeo.");
  if (!["SALIDA", "ENTRADA"].includes(turno)) return fallo(res, 400, "Turno inválido.");

  const [{ data: vehiculo }, { data: conductor }, config] = await Promise.all([
    supabase.from("asa_flota_vehiculos").select("*").eq("id", vehiculo_id).maybeSingle(),
    supabase.from("asa_flota_conductores").select("id,nombre").eq("id", conductor_id).maybeSingle(),
    leerConfig(),
  ]);
  if (!vehiculo) return fallo(res, 404, "Ese vehículo no existe.");
  if (!conductor) return fallo(res, 404, "Ese conductor no existe.");

  // ── Kilometraje ───────────────────────────────────────────────────────────
  // El odómetro no retrocede. Si el número llega menor que el último, casi
  // siempre es un dígito de menos al teclear. No se rechaza el parte por eso
  // — dejar a un conductor trancado a las 7am es peor que un dato marcado —
  // pero tampoco se le baja el kilometraje al vehículo: se guarda como
  // sospechoso para que el encargado lo revise.
  const kmAnterior = Number(vehiculo.km_actual || 0);
  const km = num(b.km);
  const kmSospechoso = km !== null && kmAnterior > 0 && km < kmAnterior;
  const kmRecorrido = km !== null && !kmSospechoso && kmAnterior > 0 ? km - kmAnterior : null;

  // ── Checklist ─────────────────────────────────────────────────────────────
  // Solo llega lo que está mal. Todo lo demás se da por bien.
  const itemsMal = Array.isArray(b.items_mal) ? b.items_mal : [];
  const codigosMal = itemsMal.map(i => i.codigo).filter(Boolean);

  let catalogoItems = [];
  if (codigosMal.length) {
    const { data } = await supabase.from("asa_flota_checklist_items")
      .select("codigo,etiqueta,critico").in("codigo", codigosMal);
    catalogoItems = data || [];
  }
  const hayCriticoEnChecklist = catalogoItems.some(i => i.critico);

  // ── Fallas ────────────────────────────────────────────────────────────────
  const codigosFalla = (Array.isArray(b.fallas) ? b.fallas : []).filter(Boolean);
  let catalogoFallas = [];
  if (codigosFalla.length) {
    const { data } = await supabase.from("asa_flota_fallas_catalogo")
      .select("codigo,categoria,etiqueta,severidad,detiene_vehiculo").in("codigo", codigosFalla);
    catalogoFallas = data || [];
  }
  const hayFallaQueDetiene = catalogoFallas.some(f => f.detiene_vehiculo);

  const respuestas = {
    items_mal: itemsMal,
    fallas: codigosFalla,
    km_anterior: kmAnterior,
    km_sospechoso: kmSospechoso,
  };

  const fila = {
    vehiculo_id,
    conductor_id,
    conductor_nombre: conductor.nombre,
    fecha,
    turno,
    km,
    km_recorrido: kmRecorrido,
    combustible_octavos: b.combustible_octavos === null || b.combustible_octavos === undefined
      ? null : Math.max(0, Math.min(8, Number(b.combustible_octavos))),
    respuestas,
    items_mal: itemsMal.length,
    fallas_reportadas: codigosFalla.length,
    apto_circular: !(hayCriticoEnChecklist || hayFallaQueDetiene),
    observacion: b.observacion || null,
    lat: num(b.lat),
    lng: num(b.lng),
  };

  // Reemplazo, no duplicado: el índice único (vehiculo, fecha, turno) es lo
  // que hace posible este upsert.
  const { data: chequeo, error: errChq } = await supabase
    .from("asa_flota_chequeos")
    .upsert([fila], { onConflict: "vehiculo_id,fecha,turno" })
    .select().maybeSingle();
  if (errChq) return fallo(res, 500, errChq.message);

  // Detalle del checklist — se rehace completo para que reenviar el parte
  // corregido no deje pegados los items de la primera versión.
  await supabase.from("asa_flota_chequeo_items").delete().eq("chequeo_id", chequeo.id);
  if (itemsMal.length) {
    const porCodigo = Object.fromEntries(catalogoItems.map(i => [i.codigo, i]));
    await supabase.from("asa_flota_chequeo_items").insert(
      itemsMal.map(i => ({
        chequeo_id: chequeo.id,
        vehiculo_id,
        fecha,
        item_codigo: i.codigo,
        item_etiqueta: porCodigo[i.codigo]?.etiqueta ?? i.codigo,
        valor: i.valor === "NA" ? "NA" : "MAL",
        critico: !!porCodigo[i.codigo]?.critico,
      }))
    );
  }

  // ── Fallas: abrir o acumular ──────────────────────────────────────────────
  const fallasNuevas = [];
  for (const f of catalogoFallas) {
    const { data: existente } = await supabase
      .from("asa_flota_fallas_reportadas")
      .select("id,veces_reportada")
      .eq("vehiculo_id", vehiculo_id)
      .eq("falla_codigo", f.codigo)
      .in("estado", ["ABIERTA", "EN_REVISION", "EN_TALLER"])
      .maybeSingle();

    if (existente) {
      await supabase.from("asa_flota_fallas_reportadas").update({
        veces_reportada: (existente.veces_reportada || 1) + 1,
        ultima_vez: new Date().toISOString(),
        km_reporte: km,
      }).eq("id", existente.id);
    } else {
      const { data: creada } = await supabase.from("asa_flota_fallas_reportadas").insert([{
        vehiculo_id,
        chequeo_id: chequeo.id,
        conductor_id,
        conductor_nombre: conductor.nombre,
        falla_codigo: f.codigo,
        falla_etiqueta: f.etiqueta,
        categoria: f.categoria,
        severidad: f.severidad,
        detiene_vehiculo: f.detiene_vehiculo,
        km_reporte: km,
        nota: b.nota_falla || null,
      }]).select().maybeSingle();
      if (creada) fallasNuevas.push(creada);
    }
  }

  // ── Fotos ─────────────────────────────────────────────────────────────────
  const fotos = Array.isArray(b.fotos) ? b.fotos : [];
  const guardadas = [];
  const fallidas = [];
  for (const f of fotos) {
    try {
      const subida = await subirFoto(f.dataUrl, { vehiculo_id, angulo: f.angulo, fecha });
      const { data } = await supabase.from("asa_flota_fotos").insert([{
        vehiculo_id,
        chequeo_id: chequeo.id,
        conductor_id,
        fecha,
        angulo: (f.angulo || "OTRO").toUpperCase(),
        url: subida.url,
        ruta: subida.ruta,
        bytes: subida.bytes,
        nota: f.nota || null,
      }]).select().maybeSingle();
      if (data) guardadas.push(data);
    } catch (e) {
      // Una foto que no sube no bota el parte: el checklist y el kilometraje
      // ya están guardados y valen más que la imagen.
      fallidas.push({ angulo: f.angulo, mensaje: e.message });
    }
  }

  // ¿Quedaron completas las fotos del día?
  const { data: fotosDelDia } = await supabase
    .from("asa_flota_fotos").select("angulo").eq("vehiculo_id", vehiculo_id).eq("fecha", fecha);
  const angulosHoy = new Set((fotosDelDia || []).map(f => f.angulo));
  const requeridos = Array.isArray(config.angulos_requeridos) ? config.angulos_requeridos : [];
  const completas = !vehiculo.requiere_fotos || requeridos.every(a => angulosHoy.has(a));

  await supabase.from("asa_flota_chequeos").update({
    fotos_subidas: (fotosDelDia || []).length,
    fotos_completas: completas,
  }).eq("id", chequeo.id);

  // ── Kilometraje del vehículo ──────────────────────────────────────────────
  if (km !== null && !kmSospechoso) {
    await supabase.from("asa_flota_vehiculos").update({
      km_actual: km,
      km_actualizado: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", vehiculo_id);
  }

  res.json({
    error: false,
    chequeo: { ...chequeo, fotos_subidas: (fotosDelDia || []).length, fotos_completas: completas },
    km_sospechoso: kmSospechoso,
    km_anterior: kmAnterior,
    apto_circular: fila.apto_circular,
    fallas_nuevas: fallasNuevas.length,
    fotos_guardadas: guardadas.length,
    fotos_fallidas: fallidas,
    faltan_angulos: requeridos.filter(a => !angulosHoy.has(a)),
    mensaje: fila.apto_circular
      ? "Chequeo guardado."
      : "Chequeo guardado. Este vehículo tiene una condición que impide sacarlo: avisa al encargado.",
  });
}));


/** POST /asa/publico/foto — subir una foto suelta (llega tarde o se repite). */
publico.post("/publico/foto", ruta(async (req, res) => {
  const { vehiculo_id, chequeo_id, conductor_id, angulo, dataUrl, nota } = req.body || {};
  if (!vehiculo_id) return fallo(res, 400, "Falta el vehículo.");
  try {
    const fecha = req.body.fecha || hoyRD();
    const subida = await subirFoto(dataUrl, { vehiculo_id: Number(vehiculo_id), angulo, fecha });
    const { data, error } = await supabase.from("asa_flota_fotos").insert([{
      vehiculo_id: Number(vehiculo_id),
      chequeo_id: chequeo_id ? Number(chequeo_id) : null,
      conductor_id: conductor_id ? Number(conductor_id) : null,
      fecha,
      angulo: (angulo || "OTRO").toUpperCase(),
      url: subida.url, ruta: subida.ruta, bytes: subida.bytes, nota: nota || null,
    }]).select().maybeSingle();
    if (error) return fallo(res, 500, error.message);
    res.json({ error: false, foto: data });
  } catch (e) {
    return fallo(res, 400, e.message);
  }
}));


// ═════════════════════════════════════════════════════════════════════════════
// TABLERO DEL ENCARGADO
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /asa/dashboard
 *
 * Lo que el encargado necesita saber antes de las 9 de la mañana: quién no
 * reportó, qué unidad no puede salir, qué papel se vence y cómo va el gasto
 * del mes.
 */
router.get("/dashboard", ruta(async (req, res) => {
  const fecha = req.query.fecha || hoyRD();
  const mesDesde = fecha.slice(0, 8) + "01";

  const [resumen, chequeosHoy, fallas, docs, gastosMes, config] = await Promise.all([
    supabase.from("asa_flota_v_resumen_vehiculo").select("*").order("codigo"),
    supabase.from("asa_flota_chequeos")
      .select("id,vehiculo_id,turno,conductor_nombre,km,combustible_octavos,items_mal,fallas_reportadas,fotos_completas,apto_circular,created_at")
      .eq("fecha", fecha),
    supabase.from("asa_flota_fallas_reportadas")
      .select("*").in("estado", ["ABIERTA", "EN_REVISION", "EN_TALLER"])
      .order("severidad").order("ultima_vez", { ascending: false }),
    supabase.from("asa_flota_v_documentos_alerta").select("*").neq("situacion", "VIGENTE").order("vence"),
    supabase.from("asa_flota_gastos").select("tipo,monto,galones").gte("fecha", mesDesde).lte("fecha", fecha),
    leerConfig(),
  ]);

  if (resumen.error) return fallo(res, 500, resumen.error.message);

  const vehiculos = resumen.data || [];
  const chq = chequeosHoy.data || [];
  const idsConChequeo = new Set(chq.map(c => c.vehiculo_id));

  const sinChequeo = vehiculos.filter(v => v.estado === "ACTIVO" && !idsConChequeo.has(v.id));
  const sinFotos = chq.filter(c => !c.fotos_completas);
  const noAptos = chq.filter(c => !c.apto_circular);

  const gastos = gastosMes.data || [];
  const porTipo = {};
  for (const g of gastos) porTipo[g.tipo] = (porTipo[g.tipo] || 0) + Number(g.monto || 0);

  const kmFlota = vehiculos.reduce((s, v) => s + Number(v.km_recorridos || 0), 0);
  const gastoTotal = vehiculos.reduce((s, v) => s + Number(v.total_gastado || 0), 0);

  res.json({
    error: false,
    fecha,
    config,
    kpis: {
      vehiculos_activos: vehiculos.filter(v => v.estado === "ACTIVO").length,
      vehiculos_en_taller: vehiculos.filter(v => v.estado === "EN_TALLER").length,
      chequearon_hoy: chq.length,
      faltan_chequeo: sinChequeo.length,
      sin_fotos_hoy: sinFotos.length,
      no_aptos: noAptos.length,
      fallas_abiertas: (fallas.data || []).length,
      fallas_graves: (fallas.data || []).filter(f => f.severidad === "GRAVE").length,
      documentos_alerta: (docs.data || []).length,
      gasto_mes: Math.round(gastos.reduce((s, g) => s + Number(g.monto || 0), 0) * 100) / 100,
      galones_mes: Math.round(gastos.reduce((s, g) => s + Number(g.galones || 0), 0) * 100) / 100,
      km_flota: kmFlota,
      gasto_flota: gastoTotal,
      costo_km_flota: kmFlota > 0 ? Math.round((gastoTotal / kmFlota) * 100) / 100 : null,
    },
    gasto_mes_por_tipo: porTipo,
    vehiculos,
    chequeos_hoy: chq,
    sin_chequeo: sinChequeo,
    fallas_abiertas: fallas.data || [],
    documentos_alerta: docs.data || [],
  });
}));


/** GET /asa/vehiculos/:id/ficha — todo lo del vehículo en una pantalla. */
router.get("/vehiculos/:id/ficha", ruta(async (req, res) => {
  const id = Number(req.params.id);
  const desde = req.query.desde || null;

  let qGastos = supabase.from("asa_flota_gastos").select("*").eq("vehiculo_id", id);
  if (desde) qGastos = qGastos.gte("fecha", desde);

  const [veh, resumen, chequeos, fallas, gastos, fotos, docs, mant, asign] = await Promise.all([
    supabase.from("asa_flota_vehiculos").select("*").eq("id", id).maybeSingle(),
    supabase.from("asa_flota_v_resumen_vehiculo").select("*").eq("id", id).maybeSingle(),
    supabase.from("asa_flota_chequeos").select("*").eq("vehiculo_id", id)
      .order("fecha", { ascending: false }).limit(90),
    supabase.from("asa_flota_fallas_reportadas").select("*").eq("vehiculo_id", id)
      .order("ultima_vez", { ascending: false }),
    qGastos.order("fecha", { ascending: false }),
    supabase.from("asa_flota_fotos").select("*").eq("vehiculo_id", id)
      .order("fecha", { ascending: false }).limit(200),
    supabase.from("asa_flota_documentos").select("*").eq("vehiculo_id", id).eq("activo", true).order("vence"),
    supabase.from("asa_flota_mantenimientos").select("*").eq("vehiculo_id", id).eq("activo", true),
    supabase.from("asa_flota_asignaciones").select("*, asa_flota_conductores(nombre)").eq("vehiculo_id", id)
      .order("desde", { ascending: false }),
  ]);

  if (!veh.data) return fallo(res, 404, "Ese vehículo no existe.");

  // Mantenimiento: cuánto falta según el km que trae el parte diario.
  const kmActual = Number(veh.data.km_actual || 0);
  const mantenimientos = (mant.data || []).map(m => {
    const proximoKm = m.km_ultimo != null && m.intervalo_km
      ? Number(m.km_ultimo) + Number(m.intervalo_km) : null;
    const faltanKm = proximoKm != null ? Math.round(proximoKm - kmActual) : null;
    let proximaFecha = null;
    if (m.fecha_ultimo && m.intervalo_dias) {
      const d = new Date(m.fecha_ultimo);
      d.setDate(d.getDate() + Number(m.intervalo_dias));
      proximaFecha = d.toISOString().slice(0, 10);
    }
    const faltanDias = proximaFecha
      ? Math.round((new Date(proximaFecha) - new Date(hoyRD())) / 86400000) : null;
    return {
      ...m, proximo_km: proximoKm, faltan_km: faltanKm,
      proxima_fecha: proximaFecha, faltan_dias: faltanDias,
      vencido: (faltanKm != null && faltanKm <= 0) || (faltanDias != null && faltanDias <= 0),
    };
  });

  // Rendimiento tanqueo a tanqueo: km entre dos cargas completas ÷ galones de
  // la segunda. Es más honesto que dividir el total, que se ensucia con los
  // tanqueos parciales.
  const tanqueos = (gastos.data || [])
    .filter(g => g.tipo === "COMBUSTIBLE" && g.km != null && Number(g.galones) > 0)
    .sort((a, b) => Number(a.km) - Number(b.km));
  const rendimientos = [];
  for (let i = 1; i < tanqueos.length; i++) {
    const dkm = Number(tanqueos[i].km) - Number(tanqueos[i - 1].km);
    const gal = Number(tanqueos[i].galones);
    if (dkm > 0 && gal > 0 && tanqueos[i].tanque_lleno) {
      rendimientos.push({
        fecha: tanqueos[i].fecha,
        km: dkm,
        galones: gal,
        km_galon: Math.round((dkm / gal) * 100) / 100,
      });
    }
  }

  res.json({
    error: false,
    vehiculo: veh.data,
    resumen: resumen.data || null,
    chequeos: chequeos.data || [],
    fallas: fallas.data || [],
    gastos: gastos.data || [],
    fotos: fotos.data || [],
    documentos: docs.data || [],
    mantenimientos,
    asignaciones: asign.data || [],
    rendimientos,
  });
}));


/**
 * GET /asa/reportes/costos?desde=&hasta=
 *
 * El reporte que responde "¿cuánto me está costando esto?": gasto por
 * vehículo, por tipo y por kilómetro en un rango.
 */
router.get("/reportes/costos", ruta(async (req, res) => {
  const hasta = req.query.hasta || hoyRD();
  const desde = req.query.desde || hasta.slice(0, 4) + "-01-01";

  const [veh, gastos, chequeos] = await Promise.all([
    supabase.from("asa_flota_vehiculos").select("id,codigo,placa,marca,modelo,km_inicial,km_actual,estado")
      .eq("activo", true).order("codigo"),
    supabase.from("asa_flota_gastos").select("*").gte("fecha", desde).lte("fecha", hasta),
    supabase.from("asa_flota_chequeos").select("vehiculo_id,fecha,km,km_recorrido")
      .gte("fecha", desde).lte("fecha", hasta),
  ]);

  if (veh.error) return fallo(res, 500, veh.error.message);

  const porVehiculo = (veh.data || []).map(v => {
    const g = (gastos.data || []).filter(x => x.vehiculo_id === v.id);
    // Km del período: primer y último odómetro leído en el rango. Más fiel
    // que sumar km_recorrido, que tiene huecos los días sin parte.
    const lecturas = (chequeos.data || [])
      .filter(c => c.vehiculo_id === v.id && c.km != null)
      .map(c => Number(c.km)).sort((a, b) => a - b);
    const km = lecturas.length >= 2 ? lecturas[lecturas.length - 1] - lecturas[0] : 0;

    const total = g.reduce((s, x) => s + Number(x.monto || 0), 0);
    const galones = g.reduce((s, x) => s + Number(x.galones || 0), 0);
    const porTipo = {};
    for (const x of g) porTipo[x.tipo] = (porTipo[x.tipo] || 0) + Number(x.monto || 0);

    return {
      id: v.id, codigo: v.codigo, placa: v.placa,
      vehiculo: [v.marca, v.modelo].filter(Boolean).join(" "),
      estado: v.estado,
      km_periodo: Math.round(km),
      total: Math.round(total * 100) / 100,
      galones: Math.round(galones * 100) / 100,
      por_tipo: porTipo,
      costo_km: km > 0 ? Math.round((total / km) * 100) / 100 : null,
      km_galon: galones > 0 && km > 0 ? Math.round((km / galones) * 100) / 100 : null,
      movimientos: g.length,
    };
  });

  const totales = porVehiculo.reduce((acc, v) => {
    acc.total += v.total; acc.km += v.km_periodo; acc.galones += v.galones;
    return acc;
  }, { total: 0, km: 0, galones: 0 });

  res.json({
    error: false, desde, hasta,
    por_vehiculo: porVehiculo,
    totales: {
      ...totales,
      total: Math.round(totales.total * 100) / 100,
      costo_km: totales.km > 0 ? Math.round((totales.total / totales.km) * 100) / 100 : null,
    },
  });
}));


/** GET /asa/reportes/conductores — quién cumple con el parte y quién no. */
router.get("/reportes/conductores", ruta(async (req, res) => {
  const hasta = req.query.hasta || hoyRD();
  const desde = req.query.desde || hasta.slice(0, 8) + "01";

  const [emp, chq, fallas] = await Promise.all([
    supabase.from("asa_flota_conductores").select("id,nombre,cargo").eq("activo", true).order("nombre"),
    supabase.from("asa_flota_chequeos").select("conductor_id,fecha,km_recorrido,items_mal,fotos_completas,apto_circular")
      .gte("fecha", desde).lte("fecha", hasta),
    supabase.from("asa_flota_fallas_reportadas").select("conductor_id,severidad")
      .gte("primera_vez", desde),
  ]);

  const filas = (emp.data || []).map(e => {
    const suyos = (chq.data || []).filter(c => c.conductor_id === e.id);
    const dias = new Set(suyos.map(c => c.fecha)).size;
    return {
      id: e.id, nombre: e.nombre, cargo: e.cargo,
      partes: suyos.length,
      dias_reportados: dias,
      km_recorrido: Math.round(suyos.reduce((s, c) => s + Number(c.km_recorrido || 0), 0)),
      con_fotos: suyos.filter(c => c.fotos_completas).length,
      sin_fotos: suyos.filter(c => !c.fotos_completas).length,
      items_mal: suyos.reduce((s, c) => s + Number(c.items_mal || 0), 0),
      fallas_reportadas: (fallas.data || []).filter(f => f.conductor_id === e.id).length,
      cumplimiento_fotos: suyos.length
        ? Math.round((suyos.filter(c => c.fotos_completas).length / suyos.length) * 100) : null,
    };
  });

  res.json({ error: false, desde, hasta, conductores: filas });
}));


// ═════════════════════════════════════════════════════════════════════════════
// CRUD — VEHÍCULOS, EMPLEADOS, GASTOS, DOCUMENTOS, MANTENIMIENTOS
// ═════════════════════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════════════════════
// POST /flota/importar-excel — carga el .xlsx que exporta el CRM del taller
//
// Body: { archivo_base64, simular? }
//
// Es la otra mitad de "CRM Sólido → ASA → Configuración → Exportar". Existe
// para no tener que poner la clave del Supabase del CRM dentro de este
// backend: el archivo se baja allá y se sube aquí.
//
// Tres cosas que vale la pena saber:
//
// · **Los `id` del archivo no se reutilizan.** Estas tablas son BIGSERIAL:
//   insertar con ids ajenos dejaría la secuencia atrás y el primer vehículo que
//   alguien agregue a mano chocaría con un id repetido. Se inserta sin id y se
//   guarda un mapa viejo→nuevo para reescribir `vehiculo_id`, `conductor_id` y
//   `chequeo_id`.
//
// · **El orden importa.** Conductores antes que vehículos, vehículos antes que
//   partes: una llave foránea a algo que todavía no existe falla.
//
// · **Es repetible.** Cada hoja se reconcilia por su clave natural (el código
//   del vehículo, la cédula del conductor, vehículo+fecha+turno del parte), así
//   que subir el mismo archivo dos veces actualiza en vez de duplicar. Es lo
//   que permite hacer una prueba, seguir trabajando en el CRM unos días, y
//   volver a subir para ponerse al día.
// ═════════════════════════════════════════════════════════════════════════════

// Hoja → tabla, con la clave por la que se reconcilia y qué columnas son
// referencias a otras hojas. Este mapa es el contrato con el exportador del
// CRM: los nombres de hoja y de columna son los mismos en los dos lados a
// propósito, para que no haya traducción que mantener.
const HOJAS_IMPORTAR = [
  { hoja: "Checklist",        tabla: "asa_flota_checklist_items",   clave: ["codigo"] },
  { hoja: "CatalogoFallas",   tabla: "asa_flota_fallas_catalogo",   clave: ["codigo"] },
  { hoja: "Conductores",      tabla: "asa_flota_conductores",       clave: ["cedula"], claveAlterna: ["nombre"], mapa: "conductores" },
  { hoja: "Vehiculos",        tabla: "asa_flota_vehiculos",         clave: ["codigo"], mapa: "vehiculos",
    refs: { conductor_id: "conductores" } },
  { hoja: "Asignaciones",     tabla: "asa_flota_asignaciones",      clave: ["vehiculo_id", "conductor_id", "desde"],
    refs: { vehiculo_id: "vehiculos", conductor_id: "conductores" },
    obligatorias: ["vehiculo_id", "conductor_id"] },
  { hoja: "Chequeos",         tabla: "asa_flota_chequeos",          clave: ["vehiculo_id", "fecha", "turno"], mapa: "chequeos",
    refs: { vehiculo_id: "vehiculos", conductor_id: "conductores" },
    json: ["respuestas"],
    obligatorias: ["vehiculo_id"] },
  { hoja: "ChequeoItems",     tabla: "asa_flota_chequeo_items",     clave: ["chequeo_id", "item_codigo"],
    refs: { vehiculo_id: "vehiculos", chequeo_id: "chequeos" },
    obligatorias: ["vehiculo_id", "chequeo_id"] },
  { hoja: "FallasReportadas", tabla: "asa_flota_fallas_reportadas", clave: ["vehiculo_id", "falla_codigo", "primera_vez"],
    refs: { vehiculo_id: "vehiculos", chequeo_id: "chequeos", conductor_id: "conductores" },
    obligatorias: ["vehiculo_id"] },
  { hoja: "Fotos",            tabla: "asa_flota_fotos",             clave: ["vehiculo_id", "fecha", "angulo", "url"],
    refs: { vehiculo_id: "vehiculos", chequeo_id: "chequeos", conductor_id: "conductores" },
    obligatorias: ["vehiculo_id"] },
  { hoja: "Gastos",           tabla: "asa_flota_gastos",            clave: ["vehiculo_id", "fecha", "tipo", "monto"],
    refs: { vehiculo_id: "vehiculos", conductor_id: "conductores" },
    obligatorias: ["vehiculo_id"] },
  { hoja: "Documentos",       tabla: "asa_flota_documentos",        clave: ["vehiculo_id", "tipo", "vence"],
    refs: { vehiculo_id: "vehiculos" },
    obligatorias: ["vehiculo_id"] },
  { hoja: "Mantenimientos",   tabla: "asa_flota_mantenimientos",    clave: ["vehiculo_id", "tipo"],
    refs: { vehiculo_id: "vehiculos" },
    obligatorias: ["vehiculo_id"] },
];

/** Una celda de Excel puede venir de seis formas distintas. Aquí se aplanan a
 *  un valor de JavaScript, y el vacío siempre termina en null — no en "". */
export function valorCelda(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if (v.result !== undefined) return valorCelda(v.result);      // celda con fórmula
    if (v.text !== undefined) return valorCelda(v.text);          // enlace
    return JSON.stringify(v);
  }
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "" || t === "null" || t === "undefined") return null;
    if (t === "true") return true;
    if (t === "false") return false;
    return t;
  }
  return v;
}

/** Lee una hoja como lista de objetos usando la primera fila de encabezados. */
export function leerHoja(wb, nombre) {
  const ws = wb.getWorksheet(nombre);
  if (!ws) return null;   // hoja ausente: el archivo puede ser de una versión anterior

  const encabezados = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (celda, col) => {
    encabezados[col] = String(celda.value ?? "").trim();
  });

  const filas = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const fila = {};
    let algo = false;
    ws.getRow(r).eachCell({ includeEmpty: false }, (celda, col) => {
      const clave = encabezados[col];
      if (!clave) return;
      const v = valorCelda(celda.value);
      if (v !== null) algo = true;
      fila[clave] = v;
    });
    if (algo) filas.push(fila);
  }
  return filas;
}

router.post("/importar-excel", ruta(async (req, res) => {
  const { archivo_base64, simular = false } = req.body || {};
  if (!archivo_base64) return fallo(res, 400, "Falta el archivo.");

  let wb;
  try {
    const binario = Buffer.from(String(archivo_base64).replace(/^data:[^,]+,/, ""), "base64");
    wb = new ExcelJS.Workbook();
    await wb.xlsx.load(binario);
  } catch (e) {
    return fallo(res, 400, `No se pudo leer el archivo: ${e.message}. ¿Seguro que es el .xlsx que exporta el CRM?`);
  }

  // Un archivo equivocado (un reporte de costos, por ejemplo) no trae estas
  // hojas. Mejor decirlo de una que escribir a medias.
  if (!wb.getWorksheet("Vehiculos") && !wb.getWorksheet("Conductores")) {
    return fallo(res, 400,
      "Ese archivo no tiene las hojas de la flota. Debe ser el que sale de " +
      "CRM Sólido → ASA → Configuración → Exportar.");
  }

  const mapas = { conductores: new Map(), vehiculos: new Map(), chequeos: new Map() };
  const resumen = [];
  const avisos = [];

  for (const def of HOJAS_IMPORTAR) {
    const filas = leerHoja(wb, def.hoja);
    if (filas === null) {
      avisos.push(`La hoja "${def.hoja}" no está en el archivo; se saltó.`);
      continue;
    }

    let nuevos = 0, actualizados = 0, saltados = 0;

    for (const cruda of filas) {
      const { id: idViejo, created_at: _c, updated_at: _u, ...fila } = cruda;

      // Reescribir las referencias a otras hojas con los ids de aquí
      let referenciaRota = false;
      for (const [columna, mapa] of Object.entries(def.refs || {})) {
        const viejo = fila[columna];
        if (viejo === null || viejo === undefined) { fila[columna] = null; continue; }
        const nuevo = mapas[mapa].get(Number(viejo));
        if (nuevo === undefined || nuevo === -1) {
          // El registro al que apunta no vino en el archivo (o no existe aquí).
          // Si esa referencia es obligatoria — un parte sin vehículo, un gasto
          // sin unidad — la fila se salta entera en vez de dejarla huérfana o
          // hacer reventar la llave foránea a mitad de la carga.
          if ((def.obligatorias || []).includes(columna)) referenciaRota = true;
          fila[columna] = null;
        } else {
          fila[columna] = nuevo;
        }
      }
      if (referenciaRota) { saltados++; continue; }

      // Las columnas jsonb vienen como texto en la celda
      for (const columna of def.json || []) {
        if (typeof fila[columna] === "string") {
          try { fila[columna] = JSON.parse(fila[columna]); } catch { fila[columna] = {}; }
        }
      }

      // Clave natural: con qué se decide si esta fila ya existe aquí
      let clave = def.clave;
      if (def.claveAlterna && (fila[clave[0]] === null || fila[clave[0]] === undefined)) clave = def.claveAlterna;
      if (clave.some((k) => fila[k] === null || fila[k] === undefined)) { saltados++; continue; }

      if (simular) { nuevos++; continue; }

      let q = supabase.from(def.tabla).select("id");
      for (const k of clave) q = q.eq(k, fila[k]);
      const { data: ya } = await q.maybeSingle();

      if (ya) {
        const { error } = await supabase.from(def.tabla).update(fila).eq("id", ya.id);
        if (error) return fallo(res, 500, `${def.hoja}: ${error.message}`);
        if (def.mapa && idViejo != null) mapas[def.mapa].set(Number(idViejo), ya.id);
        actualizados++;
      } else {
        const { data, error } = await supabase.from(def.tabla).insert([fila]).select("id").single();
        if (error) return fallo(res, 500, `${def.hoja} (fila con ${clave.map((k) => `${k}=${fila[k]}`).join(", ")}): ${error.message}`);
        if (def.mapa && idViejo != null) mapas[def.mapa].set(Number(idViejo), data.id);
        nuevos++;
      }
    }

    // En modo prueba no se escribe nada, así que no hay ids nuevos que mapear.
    // Se llena el mapa con los que YA existen aquí para que las hojas que
    // dependen de ellos no reporten todo como saltado.
    if (simular && def.mapa) {
      const columnaClave = def.clave[0];
      const { data: existentes } = await supabase.from(def.tabla).select(`id, ${columnaClave}`);
      const porClave = new Map((existentes || []).map((x) => [String(x[columnaClave]), x.id]));
      for (const f of filas) {
        const suyo = porClave.get(String(f[columnaClave]));
        if (f.id != null) mapas[def.mapa].set(Number(f.id), suyo ?? -1);
      }
    }

    resumen.push({ hoja: def.hoja, leidas: filas.length, nuevos, actualizados, saltados });
  }

  // Ajustes del módulo
  const cfg = leerHoja(wb, "Configuracion");
  if (cfg?.length && !simular) {
    for (const fila of cfg) {
      if (fila.clave !== "asa_flota_config" || !fila.valor) continue;
      let valor = fila.valor;
      if (typeof valor === "string") { try { valor = JSON.parse(valor); } catch { continue; } }
      await supabase.from("asa_config_sistema")
        .upsert([{ clave: "asa_flota_config", valor, updated_at: new Date().toISOString() }], { onConflict: "clave" });
    }
  }

  if (!simular) {
    logAccion(req, {
      accion: "crear",
      modulo: "flota_importacion",
      descripcion: `Importación de la flota desde Excel: ${resumen.map((r) => `${r.hoja} ${r.nuevos}+${r.actualizados}`).join(", ")}`,
      detalle: { resumen },
    });
  }

  res.json({
    error: false,
    simulado: !!simular,
    resumen,
    avisos,
    totales: {
      nuevos: resumen.reduce((a, r) => a + r.nuevos, 0),
      actualizados: resumen.reduce((a, r) => a + r.actualizados, 0),
      saltados: resumen.reduce((a, r) => a + r.saltados, 0),
    },
    nota: "Las fotos no vienen en el archivo: sus enlaces siguen apuntando al almacenamiento del CRM del taller.",
  });
}));

/**
 * Fábrica de CRUD: todas estas tablas se comportan igual.
 *
 * `tocarUpdated` existe porque los dos catálogos (checklist y fallas) no
 * tienen columna `updated_at`. Escribirla igual hacía que editar una etiqueta
 * desde Configuración fallara con "column updated_at does not exist".
 */
// Una linea legible para la bitacora. Sin esto, la auditoria muestra
// "actualizo flota_gastos" y hay que ir a la tabla a ver de que se trataba.
function resumirFila(base, fila) {
  if (!fila) return base;
  if (fila.nombre) return fila.nombre;
  if (fila.codigo && fila.placa) return `${fila.codigo} (${fila.placa})`;
  if (fila.etiqueta) return fila.etiqueta;
  if (fila.tipo && fila.monto !== undefined) return `${fila.tipo} RD$${fila.monto}`;
  if (fila.tipo && fila.vence) return `${fila.tipo} vence ${fila.vence}`;
  return `${base} #${fila.id ?? ""}`;
}

function montarCrud(base, tabla, { orden = "id", ascendente = true, softDelete = true, tocarUpdated = true } = {}) {
  router.get(`/${base}`, ruta(async (req, res) => {
    let q = supabase.from(tabla).select("*");
    if (req.query.vehiculo_id) q = q.eq("vehiculo_id", Number(req.query.vehiculo_id));
    if (req.query.desde) q = q.gte("fecha", req.query.desde);
    if (req.query.hasta) q = q.lte("fecha", req.query.hasta);
    if (req.query.tipo) q = q.eq("tipo", req.query.tipo);
    if (softDelete && req.query.incluir_inactivos !== "1") q = q.eq("activo", true);
    const { data, error } = await q.order(orden, { ascending: ascendente });
    if (error) return fallo(res, 500, error.message);
    res.json({ error: false, [base]: data || [] });
  }));

  router.post(`/${base}`, ruta(async (req, res) => {
    const usuario = usuarioDe(req);
    const { usuario_id, usuario_nombre, ...campos } = req.body || {};
    if ("registrado_por" in campos === false && tabla === "asa_flota_gastos") {
      campos.registrado_por = usuario.nombre;
    }
    const { data, error } = await supabase.from(tabla).insert([campos]).select().maybeSingle();
    if (error) return fallo(res, 500, error.message);
    logAccion(req, { accion: "crear", modulo: `flota_${base}`, registroId: null, descripcion: resumirFila(base, data) });
    res.json({ error: false, registro: data });
  }));

  router.patch(`/${base}/:id`, ruta(async (req, res) => {
    const { usuario_id, usuario_nombre, id, created_at, ...campos } = req.body || {};
    const { data, error } = await supabase.from(tabla)
      .update({ ...campos, ...(tocarUpdated ? { updated_at: new Date().toISOString() } : {}) })
      .eq("id", Number(req.params.id)).select().maybeSingle();
    if (error) return fallo(res, 500, error.message);
    logAccion(req, { accion: "actualizar", modulo: `flota_${base}`, descripcion: resumirFila(base, data), detalle: { id: req.params.id, campos: Object.keys(campos) } });
    res.json({ error: false, registro: data });
  }));

  router.delete(`/${base}/:id`, ruta(async (req, res) => {
    const id = Number(req.params.id);

    // Dos borrados distintos y a proposito:
    //
    //   Baja (por defecto)   pone activo = false. Desaparece de las pantallas
    //                        pero el historial sigue entero y se puede
    //                        reactivar. Es lo que se quiere el 95% de las
    //                        veces: el conductor que se fue de la empresa no
    //                        debe borrar los partes que firmo.
    //
    //   ?definitivo=1        borra la fila de verdad. Para lo que se creo por
    //                        error o para pruebas. Irreversible.
    const definitivo = req.query.definitivo === "1";

    const { error } = (softDelete && !definitivo)
      ? await supabase.from(tabla).update({ activo: false }).eq("id", id)
      : await supabase.from(tabla).delete().eq("id", id);
    if (error) return fallo(res, 500, error.message);
    logAccion(req, {
      accion: "eliminar",
      modulo: `flota_${base}`,
      descripcion: `${definitivo || !softDelete ? "Borrado definitivo" : "Dado de baja"} en ${base} (id ${id})`,
    });
    res.json({ error: false, definitivo: definitivo || !softDelete });
  }));
}

montarCrud("conductores", "asa_flota_conductores", { orden: "orden" });
montarCrud("gastos", "asa_flota_gastos", { orden: "fecha", ascendente: false, softDelete: false, tocarUpdated: false });
montarCrud("documentos", "asa_flota_documentos", { orden: "vence" });
montarCrud("mantenimientos", "asa_flota_mantenimientos", { orden: "id" });
// Los catálogos no llevan updated_at ni fecha: solo orden y activo.
montarCrud("checklist", "asa_flota_checklist_items", { orden: "orden", tocarUpdated: false });
montarCrud("catalogo-fallas", "asa_flota_fallas_catalogo", { orden: "orden", tocarUpdated: false });


/** GET /asa/vehiculos — con el resumen de costos ya calculado. */
router.get("/vehiculos", ruta(async (req, res) => {
  const [veh, resumen] = await Promise.all([
    (req.query.incluir_inactivos === "1"
      ? supabase.from("asa_flota_vehiculos").select("*, asa_flota_conductores(id,nombre)")
      : supabase.from("asa_flota_vehiculos").select("*, asa_flota_conductores(id,nombre)").eq("activo", true)
    ).order("codigo"),
    supabase.from("asa_flota_v_resumen_vehiculo").select("*"),
  ]);
  if (veh.error) return fallo(res, 500, veh.error.message);
  const porId = Object.fromEntries((resumen.data || []).map(r => [r.id, r]));
  res.json({
    error: false,
    vehiculos: (veh.data || []).map(v => ({ ...v, resumen: porId[v.id] || null })),
  });
}));

router.post("/vehiculos", ruta(async (req, res) => {
  const { usuario_id, usuario_nombre, ...campos } = req.body || {};
  if (!campos.codigo || !campos.placa) return fallo(res, 400, "El código y la placa son obligatorios.");
  // El odómetro con el que entra a la flota es la línea base de todo cálculo
  // de kilómetros recorridos. Si viene vacío, arranca igual al actual.
  if (campos.km_inicial == null) campos.km_inicial = campos.km_actual ?? 0;
  const { data, error } = await supabase.from("asa_flota_vehiculos").insert([campos]).select().maybeSingle();
  if (error) return fallo(res, 500, error.message);
  res.json({ error: false, vehiculo: data });
}));

router.patch("/vehiculos/:id", ruta(async (req, res) => {
  const { usuario_id, usuario_nombre, id, created_at, asa_flota_conductores, resumen, ...campos } = req.body || {};
  const { data, error } = await supabase.from("asa_flota_vehiculos")
    .update({ ...campos, updated_at: new Date().toISOString() })
    .eq("id", Number(req.params.id)).select().maybeSingle();
  if (error) return fallo(res, 500, error.message);
  res.json({ error: false, vehiculo: data });
}));

/**
 * Cuenta lo que se llevaria por delante borrar un vehiculo.
 *
 * Todas las tablas del modulo cuelgan de `vehiculo_id` con ON DELETE CASCADE,
 * asi que borrar la unidad borra tambien sus partes, gastos, fotos y fallas.
 * La pantalla enseña estos numeros antes de preguntar: "vas a borrar 340
 * partes y 52 gastos" frena a cualquiera, "¿seguro?" no frena a nadie.
 */
async function dependenciasVehiculo(id) {
  const tablas = [
    ["chequeos",       "asa_flota_chequeos"],
    ["gastos",         "asa_flota_gastos"],
    ["fotos",          "asa_flota_fotos"],
    ["fallas",         "asa_flota_fallas_reportadas"],
    ["documentos",     "asa_flota_documentos"],
    ["mantenimientos", "asa_flota_mantenimientos"],
    ["asignaciones",   "asa_flota_asignaciones"],
  ];
  const out = {};
  for (const [clave, tabla] of tablas) {
    const { count } = await supabase.from(tabla)
      .select("*", { count: "exact", head: true }).eq("vehiculo_id", id);
    out[clave] = count || 0;
  }
  return out;
}

/** Lo mismo para un conductor. */
async function dependenciasConductor(id) {
  const tablas = [
    ["chequeos",     "asa_flota_chequeos"],
    ["gastos",       "asa_flota_gastos"],
    ["fotos",        "asa_flota_fotos"],
    ["fallas",       "asa_flota_fallas_reportadas"],
    ["asignaciones", "asa_flota_asignaciones"],
  ];
  const out = {};
  for (const [clave, tabla] of tablas) {
    const { count } = await supabase.from(tabla)
      .select("*", { count: "exact", head: true }).eq("conductor_id", id);
    out[clave] = count || 0;
  }
  const { count: veh } = await supabase.from("asa_flota_vehiculos")
    .select("*", { count: "exact", head: true }).eq("conductor_id", id);
  out.vehiculos_asignados = veh || 0;
  return out;
}

router.get("/vehiculos/:id/dependencias", ruta(async (req, res) => {
  res.json({ error: false, dependencias: await dependenciasVehiculo(Number(req.params.id)) });
}));

router.get("/conductores/:id/dependencias", ruta(async (req, res) => {
  res.json({ error: false, dependencias: await dependenciasConductor(Number(req.params.id)) });
}));

/**
 * DELETE /asa/vehiculos/:id            baja logica (activo = false)
 * DELETE /asa/vehiculos/:id?definitivo=1  borra de verdad, con todo su historial
 */
router.delete("/vehiculos/:id", ruta(async (req, res) => {
  const id = Number(req.params.id);

  if (req.query.definitivo !== "1") {
    const { error } = await supabase.from("asa_flota_vehiculos")
      .update({ activo: false, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return fallo(res, 500, error.message);
    return res.json({ error: false, definitivo: false });
  }

  const borrado = await dependenciasVehiculo(id);

  // Los archivos del bucket no se van con el CASCADE: si no se quitan aqui,
  // quedan ocupando espacio para siempre sin ninguna fila que los nombre.
  const { data: fotos } = await supabase.from("asa_flota_fotos")
    .select("ruta").eq("vehiculo_id", id);
  const rutas = (fotos || []).map(f => f.ruta).filter(Boolean);
  for (let i = 0; i < rutas.length; i += 100) {
    // Que falle el borrado de una imagen no debe impedir borrar el vehiculo:
    // el archivo huerfano molesta menos que una unidad que no se deja quitar.
    try { await supabase.storage.from(BUCKET).remove(rutas.slice(i, i + 100)); }
    catch (e) { console.error("[asa] no se pudieron borrar fotos:", e.message); }
  }

  const { error } = await supabase.from("asa_flota_vehiculos").delete().eq("id", id);
  if (error) return fallo(res, 500, error.message);

  res.json({ error: false, definitivo: true, borrado, fotos_borradas: rutas.length });
}));


/**
 * POST /asa/asignaciones — entregar un vehículo a un conductor.
 *
 * Cierra la asignación anterior antes de abrir la nueva. Dos abiertas a la
 * vez dejarían sin respuesta la pregunta de quién lo tenía tal día.
 */
router.post("/asignaciones", ruta(async (req, res) => {
  const usuario = usuarioDe(req);
  const { vehiculo_id, conductor_id, km_entrega, motivo } = req.body || {};
  if (!vehiculo_id || !conductor_id) return fallo(res, 400, "Falta el vehículo o el conductor.");

  const hoy = hoyRD();
  await supabase.from("asa_flota_asignaciones")
    .update({ hasta: hoy, km_devuelve: num(km_entrega) })
    .eq("vehiculo_id", Number(vehiculo_id)).is("hasta", null);

  const { data, error } = await supabase.from("asa_flota_asignaciones").insert([{
    vehiculo_id: Number(vehiculo_id),
    conductor_id: Number(conductor_id),
    desde: hoy,
    km_entrega: num(km_entrega),
    motivo: motivo || null,
    asignado_por: usuario.nombre,
  }]).select().maybeSingle();
  if (error) return fallo(res, 500, error.message);

  await supabase.from("asa_flota_vehiculos")
    .update({ conductor_id: Number(conductor_id), updated_at: new Date().toISOString() })
    .eq("id", Number(vehiculo_id));

  res.json({ error: false, asignacion: data });
}));


// ═════════════════════════════════════════════════════════════════════════════
// CHEQUEOS Y FALLAS (LECTURA Y CIERRE)
// ═════════════════════════════════════════════════════════════════════════════

router.get("/chequeos", ruta(async (req, res) => {
  let q = supabase.from("asa_flota_chequeos").select("*, asa_flota_vehiculos(codigo,placa,marca,modelo)");
  if (req.query.vehiculo_id) q = q.eq("vehiculo_id", Number(req.query.vehiculo_id));
  if (req.query.conductor_id) q = q.eq("conductor_id", Number(req.query.conductor_id));
  if (req.query.desde) q = q.gte("fecha", req.query.desde);
  if (req.query.hasta) q = q.lte("fecha", req.query.hasta);
  if (req.query.fecha) q = q.eq("fecha", req.query.fecha);
  const { data, error } = await q.order("fecha", { ascending: false })
    .order("id", { ascending: false }).limit(Number(req.query.limite || 300));
  if (error) return fallo(res, 500, error.message);
  res.json({ error: false, chequeos: data || [] });
}));

router.get("/chequeos/:id", ruta(async (req, res) => {
  const id = Number(req.params.id);
  const [chq, items, fotos] = await Promise.all([
    supabase.from("asa_flota_chequeos").select("*, asa_flota_vehiculos(codigo,placa,marca,modelo)").eq("id", id).maybeSingle(),
    supabase.from("asa_flota_chequeo_items").select("*").eq("chequeo_id", id).order("item_codigo"),
    supabase.from("asa_flota_fotos").select("*").eq("chequeo_id", id),
  ]);
  if (!chq.data) return fallo(res, 404, "Ese chequeo no existe.");
  res.json({ error: false, chequeo: chq.data, items: items.data || [], fotos: fotos.data || [] });
}));

router.get("/fallas", ruta(async (req, res) => {
  let q = supabase.from("asa_flota_fallas_reportadas").select("*, asa_flota_vehiculos(codigo,placa,marca,modelo)");
  if (req.query.vehiculo_id) q = q.eq("vehiculo_id", Number(req.query.vehiculo_id));
  if (req.query.estado) q = q.eq("estado", req.query.estado);
  else q = q.in("estado", ["ABIERTA", "EN_REVISION", "EN_TALLER"]);
  const { data, error } = await q.order("ultima_vez", { ascending: false });
  if (error) return fallo(res, 500, error.message);

  const { data: frecuentes } = await supabase.from("asa_flota_v_fallas_frecuentes")
    .select("*").order("veces_total", { ascending: false }).limit(15);

  res.json({ error: false, fallas: data || [], frecuentes: frecuentes || [] });
}));

/** PATCH /asa/fallas/:id — mover de estado o cerrarla con su costo. */
router.patch("/fallas/:id", ruta(async (req, res) => {
  const usuario = usuarioDe(req);
  const { estado, nota, costo_reparacion } = req.body || {};
  const campos = {};
  if (estado) campos.estado = estado;
  if (nota !== undefined) campos.nota = nota;
  if (costo_reparacion !== undefined) campos.costo_reparacion = num(costo_reparacion);
  if (["RESUELTA", "DESCARTADA"].includes(estado)) {
    campos.resuelta_en = new Date().toISOString();
    campos.resuelta_por = usuario.nombre;
  }
  const { data, error } = await supabase.from("asa_flota_fallas_reportadas")
    .update(campos).eq("id", Number(req.params.id)).select().maybeSingle();
  if (error) return fallo(res, 500, error.message);
  res.json({ error: false, falla: data });
}));


// ═════════════════════════════════════════════════════════════════════════════
// FOTOS Y CONFIGURACIÓN
// ═════════════════════════════════════════════════════════════════════════════

router.get("/fotos", ruta(async (req, res) => {
  let q = supabase.from("asa_flota_fotos").select("*, asa_flota_vehiculos(codigo,placa)");
  if (req.query.vehiculo_id) q = q.eq("vehiculo_id", Number(req.query.vehiculo_id));
  if (req.query.fecha) q = q.eq("fecha", req.query.fecha);
  if (req.query.desde) q = q.gte("fecha", req.query.desde);
  const { data, error } = await q.order("fecha", { ascending: false })
    .order("id", { ascending: false }).limit(Number(req.query.limite || 200));
  if (error) return fallo(res, 500, error.message);
  res.json({ error: false, fotos: data || [] });
}));

router.delete("/fotos/:id", ruta(async (req, res) => {
  const id = Number(req.params.id);
  const { data: foto } = await supabase.from("asa_flota_fotos").select("ruta").eq("id", id).maybeSingle();
  if (foto?.ruta) {
    // Si el archivo ya no está, no importa: lo que molesta es la fila huérfana.
    await supabase.storage.from(BUCKET).remove([foto.ruta]).catch(() => {});
  }
  const { error } = await supabase.from("asa_flota_fotos").delete().eq("id", id);
  if (error) return fallo(res, 500, error.message);
  res.json({ error: false });
}));

router.get("/config", ruta(async (req, res) => {
  res.json({ error: false, config: await leerConfig() });
}));

router.put("/config", ruta(async (req, res) => {
  const { usuario_id, usuario_nombre, ...valor } = req.body || {};
  const { error } = await supabase.from("asa_config_sistema")
    .upsert([{ clave: "asa_flota_config", valor }], { onConflict: "clave" });
  if (error) return fallo(res, 500, error.message);
  res.json({ error: false, config: valor });
}));


/** GET /asa/salud — diagnóstico rápido cuando algo no aparece en pantalla. */
router.get("/salud", ruta(async (req, res) => {
  const tablas = [
    "asa_flota_conductores", "asa_flota_vehiculos", "asa_flota_asignaciones", "asa_flota_checklist_items",
    "asa_flota_fallas_catalogo", "asa_flota_chequeos", "asa_flota_chequeo_items",
    "asa_flota_fallas_reportadas", "asa_flota_fotos", "asa_flota_gastos", "asa_flota_documentos",
    "asa_flota_mantenimientos",
  ];
  const estado = {};
  for (const t of tablas) {
    const { count, error } = await supabase.from(t).select("*", { count: "exact", head: true });
    estado[t] = error ? `ERROR: ${error.message}` : count;
  }
  const vistas = {};
  for (const v of ["asa_flota_v_resumen_vehiculo", "asa_flota_v_documentos_alerta", "asa_flota_v_fallas_frecuentes"]) {
    const { error } = await supabase.from(v).select("*").limit(1);
    vistas[v] = error ? `ERROR: ${error.message}` : "OK";
  }
  const { data: buckets } = await supabase.storage.listBuckets();
  res.json({
    error: false,
    fecha_rd: hoyRD(),
    tablas: estado,
    vistas,
    bucket_fotos: (buckets || []).some(b => b.name === BUCKET) ? "OK" : "FALTA — corre la migración v32",
  });
}));


export default router;
