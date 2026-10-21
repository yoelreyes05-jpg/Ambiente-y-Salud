// lib/sitiosTecnico.js — A qué hoteles está asignado un técnico
//
// Se usa la misma tabla del portal del hotel (asa_usuario_sitios). Un técnico
// SIN hoteles asignados trabaja en todos (como antes); con hoteles asignados,
// la app solo le muestra esos y el servidor no le acepta servicios de otros.
import { supabase } from "./supabaseClient.js";

const CACHE = new Map();
const MS = 30_000;

export function olvidarSitiosTecnico(usuarioId) {
  if (usuarioId) CACHE.delete(usuarioId);
  else CACHE.clear();
}

/** null = sin restricción; [...] = solo esos sitio_id */
export async function sitiosDelTecnico(req) {
  if (req.usuario?.rol !== "tecnico_plagas") return null;
  const id = req.usuario.id;
  const g = CACHE.get(id);
  if (g && Date.now() - g.t < MS) return g.ids;
  const { data, error } = await supabase.from("asa_usuario_sitios").select("sitio_id").eq("usuario_id", id);
  if (error) return null; // ante la duda no se bloquea el trabajo
  const ids = (data || []).map((r) => r.sitio_id);
  const valor = ids.length ? ids : null;
  CACHE.set(id, { ids: valor, t: Date.now() });
  return valor;
}
