// routes/sitios.js — Hoteles (sitios) y sus áreas
//
// Jerarquía: cliente → contrato → hotel → área → punto de control.
// Este router cubre los dos niveles del medio.
import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { logAccion } from "../lib/auditoria.js";
import { requireRol, filtrarPorSitio, exigirSitioPermitido } from "../middleware/auth.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// HOTELES / SITIOS
// ─────────────────────────────────────────────────────────────────────────────

// GET /sitios?cliente_id=&contrato_id=&tipo=
router.get("/", async (req, res) => {
  let q = supabase
    .from("asa_sitios")
    .select("*, asa_clientes(id, nombre_contacto, razon_social)")
    .eq("activo", true)
    .order("nombre");

  if (req.query.cliente_id) q = q.eq("cliente_id", req.query.cliente_id);
  if (req.query.tipo) q = q.eq("tipo_sitio", req.query.tipo);
  q = filtrarPorSitio(q, req, "id");

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  // Filtro por contrato: se resuelve con la tabla puente
  if (req.query.contrato_id) {
    const { data: puente } = await supabase
      .from("asa_contrato_sitios")
      .select("sitio_id")
      .eq("contrato_id", req.query.contrato_id);
    const ids = new Set((puente || []).map((p) => p.sitio_id));
    return res.json((data || []).filter((s) => ids.has(s.id)));
  }

  res.json(data);
});

// GET /sitios/:id — ficha del hotel con su avance del día
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  if (!exigirSitioPermitido(req, res, id)) return;

  const [sitio, areas, avance, contratos] = await Promise.all([
    supabase.from("asa_sitios").select("*, asa_clientes(*)").eq("id", id).maybeSingle(),
    supabase.from("asa_areas").select("*").eq("sitio_id", id).eq("activo", true).order("orden"),
    supabase.from("asa_v_avance_dia").select("*").eq("sitio_id", id).maybeSingle(),
    supabase.from("asa_contrato_sitios").select("asa_contratos_plagas(*)").eq("sitio_id", id),
  ]);

  if (!sitio.data) return res.status(404).json({ error: true, mensaje: "Hotel no encontrado" });

  res.json({
    ...sitio.data,
    areas: areas.data || [],
    avance_hoy: avance.data || { puntos_totales: 0, realizados: 0, pendientes: 0 },
    contratos: (contratos.data || []).map((c) => c.asa_contratos_plagas).filter(Boolean),
  });
});

