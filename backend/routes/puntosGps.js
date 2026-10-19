// routes/puntosGps.js — Puntos de control desde coordenadas GPS
//
// El técnico marca los puntos en el teléfono con una app de mapas ("Map
// Marker" / "General Map": Nombre, GPS Lat, GPS Lng) y exporta un Excel. Aquí
// ese Excel se convierte en puntos de control del sistema:
//
//   POST /puntos-gps/analizar { archivo_base64 }
//     Lee los puntos, deduce el tipo por el nombre ("cebadero", "registro",
//     "lámpara"…) y propone a qué hotel va cada uno:
//       1. el hotel cuyo plano georreferenciado (PDF de QGIS) lo contiene;
//       2. si no, el hotel más cercano con ubicación fijada (Técnicos en vivo),
//          dentro de su radio;
//       3. si no, queda sin hotel y se elige en el mapa.
//     Marca los que ya existen (mismo tipo a menos de 3 m en ese hotel).
//
//   POST /puntos-gps/importar { puntos: [{ lat, lng, nombre, tipo_codigo, sitio_id }] }
//     Crea los puntos con su código (CR-001, RG-001…), sus coordenadas y su
//     posición en el plano del hotel si cae dentro de uno. No duplica.
import express from "express";
import ExcelJS from "exceljs";
import { supabase } from "../lib/supabaseClient.js";
import { requireRol } from "../middleware/auth.js";
import { logAccion } from "../lib/auditoria.js";
import { traerTodo } from "../lib/paginar.js";
import { emparejarTipo } from "./puntos.js";

const router = express.Router();
const PUEDE = requireRol("operaciones");

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Tipo que no viene de fábrica: registros sanitarios y cárcamos
const TIPO_REGISTRO = { codigo: "registro", nombre: "Registro / cárcamo", prefijo_codigo: "RG", icono: "🕳️", color: "#7C3AED", frecuencia_default: "mensual" };
const ES_REGISTRO = /registro|carcamo|cancamo|alcantarill|trampadegrasa|drenaje|desague/;

// Distancia en metros entre dos coordenadas
function metros(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const x = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Texto con tildes mal leídas ("CÃ¡rcamo") por el export de la app
const arreglar = (t) => { const s = String(t ?? "").trim(); try { return /Ã|Â/.test(s) ? decodeURIComponent(escape(s)) : s; } catch { return s; } };

// El Excel del teléfono: la fila de títulos es la que tiene latitud y longitud
async function leerPuntosGps(base64) {
  const buffer = Buffer.from(String(base64).replace(/^data:[^;]+;base64,/, ""), "base64");
  const wb = new ExcelJS.Workbook();
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) await wb.xlsx.load(buffer);
  else throw new Error("Sube el Excel (.xlsx) que exporta la app de mapas");
  for (const ws of wb.worksheets) {
    for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
      const cab = {};
      ws.getRow(r).eachCell((c, col) => { cab[norm(arreglar(c.value))] = col; });
      const col = (re) => Object.entries(cab).find(([k]) => re.test(k))?.[1];
      const cLat = col(/^(gps)?lat(itud|itude)?$/), cLng = col(/^(gps)?(lng|lon|long|longitud|longitude)$/);
      if (!cLat || !cLng) continue;
      const cNom = col(/^(nombre|name|titulo|title|punto)$/), cDesc = col(/^(descripcion|description|nota|notas)$/);
      const cFecha = col(/^(timestamp|fecha|date|creado)$/), cTipo = col(/^tipo$/);
      const puntos = [];
      for (let i = r + 1; i <= ws.rowCount; i++) {
        const fila = ws.getRow(i);
        const v = (c) => { if (!c) return null; let x = fila.getCell(c).value; if (x && typeof x === "object" && !(x instanceof Date)) x = x.text ?? x.result ?? null; return x; };
        const lat = Number(v(cLat)), lng = Number(v(cLng));
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !lat || !lng || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
        puntos.push({
          fila: i,
          nombre: arreglar(v(cNom)) || "Punto",
          descripcion: arreglar(v(cDesc)) || null,
          tipo_app: arreglar(v(cTipo)) || null,
          fecha: v(cFecha) ? String(v(cFecha)).slice(0, 19) : null,
          lat, lng,
        });
      }
      return puntos;
    }
  }
  throw new Error("No encontré columnas de latitud y longitud (GPS Lat / GPS Lng) en el Excel");
}

