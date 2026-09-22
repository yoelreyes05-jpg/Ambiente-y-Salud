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
  const vistas = { hoy: vistaHoy, historial: vistaHistorial, pendientes: vistaPendientes, hallazgos: vistaHallazgos, ordenes: vistaOrdenes };
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
// Dos cosas distintas que conviene no mezclar: lo que el técnico intentó y no
// pudo (con su motivo y con quién habló), y lo que ya pasó su frecuencia y no
// tiene ningún registro. La columna de responsable existe porque no es lo mismo
// que el hotel no autorizara el acceso a que ASA no llegara.
async function vistaPendientes(cuerpo) {
  const d = await GET(`/inspecciones/dia?sitio_id=${PLANTA.id}`);

  if (!d.no_realizados.length && !d.pendientes.length) {
    cuerpo.innerHTML = `
      <div class="vacio"><span class="emoji">✅</span>
        No hay nada pendiente: todo lo programado está dentro de su frecuencia y
        no hubo accesos negados.</div>`;
    return;
  }

  cuerpo.innerHTML = `
    ${d.no_realizados.length ? `
      <div class="tarjeta borde-rojo">
        <h2>Se intentó y no se pudo — ${d.no_realizados.length}</h2>
        <p style="margin:0 0 12px;color:var(--suave);font-size:13px">
          El técnico se presentó y no pudo trabajar el punto. Queda registrado el
          motivo y con quién se habló.
        </p>
        ${d.no_realizados.map((n) => `
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

    ${d.pendientes.length ? `
      <div class="tarjeta">
        <h2>Fuera de su frecuencia — ${d.pendientes.length}</h2>
        <p style="margin:0 0 12px;color:var(--suave);font-size:13px">
          Puntos que ya pasaron el ciclo que les toca y todavía no tienen registro.
        </p>
        ${d.pendientes.map((p) => `
          <div class="registro">
            <div class="cab">
              <div>
                <div class="punto">${esc(p.numero_habitacion ? `Habitación ${p.numero_habitacion}` : p.codigo_visible)}</div>
                <div class="meta">${esc([p.tipo_nombre, p.area].filter(Boolean).join(" · "))} · cada ${esc(p.frecuencia)}</div>
              </div>
              <div class="fecha">
                <span class="marca mal">
                  ${p.dias_sin_revisar == null ? "Nunca" : `${p.dias_sin_revisar} días`}
                </span>
              </div>
            </div>
          </div>`).join("")}
      </div>` : ""}`;

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
