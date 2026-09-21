// routes/estetica.js — Estética canina: lavado/baño/grooming
import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { logAccion } from "../lib/auditoria.js";

const router = express.Router();

// ── Catálogo de servicios de estética ───────────────────────────────────────
router.get("/catalogo", async (req, res) => {
  const { data, error } = await supabase.from("asa_estetica_servicios_catalogo").select("*").eq("activo", true).order("nombre");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

router.post("/catalogo", async (req, res) => {
  const { data, error } = await supabase.from("asa_estetica_servicios_catalogo").insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});

// ── Órdenes de estética ──────────────────────────────────────────────────────
router.get("/ordenes", async (req, res) => {
  let q = supabase.from("asa_estetica_ordenes").select("*, asa_mascotas(nombre), asa_estetica_orden_detalle(*)").order("fecha", { ascending: false });
  if (req.query.mascota_id) q = q.eq("mascota_id", req.query.mascota_id);
  if (req.query.estado) q = q.eq("estado", req.query.estado);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// POST /estetica/ordenes  { mascota_id, cita_id?, groomer_id, servicios: [servicio_id,...] }
router.post("/ordenes", async (req, res) => {
  const { servicios = [], ...orden } = req.body;
  const { data: creada, error } = await supabase.from("asa_estetica_ordenes").insert([orden]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  if (servicios.length) {
    const { data: catalogo } = await supabase.from("asa_estetica_servicios_catalogo").select("id, precio").in("id", servicios);
    const detalle = (catalogo || []).map((s) => ({ orden_id: creada.id, servicio_id: s.id, precio: s.precio }));
    if (detalle.length) await supabase.from("asa_estetica_orden_detalle").insert(detalle);
  }

  logAccion(req, { accion: "crear", modulo: "estetica_ordenes", registroId: creada.id });
  res.status(201).json(creada);
});

router.patch("/ordenes/:id/estado", async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;
  const { data, error } = await supabase.from("asa_estetica_ordenes").update({ estado }).eq("id", id).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

export default router;
