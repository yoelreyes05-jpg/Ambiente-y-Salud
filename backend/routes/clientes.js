// routes/clientes.js — CRM único de las 3 líneas (tabla asa_clientes)
import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { logAccion } from "../server.mjs";

const router = express.Router();

// GET /clientes?buscar=texto
router.get("/", async (req, res) => {
  let q = supabase.from("asa_clientes").select("*").eq("activo", true).order("created_at", { ascending: false });
  if (req.query.buscar) {
    q = q.or(`nombre_contacto.ilike.%${req.query.buscar}%,razon_social.ilike.%${req.query.buscar}%,rnc_cedula.ilike.%${req.query.buscar}%`);
  }
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// GET /clientes/:id  (incluye sitios y mascotas del cliente)
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  const [cliente, sitios, mascotas] = await Promise.all([
    supabase.from("asa_clientes").select("*").eq("id", id).maybeSingle(),
    supabase.from("asa_sitios").select("*").eq("cliente_id", id).eq("activo", true),
    supabase.from("asa_mascotas").select("*").eq("cliente_id", id).eq("activo", true),
  ]);
  if (cliente.error) return res.status(500).json({ error: true, mensaje: cliente.error.message });
  if (!cliente.data) return res.status(404).json({ error: true, mensaje: "Cliente no encontrado" });
  res.json({ ...cliente.data, sitios: sitios.data || [], mascotas: mascotas.data || [] });
});

// POST /clientes — crear cliente (idealmente ya validado por RNC vía /rnc/:rnc antes)
router.post("/", async (req, res) => {
  const { data, error } = await supabase.from("asa_clientes").insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  logAccion(req, { accion: "crear", modulo: "clientes", registroId: data.id, descripcion: `Cliente creado: ${data.nombre_contacto}` });
  res.status(201).json(data);
});

// PUT /clientes/:id
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from("asa_clientes")
    .update({ ...req.body, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  logAccion(req, { accion: "actualizar", modulo: "clientes", registroId: id });
  res.json(data);
});

// DELETE /clientes/:id — borrado lógico (activo=false), nunca borrado físico
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from("asa_clientes").update({ activo: false }).eq("id", id);
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  logAccion(req, { accion: "eliminar", modulo: "clientes", registroId: id });
  res.json({ ok: true });
});

// ── Sitios (línea de plagas) ────────────────────────────────────────────────
router.post("/:id/sitios", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from("asa_sitios").insert([{ ...req.body, cliente_id: id }]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});

export default router;
