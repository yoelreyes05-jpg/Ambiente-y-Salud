// ═════════════════════════════════════════════════════════════════════════
// cronograma.js — Cronograma de trabajo (programación de servicios)
//
// · Subir el Excel de "PROG. SERVICIO" tal como se descarga hoy.
// · Ver la semana: los días y horas de cada servicio, por planta.
// · Corregir una fila (fecha, horas, planta, título, notas, equipo, estado),
//   borrar una o varias, y agregar a mano.
// · Repetir una semana en las siguientes (mismo día y hora).
//
// Lo mismo lo ven el técnico (app) y el hotel (portal), solo de sus plantas.
// Se carga antes de app.js y aporta MODULOS_EXTRA_10.
// ═════════════════════════════════════════════════════════════════════════

const MODULOS_EXTRA_10 = [
  { key: "cronograma", label: "Cronograma", ic: "📅", seccion: "operacion", roles: ["admin", "operaciones", "comercial"], view: viewCronograma },
];

const CRONO_ESTADOS = [["pendiente", "Pendiente"], ["realizado", "Realizado"], ["reprogramado", "Reprogramado"], ["cancelado", "Cancelado"]];
const CRONO_DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const CRONO_COLORES = ["#32539C", "#4A7D4D", "#B45309", "#0E7490", "#7C3AED", "#B91C1C", "#CA8A04", "#DB2777", "#475569"];
let CRONO = { semana: null, sitio: "", vista: "semana", sitios: [] };

