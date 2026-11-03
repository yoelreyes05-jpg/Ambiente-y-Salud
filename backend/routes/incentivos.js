// routes/incentivos.js — Evaluación de desempeño e incentivos (módulo Técnicos)
//
//   GET  /incentivos/plantilla                 preguntas, escala y columnas de ajuste
//   GET  /incentivos/colaboradores             lista (nombre, zona, cliente, sueldo…)
//   PUT  /incentivos/colaboradores             guarda la lista completa (solo admin)
//   GET  /incentivos/evaluaciones?mes=AAAA-MM  evaluaciones del mes
//   PUT  /incentivos/evaluaciones/:mes/:col    guarda una evaluación (calcula el %)
//   DELETE /incentivos/evaluaciones/:mes/:col
//   GET  /incentivos/:mes                      cálculo del incentivo de cada colaborador
//   PUT  /incentivos/:mes/:col                 ajustes del mes (bono, préstamos…)
//   GET  /incentivos/:mes/excel                Excel para el pago del día 5
//
// La lógica y el formulario están en lib/incentivos.js.

import express from "express";
import ExcelJS from "exceljs";
import { requireRol } from "../middleware/auth.js";
import {
  PLANTILLA, ESCALA, AJUSTES, plantilla, limpiarPlantilla, colaboradores, leer, escribir, mesValido,
  calcularEvaluacion, filaIncentivo, fechaPago, ultimoDia,
} from "../lib/incentivos.js";

const router = express.Router();
const evaluar = requireRol("admin", "operaciones");   // evaluar: admin y operaciones
const pagar = requireRol("admin");                     // sueldos e incentivos: solo admin

