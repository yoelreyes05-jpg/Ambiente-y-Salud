// middleware/auth.js — Autenticación JWT y control de acceso por rol (RBAC)
//
// Roles válidos: ver enum asa_rol_usuario (01_extensiones_y_tipos.sql +
// 20_hoteles_puntos_control.sql).
//
//   admin            — todo
//   comercial        — clientes, contratos
//   operaciones      — órdenes, agenda, puntos de control
//   tecnico_plagas   — su ruta del día, escanear y registrar inspecciones
//   contabilidad     — facturación y contabilidad
//   nomina           — empleados y nómina
//   cliente_calidad  — personal de calidad DEL HOTEL: solo lectura, y
//                      únicamente de los sitios asignados en asa_usuario_sitios
//   cliente          — cliente final de la app (su propio cliente_id)
//
import jwt from "jsonwebtoken";
import { supabase } from "../lib/supabaseClient.js";

export const ROLES_INTERNOS = [
  "admin", "comercial", "operaciones", "tecnico_plagas",
  "veterinario", "groomer", "cajero", "contabilidad", "nomina",
];
export const ROLES_EXTERNOS = ["cliente_calidad", "cliente"];

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: true, mensaje: "Token requerido" });

  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET); // { id, rol, nombre, cliente_id?, empleado_id? }
    next();
  } catch {
    return res.status(401).json({ error: true, mensaje: "Token inválido o expirado" });
  }
}

export function requireRol(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: true, mensaje: "No autenticado" });
    if (req.usuario.rol === "admin") return next();
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: true, mensaje: "No tienes permiso para esta acción" });
    }
    next();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Alcance por sitio (hotel)
//
// El personal de calidad del hotel solo puede ver SUS hoteles. Este middleware
// carga esa lista una vez por request y la deja en req.sitiosPermitidos:
//   null  → sin restricción (personal interno de ASA)
//   [...] → solo esos sitio_id
// Los routers la aplican con `filtrarPorSitio(query, req)`.
// ─────────────────────────────────────────────────────────────────────────────
export async function cargarAlcance(req, res, next) {
  req.sitiosPermitidos = null;

  if (!req.usuario) return next();
  if (ROLES_INTERNOS.includes(req.usuario.rol)) return next();

  if (req.usuario.rol === "cliente_calidad") {
    const { data, error } = await supabase
      .from("asa_usuario_sitios")
      .select("sitio_id")
      .eq("usuario_id", req.usuario.id);
    if (error) return res.status(500).json({ error: true, mensaje: error.message });
    req.sitiosPermitidos = (data || []).map((r) => r.sitio_id);
    if (!req.sitiosPermitidos.length) {
      return res.status(403).json({
        error: true,
        mensaje: "Tu usuario no tiene ningún hotel asignado. Contacta a Ambiente y Salud.",
      });
    }
    return next();
  }

  if (req.usuario.rol === "cliente") {
    const { data } = await supabase
      .from("asa_sitios")
      .select("id")
      .eq("cliente_id", req.usuario.cliente_id);
    req.sitiosPermitidos = (data || []).map((r) => r.id);
    return next();
  }

  return res.status(403).json({ error: true, mensaje: "Rol sin acceso" });
}

// Aplica el alcance a una consulta de Supabase sobre una columna de sitio.
export function filtrarPorSitio(query, req, columna = "sitio_id") {
  if (req.sitiosPermitidos === null) return query;
  return query.in(columna, req.sitiosPermitidos);
}

// Para endpoints que reciben un sitio_id concreto (detalle, alta, etc.)
export function puedeVerSitio(req, sitioId) {
  if (req.sitiosPermitidos === null) return true;
  return req.sitiosPermitidos.includes(sitioId);
}

export function exigirSitioPermitido(req, res, sitioId) {
  if (puedeVerSitio(req, sitioId)) return true;
  res.status(403).json({ error: true, mensaje: "No tienes acceso a este hotel" });
  return false;
}

// Solo lectura: bloquea cualquier método que modifique datos.
// Lo único que una cuenta externa SÍ puede escribir: reportar una plaga.
// El portal del hotel necesita crear órdenes de trabajo; si no, el encargado
// de calidad ve el problema y no tiene cómo pedir la visita.
//
// Se compara la ruta completa (baseUrl + path) porque este middleware corre
// antes de que Express entre al router, así que req.path todavía es "/".
// Solicitudes del hotel (routes/solicitudes.js): crear, agregar habitaciones,
// escribir en el hilo y cancelar. Cada ruta comprueba además que la planta sea
// de ese usuario. Asignar técnico o cerrar sigue siendo solo de la oficina.
const ESCRITURAS_PERMITIDAS_EXTERNAS = [
  { metodo: "POST", ruta: "/plagas/reportar" },
  { metodo: "POST", ruta: "/solicitudes" },
  { metodo: "POST", patron: /^\/solicitudes\/[0-9a-f-]{36}\/(puntos|mensajes|cancelar)$/i },
];

export function soloLectura(req, res, next) {
  if (req.method === "GET" || req.method === "OPTIONS" || req.method === "HEAD") return next();

  const rutaCompleta = (req.baseUrl || "") + (req.path || "");
  const permitida = ESCRITURAS_PERMITIDAS_EXTERNAS.some(
    (p) =>
      p.metodo === req.method &&
      (p.patron ? p.patron.test(rutaCompleta.replace(/\/+$/, "")) : rutaCompleta.replace(/\/+$/, "") === p.ruta)
  );
  if (permitida) return next();

  if (ROLES_EXTERNOS.includes(req.usuario?.rol)) {
    return res.status(403).json({
      error: true,
      mensaje: "Tu usuario es de consulta: puedes ver la información pero no modificarla.",
    });
  }
  next();
}
