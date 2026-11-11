// firmas.js — Panel: órdenes del técnico por planta y su firma de recibido
//
// Pestaña "Órdenes y firmas" dentro de cada planta. Cada orden es lo que hizo
// un técnico en un día: "En proceso" hasta que el hotel firma, "Finalizada"
// con la firma. Servidor: backend/routes/firmas.js

async function tabFirmasPlanta(cuerpo, sitioId, dias = 7) {
  const hasta = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
  const d0 = new Date(`${hasta}T12:00:00Z`); d0.setUTCDate(d0.getUTCDate() - (dias - 1));
  const d = await get(`/firmas/ordenes?${new URLSearchParams({ sitio_id: sitioId, desde: d0.toISOString().slice(0, 10), hasta })}`);
  const hora = (f) => new Date(f).toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit", timeZone: "America/Santo_Domingo" });
  cuerpo.innerHTML = `
    <div class="toolbar">
      <select id="fp-dias">${[[1, "Hoy"], [7, "Últimos 7 días"], [30, "Últimos 30 días"], [90, "Últimos 90 días"]].map(([n, t]) => `<option value="${n}"${n === dias ? " selected" : ""}>${t}</option>`).join("")}</select>
      <span class="estado-chip pendiente">${d.resumen.en_proceso} en proceso</span>
      <span class="estado-chip hecho">${d.resumen.finalizadas} finalizadas</span>
    </div>
    <p class="text-muted" style="margin-top:0">La orden queda <strong>finalizada</strong> cuando el hotel firma de recibido: en el teléfono del técnico (botón “Firma de recibido”) o en el portal del hotel (pestaña Firmas).</p>
    ${d.ordenes.length ? `<div class="table-wrap"><table class="data">
      <thead><tr><th>Fecha</th><th>Técnico</th><th>Servicios</th><th>Estado</th><th>Recibido por</th></tr></thead>
      <tbody>${d.ordenes.map((o) => `
        <tr class="clickable" data-orden="${esc(o.fecha)}|${esc(o.clave)}" tabindex="0">
          <td>${esc(new Date(`${o.fecha}T12:00:00`).toLocaleDateString("es-DO", { weekday: "short", day: "numeric", month: "short" }))}<div class="tec-sub">${hora(o.desde)} a ${hora(o.hasta)}</div></td>
          <td>${esc(o.tecnico)}</td>
          <td>${o.hechos} puntos hechos${o.registros > o.puntos ? ` <span class="tec-sub">(${o.registros} registros)</span>` : ""}${o.no_realizados ? ` · <span style="color:#b91c1c">${o.no_realizados} no realizados</span>` : ""}</td>
          <td>${o.estado === "finalizada" ? `<span class="estado-chip hecho">Finalizada</span>` : `<span class="estado-chip pendiente">En proceso</span>`}</td>
          <td>${o.firma ? `${esc(o.firma.firmante_nombre)}${o.firma.firmante_cargo ? ` <span class="tec-sub">${esc(o.firma.firmante_cargo)}</span>` : ""}` : "—"}</td>
        </tr>`).join("")}</tbody></table></div>`
      : `<div class="empty-row">No hay órdenes en este período.</div>`}`;
  $("#fp-dias").addEventListener("change", (e) => tabFirmasPlanta(cuerpo, sitioId, Number(e.target.value)));
  cuerpo.querySelectorAll("[data-orden]").forEach((tr) => {
    const abrir = () => { const [fecha, ...c] = tr.dataset.orden.split("|"); modalOrdenFirma(sitioId, fecha, c.join("|"), () => tabFirmasPlanta(cuerpo, sitioId, dias)); };
    tr.addEventListener("click", abrir);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") abrir(); });
  });
}

async function modalOrdenFirma(sitioId, fecha, clave, alCambiar) {
  const o = await get(`/firmas/orden?${new URLSearchParams({ sitio_id: sitioId, fecha, clave })}`);
  const hora = (f) => new Date(f).toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit", timeZone: "America/Santo_Domingo" });
  openModal({
    title: `Orden de ${o.tecnico || "técnico"} · ${new Date(`${fecha}T12:00:00`).toLocaleDateString("es-DO", { weekday: "long", day: "numeric", month: "long" })}`,
    large: true,
    bodyHTML: `
      <p>${o.estado === "finalizada" ? `<span class="estado-chip hecho">Finalizada</span>` : `<span class="estado-chip pendiente">En proceso · falta la firma del hotel</span>`}
        &nbsp;${o.hechos} puntos realizados${o.no_realizados ? ` · ${o.no_realizados} no realizados` : ""}${o.registros > o.puntos ? ` · ${o.registros} registros (un punto registrado varias veces cuenta una)` : ""}</p>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Hora</th><th>Punto</th><th>Tipo</th><th>Resultado</th></tr></thead>
        <tbody>${o.servicios.map((s) => `<tr class="clickable" data-insp="${esc(s.inspeccion_id)}">
          <td>${hora(s.hora)}</td><td><strong>${esc(s.punto || "")}</strong> <span class="tec-sub">${esc(s.area || "")}</span></td>
          <td>${esc(s.icono || "")} ${esc(s.tipo || "")}</td>
          <td>${s.no_realizado ? `<span class="estado-chip pendiente">No realizado</span>` : s.nivel_actividad && s.nivel_actividad !== "ninguna" ? `Con actividad (${esc(s.nivel_actividad)})` : "Realizado"}</td></tr>`).join("")}</tbody>
      </table></div>
      ${o.firma ? `
        <h4 class="tec-h4">Recibido conforme</h4>
        <img src="${esc(o.firma.imagen)}" alt="Firma" style="max-width:320px;width:100%;border-bottom:1px solid #94a3b8">
        <p><strong>${esc(o.firma.firmante_nombre)}</strong>${o.firma.firmante_cargo ? ` · ${esc(o.firma.firmante_cargo)}` : ""}<br>
          <span class="text-muted">${esc(fmtDateTime(o.firma.created_at))} · ${o.firma.origen === "tecnico" ? "en el teléfono del técnico" : o.firma.origen === "portal" ? `en el portal del hotel (${esc(o.firma.firmado_por_nombre || "")})` : "desde el panel"}</span></p>
        ${o.firma.comentario ? `<p><strong>Comentario:</strong> ${esc(o.firma.comentario)}</p>` : ""}
        ${USUARIO?.rol === "admin" ? `<button type="button" class="btn btn-sm btn-danger" id="fo-anular">Anular firma (vuelve a “En proceso”)</button>` : ""}` : ""}`,
    onMount(overlay) {
      overlay.querySelectorAll("[data-insp]").forEach((tr) => tr.addEventListener("click", () => typeof abrirDesglose === "function" && abrirDesglose(tr.dataset.insp)));
      overlay.querySelector("#fo-anular")?.addEventListener("click", async () => {
        if (!confirm("¿Anular la firma? La orden vuelve a quedar en proceso y el hotel tendrá que firmar otra vez.")) return;
        try { await api(`/firmas/${o.firma.id}`, { method: "DELETE" }); closeModal(); toast("Firma anulada"); alCambiar?.(); }
        catch (e) { toast(e.message, true); }
      });
    },
  });
  $(".modal-foot")?.remove();
}
