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
        <div style="font-size:60px;line-height:1">🌿</div>
        <h1 style="margin:10px 0 2px;font-size:24px">${esc(CONFIG.NOMBRE)}</h1>
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
      <input type="search" id="q" placeholder="Código, nombre o número de habitación" autocomplete="off" autofocus />
    </div>
    <div id="resultados"></div>`;
  app().appendChild(cuerpo);

  let temporizador;
  $("#q").addEventListener("input", (e) => {
    clearTimeout(temporizador);
    const termino = e.target.value.trim();
    if (termino.length < 2) return ($("#resultados").innerHTML = "");
    temporizador = setTimeout(() => buscar(termino), 280);
  });

  async function buscar(termino) {
    const caja = $("#resultados");
    caja.innerHTML = `<div class="cargando">Buscando…</div>`;
    let lista = [];
    try {
      lista = await GET(`/puntos/buscar?q=${encodeURIComponent(termino)}&sitio_id=${SITIO?.id || ""}`);
    } catch {
      // Sin señal: se busca dentro de la ruta guardada en el teléfono
      const ruta = await leerCache(`ruta:${SITIO?.id}:${hoy()}`);
      const todos = [...(ruta?.realizados || []), ...(ruta?.pendientes || [])];
      const t = termino.toLowerCase();
      lista = todos
        .filter((p) =>
          [p.codigo_visible, p.punto_nombre, p.numero_habitacion].some((v) => String(v || "").toLowerCase().includes(t))
        )
        .map((p) => ({
          qr_token: p.qr_token,
          codigo_visible: p.codigo_visible,
          nombre: p.punto_nombre,
          numero_habitacion: p.numero_habitacion,
          asa_areas: { nombre: p.area_nombre },
          asa_tipos_punto: { nombre: p.tipo_nombre, icono: p.tipo_icono },
        }));
    }

    if (!lista.length) {
      caja.innerHTML = `<div class="vacio"><span class="emoji">🔍</span>Nada con "${esc(termino)}".</div>`;
      return;
    }

    caja.innerHTML = lista
      .map(
        (p) => `
        <div class="punto" data-token="${esc(p.qr_token)}">
          <span class="icono">${p.asa_tipos_punto?.icono || "📍"}</span>
          <div class="texto">
            <div class="codigo">${esc(p.codigo_visible)}</div>
            <div class="detalle">${esc([p.numero_habitacion ? `Hab. ${p.numero_habitacion}` : p.nombre, p.asa_areas?.nombre].filter(Boolean).join(" · "))}</div>
          </div>
          <span class="marca">›</span>
        </div>`
      )
      .join("");

    caja.querySelectorAll("[data-token]").forEach((el) =>
      el.addEventListener("click", () => (location.hash = `#/p/${el.dataset.token}`))
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Ficha del punto + checklist
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
  pintarFormulario($("#form-inspeccion"), punto);
}

