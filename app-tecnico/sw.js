// sw.js — Service worker de la app del técnico
//
// Hace dos cosas, ninguna complicada:
//
// 1. Guarda el "caparazón" de la app (HTML, CSS, JS, el lector de QR) para que
//    abra sin señal. Los sótanos, cuartos de máquinas y áreas verdes de un
//    hotel no tienen cobertura, y la app tiene que abrir igual.
//
// 2. Deja pasar TODAS las llamadas a la API sin tocarlas. Los datos los maneja
//    app.js con IndexedDB, que sabe qué es una ruta del día y qué es una
//    inspección pendiente de enviar; un caché genérico aquí solo serviría para
//    mostrarle al técnico datos viejos sin avisarle.

const VERSION = "asa-tecnico-v4";
const CAPARAZON = [
  "./",
  "./index.html",
  "./estilos.css",
  "./app.js",
  "./mapa.js",
  "./chequeo.js",
  "./config.js",
  "./manifest.json",
  "./logo-asa.png",
  "https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.js",
  // Visor de PDF para los mapas. Se guarda con el caparazón porque el plano se
  // consulta justo donde no hay señal: sótanos, cuartos de máquinas, áreas
  // verdes. Sin esto, el mapa solo abriría con cobertura.
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then(async (cache) => {
      // addAll falla entero si un solo archivo falla (el CDN, por ejemplo),
      // así que se guardan uno por uno y los que fallen se reintentan luego.
      await Promise.all(
        CAPARAZON.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {
            console.warn("[sw] no se pudo guardar:", url);
          })
        )
      );
      self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((claves) =>
      Promise.all(claves.filter((c) => c !== VERSION).map((c) => caches.delete(c)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const esAPI = url.pathname.startsWith("/puntos") || url.pathname.startsWith("/inspecciones") ||
                url.pathname.startsWith("/sitios") || url.pathname.startsWith("/usuarios") ||
                url.pathname.startsWith("/hallazgos") || url.pathname.startsWith("/flota") ||
                url.pathname.startsWith("/plagas");
  if (esAPI) return; // la API va directo a la red; de lo offline se encarga app.js

  // Red primero para el caparazón: si hay señal, el técnico tiene la versión
  // nueva sin tener que reinstalar nada; si no, se sirve lo guardado.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copia = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copia));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((guardada) => guardada || caches.match("./index.html"))
      )
  );
});

// El técnico recupera señal → se avisa a la app para que vacíe su cola.
self.addEventListener("sync", (e) => {
  if (e.tag === "sincronizar-inspecciones") {
    e.waitUntil(
      self.clients.matchAll().then((clientes) => {
        for (const c of clientes) c.postMessage({ tipo: "sincronizar" });
      })
    );
  }
});
