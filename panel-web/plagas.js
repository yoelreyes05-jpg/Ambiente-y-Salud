// ═════════════════════════════════════════════════════════════════════════
// plagas.js — Plagas encontradas (lo que reportaron los técnicos)
//
// Cuántas plagas hay de cada tipo según lo que el técnico contó en sus
// inspecciones, con barras por período (día / semana / mes), y desglosado por
// técnico y por área. Los números salen de GET /reportes/plagas, la misma
// consulta que dibuja la gráfica de barras del PDF: pantalla y reporte dicen
// lo mismo.
//
// Se carga antes de app.js y aporta MODULOS_EXTRA_8.
// ═════════════════════════════════════════════════════════════════════════

const MODULOS_EXTRA_8 = [
  { key: "plagas_reporte", label: "Plagas encontradas", ic: "🪳", seccion: "operacion", roles: ["admin", "operaciones", "comercial"], view: viewPlagasEncontradas },
];

const PALETA_PLAGAS = ["#32539C", "#B45309", "#4A7D4D", "#B91C1C", "#0E7490", "#7C3AED", "#CA8A04", "#DB2777", "#475569", "#15803D", "#9A3412"];
const MESES_CORTOS_PL = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function rotuloPeriodoPl(periodo, agrupar) {
  const t = String(periodo);
  if (t.length === 7) return `${MESES_CORTOS_PL[Number(t.slice(5, 7)) - 1]} ${t.slice(0, 4)}`;
  const dm = `${t.slice(8, 10)}/${t.slice(5, 7)}`;
  return agrupar === "semana" ? `sem ${dm}` : dm;
}

const colorDePlaga = (nombre, colores, series) =>
  colores?.[nombre] || PALETA_PLAGAS[Math.max(0, series.indexOf(nombre)) % PALETA_PLAGAS.length];

// Barras apiladas en SVG con el total encima de cada barra. Se usa aquí y en
// la vista del portal del hotel (copiada allá, sin dependencias).
function barrasPlagasHTML(datos, series, colores, agrupar) {
  if (!datos.length) return `<div class="center-msg">Sin plagas reportadas en el período.</div>`;
  const W = 900, H = 260, izq = 36, abajo = 30, arriba = 18;
  const areaW = W - izq - 8, areaH = H - abajo - arriba;
  const mayor = Math.max(1, ...datos.map((d) => d.total));
  const maximo = Math.ceil(mayor * 1.08);
  const paso = areaW / datos.length;
  const wBarra = Math.min(paso * 0.7, 60);
  const cada = Math.ceil(datos.length / 16);

  let svg = "";
  for (let i = 0; i <= 4; i++) {
    const v = Math.round((maximo / 4) * i);
    const y = arriba + areaH - (areaH / 4) * i;
    svg += `<line x1="${izq}" x2="${W - 8}" y1="${y}" y2="${y}" stroke="${i ? "#E2E8F0" : "#94A3B8"}" stroke-width="1"/>`;
    svg += `<text x="${izq - 6}" y="${y + 4}" font-size="11" text-anchor="end" fill="#64748B">${v}</text>`;
  }
  datos.forEach((d, i) => {
    const cx = izq + paso * i + paso / 2;
    let acum = 0;
    series.forEach((s) => {
      const v = Number(d[s]) || 0;
      if (!v) return;
      const h = (v / maximo) * areaH;
      svg += `<rect x="${cx - wBarra / 2}" y="${arriba + areaH - acum - h}" width="${wBarra}" height="${h}" fill="${colorDePlaga(s, colores, series)}"><title>${esc(s)}: ${v}</title></rect>`;
      acum += h;
    });
    if (d.total && datos.length <= 40) {
      svg += `<text x="${cx}" y="${arriba + areaH - acum - 4}" font-size="11" font-weight="700" text-anchor="middle" fill="#0F172A">${d.total}</text>`;
    }
    if (i % cada === 0) {
      svg += `<text x="${cx}" y="${H - 10}" font-size="10.5" text-anchor="middle" fill="#475569">${esc(rotuloPeriodoPl(d.periodo, agrupar))}</text>`;
    }
  });

  return `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;background:#fbfcfe;border-radius:8px">${svg}</svg>
    <div class="hist-leyenda">
      ${series.map((s) => `<span class="serie"><i style="background:${colorDePlaga(s, colores, series)}"></i>${esc(s)}</span>`).join("")}
    </div>`;
}

