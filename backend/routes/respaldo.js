// routes/respaldo.js — Respaldo completo en Excel y restauración (solo admin)
//
// GET  /respaldo/excel       → un .xlsx con una hoja por tabla del sistema
//                              (todas las asa_*), con TODAS sus filas y columnas.
// POST /respaldo/restaurar   → sube ese mismo archivo y vuelve a cargar las filas.
//      ?modo=agregar     (por defecto) solo agrega lo que falta; lo que ya existe
//                        no se toca.
//      ?modo=reemplazar  lo que existe con el mismo id se sobrescribe con lo del
//                        respaldo.
//      ?simular=1        lee el archivo y dice qué trae, sin escribir nada.
//      El cuerpo es el archivo tal cual (application/octet-stream): un respaldo
//      grande no cabe en el límite de JSON.
//
// Nunca borra. Las fotos y archivos (Storage de Supabase) no van en el Excel:
// van sus enlaces, que siguen funcionando mientras el archivo exista.
//
// Cómo se guarda cada valor:
//   · null → celda vacía; texto vacío "" → «__VACIO__»
//   · objetos y listas (jsonb, arreglos) → texto JSON; la hoja "_info" dice qué
//     columnas son JSON para volver a convertirlas al restaurar
//   · un texto de más de 32 000 caracteres (límite de una celda de Excel) se
//     parte en trozos en la hoja "_largos" y la celda queda como «__LARGO__:n»
import express from "express";
import ExcelJS from "exceljs";
import { supabase } from "../lib/supabaseClient.js";
import { requireRol } from "../middleware/auth.js";
import { logAccion } from "../lib/auditoria.js";
import { traerTodo } from "../lib/paginar.js";

const router = express.Router();
const SOLO_ADMIN = requireRol("admin");

// Todas las tablas del sistema, de las "madres" a las "hijas". El orden ayuda
// al restaurar; si igual falta una madre, la tabla se reintenta en otra vuelta.
// La llave es la columna (o columnas) que identifica cada fila.
const TABLAS = [
  ["asa_config_sistema", "clave"], ["asa_rnc_cache", "rnc"], ["asa_secuencias_ecf", "tipo_ecf"],
  ["asa_plan_cuentas"], ["asa_suplidores"], ["asa_clientes"], ["asa_empleados"], ["asa_usuarios"],
  ["asa_sitios"], ["asa_usuario_sitios"], ["asa_contratos_plagas"], ["asa_contrato_sitios"],
  ["asa_areas"], ["asa_planos"], ["asa_tipos_punto"], ["asa_estrategias"], ["asa_preguntas"],
  ["asa_plagas"], ["asa_umbrales"], ["asa_tipo_punto_estrategias", "tipo_punto_id,estrategia_id"],
  ["asa_tipo_punto_plagas", "tipo_punto_id,plaga_id"], ["asa_puntos_control"],
  ["asa_qr_impresos", "token"], ["asa_qr_etiquetas"], ["asa_qr_no_reconocidos", "token"],
  ["asa_plaguicidas_catalogo"], ["asa_tratamientos_catalogo"], ["asa_productos_tienda"],
  ["asa_estetica_servicios_catalogo"], ["asa_mascotas"],
  ["asa_ordenes_trabajo"], ["asa_ordenes_trabajo_log"], ["asa_orden_puntos"], ["asa_orden_mensajes"],
  ["asa_inspecciones"], ["asa_inspeccion_respuestas"], ["asa_capturas"], ["asa_hallazgos"],
  ["asa_aplicaciones_productos"], ["asa_tratamientos_aplicados"], ["asa_ipm_estaciones"], ["asa_ipm_lecturas"],
  ["asa_incidencias"], ["asa_incidencias_log"], ["asa_cronograma"], ["asa_documentos"], ["asa_permisos_regulatorios"],
  ["asa_citas"], ["asa_fichas_clinicas"], ["asa_estetica_ordenes"], ["asa_estetica_orden_detalle"],
  ["asa_facturas"], ["asa_factura_items"], ["asa_pagos"], ["asa_cuentas_por_cobrar"], ["asa_cuentas_por_pagar"],
  ["asa_ventas_pos"], ["asa_ventas_pos_detalle"], ["asa_pos_cuadre_caja"], ["asa_inventario_movimientos"],
  ["asa_comisiones"], ["asa_asientos_contables"], ["asa_asientos_detalle"],
  ["asa_nomina_periodos"], ["asa_nomina_detalle"],
  ["asa_flota_conductores"], ["asa_flota_vehiculos"], ["asa_flota_asignaciones"], ["asa_flota_checklist_items"],
  ["asa_flota_fallas_catalogo"], ["asa_flota_chequeos"], ["asa_flota_chequeo_items"], ["asa_flota_fallas_reportadas"],
  ["asa_flota_fotos"], ["asa_flota_gastos"], ["asa_flota_documentos"], ["asa_flota_mantenimientos"],
  ["asa_notificaciones"], ["asa_log_auditoria"],
].map(([tabla, llave = "id"]) => ({ tabla, llave }));

