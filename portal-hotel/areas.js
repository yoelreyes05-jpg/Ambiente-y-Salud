// areas.js — Portal del hotel: pestaña Historial
//
// Una sola barra de filtros (área, desde, hasta) para todo lo de abajo.
// Lo que pide un auditor: "muéstrame la última fumigación del buffet cocina
// central". Se elige el área y salen, en una sola pantalla:
//   · el último servicio (o la última fumigación) con lo que hizo el técnico y
//     sus fotos, para abrirlo o imprimirlo con las evidencias;
//   · lo próximo programado en el cronograma para esa área;
//   · las plagas encontradas en el rango de fechas (al tocar una, dónde);
//   · todos los servicios del rango, por día.
// Sin área elegida, una tabla con cada área: su último servicio y lo próximo.
//
// Se carga antes de app.js; usa sus utilidades (GET, esc, fecha, PLANTA…) en
// tiempo de ejecución, y fechaRDp / horaRDp / masDiasP de extras.js.

let AREA_P = { area: "", desde: null, hasta: null };

// Tipos de punto o servicios del cronograma que son una fumigación / aplicación
const ES_FUMIGACION = /fumig|aplicaci|asperj|aspers|nebuliz|termonebul|tratamiento|desinsect|roci/;
const normP = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

// ¿Esta fila del cronograma es para esta área? El cronograma no guarda el área:
// se busca su nombre en las notas y el título (coincideArea, en extras.js).
const cronoDelArea = (f, area) => coincideArea(f.notas, area.nombre) || coincideArea(f.titulo, area.nombre);

const esFumigacionInsp = (i) => ES_FUMIGACION.test(normP(i.asa_puntos_control?.asa_tipos_punto?.nombre));
const esFumigacionCrono = (f) => ES_FUMIGACION.test(normP(`${f.tipo} ${f.titulo} ${f.notas || ""}`));
const tituloPunto = (i) => {
  const p = i.asa_puntos_control || {};
  return p.numero_habitacion ? `Habitación ${p.numero_habitacion}` : p.nombre || p.codigo_visible || "Punto";
};
const fechaHoraCrono = (f) =>
  `${fecha(fechaRDp(f.fecha_inicio))} · ${horaRDp(f.fecha_inicio)}${f.fecha_fin ? `–${horaRDp(f.fecha_fin)}` : ""}`;

async function vistaHistorial(cuerpo) {
  const hoy = hoyLocal();
  if (!AREA_P.desde) { AREA_P.desde = masDiasP(hoy, -29); AREA_P.hasta = hoy; }
  const areas = await GET(`/sitios/${PLANTA.id}/areas`);
  if (AREA_P.area && !areas.some((a) => a.id === AREA_P.area)) AREA_P.area = "";

  cuerpo.innerHTML = `
    <div class="tarjeta">
      <div class="ar-filtros">
        <label>Área
          <select class="btn" id="ar-area">
            <option value="">Todas las áreas</option>
            ${areas.map((a) => `<option value="${esc(a.id)}"${a.id === AREA_P.area ? " selected" : ""}>${esc(a.nombre)}</option>`).join("")}
          </select>
        </label>
        <label>Desde <input type="date" class="btn" id="ar-desde" value="${esc(AREA_P.desde)}" max="${hoy}" /></label>
        <label>Hasta <input type="date" class="btn" id="ar-hasta" value="${esc(AREA_P.hasta)}" max="${hoy}" /></label>
        <label>Período
          <select class="btn" id="ar-rango">
            <option value="">Escoger…</option>
            <option value="7">Últimos 7 días</option>
            <option value="30">Últimos 30 días</option>
            <option value="90">Últimos 90 días</option>
            <option value="365">Último año</option>
            <option value="mes">Este mes</option>
            <option value="mes-1">Mes pasado</option>
          </select>
        </label>
      </div>
      <div class="ar-acciones">
        <button class="btn principal" id="ar-imprimir">🖨 Imprimir</button>
        <button class="btn" id="btn-pdf">Reporte de auditoría (PDF)</button>
        <button class="btn" id="btn-pdf-pend">Reporte de no realizados</button>
      </div>
    </div>
    <div id="ar-cuerpo"><div class="cargando">Cargando…</div></div>`;

  const recargar = () => {
    AREA_P.area = $("#ar-area").value;
    AREA_P.desde = $("#ar-desde").value || AREA_P.desde;
    AREA_P.hasta = $("#ar-hasta").value || AREA_P.hasta;
    if (AREA_P.hasta < AREA_P.desde) [AREA_P.desde, AREA_P.hasta] = [AREA_P.hasta, AREA_P.desde];
    cargarArea(areas);
  };
  ["#ar-area", "#ar-desde", "#ar-hasta"].forEach((s) => $(s).addEventListener("change", recargar));
  $("#ar-rango").addEventListener("change", (e) => {
    const v = e.target.value;
    if (!v) return;
    if (v === "mes" || v === "mes-1") {
      let [y, m] = hoy.split("-").map(Number);
      if (v === "mes-1") { m--; if (!m) { m = 12; y--; } }
      const ini = `${y}-${String(m).padStart(2, "0")}-01`;
      const fin = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      $("#ar-desde").value = ini;
      $("#ar-hasta").value = fin < hoy ? fin : hoy;
    } else {
      $("#ar-desde").value = masDiasP(hoy, -(Number(v) - 1));
      $("#ar-hasta").value = hoy;
    }
    recargar();
  });
  $("#ar-imprimir").addEventListener("click", () => imprimirAreaP(areas));
  $("#btn-pdf").addEventListener("click", () => descargarReportePdf());
  $("#btn-pdf-pend").addEventListener("click", () => descargarReportePdf("pendientes"));
  await cargarArea(areas);
}

