// app.js — Ambiente y Salud RD (ASA SRL) — Panel administrativo
// SPA sin build step (mismo patrón que solido-web/index.html): fetch directo
// a la API (CONFIG.API_BASE) con {cache:"no-store"} para que los cambios en
// el backend/Supabase se reflejen de inmediato, sin caché del navegador.
//
// Autenticación: JWT emitido por POST /usuarios/login (backend/routes/usuarios.js),
// guardado en localStorage (app real desplegada, no es un artifact de Claude).

// ── Login obligatorio ────────────────────────────────────────────────────
// Antes había aquí un DEMO_SKIP_LOGIN=true que entraba al panel como admin sin
// pedir credenciales. Con el portal abierto al personal de los hoteles eso ya
// no es aceptable: el backend exige token en todas las rutas y el panel pide
// login siempre. Crea el primer admin con:
//     cd backend && node scripts/crear-admin.mjs <email> "<nombre>" "<clave>"
const DEMO_SKIP_LOGIN = false;

// ── Estado ───────────────────────────────────────────────────────────────
let TOKEN = localStorage.getItem("asa_token") || null;
let USUARIO = JSON.parse(localStorage.getItem("asa_usuario") || "null");
let CLIENTES_CACHE = null; // [{id, nombre_contacto, razon_social, rnc_cedula}]
let MASCOTAS_CACHE = null;
let ACTIVE_MODULE = "dashboard";

// ── Helpers DOM ──────────────────────────────────────────────────────────
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function h(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function fmtMoney(n) {
  const v = Number(n || 0);
  return "RD$ " + v.toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("es-DO"); } catch { return d; }
}
function fmtDateTime(d) {
  if (!d) return "—";
  try { return new Date(d).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" }); } catch { return d; }
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const BADGE_MAP = {
  // estados de orden de trabajo (plagas)
  solicitada: "badge-warn", agendada: "badge-cyan", en_ruta: "badge-cyan", en_sitio: "badge-cyan",
  ejecutada: "badge-green", control_calidad: "badge-cyan", facturada: "badge-green", cerrada: "badge-gray", cancelada: "badge-red",
  // citas
  confirmada: "badge-green", en_curso: "badge-cyan", completada: "badge-green", no_asistio: "badge-red",
  // facturas / dgii
  pendiente: "badge-warn", en_proceso: "badge-cyan", aceptado: "badge-green", rechazado: "badge-red",
  contingencia: "badge-warn", anulado: "badge-red", anulada: "badge-red", emitida: "badge-cyan", pagada: "badge-green",
  parcial: "badge-warn", vencida: "badge-red", borrador: "badge-gray",
  // permisos
  vigente: "badge-green", por_vencer: "badge-warn", vencido: "badge-red", en_tramite: "badge-cyan",
};
function badge(valor) {
  if (!valor) return '<span class="badge badge-gray">—</span>';
  const cls = BADGE_MAP[valor] || "badge-gray";
  return `<span class="badge ${cls}">${esc(valor.replace(/_/g, " "))}</span>`;
}

function toast(msg, isError = false) {
  let el = $("#asa-toast");
  if (!el) {
    el = h(`<div id="asa-toast" class="toast"></div>`);
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = "toast show" + (isError ? " error" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.className = "toast"), 3500);
}

// ── API ──────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

  let res;
  try {
    res = await fetch(`${CONFIG.API_BASE}${path}`, { cache: "no-store", ...opts, headers });
  } catch (errRed) {
    // Aquí NO hubo respuesta del servidor: el navegador no logró conectar.
    // El mensaje nativo ("fetch failed" / "Failed to fetch") no dice nada útil,
    // así que lo traducimos a la causa real, que casi siempre es una de dos.
    const esLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(CONFIG.API_BASE);
    const sinConfigurar = /REEMPLAZA/i.test(CONFIG.API_BASE);
    let msg;
    if (sinConfigurar) {
      msg =
        "El panel no sabe a qué API conectarse: panel-web/config.js todavía " +
        "tiene la URL de ejemplo. Reemplázala por la URL real de Railway.";
    } else if (esLocal) {
      msg =
        `No hay respuesta de ${CONFIG.API_BASE}. El backend no está corriendo. ` +
        "Abre una terminal en la carpeta backend/ y ejecuta: npm start " +
        "(déjala abierta mientras usas el panel).";
    } else {
      msg =
        `No se pudo conectar con ${CONFIG.API_BASE}. Puede ser que el servicio ` +
        "esté caído, o que tu dominio no esté en CORS_ORIGINS del backend. " +
        "Mira la consola (F12) para ver si el error menciona CORS.";
    }
    console.error("[ASA] Fallo de conexión con la API:", errRed);
    throw new Error(msg);
  }

  let data = null;
  try { data = await res.json(); } catch { /* respuesta vacía */ }
  if (res.status === 401) {
    logout("Tu sesión expiró. Inicia sesión de nuevo.");
    throw new Error("No autenticado");
  }
  if (!res.ok) {
    throw new Error((data && data.mensaje) || `Error ${res.status} en ${path}`);
  }
  return data;
}
const get = (path) => api(path);
const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body) });
const put = (path, body) => api(path, { method: "PUT", body: JSON.stringify(body) });
const patch = (path, body) => api(path, { method: "PATCH", body: JSON.stringify(body) });

// ── Auth ─────────────────────────────────────────────────────────────────
function logout(msg) {
  TOKEN = null; USUARIO = null;
  localStorage.removeItem("asa_token"); localStorage.removeItem("asa_usuario");
  renderLogin(msg);
}

async function handleLogin(e) {
  e.preventDefault();
  const email = $("#login-email").value.trim();
  const password = $("#login-password").value;
  const btn = $("#login-btn");
  const err = $("#login-error");
  err.style.display = "none";
  btn.disabled = true; btn.textContent = "Entrando…";
  try {
    const data = await api("/usuarios/login", { method: "POST", body: JSON.stringify({ email, password }) });
    TOKEN = data.token; USUARIO = data.usuario;
    if (USUARIO.rol === "cliente") {
      throw new Error("Este panel es solo para personal interno. Usa la app de clientes.");
    }
    localStorage.setItem("asa_token", TOKEN);
    localStorage.setItem("asa_usuario", JSON.stringify(USUARIO));
    renderShell();
  } catch (e2) {
    err.textContent = e2.message || "No se pudo iniciar sesión";
    err.style.display = "block";
    TOKEN = null; USUARIO = null;
  } finally {
    btn.disabled = false; btn.textContent = "Entrar";
  }
}

function renderLogin(msg) {
  document.body.innerHTML = `
    <div class="login-wrap">
      <form class="login-card" id="login-form">
        <img class="login-logo" src="assets/logo-asa.png" alt="${CONFIG.NOMBRE_SISTEMA}" />
        <p class="sub">Panel administrativo</p>
        <label for="login-email">Correo</label>
        <input id="login-email" type="email" autocomplete="username" required />
        <label for="login-password">Contraseña</label>
        <input id="login-password" type="password" autocomplete="current-password" required />
        <button id="login-btn" class="btn-login" type="submit">Entrar</button>
        <div class="login-error" id="login-error"></div>
      </form>
    </div>`;
  if (msg) { const err = $("#login-error"); err.textContent = msg; err.style.display = "block"; }
  $("#login-form").addEventListener("submit", handleLogin);
}

// ── Módulos / navegación ─────────────────────────────────────────────────
// Secciones del menú. El orden de este array es el orden en pantalla.
const SECCIONES = [
  { key: "operacion",  label: "Operación" },
  { key: "catalogos",  label: "Catálogos" },
  { key: "admin",      label: "Administración" },
];

