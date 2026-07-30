// routes/ipm.js — Manejo Integrado de Plagas: estaciones, lecturas y permisos
import express from "express";
import { supabase } from "../lib/supabaseClient.js";

const router = express.Router();

// ── Estaciones (cebo/trampas) ───────────────────────────────────────────────
router.get("/estaciones", async (req, res) => {
  let q = supabase.from("asa_ipm_estaciones").select("*").eq("activo", true);
  if (req.query.sitio_id) q = q.eq("sitio_id", req.query.sitio_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

router.post("/estaciones", async (req, res) => {
  const { data, error } = await supabase.from("asa_ipm_estaciones").insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});

// GET /ipm/estaciones/qr/:codigo — el técnico escanea el QR de la estación
router.get("/estaciones/qr/:codigo", async (req, res) => {
  const { data, error } = await supabase
    .from("asa_ipm_estaciones")
    .select("*, asa_sitios(nombre, direccion)")
    .eq("codigo_qr", req.params.codigo)
    .maybeSingle();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  if (!data) return res.status(404).json({ error: true, mensaje: "Estación no encontrada" });
  res.json(data);
});

// ── Lecturas / inspecciones ──────────────────────────────────────────────────
router.get("/lecturas", async (req, res) => {
  let q = supabase.from("asa_ipm_lecturas").select("*").order("fecha", { ascending: false });
  if (req.query.estacion_id) q = q.eq("estacion_id", req.query.estacion_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

router.post("/lecturas", async (req, res) => {
  const { data, error } = await supabase.from("asa_ipm_lecturas").insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});

// ── Permisos y cumplimiento regulatorio ─────────────────────────────────────
router.get("/permisos", async (req, res) => {
  const { data, error } = await supabase.from("asa_permisos_regulatorios").select("*").order("fecha_vencimiento");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

router.post("/permisos", async (req, res) => {
  const { data, error } = await supabase.from("asa_permisos_regulatorios").insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});

// GET /ipm/permisos/por-vencer?dias=30
router.get("/permisos/por-vencer", async (req, res) => {
  const dias = Number(req.query.dias || 30);
  const limite = new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("asa_permisos_regulatorios")
    .select("*")
    .lte("fecha_vencimiento", limite)
    .neq("estado", "vencido");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

export default router;
