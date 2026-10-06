// ═════════════════════════════════════════════════════════════════════════
// incidencias.js — Chinche / código rosa
//
// El caso de una habitación reportada por el hotel, de punta a punta:
//   1. Verificaciones (checklist) → 2. ¿Hay chinche?
//      sí → condiciones + nivel → protocolo con directrices y fechas
//           (se ajusta caso por caso) → verificación final → liberada
//      no → negativa
//   3. Certificado en español / inglés (solo con resultado negativo)
//
// La plantilla (qué se verifica, qué condiciones se marcan, qué directrices
// lleva cada nivel y quién firma el certificado) se edita en "Plantilla del
// protocolo".
//
// Se carga antes de app.js y aporta MODULOS_EXTRA_9.
// ═════════════════════════════════════════════════════════════════════════

const MODULOS_EXTRA_9 = [
  { key: "incidencias", label: "Chinche / código rosa", ic: "🛏️", seccion: "operacion", roles: ["admin", "operaciones", "comercial"], view: viewIncidencias },
];

const INC_ESTADO = {
  abierta: ["Por verificar", "pendiente"],
  en_tratamiento: ["En tratamiento", "fuera"],
  negativa: ["Negativa (sin chinche)", "hecho"],
  cerrada: ["Liberada", "hecho"],
  cancelada: ["Cancelada", "fuera"],
};
const INC_TIPO = { chinche: "Chinche", codigo_rosa: "Código rosa" };
const NIVELES_INC = [["leve", "Leve"], ["moderado", "Moderado"], ["severo", "Severo"]];
let INC_PLANTILLA = null;

const chipInc = (estado) => {
  const [t, c] = INC_ESTADO[estado] || [estado, "fuera"];
  return `<span class="estado-chip ${c}">${esc(t)}</span>`;
};

async function plantillaInc(forzar = false) {
  if (!INC_PLANTILLA || forzar) INC_PLANTILLA = await get("/incidencias/protocolo");
  return INC_PLANTILLA;
}

async function viewIncidencias(content) {
  content.innerHTML = `
    <div class="toolbar">
      <select id="inc-sitio"><option value="">Todas las plantas</option></select>
      <select id="inc-estado">
        <option value="abiertas">Abiertas</option>
        <option value="cerradas">Cerradas</option>
        <option value="todas">Todas</option>
      </select>
      <span class="toolbar-sep"></span>
      <button class="btn btn-sm" id="inc-plantilla">⚙️ Plantilla del protocolo</button>
      <button class="btn btn-sm btn-primary" id="inc-nueva">+ Nueva incidencia</button>
    </div>
    <div class="card" id="inc-lista"><div class="center-msg">Cargando…</div></div>`;

  const sitios = await get("/sitios").catch(() => []);
  $("#inc-sitio").innerHTML = `<option value="">Todas las plantas</option>` +
    sitios.map((s) => `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`).join("");

  async function cargar() {
    const qs = new URLSearchParams({ estado: $("#inc-estado").value });
    if ($("#inc-sitio").value) qs.set("sitio_id", $("#inc-sitio").value);
    const lista = await get(`/incidencias?${qs}`);
    $("#inc-lista").innerHTML = tableHTML(
      [
        { label: "Caso", fmt: (i) => `<strong>${esc(i.numero)}</strong><div class="text-muted">${esc(INC_TIPO[i.tipo] || i.tipo)}</div>` },
        { label: "Planta", fmt: (i) => esc(i.planta || "—") },
        { label: "Habitación", fmt: (i) => `<strong>${esc(i.numero_habitacion)}</strong>` },
        { label: "Reportado", fmt: (i) => `${fmtDateTime(i.fecha_reporte)}${i.reportado_por ? `<div class="text-muted">${esc(i.reportado_por)}</div>` : ""}` },
        { label: "Verificación", fmt: (i) => `${i.verificaciones_hechas}/${i.verificaciones_total}` },
        { label: "Protocolo", fmt: (i) => (i.protocolo_total ? `${i.protocolo_hechos}/${i.protocolo_total} pasos` : "—") },
        { label: "Estado", fmt: (i) => chipInc(i.estado) + (i.nivel ? ` <span class="text-muted">${esc(i.nivel)}</span>` : "") },
        { label: "Orden", fmt: (i) => esc(i.numero_orden || "—") },
      ],
      lista,
      "No hay incidencias con estos filtros."
    );
    $$("#inc-lista tr[data-id]").forEach((tr) => tr.addEventListener("click", () => abrirIncidencia(tr.dataset.id)));
  }

  $("#inc-sitio").addEventListener("change", cargar);
  $("#inc-estado").addEventListener("change", cargar);
  $("#inc-nueva").addEventListener("click", () => modalNuevaIncidencia(sitios, $("#inc-sitio").value, (i) => abrirIncidencia(i.id)));
  $("#inc-plantilla").addEventListener("click", () => editarPlantillaInc());
  await cargar();
}