function pintarFormulario(form, punto) {
  const preguntas = punto.preguntas || [];

  form.innerHTML = `
    <div class="grupo-area">Estado del punto</div>
    <div class="campo">
      ${botonera("estado_punto", [
        ["ok", "Todo bien"],
        ["actividad", "Con actividad"],
        ["dañado", "Dañado"],
        ["faltante", "No está"],
        ["no_accesible", "No pude entrar"],
        ["reemplazado", "Lo reemplacé"],
      ], "ok", "dos")}
    </div>

    <div class="campo">
      <label>Nivel de actividad</label>
      ${botonera("nivel_actividad", [
        ["ninguna", "Ninguna"],
        ["bajo", "Baja"],
        ["medio", "Media"],
        ["alto", "Alta"],
      ], "ninguna", "dos")}
    </div>

    ${preguntas.length ? `<div class="grupo-area">Checklist${punto.estrategia_id ? "" : ""}</div>` : ""}
    ${preguntas.map(campoPregunta).join("")}

    <div class="grupo-area">Cierre</div>
    <div class="campo">
      <label for="fotos">Fotos</label>
      <input type="file" id="fotos" accept="image/*" capture="environment" multiple />
      <div id="vista-fotos" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"></div>
    </div>
    <div class="campo">
      <label for="notas">Observaciones</label>
      <textarea id="notas" placeholder="Lo que el hotel deba saber"></textarea>
    </div>

    <div class="pie-fijo">
      <button class="btn" type="submit" id="guardar">✓ Guardar inspección</button>
    </div>`;

  // Botoneras
  form.querySelectorAll("[data-grupo]").forEach((grupo) => {
    grupo.addEventListener("click", (e) => {
      const op = e.target.closest(".opcion");
      if (!op) return;
      grupo.querySelectorAll(".opcion").forEach((o) => o.classList.remove("activa", "no"));
      op.classList.add("activa");
      if (["false", "no", "dañado", "faltante"].includes(op.dataset.valor)) op.classList.add("no");
      grupo.dataset.valor = op.dataset.valor;
      vibrar(15);
    });
  });

  // Fotos: se guardan como data URL para que sobrevivan sin señal en la cola
  const fotos = [];
  form.querySelector("#fotos").addEventListener("change", async (e) => {
    for (const archivo of e.target.files) {
      const dataUrl = await reducirImagen(archivo);
      fotos.push(dataUrl);
      const img = document.createElement("img");
      img.src = dataUrl;
      img.style.cssText = "width:72px;height:72px;object-fit:cover;border-radius:10px";
      form.querySelector("#vista-fotos").appendChild(img);
    }
    e.target.value = "";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const boton = form.querySelector("#guardar");

    const respuestas = [];
    let falta = null;
    for (const p of preguntas) {
      const valor = leerRespuesta(form, p);
      if (p.obligatoria && (valor === null || valor === "")) {
        falta ||= p.texto;
        continue;
      }
      if (valor === null || valor === "") continue;
      respuestas.push({
        pregunta_id: p.id,
        pregunta_texto: p.texto,
        ...(p.tipo_respuesta === "si_no"
          ? { valor_bool: valor === "true" }
          : p.tipo_respuesta === "numero"
            ? { valor_numero: Number(valor) }
            : { valor_texto: String(valor) }),
      });
    }
    if (falta) return aviso(`Falta responder: ${falta}`, "error");

    const inspeccion = {
      punto_id: punto.id,
      estado_punto: form.querySelector('[data-grupo="estado_punto"]').dataset.valor || "ok",
      nivel_actividad: form.querySelector('[data-grupo="nivel_actividad"]').dataset.valor || "ninguna",
      notas: form.querySelector("#notas").value.trim() || null,
      fotos,
      metodo_acceso: sessionStorage.getItem("asa_via") || "qr",
      respuestas,
    };

    boton.disabled = true;
    boton.textContent = "Guardando…";

    try {
      if (navigator.onLine) {
        await POST("/inspecciones", inspeccion);
        aviso("Inspección registrada ✓", "exito");
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

function botonera(nombre, opciones, porDefecto, clase = "") {
  return `<div class="opciones ${clase}" data-grupo="${nombre}" data-valor="${porDefecto ?? ""}">
    ${opciones
      .map(
        ([valor, texto]) =>
          `<div class="opcion ${valor === porDefecto ? "activa" : ""}" data-valor="${esc(valor)}">${esc(texto)}</div>`
      )
      .join("")}
  </div>`;
}

function campoPregunta(p) {
  const etiqueta = `<label>${esc(p.texto)}${p.obligatoria ? ' <span class="obligatorio">*</span>' : ""}</label>`;
  const id = `p_${p.id}`;

  if (p.tipo_respuesta === "si_no") {
    return `<div class="campo">${etiqueta}${botonera(id, [["true", "Sí"], ["false", "No"]], null, "dos")}</div>`;
  }
  if (p.tipo_respuesta === "seleccion" || p.tipo_respuesta === "multiple") {
    const ops = (p.opciones || []).map((o) => [String(o), String(o)]);
    return `<div class="campo">${etiqueta}${botonera(id, ops, null, ops.length > 3 ? "dos" : "")}</div>`;
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
async function pantallaPlano(puntoId) {
  encabezado("Ubicación", SITIO?.nombre);
  const cuerpo = document.createElement("div");
  cuerpo.className = "contenido";
  cuerpo.innerHTML = `<div class="cargando">Cargando plano…</div>`;
  app().appendChild(cuerpo);

  let planos;
  try {
    planos = await GET(`/sitios/${SITIO.id}/planos`);
    await guardarCache(`planos:${SITIO.id}`, planos);
  } catch {
    planos = (await leerCache(`planos:${SITIO.id}`)) || [];
  }

  const plano = planos.find((pl) => pl.puntos?.some((p) => p.id === puntoId)) || planos[0];
  if (!plano) {
    cuerpo.innerHTML = `<div class="vacio"><span class="emoji">🗺️</span>Este hotel todavía no tiene planos cargados.</div>`;
    return;
  }

  cuerpo.innerHTML = `
    <div class="tarjeta">
      <h2>${esc(plano.nombre)}</h2>
      <p>Toca un pin para abrir ese punto.</p>
    </div>
    <div class="plano" id="plano">
      <img src="${esc(plano.imagen_url)}" alt="${esc(plano.nombre)}" />
      ${(plano.puntos || [])
        .filter((p) => p.plano_x != null && p.plano_y != null)
        .map(
          (p) => `
          <div class="pin ${p.id === puntoId ? "destacado" : ""}"
               style="left:${p.plano_x}%;top:${p.plano_y}%;background:${esc(p.asa_tipos_punto?.color || "#475569")}"
               data-token="${esc(p.qr_token)}" title="${esc(p.codigo_visible)}">
            ${p.asa_tipos_punto?.icono || ""}
          </div>`
        )
        .join("")}
    </div>`;

  cuerpo.querySelectorAll(".pin").forEach((pin) =>
    pin.addEventListener("click", () => (location.hash = `#/p/${pin.dataset.token}`))
  );
}

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
