// lib/auditoria.js — Bitácora de acciones (asa_log_auditoria)
//
// Vive aparte de server.mjs a propósito. Antes los routers importaban
// `logAccion` desde server.mjs mientras server.mjs importaba los routers: un
// ciclo que funciona solo si el proceso arranca por server.mjs, y que revienta
// ("Cannot access 'X' before initialization") en cuanto un script o una prueba
// importa una ruta directamente. Desde aquí no hay ciclo.
import { supabase } from "./supabaseClient.js";

export function usuarioDesdeReq(req) {
  if (req.usuario) {
    return {
      id: req.usuario.id ?? null,
      nombre: req.usuario.nombre || "Sistema",
      rol: req.usuario.rol || null,
    };
  }
  try {
    const h = req.headers?.["x-usuario"];
    if (h) {
      const u = JSON.parse(decodeURIComponent(h));
      return { id: u.id ?? null, nombre: u.nombre || "Sistema", rol: u.rol || null };
    }
  } catch {}
  const b = req.body || {};
  return { id: b.usuario_id ?? null, nombre: b.usuario_nombre || "Sistema", rol: null };
}

// Fire-and-forget: la auditoría nunca debe hacer fallar la operación real.
export function logAccion(req, { accion, modulo, registroId = null, descripcion = "", detalle = {} }) {
  const u = usuarioDesdeReq(req);
  supabase
    .from("asa_log_auditoria")
    .insert([
      {
        usuario_id: u.id,
        usuario_nombre: u.nombre,
        accion,
        modulo,
        registro_id: registroId,
        descripcion,
        detalle,
      },
    ])
    .then(() => {})
    .catch((e) => console.warn("[asa_log_auditoria] no se pudo registrar:", e.message));
}
