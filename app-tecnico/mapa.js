// ═════════════════════════════════════════════════════════════════════════
// mapa.js — El mapa de la planta en la app del técnico
//
// Qué hace, y por qué está hecho así:
//
// · **Abre PDF, no solo imágenes.** El mapa se dibuja en QGIS con todos los
//   puntos marcados y se exporta a PDF. Convertirlo a PNG para poder mostrarlo
//   era perder justo lo que hace falta: al agrandarlo en el celular se pixela y
//   los códigos de los puntos no se leen. El PDF se agranda sin perder nada.
//
// · **El GPS se pinta encima del mapa.** Con el recuadro de coordenadas del
//   plano (los cuatro valores que trae el GeoPDF de QGIS, o los que se
//   escriben a mano en el panel), una posición del GPS se convierte en un
//   porcentaje del ancho y del alto. El técnico se ve como un punto azul y
//   sabe si está cerca o lejos de lo que busca, sin salir de la app.
//
// · **Se puede descargar.** Un toque y el PDF queda en el teléfono, para
//   abrirlo en cualquier visor.
//
// · **Funciona sin señal.** El archivo se guarda en el teléfono la primera vez
//   que se abre. En un sótano no hay cobertura y es justo donde hace falta el
//   plano.
// ═════════════════════════════════════════════════════════════════════════

const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";

// Resolución a la que se rasteriza el PDF. 2200 px de ancho es el punto medio
// entre que se lea al agrandar y que no se coma la memoria de un teléfono de
// gama baja: a 3000 px, un Android de 2GB mata la pestaña a media carga.
const ANCHO_RENDER = 2200;

let pdfjsListo = null;
function cargarPdfJs() {
  if (pdfjsListo) return pdfjsListo;
  pdfjsListo = new Promise((ok, mal) => {
    const s = document.createElement("script");
    s.src = `${PDFJS_CDN}/pdf.min.js`;
    s.onload = () => {
      const lib = window.pdfjsLib;
      if (!lib) return mal(new Error("No se pudo cargar el visor de PDF"));
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
      ok(lib);
    };
    s.onerror = () => mal(new Error("Sin conexión para cargar el visor de PDF"));
    document.head.appendChild(s);
  });
  return pdfjsListo;
}

