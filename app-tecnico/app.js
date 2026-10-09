// app.js — App del técnico (Ambiente y Salud RD)
//
// PWA instalable. Tres cosas que la definen:
//
//  · Escanear un QR abre el punto al instante, con su checklist y su historial.
//    El QR es una URL, así que también sirve la cámara nativa del teléfono:
//    el técnico apunta y el sistema abre solo, sin tener que entrar a la app.
//
//  · Sin señal sigue funcionando. La ruta del día se guarda en el teléfono y
//    las inspecciones se encolan en IndexedDB; al recuperar conexión se envían
//    solas. Los sótanos y áreas verdes de un hotel no tienen cobertura.
//
//  · Si el QR está roto o despegado, se busca el punto por nombre, código o
//    número de habitación. Nunca se queda trancado.

// ── Estado ───────────────────────────────────────────────────────────────
let TOKEN = localStorage.getItem("asa_t_token") || null;
let USUARIO = leerJSON("asa_t_usuario") || null;
let SITIO = leerJSON("asa_t_sitio") || null; // hotel activo
let PENDIENTES = 0; // inspecciones en cola
let SINCRONIZANDO = false;

// ── Utilidades ───────────────────────────────────────────────────────────
const $ = (s, r = document) => r.querySelector(s);
const app = () => $("#app");

function leerJSON(clave) {
  try { return JSON.parse(localStorage.getItem(clave) || "null"); } catch { return null; }
}
function guardarJSON(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch {}
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });

function aviso(texto, tipo = "") {
  let el = $("#mensaje");
  if (!el) {
    el = document.createElement("div");
    el.id = "mensaje";
    document.body.appendChild(el);
  }
  el.className = `mensaje visible ${tipo}`;
  el.textContent = texto;
  clearTimeout(aviso._t);
  aviso._t = setTimeout(() => (el.className = "mensaje"), 3200);
}

function vibrar(patron = 40) {
  try { navigator.vibrate?.(patron); } catch {}
}

// ── API ──────────────────────────────────────────────────────────────────
async function api(ruta, opciones = {}) {
  const cabeceras = { "Content-Type": "application/json", ...(opciones.headers || {}) };
  if (TOKEN) cabeceras.Authorization = `Bearer ${TOKEN}`;

  const res = await fetch(`${CONFIG.API_BASE}${ruta}`, { cache: "no-store", ...opciones, headers: cabeceras });

  if (res.status === 401) {
    cerrarSesion("Tu sesión venció. Entra de nuevo.");
    throw new Error("Sesión vencida");
  }
  let datos = null;
  try { datos = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(datos?.mensaje || `Error ${res.status}`);
    err.status = res.status;
    err.datos = datos;
    throw err;
  }
  return datos;
}
const GET = (r) => api(r);

// ¿El fallo fue de RED (sin señal) o el servidor contestó con un error?
// Solo en el primer caso tiene sentido mostrar lo guardado en el teléfono.
// Antes cualquier error —un 403, un 500, un punto que cambió de hotel— se
// tapaba con la copia vieja y el técnico seguía viendo la estrategia y los
// puntos de antes sin enterarse de que algo andaba mal.
const esSinSenal = (e) => !e?.status;
const POST = (r, cuerpo) => api(r, { method: "POST", body: JSON.stringify(cuerpo) });

// ─────────────────────────────────────────────────────────────────────────
// Almacén local (IndexedDB)
//
// Dos cajones: "cola" con las inspecciones que faltan por enviar, y "cache"
// con la ruta del día y las fichas de los puntos ya vistos.
// ─────────────────────────────────────────────────────────────────────────
const BD = {
  _db: null,
  async abrir() {
    if (this._db) return this._db;
    this._db = await new Promise((ok, fallo) => {
      const pet = indexedDB.open("asa_tecnico", 1);
      pet.onupgradeneeded = () => {
        const db = pet.result;
        if (!db.objectStoreNames.contains("cola")) db.createObjectStore("cola", { keyPath: "clave_local" });
        if (!db.objectStoreNames.contains("cache")) db.createObjectStore("cache", { keyPath: "clave" });
      };
      pet.onsuccess = () => ok(pet.result);
      pet.onerror = () => fallo(pet.error);
    });
    return this._db;
  },
  async _tx(almacen, modo, fn) {
    const db = await this.abrir();
    return new Promise((ok, fallo) => {
      const tx = db.transaction(almacen, modo);
      const pet = fn(tx.objectStore(almacen));
      pet.onsuccess = () => ok(pet.result);
      pet.onerror = () => fallo(pet.error);
    });
  },
  guardar: (almacen, valor) => BD._tx(almacen, "readwrite", (s) => s.put(valor)),
  leer: (almacen, clave) => BD._tx(almacen, "readonly", (s) => s.get(clave)),
  todos: (almacen) => BD._tx(almacen, "readonly", (s) => s.getAll()),
  borrar: (almacen, clave) => BD._tx(almacen, "readwrite", (s) => s.delete(clave)),
};

const guardarCache = (clave, datos) => BD.guardar("cache", { clave, datos, cuando: Date.now() }).catch(() => {});
const leerCache = async (clave) => (await BD.leer("cache", clave).catch(() => null))?.datos ?? null;

// ── Cola de inspecciones sin enviar ──────────────────────────────────────
async function encolar(inspeccion) {
  const entrada = {
    ...inspeccion,
    clave_local: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    creada: new Date().toISOString(),
  };
  await BD.guardar("cola", entrada);
  await actualizarContadorPendientes();
  try {
    const reg = await navigator.serviceWorker?.ready;
    await reg?.sync?.register("sincronizar-inspecciones");
  } catch {}
  return entrada;
}

async function actualizarContadorPendientes() {
  try {
    PENDIENTES = (await BD.todos("cola")).length;
  } catch {
    PENDIENTES = 0;
  }
  pintarEstadoConexion();
}

async function sincronizar(silencioso = true) {
  if (SINCRONIZANDO || !navigator.onLine || !TOKEN) return;
  const cola = await BD.todos("cola").catch(() => []);
  if (!cola.length) return;

  SINCRONIZANDO = true;
  pintarEstadoConexion();
  try {
    const r = await POST("/inspecciones/sincronizar", { inspecciones: cola });
    for (const res of r.resultados || []) {
      // Se borra lo que el servidor aceptó. Lo que falló se queda en la cola
      // para reintentar, salvo que el punto ya no exista: en ese caso
      // reintentar mil veces no lo va a arreglar.
      if (res.ok || /no existe|dado de baja/i.test(res.mensaje || "")) {
        await BD.borrar("cola", res.clave_local);
      }
    }
    await actualizarContadorPendientes();
    if (r.guardadas && !silencioso) aviso(`${r.guardadas} inspección(es) enviadas`, "exito");
    if (r.guardadas) window.dispatchEvent(new Event("asa:sincronizado"));
  } catch (e) {
    if (!silencioso) aviso("No se pudo sincronizar: " + e.message, "error");
  } finally {
    SINCRONIZANDO = false;
    pintarEstadoConexion();
  }
}

// ── Sesión ───────────────────────────────────────────────────────────────
function cerrarSesion(mensaje) {
  TOKEN = null; USUARIO = null; SITIO = null;
  localStorage.removeItem("asa_t_token");
  localStorage.removeItem("asa_t_usuario");
  localStorage.removeItem("asa_t_sitio");
  if (mensaje) aviso(mensaje, "error");
  location.hash = "";
  pantallaLogin();
}

// ─────────────────────────────────────────────────────────────────────────
// Pantallas
// ─────────────────────────────────────────────────────────────────────────

function pantallaLogin(mensaje) {
  app().innerHTML = `
    <div class="contenido" style="padding-top:56px;max-width:420px">
      <div style="text-align:center;margin-bottom:36px">
        <img src="logo-asa.png" alt="${esc(CONFIG.EMPRESA)}"
             style="width:min(230px,70vw);height:auto;display:block;margin:0 auto" />
        <h1 style="margin:14px 0 2px;font-size:24px">${esc(CONFIG.NOMBRE)}</h1>
        <p style="margin:0;color:var(--gris-600);font-size:14px">${esc(CONFIG.EMPRESA)}</p>
      </div>
      ${mensaje ? `<div class="tarjeta" style="background:var(--rojo-claro);color:var(--rojo)">${esc(mensaje)}</div>` : ""}
      <form id="form-login">
        <div class="campo">
          <label for="email">Correo</label>
          <input type="email" id="email" autocomplete="username" inputmode="email" required />
        </div>
        <div class="campo">
          <label for="clave">Contraseña</label>
          <input type="password" id="clave" autocomplete="current-password" required />
        </div>
        <button class="btn" type="submit" id="entrar">Entrar</button>
      </form>
    </div>`;

  $("#form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const boton = $("#entrar");
    boton.disabled = true;
    boton.textContent = "Entrando…";
    try {
      const r = await POST("/usuarios/login", { email: $("#email").value.trim(), password: $("#clave").value });
      TOKEN = r.token;
      USUARIO = r.usuario;
      localStorage.setItem("asa_t_token", TOKEN);
      guardarJSON("asa_t_usuario", USUARIO);
      await elegirHotel();
    } catch (err) {
      boton.disabled = false;
      boton.textContent = "Entrar";
      aviso(err.message, "error");
    }
  });
}

async function elegirHotel() {
  encabezado("Elige el hotel", "¿Dónde vas a trabajar hoy?", false);
  const cuerpo = document.createElement("div");
  cuerpo.className = "contenido";
  cuerpo.innerHTML = `<div class="cargando">Cargando hoteles…</div>`;
  app().appendChild(cuerpo);

  let hoteles;
  try {
    hoteles = await GET("/sitios");
    await guardarCache("hoteles", hoteles);
  } catch {
    hoteles = (await leerCache("hoteles")) || [];
    if (!hoteles.length) {
      cuerpo.innerHTML = `<div class="vacio"><span class="emoji">📡</span>No hay conexión y todavía no se ha guardado ningún hotel en este teléfono.</div>`;
      return;
    }
  }

  if (!hoteles.length) {
    cuerpo.innerHTML = `<div class="vacio"><span class="emoji">🏨</span>No tienes hoteles asignados.</div>`;
    return;
  }

  cuerpo.innerHTML = hoteles
    .map(
      (h) => `
      <button class="tarjeta" data-id="${esc(h.id)}" style="display:block;width:100%;text-align:left;border:0;font:inherit">
        <h2>${esc(h.nombre)}</h2>
        <p>${esc(h.direccion || "")}</p>
      </button>`
    )
    .join("");

  cuerpo.querySelectorAll("[data-id]").forEach((b) =>
    b.addEventListener("click", () => {
      SITIO = hoteles.find((h) => h.id === b.dataset.id);
      guardarJSON("asa_t_sitio", SITIO);
      // Cambiar el hash ya dispara hashchange → enrutar(). Llamarlo también a
      // mano hacía correr dos pantallas a la vez, y la segunda borraba el DOM
      // que la primera todavía estaba llenando.
      if (location.hash === "#/ruta") enrutar();
      else location.hash = "#/ruta";
    })
  );
}

