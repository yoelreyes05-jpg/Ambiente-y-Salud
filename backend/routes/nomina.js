// routes/nomina.js — Empleados, comisiones y nómina (TSS/ISR)
import express from "express";
import { supabase } from "../lib/supabaseClient.js";

const router = express.Router();

// ── Empleados ────────────────────────────────────────────────────────────────
router.get("/empleados", async (req, res) => {
  let q = supabase.from("asa_empleados").select("*").eq("activo", true);
  if (req.query.rol) q = q.eq("rol", req.query.rol);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

router.post("/empleados", async (req, res) => {
  const { data, error } = await supabase.from("asa_empleados").insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});

// ── Comisiones ───────────────────────────────────────────────────────────────
router.post("/comisiones", async (req, res) => {
  const { data, error } = await supabase.from("asa_comisiones").insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});

router.get("/comisiones/:empleadoId", async (req, res) => {
  const { data, error } = await supabase.from("asa_comisiones").select("*").eq("empleado_id", req.params.empleadoId).eq("pagada", false);
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// ── Períodos y cálculo de nómina ─────────────────────────────────────────────
// Porcentajes de referencia RD (ajustar según la legislación vigente al momento de operar):
// TSS: SFS 3.04% empleado, AFP 2.87% empleado, Riesgo Laboral a cargo del empleador.
// ISR: tabla progresiva anual de la DGII (debe configurarse/actualizarse por el contador).
const PORCENTAJES_TSS = { sfs: 0.0304, afp: 0.0287 };

router.post("/periodos", async (req, res) => {
  const { data, error } = await supabase.from("asa_nomina_periodos").insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});

// POST /nomina/periodos/:id/calcular — genera asa_nomina_detalle para todos los empleados activos
router.post("/periodos/:id/calcular", async (req, res) => {
  const { id } = req.params;
  const { data: empleados, error } = await supabase.from("asa_empleados").select("*").eq("activo", true);
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const detalles = [];
  for (const emp of empleados) {
    const { data: comisiones } = await supabase.from("asa_comisiones").select("monto, id").eq("empleado_id", emp.id).eq("pagada", false);
    const totalComisiones = (comisiones || []).reduce((s, c) => s + Number(c.monto), 0);
    const bruto = Number(emp.salario_base || 0) + totalComisiones;
    const tssSfs = Number((bruto * PORCENTAJES_TSS.sfs).toFixed(2));
    const tssAfp = Number((bruto * PORCENTAJES_TSS.afp).toFixed(2));
    // ISR: placeholder en 0 — debe calcularse con la tabla progresiva vigente de la DGII.
    const isr = 0;
    const neto = Number((bruto - tssSfs - tssAfp - isr).toFixed(2));

    const { data: detalle } = await supabase
      .from("asa_nomina_detalle")
      .insert([
        {
          periodo_id: id,
          empleado_id: emp.id,
          salario_bruto: emp.salario_base || 0,
          comisiones: totalComisiones,
          tss_sfs: tssSfs,
          tss_afp: tssAfp,
          isr,
          salario_neto: neto,
        },
      ])
      .select()
      .single();
    detalles.push(detalle);

    if (comisiones?.length) {
      await supabase
        .from("asa_comisiones")
        .update({ pagada: true, periodo_nomina_id: id })
        .in("id", comisiones.map((c) => c.id));
    }
  }

  const totalBruto = detalles.reduce((s, d) => s + Number(d.salario_bruto) + Number(d.comisiones), 0);
  const totalNeto = detalles.reduce((s, d) => s + Number(d.salario_neto), 0);
  await supabase.from("asa_nomina_periodos").update({ estado: "calculado", total_bruto: totalBruto, total_neto: totalNeto }).eq("id", id);

  res.json({ periodo_id: id, detalles });
});

router.get("/periodos/:id/detalle", async (req, res) => {
  const { data, error } = await supabase
    .from("asa_nomina_detalle")
    .select("*, asa_empleados(nombre_completo, rol)")
    .eq("periodo_id", req.params.id);
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

export default router;