// El archivo del plano, cacheado en el teléfono. Se guarda el ArrayBuffer y no
// la URL: una URL cacheada no sirve de nada en un sótano sin señal.
async function archivoPlano(plano) {
  const clave = `plano-archivo:${plano.id}`;
  const guardado = await leerCache(clave);
  if (guardado?.bytes) return guardado.bytes;

  const res = await fetch(plano.imagen_url, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo descargar el plano (${res.status})`);
  const bytes = await res.arrayBuffer();
  guardarCache(clave, { bytes, tipo: plano.tipo_mime || "application/pdf" });
  return bytes;
}

// ── Pantalla ─────────────────────────────────────────────────────────────
async function pantallaPlano(puntoId) {
  encabezado("Ubicación", SITIO?.nombre);
  const cuerpo = document.createElement("div");
  cuerpo.className = "contenido contenido-mapa";
  cuerpo.innerHTML = `<div class="cargando">Cargando plano…</div>`;
  app().appendChild(cuerpo);

  let planos;
  try {
    planos = await GET(`/sitios/${SITIO.id}/planos`);
    await guardarCache(`planos:${SITIO.id}`, planos);
  } catch {
    planos = (await leerCache(`planos:${SITIO.id}`)) || [];
  }

  let plano = puntoId
    ? planos.find((pl) => pl.puntos?.some((p) => p.id === puntoId)) || planos[0]
    : planos[0];
  if (!plano) {
    cuerpo.innerHTML = `<div class="vacio"><span class="emoji">🗺️</span>Este hotel todavía no tiene planos cargados.</div>`;
    return;
  }

  cuerpo.innerHTML = `
    <div class="mapa-barra">
      ${planos.length > 1
        ? `<select id="sel-plano" class="sel-plano">
             ${planos.map((pl) => `<option value="${pl.id}"${pl.id === plano.id ? " selected" : ""}>${esc(pl.nombre)}</option>`).join("")}
           </select>`
        : `<div class="mapa-nombre">${esc(plano.nombre)}</div>`}
      <div class="mapa-botones">
        <button id="mapa-gps" class="mapa-btn" title="Ubicarme">📍</button>
        <button id="mapa-menos" class="mapa-btn">−</button>
        <button id="mapa-mas" class="mapa-btn">+</button>
        <button id="mapa-ajustar" class="mapa-btn">⤢</button>
        <button id="mapa-bajar" class="mapa-btn" title="Descargar">⬇</button>
      </div>
    </div>
    <div class="mapa-estado" id="mapa-estado"></div>
    <div class="mapa-visor" id="mapa-visor">
      <div class="mapa-lienzo" id="mapa-lienzo"></div>
    </div>`;

  let vista = null;

  async function abrir(pl) {
    vista?.detener();
    vista = await montarPlano($("#mapa-lienzo"), pl, puntoId);
    engancharControles(pl);
  }

  function engancharControles(pl) {
    $("#mapa-mas").onclick = () => vista.zoom(1.35);
    $("#mapa-menos").onclick = () => vista.zoom(1 / 1.35);
    $("#mapa-ajustar").onclick = () => vista.ajustar();
    $("#mapa-gps").onclick = () => vista.alternarGps();
    $("#mapa-bajar").onclick = () => descargarPlano(pl);
  }

  $("#sel-plano")?.addEventListener("change", (e) => {
    plano = planos.find((pl) => pl.id === e.target.value) || plano;
    abrir(plano);
  });

  await abrir(plano);
}

// ── Montaje del plano ────────────────────────────────────────────────────
async function montarPlano(lienzo, plano, puntoId) {
  const estado = $("#mapa-estado");
  lienzo.innerHTML = `<div class="cargando">Preparando el mapa…</div>`;

  const esPdf = plano.tipo_archivo === "pdf" || /\.pdf($|\?)/i.test(plano.imagen_url || "");
  let medio;

  try {
    medio = esPdf ? await pintarPdf(plano) : pintarImagen(plano);
  } catch (e) {
    lienzo.innerHTML = `<div class="vacio"><span class="emoji">⚠️</span>${esc(e.message)}
      <button class="btn secundario" id="mapa-abrir-fuera" style="margin-top:14px">Abrir el archivo aparte</button></div>`;
    $("#mapa-abrir-fuera")?.addEventListener("click", () => window.open(plano.imagen_url, "_blank"));
    return { detener() {}, zoom() {}, ajustar() {}, alternarGps() {} };
  }

  const capa = document.createElement("div");
  capa.className = "mapa-capa";
  capa.appendChild(medio.nodo);

  // Pines de los puntos que tengan posición guardada en el panel. En un mapa de
  // QGIS los puntos ya vienen dibujados dentro del PDF; estos se suman solo si
  // alguien los colocó también desde el panel, y sirven para poder tocarlos.
  const pines = (plano.puntos || []).filter((p) => p.plano_x != null && p.plano_y != null);
  for (const p of pines) {
    const pin = document.createElement("div");
    pin.className = `pin${p.id === puntoId ? " destacado" : ""}`;
    pin.style.cssText = `left:${p.plano_x}%;top:${p.plano_y}%;background:${p.asa_tipos_punto?.color || "#475569"}`;
    pin.title = p.codigo_visible;
    pin.textContent = p.asa_tipos_punto?.icono || "";
    pin.addEventListener("click", (ev) => {
      ev.stopPropagation();
      location.hash = `#/p/${p.qr_token}`;
    });
    capa.appendChild(pin);
  }

  const yo = document.createElement("div");
  yo.className = "mapa-yo";
  yo.style.display = "none";
  yo.innerHTML = `<span class="mapa-yo-halo"></span><span class="mapa-yo-punto"></span>`;
  capa.appendChild(yo);

  lienzo.innerHTML = "";
  lienzo.appendChild(capa);

  const control = controlDeVista(lienzo, capa, medio.ancho, medio.alto);
  const gps = seguirGps(plano, yo, estado, control);

  const tieneGeo = plano.geo_norte != null && plano.geo_sur != null;
  estado.innerHTML = tieneGeo
    ? `<span class="pista">Toca 📍 para ubicarte en el mapa. Pellizca para agrandar.</span>`
    : `<span class="pista aviso">Este plano no tiene coordenadas, así que el GPS no puede ubicarte encima.
        ${esc(plano.nombre)} se ve igual, pero para la ubicación en vivo hay que cargarle el recuadro desde el panel.</span>`;

  return {
    detener() { gps.detener(); control.detener(); },
    zoom: control.zoom,
    ajustar: control.ajustar,
    alternarGps: gps.alternar,
  };
}