// ── Encabezado y estado de conexión ──────────────────────────────────────
function encabezado(titulo, subtitulo, conAtras = true) {
  app().innerHTML = `
    <div class="barra">
      ${conAtras ? `<button id="atras" aria-label="Atrás">←</button>` : ""}
      <h1>${esc(titulo)}${subtitulo ? `<small>${esc(subtitulo)}</small>` : ""}</h1>
      ${TOKEN ? `<button id="menu" aria-label="Menú">⋮</button>` : ""}
    </div>
    <div id="estado-conexion"></div>`;

  $("#atras")?.addEventListener("click", () => history.back());
  $("#menu")?.addEventListener("click", abrirMenu);
  pintarEstadoConexion();
}

function pintarEstadoConexion() {
  const caja = $("#estado-conexion");
  if (!caja) return;
  if (SINCRONIZANDO) {
    caja.innerHTML = `<div class="aviso-offline sincronizando">↻ Enviando ${PENDIENTES} inspección(es)…</div>`;
  } else if (!navigator.onLine) {
    caja.innerHTML = `<div class="aviso-offline">📡 Sin señal — se guarda en el teléfono${PENDIENTES ? ` (${PENDIENTES} por enviar)` : ""}</div>`;
  } else if (PENDIENTES) {
    caja.innerHTML = `<div class="aviso-offline">⏳ ${PENDIENTES} inspección(es) por enviar — toca para reintentar</div>`;
    caja.querySelector("div").style.cursor = "pointer";
    caja.querySelector("div").addEventListener("click", () => sincronizar(false));
  } else {
    caja.innerHTML = "";
  }
}

function abrirMenu() {
  const opciones = [
    ["🗺️ Mapa del hotel", () => { location.hash = "#/plano"; }],
    ["📅 Cronograma de la semana", () => { location.hash = "#/cronograma"; }],
    ["🛏️ Chinche / código rosa", () => { location.hash = "#/incidencias"; }],
    ["🚐 Chequeo del vehículo", () => { location.hash = "#/chequeo"; }],
    // Una sola vía: la ruta #/hoteles. Antes se vaciaba el hash Y se llamaba a
    // elegirHotel(): el hashchange pintaba la ruta de puntos encima de la
    // lista de hoteles y había que tocar dos veces.
    ["🏨 Cambiar de hotel", () => { if (location.hash === "#/hoteles") elegirHotel(); else location.hash = "#/hoteles"; }],
    ["↻ Sincronizar ahora", () => sincronizar(false)],
    ["🚪 Cerrar sesión", () => cerrarSesion()],
  ];
  const caja = document.createElement("div");
  caja.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:90;display:flex;align-items:flex-end";
  caja.innerHTML = `<div style="background:var(--blanco);width:100%;border-radius:18px 18px 0 0;padding:16px 16px calc(24px + env(safe-area-inset-bottom))"></div>`;
  const panel = caja.firstElementChild;
  opciones.forEach(([texto, accion]) => {
    const b = document.createElement("button");
    b.className = "btn secundario";
    b.textContent = texto;
    b.addEventListener("click", () => { caja.remove(); accion(); });
    panel.appendChild(b);
  });
  caja.addEventListener("click", (e) => { if (e.target === caja) caja.remove(); });
  document.body.appendChild(caja);
}

// ─────────────────────────────────────────────────────────────────────────
// Ruta del día
// ─────────────────────────────────────────────────────────────────────────
async function pantallaRuta() {
  if (!SITIO) return elegirHotel();

  // El nombre del técnico a la vista: así sabe con qué cuenta está subiendo
  // (en un teléfono compartido, cada registro sale a nombre de quien entró).
  encabezado(
    SITIO.nombre,
    `Ruta del ${new Date().toLocaleDateString("es-DO", { day: "numeric", month: "long" })}${USUARIO?.nombre ? ` · ${USUARIO.nombre}` : ""}`,
    false
  );
  const cuerpo = document.createElement("div");
  cuerpo.className = "contenido";
  cuerpo.innerHTML = `<div class="cargando">Cargando tu ruta…</div>`;
  app().appendChild(cuerpo);

  let avance;
  const claveCache = `ruta:${SITIO.id}:${hoy()}`;
  try {
    avance = await GET(`/inspecciones/avance/hoy?sitio_id=${SITIO.id}`);
    await guardarCache(claveCache, avance);
  } catch (e) {
    if (!esSinSenal(e)) {
      cuerpo.innerHTML = `<div class="vacio"><span class="emoji">⚠️</span>${esc(e.message)}</div>`;
      return;
    }
    avance = await leerCache(claveCache);
    if (!avance) {
      cuerpo.innerHTML = `<div class="vacio"><span class="emoji">📡</span>Sin señal y sin ruta guardada. Conéctate una vez para descargarla.</div>`;
      return;
    }
    aviso("Sin señal: mostrando la ruta guardada en el teléfono");
  }

  // Los puntos hechos offline todavía no están en el servidor: se marcan aquí
  // para que el técnico no los vuelva a hacer.
  // Un "no se pudo" guardado sin señal NO es un hecho: sigue pendiente, en
  // amarillo, con su motivo.
  const cola = await BD.todos("cola").catch(() => []);
  const hechosLocal = new Set(cola.filter((c) => !c.motivo_no_realizado).map((c) => c.punto_id));
  const intentosLocal = new Map(cola.filter((c) => c.motivo_no_realizado).map((c) => [c.punto_id, c]));

  const realizados = avance.realizados.filter((p) => !hechosLocal.has(p.punto_id));
  const pendientes = [];
  for (const p of avance.pendientes) {
    if (hechosLocal.has(p.punto_id)) realizados.push({ ...p, _local: true });
    else if (intentosLocal.has(p.punto_id) && !p.intento) {
      const c = intentosLocal.get(p.punto_id);
      pendientes.push({ ...p, intento: { motivo_no_realizado: c.motivo_no_realizado, tecnico: `${USUARIO?.nombre || "Tú"} · por enviar` } });
    } else pendientes.push(p);
  }

  const total = realizados.length + pendientes.length;
  const pct = total ? Math.round((realizados.length / total) * 100) : 0;
  const tocan = pendientes.filter((p) => p.vencido).length;

  cuerpo.innerHTML = `
    <div class="avance">
      <div class="hechos"><div class="numero">${realizados.length}</div><div class="rotulo">Realizados</div></div>
      <div class="faltan"><div class="numero">${tocan}</div><div class="rotulo">Le toca hoy</div></div>
    </div>
    <div class="progreso"><span style="width:${pct}%"></span></div>

    <button class="btn grande" id="btn-escanear">📷 Escanear punto</button>
    <button class="btn secundario" id="btn-buscar">🔍 Buscar por nombre o habitación</button>

    <div id="incidencias-hotel" style="margin-top:8px"></div>
    <div id="solicitudes-hotel" style="margin-top:8px"></div>
    <div id="lista-dia" style="margin-top:8px"></div>`;

  if (!cuerpo.isConnected) return; // el técnico ya navegó a otra pantalla

  $("#btn-escanear", cuerpo)?.addEventListener("click", () => (location.hash = "#/escanear"));
  $("#btn-buscar", cuerpo)?.addEventListener("click", () => (location.hash = "#/buscar"));

  bloqueSolicitudes($("#solicitudes-hotel", cuerpo)).catch(() => {});
  if (typeof bloqueIncidencias === "function") bloqueIncidencias($("#incidencias-hotel", cuerpo)).catch(() => {});

  listaDelDia($("#lista-dia", cuerpo), pendientes, realizados);
}

// ─────────────────────────────────────────────────────────────────────────
// Lista del día: pestañas "Por hacer" / "Hechos", filtro por tipo y filtro
// rápido. Todo se filtra en el teléfono, sin ir al servidor: con 400
// habitaciones y 80 cebaderos, cada toque tiene que responder al instante.
//
// La pestaña, el tipo y lo escrito se recuerdan (sessionStorage) para que, al
// volver de registrar un punto, el técnico siga donde estaba y no tenga que
// filtrar otra vez.
// ─────────────────────────────────────────────────────────────────────────
const FILTRO_RUTA = {
  get() {
    const f = leerSesion("asa_filtro_ruta") || {};
    return { pestana: f.pestana || "pendientes", tipo: f.tipo || "", texto: f.texto || "", verAlDia: !!f.verAlDia };
  },
  set(cambios) {
    try { sessionStorage.setItem("asa_filtro_ruta", JSON.stringify({ ...this.get(), ...cambios })); } catch {}
  },
};
function leerSesion(clave) {
  try { return JSON.parse(sessionStorage.getItem(clave) || "null"); } catch { return null; }
}

