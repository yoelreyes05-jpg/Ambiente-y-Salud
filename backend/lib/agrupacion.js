// lib/agrupacion.js — Bloques, villas y pisos (40_bloques_villas.sql)
//
// Algunos hoteles agrupan las habitaciones por bloques o por villas, y cada
// habitación está en un piso. Las vistas de la base (asa_v_puntos_estado) no
// traen esos dos datos, así que se leen aquí y se pegan a las filas.
//
// Si la migración 40 todavía no se corrió, devuelve mapas vacíos y todo sigue
// funcionando como antes.

import { supabase } from "./supabaseClient.js";
import { traerTodo } from "./paginar.js";

export const AGRUPACIONES = ["bloque", "villa", "edificio", "torre", "otro"];

/** @returns {Promise<{ areas: Map<string,string>, pisos: Map<string,string> }>} */
export async function datosAgrupacion(sitioId) {
  const areas = new Map();
  const pisos = new Map();
  try {
    const { data } = await supabase.from("asa_areas").select("*").eq("sitio_id", sitioId);
    for (const a of data || []) if (a.agrupacion) areas.set(a.id, a.agrupacion);
  } catch {}
  try {
    const filas = await traerTodo(() =>
      supabase.from("asa_puntos_control").select("id, piso").eq("sitio_id", sitioId).not("piso", "is", null).order("id")
    );
    for (const p of filas) if (p.piso) pisos.set(p.id, String(p.piso));
  } catch {}
  return { areas, pisos };
}

// "1101" → "1"; "205" → "2"; "21001" → "1". Solo para sugerir el piso al
// importar cuando la hoja no lo dice.
export function pisoDeNumero(numero) {
  const s = String(numero || "").replace(/\D/g, "");
  if (s.length === 3) return s[0];
  if (s.length >= 4) return s[1];
  return null;
}

// Texto del tipo de agrupación escrito como venga ("Villas", "BLOQUE", "villa")
export function normalizarAgrupacion(t) {
  const n = String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  if (!n) return null;
  if (n.startsWith("villa")) return "villa";
  if (n.startsWith("bloq")) return "bloque";
  if (n.startsWith("edif")) return "edificio";
  if (n.startsWith("torre")) return "torre";
  return "otro";
}
