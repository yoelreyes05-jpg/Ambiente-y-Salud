// puntosgps.js — Importar puntos de control desde coordenadas GPS
//
// El técnico marca los cebaderos, registros, lámparas… con una app de mapas en
// el teléfono y exporta un Excel (Nombre, GPS Lat, GPS Lng). Aquí se sube ese
// Excel, se ven todos los puntos en el mapa satelital, cada uno con el hotel
// que el sistema le propone (por el plano georreferenciado del hotel o por la
// ubicación del hotel), y se corrige lo que haga falta antes de crearlos:
//
//   · tocar un punto → cambiarle hotel o tipo, o excluirlo;
//   · "Seleccionar con recuadro" (o Shift + arrastrar) → asignar de una vez
//     todos los puntos que queden dentro al hotel elegido arriba.
//
// Backend: routes/puntosGps.js. Usa rtCargarLeaflet() de rastreo.js.

const GPS_COLORES = ["#2563EB", "#16A34A", "#DC2626", "#9333EA", "#EA580C", "#0891B2", "#CA8A04", "#DB2777", "#4F46E5", "#65A30D", "#0D9488", "#B91C1C"];

async function modalPuntosGps(onSaved) {
  openModal({
    title: "📍 Importar puntos desde GPS",
    large: true,
    bodyHTML: `
      <div id="gps-paso1">
        <p class="text-muted">Sube el Excel que exporta la app de mapas del teléfono (columnas <strong>Nombre</strong>, <strong>GPS Lat</strong>, <strong>GPS Lng</strong>).
          Verás cada punto en el mapa con el hotel donde cae, para revisarlo antes de crearlo.</p>
        ${campo("Excel de puntos GPS", `<input type="file" id="gps-archivo" accept=".xlsx,.csv" />`)}
        <div id="gps-estado" class="text-muted"></div>
      </div>
      <div id="gps-paso2" hidden></div>`,
    submitLabel: "Crear puntos",
    async onMount(overlay) {
      overlay.querySelector(".modal")?.classList.add("modal-gps");
      $("#asa-modal-submit").disabled = true;
      $("#gps-archivo").addEventListener("change", async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        $("#gps-estado").textContent = "Leyendo puntos…";
        try {
          const base = await leerBase64(f);
          const [d] = await Promise.all([post("/puntos-gps/analizar", { archivo_base64: base }), rtCargarLeaflet()]);
          $("#gps-paso1").hidden = true;
          montarMapaGps(d);
        } catch (err) {
          $("#gps-estado").textContent = err.message;
        }
      });
    },
    async onSubmit() {
      const puntos = (window.GPS_ESTADO?.puntos || []).filter((p) => !p.excluido && p.sitio_id && p.tipo_codigo && !p.ya_existe);
      if (!puntos.length) throw new Error("No hay puntos con hotel y tipo para crear");
      const r = await post("/puntos-gps/importar", { puntos });
      closeModal();
      toast(`${r.creados} punto(s) creados: ${r.resumen.map((x) => `${x.sitio} ${x.creados}`).join(", ")}`);
      onSaved?.();
    },
  });
}

