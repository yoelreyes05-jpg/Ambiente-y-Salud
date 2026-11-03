// ═════════════════════════════════════════════════════════════════════════
// incentivos.js — Técnicos → Evaluación e Incentivos (pago del día 5)
//
// Copia del "Formulario de Evaluación de Personal" de ASA:
//   · Evaluación: se escoge el colaborador de la lista y se despliega su
//     evaluación (9 renglones, calificación 1–10 o N/A). El % sale solo.
//   · Incentivos: quincena (sueldo × 50 %) × % de evaluación, más/menos los
//     ajustes del mes (bono, préstamos, combustible…). Descarga el Excel del
//     pago del día 5.
// Servidor: routes/incentivos.js · lib/incentivos.js
// ═════════════════════════════════════════════════════════════════════════

let INC_MES = null;           // AAAA-MM evaluado (se paga el 5 del mes siguiente)
let INC_PLANTILLA = null;
let EVAL_SEL = "";            // colaborador abierto en Evaluación

function mesAnterior() {
  const [a, m] = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" }).split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}
const nombreMes = (mes) => {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString("es-DO", { month: "long", year: "numeric", timeZone: "UTC" });
};
const fechaPagoTxt = (mes) => {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(m === 12 ? a + 1 : a, m === 12 ? 0 : m, 5)).toLocaleDateString("es-DO", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};
const rd = (n) => (Number(n) || 0).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctTxt = (p) => (p == null ? "—" : `${Number(p).toLocaleString("es-DO", { maximumFractionDigits: 2 })}%`);

async function plantillaIncentivos() {
  if (!INC_PLANTILLA) INC_PLANTILLA = await get("/incentivos/plantilla");
  return INC_PLANTILLA;
}

// Mismo cálculo que el servidor, para ver el % mientras se califica
function calcularEvalLocal(secciones, calif) {
  let faltan = 0;
  const renglones = secciones.map((s) => {
    let suma = 0, pesos = 0;
    for (const p of s.preguntas) {
      const v = calif[p.id];
      if (v === "NA") continue;
      if (v === "" || v == null) { faltan++; continue; }
      suma += Number(v) * p.peso; pesos += p.peso;
    }
    return { id: s.id, puntaje: pesos ? Math.round((suma / pesos) * 100) / 100 : null };
  });
  const v = renglones.filter((r) => r.puntaje != null);
  const porcentaje = v.length ? Math.round((v.reduce((a, r) => a + r.puntaje, 0) / v.length) * 1000) / 100 : 0;
  return { renglones, porcentaje, faltan };
}

function barraMes(id) {
  return `<label class="oculto-panel" for="${id}">Mes evaluado</label>
    <input type="month" id="${id}" value="${esc(INC_MES)}" title="Mes evaluado" />
    <span class="text-muted inc-pago">Pago: <strong>5 de ${esc(fechaPagoTxt(INC_MES).replace(/^5 de /, ""))}</strong></span>`;
}

// ══════════════════════════ EVALUACIÓN ═══════════════════════════════════
async function viewEvaluacion(content) {
  INC_MES = INC_MES || mesAnterior();
  content.innerHTML = `<div class="center-msg">Cargando…</div>`;
  let plantilla, cols, evals;
  try {
    [plantilla, cols, evals] = await Promise.all([
      plantillaIncentivos(), get("/incentivos/colaboradores"), get(`/incentivos/evaluaciones?mes=${INC_MES}`),
    ]);
  } catch (e) {
    content.innerHTML = `<div class="card"><div class="form-error" style="display:block">${esc(e.message)}</div></div>`;
    return;
  }
  const activos = cols.filter((c) => c.activo !== false);
  if (EVAL_SEL && !activos.some((c) => c.id === EVAL_SEL)) EVAL_SEL = "";
  const hechas = activos.filter((c) => evals[c.id]).length;

  content.innerHTML = `
    <div class="toolbar">
      ${barraMes("ev-mes")}
      <label class="oculto-panel" for="ev-col">Colaborador</label>
      <select id="ev-col" class="ev-col">
        <option value="">— Escoge el colaborador a evaluar —</option>
        ${activos.map((c) => `<option value="${esc(c.id)}" ${EVAL_SEL === c.id ? "selected" : ""}>${evals[c.id] ? "✓ " : ""}${esc(c.nombre)}${evals[c.id] ? ` · ${pctTxt(evals[c.id].porcentaje)}` : ""}</option>`).join("")}
      </select>
      <span class="toolbar-sep"></span>
      ${USUARIO?.rol === "admin" ? `<button class="btn btn-sm" id="ev-param">⚙️ Parámetros de la evaluación</button>` : ""}
    </div>
    <div id="ev-form"></div>
    <div class="card">
      <h3 class="card-title">Evaluaciones de ${esc(nombreMes(INC_MES))} · ${hechas} de ${activos.length}</h3>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Colaborador</th><th>Cliente</th><th>Evaluador</th><th>% Evaluación</th><th></th></tr></thead>
        <tbody>${activos.map((c) => {
          const e = evals[c.id];
          return `<tr class="clickable" data-ev="${esc(c.id)}" tabindex="0">
            <td><strong>${esc(c.nombre)}</strong></td><td>${esc(e?.cliente || c.cliente || "")}</td>
            <td>${esc(e?.evaluador || "")}</td>
            <td>${e ? `<span class="estado-chip ${e.porcentaje >= 80 ? "hecho" : e.porcentaje >= 60 ? "fuera" : "pendiente"}">${pctTxt(e.porcentaje)}</span>${e.completa ? "" : ` <small class="text-muted">incompleta</small>`}` : `<span class="text-muted">Sin evaluar</span>`}</td>
            <td>${e ? "Ver / editar" : "Evaluar"} ›</td></tr>`;
        }).join("")}</tbody></table></div>
    </div>`;

  $("#ev-mes").addEventListener("change", (ev) => { if (ev.target.value) { INC_MES = ev.target.value; viewEvaluacion(content); } });
  $("#ev-col").addEventListener("change", (ev) => { EVAL_SEL = ev.target.value; pintarFormEval(); });
  $("#ev-param")?.addEventListener("click", () => modalParametrosEval(plantilla, () => { INC_PLANTILLA = null; viewEvaluacion(content); }));
  content.querySelectorAll("[data-ev]").forEach((tr) => {
    const abrir = () => { EVAL_SEL = tr.dataset.ev; $("#ev-col").value = EVAL_SEL; pintarFormEval(); $("#ev-form").scrollIntoView({ behavior: "smooth" }); };
    tr.addEventListener("click", abrir);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") abrir(); });
  });

  function pintarFormEval() {
    const zona = $("#ev-form");
    const c = activos.find((x) => x.id === EVAL_SEL);
    if (!c) { zona.innerHTML = ""; return; }
    const e = evals[c.id] || {};
    const calif = { ...(e.calificaciones || {}) };
    const [a, m] = INC_MES.split("-").map(Number);
    const desde = e.desde || `${INC_MES}-01`;
    const hasta = e.hasta || new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
    const quincena = c.sueldo != null ? (c.base != null && c.base !== "" ? Number(c.base) : Number(c.sueldo) * 0.5) : null;

    zona.innerHTML = `
      <div class="card ev-card">
        <div class="ev-cab">
          <div><h3 class="card-title" style="margin:0">Evaluación de desempeño · ${esc(c.nombre)}</h3>
            <span class="text-muted">${esc(nombreMes(INC_MES))}${e.actualizado ? ` · guardada ${esc(fmtDateTime(e.actualizado))}` : " · nueva"}</span></div>
          <div class="ev-total"><span id="ev-pct">0%</span><small>de evaluación</small>
            ${quincena != null ? `<small id="ev-inc"></small>` : ""}</div>
        </div>
        <div class="form-grid ev-datos">
          <label>Posición<input name="posicion" value="${esc(e.posicion || c.posicion || "Técnico")}"></label>
          <label>Cliente<input name="cliente" value="${esc(e.cliente ?? c.cliente ?? "")}"></label>
          <label>Período desde<input type="date" name="desde" value="${esc(desde)}"></label>
          <label>Hasta<input type="date" name="hasta" value="${esc(hasta)}"></label>
          <label>Nombre del evaluador<input name="evaluador" value="${esc(e.evaluador || USUARIO?.nombre || "")}"></label>
          <label>Departamento<input name="departamento" value="${esc(e.departamento || "Fumigación")}"></label>
        </div>
        <label class="ev-larga">Describa brevemente el trabajo realizado<textarea name="trabajo" rows="2">${esc(e.trabajo || "")}</textarea></label>
        <details class="ev-escala"><summary>Definición de la calificación</summary>
          ${plantilla.escala.map((x) => `<p><strong>${esc(x.rango)}:</strong> ${esc(x.texto)}</p>`).join("")}
        </details>
        ${plantilla.secciones.map((s) => `
          <div class="ev-sec">
            <div class="ev-sec-t"><span>${esc(s.id)}.- ${esc(s.titulo)}</span><strong data-renglon="${esc(s.id)}">—</strong></div>
            ${s.preguntas.map((p, i) => `
              <div class="ev-preg">
                <div class="ev-preg-t">${String.fromCharCode(97 + i)}) ${esc(p.texto)} <small class="text-muted">· ponderación ${p.peso}</small></div>
                <div class="ev-notas" data-preg="${esc(p.id)}">
                  ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<button type="button" class="ev-n ${String(calif[p.id]) === String(n) ? "activa" : ""}" data-n="${n}">${n}</button>`).join("")}
                  <button type="button" class="ev-n na ${calif[p.id] === "NA" ? "activa" : ""}" data-n="NA">N/A</button>
                </div>
              </div>`).join("")}
          </div>`).join("")}
        <label class="ev-larga">Comentarios del evaluador (fortalezas y aspectos a mejorar)<textarea name="comentarios" rows="3">${esc(e.comentarios || "")}</textarea></label>
        <label class="ev-larga">Comentarios del personal evaluado<textarea name="comentarios_evaluado" rows="2">${esc(e.comentarios_evaluado || "")}</textarea></label>
        <p class="text-muted" id="ev-faltan"></p>
        <div class="ev-botones">
          <button class="btn" id="ev-guardar">💾 Guardar evaluación</button>
          <button class="btn btn-sm" id="ev-copiar" title="Pone las mismas notas que tuvo el mes anterior para que solo cambies lo distinto">📋 Copiar notas del mes anterior</button>
          <button class="btn btn-sm" id="ev-imprimir">🖨 Imprimir</button>
          ${e.actualizado ? `<button class="btn btn-sm btn-danger" id="ev-borrar">Borrar</button>` : ""}
        </div>
      </div>`;

    const recalcular = () => {
      const r = calcularEvalLocal(plantilla.secciones, calif);
      $("#ev-pct").textContent = pctTxt(r.porcentaje);
      if ($("#ev-inc")) $("#ev-inc").textContent = `Incentivo: RD$ ${rd(quincena * r.porcentaje / 100)}`;
      for (const x of r.renglones) {
        const el = zona.querySelector(`[data-renglon="${CSS.escape(x.id)}"]`);
        if (el) el.textContent = x.puntaje == null ? "—" : x.puntaje.toFixed(2);
      }
      $("#ev-faltan").textContent = r.faltan ? `Faltan ${r.faltan} pregunta(s) por calificar (no cuentan hasta que las califiques; usa N/A si no aplican).` : "";
      return r;
    };
    recalcular();

    zona.querySelector(".ev-card").addEventListener("click", async (ev) => {
      const b = ev.target.closest(".ev-n");
      if (b) {
        const fila = b.closest("[data-preg]");
        const id = fila.dataset.preg;
        calif[id] = calif[id] === (b.dataset.n === "NA" ? "NA" : Number(b.dataset.n)) ? "" : b.dataset.n === "NA" ? "NA" : Number(b.dataset.n);
        fila.querySelectorAll(".ev-n").forEach((x) => x.classList.toggle("activa", String(calif[id]) === x.dataset.n));
        recalcular();
        return;
      }
      if (ev.target.closest("#ev-copiar")) {
        const [ya, ym] = INC_MES.split("-").map(Number);
        const previo = ym === 1 ? `${ya - 1}-12` : `${ya}-${String(ym - 1).padStart(2, "0")}`;
        try {
          const ant = (await get(`/incentivos/evaluaciones?mes=${previo}`))[c.id];
          if (!ant) return toast(`${c.nombre} no tiene evaluación en ${nombreMes(previo)}`, true);
          let n = 0;
          zona.querySelectorAll("[data-preg]").forEach((fila) => {
            const v = ant.calificaciones?.[fila.dataset.preg];
            if (v == null || v === "") return;
            calif[fila.dataset.preg] = v; n++;
            fila.querySelectorAll(".ev-n").forEach((x) => x.classList.toggle("activa", String(v) === x.dataset.n));
          });
          recalcular();
          toast(`Copiadas ${n} notas de ${nombreMes(previo)}. Cambia lo que sea distinto y guarda.`);
        } catch (e2) { toast(e2.message, true); }
        return;
      }
      if (ev.target.closest("#ev-imprimir")) return imprimirEvaluacion(c, plantilla, calif, datosForm(), recalcular());
      if (ev.target.closest("#ev-borrar")) {
        if (!confirm(`¿Borrar la evaluación de ${c.nombre} de ${nombreMes(INC_MES)}?`)) return;
        await api(`/incentivos/evaluaciones/${INC_MES}/${encodeURIComponent(c.id)}`, { method: "DELETE" });
        toast("Evaluación borrada");
        return viewEvaluacion(content);
      }
      if (ev.target.closest("#ev-guardar")) {
        const boton = ev.target.closest("#ev-guardar");
        boton.disabled = true;
        try {
          const g = await put(`/incentivos/evaluaciones/${INC_MES}/${encodeURIComponent(c.id)}`, { ...datosForm(), calificaciones: calif });
          toast(`Evaluación guardada: ${pctTxt(g.porcentaje)}`);
          // pasa al siguiente sin evaluar
          const sig = activos.find((x) => x.id !== c.id && !evals[x.id]);
          EVAL_SEL = sig ? "" : c.id;
          viewEvaluacion(content);
        } catch (e2) { toast(e2.message, true); boton.disabled = false; }
      }
    });

    function datosForm() {
      const o = {};
      zona.querySelectorAll("input[name], textarea[name]").forEach((x) => { o[x.name] = x.value; });
      return o;
    }
  }
  pintarFormEval();
}

function imprimirEvaluacion(c, plantilla, calif, d, r) {
  const fecha = (f) => (f ? new Date(`${f}T12:00:00`).toLocaleDateString("es-DO") : "");
  const w = window.open("", "_blank");
  if (!w) return toast("Permite las ventanas emergentes para imprimir", true);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Evaluación ${esc(c.nombre)}</title>
    <style>body{font:12px Arial,sans-serif;margin:24px;color:#111}h1{font-size:16px;text-align:center;margin:0 0 4px}
    h2{font-size:13px;background:#e8f5e9;padding:4px 6px;margin:12px 0 4px}table{width:100%;border-collapse:collapse}
    td,th{border:1px solid #999;padding:3px 5px;vertical-align:top}th{background:#f3f3f3}.n{text-align:center;width:70px}
    .g{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin:8px 0}.tot{font-size:15px;font-weight:bold;text-align:right;margin-top:8px}
    .f{display:grid;grid-template-columns:1fr 1fr;gap:40px 30px;margin-top:40px}.f div{border-top:1px solid #000;padding-top:3px;text-align:center}</style></head><body>
    <h1>Ambiente y Salud, ASA, S. R. L.</h1><h1>EVALUACIÓN DE DESEMPEÑO EN EL TRABAJO</h1>
    <div class="g"><div><b>Nombre evaluado:</b> ${esc(c.nombre)}</div><div><b>Posición:</b> ${esc(d.posicion)}</div>
    <div><b>Cliente:</b> ${esc(d.cliente)}</div><div><b>Período:</b> ${fecha(d.desde)} al ${fecha(d.hasta)}</div>
    <div><b>Evaluador:</b> ${esc(d.evaluador)}</div><div><b>Departamento:</b> ${esc(d.departamento)}</div></div>
    ${d.trabajo ? `<p><b>Trabajo realizado:</b> ${esc(d.trabajo)}</p>` : ""}
    ${plantilla.secciones.map((s) => `<h2>${esc(s.id)}.- ${esc(s.titulo)} · puntaje ${r.renglones.find((x) => x.id === s.id)?.puntaje?.toFixed(2) ?? "N/A"}</h2>
      <table><tr><th></th><th class="n">Calificación</th><th class="n">Ponderación</th><th class="n">Puntaje</th></tr>
      ${s.preguntas.map((p, i) => { const v = calif[p.id]; return `<tr><td>${String.fromCharCode(97 + i)}) ${esc(p.texto)}</td>
        <td class="n">${v === "NA" ? "N/A" : v ?? ""}</td><td class="n">${p.peso}</td><td class="n">${v === "NA" || v == null || v === "" ? "" : (v * p.peso).toFixed(2)}</td></tr>`; }).join("")}</table>`).join("")}
    <div class="tot">Resumen de calificaciones: ${pctTxt(r.porcentaje)}</div>
    ${d.comentarios ? `<p><b>Comentarios del evaluador:</b> ${esc(d.comentarios)}</p>` : ""}
    ${d.comentarios_evaluado ? `<p><b>Comentarios del evaluado:</b> ${esc(d.comentarios_evaluado)}</p>` : ""}
    <div class="f"><div>Evaluado</div><div>Recursos Humanos</div><div>Evaluador</div><div>Socio</div></div>
    <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

// ══════════════════════════ INCENTIVOS ═══════════════════════════════════
async function viewIncentivos(content) {
  INC_MES = INC_MES || mesAnterior();
  content.innerHTML = `<div class="center-msg">Cargando…</div>`;
  let plantilla, d;
  try {
    [plantilla, d] = await Promise.all([plantillaIncentivos(), get(`/incentivos/${INC_MES}`)]);
  } catch (e) {
    content.innerHTML = `<div class="card"><div class="form-error" style="display:block">${esc(e.message)}</div></div>`;
    return;
  }
  const aj = plantilla.ajustes;
  const sinEval = d.filas.filter((f) => f.origen_porcentaje === "sin_evaluar");

  const pintarTotales = () => {
    const t = { resultado: 0, total: 0 };
    for (const f of d.filas) { t.resultado += f.resultado; t.total += f.total; }
    $("#inc-k-total").textContent = `RD$ ${rd(t.total)}`;
    $("#inc-k-res").textContent = `RD$ ${rd(t.resultado)}`;
    for (const a of aj) $(`#inc-t-${a.campo}`).textContent = rd(d.filas.reduce((s, f) => s + a.signo * f[a.campo], 0));
    $("#inc-t-resultado").textContent = rd(t.resultado);
    $("#inc-t-total").textContent = rd(t.total);
  };

  content.innerHTML = `
    <div class="toolbar">
      ${barraMes("inc-mes")}
      <span class="toolbar-sep"></span>
      <button class="btn btn-sm" id="inc-colab">👥 Colaboradores y sueldos</button>
      <button class="btn" id="inc-excel">⬇ Excel del pago (día 5)</button>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card g"><div class="lbl">Total a pagar el 5 de ${esc(fechaPagoTxt(INC_MES).replace(/^5 de /, ""))}</div><div class="val" id="inc-k-total"></div></div>
      <div class="kpi-card c"><div class="lbl">Incentivo por evaluación</div><div class="val" id="inc-k-res"></div></div>
      <div class="kpi-card ${sinEval.length ? "w" : "t"}"><div class="lbl">Evaluados</div><div class="val">${d.filas.length - sinEval.length} <span class="kpi-de">de ${d.filas.length}</span></div>
        <div class="kpi-sub">${sinEval.length ? `${sinEval.length} sin evaluar (cobran 0 de incentivo si no les pones % a mano)` : "Todos evaluados"}</div></div>
    </div>
    <div class="card">
      <p class="text-muted" style="margin-top:0">
        <strong>Cómo se calcula:</strong> Resultado = Quincena (sueldo × 50 %) × % de evaluación.
        Total = Resultado − días no trabajados + trabajos adicionales + días libres trabajados + bono + Santiago − préstamos + combustible + reembolso.
        Los descuentos se escriben en positivo y se restan solos. Se guarda al salir de cada casilla.
      </p>
      <div class="table-wrap"><table class="data inc-tabla">
        <thead><tr><th>Colaborador</th><th>Quincena</th><th>% Evaluación</th><th>Resultado</th>
          ${aj.map((a) => `<th class="${a.signo < 0 ? "inc-neg" : ""}">${esc(a.nombre)}${a.signo < 0 ? " (−)" : ""}</th>`).join("")}
          <th>Total a pagar</th><th>Notas</th></tr></thead>
        <tbody>${d.filas.map((f) => `
          <tr data-col="${esc(f.colaborador_id)}">
            <td><strong>${esc(f.nombre)}</strong><div class="tec-sub">${esc([f.zona, f.cliente].filter(Boolean).join(" · "))} · sueldo ${rd(f.sueldo)}</div></td>
            <td class="num">${rd(f.quincena)}</td>
            <td>${f.origen_porcentaje === "evaluacion"
              ? `<a href="#" class="inc-ver-ev" data-ev="${esc(f.colaborador_id)}" title="Ver la evaluación">${pctTxt(f.porcentaje)}</a>`
              : `<input class="inc-in" type="number" min="0" max="100" step="0.01" data-campo="porcentaje_manual" value="${f.porcentaje ?? ""}" placeholder="% a mano" title="Sin evaluar: escribe el % a mano si aplica">`}</td>
            <td class="num" data-res>${rd(f.resultado)}</td>
            ${aj.map((a) => `<td><input class="inc-in" type="number" min="0" step="0.01" data-campo="${a.campo}" value="${f[a.campo] || ""}"></td>`).join("")}
            <td class="num inc-total" data-tot>${rd(f.total)}</td>
            <td><input class="inc-in inc-nota" data-campo="notas" value="${esc(f.notas || "")}"></td>
          </tr>`).join("")}</tbody>
        <tfoot><tr><th>TOTALES</th><th class="num">${rd(d.totales.quincena)}</th><th></th><th class="num" id="inc-t-resultado"></th>
          ${aj.map((a) => `<th class="num" id="inc-t-${a.campo}"></th>`).join("")}<th class="num" id="inc-t-total"></th><th></th></tr></tfoot>
      </table></div>
    </div>`;
  pintarTotales();

  $("#inc-mes").addEventListener("change", (ev) => { if (ev.target.value) { INC_MES = ev.target.value; viewIncentivos(content); } });
  $("#inc-colab").addEventListener("click", () => modalColaboradores(() => viewIncentivos(content)));
  $("#inc-excel").addEventListener("click", async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true;
    try {
      const res = await fetch(`${CONFIG.API_BASE}/incentivos/${INC_MES}/excel`, { headers: { Authorization: `Bearer ${TOKEN}` } });
      if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = `incentivos-${INC_MES}-pago-dia-5.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { toast(`No se pudo descargar: ${e.message}`, true); }
    b.disabled = false;
  });
  content.querySelectorAll(".inc-ver-ev").forEach((a) => a.addEventListener("click", (ev) => {
    ev.preventDefault(); EVAL_SEL = a.dataset.ev; TEC_SUB = "evaluacion";
    viewTecnicos(content.closest("#tec-pestana")?.parentElement || content);
  }));

  // Guardar la fila al salir de una casilla
  content.querySelectorAll("tr[data-col]").forEach((tr) => {
    tr.addEventListener("change", async () => {
      const cuerpo = {};
      tr.querySelectorAll("[data-campo]").forEach((x) => { cuerpo[x.dataset.campo] = x.value; });
      try {
        const f = await put(`/incentivos/${INC_MES}/${encodeURIComponent(tr.dataset.col)}`, cuerpo);
        const i = d.filas.findIndex((x) => x.colaborador_id === tr.dataset.col);
        if (i >= 0 && f.colaborador_id) d.filas[i] = f;
        tr.querySelector("[data-res]").textContent = rd(f.resultado);
        tr.querySelector("[data-tot]").textContent = rd(f.total);
        pintarTotales();
        tr.classList.add("inc-ok"); setTimeout(() => tr.classList.remove("inc-ok"), 800);
      } catch (e) { toast(e.message, true); }
    });
  });
}

async function modalColaboradores(alGuardar) {
  const lista = await get("/incentivos/colaboradores");
  const fila = (c = {}) => `
    <tr data-id="${esc(c.id || "")}">
      <td><input data-k="nombre" value="${esc(c.nombre || "")}" placeholder="Nombre completo"></td>
      <td><input data-k="zona" value="${esc(c.zona || "")}"></td>
      <td><input data-k="cliente" value="${esc(c.cliente || "")}"></td>
      <td><input data-k="sueldo" type="number" min="0" value="${c.sueldo ?? ""}"></td>
      <td><input data-k="base" type="number" min="0" value="${c.base ?? ""}" placeholder="50 %"></td>
      <td style="text-align:center"><input data-k="activo" type="checkbox" ${c.activo !== false ? "checked" : ""}></td>
    </tr>`;
  openModal({
    title: "Colaboradores y sueldos", large: true, submitLabel: "Guardar lista",
    bodyHTML: `
      <p class="text-muted">Esta es la lista que sale en Evaluación e Incentivos. <strong>Quincena</strong>: déjala vacía
        para usar el 50 % del sueldo; escribe un monto solo si a esa persona se le calcula distinto.
        Desmarca <strong>Activo</strong> para quien ya no trabaja (no se borra su historial).</p>
      <div class="table-wrap"><table class="data inc-colabs">
        <thead><tr><th>Nombre</th><th>Zona</th><th>Cliente</th><th>Sueldo</th><th>Quincena</th><th>Activo</th></tr></thead>
        <tbody id="colab-filas">${lista.map(fila).join("")}</tbody></table></div>
      <button type="button" class="btn btn-sm" id="colab-mas" style="margin-top:8px">+ Agregar colaborador</button>`,
    onMount(overlay) {
      overlay.querySelector("#colab-mas").addEventListener("click", () => {
        overlay.querySelector("#colab-filas").insertAdjacentHTML("beforeend", fila());
        overlay.querySelector("#colab-filas tr:last-child input")?.focus();
      });
    },
    async onSubmit(fd, overlay) {
      const nueva = [...overlay.querySelectorAll("#colab-filas tr")].map((tr) => {
        const o = { id: tr.dataset.id || undefined };
        tr.querySelectorAll("[data-k]").forEach((x) => { o[x.dataset.k] = x.type === "checkbox" ? x.checked : x.value; });
        return o;
      }).filter((o) => o.nombre.trim());
      await put("/incentivos/colaboradores", nueva);
      closeModal();
      toast("Lista guardada");
      alGuardar?.();
    },
  });
}

// ── Parámetros de la evaluación (renglones, preguntas, ponderaciones) ────────
function modalParametrosEval(plantilla, alGuardar) {
  const preg = (p = {}) => `
    <div class="par-preg" data-pid="${esc(p.id || "")}">
      <input class="par-texto" value="${esc(p.texto || "")}" placeholder="Texto de la pregunta">
      <input class="par-peso" type="number" min="0.01" step="0.01" value="${p.peso ?? ""}" placeholder="Peso" title="Ponderación">
      <button type="button" class="btn btn-sm btn-danger par-quitar-p" title="Quitar pregunta">✕</button>
    </div>`;
  const sec = (s = { preguntas: [{}] }) => `
    <div class="par-sec">
      <div class="par-sec-cab">
        <input class="par-id" value="${esc(s.id || "")}" placeholder="Código" title="Código (I.1, II.1…)">
        <input class="par-titulo" value="${esc(s.titulo || "")}" placeholder="Nombre del renglón">
        <span class="par-suma"></span>
        <button type="button" class="btn btn-sm btn-danger par-quitar-s" title="Quitar renglón">Quitar renglón</button>
      </div>
      <div class="par-pregs">${s.preguntas.map(preg).join("")}</div>
      <button type="button" class="btn btn-sm par-mas-p">+ Pregunta</button>
    </div>`;
  openModal({
    title: "Parámetros de la evaluación", large: true, submitLabel: "Guardar parámetros",
    bodyHTML: `
      <p class="text-muted">Aquí cambias lo que se evalúa cada mes. Cada renglón da un puntaje de 0 a 10
        (calificación × ponderación); el % de evaluación es el promedio de los renglones × 10.
        Lo normal es que las ponderaciones de cada renglón sumen <strong>1</strong>; si no, se reparten en proporción.
        Las evaluaciones ya guardadas no cambian.</p>
      <div id="par-secs">${plantilla.secciones.map(sec).join("")}</div>
      <div class="ev-botones">
        <button type="button" class="btn btn-sm" id="par-mas-s">+ Renglón</button>
        ${plantilla.original ? "" : `<button type="button" class="btn btn-sm" id="par-restaurar">↺ Volver a los del formulario original</button>`}
      </div>`,
    onMount(o) {
      const sumas = () => o.querySelectorAll(".par-sec").forEach((s) => {
        const t = [...s.querySelectorAll(".par-peso")].reduce((a, x) => a + (Number(x.value) || 0), 0);
        const el = s.querySelector(".par-suma");
        el.textContent = `Suma: ${Math.round(t * 100) / 100}`;
        el.classList.toggle("mal", Math.abs(t - 1) > 0.001);
      });
      sumas();
      o.addEventListener("input", sumas);
      o.addEventListener("click", async (e) => {
        if (e.target.closest(".par-mas-p")) { e.target.closest(".par-sec").querySelector(".par-pregs").insertAdjacentHTML("beforeend", preg()); sumas(); }
        else if (e.target.closest(".par-quitar-p")) { e.target.closest(".par-preg").remove(); sumas(); }
        else if (e.target.closest(".par-quitar-s")) { if (confirm("¿Quitar este renglón y sus preguntas?")) e.target.closest(".par-sec").remove(); }
        else if (e.target.closest("#par-mas-s")) { o.querySelector("#par-secs").insertAdjacentHTML("beforeend", sec()); sumas(); }
        else if (e.target.closest("#par-restaurar")) {
          if (!confirm("¿Volver a los parámetros del formulario original?")) return;
          await put("/incentivos/plantilla", { restaurar: true });
          closeModal(); toast("Parámetros restaurados"); alGuardar?.();
        }
      });
    },
    async onSubmit(fd, o) {
      const secciones = [...o.querySelectorAll(".par-sec")].map((s) => ({
        id: s.querySelector(".par-id").value.trim(), titulo: s.querySelector(".par-titulo").value.trim(),
        preguntas: [...s.querySelectorAll(".par-preg")].map((p) => ({
          id: p.dataset.pid || undefined, texto: p.querySelector(".par-texto").value.trim(), peso: Number(p.querySelector(".par-peso").value),
        })).filter((p) => p.texto),
      }));
      await put("/incentivos/plantilla", { secciones });
      closeModal(); toast("Parámetros guardados"); alGuardar?.();
    },
  });
}
