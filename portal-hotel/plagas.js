// ═════════════════════════════════════════════════════════════════════════
// plagas.js — Estadísticas de plagas del hotel (pestaña Historial)
//
// La misma información que "Plagas encontradas" del panel de ASA, limitada a
// la planta de esta cuenta: cuántas plagas hay de cada tipo, la que más
// aparece, el mes con más plagas, las barras por semana y por mes del año, y
// las áreas donde se encontraron. Sin el técnico: el backend ni siquiera lo
// envía a las cuentas del hotel (GET /reportes/plagas).
//
// Se carga antes de app.js; vistaHistorial llama a montarEstadisticasPlagas.
// ═════════════════════════════════════════════════════════════════════════

const PALETA_PLAGAS_H = ["#32539C", "#B45309", "#4A7D4D", "#B91C1C", "#0E7490", "#7C3AED", "#CA8A04", "#DB2777", "#475569", "#15803D", "#9A3412"];
const MESES_CORTOS_H = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_H = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const colorPlagaH = (nombre, colores, series) =>
  colores?.[nombre] || PALETA_PLAGAS_H[Math.max(0, series.indexOf(nombre)) % PALETA_PLAGAS_H.length];

function rotuloPeriodoH(periodo) {
  const t = String(periodo);
  if (t.length === 2) return MESES_CORTOS_H[Number(t) - 1];                       // mes del año
  if (t.length === 7) return `${MESES_CORTOS_H[Number(t.slice(5, 7)) - 1]} ${t.slice(2, 4)}`;
  return `${t.slice(8, 10)}/${t.slice(5, 7)}`;                                  // semana: su domingo
}

// Barras apiladas por plaga, con el total encima. Copia de la del panel de ASA.
function barrasPlagasH(datos, series, colores) {
  if (!datos.some((d) => d.total)) return `<div class="vacio">Sin plagas reportadas en el período.</div>`;
  const W = 900, H = 260, izq = 36, abajo = 30, arriba = 18;
  const areaW = W - izq - 8, areaH = H - abajo - arriba;
  const maximo = Math.ceil(Math.max(1, ...datos.map((d) => d.total)) * 1.08);
  const paso = areaW / datos.length;
  const wBarra = Math.min(paso * 0.7, 60);
  const cada = Math.ceil(datos.length / 14);

  let svg = "";
  for (let i = 0; i <= 4; i++) {
    const v = Math.round((maximo / 4) * i);
    const y = arriba + areaH - (areaH / 4) * i;
    svg += `<line x1="${izq}" x2="${W - 8}" y1="${y}" y2="${y}" stroke="${i ? "#E2E8F0" : "#94A3B8"}" stroke-width="1"/>`;
    svg += `<text x="${izq - 6}" y="${y + 4}" font-size="12" text-anchor="end" fill="#64748B">${v}</text>`;
  }
  datos.forEach((d, i) => {
    const cx = izq + paso * i + paso / 2;
    let acum = 0;
    series.forEach((s) => {
      const v = Number(d[s]) || 0;
      if (!v) return;
      const h = (v / maximo) * areaH;
      svg += `<rect x="${cx - wBarra / 2}" y="${arriba + areaH - acum - h}" width="${wBarra}" height="${h}" fill="${colorPlagaH(s, colores, series)}"><title>${esc(s)}: ${v}</title></rect>`;
      acum += h;
    });
    if (d.total && datos.length <= 30) {
      svg += `<text x="${cx}" y="${arriba + areaH - acum - 4}" font-size="12" font-weight="700" text-anchor="middle" fill="#0F172A">${d.total}</text>`;
    }
    if (i % cada === 0) {
      svg += `<text x="${cx}" y="${H - 10}" font-size="12" text-anchor="middle" fill="#475569">${esc(rotuloPeriodoH(d.periodo))}</text>`;
    }
  });

  return `
    <svg viewBox="0 0 ${W} ${H}" class="pl-grafica" role="img" aria-label="Gráfica de plagas">${svg}</svg>
    <div class="pl-leyenda">
      ${series.map((s) => `<span><i style="background:${colorPlagaH(s, colores, series)}"></i>${esc(s)}</span>`).join("")}
    </div>`;
}

