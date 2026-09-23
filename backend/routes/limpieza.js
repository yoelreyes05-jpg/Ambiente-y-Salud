// ═════════════════════════════════════════════════════════════════════════════
// routes/limpieza.js — Borrar datos de prueba (SOLO ADMINISTRADOR)
//
// Para arrancar el sistema limpio: el admin escoge qué tipo de registro quiere
// revisar, marca uno por uno (o "todos los visibles") y los borra. Nada se
// borra solo ni por tipo completo: únicamente los ids que llegan marcados, y
// solo si viene escrita la palabra BORRAR.
//
//   GET  /limpieza/tipos                 → catálogo con cuántos hay de cada uno
//   GET  /limpieza/:tipo?desde&hasta&sitio_id&buscar
//   POST /limpieza/:tipo/borrar          { ids: [...], confirmacion: "BORRAR" }
//
// Se borra de verdad (no se desactiva). También se limpian los archivos de
// Storage que cuelgan de esos registros (fotos de inspecciones, fotos del
// chequeo del vehículo, archivos de documentos).
// ═════════════════════════════════════════════════════════════════════════════
import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { logAccion } from "../lib/auditoria.js";
import { requireRol } from "../middleware/auth.js";

const router = express.Router();
router.use(requireRol());   // sin roles en la lista: solo pasa el admin

const fallo = (res, st, mensaje) => res.status(st).json({ error: true, mensaje });
const envolver = (h) => (req, res, next) => Promise.resolve(h(req, res, next)).catch(next);
const trozos = (arr, n = 100) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

// Saca la ruta dentro del bucket de una URL pública de Supabase Storage.
function rutaDeUrl(url, bucket) {
  if (typeof url !== "string") return null;
  const marca = `/object/public/${bucket}/`;
  const i = url.indexOf(marca);
  return i >= 0 ? decodeURIComponent(url.slice(i + marca.length).split("?")[0]) : null;
}
async function borrarArchivos(bucket, rutas) {
  const limpias = [...new Set(rutas.filter(Boolean))];
  for (const t of trozos(limpias, 100)) {
    await supabase.storage.from(bucket).remove(t).catch(() => {});
  }
  return limpias.length;
}

const nombreSitio = (r) => r.asa_sitios?.nombre || "";
const vehiculoTxt = (v) => v ? `${v.codigo || ""} · ${v.placa || ""}` : "";

