// ═════════════════════════════════════════════════════════════════════════
// app.js — Portal del hotel (ASA SRL)
//
// Lo usa el personal de calidad del hotel. Entra con la cuenta que ASA le
// crea desde el panel (Accesos del hotel) y ve, en tiempo real y solo de
// lectura, lo que el técnico registró en SUS plantas.
//
// El aislamiento por planta no lo hace esta pantalla: el backend filtra cada
// consulta contra asa_usuario_sitios. Aquí solo se pide y se muestra.
//
// La única escritura permitida a estas cuentas es reportar una plaga, que
// crea una orden de trabajo. Todo lo demás el servidor lo rechaza.
// ═════════════════════════════════════════════════════════════════════════

let TOKEN = localStorage.getItem("asa_portal_token") || null;
let USUARIO = leerJSON("asa_portal_usuario");
let PLANTA = leerJSON("asa_portal_planta");
let PLANTAS = [];
let PESTANA = "hoy";
let AVISO_ORDEN = null;   // mensaje a mostrar tras crear una orden

const app = () => document.getElementById("app");
const $ = (s, raiz = document) => raiz.querySelector(s);
const $$ = (s, raiz = document) => [...raiz.querySelectorAll(s)];

function leerJSON(clave) {
  try { return JSON.parse(localStorage.getItem(clave) || "null"); } catch { return null; }
}
function guardarJSON(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* modo privado */ }
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function fecha(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-DO", { day: "numeric", month: "short", year: "numeric" });
}
function fechaHora(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-DO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
const hoyLocal = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });

// ── API ──────────────────────────────────────────────────────────────────
async function api(ruta, opciones = {}) {
  const headers = { "Content-Type": "application/json", ...(opciones.headers || {}) };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

  let res;
  try {
    res = await fetch(`${CONFIG.API_BASE}${ruta}`, { cache: "no-store", ...opciones, headers });
  } catch {
    throw new Error(
      `No se pudo conectar con el servidor. Revisa tu conexión; si el problema sigue, ` +
      `avísale a ${CONFIG.EMPRESA}.`
    );
  }

  let datos = null;
  try { datos = await res.json(); } catch { /* respuesta vacía */ }

  if (res.status === 401) {
    salir("Tu sesión expiró. Vuelve a entrar.");
    throw new Error("No autenticado");
  }
  if (res.status === 403) {
    throw new Error(datos?.mensaje || "Tu usuario no tiene permiso para esta acción.");
  }
  if (!res.ok) throw new Error(datos?.mensaje || `Error ${res.status}`);
  return datos;
}
const GET = (r) => api(r);
const POST = (r, cuerpo) => api(r, { method: "POST", body: JSON.stringify(cuerpo) });

// ── Sesión ───────────────────────────────────────────────────────────────
function salir(mensaje) {
  TOKEN = null; USUARIO = null; PLANTA = null;
  localStorage.removeItem("asa_portal_token");
  localStorage.removeItem("asa_portal_usuario");
  localStorage.removeItem("asa_portal_planta");
  pantallaLogin(mensaje);
}

function pantallaLogin(mensaje) {
  app().innerHTML = `
    <div class="login-wrap">
      <form class="login-card" id="form-login">
        <img src="assets/logo-asa.png" alt="${esc(CONFIG.EMPRESA)}" />
        <p class="sub">Portal del hotel</p>
        <label for="correo">Correo</label>
        <input id="correo" type="email" autocomplete="username" required />
        <label for="clave">Contraseña</label>
        <input id="clave" type="password" autocomplete="current-password" required />
        <button class="btn-entrar" id="btn-entrar" type="submit">Entrar</button>
        ${mensaje ? `<div class="error">${esc(mensaje)}</div>` : ""}
      </form>
    </div>`;

  $("#form-login").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = $("#btn-entrar");
    btn.disabled = true; btn.textContent = "Entrando…";
    try {
      const r = await POST("/usuarios/login", {
        email: $("#correo").value.trim().toLowerCase(),
        password: $("#clave").value,
      });
      // Este portal es solo para cuentas de hotel. Al personal de ASA se le
      // dice dónde entrar en vez de dejarlo con una pantalla vacía.
      if (r.usuario.rol !== "cliente_calidad") {
        throw new Error("Esta cuenta es del personal de ASA. Entra por el panel administrativo.");
      }
      TOKEN = r.token; USUARIO = r.usuario;
      localStorage.setItem("asa_portal_token", TOKEN);
      guardarJSON("asa_portal_usuario", USUARIO);
      await arrancar();
    } catch (e) {
      const caja = $(".error") || document.createElement("div");
      caja.className = "error";
      caja.textContent = e.message;
      $("#form-login").appendChild(caja);
    } finally {
      btn.disabled = false; btn.textContent = "Entrar";
    }
  });
}

