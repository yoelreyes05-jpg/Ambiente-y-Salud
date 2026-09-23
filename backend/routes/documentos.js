// ═════════════════════════════════════════════════════════════════════════════
// routes/documentos.js — Documentos regulatorios y productos que usa ASA
//
// Lo que el hotel pide en cada auditoría: fichas técnicas y hojas de seguridad
// de cada producto, el listado de productos, manual de operaciones, protocolo
// de trabajo, licencia ambiental, licencia sanitaria, no objeción de Salud
// Pública, registro de Agricultura y regencia.
//
//   Oficina (admin / operaciones / comercial): sube, edita y retira.
//   Hotel (cliente_calidad / cliente): solo ve lo marcado "visible al cliente"
//   que es general (cliente_id null) o de SU cliente.
//
// Los archivos viven en el bucket PRIVADO "asa-documentos". Nadie recibe la
// ruta: GET /documentos/:id/archivo entrega un enlace firmado de 1 hora.
//
// Tablas: asa_documentos, asa_plaguicidas_catalogo (32_documentos_regulatorios.sql)
// ═════════════════════════════════════════════════════════════════════════════
import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { logAccion } from "../lib/auditoria.js";
import { requireRol, ROLES_EXTERNOS } from "../middleware/auth.js";

const router = express.Router();

// Express 4 no atrapa errores de funciones async: una excepción tumbaba el
// servidor entero. Se envuelve cada handler para que responda 500 y siga vivo.
for (const metodo of ["get", "post", "put", "patch", "delete"]) {
  const original = router[metodo].bind(router);
  router[metodo] = (ruta, ...handlers) =>
    original(ruta, ...handlers.map((h) => (req, res, next) => {
      try {
        const r = h(req, res, next);
        if (r && typeof r.catch === "function") r.catch(next);
      } catch (e) { next(e); }
    }));
}
const BUCKET = "asa-documentos";
const MAX_BYTES = 15 * 1024 * 1024;
const ESCRIBEN = requireRol("operaciones", "comercial");   // admin pasa siempre

export const CATEGORIAS = {
  ficha_tecnica:        "Ficha técnica",
  hoja_seguridad:       "Hoja de seguridad (SDS)",
  listado_productos:    "Listado de productos",
  manual_operaciones:   "Manual de operaciones",
  protocolo_trabajo:    "Protocolo de trabajo",
  licencia_ambiental:   "Licencia ambiental",
  licencia_sanitaria:   "Licencia sanitaria",
  no_objecion_salud:    "No objeción de Salud Pública",
  registro_agricultura: "Registro de Agricultura",
  regencia:             "Regencia",
  otro:                 "Otro documento",
};

const MIME_OK = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

const fallo = (res, st, mensaje) => res.status(st).json({ error: true, mensaje });
const esExterno = (req) => ROLES_EXTERNOS.includes(req.usuario?.rol);
const hoyRD = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });

// vigente | por_vencer (≤30 días) | vencido | sin_vencimiento
function estadoVigencia(fechaVenc) {
  if (!fechaVenc) return "sin_vencimiento";
  const hoy = new Date(hoyRD());
  const vence = new Date(fechaVenc);
  const dias = Math.round((vence - hoy) / 86400000);
  if (dias < 0) return "vencido";
  if (dias <= 30) return "por_vencer";
  return "vigente";
}

// Clientes que puede ver una cuenta externa. El personal del hotel está atado
// a plantas (req.sitiosPermitidos); los documentos se atan a clientes.
async function clientesDelUsuario(req) {
  if (!esExterno(req)) return null;
  if (req.usuario.rol === "cliente" && req.usuario.cliente_id) return [req.usuario.cliente_id];
  const sitios = req.sitiosPermitidos || [];
  if (!sitios.length) return [];
  const { data } = await supabase.from("asa_sitios").select("cliente_id").in("id", sitios);
  return [...new Set((data || []).map((s) => s.cliente_id).filter(Boolean))];
}

let bucketListo = false;
async function asegurarBucket() {
  if (bucketListo) return;
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await supabase.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: 20 * 1024 * 1024,
    });
    if (error && !/exist/i.test(error.message)) throw new Error(`Storage: ${error.message}`);
  }
  bucketListo = true;
}