const normalizar = (v) =>
  String(v ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function textoDePunto(p) {
  return normalizar([
    p.codigo_visible, p.punto_nombre, p.numero_habitacion, p.area_nombre,
    p.tipo_nombre, p.ubicacion_descripcion, p.inspeccion?.tecnico,
  ].filter(Boolean).join(" "));
}

function listaDelDia(caja, pendientes, realizados) {
  const f = FILTRO_RUTA.get();

  caja.innerHTML = `
    <div class="pestanas" role="tablist" aria-label="Puntos del día">
      <button type="button" role="tab" class="pestana" data-pestana="pendientes" id="tab-pendientes">
        Por hacer <span class="cuenta" id="cuenta-pendientes"></span>
      </button>
      <button type="button" role="tab" class="pestana hecho" data-pestana="hechos" id="tab-hechos">
        ✓ Hechos <span class="cuenta" id="cuenta-hechos"></span>
      </button>
    </div>
    <div class="chips-tipo" id="chips-tipo" role="group" aria-label="Filtrar por tipo"></div>
    <div class="campo filtro-rapido">
      <label for="filtro-texto" class="oculto">Filtrar la lista</label>
      <input type="search" id="filtro-texto" placeholder="Filtrar: habitación, código, área…"
             autocomplete="off" enterkeyhint="search" value="${esc(f.texto)}" />
    </div>
    <div id="listas" role="tabpanel"></div>`;

  // Tipos presentes en el hotel, en orden de cantidad. La clave es el código
  // del tipo; si un punto no lo trae se usa el nombre.
  const claveTipo = (p) => p.tipo_codigo || p.tipo_nombre || "otro";
  const tipos = new Map();
  for (const p of [...pendientes, ...realizados]) {
    const k = claveTipo(p);
    if (!tipos.has(k)) tipos.set(k, { clave: k, nombre: p.tipo_nombre || "Otros", icono: p.tipo_icono || "📍" });
  }
  // Un tipo guardado que ya no existe en este hotel no puede dejar la lista vacía
  if (f.tipo && !tipos.has(f.tipo)) FILTRO_RUTA.set({ tipo: "" });

  const listas = $("#listas", caja);
  const chips = $("#chips-tipo", caja);
  const entrada = $("#filtro-texto", caja);

  function pintar() {
    const { pestana, tipo, texto, verAlDia } = FILTRO_RUTA.get();
    const t = normalizar(texto.trim());
    const pasaTexto = (p) => !t || textoDePunto(p).includes(t);
    const pasaTipo = (p) => !tipo || claveTipo(p) === tipo;

    const base = pestana === "hechos" ? realizados : pendientes;

    // Pestañas: el número es lo que hay con el filtro de tipo y texto puesto
    const nPend = pendientes.filter((p) => pasaTipo(p) && pasaTexto(p) && (verAlDia || p.vencido || p.intento)).length;
    const nHech = realizados.filter((p) => pasaTipo(p) && pasaTexto(p)).length;
    $("#cuenta-pendientes", caja).textContent = nPend;
    $("#cuenta-hechos", caja).textContent = nHech;
    caja.querySelectorAll("[data-pestana]").forEach((b) => {
      const activa = b.dataset.pestana === pestana;
      b.classList.toggle("activa", activa);
      b.setAttribute("aria-selected", activa ? "true" : "false");
    });

    // Chips de tipo, con cuántos hay de cada uno en la pestaña abierta
    const cuenta = new Map();
    for (const p of base) {
      if (!pasaTexto(p)) continue;
      if (pestana === "pendientes" && !verAlDia && !p.vencido && !p.intento) continue;
      cuenta.set(claveTipo(p), (cuenta.get(claveTipo(p)) || 0) + 1);
    }
    const totalChips = [...cuenta.values()].reduce((a, b) => a + b, 0);
    chips.innerHTML =
      `<button type="button" class="chip ${!tipo ? "activo" : ""}" data-tipo="" aria-pressed="${!tipo}">Todos <b>${totalChips}</b></button>` +
      [...tipos.values()]
        .sort((a, b) => (cuenta.get(b.clave) || 0) - (cuenta.get(a.clave) || 0) || a.nombre.localeCompare(b.nombre))
        .map((x) => `
          <button type="button" class="chip ${tipo === x.clave ? "activo" : ""} ${cuenta.get(x.clave) ? "" : "vacio"}"
                  data-tipo="${esc(x.clave)}" aria-pressed="${tipo === x.clave}">
            <span aria-hidden="true">${x.icono}</span> ${esc(x.nombre)} <b>${cuenta.get(x.clave) || 0}</b>
          </button>`)
        .join("");

    // Lista
    const filtrados = base.filter((p) => pasaTipo(p) && pasaTexto(p));
    if (pestana === "hechos") {
      listas.innerHTML = filtrados.length
        ? `<div class="grupo-area">Hechos hoy · ${filtrados.length}</div>` + filtrados.map((p) => filaPunto(p, true)).join("")
        : `<div class="vacio" style="padding:28px">${realizados.length ? "Nada hecho con ese filtro." : "Todavía no hay nada hecho hoy."}</div>`;
    } else {
      const leToca = filtrados.filter((p) => p.vencido || p.intento);
      const alDia = filtrados.filter((p) => !p.vencido && !p.intento);
      listas.innerHTML =
        (leToca.length
          ? porArea("Le toca", leToca)
          : `<div class="vacio" style="padding:24px">${pendientes.length ? "¡Nada pendiente con ese filtro!" : "¡Todo al día!"}</div>`) +
        (alDia.length
          ? verAlDia
            ? porArea("Al día — todavía no le toca", alDia) +
              `<button type="button" class="btn secundario" id="ver-al-dia">Ocultar los que están al día</button>`
            : `<button type="button" class="btn secundario" id="ver-al-dia">Ver también los que están al día (${alDia.length})</button>`
          : "");
    }
  }

  function porArea(titulo, puntos) {
    // Agrupados por área: el técnico recorre el hotel área por área. Lo
    // intentado sin éxito va primero dentro de cada área.
    const grupos = {};
    for (const p of puntos) (grupos[p.area_nombre || "Sin área"] ||= []).push(p);
    return (
      `<div class="grupo-area">${esc(titulo)} · ${puntos.length}</div>` +
      Object.keys(grupos)
        .sort((a, b) => a.localeCompare(b))
        .map((area) => `
          <div class="grupo-area sub">${esc(area)} · ${grupos[area].length}</div>
          ${grupos[area]
            .sort((a, b) => (b.intento ? 1 : 0) - (a.intento ? 1 : 0))
            .map((p) => filaPunto(p, false))
            .join("")}`)
        .join("")
    );
  }

  // Un solo escuchador para toda la lista: con cientos de filas, poner uno por
  // fila hacía lento repintar cada vez que se toca un filtro.
  caja.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-pestana]");
    if (tab) { FILTRO_RUTA.set({ pestana: tab.dataset.pestana }); vibrar(15); return pintar(); }
    const chip = e.target.closest("[data-tipo]");
    if (chip) { FILTRO_RUTA.set({ tipo: chip.dataset.tipo }); vibrar(15); return pintar(); }
    if (e.target.closest("#ver-al-dia")) { FILTRO_RUTA.set({ verAlDia: !FILTRO_RUTA.get().verAlDia }); return pintar(); }
    const fila = e.target.closest("[data-token]");
    if (fila) {
      sessionStorage.setItem("asa_via_sig", "manual");
      location.hash = `#/p/${fila.dataset.token}`;
    }
  });

  caja.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const fila = e.target.closest?.("[data-token]");
    if (fila) fila.click();
  });

  let espera;
  entrada.addEventListener("input", () => {
    clearTimeout(espera);
    espera = setTimeout(() => { FILTRO_RUTA.set({ texto: entrada.value }); pintar(); }, 80);
  });

  pintar();
}

function filaPunto(p, hecho) {
  const nombre = p.numero_habitacion ? `Habitación ${p.numero_habitacion}` : p.punto_nombre || p.tipo_nombre || "";
  // No se pudo hacer = amarillo y pendiente. Le toca = rojo. Hecho = verde.
  const clases = ["punto", hecho ? "hecho" : "", !hecho && p.intento ? "nopudo" : !hecho && p.vencido ? "vencido" : ""].filter(Boolean).join(" ");
  const marca = hecho ? (p._local ? "⏳" : "✓") : p.intento ? "⚠️" : "›";

  let linea2 = esc([nombre, p.area_nombre && !hecho ? null : p.area_nombre].filter(Boolean).join(" · "));
  if (hecho) {
    // Quién lo hizo y a qué hora: es lo primero que pregunta el supervisor.
    const i = p.inspeccion || {};
    const hora = i.fecha
      ? new Date(i.fecha).toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit", timeZone: "America/Santo_Domingo" })
      : "";
    const quien = p._local ? `${USUARIO?.nombre || "Tú"} · por enviar` : i.tecnico || "Técnico no registrado";
    linea2 += `<div class="quien">👷 ${esc(quien)}${hora ? ` · ${esc(hora)}` : ""}${
      i.nivel_actividad && i.nivel_actividad !== "ninguna" ? ` <span class="etiqueta roja">Actividad ${esc({ bajo: "baja", medio: "media", alto: "alta" }[i.nivel_actividad] || i.nivel_actividad)}</span>` : ""
    }</div>`;
  } else if (p.intento) {
    linea2 += `<div class="quien alerta">No se pudo: ${esc(MOTIVO_CORTO[p.intento.motivo_no_realizado] || p.intento.motivo_no_realizado)}${
      p.intento.tecnico ? ` · ${esc(p.intento.tecnico)}` : ""}</div>`;
  } else if (!p.vencido && p.ultima_inspeccion) {
    const dias = Math.floor((Date.now() - new Date(p.ultima_inspeccion)) / 86400000);
    linea2 += `<div class="quien">Hecho hace ${dias === 0 ? "menos de un día" : `${dias} día${dias === 1 ? "" : "s"}`}</div>`;
  }

  return `
    <div class="${clases}" data-token="${esc(p.qr_token)}" role="button" tabindex="0">
      <span class="icono" aria-hidden="true">${p.tipo_icono || "📍"}</span>
      <div class="texto">
        <div class="codigo">${esc(p.codigo_visible)}</div>
        <div class="detalle">${linea2}</div>
      </div>
      <span class="marca" aria-hidden="true">${marca}</span>
    </div>`;
}

const MOTIVO_CORTO = {
  permiso_denegado: "no dieron permiso",
  huesped_en_habitacion: "huésped en la habitación",
  area_ocupada: "área ocupada",
  sin_llave: "sin llave",
  en_mantenimiento: "en mantenimiento",
  punto_inaccesible: "inaccesible",
  evento_en_curso: "evento en curso",
  otro: "otro motivo",
};

// ─────────────────────────────────────────────────────────────────────────
// Escáner
// ─────────────────────────────────────────────────────────────────────────
async function pantallaEscanear() {
  app().innerHTML = `
    <div class="escaner">
      <video id="video" playsinline muted></video>
      <div class="mira"></div>
      <div class="pie">
        <p id="pista">Apunta al código QR del punto</p>
        <button class="btn secundario" id="cerrar">Cancelar</button>
        <label class="btn secundario" style="margin-top:8px;display:flex;align-items:center;justify-content:center">
          📷 No lee — tomar foto del QR
          <input type="file" id="foto-qr" accept="image/*" capture="environment" hidden />
        </label>
        <button class="btn secundario" id="a-buscar" style="margin-top:8px">🔍 El código no se lee — buscar por nombre</button>
      </div>
    </div>`;

  $("#cerrar").addEventListener("click", () => (location.hash = "#/ruta"));
  $("#a-buscar").addEventListener("click", () => (location.hash = "#/buscar"));
  $("#foto-qr").addEventListener("change", async (ev) => {
    const archivo = ev.target.files?.[0];
    if (!archivo) return;
    $("#pista").textContent = "Leyendo la foto…";
    try {
      const texto = await leerQRDeFoto(archivo);
      const token = texto && extraerToken(texto);
      if (!token) { $("#pista").textContent = "No se encontró un QR en la foto. Acércate más y que salga nítido."; return; }
      vibrar([50, 40, 50]);
      activo = false;
      flujo?.getTracks().forEach((t) => t.stop());
      sessionStorage.setItem("asa_origen_qr", "foto");
      location.hash = `#/p/${encodeURIComponent(token)}`;
    } catch {
      $("#pista").textContent = "No se pudo leer la foto. Inténtalo otra vez.";
    }
  });

  const video = $("#video");
  let flujo = null;
  let activo = true;

  const detener = () => {
    activo = false;
    flujo?.getTracks().forEach((t) => t.stop());
  };
  window.addEventListener("hashchange", detener, { once: true });

  try {
    flujo = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
    });
    video.srcObject = flujo;
    await video.play();
  } catch {
    $("#pista").textContent = "No se pudo abrir la cámara. Busca el punto por nombre.";
    return;
  }

  const abrir = (texto) => {
    const token = extraerToken(texto);
    if (!token) {
      $("#pista").textContent = "Ese código no es de un punto de control.";
      return;
    }
    vibrar([50, 40, 50]);
    detener();
    sessionStorage.setItem("asa_origen_qr", "escaneo");
    location.hash = `#/p/${encodeURIComponent(token)}`;
  };

  // BarcodeDetector es nativo y rapidísimo (Android/Chrome). Donde no existe
  // —iPhone, sobre todo— se cae a jsQR sobre un canvas.
  if ("BarcodeDetector" in window) {
    try {
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      const mirar = async () => {
        if (!activo) return;
        try {
          const codigos = await detector.detect(video);
          if (codigos.length) return abrir(codigos[0].rawValue);
        } catch {}
        requestAnimationFrame(mirar);
      };
      return requestAnimationFrame(mirar);
    } catch {}
  }

  await cargarJsQR();
  const lienzo = document.createElement("canvas");
  const ctx = lienzo.getContext("2d", { willReadFrequently: true });
  const mirar = () => {
    if (!activo) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA && window.jsQR) {
      lienzo.width = video.videoWidth;
      lienzo.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, lienzo.width, lienzo.height);
      const img = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
      const codigo = window.jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
      if (codigo?.data) return abrir(codigo.data);
    }
    requestAnimationFrame(mirar);
  };
  requestAnimationFrame(mirar);
}

