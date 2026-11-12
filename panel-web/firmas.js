// firmas.js — Panel: órdenes del técnico por planta y sus firmas de recibido
//
// Pestaña "Órdenes y firmas" dentro de cada planta. Cada orden es lo que hizo
// un técnico en un día. Se firma toda de una vez o por partes (por área o por
// responsable). "En proceso" sin firmas, "Firmada en parte" si falta algo,
// "Finalizada" cuando todo tiene firma. Aquí también se configura quién firma
// cada área (chef, ama de llaves, calidad…), que la app propone sola.
// Servidor: backend/routes/firmas.js

const ESTADO_FIRMA_P = {
  en_proceso: `<span class="estado-chip pendiente">En proceso</span>`,
  parcial: `<span class="estado-chip fuera">Firmada en parte</span>`,
  finalizada: `<span class="estado-chip hecho">Finalizada</span>`,
};

async function tabFirmasPlanta(cuerpo, sitioId, areas = [], dias = 7) {
  const hasta = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
  const d0 = new Date(`${hasta}T12:00:00Z`); d0.setUTCDate(d0.getUTCDate() - (dias - 1));
  const [d, resp] = await Promise.all([
    get(`/firmas/ordenes?${new URLSearchParams({ sitio_id: sitioId, desde: d0.toISOString().slice(0, 10), hasta })}`),
    get(`/firmas/responsables?sitio_id=${sitioId}`).catch(() => []),
  ]);
  const hora = (f) => new Date(f).toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit", timeZone: "America/Santo_Domingo" });
  const nombreArea = new Map(areas.map((a) => [String(a.id), a.nombre]));
  cuerpo.innerHTML = `
    <div class="toolbar">
      <select id="fp-dias">${[[1, "Hoy"], [7, "Últimos 7 días"], [30, "Últimos 30 días"], [90, "Últimos 90 días"]].map(([n, t]) => `<option value="${n}"${n === dias ? " selected" : ""}>${t}</option>`).join("")}</select>
      <span class="estado-chip pendiente">${d.resumen.en_proceso} en proceso</span>
      ${d.resumen.parciales ? `<span class="estado-chip fuera">${d.resumen.parciales} firmadas en parte</span>` : ""}
      <span class="estado-chip hecho">${d.resumen.finalizadas} finalizadas</span>
      <span class="toolbar-sep"></span>
      <button class="btn btn-sm" id="fp-resp">👤 Quién firma cada área</button>
    </div>
    <p class="text-muted" style="margin-top:0">
      Se firma toda la orden de una vez o por partes: en el teléfono del técnico (“Firma de recibido”) o en el portal del hotel (pestaña Firmas).
      ${resp.length ? `Responsables configurados: ${resp.map((r) => `<strong>${esc(r.cargo)}</strong> (${esc(r.areas.map((id) => nombreArea.get(String(id)) || "área").join(", "))})`).join(" · ")}.`
        : "Todavía no hay responsables por área: con “Quién firma cada área” la app arma sola los grupos (chef, ama de llaves…)."}
    </p>
    ${d.ordenes.length ? `<div class="table-wrap"><table class="data">
      <thead><tr><th>Fecha</th><th>Técnico</th><th>Puntos</th><th>Estado</th><th>Firmas</th></tr></thead>
      <tbody>${d.ordenes.map((o) => `
        <tr class="clickable" data-orden="${esc(o.fecha)}|${esc(o.clave)}" tabindex="0">
          <td>${esc(new Date(`${o.fecha}T12:00:00`).toLocaleDateString("es-DO", { weekday: "short", day: "numeric", month: "short" }))}<div class="tec-sub">${hora(o.desde)} a ${hora(o.hasta)}</div></td>
          <td>${esc(o.tecnico)}</td>
          <td>${o.hechos} hechos${o.registros > o.puntos ? ` <span class="tec-sub">(${o.registros} registros)</span>` : ""}${o.no_realizados ? ` · <span style="color:#b91c1c">${o.no_realizados} no realizados</span>` : ""}</td>
          <td>${ESTADO_FIRMA_P[o.estado]}${o.estado === "parcial" ? `<div class="tec-sub">faltan ${o.pendientes_puntos} punto(s)</div>` : ""}</td>
          <td>${o.firmas.length ? o.firmas.map((f) => `${esc(f.firmante_nombre)}${f.firmante_cargo ? ` <span class="tec-sub">${esc(f.firmante_cargo)}</span>` : ""} <span class="tec-sub">· ${esc(f.parte || "Todo")}</span>`).join("<br>") : "—"}</td>
        </tr>`).join("")}</tbody></table></div>`
      : `<div class="empty-row">No hay órdenes en este período.</div>`}`;
  const recargar = () => tabFirmasPlanta(cuerpo, sitioId, areas, dias);
  $("#fp-dias").addEventListener("change", (e) => tabFirmasPlanta(cuerpo, sitioId, areas, Number(e.target.value)));
  $("#fp-resp").addEventListener("click", () => modalResponsablesFirma(sitioId, areas, resp, recargar));
  cuerpo.querySelectorAll("[data-orden]").forEach((tr) => {
    const abrir = () => { const [fecha, ...c] = tr.dataset.orden.split("|"); modalOrdenFirma(sitioId, fecha, c.join("|"), recargar); };
    tr.addEventListener("click", abrir);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") abrir(); });
  });
}

