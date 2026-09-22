// lib/reportePdf.js — El reporte de evidencia que se presenta en auditoria
//
// Lo que un auditor de hotel pide, en este orden: que se hizo, quien lo hizo,
// que encontro, con que evidencia, y que NO se pudo hacer y por que. Este
// archivo arma exactamente eso en un PDF.
//
// Decisiones que vale la pena conocer:
//
// · Las fotos van dentro del PDF, no como enlaces. Un reporte de auditoria
//   tiene que sostenerse solo: dentro de dos anos, cuando el hotel lo saque de
//   un archivo, los enlaces pueden no existir y el PDF si.
//
// · Se descargan en paralelo pero con tope (LOTE_FOTOS). Una planta con 600
//   puntos y cinco fotos cada uno son 3,000 descargas: sin tope se le agota la
//   memoria al servidor, y con tope de 1 el reporte tarda minutos.
//
// · pdfkit solo mete JPEG y PNG. Una foto en webp se salta y se anota; es mejor
//   un reporte con una foto menos y una nota, que un 500 a mitad de camino.
//
// · Las fuentes estandar de PDF (Helvetica) manejan acentos y ñ, pero NO
//   emojis. El catalogo de tipos de punto y de plagas esta lleno de emojis
//   (🪰 🪳 🐁), asi que todo texto pasa por `limpiar()` antes de escribirse. Sin
//   eso, pdfkit escribe basura o revienta.
//
// · El detalle de cada servicio se arma con el texto de la pregunta guardado en
//   la respuesta (`pregunta_texto`), no con el de la tabla de preguntas. Si ASA
//   reescribio la pregunta el mes pasado, el reporte de marzo sigue mostrando
//   lo que realmente se le pregunto al tecnico en marzo. Eso es lo que hace que
//   el documento aguante una auditoria.
import PDFDocument from "pdfkit";

const LOTE_FOTOS = 6;
const MAX_BYTES_FOTO = 6 * 1024 * 1024;

// Paleta de marca ASA (la misma del panel y de la app del tecnico)
const C = {
  azul: "#32539C",
  azulOsc: "#24407C",
  azulClaro: "#BAC9E1",
  azulPastel: "#EAF0F8",
  verde: "#4A7D4D",
  verdeClaro: "#EDF5EE",
  rojo: "#B91C1C",
  rojoClaro: "#FEE2E2",
  ambar: "#B45309",
  ambarClaro: "#FEF3C7",
  texto: "#0F172A",
  suave: "#475569",
  linea: "#E2E8F0",
  gris: "#94A3B8",
};

// ── Texto ────────────────────────────────────────────────────────────────────
// Deja solo lo que las fuentes estandar de PDF saben escribir. Los emojis se
// caen; los acentos y la ñ se conservan.
function limpiar(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s+/g, " ")
    // Al caerse un emoji del medio queda un espacio suelto antes del signo:
    // "Cucaracha alemana : 3". Se recoge aqui y no en cada llamada.
    .replace(/\s+([:,.;)\]])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .trim();
}

const MOTIVOS_TEXTO = {
  permiso_denegado: "El hotel no autorizo el acceso",
  huesped_en_habitacion: "Huesped dentro de la habitacion",
  area_ocupada: "Area ocupada al momento de la visita",
  sin_llave: "No habia quien abriera",
  en_mantenimiento: "Area en obra o mantenimiento",
  punto_inaccesible: "Punto bloqueado o inaccesible",
  evento_en_curso: "Evento en curso en el area",
  otro: "Otro motivo",
};

const ESTADOS_TEXTO = {
  ok: "Conforme",
  actividad: "Con actividad",
  "dañado": "Danado",
  faltante: "Faltante",
  no_accesible: "No realizado",
  reemplazado: "Reemplazado",
};

const NIVEL_TEXTO = { ninguna: "Sin actividad", bajo: "Actividad baja", medio: "Actividad media", alto: "Actividad alta" };

const fechaLarga = (d) =>
  new Date(d).toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo", day: "2-digit", month: "long", year: "numeric" });
const fechaCorta = (d) =>
  new Date(d).toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo", day: "2-digit", month: "2-digit", year: "numeric" });
const horaCorta = (d) =>
  new Date(d).toLocaleTimeString("es-DO", { timeZone: "America/Santo_Domingo", hour: "2-digit", minute: "2-digit" });

