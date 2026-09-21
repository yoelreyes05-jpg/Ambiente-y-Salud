// routes/facturacion.js — Facturación electrónica (e-CF) unificada de las
// 3 líneas de negocio (plagas, veterinaria/estética, tienda) — Ley 32-23.
import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { logAccion } from "../lib/auditoria.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// Envío al proveedor de e-CF certificado por la DGII.
// STUB: aquí se integra el SDK/API del proveedor que elijan (firma XML,
// transmisión y contingencia). Mientras no haya proveedor configurado,
// esta función simula la aceptación para no bloquear el desarrollo del resto
// del sistema. NUNCA usar este modo simulado en producción real.
// ─────────────────────────────────────────────────────────────────────────────
async function enviarAProveedorECF(factura) {
  if (!process.env.ECF_PROVIDER_BASE_URL) {
    console.warn("[ASA][e-CF] ECF_PROVIDER_BASE_URL no configurado — modo simulado (NO usar en producción)");
    return { estado_dgii: "aceptado", acuse_dgii: { simulado: true, mensaje: "Sin proveedor configurado" } };
  }
  // Ejemplo de integración real (ajustar a la API del proveedor elegido):
  // const resp = await axios.post(`${process.env.ECF_PROVIDER_BASE_URL}/ecf`, payload, {
  //   headers: { Authorization: `Bearer ${process.env.ECF_PROVIDER_API_KEY}` }
  // });
  // return { estado_dgii: resp.data.estado, acuse_dgii: resp.data };
  return { estado_dgii: "pendiente", acuse_dgii: null };
}

async function siguienteNCF(tipoEcf) {
  const { data: sec, error } = await supabase.from("asa_secuencias_ecf").select("*").eq("tipo_ecf", tipoEcf).maybeSingle();
  if (error || !sec) throw new Error(`Secuencia de e-CF no configurada para ${tipoEcf}`);
  if (sec.siguiente > sec.maximo) throw new Error(`Secuencia de e-CF agotada para ${tipoEcf}`);
  const eNcf = `${sec.prefijo}${String(sec.siguiente).padStart(8, "0")}`;
  await supabase.from("asa_secuencias_ecf").update({ siguiente: sec.siguiente + 1 }).eq("tipo_ecf", tipoEcf);
  return eNcf;
}

// GET /facturacion?cliente_id=&tipo_origen=&estado=
router.get("/", async (req, res) => {
  let q = supabase.from("asa_facturas").select("*, asa_clientes(nombre_contacto, rnc_cedula)").order("created_at", { ascending: false });
  if (req.query.cliente_id) q = q.eq("cliente_id", req.query.cliente_id);
  if (req.query.tipo_origen) q = q.eq("tipo_origen", req.query.tipo_origen);
  if (req.query.estado) q = q.eq("estado_factura", req.query.estado);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;
  const [factura, items, pagos] = await Promise.all([
    supabase.from("asa_facturas").select("*, asa_clientes(*)").eq("id", id).maybeSingle(),
    supabase.from("asa_factura_items").select("*").eq("factura_id", id),
    supabase.from("asa_pagos").select("*").eq("factura_id", id),
  ]);
  if (!factura.data) return res.status(404).json({ error: true, mensaje: "Factura no encontrada" });
  res.json({ ...factura.data, items: items.data || [], pagos: pagos.data || [] });
});

// POST /facturacion — emitir e-CF
// Body: { cliente_id, tipo_origen, origen_id, tipo_ecf, items: [{descripcion, cantidad, precio_unitario, itbis_aplica}] }
router.post("/", async (req, res) => {
  const { cliente_id, tipo_origen, origen_id, tipo_ecf = "e32", items = [] } = req.body;
  if (!cliente_id || !items.length) {
    return res.status(400).json({ error: true, mensaje: "cliente_id e items son requeridos" });
  }

  const { data: config } = await supabase.from("asa_config_sistema").select("valor").eq("clave", "itbis_porcentaje").maybeSingle();
  const itbisPct = Number(config?.valor || 18);

  let subtotal = 0;
  let itbisTotal = 0;
  const itemsCalc = items.map((it) => {
    const lineaSubtotal = Number(it.precio_unitario) * Number(it.cantidad);
    const lineaItbis = it.itbis_aplica !== false ? lineaSubtotal * (itbisPct / 100) : 0;
    subtotal += lineaSubtotal;
    itbisTotal += lineaItbis;
    return { ...it, subtotal: Number(lineaSubtotal.toFixed(2)) };
  });

  let eNcf;
  try {
    eNcf = await siguienteNCF(tipo_ecf);
  } catch (e) {
    return res.status(500).json({ error: true, mensaje: e.message });
  }

  const { data: factura, error } = await supabase
    .from("asa_facturas")
    .insert([
      {
        cliente_id,
        tipo_origen,
        origen_id,
        tipo_ecf,
        e_ncf: eNcf,
        subtotal: Number(subtotal.toFixed(2)),
        itbis: Number(itbisTotal.toFixed(2)),
        total: Number((subtotal + itbisTotal).toFixed(2)),
        estado_dgii: "pendiente",
        estado_factura: "emitida",
      },
    ])
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  await supabase.from("asa_factura_items").insert(itemsCalc.map((it) => ({ ...it, factura_id: factura.id })));

  const resultadoDgii = await enviarAProveedorECF(factura);
  await supabase.from("asa_facturas").update(resultadoDgii).eq("id", factura.id);

  logAccion(req, {
    accion: "crear",
    modulo: "facturacion",
    registroId: factura.id,
    descripcion: `e-CF ${eNcf} emitido para ${tipo_origen} por RD$ ${factura.total}`,
  });

  res.status(201).json({ ...factura, ...resultadoDgii, items: itemsCalc });
});

// POST /facturacion/:id/pagos
router.post("/:id/pagos", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from("asa_pagos").insert([{ ...req.body, factura_id: id }]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const { data: pagos } = await supabase.from("asa_pagos").select("monto").eq("factura_id", id);
  const { data: factura } = await supabase.from("asa_facturas").select("total").eq("id", id).maybeSingle();
  const totalPagado = (pagos || []).reduce((s, p) => s + Number(p.monto), 0);
  if (factura && totalPagado >= Number(factura.total)) {
    await supabase.from("asa_facturas").update({ estado_factura: "pagada" }).eq("id", id);
  }

  logAccion(req, { accion: "crear", modulo: "facturacion_pagos", registroId: data.id });
  res.status(201).json(data);
});

export default router;
