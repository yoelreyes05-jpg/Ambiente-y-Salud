// lib/productoDeArchivo.js — De qué producto y de qué tipo es un archivo
//
// "FICHA_TECNICA_FENDONA.pdf"           → ficha_tecnica, "Fendona"
// "18.1-_Hoja_Seguridad_Klerat.pdf"     → hoja_seguridad, "Klerat"
// "MSDS Demand CS.pdf"                  → hoja_seguridad, "Demand CS"
// La misma lógica está en panel-web/documentos.js para llenar el formulario.

const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function categoriaDeArchivo(nombre) {
  const t = norm(nombre).replace(/[_\-.]+/g, " ");
  if (/\b(hoja\s*(de\s*)?(datos\s*(de\s*)?)?seguridad|m?sds|fds|hds)\b/.test(t)) return "hoja_seguridad";
  if (/\bficha\s*tecnica\b|\bficha\b|\btds\b/.test(t)) return "ficha_tecnica";
  return null;
}

export function productoDeArchivo(nombre) {
  let t = String(nombre || "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_]+/g, " ");
  const n = norm(t);
  // Se quitan las palabras del tipo de documento, en el texto original (con acentos)
  const quitar = /(hoja\s*(de\s*)?(datos\s*(de\s*)?)?seguridad|ficha\s*t[eé]cnica|\bficha\b|\bm?sds\b|\bfds\b|\bhds\b|\btds\b|\bdel?\b\s*(?=$)|\bversi[oó]n\b\s*\d*|\brev\.?\s*\d+)/gi;
  if (!n) return null;
  t = t.replace(quitar, " ")
    .replace(/^[\s\d.\-–:)]+/, "")         // "18.1- " al principio
    .replace(/[\s\-–:.]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!t) return null;
  // MAYÚSCULAS → Tipo Título; si ya viene mezclado se respeta.
  if (t === t.toUpperCase()) t = t.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  return t;
}

export const mismoProducto = (a, b) => norm(a).replace(/[^a-z0-9]/g, "") === norm(b).replace(/[^a-z0-9]/g, "");

// ── Para qué plagas es un producto ──────────────────────────────────────────
// rastreros (cucarachas, hormigas…), voladores (moscas, mosquitos…), roedores.
// Lo que se marque en el catálogo (grupo_plaga: "rastreros,voladores") manda;
// si está vacío se deduce del nombre, el ingrediente activo y el uso.
export const GRUPOS_PLAGA = ["rastreros", "voladores", "roedores"];
const PISTAS = {
  roedores: /roedor|\brata|\braton|rodentic|brodifacoum|bromadiolon|difenacoum|difetialon|flocoumafen|klerat|\bstorm\b|racumin|contrac|ratimor/,
  voladores: /mosca|mosquito|zancudo|volador|jejen|polilla|avispa|aedes|culex|larvicid|temefos|\babate\b|agita|quick\s*bayt/,
  rastreros: /cucaracha|hormiga|rastrer|chinche|pulga|garrapata|alacran|escorpion|arana|grillo|tijereta|ciempies|termita|comejen|fipronil|hidrametilnon|indoxacarb|advion|maxforce|goliath/,
};
// Piretroides y residuales de amplio espectro: sirven para los dos
const AMPLIO = /cipermetrin|cypermethrin|lambda|cihalotrin|cyhalothrin|deltametrin|deltamethrin|bifentrin|bifenthrin|permetrin|permethrin|fendona|\bdemand\b|k-?othrine|temprid|suspend|\btempo\b/;

export function gruposPlaga(p) {
  const marcados = String(p?.grupo_plaga || "").split(",").map((x) => x.trim()).filter((x) => GRUPOS_PLAGA.includes(x));
  if (marcados.length) return { grupos: marcados, deducido: false };
  const t = norm(`${p?.nombre_comercial} ${p?.principio_activo} ${p?.uso}`);
  const grupos = GRUPOS_PLAGA.filter((g) => PISTAS[g].test(t));
  if (AMPLIO.test(t)) for (const g of ["rastreros", "voladores"]) if (!grupos.includes(g)) grupos.push(g);
  return { grupos: GRUPOS_PLAGA.filter((g) => grupos.includes(g)), deducido: true };
}
