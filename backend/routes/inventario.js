// routes/inventario.js — Plaguicidas + productos de tienda + movimientos
import express from "express";
import { supabase } from "../lib/supabaseClient.js";

const router = express.Router();

// ── Plaguicidas ──────────────────────────────────────────────────────────────
router.get("/plaguicidas", async (req, res) => {
  const { data, error } = await supabase.from("asa_plaguicidas_catalogo").select("*").eq("activo", true).order("nombre_comercial");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

router.post("/plaguicidas", async (req, res) => {
  const { data, error } = await supabase.from("asa_plaguicidas_catalogo").insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});

// ── Productos de tienda ─────────────────────────────────────────────────────
router.get("/productos", async (req, res) => {
  let q = supabase.from("asa_productos_tienda").select("*").eq("activo", true).order("nombre");
  if (req.query.buscar) q = q.ilike("nombre", `%${req.query.buscar}%`);
  if (req.query.categoria) q = q.eq("categoria", req.query.categoria);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

router.get("/productos/codigo/:codigo", async (req, res) => {
  const { data, error } = await supabase.from("asa_productos_tienda").select("*").eq("codigo_barra", req.params.codigo).maybeSingle();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  if (!data) return res.status(404).json({ error: true, mensaje: "Producto no encontrado" });
  res.json(data);
});

router.post("/productos", async (req, res) => {
  const { data, error } = await supabase.from("asa_productos_tienda").insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});

router.put("/productos/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("asa_productos_tienda")
    .update({ ...req.body, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// ── Movimientos (ajustes manuales de entrada/salida) ────────────────────────
router.post("/movimientos", async (req, res) => {
  const { tipo_item, item_id, tipo_movimiento, cantidad, usuario, notas } = req.body;
  const tabla = tipo_item === "plaguicida" ? "asa_plaguicidas_catalogo" : "asa_productos_tienda";

  const { data: item } = await supabase.from(tabla).select("stock_actual").eq("id", item_id).maybeSingle();
  if (!item) return res.status(404).json({ error: true, mensaje: "Item no encontrado" });

  const delta = tipo_movimiento === "salida" || tipo_movimiento === "merma" ? -Math.abs(cantidad) : Math.abs(cantidad);
  const stockDespues = Number(item.stock_actual) + delta;

  await supabase.from(tabla).update({ stock_actual: stockDespues }).eq("id", item_id);
  const { data, error } = await supabase
    .from("asa_inventario_movimientos")
    .insert([
      {
        tipo_item,
        item_id,
        tipo_movimiento,
        cantidad,
        stock_antes: item.stock_actual,
        stock_despues: stockDespues,
        usuario,
        notas,
      },
    ])
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});

router.get("/movimientos", async (req, res) => {
  let q = supabase.from("asa_inventario_movimientos").select("*").order("created_at", { ascending: false }).limit(200);
  if (req.query.tipo_item) q = q.eq("tipo_item", req.query.tipo_item);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// ── Alertas de stock mínimo (ambos catálogos) ───────────────────────────────
router.get("/alertas-stock", async (req, res) => {
  const [plaguicidas, productos] = await Promise.all([
    supabase.from("asa_plaguicidas_catalogo").select("*").eq("activo", true),
    supabase.from("asa_productos_tienda").select("*").eq("activo", true),
  ]);
  const bajos = [
    ...(plaguicidas.data || []).filter((p) => Number(p.stock_actual) <= Number(p.stock_minimo)).map((p) => ({ ...p, tipo_item: "plaguicida" })),
    ...(productos.data || []).filter((p) => Number(p.stock_actual) <= Number(p.stock_minimo)).map((p) => ({ ...p, tipo_item: "producto_tienda" })),
  ];
  res.json(bajos);
});

export default router;
