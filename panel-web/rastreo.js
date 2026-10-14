// ═════════════════════════════════════════════════════════════════════════
// rastreo.js — Técnicos en vivo (dónde está cada técnico y por dónde pasó)
//
// · Mapa con un punto por técnico que se mueve solo (se actualiza cada 20 s).
// · Al tocar un técnico: su recorrido del día, los km, y a qué hora llegó y
//   salió de cada hotel con cuántos servicios hizo ahí.
// · Otro día: el recorrido completo de ese día.
// · Hoteles sin ubicación: se fijan tocando el mapa.
//
// Los datos los manda la app del técnico mientras está abierta (routes/
// rastreo.js). Mapa: Leaflet + OpenStreetMap, cargado solo al entrar aquí.
//
// Se carga antes de app.js y aporta MODULOS_EXTRA_12.
// ═════════════════════════════════════════════════════════════════════════

const MODULOS_EXTRA_12 = [
  { key: "rastreo", label: "Técnicos en vivo", ic: "🛰️", seccion: "operacion", roles: ["admin", "operaciones"], view: viewRastreo },
];

const RT = { mapa: null, capaTec: null, capaRuta: null, capaHoteles: null, sel: null, timer: null, fecha: null, fijando: null, datos: null };
const RT_TZ = { timeZone: "America/Santo_Domingo" };
const rtHoy = () => new Date().toLocaleDateString("en-CA", RT_TZ);
const rtHora = (iso) => (iso ? new Date(iso).toLocaleTimeString("es-DO", { ...RT_TZ, hour: "numeric", minute: "2-digit" }) : "—");
const rtDur = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);
const RT_ESTADO = {
  en_linea: { txt: "En línea", color: "#16a34a" },
  reciente: { txt: "Hace poco", color: "#ca8a04" },
  sin_senal: { txt: "Sin señal", color: "#94a3b8" },
  sin_datos: { txt: "Sin datos hoy", color: "#cbd5e1" },
  dia_pasado: { txt: "", color: "#32539C" },
};

function rtCargarLeaflet() {
  if (window.L) return Promise.resolve();
  if (rtCargarLeaflet._p) return rtCargarLeaflet._p;
  rtCargarLeaflet._p = new Promise((ok, mal) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    js.onload = ok;
    js.onerror = () => mal(new Error("No se pudo cargar el mapa. Revisa la conexión."));
    document.head.appendChild(js);
  });
  return rtCargarLeaflet._p;
}