const err = (res, e, st = 500) => res.status(st).json({ error: true, mensaje: e.message || String(e) });
const fechaLarga = (d) => d.toLocaleDateString("es-DO", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

router.get("/plantilla", evaluar, async (req, res) => {
  try {
    const secciones = await plantilla();
    res.json({ secciones, escala: ESCALA, ajustes: AJUSTES, original: secciones === PLANTILLA });
  } catch (e) { err(res, e); }
});

// Cambiar los parámetros de la evaluación (solo admin). Las evaluaciones ya
// guardadas conservan su % (no se recalculan).
router.put("/plantilla", pagar, async (req, res) => {
  try {
    if (req.body?.restaurar) { await escribir("evaluacion_plantilla", []); return res.json({ secciones: PLANTILLA }); }
    const secciones = limpiarPlantilla(req.body?.secciones);
    await escribir("evaluacion_plantilla", secciones);
    res.json({ secciones });
  } catch (e) { err(res, e, 400); }
});

router.get("/colaboradores", evaluar, async (req, res) => {
  try {
    const lista = await colaboradores();
    // operaciones evalúa, pero no ve sueldos
    res.json(req.usuario.rol === "admin" ? lista : lista.map(({ sueldo, base, ...c }) => c));
  } catch (e) { err(res, e); }
});

router.put("/colaboradores", pagar, async (req, res) => {
  try {
    const lista = Array.isArray(req.body) ? req.body : req.body?.colaboradores;
    if (!Array.isArray(lista)) return err(res, new Error("Lista inválida"), 400);
    const limpia = lista.filter((c) => String(c.nombre || "").trim()).map((c, i) => ({
      id: String(c.id || `col-${Date.now().toString(36)}-${i}`),
      nombre: String(c.nombre).trim(), zona: String(c.zona || "").trim(), cliente: String(c.cliente || "").trim(),
      posicion: String(c.posicion || "Técnico").trim(),
      sueldo: Number(c.sueldo) || 0, base: c.base === "" || c.base == null ? null : Number(c.base),
      activo: c.activo !== false,
    }));
    res.json(await escribir("incentivos_colaboradores", limpia));
  } catch (e) { err(res, e); }
});

router.get("/evaluaciones", evaluar, async (req, res) => {
  const { mes } = req.query;
  if (!mesValido(mes)) return err(res, new Error("mes inválido (AAAA-MM)"), 400);
  try { res.json(await leer(`evaluacion_${mes}`, {})); } catch (e) { err(res, e); }
});

router.put("/evaluaciones/:mes/:col", evaluar, async (req, res) => {
  const { mes, col } = req.params;
  if (!mesValido(mes)) return err(res, new Error("mes inválido (AAAA-MM)"), 400);
  try {
    const lista = await colaboradores();
    const c = lista.find((x) => x.id === col);
    if (!c) return err(res, new Error("Colaborador no encontrado"), 404);
    const b = req.body || {};
    const calif = {};
    const secciones = await plantilla();
    for (const s of secciones) for (const p of s.preguntas) {
      const v = b.calificaciones?.[p.id];
      if (v === "NA") calif[p.id] = "NA";
      else if (v !== "" && v != null && !Number.isNaN(Number(v))) calif[p.id] = Math.min(10, Math.max(1, Math.round(Number(v))));
    }
    const calc = calcularEvaluacion(calif, secciones);
    const todas = await leer(`evaluacion_${mes}`, {});
    todas[col] = {
      colaborador_id: col, nombre: c.nombre,
      posicion: b.posicion || c.posicion || "Técnico", cliente: b.cliente ?? c.cliente ?? "",
      desde: b.desde || null, hasta: b.hasta || null,
      evaluador: b.evaluador || req.usuario.nombre || "", departamento: b.departamento || "Fumigación",
      trabajo: b.trabajo || "", comentarios: b.comentarios || "", comentarios_evaluado: b.comentarios_evaluado || "",
      calificaciones: calif, renglones: calc.renglones, porcentaje: calc.porcentaje, completa: calc.completa,
      actualizado: new Date().toISOString(), actualizado_por: req.usuario.nombre || null,
    };
    await escribir(`evaluacion_${mes}`, todas);
    res.json(todas[col]);
  } catch (e) { err(res, e); }
});

router.delete("/evaluaciones/:mes/:col", evaluar, async (req, res) => {
  const { mes, col } = req.params;
  if (!mesValido(mes)) return err(res, new Error("mes inválido (AAAA-MM)"), 400);
  try {
    const todas = await leer(`evaluacion_${mes}`, {});
    delete todas[col];
    await escribir(`evaluacion_${mes}`, todas);
    res.json({ ok: true });
  } catch (e) { err(res, e); }
});

async function calculo(mes) {
  const [lista, evals, ajustes] = await Promise.all([colaboradores(), leer(`evaluacion_${mes}`, {}), leer(`incentivo_${mes}`, {})]);
  const filas = lista.filter((c) => c.activo !== false || ajustes[c.id] || evals[c.id])
    .map((c) => filaIncentivo(c, evals[c.id], ajustes[c.id] || {}));
  const totales = { quincena: 0, resultado: 0, total: 0 };
  for (const a of AJUSTES) totales[a.campo] = 0;
  for (const f of filas) for (const k of Object.keys(totales)) totales[k] += f[k] || 0;
  return { mes, fecha_pago: fechaPago(mes).toISOString().slice(0, 10), al: ultimoDia(mes).toISOString().slice(0, 10), filas, totales };
}

router.get("/:mes/excel", pagar, async (req, res) => {
  const { mes } = req.params;
  if (!mesValido(mes)) return err(res, new Error("mes inválido (AAAA-MM)"), 400);
  try {
    const d = await calculo(mes);
    const evals = await leer(`evaluacion_${mes}`, {});
    const PLANTILLA = await plantilla();
    const wb = new ExcelJS.Workbook();
    wb.creator = "Ambiente y Salud, ASA";
    const ws = wb.addWorksheet("Resultado", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    const cols = ["Nombre completo", "Zona", "Cliente", "Sueldo", "Quincena", "Porcentaje evaluación", "Resultado",
      ...AJUSTES.map((a) => a.nombre), "Total a pagar", "Notas"];
    ws.columns = cols.map((_, i) => ({ width: i === 0 ? 34 : i < 3 ? 18 : i === cols.length - 1 ? 30 : 14 }));
    const ult = String.fromCharCode(64 + cols.length);
    const titulo = (fila, texto, tam) => {
      ws.mergeCells(`A${fila}:${ult}${fila}`);
      const c = ws.getCell(`A${fila}`); c.value = texto; c.font = { bold: true, size: tam }; c.alignment = { horizontal: "center" };
    };
    titulo(1, "Ambiente y Salud, ASA, S. R. L.", 14);
    titulo(2, "Reporte de incentivo", 12);
    titulo(3, `Al ${fechaLarga(ultimoDia(mes))} · Pago el ${fechaLarga(fechaPago(mes))}`, 11);
    const cab = ws.getRow(5);
    cab.values = cols;
    cab.eachCell((c) => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E7D32" } };
      c.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
      c.border = { bottom: { style: "thin" } };
    });
    cab.height = 34;
    const moneda = '#,##0.00;[Red]-#,##0.00';
    const primera = 6;
    d.filas.forEach((f, i) => {
      const n = primera + i;
      const row = ws.getRow(n);
      row.values = [f.nombre, f.zona, f.cliente, f.sueldo, f.quincena, f.porcentaje == null ? null : f.porcentaje / 100, null,
        ...AJUSTES.map((a) => (f[a.campo] ? a.signo * f[a.campo] : null)), null, f.notas || (f.origen_porcentaje === "sin_evaluar" ? "Sin evaluar" : "")];
      row.getCell(7).value = { formula: `E${n}*F${n}`, result: f.resultado };
      const iTotal = 8 + AJUSTES.length;
      const finAj = String.fromCharCode(64 + iTotal - 1);
      row.getCell(iTotal).value = { formula: `G${n}+SUM(H${n}:${finAj}${n})`, result: f.total };
      row.getCell(6).numFmt = "0.00%";
      for (let c = 4; c <= iTotal; c++) if (c !== 6) row.getCell(c).numFmt = moneda;
      row.getCell(iTotal).font = { bold: true };
    });
    const nTot = primera + d.filas.length + 1;
    const tot = ws.getRow(nTot);
    tot.getCell(1).value = "TOTALES";
    tot.getCell(1).font = { bold: true };
    for (let c = 5; c <= 8 + AJUSTES.length; c++) {
      if (c === 6) continue;
      const L = String.fromCharCode(64 + c);
      tot.getCell(c).value = { formula: `SUM(${L}${primera}:${L}${nTot - 2})` };
      tot.getCell(c).numFmt = moneda;
      tot.getCell(c).font = { bold: true };
      tot.getCell(c).border = { top: { style: "double" } };
    }
    ws.views = [{ state: "frozen", xSplit: 1, ySplit: 5 }];

    // Hoja con el detalle de las evaluaciones del mes
    const we = wb.addWorksheet("Evaluaciones");
    we.columns = [{ width: 34 }, { width: 22 }, { width: 18 }, ...PLANTILLA.map(() => ({ width: 11 })), { width: 13 }, { width: 50 }];
    const ce = we.getRow(1);
    ce.values = ["Colaborador", "Evaluador", "Cliente", ...PLANTILLA.map((s) => `${s.id} ${s.titulo}`), "% Evaluación", "Comentarios del evaluador"];
    ce.eachCell((c) => { c.font = { bold: true }; c.alignment = { wrapText: true, vertical: "middle" }; });
    ce.height = 60;
    Object.values(evals).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")).forEach((ev) => {
      const r = we.addRow([ev.nombre, ev.evaluador, ev.cliente, ...PLANTILLA.map((s) => ev.renglones?.find((x) => x.id === s.id)?.puntaje ?? "N/A"),
        ev.porcentaje / 100, ev.comentarios]);
      r.getCell(4 + PLANTILLA.length).numFmt = "0.00%";
    });

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="incentivos-${mes}-pago-${d.fecha_pago}.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (e) { err(res, e); }
});

