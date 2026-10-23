// lib/plagasUnificadas.js — Plagas que se cuentan como una sola
//
// Para el hotel una cucaracha es una cucaracha: alemana, americana, oriental o
// de banda marrón suman en "Cucarachas". Se unifican al leer (reportes,
// estadísticas, ficha del servicio), sin tocar lo que guardó el técnico, así
// que el historial viejo también queda junto.

const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const GRUPOS = [
  { prueba: /cucaracha/, codigo: "cucarachas", nombre: "Cucarachas", color: "#b45309" },
];

/** La plaga tal como se debe mostrar y sumar. Devuelve la misma si no se une con otra. */
export function unificarPlaga(p) {
  if (!p) return p;
  const t = `${norm(p.codigo)} ${norm(p.nombre)}`;
  const g = GRUPOS.find((x) => x.prueba.test(t));
  return g ? { ...p, codigo: g.codigo, nombre: g.nombre, color: g.color, nombre_cientifico: null } : p;
}