// Quién firma cada área: grupos de áreas con su cargo (Chef → Cocina, Bar…)
function modalResponsablesFirma(sitioId, areas, actuales, alGuardar) {
  const fila = (r = { cargo: "", areas: [] }) => `
    <div class="resp-fila" data-id="${esc(r.id || "")}">
      <div class="resp-cab">
        <input class="resp-cargo" placeholder="Cargo de quien firma (Chef, Ama de llaves, Calidad…)" value="${esc(r.cargo)}">
        <button type="button" class="btn btn-sm btn-danger resp-quitar">Quitar</button>
      </div>
      <div class="resp-areas">${areas.map((a) => `<label class="campo-check"><input type="checkbox" value="${esc(a.id)}" ${r.areas.map(String).includes(String(a.id)) ? "checked" : ""}> ${esc(a.nombre)}</label>`).join("")}</div>
    </div>`;
  openModal({
    title: "Quién firma cada área", large: true, submitLabel: "Guardar",
    bodyHTML: `
      <p class="text-muted">Agrupa las áreas según quién las recibe. Al pedir la firma, la app del técnico y el portal del hotel ofrecen
        un botón por responsable (“👤 Chef · 12 puntos”) que marca solas sus áreas. Siempre se puede firmar todo de una vez o marcar áreas a mano.</p>
      ${areas.length ? "" : `<p class="form-error" style="display:block">Esta planta no tiene áreas.</p>`}
      <div id="resp-lista">${(actuales.length ? actuales : [{ cargo: "", areas: [] }]).map(fila).join("")}</div>
      <button type="button" class="btn btn-sm" id="resp-mas" style="margin-top:8px">+ Agregar responsable</button>`,
    onMount(o) {
      o.querySelector("#resp-mas").addEventListener("click", () => o.querySelector("#resp-lista").insertAdjacentHTML("beforeend", fila()));
      o.addEventListener("click", (e) => { if (e.target.closest(".resp-quitar")) e.target.closest(".resp-fila").remove(); });
    },
    async onSubmit(fd, o) {
      const lista = [...o.querySelectorAll(".resp-fila")].map((f) => ({
        id: f.dataset.id || undefined, cargo: f.querySelector(".resp-cargo").value.trim(),
        areas: [...f.querySelectorAll(".resp-areas input:checked")].map((c) => c.value),
      })).filter((r) => r.cargo || r.areas.length);
      const malos = lista.filter((r) => !r.cargo || !r.areas.length);
      if (malos.length) throw new Error("Cada responsable necesita su cargo y al menos un área");
      await put(`/firmas/responsables?sitio_id=${sitioId}`, lista);
      closeModal(); toast("Responsables guardados"); alGuardar?.();
    },
  });
}

