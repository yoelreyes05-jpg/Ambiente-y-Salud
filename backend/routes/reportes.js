// routes/reportes.js — Histograma, tendencias y exportación a Excel
//
// Es lo que el hotel pide en auditoría y lo que tú necesitas para ver si una
// plaga está subiendo en un área antes de que se convierta en un problema.
import express from "express";
import ExcelJS from "exceljs";
import { supabase } from "../lib/supabaseClient.js";
import { exigirSitioPermitido, filtrarPorSitio } from "../middleware/auth.js";
import { construirReporte } from "../lib/reportePdf.js";
import { logAccion } from "../lib/auditoria.js";

const router = express.Router();

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

  let qPuntos = supabase.from("asa_v_puntos_estado").select("*");
  let qInsp = supabase.from("asa_inspecciones").select("fecha_local, nivel_actividad, estado_punto, sitio_id").gte("fecha_local", desde);
  let qHall = supabase.from("asa_hallazgos").select("estado, severidad, sitio_id");

  if (sitio_id) {
    qPuntos = qPuntos.eq("sitio_id", sitio_id);
    qInsp = qInsp.eq("sitio_id", sitio_id);
    qHall = qHall.eq("sitio_id", sitio_id);
  } else {
    qPuntos = filtrarPorSitio(qPuntos, req);
    qInsp = filtrarPorSitio(qInsp, req);
    qHall = filtrarPorSitio(qHall, req);
  }

  const [puntos, insp, hall] = await Promise.all([qPuntos, qInsp, qHall]);
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
  let qPuntos = supabase.from("asa_v_puntos_estado").select("vencido, frecuencia, sitio_id");
  let qOrdenes = supabase
    .from("asa_ordenes_trabajo")
    .select("id, estado, prioridad, tecnico_id, fecha_solicitud, fecha_agendada, fecha_ejecucion, sitio_id")
    .gte("fecha_solicitud", desde + "T00:00:00");

  if (sitio_id) {
    qInsp = qInsp.eq("sitio_id", sitio_id);
    qPuntos = qPuntos.eq("sitio_id", sitio_id);
    qOrdenes = qOrdenes.eq("sitio_id", sitio_id);
  } else {
    qInsp = filtrarPorSitio(qInsp, req);
    qPuntos = filtrarPorSitio(qPuntos, req);
    qOrdenes = filtrarPorSitio(qOrdenes, req);
  }

  const [insp, puntos, ordenes, capturas] = await Promise.all([
    qInsp,
    qPuntos,
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

  const { data: puntos, error } = await supabase
    .from("asa_v_puntos_estado")
    .select("*")
    .eq("sitio_id", sitio_id)
    .eq("tipo_codigo", "habitacion");
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
  let qPuntos = supabase.from("asa_v_puntos_estado").select("vencido, frecuencia, sitio_id");
  let qHallazgos = supabase
    .from("asa_hallazgos")
    .select("id, titulo, descripcion, severidad, responsable, estado, fecha_reporte, fecha_limite, sitio_id, asa_areas(nombre)")
    .gte("fecha_reporte", desde)
    .order("fecha_reporte", { ascending: false });

  if (sitio_id) {
    qServicios = qServicios.eq("sitio_id", sitio_id);
    qPuntos = qPuntos.eq("sitio_id", sitio_id);
    qHallazgos = qHallazgos.eq("sitio_id", sitio_id);
  } else {
    qServicios = filtrarPorSitio(qServicios, req);
    qPuntos = filtrarPorSitio(qPuntos, req);
    qHallazgos = filtrarPorSitio(qHallazgos, req);
  }

  const [empresa, sitio, servicios, puntos, hallazgos] = await Promise.all([
    qEmpresa, qSitio, qServicios, qPuntos, qHallazgos,
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

  // ── Plagas con tendencia ──────────────────────────────────────────────────
  const corte = mitadPeriodo(desde, hasta);
  const porPlaga = new Map();
  for (const s2 of serviciosCompletos) {
    for (const c of s2.capturas) {
      if (!porPlaga.has(c.plaga)) {
        porPlaga.set(c.plaga, { plaga: c.plaga, grupo: c.grupo, color: c.color, total: 0, registros: 0, maximo: 0, reciente: 0, previo: 0 });
      }
      const p = porPlaga.get(c.plaga);
      p.total += c.cantidad || 0;
      p.registros++;
      p.maximo = Math.max(p.maximo, c.cantidad || 0);
      if (s2.fecha_local >= corte) p.reciente += c.cantidad || 0;
      else p.previo += c.cantidad || 0;
    }
  }
  const plagas = [...porPlaga.values()]
    .map((p) => ({
      ...p,
      variacion_pct: p.previo > 0 ? Number((((p.reciente - p.previo) / p.previo) * 100).toFixed(0)) : null,
      tendencia: p.previo === 0 ? (p.reciente > 0 ? "nueva" : "estable")
        : p.reciente > p.previo * 1.15 ? "sube"
        : p.reciente < p.previo * 0.85 ? "baja" : "estable",
    }))
    .sort((a, b) => b.total - a.total);

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
      servicios_realizados: realizados.length,
      no_realizados: noRealizados.length,
      con_actividad: realizados.filter((x) => x.nivel_actividad && x.nivel_actividad !== "ninguna").length,
      plagas_contadas: S.reduce((a, b) => a + (b.plagas_total || 0), 0),
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
    por_area: [...porArea.values()].sort((a, b) => b.servicios - a.servicios),
    servicios: serviciosCompletos,
    no_realizados: noRealizados,
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
    supabase.from("asa_v_puntos_estado").select("*").eq("sitio_id", sitio_id),
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
