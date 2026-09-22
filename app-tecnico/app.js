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
  if (!res.ok) throw new Error(datos?.mensaje || `Error ${res.status}`);
  return datos;
}
const GET = (r) => api(r);
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
    ["🚐 Chequeo del vehículo", () => { location.hash = "#/chequeo"; }],
    ["🏨 Cambiar de hotel", () => { location.hash = ""; elegirHotel(); }],
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

  encabezado(SITIO.nombre, `Ruta del ${new Date().toLocaleDateString("es-DO", { day: "numeric", month: "long" })}`, false);
  const cuerpo = document.createElement("div");
  cuerpo.className = "contenido";
  cuerpo.innerHTML = `<div class="cargando">Cargando tu ruta…</div>`;
  app().appendChild(cuerpo);

  let avance;
  const claveCache = `ruta:${SITIO.id}:${hoy()}`;
  try {
    avance = await GET(`/inspecciones/avance/hoy?sitio_id=${SITIO.id}`);
    await guardarCache(claveCache, avance);
  } catch {
    avance = await leerCache(claveCache);
    if (!avance) {
      cuerpo.innerHTML = `<div class="vacio"><span class="emoji">📡</span>Sin señal y sin ruta guardada. Conéctate una vez para descargarla.</div>`;
      return;
    }
  }

  // Los puntos hechos offline todavía no están en el servidor: se marcan aquí
  // para que el técnico no los vuelva a hacer.
  const cola = await BD.todos("cola").catch(() => []);
  const hechosLocal = new Set(cola.map((c) => c.punto_id));

  const realizados = avance.realizados.filter((p) => !hechosLocal.has(p.punto_id));
  const pendientes = [];
  for (const p of avance.pendientes) {
    if (hechosLocal.has(p.punto_id)) realizados.push({ ...p, _local: true });
    else pendientes.push(p);
  }

  const total = realizados.length + pendientes.length;
  const pct = total ? Math.round((realizados.length / total) * 100) : 0;

  cuerpo.innerHTML = `
    <div class="avance">
      <div class="hechos"><div class="numero">${realizados.length}</div><div class="rotulo">Realizados</div></div>
      <div class="faltan"><div class="numero">${pendientes.length}</div><div class="rotulo">Faltan</div></div>
    </div>
    <div class="progreso"><span style="width:${pct}%"></span></div>

    <button class="btn grande" id="btn-escanear">📷 Escanear punto</button>
    <button class="btn secundario" id="btn-buscar">🔍 Buscar por nombre o habitación</button>

    <div id="listas" style="margin-top:8px"></div>`;

  if (!cuerpo.isConnected) return; // el técnico ya navegó a otra pantalla

  $("#btn-escanear", cuerpo)?.addEventListener("click", () => (location.hash = "#/escanear"));
  $("#btn-buscar", cuerpo)?.addEventListener("click", () => (location.hash = "#/buscar"));

  const listas = $("#listas", cuerpo);
  listas.innerHTML = `
    ${seccion("Faltan por hacer", pendientes, false)}
    ${seccion("Ya realizados", realizados, true)}`;

  listas.querySelectorAll("[data-token]").forEach((el) =>
    el.addEventListener("click", () => (location.hash = `#/p/${el.dataset.token}`))
  );
}

function seccion(titulo, puntos, hechos) {
  if (!puntos.length) {
    return `<div class="grupo-area">${titulo}</div>
      <div class="vacio" style="padding:24px">${hechos ? "Todavía nada." : "¡Todo al día!"}</div>`;
  }

  // Agrupadas por área: el técnico recorre el hotel área por área, no en el
  // orden en que la base de datos devuelva las filas.
  const porArea = {};
  for (const p of puntos) (porArea[p.area_nombre || "Sin área"] ||= []).push(p);

  return (
    `<div class="grupo-area">${titulo} · ${puntos.length}</div>` +
    Object.entries(porArea)
      .sort()
      .map(
        ([area, lista]) => `
        <div class="grupo-area" style="margin-top:14px;color:var(--gris-400)">${esc(area)}</div>
        ${lista.map((p) => filaPunto(p, hechos)).join("")}`
      )
      .join("")
  );
}

