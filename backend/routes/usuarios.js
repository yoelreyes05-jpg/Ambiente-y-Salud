// routes/usuarios.js — Autenticación y usuarios (personal interno + clientes)
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { supabase } from "../lib/supabaseClient.js";
import { requireAuth, requireRol } from "../middleware/auth.js";

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

export default router;