// El QR guarda una URL completa; también se acepta el token pelado por si
// alguien lo teclea o el código viejo traía solo el número.
function extraerToken(texto) {
  const t = String(texto || "").trim();
  const conAncla = t.match(/#\/p\/([A-Za-z0-9_-]+)/);
  if (conAncla) return conAncla[1];
  const conRuta = t.match(/\/p\/([A-Za-z0-9_-]+)/);
  if (conRuta) return conRuta[1];
  if (/^[A-Za-z0-9_-]{6,64}$/.test(t)) return t;
  // Etiquetas impresas con otro formato (URL de otro sistema, minúsculas,
  // espacios): se mandan tal cual y el servidor saca el código.
  if (t && t.length <= 300) return t;
  return null;
}

function cargarJsQR() {
  if (window.jsQR) return Promise.resolve();
  return new Promise((ok) => {
    const s = document.createElement("script");
    // Copia local (jsQR 1.4.0): no depende de un CDN y queda en el caché
    // del service worker, así que también lee QR sin señal.
    s.src = "jsQR.js";
    s.onload = ok;
    s.onerror = ok; // sin lector: queda la búsqueda por nombre
    document.head.appendChild(s);
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Búsqueda por nombre (respaldo cuando el QR está dañado)
// ─────────────────────────────────────────────────────────────────────────
async function pantallaBuscar() {
  encabezado("Buscar punto", SITIO?.nombre);
  const cuerpo = document.createElement("div");
  cuerpo.className = "contenido";
  cuerpo.innerHTML = `
    <div class="campo">
      <label for="q" class="oculto">Buscar punto</label>
      <input type="search" id="q" placeholder="Área, tipo, código o habitación" autocomplete="off" enterkeyhint="search" />
      <small class="ayuda">
        Escribe <strong>cocina</strong>, <strong>aerosol</strong> o <strong>4312</strong>,
        o toca un tipo para ver todos los de ese tipo.
      </small>
    </div>
    <div class="chips-tipo" id="chips-buscar" role="group" aria-label="Filtrar por tipo"></div>
    <div id="resultados"></div>`;
  app().appendChild(cuerpo);
  $("#q").focus();

  // Los puntos del hotel ya están en el teléfono (ruta del día): se busca ahí
  // primero y el resultado sale al instante, con o sin señal. El servidor se
  // consulta después solo para completar lo que no esté en la ruta (puntos
  // "por orden").
  const ruta = await leerCache(`ruta:${SITIO?.id}:${hoy()}`);
  const hechosHoy = new Set((ruta?.realizados || []).map((p) => p.qr_token));
  const locales = [...(ruta?.pendientes || []), ...(ruta?.realizados || [])].map((p) => ({
    qr_token: p.qr_token,
    codigo_visible: p.codigo_visible,
    nombre: p.punto_nombre,
    numero_habitacion: p.numero_habitacion,
    ubicacion_descripcion: p.ubicacion_descripcion,
    area: p.area_nombre || "Sin área",
    tipo: p.tipo_nombre || "Otros",
    icono: p.tipo_icono || "📍",
    hecho: hechosHoy.has(p.qr_token),
  }));

  let tipo = sessionStorage.getItem("asa_buscar_tipo") || "";
  let termino = "";
  let delServidor = [];
  let pedido = 0;

  const tipos = [...new Map(locales.map((p) => [p.tipo, p.icono])).entries()]
    .map(([nombre, icono]) => ({ nombre, icono, n: locales.filter((p) => p.tipo === nombre).length }))
    .sort((a, b) => b.n - a.n);
  if (tipo && !tipos.some((t) => t.nombre === tipo)) tipo = "";

  function pintarChips() {
    $("#chips-buscar").innerHTML = tipos.length
      ? `<button type="button" class="chip ${!tipo ? "activo" : ""}" data-tipo="" aria-pressed="${!tipo}">Todos</button>` +
        tipos.map((t) => `
          <button type="button" class="chip ${tipo === t.nombre ? "activo" : ""}" data-tipo="${esc(t.nombre)}" aria-pressed="${tipo === t.nombre}">
            <span aria-hidden="true">${t.icono}</span> ${esc(t.nombre)} <b>${t.n}</b>
          </button>`).join("")
      : "";
  }

  function coincide(p, t) {
    if (!t) return true;
    const campos = [p.codigo_visible, p.nombre, p.numero_habitacion, p.area, p.tipo, p.ubicacion_descripcion];
    // Una sola letra: lo que EMPIEZA con ella, para no traer medio hotel.
    return campos.some((v) => {
      const c = normalizar(v);
      return t.length === 1 ? c.startsWith(t) : c.includes(t);
    });
  }

  function pintar() {
    const caja = $("#resultados");
    const t = normalizar(termino.trim());
    if (!t && !tipo) { caja.innerHTML = ""; return; }

    const vistos = new Set();
    const lista = [];
    for (const p of [...locales, ...delServidor]) {
      if (vistos.has(p.qr_token)) continue;
      if (tipo && p.tipo !== tipo) continue;
      if (!coincide(p, t)) continue;
      vistos.add(p.qr_token);
      lista.push(p);
    }

    if (!lista.length) {
      caja.innerHTML = `<div class="vacio"><span class="emoji">🔍</span>
        Nada${termino ? ` con "${esc(termino)}"` : ""}${tipo ? ` en ${esc(tipo)}` : ""}.<br><small>Prueba con el área ("cocina", "lobby"),
        con el tipo ("cebadero", "lámpara") o con el número de la habitación.</small></div>`;
      return;
    }

    // Agrupado por área: cuando salen 40 cebaderos, por área se sabe dónde
    // hay que caminar. Lo que falta por hacer va antes que lo ya hecho.
    const porArea = {};
    for (const p of lista) (porArea[p.area] ||= []).push(p);
    const maximo = 300; // pintar miles de filas en un teléfono viejo traba la pantalla
    let pintadas = 0;

    caja.innerHTML = `
      <p class="resumen-busqueda">
        ${lista.length} punto${lista.length === 1 ? "" : "s"} en ${Object.keys(porArea).length} área${Object.keys(porArea).length === 1 ? "" : "s"}
        · ${lista.filter((p) => !p.hecho).length} por hacer
      </p>
      ${Object.entries(porArea)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([area, puntos]) => {
          if (pintadas >= maximo) return "";
          const filas = puntos
            .sort((a, b) => (a.hecho ? 1 : 0) - (b.hecho ? 1 : 0))
            .slice(0, maximo - pintadas);
          pintadas += filas.length;
          return `
            <div class="grupo-area">${esc(area)} · ${puntos.length}</div>
            ${filas.map((p) => `
              <div class="punto ${p.hecho ? "hecho" : ""}" data-token="${esc(p.qr_token)}" role="button" tabindex="0">
                <span class="icono" aria-hidden="true">${p.icono}</span>
                <div class="texto">
                  <div class="codigo">${esc(p.numero_habitacion ? `Hab. ${p.numero_habitacion}` : p.codigo_visible)}</div>
                  <div class="detalle">${esc([
                    p.numero_habitacion ? p.codigo_visible : p.nombre,
                    p.tipo,
                    p.ubicacion_descripcion,
                  ].filter(Boolean).join(" · "))}</div>
                </div>
                <span class="marca" aria-hidden="true">${p.hecho ? "✓" : "›"}</span>
              </div>`).join("")}`;
        })
        .join("")}
      ${lista.length > maximo ? `<p class="resumen-busqueda">Se muestran ${maximo}. Escribe algo más para afinar.</p>` : ""}`;
  }

  // El servidor completa la búsqueda (puntos fuera de la ruta del día)
  let temporizador;
  function consultarServidor() {
    clearTimeout(temporizador);
    const t = termino.trim();
    if (!t || !navigator.onLine) return;
    const yo = ++pedido;
    temporizador = setTimeout(async () => {
      try {
        const r = await GET(`/puntos/buscar?q=${encodeURIComponent(t)}&sitio_id=${SITIO?.id || ""}`);
        if (yo !== pedido) return; // ya escribió otra cosa
        delServidor = (r || []).map((p) => ({
          qr_token: p.qr_token,
          codigo_visible: p.codigo_visible,
          nombre: p.nombre,
          numero_habitacion: p.numero_habitacion,
          ubicacion_descripcion: p.ubicacion_descripcion,
          area: p.asa_areas?.nombre || "Sin área",
          tipo: p.asa_tipos_punto?.nombre || "Otros",
          icono: p.asa_tipos_punto?.icono || "📍",
          hecho: hechosHoy.has(p.qr_token),
        }));
        pintar();
      } catch {}
    }, t.length === 1 ? 420 : 260);
  }

  $("#q").addEventListener("input", (e) => {
    termino = e.target.value;
    delServidor = [];
    pintar();            // al instante, con lo que hay en el teléfono
    consultarServidor(); // y luego se completa
  });

  $("#chips-buscar").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-tipo]");
    if (!chip) return;
    tipo = chip.dataset.tipo;
    try { sessionStorage.setItem("asa_buscar_tipo", tipo); } catch {}
    vibrar(15);
    pintarChips();
    pintar();
  });

  $("#resultados").addEventListener("click", (e) => {
    const fila = e.target.closest("[data-token]");
    if (!fila) return;
    sessionStorage.setItem("asa_via_sig", "busqueda");
    location.hash = `#/p/${fila.dataset.token}`;
  });
  $("#resultados").addEventListener("keydown", (e) => {
    if (e.key === "Enter") e.target.closest?.("[data-token]")?.click();
  });

  pintarChips();
  pintar();
}

// ─────────────────────────────────────────────────────────────────────────
// Ficha del punto + checklist
// ─────────────────────────────────────────────────────────────────────────
// Catalogo de plagas
//
// El tecnico tiene que poder decir QUE encontro y CUANTAS, no solo "actividad
// alta". Sin eso, el reporte del hotel no puede mostrar tendencia por plaga,
// que es lo primero que piden en auditoria.
//
// Se guarda en cache: en un sotano sin senal el catalogo tiene que estar ahi
// igual, porque si no el tecnico no puede reportar lo que vio.
// ─────────────────────────────────────────────────────────────────────────
let PLAGAS = null;

async function catalogoPlagas() {
  if (PLAGAS) return PLAGAS;
  try {
    PLAGAS = await GET("/plagas/catalogo");
    await guardarCache("plagas", PLAGAS);
  } catch {
    PLAGAS = (await leerCache("plagas")) || [];
  }
  return PLAGAS;
}

// ─────────────────────────────────────────────────────────────────────────
// Catalogo de estados del punto
//
// Antes eran seis botones escritos aqui mismo, heredados del sistema anterior,
// y cambiarle una palabra a uno pedia tocar la app, el backend y la base. Ahora
// la lista se configura en el panel (Configuracion -> Estados del punto) y la
// app la baja y la guarda igual que el catalogo de plagas: en un sotano sin
// senal el tecnico tiene que poder marcar el estado de todas formas.
//
// La de abajo es solo la red de seguridad de la primera vez, antes de que la app
// haya podido bajar el catalogo ni una sola vez.
// ─────────────────────────────────────────────────────────────────────────
let ESTADOS = null;

const ESTADOS_RESPALDO = [
  { codigo: "ok",           etiqueta: "Todo bien",      orden: 10, requiere_motivo: false },
  { codigo: "actividad",    etiqueta: "Con actividad",  orden: 20, requiere_motivo: false },
  { codigo: "dañado",       etiqueta: "Dañado",         orden: 30, requiere_motivo: false, genera_hallazgo: true },
  { codigo: "faltante",     etiqueta: "No está",        orden: 40, requiere_motivo: false, genera_hallazgo: true },
  { codigo: "no_accesible", etiqueta: "No pude entrar", orden: 50, requiere_motivo: true },
  { codigo: "reemplazado",  etiqueta: "Lo reemplacé",   orden: 60, requiere_motivo: false },
];

async function catalogoEstados() {
  if (ESTADOS) return ESTADOS;
  const usables = (lista) =>
    (Array.isArray(lista) ? lista : [])
      .filter((e) => e?.codigo && e.activo !== false)
      .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));

  try {
    const lista = usables(await GET("/config/estados_punto"));
    ESTADOS = lista.length ? lista : ESTADOS_RESPALDO;
    await guardarCache("estados-punto", ESTADOS);
  } catch {
    ESTADOS = usables(await leerCache("estados-punto"));
    if (!ESTADOS.length) ESTADOS = ESTADOS_RESPALDO;
  }
  return ESTADOS;
}