// ── Catálogo de lo que se puede borrar ─────────────────────────────────────
// grupo: "movimientos" (lo que se genera trabajando) o "maestros" (la base).
// aviso: lo que se va con él, para que el admin lo lea antes de confirmar.
const TIPOS = {
  inspecciones: {
    grupo: "movimientos", nombre: "Inspecciones de puntos", tabla: "asa_inspecciones",
    select: "id, fecha, estado_punto, nivel_actividad, fotos, sitio_id, asa_puntos_control(codigo_visible, nombre), asa_sitios(nombre)",
    fecha: "fecha", sitio: "sitio_id", buscar: null,
    fila: (r) => ({ fecha: r.fecha, titulo: `Punto ${r.asa_puntos_control?.codigo_visible || "?"}${r.asa_puntos_control?.nombre ? " — " + r.asa_puntos_control.nombre : ""}`,
      detalle: [nombreSitio(r), r.estado_punto, r.nivel_actividad !== "ninguna" ? `actividad ${r.nivel_actividad}` : ""].filter(Boolean).join(" · ") }),
    aviso: "Se borran también sus respuestas del checklist, conteos de plagas y fotos. El punto vuelve a quedar pendiente.",
    antes: async (ids) => {
      const rutas = [];
      for (const t of trozos(ids)) {
        const { data } = await supabase.from("asa_inspecciones").select("fotos").in("id", t);
        for (const r of data || []) for (const f of r.fotos || []) rutas.push(rutaDeUrl(f, "asa-evidencias"));
        const { data: resp } = await supabase.from("asa_inspeccion_respuestas").select("fotos").in("inspeccion_id", t);
        for (const r of resp || []) for (const f of r.fotos || []) rutas.push(rutaDeUrl(f, "asa-evidencias"));
      }
      return () => borrarArchivos("asa-evidencias", rutas);
    },
  },
  hallazgos: {
    grupo: "movimientos", nombre: "Hallazgos", tabla: "asa_hallazgos",
    select: "id, titulo, severidad, estado, fecha_reporte, fotos, asa_sitios(nombre)",
    fecha: "fecha_reporte", sitio: "sitio_id", buscar: "titulo",
    fila: (r) => ({ fecha: r.fecha_reporte, titulo: r.titulo, detalle: [nombreSitio(r), r.severidad, r.estado].join(" · ") }),
    aviso: "Se borra el hallazgo y sus fotos.",
    antes: async (ids) => {
      const rutas = [];
      for (const t of trozos(ids)) {
        const { data } = await supabase.from("asa_hallazgos").select("fotos").in("id", t);
        for (const r of data || []) for (const f of r.fotos || []) rutas.push(rutaDeUrl(f, "asa-evidencias"));
      }
      return () => borrarArchivos("asa-evidencias", rutas);
    },
  },
  solicitudes: {
    grupo: "movimientos", nombre: "Solicitudes / órdenes de trabajo", tabla: "asa_ordenes_trabajo",
    select: "id, numero_orden, tipo_solicitud, estado, tipo_plaga_reportada, fecha_solicitud, asa_sitios(nombre)",
    fecha: "fecha_solicitud", sitio: "sitio_id", buscar: "numero_orden",
    fila: (r) => ({ fecha: r.fecha_solicitud, titulo: `${r.numero_orden || "Sin número"} · ${r.tipo_solicitud || ""}`,
      detalle: [nombreSitio(r), r.estado, r.tipo_plaga_reportada].filter(Boolean).join(" · ") }),
    aviso: "Se borran su lista de habitaciones y sus mensajes. Las inspecciones que se hicieron por ella NO se borran (quedan sueltas).",
  },
  chequeos: {
    grupo: "movimientos", nombre: "Chequeos de vehículos", tabla: "asa_flota_chequeos",
    select: "id, fecha, turno, km, conductor_nombre, vehiculo_id, asa_flota_vehiculos(codigo, placa)",
    fecha: "fecha", sitio: null, buscar: "conductor_nombre",
    fila: (r) => ({ fecha: r.fecha + "T12:00:00", titulo: `${vehiculoTxt(r.asa_flota_vehiculos)} · ${r.turno}`,
      detalle: [r.conductor_nombre, r.km != null ? `${r.km} km` : ""].filter(Boolean).join(" · ") }),
    aviso: "Se borran sus fotos y su checklist. El kilometraje del vehículo se recalcula con los chequeos que queden.",
    antes: async (ids) => {
      const rutas = []; const vehiculos = new Set();
      for (const t of trozos(ids)) {
        const { data } = await supabase.from("asa_flota_fotos").select("ruta, url").in("chequeo_id", t);
        for (const f of data || []) rutas.push(f.ruta || rutaDeUrl(f.url, "asa-flota-fotos"));
        const { data: ch } = await supabase.from("asa_flota_chequeos").select("vehiculo_id").in("id", t);
        for (const c of ch || []) vehiculos.add(c.vehiculo_id);
      }
      return async () => {
        await borrarArchivos("asa-flota-fotos", rutas);
        await recalcularKm([...vehiculos]);
      };
    },
  },
  fallas: {
    grupo: "movimientos", nombre: "Fallas reportadas de vehículos", tabla: "asa_flota_fallas_reportadas",
    select: "id, falla_etiqueta, estado, ultima_vez, conductor_nombre, asa_flota_vehiculos(codigo, placa)",
    fecha: "ultima_vez", sitio: null, buscar: "falla_etiqueta",
    fila: (r) => ({ fecha: r.ultima_vez, titulo: `${vehiculoTxt(r.asa_flota_vehiculos)} · ${r.falla_etiqueta || ""}`,
      detalle: [r.estado, r.conductor_nombre].filter(Boolean).join(" · ") }),
  },
  gastos: {
    grupo: "movimientos", nombre: "Gastos de flota", tabla: "asa_flota_gastos",
    select: "id, fecha, tipo, monto, descripcion, asa_flota_vehiculos(codigo, placa)",
    fecha: "fecha", sitio: null, buscar: "descripcion",
    fila: (r) => ({ fecha: r.fecha + "T12:00:00", titulo: `${vehiculoTxt(r.asa_flota_vehiculos)} · ${r.tipo} RD$ ${Number(r.monto || 0).toLocaleString("es-DO")}`,
      detalle: r.descripcion || "" }),
  },
  qr_no_reconocidos: {
    grupo: "movimientos", nombre: "QR escaneados sin asignar", tabla: "asa_qr_no_reconocidos", pk: "token",
    select: "token, veces, ultimo_escaneo, ultimo_usuario_nombre, asa_sitios(nombre)",
    fecha: "ultimo_escaneo", sitio: "sitio_id", buscar: "token",
    fila: (r) => ({ fecha: r.ultimo_escaneo, titulo: r.token, detalle: [nombreSitio(r), `${r.veces} escaneo(s)`, r.ultimo_usuario_nombre].filter(Boolean).join(" · ") }),
  },
  documentos: {
    grupo: "movimientos", nombre: "Documentos subidos (licencias, fichas…)", tabla: "asa_documentos",
    select: "id, titulo, categoria, created_at, archivo_nombre, activo",
    fecha: "created_at", sitio: null, buscar: "titulo",
    fila: (r) => ({ fecha: r.created_at, titulo: r.titulo, detalle: [r.categoria, r.archivo_nombre, r.activo ? "" : "retirado"].filter(Boolean).join(" · ") }),
    aviso: "Se borra el documento y su archivo.",
    antes: async (ids) => {
      const rutas = [];
      for (const t of trozos(ids)) {
        const { data } = await supabase.from("asa_documentos").select("archivo_ruta").in("id", t);
        for (const d of data || []) rutas.push(d.archivo_ruta);
      }
      return () => borrarArchivos("asa-documentos", rutas);
    },
  },
  productos: {
    grupo: "movimientos", nombre: "Productos (catálogo de plaguicidas)", tabla: "asa_plaguicidas_catalogo",
    select: "id, nombre_comercial, principio_activo, created_at",
    fecha: "created_at", sitio: null, buscar: "nombre_comercial",
    fila: (r) => ({ fecha: r.created_at, titulo: r.nombre_comercial, detalle: r.principio_activo || "" }),
    aviso: "Sus fichas y hojas de seguridad quedan como documentos sueltos (bórralas en Documentos subidos si también eran de prueba).",
  },
  auditoria: {
    grupo: "movimientos", nombre: "Bitácora de auditoría", tabla: "asa_log_auditoria",
    select: "id, created_at, usuario_nombre, accion, modulo, descripcion",
    fecha: "created_at", sitio: null, buscar: "descripcion",
    fila: (r) => ({ fecha: r.created_at, titulo: `${r.modulo} · ${r.accion}`, detalle: [r.usuario_nombre, r.descripcion].filter(Boolean).join(" · ") }),
  },

  // ── Datos base: se borran con todo lo que cuelga de ellos ──────────────
  clientes: {
    grupo: "maestros", nombre: "Clientes", tabla: "asa_clientes",
    select: "id, nombre_contacto, razon_social, rnc_cedula, created_at",
    fecha: "created_at", sitio: null, buscar: "nombre_contacto",
    fila: (r) => ({ fecha: r.created_at, titulo: r.razon_social || r.nombre_contacto, detalle: [r.nombre_contacto, r.rnc_cedula].filter(Boolean).join(" · ") }),
    aviso: "⚠ Borra TAMBIÉN sus plantas, áreas, puntos de control, inspecciones, solicitudes, hallazgos, estrategias y documentos propios. Úsalo solo con clientes inventados.",
  },
  plantas: {
    grupo: "maestros", nombre: "Plantas (hoteles)", tabla: "asa_sitios",
    select: "id, nombre, created_at, asa_clientes(razon_social, nombre_contacto)",
    fecha: "created_at", sitio: "id", buscar: "nombre",
    fila: (r) => ({ fecha: r.created_at, titulo: r.nombre, detalle: r.asa_clientes?.razon_social || r.asa_clientes?.nombre_contacto || "" }),
    aviso: "⚠ Borra TAMBIÉN sus áreas, planos, puntos de control, inspecciones, solicitudes y hallazgos.",
  },
  puntos: {
    grupo: "maestros", nombre: "Puntos de control", tabla: "asa_puntos_control",
    select: "id, codigo_visible, nombre, qr_token, created_at, asa_sitios(nombre)",
    fecha: "created_at", sitio: "sitio_id", buscar: "codigo_visible",
    fila: (r) => ({ fecha: r.created_at, titulo: `${r.codigo_visible}${r.nombre ? " — " + r.nombre : ""}`, detalle: [nombreSitio(r), `QR ${r.qr_token}`].join(" · ") }),
    aviso: "⚠ Borra TAMBIÉN sus inspecciones y sus etiquetas QR adicionales. Si la etiqueta está pegada en el hotel, dejará de abrir el punto.",
  },
  vehiculos: {
    grupo: "maestros", nombre: "Vehículos", tabla: "asa_flota_vehiculos",
    select: "id, codigo, placa, marca, modelo, created_at",
    fecha: "created_at", sitio: null, buscar: "placa",
    fila: (r) => ({ fecha: r.created_at, titulo: vehiculoTxt(r), detalle: [r.marca, r.modelo].filter(Boolean).join(" ") }),
    aviso: "⚠ Borra TAMBIÉN sus chequeos, fotos, fallas, gastos, documentos y mantenimientos.",
  },
  conductores: {
    grupo: "maestros", nombre: "Conductores", tabla: "asa_flota_conductores",
    select: "id, nombre, created_at",
    fecha: "created_at", sitio: null, buscar: "nombre",
    fila: (r) => ({ fecha: r.created_at, titulo: r.nombre, detalle: "" }),
    aviso: "Sus chequeos se conservan con el nombre escrito; se quita la asignación a vehículos.",
  },
  usuarios: {
    grupo: "maestros", nombre: "Usuarios (cuentas de acceso)", tabla: "asa_usuarios",
    select: "id, nombre_completo, email, rol, created_at",
    fecha: "created_at", sitio: null, buscar: "email",
    fila: (r) => ({ fecha: r.created_at, titulo: r.nombre_completo, detalle: `${r.email} · ${r.rol}` }),
    aviso: "La cuenta deja de poder entrar. Sus registros se conservan sin el enlace al usuario.",
  },
};

