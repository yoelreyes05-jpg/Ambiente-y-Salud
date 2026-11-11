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

async function pantallaFirmaOrden() {
  encabezado("Firma de recibido", SITIO?.nombre);
  const cuerpo = document.createElement("div");
  cuerpo.className = "contenido";
  cuerpo.innerHTML = `<div class="cargando">Cargando…</div>`;
  app().appendChild(cuerpo);
  let d;
  try {
    d = await GET(`/firmas/mia?sitio_id=${SITIO.id}`);
  } catch (e) {
    cuerpo.innerHTML = `<div class="vacio"><span class="emoji">⚠️</span>${esc(esSinSenal(e) ? "Sin señal: la firma necesita conexión. Si no hay, el hotel puede firmar luego en su portal." : e.message)}</div>`;
    return;
  }
  const o = d.orden;
  if (!o) {
    cuerpo.innerHTML = `<div class="vacio"><span class="emoji">✍️</span>Todavía no has subido servicios hoy en este hotel.<br><small>Cuando termines, vuelve aquí para que firmen de recibido.</small></div>`;
    return;
  }
  const hora = (f) => new Date(f).toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit", timeZone: "America/Santo_Domingo" });
  const resumen = `
    <div class="firma-resumen">
      <div><b>${o.hechos}</b> realizado${o.hechos === 1 ? "" : "s"}${o.no_realizados ? ` · <b>${o.no_realizados}</b> no realizado${o.no_realizados === 1 ? "" : "s"}` : ""}</div>
      <div class="firma-sub">${hora(o.desde)} a ${hora(o.hasta)}</div>
      <div class="firma-tipos">${o.tipos.map((t) => `<span>${esc(t.icono || "•")} ${esc(t.nombre || "")} · ${t.n}</span>`).join("")}</div>
    </div>`;
  if (o.estado === "finalizada") {
    cuerpo.innerHTML = `${resumen}
      <div class="firma-ok">✅ Orden finalizada<br><small>Firmó ${esc(o.firma.firmante_nombre)}${o.firma.firmante_cargo ? ` (${esc(o.firma.firmante_cargo)})` : ""} a las ${hora(o.firma.created_at)}</small>
      ${o.hechos + o.no_realizados > o.firma.servicios ? `<br><small>Subiste ${o.hechos + o.no_realizados - o.firma.servicios} servicio(s) después de la firma.</small>` : ""}</div>`;
    return;
  }
  cuerpo.innerHTML = `${resumen}
    <p class="firma-ayuda">Orden <b>en proceso</b>. Pásale el teléfono a la persona del hotel que recibe el servicio para que firme. Con la firma la orden queda <b>finalizada</b>.</p>
    <label class="firma-campo">Nombre de quien recibe<input id="fo-nombre" autocomplete="off"></label>
    <label class="firma-campo">Cargo<input id="fo-cargo" placeholder="Ama de llaves, Calidad, Supervisor…"></label>
    <div id="fo-pad"></div>
    <button class="btn grande" id="fo-firmar" style="margin-top:12px">✍️ Firmar y finalizar</button>
    <p class="firma-ayuda">Si no hay nadie para firmar ahora, el hotel puede firmarla después en su portal (pestaña Firmas).</p>`;
  const pad = padFirma($("#fo-pad", cuerpo));
  $("#fo-firmar", cuerpo).addEventListener("click", async (ev) => {
    const nombre = $("#fo-nombre", cuerpo).value.trim();
    if (nombre.length < 3) return aviso("Escribe el nombre de quien recibe", "error");
    if (pad.vacia()) return aviso("Falta la firma", "error");
    const b = ev.currentTarget;
    b.disabled = true; b.textContent = "Guardando…";
    try {
      await POST("/firmas", { sitio_id: SITIO.id, fecha: d.fecha, clave: o.clave, firmante_nombre: nombre, firmante_cargo: $("#fo-cargo", cuerpo).value, firma: pad.imagen() });
      vibrar([40, 30, 80]);
      aviso("Orden finalizada ✓", "exito");
      location.hash = "#/ruta";
    } catch (e) {
      aviso(esSinSenal(e) ? "Sin señal: no se pudo guardar la firma. Intenta de nuevo o que firmen en el portal." : e.message, "error");
      b.disabled = false; b.textContent = "✍️ Firmar y finalizar";
    }
  });
}