// Todo lo que muestra la pestaña, también lo usa la impresión.
let DATOS_AREA_P = null;

async function cargarArea(areas) {
  const caja = $("#ar-cuerpo");
  caja.innerHTML = `<div class="cargando">Cargando…</div>`;
  const area = areas.find((a) => a.id === AREA_P.area) || null;
  const hoy = hoyLocal();
  const q = (extra) => new URLSearchParams({ sitio_id: PLANTA.id, ...(area ? { area_id: area.id } : {}), ...extra });

  let recientes, servicios, crono, hallazgos;
  try {
    [recientes, servicios, crono, hallazgos] = await Promise.all([
      // Lo último de cada área (o de esta), sin límite de fechas: el auditor pide
      // "la última", aunque haya sido antes del rango elegido.
      GET(`/inspecciones?${q({ limite: area ? 300 : 1000 })}`),
      GET(`/inspecciones?${q({ desde: AREA_P.desde, hasta: AREA_P.hasta, limite: 1000 })}`),
      GET(`/cronograma?sitio_id=${PLANTA.id}&desde=${hoy}&hasta=${masDiasP(hoy, 180)}`).catch(() => ({ filas: [] })),
      GET(`/hallazgos?sitio_id=${PLANTA.id}`).catch(() => []),
    ]);
  } catch (e) {
    caja.innerHTML = `<div class="error">${esc(e.message)}</div>`;
    return;
  }
  const hechas = (l) => (Array.isArray(l) ? l : l.inspecciones || []).filter((i) => !i.motivo_no_realizado);
  recientes = hechas(recientes);
  servicios = Array.isArray(servicios) ? servicios : servicios.inspecciones || [];
  const proximos = (crono.filas || []).filter((f) => f.estado === "pendiente" || f.estado === "reprogramado");

  DATOS_AREA_P = { area, servicios, proximos, recientes };

  caja.innerHTML = area
    ? await htmlUnaArea(area, recientes, proximos)
    : htmlTodasLasAreas(areas, recientes, proximos);
  caja.insertAdjacentHTML("afterbegin", htmlHallazgosPorCorregir(hallazgos, area));
  caja.insertAdjacentHTML("beforeend", `<div id="pl-estadisticas"></div>` + htmlServiciosRango(servicios));

  engancharServicios(caja);
  $("#ar-hall-cab", caja)?.addEventListener("click", () => {
    const lista = $("#ar-hall-lista", caja);
    lista.hidden = !lista.hidden;
    $("#ar-hall-cab", caja).classList.toggle("abierto", !lista.hidden);
  });
  $$("[data-ir-area]", caja).forEach((b) => b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    $("#ar-area").value = b.dataset.irArea;
    $("#ar-area").dispatchEvent(new Event("change"));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }));
  $("#ar-evidencias", caja)?.addEventListener("click", () => imprimirEvidenciasP(DATOS_AREA_P.ultimoDia || []));
  // Las plagas, con la misma área y fechas (plagas.js). Tocar una plaga
  // despliega dónde se encontró.
  await montarEstadisticasPlagas($("#pl-estadisticas", caja), { desde: AREA_P.desde, hasta: AREA_P.hasta, area_id: area?.id }).catch(() => {});
}

