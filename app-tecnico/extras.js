// extras.js — App del técnico: cronograma de la semana y chinche / código rosa
//
// Se carga antes de app.js; usa sus utilidades (GET, POST, api, encabezado,
// app, esc, aviso, guardarCache, leerCache, SITIO) cuando ya están definidas,
// porque todo esto corre después del arranque.
//
//   #/cronograma         — la semana del hotel activo (de la programación)
//   #/incidencias        — casos de chinche / código rosa del hotel
//   #/incidencia/<id>    — el caso: verificaciones y resultado; los pasos del
//                          protocolo se marcan al hacerlos

const TZ_RD = { timeZone: "America/Santo_Domingo" };
const DIAS_SEM = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const fechaRDt = (iso) => new Date(iso).toLocaleDateString("en-CA", TZ_RD);
const horaRDt = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { ...TZ_RD, hour: "2-digit", minute: "2-digit" }) : "");
const masDias = (f, n) => {
  const d = new Date(f + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const lunesT = (f) => masDias(f, -((new Date(f + "T12:00:00Z").getUTCDay() + 6) % 7));
let SEMANA_T = null;

// ── Cronograma ───────────────────────────────────────────────────────────
async function pantallaCronograma() {
  if (!SITIO) return elegirHotel();
  const hoyRD = fechaRDt(new Date());
  if (!SEMANA_T) SEMANA_T = lunesT(hoyRD);
  const hasta = masDias(SEMANA_T, 6);
  encabezado("Cronograma", SITIO.nombre);
  const cuerpo = document.createElement("div");
  cuerpo.className = "contenido";
  cuerpo.innerHTML = `<div class="cargando">Cargando…</div>`;
  app().appendChild(cuerpo);

  const clave = `crono:${SITIO.id}:${SEMANA_T}`;
  let r;
  try {
    r = await GET(`/cronograma?sitio_id=${SITIO.id}&desde=${SEMANA_T}&hasta=${hasta}`);
    await guardarCache(clave, r);
  } catch (e) {
    r = await leerCache(clave);
    if (!r) {
      cuerpo.innerHTML = `<div class="vacio"><span class="emoji">📡</span>${esc(e.status ? e.message : "Sin señal. Ábrelo una vez con conexión para tenerlo en el teléfono.")}</div>`;
      return;
    }
  }
  if (!cuerpo.isConnected) return;

  const dias = [...Array(7)].map((_, i) => masDias(SEMANA_T, i));
  cuerpo.innerHTML = `
    <div class="semana-nav">
      <button class="btn secundario" id="sem-ant">◀</button>
      <strong>${SEMANA_T.slice(8)}/${SEMANA_T.slice(5, 7)} – ${hasta.slice(8)}/${hasta.slice(5, 7)}</strong>
      <button class="btn secundario" id="sem-sig">▶</button>
    </div>
    ${r.filas.length ? "" : `<div class="vacio"><span class="emoji">📅</span>No hay servicios programados esta semana.</div>`}
    ${dias.map((d, i) => {
      const del = r.filas.filter((f) => fechaRDt(f.fecha_inicio) === d);
      if (!del.length) return "";
      return `
        <div class="grupo-area" ${d === hoyRD ? 'style="color:var(--azul)"' : ""}>${DIAS_SEM[i]} ${d.slice(8)}/${d.slice(5, 7)}${d === hoyRD ? " · HOY" : ""}</div>
        ${del.map((f) => `
          <div class="punto ${f.estado === "realizado" ? "hecho" : ""}" data-crono="${esc(f.id)}">
            <span class="icono">🕘</span>
            <div class="texto">
              <div class="codigo">${horaRDt(f.fecha_inicio)}${f.fecha_fin ? ` – ${horaRDt(f.fecha_fin)}` : ""}</div>
              <div class="detalle">${esc(f.notas || f.titulo)}</div>
              ${f.equipo ? `<div class="detalle">👷 ${esc(f.equipo)}</div>` : ""}
            </div>
            <span class="marca">${f.estado === "realizado" ? "✅" : f.estado === "cancelado" ? "✖" : ""}</span>
          </div>`).join("")}`;
    }).join("")}`;

  $("#sem-ant", cuerpo).addEventListener("click", () => { SEMANA_T = masDias(SEMANA_T, -7); pantallaCronograma(); });
  $("#sem-sig", cuerpo).addEventListener("click", () => { SEMANA_T = masDias(SEMANA_T, 7); pantallaCronograma(); });
  cuerpo.querySelectorAll("[data-crono]").forEach((el) =>
    el.addEventListener("click", async () => {
      const f = r.filas.find((x) => x.id === el.dataset.crono);
      if (!f || f.estado === "cancelado") return;
      const nuevo = f.estado === "realizado" ? "pendiente" : "realizado";
      if (!confirm(nuevo === "realizado" ? "¿Marcar este servicio como realizado?" : "¿Volver a ponerlo como pendiente?")) return;
      try {
        await api(`/cronograma/${f.id}/estado`, { method: "PATCH", body: JSON.stringify({ estado: nuevo }) });
        pantallaCronograma();
      } catch (e) { aviso(e.message, "error"); }
    })
  );
}

// ── Chinche / código rosa ────────────────────────────────────────────────
const ESTADO_INC_T = {
  abierta: ["Por verificar", "roja"],
  en_tratamiento: ["En tratamiento", "ambar"],
  negativa: ["Sin chinche", "verde"],
  cerrada: ["Liberada", "verde"],
  cancelada: ["Cancelada", ""],
};

async function bloqueIncidencias(caja) {
  if (!SITIO || !caja) return;
  let lista = [];
  try {
    lista = await GET(`/incidencias?sitio_id=${SITIO.id}&estado=abiertas`);
    await guardarCache(`incidencias:${SITIO.id}`, lista);
  } catch {
    lista = (await leerCache(`incidencias:${SITIO.id}`)) || [];
  }
  if (!caja.isConnected || !lista.length) { caja.innerHTML = ""; return; }
  caja.innerHTML = `
    <div class="grupo-area" style="color:var(--rojo)">🛏️ Chinche / código rosa · ${lista.length}</div>
    ${lista.map(filaIncidencia).join("")}`;
  caja.querySelectorAll("[data-inc]").forEach((el) => el.addEventListener("click", () => (location.hash = `#/incidencia/${el.dataset.inc}`)));
}

function filaIncidencia(i) {
  const [t, c] = ESTADO_INC_T[i.estado] || [i.estado, ""];
  return `
    <div class="punto ${i.estado === "abierta" ? "vencido" : ""}" data-inc="${esc(i.id)}">
      <span class="icono">🛏️</span>
      <div class="texto">
        <div class="codigo">Habitación ${esc(i.numero_habitacion)} <span class="etiqueta ${c}">${esc(t)}</span></div>
        <div class="detalle">${esc(i.numero)} · ${i.tipo === "codigo_rosa" ? "Código rosa" : "Chinche"} · verificado ${i.verificaciones_hechas}/${i.verificaciones_total}${i.protocolo_total ? ` · protocolo ${i.protocolo_hechos}/${i.protocolo_total}` : ""}</div>
      </div>
      <span class="marca">›</span>
    </div>`;
}

async function pantallaIncidencias() {
  if (!SITIO) return elegirHotel();
  encabezado("Chinche / código rosa", SITIO.nombre);
  const cuerpo = document.createElement("div");
  cuerpo.className = "contenido";
  cuerpo.innerHTML = `<div class="cargando">Cargando…</div>`;
  app().appendChild(cuerpo);
  try {
    const lista = await GET(`/incidencias?sitio_id=${SITIO.id}&estado=todas`);
    if (!cuerpo.isConnected) return;
    cuerpo.innerHTML = lista.length
      ? lista.slice(0, 60).map(filaIncidencia).join("")
      : `<div class="vacio"><span class="emoji">🛏️</span>No hay casos de chinche en este hotel.</div>`;
    cuerpo.querySelectorAll("[data-inc]").forEach((el) => el.addEventListener("click", () => (location.hash = `#/incidencia/${el.dataset.inc}`)));
  } catch (e) {
    cuerpo.innerHTML = `<div class="vacio"><span class="emoji">📡</span>${esc(e.message)}</div>`;
  }
}

async function pantallaIncidencia(id) {
  encabezado("Chinche / código rosa", SITIO?.nombre || "");
  const cuerpo = document.createElement("div");
  cuerpo.className = "contenido";
  cuerpo.innerHTML = `<div class="cargando">Cargando…</div>`;
  app().appendChild(cuerpo);

  let i, plantilla;
  try {
    [i, plantilla] = await Promise.all([GET(`/incidencias/${id}`), GET("/incidencias/protocolo")]);
  } catch (e) {
    cuerpo.innerHTML = `<div class="vacio"><span class="emoji">📡</span>${esc(e.status ? e.message : "Necesitas señal para abrir el caso.")}</div>`;
    return;
  }
  if (!cuerpo.isConnected) return;

  const abierta = ["abierta", "en_tratamiento"].includes(i.estado);
  const hechas = i.verificaciones.filter((v) => v.hecho).length;
  const todas = hechas === i.verificaciones.length;
  const [et, ec] = ESTADO_INC_T[i.estado] || [i.estado, ""];

  cuerpo.innerHTML = `
    <div class="tarjeta">
      <h2>Habitación ${esc(i.numero_habitacion)} <span class="etiqueta ${ec}">${esc(et)}</span></h2>
      <p>${esc(i.numero)} · ${i.tipo === "codigo_rosa" ? "Código rosa" : "Chinche"}${i.nivel ? ` · nivel ${esc(i.nivel)}` : ""}</p>
      ${i.descripcion ? `<p style="margin-top:6px">📝 ${esc(i.descripcion)}</p>` : ""}
    </div>

    <div class="grupo-area">1. Verificaciones · ${hechas}/${i.verificaciones.length}</div>
    ${i.verificaciones.map((v) => `
      <label class="punto ${v.hecho ? "hecho" : ""}" style="cursor:pointer">
        <input type="checkbox" data-v="${esc(v.id)}" ${v.hecho ? "checked" : ""} ${abierta ? "" : "disabled"} style="width:24px;height:24px;flex-shrink:0" />
        <div class="texto"><div class="codigo" style="font-weight:600">${esc(v.texto)}</div>
          ${v.hecho ? `<div class="detalle">${esc(v.por || "")}</div>` : ""}</div>
      </label>`).join("")}

    ${abierta ? `
      <div class="grupo-area">2. ¿Se encontró chinche?</div>
      ${todas ? "" : `<p style="color:var(--rojo);font-size:14px">Marca todas las verificaciones para dar el resultado.</p>`}
      <button class="btn peligro" id="inc-si" ${todas ? "" : "disabled"}>🔴 Sí, hay chinche</button>
      <button class="btn" id="inc-no" ${todas ? "" : "disabled"} style="background:var(--verde)">🟢 No hay chinche${i.estado === "en_tratamiento" ? " — liberar" : ""}</button>
      <div id="inc-cond" style="display:none;margin-top:12px">
        <div class="grupo-area">¿Qué se encontró?</div>
        ${plantilla.condiciones.map((c) => `
          <label class="punto" style="cursor:pointer">
            <input type="checkbox" value="${esc(c.codigo)}" class="cond" style="width:24px;height:24px;flex-shrink:0" />
            <div class="texto"><div class="codigo" style="font-weight:600">${esc(c.texto)}</div></div>
          </label>`).join("")}
        <button class="btn peligro" id="inc-confirmar">Confirmar positivo</button>
      </div>` : ""}

    ${i.protocolo?.length ? `
      <div class="grupo-area">3. Protocolo · ${i.protocolo.filter((p) => p.hecho).length}/${i.protocolo.length}</div>
      ${i.protocolo.map((p) => `
        <label class="punto ${p.hecho ? "hecho" : ""}" style="cursor:pointer">
          <input type="checkbox" data-p="${esc(p.id)}" ${p.hecho ? "checked" : ""} ${abierta ? "" : "disabled"} style="width:24px;height:24px;flex-shrink:0" />
          <div class="texto"><div class="codigo" style="font-weight:600">${esc(p.texto)}</div>
            <div class="detalle">${p.fecha ? `📅 ${p.fecha.slice(8)}/${p.fecha.slice(5, 7)}` : ""}${p.hecho ? ` · ${esc(p.por || "")}` : ""}</div></div>
        </label>`).join("")}
      ${i.estado === "en_tratamiento" ? `<button class="btn secundario" id="inc-reverificar">↻ Empezar verificación final</button>` : ""}` : ""}
  `;

  const guardar = async (cuerpoPatch) => {
    try {
      await api(`/incidencias/${i.id}`, { method: "PATCH", body: JSON.stringify(cuerpoPatch) });
      pantallaIncidencia(i.id);
    } catch (e) { aviso(e.message, "error"); }
  };
  cuerpo.querySelectorAll("[data-v]").forEach((c) => c.addEventListener("change", () => {
    guardar({ verificaciones: i.verificaciones.map((v) => ({ ...v, hecho: v.id === c.dataset.v ? c.checked : v.hecho })) });
  }));
  cuerpo.querySelectorAll("[data-p]").forEach((c) => c.addEventListener("change", () => {
    guardar({ protocolo: i.protocolo.map((p) => ({ ...p, hecho: p.id === c.dataset.p ? c.checked : p.hecho })) });
  }));
  $("#inc-si", cuerpo)?.addEventListener("click", () => { $("#inc-cond", cuerpo).style.display = ""; });
  $("#inc-confirmar", cuerpo)?.addEventListener("click", async () => {
    const condiciones = [...cuerpo.querySelectorAll(".cond:checked")].map((x) => x.value);
    if (!condiciones.length) return aviso("Marca al menos una condición", "error");
    try {
      await POST(`/incidencias/${i.id}/resultado`, { resultado: "positivo", condiciones });
      aviso("Positivo registrado. La oficina ya ve el protocolo.");
      pantallaIncidencia(i.id);
    } catch (e) { aviso(e.message, "error"); }
  });
  $("#inc-no", cuerpo)?.addEventListener("click", async () => {
    if (!confirm("¿Confirmas que NO hay chinche en la habitación?")) return;
    try {
      await POST(`/incidencias/${i.id}/resultado`, { resultado: "negativo" });
      aviso("Negativo registrado. La oficina puede emitir el certificado.");
      pantallaIncidencia(i.id);
    } catch (e) { aviso(e.message, "error"); }
  });
  $("#inc-reverificar", cuerpo)?.addEventListener("click", async () => {
    try {
      await POST(`/incidencias/${i.id}/nueva-verificacion`, {});
      pantallaIncidencia(i.id);
    } catch (e) { aviso(e.message, "error"); }
  });
}
