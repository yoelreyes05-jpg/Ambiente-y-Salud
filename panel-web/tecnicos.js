// ═════════════════════════════════════════════════════════════════════════
// tecnicos.js — Técnicos: quién subió su trabajo y cómo va cada uno
//
// Pensada para la oficina, en dos preguntas:
//   · Hoy: ¿quién ya subió y quién no ha subido nada?
//   · En el período: ¿quién lleva más registros y cuál es su índice?
//
// Los números salen de GET /reportes/tecnicos (calculados en el servidor).
// Al tocar un técnico se abre su detalle con sus últimos registros, y cada
// registro abre el mismo desglose del servicio que usa Servicios.
//
// Se carga antes de app.js y aporta MODULOS_EXTRA_7.
// ═════════════════════════════════════════════════════════════════════════

const MODULOS_EXTRA_7 = [
  { key: "tecnicos", label: "Técnicos", ic: "👷", seccion: "operacion", roles: ["admin", "operaciones", "comercial"], view: viewTecnicos },
];

let TEC_DATOS = null;

async function viewTecnicos(content) {
  content.innerHTML = `
    <div class="toolbar">
      <label class="oculto-panel" for="tec-dias">Período</label>
      <select id="tec-dias">
        <option value="1">Hoy</option>
        <option value="7" selected>Últimos 7 días</option>
        <option value="30">Últimos 30 días</option>
        <option value="90">Últimos 90 días</option>
      </select>
      <label class="oculto-panel" for="tec-sitio">Planta</label>
      <select id="tec-sitio"><option value="">Todas las plantas</option></select>
      <span class="toolbar-sep"></span>
      <button class="btn btn-sm" id="tec-actualizar">↻ Actualizar</button>
    </div>
    <div id="tec-cuerpo"><div class="center-msg">Cargando…</div></div>`;

  get("/sitios")
    .then((ss) => {
      $("#tec-sitio").innerHTML =
        `<option value="">Todas las plantas</option>` +
        ss.map((s) => `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`).join("");
    })
    .catch(() => {});

  async function cargar() {
    const cuerpo = $("#tec-cuerpo");
    cuerpo.innerHTML = `<div class="center-msg">Cargando…</div>`;
    const qs = new URLSearchParams({ dias: $("#tec-dias").value });
    if ($("#tec-sitio").value) qs.set("sitio_id", $("#tec-sitio").value);
    try {
      TEC_DATOS = await get(`/reportes/tecnicos?${qs}`);
    } catch (e) {
      cuerpo.innerHTML = `<div class="card"><div class="form-error" style="display:block">${esc(e.message)}</div></div>`;
      return;
    }
    cuerpo.innerHTML = pantallaTecnicosHTML(TEC_DATOS);

    cuerpo.querySelectorAll("tr[data-clave]").forEach((tr) => {
      tr.addEventListener("click", () => abrirTecnico(tr.dataset.clave));
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") abrirTecnico(tr.dataset.clave); });
    });
  }

  $("#tec-dias").addEventListener("change", cargar);
  $("#tec-sitio").addEventListener("change", cargar);
  $("#tec-actualizar").addEventListener("click", cargar);
  await cargar();
}

const fmtHora = (f) =>
  f ? new Date(f).toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit", timeZone: "America/Santo_Domingo" }) : "—";