// Tras borrar chequeos de prueba, el odómetro del vehículo no puede quedarse
// con un número inventado: vuelve al mayor de los chequeos que quedan, o al
// kilometraje con que entró a la flota.
async function recalcularKm(vehiculoIds) {
  for (const id of vehiculoIds) {
    const [{ data: ult }, { data: v }] = await Promise.all([
      supabase.from("asa_flota_chequeos").select("km, created_at").eq("vehiculo_id", id).not("km", "is", null)
        .order("km", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("asa_flota_vehiculos").select("km_inicial").eq("id", id).maybeSingle(),
    ]);
    if (!v) continue;
    await supabase.from("asa_flota_vehiculos").update({
      km_actual: ult?.km ?? v.km_inicial ?? 0,
      km_actualizado: ult?.created_at ?? null,
    }).eq("id", id);
  }
}

// ── GET /limpieza/tipos ────────────────────────────────────────────────────
router.get("/tipos", envolver(async (req, res) => {
  const lista = await Promise.all(Object.entries(TIPOS).map(async ([clave, t]) => {
    const { count, error } = await supabase.from(t.tabla).select(t.pk || "id", { count: "exact", head: true });
    return { clave, nombre: t.nombre, grupo: t.grupo, aviso: t.aviso || null, filtra_planta: !!t.sitio,
             total: error ? null : count ?? 0, error: error ? error.message : null };
  }));
  res.json(lista);
}));

// ── GET /limpieza/:tipo ─────────────────────────────────────────────────────
router.get("/:tipo", envolver(async (req, res) => {
  const t = TIPOS[req.params.tipo];
  if (!t) return fallo(res, 404, "Tipo de registro desconocido.");
  const pk = t.pk || "id";
  let q = supabase.from(t.tabla).select(t.select).order(t.fecha, { ascending: false }).limit(1000);
  if (req.query.desde) q = q.gte(t.fecha, req.query.desde);
  if (req.query.hasta) q = q.lte(t.fecha, `${req.query.hasta}T23:59:59`);
  if (req.query.sitio_id && t.sitio) q = q.eq(t.sitio, req.query.sitio_id);
  if (req.query.buscar && t.buscar) q = q.ilike(t.buscar, `%${req.query.buscar}%`);
  const { data, error } = await q;
  if (error) return fallo(res, 500, error.message);
  res.json({
    tipo: req.params.tipo, nombre: t.nombre, aviso: t.aviso || null, limite: 1000,
    filas: (data || []).map((r) => ({ id: r[pk], ...t.fila(r) })),
  });
}));

// ── POST /limpieza/:tipo/borrar ─────────────────────────────────────────────
router.post("/:tipo/borrar", envolver(async (req, res) => {
  const t = TIPOS[req.params.tipo];
  if (!t) return fallo(res, 404, "Tipo de registro desconocido.");
  const { ids, confirmacion } = req.body || {};
  if (String(confirmacion || "").trim().toUpperCase() !== "BORRAR") {
    return fallo(res, 400, 'Para borrar hay que escribir la palabra BORRAR.');
  }
  if (!Array.isArray(ids) || !ids.length) return fallo(res, 400, "No marcaste ningún registro.");
  if (ids.length > 1000) return fallo(res, 400, "Máximo 1000 registros por vez.");
  const pk = t.pk || "id";
  let lista = [...new Set(ids.map(String))];

  // Candados de usuarios: nadie se borra a sí mismo ni deja el sistema sin admin.
  if (req.params.tipo === "usuarios") {
    if (lista.includes(String(req.usuario.id))) return fallo(res, 400, "No puedes borrar tu propia cuenta.");
    const { data: admins } = await supabase.from("asa_usuarios").select("id").eq("rol", "admin").eq("activo", true);
    const quedan = (admins || []).filter((a) => !lista.includes(String(a.id)));
    if (!quedan.length) return fallo(res, 400, "Debe quedar al menos un administrador activo.");
  }

  const despues = t.antes ? await t.antes(lista) : null;

  let borrados = 0;
  const errores = [];
  for (const trozo of trozos(lista)) {
    const { data, error } = await supabase.from(t.tabla).delete().in(pk, trozo).select(pk);
    if (error) {
      errores.push(/foreign key|violates/i.test(error.message)
        ? "Algunos no se pudieron borrar porque otros registros los usan (por ejemplo, un producto aplicado en una orden). Borra primero esos registros."
        : error.message);
    } else {
      borrados += (data || []).length;
    }
  }
  if (despues && borrados) await despues().catch((e) => console.warn("[limpieza] después:", e.message));

  logAccion(req, {
    accion: "eliminar", modulo: "limpieza",
    descripcion: `Borró ${borrados} de ${lista.length} registro(s) de "${t.nombre}"`,
    detalle: { tipo: req.params.tipo, ids: lista.slice(0, 200) },
  });

  if (!borrados && errores.length) return fallo(res, 400, errores[0]);
  res.json({ ok: true, borrados, pedidos: lista.length, errores: [...new Set(errores)] });
}));

export default router;