// ── Marco ────────────────────────────────────────────────────────────────
function pintarMarco() {
  const pestanas = [
    ["hoy", "Hoy"],
    ["historial", "Historial"],
    ["hallazgos", "Hallazgos"],
    ["ordenes", "Órdenes"],
  ];

  app().innerHTML = `
    <header class="barra">
      <img src="assets/logo-asa.png" alt="${esc(CONFIG.EMPRESA)}" />
      <select class="sel-planta" id="sel-planta">
        ${PLANTAS.map(
          (p) => `<option value="${p.id}"${p.id === PLANTA?.id ? " selected" : ""}>${esc(p.nombre)}</option>`
        ).join("")}
      </select>
      <div class="quien">
        <span>${esc(USUARIO?.nombre || "")}</span>
        <button class="btn-salir" id="btn-salir">Salir</button>
      </div>
    </header>
    <nav class="pestanas">
      ${pestanas
        .map(([k, t]) => `<button class="pestana${k === PESTANA ? " activa" : ""}" data-p="${k}">${t}</button>`)
        .join("")}
    </nav>
    <main class="contenido" id="cuerpo"><div class="cargando">Cargando…</div></main>`;

  $("#btn-salir").addEventListener("click", () => salir());
  $("#sel-planta").addEventListener("change", (e) => {
    PLANTA = PLANTAS.find((p) => p.id === e.target.value);
    guardarJSON("asa_portal_planta", PLANTA);
    pintarPestana();
  });
  $$(".pestana").forEach((b) =>
    b.addEventListener("click", () => {
      PESTANA = b.dataset.p;
      $$(".pestana").forEach((x) => x.classList.toggle("activa", x === b));
      pintarPestana();
    })
  );
}

