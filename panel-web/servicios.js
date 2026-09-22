// ═════════════════════════════════════════════════════════════════════════
// servicios.js — El dia de trabajo de una planta, y el reporte de evidencia
//
// Se carga despues de admin.js y antes de app.js. Reemplaza la pestana de
// "Habitaciones de hoy", que solo mostraba un tipo de punto: ASA sube muchos
// mas servicios que habitaciones (recorridos de areas, cebaderos, lamparas,
// aplicaciones puntuales) y todo eso quedaba invisible en el panel.
//
// Tres pestanas, que es como se mira el dia de verdad:
//   Servicios de hoy   — TODO lo que subio el tecnico, agrupado por tipo
//   Inspecciones de hoy— la rejilla de puntos hecho/pendiente, aparte
//   No realizados      — en rojo, lo que se intento y no se pudo, con el motivo
// ═════════════════════════════════════════════════════════════════════════

const MOTIVOS_TEXTO = {
  permiso_denegado: "El hotel no autorizó el acceso",
  huesped_en_habitacion: "Huésped dentro de la habitación",
  area_ocupada: "Área ocupada al momento de la visita",
  sin_llave: "No había quien abriera",
  en_mantenimiento: "Área en obra o mantenimiento",
  punto_inaccesible: "Punto bloqueado o inaccesible",
  evento_en_curso: "Evento en curso en el área",
  otro: "Otro motivo",
};

// Los estados del punto se editan en Configuracion -> Estados del punto, asi que
// esta tabla ya no manda: es solo el respaldo para dibujar algo mientras llega el
// catalogo (o si la llamada falla). Sin esto, renombrar un estado en el panel se
// veria bien en la app del tecnico y seguiria saliendo con el nombre viejo aqui.
const ESTADO_TEXTO = {
  ok: "Conforme",
  actividad: "Con actividad",
  "dañado": "Dañado",
  faltante: "Faltante",
  no_accesible: "No realizado",
  reemplazado: "Reemplazado",
};

let ESTADOS_PUNTO = null;

async function cargarEstadosPunto() {
  if (ESTADOS_PUNTO) return ESTADOS_PUNTO;
  try {
    const lista = await get("/config/estados_punto");
    ESTADOS_PUNTO = Object.fromEntries((Array.isArray(lista) ? lista : []).map((e) => [e.codigo, e.etiqueta]));
  } catch {
    ESTADOS_PUNTO = {};
  }
  return ESTADOS_PUNTO;
}

const estadoTexto = (codigo) =>
  ESTADOS_PUNTO?.[codigo] || ESTADO_TEXTO[codigo] || String(codigo || "").replace(/_/g, " ");

const NIVEL_TEXTO = { ninguna: "Sin actividad", bajo: "Actividad baja", medio: "Actividad media", alto: "Actividad alta" };
const NIVEL_CLASE = { ninguna: "hecho", bajo: "hecho", medio: "fuera", alto: "pendiente" };

// Responsabilidad del no realizado. No es un detalle: es lo que se discute en
// auditoria, y por eso se muestra desde la pantalla y no solo en el PDF.
const MOTIVOS_DEL_HOTEL = ["permiso_denegado", "sin_llave", "huesped_en_habitacion", "area_ocupada", "evento_en_curso"];