async function viewRastreo(content) {
  clearInterval(RT.timer);
  RT.fecha = RT.fecha || rtHoy();
  RT.sel = null;
  content.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>🛰️ Técnicos en vivo</h2>
        <div class="actions">
          <input type="date" id="rt-fecha" value="${RT.fecha}" max="${rtHoy()}" />
          <button class="btn" id="rt-hoy">Hoy</button>
          <button class="btn" id="rt-actualizar">↻ Actualizar</button>
          ${USUARIO.rol === "admin" ? `<button class="btn" id="rt-config">⚙ Horario</button>` : ""}
        </div>
      </div>
      <p class="text-muted" style="margin-top:0">
        Se ve a cada técnico <strong>mientras tiene la app abierta</strong> en horario de trabajo.
        Si la cierra o apaga la pantalla, queda su última ubicación con la hora.
      </p>
      <div class="rt-grid">
        <div class="rt-lista" id="rt-lista"><div class="center-msg">Cargando…</div></div>
        <div>
          <div id="rt-mapa" class="rt-mapa"></div>
          <div id="rt-detalle"></div>
        </div>
      </div>
    </div>`;

  $("#rt-fecha").addEventListener("change", (e) => { RT.fecha = e.target.value || rtHoy(); RT.sel = null; rtCargar(true); });
  $("#rt-hoy").addEventListener("click", () => { RT.fecha = rtHoy(); $("#rt-fecha").value = RT.fecha; RT.sel = null; rtCargar(true); });
  $("#rt-actualizar").addEventListener("click", () => rtCargar(false));
  $("#rt-config")?.addEventListener("click", rtModalConfig);

  try {
    await rtCargarLeaflet();
  } catch (e) {
    $("#rt-mapa").innerHTML = `<div class="form-error" style="display:block">${esc(e.message)}</div>`;
    return;
  }
  RT.mapa = L.map("rt-mapa", { zoomControl: true }).setView([18.7, -69.9], 8); // República Dominicana
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap",
  }).addTo(RT.mapa);
  RT.capaHoteles = L.layerGroup().addTo(RT.mapa);
  RT.capaRuta = L.layerGroup().addTo(RT.mapa);
  RT.capaTec = L.layerGroup().addTo(RT.mapa);
  RT.mapa.on("click", rtClickMapa);

  await rtCargar(true);
  // Se mueve solo mientras se mira el día de hoy; al salir de la pantalla se apaga
  RT.timer = setInterval(() => {
    if (!document.getElementById("rt-mapa")) { clearInterval(RT.timer); return; }
    if (RT.fecha === rtHoy() && !document.hidden) rtCargar(false);
  }, 20000);
}

async function rtCargar(encuadrar) {
  let d;
  try {
    d = await get(`/rastreo/en-vivo?fecha=${RT.fecha}`);
  } catch (e) {
    const falta = /asa_ubicaciones|relation|schema cache/i.test(e.message);
    $("#rt-lista").innerHTML = `<div class="form-error" style="display:block">${
      falta ? "Falta correr <strong>supabase/39_rastreo_tecnicos.sql</strong> en Supabase." : esc(e.message)}</div>`;
    return;
  }
  RT.datos = d;
  const esHoy = RT.fecha === rtHoy();

  // Lista de técnicos
  const lista = esHoy ? d.tecnicos : d.tecnicos.filter((t) => t.ultima);
  $("#rt-lista").innerHTML = lista.length
    ? lista.map((t) => {
        const e = RT_ESTADO[t.estado] || RT_ESTADO.sin_datos;
        return `
        <button type="button" class="rt-tec${RT.sel === t.usuario_id ? " activo" : ""}" data-id="${esc(t.usuario_id)}" ${t.ultima ? "" : "disabled"}>
          <span class="rt-punto" style="background:${e.color}"></span>
          <span class="rt-tec-txt">
            <strong>${esc(t.nombre)}</strong>
            <small>${
              !t.ultima ? "No ha abierto la app hoy"
              : esHoy ? `${e.txt}${t.minutos > 0 ? ` · hace ${rtDur(t.minutos)}` : ""}`
              : `Última: ${rtHora(t.ultima.hora)}`}${t.hotel ? ` · 🏨 ${esc(t.hotel)}` : ""}</small>
            <small>${t.servicios.hechos} servicio(s)${t.servicios.no_realizados ? ` · ${t.servicios.no_realizados} no se pudo` : ""}${
              t.bateria != null ? ` · 🔋 ${Math.round(t.bateria * 100)}%` : ""}</small>
          </span>
        </button>`;
      }).join("")
    : `<div class="text-muted" style="padding:12px">${esHoy ? "No hay técnicos registrados." : "Nadie mandó ubicación ese día."}</div>`;
  $$(".rt-tec").forEach((b) => b.addEventListener("click", () => rtSeleccionar(b.dataset.id)));

  // Hoteles (círculo con su radio)
  RT.capaHoteles.clearLayers();
  for (const h of d.hoteles || []) {
    L.circle([h.lat, h.lng], { radius: h.radio, color: "#32539C", weight: 1, fillOpacity: 0.06 })
      .bindTooltip(`🏨 ${h.nombre}`, { direction: "top" })
      .addTo(RT.capaHoteles);
  }

  // Técnicos (punto con el nombre)
  RT.capaTec.clearLayers();
  const marcas = [];
  for (const t of d.tecnicos) {
    if (!t.ultima) continue;
    const e = RT_ESTADO[t.estado] || RT_ESTADO.sin_datos;
    const icono = L.divIcon({
      className: "rt-marca",
      html: `<div class="rt-marca-punto" style="background:${e.color}"></div><div class="rt-marca-nombre">${esc(t.nombre.split(" ")[0])}</div>`,
      iconSize: [0, 0],
    });
    const m = L.marker([t.ultima.lat, t.ultima.lng], { icon: icono })
      .bindPopup(`<strong>${esc(t.nombre)}</strong><br>${rtHora(t.ultima.hora)}${t.hotel ? `<br>🏨 ${esc(t.hotel)}` : ""}${
        t.ultima.precision_m ? `<br><small>Precisión ±${Math.round(t.ultima.precision_m)} m</small>` : ""}`)
      .on("click", () => rtSeleccionar(t.usuario_id));
    m.addTo(RT.capaTec);
    marcas.push([t.ultima.lat, t.ultima.lng]);
  }
  if (encuadrar && !RT.sel) {
    const todo = [...marcas, ...(d.hoteles || []).map((h) => [h.lat, h.lng])];
    if (todo.length) RT.mapa.fitBounds(todo, { padding: [30, 30], maxZoom: 15 });
  }

  if (RT.sel) await rtRecorrido(RT.sel, false);
  else rtSinSeleccion();
}

function rtSinSeleccion() {
  RT.capaRuta.clearLayers();
  const sinUbic = (RT.datos?.hoteles || []).length;
  $("#rt-detalle").innerHTML = `
    <p class="text-muted" style="margin:10px 0 0">Toca un técnico para ver su recorrido del día y a qué hora llegó y salió de cada hotel.</p>
    <p class="text-muted" style="margin:6px 0 0">
      ${sinUbic} hotel(es) con ubicación en el mapa.
      <a href="#" id="rt-fijar">📍 Fijar la ubicación de un hotel</a>
    </p>`;
  $("#rt-fijar")?.addEventListener("click", (e) => { e.preventDefault(); rtElegirHotelAFijar(); });
}

async function rtSeleccionar(id) {
  RT.sel = id;
  $$(".rt-tec").forEach((b) => b.classList.toggle("activo", b.dataset.id === id));
  await rtRecorrido(id, true);
}

async function rtRecorrido(id, encuadrar) {
  let r;
  try {
    r = await get(`/rastreo/recorrido?usuario_id=${encodeURIComponent(id)}&fecha=${RT.fecha}`);
  } catch (e) {
    $("#rt-detalle").innerHTML = `<div class="form-error" style="display:block">${esc(e.message)}</div>`;
    return;
  }
  const t = RT.datos?.tecnicos.find((x) => x.usuario_id === id);
  RT.capaRuta.clearLayers();
  const linea = r.puntos.map((p) => [p.lat, p.lng]);
  if (linea.length > 1) {
    L.polyline(linea, { color: "#2563eb", weight: 4, opacity: 0.8 }).addTo(RT.capaRuta);
  }
  if (linea.length) {
    L.circleMarker(linea[0], { radius: 7, color: "#fff", weight: 2, fillColor: "#16a34a", fillOpacity: 1 })
      .bindTooltip(`Inicio ${rtHora(r.puntos[0].hora)}`).addTo(RT.capaRuta);
    L.circleMarker(linea[linea.length - 1], { radius: 7, color: "#fff", weight: 2, fillColor: "#dc2626", fillOpacity: 1 })
      .bindTooltip(`${RT.fecha === rtHoy() ? "Última ubicación" : "Fin"} ${rtHora(r.puntos[r.puntos.length - 1].hora)}`).addTo(RT.capaRuta);
    if (encuadrar) RT.mapa.fitBounds(linea, { padding: [30, 30], maxZoom: 17 });
  }

  $("#rt-detalle").innerHTML = `
    <div class="rt-resumen">
      <h3 style="margin:12px 0 6px">${esc(t?.nombre || "Técnico")} — ${RT.fecha === rtHoy() ? "hoy" : RT.fecha.split("-").reverse().join("/")}</h3>
      <div class="rt-kpis">
        <div><strong>${r.km} km</strong><span>recorridos</span></div>
        <div><strong>${rtHora(r.primera)}</strong><span>primera ubicación</span></div>
        <div><strong>${rtHora(r.ultima)}</strong><span>última ubicación</span></div>
        <div><strong>${r.servicios.filter((s) => !s.no_realizado).length}</strong><span>servicios hechos</span></div>
      </div>
      ${r.visitas.length ? `
        <h4 style="margin:12px 0 6px">Visitas a hoteles</h4>
        <table class="data">
          <thead><tr><th>Hotel</th><th>Llegó</th><th>Salió</th><th>Tiempo</th><th style="text-align:right">Servicios</th></tr></thead>
          <tbody>
            ${r.visitas.map((v) => `
              <tr>
                <td><strong>🏨 ${esc(v.hotel)}</strong></td>
                <td>${rtHora(v.llegada)}</td>
                <td>${rtHora(v.salida)}</td>
                <td>${rtDur(v.minutos)}</td>
                <td style="text-align:right">${v.servicios}${v.no_realizados ? ` <small class="text-muted">(+${v.no_realizados} no se pudo)</small>` : ""}</td>
              </tr>`).join("")}
          </tbody>
        </table>`
      : `<p class="text-muted">${r.puntos.length ? "No pasó por ningún hotel con ubicación en el mapa. Fija la ubicación de los hoteles para ver llegadas y salidas." : "No hay ubicaciones de este técnico ese día."}</p>`}
      <p style="margin:10px 0 0"><a href="#" id="rt-volver">← Ver todos</a></p>
    </div>`;
  $("#rt-volver").addEventListener("click", (e) => {
    e.preventDefault();
    RT.sel = null;
    $$(".rt-tec").forEach((b) => b.classList.remove("activo"));
    rtSinSeleccion();
  });
}

// ── Fijar la ubicación de un hotel tocando el mapa ───────────────────────
async function rtElegirHotelAFijar() {
  const sitios = await get("/sitios").catch(() => []);
  const lista = (Array.isArray(sitios) ? sitios : sitios.sitios || []).filter((s) => s.activo !== false);
  openModal({
    title: "Fijar la ubicación de un hotel",
    bodyHTML:
      `<p class="text-muted">Elige el hotel y después toca en el mapa el centro del hotel. El círculo es el área que
        cuenta como "dentro del hotel" para la hora de llegada y salida.</p>` +
      campo("Hotel", `<select name="sitio" required>${lista.map((s) => `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`).join("")}</select>`) +
      campo("Radio (metros)", `<input name="radio" type="number" min="50" max="5000" value="400" />`,
        "Un resort grande puede necesitar 600–800 m; un hotel de ciudad 150–250 m."),
    submitLabel: "Tocar en el mapa",
    async onSubmit(fd) {
      const s = lista.find((x) => x.id === fd.get("sitio"));
      RT.fijando = { id: s.id, nombre: s.nombre, radio: Number(fd.get("radio")) || 400 };
      closeModal();
      toast(`Toca en el mapa el centro de ${s.nombre}`);
      $("#rt-mapa").classList.add("rt-fijando");
    },
  });
}

async function rtClickMapa(e) {
  if (!RT.fijando) return;
  const f = RT.fijando;
  RT.fijando = null;
  $("#rt-mapa").classList.remove("rt-fijando");
  if (!confirm(`¿Guardar aquí la ubicación de ${f.nombre}?`)) return;
  try {
    await put(`/rastreo/hoteles/${f.id}`, { lat: e.latlng.lat, lng: e.latlng.lng, radio_m: f.radio });
    toast(`Ubicación de ${f.nombre} guardada`);
    rtCargar(false);
  } catch (err) {
    toast(err.message, true);
  }
}

// ── Horario en que se registra la ubicación (admin) ──────────────────────
async function rtModalConfig() {
  const c = await get("/rastreo/config");
  const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  openModal({
    title: "Horario de ubicación de los técnicos",
    bodyHTML:
      `<p class="text-muted">La ubicación solo se guarda dentro de este horario y solo con la app abierta.
        Si "Hasta" es menor que "Desde", cruza la medianoche (para las profundas de noche).</p>` +
      campo("Rastreo", `<select name="activo"><option value="si"${c.activo ? " selected" : ""}>Encendido</option><option value="no"${c.activo ? "" : " selected"}>Apagado</option></select>`) +
      `<div style="display:flex;gap:10px">
         ${campo("Desde", `<input type="time" name="desde" value="${esc(c.desde)}" />`)}
         ${campo("Hasta", `<input type="time" name="hasta" value="${esc(c.hasta)}" />`)}
       </div>` +
      campo("Cada cuántos segundos", `<input type="number" name="intervalo" min="15" max="600" value="${c.intervalo_seg}" />`,
        "45 s da una ruta clara sin gastar mucha batería.") +
      campo("Días", DIAS.map((d, i) => `<label style="margin-right:10px"><input type="checkbox" name="dia" value="${i}"${(c.dias || []).includes(i) ? " checked" : ""}> ${d}</label>`).join("")),
    submitLabel: "Guardar",
    async onSubmit(fd) {
      await put("/rastreo/config", {
        activo: fd.get("activo") === "si",
        desde: fd.get("desde"),
        hasta: fd.get("hasta"),
        intervalo_seg: Number(fd.get("intervalo")),
        dias: fd.getAll("dia").map(Number),
      });
      closeModal();
      toast("Horario guardado. Los teléfonos lo toman al abrir la app.");
    },
  });
}
