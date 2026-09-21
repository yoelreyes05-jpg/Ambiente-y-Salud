// routes/hallazgos.js — Condiciones abiertas
//
// Lo que ASA reporta y el hotel debe corregir: una puerta que no sella, un
// drenaje sin rejilla, basura acumulada. Queda constancia de que se reportó,
// con fecha y foto — es lo que te respalda en una auditoría del hotel.
import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { logAccion } from "../lib/auditoria.js";
import { requireRol, filtrarPorSitio, exigirSitioPermitido } from "../middleware/auth.js";

const router = express.Router();

// GET /hallazgos?sitio_id=&estado=&severidad=&responsable=
router.get("/", async (req, res) => {
  const { sitio_id, estado, severidad, responsable } = req.query;

  let q = supabase
    .from("asa_hallazgos")
    .select(`
      *,
      asa_sitios(nombre),
      asa_areas(nombre),
      asa_puntos_control(codigo_visible, nombre)
    `)
    .order("fecha_reporte", { ascending: false })
    .limit(500);

  if (sitio_id) {
    if (!exigirSitioPermitido(req, res, sitio_id)) return;
    q = q.eq("sitio_id", sitio_id);
  } else {
    q = filtrarPorSitio(q, req);
  }
  if (estado) q = q.eq("estado", estado);
  if (severidad) q = q.eq("severidad", severidad);
  if (responsable) q = q.eq("responsable", responsable);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// GET /hallazgos/resumen?sitio_id= — para el tablero del hotel
router.get("/resumen", async (req, res) => {
  let q = supabase.from("asa_hallazgos").select("estado, severidad, responsable, fecha_limite, sitio_id");
  if (req.query.sitio_id) {
    if (!exigirSitioPermitido(req, res, req.query.sitio_id)) return;
    q = q.eq("sitio_id", req.query.sitio_id);
  } else {
    q = filtrarPorSitio(q, req);
  }

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const hoy = new Date().toISOString().slice(0, 10);
  const abiertos = (data || []).filter((h) => h.estado === "abierto" || h.estado === "en_proceso");

  res.json({
    total: (data || []).length,
    abiertos: abiertos.length,
    corregidos: (data || []).filter((h) => h.estado === "corregido").length,
    vencidos: abiertos.filter((h) => h.fecha_limite && h.fecha_limite < hoy).length,
    por_severidad: abiertos.reduce((a, h) => ({ ...a, [h.severidad]: (a[h.severidad] || 0) + 1 }), {}),
    responsabilidad_cliente: abiertos.filter((h) => h.responsable === "cliente").length,
    responsabilidad_asa: abiertos.filter((h) => h.responsable === "asa").length,
  });
});

// POST /hallazgos
router.post("/", requireRol("tecnico_plagas", "operaciones", "comercial"), async (req, res) => {
  if (!req.body.sitio_id || !req.body.titulo) {
    return res.status(400).json({ error: true, mensaje: "sitio_id y titulo son requeridos" });
  }
  if (!exigirSitioPermitido(req, res, req.body.sitio_id)) return;

  const { data, error } = await supabase.from("asa_hallazgos").insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  logAccion(req, { accion: "crear", modulo: "hallazgos", registroId: data.id, descripcion: data.titulo });
  res.status(201).json(data);
});

// PATCH /hallazgos/:id/estado — { estado, nota_cierre }
router.patch("/:id/estado", requireRol("tecnico_plagas", "operaciones", "comercial"), async (req, res) => {
  const { estado, nota_cierre } = req.body;
  const cierra = ["corregido", "aceptado_riesgo"].includes(estado);

  const { data, error } = await supabase
    .from("asa_hallazgos")
    .update({
      estado,
      nota_cierre: nota_cierre ?? null,
      fecha_cierre: cierra ? new Date().toISOString() : null,
      cerrado_por: cierra ? req.usuario?.id ?? null : null,
    })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  logAccion(req, { accion: "actualizar", modulo: "hallazgos", registroId: req.params.id, descripcion: `→ ${estado}` });
  res.json(data);
});

export default router;