// ── Pestaña: servicios de hoy ────────────────────────────────────────────
// opts.fecha abre un día concreto; opts.volver pone el botón para regresar a
// "Días anteriores" (desde donde se abre el día completo).
async function tabServiciosHoy(cuerpo, sitioId, opts = {}) {
  cuerpo.innerHTML = `
    <div class="toolbar">
      ${opts.volver ? `<button class="btn btn-sm" id="sv-volver">← Días anteriores</button>` : ""}
      <input type="date" id="sv-fecha" value="${opts.fecha || hoyLocal()}" />
      <select id="sv-tipo"><option value="">Todos los tipos de servicio</option></select>
      <span class="toolbar-sep"></span>
      <button class="btn btn-sm" id="sv-reporte">Generar reporte</button>
    </div>
    <div id="sv-cuerpo"><div class="center-msg">Cargando…</div></div>`;

  tiposPunto().then((tipos) => {
    $("#sv-tipo").innerHTML =
      `<option value="">Todos los tipos de servicio</option>` +
      tipos.map((t) => `<option value="${esc(t.codigo)}">${esc(t.nombre)}</option>`).join("");
  }).catch(() => {});

  async function cargar() {
    const fecha = $("#sv-fecha").value || hoyLocal();
    const tipo = $("#sv-tipo").value;
    const destino = $("#sv-cuerpo");
    destino.innerHTML = `<div class="center-msg">Cargando…</div>`;

    const qs = new URLSearchParams({ sitio_id: sitioId, fecha });
    if (tipo) qs.set("tipo", tipo);
    const d = await get(`/inspecciones/dia?${qs}`);

    if (!d.realizados.length && !d.no_realizados.length) {
      destino.innerHTML = `<div class="center-msg">
        No hay servicios registrados el ${fmtDate(fecha)}.
        ${d.pendientes.length ? `<br><br>Hay <strong>${d.pendientes.length}</strong> puntos fuera de su frecuencia: míralos en la pestaña <strong>No realizados</strong>.` : ""}
      </div>`;
      return;
    }

    const r = d.resumen;
    destino.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card g"><div class="lbl">Servicios hechos</div><div class="val">${r.hechos}</div></div>
        <div class="kpi-card ${r.no_realizados ? "r" : ""}"><div class="lbl">No realizados</div><div class="val">${r.no_realizados}</div></div>
        <div class="kpi-card ${r.con_actividad ? "w" : "g"}"><div class="lbl">Con actividad</div><div class="val">${r.con_actividad}</div></div>
        <div class="kpi-card"><div class="lbl">Individuos contados</div><div class="val">${r.plagas_contadas}</div></div>
        <div class="kpi-card"><div class="lbl">Fotos subidas</div><div class="val">${r.fotos}</div></div>
      </div>
      ${r.tecnicos.length ? `<p class="text-muted">Trabajaron: ${esc(r.tecnicos.join(", "))}.</p>` : ""}
      ${d.por_tipo.map((t) => bloqueTipo(t, d.realizados)).join("")}
      <p class="text-muted" style="margin-top:14px">
        Toca cualquier servicio para ver el desglose completo: cada pregunta que el
        técnico verificó, las plagas contadas y sus fotos.
      </p>`;

    $$("#sv-cuerpo [data-insp]").forEach((el) =>
      el.addEventListener("click", () => abrirDesglose(el.dataset.insp))
    );
  }

  function bloqueTipo(t, servicios) {
    const delTipo = servicios.filter((s) => s.tipo_codigo === t.tipo_codigo);
    if (!delTipo.length) return "";
    return `
      <div class="card" style="margin-top:14px">
        <div class="card-head">
          <h2>${esc(t.tipo_nombre || "Otros servicios")}</h2>
          <span class="text-muted">
            ${t.hechos} hecho${t.hechos === 1 ? "" : "s"}${t.plagas ? ` · ${t.plagas} individuos` : ""}${t.fotos ? ` · ${t.fotos} fotos` : ""}
          </span>
        </div>
        <div class="grid-servicios">
          ${delTipo.map(tarjetaServicio).join("")}
        </div>
      </div>`;
  }

  if (opts.volver) $("#sv-volver").addEventListener("click", () => opts.volver());
  $("#sv-fecha").addEventListener("change", cargar);
  $("#sv-tipo").addEventListener("change", cargar);
  $("#sv-reporte").addEventListener("click", () => modalReporte(sitioId));
  await cargar();
}

function tarjetaServicio(s) {
  const titulo = s.numero_habitacion ? `Hab. ${s.numero_habitacion}` : s.codigo_visible;
  const clase = NIVEL_CLASE[s.nivel_actividad] || "hecho";
  return `
    <div class="serv-card ${clase}" data-insp="${s.inspeccion_id}"
         title="${esc([s.punto_nombre, s.area, s.planta].filter(Boolean).join(" · "))}">
      <div class="serv-cod">${esc(titulo)}</div>
      <div class="serv-area">${esc(s.area || "Sin área")}</div>
      <div class="serv-pie">
        <span>${esc(new Date(s.fecha).toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" }))}</span>
        ${s.plagas_total ? `<span class="chip">${s.plagas_total}</span>` : ""}
        ${s.fotos_total ? `<span class="chip">${s.fotos_total} 📷</span>` : ""}
      </div>
    </div>`;
}

// ── Pestaña: no realizados (en rojo) ─────────────────────────────────────
async function tabNoRealizados(cuerpo, sitioId) {
  cuerpo.innerHTML = `
    <div class="toolbar">
      <input type="date" id="nr-fecha" value="${hoyLocal()}" />
      <span class="text-muted">Lo que no se pudo hacer, y por qué.</span>
    </div>
    <div id="nr-cuerpo"><div class="center-msg">Cargando…</div></div>`;

  async function cargar() {
    const fecha = $("#nr-fecha").value || hoyLocal();
    const destino = $("#nr-cuerpo");
    destino.innerHTML = `<div class="center-msg">Cargando…</div>`;
    const d = await get(`/inspecciones/dia?sitio_id=${sitioId}&fecha=${fecha}`);

    const nada = !d.no_realizados.length && !d.pendientes.length;
    if (nada) {
      destino.innerHTML = `<div class="center-msg" style="color:var(--verde,#4A7D4D)">
        Todo lo programado para el ${fmtDate(fecha)} se ejecutó. Ningún acceso negado ni punto vencido.
      </div>`;
      return;
    }

    destino.innerHTML = `
      ${d.no_realizados.length ? `
        <div class="card card-rojo">
          <div class="card-head">
            <h2>Se intentó y no se pudo — ${d.no_realizados.length}</h2>
          </div>
          <p class="text-muted">
            El técnico se presentó y no pudo trabajar el punto. La columna
            <strong>responsable</strong> es la que decide si el pendiente es de ASA
            o del hotel: no es lo mismo que no autorizaran el acceso a que ASA no llegara.
          </p>
          ${tableHTML(
            [
              { key: "hora", label: "Hora", fmt: (n) => esc(new Date(n.fecha).toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" })) },
              { key: "punto", label: "Punto / habitación", fmt: (n) => `<strong>${esc(n.numero_habitacion ? `Hab. ${n.numero_habitacion}` : n.codigo_visible)}</strong>` },
              { key: "area", label: "Área", fmt: (n) => esc([n.area, n.nivel ? `Nivel ${n.nivel}` : null].filter(Boolean).join(" · ") || "—") },
              { key: "motivo", label: "Motivo", fmt: (n) => esc(MOTIVOS_TEXTO[n.motivo_no_realizado] || n.motivo_no_realizado || "Sin motivo") },
              { key: "impedido_por", label: "Informado por", fmt: (n) => esc(n.impedido_por || "—") },
              { key: "tecnico", label: "Técnico", fmt: (n) => esc(n.tecnico || "—") },
              {
                key: "resp", label: "Responsable",
                fmt: (n) => MOTIVOS_DEL_HOTEL.includes(n.motivo_no_realizado)
                  ? `<span class="estado-chip fuera">Hotel</span>`
                  : `<span class="estado-chip pendiente">ASA</span>`,
              },
            ],
            d.no_realizados.map((n) => ({ ...n, id: n.inspeccion_id })),
            "Ninguno."
          )}
        </div>` : ""}

      ${d.pendientes.length ? `
        <div class="card card-rojo" style="margin-top:14px">
          <div class="card-head"><h2>Vencidos sin registro — ${d.pendientes.length}</h2></div>
          <p class="text-muted">
            Puntos que ya pasaron su frecuencia y no tienen ningún registro este día:
            ni hecho, ni intentado. Estos sí son pendientes de ASA.
          </p>
          ${tableHTML(
            [
              { key: "codigo_visible", label: "Punto", fmt: (p) => `<strong>${esc(p.numero_habitacion ? `Hab. ${p.numero_habitacion}` : p.codigo_visible)}</strong>` },
              { key: "tipo_nombre", label: "Tipo", fmt: (p) => esc(p.tipo_nombre || "—") },
              { key: "area", label: "Área", fmt: (p) => esc(p.area || "—") },
              { key: "frecuencia", label: "Frecuencia", fmt: (p) => badge(p.frecuencia) },
              {
                key: "dias", label: "Sin revisar",
                fmt: (p) => p.dias_sin_revisar == null
                  ? `<span class="estado-chip pendiente">Nunca</span>`
                  : `<span class="estado-chip pendiente">${p.dias_sin_revisar} días</span>`,
              },
            ],
            d.pendientes.map((p) => ({ ...p, id: p.punto_id, _clickable: false })),
            "Ninguno."
          )}
        </div>` : ""}`;

    $$("#nr-cuerpo tr[data-id]").forEach((tr) => {
      const n = d.no_realizados.find((x) => x.inspeccion_id === tr.dataset.id);
      if (n) tr.addEventListener("click", () => abrirDesglose(n.inspeccion_id));
    });
  }

  $("#nr-fecha").addEventListener("change", cargar);
  await cargar();
}

// ═════════════════════════════════════════════════════════════════════════
// DESGLOSE DE UN SERVICIO
//
// Todo lo que se hizo en ese punto: dónde queda (área, nivel y planta), quién
// lo hizo, cada pregunta del checklist con la respuesta que dio el técnico,
// las plagas contadas y las fotos. Con botón de imprimir, que abre la misma
// ficha en una hoja limpia — las fotos incluidas.
// ═════════════════════════════════════════════════════════════════════════
async function abrirDesglose(inspeccionId) {
  const overlay = openModal({
    title: "Desglose del servicio",
    large: true,
    bodyHTML: `<div class="center-msg">Cargando…</div>`,
  });
  $(".modal-foot")?.remove();

  let d;
  try {
    // El catalogo de estados se pide junto con el desglose (y se guarda en
    // memoria), para que la ficha imprima el nombre que ASA configuro hoy.
    [d] = await Promise.all([get(`/inspecciones/${inspeccionId}/desglose`), cargarEstadosPunto()]);
  } catch (e) {
    $(".modal-body").innerHTML = `<div class="form-error" style="display:block">${esc(e.message)}</div>`;
    return;
  }

  $(".modal-head h3").textContent = `${d.punto.codigo} — ${d.punto.nombre || d.punto.tipo || ""}`;
  $(".modal-body").innerHTML = fichaServicioHTML(d) + `
    <div class="actions" style="margin-top:18px">
      <button class="btn" id="dg-imprimir">Imprimir / guardar en PDF</button>
    </div>`;

  $("#dg-imprimir").addEventListener("click", () => imprimirServicio(d));
}

function fichaServicioHTML(d) {
  const noHecho = !!d.motivo_no_realizado;
  const fotos = [...(d.fotos || []), ...(d.respuestas || []).flatMap((r) => r.fotos || [])];

  return `
    <div class="ficha-servicio">
      <div class="fs-cabecera ${noHecho ? "no-hecho" : ""}">
        <div>
          <div class="fs-titulo">${esc(d.punto.nombre || d.punto.codigo)}</div>
          <div class="fs-sub">${esc(d.punto.codigo)} · ${esc(d.punto.tipo || "")}</div>
        </div>
        <div class="fs-estado ${noHecho ? "rojo" : ""}">
          ${esc(noHecho ? "NO REALIZADO" : estadoTexto(d.estado_punto))}
          <small>${esc(noHecho ? "" : NIVEL_TEXTO[d.nivel_actividad] || "")}</small>
        </div>
      </div>

      <div class="fs-datos">
        ${[
          ["Planta", d.planta],
          ["Área", [d.area, d.nivel ? `Nivel ${d.nivel}` : null].filter(Boolean).join(" · ")],
          ["Ubicación", d.punto.ubicacion],
          ["Cliente", d.cliente],
          ["Técnico", d.tecnico],
          ["Fecha y hora", fmtDateTime(d.fecha)],
          ["Registrado por", d.metodo_acceso === "qr" ? "Escaneo de QR" : d.metodo_acceso],
          ["Frecuencia", d.punto.frecuencia],
        ].filter(([, v]) => v).map(([k, v]) => `<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join("")}
      </div>

      ${noHecho ? `
        <div class="fs-alerta">
          <strong>No se pudo realizar:</strong> ${esc(MOTIVOS_TEXTO[d.motivo_no_realizado] || d.motivo_no_realizado)}
          ${d.impedido_por ? `<br>Informado por: ${esc(d.impedido_por)}` : ""}
          <br>Responsable del pendiente:
          <strong>${MOTIVOS_DEL_HOTEL.includes(d.motivo_no_realizado) ? "el hotel" : "ASA"}</strong>
        </div>` : ""}

      ${d.respuestas?.length ? `
        <h4>Checklist verificado por el técnico</h4>
        <table class="data fs-tabla">
          <thead><tr><th style="width:52px">Visto</th><th>Pregunta</th><th>Respuesta</th></tr></thead>
          <tbody>
            ${d.respuestas.map((r) => `
              <tr>
                <td style="text-align:center;color:var(--verde,#4A7D4D);font-weight:700">✓</td>
                <td>${esc(r.pregunta_texto)}</td>
                <td><strong>${esc(valorRespuestaTexto(r))}</strong></td>
              </tr>`).join("")}
          </tbody>
        </table>` : noHecho ? "" : `
        <p class="text-muted">
          Este punto no tenía checklist asignado el día de la visita: solo se
          registró estado y nivel de actividad. Asígnale una estrategia con
          preguntas para que el técnico tenga qué verificar.
        </p>`}

      ${d.capturas?.length ? `
        <h4>Plagas encontradas</h4>
        <table class="data fs-tabla">
          <thead><tr><th>Plaga</th><th>Grupo</th><th style="text-align:right">Cantidad</th><th>Etapa</th><th></th></tr></thead>
          <tbody>
            ${d.capturas.map((c) => `
              <tr>
                <td><strong>${esc(c.plaga)}</strong></td>
                <td>${esc(c.grupo || "—")}</td>
                <td style="text-align:right">${c.cantidad}</td>
                <td>${esc(c.etapa || "—")}</td>
                <td>${c.sobre_umbral ? `<span class="estado-chip pendiente">Sobre el umbral</span>` : ""}</td>
              </tr>`).join("")}
          </tbody>
        </table>` : ""}

      ${d.hallazgos?.length ? `
        <h4>Hallazgos abiertos por este servicio</h4>
        <ul class="fs-hallazgos">
          ${d.hallazgos.map((h) => `
            <li>
              <strong>${esc(h.titulo)}</strong>
              <span class="chip">${esc(h.severidad)}</span>
              <span class="chip">${h.responsable === "cliente" ? "Hotel" : "ASA"}</span>
              <span class="chip">${esc(h.estado)}</span>
              ${h.descripcion ? `<div class="text-muted">${esc(h.descripcion)}</div>` : ""}
            </li>`).join("")}
        </ul>` : ""}

      ${d.notas ? `<h4>Observaciones del técnico</h4><p>${esc(d.notas)}</p>` : ""}

      ${fotos.length ? `
        <h4>Evidencia fotográfica — ${fotos.length}</h4>
        <div class="fs-fotos">
          ${fotos.map((f, i) => `
            <figure>
              <img src="${esc(f)}" alt="Evidencia ${i + 1}" loading="lazy" />
              <figcaption>${esc(d.punto.codigo)} · ${esc(d.area || "")}</figcaption>
            </figure>`).join("")}
        </div>` : ""}
    </div>`;
}

function valorRespuestaTexto(r) {
  if (r.valor_bool !== null && r.valor_bool !== undefined) return r.valor_bool ? "Sí" : "No";
  if (r.valor_numero !== null && r.valor_numero !== undefined) return String(r.valor_numero);
  if (Array.isArray(r.valor_opciones) && r.valor_opciones.length) return r.valor_opciones.join(", ");
  return r.valor_texto || "—";
}

// Imprimir el comprobante del servicio.
//
// Se imprime EN LA MISMA PÁGINA, con una capa que solo existe mientras dura la
// impresión. La versión anterior abría una ventana nueva y le escribía el HTML
// con document.write, y eso tumbaba el navegador por tres razones:
//
//   1. Volvía a serializar la ficha COMPLETA, y las fotos de las inspecciones
//      viejas están guardadas en base64 dentro del propio registro. Una foto de
//      celular en base64 son cientos de miles de caracteres; cinco fotos son
//      varios megabytes de texto metidos de un golpe con document.write. Ahí es
//      donde la pestaña se traba o se cae.
//   2. `ventana.onload` se enganchaba DESPUÉS de document.close(), cuando el
//      evento load ya había pasado, así que el diálogo de impresión muchas
//      veces no salía nunca.
//   3. Con el panel abierto como archivo local, `location.origin` vale "null" y
//      la hoja de estilos quedaba apuntando a "nullstyles.css": salía sin
//      formato.
//
// Imprimiendo en la misma página no se copia nada: las fotos ya están en el DOM
// y el navegador las reusa. Tampoco hay ventana emergente que un bloqueador
// pueda frenar.
async function imprimirServicio(d) {
  document.getElementById("area-impresion")?.remove();

  const capa = document.createElement("div");
  capa.id = "area-impresion";
  capa.innerHTML = `
    <div class="imp-encabezado">
      <div>
        <h1>${esc(CONFIG.NOMBRE_SISTEMA)}</h1>
        <p>Comprobante de servicio · Control integrado de plagas</p>
        <p>${esc(d.planta || "")}${d.cliente ? ` · ${esc(d.cliente)}` : ""}</p>
      </div>
      <p>Impreso el ${esc(new Date().toLocaleString("es-DO"))}</p>
    </div>
    ${fichaServicioHTML(d)}`;
  document.body.appendChild(capa);

  // Esperar a que las fotos estén listas: si no, Chrome dispara el diálogo
  // antes y salen los recuadros vacíos. Con tope de 8 segundos, porque una foto
  // que no carga no puede dejar al usuario sin imprimir el resto.
  const fotos = [...capa.querySelectorAll("img")];
  await Promise.race([
    Promise.all(fotos.map((img) => img.complete
      ? Promise.resolve()
      : new Promise((ok) => { img.onload = ok; img.onerror = ok; }))),
    new Promise((ok) => setTimeout(ok, 8000)),
  ]);

  const limpiar = () => {
    capa.remove();
    window.removeEventListener("afterprint", limpiar);
  };
  window.addEventListener("afterprint", limpiar);
  // Safari en iOS no dispara afterprint: una red de seguridad para que la capa
  // no se quede pegada encima del panel.
  setTimeout(limpiar, 60000);

  window.print();
}

// ═════════════════════════════════════════════════════════════════════════
// REPORTE DE EVIDENCIA (PDF)
// ═════════════════════════════════════════════════════════════════════════
function modalReporte(sitioIdPorDefecto) {
  const hace = (dias) => {
    const d = new Date();
    d.setDate(d.getDate() - dias);
    return d.toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
  };

  openModal({
    title: "Generar reporte de evidencia",
    large: true,
    bodyHTML: `
      <p class="text-muted">
        El PDF que se entrega en auditoría: qué se hizo, quién lo hizo, qué se
        encontró, con qué evidencia, y qué <strong>no</strong> se pudo hacer y por qué.
      </p>
      <div class="form-grid">
        <div class="form-group"><label>Planta</label>
          <select name="sitio_id" id="rep-sitio"><option value="">Cargando…</option></select>
        </div>
        <div class="form-group"><label>Agrupar el histograma</label>
          <select name="agrupar"><option value="dia">Por día</option><option value="semana">Por semana</option><option value="mes">Por mes</option></select>
        </div>
        <div class="form-group"><label>Desde</label><input type="date" name="desde" value="${hace(30)}" /></div>
        <div class="form-group"><label>Hasta</label><input type="date" name="hasta" value="${hoyLocal()}" /></div>
      </div>
      <label class="campo-check"><input type="checkbox" name="detalle" checked /> Incluir el detalle de cada servicio con sus preguntas</label>
      <label class="campo-check"><input type="checkbox" name="fotos" checked /> Incluir las fotos de los técnicos</label>
      <p class="text-muted" style="margin-top:10px">
        Con fotos y detalle el PDF pesa más y tarda: un mes de una planta grande
        puede tomar un minuto. Si solo necesitas los números, desmarca las dos.
      </p>`,
    submitLabel: "Generar PDF",
    onMount() {
      get("/sitios").then((ss) => {
        $("#rep-sitio").innerHTML =
          ss.map((s) => `<option value="${s.id}"${s.id === sitioIdPorDefecto ? " selected" : ""}>${esc(s.nombre)}</option>`).join("") +
          `<option value="">Todas las plantas</option>`;
      }).catch(() => { $("#rep-sitio").innerHTML = `<option value="">Todas las plantas</option>`; });
    },
    async onSubmit(fd) {
      const qs = new URLSearchParams();
      if (fd.get("sitio_id")) qs.set("sitio_id", fd.get("sitio_id"));
      qs.set("desde", fd.get("desde"));
      qs.set("hasta", fd.get("hasta"));
      qs.set("agrupar", fd.get("agrupar"));
      if (fd.get("detalle") !== "on") qs.set("detalle", "no");
      if (fd.get("fotos") !== "on") qs.set("fotos", "no");

      const btn = $("#asa-modal-submit");
      btn.textContent = "Generando… (puede tardar)";
      await descargarPdf(`/reportes/pdf?${qs}`, `reporte-asa-${fd.get("desde")}-a-${fd.get("hasta")}.pdf`);
      closeModal();
      toast("Reporte descargado");
    },
  });
}

// El PDF es binario, asi que no pasa por api() (que espera JSON). Se pide con
// fetch directo llevando el token en la cabecera.
async function descargarPdf(ruta, nombreArchivo) {
  const res = await fetch(`${CONFIG.API_BASE}${ruta}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) {
    let mensaje = `El servidor respondió ${res.status}`;
    try { mensaje = (await res.json()).mensaje || mensaje; } catch {}
    throw new Error(mensaje);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Pestaña: pendientes por área (verde / rojo) ──────────────────────────
//
// Antes era "Inspecciones de hoy" y solo pintaba habitaciones. Ahora se elige
// el tipo de punto (habitaciones, cebaderos, lámparas...) y se ve SOLO ese tipo,
// agrupado por área, con lo hecho en verde y lo que falta en rojo.
//
//   verde fuerte — hecho hoy          verde claro — al día (dentro de su frecuencia)
//   rojo         — por hacer (vencido) rojo punteado — se intentó hoy y no se pudo
const ESTADO_CELDA = {
  hecho_hoy: { clase: "hecho", texto: "Hecho hoy" },
  al_dia: { clase: "aldia", texto: "Al día" },
  no_realizado: { clase: "norealizado", texto: "No se pudo hoy" },
  por_hacer: { clase: "pendiente", texto: "Por hacer" },
};

async function tabPendientesArea(cuerpo, sitioId) {
  let tipoSel = null; // se decide con la primera respuesta
  let areaSel = "";
  let verSel = "";

  cuerpo.innerHTML = `
    <div class="toolbar">
      <select id="pa-tipo"></select>
      <select id="pa-area"><option value="">Todas las áreas</option></select>
      <select id="pa-ver">
        <option value="">Todo</option>
        <option value="rojo">Solo lo que falta (rojo)</option>
        <option value="verde">Solo lo hecho (verde)</option>
      </select>
      <span class="toolbar-sep"></span>
      <button class="btn btn-sm" id="pa-recargar">Actualizar</button>
    </div>
    <div id="pa-cuerpo"><div class="center-msg">Cargando…</div></div>`;

  async function cargar() {
    const destino = $("#pa-cuerpo");
    destino.innerHTML = `<div class="center-msg">Cargando…</div>`;

    const qs = new URLSearchParams({ sitio_id: sitioId });
    if (tipoSel) qs.set("tipo", tipoSel);
    let d = await get(`/puntos/estado?${qs}`);

    if (!d.tipos.length) {
      destino.innerHTML = `<div class="center-msg">Esta planta no tiene puntos de control cargados.</div>`;
      return;
    }
    // Primera carga: arranca en habitaciones si existen, si no en el tipo con más puntos.
    if (!tipoSel) {
      tipoSel = (d.tipos.find((t) => t.codigo === "habitacion") || d.tipos[0]).codigo;
      d = await get(`/puntos/estado?${new URLSearchParams({ sitio_id: sitioId, tipo: tipoSel })}`);
    }

    $("#pa-tipo").innerHTML = d.tipos
      .map((t) => `<option value="${esc(t.codigo)}"${t.codigo === tipoSel ? " selected" : ""}>${esc(t.icono || "")} ${esc(t.nombre)} (${t.total})</option>`)
      .join("");
    if (areaSel && !d.areas.some((a) => (a.id || "sin_area") === areaSel)) areaSel = "";
    $("#pa-area").innerHTML =
      `<option value="">Todas las áreas (${d.areas.length})</option>` +
      d.areas
        .map((a) => {
          const k = a.id || "sin_area";
          return `<option value="${esc(k)}"${k === areaSel ? " selected" : ""}>${esc(a.nombre)} — ${a.por_hacer ? `${a.por_hacer} por hacer` : "completa"}</option>`;
        })
        .join("");

    const r = d.resumen;
    const verdes = r.hechos_hoy + r.al_dia;
    const pct = r.total ? Math.round((verdes / r.total) * 100) : 0;
    const tipoNombre = d.tipos.find((t) => t.codigo === tipoSel)?.nombre || "puntos";

    const visibles = d.puntos.filter((p) => {
      if (areaSel && (p.area_id || "sin_area") !== areaSel) return false;
      const rojo = p.estado === "por_hacer" || p.estado === "no_realizado";
      if (verSel === "rojo" && !rojo) return false;
      if (verSel === "verde" && rojo) return false;
      return true;
    });

    const grupos = new Map();
    for (const p of visibles) {
      const k = p.area_id || "sin_area";
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(p);
    }
    const areasOrden = d.areas.filter((a) => grupos.has(a.id || "sin_area"));

    const titulo = (p) => (p.numero_habitacion ? p.numero_habitacion : p.codigo_visible);
    const ayuda = (p) =>
      [
        p.punto_nombre || p.codigo_visible,
        ESTADO_CELDA[p.estado].texto,
        p.frecuencia ? `Frecuencia: ${p.frecuencia}` : "",
        p.hora ? `Hoy ${new Date(p.hora).toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" })}${p.tecnico ? ` · ${p.tecnico}` : ""}` : "",
        p.motivo_no_realizado ? `Motivo: ${MOTIVOS_TEXTO[p.motivo_no_realizado] || p.motivo_no_realizado}` : "",
        !p.hora && p.ultima_inspeccion ? `Último servicio: ${fmtDate(p.ultima_inspeccion)}` : "",
        !p.ultima_inspeccion && !p.hora ? "Nunca se ha revisado" : "",
      ]
        .filter(Boolean)
        .join("\n");

    destino.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card g"><div class="lbl">Hechos hoy</div><div class="val">${r.hechos_hoy}</div></div>
        <div class="kpi-card g"><div class="lbl">Al día</div><div class="val">${r.al_dia}</div></div>
        <div class="kpi-card ${r.por_hacer ? "r" : ""}"><div class="lbl">Por hacer</div><div class="val">${r.por_hacer}</div></div>
        <div class="kpi-card ${r.no_realizados ? "r" : ""}"><div class="lbl">No se pudieron hoy</div><div class="val">${r.no_realizados}</div></div>
      </div>
      <div class="resumen-dia">
        <div><strong>${verdes}</strong> de <strong>${r.total}</strong> ${esc(tipoNombre.toLowerCase())} en verde (${pct}%)</div>
        <div class="barra"><span style="width:${pct}%"></span></div>
        <div class="leyenda">
          <span class="estado-chip hecho">Hecho hoy</span>
          <span class="estado-chip aldia">Al día</span>
          <span class="estado-chip pendiente">Por hacer</span>
          <span class="estado-chip norealizado">No se pudo hoy</span>
        </div>
      </div>
      ${
        areasOrden.length
          ? areasOrden
              .map((a) => {
                const ps = grupos.get(a.id || "sin_area");
                return `
            <div class="dia-bloque">
              <div class="dia-cabecera">
                ${esc(a.nombre)} —
                ${a.por_hacer ? `<span class="estado-chip pendiente">${a.por_hacer} por hacer</span>` : `<span class="estado-chip hecho">Completa</span>`}
                <span class="text-muted">${a.hechos} de ${a.total} en verde</span>
              </div>
              <div class="grid-habitaciones">
                ${ps
                  .map(
                    (p) => `<div class="hab ${ESTADO_CELDA[p.estado].clase}"
                              title="${esc(ayuda(p))}"
                              ${p.inspeccion_id ? `data-insp="${esc(p.inspeccion_id)}"` : ""}>
                              ${esc(titulo(p))}
                              ${p.estado === "hecho_hoy" && p.nivel_actividad && p.nivel_actividad !== "ninguna" ? `<small>${esc(p.nivel_actividad)}</small>` : ""}
                            </div>`
                  )
                  .join("")}
              </div>
            </div>`;
              })
              .join("")
          : `<div class="center-msg">${verSel === "rojo" ? "No falta nada con este filtro. ✅" : "No hay puntos con este filtro."}</div>`
      }
      <p class="text-muted" style="margin-top:14px">
        Pasa el cursor sobre un punto para ver su detalle. Los que tienen servicio
        hoy se abren con un clic.
      </p>`;

    $$("#pa-cuerpo [data-insp]").forEach((el) =>
      el.addEventListener("click", () => abrirDesglose(el.dataset.insp))
    );
  }

  $("#pa-tipo").addEventListener("change", (e) => {
    tipoSel = e.target.value;
    areaSel = "";
    cargar();
  });
  $("#pa-area").addEventListener("change", (e) => {
    areaSel = e.target.value;
    cargar();
  });
  $("#pa-ver").addEventListener("change", (e) => {
    verSel = e.target.value;
    cargar();
  });
  $("#pa-recargar").addEventListener("click", cargar);
  await cargar();
}

// ── Pestaña: días anteriores ─────────────────────────────────────────────
//
// Un renglón por día con TODO lo que se hizo (no solo habitaciones). Al tocar
// un día se abre el día completo — la misma vista de "Servicios de hoy" con esa
// fecha — y ahí cada servicio abre su desglose: preguntas, plagas y fotos.
async function tabDiasAnteriores(cuerpo, sitioId, dias = 30) {
  cuerpo.innerHTML = `
    <div class="toolbar">
      <select id="da-rango">
        ${[7, 30, 90, 180].map((n) => `<option value="${n}"${n === dias ? " selected" : ""}>Últimos ${n} días</option>`).join("")}
      </select>
      <span class="text-muted">Toca un día para ver todo lo que se hizo.</span>
    </div>
    <div id="da-cuerpo"><div class="center-msg">Cargando…</div></div>`;

  $("#da-rango").addEventListener("change", (e) => tabDiasAnteriores(cuerpo, sitioId, Number(e.target.value)));

  const r = await get(`/inspecciones/dias?sitio_id=${sitioId}&dias=${dias}`);
  const destino = $("#da-cuerpo");
  if (!r.dias.length) {
    destino.innerHTML = `<div class="center-msg">No hay servicios registrados en los últimos ${dias} días.</div>`;
    return;
  }

  const nombreDia = (f) =>
    new Date(`${f}T12:00:00`).toLocaleDateString("es-DO", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  destino.innerHTML = `
    <div class="lista-dias">
      ${r.dias
        .map(
          (d) => `
        <div class="dia-fila" data-fecha="${esc(d.fecha)}">
          <div class="dia-fecha">${esc(nombreDia(d.fecha))}</div>
          <div class="dia-datos">
            <span class="estado-chip hecho">${d.hechos} hecho${d.hechos === 1 ? "" : "s"}</span>
            ${d.no_realizados ? `<span class="estado-chip pendiente">${d.no_realizados} no realizado${d.no_realizados === 1 ? "" : "s"}</span>` : ""}
            ${d.con_actividad ? `<span class="estado-chip fuera">${d.con_actividad} con actividad</span>` : ""}
            ${d.tipos.map((t) => `<span class="chip">${esc(t.icono || "")} ${esc(t.nombre)}: ${t.hechos}</span>`).join("")}
          </div>
          ${d.tecnicos.length ? `<div class="text-muted">${esc(d.tecnicos.join(", "))}</div>` : ""}
          <div class="dia-flecha">›</div>
        </div>`
        )
        .join("")}
    </div>`;

  $$("#da-cuerpo .dia-fila").forEach((el) =>
    el.addEventListener("click", () =>
      tabServiciosHoy(cuerpo, sitioId, {
        fecha: el.dataset.fecha,
        volver: () => tabDiasAnteriores(cuerpo, sitioId, dias),
      })
    )
  );
}