const tz = { timeZone: "America/Santo_Domingo" };
const fechaRDc = (iso) => new Date(iso).toLocaleDateString("en-CA", tz);
const horaRDc = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { ...tz, hour: "2-digit", minute: "2-digit" }) : "");
const sumarDiasC = (f, n) => {
  const d = new Date(f + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
// Lunes de la semana de una fecha
function lunesDe(fecha) {
  const d = new Date(fecha + "T12:00:00Z");
  const dia = (d.getUTCDay() + 6) % 7;
  return sumarDiasC(fecha, -dia);
}
const fechaCortaC = (f) => {
  const [y, m, d] = f.split("-");
  return `${d}/${m}`;
};
function colorPlanta(nombre) {
  let h = 0;
  for (const c of String(nombre || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CRONO_COLORES[h % CRONO_COLORES.length];
}

async function viewCronograma(content) {
  if (!CRONO.semana) CRONO.semana = lunesDe(hoyLocal());
  content.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-sm" id="cr-ant">◀</button>
      <strong id="cr-titulo" style="min-width:210px;text-align:center"></strong>
      <button class="btn btn-sm" id="cr-sig">▶</button>
      <button class="btn btn-sm" id="cr-hoy">Esta semana</button>
      <select id="cr-sitio"><option value="">Todas las plantas</option></select>
      <select id="cr-vista">
        <option value="semana">Vista semanal</option>
        <option value="plantas">Por planta</option>
        <option value="lista">Lista (editar / borrar varios)</option>
      </select>
      <span class="toolbar-sep"></span>
      <button class="btn btn-sm" id="cr-copiar-ant" title="Trae a esta semana lo de la semana anterior, mismo día y hora">⤵ Copiar semana anterior</button>
      <button class="btn btn-sm" id="cr-repetir">Repetir semana…</button>
      <button class="btn btn-sm" id="cr-nuevo">+ Servicio</button>
      <button class="btn btn-sm btn-primary" id="cr-excel">Subir Excel</button>
    </div>
    <div id="cr-cuerpo"><div class="center-msg">Cargando…</div></div>`;

  CRONO.sitios = await get("/sitios").catch(() => []);
  $("#cr-sitio").innerHTML = `<option value="">Todas las plantas</option>` +
    CRONO.sitios.map((s) => `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`).join("") +
    `<option value="sin_planta">Sin planta asignada</option>`;
  $("#cr-sitio").value = CRONO.sitio;
  $("#cr-vista").value = CRONO.vista;

  $("#cr-ant").addEventListener("click", () => { CRONO.semana = sumarDiasC(CRONO.semana, -7); pintarCronograma(); });
  $("#cr-sig").addEventListener("click", () => { CRONO.semana = sumarDiasC(CRONO.semana, 7); pintarCronograma(); });
  $("#cr-hoy").addEventListener("click", () => { CRONO.semana = lunesDe(hoyLocal()); pintarCronograma(); });
  $("#cr-sitio").addEventListener("change", (e) => { CRONO.sitio = e.target.value; pintarCronograma(); });
  $("#cr-vista").addEventListener("change", (e) => { CRONO.vista = e.target.value; pintarCronograma(); });
  $("#cr-nuevo").addEventListener("click", () => modalServicioCrono(null));
  $("#cr-excel").addEventListener("click", modalImportarCrono);
  $("#cr-repetir").addEventListener("click", modalRepetirCrono);
  $("#cr-copiar-ant").addEventListener("click", copiarSemanaAnterior);
  await pintarCronograma();
}

async function pintarCronograma() {
  const cuerpo = $("#cr-cuerpo");
  if (!cuerpo) return;
  const desde = CRONO.semana;
  const hasta = sumarDiasC(desde, 6);
  $("#cr-titulo").textContent = `Semana del ${fechaCortaC(desde)} al ${fechaCortaC(hasta)}/${hasta.slice(0, 4)}`;
  cuerpo.innerHTML = `<div class="center-msg">Cargando…</div>`;

  const qs = new URLSearchParams({ desde, hasta });
  if (CRONO.sitio) qs.set("sitio_id", CRONO.sitio);
  let r;
  try {
    r = await get(`/cronograma?${qs}`);
  } catch (e) {
    cuerpo.innerHTML = `<div class="card"><div class="form-error" style="display:block">${esc(e.message)}</div></div>`;
    return;
  }
  const filas = r.filas;
  if (!filas.length) {
    cuerpo.innerHTML = `<div class="card"><div class="center-msg">
      No hay servicios programados esta semana${CRONO.sitio ? " para esta planta" : ""}.
      Sube el Excel de la programación, agrega un servicio o trae lo de la semana anterior.
      <div style="margin-top:12px"><button class="btn btn-primary" id="cr-copiar-vacia">⤵ Copiar la semana anterior aquí</button></div>
    </div></div>`;
    $("#cr-copiar-vacia").addEventListener("click", copiarSemanaAnterior);
    return;
  }

  const resumen = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="lbl">Servicios en la semana</div><div class="val">${filas.length}</div></div>
      <div class="kpi-card g"><div class="lbl">Realizados</div><div class="val">${filas.filter((f) => f.estado === "realizado").length}</div></div>
      <div class="kpi-card w"><div class="lbl">Pendientes</div><div class="val">${filas.filter((f) => f.estado === "pendiente").length}</div></div>
      <div class="kpi-card c"><div class="lbl">Plantas</div><div class="val">${new Set(filas.map((f) => f.planta)).size}</div></div>
    </div>`;

  if (CRONO.vista === "lista") {
    cuerpo.innerHTML = resumen + `
      <div class="card">
        <div class="toolbar">
          <label class="campo-check" style="margin:0"><input type="checkbox" id="cr-todos" /> Seleccionar todo</label>
          <span class="toolbar-sep"></span>
          <button class="btn btn-sm btn-danger" id="cr-borrar-sel" disabled>Borrar seleccionados</button>
        </div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th></th><th>Día</th><th>Hora</th><th>Planta</th><th>Servicio</th><th>Notas</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            ${filas.map((f) => `
              <tr data-id="${esc(f.id)}">
                <td><input type="checkbox" class="cr-sel" value="${esc(f.id)}" /></td>
                <td>${CRONO_DIAS[(new Date(fechaRDc(f.fecha_inicio) + "T12:00:00Z").getUTCDay() + 6) % 7]} ${fechaCortaC(fechaRDc(f.fecha_inicio))}</td>
                <td>${horaRDc(f.fecha_inicio)}${f.fecha_fin ? `–${horaRDc(f.fecha_fin)}` : ""}</td>
                <td><span class="cr-punto" style="background:${colorPlanta(f.planta)}"></span>${esc(f.planta)}</td>
                <td>${esc(f.titulo)}</td>
                <td class="text-muted">${esc(f.notas || "")}</td>
                <td>${chipCrono(f.estado)}</td>
                <td><button class="btn btn-sm cr-editar">Editar</button></td>
              </tr>`).join("")}
          </tbody>
        </table></div>
      </div>`;
    const sel = () => $$(".cr-sel:checked").map((x) => x.value);
    const refrescar = () => { $("#cr-borrar-sel").disabled = !sel().length; $("#cr-borrar-sel").textContent = `Borrar seleccionados (${sel().length})`; };
    $$(".cr-sel").forEach((c) => c.addEventListener("change", refrescar));
    $("#cr-todos").addEventListener("change", (e) => { $$(".cr-sel").forEach((c) => (c.checked = e.target.checked)); refrescar(); });
    $("#cr-borrar-sel").addEventListener("click", async () => {
      const ids = sel();
      if (!confirm(`¿Borrar ${ids.length} servicio(s) del cronograma? No se puede deshacer.`)) return;
      const r2 = await post("/cronograma/eliminar", { ids });
      toast(`${r2.borradas} borrado(s)`);
      pintarCronograma();
    });
    $$(".cr-editar").forEach((b) => b.addEventListener("click", () => modalServicioCrono(filas.find((f) => f.id === b.closest("tr").dataset.id))));
    return;
  }

  const dias = [...Array(7)].map((_, i) => sumarDiasC(desde, i));
  const tarjeta = (f) => `
    <div class="cr-item ${f.estado}" data-id="${esc(f.id)}" style="border-left-color:${colorPlanta(f.planta)}">
      <div class="cr-hora">${horaRDc(f.fecha_inicio)}${f.fecha_fin ? ` – ${horaRDc(f.fecha_fin)}` : ""}</div>
      ${CRONO.vista === "semana" && !CRONO.sitio ? `<div class="cr-planta" style="color:${colorPlanta(f.planta)}">${esc(f.planta)}</div>` : ""}
      <div class="cr-tit">${esc(f.notas || f.titulo)}</div>
      ${f.notas ? `<div class="cr-sub">${esc(f.titulo)}</div>` : ""}
      ${f.estado !== "pendiente" ? `<div>${chipCrono(f.estado)}</div>` : ""}
    </div>`;

  if (CRONO.vista === "plantas") {
    const plantas = [...new Set(filas.map((f) => f.planta))].sort((a, b) => a.localeCompare(b, "es"));
    cuerpo.innerHTML = resumen + plantas.map((p) => {
      const deP = filas.filter((f) => f.planta === p);
      return `
        <div class="card">
          <div class="card-head"><h2><span class="cr-punto" style="background:${colorPlanta(p)}"></span>${esc(p)} <span class="text-muted">· ${deP.length} servicio(s)</span></h2></div>
          <div class="cr-semana">
            ${dias.map((d, i) => `
              <div class="cr-dia ${d === hoyLocal() ? "hoy" : ""}">
                <div class="cr-dia-tit">${CRONO_DIAS[i]} <span>${fechaCortaC(d)}</span></div>
                ${deP.filter((f) => fechaRDc(f.fecha_inicio) === d).map(tarjeta).join("") || `<div class="cr-vacio">—</div>`}
              </div>`).join("")}
          </div>
        </div>`;
    }).join("");
  } else {
    cuerpo.innerHTML = resumen + `
      <div class="card">
        <div class="cr-semana">
          ${dias.map((d, i) => `
            <div class="cr-dia ${d === hoyLocal() ? "hoy" : ""}">
              <div class="cr-dia-tit">${CRONO_DIAS[i]} <span>${fechaCortaC(d)}</span></div>
              ${filas.filter((f) => fechaRDc(f.fecha_inicio) === d).map(tarjeta).join("") || `<div class="cr-vacio">—</div>`}
            </div>`).join("")}
        </div>
        ${!CRONO.sitio ? `<div class="hist-leyenda">${[...new Set(filas.map((f) => f.planta))].map((p) => `<span class="serie"><i style="background:${colorPlanta(p)}"></i>${esc(p)}</span>`).join("")}</div>` : ""}
      </div>`;
  }
  $$(".cr-item").forEach((el) => el.addEventListener("click", () => modalServicioCrono(filas.find((f) => f.id === el.dataset.id))));
}

function chipCrono(estado) {
  const clase = { realizado: "hecho", pendiente: "pendiente", cancelado: "fuera", reprogramado: "fuera" }[estado] || "fuera";
  const t = (CRONO_ESTADOS.find((e) => e[0] === estado) || [estado, estado])[1];
  return `<span class="estado-chip ${clase}">${esc(t)}</span>`;
}

function modalServicioCrono(f) {
  const nuevo = !f;
  const fecha = f ? fechaRDc(f.fecha_inicio) : CRONO.semana;
  openModal({
    title: nuevo ? "Agregar servicio al cronograma" : "Editar servicio del cronograma",
    large: true,
    bodyHTML: `
      <div class="form-grid">
        <div class="form-group"><label>Planta</label>
          <select name="sitio_id">
            <option value="">Sin planta</option>
            ${CRONO.sitios.map((s) => `<option value="${esc(s.id)}"${(f ? f.sitio_id : CRONO.sitio) === s.id ? " selected" : ""}>${esc(s.nombre)}</option>`).join("")}
          </select>
          ${f && !f.sitio_id && f.planta_texto ? `<small class="text-muted">En el Excel decía: ${esc(f.planta_texto)}</small>` : ""}
        </div>
        <div class="form-group"><label>Estado</label>
          <select name="estado">${CRONO_ESTADOS.map(([v, t]) => `<option value="${v}"${(f?.estado || "pendiente") === v ? " selected" : ""}>${t}</option>`).join("")}</select>
        </div>
        <div class="form-group"><label>Fecha *</label><input type="date" name="fecha" required value="${fecha}" /></div>
        <div class="form-group" style="display:flex;gap:8px">
          <div style="flex:1"><label>Hora inicio</label><input type="time" name="hora_inicio" value="${f ? horaRDc(f.fecha_inicio) : "09:00"}" /></div>
          <div style="flex:1"><label>Hora fin</label><input type="time" name="hora_fin" value="${f?.fecha_fin ? horaRDc(f.fecha_fin) : ""}" /></div>
        </div>
        <div class="form-group full"><label>Título *</label><input name="titulo" required value="${esc(f?.titulo || "")}" placeholder="IJ001 - MANEJO INTEGRADO DE PLAGAS" /></div>
        <div class="form-group full"><label>Qué se hace (notas)</label><textarea name="notas" rows="2" placeholder="Recorrido diario / inspección de áreas, monitoreo de lámparas…">${esc(f?.notas || "")}</textarea></div>
        <div class="form-group full"><label>Equipo de trabajo</label><input name="equipo" value="${esc(f?.equipo || "")}" placeholder="Santo Liranzo, Eduard Paniagua…" /></div>
        <div class="form-group"><label>Contrato</label><input name="contrato" value="${esc(f?.contrato || "")}" /></div>
      </div>
      ${f ? `<div class="form-group full" style="background:#f8fafc;border:1px solid var(--border);border-radius:8px;padding:10px">
        <label>Aplicar el horario a</label>
        <select name="alcance_horario">
          <option value="solo">Solo este servicio</option>
          <option value="dia_semana">Todos los ${CRONO_DIAS[(new Date(fecha + "T12:00:00Z").getUTCDay() + 6) % 7].toLowerCase()} de este servicio, de aquí en adelante</option>
          <option value="semana">Toda esta semana (lunes a domingo) de este servicio</option>
          <option value="todo">Todos los días de este servicio, de aquí en adelante</option>
        </select>
        <small class="text-muted">“Este servicio” = misma planta, mismo título y misma hora de inicio (${horaRDc(f.fecha_inicio)}). Solo cambia la hora; las fechas y lo demás quedan igual.</small>
      </div>` : ""}
      ${f ? `<p class="text-muted">Origen: ${esc(f.origen)}${f.creado_por ? ` · ${esc(f.creado_por)}` : ""}. Si la hora de fin es menor que la de inicio, termina al día siguiente.</p>` : ""}
      ${f ? `<button type="button" class="btn btn-danger btn-sm" id="cr-borrar">Borrar este servicio</button>` : ""}`,
    submitLabel: nuevo ? "Agregar" : "Guardar cambios",
    onMount() {
      $("#cr-borrar")?.addEventListener("click", async () => {
        if (!confirm("¿Borrar este servicio del cronograma?")) return;
        await api(`/cronograma/${f.id}`, { method: "DELETE" });
        closeModal();
        toast("Servicio borrado");
        pintarCronograma();
      });
    },
    async onSubmit(fd) {
      const cuerpo = Object.fromEntries(fd.entries());
      const alcance = cuerpo.alcance_horario || "solo";
      delete cuerpo.alcance_horario;
      let extra = "";
      if (nuevo) await post("/cronograma", cuerpo);
      else {
        await put(`/cronograma/${f.id}`, cuerpo);
        if (alcance !== "solo") {
          const r = await post(`/cronograma/${f.id}/horario-masivo`, {
            hora_inicio: cuerpo.hora_inicio,
            hora_fin: cuerpo.hora_fin || "",
            alcance,
            hora_original: horaRDc(f.fecha_inicio),
          });
          extra = ` · horario aplicado a ${r.cambiados} servicio(s)`;
        }
      }
      closeModal();
      toast((nuevo ? "Servicio agregado" : "Cambios guardados") + extra);
      if (nuevo) CRONO.semana = lunesDe(cuerpo.fecha);
      pintarCronograma();
    },
  });
}

// La semana anterior, mismo día y hora, en la semana que se está viendo. Es
// /repetir con la semana de antes y una sola repetición: lo que ya esté no se duplica.
async function copiarSemanaAnterior() {
  const anterior = sumarDiasC(CRONO.semana, -7);
  const planta = CRONO.sitio && CRONO.sitio !== "sin_planta" ? CRONO.sitio : null;
  const nombre = planta ? CRONO.sitios.find((s) => s.id === planta)?.nombre : "todas las plantas";
  if (!confirm(`¿Copiar a esta semana los servicios de la semana del ${fechaCortaC(anterior)} (${nombre}), mismo día y hora?`)) return;
  try {
    const r = await post("/cronograma/repetir", { semana: anterior, semanas: 1, sitio_id: planta });
    toast(`${r.creadas} servicio(s) copiados${r.saltadas ? ` · ${r.saltadas} ya estaban` : ""}`);
    pintarCronograma();
  } catch (e) { toast(e.message, true); }
}

function modalRepetirCrono() {
  openModal({
    title: "Repetir la semana en las siguientes",
    bodyHTML: `
      <p class="text-muted">Toma los días y horas de los servicios de la semana del <strong>${fechaCortaC(CRONO.semana)}</strong>
        ${CRONO.sitio && CRONO.sitio !== "sin_planta" ? `de <strong>${esc(CRONO.sitios.find((s) => s.id === CRONO.sitio)?.nombre || "")}</strong>` : "de <strong>todas las plantas</strong>"}
        y los copia, el mismo día de la semana y a la misma hora, en las semanas que siguen. Lo que ya exista igual no se duplica.</p>
      <div class="form-group"><label>¿Cuántas semanas?</label><input type="number" name="semanas" min="1" max="26" value="4" /></div>`,
    submitLabel: "Repetir",
    async onSubmit(fd) {
      const r = await post("/cronograma/repetir", {
        semana: CRONO.semana,
        semanas: Number(fd.get("semanas")) || 1,
        sitio_id: CRONO.sitio && CRONO.sitio !== "sin_planta" ? CRONO.sitio : null,
      });
      closeModal();
      toast(`${r.creadas} servicio(s) creados${r.saltadas ? ` · ${r.saltadas} ya existían` : ""}`);
    },
  });
}

function modalImportarCrono() {
  let base64 = null;
  let nombre = "";
  openModal({
    title: "Subir cronograma desde Excel",
    large: true,
    bodyHTML: `
      <p class="text-muted">El Excel de la programación de servicios tal como lo descargas (columnas PLANTA, TÍTULO,
        FECHA INICIO, FECHA FIN, ESTADO, EQUIPO DE TRABAJO, Notas Internas). Primero te muestro lo que trae
        y a qué planta va cada una; después lo guardas.</p>
      <div class="form-group"><label>Archivo .xlsx</label><input type="file" id="cr-archivo" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" /></div>
      <div id="cr-previa"></div>`,
    submitLabel: "Guardar en el cronograma",
    onMount() {
      $("#asa-modal-submit").disabled = true;
      $("#cr-archivo").addEventListener("change", async (e) => {
        const archivo = e.target.files[0];
        if (!archivo) return;
        nombre = archivo.name;
        $("#cr-previa").innerHTML = `<div class="center-msg">Leyendo el Excel…</div>`;
        base64 = await new Promise((ok, mal) => {
          const fr = new FileReader();
          fr.onload = () => ok(String(fr.result).split(",")[1]);
          fr.onerror = mal;
          fr.readAsDataURL(archivo);
        });
        try {
          const p = await post("/cronograma/importar", { archivo: base64, vista_previa: true });
          $("#cr-previa").innerHTML = `
            <div class="kpi-grid">
              <div class="kpi-card"><div class="lbl">Servicios</div><div class="val">${p.filas}</div></div>
              <div class="kpi-card c"><div class="lbl">Desde</div><div class="val" style="font-size:18px">${esc(p.desde)}</div></div>
              <div class="kpi-card c"><div class="lbl">Hasta</div><div class="val" style="font-size:18px">${esc(p.hasta)}</div></div>
            </div>
            ${p.errores.length ? `<div class="form-error" style="display:block">${p.errores.length} fila(s) no se pudieron leer: ${esc(p.errores.slice(0, 5).join("; "))}</div>` : ""}
            <h3>¿A qué planta va cada una?</h3>
            <table class="data"><thead><tr><th>En el Excel</th><th>Filas</th><th>Planta del sistema</th></tr></thead><tbody>
              ${p.plantas.map((pl, i) => `
                <tr><td>${esc(pl.texto || "(sin planta)")}</td><td>${pl.filas}</td>
                <td><select data-texto="${esc(pl.texto)}" class="cr-mapa">
                  <option value="">— Sin planta (solo la oficina lo ve) —</option>
                  ${p.sitios.map((s) => `<option value="${esc(s.id)}"${s.id === pl.sitio_id ? " selected" : ""}>${esc(s.nombre)}</option>`).join("")}
                </select>${pl.sitio_id && !pl.seguro ? ` <small class="text-muted">sugerida, revísala</small>` : ""}</td></tr>`).join("")}
            </tbody></table>
            <label class="campo-check" style="margin-top:12px"><input type="checkbox" name="reemplazar" checked />
              Reemplazar lo que ya había en el cronograma del ${esc(p.desde)} al ${esc(p.hasta)} para esas plantas (para no duplicar al subir el Excel corregido)</label>
            <h3>Primeras filas</h3>
            <table class="data"><thead><tr><th>Planta</th><th>Inicio</th><th>Fin</th><th>Notas</th></tr></thead><tbody>
              ${p.muestra.map((m) => `<tr><td>${esc(m.planta_texto || "")}</td><td>${esc(m.fecha_inicio.slice(0, 16).replace("T", " "))}</td><td>${esc((m.fecha_fin || "").slice(0, 16).replace("T", " "))}</td><td>${esc(m.notas || m.titulo)}</td></tr>`).join("")}
            </tbody></table>`;
          $("#asa-modal-submit").disabled = false;
        } catch (err) {
          $("#cr-previa").innerHTML = `<div class="form-error" style="display:block">${esc(err.message)}</div>`;
        }
      });
    },
    async onSubmit(fd) {
      if (!base64) throw new Error("Elige el archivo primero");
      const mapeo = Object.fromEntries($$(".cr-mapa").map((s) => [s.dataset.texto, s.value]));
      $("#asa-modal-submit").textContent = "Guardando…";
      const r = await post("/cronograma/importar", { archivo: base64, mapeo, reemplazar: fd.get("reemplazar") === "on", nombre_archivo: nombre });
      closeModal();
      toast(`${r.guardadas} servicios guardados${r.reemplazadas ? ` · ${r.reemplazadas} reemplazados` : ""}${r.sin_planta ? ` · ${r.sin_planta} sin planta` : ""}`);
      CRONO.semana = lunesDe(r.desde);
      pintarCronograma();
    },
  });
}