// archivo = { nombre, dataUrl }  →  { archivo_ruta, archivo_nombre, archivo_tipo, archivo_bytes }
async function subirArchivo(archivo, categoria) {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(archivo?.dataUrl || "");
  if (!m) throw new Error("El archivo no llegó bien. Vuelve a escogerlo.");
  let mime = (m[1] || "").toLowerCase();
  const nombre = String(archivo.nombre || "documento").slice(0, 180);
  // Algunos teléfonos mandan el PDF sin tipo: se deduce por la extensión.
  if (!MIME_OK[mime]) {
    const ext = nombre.split(".").pop().toLowerCase();
    const porExt = Object.entries(MIME_OK).find(([, e]) => e === ext);
    if (porExt) mime = porExt[0];
  }
  const ext = MIME_OK[mime];
  if (!ext) throw new Error("Tipo de archivo no permitido. Sube PDF, imagen (JPG/PNG), Word o Excel.");

  const buffer = Buffer.from(m[3], "base64");
  if (!buffer.length) throw new Error("El archivo está vacío.");
  if (buffer.length > MAX_BYTES) throw new Error("El archivo pesa más de 15 MB. Comprímelo o divídelo.");

  await asegurarBucket();
  const limpio = nombre.replace(/\.[^.]+$/, "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "documento";
  const ruta = `${categoria}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${limpio}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(ruta, buffer, { contentType: mime, upsert: false });
  if (error) throw new Error(`No se pudo guardar el archivo: ${error.message}`);
  return { archivo_ruta: ruta, archivo_nombre: nombre, archivo_tipo: mime, archivo_bytes: buffer.length };
}

// Lo que se deja escribir desde el panel (nada de ids ni rutas de archivo).
function camposDocumento(b = {}) {
  const out = {};
  for (const k of ["titulo", "descripcion", "numero", "emitido_por", "version"]) {
    if (k in b) out[k] = b[k] === "" || b[k] == null ? null : String(b[k]).trim();
  }
  for (const k of ["fecha_emision", "fecha_vencimiento"]) {
    if (k in b) out[k] = b[k] || null;
  }
  for (const k of ["producto_id", "cliente_id"]) {
    if (k in b) out[k] = b[k] || null;
  }
  if ("categoria" in b) out.categoria = b.categoria;
  if ("visible_cliente" in b) out.visible_cliente = !!b.visible_cliente;
  return out;
}

const SELECT_DOC = `id, categoria, titulo, descripcion, producto_id, cliente_id, numero, emitido_por,
  fecha_emision, fecha_vencimiento, version, archivo_nombre, archivo_tipo, archivo_bytes,
  visible_cliente, created_at, updated_at,
  asa_plaguicidas_catalogo ( nombre_comercial ),
  asa_clientes ( razon_social, nombre_contacto )`;

function darForma(d, externo) {
  const out = {
    ...d,
    categoria_texto: CATEGORIAS[d.categoria] || d.categoria,
    producto_nombre: d.asa_plaguicidas_catalogo?.nombre_comercial || null,
    cliente_nombre: d.asa_clientes ? (d.asa_clientes.razon_social || d.asa_clientes.nombre_contacto) : null,
    vigencia: estadoVigencia(d.fecha_vencimiento),
    tiene_archivo: !!d.archivo_nombre,
  };
  delete out.asa_plaguicidas_catalogo;
  delete out.asa_clientes;
  if (externo) { delete out.cliente_id; delete out.visible_cliente; }
  return out;
}

// Consulta base de documentos con el alcance del usuario aplicado.
//
// OJO: devuelve { q } y no el constructor directo. El constructor de Supabase
// es "thenable": si una función async lo devuelve tal cual, el `await` del que
// llama lo EJECUTA y entrega { data, error } en vez del constructor, y luego
// q.order / q.eq revientan con "is not a function".
async function consultaDocumentos(req) {
  let q = supabase.from("asa_documentos").select(SELECT_DOC).eq("activo", true);
  if (esExterno(req)) {
    const clientes = await clientesDelUsuario(req);
    q = q.eq("visible_cliente", true);
    q = clientes.length
      ? q.or(`cliente_id.is.null,cliente_id.in.(${clientes.join(",")})`)
      : q.is("cliente_id", null);
  }
  return { q };
}

// ── Catálogo de categorías (para los selects) ───────────────────────────────
router.get("/categorias", (req, res) => {
  res.json(Object.entries(CATEGORIAS).map(([codigo, nombre]) => ({ codigo, nombre })));
});

// ── Productos ───────────────────────────────────────────────────────────────
// GET /documentos/productos — cada producto con sus documentos colgados.
router.get("/productos", async (req, res) => {
  const externo = esExterno(req);
  let q = supabase.from("asa_plaguicidas_catalogo")
    .select("id, nombre_comercial, principio_activo, fabricante, categoria_toxicologica, registro_sanitario, registro_agricultura, uso, presentacion, visible_cliente, notas, activo")
    .order("nombre_comercial");
  if (externo) q = q.eq("activo", true).eq("visible_cliente", true);
  else if (req.query.todos !== "1") q = q.eq("activo", true);
  const { data: productos, error } = await q;
  if (error) return fallo(res, 500, error.message);

  let { q: dq } = await consultaDocumentos(req);
  dq = dq.not("producto_id", "is", null);
  const { data: docs, error: e2 } = await dq;
  if (e2) return fallo(res, 500, e2.message);

  const porProducto = {};
  for (const d of docs || []) (porProducto[d.producto_id] = porProducto[d.producto_id] || []).push(darForma(d, externo));

  res.json((productos || []).map((p) => {
    const out = { ...p, documentos: porProducto[p.id] || [] };
    if (externo) { delete out.visible_cliente; delete out.notas; delete out.activo; }
    return out;
  }));
});

router.post("/productos", ESCRIBEN, async (req, res) => {
  const b = req.body || {};
  if (!String(b.nombre_comercial || "").trim()) return fallo(res, 400, "Falta el nombre comercial.");
  const fila = productoDesdeCuerpo(b);
  const { data, error } = await supabase.from("asa_plaguicidas_catalogo").insert([fila]).select().single();
  if (error) return fallo(res, 500, error.message);
  logAccion(req, { accion: "crear", modulo: "documentos", registroId: data.id, descripcion: `Producto ${data.nombre_comercial}` });
  res.status(201).json(data);
});

router.put("/productos/:id", ESCRIBEN, async (req, res) => {
  const fila = { ...productoDesdeCuerpo(req.body || {}), updated_at: new Date().toISOString() };
  if ("activo" in (req.body || {})) fila.activo = !!req.body.activo;
  const { data, error } = await supabase.from("asa_plaguicidas_catalogo").update(fila).eq("id", req.params.id).select().single();
  if (error) return fallo(res, 500, error.message);
  logAccion(req, { accion: "actualizar", modulo: "documentos", registroId: data.id, descripcion: `Producto ${data.nombre_comercial}` });
  res.json(data);
});

function productoDesdeCuerpo(b) {
  const out = {};
  for (const k of ["nombre_comercial", "principio_activo", "fabricante", "categoria_toxicologica",
                   "registro_sanitario", "registro_agricultura", "uso", "presentacion", "notas"]) {
    if (k in b) out[k] = b[k] === "" || b[k] == null ? null : String(b[k]).trim();
  }
  if ("visible_cliente" in b) out.visible_cliente = !!b.visible_cliente;
  return out;
}

// ── Documentos ──────────────────────────────────────────────────────────────
// GET /documentos?categoria=&producto_id=
router.get("/", async (req, res) => {
  let { q } = await consultaDocumentos(req);
  if (req.query.categoria) q = q.eq("categoria", req.query.categoria);
  if (req.query.producto_id) q = q.eq("producto_id", req.query.producto_id);
  const { data, error } = await q.order("categoria").order("titulo");
  if (error) return fallo(res, 500, error.message);
  res.json((data || []).map((d) => darForma(d, esExterno(req))));
});

// GET /documentos/:id/archivo — enlace firmado de 1 hora para ver o descargar.
router.get("/:id/archivo", async (req, res) => {
  let { q } = await consultaDocumentos(req);
  const { data: doc, error } = await q.eq("id", req.params.id).maybeSingle();
  if (error) return fallo(res, 500, error.message);
  if (!doc) return fallo(res, 404, "Documento no encontrado.");

  const { data: fila } = await supabase.from("asa_documentos").select("archivo_ruta, archivo_nombre").eq("id", doc.id).single();
  if (!fila?.archivo_ruta) return fallo(res, 404, "Este documento todavía no tiene archivo adjunto.");

  const descargar = req.query.descargar === "1" ? (fila.archivo_nombre || true) : undefined;
  const { data, error: e2 } = await supabase.storage.from(BUCKET)
    .createSignedUrl(fila.archivo_ruta, 3600, descargar ? { download: descargar } : undefined);
  if (e2) return fallo(res, 500, `No se pudo abrir el archivo: ${e2.message}`);
  res.json({ url: data.signedUrl, nombre: fila.archivo_nombre, tipo: doc.archivo_tipo });
});

// POST /documentos — { titulo, categoria, ..., archivo: { nombre, dataUrl } }
router.post("/", ESCRIBEN, async (req, res) => {
  const b = req.body || {};
  const fila = camposDocumento(b);
  if (!fila.titulo) return fallo(res, 400, "Falta el título del documento.");
  if (!CATEGORIAS[fila.categoria]) return fallo(res, 400, "Categoría no válida.");
  if (!b.archivo?.dataUrl) return fallo(res, 400, "Falta adjuntar el archivo.");
  try {
    Object.assign(fila, await subirArchivo(b.archivo, fila.categoria));
  } catch (e) {
    return fallo(res, 400, e.message);
  }
  fila.creado_por = req.usuario?.nombre || req.usuario?.email || null;
  const { data, error } = await supabase.from("asa_documentos").insert([fila]).select(SELECT_DOC).single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([fila.archivo_ruta]).catch(() => {});
    return fallo(res, 500, error.message);
  }
  logAccion(req, { accion: "crear", modulo: "documentos", registroId: data.id, descripcion: `${CATEGORIAS[data.categoria]} · ${data.titulo}` });
  res.status(201).json(darForma(data, false));
});

// PUT /documentos/:id — datos y, si viene `archivo`, reemplaza el adjunto.
router.put("/:id", ESCRIBEN, async (req, res) => {
  const b = req.body || {};
  const { data: previo } = await supabase.from("asa_documentos").select("id, categoria, archivo_ruta").eq("id", req.params.id).maybeSingle();
  if (!previo) return fallo(res, 404, "Documento no encontrado.");

  const fila = camposDocumento(b);
  if ("categoria" in fila && !CATEGORIAS[fila.categoria]) return fallo(res, 400, "Categoría no válida.");
  if ("titulo" in fila && !fila.titulo) return fallo(res, 400, "El título no puede quedar vacío.");
  if (b.archivo?.dataUrl) {
    try {
      Object.assign(fila, await subirArchivo(b.archivo, fila.categoria || previo.categoria));
    } catch (e) {
      return fallo(res, 400, e.message);
    }
  }
  fila.updated_at = new Date().toISOString();

  const { data, error } = await supabase.from("asa_documentos").update(fila).eq("id", previo.id).select(SELECT_DOC).single();
  if (error) return fallo(res, 500, error.message);
  // El archivo viejo se borra solo cuando el nuevo ya quedó guardado.
  if (fila.archivo_ruta && previo.archivo_ruta) {
    await supabase.storage.from(BUCKET).remove([previo.archivo_ruta]).catch(() => {});
  }
  logAccion(req, { accion: "actualizar", modulo: "documentos", registroId: data.id,
    descripcion: `${CATEGORIAS[data.categoria]} · ${data.titulo}${fila.archivo_ruta ? " (archivo reemplazado)" : ""}` });
  res.json(darForma(data, false));
});

// DELETE /documentos/:id — lo retira del portal. El archivo se conserva en el
// bucket por si hace falta en una auditoría; no se borra de verdad.
router.delete("/:id", ESCRIBEN, async (req, res) => {
  const { data, error } = await supabase.from("asa_documentos")
    .update({ activo: false, updated_at: new Date().toISOString() })
    .eq("id", req.params.id).select("id, titulo, categoria").maybeSingle();
  if (error) return fallo(res, 500, error.message);
  if (!data) return fallo(res, 404, "Documento no encontrado.");
  logAccion(req, { accion: "eliminar", modulo: "documentos", registroId: data.id, descripcion: `${CATEGORIAS[data.categoria]} · ${data.titulo}` });
  res.json({ ok: true });
});

export default router;
