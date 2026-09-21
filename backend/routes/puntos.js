// routes/puntos.js — Puntos de control (el corazón del sistema)
//
// Un punto de control es cualquier cosa que el técnico debe revisar: un
// cebadero, una lámpara de moscas, un dispensador de aerosol, una habitación.
// Cada uno lleva un QR cuyo token NUNCA cambia (lo garantiza un trigger en la
// base de datos), así que la calcomanía pegada en la pared sigue sirviendo
// aunque renombres el punto o lo muevas de área.
import express from "express";
import ExcelJS from "exceljs";
import { supabase } from "../lib/supabaseClient.js";
import { logAccion } from "../lib/auditoria.js";
import { requireRol, filtrarPorSitio, exigirSitioPermitido, puedeVerSitio } from "../middleware/auth.js";

const router = express.Router();

// La URL que se codifica en el QR: al escanear con cualquier cámara, el
// teléfono abre la app del técnico directo en ese punto.
const APP_TECNICO_URL = (process.env.APP_TECNICO_URL || "https://asa-tecnico.vercel.app").replace(/\/$/, "");
export const urlQR = (token) => `${APP_TECNICO_URL}/p/${token}`;

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo de tipos de punto
// ─────────────────────────────────────────────────────────────────────────────
const FRECUENCIAS_VALIDAS = ["diaria", "semanal", "quincenal", "mensual", "trimestral", "por_orden"];

router.get("/tipos", async (req, res) => {
  const { data, error } = await supabase
    .from("asa_tipos_punto")
    .select("*")
    .eq("activo", true)
    .order("orden");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

router.post("/tipos", requireRol("operaciones"), async (req, res) => {
  const { data, error } = await supabase.from("asa_tipos_punto").insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});

// PUT /puntos/tipos/:id — editar un tipo (sobre todo su frecuencia por defecto)
//
// El `codigo` no se acepta: los puntos ya creados y el importador lo usan como
// llave, así que cambiarlo rompería referencias silenciosamente. Para renombrar
// se edita `nombre`, que es lo que se muestra.
router.put("/tipos/:id", requireRol("operaciones"), async (req, res) => {
  const { id: _a, codigo: _b, created_at: _c, ...cambios } = req.body;

  if (cambios.frecuencia_default && !FRECUENCIAS_VALIDAS.includes(cambios.frecuencia_default)) {
    return res.status(400).json({
      error: true,
      mensaje: `frecuencia_default debe ser una de: ${FRECUENCIAS_VALIDAS.join(", ")}`,
    });
  }

  const { data, error } = await supabase
    .from("asa_tipos_punto")
    .update(cambios)
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: mensajeAmable(error) });

  logAccion(req, { accion: "actualizar", modulo: "tipos_punto", registroId: data.id, descripcion: data.nombre });
  res.json(data);
});

// ─────────────────────────────────────────────────────────────────────────────
// Listado y semáforo
// ─────────────────────────────────────────────────────────────────────────────

// GET /puntos?sitio_id=&area_id=&tipo=&estado=pendientes|realizados
//
// Devuelve los puntos con su última inspección y si están vencidos. El panel
// usa `estado` para armar los dos recuadros: lo hecho y lo que falta.
router.get("/", async (req, res) => {
  const { sitio_id, area_id, tipo, estado } = req.query;
  if (!sitio_id) return res.status(400).json({ error: true, mensaje: "sitio_id es requerido" });
  if (!exigirSitioPermitido(req, res, sitio_id)) return;

  let q = supabase.from("asa_v_puntos_estado").select("*").eq("sitio_id", sitio_id);
  if (area_id) q = q.eq("area_id", area_id);
  if (tipo) q = q.eq("tipo_codigo", tipo);

  const { data, error } = await q.order("area_nombre").order("codigo_visible");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
  const conHoy = (data || []).map((p) => ({
    ...p,
    url_qr: urlQR(p.qr_token),
    hecho_hoy: p.ultima_inspeccion
      ? new Date(p.ultima_inspeccion).toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" }) === hoy
      : false,
  }));

  if (estado === "realizados") return res.json(conHoy.filter((p) => p.hecho_hoy));
  if (estado === "pendientes") return res.json(conHoy.filter((p) => !p.hecho_hoy));

  res.json({
    total: conHoy.length,
    realizados: conHoy.filter((p) => p.hecho_hoy),
    pendientes: conHoy.filter((p) => !p.hecho_hoy),
  });
});