// Los motivos por los que un servicio no se pudo hacer, en el idioma del
// tecnico. El backend guarda la clave; aqui se lee lo de la derecha.
const MOTIVOS = [
  ["huesped_en_habitacion", "El huesped estaba dentro"],
  ["permiso_denegado", "El hotel no autorizo"],
  ["sin_llave", "No aparecio quien abriera"],
  ["area_ocupada", "El area estaba ocupada"],
  ["evento_en_curso", "Habia un evento"],
  ["en_mantenimiento", "En obra o mantenimiento"],
  ["punto_inaccesible", "Bloqueado, no se llega"],
  ["otro", "Otro motivo"],
];

// ─────────────────────────────────────────────────────────────────────────
async function pantallaPunto(token) {
  encabezado("Punto de control", SITIO?.nombre);
  const cuerpo = document.createElement("div");
  cuerpo.className = "contenido";
  cuerpo.innerHTML = `<div class="cargando">Abriendo punto…</div>`;
  app().appendChild(cuerpo);

  let punto;
  try {
    punto = await GET(`/puntos/qr/${encodeURIComponent(token)}${SITIO?.id ? `?sitio_id=${SITIO.id}` : ""}`);
    await guardarCache(`punto:${token}`, punto);
  } catch (e) {
    if (e.datos?.sin_asignar) return pantallaEtiquetaSinAsignar(cuerpo, e.datos);
    // El servidor contestó (punto dado de baja, de otro hotel, error): se dice
    // eso. La copia guardada es solo para cuando no hay señal.
    punto = esSinSenal(e) ? await leerCache(`punto:${token}`) : null;
    if (!punto) {
      cuerpo.innerHTML = `
        <div class="vacio"><span class="emoji">❓</span>${esc(e.message)}</div>
        <button class="btn secundario" onclick="location.hash='#/buscar'">Buscar por nombre</button>`;
      return;
    }
    aviso("Sin señal: mostrando la última versión guardada");
  }

  const nombre = punto.numero_habitacion
    ? `Habitación ${punto.numero_habitacion}`
    : punto.nombre || punto.asa_tipos_punto?.nombre || "";
  const ultima = punto.historial?.[0];

  cuerpo.innerHTML = `
    <div class="tarjeta" style="border-left:5px solid ${esc(punto.asa_tipos_punto?.color || "#475569")}">
      <div style="display:flex;gap:14px;align-items:flex-start">
        <div style="font-size:40px;line-height:1">${punto.asa_tipos_punto?.icono || "📍"}</div>
        <div style="flex:1;min-width:0">
          <h2 style="font-size:20px">${esc(punto.codigo_visible)}</h2>
          <p style="font-weight:600;color:var(--gris-900)">${esc(nombre)}</p>
          <p style="margin-top:6px">${esc(punto.asa_tipos_punto?.nombre || "")}</p>
          <p>${esc(punto.asa_areas?.nombre || "Sin área")}${punto.asa_areas?.nivel ? ` · ${esc(punto.asa_areas.nivel)}` : ""}</p>
          ${punto.ubicacion_descripcion ? `<p style="margin-top:8px;font-style:italic">📌 ${esc(punto.ubicacion_descripcion)}</p>` : ""}
        </div>
      </div>
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        <span class="etiqueta">Cada ${esc(punto.frecuencia)}</span>
        ${ultima
          ? `<span class="etiqueta ${ultima.nivel_actividad === "ninguna" ? "verde" : "ambar"}">Última: ${new Date(ultima.fecha).toLocaleDateString("es-DO")}</span>`
          : `<span class="etiqueta roja">Nunca inspeccionado</span>`}
      </div>
      ${punto.asa_planos?.imagen_url ? `<button class="btn secundario" id="ver-plano" style="margin-top:12px">🗺️ Ver en el plano</button>` : ""}
    </div>

    <form id="form-inspeccion"></form>`;

  $("#ver-plano")?.addEventListener("click", () => (location.hash = `#/plano/${punto.id}`));

  // Las plagas de ESTE punto vienen dentro de la ficha (el backend las saca de
  // las que lleva su tipo), asi que no hay que pedirlas aparte y funcionan sin
  // senal. `catalogoPlagas()` queda solo para fichas viejas que se guardaron en
  // el telefono antes de este cambio y no traen el campo.
  // Si el tipo de punto no tiene plagas asignadas, el contador no salía y el
  // técnico no tenía dónde poner cuántas moscas o cucarachas vio: lo dejaba en
  // las notas y no contaba en ningún reporte. Ahora sale el catálogo completo,
  // pero solo cuando marca que hubo actividad.
  let plagas = Array.isArray(punto.plagas) ? punto.plagas : await catalogoPlagas();
  let soloConActividad = false;
  if (!plagas.length) {
    plagas = await catalogoPlagas();
    soloConActividad = true;
  }
  const estados = await catalogoEstados();
  pintarFormulario($("#form-inspeccion"), punto, plagas, estados, { soloConActividad });
}

