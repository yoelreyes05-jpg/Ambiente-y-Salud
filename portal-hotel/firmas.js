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
  parcial: { txt: "Firmada en parte", clase: "parcial" },
  finalizada: { txt: "Finalizada", clase: "finalizada" },
};
const fechaLargaF = (f) => new Date(`${f}T12:00:00`).toLocaleDateString("es-DO", { weekday: "long", day: "numeric", month: "long" });
const horaF = (d) => new Date(d).toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit", timeZone: "America/Santo_Domingo" });
const origenF = (o) => (o === "tecnico" ? "en el teléfono del técnico" : o === "portal" ? "en el portal del hotel" : "registrado por ASA");

async function vistaFirmas(cuerpo) {
  const hasta = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
  const d0 = new Date(`${hasta}T12:00:00Z`); d0.setUTCDate(d0.getUTCDate() - (FIRMAS_DIAS - 1));
  const desde = d0.toISOString().slice(0, 10);
  const d = await GET(`/firmas/ordenes?${new URLSearchParams({ sitio_id: PLANTA.id, desde, hasta })}`);
  const lista = d.ordenes.filter((o) => !FIRMAS_VER || (FIRMAS_VER === "por_firmar" ? o.estado !== "finalizada" : o.estado === FIRMAS_VER));
  const porFirmar = d.resumen.en_proceso + (d.resumen.parciales || 0);

  cuerpo.innerHTML = `
    <div class="acciones">
      <select class="btn" id="fi-dias">
        ${[[1, "Hoy"], [7, "Últimos 7 días"], [30, "Últimos 30 días"], [90, "Últimos 90 días"]].map(([n, t]) => `<option value="${n}"${n === FIRMAS_DIAS ? " selected" : ""}>${t}</option>`).join("")}
      </select>
      <select class="btn" id="fi-ver">
        <option value="">Todas</option>
        <option value="por_firmar"${FIRMAS_VER === "por_firmar" ? " selected" : ""}>Por firmar (en proceso o en parte)</option>
        <option value="finalizada"${FIRMAS_VER === "finalizada" ? " selected" : ""}>Firmadas completas</option>
      </select>
    </div>
    <div class="kpis">
      <div class="kpi ${porFirmar ? "mal" : "ok"}"><div class="n">${porFirmar}</div><div class="t">Por firmar${d.resumen.parciales ? ` (${d.resumen.parciales} en parte)` : ""}</div></div>
      <div class="kpi ok"><div class="n">${d.resumen.finalizadas}</div><div class="t">Firmadas completas</div></div>
      <div class="kpi"><div class="n">${d.resumen.total}</div><div class="t">Órdenes del período</div></div>
    </div>
    <p class="nota-firmas">Cada orden es lo que hizo un técnico en el día. Se puede firmar toda de una vez o por áreas (cada responsable firma lo suyo). Queda <b>finalizada</b> cuando todo tiene firma.</p>
    ${lista.length ? lista.map((o) => `
      <div class="tarjeta orden ${ESTADO_ORDEN[o.estado].clase}" data-orden="${esc(o.fecha)}|${esc(o.clave)}" role="button" tabindex="0">
        <div class="orden-cab">
          <div><strong>${esc(fechaLargaF(o.fecha))}</strong><div class="orden-sub">👷 ${esc(o.tecnico)} · ${horaF(o.desde)} a ${horaF(o.hasta)}</div></div>
          <span class="marca-orden ${ESTADO_ORDEN[o.estado].clase}">${ESTADO_ORDEN[o.estado].txt}</span>
        </div>
        <div class="orden-tipos">
          <span class="chip-tipo"><b>${o.hechos}</b> punto${o.hechos === 1 ? "" : "s"} realizado${o.hechos === 1 ? "" : "s"}</span>
          ${o.tipos.map((t) => `<span class="chip-tipo">${esc(t.icono || "•")} ${esc(t.nombre || "")} · ${t.n}</span>`).join("")}
          ${o.no_realizados ? `<span class="chip-tipo mal">⚠ ${o.no_realizados} no realizado${o.no_realizados === 1 ? "" : "s"}</span>` : ""}
        </div>
        ${o.firmas.map((f) => `<div class="orden-firma">✍️ <b>${esc(f.firmante_nombre)}</b>${f.firmante_cargo ? ` (${esc(f.firmante_cargo)})` : ""} · ${esc(f.parte || "Todo")} · ${f.puntos} punto(s)</div>`).join("")}
        ${o.estado !== "finalizada" ? `<div class="orden-firma pend">${o.firmas.length ? `Faltan ${o.pendientes_puntos} punto(s) por firmar ›` : "Toca para revisar y firmar ›"}</div>` : ""}
      </div>`).join("")
      : `<div class="vacio"><span class="emoji">✍️</span>${FIRMAS_VER === "por_firmar" ? "No hay órdenes por firmar." : "No hay órdenes en este período."}</div>`}`;

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
  const quienFirmo = new Map(o.firmas.map((f) => [f.id, f]));
  $("#hoja-cuerpo", hoja).innerHTML = `
    <div class="orden-cab grande">
      <div><h2 style="margin:0">Orden de servicio · ${esc(PLANTA.nombre)}</h2>
        <div class="orden-sub">${esc(fechaLargaF(o.fecha))} · Técnico: <b>${esc(o.tecnico || "")}</b></div></div>
      <span class="marca-orden ${est.clase}">${est.txt}</span>
    </div>
    <div class="kpis">
      <div class="kpi ok"><div class="n">${o.hechos}</div><div class="t">Puntos realizados</div></div>
      <div class="kpi ${o.no_realizados ? "mal" : ""}"><div class="n">${o.no_realizados}</div><div class="t">No realizados</div></div>
      <div class="kpi ${o.pendientes_puntos ? "mal" : "ok"}"><div class="n">${o.pendientes_puntos}</div><div class="t">Puntos sin firmar</div></div>
    </div>
    <div class="tarjeta">
      <h2>Lo que hizo el técnico</h2>
      ${o.registros > o.puntos ? `<p style="margin:-4px 0 8px;color:var(--suave);font-size:13px">${o.registros} registros de ${o.puntos} puntos: algunos se registraron más de una vez y en los totales cuentan una sola vez.</p>` : ""}
      <div class="tabla-orden">
        ${o.servicios.map((s) => `
          <div class="fila-orden ${s.no_realizado ? "nr" : ""}" ${s.inspeccion_id ? `data-insp="${esc(s.inspeccion_id)}"` : ""}>
            <span class="fo-hora">${horaF(s.hora)}</span>
            <span class="fo-punto">${esc(s.icono || "•")} <b>${esc(s.punto || "")}</b><small>${esc([s.tipo, s.area].filter(Boolean).join(" · "))}</small></span>
            <span class="fo-res">${s.no_realizado ? `No realizado${s.motivo ? ` · ${esc((typeof MOTIVOS_TEXTO !== "undefined" && MOTIVOS_TEXTO[s.motivo]) || s.motivo)}` : ""}`
              : s.nivel_actividad && s.nivel_actividad !== "ninguna" ? `Con actividad (${esc(s.nivel_actividad)})` : "Realizado"}${s.fotos ? ` · 📷 ${s.fotos}` : ""}
              <br><small class="${s.firma_id ? "ok-firma" : "sin-firma"}">${s.firma_id ? `✍️ ${esc(quienFirmo.get(s.firma_id)?.firmante_nombre || "Firmado")}` : "Sin firmar"}</small></span>
          </div>`).join("")}
      </div>
    </div>
    ${o.firmas.length ? `<div class="tarjeta">
      <h2>Recibido conforme · ${o.firmas.length} firma${o.firmas.length === 1 ? "" : "s"}</h2>
      ${o.firmas.map((f) => `
        <div class="firma-bloque">
          <div class="firma-parte">${esc(f.parte || "Todo el servicio")} · ${f.puntos} punto(s)</div>
          ${f.imagen ? `<img class="firma-img" src="${esc(f.imagen)}" alt="Firma de ${esc(f.firmante_nombre)}">` : ""}
          <p style="margin:6px 0 0"><b>${esc(f.firmante_nombre)}</b>${f.firmante_cargo ? ` · ${esc(f.firmante_cargo)}` : ""}<br>
            <small>${esc(new Date(f.created_at).toLocaleString("es-DO"))} · ${origenF(f.origen)}</small></p>
          ${f.comentario ? `<p><b>Comentario:</b> ${esc(f.comentario)}</p>` : ""}
        </div>`).join("")}
    </div>` : ""}
    ${o.areas_pendientes.length ? `<div class="tarjeta" id="zona-firma">
      <h2>Firmar lo que falta</h2>
      <p style="margin:0 0 10px;color:var(--suave);font-size:13px">Marca las áreas que recibiste. Lo que no marques queda para otra firma.</p>
      ${o.grupos.length ? `<div class="firma-modos-p">${o.grupos.map((g) => `<button type="button" class="btn" data-grupo="${esc(g.id)}">👤 ${esc(g.cargo)} · ${g.puntos} punto(s)</button>`).join("")}
        <button type="button" class="btn" data-grupo="__todo">📋 Todo lo pendiente</button></div>` : ""}
      <div class="firma-areas-p">
        ${o.areas_pendientes.map((a) => `<label class="firma-area-p"><input type="checkbox" data-area="${esc(String(a.area_id))}" checked> <span>${esc(a.area)}</span> <small>${a.puntos} punto(s)</small></label>`).join("")}
      </div>
      <div class="form-firma">
        <label>Nombre de quien recibe<input id="ff-nombre" value="${esc(USUARIO?.nombre || "")}"></label>
        <label>Cargo<input id="ff-cargo" placeholder="Ama de llaves, Chef, Calidad, Supervisor…" value="${esc(PERFIL_PORTAL?.perfil === "ama_llaves" ? "Ama de llaves" : "")}"></label>
        <label class="ancho">Comentario (opcional)<input id="ff-comentario" placeholder="Solo si hay algo que anotar"></label>
      </div>
      <div id="ff-pad"></div>
      <button class="btn principal" id="ff-firmar" style="margin-top:10px;width:100%">✍️ Firmar</button>
    </div>` : ""}`;
  if (typeof engancharServicios === "function") engancharServicios($("#hoja-cuerpo", hoja));
  if (!o.areas_pendientes.length) return;

  let parte = "";
  const marcadas = () => o.areas_pendientes.filter((a) => hoja.querySelector(`[data-area="${CSS.escape(String(a.area_id))}"]`)?.checked);
  const contar = () => {
    const a = marcadas();
    $("#ff-firmar", hoja).textContent = a.length ? `✍️ Firmar ${a.reduce((n, x) => n + x.puntos, 0)} punto(s)${a.length === o.areas_pendientes.length ? " · todo lo pendiente" : ""}` : "Marca al menos un área";
  };
  contar();
  hoja.querySelectorAll("[data-area]").forEach((c) => c.addEventListener("change", () => { parte = ""; contar(); }));
  hoja.querySelectorAll("[data-grupo]").forEach((b) => b.addEventListener("click", () => {
    const g = o.grupos.find((x) => x.id === b.dataset.grupo);
    hoja.querySelectorAll("[data-area]").forEach((c) => { c.checked = !g || g.areas.map(String).includes(c.dataset.area); });
    parte = g ? g.cargo : "";
    if (g && !$("#ff-cargo", hoja).value.trim()) $("#ff-cargo", hoja).value = g.cargo;
    contar();
  }));
  const pad = padFirma($("#ff-pad", hoja));
  $("#ff-firmar", hoja).addEventListener("click", async (e) => {
    const areas = marcadas();
    if (!areas.length) return alert("Marca al menos un área.");
    const nombre = $("#ff-nombre", hoja).value.trim();
    if (nombre.length < 3) return alert("Escribe el nombre de quien recibe el servicio.");
    if (pad.vacia()) return alert("Falta la firma: firma en el recuadro.");
    e.target.disabled = true; e.target.textContent = "Guardando…";
    const todo = areas.length === o.areas_pendientes.length;
    try {
      await POST("/firmas", {
        sitio_id: PLANTA.id, fecha: o.fecha, clave: o.clave, firmante_nombre: nombre,
        firmante_cargo: $("#ff-cargo", hoja).value, comentario: $("#ff-comentario", hoja).value, firma: pad.imagen(),
        ...(todo ? {} : { inspecciones: areas.flatMap((a) => a.inspecciones) }), ...(parte ? { parte } : {}),
      });
      cerrar();
      alFirmar?.();
    } catch (err) {
      alert(err.message);
      e.target.disabled = false; contar();
    }
  });
}
