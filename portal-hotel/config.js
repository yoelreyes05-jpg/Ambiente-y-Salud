// config.js — Portal del hotel (ASA)
//
// Mismo patrón que panel-web y app-tecnico: se edita a mano por entorno, sin
// build step. Apunta a la MISMA API de Railway que usan el panel y la app del
// técnico; lo que cambia es qué puede ver y hacer la cuenta que entra.
const ES_LOCAL =
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1" ||
  location.hostname.startsWith("192.168.") ||
  location.protocol === "file:";

const CONFIG = {
  API_BASE: ES_LOCAL
    ? "http://localhost:4000"
    : "https://ambiente-y-salud-production.up.railway.app",
  EMPRESA: "Ambiente y Salud RD",
  SIGLAS: "ASA SRL",
};
