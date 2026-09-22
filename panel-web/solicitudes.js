// ═════════════════════════════════════════════════════════════════════════
// solicitudes.js — Lo que piden los hoteles, en el panel
//
// El hotel manda desde su portal la LISTA DE HABITACIONES que liberaron los
// huéspedes (o reporta una plaga). Aquí la oficina:
//   - se entera: globito en el menú con las nuevas y aviso cuando entra una
//   - la recibe, le asigna técnico y la sigue habitación por habitación
//   - conversa con el hotel y el técnico en el hilo de la solicitud
//
// Las habitaciones se marcan solas cuando el técnico las inspecciona
// (trigger en la base, 30_solicitudes_hotel.sql); el panel solo lo muestra.
//
// Se carga antes de app.js y aporta MODULOS_EXTRA_4.
// ═════════════════════════════════════════════════════════════════════════

const MODULOS_EXTRA_4 = [
  { key: "solicitudes", label: "Solicitudes", ic: "📨", seccion: "operacion", roles: ["admin", "operaciones", "comercial"], view: viewSolicitudes },
];

const SOL_ESTADO = {
  solicitada: ["Nueva / enviada", "pendiente"],
  agendada: ["Recibida", "fuera"],
  en_ruta: ["En camino", "fuera"],
  en_sitio: ["En proceso", "fuera"],
  ejecutada: ["Completada", "hecho"],
  control_calidad: ["Completada", "hecho"],
  facturada: ["Completada", "hecho"],
  cerrada: ["Cerrada", "hecho"],
  cancelada: ["Cancelada", "fuera"],
};
const SOL_TIPO = { habitaciones: "🛏️ Habitaciones", plaga: "🐜 Plaga", puntos: "📍 Puntos", otro: "Otro" };
const SOL_ABIERTAS = ["solicitada", "agendada", "en_ruta", "en_sitio"];
const SOL_MOTIVOS = {
  permiso_denegado: "El hotel no autorizó el acceso", huesped_en_habitacion: "Huésped dentro",
  area_ocupada: "Área ocupada", sin_llave: "Sin llave", en_mantenimiento: "En mantenimiento",
  punto_inaccesible: "Inaccesible", evento_en_curso: "Evento en curso", otro: "Otro motivo",
};
const rolTexto = (r) => (r === "cliente_calidad" || r === "cliente" ? "Hotel" : r === "tecnico_plagas" ? "Técnico" : "ASA");

let SOL_FILTRO = { sitio: "", estado: "abiertas" };
let SOL_TECNICOS = null;

