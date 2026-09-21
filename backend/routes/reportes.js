// routes/reportes.js — Histograma, tendencias y exportación a Excel
//
// Es lo que el hotel pide en auditoría y lo que tú necesitas para ver si una
// plaga está subiendo en un área antes de que se convierta en un problema.
import express from "express";
import ExcelJS from "exceljs";
import { supabase } from "../lib/supabaseClient.js";
import { exigirSitioPermitido, filtrarPorSitio } from "../middleware/auth.js";

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
