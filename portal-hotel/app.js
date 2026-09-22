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
    ["pendientes", "Por hacer"],
    ["mapa", "Mapa"],
    ["hallazgos", "Hallazgos"],
    ["ordenes", "Solicitudes"],
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
  const vistas = { hoy: vistaHoy, historial: vistaHistorial, pendientes: vistaPendientes, mapa: vistaMapa, hallazgos: vistaHallazgos, ordenes: vistaOrdenes };
  try {
    await vistas[PESTANA](cuerpo);
  } catch (e) {
    cuerpo.innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
}

// ── Textos compartidos ───────────────────────────────────────────────────
const MOTIVOS_TEXTO = {
  permiso_denegado: "El hotel no autorizó el acceso",
  huesped_en_habitacion: "Huésped dentro de la habitación",
  area_ocupada: "Área ocupada al momento de la visita",
  sin_llave: "No había quien abriera",
  en_mantenimiento: "Área en obra o mantenimiento",
  punto_inaccesible: "Punto bloqueado o inaccesible",
  evento_en_curso: "Evento en curso en el área",
  otro: "Otro motivo",
};
const ESTADO_TEXTO = {
  ok: "Conforme", actividad: "Con actividad", "dañado": "Dañado",
  faltante: "Faltante", no_accesible: "No realizado", reemplazado: "Reemplazado",
};
const NIVEL_TEXTO = {
  ninguna: "Sin actividad", bajo: "Actividad baja",
  medio: "Actividad media", alto: "Actividad alta",
};
// De quién es el pendiente. No es un detalle: es lo que se discute en auditoría.
const MOTIVOS_DEL_HOTEL = ["permiso_denegado", "sin_llave", "huesped_en_habitacion", "area_ocupada", "evento_en_curso"];

const horaCorta = (d) =>
  new Date(d).toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" });

// ── Hoy ──────────────────────────────────────────────────────────────────
//
// Solo lo que SE HIZO hoy. Lo que falta vive en "Por hacer": mezclarlos hacía
// que la pantalla de entrada pareciera llena de problemas a las 7 de la mañana,
// cuando todavía no había pasado nada.
async function vistaHoy(cuerpo) {
  const d = await GET(`/inspecciones/dia?sitio_id=${PLANTA.id}`);
  const r = d.resumen;

  if (!r.hechos) {
    cuerpo.innerHTML = `
      <div class="vacio">
        <span class="emoji">🕗</span>
        Todavía no se ha registrado ningún servicio hoy.
        <div style="margin-top:10px;font-size:13px">
          Esta pantalla se llena sola a medida que el técnico va escaneando los
          puntos. ${r.pendientes || r.no_realizados
            ? `Mientras tanto, en <strong>Por hacer</strong> está lo que queda pendiente.`
            : ""}
        </div>
      </div>`;
    return;
  }

  cuerpo.innerHTML = `
    <div class="kpis">
      <div class="kpi ok"><div class="n">${r.hechos}</div><div class="t">Servicios realizados hoy</div></div>
      <div class="kpi ${r.con_actividad ? "mal" : "ok"}">
        <div class="n">${r.con_actividad}</div><div class="t">Con actividad detectada</div>
      </div>
      <div class="kpi"><div class="n">${r.plagas_contadas}</div><div class="t">Individuos contados</div></div>
      <div class="kpi ${r.no_realizados ? "mal" : ""}">
        <div class="n">${r.no_realizados}</div><div class="t">No se pudieron hacer</div>
      </div>
    </div>

    ${r.tecnicos.length ? `<p style="color:var(--suave);font-size:13px;margin:0 0 14px">
      Trabajaron: <strong>${esc(r.tecnicos.join(", "))}</strong>.
    </p>` : ""}

    ${d.por_tipo.filter((t) => t.hechos).map((t) => `
      <div class="tarjeta">
        <h2>${esc(t.tipo_nombre || "Otros servicios")} · ${t.hechos}</h2>
        ${d.realizados.filter((x) => x.tipo_codigo === t.tipo_codigo).map(filaServicio).join("")}
      </div>`).join("")}

    <p style="color:var(--suave);font-size:12.5px;text-align:center">
      Toca cualquier servicio para ver todo lo que se hizo, con sus fotos.
    </p>`;

  engancharServicios(cuerpo);
}

// Una línea de servicio, la misma en Hoy y en Historial.
function filaServicio(s) {
  const titulo = s.numero_habitacion ? `Habitación ${s.numero_habitacion}` : (s.punto_nombre || s.codigo_visible);
  const nivel = s.nivel_actividad && s.nivel_actividad !== "ninguna";
  return `
    <div class="registro clicable" data-insp="${esc(s.inspeccion_id || s.id)}">
      <div class="cab">
        <div>
          <div class="punto">
            ${esc(titulo)}
            <span class="marca ${nivel ? "alerta" : "ok"}">${esc(nivel ? NIVEL_TEXTO[s.nivel_actividad] : "Conforme")}</span>
          </div>
          <div class="meta">
            ${esc([s.codigo_visible, s.area, s.tipo_nombre].filter(Boolean).join(" · "))}
          </div>
          <div class="meta">${esc(s.tecnico || "")}</div>
        </div>
        <div class="fecha">
          ${esc(horaCorta(s.fecha))}
          ${s.fotos_total ? `<div class="marca neutra" style="margin-top:4px">${s.fotos_total} fotos</div>` : ""}
        </div>
      </div>
    </div>`;
}

function engancharServicios(raiz) {
  raiz.querySelectorAll("[data-insp]").forEach((el) =>
    el.addEventListener("click", () => abrirServicio(el.dataset.insp))
  );
}

// ── Por hacer ────────────────────────────────────────────────────────────
//
// Arriba, el semáforo: cada punto del tipo elegido (habitaciones, cebaderos,
// lámparas...) agrupado por área, en VERDE lo que está hecho y en ROJO lo que
// falta por hacer. Abajo, el detalle de lo que el técnico intentó hoy y no pudo
// (con su motivo y con quién habló), porque no es lo mismo que el hotel no
// autorizara el acceso a que ASA no llegara.
let PH_TIPO = null;
let PH_VER = "";

