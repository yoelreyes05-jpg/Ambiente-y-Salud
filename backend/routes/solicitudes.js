// routes/solicitudes.js — Solicitudes del hotel (hotel ↔ ASA ↔ técnico)
//
// El hotel pide trabajo desde su portal: una LISTA DE HABITACIONES (las que ya
// salieron los huéspedes, la hoja que antes le entregaban en papel al técnico)
// o el reporte de una plaga. Todo queda en asa_ordenes_trabajo, con:
//
//   asa_orden_puntos   — cada habitación/punto pedido y si ya se hizo. Se marca
//                        SOLA cuando el técnico inspecciona ese punto (trigger
//                        trg_asa_marcar_solicitudes, 30_solicitudes_hotel.sql)
//   asa_orden_mensajes — el hilo de conversación de la solicitud
//
// Quién hace qué:
//   hotel (cliente_calidad) — crear, agregar habitaciones, escribir, cancelar
//   técnico                 — ver, "recibida", escribir
//   panel (admin/operaciones/comercial) — todo lo anterior + asignar y cerrar
//
// Las escrituras del hotel están permitidas explícitamente en
// middleware/auth.js (ESCRITURAS_PERMITIDAS_EXTERNAS); el resto sigue en
// solo lectura para las cuentas externas.
import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { logAccion } from "../lib/auditoria.js";
import { filtrarPorSitio, exigirSitioPermitido, puedeVerSitio, requireRol, ROLES_EXTERNOS } from "../middleware/auth.js";

const router = express.Router();

const ABIERTAS = ["solicitada", "agendada", "en_ruta", "en_sitio"];
const esExterno = (req) => ROLES_EXTERNOS.includes(req.usuario?.rol);
const esTecnico = (req) => req.usuario?.rol === "tecnico_plagas";
const esOficina = (req) => !esExterno(req) && !esTecnico(req);

const error500 = (res, e) => res.status(500).json({ error: true, mensaje: e.message || String(e) });

async function generarNumeroOrden() {
  const { count } = await supabase.from("asa_ordenes_trabajo").select("id", { count: "exact", head: true });
  return `ASA-${String((count || 0) + 1).padStart(6, "0")}`;
}

async function registrarEstado(ordenId, anterior, nuevo, req, motivo) {
  await supabase.from("asa_ordenes_trabajo_log").insert([
    {
      orden_id: ordenId,
      estado_anterior: anterior,
      estado_nuevo: nuevo,
      usuario_id: req.usuario?.id || null,
      usuario_nombre: req.usuario?.nombre || "Sistema",
      motivo,
    },
  ]);
}

// Carga una orden y comprueba que el usuario pueda verla. Devuelve null y ya
// respondió si no.
async function ordenVisible(req, res, id, campos = "*") {
  const { data, error } = await supabase.from("asa_ordenes_trabajo").select(campos).eq("id", id).maybeSingle();
  if (error) { error500(res, error); return null; }
  if (!data) { res.status(404).json({ error: true, mensaje: "Solicitud no encontrada" }); return null; }
  if (!puedeVerSitio(req, data.sitio_id)) { res.status(403).json({ error: true, mensaje: "No tienes acceso a este hotel" }); return null; }
  return data;
}