// ── Hallazgos por corregir ───────────────────────────────────────────────
// El mismo número que sale en el reporte PDF ("Hallazgos por corregir"). Al
// tocarlo se despliega cuáles son; cada uno abre el servicio donde se reportó,
// con lo que vio el técnico y sus fotos.
const SEVERIDAD_P = { critica: ["Crítica", "mal"], alta: ["Alta", "alerta"], media: ["Media", "neutra"], baja: ["Baja", "neutra"] };
function htmlHallazgosPorCorregir(lista, area) {
  const todos = (Array.isArray(lista) ? lista : lista?.hallazgos || [])
    .filter((h) => h.estado === "abierto" || h.estado === "en_proceso")
    .filter((h) => !area || h.area_id === area.id);
  if (!todos.length) return "";
  return `
    <div class="tarjeta ar-hall">
      <button type="button" class="ar-hall-cab" id="ar-hall-cab">
        <span>⚠️ <strong>${todos.length}</strong> hallazgo${todos.length === 1 ? "" : "s"} por corregir${area ? ` · ${esc(area.nombre)}` : ""}</span>
        <span class="ar-hall-ver">Ver cuál${todos.length === 1 ? "" : "es"} ▾</span>
      </button>
      <div id="ar-hall-lista" hidden>
        ${todos.map((h) => {
          const [sev, cls] = SEVERIDAD_P[h.severidad] || [h.severidad || "Media", "neutra"];
          return `
          <div class="registro${h.inspeccion_id ? " clicable" : ""}"${h.inspeccion_id ? ` data-insp="${esc(h.inspeccion_id)}"` : ""}>
            <div class="cab">
              <div>
                <div class="punto">${esc(h.titulo || "Hallazgo")} <span class="marca ${cls}">${esc(sev)}</span></div>
                ${h.descripcion && h.descripcion !== h.titulo ? `<div class="meta">${esc(h.descripcion)}</div>` : ""}
                <div class="meta">${esc([h.asa_puntos_control?.codigo_visible, h.asa_areas?.nombre, h.responsable === "asa" ? "Lo corrige ASA" : "Lo corrige el hotel", h.estado === "en_proceso" ? "En proceso" : "Por corregir"].filter(Boolean).join(" · "))}</div>
                ${h.fecha_limite ? `<div class="meta">Fecha límite: ${esc(fecha(h.fecha_limite))}</div>` : ""}
              </div>
              <div class="fecha">${esc(fecha(h.fecha_reporte || h.created_at))}
                ${h.inspeccion_id ? `<div class="marca neutra" style="margin-top:4px">ver evidencia</div>` : ""}</div>
            </div>
          </div>`;
        }).join("")}
      </div>
    </div>`;
}

