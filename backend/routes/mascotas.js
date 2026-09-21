// routes/mascotas.js — Expediente base del animal (tabla asa_mascotas)
import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { logAccion } from "../lib/auditoria.js";

const router = express.Router();

// GET /mascotas?cliente_id=...
router.get("/", async (req, res) => {
  let q = supabase.from("asa_mascotas").select("*").eq("activo", true).order("created_at", { ascending: false });
  if (req.query.cliente_id) q = q.eq("cliente_id", req.query.cliente_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// GET /mascotas/:id — ficha completa: datos + tratamientos + historial clínico
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  const [mascota, tratamientos, fichas, citas] = await Promise.all([
    supabase.from("asa_mascotas").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("asa_tratamientos_aplicados")
      .select("*, asa_tratamientos_catalogo(nombre, tipo)")
      .eq("mascota_id", id)
      .order("fecha_aplicacion", { ascending: false }),
    supabase.from("asa_fichas_clinicas").select("*").eq("mascota_id", id).order("fecha", { ascending: false }),
    supabase.from("asa_citas").select("*").eq("mascota_id", id).order("fecha_hora", { ascending: false }),
  ]);
  if (mascota.error) return res.status(500).json({ error: true, mensaje: mascota.error.message });
  if (!mascota.data) return res.status(404).json({ error: true, mensaje: "Mascota no encontrada" });
  res.json({
    ...mascota.data,
    tratamientos: tratamientos.data || [],
    fichas_clinicas: fichas.data || [],
    citas: citas.data || [],
  });
});

// POST /mascotas — registrar nueva mascota
router.post("/", async (req, res) => {
  const { data, error } = await supabase.from("asa_mascotas").insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  logAccion(req, { accion: "crear", modulo: "mascotas", registroId: data.id, descripcion: `Mascota registrada: ${data.nombre}` });
  res.status(201).json(data);
});

router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from("asa_mascotas")
    .update({ ...req.body, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// GET /mascotas/:id/carnet — carnet digital de vacunas para la app del cliente
router.get("/:id/carnet", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from("asa_tratamientos_aplicados")
    .select("*, asa_tratamientos_catalogo(nombre, tipo, especie)")
    .eq("mascota_id", id)
    .order("fecha_aplicacion", { ascending: false });
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

export default router;
