// scripts/probar-importacion.mjs — Prueba el lector de Excel con archivos reales
//
// Lee un .xlsx de puntos de control y muestra exactamente cómo quedaría en el
// sistema: qué tipo se le asignaría a cada punto, qué áreas se crearían, qué
// estrategias, y cuántos códigos QR ya impresos se conservan. No toca la base
// de datos — es para revisar un archivo antes de subirlo de verdad.
//
//   node scripts/probar-importacion.mjs "ruta/al/PuntosServicio.xlsx" "Iberostar Coral Bavaro"
//
// El segundo argumento es el nombre del hotel, que se recorta del nombre de
// cada área (el export lo repite en todas las filas).
import fs from "node:fs";

// Credenciales de mentira: este script no consulta Supabase, pero el módulo de
// puntos importa el cliente y ese se niega a cargar sin ellas. El import es
// dinámico para que estas variables existan antes de que se evalúe.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://pruebalocal.supabase.co";
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_secret_prueba_local";

const { leerExcel, emparejarTipo, recortarPrefijo, normalizar, valor, normalizarFrecuencia } =
  await import("../routes/puntos.js");

const [ruta, nombreHotel] = process.argv.slice(2);
if (!ruta) {
  console.error('Uso: node scripts/probar-importacion.mjs "archivo.xlsx" ["Nombre del hotel"]');
  process.exit(1);
}

// El mismo catálogo que trae la migración 20
const TIPOS = [
  { id: "t1", codigo: "cebadero_roedor", nombre: "Cebadero para roedores", prefijo_codigo: "CR", frecuencia_default: "semanal" },
  { id: "t2", codigo: "lampara_moscas", nombre: "Lámpara para moscas", prefijo_codigo: "LM", frecuencia_default: "semanal" },
  { id: "t3", codigo: "dispensador_aerosol", nombre: "Dispensador de aerosol", prefijo_codigo: "DA", frecuencia_default: "mensual" },
  { id: "t4", codigo: "habitacion", nombre: "Habitación", prefijo_codigo: "HAB", frecuencia_default: "mensual" },
  { id: "t5", codigo: "trampa_pegajosa", nombre: "Trampa pegajosa", prefijo_codigo: "TP", frecuencia_default: "semanal" },
  { id: "t6", codigo: "estacion_exterior", nombre: "Estación perimetral", prefijo_codigo: "EP", frecuencia_default: "mensual" },
  { id: "t7", codigo: "apertura", nombre: "Apertura / punto de sellado", prefijo_codigo: "AP", frecuencia_default: "mensual" },
  { id: "t8", codigo: "area_general", nombre: "Área general / recorrido", prefijo_codigo: "AG", frecuencia_default: "diaria" },
];

const base64 = fs.readFileSync(ruta).toString("base64");
const filas = await leerExcel(base64);

const prefijos = nombreHotel ? [normalizar(nombreHotel)] : [];
const porTipo = {};
const areas = new Map();
const estrategias = new Map();
const qr = new Set();
const sinQR = [];
const muestra = [];

for (const f of filas) {
  const codigo = valor(f, ["codigo", "punto", "estacion", "id", "no", "num"]);
  const token = valor(f, ["codigoqr", "qr", "token"]);
  const estrategia = valor(f, ["estrategia", "servicio", "programa"]);
  const hab = valor(f, ["habitacion", "hab", "cuarto", "room"]);
  let area = valor(f, ["area", "zona", "ubicacion", "sector"]);

  if (!codigo && !token && !hab) continue;

  if (area && String(area).length > 80) area = String(area).split("(")[0].trim() || "Área múltiple";
  area = recortarPrefijo(area, prefijos);

  const tipo = emparejarTipo(estrategia, TIPOS, hab, codigo, area);
  porTipo[tipo.nombre] = (porTipo[tipo.nombre] || 0) + 1;
  if (area) areas.set(normalizar(area), area);
  if (estrategia) estrategias.set(normalizar(estrategia), String(estrategia).trim());
  if (token) qr.add(String(token).trim());
  else sinQR.push(codigo);

  if (muestra.length < 12) {
    muestra.push({
      codigo: String(codigo || hab || ""),
      tipo: tipo.nombre,
      area: area || "(sin área)",
      frecuencia: normalizarFrecuencia(valor(f, ["frecuencia", "periodicidad"])) || tipo.frecuencia_default,
      qr: token ? `${token} (conservado)` : "se generará",
    });
  }
}

const linea = (t) => console.log(`\n${t}\n${"─".repeat(t.length)}`);

console.log(`\nArchivo: ${ruta}`);
console.log(`Filas con datos: ${filas.length}`);

linea("Tipo de punto asignado");
for (const [k, v] of Object.entries(porTipo).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(5)}  ${k}`);
}

linea(`Estrategias detectadas (${estrategias.size})`);
for (const e of estrategias.values()) console.log(`  · ${e}`);

linea(`Áreas que se crearían (${areas.size})`);
for (const a of [...areas.values()].slice(0, 25)) console.log(`  · ${a}`);
if (areas.size > 25) console.log(`  … y ${areas.size - 25} más`);

linea("Códigos QR");
console.log(`  Ya impresos que se conservan: ${qr.size}`);
console.log(`  Puntos sin QR (se generará uno): ${sinQR.length}`);

linea("Muestra de cómo quedarían");
console.table(muestra);