// ── Un área: último servicio / última fumigación y lo próximo ─────────────
async function htmlUnaArea(area, recientes, proximos) {
  const fumig = recientes.find(esFumigacionInsp);
  const ultima = fumig || recientes[0];
  let delDia = [];
  if (ultima) {
    const dia = String(ultima.fecha_local || ultima.fecha).slice(0, 10);
    const r = await GET(`/inspecciones?sitio_id=${PLANTA.id}&area_id=${area.id}&desde=${dia}&hasta=${dia}&limite=1000`).catch(() => []);
    delDia = (Array.isArray(r) ? r : []).filter((i) => !i.motivo_no_realizado);
    if (fumig) delDia = delDia.filter(esFumigacionInsp);
    if (!delDia.length) delDia = [ultima];
  }
  DATOS_AREA_P.ultimoDia = delDia;
  DATOS_AREA_P.ultimaEsFumigacion = !!fumig;

  const delArea = proximos.filter((f) => cronoDelArea(f, area));
  const lista = delArea.length ? delArea : proximos;
  const fotos = (i) => (Array.isArray(i.fotos) ? i.fotos.length : 0);

  return `
    <div class="tarjeta">
      <div class="pl-cab">
        <h2>${fumig ? "🧪 Última aplicación" : "🕘 Último servicio"} · ${esc(area.nombre)}</h2>
        ${delDia.length ? `<button class="btn principal" id="ar-evidencias">🖨 Imprimir con evidencias</button>` : ""}
      </div>
      ${ultima ? `
        <p class="pl-nota">${esc(fecha(String(ultima.fecha_local || ultima.fecha).slice(0, 10)))} · ${delDia.length} ${delDia.length === 1 ? "registro" : "registros"} del técnico.</p>
        ${delDia.map((i) => `
          <div class="registro clicable" data-insp="${esc(i.id)}">
            <div class="cab">
              <div>
                <div class="punto">${esc(tituloPunto(i))}
                  <span class="marca ${i.nivel_actividad && i.nivel_actividad !== "ninguna" ? "alerta" : "ok"}">${esc(i.nivel_actividad && i.nivel_actividad !== "ninguna" ? NIVEL_TEXTO[i.nivel_actividad] : "Conforme")}</span>
                </div>
                <div class="meta">${esc([i.asa_puntos_control?.asa_tipos_punto?.nombre, i.asa_empleados?.nombre_completo].filter(Boolean).join(" · "))}</div>
                ${i.notas ? `<div class="meta">${esc(i.notas)}</div>` : ""}
              </div>
              <div class="fecha">${esc(horaCorta(i.fecha))}
                ${fotos(i) ? `<div class="marca neutra" style="margin-top:4px">${fotos(i)} fotos</div>` : ""}</div>
            </div>
          </div>`).join("")}`
      : `<div class="vacio">Todavía no hay servicios registrados en esta área.</div>`}
    </div>

    <div class="tarjeta">
      <h2>📅 Próximo programado ${delArea.length ? `· ${esc(area.nombre)}` : "en el hotel"}</h2>
      ${!delArea.length && proximos.length ? `<p class="pl-nota">El cronograma no menciona esta área por su nombre. Estos son los próximos servicios programados del hotel.</p>` : ""}
      ${lista.length ? htmlListaCrono(lista.slice(0, 8)) : `<div class="vacio">No hay servicios programados en los próximos 6 meses.</div>`}
    </div>`;
}

function htmlListaCrono(filas) {
  return filas.map((f, n) => `
    <div class="registro${n === 0 ? " ar-proximo" : ""}">
      <div class="cab">
        <div>
          <div class="punto">${esc(nombreServicioCr(f))}
            ${esFumigacionCrono(f) ? `<span class="marca alerta">aplicación</span>` : ""}
            ${f.estado === "reprogramado" ? `<span class="marca neutra">reprogramado</span>` : ""}</div>
          ${detalleServicioCr(f) ? `<div class="meta">${esc(detalleServicioCr(f))}</div>` : ""}
        </div>
        <div class="fecha">${esc(fechaHoraCrono(f))}</div>
      </div>
    </div>`).join("");
}