router.get("/:mes", pagar, async (req, res) => {
  const { mes } = req.params;
  if (!mesValido(mes)) return err(res, new Error("mes inválido (AAAA-MM)"), 400);
  try { res.json(await calculo(mes)); } catch (e) { err(res, e); }
});

router.put("/:mes/:col", pagar, async (req, res) => {
  const { mes, col } = req.params;
  if (!mesValido(mes)) return err(res, new Error("mes inválido (AAAA-MM)"), 400);
  try {
    const todos = await leer(`incentivo_${mes}`, {});
    const b = req.body || {};
    const a = {};
    for (const x of AJUSTES) if (b[x.campo] !== "" && b[x.campo] != null && Number(b[x.campo])) a[x.campo] = Math.abs(Number(b[x.campo]));
    if (b.porcentaje_manual !== "" && b.porcentaje_manual != null) a.porcentaje_manual = Math.min(100, Math.max(0, Number(b.porcentaje_manual)));
    if (String(b.notas || "").trim()) a.notas = String(b.notas).trim();
    if (Object.keys(a).length) todos[col] = a; else delete todos[col];
    await escribir(`incentivo_${mes}`, todos);
    const c = (await colaboradores()).find((x) => x.id === col);
    const ev = (await leer(`evaluacion_${mes}`, {}))[col];
    res.json(c ? filaIncentivo(c, ev, a) : a);
  } catch (e) { err(res, e); }
});

export default router;
