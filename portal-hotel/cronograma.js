// cronograma.js — Portal del hotel: Cronograma
//
// Cuatro formas de ver lo programado, para que un auditor pida lo que pida se
// encuentre en dos toques:
//   Año    — cada servicio (fumigación, áreas verdes…) contra los 12 meses:
//            en qué semanas del mes se hace. Tocar un mes abre el mes.
//   Mes    — cada servicio contra la semana 1, 2, 3, 4 y 5 del mes (1-7,
//            8-14, 15-21, 22-28, 29-fin). Tocar una semana abre su calendario.
//   Semana — el calendario de lunes a domingo.
//   Fechas — cualquier día o rango: lo programado y lo que se registró ese día.
//
// "MANEJO INTEGRADO DE PLAGAS" es el nombre del contrato y sale en casi todas
// las filas: no se muestra.
//
// Se carga después de extras.js (fechaRDp, horaRDp, masDiasP, lunesP, DIAS_P).

const MESES_CR = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const ESTADO_CR = { pendiente: "Pendiente", realizado: "Realizado", cancelado: "Cancelado", reprogramado: "Reprogramado" };
let CR = { vista: "mes", anio: null, mes: null, semana: null, desde: null, hasta: null, semMes: null, area: "" };

// Áreas de la planta, para el filtro "Área" (una vez por planta)
const AREAS_CR = new Map();
async function areasCr() {
  if (!AREAS_CR.has(PLANTA.id)) AREAS_CR.set(PLANTA.id, await GET(`/sitios/${PLANTA.id}/areas`).catch(() => []));
  return AREAS_CR.get(PLANTA.id);
}
const areaElegidaCr = (areas) => areas.find((a) => a.id === CR.area) || null;
// ¿Esta fila del cronograma toca el área elegida? (coincideArea, en extras.js)
const filaDelAreaCr = (f, area) => !area || coincideArea(f.notas, area.nombre) || coincideArea(f.titulo, area.nombre);