async function pintarPestana() {
  const cuerpo = $("#cuerpo");
  cuerpo.innerHTML = `<div class="cargando">Cargando…</div>`;
  const vistas = { hoy: vistaHoy, historial: vistaHistorial, hallazgos: vistaHallazgos, ordenes: vistaOrdenes };
  try {
    await vistas[PESTANA](cuerpo);
  } catch (e) {
    cuerpo.innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
}

// ── Hoy ──────────────────────────────────────────────────────────────────
async function vistaHoy(cuerpo) {
  const [resumen, habitaciones] = await Promise.all([
    GET(`/reportes/resumen?sitio_id=${PLANTA.id}`),
    GET(`/puntos?sitio_id=${PLANTA.id}&tipo=habitacion`).catch(() => null),
  ]);

  const hechas = habitaciones?.realizados || [];
  const faltan = habitaciones?.pendientes || [];
  const totalHab = hechas.length + faltan.length;
  const pct = totalHab ? Math.round((hechas.length / totalHab) * 100) : 0;

  cuerpo.innerHTML = `
    <div class="kpis">
      <div class="kpi ok"><div class="n">${resumen.inspecciones_hoy}</div><div class="t">Puntos revisados hoy</div></div>
      <div class="kpi"><div class="n">${resumen.puntos_total}</div><div class="t">Puntos de control en la planta</div></div>
      <div class="kpi ${resumen.puntos_vencidos ? "mal" : "ok"}">
        <div class="n">${resumen.puntos_vencidos}</div><div class="t">Fuera de su frecuencia</div>
      </div>
      <div class="kpi ${resumen.hallazgos_abiertos ? "mal" : "ok"}">
        <div class="n">${resumen.hallazgos_abiertos}</div><div class="t">Hallazgos por corregir</div>
      </div>
    </div>

    <div class="tarjeta">
      <h2>Actividad del período</h2>
      <p style="margin:0;color:var(--suave);font-size:13.5px">
        Del ${fecha(resumen.desde)} al ${fecha(resumen.hasta)}:
        <strong>${resumen.inspecciones_periodo}</strong> revisiones,
        <strong>${resumen.con_actividad}</strong> con actividad detectada
        y <strong>${resumen.actividad_alta}</strong> con actividad alta.
      </p>
    </div>

    ${
      totalHab
        ? `<div class="tarjeta">
             <h2>Habitaciones de hoy</h2>
             <p style="margin:0 0 4px;font-size:13.5px">
               <strong>${hechas.length}</strong> de <strong>${totalHab}</strong> fumigadas hoy
             </p>
             <div class="progreso"><span style="width:${pct}%"></span></div>
             <div class="rejilla-hab">
               ${hechas.map((h) => `<div class="hab si">${esc(h.numero_habitacion || h.codigo_visible)}</div>`).join("")}
               ${faltan.map((h) => `<div class="hab no">${esc(h.numero_habitacion || h.codigo_visible)}</div>`).join("")}
             </div>
           </div>`
        : ""
    }`;
}

// ── Historial ────────────────────────────────────────────────────────────
async function vistaHistorial(cuerpo) {
  cuerpo.innerHTML = `
    <div class="acciones">
      <select class="btn" id="dias">
        <option value="1">Solo hoy</option>
        <option value="7" selected>Últimos 7 días</option>
        <option value="30">Últimos 30 días</option>
        <option value="90">Últimos 90 días</option>
      </select>
      <button class="btn principal" id="btn-excel">Descargar en Excel</button>
    </div>
    <div class="tarjeta" id="lista"><div class="cargando">Cargando…</div></div>`;

  $("#btn-excel").addEventListener("click", descargarExcel);
  $("#dias").addEventListener("change", cargar);

  async function cargar() {
    const dias = Number($("#dias").value);
    const desde = new Date(Date.now() - (dias - 1) * 86400000)
      .toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });

    const insp = await GET(`/inspecciones?sitio_id=${PLANTA.id}&desde=${desde}`);
    const lista = Array.isArray(insp) ? insp : insp.inspecciones || [];

    if (!lista.length) {
      $("#lista").innerHTML = `<div class="vacio"><span class="emoji">📋</span>
        No hay revisiones registradas en ese período.</div>`;
      return;
    }

    $("#lista").innerHTML = lista
      .map((i) => {
        const punto = i.asa_puntos_control || {};
        const fotos = Array.isArray(i.fotos) ? i.fotos : [];
        const estado = i.estado_punto === "ok" ? "ok" : i.estado_punto === "actividad" ? "alerta" : "mal";
        return `
        <div class="registro">
          <div class="cab">
            <div>
              <div class="punto">
                ${esc(punto.numero_habitacion || punto.codigo_visible || "Punto")}
                <span class="marca ${estado}">${esc(i.estado_punto)}</span>
                ${
                  i.nivel_actividad && i.nivel_actividad !== "ninguna"
                    ? `<span class="marca alerta">actividad ${esc(i.nivel_actividad)}</span>`
                    : ""
                }
              </div>
              <div class="meta">
                ${esc(i.asa_areas?.nombre || punto.asa_areas?.nombre || "")}
                ${i.asa_empleados?.nombre_completo ? ` · ${esc(i.asa_empleados.nombre_completo)}` : ""}
              </div>
              ${i.notas ? `<div class="meta">${esc(i.notas)}</div>` : ""}
            </div>
            <div class="fecha">${fechaHora(i.fecha)}</div>
          </div>
          ${
            fotos.length
              ? `<div class="fotos">${fotos
                  .map((f) => `<img src="${esc(typeof f === "string" ? f : f.url)}" alt="Evidencia" />`)
                  .join("")}</div>`
              : ""
          }
        </div>`;
      })
      .join("");

    // Visor de fotos a pantalla completa
    $$("#lista .fotos img").forEach((img) =>
      img.addEventListener("click", () => {
        const visor = document.createElement("div");
        visor.className = "visor";
        visor.innerHTML = `<img src="${img.src}" alt="Evidencia" />`;
        visor.addEventListener("click", () => visor.remove());
        document.body.appendChild(visor);
      })
    );
  }
  await cargar();
}