async function viewSolicitudes(content) {
  const plantas = await get("/sitios").catch(() => []);
  content.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Solicitudes de los hoteles</h2>
        <div class="actions"><button class="btn btn-primary" id="sol-nueva">+ Nueva solicitud</button></div>
      </div>
      <div class="toolbar">
        <select id="sol-sitio">
          <option value="">Todas las plantas</option>
          ${plantas.map((p) => `<option value="${esc(p.id)}"${p.id === SOL_FILTRO.sitio ? " selected" : ""}>${esc(p.nombre)}</option>`).join("")}
        </select>
        <select id="sol-estado">
          <option value="abiertas"${SOL_FILTRO.estado === "abiertas" ? " selected" : ""}>Abiertas</option>
          <option value="todas"${SOL_FILTRO.estado === "todas" ? " selected" : ""}>Todas (60 días)</option>
          <option value="cerradas"${SOL_FILTRO.estado === "cerradas" ? " selected" : ""}>Completadas / canceladas</option>
        </select>
        <span class="text-muted" id="sol-conteo"></span>
        <span class="toolbar-sep"></span>
        <button class="btn btn-sm" id="sol-recargar">Actualizar</button>
      </div>
      <div id="sol-tabla"><div class="center-msg">Cargando…</div></div>
    </div>`;

  async function cargar() {
    const qs = new URLSearchParams({ estado: SOL_FILTRO.estado });
    if (SOL_FILTRO.sitio) qs.set("sitio_id", SOL_FILTRO.sitio);
    const lista = await get(`/solicitudes?${qs}`);
    const nuevas = lista.filter((o) => o.nueva).length;
    $("#sol-conteo").innerHTML = `${lista.length} solicitud${lista.length === 1 ? "" : "es"}` +
      (nuevas ? ` · <span class="estado-chip pendiente">${nuevas} sin abrir</span>` : "");

    $("#sol-tabla").innerHTML = tableHTML(
      [
        { key: "numero_orden", label: "Solicitud", fmt: (o) => `${o.nueva ? `<span class="estado-chip pendiente">NUEVA</span> ` : ""}<strong>${esc(o.numero_orden || "")}</strong>` },
        { key: "sitio_nombre", label: "Planta", fmt: (o) => esc(o.sitio_nombre) },
        { key: "tipo_solicitud", label: "Tipo", fmt: (o) => esc(SOL_TIPO[o.tipo_solicitud] || o.tipo_solicitud) + (o.tipo_plaga_reportada ? `<br><small>${esc(o.tipo_plaga_reportada)}</small>` : "") },
        { key: "creado_por_nombre", label: "Pedida por", fmt: (o) => `${esc(o.creado_por_nombre || "—")}<br><small class="text-muted">${rolTexto(o.creado_por_rol)}</small>` },
        { key: "estado", label: "Estado", fmt: (o) => { const [t, c] = SOL_ESTADO[o.estado] || [o.estado, "fuera"]; return `<span class="estado-chip ${c}">${esc(t)}</span>${o.prioridad === "urgente" ? ` <span class="estado-chip pendiente">urgente</span>` : ""}`; } },
        { key: "avance", label: "Avance", fmt: (o) => o.puntos.total
            ? `<div style="min-width:120px"><strong style="color:var(--asa-verde-osc)">${o.puntos.hechos}</strong> / ${o.puntos.total}${o.puntos.no_realizados ? ` · <span style="color:#b91c1c">${o.puntos.no_realizados} no se pudo</span>` : ""}
               <div class="barra"><span style="width:${Math.round((o.puntos.hechos / o.puntos.total) * 100)}%"></span></div></div>`
            : "—" },
        { key: "tecnico_nombre", label: "Técnico", fmt: (o) => esc(o.tecnico_nombre || o.recibido_tecnico_nombre || "—") },
        { key: "mensajes_total", label: "💬", fmt: (o) => (o.mensajes_total ? String(o.mensajes_total) : "") },
        { key: "created_at", label: "Creada", fmt: (o) => fmtDateTime(o.created_at) + (o.fecha_requerida ? `<br><small class="text-muted">para ${fmtDate(o.fecha_requerida + "T12:00:00")}</small>` : "") },
      ],
      lista,
      SOL_FILTRO.estado === "abiertas" ? "No hay solicitudes abiertas. ✅" : "No hay solicitudes con este filtro."
    );
    $$("#sol-tabla tr[data-id]").forEach((tr) => tr.addEventListener("click", () => abrirSolicitud(tr.dataset.id, cargar)));
    actualizarGlobitoSolicitudes();
  }

  $("#sol-sitio").addEventListener("change", (e) => { SOL_FILTRO.sitio = e.target.value; cargar(); });
  $("#sol-estado").addEventListener("change", (e) => { SOL_FILTRO.estado = e.target.value; cargar(); });
  $("#sol-recargar").addEventListener("click", cargar);
  $("#sol-nueva").addEventListener("click", () => modalNuevaSolicitud(plantas, cargar));
  await cargar();
}

// ── Detalle ──────────────────────────────────────────────────────────────
async function abrirSolicitud(id, alCambiar) {
  closeModal();
  const o = await get(`/solicitudes/${id}`);
  if (!SOL_TECNICOS) SOL_TECNICOS = await get("/solicitudes/tecnicos").catch(() => []);
  const abierta = SOL_ABIERTAS.includes(o.estado);
  const [txtEstado, claseEstado] = SOL_ESTADO[o.estado] || [o.estado, "fuera"];
  const hechos = o.puntos.filter((p) => p.estado === "hecho").length;
  const rojos = o.puntos.filter((p) => p.estado === "pendiente" || p.estado === "no_realizado").length;

  const porArea = new Map();
  for (const p of o.puntos) {
    if (!porArea.has(p.area_nombre)) porArea.set(p.area_nombre, []);
    porArea.get(p.area_nombre).push(p);
  }
  const clase = { hecho: "hecho", pendiente: "pendiente", no_realizado: "norealizado", cancelado: "fuera" };

  const overlay = h(`
    <div class="modal-overlay" id="asa-modal-overlay">
      <div class="modal modal-lg">
        <div class="modal-head">
          <h3>${esc(SOL_TIPO[o.tipo_solicitud] || "Solicitud")} · ${esc(o.numero_orden || "")}</h3>
          <button class="modal-close" id="sd-cerrar">×</button>
        </div>
        <div class="modal-body">
          <div class="form-error" id="sd-error" style="display:none"></div>
          <p style="margin-top:0">
            <strong>${esc(o.sitio_nombre)}</strong>${o.cliente_nombre ? ` · ${esc(o.cliente_nombre)}` : ""}<br>
            <span class="estado-chip ${claseEstado}">${esc(txtEstado)}</span>
            ${o.prioridad !== "normal" ? `<span class="estado-chip ${o.prioridad === "urgente" ? "pendiente" : "fuera"}">${esc(o.prioridad)}</span>` : ""}
            <span class="text-muted">
              Pedida por <strong>${esc(o.creado_por_nombre || "—")}</strong> (${rolTexto(o.creado_por_rol)}) el ${fmtDateTime(o.created_at)}
              ${o.fecha_requerida ? ` · para el <strong>${fmtDate(o.fecha_requerida + "T12:00:00")}</strong>` : ""}
            </span><br>
            <span class="text-muted">
              ${o.recibido_tecnico_nombre ? `✓ Recibida por ${esc(o.recibido_tecnico_nombre)} (${fmtDateTime(o.recibido_tecnico_at)})` : "Todavía nadie la ha marcado como recibida"}
              ${o.visto_admin_nombre ? ` · Abierta en el panel por ${esc(o.visto_admin_nombre)}` : ""}
            </span>
          </p>
          ${o.tipo_plaga_reportada ? `<p><strong>Plaga:</strong> ${esc(o.tipo_plaga_reportada)}</p>` : ""}
          ${o.descripcion_cliente ? `<p style="background:#f8fafc;border:1px solid var(--border);border-radius:8px;padding:10px">${esc(o.descripcion_cliente)}</p>` : ""}

          <div class="form-grid" style="margin:12px 0">
            <div class="form-group"><label>Técnico asignado</label>
              <select id="sd-tecnico" ${abierta ? "" : "disabled"}>
                <option value="">— sin asignar —</option>
                ${SOL_TECNICOS.map((t) => `<option value="${esc(t.id)}"${t.id === o.tecnico_id ? " selected" : ""}>${esc(t.nombre_completo)}</option>`).join("")}
              </select>
            </div>
            <div class="form-group"><label>Estado</label>
              <select id="sd-estado">
                ${["solicitada", "agendada", "en_ruta", "en_sitio", "ejecutada", "cerrada", "cancelada"]
                  .map((e) => `<option value="${e}"${e === o.estado ? " selected" : ""}>${esc((SOL_ESTADO[e] || [e])[0])}</option>`).join("")}
              </select>
            </div>
          </div>
          <div class="toolbar">
            ${abierta && !o.recibido_tecnico_at ? `<button class="btn btn-sm" id="sd-recibida">✓ Marcar recibida</button>` : ""}
            <button class="btn btn-sm btn-primary" id="sd-guardar">Guardar cambios</button>
          </div>

          ${o.puntos.length ? `
            <h4 style="margin:18px 0 6px">Habitaciones — <span style="color:var(--asa-verde-osc)">${hechos} hechas</span> · <span style="color:#b91c1c">${rojos} por hacer</span></h4>
            <div class="resumen-dia"><div class="leyenda">
              <span class="estado-chip hecho">Hecha</span><span class="estado-chip pendiente">Por hacer</span>
              <span class="estado-chip norealizado">No se pudo</span>
            </div></div>
            ${[...porArea.entries()].map(([area, ps]) => `
              <div class="dia-bloque">
                <div class="dia-cabecera">${esc(area)}</div>
                <div class="grid-habitaciones">
                  ${ps.map((p) => `<div class="hab ${clase[p.estado] || "pendiente"}"
                      title="${esc(p.estado === "no_realizado" ? SOL_MOTIVOS[p.motivo_no_realizado] || "No se pudo" : p.atendido_at ? `Hecha ${fmtDateTime(p.atendido_at)}` : "Por hacer")}"
                      ${p.inspeccion_id ? `data-insp="${esc(p.inspeccion_id)}"` : ""}>
                      ${esc(p.numero_habitacion || p.codigo_visible)}
                      ${p.estado === "no_realizado" ? `<small>${esc(SOL_MOTIVOS[p.motivo_no_realizado] || "no se pudo")}</small>` : ""}
                    </div>`).join("")}
                </div>
              </div>`).join("")}` : ""}

          <h4 style="margin:18px 0 6px">Mensajes con el hotel y el técnico</h4>
          <div class="sol-hilo" id="sd-hilo">
            ${o.mensajes.length ? o.mensajes.map((m) => `
              <div class="sol-msg ${rolTexto(m.autor_rol) === "Hotel" ? "hotel" : rolTexto(m.autor_rol) === "Técnico" ? "tecnico" : "asa"}">
                <div class="autor">${esc(m.autor_nombre || "")} · ${rolTexto(m.autor_rol)}</div>
                <div class="txt">${esc(m.texto)}</div>
                <div class="hora">${fmtDateTime(m.created_at)}</div>
              </div>`).join("") : `<p class="text-muted">Sin mensajes todavía.</p>`}
          </div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <textarea id="sd-texto" rows="2" style="flex:1;padding:8px 10px;border:1px solid var(--border);border-radius:7px;font:inherit" placeholder="Escribe al hotel y al técnico…"></textarea>
            <button class="btn btn-primary" id="sd-enviar">Enviar</button>
          </div>

          <h4 style="margin:18px 0 6px">Historial</h4>
          ${tableHTML(
            [
              { key: "estado_nuevo", label: "Estado", fmt: (r) => esc((SOL_ESTADO[r.estado_nuevo] || [r.estado_nuevo])[0]) },
              { key: "motivo", label: "Detalle", fmt: (r) => esc(r.motivo || "") },
              { key: "usuario_nombre", label: "Quién", fmt: (r) => esc(r.usuario_nombre || "") },
              { key: "created_at", label: "Fecha", fmt: (r) => fmtDateTime(r.created_at) },
            ],
            o.historial.map((r) => ({ ...r, _clickable: false })),
            "Sin historial."
          )}
        </div>
      </div>
    </div>`);
  document.body.appendChild(overlay);

  const q = (s) => overlay.querySelector(s);
  const fallo = (e) => { q("#sd-error").textContent = e.message; q("#sd-error").style.display = "block"; };
  const recargar = async () => { alCambiar && alCambiar(); await abrirSolicitud(id, alCambiar); };
  q("#sd-cerrar").addEventListener("click", () => { closeModal(); alCambiar && alCambiar(); });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) { closeModal(); alCambiar && alCambiar(); } });
  const hilo = q("#sd-hilo"); hilo.scrollTop = hilo.scrollHeight;

  q("#sd-recibida")?.addEventListener("click", async () => {
    try { await post(`/solicitudes/${id}/recibida`, {}); toast("Marcada como recibida"); recargar(); } catch (e) { fallo(e); }
  });
  q("#sd-guardar").addEventListener("click", async () => {
    const cuerpo = {};
    const tec = q("#sd-tecnico").value;
    if (tec !== (o.tecnico_id || "")) cuerpo.tecnico_id = tec || null;
    const est = q("#sd-estado").value;
    if (est !== o.estado) cuerpo.estado = est;
    if (!Object.keys(cuerpo).length) return toast("No hay cambios");
    try { await patch(`/solicitudes/${id}`, cuerpo); toast("Solicitud actualizada"); recargar(); } catch (e) { fallo(e); }
  });
  q("#sd-enviar").addEventListener("click", async () => {
    const texto = q("#sd-texto").value.trim();
    if (!texto) return;
    try { await post(`/solicitudes/${id}/mensajes`, { texto }); recargar(); } catch (e) { fallo(e); }
  });
  overlay.querySelectorAll("[data-insp]").forEach((el) =>
    el.addEventListener("click", () => { closeModal(); abrirDesglose(el.dataset.insp); })
  );
}

// ── Nueva solicitud desde la oficina (el hotel llamó o escribió) ─────────
function modalNuevaSolicitud(plantas, alGuardar) {
  let habs = [];
  openModal({
    title: "Nueva solicitud",
    bodyHTML: `
      <div class="form-group"><label>Planta *</label>
        <select name="sitio_id" id="ns-sitio" required>
          <option value="">Elige…</option>
          ${plantas.map((p) => `<option value="${esc(p.id)}"${p.id === SOL_FILTRO.sitio ? " selected" : ""}>${esc(p.nombre)}</option>`).join("")}
        </select>
      </div>
      <div class="form-group"><label>Habitaciones *</label>
        <textarea name="lista" id="ns-lista" rows="3" placeholder="4312, 4315, 4320-4325"></textarea>
        <div class="form-hint" id="ns-aviso">Escribe o pega los números; se aceptan rangos.</div>
      </div>
      <div class="form-grid">
        <div class="form-group"><label>Para el</label><input type="date" name="fecha" value="${hoyLocal()}" /></div>
        <div class="form-group"><label>Prioridad</label>
          <select name="prioridad"><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select>
        </div>
      </div>
      <div class="form-group"><label>Nota</label><textarea name="nota" rows="2" placeholder="Quién llamó, indicaciones para el técnico…"></textarea></div>`,
    submitLabel: "Crear solicitud",
    onMount: (ov) => {
      const sitio = ov.querySelector("#ns-sitio");
      const lista = ov.querySelector("#ns-lista");
      const aviso = ov.querySelector("#ns-aviso");
      const revisar = () => {
        const { ids, faltan } = resolverHabitaciones(lista.value, habs);
        aviso.innerHTML = !lista.value.trim()
          ? "Escribe o pega los números; se aceptan rangos."
          : `<strong>${ids.length}</strong> encontradas${faltan.length ? ` · <span style="color:#b91c1c">no existen: ${esc(faltan.join(", "))}</span>` : ""}`;
      };
      const cargar = async () => {
        habs = sitio.value ? (await get(`/puntos/estado?sitio_id=${sitio.value}&tipo=habitacion`)).puntos : [];
        revisar();
      };
      sitio.addEventListener("change", cargar);
      lista.addEventListener("input", revisar);
      if (sitio.value) cargar();
    },
    onSubmit: async (fd) => {
      const { ids, faltan } = resolverHabitaciones(fd.get("lista"), habs);
      if (!ids.length) throw new Error(faltan.length ? `Ninguna de esas habitaciones existe en la planta (${faltan.join(", ")}).` : "Escribe al menos una habitación.");
      const o = await post("/solicitudes", {
        sitio_id: fd.get("sitio_id"),
        tipo_solicitud: "habitaciones",
        punto_ids: ids,
        fecha_requerida: fd.get("fecha") || null,
        prioridad: fd.get("prioridad"),
        descripcion: (fd.get("nota") || "").trim(),
      });
      closeModal();
      toast(`Solicitud ${o.numero_orden} creada con ${ids.length} habitaciones`);
      alGuardar && alGuardar();
    },
  });
}

// "4312, 4315 4320-4325" → ids de punto. Igual que en el portal del hotel.
function resolverHabitaciones(texto, habs) {
  const norm = (s) => String(s || "").trim().toUpperCase().replace(/^0+(?=\d)/, "");
  const mapa = new Map();
  for (const h of habs) { mapa.set(norm(h.numero_habitacion), h.id); mapa.set(norm(h.codigo_visible), h.id); }
  const ids = new Set(), faltan = [];
  for (const trozo of String(texto || "").split(/[\s,;\/]+|\by\b/i)) {
    const t = trozo.trim().replace(/^hab\.?/i, "");
    if (!t) continue;
    const r = t.match(/^(\d+)\s*[-–a]\s*(\d+)$/i);
    const nums = r && Number(r[2]) >= Number(r[1]) && Number(r[2]) - Number(r[1]) <= 200
      ? Array.from({ length: Number(r[2]) - Number(r[1]) + 1 }, (_, i) => String(Number(r[1]) + i))
      : [t];
    for (const n of nums) { const id = mapa.get(norm(n)); id ? ids.add(id) : faltan.push(n); }
  }
  return { ids: [...ids], faltan: [...new Set(faltan)] };
}

// ── Globito del menú + aviso cuando entra una nueva ──────────────────────
let SOL_ULTIMAS_NUEVAS = null;
async function actualizarGlobitoSolicitudes() {
  const item = document.querySelector('.nav-item[data-key="solicitudes"]');
  if (!item || typeof TOKEN === "undefined" || !TOKEN) return;
  try {
    const r = await get("/solicitudes/resumen");
    let globo = item.querySelector(".nav-badge");
    if (!globo) { globo = document.createElement("span"); globo.className = "nav-badge"; item.appendChild(globo); }
    globo.textContent = r.nuevas ? String(r.nuevas) : "";
    globo.style.display = r.nuevas ? "" : "none";
    item.title = `${r.nuevas} sin abrir · ${r.abiertas} abiertas`;
    if (SOL_ULTIMAS_NUEVAS !== null && r.nuevas > SOL_ULTIMAS_NUEVAS) {
      toast(`📨 Nueva solicitud de un hotel (${r.nuevas} sin abrir)`);
      if (ACTIVE_MODULE === "solicitudes" && !document.getElementById("asa-modal-overlay")) navigate("solicitudes");
    }
    SOL_ULTIMAS_NUEVAS = r.nuevas;
  } catch {
    /* sin permiso o sin red: el globito simplemente no aparece */
  }
}
setInterval(actualizarGlobitoSolicitudes, 60000);
// Primera lectura en cuanto el menú exista (tras el login). Cada menú nuevo
// (otro login) se marca para leer una sola vez, no en cada cambio de pantalla.
new MutationObserver(() => {
  const item = document.querySelector('.nav-item[data-key="solicitudes"]');
  if (item && !item.dataset.globo) {
    item.dataset.globo = "1";
    actualizarGlobitoSolicitudes();
  }
}).observe(document.body || document.documentElement, { childList: true, subtree: true });
