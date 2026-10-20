// rastreo.js — Ubicación del técnico para el panel ("Técnicos en vivo")
//
// Mientras la app está abierta y dentro del horario de trabajo, manda la
// ubicación cada 30–60 s (lo que diga el panel) y cuando el técnico se mueve.
// Sin señal, las guarda en el teléfono y las manda juntas al volver.
//
// Es una app web: con la pantalla apagada o la app cerrada el navegador no da
// el GPS. Eso es a propósito y se le dice al técnico: se ve solo mientras
// trabaja con la app abierta.
//
// Se carga antes de app.js; app.js llama a iniciarRastreo() / detenerRastreo().

const RASTREO = {
  watch: null,
  timer: null,
  cfg: null,
  ultimoGuardado: 0,
  ultimoEnvio: 0,
  ultimo: null,
  bateria: null,
  enviando: false,
  error: null,          // último error del GPS: 1 permiso, 2 sin ubicación, 3 tiempo, "sin_gps"
  ultimoReporte: 0,
  firmaReporte: "",
};
const VERSION_APP = "t27";
const CLAVE_COLA_GPS = "asa_t_gps_cola";
const ROLES_RASTREO = ["tecnico_plagas", "operaciones", "admin"];

function colaGps() {
  try { return JSON.parse(localStorage.getItem(CLAVE_COLA_GPS) || "[]"); } catch { return []; }
}
function guardarColaGps(c) {
  try { localStorage.setItem(CLAVE_COLA_GPS, JSON.stringify(c.slice(-2000))); } catch {}
}

function gpsEnHorario(cfg, d = new Date()) {
  if (!cfg?.activo) return false;
  const h = d.toLocaleTimeString("en-GB", { timeZone: "America/Santo_Domingo", hour: "2-digit", minute: "2-digit" });
  return cfg.hasta < cfg.desde ? h >= cfg.desde || h < cfg.hasta : h >= cfg.desde && h < cfg.hasta;
}