function filaPunto(p, hecho) {
  const nombre = p.numero_habitacion ? `Habitación ${p.numero_habitacion}` : p.punto_nombre || p.tipo_nombre || "";
  const clases = ["punto", hecho ? "hecho" : "", !hecho && p.vencido ? "vencido" : ""].filter(Boolean).join(" ");
  const marca = hecho ? (p._local ? "⏳" : "✅") : p.vencido ? "⚠️" : "›";
  return `
    <div class="${clases}" data-token="${esc(p.qr_token)}">
      <span class="icono">${p.tipo_icono || "📍"}</span>
      <div class="texto">
        <div class="codigo">${esc(p.codigo_visible)}</div>
        <div class="detalle">${esc(nombre)}</div>
      </div>
      <span class="marca">${marca}</span>
    </div>`;
}

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
        <button class="btn secundario" id="a-buscar" style="margin-top:8px">🔍 El código no se lee — buscar por nombre</button>
      </div>
    </div>`;

  $("#cerrar").addEventListener("click", () => (location.hash = "#/ruta"));
  $("#a-buscar").addEventListener("click", () => (location.hash = "#/buscar"));

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
    location.hash = `#/p/${token}`;
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
  return null;
}

function cargarJsQR() {
  if (window.jsQR) return Promise.resolve();
  return new Promise((ok) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.js";
    s.onload = ok;
    s.onerror = ok; // sin lector: queda la búsqueda por nombre
    document.head.appendChild(s);
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Búsqueda por nombre (respaldo cuando el QR está dañado)
// ─────────────────────────────────────────────────────────────────────────
function pantallaBuscar() {
  encabezado("Buscar punto", SITIO?.nombre);
  const cuerpo = document.createElement("div");
  cuerpo.className = "contenido";
  cuerpo.innerHTML = `
    <div class="campo">
      <input type="search" id="q" placeholder="Área, tipo, código o habitación" autocomplete="off" autofocus />
      <small class="ayuda">
        Busca como hablas: escribe <strong>cocina</strong> y salen los puntos de las
        cocinas, <strong>aerosol</strong> y salen los dispensadores, <strong>4312</strong>
        y sale esa habitación.
      </small>
    </div>
    <div id="resultados"></div>`;
  app().appendChild(cuerpo);

  let temporizador;
  $("#q").addEventListener("input", (e) => {
    clearTimeout(temporizador);
    const termino = e.target.value.trim();
    // Desde UNA letra: el servidor devuelve los que EMPIEZAN con ella, así que
    // no hay riesgo de que una sola letra traiga medio hotel.
    if (!termino) return ($("#resultados").innerHTML = "");
    temporizador = setTimeout(() => buscar(termino), termino.length === 1 ? 420 : 260);
  });

  async function buscar(termino) {
    const caja = $("#resultados");
    caja.innerHTML = `<div class="cargando">Buscando…</div>`;
    let lista = [];
    try {
      lista = await GET(`/puntos/buscar?q=${encodeURIComponent(termino)}&sitio_id=${SITIO?.id || ""}`);
    } catch {
      lista = await buscarEnCache(termino);
    }

    if (!lista.length) {
      caja.innerHTML = `<div class="vacio"><span class="emoji">🔍</span>
        Nada con "${esc(termino)}".<br><small>Prueba con el área ("cocina", "lobby"),
        con el tipo ("cebadero", "lámpara") o con el número de la habitación.</small></div>`;
      return;
    }

    // Agrupado por área: cuando la búsqueda devuelve 40 cebaderos, verlos en un
    // chorro plano no dice nada; por área sí se sabe dónde hay que caminar.
    const porArea = {};
    for (const p of lista) {
      const area = p.asa_areas?.nombre || "Sin área";
      (porArea[area] = porArea[area] || []).push(p);
    }

    caja.innerHTML = `
      <p class="resumen-busqueda">
        ${lista.length} punto${lista.length === 1 ? "" : "s"}
        en ${Object.keys(porArea).length} área${Object.keys(porArea).length === 1 ? "" : "s"}
      </p>
      ${Object.entries(porArea).map(([area, puntos]) => `
        <div class="grupo-area">${esc(area)} · ${puntos.length}</div>
        ${puntos.map((p) => `
          <div class="punto" data-token="${esc(p.qr_token)}">
            <span class="icono">${p.asa_tipos_punto?.icono || "📍"}</span>
            <div class="texto">
              <div class="codigo">${esc(p.numero_habitacion ? `Hab. ${p.numero_habitacion}` : p.codigo_visible)}</div>
              <div class="detalle">${esc([
                p.numero_habitacion ? p.codigo_visible : p.nombre,
                p.asa_tipos_punto?.nombre,
                p.ubicacion_descripcion,
              ].filter(Boolean).join(" · "))}</div>
            </div>
            <span class="marca">›</span>
          </div>`).join("")}
      `).join("")}`;

    caja.querySelectorAll("[data-token]").forEach((el) =>
      el.addEventListener("click", () => (location.hash = `#/p/${el.dataset.token}`))
    );
  }

  // Sin señal se busca dentro de la ruta guardada en el teléfono, con las
  // mismas reglas: área, tipo, código, habitación y ubicación.
  async function buscarEnCache(termino) {
    const ruta = await leerCache(`ruta:${SITIO?.id}:${hoy()}`);
    const todos = [...(ruta?.realizados || []), ...(ruta?.pendientes || [])];
    const t = termino.toLowerCase();
    const coincide = (v) => String(v || "").toLowerCase()[termino.length === 1 ? "startsWith" : "includes"](t);

    return todos
      .filter((p) => [p.codigo_visible, p.punto_nombre, p.numero_habitacion, p.area_nombre, p.tipo_nombre, p.ubicacion_descripcion].some(coincide))
      .map((p) => ({
        qr_token: p.qr_token,
        codigo_visible: p.codigo_visible,
        nombre: p.punto_nombre,
        numero_habitacion: p.numero_habitacion,
        ubicacion_descripcion: p.ubicacion_descripcion,
        asa_areas: { nombre: p.area_nombre },
        asa_tipos_punto: { nombre: p.tipo_nombre, icono: p.tipo_icono },
      }));
  }
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
    punto = await GET(`/puntos/qr/${encodeURIComponent(token)}`);
    await guardarCache(`punto:${token}`, punto);
  } catch (e) {
    punto = await leerCache(`punto:${token}`);
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
  const [plagas, estados] = await Promise.all([catalogoPlagas(), catalogoEstados()]);
  pintarFormulario($("#form-inspeccion"), punto, plagas, estados);
}

function pintarFormulario(form, punto, plagas = [], estados = ESTADOS_RESPALDO) {
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
      <small class="ayuda">Deja en cero lo que no encontraste. Solo se guarda lo que pasó de cero.</small>
    </div>` : ""}

    ${preguntas.length ? `<div class="grupo-area">Checklist${punto.estrategia_id ? "" : ""}</div>` : ""}
    ${preguntas.map(campoPregunta).join("")}

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
  const sincronizarCaras = () => {
    const noEntro = !!estadoDe(grupoEstado.dataset.valor)?.requiere_motivo;
    form.querySelector("#caja-motivo").style.display = noEntro ? "" : "none";
    form.querySelector("#caja-actividad").style.display = noEntro ? "none" : "";
    const cajaPlagas = form.querySelector("#caja-plagas");
    if (cajaPlagas) cajaPlagas.style.display = noEntro ? "none" : "";
  };
  grupoEstado.addEventListener("click", () => setTimeout(sincronizarCaras, 0));
  sincronizarCaras();

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
      fotos.push(await reducirImagen(archivo));
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
        await POST("/inspecciones", inspeccion);
        aviso(noEntro ? "Reportado como no realizado ✓" : "Inspección registrada ✓", "exito");
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
    location.hash = "#/ruta";
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
function reducirImagen(archivo, maxLado = 1280, calidad = 0.7) {
  return new Promise((ok) => {
    const lector = new FileReader();
    lector.onload = () => {
      const img = new Image();
      img.onload = () => {
        const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
        const lienzo = document.createElement("canvas");
        lienzo.width = Math.round(img.width * escala);
        lienzo.height = Math.round(img.height * escala);
        lienzo.getContext("2d").drawImage(img, 0, 0, lienzo.width, lienzo.height);
        ok(lienzo.toDataURL("image/jpeg", calidad));
      };
      img.onerror = () => ok(lector.result);
      img.src = lector.result;
    };
    lector.readAsDataURL(archivo);
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Plano: dónde queda el punto que el técnico no conoce
// ─────────────────────────────────────────────────────────────────────────
// La pantalla del mapa vive en mapa.js: renderiza PDF con zoom y ubica al
// tecnico con el GPS encima del plano.

// ─────────────────────────────────────────────────────────────────────────
// Enrutador
// ─────────────────────────────────────────────────────────────────────────
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
    sessionStorage.setItem("asa_via", "qr");
    return pantallaPunto(ruta.slice(2));
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