async function vistaPendientes(cuerpo) {
  const qs = new URLSearchParams({ sitio_id: PLANTA.id });
  if (PH_TIPO) qs.set("tipo", PH_TIPO);
  let [e, d] = await Promise.all([GET(`/puntos/estado?${qs}`), GET(`/inspecciones/dia?sitio_id=${PLANTA.id}`)]);

  if (!e.tipos.length) {
    cuerpo.innerHTML = `<div class="vacio"><span class="emoji">📍</span>Esta planta todavía no tiene puntos de control cargados.</div>`;
    return;
  }
  // El tipo elegido puede no existir en otra planta: se vuelve a elegir.
  if (!PH_TIPO || !e.tipos.some((t) => t.codigo === PH_TIPO)) {
    PH_TIPO = (e.tipos.find((t) => t.codigo === "habitacion") || e.tipos[0]).codigo;
    e = await GET(`/puntos/estado?${new URLSearchParams({ sitio_id: PLANTA.id, tipo: PH_TIPO })}`);
  }

  const esVerde = (p) => p.estado === "hecho_hoy" || p.estado === "al_dia";
  const verdes = e.puntos.filter(esVerde).length;
  const rojos = e.puntos.length - verdes;
  const pct = e.puntos.length ? Math.round((verdes / e.puntos.length) * 100) : 0;
  const tipoNombre = e.tipos.find((t) => t.codigo === PH_TIPO)?.nombre || "Puntos";

  const visibles = e.puntos.filter((p) => (PH_VER === "rojo" ? !esVerde(p) : PH_VER === "verde" ? esVerde(p) : true));
  const grupos = new Map();
  for (const p of visibles) {
    const k = p.area_id || "sin_area";
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(p);
  }
  const areas = e.areas.filter((a) => grupos.has(a.id || "sin_area"));

  const detalle = (p) =>
    [
      p.punto_nombre || p.codigo_visible,
      p.estado === "hecho_hoy" ? `Hecho hoy ${p.hora ? horaCorta(p.hora) : ""}` :
      p.estado === "al_dia" ? `Hecho el ${fecha(p.ultima_inspeccion)} · al día` :
      p.estado === "no_realizado" ? `No se pudo hoy: ${MOTIVOS_TEXTO[p.motivo_no_realizado] || "sin motivo"}` :
      p.ultima_inspeccion ? `Por hacer · último servicio ${fecha(p.ultima_inspeccion)}` : "Por hacer · nunca revisado",
    ].join("\n");

  const noRealizados = d.no_realizados;

  cuerpo.innerHTML = `
    <div class="acciones">
      <select class="btn" id="ph-tipo">
        ${e.tipos.map((t) => `<option value="${esc(t.codigo)}"${t.codigo === PH_TIPO ? " selected" : ""}>${esc(t.icono || "")} ${esc(t.nombre)}</option>`).join("")}
      </select>
      <select class="btn" id="ph-ver">
        <option value="">Todo</option>
        <option value="rojo"${PH_VER === "rojo" ? " selected" : ""}>Solo lo que falta</option>
        <option value="verde"${PH_VER === "verde" ? " selected" : ""}>Solo lo hecho</option>
      </select>
    </div>

    <div class="kpis">
      <div class="kpi ok"><div class="n">${verdes}</div><div class="t">${esc(tipoNombre)} hechos</div></div>
      <div class="kpi ${rojos ? "mal" : "ok"}"><div class="n">${rojos}</div><div class="t">Por hacer</div></div>
      <div class="kpi"><div class="n">${pct}%</div><div class="t">Avance del ciclo</div></div>
    </div>

    <div class="leyenda-semaforo">
      <span><i class="punto-verde"></i> Hecho</span>
      <span><i class="punto-rojo"></i> Por hacer</span>
    </div>

    ${areas.length
      ? areas.map((a) => {
          const ps = grupos.get(a.id || "sin_area");
          return `
        <div class="tarjeta">
          <h2>${esc(a.nombre)}
            ${a.por_hacer ? `<span class="marca mal">${a.por_hacer} por hacer</span>` : `<span class="marca ok">Completa</span>`}
          </h2>
          <div class="semaforo">
            ${ps.map((p) => `
              <div class="celda ${esVerde(p) ? "verde" : "rojo"}${p.inspeccion_id ? " clicable" : ""}"
                   title="${esc(detalle(p))}"
                   ${p.inspeccion_id ? `data-insp="${esc(p.inspeccion_id)}"` : ""}>
                ${esc(p.numero_habitacion || p.codigo_visible)}
              </div>`).join("")}
          </div>
        </div>`;
        }).join("")
      : `<div class="vacio"><span class="emoji">✅</span>${PH_VER === "rojo" ? "No falta nada por hacer." : "No hay puntos con este filtro."}</div>`}

    ${noRealizados.length ? `
      <div class="tarjeta borde-rojo">
        <h2>Hoy se intentó y no se pudo — ${noRealizados.length}</h2>
        <p style="margin:0 0 12px;color:var(--suave);font-size:13px">
          El técnico se presentó y no pudo trabajar el punto. Queda registrado el
          motivo y con quién se habló.
        </p>
        ${noRealizados.map((n) => `
          <div class="registro clicable" data-insp="${esc(n.inspeccion_id)}">
            <div class="cab">
              <div>
                <div class="punto">
                  ${esc(n.numero_habitacion ? `Habitación ${n.numero_habitacion}` : n.codigo_visible)}
                  <span class="marca ${MOTIVOS_DEL_HOTEL.includes(n.motivo_no_realizado) ? "alerta" : "mal"}">
                    ${MOTIVOS_DEL_HOTEL.includes(n.motivo_no_realizado) ? "Depende del hotel" : "Pendiente de ASA"}
                  </span>
                </div>
                <div class="meta">${esc(MOTIVOS_TEXTO[n.motivo_no_realizado] || n.motivo_no_realizado || "Sin motivo")}</div>
                ${n.impedido_por ? `<div class="meta">Informado por: ${esc(n.impedido_por)}</div>` : ""}
                <div class="meta">${esc([n.area, n.tecnico].filter(Boolean).join(" · "))}</div>
              </div>
              <div class="fecha">${esc(horaCorta(n.fecha))}</div>
            </div>
          </div>`).join("")}
      </div>` : ""}

    <p style="color:var(--suave);font-size:12.5px;text-align:center">
      Verde: hecho dentro de su frecuencia. Rojo: le toca y todavía no se ha hecho.
      Toca un punto hecho hoy para ver el servicio completo.
    </p>`;

  $("#ph-tipo").addEventListener("change", (ev) => { PH_TIPO = ev.target.value; vistaPendientes(cuerpo); });
  $("#ph-ver").addEventListener("change", (ev) => { PH_VER = ev.target.value; vistaPendientes(cuerpo); });
  engancharServicios(cuerpo);
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
      <button class="btn principal" id="btn-pdf">Generar reporte (PDF)</button>
    </div>
    <p class="nota-reporte">
      El PDF trae el gráfico de barras del período, todas las revisiones con las
      preguntas que el técnico verificó, las plagas contadas y sus fotos — y lo
      que no se pudo hacer, con el motivo. Es el documento para auditoría.
    </p>
    <div class="tarjeta" id="lista"><div class="cargando">Cargando…</div></div>`;

  $("#btn-pdf").addEventListener("click", descargarReportePdf);
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

    // Agrupado por día: un chorro de 300 revisiones seguidas no se lee, y el
    // hotel piensa en días ("¿qué se hizo el martes?"), no en filas.
    const porDia = {};
    for (const i of lista) {
      const dia = String(i.fecha_local || i.fecha).slice(0, 10);
      (porDia[dia] = porDia[dia] || []).push(i);
    }

    $("#lista").innerHTML = Object.entries(porDia)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([dia, items]) => `
        <div class="dia-cabecera">${esc(fecha(dia))} · ${items.length} ${items.length === 1 ? "revisión" : "revisiones"}</div>
        ${items.map((i) => {
          const punto = i.asa_puntos_control || {};
          const noHecho = !!i.motivo_no_realizado;
          const nivel = i.nivel_actividad && i.nivel_actividad !== "ninguna";
          const fotos = Array.isArray(i.fotos) ? i.fotos : [];
          return `
          <div class="registro clicable" data-insp="${esc(i.id)}">
            <div class="cab">
              <div>
                <div class="punto">
                  ${esc(punto.numero_habitacion ? `Habitación ${punto.numero_habitacion}` : punto.codigo_visible || "Punto")}
                  <span class="marca ${noHecho ? "mal" : nivel ? "alerta" : "ok"}">
                    ${esc(noHecho ? "No realizado" : nivel ? NIVEL_TEXTO[i.nivel_actividad] : "Conforme")}
                  </span>
                </div>
                <div class="meta">
                  ${esc([
                    punto.asa_tipos_punto?.nombre,
                    i.asa_areas?.nombre || punto.asa_areas?.nombre,
                    i.asa_empleados?.nombre_completo,
                  ].filter(Boolean).join(" · "))}
                </div>
                ${noHecho ? `<div class="meta">${esc(MOTIVOS_TEXTO[i.motivo_no_realizado] || i.motivo_no_realizado)}</div>` : ""}
                ${i.notas ? `<div class="meta">${esc(i.notas)}</div>` : ""}
              </div>
              <div class="fecha">
                ${esc(horaCorta(i.fecha))}
                ${fotos.length ? `<div class="marca neutra" style="margin-top:4px">${fotos.length} fotos</div>` : ""}
              </div>
            </div>
          </div>`;
        }).join("")}
      `).join("");

    $("#lista").insertAdjacentHTML("beforeend",
      `<p style="color:var(--suave);font-size:12.5px;text-align:center;margin:16px 0 0">
         Toca una revisión para ver todo lo que se hizo, con sus fotos, y poder imprimirlo.
       </p>`);

    engancharServicios($("#lista"));
  }
  await cargar();
}

// El reporte de auditoría en PDF. Se arma en el servidor y no aquí para que sea
// exactamente el mismo documento que saca ASA desde su panel — un PDF del hotel
// que no cuadre con el de ASA es una discusión asegurada. El servidor limita la
// consulta a las plantas de esta cuenta, así que el hotel solo saca el suyo.
async function descargarReportePdf() {
  const boton = $("#btn-pdf");
  const original = boton.textContent;
  const dias = Number($("#dias").value) || 30;
  const desde = new Date(Date.now() - (dias - 1) * 86400000)
    .toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });

  boton.disabled = true;
  boton.textContent = "Generando… puede tardar";
  try {
    const qs = new URLSearchParams({
      sitio_id: PLANTA.id,
      desde,
      hasta: hoyLocal(),
      agrupar: dias > 60 ? "semana" : "dia",
    });
    const res = await fetch(`${CONFIG.API_BASE}/reportes/pdf?${qs}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) {
      let mensaje = `El servidor respondió ${res.status}`;
      try { mensaje = (await res.json()).mensaje || mensaje; } catch {}
      throw new Error(mensaje);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reporte-${PLANTA.nombre.replace(/\s+/g, "-").toLowerCase()}-${desde}-a-${hoyLocal()}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(`No se pudo generar el reporte: ${e.message}`);
  } finally {
    boton.disabled = false;
    boton.textContent = original;
  }
}

