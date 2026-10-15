// lib/leerHabitaciones.js — Habitaciones desde la hoja como la tenga el hotel
//
// El importador de puntos espera una tabla (una fila por punto, con columnas
// Área, Código, Habitación…). Pero los hoteles mandan sus habitaciones como
// las usan en el día a día, por ejemplo la "sábana de fumigación":
//
//            Villa Barahona 1er piso          Villa Barahona 2do piso
//   No Hab. | Fecha | Preventivo …    No Hab. | Fecha | Preventivo …
//   1113    |       |                 1213    |
//   1114    |       |                 1214    |
//
// Aquí se lee ese tipo de hoja, en todas sus pestañas, y se convierte en las
// mismas filas de tabla que entiende el importador (Área, Tipo de área, Piso,
// Habitación, Código, Tipo). El nombre del área y el piso salen del título de
// cada bloque; si el título no dice el piso, se saca del número (1213 → 2).
//
// También se aceptan:
//   - Varias pestañas con la misma tabla, una por villa o bloque, sin columna
//     de área: el nombre de la pestaña es el área.
//   - Listas sueltas de números bajo un título, sin encabezado "Hab.".
//   - CSV (separado por coma, punto y coma o tabulador).

import { normalizarAgrupacion, pisoDeNumero } from "./agrupacion.js";

const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

// Texto de una celda de ExcelJS (texto enriquecido, fórmula, hipervínculo…)
export function textoCelda(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return null;
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) v = v.richText.map((t) => t.text).join("");
    else v = v.text ?? v.result ?? v.hyperlink ?? null;
    if (v === null || v === undefined || typeof v === "object") return null;
  }
  const t = String(v).replace(/ /g, " ");
  return t.trim() === "" ? null : t;
}

// "No Hab.", "Habitación", "No. de habitaciones", "Room", "Cuarto", "Suite"
const ENCABEZADO_HAB = /^(no|n|num|numero|nro|nr|nu|numer)?(de)?(hab|habs|habit|habitacion|habitaciones|room|rooms|roomno|cuarto|cuartos|suite|suites)(no|num|numero)?$/;
export const esEncabezadoHab = (t) => !!t && ENCABEZADO_HAB.test(norm(t));

// Número de habitación: 101, 1101, 21001, "A-12", "B204", "1205A"
function numeroHab(v) {
  if (typeof v === "number") return Number.isInteger(v) && v > 0 && v < 1000000 ? String(v) : null;
  const t = textoCelda(v);
  if (!t) return null;
  const s = t.trim();
  if (s.length > 10 || !/\d/.test(s)) return null;
  if (/^\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?$/.test(s)) return null; // fecha
  return /^[A-Za-z]{0,3}[- ]?\d{1,6}[A-Za-z]?$/.test(s) ? s.replace(/\s+/g, "") : null;
}

const ORDINALES = { primer: 1, primero: 1, segundo: 2, tercer: 3, tercero: 3, cuarto: 4, quinto: 5, sexto: 6, septimo: 7, octavo: 8 };

