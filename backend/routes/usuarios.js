// routes/usuarios.js — Autenticación y usuarios (personal interno + clientes)
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { supabase } from "../lib/supabaseClient.js";
import { requireAuth, requireRol, ROLES_INTERNOS } from "../middleware/auth.js";
import { logAccion } from "../lib/auditoria.js";

const router = express.Router();

// POST /usuarios/registrar-cliente — usado por la app móvil del cliente
router.post("/registrar-cliente", async (req, res) => {
  const { email, password, nombre_completo, cliente_id } = req.body;
  if (!email || !password) return res.status(400).json({ error: true, mensaje: "email y password son requeridos" });

  const password_hash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from("asa_usuarios")
    .insert([{ email, password_hash, nombre_completo, rol: "cliente", cliente_id }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const { password_hash: _omit, ...usuario } = data;
  res.status(201).json(usuario);
});

// POST /usuarios/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const { data: usuario, error } = await supabase.from("asa_usuarios").select("*").eq("email", email).eq("activo", true).maybeSingle();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  if (!usuario) return res.status(401).json({ error: true, mensaje: "Credenciales inválidas" });

  const valido = await bcrypt.compare(password, usuario.password_hash);
  if (!valido) return res.status(401).json({ error: true, mensaje: "Credenciales inválidas" });

  const token = jwt.sign(
    { id: usuario.id, rol: usuario.rol, nombre: usuario.nombre_completo, cliente_id: usuario.cliente_id, empleado_id: usuario.empleado_id },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );

  await supabase.from("asa_usuarios").update({ ultimo_acceso: new Date().toISOString() }).eq("id", usuario.id);

  res.json({ token, usuario: { id: usuario.id, nombre: usuario.nombre_completo, rol: usuario.rol, cliente_id: usuario.cliente_id } });
});