function haceCuanto(f) {
  if (!f) return "—";
  const min = Math.round((Date.now() - new Date(f)) / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} día${d === 1 ? "" : "s"}`;
}

const claseIndice = (i) => (i >= 75 ? "hecho" : i >= 50 ? "fuera" : "pendiente");

function pantallaTecnicosHTML(d) {
  const lista = d.tecnicos.filter((t) => t.registros || !t.clave.startsWith("sin"));
  const conDatos = lista.filter((t) => t.registros);
  const max = Math.max(1, ...lista.map((t) => t.registros));
  const periodo = d.dias === 1 ? "hoy" : `los últimos ${d.dias} días`;
  const totalTec = lista.filter((t) => !t.clave.startsWith("sin")).length;

  const kpis = `
    <div class="kpi-grid">
      <div class="kpi-card g">
        <div class="lbl">Registros hoy</div>
        <div class="val">${d.hoy_total}</div>
      </div>
      <div class="kpi-card ${d.activos_hoy && d.activos_hoy >= totalTec ? "g" : "w"}">
        <div class="lbl">Técnicos que subieron hoy</div>
        <div class="val">${d.activos_hoy} <span class="kpi-de">de ${totalTec}</span></div>
      </div>
      <div class="kpi-card c">
        <div class="lbl">Más registros (${esc(periodo)})</div>
        <div class="val kpi-nombre">${d.lider ? `🥇 ${esc(d.lider.nombre)}` : "—"}</div>
        <div class="kpi-sub">${d.lider ? `${d.lider.registros} registros · ${d.lider.participacion_pct}% del total` : "Sin registros en el período"}</div>
      </div>
      <div class="kpi-card t">
        <div class="lbl">Mejor índice</div>
        <div class="val kpi-nombre">${d.mejor_indice ? esc(d.mejor_indice.nombre) : "—"}</div>
        <div class="kpi-sub">${d.mejor_indice ? `Índice ${d.mejor_indice.indice} de 100` : ""}</div>
      </div>
    </div>`;

  const aviso = d.sin_registro_hoy.length
    ? `<div class="card aviso-tec">
         <strong>Sin subir nada hoy (${d.sin_registro_hoy.length}):</strong>
         ${d.sin_registro_hoy.map((n) => `<span class="estado-chip pendiente">${esc(n)}</span>`).join(" ")}
       </div>`
    : d.activos_hoy
      ? `<div class="card aviso-tec ok"><strong>✓ Todos los técnicos subieron información hoy.</strong></div>`
      : "";

  const filas = lista
    .map((t, n) => {
      const puesto = t.registros ? (n === 0 ? "🥇" : n === 1 ? "🥈" : n === 2 ? "🥉" : n + 1) : "—";
      const plantas = t.plantas.slice(0, 2).map((p) => p.nombre).join(", ") + (t.plantas.length > 2 ? ` +${t.plantas.length - 2}` : "");
      return `
        <tr class="clickable" data-clave="${esc(t.clave)}" tabindex="0" title="Ver el detalle de ${esc(t.nombre)}">
          <td class="tec-puesto">${puesto}</td>
          <td>
            <div class="tec-nombre">${esc(t.nombre)}</div>
            <div class="tec-sub">${t.registros ? esc(plantas) : "Sin registros en el período"}</div>
          </td>
          <td>
            ${t.hoy
              ? `<span class="estado-chip hecho">${t.hoy} hoy</span><div class="tec-sub">desde ${esc(fmtHora(t.primero_hoy))}</div>`
              : `<span class="estado-chip pendiente">0 hoy</span>`}
          </td>
          <td class="tec-barra-celda">
            <div class="tec-barra" title="${t.registros} registros">
              <span style="width:${(t.registros / max) * 100}%"></span>
            </div>
            <strong>${t.registros}</strong>
          </td>
          <td>${t.hechos}${t.no_realizados ? ` <span class="tec-sub">· ${t.no_realizados} no realiz.</span>` : ""}</td>
          <td>${t.dias_activos}${d.dias_con_operacion ? ` <span class="tec-sub">de ${d.dias_con_operacion}</span>` : ""}</td>
          <td>${t.promedio_dia || "—"}</td>
          <td>${t.hechos ? `${t.con_foto_pct}%` : "—"}</td>
          <td><span class="estado-chip ${claseIndice(t.indice)}">${t.indice}</span></td>
          <td>${t.ultimo ? `${esc(haceCuanto(t.ultimo))}` : "—"}</td>
        </tr>`;
    })
    .join("");

  return `
    ${kpis}
    ${aviso}
    <div class="card" style="margin-top:16px">
      <div class="card-head"><h2>Ranking de técnicos — ${esc(periodo)}</h2></div>
      ${lista.length
        ? `<div class="table-wrap"><table class="data tabla-tec">
            <thead><tr>
              <th>#</th><th>Técnico</th><th>Hoy</th><th>Registros</th><th>Hechos</th>
              <th>Días activos</th><th>Prom./día</th><th>Con foto</th><th>Índice</th><th>Último</th>
            </tr></thead>
            <tbody>${filas}</tbody>
          </table></div>`
        : `<div class="empty-row">No hay técnicos activos ni registros en el período.</div>`}
      <p class="text-muted" style="margin-top:12px">
        <strong>Índice (0–100):</strong> 50% volumen (sus registros contra los del que más subió),
        20% constancia (días que subió, de los días con operación), 15% efectividad
        (lo que sí se pudo hacer) y 15% evidencia (servicios con foto).
        Toca un técnico para ver sus últimos registros.
      </p>
      ${d.truncado ? `<p class="form-error" style="display:block">Hay demasiados registros: se contaron los 50,000 más recientes. Elige un período más corto.</p>` : ""}
    </div>
    ${conDatos.length ? "" : `<p class="text-muted" style="margin-top:12px">Cuando los técnicos suban inspecciones desde la app, aparecerán aquí.</p>`}`;
}

function abrirTecnico(clave) {
  const t = TEC_DATOS?.tecnicos.find((x) => x.clave === clave);
  if (!t) return;

  openModal({ title: t.nombre, large: true, bodyHTML: `
    <div class="mini-kpis">
      <div><span class="mk-val">${t.registros}</span><span class="mk-lbl">registros en el período</span></div>
      <div><span class="mk-val">${t.hoy}</span><span class="mk-lbl">hoy${t.primero_hoy ? `, desde las ${esc(fmtHora(t.primero_hoy))}` : ""}</span></div>
      <div><span class="mk-val">${t.participacion_pct}%</span><span class="mk-lbl">del total del equipo</span></div>
      <div><span class="mk-val"><span class="estado-chip ${claseIndice(t.indice)}" style="font-size:20px">${t.indice}</span></span><span class="mk-lbl">índice de 100</span></div>
    </div>

    <div class="tec-componentes">
      ${componente("Constancia", t.constancia_pct, `${t.dias_activos} días con registros`)}
      ${componente("Efectividad", t.efectividad_pct, `${t.hechos} hechos · ${t.no_realizados} no realizados`)}
      ${componente("Evidencia", t.con_foto_pct, "servicios hechos con foto")}
    </div>

    ${t.tipos.length ? `
      <h4 class="tec-h4">Qué registró</h4>
      <div class="tec-chips">${t.tipos.map((x) => `<span class="estado-chip fuera">${x.icono} ${esc(x.nombre)} · ${x.n}</span>`).join(" ")}</div>` : ""}
    ${t.plantas.length ? `
      <h4 class="tec-h4">Plantas</h4>
      <div class="tec-chips">${t.plantas.map((x) => `<span class="estado-chip fuera">${esc(x.nombre)} · ${x.n}</span>`).join(" ")}</div>` : ""}

    <h4 class="tec-h4">Últimos registros</h4>
    ${t.recientes.length
      ? `<div class="table-wrap"><table class="data">
          <thead><tr><th>Fecha</th><th>Punto</th><th>Tipo</th><th>Planta</th><th>Resultado</th><th>Fotos</th></tr></thead>
          <tbody>${t.recientes.map((r) => `
            <tr class="clickable" data-insp="${esc(r.id)}" tabindex="0" title="Abrir el desglose">
              <td>${esc(fmtDateTime(r.fecha))}</td>
              <td><strong>${esc(r.codigo)}</strong> <span class="tec-sub">${esc(r.punto)}</span></td>
              <td>${r.icono} ${esc(r.tipo)}</td>
              <td>${esc(r.planta)}</td>
              <td>${r.hecho
                ? `<span class="estado-chip hecho">Hecho${r.nivel_actividad && r.nivel_actividad !== "ninguna" ? ` · actividad ${esc(r.nivel_actividad)}` : ""}</span>`
                : `<span class="estado-chip pendiente">No realizado</span>`}</td>
              <td>${r.fotos || "—"}</td>
            </tr>`).join("")}
          </tbody></table></div>`
      : `<div class="empty-row">Sin registros en el período.</div>`}
    ${t.ultimo_acceso ? `<p class="text-muted" style="margin-top:10px">Último acceso a la app: ${esc(fmtDateTime(t.ultimo_acceso))}</p>` : ""}
  ` });
  $(".modal-foot")?.remove();

  document.querySelectorAll(".modal [data-insp]").forEach((tr) => {
    const abrir = () => typeof abrirDesglose === "function" && abrirDesglose(tr.dataset.insp);
    tr.addEventListener("click", abrir);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") abrir(); });
  });
}

function componente(nombre, valor, detalle) {
  return `
    <div class="tec-comp">
      <div class="tec-comp-cab"><span>${esc(nombre)}</span><strong>${valor}%</strong></div>
      <div class="barra"><span style="width:${Math.min(valor, 100)}%"></span></div>
      <div class="tec-sub">${esc(detalle)}</div>
    </div>`;
}
