// middleware/auth.js — JWT + control de acceso por rol (RBAC)
// Roles válidos: ver enum asa_rol_usuario en supabase/01_extensiones_y_tipos.sql
import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: true, mensaje: "Token requerido" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = payload; // { id, rol, nombre, cliente_id?, empleado_id? }
    next();
  } catch {
    return res.status(401).json({ error: true, mensaje: "Token inválido o expirado" });
  }
}

export function requireRol(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: true, mensaje: "No autenticado" });
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: true, mensaje: "No tienes permiso para esta acción" });
    }
    next();
  };
}