// Módulos ACTIVOS. Los de veterinaria, estética, POS, facturación,
// contabilidad y nómina quedaron congelados: su código sigue en este archivo
// (viewMascotas, viewCitas, ... más abajo) y sus rutas siguen vivas en el
// backend, pero no se muestran. Para reactivar uno, devuélvelo a esta lista.
const MODULES = [
  { key: "dashboard",      label: "Dashboard",      ic: "📊", seccion: "operacion", roles: null,      view: viewDashboard },
  { key: "clientes",       label: "Clientes",       ic: "🏨", seccion: "operacion", roles: null,      view: viewClientes },
  { key: "usuarios",       label: "Usuarios",       ic: "🔐", seccion: "admin",     roles: ["admin"], view: viewUsuarios },
  { key: "notificaciones", label: "Notificaciones", ic: "🔔", seccion: "admin",     roles: null,      view: viewNotificaciones },
];

// Congelados a propósito (ver comentario arriba). Se deja la lista escrita
// para que se vea qué existe y no se reimplemente por error:
//   mascotas, citas, plagas, ipm, estetica, inventario, pos,
//   facturacion, contabilidad, nomina
const MODULOS_CONGELADOS = [
  "mascotas", "citas", "plagas", "ipm", "estetica",
  "inventario", "pos", "facturacion", "contabilidad", "nomina",
];
function modulosPermitidos() {
  return MODULES.filter((m) => !m.roles || m.roles.includes(USUARIO.rol));
}

