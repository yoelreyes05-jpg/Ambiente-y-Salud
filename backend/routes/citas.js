// routes/citas.js — Agenda de consultas, vacunación, desparasitación y estética
import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { logAccion } from "../lib/auditoria.js";

const router = express.Router();

// GET /citas?cliente_id=&desde=&hasta=&estado=
router.get("/", async (req, res) => {
  let q = supabase.from("asa_citas").select("*, asa_mascotas(nombre), asa_clientes(nombre_contacto)").order("fecha_hora");
  if (req.query.cliente_id) q = q.eq("cliente_id", req.query.cliente_id);
  if (req.query.estado) q = q.eq("estado", req.query.estado);
  if (req.query.desde) q = q.gte("fecha_hora", req.query.desde);
  if (req.query.hasta) q = q.lte("fecha_hora", req.query.hasta);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// POST /citas — agendar cita (usado también desde la app del cliente)
router.post("/", async (req, res) => {
  const { data, error } = await supabase.from("asa_citas").insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  await supabase.from("asa_notificaciones").insert([
    {
      cliente_id: data.cliente_id,
      tipo: "cita_confirmada",
      titulo: "Cita registrada",
      mensaje: `Tu cita (${data.tipo_servicio}) fue registrada para ${data.fecha_hora}. Te confirmaremos pronto.`,
      canal: "push",
    },
  ]);

  logAccion(req, { accion: "crear", modulo: "citas", registroId: data.id });
  res.status(201).json(data);
});

// PATCH /citas/:id/estado
router.patch("/:id/estado", async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;
  const { data, error } = await supabase
    .from("asa_citas")
    .update({ estado, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  if (estado === "confirmada") {
    await supabase.from("asa_notificaciones").insert([
      {
        cliente_id: data.cliente_id,
        tipo: "cita_confirmada",
        titulo: "Cita confirmada",
        mensaje: `Tu cita del ${data.fecha_hora} fue confirmada.`,
        canal: "whatsapp",
      },
    ]);
  }

  logAccion(req, { accion: "cambio_estado", modulo: "citas", registroId: id, descripcion: `-> ${estado}` });
  res.json(data);
});

export default router;
