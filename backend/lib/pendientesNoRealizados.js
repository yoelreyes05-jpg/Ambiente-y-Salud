// lib/pendientesNoRealizados.js — "No se pudo" que sigue pendiente
//
// Cuando el técnico no puede hacer un punto (huésped en la habitación, sin
// llave…), el punto NO queda hecho: queda pendiente, en amarillo, con su
// motivo. Antes ese amarillo duraba solo el día del intento; al otro día la
// habitación volvía a rojo y el hotel ya no veía por qué no se hizo.
//
// Aquí se busca, por punto, el último intento fallido que todavía no se ha
// resuelto: el que es posterior al último servicio realizado del punto. En
// cuanto el técnico lo hace, ese intento deja de contar solo.

import { supabase } from "./supabaseClient.js";
import { traerTodo } from "./paginar.js";
import { motivosDeInspecciones } from "./motivoEstrategia.js";

// Hasta cuántos días atrás se mira. Un intento más viejo que esto ya no se
// muestra como "no se pudo": el punto queda simplemente por hacer.
const DIAS_ATRAS = 60;

/**
 * @param {string} sitioId
 * @param {Map<string, string|null>} ultimaRealizada  punto_id → fecha del último servicio realizado
 * @returns {Promise<Map<string, {inspeccion_id, punto_id, fecha, motivo_no_realizado, tecnico}>>}
 */
export async function intentosPendientes(sitioId, ultimaRealizada) {
  const desde = new Date(Date.now() - DIAS_ATRAS * 86400000).toISOString();
  let filas;
  try {
    filas = await traerTodo(() =>
      supabase
        .from("asa_inspecciones")
        .select("id, punto_id, fecha, motivo_no_realizado, asa_empleados(nombre_completo), asa_usuarios(nombre_completo)")
        .eq("sitio_id", sitioId)
        .not("motivo_no_realizado", "is", null)
        .gte("fecha", desde)
        .order("fecha", { ascending: true })
        .order("id")
    );
  } catch {
    return new Map(); // sin esto el día se sigue viendo como antes
  }

  const out = new Map();
  for (const i of filas) {
    const ultima = ultimaRealizada.get(i.punto_id);
    if (ultima && new Date(ultima) >= new Date(i.fecha)) continue; // ya se hizo después
    out.set(i.punto_id, {
      inspeccion_id: i.id,
      punto_id: i.punto_id,
      fecha: i.fecha,
      motivo_no_realizado: i.motivo_no_realizado,
      tecnico: i.asa_empleados?.nombre_completo || i.asa_usuarios?.nombre_completo || null,
    });
  }
  // El motivo tal como lo escribió el técnico en la estrategia
  const textos = await motivosDeInspecciones([...out.values()].map((x) => x.inspeccion_id)).catch(() => new Map());
  for (const x of out.values()) x.motivo_texto = textos.get(x.inspeccion_id) || null;
  return out;
}
