// lib/certificadoPdf.js — Certificado de habitación libre de chinches
//
// Reproduce la carta que ASA ya entrega al hotel ("Certificación no chinches")
// con el mismo papel membretado, firma y sello, y cambia solo lo que varía:
// hotel, persona a quien va dirigida, número de habitación y fecha.
//
// Sale en español y en inglés (el huésped o la cadena muchas veces lo piden en
// inglés). Con idioma "ambos" se arma un solo PDF de dos hojas.
//
// Las imágenes viven en backend/assets/certificado/ y se sacaron del Word
// original: fondo.jpg (el membrete con la marca de agua), firma.png y
// sello.png (con el fondo vuelto transparente para que no tape el membrete).
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "certificado");
const leer = (n) => {
  try { return fs.readFileSync(path.join(DIR, n)); } catch { return null; }
};
const FONDO = leer("fondo.jpg");
const FIRMA = leer("firma.png");
const SELLO = leer("sello.png");

export const CERTIFICADO_DEFECTO = {
  empresa: "Ambiente y Salud ASA, S. R. L.",
  empresa_corta: "Ambiente y Salud, ASA",
  rnc: "RNC-131573258",
  firmante: "Santo Gavino Liranzo Terrero",
  cargo: "Gerente General",
  cargo_en: "General Manager",
};

const MESES = {
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

// "2026-10-03" o una fecha completa → partes en hora de RD
function partesFecha(f) {
  const d = typeof f === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f) ? new Date(f + "T12:00:00") : new Date(f || Date.now());
  const [y, m, dia] = d.toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" }).split("-").map(Number);
  return { y, m, dia };
}
function fechaCarta(f, idioma) {
  const { y, m, dia } = partesFecha(f);
  return idioma === "en"
    ? `${MESES.en[m - 1]} ${dia}, ${y}.`
    : `${String(dia).padStart(2, "0")} de ${MESES.es[m - 1]} de ${y}.`;
}

// Las fuentes estándar de PDF no tienen emojis; el resto (acentos, ñ) sí.
const limpio = (v) => String(v ?? "").replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();

function textos(c, idioma) {
  const hab = limpio(c.habitacion);
  const plaga = c.tipo === "codigo_rosa";
  if (idioma === "en") {
    return {
      a: "To:",
      asunto: `Subject: Inspection of room ${hab}`,
      cuerpo:
        `We hereby inform you that ${c.firma.empresa_corta} carried out an inspection of room number ${hab}, ` +
        `and observed that no levels of bed bug or flea infestation were found in it; therefore, it does not ` +
        `require treatment for them.`,
      cierre: "Without further ado, we thank you in advance for your kind attention.",
      cargo: c.firma.cargo_en,
      _plaga: plaga,
    };
  }
  return {
    a: "A:",
    asunto: `Asunto: Inspección habitación ${hab}`,
    cuerpo:
      `Extendemos la presente para informar que la empresa ${c.firma.empresa_corta}, procedió a realizar una ` +
      `inspección a la habitación número ${hab}, observando que en la misma no se encontró con niveles de ` +
      `infestación de chinches y pulgas, por lo que no requiere de tratamiento para las mismas.`,
    cierre: "Sin más por el momento me despido de usted no sin antes agradecerle sus atenciones de antemano.",
    cargo: c.firma.cargo,
    _plaga: plaga,
  };
}

// Una hoja. Medidas tomadas del Word original (A4, margen izquierdo 3 cm).
function hoja(doc, c, idioma) {
  const W = doc.page.width;
  const H = doc.page.height;
  const x = 85;
  const ancho = W - x - 85;
  const t = textos(c, idioma);

  if (FONDO) doc.image(FONDO, 0, 0, { width: W, height: H });

  doc.fillColor("#000000").font("Helvetica").fontSize(10.5);
  doc.text(limpio(c.firma.empresa), x, 108, { width: ancho });
  doc.text(limpio(c.firma.rnc), x, doc.y + 1, { width: ancho });
  doc.text(fechaCarta(c.fecha, idioma), x, doc.y + 1, { width: ancho });

  doc.font("Helvetica-Bold");
  doc.text(`${t.a} ${limpio(c.dirigido_a || "")}`.trim(), x, 168, { width: ancho });
  doc.text(limpio(c.hotel), x, doc.y + 1, { width: ancho });

  doc.text(t.asunto, x, 226, { width: ancho });

  doc.font("Helvetica").fontSize(10.5);
  doc.text(t.cuerpo, x, 268, { width: ancho, align: "justify", lineGap: 2 });
  doc.moveDown(1);
  doc.text(t.cierre, x, doc.y, { width: ancho, align: "justify", lineGap: 2 });

  // Firma, nombre y cargo; el sello montado debajo, como en el original.
  const yFirma = Math.max(doc.y + 26, 380);
  if (FIRMA) doc.image(FIRMA, x + 6, yFirma, { width: 130 });
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#000000");
  doc.text(limpio(c.firma.firmante), x, yFirma + 58, { width: ancho });
  doc.text(limpio(t.cargo), x, doc.y + 1, { width: ancho });
  if (SELLO) {
    doc.save();
    doc.opacity(0.42);
    doc.image(SELLO, x + 28, yFirma + 96, { width: 170 });
    doc.restore();
  }
}

/**
 * @param {object} c
 *   habitacion, hotel, dirigido_a, fecha (YYYY-MM-DD o Date), tipo,
 *   firma: { empresa, empresa_corta, rnc, firmante, cargo, cargo_en }
 * @param {"es"|"en"|"ambos"} idioma
 * @returns {Promise<Buffer>}
 */
export function construirCertificado(c, idioma = "es") {
  const datos = { ...c, firma: { ...CERTIFICADO_DEFECTO, ...(c.firma || {}) } };
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    info: {
      Title: `Certificado habitación ${limpio(c.habitacion)} - ${limpio(c.hotel)}`,
      Author: datos.firma.empresa,
    },
  });
  const trozos = [];
  doc.on("data", (t) => trozos.push(t));
  const listo = new Promise((ok) => doc.on("end", () => ok(Buffer.concat(trozos))));

  const idiomas = idioma === "ambos" ? ["es", "en"] : [idioma === "en" ? "en" : "es"];
  idiomas.forEach((i, n) => {
    if (n) doc.addPage();
    hoja(doc, datos, i);
  });
  doc.end();
  return listo;
}
