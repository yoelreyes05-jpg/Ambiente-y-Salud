// routes/pos.js — Punto de venta de la tienda (venta al detalle)
import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { logAccion } from "../lib/auditoria.js";

const router = express.Router();

async function generarNumeroVenta() {
  const { count } = await supabase.from("asa_ventas_pos").select("id", { count: "exact", head: true });
  return `POS-${String((count || 0) + 1).padStart(6, "0")}`;
}

// GET /pos/ventas
router.get("/ventas", async (req, res) => {
  let q = supabase.from("asa_ventas_pos").select("*, asa_ventas_pos_detalle(*)").order("created_at", { ascending: false }).limit(100);
  if (req.query.cliente_id) q = q.eq("cliente_id", req.query.cliente_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// POST /pos/ventas — { cliente_id?, cajero_id, metodo_pago, items: [{producto_id, cantidad}] }
router.post("/ventas", async (req, res) => {
  const { cliente_id, cajero_id, metodo_pago, items = [] } = req.body;
  if (!items.length) return res.status(400).json({ error: true, mensaje: "La venta debe tener al menos un producto" });

  // Traer precios/ITBIS actuales del catálogo (nunca confiar en precio enviado por el cliente)
  const ids = items.map((i) => i.producto_id);
  const { data: productos, error: errProd } = await supabase.from("asa_productos_tienda").select("*").in("id", ids);
  if (errProd) return res.status(500).json({ error: true, mensaje: errProd.message });

  const { data: config } = await supabase.from("asa_config_sistema").select("valor").eq("clave", "itbis_porcentaje").maybeSingle();
  const itbisPct = Number(config?.valor || 18);

  let subtotal = 0;
  let itbisTotal = 0;
  const detalle = [];
  for (const it of items) {
    const prod = productos.find((p) => p.id === it.producto_id);
    if (!prod) return res.status(400).json({ error: true, mensaje: `Producto ${it.producto_id} no existe` });
    if (Number(prod.stock_actual) < Number(it.cantidad)) {
      return res.status(409).json({ error: true, mensaje: `Stock insuficiente para ${prod.nombre}` });
    }
    const lineaSubtotal = Number(prod.precio_venta) * Number(it.cantidad);
    const lineaItbis = prod.itbis_aplica ? lineaSubtotal * (itbisPct / 100) : 0;
    subtotal += lineaSubtotal;
    itbisTotal += lineaItbis;
    detalle.push({
      producto_id: prod.id,
      cantidad: it.cantidad,
      precio_unitario: prod.precio_venta,
      itbis: Number(lineaItbis.toFixed(2)),
      subtotal: Number(lineaSubtotal.toFixed(2)),
    });
  }

  const numero = await generarNumeroVenta();
  const total = subtotal + itbisTotal;

  const { data: venta, error } = await supabase
    .from("asa_ventas_pos")
    .insert([
      {
        numero,
        cliente_id: cliente_id || null,
        cajero_id,
        subtotal: Number(subtotal.toFixed(2)),
        itbis: Number(itbisTotal.toFixed(2)),
        total: Number(total.toFixed(2)),
        metodo_pago,
      },
    ])
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  await supabase.from("asa_ventas_pos_detalle").insert(detalle.map((d) => ({ ...d, venta_id: venta.id })));

  // Descontar inventario y dejar rastro en el ledger
  for (const d of detalle) {
    const prod = productos.find((p) => p.id === d.producto_id);
    const nuevoStock = Number(prod.stock_actual) - Number(d.cantidad);
    await supabase.from("asa_productos_tienda").update({ stock_actual: nuevoStock }).eq("id", prod.id);
    await supabase.from("asa_inventario_movimientos").insert([
      {
        tipo_item: "producto_tienda",
        item_id: prod.id,
        tipo_movimiento: "venta",
        cantidad: d.cantidad,
        stock_antes: prod.stock_actual,
        stock_despues: nuevoStock,
        referencia_tipo: "venta_pos",
        referencia_id: venta.id,
      },
    ]);
  }

  logAccion(req, { accion: "crear", modulo: "pos_ventas", registroId: venta.id, descripcion: `Venta ${numero} por RD$ ${total.toFixed(2)}` });
  res.status(201).json({ ...venta, detalle });
});

// POST /pos/ventas/:id/anular
router.post("/ventas/:id/anular", async (req, res) => {
  const { id } = req.params;
  const { motivo } = req.body;
  const { data, error } = await supabase.from("asa_ventas_pos").update({ anulada: true, motivo_anulacion: motivo }).eq("id", id).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  logAccion(req, { accion: "actualizar", modulo: "pos_ventas", registroId: id, descripcion: "Venta anulada" });
  res.json(data);
});

// ── Cuadre de caja ───────────────────────────────────────────────────────────
router.post("/cuadre-caja", async (req, res) => {
  const { data, error } = await supabase.from("asa_pos_cuadre_caja").insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});

router.get("/cuadre-caja", async (req, res) => {
  const { data, error } = await supabase.from("asa_pos_cuadre_caja").select("*").order("fecha", { ascending: false }).limit(60);
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

export default router;
