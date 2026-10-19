// routes/usuarios.js — Autenticación y usuarios (personal interno + clientes)
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { supabase } from "../lib/supabaseClient.js";
import { requireAuth, requireRol, ROLES_INTERNOS, olvidarVigencia } from "../middleware/auth.js";
import { logAccion } from "../lib/auditoria.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// Ficha de empleado de los técnicos
//
// La inspección guarda QUIÉN la hizo tomando el `empleado_id` de la cuenta. Si
// la cuenta no tiene ficha de empleado, el servicio queda sin técnico y en el
// reporte sale "Sin técnico". Por eso toda cuenta de técnico u operaciones se
// amarra sola a su ficha: se busca por nombre y, si no existe, se crea.
// ─────────────────────────────────────────────────────────────────────────────
const ROLES_CON_FICHA = ["tecnico_plagas", "operaciones"];

export async function vincularEmpleado(usuario) {
  if (!usuario || usuario.empleado_id || !ROLES_CON_FICHA.includes(usuario.rol)) {
    return usuario?.empleado_id || null;
  }
  const nombre = String(usuario.nombre_completo || "").trim();
  if (!nombre) return null;

  let empleadoId = null;
  const { data: existentes } = await supabase
    .from("asa_empleados")
    .select("id")
    .ilike("nombre_completo", nombre)
    .limit(1);
  empleadoId = existentes?.[0]?.id || null;

  if (!empleadoId) {
    const { data: nuevo, error } = await supabase
      .from("asa_empleados")
      .insert([{ nombre_completo: nombre, email: usuario.email || null, rol: usuario.rol, activo: true }])
      .select("id")
      .single();
    if (error) return null; // no se frena el login por esto
    empleadoId = nuevo.id;
  }

  await supabase
    .from("asa_usuarios")
    .update({ empleado_id: empleadoId, updated_at: new Date().toISOString() })
    .eq("id", usuario.id);
  return empleadoId;
}