// ── Ficha completa de un servicio ────────────────────────────────────────
//
// Se abre como una hoja a pantalla completa y no como ventana aparte: esto se
// usa desde el celular o la tableta del encargado de calidad caminando por el
// hotel, y una ventana emergente ahí es una pelea con el navegador.
async function abrirServicio(inspeccionId) {
  const hoja = document.createElement("div");
  hoja.className = "hoja";
  hoja.innerHTML = `
    <div class="hoja-barra">
      <button class="btn" id="hoja-cerrar">← Volver</button>
      <button class="btn principal" id="hoja-imprimir">Imprimir</button>
    </div>
    <div class="hoja-cuerpo" id="hoja-cuerpo"><div class="cargando">Cargando…</div></div>`;
  document.body.appendChild(hoja);
  document.body.style.overflow = "hidden";

  const cerrar = () => {
    hoja.remove();
    document.body.style.overflow = "";
  };
  $("#hoja-cerrar", hoja).addEventListener("click", cerrar);

  let d;
  try {
    d = await GET(`/inspecciones/${inspeccionId}/desglose`);
  } catch (e) {
    $("#hoja-cuerpo", hoja).innerHTML = `<div class="error">${esc(e.message)}</div>`;
    return;
  }

  $("#hoja-cuerpo", hoja).innerHTML = fichaServicioHTML(d);
  $("#hoja-imprimir", hoja).addEventListener("click", () => imprimirServicio(d));

  // Ver una foto en grande, igual que en el historial
  $$(".fs-fotos img", hoja).forEach((img) =>
    img.addEventListener("click", () => {
      const visor = document.createElement("div");
      visor.className = "visor";
      visor.innerHTML = `<img src="${img.src}" alt="Evidencia" />`;
      visor.addEventListener("click", () => visor.remove());
      document.body.appendChild(visor);
    })
  );
}