// Valida que los puntos sean activos y de ESTA planta. Devuelve sus ids.
async function puntosDeLaPlanta(sitioId, ids) {
  const unicos = [...new Set((ids || []).filter(Boolean))];
  if (!unicos.length) return [];
  const { data, error } = await supabase
    .from("asa_puntos_control")
    .select("id")
    .eq("sitio_id", sitioId)
    .eq("activo", true)
    .in("id", unicos);
  if (error) throw error;
  return (data || []).map((p) => p.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /solicitudes?sitio_id=&estado=abiertas|cerradas|todas&dias=60
// ─────────────────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const { sitio_id, estado = "todas" } = req.query;
  const dias = Math.min(Math.max(Number(req.query.dias) || 60, 1), 365);

  let q = supabase
    .from("asa_ordenes_trabajo")
    .select(`
      id, numero_orden, sitio_id, cliente_id, tipo_solicitud, origen, estado, prioridad,
      tipo_plaga_reportada, descripcion_cliente, fecha_requerida, fecha_agendada, fecha_ejecucion,
      created_at, updated_at, creado_por_nombre, creado_por_rol, tecnico_id,
      visto_admin_at, visto_admin_nombre, recibido_tecnico_at, recibido_tecnico_nombre,
      asa_sitios(nombre)
    `)
    .order("created_at", { ascending: false })
    .limit(300);

  if (sitio_id) {
    if (!exigirSitioPermitido(req, res, sitio_id)) return;
    q = q.eq("sitio_id", sitio_id);
  } else {
    q = filtrarPorSitio(q, req);
  }
  if (estado === "abiertas") q = q.in("estado", ABIERTAS);
  else {
    const desde = new Date(Date.now() - dias * 86400000).toISOString();
    q = q.gte("created_at", desde);
    if (estado === "cerradas") q = q.not("estado", "in", `(${ABIERTAS.join(",")})`);
  }

  const { data: ordenes, error } = await q;
  if (error) return error500(res, error);
  if (!ordenes.length) return res.json([]);

  const ids = ordenes.map((o) => o.id);
  const tecIds = [...new Set(ordenes.map((o) => o.tecnico_id).filter(Boolean))];
  const [items, msgs, tecs] = await Promise.all([
    supabase.from("asa_orden_puntos").select("orden_id, estado").in("orden_id", ids),
    supabase.from("asa_orden_mensajes").select("orden_id, created_at, autor_rol").in("orden_id", ids),
    tecIds.length ? supabase.from("asa_empleados").select("id, nombre_completo").in("id", tecIds) : { data: [] },
  ]);
  if (items.error) return error500(res, items.error);

  const conteo = new Map();
  for (const it of items.data || []) {
    if (!conteo.has(it.orden_id)) conteo.set(it.orden_id, { total: 0, hechos: 0, no_realizados: 0, pendientes: 0 });
    const c = conteo.get(it.orden_id);
    if (it.estado === "cancelado") continue;
    c.total++;
    if (it.estado === "hecho") c.hechos++;
    else if (it.estado === "no_realizado") c.no_realizados++;
    else c.pendientes++;
  }
  const mensajes = new Map();
  for (const m of msgs.data || []) {
    const x = mensajes.get(m.orden_id) || { total: 0, ultimo: null };
    x.total++;
    if (!x.ultimo || m.created_at > x.ultimo) x.ultimo = m.created_at;
    mensajes.set(m.orden_id, x);
  }
  const nombreTec = new Map((tecs.data || []).map((t) => [t.id, t.nombre_completo]));

  res.json(
    ordenes.map((o) => ({
      ...o,
      sitio_nombre: o.asa_sitios?.nombre || "",
      asa_sitios: undefined,
      tecnico_nombre: nombreTec.get(o.tecnico_id) || null,
      nueva: !o.visto_admin_at && o.estado !== "cancelada" && ROLES_EXTERNOS.includes(o.creado_por_rol || ""),
      puntos: conteo.get(o.id) || { total: 0, hechos: 0, no_realizados: 0, pendientes: 0 },
      mensajes_total: mensajes.get(o.id)?.total || 0,
      ultimo_mensaje_at: mensajes.get(o.id)?.ultimo || null,
    }))
  );
});

// GET /solicitudes/resumen — el globito del menú del panel y de la app
router.get("/resumen", async (req, res) => {
  let qNuevas = supabase
    .from("asa_ordenes_trabajo")
    .select("id", { count: "exact", head: true })
    .is("visto_admin_at", null)
    .in("creado_por_rol", ROLES_EXTERNOS)
    .neq("estado", "cancelada");
  let qAbiertas = supabase
    .from("asa_ordenes_trabajo")
    .select("id", { count: "exact", head: true })
    .in("estado", ABIERTAS);
  if (req.query.sitio_id) {
    if (!exigirSitioPermitido(req, res, req.query.sitio_id)) return;
    qNuevas = qNuevas.eq("sitio_id", req.query.sitio_id);
    qAbiertas = qAbiertas.eq("sitio_id", req.query.sitio_id);
  } else {
    qNuevas = filtrarPorSitio(qNuevas, req);
    qAbiertas = filtrarPorSitio(qAbiertas, req);
  }
  const [n, a] = await Promise.all([qNuevas, qAbiertas]);
  if (n.error) return error500(res, n.error);
  res.json({ nuevas: n.count || 0, abiertas: a.count || 0 });
});

