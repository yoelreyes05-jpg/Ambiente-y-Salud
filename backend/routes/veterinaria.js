// routes/veterinaria.js — Fichas clínicas + catálogo y aplicación de
// vacunas/tratamientos preventivos. "Control de cada animal".
import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { logAccion } from "../server.mjs";

const router = express.Router();

// ── Fichas clínicas ─────────────────────────────────────────────────────────
router.post("/fichas", async (req, res) => {
  const { data, error } = await supabase.from("asa_fichas_clinicas").insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  logAccion(req, { accion: "crear", modulo: "veterinaria_fichas", registroId: data.id });
  res.status(201).json(data);
});

router.get("/fichas/:mascotaId", async (req, res) => {
  const { data, error } = await supabase
    .from("asa_fichas_clinicas")
    .select("*")
    .eq("mascota_id", req.params.mascotaId)
    .order("fecha", { ascending: false });
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// ── Catálogo de tratamientos (vacunas/desparasitantes) ──────────────────────
router.get("/tratamientos-catalogo", async (req, res) => {
  const { data, error } = await supabase.from("asa_tratamientos_catalogo").select("*").eq("activo", true).order("nombre");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

router.post("/tratamientos-catalogo", async (req, res) => {
  const { data, error } = await supabase.from("asa_tratamientos_catalogo").insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});

// ── Aplicar tratamiento/vacuna a una mascota (genera el recordatorio) ───────
router.post("/tratamientos-aplicados", async (req, res) => {
  const body = { ...req.body };

  // Calcular proxima_fecha automáticamente si no viene explícita
  if (!body.proxima_fecha && body.tratamiento_id && body.fecha_aplicacion) {
    const { data: cat } = await supabase
      .from("asa_tratamientos_catalogo")
      .select("intervalo_dias_refuerzo")
      .eq("id", body.tratamiento_id)
      .maybeSingle();
    if (cat?.intervalo_dias_refuerzo) {
      const base = new Date(body.fecha_aplicacion);
      base.setDate(base.getDate() + cat.intervalo_dias_refuerzo);
      body.proxima_fecha = base.toISOString().slice(0, 10);
    }
  }

  const { data, error } = await supabase.from("asa_tratamientos_aplicados").insert([body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  // Notificación/recordatorio al dueño (se procesa realmente en /notificaciones o un cron)
  const { data: mascota } = await supabase.from("asa_mascotas").select("cliente_id, nombre").eq("id", data.mascota_id).maybeSingle();
  if (mascota && data.proxima_fecha) {
    await supabase.from("asa_notificaciones").insert([
      {
        cliente_id: mascota.cliente_id,
        tipo: "recordatorio_vacuna",
        titulo: "Próxima vacuna/tratamiento",
        mensaje: `${mascota.nombre} tiene su próxima aplicación programada para ${data.proxima_fecha}.`,
        canal: "push",
      },
    ]);
  }

  logAccion(req, { accion: "crear", modulo: "veterinaria_tratamientos", registroId: data.id });
  res.status(201).json(data);
});

router.get("/tratamientos-aplicados/:mascotaId", async (req, res) => {
  const { data, error } = await supabase
    .from("asa_tratamientos_aplicados")
    .select("*, asa_tratamientos_catalogo(nombre, tipo)")
    .eq("mascota_id", req.params.mascotaId)
    .order("fecha_aplicacion", { ascending: false });
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// ── Próximos vencimientos (para el cron de recordatorios) ───────────────────
router.get("/recordatorios-pendientes", async (req, res) => {
  const hoy = new Date().toISOString().slice(0, 10);
  const en7dias = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("asa_tratamientos_aplicados")
    .select("*, asa_mascotas(nombre, cliente_id)")
    .eq("recordatorio_enviado", false)
    .gte("proxima_fecha", hoy)
    .lte("proxima_fecha", en7dias);
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

export default router;