function pintarImagen(plano) {
  const img = document.createElement("img");
  img.src = plano.imagen_url;
  img.alt = plano.nombre;
  img.className = "mapa-medio";
  return { nodo: img, ancho: plano.ancho_px || 1600, alto: plano.alto_px || 1100 };
}

async function pintarPdf(plano) {
  const lib = await cargarPdfJs();
  const bytes = await archivoPlano(plano);
  // pdf.js se queda con el ArrayBuffer que recibe (lo deja "detached"), y el
  // mismo buffer sale del caché la próxima vez. Se le pasa una copia.
  const doc = await lib.getDocument({ data: bytes.slice(0) }).promise;
  const pagina = await doc.getPage(1);

  const base = pagina.getViewport({ scale: 1 });
  const escala = Math.min(ANCHO_RENDER / base.width, 4);
  const vista = pagina.getViewport({ scale: escala });

  const canvas = document.createElement("canvas");
  canvas.className = "mapa-medio";
  canvas.width = Math.round(vista.width);
  canvas.height = Math.round(vista.height);
  await pagina.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport: vista }).promise;

  return { nodo: canvas, ancho: canvas.width, alto: canvas.height };
}

// ═════════════════════════════════════════════════════════════════════════
// Zoom y desplazamiento
//
// Hecho con transform sobre una capa, y no con el zoom del navegador ni con
// una librería de mapas: el plano es una sola imagen, los pines tienen que
// moverse pegados a ella, y una librería de mapas de verdad (Leaflet y
// compañía) obligaría a cortar el plano en teselas en el servidor.
//
// Se toca con una mano y con guantes: pellizco para agrandar, arrastre para
// mover, doble toque para acercar de un golpe.
// ═════════════════════════════════════════════════════════════════════════
function controlDeVista(visor, capa, anchoNatural, altoNatural) {
  let escala = 1, x = 0, y = 0;
  let minEscala = 1;

  const aplicar = () => {
    capa.style.transform = `translate(${x}px, ${y}px) scale(${escala})`;
  };

  function ajustar() {
    const caja = visor.getBoundingClientRect();
    minEscala = Math.min(caja.width / anchoNatural, caja.height / altoNatural);
    escala = minEscala;
    x = (caja.width - anchoNatural * escala) / 2;
    y = (caja.height - altoNatural * escala) / 2;
    aplicar();
  }

  // Los pines y el punto del GPS se posicionan en % de la capa, así que la capa
  // tiene que medir lo que mide el plano.
  capa.style.width = `${anchoNatural}px`;
  capa.style.height = `${altoNatural}px`;
  requestAnimationFrame(ajustar);

  function zoomEn(factor, cx, cy) {
    const caja = visor.getBoundingClientRect();
    const px = (cx ?? caja.width / 2) - caja.left;
    const py = (cy ?? caja.height / 2) - caja.top;
    const nueva = Math.max(minEscala * 0.9, Math.min(escala * factor, minEscala * 14));
    // Se agranda alrededor del dedo, no del centro: si no, al acercarse a un
    // punto del borde se pierde de vista justo lo que se estaba mirando.
    x = px - ((px - x) * nueva) / escala;
    y = py - ((py - y) * nueva) / escala;
    escala = nueva;
    aplicar();
  }

  let arrastrando = false, ultimoX = 0, ultimoY = 0;
  let distanciaInicial = 0, escalaInicial = 1;

  const alTocar = (e) => {
    if (e.touches.length === 2) {
      distanciaInicial = distancia(e.touches);
      escalaInicial = escala;
      arrastrando = false;
    } else if (e.touches.length === 1) {
      arrastrando = true;
      ultimoX = e.touches[0].clientX;
      ultimoY = e.touches[0].clientY;
    }
  };

  const alMover = (e) => {
    if (e.touches.length === 2 && distanciaInicial) {
      e.preventDefault();
      const d = distancia(e.touches);
      const centroX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const centroY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const objetivo = escalaInicial * (d / distanciaInicial);
      zoomEn(objetivo / escala, centroX, centroY);
    } else if (arrastrando && e.touches.length === 1) {
      e.preventDefault();
      x += e.touches[0].clientX - ultimoX;
      y += e.touches[0].clientY - ultimoY;
      ultimoX = e.touches[0].clientX;
      ultimoY = e.touches[0].clientY;
      aplicar();
    }
  };

  const alSoltar = (e) => {
    if (!e.touches.length) { arrastrando = false; distanciaInicial = 0; }
  };

  // Doble toque: acercar de golpe donde se tocó, y si ya está acercado, volver
  // a la vista completa.
  let ultimoToque = 0;
  const alFin = (e) => {
    const ahora = Date.now();
    if (ahora - ultimoToque < 300 && e.changedTouches?.length === 1) {
      const t = e.changedTouches[0];
      if (escala > minEscala * 1.5) ajustar();
      else zoomEn(3, t.clientX, t.clientY);
    }
    ultimoToque = ahora;
    alSoltar(e);
  };

  const alRueda = (e) => { e.preventDefault(); zoomEn(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); };

  // Ratón, para cuando el panel se mira desde una computadora
  let ratonAbajo = false;
  const ratonInicio = (e) => { ratonAbajo = true; ultimoX = e.clientX; ultimoY = e.clientY; };
  const ratonMueve = (e) => {
    if (!ratonAbajo) return;
    x += e.clientX - ultimoX; y += e.clientY - ultimoY;
    ultimoX = e.clientX; ultimoY = e.clientY;
    aplicar();
  };
  const ratonFin = () => { ratonAbajo = false; };

  visor.addEventListener("touchstart", alTocar, { passive: true });
  visor.addEventListener("touchmove", alMover, { passive: false });
  visor.addEventListener("touchend", alFin);
  visor.addEventListener("touchcancel", alSoltar);
  visor.addEventListener("wheel", alRueda, { passive: false });
  visor.addEventListener("mousedown", ratonInicio);
  window.addEventListener("mousemove", ratonMueve);
  window.addEventListener("mouseup", ratonFin);
  window.addEventListener("resize", ajustar);

  return {
    ajustar,
    zoom: (f) => zoomEn(f),
    // Centra la vista en un punto dado en % del plano (lo usa el GPS)
    centrarEn(pctX, pctY) {
      const caja = visor.getBoundingClientRect();
      if (escala < minEscala * 2) escala = minEscala * 3;
      x = caja.width / 2 - (anchoNatural * (pctX / 100)) * escala;
      y = caja.height / 2 - (altoNatural * (pctY / 100)) * escala;
      aplicar();
    },
    detener() {
      visor.removeEventListener("touchstart", alTocar);
      visor.removeEventListener("touchmove", alMover);
      visor.removeEventListener("touchend", alFin);
      visor.removeEventListener("touchcancel", alSoltar);
      visor.removeEventListener("wheel", alRueda);
      visor.removeEventListener("mousedown", ratonInicio);
      window.removeEventListener("mousemove", ratonMueve);
      window.removeEventListener("mouseup", ratonFin);
      window.removeEventListener("resize", ajustar);
    },
  };
}