function fichaServicioHTML(d) {
  const noHecho = !!d.motivo_no_realizado;
  const fotos = [...(d.fotos || []), ...(d.respuestas || []).flatMap((r) => r.fotos || [])];

  const dato = (k, v) => (v ? `<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>` : "");

  return `
    <div class="ficha">
      <div class="fs-cabecera ${noHecho ? "no-hecho" : ""}">
        <div>
          <div class="fs-titulo">${esc(d.punto.nombre || d.punto.codigo)}</div>
          <div class="fs-sub">${esc(d.punto.codigo)} · ${esc(d.punto.tipo || "")}</div>
        </div>
        <div class="fs-estado ${noHecho ? "rojo" : ""}">
          ${esc(noHecho ? "NO REALIZADO" : ESTADO_TEXTO[d.estado_punto] || d.estado_punto)}
          <small>${esc(noHecho ? "" : NIVEL_TEXTO[d.nivel_actividad] || "")}</small>
        </div>
      </div>

      <div class="fs-datos">
        ${dato("Planta", d.planta)}
        ${dato("Área", [d.area, d.nivel ? `Nivel ${d.nivel}` : null].filter(Boolean).join(" · "))}
        ${dato("Ubicación", d.punto.ubicacion)}
        ${dato("Técnico", d.tecnico)}
        ${dato("Fecha y hora", fechaHora(d.fecha))}
        ${dato("Registrado por", d.metodo_acceso === "qr" ? "Escaneo de QR" : d.metodo_acceso)}
        ${dato("Frecuencia", d.punto.frecuencia)}
      </div>

      ${noHecho ? `
        <div class="fs-alerta">
          <strong>No se pudo realizar:</strong> ${esc(MOTIVOS_TEXTO[d.motivo_no_realizado] || d.motivo_no_realizado)}
          ${d.impedido_por ? `<br>Informado por: ${esc(d.impedido_por)}` : ""}
          <br>Responsable del pendiente:
          <strong>${MOTIVOS_DEL_HOTEL.includes(d.motivo_no_realizado) ? "el hotel" : "ASA"}</strong>
        </div>` : ""}

      ${d.respuestas?.length ? `
        <h3>Lo que el técnico verificó</h3>
        <table class="fs-tabla">
          <thead><tr><th style="width:44px">Visto</th><th>Pregunta</th><th>Respuesta</th></tr></thead>
          <tbody>
            ${d.respuestas.map((r) => `
              <tr>
                <td style="text-align:center;color:var(--verde);font-weight:700">✓</td>
                <td>${esc(r.pregunta_texto)}</td>
                <td><strong>${esc(valorRespuesta(r))}</strong></td>
              </tr>`).join("")}
          </tbody>
        </table>` : ""}

      ${d.capturas?.length ? `
        <h3>Plagas encontradas</h3>
        <table class="fs-tabla">
          <thead><tr><th>Plaga</th><th>Grupo</th><th style="text-align:right">Cantidad</th><th>Etapa</th></tr></thead>
          <tbody>
            ${d.capturas.map((c) => `
              <tr class="${c.sobre_umbral ? "sobre-umbral" : ""}">
                <td><strong>${esc(c.plaga)}</strong></td>
                <td>${esc(c.grupo || "—")}</td>
                <td style="text-align:right">${c.cantidad}</td>
                <td>${esc(c.etapa || "—")}${c.sobre_umbral ? " · sobre el umbral" : ""}</td>
              </tr>`).join("")}
          </tbody>
        </table>` : ""}

      ${d.hallazgos?.length ? `
        <h3>Condiciones reportadas en esta visita</h3>
        <ul class="fs-hallazgos">
          ${d.hallazgos.map((h) => `
            <li>
              <strong>${esc(h.titulo)}</strong>
              <span class="marca ${h.severidad === "critica" ? "mal" : "alerta"}">${esc(h.severidad)}</span>
              <span class="marca neutra">${h.responsable === "cliente" ? "Hotel" : "ASA"}</span>
              ${h.descripcion ? `<div class="meta">${esc(h.descripcion)}</div>` : ""}
            </li>`).join("")}
        </ul>` : ""}

      ${d.notas ? `<h3>Observaciones del técnico</h3><p>${esc(d.notas)}</p>` : ""}

      ${fotos.length ? `
        <h3>Evidencia fotográfica — ${fotos.length}</h3>
        <div class="fs-fotos">
          ${fotos.map((f, i) => `
            <figure>
              <img src="${esc(f)}" alt="Evidencia ${i + 1}" loading="lazy" />
              <figcaption>${esc(d.punto.codigo)} · ${esc(d.area || "")}</figcaption>
            </figure>`).join("")}
        </div>` : ""}
    </div>`;
}

function valorRespuesta(r) {
  if (r.valor_bool !== null && r.valor_bool !== undefined) return r.valor_bool ? "Sí" : "No";
  if (r.valor_numero !== null && r.valor_numero !== undefined) return String(r.valor_numero);
  if (Array.isArray(r.valor_opciones) && r.valor_opciones.length) return r.valor_opciones.join(", ");
  return r.valor_texto || "—";
}

// Imprime en la MISMA página con una capa temporal. Nada de abrir otra ventana
// y volver a escribirle el HTML: las fotos de las revisiones viejas están
// guardadas en base64 dentro del propio registro, y copiarlas a otra ventana
// son megabytes de texto que traban el navegador del celular.
async function imprimirServicio(d) {
  document.getElementById("area-impresion")?.remove();

  const capa = document.createElement("div");
  capa.id = "area-impresion";
  capa.innerHTML = `
    <div class="imp-encabezado">
      <div>
        <h1>${esc(CONFIG.EMPRESA)}</h1>
        <p>Comprobante de servicio · Control integrado de plagas</p>
        <p>${esc(d.planta || "")}${d.cliente ? ` · ${esc(d.cliente)}` : ""}</p>
      </div>
      <p>Impreso el ${esc(new Date().toLocaleString("es-DO"))}</p>
    </div>
    ${fichaServicioHTML(d)}`;
  document.body.appendChild(capa);

  // Sin esto el navegador dispara el diálogo antes de que lleguen las fotos y
  // salen los recuadros vacíos. Con tope: una foto que no carga no puede dejar
  // al encargado sin imprimir el resto.
  const fotos = [...capa.querySelectorAll("img")];
  await Promise.race([
    Promise.all(fotos.map((img) => img.complete
      ? Promise.resolve()
      : new Promise((ok) => { img.onload = ok; img.onerror = ok; }))),
    new Promise((ok) => setTimeout(ok, 8000)),
  ]);

  const limpiar = () => {
    capa.remove();
    window.removeEventListener("afterprint", limpiar);
  };
  window.addEventListener("afterprint", limpiar);
  setTimeout(limpiar, 60000);   // Safari en iOS no dispara afterprint

  window.print();
}

