// routes/reportes.js — Histograma, tendencias y exportación a Excel
//
// Es lo que el hotel pide en auditoría y lo que tú necesitas para ver si una
// plaga está subiendo en un área antes de que se convierta en un problema.
import express from "express";
import ExcelJS from "exceljs";
import { supabase } from "../lib/supabaseClient.js";
import { exigirSitioPermitido, filtrarPorSitio, requireRol } from "../middleware/auth.js";
import { construirReporte, construirReportePendientes } from "../lib/reportePdf.js";
import { logAccion } from "../lib/auditoria.js";
import { leerEstadosPunto } from "./configuracion.js";
import { traerTodo, traerTodoComoRespuesta } from "../lib/paginar.js";

const router = express.Router();

// Periodo al que pertenece una fecha (YYYY-MM-DD) según cómo se agrupe.
// La semana arranca el domingo, igual que el histograma de siempre.
function cubetaDe(fecha, agrupar) {
  if (agrupar === "mes") return String(fecha).slice(0, 7);
  if (agrupar === "semana") {
    const d = new Date(fecha + "T12:00:00");
    d.setDate(d.getDate() - d.getDay());
    return d.toISOString().slice(0, 10);
  }
  return String(fecha).slice(0, 10);
}

// ── Plagas escritas en el checklist ─────────────────────────────────────────
//
// Preguntas que pueden traer plagas: se filtran en la base por el texto de la
// pregunta para no bajar todas las respuestas del período.
const PREGUNTAS_DE_PLAGA = [
  "plaga", "encontr", "observ", "evidencia", "conteo", "captura", "cantidad",
  "insecto", "individuo", "mosca", "cucaracha", "roedor", "raton", "ratón",
  "hormiga", "chinche", "mosquito",
].map((t) => `pregunta_texto.ilike.*${t}*`).join(",");

const sinAcentos = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Texto ("Moscas", "Cucaracha americana", "Capturas de roedor") → código de plaga
function plagaDeTexto(texto) {
  const t = sinAcentos(texto);
  if (/chinche/.test(t)) return "chinche";
  if (/cucaracha/.test(t)) return /americ/.test(t) ? "cucaracha_america" : "cucaracha_alemana";
  if (/mosquito|zancudo/.test(t)) return "mosquito";
  if (/mosca/.test(t)) return /fruta/.test(t) ? "mosca_fruta" : "mosca_domestica";
  if (/hormiga/.test(t)) return "hormiga";
  if (/\brata/.test(t)) return "roedor_rata";
  if (/roedor|raton/.test(t)) return "roedor_raton";
  if (/termita|comejen/.test(t)) return "termita";
  return null;
}

// Un número sin plaga en la pregunta ("Conteo de insectos en la lámina") se
// asigna por el tipo de punto: en una lámpara son moscas, en un cebadero roedores.
function plagaDelTipoPunto(tipo) {
  const t = sinAcentos(tipo);
  if (/lampara|mosca/.test(t)) return "mosca_domestica";
  if (/cebadero|roedor|estacion/.test(t)) return "roedor_raton";
  return null;
}

const NO_ES_CONTEO = /cebo|gramo|%|porcentaje|carga|dosis|producto|temperatura|litro|ml\b/;

function plagasDelChecklist(respuestas, plagaPorCodigo) {
  // Por inspección: los números mandan; una plaga solo marcada (sin número)
  // cuenta como 1 y queda señalada como "sin conteo".
  const porInsp = new Map();
  for (const r of respuestas) {
    const insp = r.asa_inspecciones;
    if (!insp) continue;
    if (!porInsp.has(insp.id)) porInsp.set(insp.id, { insp, numeros: new Map(), vistas: new Set() });
    const x = porInsp.get(insp.id);
    const texto = sinAcentos(r.pregunta_texto);
    const tipo = insp.asa_puntos_control?.asa_tipos_punto?.codigo;

    const n = Number(r.valor_numero);
    if (n > 0 && !NO_ES_CONTEO.test(texto) && /conteo|cuant|cantidad|captura|insecto|individuo|plaga|mosca|cucaracha|roedor|raton|hormiga|chinche|mosquito/.test(texto)) {
      const codigo = plagaDeTexto(texto) || plagaDelTipoPunto(tipo) || "otro";
      x.numeros.set(codigo, (x.numeros.get(codigo) || 0) + Math.round(n));
      continue;
    }
    if (r.valor_bool === true && /captur/.test(texto) && /roedor|raton|rata/.test(texto)) {
      x.vistas.add(plagaDeTexto(texto) || "roedor_raton");
      continue;
    }
    if (/plaga|encontr|observ|evidencia|indicio/.test(texto) && !/condicion|favorec/.test(texto)) {
      const opciones = Array.isArray(r.valor_opciones) ? r.valor_opciones : [];
      for (const o of [...opciones, r.valor_texto].filter(Boolean)) {
        const codigo = plagaDeTexto(o);
        if (codigo) x.vistas.add(codigo);
      }
    }
  }

  const salida = [];
  const fila = (codigo, cantidad, insp, sinConteo) => {
    const p = plagaPorCodigo.get(codigo) || plagaPorCodigo.get("otro") || { codigo, nombre: "Otra plaga", grupo: "otra" };
    salida.push({ cantidad, asa_plagas: p, asa_inspecciones: insp, sin_conteo: sinConteo });
  };
  for (const { insp, numeros, vistas } of porInsp.values()) {
    for (const [codigo, n] of numeros) fila(codigo, n, insp, false);
    for (const codigo of vistas) if (!numeros.has(codigo)) fila(codigo, 1, insp, true);
  }
  return salida;
}

