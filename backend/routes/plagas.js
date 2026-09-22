// routes/plagas.js — Salud Ambiental / Control de Plagas
// Contiene el flujo central: la app del cliente reporta una plaga y el
// sistema genera automáticamente una Orden de Trabajo (OT).
import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { requireRol } from "../middleware/auth.js";
import { logAccion } from "../lib/auditoria.js";
import { filtrarPorSitio, exigirSitioPermitido } from "../middleware/auth.js";

const router = express.Router();

// ── Contratos recurrentes ───────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// GET /plagas/catalogo — el catalogo de plagas (asa_plagas)
//
// Lo necesita la app del tecnico para que pueda decir QUE encontro y CUANTAS,
// no solo "nivel de actividad: alto". Sin esto, asa_capturas se queda vacia y
// el reporte del hotel no puede mostrar tendencia por plaga, que es lo primero
// que piden en auditoria.
// ─────────────────────────────────────────────────────────────────────────────
// Con ?tipo_punto_id= devuelve SOLO las plagas que se cuentan en ese tipo de
// punto (asa_tipo_punto_plagas, editable en el panel). Sin el parametro sigue
// devolviendo el catalogo completo, que es lo que necesita el panel.
//
// Un tipo sin plagas configuradas devuelve lista vacia a proposito: antes la app
// pintaba las once plagas del sistema en cualquier punto, y asi es como
// terminaban chinches de cama en una lampara de moscas.
router.get("/catalogo", async (req, res) => {
  if (req.query.tipo_punto_id) {
    const { data, error } = await supabase
      .from("asa_tipo_punto_plagas")
      .select("orden, asa_plagas!inner(*)")
      .eq("tipo_punto_id", req.query.tipo_punto_id)
      .eq("asa_plagas.activo", true);
    if (error) return res.status(500).json({ error: true, mensaje: error.message });
    return res.json(
      (data || [])
        .map((x) => ({ ...x.asa_plagas, orden: x.orden ?? x.asa_plagas.orden ?? 0 }))
        .sort((a, b) => (a.orden || 0) - (b.orden || 0) || String(a.nombre).localeCompare(String(b.nombre)))
    );
  }

  let q = supabase.from("asa_plagas").select("*").order("orden").order("nombre");
  if (req.query.todas !== "true") q = q.eq("activo", true);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data || []);
});

// POST /plagas/catalogo — agregar una plaga que no estaba en la lista
router.post("/catalogo", requireRol("operaciones"), async (req, res) => {
  const { codigo, nombre } = req.body;
  if (!codigo || !nombre) return res.status(400).json({ error: true, mensaje: "codigo y nombre son requeridos" });
  const { data, error } = await supabase.from("asa_plagas").insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});

// PATCH /plagas/catalogo/:id — umbral, color, nombre, o darla de baja
router.patch("/catalogo/:id", requireRol("operaciones"), async (req, res) => {
  const { id: _o, ...cambios } = req.body;
  const { data, error } = await supabase.from("asa_plagas").update(cambios).eq("id", req.params.id).select();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  if (!data?.length) return res.status(404).json({ error: true, mensaje: "Plaga no encontrada" });
  res.json(data[0]);
});