function montarMapaGps(d) {
  const E = (window.GPS_ESTADO = { puntos: d.puntos.map((p, i) => ({ ...p, i, excluido: false })), sitios: d.sitios, tipos: d.tipos });
  const color = new Map(d.sitios.map((s, i) => [s.id, GPS_COLORES[i % GPS_COLORES.length]]));
  const nombreSitio = new Map(d.sitios.map((s) => [s.id, s.nombre]));
  const nombreTipo = new Map(d.tipos.map((t) => [t.codigo, t.nombre]));
  const opcSitios = `<option value="">— Sin hotel —</option>${d.sitios.map((s) => `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`).join("")}<option value="__excluir">✕ Excluir (no crear)</option>`;
  const opcTipos = d.tipos.filter((t) => t.codigo !== "habitacion").map((t) => `<option value="${esc(t.codigo)}">${esc(t.nombre)}${t.nuevo ? " (tipo nuevo)" : ""}</option>`).join("");

  const caja = $("#gps-paso2");
  caja.hidden = false;
  caja.innerHTML = `
    <div class="gps-barra">
      <label>Asignar a <select id="gps-destino">${opcSitios}</select></label>
      <button type="button" class="btn" id="gps-recuadro">▭ Seleccionar con recuadro</button>
      <span class="text-muted" style="font-size:12.5px">o mantén <kbd>Shift</kbd> y arrastra · toca un punto para cambiarlo</span>
    </div>
    <div class="text-muted" style="font-size:12.5px;margin:-2px 0 8px">
      Color = hotel · gris = sin hotel · borde blanco = registro/cárcamo · blanco por dentro = ya existe · recuadro punteado = plano del hotel
    </div>
    <div class="gps-zonas" id="gps-zonas"></div>
    <div id="gps-mapa" class="gps-mapa"></div>
    <div id="gps-resumen" class="gps-resumen"></div>`;

  const mapa = L.map("gps-mapa", { boxZoom: false, preferCanvas: true });
  const satelite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 20, maxNativeZoom: 19, attribution: "Esri World Imagery" });
  const calles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 20, maxNativeZoom: 19, attribution: "© OpenStreetMap" });
  satelite.addTo(mapa);
  L.control.layers({ "Satélite": satelite, "Calles": calles }).addTo(mapa);

  // Planos georreferenciados de cada hotel
  for (const pl of d.planos) {
    L.rectangle([[pl.sur, pl.oeste], [pl.norte, pl.este]], { color: color.get(pl.sitio_id) || "#fff", weight: 2, dashArray: "6 4", fill: false })
      .bindTooltip(`Plano: ${nombreSitio.get(pl.sitio_id) || ""} · ${pl.nombre}`).addTo(mapa);
  }

  const capa = L.layerGroup().addTo(mapa);
  const marcadores = new Map();
  const estilo = (p) => ({
    radius: p.tipo_codigo === "registro" ? 6 : 5,
    color: p.excluido ? "#64748b" : p.tipo_codigo === "registro" ? "#ffffff" : "#111827",
    weight: p.tipo_codigo === "registro" ? 2 : 1,
    fillColor: p.excluido ? "#94a3b8" : p.ya_existe ? "#ffffff" : color.get(p.sitio_id) || "#9ca3af",
    fillOpacity: p.excluido ? 0.35 : 0.95,
    dashArray: p.excluido ? "2 2" : null,
  });
  const popup = (p) => `
    <div class="gps-pop" data-i="${p.i}">
      <strong>${esc(p.nombre)}</strong>${p.descripcion ? `<br><small>${esc(p.descripcion)}</small>` : ""}
      <br><small class="text-muted">${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}${p.fecha ? ` · ${esc(p.fecha.slice(0, 10))}` : ""}</small>
      ${p.ya_existe ? `<br><span class="estado-chip hecho">Ya existe: ${esc(p.ya_existe)}</span>` : ""}
      ${p.cercano ? `<br><small>Hotel más cercano: ${esc(p.cercano.nombre)} (${p.cercano.metros} m)</small>` : ""}
      <label style="display:block;margin-top:6px">Hotel <select data-gps-sitio>${opcSitios}</select></label>
      <label style="display:block;margin-top:4px">Tipo <select data-gps-tipo><option value="">— Sin tipo —</option>${opcTipos}</select></label>
    </div>`;

  for (const p of E.puntos) {
    const m = L.circleMarker([p.lat, p.lng], estilo(p)).addTo(capa);
    m.bindTooltip(() => `${esc(p.nombre)} · ${esc(nombreTipo.get(p.tipo_codigo) || "sin tipo")} · ${esc(p.excluido ? "excluido" : nombreSitio.get(p.sitio_id) || "sin hotel")}`);
    m.bindPopup(() => popup(p));
    m.on("popupopen", (ev) => {
      const el = ev.popup.getElement();
      const sSel = el.querySelector("[data-gps-sitio]"), tSel = el.querySelector("[data-gps-tipo]");
      sSel.value = p.excluido ? "__excluir" : p.sitio_id || "";
      tSel.value = p.tipo_codigo || "";
      sSel.addEventListener("change", () => { asignar([p], sSel.value); });
      tSel.addEventListener("change", () => { p.tipo_codigo = tSel.value || null; repintar([p]); });
    });
    marcadores.set(p.i, m);
  }

  function asignar(lista, destino) {
    for (const p of lista) {
      if (destino === "__excluir") p.excluido = true;
      else { p.excluido = false; p.sitio_id = destino || null; p.como = destino ? "manual" : null; }
    }
    repintar(lista);
  }
  function repintar(lista) {
    for (const p of lista) marcadores.get(p.i)?.setStyle(estilo(p));
    resumen();
  }

  // Zonas: grupos de puntos a ~5 km, para saltar de una a otra
  const zonas = new Map();
  for (const p of E.puntos) {
    const k = `${(Math.round(p.lat * 20) / 20).toFixed(2)},${(Math.round(p.lng * 20) / 20).toFixed(2)}`;
    if (!zonas.has(k)) zonas.set(k, []);
    zonas.get(k).push(p);
  }
  const listaZonas = [...zonas.values()].sort((a, b) => b.length - a.length);
  const nombreZona = (pts) => {
    const c = {};
    for (const p of pts) { const n = p.excluido ? null : nombreSitio.get(p.sitio_id); if (n) c[n] = (c[n] || 0) + 1; }
    const hoteles = Object.entries(c).sort((a, b) => b[1] - a[1]).map(([n]) => n);
    const sin = pts.filter((p) => !p.excluido && !p.sitio_id).length;
    const lugar = `${pts[0].lat.toFixed(2)}, ${pts[0].lng.toFixed(2)}`;
    return `${hoteles.length ? hoteles.slice(0, 2).join(" + ") : "Sin hotel"}${sin && hoteles.length ? ` (+${sin} sin hotel)` : ""} · ${pts.length} puntos · ${lugar}`;
  };
  const pintarZonas = () => {
    const actual = $("#gps-zona")?.value || "";
    $("#gps-zonas").innerHTML = `<label>Ir a la zona <select id="gps-zona"><option value="">— Elige —</option>
        ${listaZonas.map((pts, i) => `<option value="${i}">${esc(nombreZona(pts))}</option>`).join("")}
        <option value="todo">Todos los puntos</option></select></label>`;
    $("#gps-zona").value = actual;
    $("#gps-zona").addEventListener("change", (ev) => {
      if (ev.target.value === "") return;
      const pts = ev.target.value === "todo" ? E.puntos : listaZonas[Number(ev.target.value)];
      mapa.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])).pad(0.15), { maxZoom: 18 });
    });
  };

  function resumen() {
    const por = new Map();
    let sinHotel = 0, sinTipo = 0, excl = 0, ya = 0;
    for (const p of E.puntos) {
      if (p.excluido) { excl++; continue; }
      if (p.ya_existe) { ya++; continue; }
      if (!p.sitio_id) { sinHotel++; continue; }
      if (!p.tipo_codigo) { sinTipo++; continue; }
      if (!por.has(p.sitio_id)) por.set(p.sitio_id, {});
      const t = por.get(p.sitio_id);
      t[p.tipo_codigo] = (t[p.tipo_codigo] || 0) + 1;
    }
    const total = [...por.values()].reduce((a, t) => a + Object.values(t).reduce((x, y) => x + y, 0), 0);
    $("#gps-resumen").innerHTML = `
      <table class="data"><thead><tr><th>Hotel</th><th>Se crearán</th></tr></thead><tbody>
        ${[...por.entries()].map(([sid, t]) => `
          <tr><td><span class="gps-punto" style="background:${color.get(sid)}"></span> ${esc(nombreSitio.get(sid))}</td>
              <td>${Object.entries(t).map(([c, n]) => `${n} ${esc(nombreTipo.get(c) || c)}`).join(" · ")}</td></tr>`).join("") ||
          `<tr><td colspan="2" class="text-muted">Todavía ningún punto tiene hotel.</td></tr>`}
      </tbody></table>
      <p class="text-muted" style="margin:6px 0 0">
        ${sinHotel ? `<strong style="color:#b91c1c">${sinHotel} sin hotel</strong> (gris) · ` : ""}${sinTipo ? `<strong style="color:#b91c1c">${sinTipo} sin tipo</strong> · ` : ""}${ya ? `${ya} ya existen (blancos, se saltan) · ` : ""}${excl ? `${excl} excluidos · ` : ""}
        Los que caen dentro del plano del hotel quedan ubicados también en el plano.
      </p>`;
    $("#asa-modal-submit").disabled = !total;
    $("#asa-modal-submit").textContent = total ? `Crear ${total} punto${total === 1 ? "" : "s"}` : "Crear puntos";
    pintarZonas();
  }

  // Selección con recuadro: botón (también en pantalla táctil) o Shift + arrastrar
  let modoRecuadro = false, inicio = null, rect = null;
  const boton = $("#gps-recuadro");
  const ponerModo = (on) => {
    modoRecuadro = on;
    boton.classList.toggle("btn-primary", on);
    boton.textContent = on ? "▭ Arrastra sobre el mapa…" : "▭ Seleccionar con recuadro";
    on ? mapa.dragging.disable() : mapa.dragging.enable();
  };
  boton.addEventListener("click", () => ponerModo(!modoRecuadro));
  mapa.on("mousedown", (e) => {
    if (!modoRecuadro && !e.originalEvent.shiftKey) return;
    mapa.dragging.disable();
    inicio = e.latlng;
    rect = L.rectangle([inicio, inicio], { color: "#fff", weight: 2, dashArray: "4 4", fillOpacity: 0.1 }).addTo(mapa);
  });
  mapa.on("mousemove", (e) => { if (inicio && rect) rect.setBounds([inicio, e.latlng]); });
  mapa.on("mouseup", () => {
    if (!inicio || !rect) return;
    const b = rect.getBounds();
    rect.remove(); rect = null; inicio = null;
    if (!modoRecuadro) mapa.dragging.enable();
    const dentroRect = E.puntos.filter((p) => b.contains([p.lat, p.lng]));
    if (!dentroRect.length) return;
    const destino = $("#gps-destino").value;
    asignar(dentroRect, destino);
    toast(`${dentroRect.length} punto(s) → ${destino === "__excluir" ? "excluidos" : nombreSitio.get(destino) || "sin hotel"}`);
    ponerModo(false);
  });

  mapa.fitBounds(L.latLngBounds((listaZonas[0] || E.puntos).map((p) => [p.lat, p.lng])).pad(0.15), { maxZoom: 18 });
  setTimeout(() => mapa.invalidateSize(), 50);
  resumen();
}