function modalNuevaIncidencia(sitios, sitioPorDefecto, alGuardar, datos = {}) {
  openModal({
    title: "Nueva incidencia de chinche / código rosa",
    bodyHTML: `
      <div class="form-grid">
        <div class="form-group"><label>Planta *</label>
          <select name="sitio_id" required>
            ${sitios.map((s) => `<option value="${esc(s.id)}"${s.id === (datos.sitio_id || sitioPorDefecto) ? " selected" : ""}>${esc(s.nombre)}</option>`).join("")}
          </select>
        </div>
        <div class="form-group"><label>Habitación *</label><input name="numero_habitacion" required value="${esc(datos.numero_habitacion || "")}" placeholder="2446" /></div>
        <div class="form-group"><label>Tipo</label>
          <select name="tipo"><option value="chinche">Chinche</option><option value="codigo_rosa">Código rosa</option></select>
        </div>
        <div class="form-group"><label>Reportado por (hotel)</label><input name="reportado_por" value="${esc(datos.reportado_por || "")}" /></div>
        <div class="form-group"><label>Certificado dirigido a</label><input name="dirigido_a" placeholder="Leticia Álvarez" /></div>
        <div class="form-group"><label>Nombre del hotel en el certificado</label><input name="hotel_nombre" placeholder="Vacío = nombre de la planta" /></div>
      </div>
      <div class="form-group"><label>Qué reportó el hotel</label><textarea name="descripcion" rows="2">${esc(datos.descripcion || "")}</textarea></div>`,
    submitLabel: "Abrir incidencia",
    async onSubmit(fd) {
      const cuerpo = Object.fromEntries(fd.entries());
      if (datos.orden_id) cuerpo.orden_id = datos.orden_id;
      const i = await post("/incidencias", cuerpo);
      closeModal();
      toast(`Incidencia ${i.numero} abierta`);
      alGuardar(i);
    },
  });
}

// ── Ficha del caso ───────────────────────────────────────────────────────
async function abrirIncidencia(id) {
  const content = $("#content");
  content.innerHTML = `<div class="center-msg">Cargando…</div>`;
  const [inc, plantilla] = await Promise.all([get(`/incidencias/${id}`), plantillaInc()]);
  pintarIncidencia(content, inc, plantilla);
}

