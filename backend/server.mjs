// ============================================================================
// Ambiente y Salud RD (ASA SRL) — Backend principal
// Mismo patron que crm-backend (Express + Supabase), pero TODAS las consultas
// de este servidor operan exclusivamente sobre tablas con prefijo "asa_".
// Nunca se debe agregar aqui una consulta a una tabla sin ese prefijo.
// ============================================================================
// El .env se carga dentro de lib/supabaseClient.js (import "dotenv/config"),
// que se evalua antes que el resto — ver el comentario en ese archivo.
import express from "express";
import cors from "cors";
import { supabase } from "./lib/supabaseClient.js";

export const app = express();

// ── CORS ─────────────────────────────────────────────────────────────────────
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim())
  : null;

app.use(
  cors({
    origin: (origin, cb) => {
      if (!CORS_ORIGINS) return cb(null, true);
      if (!origin) return cb(null, true);
      // "null" (string) es el Origin que envía el navegador cuando el panel
      // se abre como archivo local (file://index.html) en vez de servido por
      // un servidor — lo permitimos para poder probar el panel-web así.
      if (origin === "null") return cb(null, true);
      if (CORS_ORIGINS.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origen no permitido -> ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-usuario"],
    credentials: true,
  })
);
app.use(express.json({ limit: "15mb" }));

// ── Cliente Supabase (compartido en la infraestructura, pero este backend SOLO toca tablas asa_*) ──
export { supabase };

// ── Auditoria: registra acciones en asa_log_auditoria (fire-and-forget) ─────
export function usuarioDesdeReq(req) {
  try {
    const h = req.headers["x-usuario"];
    if (h) {
      const u = JSON.parse(decodeURIComponent(h));
      return { id: u.id ?? null, nombre: u.nombre || "Sistema", rol: u.rol || null };
    }
  } catch {}
  const b = req.body || {};
  return { id: b.usuario_id ?? null, nombre: b.usuario_nombre || "Sistema", rol: null };
}

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

// ── Rutas ────────────────────────────────────────────────────────────────────
import clientesRouter from "./routes/clientes.js";
import mascotasRouter from "./routes/mascotas.js";
import veterinariaRouter from "./routes/veterinaria.js";
import citasRouter from "./routes/citas.js";
import esteticaRouter from "./routes/estetica.js";
import plagasRouter from "./routes/plagas.js";
import ipmRouter from "./routes/ipm.js";
import inventarioRouter from "./routes/inventario.js";
import posRouter from "./routes/pos.js";
import facturacionRouter from "./routes/facturacion.js";
import contabilidadRouter from "./routes/contabilidad.js";
import nominaRouter from "./routes/nomina.js";
import usuariosRouter from "./routes/usuarios.js";
import rncRouter from "./routes/rnc.js";
import notificacionesRouter from "./routes/notificaciones.js";

app.get("/", (req, res) => {
  res.json({
    ok: true,
    sistema: "Ambiente y Salud RD (ASA SRL) - API",
    prefijo_tablas: "asa_",
    modulos: [
      "clientes", "mascotas", "veterinaria", "citas", "estetica",
      "plagas", "ipm", "inventario", "pos", "facturacion",
      "contabilidad", "nomina", "usuarios", "rnc", "notificaciones",
    ],
  });
});

app.use("/clientes", clientesRouter);
app.use("/mascotas", mascotasRouter);
app.use("/veterinaria", veterinariaRouter);
app.use("/citas", citasRouter);
app.use("/estetica", esteticaRouter);
app.use("/plagas", plagasRouter);
app.use("/ipm", ipmRouter);
app.use("/inventario", inventarioRouter);
app.use("/pos", posRouter);
app.use("/facturacion", facturacionRouter);
app.use("/contabilidad", contabilidadRouter);
app.use("/nomina", nominaRouter);
app.use("/usuarios", usuariosRouter);
app.use("/rnc", rncRouter);
app.use("/notificaciones", notificacionesRouter);

// ── Manejo de errores genérico ──────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("[ASA][error]", err);
  res.status(err.status || 500).json({ error: true, mensaje: err.message || "Error interno" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`[ASA] Backend escuchando en puerto ${PORT}`);
});
