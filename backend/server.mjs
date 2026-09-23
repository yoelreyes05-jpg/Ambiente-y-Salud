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
import { requireAuth, cargarAlcance, soloLectura } from "./middleware/auth.js";

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
app.use(express.json({ limit: "25mb" }));

// ── Cliente Supabase (compartido en la infraestructura, pero este backend SOLO toca tablas asa_*) ──
export { supabase };

// ── Auditoria ────────────────────────────────────────────────────────────────
// La implementación vive en lib/auditoria.js (sin ciclo de imports). Se
// reexporta aquí porque el código anterior la importaba desde este archivo.
export { usuarioDesdeReq, logAccion } from "./lib/auditoria.js";

// ── Rutas ────────────────────────────────────────────────────────────────────
import clientesRouter from "./routes/clientes.js";
import sitiosRouter from "./routes/sitios.js";
import puntosRouter from "./routes/puntos.js";
import inspeccionesRouter from "./routes/inspecciones.js";
import estrategiasRouter from "./routes/estrategias.js";
import hallazgosRouter from "./routes/hallazgos.js";
import reportesRouter from "./routes/reportes.js";
import mascotasRouter from "./routes/mascotas.js";
import veterinariaRouter from "./routes/veterinaria.js";
import citasRouter from "./routes/citas.js";
import esteticaRouter from "./routes/estetica.js";
import plagasRouter from "./routes/plagas.js";
import solicitudesRouter from "./routes/solicitudes.js";
import ipmRouter from "./routes/ipm.js";
import inventarioRouter from "./routes/inventario.js";
import posRouter from "./routes/pos.js";
import facturacionRouter from "./routes/facturacion.js";
import contabilidadRouter from "./routes/contabilidad.js";
import nominaRouter from "./routes/nomina.js";
import usuariosRouter from "./routes/usuarios.js";
import rncRouter from "./routes/rnc.js";
import notificacionesRouter from "./routes/notificaciones.js";
import configuracionRouter from "./routes/configuracion.js";
import auditoriaRouter from "./routes/auditoria.js";
import flotaRouter, { publico as flotaPublico } from "./routes/flota.js";
import documentosRouter from "./routes/documentos.js";
import limpiezaRouter from "./routes/limpieza.js";

// ── Endpoints públicos (los únicos sin token) ───────────────────────────────
app.get("/", (req, res) => {
  res.json({
    ok: true,
    sistema: "Ambiente y Salud RD (ASA SRL) - API",
    prefijo_tablas: "asa_",
    version: "2.0-plagas",
  });
});
app.get("/salud", (req, res) => res.json({ ok: true, hora: new Date().toISOString() }));

// El login y el alta de cliente son necesariamente públicos.
app.use("/usuarios", usuariosRouter);

// La pantalla del chequeo vehicular del conductor también: es pública a
// propósito. Darle cuenta del sistema a cada conductor sería abrirle plantas,
// clientes y reportes para que avise de una goma baja. Estas rutas solo leen
// catálogos y escriben el parte del día de su propio vehículo.
app.use("/flota", flotaPublico);

// ── A PARTIR DE AQUÍ, TODO EXIGE TOKEN ──────────────────────────────────────
//
// Antes este backend exponía los 14 módulos sin autenticación: cualquiera con
// la URL podía leer clientes, facturas y nómina. Esta puerta única cierra eso
// de golpe, y `cargarAlcance` limita al personal del hotel a sus propios
// sitios. No agregues rutas ARRIBA de esta línea salvo que deban ser públicas.
app.use(requireAuth);
app.use(soloLectura);   // rechaza escrituras de cuentas externas antes de tocar la base
app.use(cargarAlcance); // limita al personal del hotel a sus propios sitios

// Módulo de plagas / hoteles (el foco del sistema)
app.use("/clientes", clientesRouter);
app.use("/sitios", sitiosRouter);
app.use("/puntos", puntosRouter);
app.use("/inspecciones", inspeccionesRouter);
app.use("/estrategias", estrategiasRouter);
app.use("/hallazgos", hallazgosRouter);
app.use("/reportes", reportesRouter);
app.use("/plagas", plagasRouter);
// Solicitudes del hotel: listas de habitaciones y reportes, con su hilo de mensajes
app.use("/solicitudes", solicitudesRouter);
app.use("/ipm", ipmRouter);
app.use("/inventario", inventarioRouter);
// Documentos regulatorios y fichas de productos (el hotel los ve en su portal)
app.use("/documentos", documentosRouter);
// Borrar datos de prueba — solo administrador (el router lo exige)
app.use("/limpieza", limpiezaRouter);
app.use("/notificaciones", notificacionesRouter);
app.use("/rnc", rncRouter);

// Administracion del propio sistema: datos de la empresa, permisos por rol y
// la bitacora de quien hizo que. La bitacora ya se llenaba sola desde el
// principio (lib/auditoria.js); lo que faltaba era poder verla.
app.use("/config", configuracionRouter);
app.use("/auditoria", auditoriaRouter);

// Flota y transportación (el resto del módulo, ya con token)
app.use("/flota", flotaRouter);

// Módulos congelados (veterinaria, estética, tienda, administración).
// Siguen funcionando pero están ocultos del panel; se reactivan cuando ASA
// retome esas líneas de negocio.
app.use("/mascotas", mascotasRouter);
app.use("/veterinaria", veterinariaRouter);
app.use("/citas", citasRouter);
app.use("/estetica", esteticaRouter);
app.use("/pos", posRouter);
app.use("/facturacion", facturacionRouter);
app.use("/contabilidad", contabilidadRouter);
app.use("/nomina", nominaRouter);

// ── Manejo de errores genérico ──────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("[ASA][error]", err);
  res.status(err.status || 500).json({ error: true, mensaje: err.message || "Error interno" });
});

const PORT = process.env.PORT || 4000;
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`[ASA] Backend escuchando en puerto ${PORT}`);
    if (!process.env.JWT_SECRET) {
      console.error("[ASA] ¡ATENCIÓN! JWT_SECRET está vacío: el login no funcionará.");
    }
  });
}