router.get("/contratos", async (req, res) => {
  let q = supabase.from("asa_contratos_plagas").select("*, asa_sitios(nombre, direccion)").eq("activo", true);
  if (req.query.cliente_id) q = q.eq("cliente_id", req.query.cliente_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

router.post("/contratos", async (req, res) => {
  const { data, error } = await supabase.from("asa_contratos_plagas").insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});

// ── Generador de numero_orden legible (ASA-000123) ──────────────────────────
async function generarNumeroOrden() {
  const { count } = await supabase.from("asa_ordenes_trabajo").select("id", { count: "exact", head: true });
  const siguiente = (count || 0) + 1;
  return `ASA-${String(siguiente).padStart(6, "0")}`;
}

// ── Órdenes de trabajo ───────────────────────────────────────────────────────
router.get("/ordenes", async (req, res) => {
  let q = supabase
    .from("asa_ordenes_trabajo")
    .select("*, asa_clientes(nombre_contacto), asa_sitios(nombre, direccion)")
    .order("created_at", { ascending: false });

  // Sin esto, una cuenta de hotel veía las órdenes de TODOS los hoteles: esta
  // ruta era la única del módulo que no aplicaba el alcance por sitio.
  if (req.query.sitio_id) {
    if (!exigirSitioPermitido(req, res, req.query.sitio_id)) return;
    q = q.eq("sitio_id", req.query.sitio_id);
  } else {
    q = filtrarPorSitio(q, req);
  }

  if (req.query.cliente_id) q = q.eq("cliente_id", req.query.cliente_id);
  if (req.query.estado) q = q.eq("estado", req.query.estado);
  if (req.query.tecnico_id) q = q.eq("tecnico_id", req.query.tecnico_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

router.get("/ordenes/:id", async (req, res) => {
  const { id } = req.params;
  const [orden, aplicaciones, log] = await Promise.all([
    supabase.from("asa_ordenes_trabajo").select("*, asa_clientes(*), asa_sitios(*)").eq("id", id).maybeSingle(),
    supabase.from("asa_aplicaciones_productos").select("*, asa_plaguicidas_catalogo(nombre_comercial)").eq("orden_trabajo_id", id),
    supabase.from("asa_ordenes_trabajo_log").select("*").eq("orden_id", id).order("created_at"),
  ]);
  if (orden.error) return res.status(500).json({ error: true, mensaje: orden.error.message });
  if (!orden.data) return res.status(404).json({ error: true, mensaje: "Orden no encontrada" });
  res.json({ ...orden.data, aplicaciones: aplicaciones.data || [], historial_estados: log.data || [] });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /plagas/reportar — ENDPOINT DE LA APP DEL CLIENTE
// El cliente reporta una plaga -> se crea automáticamente la OT "solicitada".
// Body: { cliente_id, sitio_id, tipo_plaga_reportada, descripcion_cliente,
//          fotos_cliente: [urls], prioridad? }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/reportar", async (req, res) => {
  const { cliente_id, sitio_id, tipo_plaga_reportada, descripcion_cliente, fotos_cliente = [], prioridad } = req.body;

  if (!cliente_id || !sitio_id) {
    return res.status(400).json({ error: true, mensaje: "cliente_id y sitio_id son requeridos" });
  }
  if (!exigirSitioPermitido(req, res, sitio_id)) return;

  // Si el sitio tiene un contrato activo, se enlaza automáticamente
  const { data: contrato } = await supabase
    .from("asa_contratos_plagas")
    .select("id")
    .eq("sitio_id", sitio_id)
    .eq("activo", true)
    .maybeSingle();

  const numero_orden = await generarNumeroOrden();

  const { data: orden, error } = await supabase
    .from("asa_ordenes_trabajo")
    .insert([
      {
        numero_orden,
        cliente_id,
        sitio_id,
        contrato_id: contrato?.id || null,
        origen: "app_cliente",
        estado: "solicitada",
        prioridad: prioridad || "normal",
        tipo_plaga_reportada,
        descripcion_cliente,
        fotos_cliente,
      },
    ])
    .select()
    .single();

  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  await supabase.from("asa_ordenes_trabajo_log").insert([
    { orden_id: orden.id, estado_nuevo: "solicitada", usuario_nombre: "App Cliente", motivo: "Reporte de plaga desde la app" },
  ]);

  // Notifica a operaciones (usuarios con rol operaciones/admin) — se resuelve
  // en el módulo de notificaciones/cron; aquí se deja el registro base.
  await supabase.from("asa_notificaciones").insert([
    {
      cliente_id,
      tipo: "ot_actualizada",
      titulo: "Reporte recibido",
      mensaje: `Recibimos tu reporte (${numero_orden}). Pronto agendaremos la visita.`,
      canal: "push",
    },
  ]);

  logAccion(req, { accion: "crear", modulo: "plagas_reportar", registroId: orden.id, descripcion: `OT ${numero_orden} creada desde app cliente` });
  res.status(201).json(orden);
});

// PATCH /plagas/ordenes/:id/estado — transición de estado con auditoría
router.patch("/ordenes/:id/estado", async (req, res) => {
  const { id } = req.params;
  const { estado, motivo, usuario_nombre } = req.body;

  const { data: actual } = await supabase.from("asa_ordenes_trabajo").select("estado, cliente_id").eq("id", id).maybeSingle();
  if (!actual) return res.status(404).json({ error: true, mensaje: "Orden no encontrada" });

  const camposFecha = {
    agendada: "fecha_agendada",
    ejecutada: "fecha_ejecucion",
  };
  const update = { estado, updated_at: new Date().toISOString() };
  if (camposFecha[estado]) update[camposFecha[estado]] = new Date().toISOString();

  const { data, error } = await supabase.from("asa_ordenes_trabajo").update(update).eq("id", id).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  await supabase.from("asa_ordenes_trabajo_log").insert([
    { orden_id: id, estado_anterior: actual.estado, estado_nuevo: estado, usuario_nombre: usuario_nombre || "Sistema", motivo },
  ]);

  await supabase.from("asa_notificaciones").insert([
    {
      cliente_id: actual.cliente_id,
      tipo: "ot_actualizada",
      titulo: "Actualización de tu servicio",
      mensaje: `Tu orden ${data.numero_orden} cambió a: ${estado}.`,
      canal: "push",
    },
  ]);

  logAccion(req, { accion: "cambio_estado", modulo: "plagas_ordenes", registroId: id, descripcion: `${actual.estado} -> ${estado}` });
  res.json(data);
});

// PATCH /plagas/ordenes/:id/asignar — asignar técnico y agendar
router.patch("/ordenes/:id/asignar", async (req, res) => {
  const { id } = req.params;
  const { tecnico_id, fecha_agendada } = req.body;
  const { data, error } = await supabase
    .from("asa_ordenes_trabajo")
    .update({ tecnico_id, fecha_agendada, estado: "agendada", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  await supabase.from("asa_ordenes_trabajo_log").insert([
    { orden_id: id, estado_nuevo: "agendada", motivo: "Técnico asignado y visita agendada" },
  ]);
  await supabase.from("asa_notificaciones").insert([
    {
      cliente_id: data.cliente_id,
      tipo: "ot_actualizada",
      titulo: "Visita agendada",
      mensaje: `Tu servicio ${data.numero_orden} fue agendado para ${fecha_agendada}.`,
      canal: "whatsapp",
    },
  ]);
  res.json(data);
});

// POST /plagas/ordenes/:id/ejecutar — el técnico cierra la ejecución en sitio
router.post("/ordenes/:id/ejecutar", async (req, res) => {
  const { id } = req.params;
  const { diagnostico, plan_tratamiento, evidencias_tecnico, firma_cliente, aplicaciones = [] } = req.body;

  const { data, error } = await supabase
    .from("asa_ordenes_trabajo")
    .update({
      diagnostico,
      plan_tratamiento,
      evidencias_tecnico,
      firma_cliente,
      estado: "ejecutada",
      fecha_ejecucion: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  // Registrar aplicaciones de plaguicidas (trazabilidad + descuenta inventario)
  for (const app of aplicaciones) {
    await supabase.from("asa_aplicaciones_productos").insert([{ ...app, orden_trabajo_id: id }]);
    if (app.producto_id && app.cantidad_usada) {
      const { data: prod } = await supabase.from("asa_plaguicidas_catalogo").select("stock_actual").eq("id", app.producto_id).maybeSingle();
      if (prod) {
        const nuevoStock = Number(prod.stock_actual) - Number(app.cantidad_usada);
        await supabase.from("asa_plaguicidas_catalogo").update({ stock_actual: nuevoStock }).eq("id", app.producto_id);
        await supabase.from("asa_inventario_movimientos").insert([
          {
            tipo_item: "plaguicida",
            item_id: app.producto_id,
            tipo_movimiento: "aplicacion",
            cantidad: app.cantidad_usada,
            stock_antes: prod.stock_actual,
            stock_despues: nuevoStock,
            referencia_tipo: "orden_trabajo",
            referencia_id: id,
          },
        ]);
      }
    }
  }

  await supabase.from("asa_ordenes_trabajo_log").insert([{ orden_id: id, estado_nuevo: "ejecutada", motivo: "Servicio ejecutado en sitio" }]);
  logAccion(req, { accion: "actualizar", modulo: "plagas_ordenes", registroId: id, descripcion: "OT ejecutada con evidencias" });
  res.json(data);
});

export default router;