function pintarFormulario(form, punto, plagas = [], estados = ESTADOS_RESPALDO, opciones = {}) {
  const preguntas = punto.preguntas || [];
  const estadoPorDefecto = estados[0]?.codigo || "ok";
  const estadoDe = (codigo) => estados.find((e) => e.codigo === codigo) || null;

  form.innerHTML = `
    <div class="grupo-area">Estado del punto</div>
    <div class="campo">
      ${botonera(
        "estado_punto",
        // El tercer elemento pinta el boton en rojo al marcarlo: los estados que
        // piden motivo o abren hallazgo tienen que verse distintos de "todo bien".
        estados.map((e) => [e.codigo, e.etiqueta, e.requiere_motivo || e.genera_hallazgo ? "alerta" : ""]),
        estadoPorDefecto,
        "dos"
      )}
    </div>

    <!-- Solo aparece si marco "No pude entrar". El motivo es obligatorio:
         "no se hizo" sin decir por que es justo lo que el hotel discute. -->
    <div class="campo" id="caja-motivo" style="display:none">
      <label>¿Por qué no se pudo hacer? <span class="obligatorio">*</span></label>
      ${botonera("motivo_no_realizado", MOTIVOS, null, "dos")}
      <input type="text" id="impedido_por" placeholder="¿Con quién hablaste? (nombre y puesto)"
             style="margin-top:10px" />
    </div>

    <div class="campo" id="caja-actividad">
      <label>Nivel de actividad</label>
      ${botonera("nivel_actividad", [
        ["ninguna", "Ninguna"],
        ["bajo", "Baja"],
        ["medio", "Media"],
        ["alto", "Alta"],
      ], "ninguna", "dos")}
    </div>

    ${plagas.length ? `
    <div class="campo" id="caja-plagas">
      <label>¿Qué encontraste y cuántas?</label>
      <div class="plagas">
        ${plagas.map((pl) => `
          <div class="plaga" data-plaga="${esc(pl.id)}" data-cant="0">
            <span class="pl-ic">${esc(pl.icono || "•")}</span>
            <span class="pl-nom">${esc(pl.nombre)}</span>
            <button type="button" class="pl-btn" data-paso="-1">−</button>
            <span class="pl-cant">0</span>
            <button type="button" class="pl-btn" data-paso="1">+</button>
          </div>`).join("")}
      </div>
      <small class="ayuda">Deja en cero lo que no encontraste. Solo se guarda lo que pasó de cero. Lo que pongas aquí es lo que sale en el reporte de plagas.</small>
    </div>` : ""}

    ${preguntas.length ? `<div class="grupo-area">Checklist</div>` : ""}
    ${preguntas.map(campoPregunta).join("")}

    <!-- Un punto sin checklist no es normal: es que a su tipo no se le asignó
         ninguna estrategia. Antes la app se quedaba callada y el técnico
         registraba el punto pensando que así era. Ahora se dice, porque es lo
         que hace que alguien lo arregle en el panel. -->
    ${!preguntas.length && punto.sin_estrategia ? `
      <div class="tarjeta aviso-config">
        <strong>Este punto todavía no tiene checklist.</strong>
        <p>Se puede registrar igual con su estado y nivel de actividad. Para que
        traiga preguntas, en el panel hay que asignarle una estrategia a
        <em>${esc(punto.asa_tipos_punto?.nombre || "este tipo de punto")}</em>.</p>
      </div>` : ""}

    <div class="grupo-area">Cierre</div>
    <div class="campo">
      <label>Fotos</label>
      <!-- Dos botones en vez de un input suelto. El input con capture abre la
           camara directo; el otro abre la galeria del telefono, que es lo que
           hace falta cuando la foto ya se tomo antes de abrir la app (sin senal,
           con el telefono de otro, o porque se documento el area al entrar). -->
      <div class="foto-acciones">
        <button type="button" class="btn secundario" id="btn-camara">📷 Tomar foto</button>
        <button type="button" class="btn secundario" id="btn-galeria">🖼️ Elegir de mis fotos</button>
      </div>
      <input type="file" id="fotos-camara" accept="image/*" capture="environment" multiple hidden />
      <input type="file" id="fotos-galeria" accept="image/*" multiple hidden />
      <div id="vista-fotos" class="vista-fotos"></div>
    </div>
    <div class="campo">
      <label for="notas">Observaciones</label>
      <textarea id="notas" placeholder="Lo que el hotel deba saber"></textarea>
    </div>

    <div class="pie-fijo">
      <button class="btn" type="submit" id="guardar">✓ Guardar inspección</button>
    </div>`;

  // Botoneras de una sola opcion
  form.querySelectorAll("[data-grupo]").forEach((grupo) => {
    grupo.addEventListener("click", (e) => {
      const op = e.target.closest(".opcion");
      if (!op) return;
      grupo.querySelectorAll(".opcion").forEach((o) => o.classList.remove("activa", "no"));
      op.classList.add("activa");
      if (["false", "no"].includes(op.dataset.valor) || op.classList.contains("alerta")) op.classList.add("no");
      grupo.dataset.valor = op.dataset.valor;
      vibrar(15);
    });
  });

  // Listas de varias opciones (Áreas tratadas, Plagas observadas, Indicios…).
  //
  // Antes toda pregunta de lista se pintaba con la misma botonera de una sola
  // opcion, asi que marcar "Clóset" borraba "Baño" aunque en el panel la
  // pregunta estuviera configurada para varias. Aqui cada opcion se prende y se
  // apaga sola, y al guardar se manda la lista completa en valor_opciones.
  form.querySelectorAll("[data-multi]").forEach((grupo) => {
    grupo.addEventListener("click", (e) => {
      const op = e.target.closest(".opcion");
      if (!op) return;
      op.classList.toggle("activa");
      vibrar(12);
    });
  });

  // Al marcar un estado que pide motivo ("No pude entrar" y los que ASA haya
  // configurado igual) el formulario cambia de cara: pide el motivo y esconde lo
  // que ya no aplica (nivel de actividad y conteo de plagas de un punto al que
  // no se entro). Asi no quedan filas contradictorias.
  const grupoEstado = form.querySelector('[data-grupo="estado_punto"]');
  const grupoNivel = form.querySelector('[data-grupo="nivel_actividad"]');
  const sincronizarCaras = () => {
    const noEntro = !!estadoDe(grupoEstado.dataset.valor)?.requiere_motivo;
    form.querySelector("#caja-motivo").style.display = noEntro ? "" : "none";
    form.querySelector("#caja-actividad").style.display = noEntro ? "none" : "";
    const cajaPlagas = form.querySelector("#caja-plagas");
    const hayActividad = (grupoNivel.dataset.valor && grupoNivel.dataset.valor !== "ninguna") || grupoEstado.dataset.valor === "actividad";
    if (cajaPlagas) cajaPlagas.style.display = noEntro || (opciones.soloConActividad && !hayActividad) ? "none" : "";
  };
  grupoEstado.addEventListener("click", () => setTimeout(sincronizarCaras, 0));
  grupoNivel.addEventListener("click", () => setTimeout(sincronizarCaras, 0));
  sincronizarCaras();

  // "¿Se realizó el tratamiento / la aplicación?" → No. Antes el servicio se
  // guardaba como hecho (verde) aunque el técnico dijera que no se hizo. Ahora
  // esa respuesta pasa el punto a "no se pudo" y pide el motivo: queda en
  // amarillo y sigue pendiente.
  const estadoNoSePudo = estados.find((e) => e.requiere_motivo && e.activo !== false) || estados.find((e) => e.requiere_motivo);
  for (const p of preguntas) {
    if (p.tipo_respuesta !== "si_no" || !/se\s+realiz/i.test(p.texto || "")) continue;
    form.querySelector(`[data-grupo="p_${p.id}"]`)?.addEventListener("click", (e) => {
      const op = e.target.closest(".opcion");
      if (!op || op.dataset.valor !== "false" || !estadoNoSePudo) return;
      const boton = grupoEstado.querySelector(`.opcion[data-valor="${CSS.escape(estadoNoSePudo.codigo)}"]`);
      if (boton) {
        boton.click();
        setTimeout(() => {
          sincronizarCaras();
          form.querySelector("#caja-motivo").scrollIntoView({ behavior: "smooth", block: "center" });
        }, 0);
        aviso("Marcado como NO realizado: dime por qué no se pudo hacer");
      }
    });
  }

  // Contadores de plagas: a toques, sin teclado. Un toque largo no hace falta;
  // para cantidades grandes (una lampara cargada de moscas) el paso sube solo.
  form.querySelectorAll(".plaga").forEach((fila) => {
    const salida = fila.querySelector(".pl-cant");
    fila.querySelectorAll(".pl-btn").forEach((b) =>
      b.addEventListener("click", () => {
        const actual = Number(fila.dataset.cant) || 0;
        // Paso creciente: 1 en 1 hasta 10, de 5 en 5 hasta 50, de 10 en 10 despues.
        const paso = Number(b.dataset.paso) * (actual >= 50 ? 10 : actual >= 10 ? 5 : 1);
        const nuevo = Math.max(0, actual + paso);
        fila.dataset.cant = String(nuevo);
        salida.textContent = String(nuevo);
        fila.classList.toggle("con-algo", nuevo > 0);
        vibrar(10);
      })
    );
  });

  // Fotos: se guardan como data URL para que sobrevivan sin señal en la cola.
  // Da igual si salieron de la camara o de la galeria: entran por el mismo sitio
  // y se achican igual antes de guardarse.
  const fotos = [];
  const vista = form.querySelector("#vista-fotos");

  const pintarFotos = () => {
    vista.innerHTML = fotos
      .map(
        (f, i) => `
        <figure class="foto-mini">
          <img src="${f}" alt="Foto ${i + 1}" />
          <button type="button" class="foto-quitar" data-quitar="${i}" aria-label="Quitar la foto ${i + 1}">×</button>
        </figure>`
      )
      .join("");
    vista.querySelectorAll("[data-quitar]").forEach((b) =>
      b.addEventListener("click", () => {
        fotos.splice(Number(b.dataset.quitar), 1);
        pintarFotos();
        vibrar(15);
      })
    );
  };

  const agregarFotos = async (lista) => {
    for (const archivo of lista) {
      if (!archivo.type?.startsWith("image/")) continue;
      fotos.push(await reducirImagen(archivo, 1024, 0.6, true));
    }
    pintarFotos();
  };

  form.querySelector("#btn-camara").addEventListener("click", () => form.querySelector("#fotos-camara").click());
  form.querySelector("#btn-galeria").addEventListener("click", () => form.querySelector("#fotos-galeria").click());
  ["#fotos-camara", "#fotos-galeria"].forEach((sel) =>
    form.querySelector(sel).addEventListener("change", async (e) => {
      await agregarFotos(e.target.files);
      e.target.value = "";   // para poder volver a escoger la misma foto
    })
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const boton = form.querySelector("#guardar");

    const estado = grupoEstado.dataset.valor || estadoPorDefecto;
    const noEntro = !!estadoDe(estado)?.requiere_motivo;
    const motivo = form.querySelector('[data-grupo="motivo_no_realizado"]').dataset.valor || null;
    if (noEntro && !motivo) return aviso("Dime por qué no se pudo hacer", "error");

    const capturas = [...form.querySelectorAll(".plaga")]
      .map((f) => ({ plaga_id: f.dataset.plaga, cantidad: Number(f.dataset.cant) || 0 }))
      .filter((c) => c.cantidad > 0);

    const nivelMarcado = form.querySelector('[data-grupo="nivel_actividad"]').dataset.valor || "ninguna";
    if (!noEntro && nivelMarcado !== "ninguna" && !capturas.length && form.querySelector("#caja-plagas")
        && !confirm("Marcaste actividad pero no pusiste cuántas plagas encontraste. Sin ese número no sale en el reporte de plagas.\n\n¿Guardar así de todos modos?")) {
      form.querySelector("#caja-plagas").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const respuestas = [];
    let falta = null;
    for (const p of preguntas) {
      if (noEntro) break;   // no se entro: no hay checklist que responder
      const valor = leerRespuesta(form, p);
      const vacio = valor === null || valor === "" || (Array.isArray(valor) && !valor.length);
      if (p.obligatoria && vacio) {
        falta ||= p.texto;
        continue;
      }
      if (vacio) continue;
      respuestas.push({
        pregunta_id: p.id,
        pregunta_texto: p.texto,
        // Una lista de varias opciones viaja en valor_opciones, que es lo que el
        // panel y el PDF leen primero. El valor_texto va de acompanante para las
        // exportaciones viejas que solo miraban esa columna.
        ...(Array.isArray(valor)
          ? { valor_opciones: valor, valor_texto: valor.join(", ") }
          : p.tipo_respuesta === "si_no"
            ? { valor_bool: valor === "true" }
            : p.tipo_respuesta === "numero"
              ? { valor_numero: Number(valor) }
              : { valor_texto: String(valor) }),
      });
    }
    if (falta) return aviso(`Falta responder: ${falta}`, "error");

    const inspeccion = {
      punto_id: punto.id,
      estado_punto: estado,
      nivel_actividad: noEntro
        ? "ninguna"
        : form.querySelector('[data-grupo="nivel_actividad"]').dataset.valor || "ninguna",
      motivo_no_realizado: noEntro ? motivo : null,
      impedido_por: noEntro ? (form.querySelector("#impedido_por").value.trim() || null) : null,
      notas: form.querySelector("#notas").value.trim() || null,
      fotos,
      metodo_acceso: sessionStorage.getItem("asa_via") || "qr",
      respuestas,
      capturas: noEntro ? [] : capturas,
    };

    boton.disabled = true;
    boton.textContent = "Guardando…";

    try {
      if (navigator.onLine) {
        const guardada = await POST("/inspecciones", inspeccion);
        if (guardada?.aviso) aviso(guardada.aviso, "error");
        else aviso(noEntro ? "Reportado como no realizado ✓" : "Inspección registrada ✓", "exito");
      } else {
        await encolar(inspeccion);
        aviso("Guardada en el teléfono — se enviará al haber señal", "exito");
      }
    } catch (err) {
      // Si el envío falla por red, no se pierde: va a la cola.
      await encolar(inspeccion);
      aviso("Sin conexión — guardada para enviar después");
    }

    vibrar([40, 30, 80]);
    await actualizarContadorPendientes();
    const volver = sessionStorage.getItem("asa_volver");
    sessionStorage.removeItem("asa_volver");
    location.hash = volver || "#/ruta";
  });
}

