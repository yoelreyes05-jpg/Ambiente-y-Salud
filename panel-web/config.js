// config.js — Ambiente y Salud RD (ASA SRL) — Panel administrativo
// Mismo patrón que solido-web/index.html: un objeto CONFIG editado a mano
// por entorno (sin build step, sin variables de entorno de Node/Next).
//
// Local:      abre este panel sirviéndolo en localhost (o file://) mientras
//             el backend corre en `cd backend && npm run dev` -> localhost:4000.
// Producción: cuando publiques el backend en Railway, reemplaza la URL de
//             abajo (rama "else") por la URL pública que te dé Railway,
//             ej. "https://asa-backend-production.up.railway.app".
const ES_LOCAL =
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1" ||
  location.protocol === "file:" || // panel abierto como archivo local (doble clic)
  location.hostname === ""; // algunos navegadores dejan el hostname vacío en file://

const CONFIG = {
  API_BASE: ES_LOCAL
    ? "http://localhost:4000"
    : "https://REEMPLAZA-CON-TU-URL-DE-RAILWAY.up.railway.app",
  NOMBRE_SISTEMA: "Ambiente y Salud RD",
  SIGLAS: "ASA SRL",
};