// ── Mapa ─────────────────────────────────────────────────────────────────
//
// Los planos de la planta que ASA subió desde el panel. Si el plano es una
// imagen, encima van los puntos de control en VERDE (hecho) o ROJO (por
// hacer), con el mismo criterio de "Por hacer". Si es un PDF (los que salen
// de QGIS), los puntos ya vienen dibujados dentro del archivo y se muestra tal
// cual, con botón para abrirlo en pantalla completa en el celular.
let MAPA_PLANO = null;

async function vistaMapa(cuerpo) {
  const [planos, estado] = await Promise.all([
    GET(`/sitios/${PLANTA.id}/planos`),
    GET(`/puntos/estado?sitio_id=${PLANTA.id}`).catch(() => null),
  ]);

  if (!planos.length) {
    cuerpo.innerHTML = `<div class="vacio"><span class="emoji">🗺️</span>
      Todavía no hay planos cargados para esta planta.<br>
      Pídeselo a ${esc(CONFIG.EMPRESA)} y aparecerán aquí.</div>`;
    return;
  }
  if (!planos.some((p) => p.id === MAPA_PLANO)) MAPA_PLANO = planos[0].id;
  const plano = planos.find((p) => p.id === MAPA_PLANO);
  const esPdf = plano.tipo_archivo === "pdf" || /\.pdf($|\?)/i.test(plano.imagen_url || "");

  const estadoDe = new Map((estado?.puntos || []).map((p) => [p.id, p]));
  const verde = (e) => e === "hecho_hoy" || e === "al_dia";
  const pins = plano.puntos.filter((p) => p.plano_x != null && p.plano_y != null);
  const nVerde = pins.filter((p) => verde(estadoDe.get(p.id)?.estado)).length;

  cuerpo.innerHTML = `
    <div class="acciones">
      ${planos.length > 1 ? `
        <select class="btn" id="mapa-plano">
          ${planos.map((p) => `<option value="${esc(p.id)}"${p.id === MAPA_PLANO ? " selected" : ""}>${esc(p.nombre)}</option>`).join("")}
        </select>` : `<strong style="align-self:center">${esc(plano.nombre)}</strong>`}
      <a class="btn" href="${esc(plano.imagen_url)}" target="_blank" rel="noopener">⤢ Pantalla completa</a>
    </div>

    ${esPdf ? `
      <div class="mapa-pdf">
        <iframe src="${esc(plano.imagen_url)}#toolbar=1&view=FitH" title="${esc(plano.nombre)}"></iframe>
      </div>
      <p style="color:var(--suave);font-size:12.5px;text-align:center">
        Los puntos de control vienen marcados dentro del plano. En el celular, si no
        se ve completo, toca <strong>Pantalla completa</strong>.
      </p>` : `
      ${pins.length ? `
        <div class="leyenda-semaforo">
          <span><i class="punto-verde"></i> Hecho (${nVerde})</span>
          <span><i class="punto-rojo"></i> Por hacer (${pins.length - nVerde})</span>
        </div>` : ""}
      <div class="mapa-img" id="mapa-img">
        <img src="${esc(plano.imagen_url)}" alt="${esc(plano.nombre)}" />
        ${pins.map((p) => {
          const e = estadoDe.get(p.id);
          const ok = verde(e?.estado);
          return `<button class="mapa-pin ${ok ? "verde" : "rojo"}" style="left:${Number(p.plano_x)}%;top:${Number(p.plano_y)}%"
                    data-info="${esc([p.codigo_visible, p.nombre, e ? (ok ? "Hecho" : "Por hacer") : "", e?.ultima_inspeccion ? `Último servicio: ${fecha(e.ultima_inspeccion)}` : ""].filter(Boolean).join(" · "))}"
                    ${e?.inspeccion_id && ok ? `data-insp="${esc(e.inspeccion_id)}"` : ""}
                    aria-label="${esc(p.codigo_visible)}"></button>`;
        }).join("")}
      </div>
      <div class="mapa-info" id="mapa-info">${pins.length ? "Toca un punto del plano para ver qué es y cómo está." : ""}</div>`}`;

  $("#mapa-plano")?.addEventListener("change", (ev) => { MAPA_PLANO = ev.target.value; vistaMapa(cuerpo); });
  $$(".mapa-pin", cuerpo).forEach((b) =>
    b.addEventListener("click", () => {
      $$(".mapa-pin.activo", cuerpo).forEach((x) => x.classList.remove("activo"));
      b.classList.add("activo");
      $("#mapa-info").innerHTML = `${esc(b.dataset.info)}${b.dataset.insp ? ` · <a href="#" id="mapa-ver">ver el servicio</a>` : ""}`;
      $("#mapa-ver")?.addEventListener("click", (ev) => { ev.preventDefault(); abrirServicio(b.dataset.insp); });
    })
  );
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

// ── Solicitudes ──────────────────────────────────────────────────────────
//
// Lo que el hotel le pide a ASA: la LISTA DE HABITACIONES que ya liberaron los
// huéspedes (la hoja que antes se le entregaba en papel al técnico) o el
// reporte de una plaga. Cada solicitud muestra sus habitaciones en verde (hecha)
// o en rojo (por hacer) y tiene un hilo de mensajes con ASA y con el técnico.
// Las habitaciones se ponen en verde solas cuando el técnico las inspecciona.
const ESTADO_SOL = {
  solicitada: ["Enviada", "alerta"],
  agendada: ["Recibida por ASA", "neutra"],
  en_ruta: ["Técnico en camino", "neutra"],
  en_sitio: ["En proceso", "neutra"],
  ejecutada: ["Completada", "ok"],
  control_calidad: ["Completada", "ok"],
  facturada: ["Completada", "ok"],
  cerrada: ["Cerrada", "ok"],
  cancelada: ["Cancelada", "mal"],
};
const SOL_ABIERTA = ["solicitada", "agendada", "en_ruta", "en_sitio"];
const TIPO_SOL = { habitaciones: "🛏️ Habitaciones", plaga: "🐜 Reporte de plaga", puntos: "📍 Puntos", otro: "Solicitud" };
let SOL_ABIERTA_ID = null; // detalle abierto (para el refresco automático)

async function vistaOrdenes(cuerpo) {
  SOL_ABIERTA_ID = null;
  cuerpo.innerHTML = `
    ${AVISO_ORDEN ? `<div class="aviso-ok">${AVISO_ORDEN}</div>` : ""}
    <div class="acciones">
      <button class="btn principal" id="btn-habitaciones">🛏️ Enviar habitaciones</button>
      <button class="btn" id="btn-reportar">🐜 Reportar una plaga</button>
    </div>
    <div id="form-zona"></div>
    <div id="lista"><div class="cargando">Cargando…</div></div>`;

  $("#btn-habitaciones").addEventListener("click", () => formularioHabitaciones());
  $("#btn-reportar").addEventListener("click", formularioReporte);
  AVISO_ORDEN = null;   // se muestra una sola vez

  const lista = await GET(`/solicitudes?sitio_id=${PLANTA.id}&dias=30`);
  const abiertas = lista.filter((o) => SOL_ABIERTA.includes(o.estado));
  const cerradas = lista.filter((o) => !SOL_ABIERTA.includes(o.estado));

  $("#lista").innerHTML = lista.length
    ? `${abiertas.length ? `<div class="tarjeta"><h2>Abiertas · ${abiertas.length}</h2>${abiertas.map(filaSolicitud).join("")}</div>` : ""}
       ${cerradas.length ? `<div class="tarjeta"><h2>Últimos 30 días</h2>${cerradas.map(filaSolicitud).join("")}</div>` : ""}`
    : `<div class="vacio"><span class="emoji">🧾</span>
        Todavía no hay solicitudes.<br>
        Cuando salgan huéspedes, envía aquí las habitaciones y el técnico las
        verá al momento en su teléfono.</div>`;

  $$("#lista [data-sol]").forEach((el) => el.addEventListener("click", () => detalleSolicitud(cuerpo, el.dataset.sol)));
}

function filaSolicitud(o) {
  const [txt, clase] = ESTADO_SOL[o.estado] || [o.estado, "neutra"];
  const p = o.puntos;
  const pct = p.total ? Math.round((p.hechos / p.total) * 100) : 0;
  return `
    <div class="registro clicable" data-sol="${esc(o.id)}">
      <div class="cab">
        <div style="flex:1">
          <div class="punto">
            ${esc(TIPO_SOL[o.tipo_solicitud] || "Solicitud")}
            <span class="marca ${clase}">${esc(txt)}</span>
            ${o.prioridad === "urgente" ? `<span class="marca mal">urgente</span>` : o.prioridad === "alta" ? `<span class="marca alerta">alta</span>` : ""}
          </div>
          <div class="meta">
            ${esc(o.numero_orden || "")}
            ${o.creado_por_nombre ? ` · por ${esc(o.creado_por_nombre)}` : ""}
            ${o.fecha_requerida ? ` · para el ${fecha(o.fecha_requerida + "T12:00:00")}` : ""}
          </div>
          ${p.total ? `
            <div class="meta"><strong style="color:var(--verde)">${p.hechos} hechas</strong> ·
              <strong style="color:var(--rojo)">${p.pendientes + p.no_realizados} por hacer</strong> de ${p.total}</div>
            <div class="barra-sol"><span style="width:${pct}%"></span></div>` : ""}
          ${o.tipo_plaga_reportada || o.descripcion_cliente ? `<div class="meta">${esc([o.tipo_plaga_reportada, o.descripcion_cliente].filter(Boolean).join(" · "))}</div>` : ""}
          ${o.recibido_tecnico_nombre ? `<div class="meta">✓ Recibida por ${esc(o.recibido_tecnico_nombre)}</div>` : ""}
        </div>
        <div class="fecha">
          ${fechaHora(o.created_at)}
          ${o.mensajes_total ? `<div class="marca neutra" style="margin-top:4px">💬 ${o.mensajes_total}</div>` : ""}
        </div>
      </div>
    </div>`;
}

// ── Detalle de una solicitud ─────────────────────────────────────────────
async function detalleSolicitud(cuerpo, id, silencioso = false) {
  SOL_ABIERTA_ID = id;
  if (!silencioso) cuerpo.innerHTML = `<div class="cargando">Cargando…</div>`;
  const o = await GET(`/solicitudes/${id}`);
  if (SOL_ABIERTA_ID !== id || !cuerpo.isConnected) return; // ya navegó a otra cosa

  // No pisar lo que el usuario está escribiendo en el refresco automático
  const borrador = $("#sol-texto")?.value || "";

  const [txt, clase] = ESTADO_SOL[o.estado] || [o.estado, "neutra"];
  const abierta = SOL_ABIERTA.includes(o.estado);
  const hechos = o.puntos.filter((p) => p.estado === "hecho");
  const rojos = o.puntos.filter((p) => p.estado === "pendiente" || p.estado === "no_realizado");
  const pasos = [
    ["Enviada", true],
    ["Recibida por ASA", !!o.recibido_tecnico_at || !["solicitada"].includes(o.estado)],
    ["En proceso", ["en_sitio", "ejecutada", "control_calidad", "facturada", "cerrada"].includes(o.estado) || hechos.length > 0],
    ["Completada", ["ejecutada", "control_calidad", "facturada", "cerrada"].includes(o.estado)],
  ];

  const porArea = new Map();
  for (const p of o.puntos) {
    if (!porArea.has(p.area_nombre)) porArea.set(p.area_nombre, []);
    porArea.get(p.area_nombre).push(p);
  }
  const celda = (p) => {
    const verde = p.estado === "hecho";
    const clase = verde ? "verde" : p.estado === "cancelado" ? "gris" : p.estado === "no_realizado" ? "rojo punteado" : "rojo";
    const ayuda = verde
      ? `Hecha ${p.atendido_at ? fechaHora(p.atendido_at) : ""}`
      : p.estado === "no_realizado"
      ? `No se pudo: ${MOTIVOS_TEXTO[p.motivo_no_realizado] || "sin motivo"}`
      : p.estado === "cancelado" ? "Cancelada" : "Por hacer";
    return `<div class="celda ${clase}${p.inspeccion_id && verde ? " clicable" : ""}" title="${esc(ayuda)}"
                 ${p.inspeccion_id && verde ? `data-insp="${esc(p.inspeccion_id)}"` : ""}>
              ${esc(p.numero_habitacion || p.codigo_visible)}
              ${p.estado === "no_realizado" ? `<small>${esc(MOTIVOS_TEXTO[p.motivo_no_realizado] || "no se pudo")}</small>` : ""}
            </div>`;
  };

  cuerpo.innerHTML = `
    <div class="acciones">
      <button class="btn" id="sol-volver">← Solicitudes</button>
      ${abierta && o.tipo_solicitud !== "plaga" ? `<button class="btn" id="sol-agregar">+ Agregar habitaciones</button>` : ""}
      ${abierta ? `<button class="btn" id="sol-cancelar" style="color:var(--rojo)">Cancelar solicitud</button>` : ""}
    </div>

    <div class="tarjeta">
      <h2>${esc(TIPO_SOL[o.tipo_solicitud] || "Solicitud")} · ${esc(o.numero_orden || "")}
        <span class="marca ${clase}">${esc(txt)}</span></h2>
      <div class="pasos">
        ${pasos.map(([t, ok]) => `<div class="paso ${ok ? "ok" : ""}"><span></span>${esc(t)}</div>`).join("")}
      </div>
      <div class="meta">Creada ${fechaHora(o.created_at)}${o.creado_por_nombre ? ` por ${esc(o.creado_por_nombre)}` : ""}</div>
      ${o.fecha_requerida ? `<div class="meta">Para el ${fecha(o.fecha_requerida + "T12:00:00")}</div>` : ""}
      ${o.recibido_tecnico_nombre ? `<div class="meta">✓ Recibida por ${esc(o.recibido_tecnico_nombre)} · ${fechaHora(o.recibido_tecnico_at)}</div>` : ""}
      ${o.tecnico_nombre ? `<div class="meta">Técnico asignado: <strong>${esc(o.tecnico_nombre)}</strong></div>` : ""}
      ${o.tipo_plaga_reportada ? `<div class="meta">Plaga: <strong>${esc(o.tipo_plaga_reportada)}</strong></div>` : ""}
      ${o.descripcion_cliente ? `<p style="margin:10px 0 0">${esc(o.descripcion_cliente)}</p>` : ""}
    </div>

    ${o.puntos.length ? `
      <div class="kpis">
        <div class="kpi ok"><div class="n">${hechos.length}</div><div class="t">Hechas</div></div>
        <div class="kpi ${rojos.length ? "mal" : "ok"}"><div class="n">${rojos.length}</div><div class="t">Por hacer</div></div>
      </div>
      <div class="leyenda-semaforo">
        <span><i class="punto-verde"></i> Hecha</span>
        <span><i class="punto-rojo"></i> Por hacer</span>
      </div>
      ${[...porArea.entries()].map(([area, ps]) => `
        <div class="tarjeta">
          <h2>${esc(area)}</h2>
          <div class="semaforo">${ps.map(celda).join("")}</div>
        </div>`).join("")}` : ""}

    <div class="tarjeta">
      <h2>Mensajes</h2>
      <div class="hilo" id="sol-hilo">
        ${o.mensajes.length
          ? o.mensajes.map((m) => {
              const mio = m.usuario_id && m.usuario_id === USUARIO?.id;
              const quien = m.autor_rol === "cliente_calidad" ? "Hotel" : m.autor_rol === "tecnico_plagas" ? "Técnico" : "ASA";
              return `<div class="msg ${mio ? "mio" : ""}">
                <div class="autor">${esc(m.autor_nombre || quien)} · ${esc(quien)}</div>
                <div class="txt">${esc(m.texto)}</div>
                <div class="hora">${fechaHora(m.created_at)}</div>
              </div>`;
            }).join("")
          : `<p style="color:var(--suave);font-size:13px;margin:0">Sin mensajes. Escribe aquí cualquier indicación para el técnico o para ASA.</p>`}
      </div>
      <form id="sol-form" class="sol-enviar">
        <textarea id="sol-texto" rows="2" placeholder="Ej.: La 4312 ya está libre. La 4318 sale a las 2:00 p. m."></textarea>
        <button class="btn principal" type="submit">Enviar</button>
      </form>
    </div>`;

  $("#sol-texto").value = borrador;
  $("#sol-volver").addEventListener("click", () => vistaOrdenes(cuerpo));
  $("#sol-agregar")?.addEventListener("click", () => formularioHabitaciones(o));
  $("#sol-cancelar")?.addEventListener("click", async () => {
    const motivo = prompt("¿Por qué se cancela? (opcional)");
    if (motivo === null) return;
    try {
      await POST(`/solicitudes/${o.id}/cancelar`, { motivo });
      detalleSolicitud(cuerpo, o.id);
    } catch (e) { alert(e.message); }
  });
  $("#sol-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const texto = $("#sol-texto").value.trim();
    if (!texto) return;
    const btn = ev.target.querySelector("button");
    btn.disabled = true;
    try {
      await POST(`/solicitudes/${o.id}/mensajes`, { texto });
      $("#sol-texto").value = "";
      await detalleSolicitud(cuerpo, o.id, true);
    } catch (e) {
      alert(e.message);
      btn.disabled = false;
    }
  });
  engancharServicios(cuerpo);
  const hilo = $("#sol-hilo");
  if (hilo) hilo.scrollTop = hilo.scrollHeight;

  // Refresco automático: el hotel ve cómo se van poniendo en verde sin recargar
  if (abierta) {
    setTimeout(() => {
      if (SOL_ABIERTA_ID === id && cuerpo.isConnected && document.visibilityState === "visible" && !document.activeElement?.closest?.("#sol-form")) {
        detalleSolicitud(cuerpo, id, true).catch(() => {});
      } else if (SOL_ABIERTA_ID === id && cuerpo.isConnected) {
        setTimeout(() => detalleSolicitud(cuerpo, id, true).catch(() => {}), 30000);
      }
    }, 30000);
  }
}