// POST /usuarios/registrar-cliente — cuentas de la app del cliente.
// Estaba abierta: cualquiera podía crearse una cuenta y escoger el cliente_id
// para ver sus datos. Ahora solo la crea la oficina.
router.post("/registrar-cliente", requireAuth, requireRol("admin", "comercial"), async (req, res) => {
  const { email, password, nombre_completo, cliente_id } = req.body;
  if (!email || !password) return res.status(400).json({ error: true, mensaje: "email y password son requeridos" });

  const password_hash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from("asa_usuarios")
    .insert([{ email, password_hash, nombre_completo, rol: "cliente", cliente_id }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const { password_hash: _omit, ...usuario } = data;
  res.status(201).json(usuario);
});

// ─────────────────────────────────────────────────────────────────────────────
// Inicio de sesión
//
// Dos formas de entrar, y la cuenta de hotel puede exigir las dos:
//
//   1. Correo + clave (POST /usuarios/login), como siempre.
//   2. Correo personal verificado (POST /usuarios/login-correo): Google,
//      Microsoft (Hotmail / Outlook / Office 365) o un código que llega al
//      correo. Lo verifica Supabase Auth; aquí solo se recibe su token y se
//      pregunta a Supabase de quién es.
//
// Cuentas de hotel con personas autorizadas (asa_usuario_personas): la clave
// del hotel sola NO basta. Después de la clave, la persona entra con su correo
// y tiene que estar en la lista de esa cuenta. Si renuncia, se le desactiva y
// no vuelve a entrar aunque sepa la clave (ni con una sesión ya abierta: ver
// middleware/auth.js → vigencia).
// ─────────────────────────────────────────────────────────────────────────────
// La clave pública de Supabase. Se acepta con otros nombres comunes (o en
// minúsculas) porque en Railway un nombre mal escrito no avisa nada.
const anonKey = () =>
  String(
    process.env.SUPABASE_ANON_KEY || process.env.supabase_anon_key || process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON || process.env.ANON_KEY || ""
  ).trim();
const accesoCorreoConfigurado = () => !!(process.env.SUPABASE_URL && anonKey());

async function configAcceso() {
  try {
    const { data } = await supabase.from("asa_config_sistema").select("valor").eq("clave", "acceso").maybeSingle();
    return data?.valor || {};
  } catch {
    return {};
  }
}

async function personasActivas(usuarioId) {
  const { data, error } = await supabase
    .from("asa_usuario_personas")
    .select("id, nombre, email")
    .eq("usuario_id", usuarioId)
    .eq("activo", true);
  if (error) return [];          // falta correr 41_seguridad_y_accesos.sql
  return data || [];
}

const ticketPersona = (usuario) =>
  jwt.sign({ tipo: "persona", uid: usuario.id }, process.env.JWT_SECRET, { expiresIn: "15m" });

async function emitirSesion(usuario, persona = null) {
  usuario.empleado_id = await vincularEmpleado(usuario);
  const nombre = persona ? persona.nombre : usuario.nombre_completo;
  const token = jwt.sign(
    {
      id: usuario.id, rol: usuario.rol, nombre, cliente_id: usuario.cliente_id, empleado_id: usuario.empleado_id,
      ...(persona ? { persona_id: persona.id, persona_email: persona.email, cuenta: usuario.nombre_completo } : {}),
    },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );
  const ahora = new Date().toISOString();
  await supabase.from("asa_usuarios").update({ ultimo_acceso: ahora }).eq("id", usuario.id);
  if (persona) await supabase.from("asa_usuario_personas").update({ ultimo_acceso: ahora }).eq("id", persona.id);
  return {
    token,
    usuario: {
      id: usuario.id, nombre, rol: usuario.rol, cliente_id: usuario.cliente_id,
      ...(persona ? { persona: persona.nombre, persona_email: persona.email, cuenta: usuario.nombre_completo } : {}),
    },
  };
}

// Respuesta cuando a la cuenta le falta el paso de la persona
const pedirPersona = (usuario) => ({
  requiere_persona: true,
  ticket: ticketPersona(usuario),
  cuenta: usuario.nombre_completo,
  mensaje: "Confirma quién eres: entra con tu correo personal.",
});

// GET /usuarios/acceso-config — público: qué botones mostrar en el login.
// La anon key de Supabase es pública por diseño (va en el navegador); con la
// migración 41 no da acceso a ninguna tabla, solo sirve para el inicio de
// sesión con Google / Microsoft / código.
router.get("/acceso-config", (req, res) => {
  const ok = accesoCorreoConfigurado();
  res.json({
    oauth: ok,
    supabase_url: ok ? process.env.SUPABASE_URL.trim() : null,
    anon_key: ok ? anonKey() : null,
    proveedores: String(process.env.ACCESO_PROVEEDORES || "google,azure,email").split(",").map((x) => x.trim()).filter(Boolean),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Freno a quien prueba claves. Sin esto se podían probar miles de contraseñas
// contra una cuenta. Después de 5 claves malas para un mismo correo, ese correo
// queda bloqueado 15 minutos; y una misma conexión no puede fallar más de 30
// veces en 15 minutos (aunque cambie de correo). En memoria: si el servidor se
// reinicia, el contador vuelve a cero, que para esto basta.
// ─────────────────────────────────────────────────────────────────────────────
const FALLOS = new Map();          // clave → { n, desde }
const VENTANA_MS = 15 * 60 * 1000;
const TOPE_CORREO = 5;
const TOPE_IP = 30;
const ipDe = (req) => String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
function bloqueado(clave, tope) {
  const f = FALLOS.get(clave);
  if (!f) return 0;
  if (Date.now() - f.desde > VENTANA_MS) { FALLOS.delete(clave); return 0; }
  return f.n >= tope ? Math.ceil((f.desde + VENTANA_MS - Date.now()) / 60000) : 0;
}
function anotarFallo(clave) {
  const f = FALLOS.get(clave);
  if (!f || Date.now() - f.desde > VENTANA_MS) FALLOS.set(clave, { n: 1, desde: Date.now() });
  else f.n++;
  if (FALLOS.size > 20000) FALLOS.clear();
}

// POST /usuarios/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const kCorreo = `c:${String(email || "").trim().toLowerCase()}`;
  const kIp = `i:${ipDe(req)}`;
  const espera = bloqueado(kCorreo, TOPE_CORREO) || bloqueado(kIp, TOPE_IP);
  if (espera) {
    return res.status(429).json({ error: true, mensaje: `Demasiados intentos fallidos. Espera ${espera} minuto${espera === 1 ? "" : "s"} y vuelve a intentar.` });
  }
  const fallo = (u) => {
    anotarFallo(kCorreo);
    anotarFallo(kIp);
    const f = FALLOS.get(kCorreo);
    if (f?.n === TOPE_CORREO) {
      logAccion({ usuario: { id: u?.id || null, nombre: String(email || "") } },
        { accion: "acceso", modulo: "accesos", registroId: u?.id || null, descripcion: `Correo bloqueado 15 min por ${TOPE_CORREO} claves malas: ${email}`, detalle: { ip: ipDe(req) } });
    }
    return res.status(401).json({ error: true, mensaje: "Credenciales inválidas" });
  };

  const { data: usuario, error } = await supabase.from("asa_usuarios").select("*").eq("email", email).eq("activo", true).maybeSingle();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  if (!usuario) return fallo(null);

  const valido = await bcrypt.compare(String(password || ""), usuario.password_hash);
  if (!valido) return fallo(usuario);
  FALLOS.delete(kCorreo);

  // Cuenta de hotel con personas autorizadas: falta que la persona diga quién es
  if (usuario.rol === "cliente_calidad" && (await personasActivas(usuario.id)).length) {
    if (!accesoCorreoConfigurado()) {
      return res.status(503).json({ error: true, mensaje: "Esta cuenta exige confirmar la persona con su correo, pero el acceso con correo no está configurado en el servidor (falta SUPABASE_ANON_KEY)." });
    }
    return res.json(pedirPersona(usuario));
  }

  // Personal de ASA: si se activó "solo correo personal", la clave ya no sirve
  // (menos para admin, para no quedarse nunca afuera).
  if (ROLES_INTERNOS.includes(usuario.rol) && usuario.rol !== "admin" && accesoCorreoConfigurado()) {
    const cfg = await configAcceso();
    if (cfg.solo_correo_personal) {
      return res.status(403).json({ error: true, mensaje: "Entra con Google, Microsoft o con el código por correo (botones de abajo)." });
    }
  }

  res.json(await emitirSesion(usuario));
});

// POST /usuarios/login-correo { access_token, ticket? }
//   access_token: el de Supabase Auth después de entrar con Google, Microsoft
//                 o el código por correo.
//   ticket:       el que devolvió /login cuando la cuenta de hotel pidió la
//                 persona (paso 2).
router.post("/login-correo", async (req, res) => {
  if (!accesoCorreoConfigurado()) return res.status(503).json({ error: true, mensaje: "El acceso con correo no está configurado" });
  const { access_token, ticket } = req.body || {};
  if (!access_token) return res.status(400).json({ error: true, mensaje: "Falta el token del correo" });

  let correo;
  try {
    const { data, error } = await supabase.auth.getUser(access_token);
    if (error || !data?.user?.email) throw new Error(error?.message || "sin correo");
    correo = String(data.user.email).trim().toLowerCase();
  } catch (e) {
    return res.status(401).json({ error: true, mensaje: `No se pudo verificar el correo: ${e.message}` });
  }
  const anotar = (usuario, descripcion) =>
    logAccion({ usuario: { id: usuario?.id || null, nombre: usuario?.nombre_completo || correo } },
      { accion: "acceso", modulo: "accesos", registroId: usuario?.id || null, descripcion, detalle: { correo } });

  // Paso 2 de una cuenta de hotel: la persona tiene que estar en SU lista
  if (ticket) {
    let t;
    try {
      t = jwt.verify(ticket, process.env.JWT_SECRET);
      if (t.tipo !== "persona") throw new Error();
    } catch {
      return res.status(401).json({ error: true, mensaje: "Pasaron más de 15 minutos. Vuelve a poner el correo y la clave del hotel." });
    }
    const { data: usuario } = await supabase.from("asa_usuarios").select("*").eq("id", t.uid).eq("activo", true).maybeSingle();
    if (!usuario) return res.status(401).json({ error: true, mensaje: "La cuenta del hotel está desactivada" });
    const persona = (await personasActivas(usuario.id)).find((p) => String(p.email).toLowerCase() === correo);
    if (!persona) {
      anotar(usuario, `Intento de entrada rechazado: ${correo} no está autorizado en ${usuario.email}`);
      return res.status(403).json({
        error: true,
        mensaje: `El correo ${correo} no está autorizado en esta cuenta. Pide a Ambiente y Salud que te agreguen.`,
      });
    }
    const sesion = await emitirSesion(usuario, persona);
    anotar(usuario, `${persona.nombre} (${correo}) entró con la cuenta ${usuario.email}`);
    return res.json(sesion);
  }

  // Entrada directa con el correo personal (personal de ASA)
  const { data: usuarios } = await supabase.from("asa_usuarios").select("*").ilike("email", correo.replace(/[%_\\]/g, "\\$&")).eq("activo", true).limit(2);
  const usuario = (usuarios || []).find((u) => String(u.email).toLowerCase() === correo);
  if (usuario) {
    if (usuario.rol === "cliente_calidad" && (await personasActivas(usuario.id)).length) return res.json(pedirPersona(usuario));
    const sesion = await emitirSesion(usuario);
    anotar(usuario, `${usuario.nombre_completo} entró con su correo (${correo})`);
    return res.json(sesion);
  }

  // Es una persona de un hotel: primero va la clave de la cuenta del hotel
  const { data: deHotel } = await supabase.from("asa_usuario_personas").select("id").ilike("email", correo.replace(/[%_\\]/g, "\\$&")).eq("activo", true).limit(1);
  if (deHotel?.length) {
    return res.status(403).json({ error: true, mensaje: "Primero entra con el correo y la clave del hotel; después te pide tu correo." });
  }
  anotar(null, `Intento de entrada rechazado: ${correo} no tiene cuenta`);
  return res.status(403).json({ error: true, mensaje: `El correo ${correo} no tiene acceso. Pide a Ambiente y Salud que lo registren.` });
});

// GET /usuarios/me — requiere token
router.get("/me", requireAuth, async (req, res) => {
  const { data, error } = await supabase.from("asa_usuarios").select("id, email, nombre_completo, rol, cliente_id, empleado_id").eq("id", req.usuario.id).maybeSingle();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// GET /usuarios — solo admin: listar personal interno
router.get("/", requireAuth, requireRol("admin"), async (req, res) => {
  const { data, error } = await supabase.from("asa_usuarios").select("id, email, nombre_completo, rol, activo, ultimo_acceso").neq("rol", "cliente");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// POST /usuarios — solo admin: crear usuario de personal interno
router.post("/", requireAuth, requireRol("admin"), async (req, res) => {
  const { email, password, nombre_completo, rol, empleado_id } = req.body;
  const password_hash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase.from("asa_usuarios").insert([{ email, password_hash, nombre_completo, rol, empleado_id }]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  data.empleado_id = await vincularEmpleado(data);
  const { password_hash: _omit, ...usuario } = data;
  res.status(201).json(usuario);
});

// ─────────────────────────────────────────────────────────────────────────────
// Cuentas del personal de calidad del hotel
//
// ASA crea tantas cuentas como necesite cada hotel. Cada cuenta ve, en tiempo
// real y solo de lectura, lo que se ha hecho en los hoteles que se le asignen.
// ─────────────────────────────────────────────────────────────────────────────

// GET /usuarios/portal?sitio_id= — cuentas de hotel y sus sitios asignados
router.get("/portal", requireAuth, requireRol("admin", "comercial", "operaciones"), async (req, res) => {
  const { data, error } = await supabase
    .from("asa_usuarios")
    .select("id, email, nombre_completo, rol, activo, ultimo_acceso, asa_usuario_sitios(sitio_id, asa_sitios(id, nombre))")
    .eq("rol", "cliente_calidad")
    .order("nombre_completo");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  let lista = data || [];
  if (req.query.sitio_id) {
    lista = lista.filter((u) => (u.asa_usuario_sitios || []).some((s) => s.sitio_id === req.query.sitio_id));
  }
  res.json(lista);
});

// POST /usuarios/portal — crear una cuenta de calidad y asignarle hoteles
// Body: { email, password, nombre_completo, sitios: [sitio_id, ...] }
router.post("/portal", requireAuth, requireRol("admin", "comercial"), async (req, res) => {
  const { email, password, nombre_completo, sitios = [] } = req.body;
  if (!email || !password || !sitios.length) {
    return res.status(400).json({
      error: true,
      mensaje: "email, password y al menos un hotel (sitios) son requeridos",
    });
  }

  const password_hash = await bcrypt.hash(password, 10);
  const { data: usuario, error } = await supabase
    .from("asa_usuarios")
    .insert([{ email, password_hash, nombre_completo, rol: "cliente_calidad" }])
    .select("id, email, nombre_completo, rol, activo")
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const { error: errSitios } = await supabase
    .from("asa_usuario_sitios")
    .insert(sitios.map((sitio_id) => ({ usuario_id: usuario.id, sitio_id })));
  if (errSitios) {
    // Sin hoteles asignados la cuenta no sirve de nada: se revierte.
    await supabase.from("asa_usuarios").delete().eq("id", usuario.id);
    return res.status(500).json({ error: true, mensaje: errSitios.message });
  }

  res.status(201).json({ ...usuario, sitios });
});

// PUT /usuarios/portal/:id/sitios — cambiar los hoteles que ve una cuenta
router.put("/portal/:id/sitios", requireAuth, requireRol("admin", "comercial"), async (req, res) => {
  const { sitios = [] } = req.body;
  await supabase.from("asa_usuario_sitios").delete().eq("usuario_id", req.params.id);
  if (sitios.length) {
    const { error } = await supabase
      .from("asa_usuario_sitios")
      .insert(sitios.map((sitio_id) => ({ usuario_id: req.params.id, sitio_id })));
    if (error) return res.status(500).json({ error: true, mensaje: error.message });
  }
  res.json({ ok: true, usuario_id: req.params.id, sitios });
});

// PATCH /usuarios/:id/activo — desactivar o reactivar cualquier cuenta
router.patch("/:id/activo", requireAuth, requireRol("admin"), async (req, res) => {
  const { data, error } = await supabase
    .from("asa_usuarios")
    .update({ activo: !!req.body.activo })
    .eq("id", req.params.id)
    .select("id, email, nombre_completo, rol, activo")
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  olvidarVigencia();   // una cuenta desactivada pierde la sesión abierta al momento
  res.json(data);
});

// POST /usuarios/:id/password — restablecer contraseña
router.post("/:id/password", requireAuth, requireRol("admin"), async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: true, mensaje: "La contraseña debe tener al menos 8 caracteres" });
  }
  const password_hash = await bcrypt.hash(password, 10);
  const { error } = await supabase.from("asa_usuarios").update({ password_hash }).eq("id", req.params.id);
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edicion y borrado de cuentas
//
// ORDEN: todo lo de /portal/... queda ARRIBA de /:id. Express resuelve por
// orden de declaracion y un PATCH /usuarios/portal caeria en /:id con
// id="portal".
//
// Dos borrados distintos, como en el CRM:
//   · PATCH /:id/activo { activo:false } — dar de baja. La cuenta no puede
//     entrar, pero sigue ahi y se reactiva cuando haga falta.
//   · DELETE /:id — borrar de verdad. Se lleva sus hoteles asignados
//     (asa_usuario_sitios va con on delete cascade). Lo que hizo NO se pierde:
//     asa_log_auditoria guarda el nombre congelado y su usuario_id pasa a null.
// ─────────────────────────────────────────────────────────────────────────────

// PATCH /usuarios/portal/:id — datos de una cuenta de hotel (nombre, correo)
router.patch("/portal/:id", requireAuth, requireRol("admin", "comercial"), async (req, res) => {
  const cambios = {};
  if (req.body.nombre_completo !== undefined) cambios.nombre_completo = String(req.body.nombre_completo).trim();
  if (req.body.email !== undefined) cambios.email = String(req.body.email).trim().toLowerCase();
  if (req.body.activo !== undefined) cambios.activo = !!req.body.activo;
  if (!Object.keys(cambios).length) return res.status(400).json({ error: true, mensaje: "Nada que cambiar" });
  cambios.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("asa_usuarios")
    .update(cambios)
    .eq("id", req.params.id)
    .eq("rol", "cliente_calidad")   // esta ruta solo toca cuentas de hotel
    .select("id, email, nombre_completo, rol, activo");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  if (!data?.length) return res.status(404).json({ error: true, mensaje: "Cuenta de hotel no encontrada" });

  olvidarVigencia();
  logAccion(req, { accion: "actualizar", modulo: "accesos_hotel", registroId: req.params.id, descripcion: data[0].email });
  res.json(data[0]);
});

// POST /usuarios/portal/:id/password — cambiar la clave de una cuenta de hotel.
// Existe aparte de /usuarios/:id/password (que es solo de admin) para que
// comercial pueda resolverle la clave al encargado de calidad del hotel sin
// tener que darle permisos de administrador a comercial.
router.post("/portal/:id/password", requireAuth, requireRol("admin", "comercial"), async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: true, mensaje: "La contrasena debe tener al menos 8 caracteres" });
  }
  const password_hash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from("asa_usuarios")
    .update({ password_hash, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("rol", "cliente_calidad")
    .select("id, email");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  if (!data?.length) return res.status(404).json({ error: true, mensaje: "Cuenta de hotel no encontrada" });
  logAccion(req, { accion: "actualizar", modulo: "accesos_hotel", registroId: req.params.id, descripcion: `Clave cambiada a ${data[0].email}` });
  res.json({ ok: true });
});

// DELETE /usuarios/portal/:id — borra la cuenta de hotel y sus asignaciones
router.delete("/portal/:id", requireAuth, requireRol("admin", "comercial"), async (req, res) => {
  const { data: cuenta } = await supabase
    .from("asa_usuarios")
    .select("id, email, nombre_completo, rol")
    .eq("id", req.params.id)
    .maybeSingle();
  if (!cuenta) return res.status(404).json({ error: true, mensaje: "Cuenta no encontrada" });
  if (cuenta.rol !== "cliente_calidad") {
    return res.status(400).json({ error: true, mensaje: "Esa cuenta no es de acceso al hotel. Bórrala desde Usuarios." });
  }

  const { error } = await supabase.from("asa_usuarios").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  logAccion(req, { accion: "eliminar", modulo: "accesos_hotel", registroId: req.params.id, descripcion: cuenta.email });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Personas autorizadas en una cuenta de hotel
//
// La cuenta (hotel@ambienteysaludrd.com) es compartida. Cada gerente de calidad
// que la usa se registra aquí con su nombre y su correo personal. Al entrar,
// después de la clave, confirma con ese correo. Desactivarla le cierra la
// entrada al momento, aunque sepa la clave o tenga la sesión abierta.
// ─────────────────────────────────────────────────────────────────────────────
const PUEDE_PERSONAS = requireRol("admin", "comercial");
const correoValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const faltaMigracion41 = (error) =>
  /asa_usuario_personas/.test(error?.message || "") ? "Falta correr supabase/41_seguridad_y_accesos.sql" : error?.message;

// GET /usuarios/portal/:id/personas
router.get("/portal/:id/personas", requireAuth, requireRol("admin", "comercial", "operaciones"), async (req, res) => {
  const { data, error } = await supabase
    .from("asa_usuario_personas")
    .select("id, nombre, email, activo, ultimo_acceso, creado_por, created_at")
    .eq("usuario_id", req.params.id)
    .order("activo", { ascending: false })
    .order("nombre");
  if (error) return res.status(500).json({ error: true, mensaje: faltaMigracion41(error) });
  res.json(data || []);
});

// POST /usuarios/portal/:id/personas { nombre, email }
router.post("/portal/:id/personas", requireAuth, PUEDE_PERSONAS, async (req, res) => {
  const nombre = String(req.body?.nombre || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!nombre || !correoValido(email)) return res.status(400).json({ error: true, mensaje: "Pon el nombre y un correo válido" });
  // Sin esto la cuenta del hotel quedaría trancada: pediría el paso 2 y no
  // habría cómo hacerlo.
  if (!accesoCorreoConfigurado()) {
    return res.status(400).json({ error: true, mensaje: "Primero configura el acceso con correo en el servidor (variable SUPABASE_ANON_KEY en Railway). Sin eso las personas no podrían entrar." });
  }
  const { data: cuenta } = await supabase.from("asa_usuarios").select("id, email, rol").eq("id", req.params.id).maybeSingle();
  if (!cuenta || cuenta.rol !== "cliente_calidad") return res.status(404).json({ error: true, mensaje: "Cuenta de hotel no encontrada" });

  // Si ya estuvo (y se desactivó), se reactiva en vez de duplicarla
  const { data: previa } = await supabase.from("asa_usuario_personas").select("id").eq("usuario_id", cuenta.id).ilike("email", email.replace(/[%_\\]/g, "\\$&")).maybeSingle();
  const fila = { nombre, email, activo: true, updated_at: new Date().toISOString() };
  const { data, error } = previa
    ? await supabase.from("asa_usuario_personas").update(fila).eq("id", previa.id).select().single()
    : await supabase.from("asa_usuario_personas").insert([{ ...fila, usuario_id: cuenta.id, creado_por: req.usuario?.nombre || null }]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: faltaMigracion41(error) });
  logAccion(req, { accion: "crear", modulo: "accesos_hotel", registroId: cuenta.id, descripcion: `Autorizada ${nombre} (${email}) en ${cuenta.email}` });
  res.status(201).json(data);
});

// PATCH /usuarios/portal/personas/:pid { activo?, nombre? }
router.patch("/portal/personas/:pid", requireAuth, PUEDE_PERSONAS, async (req, res) => {
  const cambios = { updated_at: new Date().toISOString() };
  if (req.body?.activo !== undefined) cambios.activo = !!req.body.activo;
  if (req.body?.nombre !== undefined) cambios.nombre = String(req.body.nombre).trim();
  const { data, error } = await supabase.from("asa_usuario_personas").update(cambios).eq("id", req.params.pid).select().maybeSingle();
  if (error) return res.status(500).json({ error: true, mensaje: faltaMigracion41(error) });
  if (!data) return res.status(404).json({ error: true, mensaje: "Persona no encontrada" });
  olvidarVigencia();
  logAccion(req, {
    accion: "actualizar", modulo: "accesos_hotel", registroId: data.usuario_id,
    descripcion: cambios.activo === false ? `Acceso retirado a ${data.nombre} (${data.email})` : `Persona ${data.nombre} (${data.email}) actualizada`,
  });
  res.json(data);
});

// DELETE /usuarios/portal/personas/:pid — la borra de la lista
router.delete("/portal/personas/:pid", requireAuth, PUEDE_PERSONAS, async (req, res) => {
  const { data, error } = await supabase.from("asa_usuario_personas").delete().eq("id", req.params.pid).select().maybeSingle();
  if (error) return res.status(500).json({ error: true, mensaje: faltaMigracion41(error) });
  if (!data) return res.status(404).json({ error: true, mensaje: "Persona no encontrada" });
  olvidarVigencia();
  logAccion(req, { accion: "eliminar", modulo: "accesos_hotel", registroId: data.usuario_id, descripcion: `Borrada ${data.nombre} (${data.email})` });
  res.json({ ok: true });
});

// PATCH /usuarios/:id — nombre, correo, rol y empleado del personal interno
router.patch("/:id", requireAuth, requireRol("admin"), async (req, res) => {
  const cambios = {};
  if (req.body.nombre_completo !== undefined) cambios.nombre_completo = String(req.body.nombre_completo).trim();
  if (req.body.email !== undefined) cambios.email = String(req.body.email).trim().toLowerCase();
  if (req.body.empleado_id !== undefined) cambios.empleado_id = req.body.empleado_id || null;
  if (req.body.activo !== undefined) cambios.activo = !!req.body.activo;
  if (req.body.rol !== undefined) {
    if (!ROLES_INTERNOS.includes(req.body.rol)) {
      return res.status(400).json({ error: true, mensaje: `Rol no valido. Validos: ${ROLES_INTERNOS.join(", ")}` });
    }
    cambios.rol = req.body.rol;
  }
  if (!Object.keys(cambios).length) return res.status(400).json({ error: true, mensaje: "Nada que cambiar" });
  cambios.updated_at = new Date().toISOString();

  // Quedarse sin ningun admin activo deja el sistema sin quien administre, y no
  // hay forma de arreglarlo desde la interfaz: se bloquea antes de escribir.
  if (cambios.rol && cambios.rol !== "admin") {
    if (await esElUltimoAdmin(req.params.id)) {
      return res.status(409).json({ error: true, mensaje: "Es el unico administrador activo. Crea otro admin antes de cambiarle el rol." });
    }
  }
  if (cambios.activo === false && (await esElUltimoAdmin(req.params.id))) {
    return res.status(409).json({ error: true, mensaje: "Es el unico administrador activo: no se puede dar de baja." });
  }

  const { data, error } = await supabase
    .from("asa_usuarios")
    .update(cambios)
    .eq("id", req.params.id)
    .select("id, email, nombre_completo, rol, activo, ultimo_acceso, empleado_id");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  if (!data?.length) return res.status(404).json({ error: true, mensaje: "Usuario no encontrado" });
  // Si pasó a ser técnico, queda con su ficha de empleado desde ya.
  await vincularEmpleado(data[0]);

  logAccion(req, { accion: "actualizar", modulo: "usuarios", registroId: req.params.id, descripcion: data[0].email, detalle: { campos: Object.keys(cambios) } });
  res.json(data[0]);
});

// DELETE /usuarios/:id — borrado real de una cuenta de personal interno
router.delete("/:id", requireAuth, requireRol("admin"), async (req, res) => {
  if (req.params.id === req.usuario?.id) {
    return res.status(400).json({ error: true, mensaje: "No puedes borrar tu propia cuenta mientras la estas usando." });
  }
  const { data: cuenta } = await supabase
    .from("asa_usuarios")
    .select("id, email, nombre_completo, rol")
    .eq("id", req.params.id)
    .maybeSingle();
  if (!cuenta) return res.status(404).json({ error: true, mensaje: "Usuario no encontrado" });
  if (await esElUltimoAdmin(req.params.id)) {
    return res.status(409).json({ error: true, mensaje: "Es el unico administrador activo: crea otro antes de borrarlo." });
  }

  const { error } = await supabase.from("asa_usuarios").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  logAccion(req, { accion: "eliminar", modulo: "usuarios", registroId: req.params.id, descripcion: `${cuenta.nombre_completo} <${cuenta.email}>` });
  res.json({ ok: true });
});

async function esElUltimoAdmin(id) {
  const { data } = await supabase.from("asa_usuarios").select("id").eq("rol", "admin").eq("activo", true);
  const admins = (data || []).map((u) => u.id);
  return admins.length <= 1 && admins.includes(id);
}

export default router;
