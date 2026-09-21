// config.js — App del técnico (ASA)
//
// Igual que panel-web/config.js: se edita a mano por entorno, sin build step.
// Cuando publiques el backend en Railway, reemplaza la URL de producción por
// la que te dé Railway.
const ES_LOCAL =
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1" ||
  location.hostname.startsWith("192.168.") ||
  location.protocol === "file:";

const CONFIG = {
  API_BASE: ES_LOCAL
    ? "http://localhost:4000"
    : "https://ambiente-y-salud-production.up.railway.app",
  NOMBRE: "ASA Técnico",
  EMPRESA: "Ambiente y Salud RD",

  // Cuántos días de la ruta se guardan en el teléfono para trabajar sin señal.
  DIAS_CACHE: 2,
};
