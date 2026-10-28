// lib/cotejo.js — Cotejo de fumigación
//
// Puntos que se trabajan en serie (offices, carritos, registros…) no necesitan
// el formulario completo: el técnico los marca con una casilla al hacerlos y,
// si encontró plaga, dice cuál y cuántas. Las preguntas de la estrategia se
// contestan solas: "sin incidencia" si no marcó plaga, o con la plaga si la hay.
//
// Qué estrategias van en el cotejo lo decide ASA en el panel (Estrategias →
// "En el cotejo"). Se guarda en asa_config_sistema, clave "estrategias_cotejo"
// (lista de ids), que ya existe: no hace falta tocar la base de datos.

import { supabase } from "./supabaseClient.js";

const CLAVE = "estrategias_cotejo";

export async function estrategiasCotejo() {
  const { data, error } = await supabase.from("asa_config_sistema").select("valor").eq("clave", CLAVE).maybeSingle();
  if (error) throw new Error(error.message);
  return Array.isArray(data?.valor) ? data.valor.map(String) : [];
}

export async function marcarEstrategiaCotejo(estrategiaId, enCotejo) {
  const ids = new Set(await estrategiasCotejo());
  if (enCotejo) ids.add(String(estrategiaId)); else ids.delete(String(estrategiaId));
  const { error } = await supabase.from("asa_config_sistema")
    .upsert([{ clave: CLAVE, valor: [...ids], updated_at: new Date().toISOString() }], { onConflict: "clave" });
  if (error) throw new Error(error.message);
  return ids.has(String(estrategiaId));
}

const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Preguntas que hablan de plaga encontrada: su respuesta depende de si hubo plaga
const DE_PLAGA = /plaga|actividad|incidencia|presencia|evidencia|indicio|hallazgo|infestac|rastro|excremento|huella|captur|especie|insecto|roedor|cucaracha|mosca|hormiga/;
// Preguntas sobre un problema del punto (daño, suciedad…): en el cotejo, "no"
const DE_PROBLEMA = /\bdan(o|os|ad[oa]s?)\b|deterior|\brot[oa]s?\b|suci|faltante|obstru|humedad|filtraci|reemplaz|reparar|favorec/;
// Opciones de "no hay nada"
const NINGUNA = /^(ningun[oa]?|nada|sin\b|no\b|no se|no hay|negativo|ausente)/;

/**
 * Las respuestas del checklist para un punto marcado en el cotejo.
 * @param preguntas   preguntas de la estrategia del punto (asa_preguntas)
 * @param plagas      [{ nombre, cantidad }] lo que el técnico marcó (vacío = sin plaga)
 */
export function respuestasCotejo(preguntas, plagas = []) {
  const hay = plagas.some((p) => Number(p.cantidad) > 0 || p.cantidad == null);
  const total = plagas.reduce((s, p) => s + (Number(p.cantidad) || 0), 0);
  const nombres = plagas.map((p) => p.nombre);
  const texto = hay ? `Plaga encontrada: ${plagas.map((p) => `${p.nombre}${p.cantidad ? ` (${p.cantidad})` : ""}`).join(", ")}` : "Sin incidencia";
  const salida = [];

  for (const p of preguntas || []) {
    const t = norm(p.texto);
    const r = { pregunta_id: p.id, pregunta_texto: p.texto };
    if (p.tipo_respuesta === "si_no") {
      // "¿Hay presencia de plagas?" → según lo marcado; "¿Está dañado?" → no;
      // "¿Se realizó la aplicación?", "¿Está en buen estado?" → sí
      r.valor_bool = /favorec/.test(t) ? false : DE_PLAGA.test(t) ? hay : DE_PROBLEMA.test(t) ? false : true;
    } else if (p.tipo_respuesta === "seleccion" || p.tipo_respuesta === "multiple") {
      const ops = (p.opciones || []).map(String);
      if (!DE_PLAGA.test(t)) continue;             // "Áreas tratadas", "Producto"…: no se adivina
      let elegidas;
      if (hay) {
        elegidas = ops.filter((o) => nombres.some((n) => norm(o).includes(norm(n).replace(/s$/, "").slice(0, 6)) || norm(n).includes(norm(o).replace(/s$/, "").slice(0, 6))));
        if (!elegidas.length) elegidas = ops.filter((o) => /otr/.test(norm(o)));
        if (!elegidas.length) { r.valor_texto = nombres.join(", "); salida.push(r); continue; }
      } else {
        elegidas = ops.filter((o) => NINGUNA.test(norm(o).trim()));
        if (!elegidas.length) { r.valor_texto = "Sin incidencia"; salida.push(r); continue; }
      }
      r.valor_opciones = elegidas;
      r.valor_texto = elegidas.join(", ");
    } else if (p.tipo_respuesta === "numero") {
      if (!DE_PLAGA.test(t) && !/conteo|cantidad|numero|individuo/.test(t)) continue;
      r.valor_numero = total;
    } else if (p.tipo_respuesta === "escala") {
      if (!DE_PLAGA.test(t)) continue;
      r.valor_numero = hay ? Math.min(5, Math.max(2, Math.ceil(total / 3) + 1)) : 1;
      r.valor_texto = String(r.valor_numero);
    } else if (p.tipo_respuesta === "texto") {
      if (!DE_PLAGA.test(t) && !/observ|nota|coment|hallazg/.test(t)) continue;
      r.valor_texto = texto;
    } else {
      continue;                                     // fotos u otros: no se inventan
    }
    salida.push(r);
  }
  return salida;
}

/** Nivel de actividad según cuántas plagas se contaron */
export const nivelCotejo = (total, hay) => (!hay ? "ninguna" : total >= 10 ? "alto" : total >= 4 ? "medio" : "bajo");