// POST /sitios
router.post("/", requireRol("comercial", "operaciones"), async (req, res) => {
  const { contrato_id, ...sitio } = req.body;
  if (!sitio.cliente_id || !sitio.nombre) {
    return res.status(400).json({ error: true, mensaje: "cliente_id y nombre son requeridos" });
  }

  const { data, error } = await supabase
    .from("asa_sitios")
    .insert([{ ...sitio, direccion: sitio.direccion || "Por definir" }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  if (contrato_id) {
    await supabase.from("asa_contrato_sitios").insert([{ contrato_id, sitio_id: data.id }]);
  }

  logAccion(req, { accion: "crear", modulo: "sitios", registroId: data.id, descripcion: `Hotel ${data.nombre}` });
  res.status(201).json(data);
});

// PUT /sitios/:id
router.put("/:id", requireRol("comercial", "operaciones"), async (req, res) => {
  if (!exigirSitioPermitido(req, res, req.params.id)) return;
  const { id: _omit, ...cambios } = req.body;
  const { data, error } = await supabase.from("asa_sitios").update(cambios).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  logAccion(req, { accion: "actualizar", modulo: "sitios", registroId: req.params.id });
  res.json(data);
});

// POST /sitios/:id/contratos — vincular el hotel a un contrato existente
router.post("/:id/contratos", requireRol("comercial"), async (req, res) => {
  const { contrato_id } = req.body;
  const { data, error } = await supabase
    .from("asa_contrato_sitios")
    .insert([{ contrato_id, sitio_id: req.params.id }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});

// ─────────────────────────────────────────────────────────────────────────────
// ÁREAS
// ─────────────────────────────────────────────────────────────────────────────

// GET /sitios/:id/areas — con el conteo de puntos de cada una
router.get("/:id/areas", async (req, res) => {
  if (!exigirSitioPermitido(req, res, req.params.id)) return;

  const { data, error } = await supabase
    .from("asa_areas")
    .select("*")
    .eq("sitio_id", req.params.id)
    .eq("activo", true)
    .order("orden")
    .order("nombre");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const { data: puntos } = await supabase
    .from("asa_puntos_control")
    .select("area_id")
    .eq("sitio_id", req.params.id)
    .eq("activo", true);

  const conteo = {};
  for (const p of puntos || []) conteo[p.area_id] = (conteo[p.area_id] || 0) + 1;

  res.json((data || []).map((a) => ({ ...a, puntos_total: conteo[a.id] || 0 })));
});

// POST /sitios/:id/areas — una área, o varias de golpe
// Body: { nombre, codigo, nivel, orden }  ó  { areas: [{nombre, codigo}, ...] }
router.post("/:id/areas", requireRol("comercial", "operaciones"), async (req, res) => {
  const sitio_id = req.params.id;
  if (!exigirSitioPermitido(req, res, sitio_id)) return;

  const entrada = Array.isArray(req.body.areas) ? req.body.areas : [req.body];
  const filas = entrada
    .filter((a) => a && a.nombre)
    .map((a, i) => ({
      sitio_id,
      nombre: String(a.nombre).trim(),
      codigo: a.codigo ? String(a.codigo).trim().toUpperCase() : null,
      nivel: a.nivel || null,
      descripcion: a.descripcion || null,
      orden: a.orden ?? i,
    }));

  if (!filas.length) return res.status(400).json({ error: true, mensaje: "Se requiere al menos un nombre de área" });

  // upsert para que volver a cargar la misma lista no duplique nada
  const { data, error } = await supabase
    .from("asa_areas")
    .upsert(filas, { onConflict: "sitio_id,nombre", ignoreDuplicates: false })
    .select();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  logAccion(req, { accion: "crear", modulo: "areas", registroId: sitio_id, descripcion: `${data.length} área(s)` });
  res.status(201).json(data);
});

// PUT /sitios/areas/:areaId
router.put("/areas/:areaId", requireRol("comercial", "operaciones"), async (req, res) => {
  const { id: _omit, sitio_id: _omit2, ...cambios } = req.body;
  const { data, error } = await supabase.from("asa_areas").update(cambios).eq("id", req.params.areaId).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// DELETE /sitios/areas/:areaId — baja lógica; los puntos quedan sin área
router.delete("/areas/:areaId", requireRol("operaciones"), async (req, res) => {
  const { error } = await supabase.from("asa_areas").update({ activo: false }).eq("id", req.params.areaId);
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLANOS
// ─────────────────────────────────────────────────────────────────────────────

// GET /sitios/:id/planos — con los puntos ya posicionados encima
router.get("/:id/planos", async (req, res) => {
  if (!exigirSitioPermitido(req, res, req.params.id)) return;

  const { data: planos, error } = await supabase
    .from("asa_planos")
    .select("*")
    .eq("sitio_id", req.params.id)
    .eq("activo", true)
    .order("orden");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const { data: puntos } = await supabase
    .from("asa_puntos_control")
    .select("id, qr_token, codigo_visible, nombre, plano_id, plano_x, plano_y, tipo_punto_id, asa_tipos_punto(codigo, icono, color)")
    .eq("sitio_id", req.params.id)
    .eq("activo", true)
    .not("plano_id", "is", null);

  res.json(
    (planos || []).map((pl) => ({
      ...pl,
      puntos: (puntos || []).filter((p) => p.plano_id === pl.id),
    }))
  );
});

// POST /sitios/:id/planos — { nombre, imagen_url, area_id?, ancho_px?, alto_px? }
router.post("/:id/planos", requireRol("operaciones"), async (req, res) => {
  if (!exigirSitioPermitido(req, res, req.params.id)) return;
  const { data, error } = await supabase
    .from("asa_planos")
    .insert([{ ...req.body, sitio_id: req.params.id }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});

export default router;