// Pinta el bloque de estadísticas dentro de `raiz` (un div de la vista Historial).
function montarEstadisticasPlagas(raiz) {
  raiz.innerHTML = `
    <div class="tarjeta">
      <div class="pl-cab">
        <h2>📊 Plagas en tu hotel</h2>
        <select class="btn" id="pl-rango">
          <option value="30">Últimos 30 días</option>
          <option value="90">Últimos 90 días</option>
          <option value="365" selected>Últimos 12 meses</option>
          <option value="todo">Todo el historial</option>
        </select>
      </div>
      <div id="pl-cuerpo"><div class="cargando">Cargando…</div></div>
    </div>`;

  const cuerpo = $("#pl-cuerpo", raiz);

  async function cargar() {
    const r = $("#pl-rango", raiz).value;
    const desde = r === "todo"
      ? "2000-01-01"
      : new Date(Date.now() - (Number(r) - 1) * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
    cuerpo.innerHTML = `<div class="cargando">Cargando…</div>`;

    let d;
    try {
      d = await GET(`/reportes/plagas?${new URLSearchParams({ sitio_id: PLANTA.id, desde, hasta: hoyLocal(), agrupar: "semana" })}`);
    } catch (e) {
      cuerpo.innerHTML = `<div class="vacio">No se pudieron cargar las estadísticas: ${esc(e.message)}</div>`;
      return;
    }

    if (!d.plagas?.length) {
      cuerpo.innerHTML = `<div class="vacio"><span class="emoji">✅</span>No se reportaron plagas en este período.</div>`;
      return;
    }

    const est = d.estacionalidad || { meses: [], anios: [] };
    const principal = d.plagas[0];
    const pico = est.mes_pico ? est.meses[est.mes_pico - 1] : null;
    const principales = d.plagas.slice(0, 5).map((p) => p.plaga);
    const hayOtras = d.plagas.length > 5;
    const mayorTipo = Math.max(1, ...d.plagas.map((p) => p.total));

    cuerpo.innerHTML = `
      <div class="kpis">
        <div class="kpi"><div class="n">${d.total_individuos}</div><div class="t">Plagas reportadas</div></div>
        <div class="kpi"><div class="n">${d.plagas.length}</div><div class="t">Tipos de plaga</div></div>
        <div class="kpi mal"><div class="n pl-nombre">${esc(principal.plaga)}</div><div class="t">La que más aparece · ${principal.total}</div></div>
        <div class="kpi mal"><div class="n pl-nombre">${pico ? esc(MESES_H[pico.mes - 1]) : "—"}</div><div class="t">Mes con más plagas${pico ? ` · ${pico.total}` : ""}</div></div>
      </div>

      <h3 class="pl-sub">Cuántas hay de cada tipo</h3>
      <div class="pl-tipos">
        ${d.plagas.map((p) => `
          <div class="pl-tipo">
            <div class="pl-tipo-cab"><span>${esc(p.plaga)}</span><strong>${p.total}</strong></div>
            <div class="pl-barra"><span style="width:${(p.total / mayorTipo) * 100}%;background:${colorPlagaH(p.plaga, d.colores, d.series)}"></span></div>
            <div class="pl-tipo-pie">${p.puntos} punto(s)${p.mes_pico ? ` · más en ${MESES_H[p.mes_pico - 1]}` : ""}</div>
          </div>`).join("")}
      </div>

      <h3 class="pl-sub">Cantidad de plagas por semana</h3>
      ${barrasPlagasH(d.periodos, d.series, d.colores)}

      <h3 class="pl-sub">¿En qué mes hay más plagas?</h3>
      <p class="pl-nota">Suma cada mes con el mismo mes de los otros años del período. Con más meses de datos se ve más clara la temporada.</p>
      ${barrasPlagasH(est.meses, d.series, d.colores)}

      <h3 class="pl-sub">Áreas donde se encontraron</h3>
      <div class="pl-tabla-scroll">
        <table class="pl-tabla">
          <thead><tr><th>Área</th>${principales.map((n) => `<th>${esc(n)}</th>`).join("")}${hayOtras ? "<th>Otras</th>" : ""}<th>Total</th></tr></thead>
          <tbody>
            ${d.por_area.slice(0, 30).map((a) => `
              <tr><td>${esc(a.area)}</td>
                ${principales.map((n) => `<td>${a.plagas[n] || 0}</td>`).join("")}
                ${hayOtras ? `<td>${Object.entries(a.plagas).filter(([k]) => !principales.includes(k)).reduce((s, [, v]) => s + v, 0)}</td>` : ""}
                <td><strong>${a.total}</strong></td></tr>`).join("")}
          </tbody>
        </table>
      </div>
      ${d.por_area.length > 30 ? `<p class="pl-nota">Se muestran las 30 áreas con más plagas de ${d.por_area.length}.</p>` : ""}`;
  }

  $("#pl-rango", raiz).addEventListener("change", cargar);
  return cargar();
}