// GET /solicitudes/tecnicos — para asignar desde el panel
router.get("/tecnicos", async (req, res) => {
  if (esExterno(req)) return res.status(403).json({ error: true, mensaje: "Sin acceso" });
  const { data, error } = await supabase
    .from("asa_empleados")
    .select("id, nombre_completo, telefono")
    .eq("rol", "tecnico_plagas")
    .eq("activo", true)
    .order("nombre_completo");
  if (error) return error500(res, error);
  res.json(data || []);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /solicitudes/:id — la solicitud completa: habitaciones, mensajes, historial
// Si la abre alguien de la oficina, deja de ser "nueva".
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const o = await ordenVisible(req, res, req.params.id, "*, asa_sitios(nombre), asa_clientes(nombre_contacto)");
  if (!o) return;

  if (esOficina(req) && !o.visto_admin_at) {
    const ahora = new Date().toISOString();
    await supabase
      .from("asa_ordenes_trabajo")
      .update({ visto_admin_at: ahora, visto_admin_nombre: req.usuario?.nombre || null })
      .eq("id", o.id);
    o.visto_admin_at = ahora;
    o.visto_admin_nombre = req.usuario?.nombre || null;
  }

  const [items, msgs, log, tec] = await Promise.all([
    supabase
      .from("asa_orden_puntos")
      .select(`
        id, punto_id, estado, inspeccion_id, motivo_no_realizado, atendido_at, created_at,
        asa_puntos_control(codigo_visible, nombre, numero_habitacion, qr_token, asa_areas(nombre), asa_tipos_punto(codigo, nombre, icono))
      `)
      .eq("orden_id", o.id),
    supabase.from("asa_orden_mensajes").select("*").eq("orden_id", o.id).order("created_at"),
    supabase.from("asa_ordenes_trabajo_log").select("*").eq("orden_id", o.id).order("created_at"),
    o.tecnico_id ? supabase.from("asa_empleados").select("nombre_completo").eq("id", o.tecnico_id).maybeSingle() : { data: null },
  ]);
  if (items.error) return error500(res, items.error);

  const puntos = (items.data || [])
    .map((it) => {
      const p = it.asa_puntos_control || {};
      return {
        id: it.id,
        punto_id: it.punto_id,
        estado: it.estado,
        inspeccion_id: it.inspeccion_id,
        motivo_no_realizado: it.motivo_no_realizado,
        atendido_at: it.atendido_at,
        codigo_visible: p.codigo_visible,
        punto_nombre: p.nombre,
        numero_habitacion: p.numero_habitacion,
        // El QR solo lo necesita el técnico, para abrir el punto desde la lista.
        qr_token: esExterno(req) ? undefined : p.qr_token,
        area_nombre: p.asa_areas?.nombre || "Sin área",
        tipo_codigo: p.asa_tipos_punto?.codigo,
        tipo_nombre: p.asa_tipos_punto?.nombre,
        tipo_icono: p.asa_tipos_punto?.icono,
      };
    })
    .sort((a, b) =>
      String(a.numero_habitacion || a.codigo_visible).localeCompare(String(b.numero_habitacion || b.codigo_visible), "es", { numeric: true })
    );

  res.json({
    ...o,
    sitio_nombre: o.asa_sitios?.nombre || "",
    cliente_nombre: o.asa_clientes?.nombre_contacto || "",
    asa_sitios: undefined,
    asa_clientes: undefined,
    tecnico_nombre: tec.data?.nombre_completo || null,
    puntos,
    mensajes: msgs.data || [],
    historial: log.data || [],
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /solicitudes — crear
// Body: { sitio_id, tipo_solicitud: 'habitaciones'|'plaga'|'puntos'|'otro',
//         punto_ids?: [], prioridad?, fecha_requerida?, descripcion?, tipo_plaga? }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const { sitio_id, tipo_solicitud = "habitaciones", punto_ids = [], prioridad = "normal", fecha_requerida, descripcion, tipo_plaga } = req.body || {};
  if (!sitio_id) return res.status(400).json({ error: true, mensaje: "sitio_id es requerido" });
  if (!exigirSitioPermitido(req, res, sitio_id)) return;
  if (!["habitaciones", "plaga", "puntos", "otro"].includes(tipo_solicitud)) {
    return res.status(400).json({ error: true, mensaje: "Tipo de solicitud no válido" });
  }
  if (!["baja", "normal", "alta", "urgente"].includes(prioridad)) {
    return res.status(400).json({ error: true, mensaje: "Prioridad no válida" });
  }

  try {
    const { data: sitio, error: eS } = await supabase.from("asa_sitios").select("id, cliente_id, nombre").eq("id", sitio_id).maybeSingle();
    if (eS) throw eS;
    if (!sitio) return res.status(404).json({ error: true, mensaje: "Planta no encontrada" });

    const validos = await puntosDeLaPlanta(sitio_id, punto_ids);
    if (["habitaciones", "puntos"].includes(tipo_solicitud) && !validos.length) {
      return res.status(400).json({ error: true, mensaje: "Elige al menos una habitación de la lista." });
    }
    if (tipo_solicitud === "plaga" && !String(descripcion || "").trim()) {
      return res.status(400).json({ error: true, mensaje: "Describe dónde y qué se observó." });
    }

    const { data: contrato } = await supabase
      .from("asa_contratos_plagas").select("id").eq("sitio_id", sitio_id).eq("activo", true).limit(1).maybeSingle();

    const numero_orden = await generarNumeroOrden();
    const { data: orden, error } = await supabase
      .from("asa_ordenes_trabajo")
      .insert([{
        numero_orden,
        cliente_id: sitio.cliente_id,
        sitio_id,
        contrato_id: contrato?.id || null,
        origen: esExterno(req) ? "app_cliente" : "llamada",
        estado: "solicitada",
        prioridad,
        tipo_solicitud,
        tipo_plaga_reportada: tipo_plaga || null,
        descripcion_cliente: String(descripcion || "").trim() || null,
        fecha_requerida: fecha_requerida || null,
        creado_por_usuario_id: req.usuario?.id || null,
        creado_por_nombre: req.usuario?.nombre || null,
        creado_por_rol: req.usuario?.rol || null,
        // Si la crea la oficina, la oficina ya la "vio".
        visto_admin_at: esOficina(req) ? new Date().toISOString() : null,
        visto_admin_nombre: esOficina(req) ? req.usuario?.nombre || null : null,
      }])
      .select()
      .single();
    if (error) throw error;

    if (validos.length) {
      const { error: eP } = await supabase
        .from("asa_orden_puntos")
        .insert(validos.map((punto_id) => ({ orden_id: orden.id, punto_id })));
      if (eP) throw eP;
    }

    const etiqueta = tipo_solicitud === "habitaciones" ? `${validos.length} habitación(es)` : tipo_solicitud === "plaga" ? `reporte de ${tipo_plaga || "plaga"}` : `${validos.length} punto(s)`;
    await registrarEstado(orden.id, null, "solicitada", req, `Solicitud creada: ${etiqueta}`);
    logAccion(req, { accion: "crear", modulo: "solicitudes", registroId: orden.id, descripcion: `${numero_orden} · ${sitio.nombre} · ${etiqueta}` });

    res.status(201).json({ ...orden, puntos_agregados: validos.length, puntos_rechazados: [...new Set(punto_ids)].length - validos.length });
  } catch (e) {
    error500(res, e);
  }
});

// POST /solicitudes/:id/puntos — agregar habitaciones a una solicitud abierta
// (durante el día siguen saliendo huéspedes: no hace falta abrir otra orden)
router.post("/:id/puntos", async (req, res) => {
  const o = await ordenVisible(req, res, req.params.id);
  if (!o) return;
  if (!ABIERTAS.includes(o.estado) && o.estado !== "ejecutada") {
    return res.status(409).json({ error: true, mensaje: "La solicitud ya está cerrada. Crea una nueva." });
  }
  try {
    const validos = await puntosDeLaPlanta(o.sitio_id, req.body?.punto_ids);
    if (!validos.length) return res.status(400).json({ error: true, mensaje: "No hay habitaciones válidas para agregar." });

    const { data: ya } = await supabase.from("asa_orden_puntos").select("punto_id").eq("orden_id", o.id);
    const existentes = new Set((ya || []).map((x) => x.punto_id));
    const nuevos = validos.filter((id) => !existentes.has(id));
    if (nuevos.length) {
      const { error } = await supabase.from("asa_orden_puntos").insert(nuevos.map((punto_id) => ({ orden_id: o.id, punto_id })));
      if (error) throw error;
      // Si ya estaba completa, vuelve a abrirse: hay trabajo nuevo.
      if (o.estado === "ejecutada") {
        await supabase.from("asa_ordenes_trabajo").update({ estado: "en_sitio", fecha_ejecucion: null, updated_at: new Date().toISOString() }).eq("id", o.id);
        await registrarEstado(o.id, "ejecutada", "en_sitio", req, `Se agregaron ${nuevos.length} habitación(es)`);
      } else {
        await registrarEstado(o.id, o.estado, o.estado, req, `Se agregaron ${nuevos.length} habitación(es)`);
      }
    }
    res.json({ agregados: nuevos.length, repetidos: validos.length - nuevos.length });
  } catch (e) {
    error500(res, e);
  }
});

// POST /solicitudes/:id/mensajes — { texto }
router.post("/:id/mensajes", async (req, res) => {
  const texto = String(req.body?.texto || "").trim();
  if (!texto) return res.status(400).json({ error: true, mensaje: "Escribe el mensaje." });
  if (texto.length > 2000) return res.status(400).json({ error: true, mensaje: "El mensaje es demasiado largo." });
  const o = await ordenVisible(req, res, req.params.id, "id, sitio_id");
  if (!o) return;
  const { data, error } = await supabase
    .from("asa_orden_mensajes")
    .insert([{ orden_id: o.id, usuario_id: req.usuario?.id || null, autor_nombre: req.usuario?.nombre || null, autor_rol: req.usuario?.rol || null, texto }])
    .select()
    .single();
  if (error) return error500(res, error);
  // Un mensaje del hotel vuelve a marcar la solicitud como "nueva" para la oficina.
  if (esExterno(req)) await supabase.from("asa_ordenes_trabajo").update({ visto_admin_at: null }).eq("id", o.id);
  res.status(201).json(data);
});

// POST /solicitudes/:id/recibida — el técnico (o la oficina) confirma que la vio
router.post("/:id/recibida", async (req, res) => {
  if (esExterno(req)) return res.status(403).json({ error: true, mensaje: "Sin acceso" });
  const o = await ordenVisible(req, res, req.params.id);
  if (!o) return;
  const cambios = {
    recibido_tecnico_at: o.recibido_tecnico_at || new Date().toISOString(),
    recibido_tecnico_nombre: o.recibido_tecnico_nombre || req.usuario?.nombre || null,
    updated_at: new Date().toISOString(),
  };
  if (esTecnico(req) && !o.tecnico_id && req.usuario?.empleado_id) cambios.tecnico_id = req.usuario.empleado_id;
  if (o.estado === "solicitada") cambios.estado = "agendada";
  const { data, error } = await supabase.from("asa_ordenes_trabajo").update(cambios).eq("id", o.id).select().single();
  if (error) return error500(res, error);
  if (cambios.estado) await registrarEstado(o.id, o.estado, "agendada", req, `Recibida por ${req.usuario?.nombre || "ASA"}`);
  res.json(data);
});

// PATCH /solicitudes/:id — la oficina asigna técnico, fecha, prioridad o estado
router.patch("/:id", requireRol("operaciones", "comercial"), async (req, res) => {
  const o = await ordenVisible(req, res, req.params.id);
  if (!o) return;
  const { tecnico_id, fecha_agendada, prioridad, estado, motivo } = req.body || {};
  const cambios = { updated_at: new Date().toISOString() };
  if (tecnico_id !== undefined) cambios.tecnico_id = tecnico_id || null;
  if (fecha_agendada !== undefined) cambios.fecha_agendada = fecha_agendada || null;
  if (prioridad) cambios.prioridad = prioridad;
  if (estado) {
    if (!["solicitada", "agendada", "en_ruta", "en_sitio", "ejecutada", "cerrada", "cancelada"].includes(estado)) {
      return res.status(400).json({ error: true, mensaje: "Estado no válido" });
    }
    cambios.estado = estado;
    if (estado === "ejecutada" && !o.fecha_ejecucion) cambios.fecha_ejecucion = new Date().toISOString();
  } else if (cambios.tecnico_id && o.estado === "solicitada") {
    cambios.estado = "agendada";
  }
  const { data, error } = await supabase.from("asa_ordenes_trabajo").update(cambios).eq("id", o.id).select().single();
  if (error) return error500(res, error);
  if (cambios.estado && cambios.estado !== o.estado) {
    await registrarEstado(o.id, o.estado, cambios.estado, req, motivo || (cambios.tecnico_id ? "Técnico asignado" : "Cambio desde el panel"));
  }
  logAccion(req, { accion: "actualizar", modulo: "solicitudes", registroId: o.id, descripcion: JSON.stringify(req.body || {}) });
  res.json(data);
});

// POST /solicitudes/:id/cancelar — { motivo } — el hotel puede cancelar la suya
router.post("/:id/cancelar", async (req, res) => {
  const o = await ordenVisible(req, res, req.params.id);
  if (!o) return;
  if (!ABIERTAS.includes(o.estado)) return res.status(409).json({ error: true, mensaje: "La solicitud ya no está abierta." });
  const motivo = String(req.body?.motivo || "").trim() || "Cancelada por el usuario";
  const { data, error } = await supabase
    .from("asa_ordenes_trabajo")
    .update({ estado: "cancelada", updated_at: new Date().toISOString() })
    .eq("id", o.id)
    .select()
    .single();
  if (error) return error500(res, error);
  await supabase.from("asa_orden_puntos").update({ estado: "cancelado" }).eq("orden_id", o.id).eq("estado", "pendiente");
  await registrarEstado(o.id, o.estado, "cancelada", req, motivo);
  res.json(data);
});

export default router;