function renderShell() {
  document.body.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <img src="assets/logo-asa.png" alt="${CONFIG.NOMBRE_SISTEMA} (${CONFIG.SIGLAS})" />
        </div>
        <nav class="nav" id="nav"></nav>
        <div class="sidebar-foot">API: ${CONFIG.API_BASE.replace(/^https?:\/\//, "")}</div>
      </aside>
      <div class="main">
        <div class="topbar">
          <div class="titulo" id="titulo-modulo">Dashboard</div>
          <div class="quien">
            <span>${esc(USUARIO.nombre || "")}</span>
            <span class="rol-badge">${esc(USUARIO.rol || "")}</span>
            <button class="btn-logout" id="btn-logout">Cerrar sesión</button>
          </div>
        </div>
        <div class="content" id="content"></div>
      </div>
    </div>`;

  const nav = $("#nav");
  const permitidos = modulosPermitidos();
  SECCIONES.forEach((sec) => {
    const deLaSeccion = permitidos.filter((m) => m.seccion === sec.key);
    if (!deLaSeccion.length) return; // una sección sin módulos visibles no se dibuja
    const grupo = h(`<div class="nav-section"><div class="nav-section-title">${esc(sec.label)}</div></div>`);
    deLaSeccion.forEach((m) => {
      const item = h(`<div class="nav-item" data-key="${m.key}"><span class="ic">${m.ic}</span><span>${m.label}</span></div>`);
      item.addEventListener("click", () => navigate(m.key));
      grupo.appendChild(item);
    });
    nav.appendChild(grupo);
  });
  $("#btn-logout").addEventListener("click", () => logout());
  navigate("dashboard");
}

function navigate(key) {
  ACTIVE_MODULE = key;
  $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.key === key));
  const mod = MODULES.find((m) => m.key === key);
  $("#titulo-modulo").textContent = mod ? mod.label : "";
  const content = $("#content");
  content.innerHTML = `<div class="center-msg">Cargando…</div>`;
  Promise.resolve(mod.view(content)).catch((e) => {
    content.innerHTML = `<div class="card"><div class="form-error">${esc(e.message)}</div></div>`;
  });
}

// ── Modal genérico ───────────────────────────────────────────────────────
function openModal({ title, bodyHTML, large, onMount, onSubmit, submitLabel = "Guardar" }) {
  closeModal();
  const overlay = h(`
    <div class="modal-overlay" id="asa-modal-overlay">
      <div class="modal ${large ? "modal-lg" : ""}">
        <div class="modal-head"><h3>${esc(title)}</h3><button class="modal-close" id="asa-modal-close">×</button></div>
        <form id="asa-modal-form">
          <div class="modal-body">
            <div class="form-error" id="asa-modal-error" style="display:none"></div>
            ${bodyHTML}
          </div>
          <div class="modal-foot">
            <button type="button" class="btn" id="asa-modal-cancel">Cancelar</button>
            <button type="submit" class="btn btn-primary" id="asa-modal-submit">${submitLabel}</button>
          </div>
        </form>
      </div>
    </div>`);
  document.body.appendChild(overlay);
  $("#asa-modal-close").addEventListener("click", closeModal);
  $("#asa-modal-cancel").addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  if (onMount) onMount(overlay);
  if (onSubmit) {
    $("#asa-modal-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = $("#asa-modal-error");
      const btn = $("#asa-modal-submit");
      errEl.style.display = "none";
      btn.disabled = true;
      try {
        await onSubmit(new FormData(e.target), overlay);
      } catch (err) {
        errEl.textContent = err.message || "Ocurrió un error";
        errEl.style.display = "block";
        btn.disabled = false;
      }
    });
  }
  return overlay;
}
function closeModal() {
  const ov = $("#asa-modal-overlay");
  if (ov) ov.remove();
}

// ── Tabla genérica ───────────────────────────────────────────────────────
function tableHTML(columns, rows, emptyText = "Sin registros todavía.") {
  if (!rows || !rows.length) return `<div class="empty-row">${esc(emptyText)}</div>`;
  const head = columns.map((c) => `<th>${esc(c.label)}</th>`).join("");
  const body = rows
    .map((r) => {
      const cells = columns.map((c) => `<td>${c.fmt ? c.fmt(r) : esc(r[c.key] ?? "—")}</td>`).join("");
      return `<tr data-id="${esc(r.id ?? "")}" class="${r._clickable === false ? "" : "clickable"}">${cells}</tr>`;
    })
    .join("");
  return `<div class="table-wrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// ── Caches de referencia (para selects) ──────────────────────────────────
async function getClientesCache(force = false) {
  if (!CLIENTES_CACHE || force) CLIENTES_CACHE = await get("/clientes");
  return CLIENTES_CACHE;
}
async function getMascotasCache(force = false) {
  if (!MASCOTAS_CACHE || force) MASCOTAS_CACHE = await get("/mascotas");
  return MASCOTAS_CACHE;
}
function clienteLabel(c) {
  return c.razon_social ? `${c.razon_social} (${c.nombre_contacto})` : c.nombre_contacto;
}
function optionsHTML(items, valueKey, labelFn, placeholder = "Selecciona…") {
  return (
    `<option value="">${esc(placeholder)}</option>` +
    items.map((i) => `<option value="${esc(i[valueKey])}">${esc(labelFn(i))}</option>`).join("")
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════
async function viewDashboard(content) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [clientes, ordenesAbiertas, citasHoy, alertas, facturasPend] = await Promise.all([
    get("/clientes").catch(() => []),
    get("/plagas/ordenes?estado=solicitada").catch(() => []),
    get(`/citas?desde=${hoy}T00:00:00&hasta=${hoy}T23:59:59`).catch(() => []),
    get("/inventario/alertas-stock").catch(() => []),
    get("/facturacion?estado=pendiente").catch(() => []),
  ]);

  content.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card g"><div class="lbl">Clientes activos</div><div class="val">${clientes.length}</div></div>
      <div class="kpi-card w"><div class="lbl">Órdenes de plagas por atender</div><div class="val">${ordenesAbiertas.length}</div></div>
      <div class="kpi-card c"><div class="lbl">Citas de hoy</div><div class="val">${citasHoy.length}</div></div>
      <div class="kpi-card t"><div class="lbl">Alertas de stock bajo</div><div class="val">${alertas.length}</div></div>
      <div class="kpi-card w"><div class="lbl">Facturas pendientes de cobro</div><div class="val">${facturasPend.length}</div></div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Órdenes de plagas — solicitadas sin agendar</h2></div>
      ${tableHTML(
        [
          { key: "numero_orden", label: "Orden" },
          { key: "cliente", label: "Cliente", fmt: (r) => esc(r.asa_clientes?.nombre_contacto || "—") },
          { key: "tipo_plaga_reportada", label: "Tipo de plaga" },
          { key: "prioridad", label: "Prioridad", fmt: (r) => badge(r.prioridad) },
          { key: "created_at", label: "Reportada", fmt: (r) => fmtDateTime(r.created_at) },
        ],
        ordenesAbiertas,
        "No hay órdenes pendientes por agendar. 🎉"
      )}
    </div>
    <div class="card">
      <div class="card-head"><h2>Alertas de inventario (stock por debajo del mínimo)</h2></div>
      ${tableHTML(
        [
          { key: "tipo_item", label: "Tipo" },
          { key: "nombre", label: "Producto", fmt: (r) => esc(r.nombre_comercial || r.nombre || "—") },
          { key: "stock_actual", label: "Stock actual" },
          { key: "stock_minimo", label: "Mínimo" },
        ],
        alertas,
        "Inventario dentro de los niveles mínimos."
      )}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════
// CLIENTES
// ═══════════════════════════════════════════════════════════════════════
async function viewClientes(content) {
  content.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Clientes</h2>
        <div class="actions">
          <button class="btn btn-primary" id="btn-nuevo-cliente">+ Nuevo cliente</button>
        </div>
      </div>
      <div class="toolbar">
        <input type="search" id="buscar-cliente" placeholder="Buscar por nombre, razón social o RNC/cédula…" />
      </div>
      <div id="clientes-tabla"></div>
    </div>`;

  async function cargar(buscar) {
    const data = await get(`/clientes${buscar ? `?buscar=${encodeURIComponent(buscar)}` : ""}`);
    CLIENTES_CACHE = data;
    $("#clientes-tabla").innerHTML = tableHTML(
      [
        { key: "nombre_contacto", label: "Contacto" },
        { key: "razon_social", label: "Razón social / comercial", fmt: (r) => esc(r.razon_social || r.nombre_comercial || "—") },
        { key: "rnc_cedula", label: "RNC / Cédula" },
        { key: "tipo_cliente", label: "Tipo", fmt: (r) => badge(r.tipo_cliente) },
        { key: "telefono", label: "Teléfono" },
        { key: "email", label: "Correo" },
      ],
      data,
      "No hay clientes registrados todavía."
    );
    $("#clientes-tabla").querySelectorAll("tr[data-id]").forEach((tr) => {
      tr.addEventListener("click", () => abrirDetalleCliente(tr.dataset.id));
    });
  }
  await cargar();

  let t;
  $("#buscar-cliente").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => cargar(e.target.value.trim()), 300);
  });
  $("#btn-nuevo-cliente").addEventListener("click", () => modalNuevoCliente(cargar));
}

function modalNuevoCliente(onSaved) {
  openModal({
    title: "Nuevo cliente",
    bodyHTML: `
      <div class="form-grid">
        <div class="form-group"><label>Tipo de documento</label>
          <select name="tipo_documento"><option value="CEDULA">Cédula</option><option value="RNC">RNC</option><option value="PASAPORTE">Pasaporte</option></select>
        </div>
        <div class="form-group"><label>RNC / Cédula</label>
          <div style="display:flex;gap:6px">
            <input name="rnc_cedula" id="f-rnc" />
            <button type="button" class="btn btn-sm" id="btn-buscar-rnc">Buscar en DGII</button>
          </div>
          <div class="form-hint" id="rnc-hint"></div>
        </div>
        <div class="form-group"><label>Nombre de contacto *</label><input name="nombre_contacto" id="f-nombre" required /></div>
        <div class="form-group"><label>Razón social (si es empresa)</label><input name="razon_social" id="f-razon" /></div>
        <div class="form-group"><label>Tipo de cliente</label>
          <select name="tipo_cliente"><option value="particular">Particular</option><option value="empresa">Empresa</option><option value="gobierno">Gobierno</option></select>
        </div>
        <div class="form-group"><label>Teléfono</label><input name="telefono" id="f-tel" /></div>
        <div class="form-group"><label>WhatsApp</label><input name="telefono_whatsapp" /></div>
        <div class="form-group"><label>Correo</label><input name="email" type="email" id="f-email" /></div>
        <div class="form-group full"><label>Dirección</label><input name="direccion" id="f-dir" /></div>
        <div class="form-group full"><label>Notas</label><textarea name="notas"></textarea></div>
      </div>`,
    onMount: () => {
      $("#btn-buscar-rnc").addEventListener("click", async () => {
        const rnc = $("#f-rnc").value.trim();
        const hint = $("#rnc-hint");
        if (!rnc) return;
        hint.textContent = "Consultando DGII…";
        try {
          const r = await get(`/rnc/${encodeURIComponent(rnc)}`);
          const d = r.datos;
          $("#f-razon").value = d.razonSocial || "";
          if (!$("#f-nombre").value) $("#f-nombre").value = d.nombreComercial || d.razonSocial || "";
          hint.textContent = `Encontrado (${d.fuente}): estado ${d.estado || "N/D"}`;
        } catch (e) {
          hint.textContent = e.message;
        }
      });
    },
    onSubmit: async (fd) => {
      const body = Object.fromEntries(fd.entries());
      Object.keys(body).forEach((k) => { if (body[k] === "") delete body[k]; });
      await post("/clientes", body);
      closeModal();
      toast("Cliente creado");
      onSaved();
    },
  });
}

async function abrirDetalleCliente(id) {
  const c = await get(`/clientes/${id}`);
  openModal({
    title: clienteLabel(c),
    large: true,
    bodyHTML: `
      <p class="muted">${esc(c.telefono || "Sin teléfono")} · ${esc(c.email || "Sin correo")} · ${esc(c.direccion || "Sin dirección")}</p>
      <h4>Sitios (línea de plagas)</h4>
      ${tableHTML([{ key: "nombre", label: "Nombre" }, { key: "direccion", label: "Dirección" }, { key: "tipo_sitio", label: "Tipo", fmt: (r) => badge(r.tipo_sitio) }], c.sitios, "Sin sitios registrados.")}
      <h4 style="margin-top:16px">Mascotas</h4>
      ${tableHTML([{ key: "nombre", label: "Nombre" }, { key: "especie", label: "Especie" }, { key: "raza", label: "Raza" }], c.mascotas, "Sin mascotas registradas.")}
    `,
  });
  $(".modal-foot")?.remove();
}

// ═══════════════════════════════════════════════════════════════════════
// MASCOTAS / VETERINARIA (fichas)
// ═══════════════════════════════════════════════════════════════════════
async function viewMascotas(content) {
  content.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Mascotas — control por animal</h2>
        <div class="actions"><button class="btn btn-primary" id="btn-nueva-mascota">+ Nueva mascota</button></div>
      </div>
      <div id="mascotas-tabla"></div>
    </div>`;

  async function cargar() {
    const [data, clientes] = await Promise.all([get("/mascotas"), getClientesCache()]);
    const porId = Object.fromEntries(clientes.map((c) => [c.id, c]));
    $("#mascotas-tabla").innerHTML = tableHTML(
      [
        { key: "nombre", label: "Nombre" },
        { key: "especie", label: "Especie" },
        { key: "raza", label: "Raza" },
        { key: "dueno", label: "Dueño", fmt: (r) => esc(porId[r.cliente_id] ? clienteLabel(porId[r.cliente_id]) : "—") },
        { key: "esterilizado", label: "Esterilizado", fmt: (r) => (r.esterilizado ? "Sí" : "No") },
      ],
      data,
      "No hay mascotas registradas."
    );
    $("#mascotas-tabla").querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", () => abrirFichaMascota(tr.dataset.id)));
  }
  await cargar();
  $("#btn-nueva-mascota").addEventListener("click", () => modalNuevaMascota(cargar));
}

async function modalNuevaMascota(onSaved) {
  const clientes = await getClientesCache();
  openModal({
    title: "Nueva mascota",
    bodyHTML: `
      <div class="form-grid">
        <div class="form-group full"><label>Dueño (cliente) *</label>
          <select name="cliente_id" required>${optionsHTML(clientes, "id", clienteLabel)}</select>
        </div>
        <div class="form-group"><label>Nombre *</label><input name="nombre" required /></div>
        <div class="form-group"><label>Especie</label><select name="especie"><option value="canino">Canino</option><option value="felino">Felino</option><option value="otro">Otro</option></select></div>
        <div class="form-group"><label>Raza</label><input name="raza" /></div>
        <div class="form-group"><label>Sexo</label><select name="sexo"><option value="desconocido">Desconocido</option><option value="macho">Macho</option><option value="hembra">Hembra</option></select></div>
        <div class="form-group"><label>Fecha de nacimiento</label><input type="date" name="fecha_nacimiento" /></div>
        <div class="form-group"><label>Peso (kg)</label><input type="number" step="0.1" name="peso_kg" /></div>
        <div class="form-group"><label>Microchip</label><input name="microchip" /></div>
        <div class="form-group full"><label>Alergias</label><input name="alergias" /></div>
      </div>`,
    onSubmit: async (fd) => {
      const body = Object.fromEntries(fd.entries());
      Object.keys(body).forEach((k) => { if (body[k] === "") delete body[k]; });
      await post("/mascotas", body);
      closeModal(); toast("Mascota registrada"); onSaved();
    },
  });
}

async function abrirFichaMascota(id) {
  const m = await get(`/mascotas/${id}`);
  openModal({
    title: `${m.nombre} — ficha clínica`,
    large: true,
    submitLabel: null,
    bodyHTML: `
      <p class="muted">${esc(m.especie)} · ${esc(m.raza || "raza no especificada")} · ${m.peso_kg ? m.peso_kg + " kg" : ""}</p>
      <h4>Tratamientos / vacunas aplicadas</h4>
      ${tableHTML(
        [
          { key: "tratamiento", label: "Tratamiento", fmt: (r) => esc(r.asa_tratamientos_catalogo?.nombre || "—") },
          { key: "fecha_aplicacion", label: "Fecha", fmt: (r) => fmtDate(r.fecha_aplicacion) },
          { key: "proxima_fecha", label: "Próxima dosis", fmt: (r) => fmtDate(r.proxima_fecha) },
        ],
        m.tratamientos,
        "Sin tratamientos registrados."
      )}
      <h4 style="margin-top:16px">Historial clínico (fichas)</h4>
      ${tableHTML(
        [
          { key: "fecha", label: "Fecha", fmt: (r) => fmtDate(r.fecha) },
          { key: "motivo", label: "Motivo" },
          { key: "diagnostico", label: "Diagnóstico" },
        ],
        m.fichas_clinicas,
        "Sin fichas clínicas registradas."
      )}
      <h4 style="margin-top:16px">Citas</h4>
      ${tableHTML(
        [
          { key: "fecha_hora", label: "Fecha", fmt: (r) => fmtDateTime(r.fecha_hora) },
          { key: "tipo_servicio", label: "Servicio" },
          { key: "estado", label: "Estado", fmt: (r) => badge(r.estado) },
        ],
        m.citas,
        "Sin citas registradas."
      )}`,
  });
  $(".modal-foot")?.remove();
}

// ═══════════════════════════════════════════════════════════════════════
// CITAS
// ═══════════════════════════════════════════════════════════════════════
async function viewCitas(content) {
  content.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Citas — consultas, vacunación, estética</h2>
        <div class="actions"><button class="btn btn-primary" id="btn-nueva-cita">+ Agendar cita</button></div>
      </div>
      <div class="toolbar">
        <select id="filtro-estado-cita">
          <option value="">Todos los estados</option>
          <option value="solicitada">Solicitada</option>
          <option value="confirmada">Confirmada</option>
          <option value="en_curso">En curso</option>
          <option value="completada">Completada</option>
          <option value="cancelada">Cancelada</option>
          <option value="no_asistio">No asistió</option>
        </select>
      </div>
      <div id="citas-tabla"></div>
    </div>`;

  async function cargar(estado) {
    const data = await get(`/citas${estado ? `?estado=${estado}` : ""}`);
    $("#citas-tabla").innerHTML = tableHTML(
      [
        { key: "fecha_hora", label: "Fecha y hora", fmt: (r) => fmtDateTime(r.fecha_hora) },
        { key: "mascota", label: "Mascota", fmt: (r) => esc(r.asa_mascotas?.nombre || "—") },
        { key: "cliente", label: "Cliente", fmt: (r) => esc(r.asa_clientes?.nombre_contacto || "—") },
        { key: "tipo_servicio", label: "Servicio" },
        { key: "estado", label: "Estado", fmt: (r) => badge(r.estado) },
      ],
      data,
      "No hay citas registradas."
    );
    $("#citas-tabla").querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", () => abrirCitaAcciones(tr.dataset.id, data)));
  }
  await cargar();
  $("#filtro-estado-cita").addEventListener("change", (e) => cargar(e.target.value));
  $("#btn-nueva-cita").addEventListener("click", () => modalNuevaCita(() => cargar($("#filtro-estado-cita").value)));
}

async function modalNuevaCita(onSaved) {
  const [clientes, mascotas] = await Promise.all([getClientesCache(), getMascotasCache()]);
  openModal({
    title: "Agendar cita",
    bodyHTML: `
      <div class="form-grid">
        <div class="form-group"><label>Cliente *</label><select name="cliente_id" id="cita-cliente" required>${optionsHTML(clientes, "id", clienteLabel)}</select></div>
        <div class="form-group"><label>Mascota</label><select name="mascota_id" id="cita-mascota">${optionsHTML(mascotas, "id", (m) => m.nombre)}</select></div>
        <div class="form-group"><label>Tipo de servicio *</label>
          <select name="tipo_servicio" required>
            <option value="consulta">Consulta</option><option value="vacunacion">Vacunación</option>
            <option value="desparasitacion">Desparasitación</option><option value="estetica">Estética / lavado</option>
            <option value="cirugia">Cirugía</option><option value="emergencia">Emergencia</option><option value="seguimiento">Seguimiento</option>
          </select>
        </div>
        <div class="form-group"><label>Fecha y hora *</label><input type="datetime-local" name="fecha_hora" required /></div>
        <div class="form-group full"><label>Notas</label><textarea name="notas"></textarea></div>
      </div>`,
    onMount: () => {
      $("#cita-cliente").addEventListener("change", (e) => {
        const opts = mascotas.filter((m) => m.cliente_id === e.target.value);
        $("#cita-mascota").innerHTML = optionsHTML(opts.length ? opts : mascotas, "id", (m) => m.nombre);
      });
    },
    onSubmit: async (fd) => {
      const body = Object.fromEntries(fd.entries());
      if (body.fecha_hora) body.fecha_hora = new Date(body.fecha_hora).toISOString();
      Object.keys(body).forEach((k) => { if (body[k] === "") delete body[k]; });
      await post("/citas", body);
      closeModal(); toast("Cita agendada"); onSaved();
    },
  });
}

function abrirCitaAcciones(id, lista) {
  const cita = lista.find((c) => c.id === id);
  if (!cita) return;
  openModal({
    title: `Cita — ${fmtDateTime(cita.fecha_hora)}`,
    bodyHTML: `
      <p><strong>Servicio:</strong> ${esc(cita.tipo_servicio)} · <strong>Estado actual:</strong> ${badge(cita.estado)}</p>
      <div class="form-group"><label>Cambiar estado a</label>
        <select name="estado">
          <option value="confirmada">Confirmada</option><option value="en_curso">En curso</option>
          <option value="completada">Completada</option><option value="cancelada">Cancelada</option><option value="no_asistio">No asistió</option>
        </select>
      </div>`,
    submitLabel: "Actualizar estado",
    onSubmit: async (fd) => {
      await patch(`/citas/${id}/estado`, { estado: fd.get("estado") });
      closeModal(); toast("Estado actualizado"); navigate("citas");
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════
// PLAGAS — ÓRDENES DE TRABAJO Y CONTRATOS
// ═══════════════════════════════════════════════════════════════════════
let PLAGAS_SUB = "ordenes";
async function viewPlagas(content) {
  content.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>Control de plagas</h2></div>
      <div class="subtabs">
        <div class="subtab ${PLAGAS_SUB === "ordenes" ? "active" : ""}" data-t="ordenes">Órdenes de trabajo</div>
        <div class="subtab ${PLAGAS_SUB === "contratos" ? "active" : ""}" data-t="contratos">Contratos recurrentes</div>
      </div>
      <div id="plagas-body"></div>
    </div>`;
  $$(".subtab", content).forEach((t) => t.addEventListener("click", () => { PLAGAS_SUB = t.dataset.t; viewPlagas(content); }));
  if (PLAGAS_SUB === "ordenes") await renderOrdenesPlagas();
  else await renderContratosPlagas();
}

async function renderOrdenesPlagas() {
  const body = $("#plagas-body");
  body.innerHTML = `<div class="toolbar">
      <select id="filtro-estado-orden">
        <option value="">Todos los estados</option>
        <option value="solicitada">Solicitada</option><option value="agendada">Agendada</option>
        <option value="en_ruta">En ruta</option><option value="en_sitio">En sitio</option>
        <option value="ejecutada">Ejecutada</option><option value="facturada">Facturada</option>
        <option value="cerrada">Cerrada</option><option value="cancelada">Cancelada</option>
      </select>
    </div><div id="ordenes-tabla"></div>`;

  async function cargar(estado) {
    const data = await get(`/plagas/ordenes${estado ? `?estado=${estado}` : ""}`);
    $("#ordenes-tabla").innerHTML = tableHTML(
      [
        { key: "numero_orden", label: "Orden" },
        { key: "cliente", label: "Cliente", fmt: (r) => esc(r.asa_clientes?.nombre_contacto || "—") },
        { key: "sitio", label: "Sitio", fmt: (r) => esc(r.asa_sitios?.nombre || "—") },
        { key: "estado", label: "Estado", fmt: (r) => badge(r.estado) },
        { key: "prioridad", label: "Prioridad", fmt: (r) => badge(r.prioridad) },
        { key: "fecha_agendada", label: "Agendada", fmt: (r) => fmtDateTime(r.fecha_agendada) },
      ],
      data,
      "No hay órdenes de trabajo."
    );
    $("#ordenes-tabla").querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", () => abrirOrdenPlaga(tr.dataset.id)));
  }
  await cargar();
  $("#filtro-estado-orden").addEventListener("change", (e) => cargar(e.target.value));
}

async function abrirOrdenPlaga(id) {
  const o = await get(`/plagas/ordenes/${id}`);
  openModal({
    title: `Orden ${o.numero_orden}`,
    large: true,
    bodyHTML: `
      <p><strong>Cliente:</strong> ${esc(o.asa_clientes?.nombre_contacto || "—")} · <strong>Sitio:</strong> ${esc(o.asa_sitios?.nombre || "—")}</p>
      <p><strong>Estado:</strong> ${badge(o.estado)} · <strong>Prioridad:</strong> ${badge(o.prioridad)} · <strong>Origen:</strong> ${esc(o.origen)}</p>
      <p><strong>Reporte del cliente:</strong> ${esc(o.descripcion_cliente || o.tipo_plaga_reportada || "—")}</p>
      <h4>Historial de estados</h4>
      ${tableHTML([{ key: "estado_nuevo", label: "Estado", fmt: (r) => badge(r.estado_nuevo) }, { key: "motivo", label: "Motivo" }, { key: "created_at", label: "Fecha", fmt: (r) => fmtDateTime(r.created_at) }], o.historial_estados, "Sin historial.")}
      <h4 style="margin-top:14px">Acciones</h4>
      <div class="form-grid">
        <div class="form-group"><label>Técnico (ID)</label><input name="tecnico_id" placeholder="uuid del empleado técnico" /></div>
        <div class="form-group"><label>Fecha agendada</label><input type="datetime-local" name="fecha_agendada" /></div>
      </div>
      <div class="form-group"><label>Cambiar estado directamente a</label>
        <select name="estado">
          <option value="">— no cambiar —</option>
          <option value="agendada">Agendada</option><option value="en_ruta">En ruta</option><option value="en_sitio">En sitio</option>
          <option value="ejecutada">Ejecutada</option><option value="cerrada">Cerrada</option><option value="cancelada">Cancelada</option>
        </select>
      </div>`,
    submitLabel: "Aplicar",
    onSubmit: async (fd) => {
      const tecnico_id = fd.get("tecnico_id");
      const fecha_agendada = fd.get("fecha_agendada");
      const estado = fd.get("estado");
      if (tecnico_id || fecha_agendada) {
        await patch(`/plagas/ordenes/${id}/asignar`, {
          tecnico_id: tecnico_id || undefined,
          fecha_agendada: fecha_agendada ? new Date(fecha_agendada).toISOString() : undefined,
        });
      }
      if (estado) await patch(`/plagas/ordenes/${id}/estado`, { estado });
      closeModal(); toast("Orden actualizada"); navigate("plagas");
    },
  });
}

async function renderContratosPlagas() {
  const body = $("#plagas-body");
  body.innerHTML = `<div class="toolbar"><button class="btn btn-primary" id="btn-nuevo-contrato">+ Nuevo contrato</button></div><div id="contratos-tabla"></div>`;
  async function cargar() {
    const data = await get("/plagas/contratos");
    $("#contratos-tabla").innerHTML = tableHTML(
      [
        { key: "sitio", label: "Sitio", fmt: (r) => esc(r.asa_sitios?.nombre || "—") },
        { key: "frecuencia", label: "Frecuencia" },
        { key: "precio", label: "Monto", fmt: (r) => fmtMoney(r.precio) },
      ],
      data,
      "No hay contratos activos."
    );
  }
  await cargar();
  $("#btn-nuevo-contrato").addEventListener("click", async () => {
    const clientes = await getClientesCache();
    openModal({
      title: "Nuevo contrato",
      bodyHTML: `
        <div class="form-grid">
          <div class="form-group full"><label>Cliente *</label><select name="cliente_id" required>${optionsHTML(clientes, "id", clienteLabel)}</select></div>
          <div class="form-group full"><label>Sitio (UUID) *</label><input name="sitio_id" placeholder="Ver ficha del cliente para el id del sitio" required /></div>
          <div class="form-group"><label>Frecuencia</label>
            <select name="frecuencia"><option value="mensual">Mensual</option><option value="bimensual">Bimensual</option><option value="trimestral">Trimestral</option><option value="semestral">Semestral</option><option value="anual">Anual</option><option value="unico">Único</option></select>
          </div>
          <div class="form-group"><label>Monto recurrente (RD$)</label><input type="number" step="0.01" name="precio" /></div>
        </div>`,
      onSubmit: async (fd) => {
        await post("/plagas/contratos", Object.fromEntries(fd.entries()));
        closeModal(); toast("Contrato creado"); cargar();
      },
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════
// IPM (estaciones, lecturas, permisos regulatorios)
// ═══════════════════════════════════════════════════════════════════════
let IPM_SUB = "estaciones";
async function viewIpm(content) {
  content.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>Manejo Integrado de Plagas (IPM)</h2></div>
      <div class="subtabs">
        <div class="subtab ${IPM_SUB === "estaciones" ? "active" : ""}" data-t="estaciones">Estaciones</div>
        <div class="subtab ${IPM_SUB === "lecturas" ? "active" : ""}" data-t="lecturas">Lecturas</div>
        <div class="subtab ${IPM_SUB === "permisos" ? "active" : ""}" data-t="permisos">Permisos y cumplimiento</div>
      </div>
      <div id="ipm-body"></div>
    </div>`;
  $$(".subtab", content).forEach((t) => t.addEventListener("click", () => { IPM_SUB = t.dataset.t; viewIpm(content); }));

  if (IPM_SUB === "estaciones") {
    const data = await get("/ipm/estaciones");
    $("#ipm-body").innerHTML = tableHTML(
      [{ key: "codigo_qr", label: "Código QR" }, { key: "tipo_estacion", label: "Tipo" }, { key: "ubicacion_descripcion", label: "Ubicación" }],
      data, "No hay estaciones registradas."
    );
  } else if (IPM_SUB === "lecturas") {
    const data = await get("/ipm/lecturas");
    $("#ipm-body").innerHTML = tableHTML(
      [{ key: "fecha", label: "Fecha", fmt: (r) => fmtDate(r.fecha) }, { key: "actividad_detectada", label: "Actividad" }, { key: "nivel_actividad", label: "Nivel" }, { key: "notas", label: "Notas" }],
      data, "No hay lecturas registradas."
    );
  } else {
    const data = await get("/ipm/permisos");
    $("#ipm-body").innerHTML = tableHTML(
      [
        { key: "tipo", label: "Tipo" },
        { key: "numero_documento", label: "Número" },
        { key: "entidad_emisora", label: "Entidad" },
        { key: "fecha_vencimiento", label: "Vence", fmt: (r) => fmtDate(r.fecha_vencimiento) },
        { key: "estado", label: "Estado", fmt: (r) => badge(r.estado) },
      ],
      data, "No hay permisos registrados."
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ESTÉTICA
// ═══════════════════════════════════════════════════════════════════════
let ESTETICA_SUB = "ordenes";
async function viewEstetica(content) {
  content.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>Estética canina</h2></div>
      <div class="subtabs">
        <div class="subtab ${ESTETICA_SUB === "ordenes" ? "active" : ""}" data-t="ordenes">Órdenes</div>
        <div class="subtab ${ESTETICA_SUB === "catalogo" ? "active" : ""}" data-t="catalogo">Catálogo de servicios</div>
      </div>
      <div id="estetica-body"></div>
    </div>`;
  $$(".subtab", content).forEach((t) => t.addEventListener("click", () => { ESTETICA_SUB = t.dataset.t; viewEstetica(content); }));

  if (ESTETICA_SUB === "ordenes") {
    const data = await get("/estetica/ordenes");
    $("#estetica-body").innerHTML = tableHTML(
      [
        { key: "mascota", label: "Mascota", fmt: (r) => esc(r.asa_mascotas?.nombre || "—") },
        { key: "fecha", label: "Fecha", fmt: (r) => fmtDateTime(r.fecha) },
        { key: "estado", label: "Estado", fmt: (r) => badge(r.estado) },
      ],
      data, "No hay órdenes de estética."
    );
  } else {
    const data = await get("/estetica/catalogo");
    $("#estetica-body").innerHTML = tableHTML(
      [{ key: "nombre", label: "Servicio" }, { key: "precio", label: "Precio", fmt: (r) => fmtMoney(r.precio) }],
      data, "No hay servicios en el catálogo."
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════
// INVENTARIO
// ═══════════════════════════════════════════════════════════════════════
let INV_SUB = "plaguicidas";
async function viewInventario(content) {
  content.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>Inventario</h2></div>
      <div class="subtabs">
        <div class="subtab ${INV_SUB === "plaguicidas" ? "active" : ""}" data-t="plaguicidas">Plaguicidas</div>
        <div class="subtab ${INV_SUB === "productos" ? "active" : ""}" data-t="productos">Productos de tienda</div>
        <div class="subtab ${INV_SUB === "alertas" ? "active" : ""}" data-t="alertas">Alertas de stock</div>
        <div class="subtab ${INV_SUB === "movimientos" ? "active" : ""}" data-t="movimientos">Movimientos</div>
      </div>
      <div id="inv-body"></div>
    </div>`;
  $$(".subtab", content).forEach((t) => t.addEventListener("click", () => { INV_SUB = t.dataset.t; viewInventario(content); }));

  if (INV_SUB === "plaguicidas") {
    const data = await get("/inventario/plaguicidas");
    $("#inv-body").innerHTML = tableHTML(
      [{ key: "nombre_comercial", label: "Nombre" }, { key: "stock_actual", label: "Stock" }, { key: "stock_minimo", label: "Mínimo" }, { key: "unidad_medida", label: "Unidad" }],
      data, "No hay plaguicidas en el catálogo."
    );
  } else if (INV_SUB === "productos") {
    const data = await get("/inventario/productos");
    $("#inv-body").innerHTML = tableHTML(
      [{ key: "nombre", label: "Producto" }, { key: "categoria", label: "Categoría" }, { key: "precio_venta", label: "Precio", fmt: (r) => fmtMoney(r.precio_venta) }, { key: "stock_actual", label: "Stock" }],
      data, "No hay productos en el catálogo de tienda."
    );
  } else if (INV_SUB === "alertas") {
    const data = await get("/inventario/alertas-stock");
    $("#inv-body").innerHTML = tableHTML(
      [{ key: "tipo_item", label: "Tipo" }, { key: "nombre", label: "Producto", fmt: (r) => esc(r.nombre_comercial || r.nombre) }, { key: "stock_actual", label: "Stock actual" }, { key: "stock_minimo", label: "Mínimo" }],
      data, "Todo el inventario está sobre el mínimo."
    );
  } else {
    const data = await get("/inventario/movimientos");
    $("#inv-body").innerHTML = tableHTML(
      [{ key: "created_at", label: "Fecha", fmt: (r) => fmtDateTime(r.created_at) }, { key: "tipo_item", label: "Tipo" }, { key: "tipo_movimiento", label: "Movimiento" }, { key: "cantidad", label: "Cantidad" }, { key: "stock_despues", label: "Stock resultante" }],
      data, "Sin movimientos registrados."
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════
// TIENDA (POS)
// ═══════════════════════════════════════════════════════════════════════
let POS_SUB = "ventas";
async function viewPos(content) {
  content.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>Tienda — Punto de venta</h2></div>
      <div class="subtabs">
        <div class="subtab ${POS_SUB === "ventas" ? "active" : ""}" data-t="ventas">Ventas</div>
        <div class="subtab ${POS_SUB === "cuadre" ? "active" : ""}" data-t="cuadre">Cuadre de caja</div>
      </div>
      <div id="pos-body"></div>
    </div>`;
  $$(".subtab", content).forEach((t) => t.addEventListener("click", () => { POS_SUB = t.dataset.t; viewPos(content); }));

  if (POS_SUB === "ventas") {
    const data = await get("/pos/ventas");
    $("#pos-body").innerHTML = tableHTML(
      [
        { key: "numero", label: "Venta" },
        { key: "created_at", label: "Fecha", fmt: (r) => fmtDateTime(r.created_at) },
        { key: "metodo_pago", label: "Método de pago" },
        { key: "total", label: "Total", fmt: (r) => fmtMoney(r.total) },
        { key: "anulada", label: "Estado", fmt: (r) => (r.anulada ? '<span class="badge badge-red">Anulada</span>' : '<span class="badge badge-green">Válida</span>') },
      ],
      data, "No hay ventas registradas todavía."
    );
  } else {
    const data = await get("/pos/cuadre-caja");
    $("#pos-body").innerHTML = tableHTML(
      [
        { key: "fecha", label: "Fecha", fmt: (r) => fmtDate(r.fecha) },
        { key: "ventas_total", label: "Ventas", fmt: (r) => fmtMoney(r.ventas_total) },
        { key: "efectivo_contado", label: "Efectivo contado", fmt: (r) => fmtMoney(r.efectivo_contado) },
        { key: "diferencia", label: "Diferencia", fmt: (r) => fmtMoney(r.diferencia) },
        { key: "cerrado", label: "Estado", fmt: (r) => (r.cerrado ? "Cerrado" : "Abierto") },
      ],
      data, "Sin cuadres de caja registrados."
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════
// FACTURACIÓN (e-CF)
// ═══════════════════════════════════════════════════════════════════════
async function viewFacturacion(content) {
  content.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Facturación electrónica (e-CF)</h2>
        <div class="actions"><button class="btn btn-primary" id="btn-nueva-factura">+ Emitir factura</button></div>
      </div>
      <div id="fact-tabla"></div>
    </div>`;

  async function cargar() {
    const data = await get("/facturacion");
    $("#fact-tabla").innerHTML = tableHTML(
      [
        { key: "e_ncf", label: "e-NCF" },
        { key: "cliente", label: "Cliente", fmt: (r) => esc(r.asa_clientes?.nombre_contacto || "—") },
        { key: "total", label: "Total", fmt: (r) => fmtMoney(r.total) },
        { key: "estado_dgii", label: "Estado DGII", fmt: (r) => badge(r.estado_dgii) },
        { key: "estado_factura", label: "Estado factura", fmt: (r) => badge(r.estado_factura) },
        { key: "created_at", label: "Fecha", fmt: (r) => fmtDateTime(r.created_at) },
      ],
      data, "No hay facturas emitidas todavía."
    );
    $("#fact-tabla").querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", () => abrirFactura(tr.dataset.id)));
  }
  await cargar();
  $("#btn-nueva-factura").addEventListener("click", () => modalNuevaFactura(cargar));
}

async function abrirFactura(id) {
  const f = await get(`/facturacion/${id}`);
  openModal({
    title: `Factura ${f.e_ncf || "(sin e-NCF)"}`,
    large: true,
    bodyHTML: `
      <p><strong>Cliente:</strong> ${esc(f.asa_clientes?.nombre_contacto || "—")} · <strong>Total:</strong> ${fmtMoney(f.total)}</p>
      <p><strong>Estado DGII:</strong> ${badge(f.estado_dgii)} · <strong>Estado factura:</strong> ${badge(f.estado_factura)}</p>
      <h4>Ítems</h4>
      ${tableHTML([{ key: "descripcion", label: "Descripción" }, { key: "cantidad", label: "Cant." }, { key: "precio_unitario", label: "Precio", fmt: (r) => fmtMoney(r.precio_unitario) }, { key: "subtotal", label: "Subtotal", fmt: (r) => fmtMoney(r.subtotal) }], f.items, "Sin ítems.")}
      <h4 style="margin-top:14px">Pagos recibidos</h4>
      ${tableHTML([{ key: "fecha", label: "Fecha", fmt: (r) => fmtDate(r.fecha || r.created_at) }, { key: "monto", label: "Monto", fmt: (r) => fmtMoney(r.monto) }, { key: "metodo_pago", label: "Método" }], f.pagos, "Sin pagos registrados.")}`,
  });
  $(".modal-foot")?.remove();
}

async function modalNuevaFactura(onSaved) {
  const clientes = await getClientesCache();
  const overlay = openModal({
    title: "Emitir factura (e-CF)",
    large: true,
    bodyHTML: `
      <div class="form-grid">
        <div class="form-group"><label>Cliente *</label><select name="cliente_id" required>${optionsHTML(clientes, "id", clienteLabel)}</select></div>
        <div class="form-group"><label>Tipo de e-CF</label>
          <select name="tipo_ecf">
            <option value="e32">e32 — Consumo</option><option value="e31">e31 — Crédito fiscal</option>
            <option value="e43">e43 — Gastos menores</option><option value="e44">e44 — Régimen especial</option>
          </select>
        </div>
        <div class="form-group"><label>Origen</label>
          <select name="tipo_origen"><option value="plagas">Plagas</option><option value="veterinaria">Veterinaria/Estética</option><option value="tienda">Tienda</option></select>
        </div>
      </div>
      <h4 style="margin-top:12px">Ítems</h4>
      <div class="items-rows" id="items-rows"></div>
      <button type="button" class="btn btn-sm" id="btn-add-item">+ Agregar ítem</button>
    `,
    onMount: () => {
      const rows = $("#items-rows");
      function addRow() {
        rows.appendChild(h(`
          <div class="item-row">
            <input placeholder="Descripción" data-f="descripcion" required />
            <input type="number" step="1" min="1" placeholder="Cant." value="1" data-f="cantidad" required />
            <input type="number" step="0.01" placeholder="Precio unitario" data-f="precio_unitario" required />
            <button type="button" class="btn btn-sm btn-danger">×</button>
          </div>`));
        rows.lastElementChild.querySelector("button").addEventListener("click", (e) => e.target.closest(".item-row").remove());
      }
      $("#btn-add-item").addEventListener("click", addRow);
      addRow();
    },
    onSubmit: async (fd) => {
      const body = Object.fromEntries(fd.entries());
      const items = $$(".item-row", overlay).map((row) => ({
        descripcion: row.querySelector('[data-f=descripcion]').value,
        cantidad: Number(row.querySelector('[data-f=cantidad]').value),
        precio_unitario: Number(row.querySelector('[data-f=precio_unitario]').value),
      }));
      if (!items.length) throw new Error("Agrega al menos un ítem");
      await post("/facturacion", { ...body, items });
      closeModal(); toast("Factura emitida"); onSaved();
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════
// CONTABILIDAD
// ═══════════════════════════════════════════════════════════════════════
let CONTA_SUB = "plan-cuentas";
async function viewContabilidad(content) {
  content.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>Contabilidad</h2></div>
      <div class="subtabs">
        <div class="subtab ${CONTA_SUB === "plan-cuentas" ? "active" : ""}" data-t="plan-cuentas">Plan de cuentas</div>
        <div class="subtab ${CONTA_SUB === "asientos" ? "active" : ""}" data-t="asientos">Asientos</div>
        <div class="subtab ${CONTA_SUB === "balance" ? "active" : ""}" data-t="balance">Balance de comprobación</div>
        <div class="subtab ${CONTA_SUB === "suplidores" ? "active" : ""}" data-t="suplidores">Suplidores</div>
        <div class="subtab ${CONTA_SUB === "cxp" ? "active" : ""}" data-t="cxp">Cuentas por pagar</div>
      </div>
      <div id="conta-body"></div>
    </div>`;
  $$(".subtab", content).forEach((t) => t.addEventListener("click", () => { CONTA_SUB = t.dataset.t; viewContabilidad(content); }));

  if (CONTA_SUB === "plan-cuentas") {
    const data = await get("/contabilidad/plan-cuentas");
    $("#conta-body").innerHTML = tableHTML([{ key: "codigo", label: "Código" }, { key: "nombre", label: "Cuenta" }, { key: "tipo", label: "Tipo" }], data, "Plan de cuentas vacío. Créalo desde Supabase o vía API.");
  } else if (CONTA_SUB === "asientos") {
    const data = await get("/contabilidad/asientos");
    $("#conta-body").innerHTML = tableHTML([{ key: "fecha", label: "Fecha", fmt: (r) => fmtDate(r.fecha) }, { key: "concepto", label: "Concepto" }], data, "No hay asientos contables.");
  } else if (CONTA_SUB === "balance") {
    const data = await get("/contabilidad/balance-comprobacion");
    $("#conta-body").innerHTML = tableHTML(
      [{ key: "codigo", label: "Código" }, { key: "nombre", label: "Cuenta" }, { key: "debito", label: "Débito", fmt: (r) => fmtMoney(r.debito) }, { key: "credito", label: "Crédito", fmt: (r) => fmtMoney(r.credito) }, { key: "saldo", label: "Saldo", fmt: (r) => fmtMoney(r.saldo) }],
      data, "Sin movimientos contables en el rango."
    );
  } else if (CONTA_SUB === "suplidores") {
    const data = await get("/contabilidad/suplidores");
    $("#conta-body").innerHTML = tableHTML([{ key: "nombre", label: "Suplidor" }, { key: "rnc", label: "RNC" }, { key: "telefono", label: "Teléfono" }], data, "No hay suplidores registrados.");
  } else {
    const data = await get("/contabilidad/cuentas-por-pagar");
    $("#conta-body").innerHTML = tableHTML(
      [
        { key: "suplidor", label: "Suplidor", fmt: (r) => esc(r.asa_suplidores?.nombre || "—") },
        { key: "descripcion", label: "Descripción" },
        { key: "monto_original", label: "Monto", fmt: (r) => fmtMoney(r.monto_original) },
        { key: "pendiente", label: "Pendiente", fmt: (r) => fmtMoney(Number(r.monto_original || 0) - Number(r.monto_pagado || 0)) },
        { key: "fecha_vencimiento", label: "Vence", fmt: (r) => fmtDate(r.fecha_vencimiento) },
      ],
      data, "No hay cuentas por pagar."
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════
// NÓMINA
// ═══════════════════════════════════════════════════════════════════════
let NOM_SUB = "empleados";
async function viewNomina(content) {
  content.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Nómina</h2>
        <div class="actions">${NOM_SUB === "empleados" ? '<button class="btn btn-primary" id="btn-nuevo-empleado">+ Nuevo empleado</button>' : ""}</div>
      </div>
      <div class="subtabs">
        <div class="subtab ${NOM_SUB === "empleados" ? "active" : ""}" data-t="empleados">Empleados</div>
        <div class="subtab ${NOM_SUB === "periodos" ? "active" : ""}" data-t="periodos">Períodos de nómina</div>
      </div>
      <div id="nom-body"></div>
    </div>`;
  $$(".subtab", content).forEach((t) => t.addEventListener("click", () => { NOM_SUB = t.dataset.t; viewNomina(content); }));

  if (NOM_SUB === "empleados") {
    const data = await get("/nomina/empleados");
    $("#nom-body").innerHTML = tableHTML(
      [{ key: "nombre_completo", label: "Nombre" }, { key: "rol", label: "Rol" }, { key: "salario_base", label: "Salario base", fmt: (r) => fmtMoney(r.salario_base) }],
      data, "No hay empleados registrados."
    );
    $("#btn-nuevo-empleado")?.addEventListener("click", () => {
      openModal({
        title: "Nuevo empleado",
        bodyHTML: `
          <div class="form-grid">
            <div class="form-group full"><label>Nombre completo *</label><input name="nombre_completo" required /></div>
            <div class="form-group"><label>Rol</label>
              <select name="rol"><option value="tecnico_plagas">Técnico de plagas</option><option value="veterinario">Veterinario</option><option value="groomer">Groomer</option><option value="cajero">Cajero</option><option value="comercial">Comercial</option><option value="operaciones">Operaciones</option><option value="contabilidad">Contabilidad</option><option value="nomina">Nómina</option><option value="admin">Administrador</option></select>
            </div>
            <div class="form-group"><label>Salario base (RD$)</label><input type="number" step="0.01" name="salario_base" /></div>
          </div>`,
        onSubmit: async (fd) => {
          await post("/nomina/empleados", Object.fromEntries(fd.entries()));
          closeModal(); toast("Empleado registrado"); viewNomina(content);
        },
      });
    });
  } else {
    const data = await get("/nomina/periodos").catch(() => []);
    $("#nom-body").innerHTML = `
      <div class="toolbar"><button class="btn btn-primary" id="btn-nuevo-periodo">+ Nuevo período</button></div>
      ${tableHTML([{ key: "fecha_inicio", label: "Desde", fmt: (r) => fmtDate(r.fecha_inicio) }, { key: "fecha_fin", label: "Hasta", fmt: (r) => fmtDate(r.fecha_fin) }, { key: "estado", label: "Estado", fmt: (r) => badge(r.estado) }, { key: "total_neto", label: "Total neto", fmt: (r) => fmtMoney(r.total_neto) }], data, "No hay períodos de nómina creados.")}`;
    $("#btn-nuevo-periodo")?.addEventListener("click", () => {
      openModal({
        title: "Nuevo período de nómina",
        bodyHTML: `<div class="form-grid">
          <div class="form-group"><label>Desde *</label><input type="date" name="fecha_inicio" required /></div>
          <div class="form-group"><label>Hasta *</label><input type="date" name="fecha_fin" required /></div>
        </div>`,
        onSubmit: async (fd) => {
          await post("/nomina/periodos", Object.fromEntries(fd.entries()));
          closeModal(); toast("Período creado. Usa 'Calcular' desde Supabase/API para generar el detalle."); viewNomina(content);
        },
      });
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// USUARIOS (solo admin)
// ═══════════════════════════════════════════════════════════════════════
async function viewUsuarios(content) {
  content.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>Usuarios del sistema</h2><div class="actions"><button class="btn btn-primary" id="btn-nuevo-usuario">+ Nuevo usuario</button></div></div>
      <div id="usr-tabla"></div>
    </div>`;
  async function cargar() {
    const data = await get("/usuarios");
    $("#usr-tabla").innerHTML = tableHTML(
      [{ key: "nombre_completo", label: "Nombre" }, { key: "email", label: "Correo" }, { key: "rol", label: "Rol", fmt: (r) => badge(r.rol) }, { key: "activo", label: "Activo", fmt: (r) => (r.activo ? "Sí" : "No") }, { key: "ultimo_acceso", label: "Último acceso", fmt: (r) => fmtDateTime(r.ultimo_acceso) }],
      data, "No hay usuarios de personal interno creados todavía."
    );
  }
  await cargar();
  $("#btn-nuevo-usuario").addEventListener("click", () => {
    openModal({
      title: "Nuevo usuario",
      bodyHTML: `
        <div class="form-grid">
          <div class="form-group full"><label>Nombre completo *</label><input name="nombre_completo" required /></div>
          <div class="form-group"><label>Correo *</label><input type="email" name="email" required /></div>
          <div class="form-group"><label>Contraseña *</label><input type="password" name="password" required minlength="6" /></div>
          <div class="form-group full"><label>Rol *</label>
            <select name="rol" required>
              <option value="admin">Administrador</option><option value="comercial">Comercial</option><option value="operaciones">Operaciones</option>
              <option value="tecnico_plagas">Técnico de plagas</option><option value="veterinario">Veterinario</option><option value="groomer">Groomer</option>
              <option value="cajero">Cajero</option><option value="contabilidad">Contabilidad</option><option value="nomina">Nómina</option>
            </select>
          </div>
        </div>`,
      onSubmit: async (fd) => {
        await post("/usuarios", Object.fromEntries(fd.entries()));
        closeModal(); toast("Usuario creado"); cargar();
      },
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════
// NOTIFICACIONES
// ═══════════════════════════════════════════════════════════════════════
async function viewNotificaciones(content) {
  content.innerHTML = `<div class="card"><div class="card-head"><h2>Notificaciones enviadas</h2></div><div id="notif-tabla"></div></div>`;
  async function cargar() {
    const data = await get("/notificaciones");
    $("#notif-tabla").innerHTML = tableHTML(
      [
        { key: "titulo", label: "Título" },
        { key: "mensaje", label: "Mensaje" },
        { key: "canal", label: "Canal" },
        { key: "leida", label: "Leída", fmt: (r) => (r.leida ? "Sí" : "No") },
        { key: "created_at", label: "Fecha", fmt: (r) => fmtDateTime(r.created_at) },
        {
          key: "_acciones", label: "", _clickable: false,
          fmt: (r) => (r.leida ? "" : `<button class="btn btn-sm" data-marcar="${r.id}">Marcar leída</button>`),
        },
      ],
      data, "No hay notificaciones registradas."
    );
    $$('[data-marcar]', document).forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await patch(`/notificaciones/${btn.dataset.marcar}/leida`, {});
        cargar();
      })
    );
  }
  await cargar();
}

// ── Arranque ─────────────────────────────────────────────────────────────
function boot() {
  if (DEMO_SKIP_LOGIN && !(TOKEN && USUARIO)) {
    USUARIO = { id: null, nombre: "Vista previa (sin login)", rol: "admin" };
  }
  if ((TOKEN && USUARIO) || DEMO_SKIP_LOGIN) {
    renderShell();
  } else {
    renderLogin();
  }
}
document.addEventListener("DOMContentLoaded", boot);