function distanciaGps(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const x = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function pastillaGps(estado) {
  let el = document.getElementById("gps-pastilla");
  if (!estado) { el?.remove(); return; }
  if (!el) {
    el = document.createElement("div");
    el.id = "gps-pastilla";
    el.className = "gps-pastilla";
    el.title = "Tu ubicación se envía a la oficina mientras usas la app en horario de trabajo";
    document.body.appendChild(el);
  }
  el.textContent = estado === "activo" ? "📍 Ubicación activa" : estado === "fuera" ? "📍 Fuera de horario" : "📍 Activa la ubicación";
  el.dataset.estado = estado;
}

// Le dice a la oficina cómo está el GPS de este teléfono: así el panel puede
// decir "bloqueó la ubicación" en vez de "no ha abierto la app". Se manda al
// cambiar algo y cada 10 minutos.
async function reportarEstadoGps(forzar) {
  if (!TOKEN || !navigator.onLine) return;
  let permiso = null;
  try { permiso = (await navigator.permissions?.query({ name: "geolocation" }))?.state || null; } catch {}
  const estado = {
    permiso,
    error: RASTREO.error,
    gps_ok: !!RASTREO.ultimo && RASTREO.error === null,
    en_horario: RASTREO.cfg ? gpsEnHorario(RASTREO.cfg) : true,
    cola: colaGps().length,
    version: VERSION_APP,
    plataforma: navigator.userAgent,
  };
  const firma = [permiso, estado.error, estado.gps_ok, estado.en_horario].join("|");
  if (!forzar && firma === RASTREO.firmaReporte && Date.now() - RASTREO.ultimoReporte < 10 * 60000) return;
  RASTREO.firmaReporte = firma;
  RASTREO.ultimoReporte = Date.now();
  try { await POST("/rastreo/estado", estado); } catch {}
}

// La ubicación de hace menos de 5 minutos (se guarda con cada servicio)
function ubicacionActual() {
  const u = RASTREO.ultimo;
  if (!u || Date.now() - new Date(u.t) > 5 * 60000) return null;
  return { lat: u.lat, lng: u.lng };
}

async function iniciarRastreo() {
  if (!TOKEN || !USUARIO || !ROLES_RASTREO.includes(USUARIO.rol)) return;
  if (!("geolocation" in navigator)) { RASTREO.error = "sin_gps"; reportarEstadoGps(true); return; }
  if (RASTREO.watch !== null) return;

  try {
    RASTREO.cfg = await GET("/rastreo/config");
    guardarJSON("asa_t_gps_cfg", RASTREO.cfg);
  } catch {
    RASTREO.cfg = leerJSON("asa_t_gps_cfg") || { activo: true, desde: "06:00", hasta: "03:00", intervalo_seg: 45 };
  }
  if (!RASTREO.cfg.activo) { pastillaGps(null); return; }

  // Aviso una sola vez: el técnico tiene que saber que se registra
  if (!localStorage.getItem("asa_t_gps_aviso")) {
    aviso("Mientras uses la app en horario de trabajo, tu ubicación se envía a la oficina.");
    try { localStorage.setItem("asa_t_gps_aviso", "1"); } catch {}
  }

  try {
    const b = await navigator.getBattery?.();
    if (b) {
      RASTREO.bateria = b.level;
      b.addEventListener?.("levelchange", () => (RASTREO.bateria = b.level));
    }
  } catch {}

  RASTREO.watch = navigator.geolocation.watchPosition(alMoverse, errorGps, {
    enableHighAccuracy: true,
    maximumAge: 15000,
    timeout: 30000,
  });
  // Aunque el técnico no se mueva (dentro de un hotel), se manda cada intervalo
  RASTREO.timer = setInterval(() => {
    if (RASTREO.ultimo && Date.now() - RASTREO.ultimoGuardado >= RASTREO.cfg.intervalo_seg * 1000) {
      guardarPunto(RASTREO.ultimo);
    }
    enviarGps();
    reportarEstadoGps(false);
  }, Math.max(15, Number(RASTREO.cfg.intervalo_seg) || 45) * 1000);
  pastillaGps(gpsEnHorario(RASTREO.cfg) ? "activo" : "fuera");
  enviarGps();
  reportarEstadoGps(true);
}

function detenerRastreo() {
  if (RASTREO.watch !== null) navigator.geolocation.clearWatch(RASTREO.watch);
  clearInterval(RASTREO.timer);
  RASTREO.watch = null;
  RASTREO.timer = null;
  pastillaGps(null);
}

function alMoverse(pos) {
  const c = pos.coords;
  if (RASTREO.error !== null || !RASTREO.ultimo) { RASTREO.error = null; setTimeout(() => reportarEstadoGps(true), 0); }
  const p = {
    lat: c.latitude,
    lng: c.longitude,
    precision: Math.round(c.accuracy || 0),
    velocidad: c.speed ?? null,
    rumbo: c.heading ?? null,
    bateria: RASTREO.bateria,
    t: new Date(pos.timestamp || Date.now()).toISOString(),
  };
  const dentro = gpsEnHorario(RASTREO.cfg);
  pastillaGps(dentro ? "activo" : "fuera");
  if (!dentro) return;

  const intervalo = (Number(RASTREO.cfg.intervalo_seg) || 45) * 1000;
  const movido = !RASTREO.ultimo || distanciaGps(RASTREO.ultimo, p) > 40;
  RASTREO.ultimo = p;
  const espera = Date.now() - RASTREO.ultimoGuardado;
  // Cada intervalo, o antes si se movió más de 40 m (para que la ruta siga
  // las calles y no salte en línea recta), pero nunca más de uno cada 10 s.
  if (espera >= intervalo || (movido && espera >= 10000)) guardarPunto(p);
}

function guardarPunto(p) {
  if (!gpsEnHorario(RASTREO.cfg)) return;
  const cola = colaGps();
  cola.push({ ...p, t: p.t && Date.now() - new Date(p.t) < 60000 ? p.t : new Date().toISOString() });
  guardarColaGps(cola);
  RASTREO.ultimoGuardado = Date.now();
  const intervalo = (Number(RASTREO.cfg.intervalo_seg) || 45) * 1000;
  if (Date.now() - RASTREO.ultimoEnvio >= intervalo) enviarGps();
}

async function enviarGps() {
  if (RASTREO.enviando || !TOKEN || !navigator.onLine) return;
  const cola = colaGps();
  if (!cola.length) return;
  RASTREO.enviando = true;
  const lote = cola.slice(0, 300);
  try {
    await POST("/rastreo/ubicaciones", { puntos: lote });
    guardarColaGps(colaGps().slice(lote.length));
    RASTREO.ultimoEnvio = Date.now();
  } catch (e) {
    // El servidor lo rechazó (no es falta de señal): no se reintenta eso
    if (e?.status && e.status >= 400 && e.status < 500) guardarColaGps(colaGps().slice(lote.length));
  } finally {
    RASTREO.enviando = false;
  }
}

function errorGps(err) {
  if (err?.code && err.code !== RASTREO.error) {
    RASTREO.error = err.code;
    reportarEstadoGps(true);
  }
  if (err?.code === 1) {
    pastillaGps("permiso");
    aviso("Activa la ubicación del teléfono para la app (Ajustes → Ubicación).", "error");
    detenerRastreo();
    pastillaGps("permiso");
  }
}

// Al volver a la app: retomar el GPS y mandar lo pendiente
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && TOKEN) {
    if (RASTREO.watch === null) iniciarRastreo();
    else enviarGps();
  }
});
window.addEventListener("online", () => enviarGps());