// "Villa Barahona 2do piso" → { nombre: "Villa Barahona", piso: "2" }
export function separarPiso(texto) {
  let t = String(texto || "").replace(/\s+/g, " ").trim();
  let piso = null;
  const quitar = (re, valor) => {
    const m = t.match(re);
    if (!m) return false;
    piso = valor(m);
    t = (t.slice(0, m.index) + " " + t.slice(m.index + m[0].length)).trim();
    return true;
  };
  quitar(/\b(planta\s*baja|lobby\s*level|pb)\b/i, () => "0") ||
    quitar(/(\d{1,2})\s*(?:er|ro|re|do|to|vo|no|mo|avo|°|º|o)?\.?\s*(?:piso|nivel|planta|floor)\b/i, (m) => String(Number(m[1]))) ||
    quitar(/\b(?:piso|nivel|planta|floor)\s*(?:no\.?|#|n°)?\s*(\d{1,2})\b/i, (m) => String(Number(m[1]))) ||
    quitar(new RegExp(`\\b(${Object.keys(ORDINALES).join("|")})\\s+(?:piso|nivel|planta)\\b`, "i"), (m) => String(ORDINALES[m[1].toLowerCase()]));
  const nombre = t.replace(/^[\s\-–—:,·.|]+|[\s\-–—:,·.|]+$/g, "").replace(/\s+/g, " ").trim();
  return { nombre, piso };
}

// "VILLA AZUA" / "villa perdenales" → "Villa Azua" / "Villa Perdenales"
function bonito(t) {
  if (!t) return t;
  const todoMayus = t === t.toUpperCase();
  return t
    .split(" ")
    .map((w, i) => {
      const l = todoMayus ? w.toLowerCase() : w;
      if (i > 0 && ["de", "del", "la", "las", "los", "y"].includes(l.toLowerCase())) return l.toLowerCase();
      return l.charAt(0).toUpperCase() + l.slice(1);
    })
    .join(" ");
}

function distancia(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

const TITULO_IGNORADO = /^(hotel|hoteles|sabana|control de|programa|reporte|registro|fecha|mes|ano|año)\b/i;
const HOJA_GENERICA = /^(hoja|sheet|tabla|libro)\s*\d*$/i;

// Cuadrícula de una pestaña de ExcelJS, con las celdas combinadas resueltas:
// cada celda dice su texto y cuál es su celda "dueña" (la de arriba a la
// izquierda de la combinación), para saber qué título cubre qué columna.
export function cuadriculaDeHoja(ws) {
  const filas = ws.rowCount, cols = ws.columnCount;
  const celdas = [];
  for (let r = 1; r <= filas; r++) {
    const fila = [];
    for (let c = 1; c <= cols; c++) {
      const cel = ws.getCell(r, c);
      const duena = cel.isMerged && cel.master ? cel.master : cel;
      fila[c] = { v: duena.value, dueno: `${duena.row}:${duena.col}`, colDueno: duena.col, filaDueno: duena.row };
    }
    celdas[r] = fila;
  }
  return { nombre: ws.name, filas, cols, celdas };
}

// Cuadrícula desde CSV
export function cuadriculaDeCSV(texto, nombre = "CSV") {
  const lineas = String(texto).replace(/^﻿/, "").split(/\r?\n/);
  const muestra = lineas.slice(0, 10).join("\n");
  const sep = [";", "\t", ","].sort((a, b) => muestra.split(b).length - muestra.split(a).length)[0];
  const celdas = [];
  let cols = 0;
  lineas.forEach((linea, i) => {
    const valores = [];
    let actual = "", comillas = false;
    for (let k = 0; k < linea.length; k++) {
      const ch = linea[k];
      if (ch === '"') {
        if (comillas && linea[k + 1] === '"') { actual += '"'; k++; } else comillas = !comillas;
      } else if (ch === sep && !comillas) { valores.push(actual); actual = ""; }
      else actual += ch;
    }
    valores.push(actual);
    cols = Math.max(cols, valores.length);
    const fila = [];
    valores.forEach((v, j) => {
      const t = v.trim();
      fila[j + 1] = { v: /^\d+$/.test(t) && t.length < 7 && !t.startsWith("0") ? Number(t) : t || null, dueno: `${i + 1}:${j + 1}`, colDueno: j + 1, filaDueno: i + 1 };
    });
    celdas[i + 1] = fila;
  });
  return { nombre, filas: lineas.length, cols, celdas };
}

const celda = (g, r, c) => g.celdas[r]?.[c] || { v: null, dueno: `${r}:${c}`, colDueno: c, filaDueno: r };

// Lee una "sábana": bloques de habitaciones bajo un título. Devuelve los
// bloques encontrados (vacío si la hoja no tiene esa forma).
function bloquesDeHoja(g) {
  const encabezados = [];
  for (let r = 1; r <= g.filas; r++)
    for (let c = 1; c <= g.cols; c++) {
      const x = celda(g, r, c);
      if (x.dueno === `${r}:${c}` && esEncabezadoHab(textoCelda(x.v))) encabezados.push({ r, c });
    }

  const filasEncabezado = new Set(encabezados.map((h) => h.r));
  const corridas = [];

  // Bajando por la columna desde el encabezado (o desde el primer número):
  // se juntan los números hasta el siguiente título o encabezado. Se toleran
  // filas vacías sueltas, que en las sábanas son habitaciones que no existen.
  const bajar = (c, desde) => {
    const nums = [];
    let vacias = 0, r = desde;
    for (; r <= g.filas; r++) {
      const x = celda(g, r, c);
      const n = numeroHab(x.v);
      if (n) { nums.push({ n, r, c }); vacias = 0; continue; }
      const t = textoCelda(x.v);
      if (t && x.colDueno === c) break;               // título o encabezado propio de la columna
      if (t && x.colDueno !== c && x.filaDueno === r) break; // título combinado que cruza la columna
      if (++vacias > 4 && nums.length) break;
    }
    return { nums, hasta: r };
  };

  if (encabezados.length) {
    for (const h of encabezados) {
      const { nums } = bajar(h.c, h.r + 1);
      corridas.push({ c: h.c, rEnc: h.r, nums });
    }
  } else {
    // Sin encabezado "Hab.": columnas con al menos 3 números seguidos y un
    // título arriba. Una columna de números sin título no se toma (puede ser
    // una cantidad, un precio…).
    for (let c = 1; c <= g.cols; c++) {
      let r = 1;
      while (r <= g.filas) {
        if (!numeroHab(celda(g, r, c).v)) { r++; continue; }
        const { nums, hasta } = bajar(c, r);
        if (nums.length >= 3) corridas.push({ c, rEnc: r - 1, nums, sinEncabezado: true });
        r = Math.max(hasta, r + 1);
      }
    }
  }
  if (!corridas.length) return [];

  // Título de cada corrida: la fila con texto más cercana por encima (hasta 6
  // filas), saltando la fila de encabezados ("No Hab. | Fecha | …") y sin
  // pasar por encima de otra corrida de la misma columna.
  for (const k of corridas) {
    k.titulo = null;
    for (let r = k.rEnc - (k.sinEncabezado ? 0 : 1); r >= Math.max(1, k.rEnc - 6); r--) {
      if (filasEncabezado.has(r)) continue;
      if (numeroHab(celda(g, r, k.c).v)) break;
      // Texto que cubre la columna (propio o combinado), o el más cercano a la izquierda
      let cand = null;
      const aqui = celda(g, r, k.c);
      if (textoCelda(aqui.v)) cand = aqui;
      else {
        for (let c = k.c - 1; c >= 1; c--) {
          const x = celda(g, r, c);
          if (numeroHab(x.v)) break;
          if (textoCelda(x.v)) { cand = celda(g, x.filaDueno, x.colDueno); break; }
        }
      }
      const texto = cand && textoCelda(cand.v);
      if (texto && !esEncabezadoHab(texto) && !TITULO_IGNORADO.test(texto.trim())) {
        k.titulo = { clave: cand.dueno, texto, col: cand.colDueno };
        break;
      }
    }
  }

  // Un título puede llevar dos bloques: "Villa Barahona 1er piso      Villa
  // Barahona 2do piso" escrito en una sola celda. Cada bloque toma su parte,
  // en orden de columna.
  const porTitulo = new Map();
  for (const k of corridas) {
    if (!k.titulo) continue;
    if (!porTitulo.has(k.titulo.clave)) porTitulo.set(k.titulo.clave, []);
    porTitulo.get(k.titulo.clave).push(k);
  }
  for (const grupo of porTitulo.values()) {
    grupo.sort((a, b) => a.c - b.c);
    const partes = grupo[0].titulo.texto.split(/\s{3,}|\n|\t/).map((s) => s.trim()).filter(Boolean);
    let nombreAnterior = null;
    grupo.forEach((k, i) => {
      const parte = partes.length === 1 ? partes[0] : partes[Math.min(i, partes.length - 1)];
      const { nombre, piso } = separarPiso(parte);
      k.area = nombre || nombreAnterior || (partes.length > 1 ? separarPiso(partes[0]).nombre : null);
      k.piso = piso;
      nombreAnterior = k.area;
    });
  }
  // Sin título propio: hereda el área de la corrida de arriba en la misma columna
  const ordenadas = [...corridas].sort((a, b) => a.c - b.c || a.rEnc - b.rEnc);
  for (const [i, k] of ordenadas.entries()) {
    if (k.area) continue;
    const arriba = ordenadas.slice(0, i).reverse().find((x) => x.c === k.c && x.area);
    k.area = arriba?.area || (HOJA_GENERICA.test(g.nombre.trim()) ? null : g.nombre.trim());
  }
  return corridas.filter((k) => k.nums.length);
}

// ¿Es el mismo nombre con una letra de más o de menos? Se compara solo la
// parte que distingue ("Perdernales" en "Villa Perdernales"), con la misma
// primera palabra, y nunca nombres cortos: "Bloque A" y "Bloque B" o "Samana"
// y "Romana" son áreas distintas.
function mismoNombre(x, y) {
  if (norm(x) === norm(y)) return true;
  const px = x.trim().split(/\s+/), py = y.trim().split(/\s+/);
  if (px.length < 2 || py.length < 2 || px[0].toLowerCase() !== py[0].toLowerCase()) return false;
  const a = norm(px.slice(1).join(" ")), b = norm(py.slice(1).join(" "));
  if (Math.min(a.length, b.length) < 6 || /\d/.test(a + b)) return false;
  return distancia(a, b) <= 1;
}

// Une "Villa Perdernales" y "Villa perdenales" (el mismo nombre escrito
// distinto en la misma hoja): se queda la forma con más habitaciones.
function unirNombresParecidos(filas, avisos) {
  const cuenta = new Map();
  for (const f of filas) if (f.area) cuenta.set(f.area, (cuenta.get(f.area) || 0) + 1);
  const nombres = [...cuenta.keys()].sort((a, b) => cuenta.get(b) - cuenta.get(a));
  const canon = new Map();
  const elegidos = [];
  for (const n of nombres) {
    const igual = elegidos.find((e) => mismoNombre(n, e));
    if (igual) {
      canon.set(n, igual);
      if (norm(igual) !== norm(n)) avisos.push(`"${n}" y "${igual}" parecen la misma área escrita distinto: se juntaron como "${igual}"`);
    } else {
      canon.set(n, n);
      elegidos.push(n);
    }
  }
  for (const f of filas) if (f.area) f.area = canon.get(f.area);
}

/**
 * Lee las habitaciones de una o varias cuadrículas con forma de sábana.
 * @returns {{ filas: object[], avisos: string[], hojas: string[] } | null}
 */
export function leerSabana(cuadriculas) {
  const crudas = [];
  const hojas = [];
  for (const g of cuadriculas) {
    const bloques = bloquesDeHoja(g);
    if (!bloques.length) continue;
    hojas.push(g.nombre);
    for (const b of bloques)
      for (const x of b.nums) crudas.push({ hab: x.n, area: b.area ? bonito(b.area) : null, piso: b.piso, hoja: g.nombre, fila: x.r, col: x.c });
  }
  if (!crudas.length) return null;

  const avisos = [];
  unirNombresParecidos(crudas, avisos);

  const vistos = new Map();
  const filas = [];
  const colLetra = (c) => { let s = ""; for (; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s; return s; };
  for (const f of crudas) {
    const donde = `${f.hoja}!${colLetra(f.col)}${f.fila}`;
    const clave = norm(f.hab);
    if (vistos.has(clave)) {
      const a = vistos.get(clave);
      avisos.push(`Habitación ${f.hab} repetida (${a.area || "sin área"} en ${a.donde} y ${f.area || "sin área"} en ${donde}): se dejó la primera`);
      continue;
    }
    vistos.set(clave, { area: f.area, donde });
    const piso = f.piso ?? pisoDeNumero(f.hab);
    const agrup = f.area ? normalizarAgrupacion(f.area) : null;
    filas.push({
      "Área": f.area,
      "Tipo de área": agrup && agrup !== "otro" ? agrup : null,
      Piso: piso,
      "Habitación": f.hab,
      "Código": /^\d+$/.test(f.hab) ? `H${f.hab}` : f.hab,
      Tipo: "Habitación",
    });
  }
  const sinArea = filas.filter((f) => !f["Área"]).length;
  if (sinArea) avisos.push(`${sinArea} habitación(es) sin título de villa o bloque encima: quedan sin área`);
  return { filas, avisos, hojas };
}
