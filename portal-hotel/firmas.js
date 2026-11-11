// firmas.js — Portal del hotel: órdenes del técnico y firma de recibido
//
// Cada día, lo que sube un técnico en el hotel es su ORDEN. Queda "En proceso"
// hasta que alguien del hotel revisa lo que hizo y firma; con la firma queda
// "Finalizada". Servidor: backend/routes/firmas.js
//
// padFirma() también está copiado en app-tecnico/firma.js (cada app se publica
// sola). Si lo cambias aquí, cámbialo allá.

let FIRMAS_DIAS = 7;
let FIRMAS_VER = "";

// ── Recuadro para firmar con el dedo o el ratón ──────────────────────────────
function padFirma(contenedor) {
  contenedor.innerHTML = `
    <div class="pad-firma">
      <canvas></canvas>
      <div class="pad-linea">Firme aquí</div>
      <button type="button" class="pad-borrar">Borrar</button>
    </div>`;
  const caja = contenedor.querySelector(".pad-firma");
  const lienzo = caja.querySelector("canvas");
  const ctx = lienzo.getContext("2d");
  let trazos = 0, dibujando = false, ultimo = null;
  const ajustar = () => {
    const r = caja.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    lienzo.width = Math.max(1, Math.round(r.width * dpr));
    lienzo.height = Math.max(1, Math.round(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0f172a";
    trazos = 0;
  };
  const punto = (e) => { const r = lienzo.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  lienzo.addEventListener("pointerdown", (e) => {
    e.preventDefault(); lienzo.setPointerCapture(e.pointerId);
    dibujando = true; ultimo = punto(e);
    ctx.beginPath(); ctx.arc(ultimo.x, ultimo.y, 1.1, 0, Math.PI * 2); ctx.fillStyle = "#0f172a"; ctx.fill();
  });
  lienzo.addEventListener("pointermove", (e) => {
    if (!dibujando) return;
    const p = punto(e);
    ctx.beginPath(); ctx.moveTo(ultimo.x, ultimo.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    ultimo = p; trazos++;
  });
  const soltar = () => { dibujando = false; };
  lienzo.addEventListener("pointerup", soltar);
  lienzo.addEventListener("pointercancel", soltar);
  caja.querySelector(".pad-borrar").addEventListener("click", () => { ctx.clearRect(0, 0, lienzo.width, lienzo.height); trazos = 0; });
  requestAnimationFrame(ajustar);
  return {
    vacia: () => trazos < 5,
    // PNG achicado a 600 px de ancho, fondo blanco (pesa poco y se imprime bien)
    imagen() {
      const ancho = Math.min(600, lienzo.width);
      const alto = Math.round(lienzo.height * (ancho / lienzo.width));
      const c = document.createElement("canvas");
      c.width = ancho; c.height = alto;
      const x = c.getContext("2d");
      x.fillStyle = "#fff"; x.fillRect(0, 0, ancho, alto);
      x.drawImage(lienzo, 0, 0, ancho, alto);
      return c.toDataURL("image/png");
    },
  };
}

const ESTADO_ORDEN = {
  en_proceso: { txt: "En proceso", clase: "proceso" },
  finalizada: { txt: "Finalizada", clase: "finalizada" },
};
const fechaLargaF = (f) => new Date(`${f}T12:00:00`).toLocaleDateString("es-DO", { weekday: "long", day: "numeric", month: "long" });
const horaF = (d) => new Date(d).toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit", timeZone: "America/Santo_Domingo" });

async function vistaFirmas(cuerpo) {
  const hasta = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
  const d0 = new Date(`${hasta}T12:00:00Z`); d0.setUTCDate(d0.getUTCDate() - (FIRMAS_DIAS - 1));
  const desde = d0.toISOString().slice(0, 10);
  const d = await GET(`/firmas/ordenes?${new URLSearchParams({ sitio_id: PLANTA.id, desde, hasta })}`);
  const lista = d.ordenes.filter((o) => !FIRMAS_VER || o.estado === FIRMAS_VER);

  cuerpo.innerHTML = `
    <div class="acciones">
      <select class="btn" id="fi-dias">
        ${[[1, "Hoy"], [7, "Últimos 7 días"], [30, "Últimos 30 días"], [90, "Últimos 90 días"]].map(([n, t]) => `<option value="${n}"${n === FIRMAS_DIAS ? " selected" : ""}>${t}</option>`).join("")}
      </select>
      <select class="btn" id="fi-ver">
        <option value="">Todas</option>
        <option value="en_proceso"${FIRMAS_VER === "en_proceso" ? " selected" : ""}>Por firmar (en proceso)</option>
        <option value="finalizada"${FIRMAS_VER === "finalizada" ? " selected" : ""}>Firmadas (finalizadas)</option>
      </select>
    </div>
    <div class="kpis">
      <div class="kpi ${d.resumen.en_proceso ? "mal" : "ok"}"><div class="n">${d.resumen.en_proceso}</div><div class="t">Por firmar</div></div>
      <div class="kpi ok"><div class="n">${d.resumen.finalizadas}</div><div class="t">Firmadas</div></div>
      <div class="kpi"><div class="n">${d.resumen.total}</div><div class="t">Órdenes del período</div></div>
    </div>
    <p class="nota-firmas">Cada orden es lo que hizo un técnico en el día. Ábrela, revisa lo que hizo y firma de recibido: así queda <b>finalizada</b>.</p>
    ${lista.length ? lista.map((o) => `
      <div class="tarjeta orden ${ESTADO_ORDEN[o.estado].clase}" data-orden="${esc(o.fecha)}|${esc(o.clave)}" role="button" tabindex="0">
        <div class="orden-cab">
          <div><strong>${esc(fechaLargaF(o.fecha))}</strong><div class="orden-sub">👷 ${esc(o.tecnico)} · ${horaF(o.desde)} a ${horaF(o.hasta)}</div></div>
          <span class="marca-orden ${ESTADO_ORDEN[o.estado].clase}">${ESTADO_ORDEN[o.estado].txt}</span>
        </div>
        <div class="orden-tipos">
          ${o.tipos.map((t) => `<span class="chip-tipo">${esc(t.icono || "•")} ${esc(t.nombre || "")} · ${t.n}</span>`).join("")}
          ${o.no_realizados ? `<span class="chip-tipo mal">⚠ ${o.no_realizados} no realizado${o.no_realizados === 1 ? "" : "s"}</span>` : ""}
        </div>
        ${o.firma ? `<div class="orden-firma">✍️ Firmó <b>${esc(o.firma.firmante_nombre)}</b>${o.firma.firmante_cargo ? ` (${esc(o.firma.firmante_cargo)})` : ""} · ${esc(new Date(o.firma.created_at).toLocaleString("es-DO"))}
          ${o.nuevos_despues ? `<br><small>El técnico subió ${o.nuevos_despues} servicio(s) después de la firma.</small>` : ""}</div>`
          : `<div class="orden-firma pend">Toca para revisar y firmar ›</div>`}
      </div>`).join("")
      : `<div class="vacio"><span class="emoji">✍️</span>${FIRMAS_VER === "en_proceso" ? "No hay órdenes por firmar." : "No hay órdenes en este período."}</div>`}`;

  $("#fi-dias").addEventListener("change", (e) => { FIRMAS_DIAS = Number(e.target.value); vistaFirmas(cuerpo); });
  $("#fi-ver").addEventListener("change", (e) => { FIRMAS_VER = e.target.value; vistaFirmas(cuerpo); });
  cuerpo.querySelectorAll("[data-orden]").forEach((el) => {
    const abrir = () => { const [fecha, ...c] = el.dataset.orden.split("|"); abrirOrden(fecha, c.join("|"), () => vistaFirmas(cuerpo)); };
    el.addEventListener("click", abrir);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") abrir(); });
  });
}

async function abrirOrden(fecha, clave, alFirmar) {
  const hoja = document.createElement("div");
  hoja.className = "hoja";
  hoja.innerHTML = `
    <div class="hoja-barra">
      <button class="btn" id="hoja-cerrar">← Volver</button>
      <button class="btn" id="hoja-imprimir">Imprimir</button>
    </div>
    <div class="hoja-cuerpo" id="hoja-cuerpo"><div class="cargando">Cargando…</div></div>`;
  document.body.appendChild(hoja);
  document.body.style.overflow = "hidden";
  const cerrar = () => { hoja.remove(); document.body.style.overflow = ""; };
  $("#hoja-cerrar", hoja).addEventListener("click", cerrar);
  $("#hoja-imprimir", hoja).addEventListener("click", () => window.print());

  let o;
  try {
    o = await GET(`/firmas/orden?${new URLSearchParams({ sitio_id: PLANTA.id, fecha, clave })}`);
  } catch (e) {
    $("#hoja-cuerpo", hoja).innerHTML = `<div class="error">${esc(e.message)}</div>`;
    return;
  }
  const est = ESTADO_ORDEN[o.estado];
  $("#hoja-cuerpo", hoja).innerHTML = `
    <div class="orden-cab grande">
      <div><h2 style="margin:0">Orden de servicio · ${esc(PLANTA.nombre)}</h2>
        <div class="orden-sub">${esc(fechaLargaF(o.fecha))} · Técnico: <b>${esc(o.tecnico || "")}</b></div></div>
      <span class="marca-orden ${est.clase}">${est.txt}</span>
    </div>
    <div class="kpis">
      <div class="kpi ok"><div class="n">${o.hechos}</div><div class="t">Realizados</div></div>
      <div class="kpi ${o.no_realizados ? "mal" : ""}"><div class="n">${o.no_realizados}</div><div class="t">No realizados</div></div>
      <div class="kpi"><div class="n">${o.servicios.reduce((a, s) => a + (s.plagas || 0), 0)}</div><div class="t">Plagas contadas</div></div>
    </div>
    <div class="tarjeta">
      <h2>Lo que hizo el técnico</h2>
      <div class="tabla-orden">
        ${o.servicios.map((s) => `
          <div class="fila-orden ${s.no_realizado ? "nr" : ""}" ${s.inspeccion_id ? `data-insp="${esc(s.inspeccion_id)}"` : ""}>
            <span class="fo-hora">${horaF(s.hora)}</span>
            <span class="fo-punto">${esc(s.icono || "•")} <b>${esc(s.punto || "")}</b><small>${esc([s.tipo, s.area].filter(Boolean).join(" · "))}</small></span>
            <span class="fo-res">${s.no_realizado ? `No realizado${s.motivo ? ` · ${esc((typeof MOTIVOS_TEXTO !== "undefined" && MOTIVOS_TEXTO[s.motivo]) || s.motivo)}` : ""}`
              : s.nivel_actividad && s.nivel_actividad !== "ninguna" ? `Con actividad (${esc(s.nivel_actividad)})` : "Realizado"}${s.fotos ? ` · 📷 ${s.fotos}` : ""}</span>
          </div>`).join("")}
      </div>
    </div>
    <div class="tarjeta" id="zona-firma">
      ${o.firma ? `
        <h2>Recibido conforme</h2>
        <img class="firma-img" src="${esc(o.firma.imagen)}" alt="Firma de ${esc(o.firma.firmante_nombre)}">
        <p style="margin:6px 0 0"><b>${esc(o.firma.firmante_nombre)}</b>${o.firma.firmante_cargo ? ` · ${esc(o.firma.firmante_cargo)}` : ""}<br>
          <small>${esc(new Date(o.firma.created_at).toLocaleString("es-DO"))} · ${o.firma.origen === "tecnico" ? "firmado en el teléfono del técnico" : o.firma.origen === "portal" ? "firmado en el portal del hotel" : "registrado por ASA"}</small></p>
        ${o.firma.comentario ? `<p><b>Comentario:</b> ${esc(o.firma.comentario)}</p>` : ""}`
      : `
        <h2>Firma de quien recibe el servicio</h2>
        <p style="margin:0 0 10px;color:var(--suave);font-size:13px">Al firmar confirmas que recibiste el servicio descrito arriba. La orden queda <b>finalizada</b>.</p>
        <div class="form-firma">
          <label>Nombre de quien recibe<input id="ff-nombre" value="${esc(USUARIO?.nombre || "")}"></label>
          <label>Cargo<input id="ff-cargo" placeholder="Ama de llaves, Calidad, Supervisor…" value="${esc(PERFIL_PORTAL?.perfil === "ama_llaves" ? "Ama de llaves" : "")}"></label>
          <label class="ancho">Comentario (opcional)<input id="ff-comentario" placeholder="Solo si hay algo que anotar"></label>
        </div>
        <div id="ff-pad"></div>
        <button class="btn principal" id="ff-firmar" style="margin-top:10px;width:100%">✍️ Firmar y finalizar la orden</button>`}
    </div>`;
  if (typeof engancharServicios === "function") engancharServicios($("#hoja-cuerpo", hoja));
  if (o.firma) return;
  const pad = padFirma($("#ff-pad", hoja));
  $("#ff-firmar", hoja).addEventListener("click", async (e) => {
    const nombre = $("#ff-nombre", hoja).value.trim();
    if (nombre.length < 3) return alert("Escribe el nombre de quien recibe el servicio.");
    if (pad.vacia()) return alert("Falta la firma: firma en el recuadro.");
    e.target.disabled = true; e.target.textContent = "Guardando…";
    try {
      await POST("/firmas", { sitio_id: PLANTA.id, fecha: o.fecha, clave: o.clave, firmante_nombre: nombre, firmante_cargo: $("#ff-cargo", hoja).value, comentario: $("#ff-comentario", hoja).value, firma: pad.imagen() });
      cerrar();
      alFirmar?.();
    } catch (err) {
      alert(err.message);
      e.target.disabled = false; e.target.textContent = "✍️ Firmar y finalizar la orden";
    }
  });
}