// ── Formulario: lista de habitaciones ────────────────────────────────────
//
// Dos maneras de armar la lista, y se combinan: pegar/escribir los números
// ("4312, 4315, 4320-4325", tal como vienen en la hoja de ama de llaves) o
// tocarlas en la cuadrícula. Si `orden` viene, se agregan a esa solicitud.
function interpretarLista(texto) {
  const numeros = [];
  for (const trozo of String(texto || "").split(/[\s,;\/]+|\by\b/i)) {
    const t = trozo.trim().replace(/^hab\.?/i, "");
    if (!t) continue;
    const rango = t.match(/^(\d+)\s*[-–a]\s*(\d+)$/i);
    if (rango) {
      const a = Number(rango[1]), b = Number(rango[2]);
      if (b >= a && b - a <= 200) for (let n = a; n <= b; n++) numeros.push(String(n));
      else numeros.push(t);
    } else numeros.push(t);
  }
  return [...new Set(numeros)];
}

async function formularioHabitaciones(orden = null) {
  const zona = orden ? null : $("#form-zona");
  if (zona && $("#form-hab")) { zona.innerHTML = ""; return; }

  const e = await GET(`/puntos/estado?sitio_id=${PLANTA.id}&tipo=habitacion`);
  const habs = e.puntos;
  if (!habs.length) {
    alert("Esta planta no tiene habitaciones cargadas como puntos de control. Pídele a ASA que las cargue.");
    return;
  }
  const norm = (s) => String(s || "").trim().toUpperCase().replace(/^0+(?=\d)/, "");
  const porNumero = new Map();
  for (const h of habs) {
    porNumero.set(norm(h.numero_habitacion), h);
    porNumero.set(norm(h.codigo_visible), h);
  }
  const elegidas = new Set();

  const html = `
    <form class="tarjeta" id="form-hab">
      <h2>${orden ? `Agregar habitaciones a ${esc(orden.numero_orden)}` : "Enviar habitaciones al técnico"}</h2>
      <p style="margin:0 0 12px;color:var(--suave);font-size:13px">
        Escribe o pega los números (por ejemplo <strong>4312, 4315, 4320-4325</strong>) o tócalas
        en la lista de abajo. El técnico las recibe al momento y cada una se pone en verde
        cuando la termina.
      </p>
      <label class="campo">Números de habitación
        <textarea id="hab-texto" rows="2" placeholder="4312, 4315, 4320-4325"></textarea>
        <small id="hab-aviso"></small>
      </label>
      ${orden ? "" : `
      <div class="fila-campos">
        <label class="campo">¿Para cuándo?
          <input type="date" name="fecha" value="${hoyLocal()}" min="${hoyLocal()}" />
        </label>
        <label class="campo">Urgencia
          <select name="prioridad">
            <option value="normal">Normal</option>
            <option value="alta">Alta</option>
            <option value="urgente">Urgente — hay huésped esperando</option>
          </select>
        </label>
      </div>
      <label class="campo">Nota para el técnico (opcional)
        <textarea name="nota" rows="2" placeholder="Ej.: pedir la llave en ama de llaves, piso 3."></textarea>
      </label>`}
      <div class="acciones" style="margin:4px 0 10px">
        <strong id="hab-contador">0 habitaciones elegidas</strong>
        <button type="button" class="btn" id="hab-limpiar">Limpiar</button>
      </div>
      <div id="hab-grid"></div>
      <div class="acciones" style="margin:12px 0 0">
        <button type="submit" class="btn principal" id="hab-enviar">${orden ? "Agregar" : "Enviar al técnico"}</button>
        <button type="button" class="btn" id="hab-cancelar">Cancelar</button>
      </div>
    </form>`;

  let raiz;
  if (orden) {
    const capa = document.createElement("div");
    capa.className = "capa-modal";
    capa.innerHTML = `<div class="capa-caja">${html}</div>`;
    document.body.appendChild(capa);
    raiz = capa;
  } else {
    zona.innerHTML = html;
    raiz = zona;
  }
  const cerrar = () => (orden ? raiz.remove() : (raiz.innerHTML = ""));
  const q = (s) => raiz.querySelector(s);

  const porArea = new Map();
  for (const h of habs) {
    if (!porArea.has(h.area_nombre)) porArea.set(h.area_nombre, []);
    porArea.get(h.area_nombre).push(h);
  }
  q("#hab-grid").innerHTML = [...porArea.entries()]
    .map(([area, lista]) => `
      <div class="grupo-hab">
        <div class="grupo-hab-titulo">${esc(area)}</div>
        <div class="semaforo">
          ${lista.map((h) => `<button type="button" class="celda elegible" data-id="${esc(h.id)}">${esc(h.numero_habitacion || h.codigo_visible)}</button>`).join("")}
        </div>
      </div>`)
    .join("");

  function pintar() {
    raiz.querySelectorAll(".celda.elegible").forEach((b) => b.classList.toggle("elegida", elegidas.has(b.dataset.id)));
    q("#hab-contador").textContent = elegidas.size === 1 ? "1 habitación elegida" : `${elegidas.size} habitaciones elegidas`;
  }
  raiz.querySelectorAll(".celda.elegible").forEach((b) =>
    b.addEventListener("click", () => {
      elegidas.has(b.dataset.id) ? elegidas.delete(b.dataset.id) : elegidas.add(b.dataset.id);
      pintar();
    })
  );
  q("#hab-texto").addEventListener("input", () => {
    const numeros = interpretarLista(q("#hab-texto").value);
    const noEsta = [];
    for (const n of numeros) {
      const h = porNumero.get(norm(n));
      if (h) elegidas.add(h.id);
      else noEsta.push(n);
    }
    q("#hab-aviso").innerHTML = noEsta.length
      ? `<span style="color:var(--rojo)">No existen en esta planta: ${esc(noEsta.join(", "))}</span>`
      : numeros.length ? `<span style="color:var(--verde)">Todas encontradas ✓</span>` : "";
    pintar();
  });
  q("#hab-limpiar").addEventListener("click", () => { elegidas.clear(); q("#hab-texto").value = ""; q("#hab-aviso").innerHTML = ""; pintar(); });
  q("#hab-cancelar").addEventListener("click", cerrar);

  q("#form-hab").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!elegidas.size) { q("#hab-aviso").innerHTML = `<span style="color:var(--rojo)">Elige al menos una habitación.</span>`; return; }
    const btn = q("#hab-enviar");
    btn.disabled = true; btn.textContent = "Enviando…";
    try {
      if (orden) {
        const r = await POST(`/solicitudes/${orden.id}/puntos`, { punto_ids: [...elegidas] });
        cerrar();
        detalleSolicitud($("#cuerpo"), orden.id);
        if (r.repetidos) alert(`${r.agregados} agregadas. ${r.repetidos} ya estaban en la solicitud.`);
      } else {
        const fd = new FormData(ev.target);
        const o = await POST("/solicitudes", {
          sitio_id: PLANTA.id,
          tipo_solicitud: "habitaciones",
          punto_ids: [...elegidas],
          fecha_requerida: fd.get("fecha") || null,
          prioridad: fd.get("prioridad") || "normal",
          descripcion: (fd.get("nota") || "").trim(),
        });
        AVISO_ORDEN = `Listo. Enviaste <strong>${elegidas.size}</strong> habitación(es) en la solicitud <strong>${esc(o.numero_orden || "")}</strong>. El técnico ya la ve en su teléfono.`;
        await pintarPestana();
      }
    } catch (e) {
      q("#hab-aviso").innerHTML = `<span style="color:var(--rojo)">${esc(e.message)}</span>`;
      btn.disabled = false; btn.textContent = orden ? "Agregar" : "Enviar al técnico";
    }
  });
  pintar();
  q("#hab-texto").focus();
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
      // Va por /solicitudes para que quede en la misma lista, con su hilo de
      // mensajes, igual que las listas de habitaciones.
      const orden = await POST("/solicitudes", {
        sitio_id: PLANTA.id,
        tipo_solicitud: "plaga",
        tipo_plaga: fd.get("tipo"),
        prioridad: fd.get("prioridad"),
        descripcion: (fd.get("descripcion") || "").trim(),
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
