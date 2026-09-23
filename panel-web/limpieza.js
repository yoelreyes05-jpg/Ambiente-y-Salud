// ═════════════════════════════════════════════════════════════════════════
// limpieza.js — Borrar datos de prueba (solo administrador)
//
// Escoges qué revisar (inspecciones, solicitudes, chequeos, clientes…), filtras
// por fechas o planta, marcas lo que no sirve y lo borras escribiendo BORRAR.
// Solo se borra lo marcado. El servidor vuelve a comprobar que eres admin.
//
// Se carga antes de app.js y aporta MODULOS_EXTRA_6.
// ═════════════════════════════════════════════════════════════════════════

const MODULOS_EXTRA_6 = [
  { key: "limpieza", label: "Borrar datos de prueba", ic: "🧹", seccion: "admin", roles: ["admin"], view: viewLimpieza },
];

let LIMP = { tipo: null, desde: "", hasta: "", sitio: "", buscar: "", marcados: new Set(), filas: [] };

async function viewLimpieza(content) {
  if (USUARIO.rol !== "admin") {
    content.innerHTML = `<div class="card"><div class="form-error" style="display:block">Solo el administrador puede borrar registros.</div></div>`;
    return;
  }
  const [tipos, plantas] = await Promise.all([get("/limpieza/tipos"), get("/sitios").catch(() => [])]);
  if (!LIMP.tipo || !tipos.some((t) => t.clave === LIMP.tipo)) LIMP.tipo = tipos[0]?.clave;

  const opcion = (t) => `<option value="${t.clave}"${t.clave === LIMP.tipo ? " selected" : ""}>${esc(t.nombre)} (${t.total ?? "?"})</option>`;
  content.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Borrar datos de prueba</h2>
        <span class="text-muted">Solo se borra lo que marques. No se puede deshacer.</span>
      </div>
      <div class="toolbar">
        <select id="limp-tipo">
          <optgroup label="Lo que se registra trabajando">${tipos.filter((t) => t.grupo === "movimientos").map(opcion).join("")}</optgroup>
          <optgroup label="Datos base (borran lo que cuelga de ellos)">${tipos.filter((t) => t.grupo === "maestros").map(opcion).join("")}</optgroup>
        </select>
        <select id="limp-sitio"><option value="">Todas las plantas</option>
          ${plantas.map((p) => `<option value="${esc(p.id)}"${p.id === LIMP.sitio ? " selected" : ""}>${esc(p.nombre)}</option>`).join("")}
        </select>
        <label class="text-muted">Desde <input type="date" id="limp-desde" value="${esc(LIMP.desde)}" /></label>
        <label class="text-muted">Hasta <input type="date" id="limp-hasta" value="${esc(LIMP.hasta)}" /></label>
        <input type="search" id="limp-buscar" placeholder="Buscar…" value="${esc(LIMP.buscar)}" />
        <button class="btn btn-sm" id="limp-aplicar">Filtrar</button>
      </div>
      <div id="limp-aviso"></div>
      <div class="toolbar" style="margin-top:6px">
        <label class="campo-check" style="margin:0"><input type="checkbox" id="limp-todos" /> Marcar todos los que se ven</label>
        <span class="text-muted" id="limp-conteo"></span>
        <span class="toolbar-sep"></span>
        <button class="btn btn-danger" id="limp-borrar" disabled>🗑 Borrar marcados</button>
      </div>
      <div id="limp-tabla"><div class="center-msg">Cargando…</div></div>
    </div>`;

  const leerFiltros = () => {
    LIMP.tipo = $("#limp-tipo").value;
    LIMP.sitio = $("#limp-sitio").value;
    LIMP.desde = $("#limp-desde").value;
    LIMP.hasta = $("#limp-hasta").value;
    LIMP.buscar = $("#limp-buscar").value.trim();
  };
  $("#limp-tipo").addEventListener("change", () => { leerFiltros(); cargarLimpieza(tipos); });
  $("#limp-aplicar").addEventListener("click", () => { leerFiltros(); cargarLimpieza(tipos); });
  $("#limp-buscar").addEventListener("keydown", (e) => { if (e.key === "Enter") { leerFiltros(); cargarLimpieza(tipos); } });
  $("#limp-todos").addEventListener("change", (e) => {
    LIMP.filas.forEach((f) => e.target.checked ? LIMP.marcados.add(f.id) : LIMP.marcados.delete(f.id));
    $$("#limp-tabla input[data-id]").forEach((c) => (c.checked = e.target.checked));
    pintarConteoLimpieza();
  });
  $("#limp-borrar").addEventListener("click", () => confirmarBorrado(tipos));
  await cargarLimpieza(tipos);
}

async function cargarLimpieza(tipos) {
  const t = tipos.find((x) => x.clave === LIMP.tipo);
  LIMP.marcados = new Set();
  $("#limp-todos").checked = false;
  $("#limp-sitio").disabled = !t.filtra_planta;
  $("#limp-aviso").innerHTML = t.aviso
    ? `<div class="form-hint" style="margin:0 0 8px;padding:8px 10px;border-radius:8px;background:${t.grupo === "maestros" ? "#fdecec" : "#f7faf8"}">${esc(t.aviso)}</div>` : "";
  $("#limp-tabla").innerHTML = `<div class="center-msg">Cargando…</div>`;

  const qs = new URLSearchParams();
  if (LIMP.desde) qs.set("desde", LIMP.desde);
  if (LIMP.hasta) qs.set("hasta", LIMP.hasta);
  if (LIMP.sitio && t.filtra_planta) qs.set("sitio_id", LIMP.sitio);
  if (LIMP.buscar) qs.set("buscar", LIMP.buscar);
  try {
    const r = await get(`/limpieza/${LIMP.tipo}?${qs}`);
    LIMP.filas = r.filas;
    $("#limp-tabla").innerHTML = r.filas.length ? `
      <div class="table-wrap"><table class="data">
        <thead><tr><th style="width:34px"></th><th>Fecha</th><th>Registro</th><th>Detalle</th></tr></thead>
        <tbody>${r.filas.map((f) => `
          <tr>
            <td><input type="checkbox" data-id="${esc(f.id)}" /></td>
            <td style="white-space:nowrap">${esc(fmtDateTime(f.fecha))}</td>
            <td><strong>${esc(f.titulo)}</strong></td>
            <td class="muted">${esc(f.detalle || "")}</td>
          </tr>`).join("")}</tbody>
      </table></div>
      ${r.filas.length >= r.limite ? `<p class="text-muted">Se muestran los ${r.limite} más recientes. Filtra por fecha para ver los demás.</p>` : ""}`
      : `<div class="empty-row">No hay registros con esos filtros.</div>`;
    $$("#limp-tabla input[data-id]").forEach((c) => c.addEventListener("change", () => {
      c.checked ? LIMP.marcados.add(c.dataset.id) : LIMP.marcados.delete(c.dataset.id);
      pintarConteoLimpieza();
    }));
  } catch (e) {
    LIMP.filas = [];
    $("#limp-tabla").innerHTML = `<div class="form-error" style="display:block">${esc(e.message)}</div>`;
  }
  pintarConteoLimpieza();
}