const distancia = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

// ═════════════════════════════════════════════════════════════════════════
// GPS
//
// El recuadro del plano (norte, sur, este, oeste en grados) convierte una
// posición del GPS en un porcentaje del ancho y del alto. Es una regla de tres
// en cada eje: a esta escala — un hotel son cientos de metros — la curvatura de
// la Tierra no se nota, así que no hace falta proyectar nada.
// ═════════════════════════════════════════════════════════════════════════
function seguirGps(plano, marca, estado, control) {
  let vigilante = null;
  let encendido = false;

  const tieneGeo = [plano.geo_norte, plano.geo_sur, plano.geo_este, plano.geo_oeste]
    .every((v) => v !== null && v !== undefined);

  function aPorcentaje(lat, lng) {
    const x = ((lng - plano.geo_oeste) / (plano.geo_este - plano.geo_oeste)) * 100;
    const y = ((plano.geo_norte - lat) / (plano.geo_norte - plano.geo_sur)) * 100;
    return { x, y, dentro: x >= -3 && x <= 103 && y >= -3 && y <= 103 };
  }

  // Metros por grado, para traducir la precisión del GPS a un tamaño en el
  // plano. La longitud se encoge con el coseno de la latitud.
  function anchoDelPlanoEnMetros() {
    const latMedia = ((plano.geo_norte + plano.geo_sur) / 2) * (Math.PI / 180);
    return (plano.geo_este - plano.geo_oeste) * 111320 * Math.cos(latMedia);
  }

  function pintar(pos) {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    const p = aPorcentaje(lat, lng);

    if (!p.dentro) {
      marca.style.display = "none";
      estado.innerHTML = `<span class="pista aviso">
        Estás fuera del área de este plano. Si el hotel tiene varios, cambia de plano arriba.</span>`;
      return;
    }

    marca.style.display = "";
    marca.style.left = `${p.x}%`;
    marca.style.top = `${p.y}%`;

    // El halo mide la precisión real del GPS a la escala del plano: un halo
    // grande es el aviso honesto de que el teléfono no sabe bien dónde está,
    // que es lo normal dentro de un edificio.
    const metros = anchoDelPlanoEnMetros();
    const halo = metros > 0 ? Math.min((accuracy / metros) * 100, 60) : 2;
    marca.style.setProperty("--halo", `${Math.max(halo, 1.2)}%`);

    estado.innerHTML = `<span class="pista ok">
      Ubicación en el mapa · precisión ${Math.round(accuracy)} m
      ${accuracy > 30 ? " — bajo techo el GPS pierde precisión; el círculo es el margen real" : ""}
    </span>`;

    if (!seguirGps.centradoUnaVez) {
      control.centrarEn(p.x, p.y);
      seguirGps.centradoUnaVez = true;
    }
  }

  function alternar() {
    if (!tieneGeo) {
      estado.innerHTML = `<span class="pista aviso">
        Este plano no tiene el recuadro de coordenadas cargado, así que no se puede
        ubicar el GPS encima. Se carga desde el panel, en el mapa de la planta.</span>`;
      return;
    }
    if (encendido) return detener();

    if (!navigator.geolocation) {
      estado.innerHTML = `<span class="pista aviso">Este teléfono no permite ubicación.</span>`;
      return;
    }

    estado.innerHTML = `<span class="pista">Buscando tu ubicación…</span>`;
    encendido = true;
    document.getElementById("mapa-gps")?.classList.add("activo");
    seguirGps.centradoUnaVez = false;

    vigilante = navigator.geolocation.watchPosition(pintar, (err) => {
      encendido = false;
      document.getElementById("mapa-gps")?.classList.remove("activo");
      estado.innerHTML = `<span class="pista aviso">${
        err.code === 1
          ? "Permiso de ubicación denegado. Actívalo para el navegador en los ajustes del teléfono."
          : "No se pudo obtener la ubicación. Sal a un área abierta y vuelve a intentar."
      }</span>`;
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }

  function detener() {
    if (vigilante !== null) navigator.geolocation.clearWatch(vigilante);
    vigilante = null;
    encendido = false;
    marca.style.display = "none";
    document.getElementById("mapa-gps")?.classList.remove("activo");
  }

  return { alternar, detener };
}

// ── Descargar el plano ───────────────────────────────────────────────────
async function descargarPlano(plano) {
  const nombre = `${(plano.nombre || "plano").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase()}.${plano.tipo_archivo === "pdf" ? "pdf" : "png"}`;
  try {
    // Se baja a memoria y se guarda desde ahí: un enlace directo al bucket, en
    // el navegador del teléfono, muchas veces abre el PDF en vez de guardarlo.
    const bytes = await archivoPlano(plano);
    const blob = new Blob([bytes], { type: plano.tipo_mime || "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    aviso("Plano descargado", "exito");
  } catch {
    window.open(plano.imagen_url, "_blank");
  }
}