// Quita el nombre del contrato, que no dice nada del servicio.
const sinMIP = (t) => String(t || "").replace(/manejo\s+integrado\s+de\s+plagas/gi, "").replace(/^[\s\-–·:/|]+|[\s\-–·:/|]+$/g, "").trim();
// Qué servicio es: lo que dicen las notas ("Fumigación de cocina") o el título.
// Si las notas son la lista de áreas ("Áreas: Cocina, Sancho…"), el servicio es
// el título ("Tratamiento profundo") y las áreas van debajo como detalle.
const esListaAreas = (t) => /^\s*[áa]reas?\s*:/i.test(String(t || ""));
const nombreServicioCr = (f) => (esListaAreas(f.notas) ? sinMIP(f.titulo) : sinMIP(f.notas) || sinMIP(f.titulo)) || "Servicio sin descripción";
const detalleServicioCr = (f) => {
  if (esListaAreas(f.notas)) return String(f.notas).trim();
  const t = sinMIP(f.titulo);
  return t && t !== nombreServicioCr(f) ? t : "";
};
const semanaDelMes = (d) => Math.min(5, Math.ceil(Number(d.slice(8, 10)) / 7));
const finDeMes = (a, m) => new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
const ddmm = (d) => `${d.slice(8)}/${d.slice(5, 7)}`;
const diaLargo = (d) => {
  const t = new Date(d + "T12:00:00Z").toLocaleDateString("es-DO", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
// Rango de días de la semana N del mes
const rangoSemanaMes = (a, m, n) => {
  const ini = `${a}-${String(m).padStart(2, "0")}-${String((n - 1) * 7 + 1).padStart(2, "0")}`;
  const fin = n === 5 ? finDeMes(a, m) : masDiasP(ini, 6);
  return [ini, fin];
};

async function vistaCronograma(cuerpo) {
  const hoy = fechaRDp(new Date());
  CR.anio ??= Number(hoy.slice(0, 4));
  // La primera vez en una planta con programa anual oficial, se abre en Año
  if (CR.plantaVista !== PLANTA.id) {
    CR.plantaVista = PLANTA.id;
    CR.vista = (await programaOficialCr(CR.anio)) ? "anio" : "mes";
  }
  CR.mes ??= Number(hoy.slice(5, 7));
  CR.semana ??= lunesP(hoy);
  CR.desde ??= hoy;
  CR.hasta ??= hoy;

  const areas = await areasCr();
  if (CR.area && !areas.some((a) => a.id === CR.area)) CR.area = "";
  const areaSel = areaElegidaCr(areas);

  cuerpo.innerHTML = `
    <div class="tarjeta cr-barra">
      <div class="cr-vistas">
        ${[["anio", "Año"], ["mes", "Mes"], ["semana", "Semana"], ["fechas", "Fechas"]].map(([k, t]) =>
          `<button class="btn${CR.vista === k ? " principal" : ""}" data-vista="${k}">${t}</button>`).join("")}
      </div>
      ${areas.length ? `<label class="cr-area">Área
        <select class="btn" id="cr-area">
          <option value="">Todas las áreas</option>
          ${areas.map((a) => `<option value="${esc(a.id)}"${a.id === CR.area ? " selected" : ""}>${esc(a.nombre)}</option>`).join("")}
        </select></label>` : ""}
      <div class="cr-nav" id="cr-nav"></div>
    </div>
    ${areaSel ? `<p class="pl-nota cr-aviso-area">Mostrando solo lo programado para <strong>${esc(areaSel.nombre)}</strong>.</p>` : ""}
    <div id="cr-cuerpo"><div class="cargando">Cargando…</div></div>`;

  $$(".cr-vistas [data-vista]", cuerpo).forEach((b) => b.addEventListener("click", () => {
    CR.vista = b.dataset.vista; CR.semMes = null; vistaCronograma(cuerpo);
  }));
  $("#cr-area")?.addEventListener("change", (e) => { CR.area = e.target.value; vistaCronograma(cuerpo); });
  const nav = $("#cr-nav");
  const caja = $("#cr-cuerpo");
  const ir = () => vistaCronograma(cuerpo);

  if (CR.vista === "anio") {
    nav.innerHTML = `<button class="btn" id="cr-ant">◀</button><strong>${CR.anio}</strong><button class="btn" id="cr-sig">▶</button>
      <button class="btn principal" id="cr-imp">🖨 Imprimir</button>`;
    $("#cr-ant").onclick = () => { CR.anio--; ir(); };
    $("#cr-sig").onclick = () => { CR.anio++; ir(); };
    // Si la planta tiene su programa anual oficial (el documento que ASA le
    // entrega al hotel), se muestra ese, tal cual, en vez del que se arma con
    // el cronograma.
    const prog = await programaOficialCr(CR.anio);
    if (prog) {
      // Con un área elegida, solo sus filas del programa
      const progVer = areaSel
        ? { ...prog, areas: prog.areas.filter((a) => coincideArea(a.area, areaSel.nombre) || coincideArea(areaSel.nombre, a.area)) }
        : prog;
      if (areaSel && !progVer.areas.length) {
        caja.innerHTML = `<div class="vacio">El programa anual no tiene una fila para <strong>${esc(areaSel.nombre)}</strong>. Escoge "Todas las áreas" para verlo completo.</div>`;
        return;
      }
      caja.innerHTML = htmlProgramaOficial(progVer);
      $$("[data-sem-anio]", caja).forEach((el) => el.addEventListener("click", () => {
        CR.vista = "semana"; CR.semana = lunesSemanaAnio(CR.anio, Number(el.dataset.semAnio)); ir();
      }));
      $("#cr-imp").onclick = () => imprimirHtmlCr(`Programa anual ${prog.anio}${areaSel ? ` · ${areaSel.nombre}` : ""}`, htmlProgramaOficial(progVer, true));
      return;
    }
    const filas = await traerCrono(`${CR.anio}-01-01`, `${CR.anio}-12-31`, caja);
    if (!filas) return;
    caja.innerHTML = htmlAnio(filas);
    $$("[data-mes]", caja).forEach((el) => el.addEventListener("click", () => { CR.vista = "mes"; CR.mes = Number(el.dataset.mes); ir(); }));
    $("#cr-imp").onclick = () => imprimirHtmlCr(`Cronograma anual ${CR.anio}`, htmlAnio(filas, true));
  } else if (CR.vista === "mes") {
    nav.innerHTML = `<button class="btn" id="cr-ant">◀</button><strong>${MESES_CR[CR.mes - 1]} ${CR.anio}</strong><button class="btn" id="cr-sig">▶</button>
      <button class="btn principal" id="cr-imp">🖨 Imprimir</button>`;
    const mover = (n) => { CR.mes += n; if (CR.mes < 1) { CR.mes = 12; CR.anio--; } if (CR.mes > 12) { CR.mes = 1; CR.anio++; } CR.semMes = null; ir(); };
    $("#cr-ant").onclick = () => mover(-1);
    $("#cr-sig").onclick = () => mover(1);
    const ini = `${CR.anio}-${String(CR.mes).padStart(2, "0")}-01`, fin = finDeMes(CR.anio, CR.mes);
    const filas = await traerCrono(ini, fin, caja);
    if (!filas) return;
    const pintar = async () => {
      caja.innerHTML = htmlMes(filas) + `<div id="cr-semana-mes"></div>`;
      $$("[data-sem]", caja).forEach((el) => el.addEventListener("click", () => {
        CR.semMes = CR.semMes === Number(el.dataset.sem) ? null : Number(el.dataset.sem);
        pintar();
      }));
      if (CR.semMes) {
        const [d, h] = rangoSemanaMes(CR.anio, CR.mes, CR.semMes);
        const box = $("#cr-semana-mes");
        box.innerHTML = `<h3 class="pl-sub">${MESES_CR[CR.mes - 1]} · semana ${CR.semMes} (${ddmm(d)} al ${ddmm(h)})</h3>`;
        await pintarCalendario(box, filas.filter((f) => fechaRDp(f.fecha_inicio) >= d && fechaRDp(f.fecha_inicio) <= h), d, h);
        box.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    await pintar();
    $("#cr-imp").onclick = () => imprimirHtmlCr(`Cronograma de ${MESES_CR[CR.mes - 1]} ${CR.anio}`,
      htmlMes(filas, true) + htmlListaDiasCr(filas, ini, fin));
  } else if (CR.vista === "semana") {
    const fin = masDiasP(CR.semana, 6);
    nav.innerHTML = `<button class="btn" id="cr-ant">◀</button><strong>${ddmm(CR.semana)} al ${ddmm(fin)}/${fin.slice(0, 4)}</strong><button class="btn" id="cr-sig">▶</button>
      <button class="btn" id="cr-hoy">Hoy</button><button class="btn principal" id="cr-imp">🖨 Imprimir</button>`;
    $("#cr-ant").onclick = () => { CR.semana = masDiasP(CR.semana, -7); ir(); };
    $("#cr-sig").onclick = () => { CR.semana = masDiasP(CR.semana, 7); ir(); };
    $("#cr-hoy").onclick = () => { CR.semana = lunesP(hoy); ir(); };
    const filas = await traerCrono(CR.semana, fin, caja);
    if (!filas) return;
    caja.innerHTML = "";
    await pintarCalendario(caja, filas, CR.semana, fin);
    $("#cr-imp").onclick = () => imprimirHtmlCr(`Cronograma · semana del ${ddmm(CR.semana)} al ${ddmm(fin)}/${fin.slice(0, 4)}`, htmlListaDiasCr(filas, CR.semana, fin));
  } else {
    nav.innerHTML = `
      <label>Desde <input type="date" class="btn" id="cr-desde" value="${CR.desde}" /></label>
      <label>Hasta <input type="date" class="btn" id="cr-hasta" value="${CR.hasta}" /></label>
      <button class="btn principal" id="cr-imp">🖨 Imprimir</button>`;
    const cambiar = () => {
      CR.desde = $("#cr-desde").value || CR.desde;
      CR.hasta = $("#cr-hasta").value || CR.desde;
      if (CR.hasta < CR.desde) [CR.desde, CR.hasta] = [CR.hasta, CR.desde];
      ir();
    };
    $("#cr-desde").onchange = cambiar;
    $("#cr-hasta").onchange = cambiar;
    const dias = Math.round((Date.parse(CR.hasta) - Date.parse(CR.desde)) / 86400000) + 1;
    if (dias > 93) { caja.innerHTML = `<div class="vacio">Elige un rango de hasta 3 meses. Para ver más, usa la vista Mes o Año.</div>`; return; }
    const filas = await traerCrono(CR.desde, CR.hasta, caja);
    if (!filas) return;
    caja.innerHTML = `<p class="pl-nota">Elige un solo día (desde y hasta iguales) o un rango. Se ve lo programado y lo que el técnico registró cada día.</p>`;
    await pintarCalendario(caja, filas, CR.desde, CR.hasta);
    $("#cr-imp").onclick = () => imprimirHtmlCr(`Cronograma del ${ddmm(CR.desde)}/${CR.desde.slice(0, 4)} al ${ddmm(CR.hasta)}/${CR.hasta.slice(0, 4)}`, htmlListaDiasCr(filas, CR.desde, CR.hasta));
  }
}

async function traerCrono(desde, hasta, caja) {
  try {
    const r = await GET(`/cronograma?sitio_id=${PLANTA.id}&desde=${desde}&hasta=${hasta}`);
    const area = areaElegidaCr(await areasCr());
    return (r.filas || []).filter((f) => filaDelAreaCr(f, area));
  } catch (e) {
    caja.innerHTML = `<div class="error">${esc(e.message)}</div>`;
    return null;
  }
}

// Agrupa por servicio: { nombre → filas }
function porServicioCr(filas) {
  const m = new Map();
  for (const f of filas) {
    const n = nombreServicioCr(f);
    if (!m.has(n)) m.set(n, []);
    m.get(n).push(f);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "es"));
}

// ── Año: servicio × mes, con las semanas del mes en que se hace ──────────
// El programa anual oficial de la planta. Primero lo pide al servidor; si el
// servidor no lo tiene (o todavía no se ha actualizado), lo toma de la copia
// que viaja con el portal (programas/indice.json).
const PROGRAMAS_CR = new Map();
async function programaOficialCr(anio) {
  const k = `${PLANTA.id}|${anio}`;
  if (PROGRAMAS_CR.has(k)) return PROGRAMAS_CR.get(k);
  let prog = null;
  try { prog = (await GET(`/cronograma/programa-anual?sitio_id=${PLANTA.id}&anio=${anio}`))?.programa || null; } catch { /* abajo */ }
  if (!prog) {
    try {
      const clave = String(PLANTA.nombre || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-");
      const ind = await (await fetch("programas/indice.json", { cache: "no-cache" })).json();
      const e = (ind.programas || []).find((x) => Number(x.anio) === Number(anio) && clave.includes(x.clave));
      if (e) prog = await (await fetch(`programas/${e.archivo}`, { cache: "no-cache" })).json();
    } catch { /* sin programa */ }
  }
  PROGRAMAS_CR.set(k, prog);
  return prog;
}

// Lunes de la semana N del año (semanas ISO: la 1 es la del primer jueves)
function lunesSemanaAnio(anio, n) {
  const ene4 = new Date(Date.UTC(anio, 0, 4));
  const lunes1 = new Date(ene4.getTime() - ((ene4.getUTCDay() + 6) % 7) * 86400000);
  return new Date(lunes1.getTime() + (n - 1) * 7 * 86400000).toISOString().slice(0, 10);
}

// En papel, productos / métodos / plagas lado a lado en una sola tabla corta,
// como el documento original, para que todo quepa en una hoja.
function leyendaImpresa(prog) {
  const cols = [["Nombre del producto", prog.productos || []], ["Método de aplicación", prog.metodos || []], ["Plagas tratadas", prog.plagas || []]];
  const n = Math.max(...cols.map(([, l]) => l.length));
  return `<table class="cr-prog-tabla cr-prog-ley">
    <tr>${cols.map(([t]) => `<th colspan="2">${t}</th>`).join("")}</tr>
    ${[...Array(n)].map((_, i) => `<tr>${cols.map(([, l]) => l[i] ? `<td>${l[i][0]}</td><td>${esc(l[i][1])}</td>` : "<td></td><td></td>").join("")}</tr>`).join("")}
  </table>`;
}

// ── Programa anual oficial: áreas × 52 semanas, como el documento ────────
function htmlProgramaOficial(prog, impresion = false) {
  const sem = prog.semanas_por_mes || 4;
  const total = prog.meses.length * sem;
  const tabla = (filas) => `<table class="cr-prog-tabla">${filas.map(([n, t]) => `<tr><td class="n">${n}</td><td>${esc(t)}</td></tr>`).join("")}</table>`;
  return `
    <div class="tarjeta cr-prog">
      <div class="cr-prog-cab">${prog.titulo.map((t, i) => `<div${i === 0 ? ' class="fuerte"' : ""}>${esc(t)}</div>`).join("")}</div>
      ${impresion ? "" : `<p class="pl-nota">Programa anual ${prog.anio}</p>`}
      <div class="pl-tabla-scroll">
        <table class="cr-prog-matriz">
          <thead>
            <tr><th class="cr-prog-area" rowspan="2">Áreas</th>${prog.meses.map((m) => `<th colspan="${sem}">${esc(m)}</th>`).join("")}</tr>
            <tr>${[...Array(total)].map((_, i) => `<th class="cr-prog-sem${impresion ? "" : " clicable"}" ${impresion ? "" : `data-sem-anio="${i + 1}"`} title="Semana ${i + 1} del año · desde el lunes ${impresion ? "" : lunesSemanaAnio(prog.anio, i + 1)}">${(i % sem) + 1}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${prog.areas.map((a, r) => {
              const si = new Set(a.semanas);
              return `<tr class="${r % 2 ? "azul" : "verde"}"><td class="cr-prog-area">${esc(a.area)}</td>${[...Array(total)].map((_, i) =>
                `<td class="${si.has(i + 1) ? "si" : "no"}"${impresion || !si.has(i + 1) ? "" : ` data-sem-anio="${i + 1}"`}></td>`).join("")}</tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      ${impresion ? leyendaImpresa(prog) : `<div class="cr-prog-leyendas">
        <div><h3>Nombre del producto</h3>${tabla(prog.productos || [])}</div>
        <div><h3>Método de aplicación</h3>${tabla(prog.metodos || [])}</div>
        <div><h3>Plagas tratadas</h3>${tabla(prog.plagas || [])}</div>
      </div>`}
    </div>`;
}

function htmlAnio(filas, impresion = false) {
  if (!filas.length) return `<div class="vacio"><span class="emoji">📅</span>No hay servicios programados en ${CR.anio}.</div>`;
  const grupos = porServicioCr(filas);
  const celda = (lista, m) => {
    const del = lista.filter((f) => Number(fechaRDp(f.fecha_inicio).slice(5, 7)) === m);
    if (!del.length) return `<td class="cr-vacia"></td>`;
    const sems = [...new Set(del.map((f) => semanaDelMes(fechaRDp(f.fecha_inicio))))].sort();
    const hechas = del.filter((f) => f.estado === "realizado").length;
    return `<td class="cr-con${hechas === del.length ? " ok" : ""}" ${impresion ? "" : `data-mes="${m}"`} title="${del.length} servicio(s)">
      ${sems.map((s) => `S${s}`).join(" ")}</td>`;
  };
  return `
    <div class="tarjeta">
      ${impresion ? "" : `<p class="pl-nota">En cada mes, las semanas en que se hace cada servicio (S1 = días 1 al 7, S2 = 8 al 14, S3 = 15 al 21, S4 = 22 al 28, S5 = 29 al fin de mes). Toca un mes para abrirlo.</p>`}
      <div class="pl-tabla-scroll">
        <table class="cr-matriz">
          <thead><tr><th>Servicio</th>${MESES_CR.map((n, i) => `<th ${impresion ? "" : `data-mes="${i + 1}" class="clicable"`}>${n.slice(0, 3)}</th>`).join("")}</tr></thead>
          <tbody>${grupos.map(([n, lista]) => `<tr><td class="cr-serv">${esc(n)}</td>${MESES_CR.map((_, i) => celda(lista, i + 1)).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Mes: servicio × semana 1-5 ──────────────────────────────────────────
function htmlMes(filas, impresion = false) {
  if (!filas.length) return `<div class="vacio"><span class="emoji">📅</span>No hay servicios programados en ${MESES_CR[CR.mes - 1]} ${CR.anio}.</div>`;
  const grupos = porServicioCr(filas);
  const nSem = semanaDelMes(finDeMes(CR.anio, CR.mes));
  const sems = [...Array(nSem)].map((_, i) => i + 1);
  const hechos = filas.filter((f) => f.estado === "realizado").length;
  return `
    ${impresion ? "" : `<div class="kpis">
      <div class="kpi"><div class="n">${filas.length}</div><div class="t">Servicios programados</div></div>
      <div class="kpi"><div class="n">${grupos.length}</div><div class="t">Tipos de servicio</div></div>
      <div class="kpi ok"><div class="n">${hechos}</div><div class="t">Marcados realizados</div></div>
    </div>`}
    <div class="tarjeta">
      ${impresion ? "" : `<p class="pl-nota">Veces que se hace cada servicio en cada semana y en qué días. En verde, lo marcado como realizado. Toca una semana para ver su calendario día por día.</p>`}
      <div class="pl-tabla-scroll">
        <table class="cr-matriz">
          <thead><tr><th>Servicio</th>${sems.map((s) => {
            const [d, h] = rangoSemanaMes(CR.anio, CR.mes, s);
            return `<th ${impresion ? "" : `data-sem="${s}"`} class="${impresion ? "" : "clicable"}${CR.semMes === s ? " activa" : ""}">Semana ${s}<div class="cr-rango">${ddmm(d)}–${ddmm(h)}</div></th>`;
          }).join("")}</tr></thead>
          <tbody>${grupos.map(([n, lista]) => `<tr><td class="cr-serv">${esc(n)}</td>${sems.map((s) => {
            const del = lista.filter((f) => semanaDelMes(fechaRDp(f.fecha_inicio)) === s);
            if (!del.length) return `<td class="cr-vacia"></td>`;
            const dias = [...new Set(del.map((f) => fechaRDp(f.fecha_inicio).slice(8)))];
            const ok = del.every((f) => f.estado === "realizado");
            return `<td class="cr-con${ok ? " ok" : ""}" ${impresion ? "" : `data-sem="${s}"`}>${del.length}×<div class="cr-rango">día ${dias.join(", ")}</div></td>`;
          }).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Calendario día por día (semana, semana del mes o rango) ──────────────
// Junto a lo programado, cuántos servicios registró el técnico ese día; al
// tocarlo se abre Historial en ese día, con las evidencias.
async function pintarCalendario(caja, filas, desde, hasta) {
  const dias = [];
  for (let d = desde; d <= hasta; d = masDiasP(d, 1)) dias.push(d);
  const hechos = {};
  try {
    // Lo registrado ese día, en el área elegida si hay una
    const r = await GET(`/inspecciones?sitio_id=${PLANTA.id}&desde=${desde}&hasta=${hasta}&limite=1000${CR.area ? `&area_id=${CR.area}` : ""}`);
    for (const i of Array.isArray(r) ? r : []) if (!i.motivo_no_realizado) {
      const d = String(i.fecha_local || i.fecha).slice(0, 10);
      hechos[d] = (hechos[d] || 0) + 1;
    }
  } catch { /* sin lo registrado, igual se ve lo programado */ }
  const hoy = fechaRDp(new Date());
  caja.insertAdjacentHTML("beforeend", `
    <div class="cr-semana-p">
      ${dias.map((d) => {
        const del = filas.filter((f) => fechaRDp(f.fecha_inicio) === d);
        const dia = DIAS_P[(new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7];
        return `
          <div class="tarjeta cr-dia-p ${d === hoy ? "hoy" : ""}">
            <h2>${dia} <span style="color:var(--suave);font-weight:500">${ddmm(d)}/${d.slice(0, 4)}</span></h2>
            ${hechos[d] ? `<button class="btn cr-hechos" data-dia="${d}">✔ ${hechos[d]} servicio(s) registrados · ver evidencias</button>` : ""}
            ${del.length ? del.map((f) => `
              <div class="cr-item-p ${f.estado}">
                <div class="h">${horaRDp(f.fecha_inicio)}${f.fecha_fin ? ` – ${horaRDp(f.fecha_fin)}` : ""}
                  ${f.estado === "realizado" ? ` <span class="marca ok">realizado</span>` : f.estado === "cancelado" ? ` <span class="marca neutra">cancelado</span>` : f.estado === "reprogramado" ? ` <span class="marca neutra">reprogramado</span>` : ""}</div>
                <div>${esc(nombreServicioCr(f))}</div>
                ${detalleServicioCr(f) ? `<div class="s">${esc(detalleServicioCr(f))}</div>` : ""}
              </div>`).join("") : `<div class="s">Sin servicios programados</div>`}
          </div>`;
      }).join("")}
    </div>`);
  $$(".cr-hechos", caja).forEach((b) => b.addEventListener("click", () => {
    // Historial (areas.js) en ese día, con el área elegida aquí (o todas)
    AREA_P.area = CR.area || ""; AREA_P.desde = b.dataset.dia; AREA_P.hasta = b.dataset.dia;
    PESTANA = "historial";
    pintarMarco();
    pintarPestana();
    window.scrollTo({ top: 0 });
  }));
}

// Lista por día para imprimir
function htmlListaDiasCr(filas, desde, hasta) {
  const porDia = new Map();
  for (const f of filas) {
    const d = fechaRDp(f.fecha_inicio);
    if (d < desde || d > hasta) continue;
    if (!porDia.has(d)) porDia.set(d, []);
    porDia.get(d).push(f);
  }
  if (!porDia.size) return `<p>No hay servicios programados en ese período.</p>`;
  return `<table class="cr-lista"><thead><tr><th>Hora</th><th>Servicio</th><th>Estado</th></tr></thead>
    ${[...porDia.keys()].sort().map((d) => `<tbody>
      <tr class="dia"><td colspan="3">${esc(diaLargo(d))}</td></tr>
      ${porDia.get(d).map((f) => `<tr>
        <td class="hora">${horaRDp(f.fecha_inicio)}${f.fecha_fin ? `–${horaRDp(f.fecha_fin)}` : ""}</td>
        <td><strong>${esc(nombreServicioCr(f))}</strong>${detalleServicioCr(f) ? `<div class="sub">${esc(detalleServicioCr(f))}</div>` : ""}</td>
        <td>${esc(ESTADO_CR[f.estado] || f.estado)}</td></tr>`).join("")}
    </tbody>`).join("")}</table>`;
}

// Hoja aparte para imprimir o guardar en PDF.
function imprimirHtmlCr(titulo, html) {
  const v = window.open("", "_blank");
  if (!v) return alert("El navegador bloqueó la ventana. Permite las ventanas emergentes de este sitio.");
  const logo = new URL("assets/logo-asa.png", location.href).href;
  v.document.open();
  v.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(titulo)} — ${esc(PLANTA.nombre)}</title>
<style>
  @page { size: letter landscape; margin: 10mm; }
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color:#1c2433; margin:0; padding:10mm; font-size:11px }
  .cab { display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid #4A7D4D; padding-bottom:8px; margin-bottom:12px; gap:10px }
  .cab img { height:42px } .cab .t { text-align:right }
  .cab h1 { margin:0; font-size:17px; color:#24407C } .cab p { margin:2px 0 0; color:#555 }
  table { width:100%; border-collapse:collapse; margin-bottom:14px }
  th { text-align:left; font-size:10px; color:#fff; background:#32539C; padding:5px 6px }
  td { padding:4px 6px; border-bottom:1px solid #e3e8ef; vertical-align:top }
  .cr-matriz td, .cr-matriz th { border:1px solid #cfd8e6; text-align:center }
  .cr-matriz td.cr-serv { text-align:left; font-weight:600 }
  .cr-matriz td.cr-con { background:#EAF0F8; font-weight:700; color:#24407C }
  .cr-matriz td.cr-con.ok { background:#e8f5e9; color:#2e6b32 }
  .cr-rango { font-size:9px; font-weight:400; opacity:.85 }
  .cr-prog-cab div { font-size:11px; font-weight:700 } .cr-prog-cab { margin-bottom:8px }
  .cr-prog-matriz { border-collapse:collapse; width:100%; font-size:7.5px; table-layout:fixed }
  .cr-prog-matriz th, .cr-prog-matriz td { border:1px solid #333; padding:1px; text-align:center; color:#000; background:#fff }
  .cr-prog-matriz .cr-prog-area { text-align:left; width:150px; white-space:nowrap; overflow:hidden; font-size:8px }
  .cr-prog-matriz tr.verde td.si { background:#D8E4BC } .cr-prog-matriz tr.azul td.si { background:#DAEEF3 }
  .cr-prog-leyendas { display:flex; gap:24px; margin-top:10px; font-size:9px } .cr-prog-leyendas h3 { font-size:10px; margin:0 0 4px }
  .cr-prog-tabla { width:auto; border-collapse:collapse; margin:0; font-size:8px } .cr-prog-tabla td { border:1px solid #999; padding:0 5px; line-height:1.25 }
  .cr-prog-tabla tbody, .cr-prog-matriz tbody { break-inside:auto }
  .cr-prog-matriz td { height:7px; padding:0; line-height:1 } .cr-prog-matriz th { padding:0; font-size:7px }
  .cr-prog-matriz .cr-prog-area { font-size:7px; padding:0 3px; line-height:1.15 }
  .cr-prog-cab div { font-size:9px } .cr-prog-cab { margin-bottom:4px }
  .cr-prog-ley { margin-top:6px } .cr-prog-ley th { background:#fff; color:#000; border:1px solid #999; font-size:8px; padding:1px 5px }
  @page { size: letter landscape; margin: 8mm; }
  tr.dia td { background:#f5f7fa; font-weight:700; color:#24407C }
  td.hora { white-space:nowrap; width:140px } .sub { color:#777; font-size:10px }
  tbody { break-inside:avoid } .tarjeta { margin:0 } .vacio { padding:20px; text-align:center; color:#777 }
  .aviso { background:#EAF0F8; border:1px solid #BAC9E1; padding:10px 12px; border-radius:6px; margin-bottom:12px;
           display:flex; justify-content:space-between; align-items:center; gap:12px; font-size:12px }
  .aviso button { background:#32539C; color:#fff; border:0; border-radius:6px; padding:8px 14px; font-weight:700; cursor:pointer }
  * { -webkit-print-color-adjust:exact; print-color-adjust:exact }
  @media print { .aviso { display:none } body { padding:0 } }
</style></head><body>
  <div class="aviso"><span>Para PDF elige <em>Guardar como PDF</em>.</span><button onclick="window.print()">Imprimir / Guardar PDF</button></div>
  <div class="cab"><img src="${esc(logo)}" alt="Ambiente y Salud" />
    <div class="t"><h1>${esc(titulo)}</h1><p><strong>${esc(PLANTA.nombre)}</strong></p></div></div>
  ${html}
</body></html>`);
  v.document.close();
}