// Botonera de una sola opcion. El tercer elemento de cada opcion es una clase
// extra opcional ("alerta" pinta el boton en rojo al marcarlo).
function botonera(nombre, opciones, porDefecto, clase = "") {
  return `<div class="opciones ${clase}" data-grupo="${nombre}" data-valor="${porDefecto ?? ""}">
    ${opciones
      .map(
        ([valor, texto, extra]) =>
          `<div class="opcion ${extra || ""} ${valor === porDefecto ? "activa" : ""}${
            valor === porDefecto && extra === "alerta" ? " no" : ""
          }" data-valor="${esc(valor)}">${esc(texto)}</div>`
      )
      .join("")}
  </div>`;
}

// Botonera de varias opciones: cada una se prende y se apaga por su cuenta.
function botoneraMulti(nombre, opciones, clase = "") {
  return `<div class="opciones multi ${clase}" data-multi="${nombre}">
    ${opciones.map((o) => `<div class="opcion" data-valor="${esc(o)}">${esc(o)}</div>`).join("")}
  </div>`;
}

function campoPregunta(p) {
  const etiqueta = `<label>${esc(p.texto)}${p.obligatoria ? ' <span class="obligatorio">*</span>' : ""}</label>`;
  const id = `p_${p.id}`;

  if (p.tipo_respuesta === "si_no") {
    return `<div class="campo">${etiqueta}${botonera(id, [["true", "Sí"], ["false", "No"]], null, "dos")}</div>`;
  }
  // Toda pregunta de lista acepta varias respuestas: en campo casi nunca se trata
  // una sola area ni se ve una sola plaga, y obligar a escoger una sola era lo
  // que hacia que el tecnico dejara la mitad de lo que hizo sin registrar.
  if (p.tipo_respuesta === "seleccion" || p.tipo_respuesta === "multiple") {
    const ops = (p.opciones || []).map(String);
    return `<div class="campo">${etiqueta}
      ${botoneraMulti(id, ops, ops.length > 3 ? "dos" : "")}
      <small class="ayuda">Marca todas las que apliquen.</small></div>`;
  }
  if (p.tipo_respuesta === "numero") {
    return `<div class="campo">${etiqueta}
      <input type="number" id="${id}" inputmode="decimal" step="any" placeholder="${esc(p.unidad || "")}" /></div>`;
  }
  if (p.tipo_respuesta === "escala") {
    return `<div class="campo">${etiqueta}${botonera(id, [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"]], null)}</div>`;
  }
  return `<div class="campo">${etiqueta}<textarea id="${id}" rows="2"></textarea></div>`;
}

function leerRespuesta(form, p) {
  const id = `p_${p.id}`;
  const multi = form.querySelector(`[data-multi="${id}"]`);
  if (multi) return [...multi.querySelectorAll(".opcion.activa")].map((o) => o.dataset.valor);
  const grupo = form.querySelector(`[data-grupo="${id}"]`);
  if (grupo) return grupo.dataset.valor || null;
  const campo = form.querySelector(`#${CSS.escape(id)}`);
  return campo ? campo.value.trim() || null : null;
}

// Las fotos se reducen antes de guardarlas: una foto de teléfono pesa 4 MB y
// en la cola offline eso llena el almacenamiento en pocas inspecciones.
//
// Con `webp` en true se intenta WebP (pesa ~30% menos que un JPEG de la misma
// calidad). Safari no sabe codificar WebP en canvas y devuelve PNG, que pesa
// MUCHO más: en ese caso se cae a JPEG. El servidor convierte la WebP a JPEG
// solo al armar el PDF, así que el reporte no pierde fotos.
function reducirImagen(archivo, maxLado = 1280, calidad = 0.7, webp = false) {
  // Dibuja la foto achicada en un canvas y la devuelve como JPEG (o WebP).
  // Si el navegador no la puede leer (formato raro), devuelve el data URL
  // original: quien llama decide si le sirve (el chequeo lo rechaza).
  const dibujar = (fuente, ancho, alto) => {
    const escala = Math.min(1, maxLado / Math.max(ancho, alto));
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.max(1, Math.round(ancho * escala));
    lienzo.height = Math.max(1, Math.round(alto * escala));
    lienzo.getContext("2d").drawImage(fuente, 0, 0, lienzo.width, lienzo.height);
    if (webp) {
      const w = lienzo.toDataURL("image/webp", calidad);
      if (w.startsWith("data:image/webp")) return w;
    }
    return lienzo.toDataURL("image/jpeg", calidad);
  };
  const porImagen = () => new Promise((ok) => {
    const lector = new FileReader();
    lector.onload = () => {
      const img = new Image();
      img.onload = () => {
        try { ok(dibujar(img, img.naturalWidth || img.width, img.naturalHeight || img.height)); }
        catch { ok(lector.result); }
      };
      img.onerror = () => ok(lector.result);
      img.src = lector.result;
    };
    lector.onerror = () => ok("");
    lector.readAsDataURL(archivo);
  });
  // createImageBitmap es más rápido, no revienta la memoria con fotos de 50MP
  // y respeta la orientación de la cámara. Si no existe o falla, plan B.
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(archivo, { imageOrientation: "from-image" })
      .then((bmp) => { const r = dibujar(bmp, bmp.width, bmp.height); bmp.close?.(); return r; })
      .catch(porImagen);
  }
  return porImagen();
}

// ─────────────────────────────────────────────────────────────────────────
// Plano: dónde queda el punto que el técnico no conoce
// ─────────────────────────────────────────────────────────────────────────
// La pantalla del mapa vive en mapa.js: renderiza PDF con zoom y ubica al
// tecnico con el GPS encima del plano.

// ─────────────────────────────────────────────────────────────────────────
// Enrutador
// ─────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────
// Solicitudes del hotel
//
// El hotel manda desde su portal la lista de habitaciones que ya liberaron los
// huéspedes. Aquí salen arriba de la ruta. Tocar una habitación abre el punto
// como si se hubiera escaneado; al guardar la inspección, la habitación se
// marca sola en la solicitud (lo hace la base de datos) y el hotel la ve en
// verde. No hay que marcar nada dos veces.
// ─────────────────────────────────────────────────────────────────────────
const MOTIVO_TXT = {
  permiso_denegado: "El hotel no autorizó", huesped_en_habitacion: "Huésped dentro",
  area_ocupada: "Área ocupada", sin_llave: "Sin llave", en_mantenimiento: "En mantenimiento",
  punto_inaccesible: "Inaccesible", evento_en_curso: "Evento en curso", otro: "Otro motivo",
};

async function bloqueSolicitudes(caja) {
  const clave = `solicitudes:${SITIO.id}`;
  let lista;
  try {
    lista = await GET(`/solicitudes?sitio_id=${SITIO.id}&estado=abiertas`);
    await guardarCache(clave, lista);
  } catch {
    lista = (await leerCache(clave)) || [];
  }
  if (!caja.isConnected) return;
  if (!lista.length) { caja.innerHTML = ""; return; }

  caja.innerHTML = `
    <div class="grupo-area" style="color:var(--rojo)">🛎️ Pedidas por el hotel · ${lista.length}</div>
    ${lista.map((o) => {
      const p = o.puntos;
      const faltan = p.pendientes + p.no_realizados;
      return `
      <div class="punto solicitud ${o.recibido_tecnico_at ? "" : "sin-recibir"}" data-sol="${esc(o.id)}">
        <span class="icono">${o.tipo_solicitud === "plaga" ? "🐜" : "🛏️"}</span>
        <div class="texto">
          <div class="codigo">
            ${o.tipo_solicitud === "plaga" ? esc(o.tipo_plaga_reportada || "Reporte de plaga") : `${faltan} por hacer de ${p.total}`}
            ${o.prioridad === "urgente" ? ` <span class="etiqueta roja">URGENTE</span>` : ""}
            ${o.recibido_tecnico_at ? "" : ` <span class="etiqueta">NUEVA</span>`}
          </div>
          <div class="detalle">${esc(o.numero_orden || "")}${o.creado_por_nombre ? ` · ${esc(o.creado_por_nombre)}` : ""}${o.mensajes_total ? ` · 💬 ${o.mensajes_total}` : ""}</div>
        </div>
        <span class="marca">›</span>
      </div>`;
    }).join("")}`;

  caja.querySelectorAll("[data-sol]").forEach((el) =>
    el.addEventListener("click", () => (location.hash = `#/solicitud/${el.dataset.sol}`))
  );
}