// GET /usuarios/me — requiere token
router.get("/me", requireAuth, async (req, res) => {
  const { data, error } = await supabase.from("asa_usuarios").select("id, email, nombre_completo, rol, cliente_id, empleado_id").eq("id", req.usuario.id).maybeSingle();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// GET /usuarios — solo admin: listar personal interno
router.get("/", requireAuth, requireRol("admin"), async (req, res) => {
  const { data, error } = await supabase.from("asa_usuarios").select("id, email, nombre_completo, rol, activo, ultimo_acceso").neq("rol", "cliente");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// POST /usuarios — solo admin: crear usuario de personal interno
router.post("/", requireAuth, requireRol("admin"), async (req, res) => {
  const { email, password, nombre_completo, rol, empleado_id } = req.body;
  const password_hash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase.from("asa_usuarios").insert([{ email, password_hash, nombre_completo, rol, empleado_id }]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  const { password_hash: _omit, ...usuario } = data;
  res.status(201).json(usuario);
});

// ─────────────────────────────────────────────────────────────────────────────
// Cuentas del personal de calidad del hotel
//
// ASA crea tantas cuentas como necesite cada hotel. Cada cuenta ve, en tiempo
// real y solo de lectura, lo que se ha hecho en los hoteles que se le asignen.
// ─────────────────────────────────────────────────────────────────────────────

// GET /usuarios/portal?sitio_id= — cuentas de hotel y sus sitios asignados
router.get("/portal", requireAuth, requireRol("admin", "comercial", "operaciones"), async (req, res) => {
  const { data, error } = await supabase
    .from("asa_usuarios")
    .select("id, email, nombre_completo, rol, activo, ultimo_acceso, asa_usuario_sitios(sitio_id, asa_sitios(id, nombre))")
    .eq("rol", "cliente_calidad")
    .order("nombre_completo");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  let lista = data || [];
  if (req.query.sitio_id) {
    lista = lista.filter((u) => (u.asa_usuario_sitios || []).some((s) => s.sitio_id === req.query.sitio_id));
  }
  res.json(lista);
});

// POST /usuarios/portal — crear una cuenta de calidad y asignarle hoteles
// Body: { email, password, nombre_completo, sitios: [sitio_id, ...] }
router.post("/portal", requireAuth, requireRol("admin", "comercial"), async (req, res) => {
  const { email, password, nombre_completo, sitios = [] } = req.body;
  if (!email || !password || !sitios.length) {
    return res.status(400).json({
      error: true,
      mensaje: "email, password y al menos un hotel (sitios) son requeridos",
    });
  }

  const password_hash = await bcrypt.hash(password, 10);
  const { data: usuario, error } = await supabase
    .from("asa_usuarios")
    .insert([{ email, password_hash, nombre_completo, rol: "cliente_calidad" }])
    .select("id, email, nombre_completo, rol, activo")
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const { error: errSitios } = await supabase
    .from("asa_usuario_sitios")
    .insert(sitios.map((sitio_id) => ({ usuario_id: usuario.id, sitio_id })));
  if (errSitios) {
    // Sin hoteles asignados la cuenta no sirve de nada: se revierte.
    await supabase.from("asa_usuarios").delete().eq("id", usuario.id);
    return res.status(500).json({ error: true, mensaje: errSitios.message });
  }

  res.status(201).json({ ...usuario, sitios });
});

// PUT /usuarios/portal/:id/sitios — cambiar los hoteles que ve una cuenta
router.put("/portal/:id/sitios", requireAuth, requireRol("admin", "comercial"), async (req, res) => {
  const { sitios = [] } = req.body;
  await supabase.from("asa_usuario_sitios").delete().eq("usuario_id", req.params.id);
  if (sitios.length) {
    const { error } = await supabase
      .from("asa_usuario_sitios")
      .insert(sitios.map((sitio_id) => ({ usuario_id: req.params.id, sitio_id })));
    if (error) return res.status(500).json({ error: true, mensaje: error.message });
  }
  res.json({ ok: true, usuario_id: req.params.id, sitios });
});

// PATCH /usuarios/:id/activo — desactivar o reactivar cualquier cuenta
router.patch("/:id/activo", requireAuth, requireRol("admin"), async (req, res) => {
  const { data, error } = await supabase
    .from("asa_usuarios")
    .update({ activo: !!req.body.activo })
    .eq("id", req.params.id)
    .select("id, email, nombre_completo, rol, activo")
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// POST /usuarios/:id/password — restablecer contraseña
router.post("/:id/password", requireAuth, requireRol("admin"), async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: true, mensaje: "La contraseña debe tener al menos 8 caracteres" });
  }
  const password_hash = await bcrypt.hash(password, 10);
  const { error } = await supabase.from("asa_usuarios").update({ password_hash }).eq("id", req.params.id);
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edicion y borrado de cuentas
//
// ORDEN: todo lo de /portal/... queda ARRIBA de /:id. Express resuelve por
// orden de declaracion y un PATCH /usuarios/portal caeria en /:id con
// id="portal".
//
// Dos borrados distintos, como en el CRM:
//   · PATCH /:id/activo { activo:false } — dar de baja. La cuenta no puede
//     entrar, pero sigue ahi y se reactiva cuando haga falta.
//   · DELETE /:id — borrar de verdad. Se lleva sus hoteles asignados
//     (asa_usuario_sitios va con on delete cascade). Lo que hizo NO se pierde:
//     asa_log_auditoria guarda el nombre congelado y su usuario_id pasa a null.
// ─────────────────────────────────────────────────────────────────────────────

// PATCH /usuarios/portal/:id — datos de una cuenta de hotel (nombre, correo)
router.patch("/portal/:id", requireAuth, requireRol("admin", "comercial"), async (req, res) => {
  const cambios = {};
  if (req.body.nombre_completo !== undefined) cambios.nombre_completo = String(req.body.nombre_completo).trim();
  if (req.body.email !== undefined) cambios.email = String(req.body.email).trim().toLowerCase();
  if (req.body.activo !== undefined) cambios.activo = !!req.body.activo;
  if (!Object.keys(cambios).length) return res.status(400).json({ error: true, mensaje: "Nada que cambiar" });
  cambios.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("asa_usuarios")
    .update(cambios)
    .eq("id", req.params.id)
    .eq("rol", "cliente_calidad")   // esta ruta solo toca cuentas de hotel
    .select("id, email, nombre_completo, rol, activo");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  if (!data?.length) return res.status(404).json({ error: true, mensaje: "Cuenta de hotel no encontrada" });

  logAccion(req, { accion: "actualizar", modulo: "accesos_hotel", registroId: req.params.id, descripcion: data[0].email });
  res.json(data[0]);
});

// POST /usuarios/portal/:id/password — cambiar la clave de una cuenta de hotel.
// Existe aparte de /usuarios/:id/password (que es solo de admin) para que
// comercial pueda resolverle la clave al encargado de calidad del hotel sin
// tener que darle permisos de administrador a comercial.
router.post("/portal/:id/password", requireAuth, requireRol("admin", "comercial"), async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: true, mensaje: "La contrasena debe tener al menos 8 caracteres" });
  }
  const password_hash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from("asa_usuarios")
    .update({ password_hash, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("rol", "cliente_calidad")
    .select("id, email");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  if (!data?.length) return res.status(404).json({ error: true, mensaje: "Cuenta de hotel no encontrada" });
  logAccion(req, { accion: "actualizar", modulo: "accesos_hotel", registroId: req.params.id, descripcion: `Clave cambiada a ${data[0].email}` });
  res.json({ ok: true });
});

// DELETE /usuarios/portal/:id — borra la cuenta de hotel y sus asignaciones
router.delete("/portal/:id", requireAuth, requireRol("admin", "comercial"), async (req, res) => {
  const { data: cuenta } = await supabase
    .from("asa_usuarios")
    .select("id, email, nombre_completo, rol")
    .eq("id", req.params.id)
    .maybeSingle();
  if (!cuenta) return res.status(404).json({ error: true, mensaje: "Cuenta no encontrada" });
  if (cuenta.rol !== "cliente_calidad") {
    return res.status(400).json({ error: true, mensaje: "Esa cuenta no es de acceso al hotel. Bórrala desde Usuarios." });
  }

  const { error } = await supabase.from("asa_usuarios").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  logAccion(req, { accion: "eliminar", modulo: "accesos_hotel", registroId: req.params.id, descripcion: cuenta.email });
  res.json({ ok: true });
});

// PATCH /usuarios/:id — nombre, correo, rol y empleado del personal interno
router.patch("/:id", requireAuth, requireRol("admin"), async (req, res) => {
  const cambios = {};
  if (req.body.nombre_completo !== undefined) cambios.nombre_completo = String(req.body.nombre_completo).trim();
  if (req.body.email !== undefined) cambios.email = String(req.body.email).trim().toLowerCase();
  if (req.body.empleado_id !== undefined) cambios.empleado_id = req.body.empleado_id || null;
  if (req.body.activo !== undefined) cambios.activo = !!req.body.activo;
  if (req.body.rol !== undefined) {
    if (!ROLES_INTERNOS.includes(req.body.rol)) {
      return res.status(400).json({ error: true, mensaje: `Rol no valido. Validos: ${ROLES_INTERNOS.join(", ")}` });
    }
    cambios.rol = req.body.rol;
  }
  if (!Object.keys(cambios).length) return res.status(400).json({ error: true, mensaje: "Nada que cambiar" });
  cambios.updated_at = new Date().toISOString();

  // Quedarse sin ningun admin activo deja el sistema sin quien administre, y no
  // hay forma de arreglarlo desde la interfaz: se bloquea antes de escribir.
  if (cambios.rol && cambios.rol !== "admin") {
    if (await esElUltimoAdmin(req.params.id)) {
      return res.status(409).json({ error: true, mensaje: "Es el unico administrador activo. Crea otro admin antes de cambiarle el rol." });
    }
  }
  if (cambios.activo === false && (await esElUltimoAdmin(req.params.id))) {
    return res.status(409).json({ error: true, mensaje: "Es el unico administrador activo: no se puede dar de baja." });
  }

  const { data, error } = await supabase
    .from("asa_usuarios")
    .update(cambios)
    .eq("id", req.params.id)
    .select("id, email, nombre_completo, rol, activo, ultimo_acceso");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  if (!data?.length) return res.status(404).json({ error: true, mensaje: "Usuario no encontrado" });

  logAccion(req, { accion: "actualizar", modulo: "usuarios", registroId: req.params.id, descripcion: data[0].email, detalle: { campos: Object.keys(cambios) } });
  res.json(data[0]);
});

// DELETE /usuarios/:id — borrado real de una cuenta de personal interno
router.delete("/:id", requireAuth, requireRol("admin"), async (req, res) => {
  if (req.params.id === req.usuario?.id) {
    return res.status(400).json({ error: true, mensaje: "No puedes borrar tu propia cuenta mientras la estas usando." });
  }
  const { data: cuenta } = await supabase
    .from("asa_usuarios")
    .select("id, email, nombre_completo, rol")
    .eq("id", req.params.id)
    .maybeSingle();
  if (!cuenta) return res.status(404).json({ error: true, mensaje: "Usuario no encontrado" });
  if (await esElUltimoAdmin(req.params.id)) {
    return res.status(409).json({ error: true, mensaje: "Es el unico administrador activo: crea otro antes de borrarlo." });
  }

  const { error } = await supabase.from("asa_usuarios").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  logAccion(req, { accion: "eliminar", modulo: "usuarios", registroId: req.params.id, descripcion: `${cuenta.nombre_completo} <${cuenta.email}>` });
  res.json({ ok: true });
});

async function esElUltimoAdmin(id) {
  const { data } = await supabase.from("asa_usuarios").select("id").eq("rol", "admin").eq("activo", true);
  const admins = (data || []).map((u) => u.id);
  return admins.length <= 1 && admins.includes(id);
}

export default router;