function pintarConteoLimpieza() {
  const n = LIMP.marcados.size;
  $("#limp-conteo").textContent = `${LIMP.filas.length} en pantalla · ${n} marcado${n === 1 ? "" : "s"}`;
  $("#limp-borrar").disabled = !n;
  $("#limp-borrar").textContent = n ? `🗑 Borrar ${n} marcado${n === 1 ? "" : "s"}` : "🗑 Borrar marcados";
}

function confirmarBorrado(tipos) {
  const t = tipos.find((x) => x.clave === LIMP.tipo);
  const ids = [...LIMP.marcados];
  const muestra = LIMP.filas.filter((f) => LIMP.marcados.has(f.id)).slice(0, 8);
  openModal({
    title: `Borrar ${ids.length} registro${ids.length === 1 ? "" : "s"}`,
    submitLabel: "Borrar definitivamente",
    bodyHTML: `
      <p><strong>${esc(t.nombre)}</strong> — se van a borrar <strong>${ids.length}</strong>. No se puede deshacer.</p>
      ${t.aviso ? `<p class="form-hint" style="font-size:13px">${esc(t.aviso)}</p>` : ""}
      <ul class="text-muted" style="margin:6px 0 12px 18px;padding:0">
        ${muestra.map((f) => `<li>${esc(f.titulo)}</li>`).join("")}
        ${ids.length > muestra.length ? `<li>… y ${ids.length - muestra.length} más</li>` : ""}
      </ul>
      <div class="form-group"><label>Escribe BORRAR para confirmar</label>
        <input name="confirmacion" autocomplete="off" required /></div>`,
    onSubmit: async (fd) => {
      if (String(fd.get("confirmacion") || "").trim().toUpperCase() !== "BORRAR") {
        throw new Error("Escribe la palabra BORRAR para confirmar.");
      }
      const r = await post(`/limpieza/${LIMP.tipo}/borrar`, { ids, confirmacion: "BORRAR" });
      closeModal();
      toast(r.errores?.length
        ? `Se borraron ${r.borrados} de ${r.pedidos}. ${r.errores[0]}`
        : `Listo: ${r.borrados} registro${r.borrados === 1 ? "" : "s"} borrado${r.borrados === 1 ? "" : "s"}`, !!r.errores?.length);
      // Clientes/plantas/productos pueden haber cambiado: que las listas se recarguen.
      CLIENTES_CACHE = null;
      viewLimpieza($("#content"));
    },
  });
}