// ── Todas las áreas: una fila por área ───────────────────────────────────
function htmlTodasLasAreas(areas, recientes, proximos) {
  const ultimoDe = new Map(), fumigDe = new Map();
  for (const i of recientes) {
    if (!ultimoDe.has(i.area_id)) ultimoDe.set(i.area_id, i);
    if (!fumigDe.has(i.area_id) && esFumigacionInsp(i)) fumigDe.set(i.area_id, i);
  }
  const dia = (i) => (i ? fecha(String(i.fecha_local || i.fecha).slice(0, 10)) : "—");
  return `
    <details class="tarjeta ar-plegable">
      <summary><h2>🗂 Áreas del hotel (${areas.length}) · último servicio y próxima aplicación</h2></summary>
      <p class="pl-nota">Toca un área para ver su última aplicación con evidencias.</p>
      <div class="pl-tabla-scroll">
        <table class="pl-tabla ar-tabla">
          <thead><tr><th>Área</th><th>Último servicio</th><th>Última aplicación</th><th>Próximo programado</th></tr></thead>
          <tbody>
            ${areas.map((a) => {
              const prox = proximos.find((f) => cronoDelArea(f, a));
              return `<tr class="clicable" data-ir-area="${esc(a.id)}">
                <td><strong>${esc(a.nombre)}</strong></td>
                <td>${esc(dia(ultimoDe.get(a.id)))}</td>
                <td>${esc(dia(fumigDe.get(a.id)))}</td>
                <td>${prox ? esc(fechaHoraCrono(prox)) : "—"}</td></tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </details>`;
}

// Habitación o punto, área y fecha de cada registro de una plaga. También la
// usa Historial (plagas.js).
function tablaDondePlaga(lista, plaga) {
  if (!lista.length) return `<p class="pl-nota">Sin registros de ${esc(plaga)}.</p>`;
  const porArea = {};
  for (const x of lista) porArea[x.area] = (porArea[x.area] || 0) + x.cantidad;
  return `
    <h3 class="pl-sub">Dónde se encontró: ${esc(plaga)}</h3>
    <p class="pl-nota">${Object.entries(porArea).sort((a, b) => b[1] - a[1]).map(([a, n]) => `${esc(a)}: <strong>${n}</strong>`).join(" · ")}</p>
    <div class="pl-tabla-scroll"><table class="pl-tabla">
      <thead><tr><th>Habitación / punto</th><th>Área</th><th>Fecha</th><th>Cant.</th></tr></thead>
      <tbody>${lista.slice(0, 300).map((x) => `
        <tr class="clicable"${x.inspeccion_id ? ` data-insp="${esc(x.inspeccion_id)}"` : ""}>
          <td>${esc(x.punto)}</td><td>${esc(x.area)}</td><td>${esc(x.fecha ? fecha(x.fecha) : "")}</td><td><strong>${x.cantidad}</strong></td>
        </tr>`).join("")}</tbody>
    </table></div>
    ${lista.length > 300 ? `<p class="pl-nota">Se muestran 300 de ${lista.length}.</p>` : `<p class="pl-nota">Toca una fila para ver el servicio con sus fotos.</p>`}`;
}

// ── Servicios del rango, por día ─────────────────────────────────────────
function htmlServiciosRango(lista) {
  const porDia = {};
  for (const i of lista) (porDia[String(i.fecha_local || i.fecha).slice(0, 10)] ||= []).push(i);
  const dias = Object.keys(porDia).sort().reverse();
  return `
    <div class="tarjeta">
      <h2>📋 Servicios del período${DATOS_AREA_P.area ? ` · ${esc(DATOS_AREA_P.area.nombre)}` : ""}</h2>
      ${!lista.length ? `<div class="vacio">No hay servicios registrados en ese período.</div>` : `
        <p class="pl-nota">${lista.length} ${lista.length === 1 ? "registro" : "registros"} en ${dias.length} ${dias.length === 1 ? "día" : "días"}.${lista.length >= 1000 ? " Se muestran los 1000 más recientes: acorta el rango para ver el resto." : ""}</p>
        ${dias.map((d) => `
          <div class="dia-cabecera">${esc(fecha(d))} · ${porDia[d].length}</div>
          ${porDia[d].map((i) => {
            const noHecho = !!i.motivo_no_realizado;
            const nivel = i.nivel_actividad && i.nivel_actividad !== "ninguna";
            const nf = Array.isArray(i.fotos) ? i.fotos.length : 0;
            return `
            <div class="registro clicable" data-insp="${esc(i.id)}">
              <div class="cab">
                <div>
                  <div class="punto">${esc(tituloPunto(i))}
                    <span class="marca ${noHecho ? "nopudo" : nivel ? "alerta" : "ok"}">${esc(noHecho ? "No realizado" : nivel ? NIVEL_TEXTO[i.nivel_actividad] : "Conforme")}</span></div>
                  <div class="meta">${esc([i.asa_puntos_control?.asa_tipos_punto?.nombre, DATOS_AREA_P.area ? null : i.asa_areas?.nombre, i.asa_empleados?.nombre_completo].filter(Boolean).join(" · "))}</div>
                </div>
                <div class="fecha">${esc(horaCorta(i.fecha))}${nf ? `<div class="marca neutra" style="margin-top:4px">${nf} fotos</div>` : ""}</div>
              </div>
            </div>`;
          }).join("")}`).join("")}`}
    </div>`;
}

// ── Imprimir ─────────────────────────────────────────────────────────────
// Se imprime dentro de la página (#area-impresion), con los estilos del portal.
async function imprimirEnPaginaP(titulo, html) {
  document.getElementById("area-impresion")?.remove();
  const capa = document.createElement("div");
  capa.id = "area-impresion";
  capa.innerHTML = `
    <div class="imp-encabezado">
      <div>
        <h1>${esc(CONFIG.EMPRESA)}</h1>
        <p>${esc(titulo)}</p>
        <p>${esc(PLANTA.nombre)}</p>
      </div>
      <p>Impreso el ${esc(new Date().toLocaleString("es-DO"))}</p>
    </div>
    ${html}`;
  document.body.appendChild(capa);
  const fotos = [...capa.querySelectorAll("img")];
  await Promise.race([
    Promise.all(fotos.map((img) => img.complete ? Promise.resolve() : new Promise((ok) => { img.onload = ok; img.onerror = ok; }))),
    new Promise((ok) => setTimeout(ok, 10000)),
  ]);
  const limpiar = () => { capa.remove(); window.removeEventListener("afterprint", limpiar); };
  window.addEventListener("afterprint", limpiar);
  setTimeout(limpiar, 60000);
  window.print();
}

// La hoja del área: lo mismo que se ve en pantalla, sin botones.
function imprimirAreaP() {
  const d = DATOS_AREA_P;
  if (!d) return;
  const copia = $("#ar-cuerpo").cloneNode(true);
  copia.querySelectorAll("button:not(.pl-tipo)").forEach((b) => b.remove());
  copia.querySelectorAll("details").forEach((x) => x.setAttribute("open", ""));
  copia.querySelectorAll("select").forEach((x) => x.remove());
  // En papel van todas las plagas con su ubicación, no solo la que se tocó.
  const donde = copia.querySelector("#pl-tipo-donde");
  const pl = PL_DATOS_H;
  if (donde && pl?.plagas?.length) {
    donde.innerHTML = pl.plagas.map((p) => tablaDondePlaga((pl.donde || []).filter((x) => x.plaga === p.plaga), p.plaga)).join("");
  }
  copia.querySelectorAll(".pl-nota").forEach((n) => { if (/^Toca/.test(n.textContent.trim())) n.remove(); });
  const titulo = `Historial · ${d.area ? d.area.nombre : "Todas las áreas"} · del ${fecha(AREA_P.desde)} al ${fecha(AREA_P.hasta)}`;
  imprimirEnPaginaP(titulo, copia.innerHTML);
}

// La última fumigación / el último servicio con todo lo que hizo el técnico.
async function imprimirEvidenciasP(lista) {
  if (!lista.length) return;
  const boton = $("#ar-evidencias");
  if (boton) { boton.disabled = true; boton.textContent = "Preparando…"; }
  try {
    const fichas = await Promise.all(lista.map((i) => GET(`/inspecciones/${i.id}/desglose`)));
    const d = DATOS_AREA_P;
    const titulo = `${d.ultimaEsFumigacion ? "Última aplicación" : "Último servicio"} · ${d.area?.nombre || ""} · ${fecha(String(lista[0].fecha_local || lista[0].fecha).slice(0, 10))}`;
    await imprimirEnPaginaP(titulo, fichas.map((f) => `<div class="ar-ficha-imp">${fichaServicioHTML(f)}</div>`).join(""));
  } catch (e) {
    alert(`No se pudo preparar la impresión: ${e.message}`);
  } finally {
    if (boton) { boton.disabled = false; boton.textContent = "🖨 Imprimir con evidencias"; }
  }
}
