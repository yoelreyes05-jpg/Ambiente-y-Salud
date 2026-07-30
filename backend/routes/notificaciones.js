// routes/notificaciones.js — Notificaciones al cliente (push/WhatsApp/email)
import express from "express";
import { supabase } from "../lib/supabaseClient.js";

const router = express.Router();

// GET /notificaciones?cliente_id=...
router.get("/", async (req, res) => {
  let q = supabase.from("asa_notificaciones").select("*").order("created_at", { ascending: false }).limit(100);
  if (req.query.cliente_id) q = q.eq("cliente_id", req.query.cliente_id);
  if (req.query.no_leidas === "true") q = q.eq("leida", false);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

router.patch("/:id/leida", async (req, res) => {
  const { data, error } = await supabase.from("asa_notificaciones").update({ leida: true }).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// POST /notificaciones/enviar-whatsapp — placeholder de integración WhatsApp Business API
router.post("/enviar-whatsapp", async (req, res) => {
  const { telefono, mensaje } = req.body;
  if (!process.env.WHATSAPP_TOKEN) {
    return res.status(501).json({ error: true, mensaje: "WhatsApp Business API no configurada (WHATSAPP_TOKEN vacío)" });
  }
  // Integración real: POST a la Graph API de Meta usando WHATSAPP_TOKEN y WHATSAPP_PHONE_ID
  res.json({ ok: true, simulado: true, telefono, mensaje });
});

export default router;