async function pantallaSolicitud(id) {
  encabezado("Solicitud del hotel", SITIO?.nombre || "");
  const cuerpo = document.createElement("div");
  cuerpo.className = "contenido";
  cuerpo.innerHTML = `<div class="cargando">Cargando…</div>`;
  app().appendChild(cuerpo);

  const clave = `solicitud:${id}`;
  let o;
  try {
    o = await GET(`/solicitudes/${id}`);
    await guardarCache(clave, o);
  } catch {
    o = await leerCache(clave);
    if (!o) {
      cuerpo.innerHTML = `<div class="vacio"><span class="emoji">📡</span>Sin señal. Ábrela una vez con conexión para tenerla en el teléfono.</div>`;
      return;
    }
  }
  if (!cuerpo.isConnected) return;

  // Lo hecho sin señal todavía no llegó al servidor: se marca aquí para no repetirlo.
  const cola = await BD.todos("cola").catch(() => []);
  // Solo lo HECHO sin señal se da por hecho; un "no se pudo" sigue pendiente.
  const enCola = new Set(cola.filter((c) => !c.motivo_no_realizado).map((c) => c.punto_id));

  const abierta = ["solicitada", "agendada", "en_ruta", "en_sitio"].includes(o.estado);
  const porArea = {};
  for (const p of o.puntos) (porArea[p.area_nombre || "Sin área"] ||= []).push(p);
  const faltan = o.puntos.filter((p) => (p.estado === "pendiente" || p.estado === "no_realizado") && !enCola.has(p.punto_id));

  const fila = (p) => {
    const local = enCola.has(p.punto_id) && p.estado !== "hecho";
    const hecho = p.estado === "hecho";
    const clase = hecho || local ? "hecho" : p.estado === "no_realizado" ? "vencido" : p.estado === "cancelado" ? "" : "vencido";
    const marca = hecho ? "✅" : local ? "⏳" : p.estado === "cancelado" ? "✖" : p.estado === "no_realizado" ? "⚠️" : "›";
    const nombre = p.numero_habitacion ? `Habitación ${p.numero_habitacion}` : p.punto_nombre || p.codigo_visible;
    const puedeAbrir = abierta && !hecho && !local && p.estado !== "cancelado" && p.qr_token;
    return `
      <div class="punto ${clase}" ${puedeAbrir ? `data-token="${esc(p.qr_token)}"` : ""}>
        <span class="icono">${p.tipo_icono || "🛏️"}</span>
        <div class="texto">
          <div class="codigo">${esc(nombre)}</div>
          <div class="detalle">${esc(p.codigo_visible || "")}${p.estado === "no_realizado" ? ` · No se pudo: ${esc(MOTIVO_TXT[p.motivo_no_realizado] || "")} — toca para reintentar` : ""}${local ? " · Guardada en el teléfono" : ""}</div>
        </div>
        <span class="marca">${marca}</span>
      </div>`;
  };

  cuerpo.innerHTML = `
    <div class="tarjeta">
      <h2>${esc(o.numero_orden || "")} ${o.prioridad === "urgente" ? `<span class="etiqueta roja">URGENTE</span>` : ""}</h2>
      <p>Pedida por <strong>${esc(o.creado_por_nombre || "el hotel")}</strong> · ${new Date(o.created_at).toLocaleString("es-DO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
      ${o.fecha_requerida ? `<p>Para el ${new Date(o.fecha_requerida + "T12:00:00").toLocaleDateString("es-DO", { weekday: "long", day: "numeric", month: "long" })}</p>` : ""}
      ${o.tipo_plaga_reportada ? `<p>Plaga: <strong>${esc(o.tipo_plaga_reportada)}</strong></p>` : ""}
      ${o.descripcion_cliente ? `<p style="margin-top:8px;color:var(--gris-900)">📝 ${esc(o.descripcion_cliente)}</p>` : ""}
      ${o.incidencia ? `
        <button class="btn ${["abierta", "en_tratamiento"].includes(o.incidencia.estado) ? "peligro" : "secundario"}" style="margin-top:12px"
                onclick="location.hash='#/incidencia/${esc(o.incidencia.id)}'">
          🛏️ ${["abierta", "en_tratamiento"].includes(o.incidencia.estado)
            ? `Hacer la verificación de chinche · hab. ${esc(o.incidencia.numero_habitacion)}`
            : `Ver verificación (${o.incidencia.estado === "cancelada" ? "caso cancelado" : "sin chinche"})`}
        </button>` : ""}
      ${!abierta ? `<p style="margin-top:8px"><strong>Esta solicitud ya está cerrada.</strong></p>` : ""}
    </div>

    ${abierta && !o.recibido_tecnico_at ? `<button class="btn" id="sol-recibida">✓ La recibí — avisar al hotel</button>` : ""}

    ${o.puntos.length ? `
      <div class="avance" style="margin-top:12px">
        <div class="hechos"><div class="numero">${o.puntos.length - faltan.length}</div><div class="rotulo">Hechas</div></div>
        <div class="faltan"><div class="numero">${faltan.length}</div><div class="rotulo">Faltan</div></div>
      </div>
      ${Object.entries(porArea).map(([area, lista]) => `
        <div class="grupo-area" style="margin-top:14px">${esc(area)}</div>
        ${lista.map(fila).join("")}`).join("")}` : ""}

    <div class="grupo-area" style="margin-top:18px">Mensajes</div>
    <div class="hilo">
      ${o.mensajes.length ? o.mensajes.map((m) => `
        <div class="msg ${m.usuario_id === USUARIO?.id ? "mio" : ""}">
          <div class="autor">${esc(m.autor_nombre || "")} · ${m.autor_rol === "cliente_calidad" ? "Hotel" : m.autor_rol === "tecnico_plagas" ? "Técnico" : "Oficina"}</div>
          <div class="txt">${esc(m.texto)}</div>
          <div class="hora">${new Date(m.created_at).toLocaleString("es-DO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
        </div>`).join("") : `<div class="vacio" style="padding:14px">Sin mensajes.</div>`}
    </div>
    <textarea id="sol-texto" rows="2" class="caja-texto" placeholder="Ej.: La 4318 tiene huésped, vuelvo a las 3:00."></textarea>
    <button class="btn secundario" id="sol-enviar">Enviar mensaje</button>`;

  cuerpo.querySelectorAll("[data-token]").forEach((el) =>
    el.addEventListener("click", () => {
      // Al guardar la inspección se vuelve a esta solicitud, no a la ruta.
      sessionStorage.setItem("asa_volver", `#/solicitud/${o.id}`);
      sessionStorage.setItem("asa_via_sig", "manual");
      location.hash = `#/p/${el.dataset.token}`;
    })
  );
  $("#sol-recibida", cuerpo)?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try { await POST(`/solicitudes/${o.id}/recibida`, {}); aviso("El hotel ya sabe que la recibiste ✓", "exito"); pantallaSolicitud(id); }
    catch (err) { aviso(navigator.onLine ? err.message : "Sin señal: inténtalo al tener conexión"); e.target.disabled = false; }
  });
  $("#sol-enviar", cuerpo).addEventListener("click", async (e) => {
    const texto = $("#sol-texto", cuerpo).value.trim();
    if (!texto) return;
    e.target.disabled = true;
    try { await POST(`/solicitudes/${o.id}/mensajes`, { texto }); pantallaSolicitud(id); }
    catch (err) { aviso(navigator.onLine ? err.message : "Sin señal: el mensaje no se envió"); e.target.disabled = false; }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Leer un QR desde una FOTO
//
// Para etiquetas gastadas, con reflejo o en sitios donde la cámara en vivo no
// enfoca: se toma la foto con la cámara normal del teléfono y se lee aquí.
// Prueba varios tamaños porque jsQR falla con fotos de 12 MP y con QR chicos.
// ─────────────────────────────────────────────────────────────────────────
async function leerQRDeFoto(archivo) {
  const bitmap = await createImageBitmap(archivo);
  if ("BarcodeDetector" in window) {
    try {
      const r = await new BarcodeDetector({ formats: ["qr_code"] }).detect(bitmap);
      if (r.length) return r[0].rawValue;
    } catch {}
  }
  await cargarJsQR();
  const lienzo = document.createElement("canvas");
  const ctx = lienzo.getContext("2d", { willReadFrequently: true });
  for (const lado of [1600, 1000, 700, 2400]) {
    const k = Math.min(1, lado / Math.max(bitmap.width, bitmap.height));
    lienzo.width = Math.round(bitmap.width * k);
    lienzo.height = Math.round(bitmap.height * k);
    ctx.drawImage(bitmap, 0, 0, lienzo.width, lienzo.height);
    const img = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
    const c = window.jsQR?.(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
    if (c?.data) return c.data;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Etiqueta sin asignar
//
// Se escaneó (o fotografió) un QR que no abre ningún punto. Al administrador
// y a operaciones se les deja asignarlo ahí mismo al punto correcto; al
// técnico se le avisa que quedó anotado para la oficina.
// ─────────────────────────────────────────────────────────────────────────
const PUEDE_ASIGNAR_QR = () => ["admin", "operaciones"].includes(USUARIO?.rol);

function pantallaEtiquetaSinAsignar(cuerpo, datos) {
  const origen = sessionStorage.getItem("asa_origen_qr") === "foto" ? "foto" : "escaneo";
  cuerpo.innerHTML = `
    <div class="tarjeta" style="border-left:5px solid ${datos.en_lote ? "var(--ambar)" : "var(--rojo)"}">
      <h2>🏷️ Etiqueta sin asignar</h2>
      <p style="margin-top:6px">Código: <strong style="font-family:monospace;font-size:16px;color:var(--gris-900)">${esc(datos.token || "—")}</strong></p>
      <p style="margin-top:8px">${datos.en_lote
        ? `✅ Es de las etiquetas que ASA mandó a imprimir${datos.lote ? ` (lote <strong>${esc(datos.lote)}</strong>)` : ""}.`
        : `⚠️ No está en la lista de etiquetas impresas de ASA.`}</p>
    </div>
    ${PUEDE_ASIGNAR_QR() ? `
      <div class="grupo-area">¿A qué punto pertenece?</div>
      <p style="color:var(--gris-600);font-size:14px;margin:0 0 8px">
        Busca el punto donde está pegada esta etiqueta${SITIO ? ` en <strong>${esc(SITIO.nombre)}</strong>` : ""}.
        Desde ese momento, escanearla abre ese punto.
      </p>
      <input id="asig-q" class="caja-texto" placeholder="Habitación, código, área o tipo…" autocomplete="off" />
      <div id="asig-lista"></div>
      <p style="color:var(--gris-400);font-size:13px;margin-top:12px">
        Si el punto todavía no existe, créalo en el panel (Plantas → Puntos de control → + Punto) y
        escribe este código en "Etiqueta QR ya impresa".
      </p>` : `
      <div class="vacio" style="padding:20px">
        Quedó anotada para que la oficina la asigne.<br>Mientras tanto, busca el punto por nombre.
      </div>
      <button class="btn secundario" onclick="location.hash='#/buscar'">🔍 Buscar por nombre</button>`}`;

  if (!PUEDE_ASIGNAR_QR()) return;
  const q = $("#asig-q", cuerpo);
  const lista = $("#asig-lista", cuerpo);
  let turno = 0;
  q.addEventListener("input", () => {
    const texto = q.value.trim();
    const mio = ++turno;
    if (texto.length < 1) { lista.innerHTML = ""; return; }
    setTimeout(async () => {
      if (mio !== turno) return;
      try {
        const qs = new URLSearchParams({ q: texto });
        if (SITIO?.id) qs.set("sitio_id", SITIO.id);
        const r = await GET(`/puntos/buscar?${qs}`);
        const puntos = Array.isArray(r) ? r : r.puntos || r.resultados || [];
        if (mio !== turno) return;
        lista.innerHTML = puntos.length
          ? puntos.slice(0, 40).map((p) => `
              <div class="punto" data-id="${esc(p.id)}" data-cod="${esc(p.codigo_visible)}">
                <span class="icono">${p.asa_tipos_punto?.icono || p.tipo_icono || "📍"}</span>
                <div class="texto">
                  <div class="codigo">${esc(p.codigo_visible)}</div>
                  <div class="detalle">${esc([p.numero_habitacion ? `Habitación ${p.numero_habitacion}` : p.nombre, p.asa_areas?.nombre || p.area_nombre].filter(Boolean).join(" · "))}</div>
                </div>
                <span class="marca">＋</span>
              </div>`).join("")
          : `<div class="vacio" style="padding:16px">Nada con "${esc(texto)}".</div>`;
        lista.querySelectorAll("[data-id]").forEach((el) =>
          el.addEventListener("click", async () => {
            if (!confirm(`¿Asignar la etiqueta ${datos.token} al punto ${el.dataset.cod}?`)) return;
            try {
              await POST(`/puntos/${el.dataset.id}/etiquetas`, { token: datos.token, origen });
              vibrar([40, 30, 80]);
              aviso(`Listo: la etiqueta ya abre ${el.dataset.cod}`, "exito");
              sessionStorage.removeItem("asa_origen_qr");
              const destino = `#/p/${encodeURIComponent(datos.token)}`;
              if (location.hash === destino) enrutar();
              else location.hash = destino;
            } catch (err) {
              aviso(err.message, "error");
            }
          })
        );
      } catch (err) {
        lista.innerHTML = `<div class="vacio" style="padding:16px">${esc(navigator.onLine ? err.message : "Sin señal: para asignar etiquetas hace falta conexión.")}</div>`;
      }
    }, 250);
  });
  q.focus();
}

function enrutar() {
  const ruta = location.hash.replace(/^#\/?/, "");

  if (!TOKEN) {
    // Un QR escaneado sin sesión abierta se recuerda para abrirlo tras entrar
    if (ruta.startsWith("p/")) sessionStorage.setItem("asa_destino", location.hash);
    return pantallaLogin();
  }

  const destino = sessionStorage.getItem("asa_destino");
  if (destino && !ruta) {
    sessionStorage.removeItem("asa_destino");
    location.hash = destino;
    return;
  }

  if (ruta.startsWith("p/")) {
    // Si se llegó tocando un punto (búsqueda, solicitud del hotel), esa
    // pantalla dejó dicho cómo; si no, es un QR escaneado.
    sessionStorage.setItem("asa_via", sessionStorage.getItem("asa_via_sig") || "qr");
    sessionStorage.removeItem("asa_via_sig");
    let token = ruta.slice(2);
    try { token = decodeURIComponent(token); } catch {}
    return pantallaPunto(token);
  }
  if (ruta === "plano") return pantallaPlano(null);
  // El chequeo vehicular no depende del hotel elegido: es del vehículo, no de
  // la planta, así que va antes de la comprobación de SITIO de más abajo.
  if (ruta === "chequeo") return pantallaChequeo();
  if (ruta.startsWith("plano/")) return pantallaPlano(ruta.slice(6));
  if (ruta === "escanear") return pantallaEscanear();
  if (ruta === "buscar") {
    sessionStorage.setItem("asa_via", "busqueda");
    return pantallaBuscar();
  }
  if (ruta === "hoteles") return elegirHotel();
  if (ruta.startsWith("solicitud/")) return pantallaSolicitud(ruta.slice(10));
  if (ruta === "cronograma") return pantallaCronograma();
  if (ruta === "incidencias") return pantallaIncidencias();
  if (ruta.startsWith("incidencia/")) return pantallaIncidencia(ruta.slice(11));
  if (!SITIO) return elegirHotel();
  return pantallaRuta();
}

window.addEventListener("hashchange", enrutar);
window.addEventListener("online", () => { pintarEstadoConexion(); sincronizar(false); });
window.addEventListener("offline", pintarEstadoConexion);
window.addEventListener("asa:sincronizado", () => {
  if (location.hash.replace(/^#\/?/, "") === "" || location.hash.includes("ruta")) enrutar();
});
navigator.serviceWorker?.addEventListener("message", (e) => {
  if (e.data?.tipo === "sincronizar") sincronizar(true);
});

async function arrancar() {
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("sw.js"); } catch {}
  }
  await actualizarContadorPendientes();
  enrutar();
  sincronizar(true);
  // Reintento periódico por si el navegador no soporta Background Sync
  setInterval(() => sincronizar(true), 60_000);
}

document.addEventListener("DOMContentLoaded", arrancar);
