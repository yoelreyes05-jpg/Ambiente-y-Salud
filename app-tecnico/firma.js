// firma.js — App del técnico: firma de recibido de la orden del día
//
// Lo que el técnico sube hoy en el hotel es su ORDEN del día. Queda "En
// proceso" hasta que alguien del hotel firma de recibido; con la firma queda
// "Finalizada". Aquí la persona del hotel firma en el teléfono del técnico (si
// no está, puede firmarla luego en el portal del hotel, pestaña Firmas).
// Servidor: backend/routes/firmas.js
//
// padFirma() es copia de portal-hotel/firmas.js (cada app se publica sola).
// Se carga antes de app.js y usa sus utilidades (GET, POST, SITIO, aviso…).

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

let FIRMA_DIA = 0;          // 0 = hoy, 1 = ayer
let FIRMA_SITIO = null;     // hotel escogido para la firma

const ESTADO_FIRMA = {
  en_proceso: { ic: "⏳", txt: "En proceso" },
  parcial: { ic: "🟡", txt: "Firmada en parte" },
  finalizada: { ic: "✅", txt: "Finalizada" },
};

async function pantallaFirmaOrden() {
  encabezado("Firma de recibido", "Todo de una vez o por áreas");
  const cuerpo = document.createElement("div");
  cuerpo.className = "contenido";
  cuerpo.innerHTML = `<div class="cargando">Cargando…</div>`;
  app().appendChild(cuerpo);
  const fechaDe = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
  const fecha = fechaDe(FIRMA_DIA);
  const hora = (f) => new Date(f).toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit", timeZone: "America/Santo_Domingo" });
  const recargar = () => { app().innerHTML = ""; pantallaFirmaOrden(); };
  const sinSenal = (e) => `<div class="vacio"><span class="emoji">⚠️</span>${esc(esSinSenal(e) ? "Sin señal: la firma necesita conexión. Si no hay, el hotel puede firmar luego en su portal." : e.message)}</div>`;

  let d;
  try { d = await GET(`/firmas/mias?fecha=${fecha}`); } catch (e) { cuerpo.innerHTML = sinSenal(e); return; }
  const ordenes = d.ordenes || [];
  // Una orden = hotel + técnico (la oficina ve las de todos los técnicos)
  const llave = (o) => `${o.sitio_id}|${o.clave}`;
  if (!ordenes.some((o) => llave(o) === FIRMA_SITIO)) {
    const o0 = ordenes.find((o) => o.sitio_id === SITIO?.id && o.estado !== "finalizada") || ordenes.find((o) => o.estado !== "finalizada") || ordenes[0];
    FIRMA_SITIO = o0 ? llave(o0) : null;
  }
  const dias = `<div class="firma-dias">
    <button type="button" class="cot-chip ${FIRMA_DIA === 0 ? "activa" : ""}" data-dia="0">Hoy</button>
    <button type="button" class="cot-chip ${FIRMA_DIA === 1 ? "activa" : ""}" data-dia="1">Ayer</button></div>`;
  const hoteles = ordenes.length ? `
    <div class="firma-t">${d.oficina ? "¿Cuál orden se firma? (todos los técnicos)" : "¿Para cuál hotel es la firma?"}</div>
    <div class="firma-hoteles">${ordenes.map((x) => `
      <button type="button" class="firma-hotel ${llave(x) === FIRMA_SITIO ? "activa" : ""} ${x.estado}" data-sitio="${esc(llave(x))}">
        <b>${esc(x.planta || "Hotel")}${d.oficina ? ` · ${esc(x.tecnico)}` : ""}</b>
        <small>${x.hechos} punto(s) realizado(s) · ${ESTADO_FIRMA[x.estado].ic} ${ESTADO_FIRMA[x.estado].txt}${x.estado === "parcial" ? ` · faltan ${x.pendientes_puntos}` : ""}</small>
      </button>`).join("")}</div>` : "";
  const engancharArriba = () => {
    cuerpo.querySelectorAll("[data-dia]").forEach((b) => b.addEventListener("click", () => { FIRMA_DIA = Number(b.dataset.dia); FIRMA_SITIO = null; recargar(); }));
    cuerpo.querySelectorAll("[data-sitio]").forEach((b) => b.addEventListener("click", () => { FIRMA_SITIO = b.dataset.sitio; recargar(); }));
  };
  const elegida = ordenes.find((x) => llave(x) === FIRMA_SITIO);
  if (!elegida) {
    cuerpo.innerHTML = `${dias}<div class="vacio"><span class="emoji">✍️</span>${d.oficina ? `No hay servicios registrados ${FIRMA_DIA ? "ayer" : "hoy"} en ningún hotel.` : `No tienes servicios ${FIRMA_DIA ? "de ayer" : "hoy"} en tus hoteles.`}<br><small>Cuando termines (todo o una parte), vuelve aquí para que firmen de recibido.</small></div>`;
    engancharArriba();
    return;
  }

  let o;
  try { o = await GET(`/firmas/orden?${new URLSearchParams({ sitio_id: elegida.sitio_id, fecha: d.fecha, clave: elegida.clave })}`); }
  catch (e) { cuerpo.innerHTML = dias + hoteles + sinSenal(e); engancharArriba(); return; }

  const resumen = `
    <div class="firma-resumen">
      <div><b>${esc(elegida.planta || "")}</b> · ${ESTADO_FIRMA[o.estado].ic} ${ESTADO_FIRMA[o.estado].txt}</div>
      <div class="firma-sub">Técnico: ${esc(o.tecnico || "")}</div>
      <div><b>${o.hechos}</b> punto${o.hechos === 1 ? "" : "s"} realizado${o.hechos === 1 ? "" : "s"}${o.no_realizados ? ` · <b>${o.no_realizados}</b> no realizado${o.no_realizados === 1 ? "" : "s"}` : ""} · ${hora(o.desde)} a ${hora(o.hasta)}</div>
      ${o.registros > o.puntos ? `<div class="firma-sub">${o.registros} registros (un punto registrado varias veces cuenta una)</div>` : ""}
    </div>`;
  const hechas = o.firmas.length ? `
    <div class="firma-t">Firmas de esta orden</div>
    ${o.firmas.map((f) => `<div class="firma-hecha">✅ <b>${esc(f.firmante_nombre)}</b>${f.firmante_cargo ? ` (${esc(f.firmante_cargo)})` : ""} · ${esc(f.parte || "Todo")} · ${f.puntos} punto(s) · ${hora(f.created_at)}</div>`).join("")}` : "";

  if (!o.areas_pendientes.length) {
    cuerpo.innerHTML = `${dias}${hoteles}${resumen}${hechas}<div class="firma-ok">✅ Todo lo subido está firmado</div>`;
    engancharArriba();
    return;
  }

  // Qué se firma: todo lo pendiente, lo de un responsable, o las áreas marcadas
  const seleccion = new Set(o.areas_pendientes.map((a) => String(a.area_id)));
  let cargoSugerido = "", parte = "";
  cuerpo.innerHTML = `${dias}${hoteles}${resumen}${hechas}
    <div class="firma-t">¿Qué se va a firmar ahora?</div>
    <div class="firma-modos">
      <button type="button" class="firma-modo activa" data-modo="todo">📋 Todo lo pendiente · ${o.pendientes_puntos} punto(s)</button>
      ${o.grupos.map((g) => `<button type="button" class="firma-modo" data-grupo="${esc(g.id)}">👤 ${esc(g.cargo)} · ${esc(g.nombres.join(", "))} · ${g.puntos} punto(s)</button>`).join("")}
    </div>
    <div class="firma-areas">
      ${o.areas_pendientes.map((a) => `<label class="firma-area"><input type="checkbox" data-area="${esc(String(a.area_id))}" checked> <span>${esc(a.area)}</span> <small>${a.puntos} punto(s)</small></label>`).join("")}
    </div>
    <p class="firma-ayuda" id="fo-cuenta"></p>
    <label class="firma-campo">Nombre de quien recibe<input id="fo-nombre" autocomplete="off"></label>
    <label class="firma-campo">Cargo<input id="fo-cargo" placeholder="Ama de llaves, Chef, Calidad, Supervisor…"></label>
    <div id="fo-pad"></div>
    <button class="btn grande" id="fo-firmar" style="margin-top:12px">✍️ Firmar</button>
    <p class="firma-ayuda">Puedes firmar una parte ahora y el resto después (con otra persona, o el hotel en su portal, pestaña Firmas).</p>`;
  engancharArriba();

  const pintarSel = (modo) => {
    cuerpo.querySelectorAll(".firma-modo").forEach((b) => b.classList.toggle("activa", b === modo));
    cuerpo.querySelectorAll("[data-area]").forEach((c) => { c.checked = seleccion.has(c.dataset.area); });
    const areas = o.areas_pendientes.filter((a) => seleccion.has(String(a.area_id)));
    const puntos = areas.reduce((n, a) => n + a.puntos, 0);
    $("#fo-cuenta", cuerpo).innerHTML = areas.length ? `Se firman <b>${puntos} punto(s)</b> de: ${esc(areas.map((a) => a.area).join(", "))}` : "Marca al menos un área.";
    $("#fo-firmar", cuerpo).textContent = areas.length ? `✍️ Firmar ${puntos} punto(s)` : "✍️ Firmar";
  };
  pintarSel(cuerpo.querySelector('[data-modo="todo"]'));
  cuerpo.querySelector('[data-modo="todo"]').addEventListener("click", (e) => {
    seleccion.clear(); o.areas_pendientes.forEach((a) => seleccion.add(String(a.area_id))); cargoSugerido = ""; parte = ""; pintarSel(e.currentTarget);
  });
  cuerpo.querySelectorAll("[data-grupo]").forEach((b) => b.addEventListener("click", () => {
    const g = o.grupos.find((x) => x.id === b.dataset.grupo);
    seleccion.clear(); g.areas.forEach((id) => seleccion.add(String(id)));
    cargoSugerido = g.cargo; parte = g.cargo;
    if (!$("#fo-cargo", cuerpo).value.trim() || $("#fo-cargo", cuerpo).dataset.auto) { $("#fo-cargo", cuerpo).value = g.cargo; $("#fo-cargo", cuerpo).dataset.auto = "1"; }
    pintarSel(b);
  }));
  cuerpo.querySelectorAll("[data-area]").forEach((c) => c.addEventListener("change", () => {
    c.checked ? seleccion.add(c.dataset.area) : seleccion.delete(c.dataset.area);
    parte = ""; pintarSel(null);
  }));
  $("#fo-cargo", cuerpo).addEventListener("input", (e) => { delete e.target.dataset.auto; });

  const pad = padFirma($("#fo-pad", cuerpo));
  $("#fo-firmar", cuerpo).addEventListener("click", async (ev) => {
    const areas = o.areas_pendientes.filter((a) => seleccion.has(String(a.area_id)));
    if (!areas.length) return aviso("Marca al menos un área", "error");
    const nombre = $("#fo-nombre", cuerpo).value.trim();
    if (nombre.length < 3) return aviso("Escribe el nombre de quien recibe", "error");
    if (pad.vacia()) return aviso("Falta la firma", "error");
    const b = ev.currentTarget;
    b.disabled = true; b.textContent = "Guardando…";
    const todo = areas.length === o.areas_pendientes.length;
    try {
      const r = await POST("/firmas", {
        sitio_id: elegida.sitio_id, fecha: d.fecha, clave: o.clave,
        firmante_nombre: nombre, firmante_cargo: $("#fo-cargo", cuerpo).value, firma: pad.imagen(),
        ...(todo ? {} : { inspecciones: areas.flatMap((a) => a.inspecciones) }),
        ...(parte ? { parte } : {}),
      });
      vibrar([40, 30, 80]);
      aviso(r.estado === "finalizada" ? `Orden de ${elegida.planta || "el hotel"} finalizada ✓` : `Firmados ${r.puntos} punto(s) · faltan ${r.quedan_puntos}`, "exito");
      recargar();
    } catch (e) {
      aviso(esSinSenal(e) ? "Sin señal: no se pudo guardar la firma. Intenta de nuevo o que firmen en el portal." : e.message, "error");
      b.disabled = false; pintarSel(null);
    }
  });
}
