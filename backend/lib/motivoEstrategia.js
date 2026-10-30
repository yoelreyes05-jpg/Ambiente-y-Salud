// lib/motivoEstrategia.js — El "por qué no se pudo" que el técnico contesta en
// la ESTRATEGIA del punto (la de habitaciones lo pregunta en el checklist).
//
// El técnico no siempre usa los botones de "No pude hacerlo": muchas veces
// contesta "No" a "¿Se realizó el tratamiento?" y escribe o elige el motivo en
// la pregunta de la estrategia ("¿Por qué no se pudo realizar?", "Motivo…").
// Ese texto es lo que el hotel tiene que ver, tal cual lo puso el técnico.

import { supabase } from "./supabaseClient.js";

// Pregunta que pide el motivo: "¿Por qué no se pudo realizar?", "Motivo por el
// que no se realizó", "Razón", "No se realizó porque…"
export const PREGUNTA_MOTIVO = /no\s+se\s+(pudo|realiz|hizo)|por\s*qu[eé]\s+no|motivo|raz[oó]n/i;
// Pregunta "¿Se realizó…?" (si/no)
// "¿Se realizó el tratamiento / la aplicación?" = ¿se hizo el servicio? Pero NO
// "¿Se realizó recambio de aerosol / cambio de lámina?": eso es una parte del
// servicio; responder No ahí no quiere decir que el servicio no se hizo.
export const PREGUNTA_SE_REALIZO = /^(?!.*(cambi|reempla|recarg|sustitu|reposici|renov)).*se\s+realiz/i;

const VACIO = /^(n\/?a|no aplica|ninguno|ninguna|-+|—|\.)$/i;

// Texto de una respuesta, sea texto libre, opción única o varias opciones.
export function textoRespuesta(r) {
  if (!r) return "";
  const ops = Array.isArray(r.valor_opciones) ? r.valor_opciones.filter(Boolean) : [];
  const t = [r.valor_texto, ...ops].map((x) => String(x ?? "").trim()).filter(Boolean);
  return [...new Set(t)].join(", ");
}

// De la lista de respuestas, el motivo escrito por el técnico ("" si no hay).
export function motivoDeRespuestas(respuestas = []) {
  for (const r of respuestas) {
    if (!r || PREGUNTA_SE_REALIZO.test(String(r.pregunta_texto || "")) && r.valor_bool != null) continue;
    if (!PREGUNTA_MOTIVO.test(String(r.pregunta_texto || ""))) continue;
    const t = textoRespuesta(r);
    if (t && !VACIO.test(t)) return t;
  }
  return "";
}

// Texto libre → uno de los motivos del sistema, para las estadísticas y para
// saber de quién es el pendiente (hotel o ASA). Lo que no encaje queda "otro".
export function codigoMotivo(texto) {
  const t = String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/huesped|ocupad[ao] por|cliente dentro|no molestar|dnd/.test(t)) return "huesped_en_habitacion";
  if (/llave|nadie abr|no abr|cerrad/.test(t)) return "sin_llave";
  if (/permiso|autoriz|no (me |nos )?dej|neg/.test(t)) return "permiso_denegado";
  if (/mantenimiento|obra|reparaci|remodel/.test(t)) return "en_mantenimiento";
  if (/evento/.test(t)) return "evento_en_curso";
  if (/ocupad|limpiando|camarer|servicio/.test(t)) return "area_ocupada";
  if (/bloquead|inaccesib|tapiad|no se pudo llegar/.test(t)) return "punto_inaccesible";
  return "otro";
}

// Motivo escrito en la estrategia para cada inspección no realizada.
// inspeccion_id → texto
export async function motivosDeInspecciones(ids) {
  const unicos = [...new Set((ids || []).filter(Boolean))];
  const out = new Map();
  for (let i = 0; i < unicos.length; i += 300) {
    const { data } = await supabase
      .from("asa_inspeccion_respuestas")
      .select("inspeccion_id, pregunta_texto, valor_texto, valor_bool, valor_opciones")
      .in("inspeccion_id", unicos.slice(i, i + 300));
    const porInsp = new Map();
    for (const r of data || []) {
      if (!porInsp.has(r.inspeccion_id)) porInsp.set(r.inspeccion_id, []);
      porInsp.get(r.inspeccion_id).push(r);
    }
    for (const [id, rs] of porInsp) {
      const t = motivoDeRespuestas(rs);
      if (t) out.set(id, t);
    }
  }
  return out;
}