function pintarIncidencia(content, inc, plantilla) {
  const cerrada = ["cerrada", "negativa", "cancelada"].includes(inc.estado);
  const editable = !["cancelada"].includes(inc.estado);
  const verifHechas = inc.verificaciones.filter((v) => v.hecho).length;
  const todasVerif = verifHechas === inc.verificaciones.length && inc.verificaciones.length > 0;
  const enTratamiento = inc.estado === "en_tratamiento";
  const condNombre = (c) => plantilla.condiciones.find((x) => x.codigo === c)?.texto || c;

  content.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <button class="btn btn-sm" id="inc-volver">← Incidencias</button>
          <h2 style="display:inline-block;margin-left:10px">${esc(inc.numero)} · Habitación ${esc(inc.numero_habitacion)}</h2>
          <div class="text-muted" style="margin-top:6px">
            ${esc(INC_TIPO[inc.tipo])} · ${esc(inc.planta || "")} · reportado ${fmtDateTime(inc.fecha_reporte)}
            ${inc.reportado_por ? ` por ${esc(inc.reportado_por)}` : ""}${inc.numero_orden ? ` · orden ${esc(inc.numero_orden)}` : ""}
          </div>
        </div>
        <div class="actions">${chipInc(inc.estado)}${inc.nivel ? ` <span class="estado-chip fuera">Nivel ${esc(inc.nivel)}</span>` : ""}</div>
      </div>

      ${inc.puede_certificar ? `
        <div class="inc-cert">
          <div><strong>✅ ${inc.estado === "cerrada" ? "Habitación liberada" : "Sin chinche"}.</strong>
            Certificado para ${esc(inc.dirigido_a || "(sin destinatario)")} · ${esc(inc.hotel_nombre || inc.planta || "")}
            ${inc.certificado_at ? `<span class="text-muted"> · emitido ${fmtDateTime(inc.certificado_at)}</span>` : ""}</div>
          <div class="actions">
            <input type="date" id="inc-cert-fecha" value="${(inc.fecha_cierre || inc.fecha_verificacion || new Date().toISOString()).slice(0, 10)}" title="Fecha del certificado" />
            <button class="btn btn-primary btn-sm" data-cert="es">PDF español</button>
            <button class="btn btn-primary btn-sm" data-cert="en">PDF English</button>
            <button class="btn btn-sm" data-cert="ambos">Los dos (2 hojas)</button>
          </div>
        </div>` : ""}

      <div class="form-grid" style="margin-top:14px">
        <div class="form-group"><label>Certificado dirigido a</label><input id="inc-dirigido" value="${esc(inc.dirigido_a || "")}" placeholder="Leticia Álvarez" ${editable ? "" : "disabled"} /></div>
        <div class="form-group"><label>Hotel como sale en el certificado</label><input id="inc-hotel" value="${esc(inc.hotel_nombre || "")}" placeholder="${esc(inc.planta || "")}" ${editable ? "" : "disabled"} /></div>
        <div class="form-group"><label>Reportado por</label><input id="inc-reporto" value="${esc(inc.reportado_por || "")}" ${editable ? "" : "disabled"} /></div>
        <div class="form-group"><label>Habitación</label><input id="inc-hab" value="${esc(inc.numero_habitacion)}" ${editable ? "" : "disabled"} /></div>
      </div>
      ${inc.descripcion ? `<p><strong>Lo que reportó el hotel:</strong> ${esc(inc.descripcion)}</p>` : ""}
    </div>

    <div class="card">
      <div class="card-head"><h2>1. Verificaciones (${verifHechas}/${inc.verificaciones.length})</h2>
        <div class="actions">${enTratamiento ? `<button class="btn btn-sm" id="inc-reverificar">↻ Nueva verificación (final)</button>` : ""}</div>
      </div>
      <p class="text-muted">Todas tienen que estar hechas antes de dar el resultado. Quién la marcó y cuándo queda guardado.</p>
      <div class="inc-lista" id="inc-verif">
        ${inc.verificaciones.map((v) => `
          <div class="inc-item ${v.hecho ? "hecho" : ""}" data-id="${esc(v.id)}">
            <label><input type="checkbox" ${v.hecho ? "checked" : ""} ${editable && !cerrada ? "" : "disabled"} /> <span>${esc(v.texto)}</span></label>
            <input class="inc-nota" placeholder="Nota" value="${esc(v.nota || "")}" ${editable && !cerrada ? "" : "disabled"} />
            <span class="text-muted inc-quien">${v.hecho ? `${esc(v.por || "")} · ${fmtDateTime(v.at)}` : ""}</span>
          </div>`).join("")}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>2. Resultado: ¿se encontró chinche?</h2></div>
      ${inc.resultado ? `<p><strong>${inc.resultado === "positivo" ? "🔴 Sí, positivo" : "🟢 No, negativo"}</strong>
          · ${fmtDateTime(inc.fecha_verificacion)}${inc.verificado_por ? ` · ${esc(inc.verificado_por)}` : ""}</p>` : ""}
      ${inc.condiciones?.length ? `<p><strong>Condiciones encontradas:</strong> ${inc.condiciones.map((c) => esc(condNombre(c))).join(" · ")}</p>` : ""}
      ${!cerrada && editable ? `
        ${todasVerif ? "" : `<div class="form-error" style="display:block">Faltan ${inc.verificaciones.length - verifHechas} verificación(es) para poder dar el resultado.</div>`}
        <div class="inc-botones">
          <button class="btn btn-danger" id="inc-si" ${todasVerif ? "" : "disabled"}>Sí, hay chinche</button>
          <button class="btn btn-success" id="inc-no" ${todasVerif ? "" : "disabled"}>${enTratamiento ? "No hay — liberar habitación" : "No hay chinche"}</button>
        </div>
        <div id="inc-condiciones" style="display:none">
          <h3 style="margin:14px 0 8px">¿Qué se encontró? (condiciones)</h3>
          <div class="inc-lista">
            ${plantilla.condiciones.map((c) => `
              <label class="inc-item"><span><input type="checkbox" value="${esc(c.codigo)}" ${inc.condiciones?.includes(c.codigo) ? "checked" : ""} /> ${esc(c.texto)}</span></label>`).join("")}
          </div>
          <div class="form-grid" style="margin-top:10px">
            <div class="form-group"><label>Nivel</label>
              <select id="inc-nivel">${NIVELES_INC.map(([v, t]) => `<option value="${v}"${inc.nivel === v ? " selected" : ""}>${t}</option>`).join("")}</select>
              <small class="text-muted" id="inc-nivel-sug"></small>
            </div>
          </div>
          <button class="btn btn-danger" id="inc-confirmar-si">Confirmar positivo y crear el protocolo</button>
        </div>` : ""}
    </div>

    ${inc.protocolo?.length ? `
    <div class="card">
      <div class="card-head"><h2>3. Protocolo de tratamiento (${inc.protocolo.filter((p) => p.hecho).length}/${inc.protocolo.length})</h2>
        <div class="actions">${editable && !cerrada ? `<button class="btn btn-sm" id="inc-paso-nuevo">+ Agregar directriz</button>` : ""}</div>
      </div>
      <p class="text-muted">Las directrices salen de la plantilla según el nivel. Aquí se ajustan para este caso: cambia el texto o la fecha, agrega o quita pasos, y márcalos al hacerlos.</p>
      <div class="inc-lista" id="inc-proto">
        ${inc.protocolo.map((p) => filaPaso(p, editable && !cerrada)).join("")}
      </div>
    </div>` : ""}

    ${editable && !cerrada ? `<div class="inc-guardar"><button class="btn btn-primary" id="inc-guardar">Guardar cambios</button></div>` : ""}

    <div class="card">
      <div class="card-head"><h2>Bitácora</h2>
        <div class="actions">${editable && !cerrada ? `<button class="btn btn-sm" id="inc-cancelar">Cancelar incidencia</button>` : ""}</div>
      </div>
      ${(inc.log || []).map((l) => `<div class="inc-log"><span class="text-muted">${fmtDateTime(l.created_at)}</span> · <strong>${esc(l.usuario_nombre || "")}</strong> · ${esc(l.accion)}${l.detalle ? ` — ${esc(l.detalle)}` : ""}</div>`).join("") || `<div class="text-muted">Sin movimientos.</div>`}
    </div>`;

  const recargar = (nueva) => pintarIncidencia(content, { ...inc, ...nueva, log: inc.log }, plantilla);
  const recargarDeServidor = async () => pintarIncidencia(content, await get(`/incidencias/${inc.id}`), plantilla);

  $("#inc-volver").addEventListener("click", () => navigate("incidencias"));

  $$("[data-cert]").forEach((b) => b.addEventListener("click", async () => {
    const idioma = b.dataset.cert;
    const fecha = $("#inc-cert-fecha").value;
    b.disabled = true;
    try {
      await guardarCambios(false);
      await descargarPdf(`/incidencias/${inc.id}/certificado?idioma=${idioma}&fecha=${fecha}`,
        `Certificado-hab-${inc.numero_habitacion}-${idioma === "ambos" ? "es-en" : idioma}.pdf`);
      if (!inc.certificado_at) await recargarDeServidor();
    } catch (e) { toast(e.message, true); }
    b.disabled = false;
  }));

  function leerLista(sel) {
    return $$(`${sel} .inc-item`).map((el) => {
      const o = {
        id: el.dataset.id,
        hecho: el.querySelector("input[type=checkbox]").checked,
        nota: el.querySelector(".inc-nota")?.value || "",
      };
      const t = el.querySelector(".inc-texto");
      o.texto = t ? t.value : el.querySelector("label span")?.textContent || "";
      const f = el.querySelector(".inc-fecha");
      if (f) o.fecha = f.value;
      return o;
    });
  }

  async function guardarCambios(avisar = true) {
    if (!editable) return;
    const cuerpo = {
      dirigido_a: $("#inc-dirigido").value,
      hotel_nombre: $("#inc-hotel").value,
      reportado_por: $("#inc-reporto").value,
      numero_habitacion: $("#inc-hab").value,
    };
    if (!cerrada) {
      cuerpo.verificaciones = leerLista("#inc-verif");
      if ($("#inc-proto")) cuerpo.protocolo = leerLista("#inc-proto");
    }
    const r = await patch(`/incidencias/${inc.id}`, cuerpo);
    if (avisar) { toast("Guardado"); await recargarDeServidor(); }
    return r;
  }

  $("#inc-guardar")?.addEventListener("click", () => guardarCambios().catch((e) => toast(e.message, true)));

  // Marcar una verificación o un paso se guarda al momento: es lo que hace el
  // técnico caminando la habitación, y no se debe perder si cierra la pantalla.
  $$("#inc-verif input[type=checkbox], #inc-proto input[type=checkbox]").forEach((c) =>
    c.addEventListener("change", () => guardarCambios().catch((e) => toast(e.message, true)))
  );

  $("#inc-paso-nuevo")?.addEventListener("click", () => {
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
    $("#inc-proto").insertAdjacentHTML("beforeend", filaPaso({ id: "", texto: "", fecha: hoy, hecho: false, nota: "" }, true));
    const ultimo = $$("#inc-proto .inc-item").pop();
    ultimo.querySelector(".inc-texto").focus();
    engancharQuitar();
  });
  function engancharQuitar() {
    $$("#inc-proto .inc-quitar").forEach((b) => {
      b.onclick = () => { if (confirm("¿Quitar esta directriz del protocolo?")) b.closest(".inc-item").remove(); };
    });
  }
  engancharQuitar();

  $("#inc-reverificar")?.addEventListener("click", async () => {
    if (!confirm("Se reinicia el checklist de verificaciones para hacer la verificación final. ¿Seguir?")) return;
    await guardarCambios(false);
    await post(`/incidencias/${inc.id}/nueva-verificacion`, {});
    await recargarDeServidor();
  });

  const sugerir = () => {
    const marcadas = $$("#inc-condiciones input:checked").map((x) => x.value);
    const peso = plantilla.condiciones.filter((c) => marcadas.includes(c.codigo)).reduce((s, c) => s + c.peso, 0);
    const nivel = peso >= 5 ? "severo" : peso >= 2 ? "moderado" : "leve";
    $("#inc-nivel").value = nivel;
    $("#inc-nivel-sug").textContent = marcadas.length ? `Sugerido por las condiciones: ${nivel}` : "";
  };
  $$("#inc-condiciones input[type=checkbox]").forEach((c) => c.addEventListener("change", sugerir));

  $("#inc-si")?.addEventListener("click", () => {
    $("#inc-condiciones").style.display = "";
    $("#inc-condiciones").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  $("#inc-confirmar-si")?.addEventListener("click", async () => {
    const condiciones = $$("#inc-condiciones input:checked").map((x) => x.value);
    if (!condiciones.length) return toast("Marca al menos una condición encontrada", true);
    try {
      await guardarCambios(false);
      await post(`/incidencias/${inc.id}/resultado`, { resultado: "positivo", condiciones, nivel: $("#inc-nivel").value });
      toast("Positivo registrado: protocolo creado");
      await recargarDeServidor();
    } catch (e) { toast(e.message, true); }
  });
  $("#inc-no")?.addEventListener("click", async () => {
    const msg = enTratamiento
      ? "Verificación final NEGATIVA: se libera la habitación y se habilita el certificado. ¿Confirmar?"
      : "Resultado NEGATIVO (no hay chinche): se cierra el caso y se habilita el certificado. ¿Confirmar?";
    if (!confirm(msg)) return;
    try {
      await guardarCambios(false);
      await post(`/incidencias/${inc.id}/resultado`, { resultado: "negativo" });
      toast("Negativo registrado: ya puedes generar el certificado");
      await recargarDeServidor();
    } catch (e) {
      if (/paso\(s\) del protocolo/.test(e.message) && confirm(`${e.message}\n\n¿Liberar de todos modos?`)) {
        await post(`/incidencias/${inc.id}/resultado`, { resultado: "negativo", forzar: true });
        await recargarDeServidor();
      } else toast(e.message, true);
    }
  });

  $("#inc-cancelar")?.addEventListener("click", async () => {
    const motivo = prompt("¿Por qué se cancela? (por ejemplo: reporte duplicado)");
    if (motivo === null) return;
    await post(`/incidencias/${inc.id}/cancelar`, { motivo });
    await recargarDeServidor();
  });
}

function filaPaso(p, editable) {
  return `
    <div class="inc-item inc-paso ${p.hecho ? "hecho" : ""}" data-id="${esc(p.id || "")}">
      <input type="checkbox" ${p.hecho ? "checked" : ""} ${editable ? "" : "disabled"} title="Hecho" />
      <input type="date" class="inc-fecha" value="${esc(p.fecha || "")}" ${editable ? "" : "disabled"} />
      <input class="inc-texto" value="${esc(p.texto)}" placeholder="Directriz" ${editable ? "" : "disabled"} />
      <input class="inc-nota" placeholder="Nota" value="${esc(p.nota || "")}" ${editable ? "" : "disabled"} />
      <span class="text-muted inc-quien">${p.hecho ? `${esc(p.por || "")} · ${fmtDateTime(p.at)}` : ""}</span>
      ${editable ? `<button type="button" class="btn btn-sm inc-quitar" title="Quitar">✕</button>` : ""}
    </div>`;
}

// ── Plantilla del protocolo ──────────────────────────────────────────────
async function editarPlantillaInc() {
  const p = await plantillaInc(true);
  const filaCond = (c = {}) => `
    <div class="inc-fila-cond">
      <input class="pc-texto" value="${esc(c.texto || "")}" placeholder="Condición encontrada" />
      <select class="pc-peso" title="Gravedad">
        ${[[1, "Pesa poco"], [2, "Pesa medio"], [3, "Pesa mucho"]].map(([v, t]) => `<option value="${v}"${Number(c.peso || 1) === v ? " selected" : ""}>${t}</option>`).join("")}
      </select>
      <input type="hidden" class="pc-codigo" value="${esc(c.codigo || "")}" />
      <button type="button" class="btn btn-sm pc-quitar">✕</button>
    </div>`;
  const filaDir = (d = {}) => `
    <div class="inc-fila-dir">
      <input class="pd-texto" value="${esc(d.texto || "")}" placeholder="Directriz" />
      <label class="pd-dia">Día <input type="number" min="0" class="pd-dia-n" value="${Number(d.dia || 0)}" /></label>
      ${NIVELES_INC.map(([v, t]) => `<label class="pd-niv"><input type="checkbox" value="${v}" ${(d.niveles || []).includes(v) ? "checked" : ""}/> ${t}</label>`).join("")}
      <button type="button" class="btn btn-sm pd-quitar">✕</button>
    </div>`;

  openModal({
    title: "Plantilla del protocolo de chinche / código rosa",
    large: true,
    bodyHTML: `
      <h3>Verificaciones</h3>
      <p class="text-muted">Una por línea. Es el checklist que se marca antes de dar el resultado.</p>
      <textarea name="verificaciones" rows="8">${esc(p.verificaciones.join("\n"))}</textarea>

      <h3 style="margin-top:16px">Condiciones (cuando sí hay chinche)</h3>
      <p class="text-muted">Lo que se puede marcar al encontrar chinche. El peso suma para sugerir el nivel: menos de 2 leve, de 2 a 4 moderado, 5 o más severo.</p>
      <div id="pc-lista">${p.condiciones.map(filaCond).join("")}</div>
      <button type="button" class="btn btn-sm" id="pc-agregar">+ Condición</button>

      <h3 style="margin-top:16px">Directrices del protocolo</h3>
      <p class="text-muted">Día = días después del resultado positivo. Si no marcas ningún nivel, aplica a todos.</p>
      <div id="pd-lista">${p.directrices.map(filaDir).join("")}</div>
      <button type="button" class="btn btn-sm" id="pd-agregar">+ Directriz</button>

      <h3 style="margin-top:16px">Certificado</h3>
      <div class="form-grid">
        <div class="form-group"><label>Empresa (encabezado)</label><input name="c_empresa" value="${esc(p.certificado.empresa)}" /></div>
        <div class="form-group"><label>Empresa (en el texto)</label><input name="c_empresa_corta" value="${esc(p.certificado.empresa_corta)}" /></div>
        <div class="form-group"><label>RNC</label><input name="c_rnc" value="${esc(p.certificado.rnc)}" /></div>
        <div class="form-group"><label>Firma</label><input name="c_firmante" value="${esc(p.certificado.firmante)}" /></div>
        <div class="form-group"><label>Cargo (español)</label><input name="c_cargo" value="${esc(p.certificado.cargo)}" /></div>
        <div class="form-group"><label>Cargo (inglés)</label><input name="c_cargo_en" value="${esc(p.certificado.cargo_en)}" /></div>
      </div>`,
    submitLabel: "Guardar plantilla",
    onMount() {
      const enganchar = () => {
        $$(".pc-quitar, .pd-quitar").forEach((b) => (b.onclick = () => b.parentElement.remove()));
      };
      $("#pc-agregar").addEventListener("click", () => { $("#pc-lista").insertAdjacentHTML("beforeend", filaCond()); enganchar(); });
      $("#pd-agregar").addEventListener("click", () => { $("#pd-lista").insertAdjacentHTML("beforeend", filaDir()); enganchar(); });
      enganchar();
    },
    async onSubmit(fd) {
      const cuerpo = {
        verificaciones: String(fd.get("verificaciones") || "").split("\n").map((x) => x.trim()).filter(Boolean),
        condiciones: $$("#pc-lista .inc-fila-cond").map((f) => ({
          codigo: f.querySelector(".pc-codigo").value,
          texto: f.querySelector(".pc-texto").value,
          peso: Number(f.querySelector(".pc-peso").value),
        })).filter((c) => c.texto.trim()),
        directrices: $$("#pd-lista .inc-fila-dir").map((f) => ({
          texto: f.querySelector(".pd-texto").value,
          dia: Number(f.querySelector(".pd-dia-n").value) || 0,
          niveles: [...f.querySelectorAll(".pd-niv input:checked")].map((x) => x.value),
        })).filter((d) => d.texto.trim()),
        certificado: {
          empresa: fd.get("c_empresa"), empresa_corta: fd.get("c_empresa_corta"), rnc: fd.get("c_rnc"),
          firmante: fd.get("c_firmante"), cargo: fd.get("c_cargo"), cargo_en: fd.get("c_cargo_en"),
        },
      };
      INC_PLANTILLA = await api("/incidencias/protocolo", { method: "PUT", body: JSON.stringify(cuerpo) });
      closeModal();
      toast("Plantilla guardada. Aplica a las incidencias nuevas.");
    },
  });
}