async function modalOrdenFirma(sitioId, fecha, clave, alCambiar) {
  const o = await get(`/firmas/orden?${new URLSearchParams({ sitio_id: sitioId, fecha, clave })}`);
  const hora = (f) => new Date(f).toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit", timeZone: "America/Santo_Domingo" });
  const quien = new Map(o.firmas.map((f) => [f.id, f]));
  const origen = (x) => (x === "tecnico" ? "en el teléfono del técnico" : x === "portal" ? "en el portal del hotel" : "desde el panel");
  openModal({
    title: `Orden de ${o.tecnico || "técnico"} · ${new Date(`${fecha}T12:00:00`).toLocaleDateString("es-DO", { weekday: "long", day: "numeric", month: "long" })}`,
    large: true,
    bodyHTML: `
      <p>${ESTADO_FIRMA_P[o.estado]} &nbsp;${o.hechos} puntos realizados${o.no_realizados ? ` · ${o.no_realizados} no realizados` : ""}${o.registros > o.puntos ? ` · ${o.registros} registros (un punto registrado varias veces cuenta una)` : ""}${o.pendientes_puntos ? ` · <strong>${o.pendientes_puntos} sin firmar</strong>` : ""}</p>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Hora</th><th>Punto</th><th>Tipo</th><th>Resultado</th><th>Firmado por</th></tr></thead>
        <tbody>${o.servicios.map((s) => `<tr class="clickable" data-insp="${esc(s.inspeccion_id)}">
          <td>${hora(s.hora)}</td><td><strong>${esc(s.punto || "")}</strong> <span class="tec-sub">${esc(s.area || "")}</span></td>
          <td>${esc(s.icono || "")} ${esc(s.tipo || "")}</td>
          <td>${s.no_realizado ? `<span class="estado-chip pendiente">No realizado</span>` : s.nivel_actividad && s.nivel_actividad !== "ninguna" ? `Con actividad (${esc(s.nivel_actividad)})` : "Realizado"}</td>
          <td>${s.firma_id ? esc(quien.get(s.firma_id)?.firmante_nombre || "Firmado") : `<span style="color:#b45309">Sin firmar</span>`}</td></tr>`).join("")}</tbody>
      </table></div>
      ${o.firmas.map((f) => `
        <div style="border-top:1px solid #e2e8f0;margin-top:12px;padding-top:10px">
          <h4 class="tec-h4" style="margin-top:0">✍️ ${esc(f.parte || "Todo el servicio")} · ${f.puntos} punto(s)</h4>
          ${f.imagen ? `<img src="${esc(f.imagen)}" alt="Firma" style="max-width:300px;width:100%;border-bottom:1px solid #94a3b8">` : ""}
          <p><strong>${esc(f.firmante_nombre)}</strong>${f.firmante_cargo ? ` · ${esc(f.firmante_cargo)}` : ""}<br>
            <span class="text-muted">${esc(fmtDateTime(f.created_at))} · ${origen(f.origen)}${f.origen === "portal" && f.firmado_por_nombre ? ` (${esc(f.firmado_por_nombre)})` : ""}</span></p>
          ${f.comentario ? `<p><strong>Comentario:</strong> ${esc(f.comentario)}</p>` : ""}
          ${USUARIO?.rol === "admin" ? `<button type="button" class="btn btn-sm btn-danger" data-anular="${esc(f.id)}">Anular esta firma</button>` : ""}
        </div>`).join("")}`,
    onMount(overlay) {
      overlay.querySelectorAll("[data-insp]").forEach((tr) => tr.addEventListener("click", () => typeof abrirDesglose === "function" && abrirDesglose(tr.dataset.insp)));
      overlay.querySelectorAll("[data-anular]").forEach((b) => b.addEventListener("click", async () => {
        if (!confirm("¿Anular esta firma? Lo que cubría vuelve a quedar sin firmar.")) return;
        try { await api(`/firmas/${b.dataset.anular}`, { method: "DELETE" }); closeModal(); toast("Firma anulada"); alCambiar?.(); }
        catch (e) { toast(e.message, true); }
      }));
    },
  });
  $(".modal-foot")?.remove();
}