async function descargarExcel() {
  try {
    const res = await fetch(`${CONFIG.API_BASE}/reportes/excel?sitio_id=${PLANTA.id}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `historial-${PLANTA.nombre.replace(/\s+/g, "-").toLowerCase()}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(`No se pudo descargar: ${e.message}`);
  }
}

// ── Hallazgos ────────────────────────────────────────────────────────────
async function vistaHallazgos(cuerpo) {
  const r = await GET(`/hallazgos?sitio_id=${PLANTA.id}`);
  const lista = Array.isArray(r) ? r : r.hallazgos || [];
  const abiertos = lista.filter((h) => h.estado !== "corregido");

  cuerpo.innerHTML = `
    <div class="tarjeta">
      <h2>Condiciones reportadas por ASA</h2>
      <p style="margin:0 0 14px;color:var(--suave);font-size:13.5px">
        Son las condiciones que el técnico encontró y que corresponde corregir
        al hotel: puertas sin sellar, drenajes sin rejilla, acumulación de
        residuos. Quedan registradas con fecha para la auditoría.
      </p>
      ${
        abiertos.length
          ? abiertos
              .map(
                (h) => `
        <div class="registro">
          <div class="cab">
            <div>
              <div class="punto">
                ${esc(h.titulo || h.descripcion || "Hallazgo")}
                <span class="marca ${h.severidad === "critica" ? "mal" : h.severidad === "alta" ? "alerta" : "neutra"}">
                  ${esc(h.severidad || "media")}
                </span>
              </div>
              <div class="meta">${esc(h.asa_areas?.nombre || "")} · ${esc(h.estado)}</div>
              ${h.descripcion && h.titulo ? `<div class="meta">${esc(h.descripcion)}</div>` : ""}
            </div>
            <div class="fecha">${fecha(h.created_at)}</div>
          </div>
        </div>`
              )
              .join("")
          : `<div class="vacio"><span class="emoji">✅</span>No hay condiciones pendientes de corregir.</div>`
      }
    </div>`;
}

// ── Órdenes de trabajo ───────────────────────────────────────────────────
async function vistaOrdenes(cuerpo) {
  cuerpo.innerHTML = `
    ${AVISO_ORDEN ? `<div class="aviso-ok">${AVISO_ORDEN}</div>` : ""}
    <div class="acciones">
      <button class="btn principal" id="btn-reportar">Reportar una plaga</button>
    </div>
    <div id="form-zona"></div>
    <div class="tarjeta" id="lista"><div class="cargando">Cargando…</div></div>`;

  $("#btn-reportar").addEventListener("click", formularioReporte);
  AVISO_ORDEN = null;   // se muestra una sola vez

  const r = await GET(`/plagas/ordenes?sitio_id=${PLANTA.id}`);
  const lista = Array.isArray(r) ? r : r.ordenes || [];

  $("#lista").innerHTML = lista.length
    ? lista
        .map((o) => {
          const cerrada = ["completada", "cancelada"].includes(o.estado);
          return `
      <div class="registro">
        <div class="cab">
          <div>
            <div class="punto">
              ${esc(o.numero_orden || "Orden")}
              <span class="marca ${cerrada ? "ok" : o.estado === "solicitada" ? "alerta" : "neutra"}">${esc(o.estado)}</span>
              ${o.prioridad === "urgente" ? `<span class="marca mal">urgente</span>` : ""}
            </div>
            <div class="meta">${esc(o.tipo_plaga_reportada || "Sin tipo")} · ${esc(o.descripcion_cliente || "")}</div>
            ${o.fecha_agendada ? `<div class="meta">Agendada: ${fechaHora(o.fecha_agendada)}</div>` : ""}
            ${o.fecha_ejecucion ? `<div class="meta">Atendida: ${fechaHora(o.fecha_ejecucion)}</div>` : ""}
          </div>
          <div class="fecha">${fechaHora(o.fecha_solicitud || o.created_at)}</div>
        </div>
      </div>`;
        })
        .join("")
    : `<div class="vacio"><span class="emoji">🧾</span>No hay órdenes de trabajo para esta planta.</div>`;
}

function formularioReporte() {
  const zona = $("#form-zona");
  if ($("#form-reporte")) { zona.innerHTML = ""; return; }

  zona.innerHTML = `
    <form class="tarjeta" id="form-reporte">
      <h2>Reportar una plaga</h2>
      <p style="margin:0 0 14px;color:var(--suave);font-size:13px">
        Crea una orden de trabajo para ${esc(PLANTA.nombre)}. Operaciones de
        ${esc(CONFIG.EMPRESA)} la recibe y agenda la visita.
      </p>
      <label class="campo">Tipo de plaga
        <select name="tipo" required>
          <option value="">Elige una…</option>
          <option>Cucarachas</option>
          <option>Moscas</option>
          <option>Roedores</option>
          <option>Hormigas</option>
          <option>Chinches</option>
          <option>Mosquitos</option>
          <option>Termitas</option>
          <option>Otra</option>
        </select>
      </label>
      <label class="campo">Urgencia
        <select name="prioridad">
          <option value="normal">Normal</option>
          <option value="alta">Alta</option>
          <option value="urgente">Urgente — afecta la operación</option>
        </select>
      </label>
      <label class="campo">¿Dónde y qué se observó?
        <textarea name="descripcion" rows="3" required
          placeholder="Cocina El Faro, detrás de la cámara de refrigeración. Se ven cucarachas en el turno de la noche."></textarea>
        <small>Mientras más preciso el lugar, más rápido lo resuelve el técnico.</small>
      </label>
      <div class="acciones" style="margin:0">
        <button type="submit" class="btn principal" id="btn-enviar">Enviar reporte</button>
        <button type="button" class="btn" id="btn-cancelar">Cancelar</button>
      </div>
    </form>`;

  $("#btn-cancelar").addEventListener("click", () => (zona.innerHTML = ""));

  $("#form-reporte").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const btn = $("#btn-enviar");
    btn.disabled = true; btn.textContent = "Enviando…";
    try {
      const orden = await POST("/plagas/reportar", {
        cliente_id: PLANTA.cliente_id,
        sitio_id: PLANTA.id,
        tipo_plaga_reportada: fd.get("tipo"),
        prioridad: fd.get("prioridad"),
        descripcion_cliente: (fd.get("descripcion") || "").trim(),
      });
      AVISO_ORDEN =
        `Reporte enviado. Tu orden es <strong>${esc(orden.numero_orden || "")}</strong>. ` +
        `Puedes seguir su estado en esta misma lista.`;
      await pintarPestana();
    } catch (e) {
      const err = document.createElement("div");
      err.className = "error";
      err.textContent = e.message;
      ev.target.appendChild(err);
      btn.disabled = false; btn.textContent = "Enviar reporte";
    }
  });
}

// ── Arranque ─────────────────────────────────────────────────────────────
async function arrancar() {
  if (!TOKEN) return pantallaLogin();

  try {
    PLANTAS = await GET("/sitios");
  } catch (e) {
    return salir(e.message);
  }

  if (!PLANTAS.length) {
    app().innerHTML = `<div class="vacio" style="padding-top:80px">
      <span class="emoji">🏨</span>
      Tu cuenta todavía no tiene hoteles asignados.<br />
      Pídele a ${esc(CONFIG.EMPRESA)} que te los asigne.
      <div style="margin-top:18px"><button class="btn" onclick="salir()">Salir</button></div>
    </div>`;
    return;
  }

  // Si la planta guardada ya no está asignada, se cae a la primera disponible
  PLANTA = PLANTAS.find((p) => p.id === PLANTA?.id) || PLANTAS[0];
  guardarJSON("asa_portal_planta", PLANTA);

  pintarMarco();
  await pintarPestana();
}

arrancar();
