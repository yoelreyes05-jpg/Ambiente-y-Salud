// routes/contabilidad.js — Plan de cuentas y asientos contables
import express from "express";
import { supabase } from "../lib/supabaseClient.js";

const router = express.Router();

router.get("/plan-cuentas", async (req, res) => {
  const { data, error } = await supabase.from("asa_plan_cuentas").select("*").eq("activo", true).order("codigo");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

router.post("/plan-cuentas", async (req, res) => {
  const { data, error } = await supabase.from("asa_plan_cuentas").insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});

// POST /contabilidad/asientos — { fecha, concepto, origen_tipo, origen_id, usuario, detalle: [{cuenta_id, centro_costo, debito, credito}] }
router.post("/asientos", async (req, res) => {
  const { detalle = [], ...cabecera } = req.body;
  const totalDebito = detalle.reduce((s, d) => s + Number(d.debito || 0), 0);
  const totalCredito = detalle.reduce((s, d) => s + Number(d.credito || 0), 0);
  if (Math.abs(totalDebito - totalCredito) > 0.01) {
    return res.status(400).json({ error: true, mensaje: "El asiento no cuadra: débitos y créditos deben ser iguales" });
  }

  const { data: asiento, error } = await supabase.from("asa_asientos_contables").insert([cabecera]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const { error: errDet } = await supabase.from("asa_asientos_detalle").insert(detalle.map((d) => ({ ...d, asiento_id: asiento.id })));
  if (errDet) return res.status(500).json({ error: true, mensaje: errDet.message });

  res.status(201).json({ ...asiento, detalle });
});

router.get("/asientos", async (req, res) => {
  let q = supabase.from("asa_asientos_contables").select("*, asa_asientos_detalle(*)").order("fecha", { ascending: false }).limit(200);
  if (req.query.desde) q = q.gte("fecha", req.query.desde);
  if (req.query.hasta) q = q.lte("fecha", req.query.hasta);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// GET /contabilidad/balance-comprobacion?desde=&hasta=
router.get("/balance-comprobacion", async (req, res) => {
  let q = supabase.from("asa_asientos_detalle").select("cuenta_id, debito, credito, asa_asientos_contables!inner(fecha)");
  if (req.query.desde) q = q.gte("asa_asientos_contables.fecha", req.query.desde);
  if (req.query.hasta) q = q.lte("asa_asientos_contables.fecha", req.query.hasta);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const { data: cuentas } = await supabase.from("asa_plan_cuentas").select("id, codigo, nombre, tipo");
  const acumulado = {};
  for (const fila of data || []) {
    if (!acumulado[fila.cuenta_id]) acumulado[fila.cuenta_id] = { debito: 0, credito: 0 };
    acumulado[fila.cuenta_id].debito += Number(fila.debito || 0);
    acumulado[fila.cuenta_id].credito += Number(fila.credito || 0);
  }
  const resultado = Object.entries(acumulado).map(([cuenta_id, v]) => {
    const cuenta = (cuentas || []).find((c) => c.id === cuenta_id);
    return { cuenta_id, codigo: cuenta?.codigo, nombre: cuenta?.nombre, tipo: cuenta?.tipo, ...v, saldo: v.debito - v.credito };
  });
  res.json(resultado);
});

// ── Cuentas por pagar / suplidores ──────────────────────────────────────────
router.get("/suplidores", async (req, res) => {
  const { data, error } = await supabase.from("asa_suplidores").select("*").eq("activo", true);
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});
router.post("/suplidores", async (req, res) => {
  const { data, error } = await supabase.from("asa_suplidores").insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});
router.get("/cuentas-por-pagar", async (req, res) => {
  const { data, error } = await supabase.from("asa_cuentas_por_pagar").select("*, asa_suplidores(nombre)").order("fecha_vencimiento");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});
router.post("/cuentas-por-pagar", async (req, res) => {
  const { data, error } = await supabase.from("asa_cuentas_por_pagar").insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});

export default router;