async function datosBase() {
  const [{ data: tipos }, { data: sitios }, { data: planos }] = await Promise.all([
    supabase.from("asa_tipos_punto").select("id, codigo, nombre, prefijo_codigo, color, icono, frecuencia_default").eq("activo", true),
    supabase.from("asa_sitios").select("*").eq("activo", true).order("nombre"),
    supabase.from("asa_planos").select("id, sitio_id, nombre, geo_norte, geo_sur, geo_este, geo_oeste").eq("activo", true),
  ]);
  const planosGeo = (planos || []).filter((p) => [p.geo_norte, p.geo_sur, p.geo_este, p.geo_oeste].every((x) => x != null));
  return { tipos: tipos || [], sitios: sitios || [], planos: planosGeo };
}

const dentro = (p, pl) => p.lat <= pl.geo_norte && p.lat >= pl.geo_sur && p.lng <= pl.geo_este && p.lng >= pl.geo_oeste;
const areaPlano = (pl) => (pl.geo_norte - pl.geo_sur) * (pl.geo_este - pl.geo_oeste);

function tipoDe(nombre, tipos) {
  const n = norm(nombre);
  if (ES_REGISTRO.test(n)) return tipos.find((t) => t.codigo === "registro") || { ...TIPO_REGISTRO, nuevo: true };
  if (!n || /^(newmarker|marcador|punto|c|x)$/.test(n)) return null;
  const t = emparejarTipo(nombre, tipos, null, null, null);
  return t && t.codigo !== "habitacion" ? t : null;
}

// POST /puntos-gps/analizar
router.post("/analizar", PUEDE, async (req, res) => {
  let puntos;
  try {
    puntos = await leerPuntosGps(req.body?.archivo_base64 || "");
  } catch (e) {
    return res.status(400).json({ error: true, mensaje: e.message });
  }
  if (!puntos.length) return res.status(400).json({ error: true, mensaje: "El Excel no tiene puntos con coordenadas" });

  const { tipos, sitios, planos } = await datosBase();
  const conUbicacion = sitios.filter((s) => s.lat != null && s.lng != null);
  const existentes = await traerTodo(() =>
    supabase.from("asa_puntos_control").select("id, sitio_id, lat, lng, tipo_punto_id, codigo_visible").not("lat", "is", null).eq("activo", true).order("id")
  ).catch(() => []);

  let tipoNuevo = null;
  for (const p of puntos) {
    const t = tipoDe(p.nombre, tipos);
    p.tipo_codigo = t?.codigo || null;
    if (t?.nuevo) tipoNuevo = TIPO_REGISTRO;

    // 1. plano que lo contiene (el más pequeño, si hay varios)
    const enPlanos = planos.filter((pl) => dentro(p, pl)).sort((a, b) => areaPlano(a) - areaPlano(b));
    // 2. hotel más cercano con ubicación fijada
    let cerca = null;
    for (const s of conUbicacion) {
      const d = metros(p, s);
      if (!cerca || d < cerca.d) cerca = { s, d };
    }
    if (enPlanos.length) {
      p.sitio_id = enPlanos[0].sitio_id;
      p.como = "plano";
    } else if (cerca && cerca.d <= Math.max(Number(cerca.s.radio_m) || 400, 400) * 1.5) {
      p.sitio_id = cerca.s.id;
      p.como = "cercano";
    } else {
      p.sitio_id = null;
      p.como = null;
    }
    p.cercano = cerca ? { nombre: cerca.s.nombre, metros: Math.round(cerca.d) } : null;
    const tipoId = tipos.find((x) => x.codigo === p.tipo_codigo)?.id;
    const ya = existentes.find((e) => e.sitio_id === p.sitio_id && e.tipo_punto_id === tipoId && metros(p, e) < 3);
    p.ya_existe = ya ? ya.codigo_visible : null;
  }

  res.json({
    puntos,
    sitios: sitios.map((s) => ({ id: s.id, nombre: s.nombre, lat: s.lat ?? null, lng: s.lng ?? null })),
    planos: planos.map((p) => ({ sitio_id: p.sitio_id, nombre: p.nombre, norte: p.geo_norte, sur: p.geo_sur, este: p.geo_este, oeste: p.geo_oeste })),
    tipos: [...tipos, ...(tipoNuevo ? [{ ...TIPO_REGISTRO, nuevo: true }] : [])].map((t) => ({ codigo: t.codigo, nombre: t.nombre, color: t.color, icono: t.icono, nuevo: !!t.nuevo })),
  });
});