// ── Fotos ────────────────────────────────────────────────────────────────────
// Acepta las dos formas que hay guardadas: data URL en base64 (lo que escribia
// la app antes de que las fotos se subieran a Storage) y URL publica.
async function bajarFoto(ref) {
  try {
    if (typeof ref !== "string" || !ref) return null;

    if (ref.startsWith("data:")) {
      const m = /^data:([^;]+);base64,(.*)$/s.exec(ref);
      if (!m) return null;
      if (!/jpeg|jpg|png/i.test(m[1])) return null;
      const buf = Buffer.from(m[2], "base64");
      return buf.length && buf.length < MAX_BYTES_FOTO ? buf : null;
    }

    if (!/^https?:\/\//i.test(ref)) return null;
    const res = await fetch(ref, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const tipo = res.headers.get("content-type") || "";
    if (!/jpeg|jpg|png/i.test(tipo)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length && buf.length < MAX_BYTES_FOTO ? buf : null;
  } catch {
    return null;
  }
}

async function bajarFotos(refs) {
  const salida = [];
  for (let i = 0; i < refs.length; i += LOTE_FOTOS) {
    const lote = await Promise.all(refs.slice(i, i + LOTE_FOTOS).map(bajarFoto));
    salida.push(...lote);
  }
  return salida;
}


// ════════════════════════════════════════════════════════════════════════════
// Piezas de dibujo
// ════════════════════════════════════════════════════════════════════════════
const ANCHO_UTIL = (doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;
const FONDO_HOJA = (doc) => doc.page.height - doc.page.margins.bottom;

// ── Hojas en blanco ──────────────────────────────────────────────────────────
//
// De aqui salian las paginas vacias del reporte. Dos causas, las dos silenciosas:
//
//   1. `espacio()` saltaba de hoja mirando solo la Y. Si la hoja en la que
//      estabamos ya era una hoja recien abierta y lo que venia no cabia (una
//      tabla larga, una rejilla de fotos), saltaba otra vez y dejaba la anterior
//      en blanco.
//   2. Un `doc.addPage()` escrito a mano —el de "Detalle de cada servicio"— que
//      se ejecutaba aunque la hoja actual estuviera limpia.
//
// La solucion es saber si la hoja en la que estamos tiene algo escrito. `marcar`
// lo dice cada vez que se dibuja de verdad, y `hojaLimpia` lo confirma mirando
// tambien la Y, porque pdfkit abre hojas por su cuenta cuando un texto largo se
// desborda y en esas la hoja si tiene contenido.
function marcar(doc) {
  doc._hojaVacia = false;
}
const hojaLimpia = (doc) => doc._hojaVacia === true && doc.y <= doc.page.margins.top + 0.5;

// Salto de hoja con conciencia: no abre una hoja nueva si la de ahora esta vacia.
function nuevaHoja(doc) {
  if (!hojaLimpia(doc)) doc.addPage();
}

// Deja listo el espacio de `alto` puntos: si no cabe en la pagina, salta.
// Es lo que evita un titulo de seccion solo al final de una hoja.
function espacio(doc, alto) {
  if (hojaLimpia(doc)) return;                 // ya estamos en una hoja limpia
  if (doc.y + alto > FONDO_HOJA(doc)) doc.addPage();
}

// `conservar` es cuanto contenido tiene que caber DEBAJO del titulo para que el
// titulo se quede en esta hoja. Sin eso salian hojas terminadas en un titulo
// solo, con su contenido empezando en la siguiente.
function tituloSeccion(doc, texto, color = C.azul, conservar = 90) {
  espacio(doc, conservar);
  marcar(doc);
  const x = doc.page.margins.left;
  doc.moveDown(0.6);
  const y = doc.y;
  doc.rect(x, y, 3.5, 16).fill(color);
  doc.fillColor(color).font("Helvetica-Bold").fontSize(13).text(limpiar(texto), x + 10, y + 1);
  doc.moveTo(x, doc.y + 5).lineTo(x + ANCHO_UTIL(doc), doc.y + 5).lineWidth(0.6).strokeColor(C.linea).stroke();
  doc.moveDown(0.8);
  doc.fillColor(C.texto).font("Helvetica").fontSize(9.5);
}

function parrafo(doc, texto, opciones = {}) {
  marcar(doc);
  // Anclar la x al margen en cada parrafo. pdfkit deja `doc.x` donde lo dejo la
  // ultima escritura, asi que despues de una tabla o de las tarjetas de
  // indicadores el texto arrancaba corrido a la derecha y se salia de la hoja.
  doc.x = doc.page.margins.left;
  doc.fillColor(opciones.color || C.suave).font(opciones.negrita ? "Helvetica-Bold" : "Helvetica")
     .fontSize(opciones.tam || 9);
  doc.text(limpiar(texto), doc.page.margins.left, doc.y, { width: ANCHO_UTIL(doc), ...opciones });
  doc.x = doc.page.margins.left;
  doc.fillColor(C.texto);
}

// Fila de indicadores grandes: es lo unico que mira el gerente del hotel.
//
// Se dibuja fila por fila con la Y calculada a mano. Dejar que pdfkit avance
// solo no sirve aqui: cada `text` mueve `doc.y`, asi que la segunda tarjeta
// arrancaba mas abajo que la primera y las ocho salian en escalera.
function kpis(doc, tarjetas, opciones = {}) {
  const cols = opciones.columnas || 4;
  const hueco = 8;
  const alto = 48;
  const ancho = ANCHO_UTIL(doc);
  const w = (ancho - (cols - 1) * hueco) / cols;

  for (let i = 0; i < tarjetas.length; i += cols) {
    const fila = tarjetas.slice(i, i + cols);
    espacio(doc, alto + hueco);
    marcar(doc);
    const y = doc.y;

    fila.forEach((t, j) => {
      const x = doc.page.margins.left + j * (w + hueco);
      doc.roundedRect(x, y, w, alto, 6).fillAndStroke(t.fondo || C.azulPastel, t.borde || C.azulClaro);
      doc.fillColor(t.color || C.azulOsc).font("Helvetica-Bold").fontSize(18)
         .text(limpiar(t.valor), x + 9, y + 7, { width: w - 18, lineBreak: false, ellipsis: true });
      doc.fillColor(C.suave).font("Helvetica").fontSize(6.8)
         .text(limpiar(t.etiqueta).toUpperCase(), x + 9, y + 30, { width: w - 18, height: 16 });
    });

    doc.y = y + alto + hueco;
    doc.x = doc.page.margins.left;
  }
  doc.fillColor(C.texto);
}

// Tabla sencilla. columnas: [{ titulo, ancho, alineacion?, negrita? }]
function tabla(doc, columnas, filas, opciones = {}) {
  const x0 = doc.page.margins.left;
  const total = columnas.reduce((a, c) => a + c.ancho, 0);
  const escala = ANCHO_UTIL(doc) / total;
  const anchos = columnas.map((c) => c.ancho * escala);

  // El alto del encabezado se mide, no se fija: con "MAXIMO EN UN PUNTO" en una
  // columna estrecha, un alto fijo de 17 cortaba la segunda linea a la mitad.
  doc.font("Helvetica-Bold").fontSize(7.6);
  const altoEnc = Math.max(
    17,
    ...columnas.map((c, i) => doc.heightOfString(limpiar(c.titulo).toUpperCase(), { width: anchos[i] - 8 }) + 9)
  );

  // Alto de una fila, medido igual que al dibujarla. Se usa para no dejar un
  // encabezado de tabla solo al final de una hoja.
  const altoFila = (fila) => {
    doc.font("Helvetica").fontSize(8.4);
    return Math.max(
      ...columnas.map((c, i) => doc.heightOfString(limpiar(fila[i]) || " ", { width: anchos[i] - 8 }))
    ) + 8;
  };

  const encabezado = () => {
    marcar(doc);
    const y = doc.y;
    doc.rect(x0, y, ANCHO_UTIL(doc), altoEnc).fill(opciones.colorEncabezado || C.azul);
    let x = x0;
    columnas.forEach((c, i) => {
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(7.6)
         .text(limpiar(c.titulo).toUpperCase(), x + 4, y + 4.5, { width: anchos[i] - 8, align: c.alineacion || "left" });
      x += anchos[i];
    });
    doc.y = y + altoEnc;
    doc.x = x0;
    doc.fillColor(C.texto);
  };

  // El encabezado solo se dibuja aqui si detras de el cabe al menos la primera
  // fila. Un encabezado azul solito al pie de una hoja es justo lo que se veia
  // como "hoja vacia con un encabezado".
  espacio(doc, altoEnc + (filas.length ? Math.min(altoFila(filas[0]), 90) : 0) + 4);
  encabezado();

  filas.forEach((fila, n) => {
    const celdas = columnas.map((c, i) => limpiar(fila[i]));
    const alto = altoFila(fila);

    if (doc.y + alto > FONDO_HOJA(doc)) {
      doc.addPage();
      encabezado();
    }

    marcar(doc);
    const y = doc.y;
    if (fila._fondo) doc.rect(x0, y, ANCHO_UTIL(doc), alto).fill(fila._fondo);
    else if (n % 2 === 1) doc.rect(x0, y, ANCHO_UTIL(doc), alto).fill("#FAFBFC");

    let x = x0;
    columnas.forEach((c, i) => {
      doc.fillColor(fila._color || C.texto)
         .font(c.negrita ? "Helvetica-Bold" : "Helvetica").fontSize(8.4)
         .text(celdas[i] || "", x + 4, y + 4, { width: anchos[i] - 8, align: c.alineacion || "left" });
      x += anchos[i];
    });
    doc.y = y + alto;
    doc.moveTo(x0, doc.y).lineTo(x0 + ANCHO_UTIL(doc), doc.y).lineWidth(0.4).strokeColor(C.linea).stroke();
  });
  doc.y += 6;
  doc.x = x0;
  doc.fillColor(C.texto);
}

// ── Histograma de barras ─────────────────────────────────────────────────────
// Barras apiladas, una por periodo. Se dibuja a mano y no con una libreria de
// graficos: son cuatro rectangulos y un eje, y meter una dependencia de
// graficos al servidor por esto seria cambiar un problema pequeno por otro
// grande (fuentes, canvas nativo, binarios que no compilan en Railway).
function histograma(doc, datos, series, colores, opciones = {}) {
  if (!datos.length) {
    parrafo(doc, "Sin datos en el periodo seleccionado.", { color: C.gris });
    return;
  }

  const altoGrafico = opciones.alto || 150;
  espacio(doc, altoGrafico + 60);
  marcar(doc);

  const x0 = doc.page.margins.left;
  const ancho = ANCHO_UTIL(doc);
  const y0 = doc.y;
  const ejeY = 34;                       // espacio para los numeros de la izquierda
  const areaAncho = ancho - ejeY;
  const maximo = Math.max(1, ...datos.map((d) => series.reduce((a, s) => a + (Number(d[s]) || 0), 0)));

  // Lineas guia y su valor. Cuatro son suficientes: mas lineas no se leen.
  doc.font("Helvetica").fontSize(6.8).fillColor(C.gris);
  for (let i = 0; i <= 4; i++) {
    const v = Math.round((maximo / 4) * i);
    const y = y0 + altoGrafico - (altoGrafico / 4) * i;
    doc.moveTo(x0 + ejeY, y).lineTo(x0 + ancho, y).lineWidth(0.4)
       .strokeColor(i === 0 ? C.suave : C.linea).stroke();
    doc.text(String(v), x0, y - 3, { width: ejeY - 5, align: "right" });
  }

  // Ancho de barra: con muchos periodos se estrechan, con pocos se topan a 48
  // para que tres dias no salgan como tres columnas gigantes.
  const paso = areaAncho / datos.length;
  const wBarra = Math.min(paso * 0.68, 48);

  datos.forEach((d, i) => {
    const centro = x0 + ejeY + paso * i + paso / 2;
    let acumulado = 0;
    series.forEach((s) => {
      const v = Number(d[s]) || 0;
      if (!v) return;
      const h = (v / maximo) * altoGrafico;
      doc.rect(centro - wBarra / 2, y0 + altoGrafico - acumulado - h, wBarra, h)
         .fill(colores[s] || C.azul);
      acumulado += h;
    });

    // Etiqueta del eje X. Si hay muchos periodos solo se rotula uno cada n,
    // porque encimadas no se leen y ensucian el grafico.
    const cada = Math.ceil(datos.length / 14);
    if (i % cada === 0) {
      doc.font("Helvetica").fontSize(6.2).fillColor(C.suave)
         .text(limpiar(opciones.etiqueta ? opciones.etiqueta(d) : d.periodo),
               centro - paso / 2, y0 + altoGrafico + 4, { width: paso, align: "center", lineBreak: false });
    }
  });

  doc.y = y0 + altoGrafico + 18;

  // Leyenda
  let lx = x0 + ejeY;
  doc.fontSize(7.4);
  series.forEach((s) => {
    const texto = limpiar(s);
    const w = doc.widthOfString(texto) + 18;
    if (lx + w > x0 + ancho) { lx = x0 + ejeY; doc.y += 12; }
    doc.rect(lx, doc.y + 1.5, 7, 7).fill(colores[s] || C.azul);
    doc.fillColor(C.suave).font("Helvetica").text(texto, lx + 11, doc.y, { lineBreak: false });
    lx += w;
  });
  doc.y += 16;
  doc.x = x0;
  doc.fillColor(C.texto);
}

// ── Rejilla de fotos ─────────────────────────────────────────────────────────
// Tres por fila con su pie. El pie importa: una foto sin decir de que punto y
// de que area es, en auditoria no prueba nada.
function rejillaFotos(doc, fotos, opciones = {}) {
  const porFila = opciones.porFila || 3;
  const ancho = ANCHO_UTIL(doc);
  const hueco = 8;
  const w = (ancho - hueco * (porFila - 1)) / porFila;
  const h = opciones.alto || w * 0.75;

  for (let i = 0; i < fotos.length; i += porFila) {
    const fila = fotos.slice(i, i + porFila);
    espacio(doc, h + 26);
    marcar(doc);
    const y = doc.y;

    fila.forEach((f, j) => {
      const x = doc.page.margins.left + j * (w + hueco);
      doc.roundedRect(x, y, w, h, 4).lineWidth(0.6).strokeColor(C.linea).stroke();
      try {
        doc.image(f.buffer, x + 1.5, y + 1.5, { fit: [w - 3, h - 3], align: "center", valign: "center" });
      } catch {
        doc.fillColor(C.gris).fontSize(7).text("Foto no legible", x + 4, y + h / 2 - 4, { width: w - 8, align: "center" });
      }
      if (f.pie) {
        doc.fillColor(C.suave).font("Helvetica").fontSize(6.6)
           .text(limpiar(f.pie), x, y + h + 2.5, { width: w, align: "center", height: 18 });
      }
    });
    doc.y = y + h + (fila.some((f) => f.pie) ? 20 : 6);
    doc.x = doc.page.margins.left;
  }
  doc.fillColor(C.texto);
}

// ════════════════════════════════════════════════════════════════════════════
// El reporte completo
//
// Devuelve un Buffer con el PDF. Recibe los datos ya consultados (ver
// routes/reportes.js): este archivo no toca la base, solo dibuja. Asi el mismo
// armado sirve para el panel de ASA y para el portal del hotel, que consultan
// con permisos distintos.
// ════════════════════════════════════════════════════════════════════════════
export async function construirReporte(d, opciones = {}) {
  const conFotos = opciones.fotos !== false;
  const conDetalle = opciones.detalle !== false;

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 46, bottom: 52, left: 40, right: 40 },
    bufferPages: true,
    info: {
      Title: `Reporte de control de plagas - ${limpiar(d.sitio?.nombre || "")}`,
      Author: limpiar(d.empresa?.razon_social || d.empresa?.nombre || "Ambiente y Salud RD"),
      Subject: `Periodo ${d.periodo.desde} a ${d.periodo.hasta}`,
    },
  });

  const trozos = [];
  doc.on("data", (t) => trozos.push(t));
  const terminado = new Promise((ok) => doc.on("end", () => ok(Buffer.concat(trozos))));

  // Cada hoja nueva nace vacia; `marcar()` la da por escrita en cuanto se dibuja
  // algo. Es lo que impide que un salto de hoja se coma una hoja en blanco.
  doc._hojaVacia = true;
  doc.on("pageAdded", () => { doc._hojaVacia = true; });

  // Los estados del punto se editan desde el panel, asi que el texto viene con
  // los datos. La tabla de aqui abajo queda solo como respaldo para reportes de
  // ambientes donde todavia no se corrio la migracion.
  const estadoTexto = (codigo) =>
    d.estados?.[codigo] || ESTADOS_TEXTO[codigo] || String(codigo || "").replace(/_/g, " ");

  // ── Portada ───────────────────────────────────────────────────────────────
  const e = d.empresa || {};
  marcar(doc);
  const x0 = doc.page.margins.left;
  const ancho = ANCHO_UTIL(doc);

  doc.rect(0, 0, doc.page.width, 106).fill(C.azul);
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(20)
     .text(limpiar(e.nombre || "Ambiente y Salud RD"), x0, 26, { width: ancho - 150 });
  doc.font("Helvetica").fontSize(8.6).fillColor(C.azulClaro)
     .text(limpiar([e.razon_social, e.rnc ? `RNC ${e.rnc}` : null].filter(Boolean).join(" · ")), x0, 52)
     .text(limpiar([e.telefono, e.email, e.web].filter(Boolean).join(" · ")), x0, 64)
     .text(limpiar(e.direccion), x0, 76, { width: ancho - 150 });
  doc.font("Helvetica-Bold").fontSize(8.4).fillColor("#FFFFFF")
     .text("CONTROL INTEGRADO DE PLAGAS", x0, 90);

  doc.y = 124;
  doc.fillColor(C.texto).font("Helvetica-Bold").fontSize(17)
     .text(limpiar(`Reporte de servicios y evidencia`), x0, doc.y, { width: ancho });
  doc.font("Helvetica").fontSize(11).fillColor(C.suave)
     .text(limpiar(d.sitio?.nombre || "Todas las plantas"), { width: ancho });
  doc.moveDown(0.8);

  const datosCabecera = [
    ["Cliente", d.sitio?.cliente || "—"],
    ["Planta / complejo", d.sitio?.nombre || "Todas"],
    ["Direccion", d.sitio?.direccion || "—"],
    ["Periodo cubierto", `${fechaLarga(d.periodo.desde)} al ${fechaLarga(d.periodo.hasta)}`],
    ["Responsable tecnico", e.responsable_tecnico || "—"],
    ["Licencia sanitaria", e.licencia_sanitaria || "—"],
    ["Generado", `${fechaLarga(new Date())} a las ${horaCorta(new Date())}`],
  ];
  doc.fontSize(9);
  datosCabecera.forEach(([k, v]) => {
    const y = doc.y;
    doc.font("Helvetica-Bold").fillColor(C.suave).text(limpiar(k), x0, y, { width: 130 });
    doc.font("Helvetica").fillColor(C.texto).text(limpiar(v), x0 + 136, y, { width: ancho - 136 });
    doc.y = Math.max(doc.y, y) + 2;
  });

  // ── Resumen ───────────────────────────────────────────────────────────────
  const r = d.resumen || {};
  tituloSeccion(doc, "Resumen del periodo");
  kpis(doc, [
    { valor: r.servicios_realizados ?? 0, etiqueta: "Servicios realizados", fondo: C.verdeClaro, borde: C.verde, color: C.verde },
    { valor: r.no_realizados ?? 0, etiqueta: "No realizados", fondo: r.no_realizados ? C.rojoClaro : C.azulPastel, borde: r.no_realizados ? C.rojo : C.azulClaro, color: r.no_realizados ? C.rojo : C.azulOsc },
    { valor: r.con_actividad ?? 0, etiqueta: "Con actividad detectada", fondo: C.ambarClaro, borde: C.ambar, color: C.ambar },
    { valor: r.plagas_contadas ?? 0, etiqueta: "Individuos contados" },
    { valor: r.puntos_total ?? 0, etiqueta: "Puntos de control" },
    { valor: `${r.cumplimiento_pct ?? 0}%`, etiqueta: "Puntos dentro de frecuencia" },
    { valor: r.fotos ?? 0, etiqueta: "Fotos de evidencia" },
    { valor: r.hallazgos_abiertos ?? 0, etiqueta: "Hallazgos por corregir", fondo: r.hallazgos_abiertos ? C.rojoClaro : C.azulPastel, borde: r.hallazgos_abiertos ? C.rojo : C.azulClaro, color: r.hallazgos_abiertos ? C.rojo : C.azulOsc },
  ]);

  if (r.tecnicos?.length) {
    parrafo(doc, `Personal que ejecuto los servicios: ${r.tecnicos.join(", ")}.`);
  }

  // ── Histograma ────────────────────────────────────────────────────────────
  if (d.histograma?.datos?.length) {
    tituloSeccion(doc, `Servicios registrados por ${d.histograma.agrupar === "mes" ? "mes" : d.histograma.agrupar === "semana" ? "semana" : "dia"}`);
    parrafo(doc, "Cada barra es un periodo, partida por el nivel de actividad encontrado. Una barra que crece con mucho rojo es el aviso temprano: el problema esta subiendo antes de que el hotel lo reclame.");
    doc.moveDown(0.4);
    histograma(doc, d.histograma.datos, d.histograma.series, {
      ninguna: C.azulClaro, bajo: C.verde, medio: C.ambar, alto: C.rojo,
      ...(d.histograma.colores || {}),
    }, {
      etiqueta: (x) => (String(x.periodo).length === 10 ? String(x.periodo).slice(5).replace("-", "/") : x.periodo),
    });
  }

  // ── Plagas ────────────────────────────────────────────────────────────────
  if (d.plagas?.length) {
    tituloSeccion(doc, "Plagas encontradas: tipo, cantidad y tendencia");
    tabla(doc,
      [
        { titulo: "Plaga", ancho: 150, negrita: true },
        { titulo: "Grupo", ancho: 70 },
        { titulo: "Registros", ancho: 55, alineacion: "right" },
        { titulo: "Individuos", ancho: 60, alineacion: "right" },
        { titulo: "Max. en un punto", ancho: 72, alineacion: "right" },
        { titulo: "Tendencia", ancho: 75, alineacion: "right" },
      ],
      d.plagas.map((p) => {
        const flecha = p.tendencia === "sube" ? "Sube" : p.tendencia === "baja" ? "Baja" : p.tendencia === "nueva" ? "Nueva" : "Estable";
        const fila = [
          p.plaga, p.grupo || "—", p.registros ?? "—", p.total,
          p.maximo ?? "—",
          p.variacion_pct == null ? flecha : `${flecha} ${p.variacion_pct > 0 ? "+" : ""}${p.variacion_pct}%`,
        ];
        if (p.tendencia === "sube") { fila._fondo = C.rojoClaro; fila._color = C.rojo; }
        return fila;
      })
    );
    parrafo(doc, "La tendencia compara la mitad reciente del periodo contra la mitad anterior. Una plaga marcada como nueva no aparecia en la primera mitad.");
  }

  // ── Por area ──────────────────────────────────────────────────────────────
  if (d.por_area?.length) {
    tituloSeccion(doc, "Servicios por area");
    tabla(doc,
      [
        { titulo: "Area", ancho: 170, negrita: true },
        { titulo: "Nivel / planta", ancho: 80 },
        { titulo: "Servicios", ancho: 55, alineacion: "right" },
        { titulo: "Con activ.", ancho: 60, alineacion: "right" },
        { titulo: "No realiz.", ancho: 60, alineacion: "right" },
        { titulo: "Individuos", ancho: 55, alineacion: "right" },
      ],
      d.por_area.map((a) => {
        const fila = [a.area || "Sin area", a.nivel || "—", a.servicios, a.con_actividad, a.no_realizados, a.plagas];
        if (a.no_realizados > 0) fila._color = C.rojo;
        return fila;
      })
    );
  }

  // ── No realizados ─────────────────────────────────────────────────────────
  tituloSeccion(doc, "Servicios que NO se pudieron realizar", d.no_realizados?.length ? C.rojo : C.verde);
  if (!d.no_realizados?.length) {
    parrafo(doc, "Todos los servicios programados en el periodo se ejecutaron. No hubo accesos negados ni areas inaccesibles.", { color: C.verde, negrita: true });
  } else {
    parrafo(doc, "Cada linea es un servicio que el tecnico se presento a hacer y no pudo. Se deja registrado el motivo y con quien se hablo, porque la responsabilidad no es la misma cuando el hotel no autoriza el acceso que cuando el equipo de ASA no llego.");
    doc.moveDown(0.3);
    tabla(doc,
      [
        { titulo: "Fecha", ancho: 52 },
        { titulo: "Punto / habitacion", ancho: 95, negrita: true },
        { titulo: "Area", ancho: 95 },
        { titulo: "Motivo", ancho: 120 },
        { titulo: "Informado por", ancho: 88 },
        { titulo: "Resp.", ancho: 55 },
      ],
      d.no_realizados.map((n) => {
        const fila = [
          fechaCorta(n.fecha),
          n.numero_habitacion ? `Hab. ${n.numero_habitacion}` : n.codigo_visible,
          [n.area, n.nivel].filter(Boolean).join(" · ") || "—",
          MOTIVOS_TEXTO[n.motivo_no_realizado] || n.motivo_no_realizado || "Sin motivo registrado",
          n.impedido_por || "—",
          ["permiso_denegado", "sin_llave", "huesped_en_habitacion", "area_ocupada", "evento_en_curso"].includes(n.motivo_no_realizado) ? "Hotel" : "ASA",
        ];
        fila._fondo = C.rojoClaro;
        fila._color = "#7F1D1D";
        return fila;
      }),
      { colorEncabezado: C.rojo }
    );
  }

  // ── Hallazgos ─────────────────────────────────────────────────────────────
  if (d.hallazgos?.length) {
    tituloSeccion(doc, "Hallazgos y su estado");
    tabla(doc,
      [
        { titulo: "Fecha", ancho: 52 },
        { titulo: "Hallazgo", ancho: 200, negrita: true },
        { titulo: "Area", ancho: 90 },
        { titulo: "Severidad", ancho: 55 },
        { titulo: "Resp.", ancho: 55 },
        { titulo: "Estado", ancho: 60 },
      ],
      d.hallazgos.map((h) => {
        const fila = [
          h.fecha_reporte ? fechaCorta(h.fecha_reporte) : "—",
          h.titulo, h.area || "—", h.severidad,
          h.responsable === "cliente" ? "Hotel" : "ASA",
          h.estado,
        ];
        if (h.severidad === "critica" && h.estado !== "corregido") { fila._fondo = C.rojoClaro; fila._color = C.rojo; }
        return fila;
      })
    );
  }

  // ── Detalle servicio por servicio ─────────────────────────────────────────
  if (conDetalle && d.servicios?.length) {
    nuevaHoja(doc);
    tituloSeccion(doc, "Detalle de cada servicio realizado");
    parrafo(doc, `${d.servicios.length} servicios, con las preguntas que el tecnico verifico una por una, lo que encontro y su evidencia fotografica. El texto de cada pregunta es el que estaba vigente el dia de la visita, no el de hoy: por eso el reporte sigue siendo valido si despues se cambio el checklist.`);
    doc.moveDown(0.5);

    for (const s of d.servicios) {
      await bloqueServicio(doc, s, { conFotos, estadoTexto });
    }
  }

  // ── Fotos sueltas (cuando se pide el reporte sin el detalle) ──────────────
  if (conFotos && !conDetalle) {
    const refs = [];
    for (const s of d.servicios || []) {
      for (const f of s.fotos || []) {
        refs.push({ ref: f, pie: `${s.numero_habitacion ? `Hab. ${s.numero_habitacion}` : s.codigo_visible} · ${s.area || ""} · ${fechaCorta(s.fecha)}` });
      }
    }
    if (refs.length) {
      tituloSeccion(doc, "Evidencia fotografica");
      const buffers = await bajarFotos(refs.map((x) => x.ref));
      const utiles = buffers.map((b, i) => (b ? { buffer: b, pie: refs[i].pie } : null)).filter(Boolean);
      rejillaFotos(doc, utiles);
      if (utiles.length < refs.length) {
        parrafo(doc, `${refs.length - utiles.length} fotos no se pudieron incluir (formato no compatible con PDF o archivo inaccesible).`, { color: C.gris, tam: 7.5 });
      }
    }
  }

  // ── Pie y numeracion ──────────────────────────────────────────────────────
  //
  // Aqui estaba el grueso de las hojas vacias, y no se veia a simple vista: el
  // pie se escribe a 34 puntos del borde, o sea POR DEBAJO del margen inferior
  // (52). Cuando a `text` se le pasa un `width`, pdfkit lo trata como texto
  // normal, ve que no cabe antes del margen y abre una hoja nueva para
  // escribirlo alli — una hoja por cada pie, cada una con esa linea suelta
  // arriba, que es lo que se veia como "hoja vacia con un encabezado". Y como el
  // total de paginas ya estaba contado, esas hojas extra ni siquiera llevaban
  // numero.
  //
  // Bajar el margen a cero mientras se escribe el pie le dice a pdfkit que ahi
  // abajo si se puede escribir. Se devuelve el margen al salir por si alguien
  // dibuja algo despues.
  const rango = doc.bufferedPageRange();
  for (let i = 0; i < rango.count; i++) {
    doc.switchToPage(rango.start + i);
    const margenAbajo = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    const y = doc.page.height - 34;
    doc.moveTo(40, y - 6).lineTo(doc.page.width - 40, y - 6).lineWidth(0.5).strokeColor(C.linea).stroke();
    doc.font("Helvetica").fontSize(7).fillColor(C.gris);
    doc.text(limpiar(`${e.nombre || "Ambiente y Salud RD"} · ${d.sitio?.nombre || ""} · ${d.periodo.desde} a ${d.periodo.hasta}`),
             40, y, { width: doc.page.width - 160, lineBreak: false });
    doc.text(`Pagina ${i + 1} de ${rango.count}`, doc.page.width - 120, y, { width: 80, align: "right", lineBreak: false });

    doc.page.margins.bottom = margenAbajo;
  }

  doc.end();
  return terminado;
}

// Un servicio: cabecera con donde y quien, la tabla de respuestas, las plagas y
// sus fotos. Se mantiene junto en la medida de lo posible (`espacio`) para que
// un servicio no quede partido entre dos hojas sin necesidad.
async function bloqueServicio(doc, s, { conFotos, estadoTexto = (v) => ESTADOS_TEXTO[v] || v }) {
  espacio(doc, 96);
  marcar(doc);
  const x0 = doc.page.margins.left;
  const ancho = ANCHO_UTIL(doc);
  const y = doc.y;

  const noHecho = !!s.motivo_no_realizado;
  const acento = noHecho ? C.rojo : s.nivel_actividad && s.nivel_actividad !== "ninguna" ? C.ambar : C.verde;

  doc.roundedRect(x0, y, ancho, 44, 5).fillAndStroke(noHecho ? C.rojoClaro : "#FBFCFE", C.linea);
  doc.rect(x0, y, 3.5, 44).fill(acento);

  const titulo = s.numero_habitacion ? `Habitacion ${s.numero_habitacion}` : (s.punto_nombre || s.codigo_visible);
  doc.fillColor(C.texto).font("Helvetica-Bold").fontSize(10.5)
     .text(limpiar(`${s.codigo_visible} — ${titulo}`), x0 + 10, y + 6, { width: ancho - 160, lineBreak: false });
  doc.font("Helvetica").fontSize(8).fillColor(C.suave)
     .text(limpiar([s.tipo_nombre, s.area, s.nivel ? `Nivel ${s.nivel}` : null, s.planta].filter(Boolean).join("  ·  ")),
           x0 + 10, y + 20, { width: ancho - 160 })
     .text(limpiar(`${s.tecnico || "Sin tecnico"}  ·  acceso por ${s.metodo_acceso === "qr" ? "QR" : s.metodo_acceso}`),
           x0 + 10, y + 31, { width: ancho - 160 });

  doc.font("Helvetica-Bold").fontSize(8.2).fillColor(acento)
     .text(limpiar(noHecho ? "NO REALIZADO" : estadoTexto(s.estado_punto)),
           x0 + ancho - 150, y + 7, { width: 140, align: "right" });
  doc.font("Helvetica").fontSize(7.6).fillColor(C.suave)
     .text(limpiar(`${fechaCorta(s.fecha)} · ${horaCorta(s.fecha)}`), x0 + ancho - 150, y + 20, { width: 140, align: "right" })
     .text(limpiar(noHecho ? "" : (NIVEL_TEXTO[s.nivel_actividad] || "")), x0 + ancho - 150, y + 31, { width: 140, align: "right" });

  doc.y = y + 50;

  if (noHecho) {
    parrafo(doc, `Motivo: ${MOTIVOS_TEXTO[s.motivo_no_realizado] || s.motivo_no_realizado}${s.impedido_por ? `. Informado por: ${s.impedido_por}` : ""}${s.notas ? `. ${s.notas}` : ""}`, { color: C.rojo, negrita: true, tam: 8.5 });
    doc.moveDown(0.5);
    return;
  }

  // Respuestas del checklist: lo que el tecnico verifico y le dio el visto.
  if (s.respuestas?.length) {
    tabla(doc,
      [
        { titulo: "Visto", ancho: 40, alineacion: "center" },
        { titulo: "Pregunta", ancho: 250 },
        { titulo: "Respuesta del tecnico", ancho: 190, negrita: true },
      ],
      // La columna "Visto" es literal: cada linea es una pregunta que el tecnico
      // respondio en campo. Lo que no contesto no aparece.
      s.respuestas.map((q) => ["Si", q.pregunta_texto, valorRespuesta(q)]),
      { colorEncabezado: C.azulOsc }
    );
  } else {
    parrafo(doc, "Este punto no tenia checklist asignado el dia de la visita: solo se registro estado y nivel de actividad.", { color: C.gris, tam: 7.8 });
  }

  // Plagas contadas en este punto
  if (s.capturas?.length) {
    doc.font("Helvetica-Bold").fontSize(8.6).fillColor(C.texto).text("Plagas contadas en este punto:");
    doc.font("Helvetica").fontSize(8.6).fillColor(C.suave)
       .text(limpiar(s.capturas.map((c) => `${c.plaga}: ${c.cantidad}${c.etapa ? ` (${c.etapa})` : ""}${c.sobre_umbral ? " — SOBRE EL UMBRAL" : ""}`).join("   |   ")),
             { width: ANCHO_UTIL(doc) });
    doc.moveDown(0.4);
  }

  if (s.notas) {
    doc.font("Helvetica-Bold").fontSize(8.4).fillColor(C.texto).text("Observaciones del tecnico: ", { continued: true });
    doc.font("Helvetica").fillColor(C.suave).text(limpiar(s.notas));
    doc.moveDown(0.3);
  }

  // Fotos del servicio, con su pie
  if (conFotos) {
    const refs = [...(s.fotos || [])];
    for (const q of s.respuestas || []) for (const f of q.fotos || []) refs.push(f);
    if (refs.length) {
      const buffers = await bajarFotos(refs);
      const pie = `${s.numero_habitacion ? `Hab. ${s.numero_habitacion}` : s.codigo_visible} · ${s.area || ""}`;
      const utiles = buffers.map((b) => (b ? { buffer: b, pie } : null)).filter(Boolean);
      if (utiles.length) rejillaFotos(doc, utiles, { porFila: 3, alto: 110 });
    }
  }

  doc.moveDown(0.4);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + ANCHO_UTIL(doc), doc.y)
     .lineWidth(0.5).strokeColor(C.azulClaro).stroke();
  doc.moveDown(0.7);
}

function valorRespuesta(q) {
  if (q.valor_bool !== null && q.valor_bool !== undefined) return q.valor_bool ? "Si" : "No";
  if (q.valor_numero !== null && q.valor_numero !== undefined) return String(q.valor_numero);
  if (Array.isArray(q.valor_opciones) && q.valor_opciones.length) return q.valor_opciones.join(", ");
  if (q.valor_texto) return q.valor_texto;
  return "—";
}