async function viewPlagasEncontradas(content) {
  const hace = (dias) => {
    const d = new Date();
    d.setDate(d.getDate() - dias);
    return d.toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
  };

  content.innerHTML = `
    <div class="toolbar">
      <select id="pl-sitio"><option value="">Todas las plantas</option></select>
      <select id="pl-tecnico"><option value="">Todos los técnicos</option></select>
      <input type="date" id="pl-desde" value="${hace(90)}" />
      <input type="date" id="pl-hasta" value="${hoyLocal()}" />
      <select id="pl-agrupar">
        <option value="dia">Por día</option>
        <option value="semana" selected>Por semana</option>
        <option value="mes">Por mes</option>
      </select>
      <span class="toolbar-sep"></span>
      <button class="btn btn-sm" id="pl-actualizar">↻ Actualizar</button>
      <button class="btn btn-sm btn-primary" id="pl-pdf">Reporte PDF</button>
    </div>
    <div id="pl-cuerpo"><div class="center-msg">Cargando…</div></div>`;

  get("/sitios").then((ss) => {
    $("#pl-sitio").innerHTML = `<option value="">Todas las plantas</option>` +
      ss.map((s) => `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`).join("");
  }).catch(() => {});
  get("/solicitudes/tecnicos").then((ts) => {
    $("#pl-tecnico").innerHTML = `<option value="">Todos los técnicos</option>` +
      ts.map((t) => `<option value="${esc(t.id)}">${esc(t.nombre_completo)}</option>`).join("");
  }).catch(() => {});

  async function cargar() {
    const cuerpo = $("#pl-cuerpo");
    cuerpo.innerHTML = `<div class="center-msg">Cargando…</div>`;
    const qs = new URLSearchParams({
      desde: $("#pl-desde").value,
      hasta: $("#pl-hasta").value,
      agrupar: $("#pl-agrupar").value,
    });
    if ($("#pl-sitio").value) qs.set("sitio_id", $("#pl-sitio").value);
    if ($("#pl-tecnico").value) qs.set("tecnico_id", $("#pl-tecnico").value);

    let d;
    try {
      d = await get(`/reportes/plagas?${qs}`);
    } catch (e) {
      cuerpo.innerHTML = `<div class="card"><div class="form-error" style="display:block">${esc(e.message)}</div></div>`;
      return;
    }

    if (!d.plagas.length) {
      cuerpo.innerHTML = `<div class="card"><div class="center-msg">
        Los técnicos no reportaron plagas en este período con estos filtros.</div></div>`;
      return;
    }

    const principal = d.plagas[0];
    const sube = d.plagas.filter((p) => p.tendencia === "sube");
    const principales = d.plagas.slice(0, 6).map((p) => p.plaga);
    const hayOtras = d.plagas.length > 6;

    cuerpo.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="lbl">Plagas reportadas</div><div class="val">${d.total_individuos}</div><div class="kpi-sub">individuos contados</div></div>
        <div class="kpi-card c"><div class="lbl">Tipos de plaga</div><div class="val">${d.plagas.length}</div></div>
        <div class="kpi-card w"><div class="lbl">La que más aparece</div><div class="val kpi-nombre">${esc(principal.plaga)}</div><div class="kpi-sub">${principal.total} individuos en ${principal.puntos} punto(s)</div></div>
        <div class="kpi-card ${sube.length ? "r" : "g"}"><div class="lbl">Subiendo</div><div class="val">${sube.length}</div><div class="kpi-sub">${sube.length ? esc(sube.map((p) => p.plaga).join(", ")) : "Ninguna plaga en aumento"}</div></div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Cuántas hay de cada tipo</h2></div>
        <div class="pl-tarjetas">
          ${d.plagas.map((p) => `
            <div class="pl-tarjeta" style="border-left-color:${colorDePlaga(p.plaga, d.colores, d.series)}">
              <div class="pl-n">${p.total}</div>
              <div class="pl-nombre">${esc(p.plaga)}</div>
              <div class="pl-sub">${p.registros} registro(s) · ${p.puntos} punto(s) · máx. ${p.maximo}
                ${p.sobre_umbral ? ` · <span style="color:#b91c1c;font-weight:700">${p.sobre_umbral} sobre umbral</span>` : ""}</div>
              <div class="fb-tend ${CLASE_TENDENCIA?.[p.tendencia] || ""}" style="text-align:left">
                ${p.tendencia === "sube" ? "▲ Sube" : p.tendencia === "baja" ? "▼ Baja" : p.tendencia === "nueva" ? "• Nueva" : "= Estable"}
                ${p.variacion_pct == null ? "" : ` ${p.variacion_pct > 0 ? "+" : ""}${p.variacion_pct}%`}
              </div>
            </div>`).join("")}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Cantidad de plagas por ${d.agrupar === "mes" ? "mes" : d.agrupar === "semana" ? "semana" : "día"}</h2></div>
        ${barrasPlagasHTML(d.periodos, d.series, d.colores, d.agrupar)}
      </div>

      <div class="card">
        <div class="card-head"><h2>Por técnico</h2></div>
        ${tableHTML(
          [
            { label: "Técnico", fmt: (t) => `<strong>${esc(t.tecnico)}</strong>` },
            ...principales.map((n) => ({ label: n, fmt: (t) => t.plagas[n] || 0 })),
            ...(hayOtras ? [{ label: "Otras", fmt: (t) => Object.entries(t.plagas).filter(([k]) => !principales.includes(k)).reduce((s, [, v]) => s + v, 0) }] : []),
            { label: "Total", fmt: (t) => `<strong>${t.total}</strong>` },
          ],
          d.por_tecnico
        )}
      </div>

      <div class="card">
        <div class="card-head"><h2>Por área</h2></div>
        ${tableHTML(
          [
            { label: "Área", fmt: (a) => esc(a.area) },
            ...principales.map((n) => ({ label: n, fmt: (a) => a.plagas[n] || 0 })),
            { label: "Total", fmt: (a) => `<strong>${a.total}</strong>` },
          ],
          d.por_area.slice(0, 40)
        )}
        ${d.por_area.length > 40 ? `<p class="text-muted">Se muestran las 40 áreas con más plagas de ${d.por_area.length}.</p>` : ""}
      </div>`;
  }

  ["#pl-sitio", "#pl-tecnico", "#pl-desde", "#pl-hasta", "#pl-agrupar"].forEach((s) => $(s).addEventListener("change", cargar));
  $("#pl-actualizar").addEventListener("click", cargar);
  $("#pl-pdf").addEventListener("click", () => modalReporte($("#pl-sitio").value || null));
  await cargar();
}