// POST /puntos-gps/importar
router.post("/importar", PUEDE, async (req, res) => {
  const entrada = (Array.isArray(req.body?.puntos) ? req.body.puntos : [])
    .filter((p) => p && p.sitio_id && p.tipo_codigo && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
    .map((p) => ({ ...p, lat: Number(p.lat), lng: Number(p.lng) }));
  if (!entrada.length) return res.status(400).json({ error: true, mensaje: "No hay puntos con hotel y tipo para importar" });
  if (entrada.length > 3000) return res.status(400).json({ error: true, mensaje: "Máximo 3000 puntos por vez" });

  let { tipos, sitios, planos } = await datosBase();
  // El tipo "Registro / cárcamo" se crea la primera vez que se usa
  if (entrada.some((p) => p.tipo_codigo === "registro") && !tipos.some((t) => t.codigo === "registro")) {
    const { error } = await supabase.from("asa_tipos_punto").insert([{ ...TIPO_REGISTRO, activo: true, orden: 90 }]);
    if (error && !/duplicate|unique/i.test(error.message)) return res.status(500).json({ error: true, mensaje: error.message });
    ({ tipos } = await datosBase());
  }
  const tipoPor = new Map(tipos.map((t) => [t.codigo, t]));
  const sitioPor = new Map(sitios.map((s) => [s.id, s]));

  const resumen = [];
  const porSitio = new Map();
  for (const p of entrada) {
    if (!sitioPor.has(p.sitio_id) || !tipoPor.has(p.tipo_codigo)) continue;
    if (!porSitio.has(p.sitio_id)) porSitio.set(p.sitio_id, []);
    porSitio.get(p.sitio_id).push(p);
  }

  for (const [sitioId, lista] of porSitio) {
    const existentes = await traerTodo(() =>
      supabase.from("asa_puntos_control").select("codigo_visible, lat, lng, tipo_punto_id").eq("sitio_id", sitioId).order("id")
    );
    // Siguiente número por prefijo: CR-014 → empieza en 15
    const maximo = new Map();
    for (const e of existentes) {
      const m = /^([A-Za-z]+)-(\d+)$/.exec(e.codigo_visible || "");
      if (m) maximo.set(m[1].toUpperCase(), Math.max(maximo.get(m[1].toUpperCase()) || 0, Number(m[2])));
    }
    const planosSitio = planos.filter((pl) => pl.sitio_id === sitioId).sort((a, b) => areaPlano(a) - areaPlano(b));
    const filas = [];
    let repetidos = 0;
    const yaPuestos = existentes.filter((e) => e.lat != null).map((e) => ({ lat: Number(e.lat), lng: Number(e.lng), tipo: e.tipo_punto_id }));
    for (const p of lista) {
      const t = tipoPor.get(p.tipo_codigo);
      if (yaPuestos.some((e) => e.tipo === t.id && metros(p, e) < 3)) { repetidos++; continue; }
      yaPuestos.push({ lat: p.lat, lng: p.lng, tipo: t.id });
      const pre = (t.prefijo_codigo || "PC").toUpperCase();
      const n = (maximo.get(pre) || 0) + 1;
      maximo.set(pre, n);
      const pl = planosSitio.find((x) => dentro(p, x));
      const nombre = String(p.nombre || "").trim();
      filas.push({
        sitio_id: sitioId,
        tipo_punto_id: t.id,
        codigo_visible: `${pre}-${String(n).padStart(3, "0")}`,
        nombre: nombre && norm(nombre) !== norm(t.nombre) && !/^(cebadero|registro|lampara|dispensador)$/.test(norm(nombre)) ? nombre : `${t.nombre} ${n}`,
        lat: p.lat,
        lng: p.lng,
        frecuencia: t.frecuencia_default || "mensual",
        notas: `Ubicado por GPS${p.fecha ? ` el ${String(p.fecha).slice(0, 10)}` : ""}${p.descripcion ? ` · ${p.descripcion}` : ""}`,
        ...(pl ? {
          plano_id: pl.id,
          plano_x: Number((((p.lng - pl.geo_oeste) / (pl.geo_este - pl.geo_oeste)) * 100).toFixed(2)),
          plano_y: Number((((pl.geo_norte - p.lat) / (pl.geo_norte - pl.geo_sur)) * 100).toFixed(2)),
        } : {}),
      });
    }
    for (let i = 0; i < filas.length; i += 500) {
      const { error } = await supabase.from("asa_puntos_control").insert(filas.slice(i, i + 500));
      if (error) return res.status(500).json({ error: true, mensaje: `${sitioPor.get(sitioId).nombre}: ${error.message}`, resumen });
    }
    resumen.push({
      sitio: sitioPor.get(sitioId).nombre,
      creados: filas.length,
      repetidos,
      en_plano: filas.filter((f) => f.plano_id).length,
    });
  }

  logAccion(req, {
    accion: "crear",
    modulo: "puntos",
    descripcion: `Puntos GPS importados: ${resumen.map((r) => `${r.sitio} ${r.creados}`).join(", ")}`,
    detalle: { resumen },
  });
  res.json({ ok: true, resumen, creados: resumen.reduce((a, r) => a + r.creados, 0) });
});

export default router;