// GET /puntos/buscar?q=&sitio_id= — respaldo cuando el QR está dañado o ilegible
router.get("/buscar", async (req, res) => {
  const termino = (req.query.q || "").trim();
  if (termino.length < 2) return res.json([]);

  let q = supabase
    .from("asa_puntos_control")
    .select("id, qr_token, codigo_visible, nombre, numero_habitacion, ubicacion_descripcion, sitio_id, asa_areas(nombre), asa_tipos_punto(nombre, icono), asa_sitios(nombre)")
    .eq("activo", true)
    .or(
      [
        `codigo_visible.ilike.%${termino}%`,
        `nombre.ilike.%${termino}%`,
        `numero_habitacion.ilike.%${termino}%`,
        `ubicacion_descripcion.ilike.%${termino}%`,
      ].join(",")
    )
    .limit(40);

  if (req.query.sitio_id) q = q.eq("sitio_id", req.query.sitio_id);
  q = filtrarPorSitio(q, req);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// GET /puntos/qr/:token — lo que ve el técnico al escanear
//
// Devuelve todo de una vez para que la app no tenga que hacer 4 llamadas en el
// sótano de un hotel sin señal: ficha, checklist que aplica y últimas visitas.
router.get("/qr/:token", async (req, res) => {
  const { data: punto, error } = await supabase
    .from("asa_puntos_control")
    .select(`
      *,
      asa_areas(id, nombre, codigo, nivel),
      asa_tipos_punto(id, codigo, nombre, icono, color, requiere_foto),
      asa_sitios(id, nombre, direccion, cliente_id),
      asa_planos(id, nombre, imagen_url)
    `)
    .eq("qr_token", req.params.token)
    .maybeSingle();

  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  if (!punto) {
    return res.status(404).json({
      error: true,
      mensaje: "Ese código QR no corresponde a ningún punto de control. Búscalo por nombre.",
    });
  }
  if (!punto.activo) {
    return res.status(410).json({ error: true, mensaje: `El punto ${punto.codigo_visible} está dado de baja.` });
  }
  if (!puedeVerSitio(req, punto.sitio_id)) {
    return res.status(403).json({ error: true, mensaje: "No tienes acceso a este hotel" });
  }

  const [preguntas, historial] = await Promise.all([
    preguntasDelPunto(punto),
    supabase
      .from("asa_inspecciones")
      .select("id, fecha, estado_punto, nivel_actividad, notas, fotos")
      .eq("punto_id", punto.id)
      .order("fecha", { ascending: false })
      .limit(5),
  ]);

  res.json({
    ...punto,
    url_qr: urlQR(punto.qr_token),
    preguntas,
    historial: historial.data || [],
  });
});

// Checklist que aplica a un punto: las preguntas de la estrategia del cliente
// (o del contrato/hotel) cuyo tipo de punto coincide, más las generales.
async function preguntasDelPunto(punto) {
  const clienteId = punto.asa_sitios?.cliente_id;

  // La estrategia del propio punto manda. Si no tiene una asignada, se cae a
  // las estrategias del hotel o del cliente.
  let estrategias;
  if (punto.estrategia_id) {
    estrategias = [{ id: punto.estrategia_id }];
  } else {
    let qe = supabase.from("asa_estrategias").select("id").eq("activo", true);
    qe = qe.or(
      [`sitio_id.eq.${punto.sitio_id}`, clienteId ? `cliente_id.eq.${clienteId}` : null]
        .filter(Boolean)
        .join(",")
    );
    const { data } = await qe;
    estrategias = data;
  }
  if (!estrategias?.length) return [];

  const { data } = await supabase
    .from("asa_preguntas")
    .select("*")
    .in("estrategia_id", estrategias.map((e) => e.id))
    .eq("activa", true)
    .or(`tipo_punto_id.eq.${punto.tipo_punto_id},tipo_punto_id.is.null`)
    .order("orden");

  return data || [];
}

// GET /puntos/:id
router.get("/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("asa_puntos_control")
    .select("*, asa_areas(nombre), asa_tipos_punto(*), asa_sitios(id, nombre, cliente_id)")
    .eq("id", req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  if (!data) return res.status(404).json({ error: true, mensaje: "Punto no encontrado" });
  if (!puedeVerSitio(req, data.sitio_id)) return res.status(403).json({ error: true, mensaje: "Sin acceso" });

  const { data: historial } = await supabase
    .from("asa_inspecciones")
    .select("*, asa_empleados(nombre_completo)")
    .eq("punto_id", data.id)
    .order("fecha", { ascending: false })
    .limit(50);

  res.json({ ...data, url_qr: urlQR(data.qr_token), historial: historial || [] });
});

// ─────────────────────────────────────────────────────────────────────────────
// QR ya impreso
//
// ASA tiene rollos de etiquetas impresas de antes. El QR de esas etiquetas
// codifica ÚNICAMENTE el código (ej. "C205050474718"), sin URL ni dominio, así
// que no está atado a ningún sistema: se puede reutilizar tal cual.
//
// Estas etiquetas se pegan primero y se asignan después, por eso el alta
// unitaria acepta un qr_token explícito. Una vez asignado no se puede cambiar
// (lo impide un trigger en la base de datos), así que vale la pena validarlo
// bien ANTES de insertar y dar un mensaje claro si ya está en uso.
// ─────────────────────────────────────────────────────────────────────────────
const FORMATO_QR = /^[A-Z0-9][A-Z0-9-]{5,63}$/;

function normalizarQR(valor) {
  return String(valor).trim().toUpperCase().replace(/\s+/g, "");
}

// Devuelve { ok:true, token } o { ok:false, status, mensaje }
async function validarQRImpreso(valor) {
  const token = normalizarQR(valor);

  if (!FORMATO_QR.test(token)) {
    return {
      ok: false,
      status: 400,
      mensaje:
        `"${valor}" no parece un código de etiqueta válido. Se esperan entre 6 y 64 ` +
        "caracteres, solo letras, números y guiones.",
    };
  }

  const { data: enUso, error } = await supabase
    .from("asa_puntos_control")
    .select("id, codigo_visible, activo, asa_sitios(nombre)")
    .eq("qr_token", token)
    .maybeSingle();

  if (error) return { ok: false, status: 500, mensaje: mensajeAmable(error) };

  if (enUso) {
    const donde = enUso.asa_sitios?.nombre ? ` en ${enUso.asa_sitios.nombre}` : "";
    return {
      ok: false,
      status: 409,
      mensaje:
        `Esa etiqueta ya está asignada al punto ${enUso.codigo_visible}${donde}` +
        (enUso.activo ? "." : " (desactivado). Un QR no se reutiliza aunque el punto se haya dado de baja."),
    };
  }

  return { ok: true, token };
}

// GET /puntos/qr/:token/disponible — la app escanea una etiqueta en blanco y
// pregunta si se puede usar, antes de abrir el formulario de alta.
router.get("/qr/:token/disponible", async (req, res) => {
  const r = await validarQRImpreso(req.params.token);
  if (r.ok) return res.json({ disponible: true, token: r.token });
  if (r.status === 500) return res.status(500).json({ error: true, mensaje: r.mensaje });
  res.json({ disponible: false, motivo: r.mensaje });
});

// ─────────────────────────────────────────────────────────────────────────────
// Alta: unitaria, masiva o desde Excel
// ─────────────────────────────────────────────────────────────────────────────

// POST /puntos — uno solo
router.post("/", requireRol("operaciones", "comercial"), async (req, res) => {
  const { sitio_id, tipo_punto_id, tipo_codigo, codigo_visible } = req.body;
  if (!sitio_id) return res.status(400).json({ error: true, mensaje: "sitio_id es requerido" });
  if (!exigirSitioPermitido(req, res, sitio_id)) return;

  const tipo = await resolverTipo({ tipo_punto_id, tipo_codigo });
  if (!tipo) return res.status(400).json({ error: true, mensaje: "Tipo de punto no válido" });

  const fila = {
    ...req.body,
    tipo_punto_id: tipo.id,
    codigo_visible: codigo_visible || (await siguienteCodigo(sitio_id, tipo)),
    frecuencia: req.body.frecuencia || tipo.frecuencia_default,
  };
  delete fila.tipo_codigo;

  // Si viene qr_token, es una etiqueta YA IMPRESA que se está reutilizando.
  // Se valida contra la base antes de insertar; si no viene, la base genera uno.
  delete fila.qr_token;
  if (req.body.qr_token) {
    const r = await validarQRImpreso(req.body.qr_token);
    if (!r.ok) return res.status(r.status).json({ error: true, mensaje: r.mensaje });
    fila.qr_token = r.token;
  }

  const { data, error } = await supabase.from("asa_puntos_control").insert([fila]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: mensajeAmable(error) });

  logAccion(req, { accion: "crear", modulo: "puntos", registroId: data.id, descripcion: data.codigo_visible });
  res.status(201).json({ ...data, url_qr: urlQR(data.qr_token) });
});

// POST /puntos/masivo — genera N puntos numerados de un tipo en un área
// Body: { sitio_id, area_id, tipo_codigo, cantidad, desde?, prefijo?, frecuencia?, nombre_base? }
router.post("/masivo", requireRol("operaciones"), async (req, res) => {
  const { sitio_id, area_id, tipo_punto_id, tipo_codigo, cantidad, desde = 1, prefijo, frecuencia, nombre_base } = req.body;

  if (!sitio_id || !cantidad) {
    return res.status(400).json({ error: true, mensaje: "sitio_id y cantidad son requeridos" });
  }
  if (!exigirSitioPermitido(req, res, sitio_id)) return;
  if (cantidad > 1000) {
    return res.status(400).json({ error: true, mensaje: "Máximo 1000 puntos por carga. Divídelo en varias." });
  }

  const tipo = await resolverTipo({ tipo_punto_id, tipo_codigo });
  if (!tipo) return res.status(400).json({ error: true, mensaje: "Tipo de punto no válido" });

  // Prefijo: el que mandes, o el del área, o el del tipo
  let pre = prefijo;
  if (!pre && area_id) {
    const { data: area } = await supabase.from("asa_areas").select("codigo").eq("id", area_id).maybeSingle();
    pre = area?.codigo || null;
  }
  pre = pre || tipo.prefijo_codigo || "PC";

  const filas = [];
  for (let i = 0; i < Number(cantidad); i++) {
    const n = Number(desde) + i;
    filas.push({
      sitio_id,
      area_id: area_id || null,
      tipo_punto_id: tipo.id,
      codigo_visible: `${pre}-${String(n).padStart(3, "0")}`,
      nombre: nombre_base ? `${nombre_base} ${n}` : null,
      numero_habitacion: tipo.codigo === "habitacion" ? String(n) : null,
      frecuencia: frecuencia || tipo.frecuencia_default,
    });
  }

  const { data, error } = await supabase.from("asa_puntos_control").insert(filas).select();
  if (error) return res.status(500).json({ error: true, mensaje: mensajeAmable(error) });

  logAccion(req, {
    accion: "crear",
    modulo: "puntos",
    registroId: sitio_id,
    descripcion: `${data.length} puntos de tipo ${tipo.nombre} (${pre}-...)`,
  });
  res.status(201).json({ creados: data.length, puntos: data.map((p) => ({ ...p, url_qr: urlQR(p.qr_token) })) });
});

// POST /puntos/importar — carga desde el Excel que ya tienes
//
// Body: { sitio_id, archivo_base64, hoja?, simular?, prefijo_area? }
//
// Está hecho para el export de "LISTA DE PUNTOS DE CONTROL" que ya usa ASA
// (columnas CÓDIGO, PERIODICIDAD, ESTRATEGIA, ÁREA, CONTRATO, ESTADO,
// CODIGO QR, INSPECCIONES), y también acepta hojas armadas a mano. El
// encabezado puede estar en cualquier orden y no distingue mayúsculas ni
// tildes. Columnas reconocidas:
//
//   codigo | punto | estacion    → código visible del punto
//   codigoqr | qr                → QR YA IMPRESO: se respeta tal cual
//   estrategia                   → estrategia (crea la que falte) y de ahí
//                                  se deduce el tipo de dispositivo
//   tipo | dispositivo           → tipo explícito, si la hoja lo trae
//   area | zona | ubicacion      → área (se crea sola si no existe)
//   contrato                     → código del contrato de origen
//   estado                       → Activo / Inactivo
//   habitacion | hab             → número de habitación
//   frecuencia | periodicidad    → diaria/semanal/quincenal/mensual/trimestral
//   nota | observacion           → notas
//
// LOS QR YA IMPRESOS SE CONSERVAN. Si la hoja trae la columna CODIGO QR, ese
// valor se usa como token del punto, así que las calcomanías pegadas en el
// hotel siguen funcionando sin reimprimir nada.
//
// Con simular:true no escribe nada: devuelve exactamente lo que haría, para
// revisarlo antes de confirmar.
router.post("/importar", requireRol("operaciones"), async (req, res) => {
  const { sitio_id, archivo_base64, hoja, simular = false, prefijo_area } = req.body;
  if (!sitio_id || !archivo_base64) {
    return res.status(400).json({ error: true, mensaje: "sitio_id y archivo_base64 son requeridos" });
  }
  if (!exigirSitioPermitido(req, res, sitio_id)) return;

  let filas;
  try {
    filas = await leerExcel(archivo_base64, hoja);
  } catch (e) {
    return res.status(400).json({ error: true, mensaje: `No se pudo leer el archivo: ${e.message}` });
  }
  if (!filas.length) {
    return res.status(400).json({ error: true, mensaje: "El archivo no tiene filas con datos." });
  }

  const [{ data: tipos }, { data: areasExistentes }, { data: estrategiasExistentes }, { data: sitio }] =
    await Promise.all([
      supabase.from("asa_tipos_punto").select("*").eq("activo", true),
      supabase.from("asa_areas").select("*").eq("sitio_id", sitio_id),
      supabase.from("asa_estrategias").select("*").eq("activo", true),
      supabase.from("asa_sitios").select("id, nombre, cliente_id").eq("id", sitio_id).maybeSingle(),
    ]);

  // Prefijo a recortar del nombre del área: el export trae el hotel repetido
  // en cada área ("Iberostar Coral Bavaro Cocina El Faro"), y guardarlo así
  // deja una lista ilegible en la app del técnico.
  const prefijos = (prefijo_area ? [prefijo_area] : [sitio?.nombre]).filter(Boolean).map(normalizar);

  const areasPorNombre = new Map((areasExistentes || []).map((a) => [normalizar(a.nombre), a]));
  const estrategiasPorNombre = new Map((estrategiasExistentes || []).map((e) => [normalizar(e.nombre), e]));
  const areasNuevas = [];
  const estrategiasNuevas = [];
  const puntos = [];
  const errores = [];
  const qrVistos = new Set();

  for (const [i, f] of filas.entries()) {
    const linea = i + 2; // +1 por el encabezado, +1 porque Excel empieza en 1
    const codigo = valor(f, ["codigo", "punto", "estacion", "id", "no", "num"]);
    const qr = valor(f, ["codigoqr", "qr", "codigoqrunico", "token"]);
    const estrategiaTexto = valor(f, ["estrategia", "servicio", "programa"]);
    const tipoTexto = valor(f, ["tipo", "tipopunto", "dispositivo", "equipo"]);
    const nombre = valor(f, ["nombre", "descripcion", "detalle"]);
    const hab = valor(f, ["habitacion", "hab", "cuarto", "room"]);
    const estado = valor(f, ["estado", "activo", "status"]);
    const contrato = valor(f, ["contrato", "codigocontrato"]);
    let nombreArea = valor(f, ["area", "zona", "ubicacion", "sector", "departamento"]);

    if (!codigo && !nombre && !hab && !qr) continue; // fila vacía o separadora

    // "Área Múltiple (A, B, C, ...)" del export viejo: nos quedamos con la
    // etiqueta, no con la lista completa de 30 áreas dentro del paréntesis.
    if (nombreArea && String(nombreArea).length > 80) {
      nombreArea = String(nombreArea).split("(")[0].trim() || "Área múltiple";
    }
    nombreArea = recortarPrefijo(nombreArea, prefijos);

    // El tipo de dispositivo sale del texto explícito, o se deduce de la
    // estrategia y del código ("H145" con estrategia de prevención = habitación).
    const tipo = emparejarTipo(tipoTexto || estrategiaTexto, tipos, hab, codigo, nombreArea);
    if (!tipo) {
      errores.push({ linea, mensaje: `No se pudo determinar el tipo de "${codigo}"` });
      continue;
    }

    // Estrategia: se crea la que no exista, ligada a este cliente
    let estrategia = null;
    if (estrategiaTexto) {
      const clave = normalizar(estrategiaTexto);
      estrategia = estrategiasPorNombre.get(clave);
      if (!estrategia) {
        estrategia = {
          _nueva: true,
          nombre: String(estrategiaTexto).trim(),
          descripcion: "Importada del sistema anterior. Agrégale sus preguntas.",
          cliente_id: sitio?.cliente_id ?? null,
        };
        estrategiasPorNombre.set(clave, estrategia);
        estrategiasNuevas.push(estrategia);
      }
    }

    if (nombreArea) {
      const clave = normalizar(nombreArea);
      if (!areasPorNombre.has(clave)) {
        const nueva = {
          _nueva: true,
          sitio_id,
          nombre: String(nombreArea).trim(),
          codigo: siglas(nombreArea),
          nivel: valor(f, ["nivel", "piso", "planta"]) || null,
          orden: areasPorNombre.size,
        };
        areasPorNombre.set(clave, nueva);
        areasNuevas.push(nueva);
      }
    }

    // El QR impreso manda; si la hoja no lo trae, la base de datos genera uno.
    let token = qr ? String(qr).trim() : null;
    if (token && qrVistos.has(token)) {
      errores.push({ linea, mensaje: `Código QR repetido en el archivo: ${token}` });
      token = null;
    }
    if (token) qrVistos.add(token);

    const esHabitacion = tipo.codigo === "habitacion";
    const numeroHab = hab
      ? String(hab).trim()
      : esHabitacion && codigo
        ? String(codigo).replace(/\D/g, "") || null
        : null;

    puntos.push({
      _area_nombre: nombreArea || null,
      _estrategia_nombre: estrategiaTexto ? String(estrategiaTexto).trim() : null,
      _tipo_nombre: tipo.nombre,
      sitio_id,
      tipo_punto_id: tipo.id,
      ...(token ? { qr_token: token } : {}),
      codigo_visible: String(codigo || hab || token || `${tipo.prefijo_codigo}-${linea}`).trim(),
      nombre: nombre ? String(nombre).trim() : null,
      numero_habitacion: numeroHab,
      ubicacion_descripcion: valor(f, ["ubicacionexacta", "referencia", "lugar"]) || null,
      frecuencia: normalizarFrecuencia(valor(f, ["frecuencia", "periodicidad"])) || tipo.frecuencia_default,
      codigo_contrato_origen: contrato ? String(contrato).trim() : null,
      notas: valor(f, ["nota", "notas", "observacion", "observaciones", "comentario"]) || null,
      activo: estado ? !/inactiv|baja|elimin/i.test(String(estado)) : true,
    });
  }

  // Códigos visibles repetidos: se desambiguan en vez de romper la carga,
  // porque el sistema anterior sí permitía repetirlos entre áreas.
  const usados = new Map();
  for (const p of puntos) {
    const base = p.codigo_visible;
    if (!usados.has(base)) {
      usados.set(base, 1);
    } else {
      const n = usados.get(base) + 1;
      usados.set(base, n);
      p.codigo_visible = `${base}-${n}`;
      errores.push({ linea: "-", mensaje: `Código repetido "${base}" → se guardó como "${p.codigo_visible}"` });
    }
  }

  const resumen = {
    filas_leidas: filas.length,
    puntos_a_crear: puntos.length,
    qr_conservados: qrVistos.size,
    areas_nuevas: areasNuevas.map((a) => a.nombre),
    estrategias_nuevas: estrategiasNuevas.map((e) => e.nombre),
    por_tipo: puntos.reduce((acc, p) => ({ ...acc, [p._tipo_nombre]: (acc[p._tipo_nombre] || 0) + 1 }), {}),
    advertencias: errores,
  };

  if (simular) {
    return res.json({
      simulado: true,
      ...resumen,
      muestra: puntos.slice(0, 15).map(({ _area_nombre, _estrategia_nombre, _tipo_nombre, ...p }) => ({
        ...p,
        area: _area_nombre,
        estrategia: _estrategia_nombre,
        tipo: _tipo_nombre,
      })),
    });
  }
  if (!puntos.length) {
    return res.status(400).json({ error: true, mensaje: "No se pudo interpretar ninguna fila", ...resumen });
  }

  // 1) Estrategias nuevas
  if (estrategiasNuevas.length) {
    const { data: creadas, error } = await supabase
      .from("asa_estrategias")
      .insert(estrategiasNuevas.map(({ _nueva, ...e }) => e))
      .select();
    if (error) return res.status(500).json({ error: true, mensaje: error.message });
    for (const e of creadas || []) estrategiasPorNombre.set(normalizar(e.nombre), e);
  }

  // 2) Áreas nuevas
  if (areasNuevas.length) {
    const { data: creadas, error } = await supabase
      .from("asa_areas")
      .upsert(areasNuevas.map(({ _nueva, ...a }) => a), { onConflict: "sitio_id,nombre" })
      .select();
    if (error) return res.status(500).json({ error: true, mensaje: error.message });
    for (const a of creadas || []) areasPorNombre.set(normalizar(a.nombre), a);
  }

  // 3) Puntos, resolviendo área y estrategia por nombre
  const aInsertar = puntos.map(({ _area_nombre, _estrategia_nombre, _tipo_nombre, ...p }) => ({
    ...p,
    area_id: _area_nombre ? areasPorNombre.get(normalizar(_area_nombre))?.id || null : null,
    estrategia_id: _estrategia_nombre ? estrategiasPorNombre.get(normalizar(_estrategia_nombre))?.id || null : null,
  }));

  const creados = [];
  for (let i = 0; i < aInsertar.length; i += 200) {
    const lote = aInsertar.slice(i, i + 200);
    const { data, error } = await supabase.from("asa_puntos_control").insert(lote).select();
    if (error) {
      return res.status(500).json({
        error: true,
        mensaje: mensajeAmable(error),
        creados_antes_del_error: creados.length,
        ...resumen,
      });
    }
    creados.push(...data);
  }

  logAccion(req, {
    accion: "crear",
    modulo: "puntos",
    registroId: sitio_id,
    descripcion: `Importación de ${creados.length} puntos desde Excel (${qrVistos.size} QR conservados)`,
  });

  res.status(201).json({
    ...resumen,
    creados: creados.length,
    puntos: creados.slice(0, 50).map((p) => ({ id: p.id, codigo_visible: p.codigo_visible, url_qr: urlQR(p.qr_token) })),
  });
});

// GET /puntos/etiquetas?sitio_id=&area_id= — datos para imprimir las calcomanías
router.get("/etiquetas/imprimir", async (req, res) => {
  const { sitio_id, area_id } = req.query;
  if (!sitio_id) return res.status(400).json({ error: true, mensaje: "sitio_id es requerido" });
  if (!exigirSitioPermitido(req, res, sitio_id)) return;

  let q = supabase
    .from("asa_puntos_control")
    .select("id, qr_token, codigo_visible, nombre, numero_habitacion, asa_areas(nombre), asa_tipos_punto(nombre, icono)")
    .eq("sitio_id", sitio_id)
    .eq("activo", true)
    .order("codigo_visible");
  if (area_id) q = q.eq("area_id", area_id);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const { data: sitio } = await supabase.from("asa_sitios").select("nombre").eq("id", sitio_id).maybeSingle();

  res.json({
    hotel: sitio?.nombre || "",
    total: (data || []).length,
    etiquetas: (data || []).map((p) => ({
      codigo: p.codigo_visible,
      nombre: p.nombre || p.asa_tipos_punto?.nombre || "",
      area: p.asa_areas?.nombre || "",
      habitacion: p.numero_habitacion,
      url_qr: urlQR(p.qr_token),
    })),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edición y baja
// ─────────────────────────────────────────────────────────────────────────────
router.put("/:id", requireRol("operaciones", "comercial"), async (req, res) => {
  const { id: _a, qr_token: _b, sitio_id: _c, created_at: _d, ...cambios } = req.body;
  const { data, error } = await supabase
    .from("asa_puntos_control")
    .update(cambios)
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: mensajeAmable(error) });
  logAccion(req, { accion: "actualizar", modulo: "puntos", registroId: req.params.id });
  res.json({ ...data, url_qr: urlQR(data.qr_token) });
});

// PATCH /puntos/frecuencia — cambiar la frecuencia de muchos puntos de golpe
//
// La frecuencia la decides tú por hotel: el Excel del sistema anterior trae
// PERIODICIDAD en 0 para todo, así que cada hotel se configura aquí.
//
// Body: { sitio_id, frecuencia, area_id?, tipo_codigo?, punto_ids? }
//   Sin filtros    → todos los puntos del hotel
//   area_id        → solo esa área
//   tipo_codigo    → solo ese tipo (ej. "habitacion")
//   punto_ids      → exactamente esos puntos
router.patch("/frecuencia", requireRol("operaciones", "comercial"), async (req, res) => {
  const { sitio_id, frecuencia, area_id, tipo_codigo, punto_ids } = req.body;

  if (!FRECUENCIAS_VALIDAS.includes(frecuencia)) {
    return res.status(400).json({ error: true, mensaje: `frecuencia debe ser una de: ${FRECUENCIAS_VALIDAS.join(", ")}` });
  }
  if (!sitio_id && !punto_ids?.length) {
    return res.status(400).json({ error: true, mensaje: "Indica sitio_id o una lista de punto_ids" });
  }
  if (sitio_id && !exigirSitioPermitido(req, res, sitio_id)) return;

  let q = supabase.from("asa_puntos_control").update({ frecuencia });
  if (punto_ids?.length) {
    q = q.in("id", punto_ids);
  } else {
    q = q.eq("sitio_id", sitio_id).eq("activo", true);
    if (area_id) q = q.eq("area_id", area_id);
    if (tipo_codigo) {
      const tipo = await resolverTipo({ tipo_codigo });
      if (!tipo) return res.status(400).json({ error: true, mensaje: `Tipo "${tipo_codigo}" no existe` });
      q = q.eq("tipo_punto_id", tipo.id);
    }
  }

  const { data, error } = await q.select("id");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  logAccion(req, {
    accion: "actualizar",
    modulo: "puntos",
    registroId: sitio_id ?? null,
    descripcion: `Frecuencia ${frecuencia} aplicada a ${data.length} punto(s)`,
  });
  res.json({ actualizados: data.length, frecuencia });
});


// ─────────────────────────────────────────────────────────────────────────────
// PATCH /puntos/area — mover puntos de un área a otra, en masa
//
// Renombrar un área ya se propaga sola a todos sus puntos (cuelgan de ella por
// id, no por texto). Esto es para el otro caso: cuando los puntos quedaron en
// el área equivocada y hay que moverlos sin tocarlos uno por uno.
//
// Body: { sitio_id, area_destino_id, area_origen_id?, tipo_codigo?, punto_ids? }
//   · con punto_ids  → mueve exactamente esos
//   · sin punto_ids  → mueve todos los del sitio que cumplan los filtros
//   · area_origen_id = "null" (texto) → los que no tienen área asignada
//
// Con simular:true devuelve cuántos movería sin tocar nada.
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/area", requireRol("operaciones", "comercial"), async (req, res) => {
  const { sitio_id, area_destino_id, area_origen_id, tipo_codigo, punto_ids, simular = false } = req.body;

  if (!sitio_id && !punto_ids?.length) {
    return res.status(400).json({ error: true, mensaje: "Indica sitio_id o una lista de punto_ids" });
  }
  if (area_destino_id === undefined) {
    return res.status(400).json({ error: true, mensaje: "area_destino_id es requerido (usa null para dejarlos sin área)" });
  }
  if (sitio_id && !exigirSitioPermitido(req, res, sitio_id)) return;

  // El área destino tiene que ser de la misma planta: un punto del Coral
  // Bávaro no puede quedar apuntando a un área de Comunes.
  if (area_destino_id) {
    const { data: destino } = await supabase
      .from("asa_areas")
      .select("id, sitio_id, nombre")
      .eq("id", area_destino_id)
      .maybeSingle();
    if (!destino) return res.status(400).json({ error: true, mensaje: "El área destino no existe" });
    if (sitio_id && destino.sitio_id !== sitio_id) {
      return res.status(400).json({ error: true, mensaje: "El área destino pertenece a otra planta" });
    }
  }

  let tipoResuelto = null;
  if (tipo_codigo) {
    tipoResuelto = await resolverTipo({ tipo_codigo });
    if (!tipoResuelto) return res.status(400).json({ error: true, mensaje: `Tipo "${tipo_codigo}" no existe` });
  }

  const filtrar = (q) => {
    if (punto_ids?.length) return q.in("id", punto_ids);
    q = q.eq("sitio_id", sitio_id).eq("activo", true);
    if (area_origen_id === "null" || area_origen_id === null) q = q.is("area_id", null);
    else if (area_origen_id) q = q.eq("area_id", area_origen_id);
    if (tipoResuelto) q = q.eq("tipo_punto_id", tipoResuelto.id);
    return q;
  };

  if (simular) {
    const { count, error } = await filtrar(
      supabase.from("asa_puntos_control").select("id", { count: "exact", head: true })
    );
    if (error) return res.status(500).json({ error: true, mensaje: error.message });
    return res.json({ moverian: count || 0, simulado: true });
  }

  const { data, error } = await filtrar(
    supabase.from("asa_puntos_control").update({ area_id: area_destino_id || null })
  ).select("id");
  if (error) return res.status(500).json({ error: true, mensaje: mensajeAmable(error) });

  logAccion(req, {
    accion: "actualizar",
    modulo: "puntos",
    registroId: sitio_id ?? null,
    descripcion: `${data.length} punto(s) movidos de área`,
  });
  res.json({ movidos: data.length });
});

// PATCH /puntos/:id/plano — colocar el pin del punto sobre el plano
router.patch("/:id/plano", requireRol("operaciones"), async (req, res) => {
  const { plano_id, plano_x, plano_y } = req.body;
  const { data, error } = await supabase
    .from("asa_puntos_control")
    .update({ plano_id, plano_x, plano_y })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// DELETE /puntos/:id — baja lógica: el historial de inspecciones se conserva
router.delete("/:id", requireRol("operaciones"), async (req, res) => {
  const { error } = await supabase.from("asa_puntos_control").update({ activo: false }).eq("id", req.params.id);
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  logAccion(req, { accion: "eliminar", modulo: "puntos", registroId: req.params.id });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────────────
async function resolverTipo({ tipo_punto_id, tipo_codigo }) {
  const q = supabase.from("asa_tipos_punto").select("*");
  const { data } = tipo_punto_id
    ? await q.eq("id", tipo_punto_id).maybeSingle()
    : await q.eq("codigo", tipo_codigo).maybeSingle();
  return data || null;
}

async function siguienteCodigo(sitio_id, tipo) {
  const pre = tipo.prefijo_codigo || "PC";
  const { data } = await supabase
    .from("asa_puntos_control")
    .select("codigo_visible")
    .eq("sitio_id", sitio_id)
    .like("codigo_visible", `${pre}-%`)
    .order("codigo_visible", { ascending: false })
    .limit(1);

  const ultimo = data?.[0]?.codigo_visible;
  const n = ultimo ? Number(String(ultimo).split("-").pop()) + 1 : 1;
  return `${pre}-${String(Number.isFinite(n) ? n : 1).padStart(3, "0")}`;
}

function mensajeAmable(error) {
  if (error.code === "23505" && /codigo_visible/.test(error.message || "")) {
    return "Ya existe un punto con ese código en este hotel. Los códigos no se pueden repetir dentro del mismo hotel.";
  }
  return error.message;
}

const normalizar = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

function valor(fila, claves) {
  for (const k of claves) {
    const encontrado = Object.keys(fila).find((col) => normalizar(col) === k);
    if (encontrado && fila[encontrado] !== null && String(fila[encontrado]).trim() !== "") {
      return fila[encontrado];
    }
  }
  return null;
}

function siglas(texto) {
  return String(texto)
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 4);
}

function normalizarFrecuencia(t) {
  const n = normalizar(t);
  if (!n) return null;
  if (n.startsWith("dia")) return "diaria";
  if (n.startsWith("sem")) return "semanal";
  if (n.startsWith("quin")) return "quincenal";
  if (n.startsWith("mens") || n.startsWith("mes")) return "mensual";
  if (n.startsWith("trim")) return "trimestral";
  if (n.includes("orden") || n.includes("demanda")) return "por_orden";
  return null;
}

// Empareja el texto del Excel con un tipo del catálogo, con tolerancia a las
// variantes y erratas del export real: "sebadero", "Matenimiento", "Lámpara
// ultravioletas atrapa moscas", etc.
//
// Cuando la estrategia no identifica un dispositivo (caso de "Prevención y
// Mantenimiento", que en el Excel de ASA cubre tanto habitaciones como
// restaurantes), se mira el código del punto y el nombre del área: un código
// "H145" o un área "Habitación huésped" es una habitación.
function emparejarTipo(texto, tipos, hab, codigo, area) {
  const n = normalizar(texto);
  const nCodigo = normalizar(codigo);
  const nArea = normalizar(area);
  const buscar = (c) => tipos.find((t) => t.codigo === c) || null;

  const exacto = tipos.find((t) => normalizar(t.codigo) === n || normalizar(t.nombre) === n);
  if (exacto) return exacto;

  const alias = [
    [["cebadero", "sebadero", "cebo", "roedor", "raton", "rata", "portacebo"], "cebadero_roedor"],
    [["lampara", "ultravioleta", "insectocutor", "atrapamoscas", "atrapainsectos", "luzuv"], "lampara_moscas"],
    [["aerosol", "dispensador", "difusor", "atomizador"], "dispensador_aerosol"],
    [["laminapegante", "pegajosa", "pegante", "glue", "feromona"], "trampa_pegajosa"],
    [["apertura", "sellado", "hermeticidad"], "apertura"],
    [["habitacion", "cuarto", "room", "hab"], "habitacion"],
    [["perimetral", "areasverdes", "jardin", "exterior"], "estacion_exterior"],
  ];
  for (const [palabras, codigoTipo] of alias) {
    if (palabras.some((p) => n.includes(p))) {
      const t = buscar(codigoTipo);
      if (t) return t;
    }
  }

  // Sin pista en la estrategia: deducir por el código y el área
  if (hab) return buscar("habitacion");
  if (/^h\d+$/.test(nCodigo) || nArea.includes("habitacion")) return buscar("habitacion");
  if (nCodigo.includes("cebadero") || nCodigo.includes("ccbavaro")) return buscar("cebadero_roedor");
  if (nCodigo.includes("lampara")) return buscar("lampara_moscas");
  if (nCodigo.includes("aerosol")) return buscar("dispensador_aerosol");
  if (nArea.includes("areasverdes") || nArea.includes("areaexterior")) return buscar("estacion_exterior");

  return buscar("area_general");
}

// Quita del nombre del área el nombre del hotel, que el export repite en cada
// fila: "Iberostar Coral Bavaro Cocina El Faro" → "Cocina El Faro".
function recortarPrefijo(area, prefijos) {
  if (!area) return area;
  let texto = String(area).trim();
  for (const pre of prefijos) {
    if (!pre) continue;
    const n = normalizar(texto);
    if (n.startsWith(pre) && n.length > pre.length) {
      // Recorta tantas palabras del inicio como tenga el prefijo
      const palabras = texto.split(/\s+/);
      let acumulado = "";
      let corte = 0;
      for (let i = 0; i < palabras.length; i++) {
        acumulado += normalizar(palabras[i]);
        corte = i + 1;
        if (acumulado === pre) break;
        if (!pre.startsWith(acumulado)) {
          corte = 0;
          break;
        }
      }
      if (corte > 0 && corte < palabras.length) {
        texto = palabras.slice(corte).join(" ").trim();
      }
    }
  }
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// Lee un .xlsx (o .csv) en base64 y devuelve [{encabezado: valor}, ...]
async function leerExcel(base64, nombreHoja) {
  const limpio = String(base64).replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(limpio, "base64");

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const ws = nombreHoja ? wb.getWorksheet(nombreHoja) : wb.worksheets[0];
  if (!ws) throw new Error(`No se encontró la hoja ${nombreHoja || "(la primera)"}`);

  // Encabezado: la fila con MÁS celdas llenas de las primeras 20.
  //
  // No sirve "la primera fila con 2 o más celdas": los export de ASA empiezan
  // con un título ("LISTA DE PUNTOS DE CONTROL"), una fila "DESCARGADO EL |
  // fecha" y varias de filtros. Esa segunda fila tiene 2 celdas y se colaría
  // como encabezado, dejando columnas llamadas "DESCARGADO EL" y la fecha.
  // La fila de encabezados real es la más ancha de todas.
  let filaEncabezado = 1;
  let mejorAncho = 0;
  const limite = Math.min(ws.rowCount, 20);
  for (let r = 1; r <= limite; r++) {
    const celdas = (ws.getRow(r).values || []).filter(
      (v) => v !== null && v !== undefined && String(v.text ?? v).trim() !== ""
    );
    if (celdas.length > mejorAncho) {
      mejorAncho = celdas.length;
      filaEncabezado = r;
    }
  }
  if (mejorAncho < 2) throw new Error("No se encontró una fila de encabezados con al menos dos columnas");

  const encabezados = [];
  ws.getRow(filaEncabezado).eachCell({ includeEmpty: true }, (celda, col) => {
    encabezados[col] = String(celda.value ?? "").trim();
  });

  const filas = [];
  for (let r = filaEncabezado + 1; r <= ws.rowCount; r++) {
    const fila = {};
    let tieneAlgo = false;
    ws.getRow(r).eachCell({ includeEmpty: false }, (celda, col) => {
      const clave = encabezados[col];
      if (!clave) return;
      let v = celda.value;
      if (v && typeof v === "object") v = v.text ?? v.result ?? v.hyperlink ?? String(v);
      if (v !== null && String(v).trim() !== "") tieneAlgo = true;
      fila[clave] = v;
    });
    if (tieneAlgo) filas.push(fila);
  }
  return filas;
}

export default router;

// Exportadas para scripts/probar-importacion.mjs (prueba del parser con los
// Excel reales de ASA, sin tocar la base de datos).
export { leerExcel, emparejarTipo, recortarPrefijo, normalizar, valor, normalizarFrecuencia, siglas };