// ─────────────────────────────────────────────────────────────────────────────
// Conteo de plagas según lo que reportó el técnico
//
// Suma las capturas (asa_capturas) de las inspecciones del período: cuántas
// de cada plaga, en qué período, por técnico y por área. Lo usan la pantalla
// "Plagas encontradas" del panel y la gráfica de barras del PDF, así que los
// dos dicen exactamente lo mismo.
//
// No se apoya en la vista de servicios (que en el PDF lleva tope de filas):
// va directo a las capturas, por páginas, para que el total sea el real aunque
// el período tenga miles de inspecciones.
// ─────────────────────────────────────────────────────────────────────────────
export async function contarPlagas(req, { sitio_id, desde, hasta, agrupar = "semana", tecnico_id } = {}) {
  const EMBED_INSP = `asa_inspecciones!inner(id, fecha_local, sitio_id, tecnico_id, area_id, motivo_no_realizado,
          asa_empleados(nombre_completo), asa_areas(nombre), asa_sitios(nombre),
          asa_puntos_control(codigo_visible, numero_habitacion, asa_tipos_punto(codigo)))`;
  const filtrar = (q) => {
    q = q
      .gte("asa_inspecciones.fecha_local", desde)
      .lte("asa_inspecciones.fecha_local", hasta)
      .is("asa_inspecciones.motivo_no_realizado", null)
      .order("id");
    if (tecnico_id) q = q.eq("asa_inspecciones.tecnico_id", tecnico_id);
    return sitio_id
      ? q.eq("asa_inspecciones.sitio_id", sitio_id)
      : filtrarPorSitio(q, req, "asa_inspecciones.sitio_id");
  };

  // 1. El contador de plagas de la app (asa_capturas)
  const capturas = await traerTodo(() =>
    filtrar(supabase.from("asa_capturas").select(`id, cantidad, plaga_id, asa_plagas(codigo, nombre, grupo, color, umbral_alerta), ${EMBED_INSP}`))
  );

  // 2. Lo que el técnico escribió en el checklist. Muchos puntos no tienen el
  //    contador (su tipo no tiene plagas asignadas) y el técnico lo anota en
  //    preguntas como "Conteo de insectos en la lámina", "Capturas
  //    encontradas" o "Plagas observadas: Moscas, Cucarachas". Antes eso no
  //    contaba en ningún lado. Solo se usa en inspecciones SIN conteo en el
  //    contador, para no sumar dos veces lo mismo.
  const [respuestas, catalogo] = await Promise.all([
    traerTodo(() =>
      filtrar(
        supabase
          .from("asa_inspeccion_respuestas")
          .select(`id, pregunta_texto, valor_numero, valor_bool, valor_texto, valor_opciones, ${EMBED_INSP}`)
          .or(PREGUNTAS_DE_PLAGA)
      )
    ),
    supabase.from("asa_plagas").select("codigo, nombre, grupo, color, umbral_alerta"),
  ]);
  const plagaPorCodigo = new Map((catalogo.data || []).map((p) => [p.codigo, p]));
  const conContador = new Set(capturas.map((c) => c.asa_inspecciones?.id));
  const delChecklist = plagasDelChecklist(respuestas.filter((r) => !conContador.has(r.asa_inspecciones?.id)), plagaPorCodigo);

  const filas = [
    ...capturas.map((c) => ({ cantidad: c.cantidad, asa_plagas: c.asa_plagas, asa_inspecciones: c.asa_inspecciones, sin_conteo: false })),
    ...delChecklist,
  ];

  const porPlaga = new Map();
  const porPeriodo = new Map();
  const porTecnico = new Map();
  const porArea = new Map();
  const corte = mitadPeriodo(desde, hasta);

  for (const c of filas) {
    const n = Number(c.cantidad) || 0;
    const insp = c.asa_inspecciones || {};
    const nombre = c.asa_plagas?.nombre || "Sin clasificar";

    if (!porPlaga.has(nombre)) {
      porPlaga.set(nombre, {
        plaga: nombre,
        codigo: c.asa_plagas?.codigo || null,
        grupo: c.asa_plagas?.grupo || "otra",
        color: c.asa_plagas?.color || null,
        umbral: c.asa_plagas?.umbral_alerta ?? null,
        total: 0, registros: 0, maximo: 0, sobre_umbral: 0, reciente: 0, previo: 0, sin_conteo: 0,
        puntos: new Set(),
      });
    }
    const p = porPlaga.get(nombre);
    p.total += n;
    p.registros++;
    if (c.sin_conteo) p.sin_conteo++;
    p.maximo = Math.max(p.maximo, n);
    if (p.umbral != null && p.umbral > 0 && n > p.umbral) p.sobre_umbral++;
    if (insp.fecha_local >= corte) p.reciente += n; else p.previo += n;
    const punto = insp.asa_puntos_control;
    if (punto) p.puntos.add(punto.codigo_visible || punto.numero_habitacion);

    const k = cubetaDe(insp.fecha_local, agrupar);
    if (!porPeriodo.has(k)) porPeriodo.set(k, {});
    porPeriodo.get(k)[nombre] = (porPeriodo.get(k)[nombre] || 0) + n;

    const tec = insp.asa_empleados?.nombre_completo || "Sin técnico registrado";
    if (!porTecnico.has(tec)) porTecnico.set(tec, { tecnico: tec, total: 0, registros: 0, plagas: {} });
    const t = porTecnico.get(tec);
    t.total += n;
    t.registros++;
    t.plagas[nombre] = (t.plagas[nombre] || 0) + n;

    const area = [insp.asa_sitios?.nombre && !sitio_id ? insp.asa_sitios.nombre : null, insp.asa_areas?.nombre || "Sin área"]
      .filter(Boolean).join(" · ");
    if (!porArea.has(area)) porArea.set(area, { area, total: 0, plagas: {} });
    const a = porArea.get(area);
    a.total += n;
    a.plagas[nombre] = (a.plagas[nombre] || 0) + n;
  }

  const plagas = [...porPlaga.values()]
    .map(({ puntos, ...p }) => ({
      ...p,
      puntos: puntos.size,
      variacion_pct: p.previo > 0 ? Number((((p.reciente - p.previo) / p.previo) * 100).toFixed(0)) : null,
      tendencia: p.previo === 0 ? (p.reciente > 0 ? "nueva" : "estable")
        : p.reciente > p.previo * 1.15 ? "sube"
        : p.reciente < p.previo * 0.85 ? "baja" : "estable",
    }))
    .sort((a, b) => b.total - a.total || a.plaga.localeCompare(b.plaga, "es"));

  const series = plagas.map((p) => p.plaga);
  const colores = Object.fromEntries(plagas.filter((p) => p.color).map((p) => [p.plaga, p.color]));

  return {
    desde,
    hasta,
    agrupar,
    total_individuos: plagas.reduce((s, p) => s + p.total, 0),
    registros: filas.length,
    // Plagas que el técnico marcó en el checklist sin decir cuántas: cuentan 1.
    registros_sin_conteo: filas.filter((f) => f.sin_conteo).length,
    plagas,
    series,
    colores,
    periodos: [...porPeriodo.keys()].sort().map((k) => ({
      periodo: k,
      total: Object.values(porPeriodo.get(k)).reduce((s, v) => s + v, 0),
      ...Object.fromEntries(series.map((s) => [s, porPeriodo.get(k)[s] || 0])),
    })),
    por_tecnico: [...porTecnico.values()].sort((a, b) => b.total - a.total),
    por_area: [...porArea.values()].sort((a, b) => b.total - a.total),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /reportes/plagas?sitio_id=&desde=&hasta=&agrupar=dia|semana|mes&tecnico_id=
// Cuántas plagas de cada tipo reportaron los técnicos, y en qué período.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/plagas", async (req, res) => {
  const { sitio_id, tecnico_id } = req.query;
  if (sitio_id && !exigirSitioPermitido(req, res, sitio_id)) return;
  const agrupar = ["dia", "semana", "mes"].includes(req.query.agrupar) ? req.query.agrupar : "semana";
  const desde = req.query.desde || haceDias(30);
  const hasta = req.query.hasta || hoyRD();
  try {
    res.json(await contarPlagas(req, { sitio_id, desde, hasta, agrupar, tecnico_id }));
  } catch (e) {
    res.status(500).json({ error: true, mensaje: e.message });
  }
});