const TOPE_CELDA = 32000;
const hoja = (tabla) => tabla.replace(/^asa_/, "").slice(0, 31);
const tablaNoExiste = (e) => /does not exist|relation .* does not exist|Could not find the table|PGRST205|42P01/i.test(`${e?.code || ""} ${e?.message || ""}`);

// ── GET /respaldo/excel ──────────────────────────────────────────────────
router.get("/excel", SOLO_ADMIN, async (req, res) => {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Ambiente y Salud — respaldo";
    const info = wb.addWorksheet("_info");
    info.columns = [
      { header: "tabla", key: "tabla", width: 32 },
      { header: "hoja", key: "hoja", width: 30 },
      { header: "llave", key: "llave", width: 28 },
      { header: "filas", key: "filas", width: 10 },
      { header: "columnas_json", key: "json", width: 60 },
      { header: "nota", key: "nota", width: 40 },
    ];
    const largos = wb.addWorksheet("_largos");
    largos.columns = [{ header: "clave", key: "clave", width: 12 }, { header: "parte", key: "parte", width: 8 }, { header: "texto", key: "texto", width: 80 }];
    let nLargo = 0;
    let total = 0;

    for (const { tabla, llave } of TABLAS) {
      let filas;
      try {
        const orden = llave.split(",");
        filas = await traerTodo(() => orden.reduce((q, c) => q.order(c), supabase.from(tabla).select("*")));
      } catch (e) {
        info.addRow({ tabla, hoja: "", llave, filas: 0, json: "", nota: tablaNoExiste(e) ? "no existe en esta base" : `error: ${e.message}` });
        continue;
      }
      const columnas = [...new Set(filas.flatMap((f) => Object.keys(f)))];
      const json = columnas.filter((c) => filas.some((f) => f[c] !== null && typeof f[c] === "object"));
      const ws = wb.addWorksheet(hoja(tabla));
      ws.addRow(columnas);
      ws.getRow(1).font = { bold: true };
      for (const f of filas) {
        ws.addRow(columnas.map((c) => {
          let v = f[c];
          if (v === null || v === undefined) return null;
          if (v === "") return "__VACIO__";   // una celda vacía se lee como null
          if (typeof v === "object") v = JSON.stringify(v);
          if (typeof v === "string" && v.length > TOPE_CELDA) {
            nLargo++;
            for (let i = 0, p = 0; i < v.length; i += TOPE_CELDA, p++) largos.addRow({ clave: nLargo, parte: p, texto: v.slice(i, i + TOPE_CELDA) });
            return `__LARGO__:${nLargo}`;
          }
          return v;
        }));
      }
      if (columnas.length) ws.views = [{ state: "frozen", ySplit: 1 }];
      info.addRow({ tabla, hoja: hoja(tabla), llave, filas: filas.length, json: json.join(","), nota: "" });
      total += filas.length;
    }
    info.addRow({});
    info.addRow({ tabla: "respaldo_generado", hoja: new Date().toISOString(), llave: "", filas: total, json: "", nota: req.usuario?.nombre || "" });

    const buf = await wb.xlsx.writeBuffer();
    logAccion(req, { accion: "exportar", modulo: "respaldo", descripcion: `Respaldo completo en Excel: ${total} filas` });
    const fecha = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="respaldo-ambiente-y-salud-${fecha}.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (e) {
    res.status(500).json({ error: true, mensaje: e.message });
  }
});

// ── Leer un respaldo ─────────────────────────────────────────────────────
async function leerRespaldo(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const info = wb.getWorksheet("_info");
  if (!info) throw Object.assign(new Error("Ese archivo no es un respaldo del sistema (le falta la hoja _info)."), { status: 400 });

  const celda = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === "object") {
      if (v instanceof Date) return v.toISOString();
      if (v.richText) return v.richText.map((r) => r.text).join("");
      if (v.text !== undefined) return String(v.text);
      if (v.result !== undefined) return v.result;
    }
    return v;
  };

  const largos = new Map();
  wb.getWorksheet("_largos")?.eachRow((row, n) => {
    if (n === 1) return;
    const [clave, parte, texto] = [celda(row.getCell(1).value), Number(celda(row.getCell(2).value)), String(celda(row.getCell(3).value) ?? "")];
    if (!largos.has(String(clave))) largos.set(String(clave), []);
    largos.get(String(clave))[parte] = texto;
  });

  const tablas = [];
  info.eachRow((row, n) => {
    if (n === 1) return;
    const [tabla, nombreHoja, llave, , json] = [1, 2, 3, 4, 5].map((i) => celda(row.getCell(i).value));
    if (!tabla || !String(tabla).startsWith("asa_") || !nombreHoja) return;
    const ws = wb.getWorksheet(String(nombreHoja));
    if (!ws) return;
    const columnas = [];
    ws.getRow(1).eachCell((c, i) => { columnas[i] = String(celda(c.value)); });
    const colsJson = new Set(String(json || "").split(",").filter(Boolean));
    const filas = [];
    ws.eachRow((r, i) => {
      if (i === 1) return;
      const fila = {};
      columnas.forEach((col, j) => {
        if (!col) return;
        let v = celda(r.getCell(j).value);
        if (v === "__VACIO__") v = "";
        if (typeof v === "string" && v.startsWith("__LARGO__:")) v = (largos.get(v.slice(10)) || []).join("");
        if (v !== null && colsJson.has(col) && typeof v === "string") {
          try { v = JSON.parse(v); } catch { /* se deja el texto */ }
        }
        fila[col] = v === undefined ? null : v;
      });
      filas.push(fila);
    });
    tablas.push({ tabla: String(tabla), llave: String(llave || "id"), filas });
  });
  // Del orden de madres a hijas, aunque el archivo venga en otro orden.
  const pos = new Map(TABLAS.map((t, i) => [t.tabla, i]));
  return tablas.sort((a, b) => (pos.get(a.tabla) ?? 999) - (pos.get(b.tabla) ?? 999));
}

