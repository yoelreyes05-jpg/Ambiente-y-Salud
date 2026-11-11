// lib/perfilPortal.js — Qué ve cada cuenta del portal del hotel
//
// Una cuenta de hotel (cliente_calidad) puede ser de "calidad" (ve todo el
// portal, como siempre) o de "ama de llaves" (solo las pestañas que ASA le
// marque). Se guarda en asa_config_sistema, clave "portal_perfiles":
//   { usuario_id: { perfil: "ama_llaves", pestanas: ["hoy", "pendientes", "firmas"] } }
//
// El servidor también cierra las rutas propias de las pestañas que no tiene
// (documentos, solicitudes, chinche, firmas). Hoy, Historial, Por hacer, Mapa,
// Hallazgos y Cronograma comparten consultas entre sí: esas se esconden en la
// pantalla.

import { supabase } from "./supabaseClient.js";

export const PESTANAS_PORTAL = [
  ["hoy", "Hoy"], ["historial", "Historial"], ["pendientes", "Por hacer"], ["mapa", "Mapa"],
  ["hallazgos", "Hallazgos"], ["ordenes", "Solicitudes"], ["cronograma", "Cronograma"],
  ["incidencias", "Chinche"], ["documentos", "Documentos"], ["firmas", "Firmas"],
];
export const PERFILES = { calidad: "Calidad (ve todo)", ama_llaves: "Ama de llaves (solo lo marcado)" };
export const PESTANAS_AMA_LLAVES = ["hoy", "pendientes", "firmas"];

// Rutas que pertenecen a una sola pestaña
const RUTAS_DE = { documentos: ["/documentos"], ordenes: ["/solicitudes"], incidencias: ["/incidencias"], firmas: ["/firmas"] };

const CLAVE = "portal_perfiles";
let cache = { t: 0, valor: null };

export async function perfilesPortal(fresco = false) {
  if (!fresco && cache.valor && Date.now() - cache.t < 30000) return cache.valor;
  const { data, error } = await supabase.from("asa_config_sistema").select("valor").eq("clave", CLAVE).maybeSingle();
  if (error) throw new Error(error.message);
  cache = { t: Date.now(), valor: data?.valor && typeof data.valor === "object" ? data.valor : {} };
  return cache.valor;
}

export async function perfilDe(usuarioId) {
  const p = (await perfilesPortal())[usuarioId];
  if (!p || p.perfil !== "ama_llaves") return { perfil: "calidad", pestanas: PESTANAS_PORTAL.map(([k]) => k) };
  const validas = new Set(PESTANAS_PORTAL.map(([k]) => k));
  const pestanas = (Array.isArray(p.pestanas) ? p.pestanas : PESTANAS_AMA_LLAVES).filter((k) => validas.has(k));
  return { perfil: "ama_llaves", pestanas: pestanas.length ? pestanas : PESTANAS_AMA_LLAVES };
}

export async function guardarPerfil(usuarioId, perfil, pestanas) {
  const todos = { ...(await perfilesPortal(true)) };
  if (perfil === "ama_llaves") todos[usuarioId] = { perfil, pestanas: Array.isArray(pestanas) ? pestanas : PESTANAS_AMA_LLAVES };
  else delete todos[usuarioId];
  const { error } = await supabase.from("asa_config_sistema")
    .upsert([{ clave: CLAVE, valor: todos, updated_at: new Date().toISOString() }], { onConflict: "clave" });
  if (error) throw new Error(error.message);
  cache = { t: Date.now(), valor: todos };
  return perfilDe(usuarioId);
}

/** ¿La ruta pedida es de una pestaña que este perfil no tiene? */
export function rutaBloqueada(perfil, ruta) {
  if (!perfil || perfil.perfil !== "ama_llaves") return false;
  for (const [pestana, prefijos] of Object.entries(RUTAS_DE)) {
    if (perfil.pestanas.includes(pestana)) continue;
    if (prefijos.some((p) => ruta === p || ruta.startsWith(p + "/"))) return true;
  }
  return false;
}