const hoyRD = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
const haceDias = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /reportes/resumen?sitio_id= — los números de arriba del dashboard
// ─────────────────────────────────────────────────────────────────────────────
router.get("/resumen", async (req, res) => {
  const { sitio_id } = req.query;
  if (sitio_id && !exigirSitioPermitido(req, res, sitio_id)) return;

  const desde = req.query.desde || haceDias(30);
  const hoy = hoyRD();

  const armarPuntos = () => {
    const q = supabase.from("asa_v_puntos_estado").select("*").order("id");
    return sitio_id ? q.eq("sitio_id", sitio_id) : filtrarPorSitio(q, req);
  };
  let qInsp = supabase.from("asa_inspecciones").select("fecha_local, nivel_actividad, estado_punto, sitio_id").gte("fecha_local", desde);
  let qHall = supabase.from("asa_hallazgos").select("estado, severidad, sitio_id");

  if (sitio_id) {
    qInsp = qInsp.eq("sitio_id", sitio_id);
    qHall = qHall.eq("sitio_id", sitio_id);
  } else {
    qInsp = filtrarPorSitio(qInsp, req);
    qHall = filtrarPorSitio(qHall, req);
  }

  const [puntos, insp, hall] = await Promise.all([traerTodoComoRespuesta(armarPuntos), qInsp, qHall]);
  if (puntos.error) return res.status(500).json({ error: true, mensaje: puntos.error.message });

  const P = puntos.data || [];
  const I = insp.data || [];
  const H = hall.data || [];
  const hechosHoy = I.filter((i) => i.fecha_local === hoy).length;

  res.json({
    desde,
    hasta: hoy,
    puntos_total: P.length,
    puntos_vencidos: P.filter((p) => p.vencido).length,
    inspecciones_hoy: hechosHoy,
    pendientes_hoy: Math.max(P.filter((p) => p.frecuencia !== "por_orden").length - hechosHoy, 0),
    inspecciones_periodo: I.length,
    con_actividad: I.filter((i) => i.nivel_actividad !== "ninguna").length,
    actividad_alta: I.filter((i) => i.nivel_actividad === "alto").length,
    puntos_dañados: I.filter((i) => ["dañado", "faltante"].includes(i.estado_punto)).length,
    hallazgos_abiertos: H.filter((h) => h.estado === "abierto" || h.estado === "en_proceso").length,
    hallazgos_criticos: H.filter((h) => h.severidad === "critica" && h.estado !== "corregido").length,
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// GET /reportes/tablero?sitio_id=&dias=30
//
// Los indicadores del dashboard, calculados en el servidor para que el panel
// no tenga que traerse miles de filas y procesarlas en el navegador.
//
// Devuelve cuatro bloques:
//   tecnicos   — quién produce menos incidencias (y cuántas inspecciones hizo,
//                porque un técnico con 3 inspecciones y 0 incidencias no es
//                mejor que uno con 300 y 4)
//   plagas     — ranking de plagas por cantidad capturada, con su tendencia
//                comparando la mitad reciente del período contra la anterior
//   operacion  — ritmo de trabajo: inspecciones por día, días trabajados,
//                puntos al día y vencidos
//   ordenes    — qué tan rápido se atiende una orden desde que entra
// ─────────────────────────────────────────────────────────────────────────────
router.get("/tablero", async (req, res) => {
  const { sitio_id } = req.query;
  if (sitio_id && !exigirSitioPermitido(req, res, sitio_id)) return;

  const dias = Math.min(Number(req.query.dias) || 30, 365);
  const desde = haceDias(dias);
  const hoy = hoyRD();
  // Punto de corte para la tendencia: la mitad del período
  const corte = haceDias(Math.floor(dias / 2));

  let qInsp = supabase
    .from("asa_inspecciones")
    .select("id, fecha_local, nivel_actividad, estado_punto, tecnico_id, sitio_id, asa_empleados(nombre_completo)")
    .gte("fecha_local", desde)
    .limit(20000);
  const armarPuntos = () => {
    const q = supabase.from("asa_v_puntos_estado").select("vencido, frecuencia, sitio_id").order("id");
    return sitio_id ? q.eq("sitio_id", sitio_id) : filtrarPorSitio(q, req);
  };
  let qOrdenes = supabase
    .from("asa_ordenes_trabajo")
    .select("id, estado, prioridad, tecnico_id, fecha_solicitud, fecha_agendada, fecha_ejecucion, sitio_id")
    .gte("fecha_solicitud", desde + "T00:00:00");

  if (sitio_id) {
    qInsp = qInsp.eq("sitio_id", sitio_id);
    qOrdenes = qOrdenes.eq("sitio_id", sitio_id);
  } else {
    qInsp = filtrarPorSitio(qInsp, req);
    qOrdenes = filtrarPorSitio(qOrdenes, req);
  }

  const [insp, puntos, ordenes, capturas] = await Promise.all([
    qInsp,
    traerTodoComoRespuesta(armarPuntos),
    qOrdenes,
    // Las capturas no tienen sitio_id propio: cuelgan de la inspección, así que
    // se filtran después contra los ids que sí pasaron el filtro de arriba.
    supabase
      .from("asa_capturas")
      .select("cantidad, inspeccion_id, asa_plagas(nombre, grupo, color), asa_inspecciones(fecha_local, sitio_id)")
      .gte("asa_inspecciones.fecha_local", desde)
      .limit(20000),
  ]);

  if (insp.error) return res.status(500).json({ error: true, mensaje: insp.error.message });

  const I = insp.data || [];
  const P = puntos.data || [];
  const O = ordenes.data || [];
  const C = (capturas.data || []).filter(
    (c) => c.asa_inspecciones && (!sitio_id || c.asa_inspecciones.sitio_id === sitio_id)
  );

  // ── Técnicos ──────────────────────────────────────────────────────────────
  const porTecnico = new Map();
  for (const i of I) {
    const k = i.tecnico_id || "sin_asignar";
    if (!porTecnico.has(k)) {
      porTecnico.set(k, {
        tecnico_id: i.tecnico_id,
        nombre: i.asa_empleados?.nombre_completo || "Sin técnico asignado",
        inspecciones: 0,
        incidencias: 0,
        actividad_alta: 0,
        puntos_dañados: 0,
      });
    }
    const t = porTecnico.get(k);
    t.inspecciones++;
    if (i.nivel_actividad && i.nivel_actividad !== "ninguna") t.incidencias++;
    if (i.nivel_actividad === "alto") t.actividad_alta++;
    if (["dañado", "faltante"].includes(i.estado_punto)) t.puntos_dañados++;
  }
  const tecnicos = [...porTecnico.values()]
    .map((t) => ({
      ...t,
      tasa_incidencia: t.inspecciones ? Number(((t.incidencias / t.inspecciones) * 100).toFixed(1)) : 0,
    }))
    // Menos incidencias primero, pero solo cuenta quien tiene volumen real
    .sort((a, b) => a.tasa_incidencia - b.tasa_incidencia || b.inspecciones - a.inspecciones);

  // ── Plagas y tendencia ────────────────────────────────────────────────────
  const porPlaga = new Map();
  for (const c of C) {
    const nombre = c.asa_plagas?.nombre || "Sin clasificar";
    if (!porPlaga.has(nombre)) {
      porPlaga.set(nombre, {
        plaga: nombre,
        grupo: c.asa_plagas?.grupo || "otra",
        color: c.asa_plagas?.color || null,
        total: 0,
        reciente: 0,
        previo: 0,
        registros: 0,
      });
    }
    const p = porPlaga.get(nombre);
    p.total += c.cantidad || 0;
    p.registros++;
    if (c.asa_inspecciones.fecha_local >= corte) p.reciente += c.cantidad || 0;
    else p.previo += c.cantidad || 0;
  }
  const plagas = [...porPlaga.values()]
    .map((p) => ({
      ...p,
      // Sin base previa no hay porcentaje que calcular: se informa como nueva
      variacion_pct: p.previo > 0 ? Number((((p.reciente - p.previo) / p.previo) * 100).toFixed(0)) : null,
      tendencia: p.previo === 0 ? (p.reciente > 0 ? "nueva" : "estable")
        : p.reciente > p.previo * 1.15 ? "sube"
        : p.reciente < p.previo * 0.85 ? "baja"
        : "estable",
    }))
    .sort((a, b) => b.total - a.total);

  // ── Ritmo de operación ────────────────────────────────────────────────────
  const diasTrabajados = new Set(I.map((i) => i.fecha_local)).size;
  const programables = P.filter((p) => p.frecuencia !== "por_orden");
  const operacion = {
    dias_periodo: dias,
    dias_trabajados: diasTrabajados,
    inspecciones_periodo: I.length,
    promedio_diario: diasTrabajados ? Number((I.length / diasTrabajados).toFixed(1)) : 0,
    inspecciones_hoy: I.filter((i) => i.fecha_local === hoy).length,
    puntos_programables: programables.length,
    puntos_vencidos: programables.filter((p) => p.vencido).length,
    cumplimiento_pct: programables.length
      ? Number((((programables.length - programables.filter((p) => p.vencido).length) / programables.length) * 100).toFixed(1))
      : 100,
  };

  // ── Órdenes de trabajo: rapidez de atención ───────────────────────────────
  const horas = (a, b) => (new Date(b) - new Date(a)) / 3600000;
  const atendidas = O.filter((o) => o.fecha_ejecucion && o.fecha_solicitud);
  const tiempos = atendidas.map((o) => horas(o.fecha_solicitud, o.fecha_ejecucion)).filter((h) => h >= 0);
  const mediana = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return Number((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(1));
  };

  const porTecnicoOT = new Map();
  for (const o of atendidas) {
    const k = o.tecnico_id || "sin_asignar";
    if (!porTecnicoOT.has(k)) porTecnicoOT.set(k, { tecnico_id: o.tecnico_id, atendidas: 0, horas: [] });
    const t = porTecnicoOT.get(k);
    t.atendidas++;
    t.horas.push(horas(o.fecha_solicitud, o.fecha_ejecucion));
  }

  const ordenesBloque = {
    recibidas: O.length,
    abiertas: O.filter((o) => !["completada", "cancelada"].includes(o.estado)).length,
    atendidas: atendidas.length,
    // La mediana aguanta mejor los casos raros que el promedio: una orden que
    // quedó abierta tres semanas no distorsiona el indicador.
    horas_mediana: mediana(tiempos),
    horas_promedio: tiempos.length ? Number((tiempos.reduce((a, b) => a + b, 0) / tiempos.length).toFixed(1)) : null,
    dentro_24h: tiempos.filter((h) => h <= 24).length,
    por_tecnico: [...porTecnicoOT.values()]
      .map((t) => ({ tecnico_id: t.tecnico_id, atendidas: t.atendidas, horas_mediana: mediana(t.horas) }))
      .sort((a, b) => (a.horas_mediana ?? 1e9) - (b.horas_mediana ?? 1e9)),
  };

  res.json({ desde, hasta: hoy, dias, tecnicos, plagas, operacion, ordenes: ordenesBloque });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /reportes/tecnicos?dias=7&sitio_id=
//
// Quién está subiendo su trabajo y cuánto. Es la pantalla "Técnicos" del
// panel: la usa la oficina para saber, en el día, quién ya subió y quién no,
// y en el período, quién lleva más registros y cómo va cada uno.
//
// Solo personal de ASA: el hotel no ve el desempeño de los técnicos.
//
// Por cada técnico:
//   registros, hechos, no_realizados, hoy, dias_activos, promedio_dia,
//   con_foto_pct, con_actividad, plantas, tipos, ultimo, participacion_pct,
//   indice (0–100) y sus últimos registros.
//
// El índice junta cuatro cosas, para que no gane solo el que sube rápido y
// sin evidencia:
//   50 % volumen      — sus registros contra los del técnico que más subió
//   20 % constancia   — días que subió, de los días en que hubo operación
//   15 % efectividad  — de lo que registró, cuánto sí se pudo hacer
//   15 % evidencia    — de lo hecho, cuánto lleva al menos una foto
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/tecnicos",
  requireRol("admin", "comercial", "operaciones", "contabilidad", "nomina"),
  async (req, res) => {
    const { sitio_id } = req.query;
    if (sitio_id && !exigirSitioPermitido(req, res, sitio_id)) return;

    const dias = Math.min(Math.max(Number(req.query.dias) || 7, 1), 90);
    const hoy = hoyRD();
    const desde = dias === 1 ? hoy : haceDias(dias - 1);

    // PostgREST corta en 1000 filas: se pide por páginas.
    const filas = [];
    for (let ini = 0; ; ini += 1000) {
      let q = supabase
        .from("asa_inspecciones")
        .select(`
          id, fecha, fecha_local, sitio_id, tecnico_id, usuario_id,
          motivo_no_realizado, nivel_actividad, fotos, metodo_acceso,
          asa_empleados(nombre_completo),
          asa_usuarios(nombre_completo),
          asa_sitios(nombre),
          asa_puntos_control(codigo_visible, nombre, numero_habitacion, asa_tipos_punto(nombre, icono))
        `)
        .gte("fecha_local", desde)
        .lte("fecha_local", hoy)
        .order("fecha", { ascending: false })
        .range(ini, ini + 999);
      q = sitio_id ? q.eq("sitio_id", sitio_id) : filtrarPorSitio(q, req);
      const { data, error } = await q;
      if (error) return res.status(500).json({ error: true, mensaje: error.message });
      filas.push(...(data || []));
      if (!data || data.length < 1000 || filas.length >= 50000) break;
    }

    // Todos los técnicos activos, aunque no hayan subido nada: el que no
    // aparece es justamente el que hay que ver.
    const { data: cuentas } = await supabase
      .from("asa_usuarios")
      .select("id, nombre_completo, empleado_id, ultimo_acceso")
      .eq("rol", "tecnico_plagas")
      .eq("activo", true);

    // Se agrupa por ficha de empleado; si el servicio no la tiene, por la
    // cuenta que lo subió (y esa cuenta se cruza con su empleado si lo tiene).
    const empleadoDeCuenta = new Map((cuentas || []).filter((c) => c.empleado_id).map((c) => [c.id, c.empleado_id]));
    const claveDe = (i) => i.tecnico_id || empleadoDeCuenta.get(i.usuario_id) || (i.usuario_id ? `u:${i.usuario_id}` : "sin");

    const porTecnico = new Map();
    const nuevo = (clave, nombre, extra = {}) => ({
      clave, nombre,
      registros: 0, hechos: 0, no_realizados: 0, hoy: 0, con_foto: 0, con_actividad: 0,
      dias: new Set(), plantas: new Map(), tipos: new Map(),
      ultimo: null, primero_hoy: null, recientes: [],
      ultimo_acceso: null,
      ...extra,
    });
    for (const c of cuentas || []) {
      const k = c.empleado_id || `u:${c.id}`;
      if (!porTecnico.has(k)) porTecnico.set(k, nuevo(k, c.nombre_completo, { ultimo_acceso: c.ultimo_acceso }));
    }

    const diasConOperacion = new Set();
    for (const i of filas) {
      const k = claveDe(i);
      const nombre = i.asa_empleados?.nombre_completo || i.asa_usuarios?.nombre_completo || "Sin técnico registrado";
      if (!porTecnico.has(k)) porTecnico.set(k, nuevo(k, nombre));
      const t = porTecnico.get(k);
      const hecho = !i.motivo_no_realizado;
      const fotos = Array.isArray(i.fotos) ? i.fotos.length : 0;
      const punto = i.asa_puntos_control || {};
      const tipo = punto.asa_tipos_punto || {};

      t.registros++;
      if (hecho) t.hechos++; else t.no_realizados++;
      if (hecho && fotos) t.con_foto++;
      if (hecho && i.nivel_actividad && i.nivel_actividad !== "ninguna") t.con_actividad++;
      if (i.fecha_local === hoy) {
        t.hoy++;
        if (!t.primero_hoy || i.fecha < t.primero_hoy) t.primero_hoy = i.fecha;
      }
      t.dias.add(i.fecha_local);
      diasConOperacion.add(i.fecha_local);
      if (!t.ultimo || i.fecha > t.ultimo) t.ultimo = i.fecha;
      const planta = i.asa_sitios?.nombre || "—";
      t.plantas.set(planta, (t.plantas.get(planta) || 0) + 1);
      const kt = tipo.nombre || "Otros";
      if (!t.tipos.has(kt)) t.tipos.set(kt, { nombre: kt, icono: tipo.icono || "", n: 0 });
      t.tipos.get(kt).n++;
      if (t.recientes.length < 15) {
        t.recientes.push({
          id: i.id,
          fecha: i.fecha,
          planta,
          punto: punto.numero_habitacion ? `Habitación ${punto.numero_habitacion}` : punto.nombre || punto.codigo_visible || "",
          codigo: punto.codigo_visible || "",
          tipo: kt,
          icono: tipo.icono || "",
          hecho,
          motivo: i.motivo_no_realizado || null,
          nivel_actividad: i.nivel_actividad,
          fotos,
        });
      }
    }

    const total = filas.length;
    const maxRegistros = Math.max(0, ...[...porTecnico.values()].map((t) => t.registros));
    const nDiasOp = diasConOperacion.size;
    const pct = (a, b) => (b ? Number(((a / b) * 100).toFixed(1)) : 0);

    const tecnicos = [...porTecnico.values()]
      .map((t) => {
        const volumen = maxRegistros ? t.registros / maxRegistros : 0;
        const constancia = nDiasOp ? t.dias.size / nDiasOp : 0;
        const efectividad = t.registros ? t.hechos / t.registros : 0;
        const evidencia = t.hechos ? t.con_foto / t.hechos : 0;
        const indice = t.registros
          ? Math.round((volumen * 0.5 + constancia * 0.2 + efectividad * 0.15 + evidencia * 0.15) * 100)
          : 0;
        return {
          clave: t.clave,
          nombre: t.nombre,
          registros: t.registros,
          hechos: t.hechos,
          no_realizados: t.no_realizados,
          hoy: t.hoy,
          primero_hoy: t.primero_hoy,
          ultimo: t.ultimo,
          ultimo_acceso: t.ultimo_acceso,
          dias_activos: t.dias.size,
          promedio_dia: t.dias.size ? Number((t.registros / t.dias.size).toFixed(1)) : 0,
          con_foto_pct: pct(t.con_foto, t.hechos),
          con_actividad: t.con_actividad,
          efectividad_pct: pct(t.hechos, t.registros),
          constancia_pct: pct(t.dias.size, nDiasOp),
          participacion_pct: pct(t.registros, total),
          indice,
          plantas: [...t.plantas.entries()].sort((a, b) => b[1] - a[1]).map(([nombre, n]) => ({ nombre, n })),
          tipos: [...t.tipos.values()].sort((a, b) => b.n - a.n),
          recientes: t.recientes,
        };
      })
      // El que más subió primero; a igualdad, el de mejor índice
      .sort((a, b) => b.registros - a.registros || b.indice - a.indice || a.nombre.localeCompare(b.nombre));

    const conRegistros = tecnicos.filter((t) => t.registros);
    res.json({
      desde,
      hasta: hoy,
      dias,
      total,
      hoy_total: filas.filter((i) => i.fecha_local === hoy).length,
      dias_con_operacion: nDiasOp,
      tecnicos,
      lider: conRegistros[0] || null,
      mejor_indice: [...conRegistros].sort((a, b) => b.indice - a.indice)[0] || null,
      activos_hoy: tecnicos.filter((t) => t.hoy).length,
      sin_registro_hoy: tecnicos.filter((t) => !t.hoy && !t.clave.startsWith("sin")).map((t) => t.nombre),
      truncado: filas.length >= 50000,
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /reportes/histograma?sitio_id=&desde=&hasta=&agrupar=dia|semana|mes&por=actividad|area|tipo
//
// Devuelve series listas para graficar, sin que el panel tenga que procesar.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/histograma", async (req, res) => {
  const { sitio_id, agrupar = "dia", por = "actividad" } = req.query;
  const desde = req.query.desde || haceDias(agrupar === "mes" ? 365 : 30);
  const hasta = req.query.hasta || hoyRD();

  if (sitio_id && !exigirSitioPermitido(req, res, sitio_id)) return;

  let q = supabase
    .from("asa_inspecciones")
    .select("fecha_local, nivel_actividad, estado_punto, area_id, sitio_id, asa_areas(nombre), asa_puntos_control(asa_tipos_punto(nombre, color))")
    .gte("fecha_local", desde)
    .lte("fecha_local", hasta)
    .limit(20000);

  q = sitio_id ? q.eq("sitio_id", sitio_id) : filtrarPorSitio(q, req);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const cubeta = (fecha) => {
    if (agrupar === "mes") return fecha.slice(0, 7);
    if (agrupar === "semana") {
      const d = new Date(fecha + "T12:00:00");
      d.setDate(d.getDate() - d.getDay());
      return d.toISOString().slice(0, 10);
    }
    return fecha;
  };

  const etiqueta = (i) => {
    if (por === "area") return i.asa_areas?.nombre || "Sin área";
    if (por === "tipo") return i.asa_puntos_control?.asa_tipos_punto?.nombre || "Otro";
    return i.nivel_actividad;
  };

  const mapa = new Map();
  const series = new Set();
  for (const i of data || []) {
    const c = cubeta(i.fecha_local);
    const s = etiqueta(i);
    series.add(s);
    if (!mapa.has(c)) mapa.set(c, {});
    mapa.get(c)[s] = (mapa.get(c)[s] || 0) + 1;
  }

  const periodos = [...mapa.keys()].sort();
  res.json({
    desde,
    hasta,
    agrupar,
    por,
    series: [...series],
    datos: periodos.map((p) => ({
      periodo: p,
      total: Object.values(mapa.get(p)).reduce((a, b) => a + b, 0),
      ...Object.fromEntries([...series].map((s) => [s, mapa.get(p)[s] || 0])),
    })),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /reportes/habitaciones?sitio_id=&dias=7
//
// Las habitaciones van en ciclo mensual, así que el hotel quiere ver qué se
// fumigó hoy y en los días anteriores, y cuáles llevan más de un mes sin tocar.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/habitaciones", async (req, res) => {
  const { sitio_id } = req.query;
  if (!sitio_id) return res.status(400).json({ error: true, mensaje: "sitio_id es requerido" });
  if (!exigirSitioPermitido(req, res, sitio_id)) return;

  const dias = Math.min(Number(req.query.dias) || 7, 90);

  const { data: puntos, error } = await traerTodoComoRespuesta(() => supabase
    .from("asa_v_puntos_estado")
    .select("*")
    .eq("sitio_id", sitio_id)
    .eq("tipo_codigo", "habitacion")
    .order("id"));
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const { data: insp } = await supabase
    .from("asa_inspecciones")
    .select("punto_id, fecha_local, estado_punto, nivel_actividad, asa_puntos_control(numero_habitacion, codigo_visible), asa_empleados(nombre_completo)")
    .eq("sitio_id", sitio_id)
    .gte("fecha_local", haceDias(dias))
    .order("fecha_local", { ascending: false });

  const porDia = {};
  for (const i of insp || []) {
    (porDia[i.fecha_local] = porDia[i.fecha_local] || []).push({
      habitacion: i.asa_puntos_control?.numero_habitacion || i.asa_puntos_control?.codigo_visible,
      estado: i.estado_punto,
      actividad: i.nivel_actividad,
      tecnico: i.asa_empleados?.nombre_completo || null,
    });
  }

  res.json({
    habitaciones_total: (puntos || []).length,
    al_dia: (puntos || []).filter((p) => !p.vencido).length,
    vencidas: (puntos || []).filter((p) => p.vencido).map((p) => ({
      habitacion: p.numero_habitacion || p.codigo_visible,
      ultima: p.ultima_inspeccion,
    })),
    por_dia: Object.entries(porDia)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([fecha, lista]) => ({ fecha, cantidad: lista.length, habitaciones: lista })),
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// EVIDENCIA PARA AUDITORIA
//
// GET /reportes/evidencia?sitio_id=&desde=&hasta=&agrupar=&detalle=
// GET /reportes/pdf?...   (lo mismo, ya armado en PDF)
//
// Es el reporte que el hotel pide cuando llega una auditoria: que se hizo, quien
// lo hizo, que se encontro, con que evidencia, y que NO se pudo hacer y por que.
//
// Las dos rutas usan la MISMA consulta (`juntarEvidencia`). Asi el PDF nunca
// dice algo distinto de lo que muestra la pantalla, que es como se pierde la
// confianza en un reporte.
// ═════════════════════════════════════════════════════════════════════════════
async function juntarEvidencia(req) {
  const { sitio_id } = req.query;
  const desde = req.query.desde || haceDias(30);
  const hasta = req.query.hasta || hoyRD();
  const agrupar = req.query.agrupar || "dia";
  const conDetalle = req.query.detalle !== "no";

  // Tope de servicios con detalle completo. Sin tope, pedir un ano de una planta
  // de 600 puntos arma un PDF de miles de paginas que nadie abre y que tumba el
  // servidor mientras lo genera.
  const tope = Math.min(Number(req.query.maximo) || 400, 1200);

  let qEmpresa = supabase.from("asa_config_sistema").select("valor").eq("clave", "empresa").maybeSingle();
  let qSitio = sitio_id
    ? supabase.from("asa_sitios").select("nombre, direccion, asa_clientes(razon_social, nombre_contacto)").eq("id", sitio_id).maybeSingle()
    : Promise.resolve({ data: null });

  let qServicios = supabase
    .from("asa_v_servicios_dia")
    .select("*")
    .gte("fecha_local", desde)
    .lte("fecha_local", hasta)
    .order("fecha", { ascending: true })
    .limit(tope);
  const armarPuntos = () => {
    const q = supabase
      .from("asa_v_puntos_estado")
      .select("vencido, frecuencia, sitio_id, area_nombre, tipo_nombre, ultima_inspeccion")
      .order("id");
    return sitio_id ? q.eq("sitio_id", sitio_id) : filtrarPorSitio(q, req);
  };
  let qHallazgos = supabase
    .from("asa_hallazgos")
    .select("id, titulo, descripcion, severidad, responsable, estado, fecha_reporte, fecha_limite, sitio_id, asa_areas(nombre)")
    .gte("fecha_reporte", desde)
    .order("fecha_reporte", { ascending: false });

  if (sitio_id) {
    qServicios = qServicios.eq("sitio_id", sitio_id);
    qHallazgos = qHallazgos.eq("sitio_id", sitio_id);
  } else {
    qServicios = filtrarPorSitio(qServicios, req);
    qHallazgos = filtrarPorSitio(qHallazgos, req);
  }

  const [empresa, sitio, servicios, puntos, hallazgos, estadosPunto] = await Promise.all([
    qEmpresa, qSitio, qServicios, traerTodoComoRespuesta(armarPuntos), qHallazgos, leerEstadosPunto(),
  ]);
  if (servicios.error) throw new Error(servicios.error.message);

  const S = servicios.data || [];
  const realizados = S.filter((x) => !x.no_realizado);
  const noRealizados = S.filter((x) => x.no_realizado);
  const ids = S.map((x) => x.inspeccion_id);

  // ── Respuestas, capturas y fotos de esos servicios ────────────────────────
  // En bloques de 200 ids: un `in` con 400 uuid pasa del largo maximo de URL
  // que acepta PostgREST y la consulta vuelve con un 414 que no dice nada.
  const respuestasPorInsp = new Map();
  const capturasPorInsp = new Map();
  const fotosPorInsp = new Map();

  if (conDetalle && ids.length) {
    for (let i = 0; i < ids.length; i += 200) {
      const lote = ids.slice(i, i + 200);
      const [resp, caps, insp] = await Promise.all([
        supabase.from("asa_inspeccion_respuestas").select("*").in("inspeccion_id", lote),
        supabase.from("asa_capturas").select("*, asa_plagas(nombre, grupo, icono, color, umbral_alerta)").in("inspeccion_id", lote),
        supabase.from("asa_inspecciones").select("id, fotos").in("id", lote),
      ]);
      for (const r of resp.data || []) {
        if (!respuestasPorInsp.has(r.inspeccion_id)) respuestasPorInsp.set(r.inspeccion_id, []);
        respuestasPorInsp.get(r.inspeccion_id).push(r);
      }
      for (const c of caps.data || []) {
        if (!capturasPorInsp.has(c.inspeccion_id)) capturasPorInsp.set(c.inspeccion_id, []);
        capturasPorInsp.get(c.inspeccion_id).push({
          ...c,
          plaga: c.asa_plagas?.nombre || "Sin clasificar",
          grupo: c.asa_plagas?.grupo || null,
          color: c.asa_plagas?.color || null,
          sobre_umbral: c.asa_plagas?.umbral_alerta != null ? c.cantidad > c.asa_plagas.umbral_alerta : null,
        });
      }
      for (const x of insp.data || []) fotosPorInsp.set(x.id, Array.isArray(x.fotos) ? x.fotos : []);
    }
  }

  const serviciosCompletos = realizados.map((x) => ({
    ...x,
    respuestas: respuestasPorInsp.get(x.inspeccion_id) || [],
    capturas: capturasPorInsp.get(x.inspeccion_id) || [],
    fotos: fotosPorInsp.get(x.inspeccion_id) || [],
  }));

  // ── Histograma por periodo y nivel de actividad ───────────────────────────
  const cubeta = (fecha) => {
    if (agrupar === "mes") return String(fecha).slice(0, 7);
    if (agrupar === "semana") {
      const d = new Date(fecha + "T12:00:00");
      d.setDate(d.getDate() - d.getDay());
      return d.toISOString().slice(0, 10);
    }
    return fecha;
  };
  const series = ["ninguna", "bajo", "medio", "alto"];
  const mapa = new Map();
  for (const x of realizados) {
    const c = cubeta(x.fecha_local);
    if (!mapa.has(c)) mapa.set(c, Object.fromEntries(series.map((s) => [s, 0])));
    const nivel = series.includes(x.nivel_actividad) ? x.nivel_actividad : "ninguna";
    mapa.get(c)[nivel]++;
  }
  const histograma = {
    agrupar,
    series,
    datos: [...mapa.keys()].sort().map((k) => ({ periodo: k, ...mapa.get(k), total: Object.values(mapa.get(k)).reduce((a, b) => a + b, 0) })),
  };

  // ── Plagas: cantidad por tipo y por periodo ───────────────────────────────
  // Sale de las capturas completas del periodo (no de los servicios con
  // detalle, que llevan tope), asi el total y las barras son los reales.
  const conteo = await contarPlagas(req, { sitio_id, desde, hasta, agrupar });
  const plagas = conteo.plagas;

  // ── Por area ──────────────────────────────────────────────────────────────
  const porArea = new Map();
  for (const x of S) {
    const k = x.area || "Sin area";
    if (!porArea.has(k)) porArea.set(k, { area: k, nivel: x.nivel, servicios: 0, con_actividad: 0, no_realizados: 0, plagas: 0 });
    const a = porArea.get(k);
    if (x.no_realizado) a.no_realizados++;
    else {
      a.servicios++;
      if (x.nivel_actividad && x.nivel_actividad !== "ninguna") a.con_actividad++;
    }
    a.plagas += x.plagas_total || 0;
  }

  const programables = (puntos.data || []).filter((p) => p.frecuencia !== "por_orden");
  const vencidos = programables.filter((p) => p.vencido).length;

  // Puntos programados que se quedaron sin atender, agrupados por area y tipo.
  // Van en la seccion "Servicios que NO se pudieron realizar" del PDF: sin esto
  // esa seccion decia "todo se ejecuto" aunque hubiera cientos de vencidos.
  const pend = new Map();
  for (const p of programables) {
    if (!p.vencido) continue;
    const k = `${p.area_nombre || "Sin area"}|${p.tipo_nombre || ""}`;
    if (!pend.has(k)) pend.set(k, { area: p.area_nombre || "Sin area", tipo: p.tipo_nombre || null, pendientes: 0, nunca: 0, ultima: null });
    const g = pend.get(k);
    g.pendientes++;
    if (!p.ultima_inspeccion) g.nunca++;
    else if (!g.ultima || p.ultima_inspeccion < g.ultima) g.ultima = p.ultima_inspeccion; // la mas vieja
  }
  const pendientesPorArea = [...pend.values()].sort(
    (a, b) => b.pendientes - a.pendientes || a.area.localeCompare(b.area, "es")
  );

  return {
    empresa: empresa.data?.valor || {},
    // Como los estados del punto se editan desde el panel, el reporte tiene que
    // imprimir la etiqueta de hoy y no una tabla de traducciones clavada en el
    // codigo: un estado nuevo saldria como "tapa_suelta" en plena auditoria.
    estados: Object.fromEntries(estadosPunto.map((e) => [e.codigo, e.etiqueta])),
    sitio: sitio.data
      ? {
          nombre: sitio.data.nombre,
          direccion: sitio.data.direccion,
          cliente: sitio.data.asa_clientes?.razon_social || sitio.data.asa_clientes?.nombre_contacto || null,
        }
      : null,
    periodo: { desde, hasta },
    resumen: {
      servicios_realizados: realizados.length,
      no_realizados: noRealizados.length,
      con_actividad: realizados.filter((x) => x.nivel_actividad && x.nivel_actividad !== "ninguna").length,
      plagas_contadas: conteo.total_individuos,
      tipos_plaga: conteo.plagas.filter((p) => p.total > 0).length,
      fotos: S.reduce((a, b) => a + (b.fotos_total || 0), 0),
      puntos_total: (puntos.data || []).length,
      puntos_vencidos: vencidos,
      cumplimiento_pct: programables.length
        ? Number((((programables.length - vencidos) / programables.length) * 100).toFixed(1))
        : 100,
      hallazgos_abiertos: (hallazgos.data || []).filter((h) => h.estado === "abierto" || h.estado === "en_proceso").length,
      tecnicos: [...new Set(S.map((x) => x.tecnico).filter(Boolean))],
      truncado: S.length >= tope,
    },
    histograma,
    plagas,
    // Barras de plagas por periodo: una barra por dia/semana/mes, partida por
    // tipo de plaga, con la cantidad de individuos que reportaron los tecnicos.
    plagas_periodo: {
      agrupar,
      series: conteo.series,
      colores: conteo.colores,
      datos: conteo.periodos,
      total: conteo.total_individuos,
    },
    plagas_por_tecnico: conteo.por_tecnico,
    por_area: [...porArea.values()].sort((a, b) => b.servicios - a.servicios),
    servicios: serviciosCompletos,
    no_realizados: noRealizados,
    pendientes_por_area: pendientesPorArea,
    hallazgos: (hallazgos.data || []).map((h) => ({ ...h, area: h.asa_areas?.nombre || null })),
  };
}

function mitadPeriodo(desde, hasta) {
  const a = new Date(desde + "T12:00:00").getTime();
  const b = new Date(hasta + "T12:00:00").getTime();
  return new Date(a + (b - a) / 2).toISOString().slice(0, 10);
}

// GET /reportes/evidencia — los mismos datos en JSON, para la pantalla
router.get("/evidencia", async (req, res) => {
  if (req.query.sitio_id && !exigirSitioPermitido(req, res, req.query.sitio_id)) return;
  try {
    res.json(await juntarEvidencia(req));
  } catch (e) {
    res.status(500).json({ error: true, mensaje: e.message });
  }
});

// GET /reportes/pdf — el PDF descargable
//
// Lo puede pedir tanto el panel de ASA como el portal del hotel: el filtro de
// alcance (`filtrarPorSitio`) ya limita lo que cada cuenta puede ver, asi que un
// encargado de calidad solo puede sacar el de SUS plantas.
router.get("/pdf", async (req, res) => {
  if (req.query.sitio_id && !exigirSitioPermitido(req, res, req.query.sitio_id)) return;

  try {
    const datos = await juntarEvidencia(req);
    const pdf = await construirReporte(datos, {
      fotos: req.query.fotos !== "no",
      detalle: req.query.detalle !== "no",
    });

    const nombre = `ASA-reporte-${(datos.sitio?.nombre || "general").replace(/[^\w]+/g, "-").toLowerCase()}-${datos.periodo.desde}-a-${datos.periodo.hasta}.pdf`;

    logAccion(req, {
      accion: "crear",
      modulo: "reportes",
      descripcion: `Reporte PDF de ${datos.sitio?.nombre || "todas las plantas"} (${datos.periodo.desde} a ${datos.periodo.hasta})`,
      detalle: { servicios: datos.servicios.length, no_realizados: datos.no_realizados.length },
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${nombre}"`);
    res.send(pdf);
  } catch (e) {
    console.error("[ASA][reportes/pdf]", e);
    res.status(500).json({ error: true, mensaje: `No se pudo generar el PDF: ${e.message}` });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// REPORTE APARTE: SOLO LO QUE NO SE HA REALIZADO
//
// GET /reportes/pendientes?sitio_id=&desde=&hasta=      (JSON, para pantalla)
// GET /reportes/pdf-pendientes?sitio_id=&desde=&hasta=  (el PDF)
//
// Antes esto iba dentro del reporte de evidencia, en la seccion "Servicios que
// NO se pudieron realizar". Se saco de alli para que el reporte de servicios
// muestre lo hecho, y lo pendiente se entregue por separado cuando se pida.
//
// Junta tres cosas:
//   1. Lo que el tecnico intento y no pudo hacer en el periodo (con el motivo
//      y de quien es la responsabilidad).
//   2. Los puntos programados que hoy estan fuera de su frecuencia, uno por uno
//      y resumidos por area.
//   3. Las habitaciones/puntos que el hotel pidio en una solicitud y siguen sin
//      hacerse.
// ═════════════════════════════════════════════════════════════════════════════
async function juntarPendientes(req) {
  const { sitio_id } = req.query;
  const desde = req.query.desde || haceDias(30);
  const hasta = req.query.hasta || hoyRD();

  const qEmpresa = supabase.from("asa_config_sistema").select("valor").eq("clave", "empresa").maybeSingle();
  const qSitio = sitio_id
    ? supabase.from("asa_sitios").select("nombre, direccion, asa_clientes(razon_social, nombre_contacto)").eq("id", sitio_id).maybeSingle()
    : Promise.resolve({ data: null });

  const armarNoRealizados = () => {
    const q = supabase
      .from("asa_v_servicios_dia")
      .select("*")
      .eq("no_realizado", true)
      .gte("fecha_local", desde)
      .lte("fecha_local", hasta)
      .order("fecha", { ascending: true })
      .order("inspeccion_id");
    return sitio_id ? q.eq("sitio_id", sitio_id) : filtrarPorSitio(q, req);
  };
  const armarPuntos = () => {
    const q = supabase
      .from("asa_v_puntos_estado")
      .select("*")
      .order("id");
    return sitio_id ? q.eq("sitio_id", sitio_id) : filtrarPorSitio(q, req);
  };
  let qSolicitudes = supabase
    .from("asa_orden_puntos")
    .select(`
      estado, motivo_no_realizado, created_at,
      asa_ordenes_trabajo!inner(numero_orden, estado, sitio_id, created_at, fecha_requerida, asa_sitios(nombre)),
      asa_puntos_control(codigo_visible, nombre, numero_habitacion, asa_areas(nombre))
    `)
    .in("estado", ["pendiente", "no_realizado"])
    .in("asa_ordenes_trabajo.estado", ["solicitada", "agendada", "en_ruta", "en_sitio"])
    .limit(5000);
  qSolicitudes = sitio_id
    ? qSolicitudes.eq("asa_ordenes_trabajo.sitio_id", sitio_id)
    : filtrarPorSitio(qSolicitudes, req, "asa_ordenes_trabajo.sitio_id");

  const [empresa, sitio, noRealizados, puntos, solicitudes, sitios] = await Promise.all([
    qEmpresa, qSitio, traerTodoComoRespuesta(armarNoRealizados), traerTodoComoRespuesta(armarPuntos), qSolicitudes,
    filtrarPorSitio(supabase.from("asa_sitios").select("id, nombre"), req, "id"),
  ]);
  const nombrePlanta = new Map((sitios.data || []).map((x) => [x.id, x.nombre]));
  if (noRealizados.error) throw new Error(noRealizados.error.message);
  if (puntos.error) throw new Error(puntos.error.message);

  const programables = (puntos.data || []).filter((p) => p.frecuencia !== "por_orden");
  const vencidos = programables
    .filter((p) => p.vencido)
    .map((p) => ({
      codigo: p.codigo_visible,
      punto: p.numero_habitacion ? `Habitación ${p.numero_habitacion}` : p.punto_nombre || p.codigo_visible,
      area: p.area_nombre || "Sin área",
      tipo: p.tipo_nombre || null,
      frecuencia: p.frecuencia,
      ultima: p.ultima_inspeccion || null,
      planta: nombrePlanta.get(p.sitio_id) || null,
    }))
    .sort((a, b) => a.area.localeCompare(b.area, "es") || String(a.codigo).localeCompare(String(b.codigo), "es", { numeric: true }));

  const pend = new Map();
  for (const p of vencidos) {
    const k = `${p.area}|${p.tipo || ""}`;
    if (!pend.has(k)) pend.set(k, { area: p.area, tipo: p.tipo, pendientes: 0, nunca: 0, ultima: null });
    const g = pend.get(k);
    g.pendientes++;
    if (!p.ultima) g.nunca++;
    else if (!g.ultima || p.ultima < g.ultima) g.ultima = p.ultima;
  }

  const NR = noRealizados.data || [];
  const DEL_HOTEL = ["permiso_denegado", "sin_llave", "huesped_en_habitacion", "area_ocupada", "evento_en_curso"];

  return {
    empresa: empresa.data?.valor || {},
    sitio: sitio.data
      ? {
          nombre: sitio.data.nombre,
          direccion: sitio.data.direccion,
          cliente: sitio.data.asa_clientes?.razon_social || sitio.data.asa_clientes?.nombre_contacto || null,
        }
      : null,
    periodo: { desde, hasta },
    resumen: {
      no_realizados: NR.length,
      no_realizados_hotel: NR.filter((n) => DEL_HOTEL.includes(n.motivo_no_realizado)).length,
      puntos_programables: programables.length,
      puntos_vencidos: vencidos.length,
      nunca_visitados: vencidos.filter((v) => !v.ultima).length,
      solicitudes_pendientes: (solicitudes.data || []).length,
    },
    no_realizados: NR,
    pendientes_por_area: [...pend.values()].sort((a, b) => b.pendientes - a.pendientes || a.area.localeCompare(b.area, "es")),
    puntos_vencidos: vencidos,
    solicitudes_pendientes: (solicitudes.data || []).map((s) => ({
      orden: s.asa_ordenes_trabajo?.numero_orden || "",
      planta: s.asa_ordenes_trabajo?.asa_sitios?.nombre || "",
      pedida: s.asa_ordenes_trabajo?.created_at || s.created_at,
      requerida: s.asa_ordenes_trabajo?.fecha_requerida || null,
      punto: s.asa_puntos_control?.numero_habitacion
        ? `Habitación ${s.asa_puntos_control.numero_habitacion}`
        : s.asa_puntos_control?.nombre || s.asa_puntos_control?.codigo_visible || "",
      area: s.asa_puntos_control?.asa_areas?.nombre || "",
      estado: s.estado,
      motivo: s.motivo_no_realizado || null,
    })),
  };
}

router.get("/pendientes", async (req, res) => {
  if (req.query.sitio_id && !exigirSitioPermitido(req, res, req.query.sitio_id)) return;
  try {
    res.json(await juntarPendientes(req));
  } catch (e) {
    res.status(500).json({ error: true, mensaje: e.message });
  }
});

router.get("/pdf-pendientes", async (req, res) => {
  if (req.query.sitio_id && !exigirSitioPermitido(req, res, req.query.sitio_id)) return;
  try {
    const datos = await juntarPendientes(req);
    const pdf = await construirReportePendientes(datos, { detallePuntos: req.query.puntos !== "no" });
    const nombre = `ASA-no-realizados-${(datos.sitio?.nombre || "general").replace(/[^\w]+/g, "-").toLowerCase()}-${datos.periodo.desde}-a-${datos.periodo.hasta}.pdf`;
    logAccion(req, {
      accion: "crear",
      modulo: "reportes",
      descripcion: `Reporte de no realizados de ${datos.sitio?.nombre || "todas las plantas"} (${datos.periodo.desde} a ${datos.periodo.hasta})`,
      detalle: datos.resumen,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${nombre}"`);
    res.send(pdf);
  } catch (e) {
    console.error("[ASA][reportes/pdf-pendientes]", e);
    res.status(500).json({ error: true, mensaje: `No se pudo generar el PDF: ${e.message}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /reportes/excel?sitio_id=&desde=&hasta= — descarga el .xlsx
// ─────────────────────────────────────────────────────────────────────────────
router.get("/excel", async (req, res) => {
  const { sitio_id } = req.query;
  if (!sitio_id) return res.status(400).json({ error: true, mensaje: "sitio_id es requerido" });
  if (!exigirSitioPermitido(req, res, sitio_id)) return;

  const desde = req.query.desde || haceDias(30);
  const hasta = req.query.hasta || hoyRD();

  const [sitio, puntos, inspecciones, hallazgos] = await Promise.all([
    supabase.from("asa_sitios").select("*, asa_clientes(razon_social, nombre_contacto)").eq("id", sitio_id).maybeSingle(),
    traerTodoComoRespuesta(() => supabase.from("asa_v_puntos_estado").select("*").eq("sitio_id", sitio_id).order("id")),
    supabase
      .from("asa_inspecciones")
      .select(`
        fecha, fecha_local, estado_punto, nivel_actividad, notas, metodo_acceso,
        asa_puntos_control(codigo_visible, nombre, numero_habitacion, asa_tipos_punto(nombre)),
        asa_areas(nombre),
        asa_empleados(nombre_completo)
      `)
      .eq("sitio_id", sitio_id)
      .gte("fecha_local", desde)
      .lte("fecha_local", hasta)
      .order("fecha", { ascending: false })
      .limit(20000),
    supabase.from("asa_hallazgos").select("*, asa_areas(nombre), asa_puntos_control(codigo_visible)").eq("sitio_id", sitio_id),
  ]);

  const nombreHotel = sitio.data?.nombre || "Hotel";
  const wb = new ExcelJS.Workbook();
  wb.creator = "Ambiente y Salud RD (ASA SRL)";
  wb.created = new Date();

  const VERDE = "FF16A34A";
  const encabezar = (ws, columnas) => {
    ws.columns = columnas;
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE } };
    ws.getRow(1).height = 22;
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };
  };

  // ── Hoja 1: Resumen ──
  const r = wb.addWorksheet("Resumen");
  r.columns = [{ width: 34 }, { width: 46 }];
  r.addRows([
    ["Ambiente y Salud RD (ASA SRL)", ""],
    ["Reporte de control de plagas", ""],
    ["", ""],
    ["Hotel", nombreHotel],
    ["Cliente", sitio.data?.asa_clientes?.razon_social || sitio.data?.asa_clientes?.nombre_contacto || ""],
    ["Dirección", sitio.data?.direccion || ""],
    ["Período", `${desde} a ${hasta}`],
    ["Generado", new Date().toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" })],
    ["", ""],
    ["Puntos de control activos", (puntos.data || []).length],
    ["Puntos al día", (puntos.data || []).filter((p) => !p.vencido).length],
    ["Puntos vencidos", (puntos.data || []).filter((p) => p.vencido).length],
    ["Inspecciones en el período", (inspecciones.data || []).length],
    ["Con actividad detectada", (inspecciones.data || []).filter((i) => i.nivel_actividad !== "ninguna").length],
    ["Actividad alta", (inspecciones.data || []).filter((i) => i.nivel_actividad === "alto").length],
    ["Hallazgos abiertos", (hallazgos.data || []).filter((h) => h.estado === "abierto" || h.estado === "en_proceso").length],
  ]);
  r.getRow(1).font = { bold: true, size: 14, color: { argb: VERDE } };
  r.getRow(2).font = { bold: true, size: 11 };
  for (const n of [4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16]) r.getRow(n).getCell(1).font = { bold: true };

  // ── Hoja 2: Inspecciones ──
  const i = wb.addWorksheet("Inspecciones");
  encabezar(i, [
    { header: "Fecha", key: "fecha", width: 20 },
    { header: "Área", key: "area", width: 24 },
    { header: "Código", key: "codigo", width: 12 },
    { header: "Punto / Habitación", key: "punto", width: 30 },
    { header: "Tipo", key: "tipo", width: 24 },
    { header: "Estado", key: "estado", width: 14 },
    { header: "Actividad", key: "actividad", width: 12 },
    { header: "Técnico", key: "tecnico", width: 26 },
    { header: "Registro", key: "metodo", width: 12 },
    { header: "Observaciones", key: "notas", width: 50 },
  ]);
  for (const x of inspecciones.data || []) {
    const fila = i.addRow({
      fecha: new Date(x.fecha).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" }),
      area: x.asa_areas?.nombre || "",
      codigo: x.asa_puntos_control?.codigo_visible || "",
      punto: x.asa_puntos_control?.numero_habitacion
        ? `Habitación ${x.asa_puntos_control.numero_habitacion}`
        : x.asa_puntos_control?.nombre || "",
      tipo: x.asa_puntos_control?.asa_tipos_punto?.nombre || "",
      estado: x.estado_punto,
      actividad: x.nivel_actividad,
      tecnico: x.asa_empleados?.nombre_completo || "",
      metodo: x.metodo_acceso === "qr" ? "QR" : x.metodo_acceso,
      notas: x.notas || "",
    });
    if (x.nivel_actividad === "alto") {
      fila.getCell("actividad").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFECACA" } };
      fila.getCell("actividad").font = { bold: true, color: { argb: "FFB91C1C" } };
    }
  }

  // ── Hoja 3: Puntos de control ──
  const p = wb.addWorksheet("Puntos de control");
  encabezar(p, [
    { header: "Código", key: "codigo", width: 12 },
    { header: "Área", key: "area", width: 24 },
    { header: "Punto", key: "nombre", width: 32 },
    { header: "Tipo", key: "tipo", width: 24 },
    { header: "Frecuencia", key: "frecuencia", width: 13 },
    { header: "Última inspección", key: "ultima", width: 20 },
    { header: "Estado", key: "estado", width: 14 },
    { header: "Al día", key: "aldia", width: 10 },
  ]);
  for (const x of puntos.data || []) {
    const fila = p.addRow({
      codigo: x.codigo_visible,
      area: x.area_nombre || "",
      nombre: x.numero_habitacion ? `Habitación ${x.numero_habitacion}` : x.punto_nombre || "",
      tipo: x.tipo_nombre,
      frecuencia: x.frecuencia,
      ultima: x.ultima_inspeccion
        ? new Date(x.ultima_inspeccion).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" })
        : "Nunca",
      estado: x.ultimo_estado || "",
      aldia: x.vencido ? "VENCIDO" : "Sí",
    });
    fila.getCell("aldia").font = { bold: true, color: { argb: x.vencido ? "FFB91C1C" : "FF15803D" } };
  }

  // ── Hoja 4: Hallazgos ──
  const h = wb.addWorksheet("Hallazgos");
  encabezar(h, [
    { header: "Fecha", key: "fecha", width: 14 },
    { header: "Área", key: "area", width: 24 },
    { header: "Punto", key: "punto", width: 14 },
    { header: "Hallazgo", key: "titulo", width: 46 },
    { header: "Severidad", key: "severidad", width: 12 },
    { header: "Responsable", key: "responsable", width: 14 },
    { header: "Estado", key: "estado", width: 16 },
    { header: "Límite", key: "limite", width: 13 },
    { header: "Descripción", key: "descripcion", width: 50 },
  ]);
  for (const x of hallazgos.data || []) {
    h.addRow({
      fecha: new Date(x.fecha_reporte).toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo" }),
      area: x.asa_areas?.nombre || "",
      punto: x.asa_puntos_control?.codigo_visible || "",
      titulo: x.titulo,
      severidad: x.severidad,
      responsable: x.responsable === "cliente" ? "Hotel" : "ASA",
      estado: x.estado,
      limite: x.fecha_limite || "",
      descripcion: x.descripcion || "",
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const archivo = `ASA-${nombreHotel.replace(/[^\w]+/g, "-")}-${desde}-a-${hasta}.xlsx`;

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${archivo}"`);
  res.send(Buffer.from(buffer));
});

export default router;