// ── POST /respaldo/restaurar ─────────────────────────────────────────────
router.post(
  "/restaurar",
  SOLO_ADMIN,
  express.raw({ type: () => true, limit: "200mb" }),
  async (req, res) => {
    const modo = req.query.modo === "reemplazar" ? "reemplazar" : "agregar";
    const simular = req.query.simular === "1";
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: true, mensaje: "Falta el archivo del respaldo" });

    let tablas;
    try {
      tablas = await leerRespaldo(req.body);
    } catch (e) {
      return res.status(e.status || 400).json({ error: true, mensaje: `No se pudo leer el respaldo: ${e.message}` });
    }

    if (simular) {
      return res.json({ ok: true, simulado: true, tablas: tablas.map((t) => ({ tabla: t.tabla, filas: t.filas.length })), total: tablas.reduce((s, t) => s + t.filas.length, 0) });
    }

    const resultado = new Map(tablas.map((t) => [t.tabla, { tabla: t.tabla, filas: t.filas.length, cargadas: 0, error: null }]));
    const escribir = (t, lote) => supabase.from(t.tabla).upsert(lote, { onConflict: t.llave, ignoreDuplicates: modo === "agregar" });
    const esDeFK = (e) => e?.code === "23503" || /foreign key/i.test(e?.message || "");

    // Vueltas: lo que falla por una tabla madre que todavía no está se reintenta
    // en la vuelta siguiente, cuando la madre ya cargó.
    let pendientes = tablas.filter((t) => t.filas.length);
    for (let vuelta = 0; vuelta < 6 && pendientes.length; vuelta++) {
      const siguen = [];
      for (const t of pendientes) {
        const r = resultado.get(t.tabla);
        let fallo = null;
        for (let i = r.cargadas; i < t.filas.length; i += 500) {
          const { error } = await escribir(t, t.filas.slice(i, i + 500));
          if (error) { fallo = error; break; }
          r.cargadas = Math.min(t.filas.length, i + 500);
        }
        if (!fallo) { r.error = null; continue; }
        if (tablaNoExiste(fallo)) { r.error = "la tabla no existe en esta base"; continue; }
        r.error = fallo.message;
        if (esDeFK(fallo)) siguen.push(t);
      }
      pendientes = siguen;
    }

    // Última pasada fila por fila para lo que siguió fallando: así lo que sí
    // se puede cargar entra, y se ve exactamente qué fila no.
    for (const t of pendientes) {
      const r = resultado.get(t.tabla);
      const errores = [];
      for (let i = r.cargadas; i < t.filas.length; i++) {
        const { error } = await escribir(t, [t.filas[i]]);
        if (error) errores.push(error.message);
        else r.cargadas++;
      }
      r.cargadas = Math.min(r.cargadas, t.filas.length);
      r.error = errores.length ? `${errores.length} fila(s) no entraron: ${errores[0]}` : null;
    }

    // Contadores (flota usa números seguidos; incidencias, INC-00001…). Si no se
    // ajustan, lo próximo que se cree choca con lo restaurado. Necesita la
    // función de supabase/36_respaldo.sql.
    let secuencias = "ajustadas";
    const { error: eSeq } = await supabase.rpc("asa_reajustar_secuencias");
    if (eSeq) secuencias = `no se pudieron ajustar (${eSeq.message}). Corre supabase/36_respaldo.sql en Supabase.`;

    const lista = [...resultado.values()];
    const totalCargadas = lista.reduce((s, r) => s + r.cargadas, 0);
    logAccion(req, {
      accion: "importar",
      modulo: "respaldo",
      descripcion: `Respaldo restaurado (${modo}): ${totalCargadas} filas en ${lista.length} tablas`,
      detalle: { modo, errores: lista.filter((r) => r.error).map((r) => `${r.tabla}: ${r.error}`) },
    });
    res.json({ ok: true, modo, total: lista.reduce((s, r) => s + r.filas, 0), cargadas: totalCargadas, secuencias, tablas: lista });
  }
);

export default router;
