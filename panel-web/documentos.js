// ═════════════════════════════════════════════════════════════════════════
// documentos.js — Documentos regulatorios y productos, en el panel
//
// Aquí la oficina adjunta lo que el hotel pide en cada auditoría y el portal
// se lo muestra solo (pestaña "Documentos"):
//
//   · Permisos y documentos: licencia ambiental, licencia sanitaria, no
//     objeción de Salud Pública, registro de Agricultura, regencia, manual de
//     operaciones, protocolo de trabajo, listado de productos…
//   · Productos: el listado de lo que se aplica, cada uno con su ficha
//     técnica y su hoja de seguridad.
//
// Cada documento puede tener vencimiento: el panel avisa cuando falta un mes
// y el hotel ve si está vigente. Se carga antes de app.js y aporta
// MODULOS_EXTRA_5.
// ═════════════════════════════════════════════════════════════════════════

const MODULOS_EXTRA_5 = [
  { key: "documentos", label: "Documentos", ic: "📁", seccion: "catalogos", roles: ["admin", "operaciones", "comercial"], view: viewDocumentos },
];

const DOC_CATEGORIAS = [
  ["licencia_ambiental",   "Licencia ambiental"],
  ["licencia_sanitaria",   "Licencia sanitaria"],
  ["no_objecion_salud",    "No objeción de Salud Pública"],
  ["registro_agricultura", "Registro de Agricultura"],
  ["regencia",             "Regencia"],
  ["manual_operaciones",   "Manual de operaciones"],
  ["protocolo_trabajo",    "Protocolo de trabajo"],
  ["listado_productos",    "Listado de productos"],
  ["ficha_tecnica",        "Ficha técnica"],
  ["hoja_seguridad",       "Hoja de seguridad (SDS)"],
  ["otro",                 "Otro documento"],
];
const DOC_CAT_TXT = Object.fromEntries(DOC_CATEGORIAS);
// Lo que no puede faltar en la carpeta del hotel. El listado de productos se
// cumple también con el catálogo de la pestaña Productos.
const DOC_OBLIGATORIOS = [
  "licencia_ambiental", "licencia_sanitaria", "no_objecion_salud", "registro_agricultura",
  "regencia", "manual_operaciones", "protocolo_trabajo",
];
// Categorías que se cuelgan de un producto.
const DOC_DE_PRODUCTO = ["ficha_tecnica", "hoja_seguridad", "registro_agricultura"];
const DOC_VIGENCIA = {
  vigente: ["Vigente", "badge-green"],
  por_vencer: ["Por vencer", "badge-warn"],
  vencido: ["Vencido", "badge-red"],
  sin_vencimiento: ["Sin vencimiento", "badge-gray"],
};
const DOC_MAX_MB = 15;

let DOC_TAB = "documentos";
let DOC_FILTRO = "";

async function viewDocumentos(content) {
  content.innerHTML = `
    <div class="tabs" id="tabs-doc">
      <button class="tab${DOC_TAB === "documentos" ? " active" : ""}" data-tab="documentos">Permisos y documentos</button>
      <button class="tab${DOC_TAB === "productos" ? " active" : ""}" data-tab="productos">Productos que utilizamos</button>
    </div>
    <div id="doc-cuerpo"><div class="center-msg">Cargando…</div></div>`;
  $$("#tabs-doc .tab").forEach((b) => b.addEventListener("click", () => {
    DOC_TAB = b.dataset.tab;
    $$("#tabs-doc .tab").forEach((x) => x.classList.toggle("active", x === b));
    pintarDocTab();
  }));
  await pintarDocTab();
}

async function pintarDocTab() {
  const cuerpo = $("#doc-cuerpo");
  cuerpo.innerHTML = `<div class="center-msg">Cargando…</div>`;
  try {
    if (DOC_TAB === "productos") await docVistaProductos(cuerpo);
    else await docVistaDocumentos(cuerpo);
  } catch (e) {
    cuerpo.innerHTML = `<div class="card"><div class="form-error" style="display:block">${esc(e.message)}</div></div>`;
  }
}

// ── Ayudantes ────────────────────────────────────────────────────────────
function docBadgeVigencia(d) {
  const [t, cls] = DOC_VIGENCIA[d.vigencia] || DOC_VIGENCIA.sin_vencimiento;
  return `<span class="badge ${cls}">${t}</span>`;
}
function docPeso(b) {
  if (!b) return "";
  return b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
}
function leerArchivoComoDataUrl(archivo) {
  return new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => mal(new Error("No se pudo leer el archivo."));
    r.readAsDataURL(archivo);
  });
}
// La ventana se abre ANTES de pedir el enlace: si se abre después del await,
// el navegador la toma como ventana emergente y la bloquea.
async function docAbrir(id, descargar = false) {
  const ventana = window.open("", "_blank");
  try {
    const r = await get(`/documentos/${id}/archivo${descargar ? "?descargar=1" : ""}`);
    if (ventana) ventana.location.href = r.url;
    else window.location.href = r.url;
  } catch (e) {
    if (ventana) ventana.close();
    toast(e.message, true);
  }
}

// ── Permisos y documentos ────────────────────────────────────────────────
async function docVistaDocumentos(cuerpo) {
  const editar = puedeEditar("documentos");
  const [docs, productos] = await Promise.all([get("/documentos"), get("/documentos/productos").catch(() => [])]);

  // Semáforo de la carpeta: qué tiene el hotel a mano y qué falta.
  const generales = docs.filter((d) => !d.cliente_id);
  const semaforo = DOC_OBLIGATORIOS.map((cat) => {
    const deCat = generales.filter((d) => d.categoria === cat && d.visible_cliente);
    let estado = "falta";
    if (deCat.some((d) => d.vigencia === "vigente" || d.vigencia === "sin_vencimiento")) estado = "ok";
    else if (deCat.some((d) => d.vigencia === "por_vencer")) estado = "por_vencer";
    else if (deCat.length) estado = "vencido";
    return { cat, estado };
  });
  semaforo.push({
    cat: "listado_productos",
    estado: productos.length || generales.some((d) => d.categoria === "listado_productos") ? "ok" : "falta",
  });
  const sinFicha = productos.filter((p) => !p.documentos.some((d) => d.categoria === "ficha_tecnica")).length;
  const TXT_SEM = { ok: ["✓", "hecho"], por_vencer: ["⚠ por vencer", "fuera"], vencido: ["✗ vencido", "pendiente"], falta: ["✗ falta", "pendiente"] };

  const filtrados = DOC_FILTRO ? docs.filter((d) => d.categoria === DOC_FILTRO) : docs;

  cuerpo.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Carpeta del hotel</h2>
        <span class="text-muted">Lo que el personal de calidad ve en su portal, pestaña "Documentos".</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${semaforo.map((s) => `<span class="estado-chip ${TXT_SEM[s.estado][1]}">${esc(DOC_CAT_TXT[s.cat])} · ${TXT_SEM[s.estado][0]}</span>`).join("")}
        ${productos.length ? `<span class="estado-chip ${sinFicha ? "pendiente" : "hecho"}">Fichas técnicas · ${sinFicha ? `✗ faltan ${sinFicha}` : "✓"}</span>` : ""}
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Documentos</h2>
        <div class="actions">${editar ? `<button class="btn btn-primary" id="doc-nuevo">+ Adjuntar documento</button>` : ""}</div>
      </div>
      <div class="toolbar">
        <select id="doc-filtro">
          <option value="">Todas las categorías</option>
          ${DOC_CATEGORIAS.map(([k, t]) => `<option value="${k}"${k === DOC_FILTRO ? " selected" : ""}>${esc(t)}</option>`).join("")}
        </select>
        <span class="text-muted">${filtrados.length} documento${filtrados.length === 1 ? "" : "s"}</span>
      </div>
      <div id="doc-tabla"></div>
    </div>`;

  $("#doc-tabla").innerHTML = tableHTML(
    [
      { key: "categoria", label: "Tipo", fmt: (d) => esc(d.categoria_texto) },
      { key: "titulo", label: "Documento", fmt: (d) => `<strong>${esc(d.titulo)}</strong>` +
          (d.producto_nombre ? `<br><small class="muted">Producto: ${esc(d.producto_nombre)}</small>` : "") +
          (d.archivo_nombre ? `<br><small class="muted">📎 ${esc(d.archivo_nombre)} · ${docPeso(d.archivo_bytes)}</small>` : "") },
      { key: "numero", label: "Número", fmt: (d) => esc(d.numero || "—") + (d.emitido_por ? `<br><small class="muted">${esc(d.emitido_por)}</small>` : "") },
      { key: "fecha_vencimiento", label: "Vence", fmt: (d) => `${d.fecha_vencimiento ? fmtDate(d.fecha_vencimiento + "T12:00:00") + "<br>" : ""}${docBadgeVigencia(d)}` },
      { key: "visible_cliente", label: "Lo ve", fmt: (d) => !d.visible_cliente ? `<span class="badge badge-gray">Solo ASA</span>`
          : d.cliente_nombre ? `<span class="badge badge-cyan">${esc(d.cliente_nombre)}</span>` : `<span class="badge badge-green">Todos los hoteles</span>` },
      { key: "acc", label: "", fmt: (d) => `
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
            <button class="btn btn-sm" data-ver="${d.id}">Ver</button>
            ${editar ? `<button class="btn btn-sm" data-editar="${d.id}">Editar</button>
                        <button class="btn btn-sm btn-danger" data-quitar="${d.id}">Retirar</button>` : ""}
          </div>` },
    ],
    filtrados.map((d) => ({ ...d, _clickable: false })),
    "Todavía no hay documentos. Usa “+ Adjuntar documento” para subir el primero."
  );

  $("#doc-filtro").addEventListener("change", (e) => { DOC_FILTRO = e.target.value; pintarDocTab(); });
  $("#doc-nuevo")?.addEventListener("click", () => formDocumento(null, { productos }));
  $$("[data-ver]").forEach((b) => b.addEventListener("click", () => docAbrir(b.dataset.ver)));
  $$("[data-editar]").forEach((b) => b.addEventListener("click", () =>
    formDocumento(docs.find((d) => d.id === b.dataset.editar), { productos })));
  $$("[data-quitar]").forEach((b) => b.addEventListener("click", async () => {
    const d = docs.find((x) => x.id === b.dataset.quitar);
    if (!confirm(`¿Retirar "${d.titulo}"? El hotel dejará de verlo en su portal.`)) return;
    try {
      await api(`/documentos/${d.id}`, { method: "DELETE" });
      toast("Documento retirado");
      pintarDocTab();
    } catch (e) { toast(e.message, true); }
  }));
}

// ── Formulario de documento (nuevo / editar / reemplazar archivo) ───────
async function formDocumento(doc, { productos = [], categoria = null, productoId = null, soloPdf = false } = {}) {
  const clientes = await getClientesCache().catch(() => []);
  const cat = doc?.categoria || categoria || "licencia_ambiental";
  const prodSel = doc?.producto_id || productoId || "";

  openModal({
    title: doc ? "Editar documento" : "Adjuntar documento",
    large: true,
    submitLabel: doc ? "Guardar cambios" : "Subir documento",
    bodyHTML: `
      <div class="form-grid">
        <div class="form-group"><label>Tipo de documento *</label>
          <select name="categoria" id="fd-cat" required>
            ${DOC_CATEGORIAS.map(([k, t]) => `<option value="${k}"${k === cat ? " selected" : ""}>${esc(t)}</option>`).join("")}
          </select>
        </div>
        <div class="form-group"><label>Título *</label>
          <input name="titulo" id="fd-titulo" required value="${esc(doc?.titulo || "")}" placeholder="Ej. Licencia sanitaria 2026" />
        </div>
        <div class="form-group" id="fd-caja-prod"><label>Producto</label>
          <select name="producto_id" id="fd-prod">
            <option value="">— No es de un producto —</option>
            ${productos.map((p) => `<option value="${p.id}"${p.id === prodSel ? " selected" : ""}>${esc(p.nombre_comercial)}</option>`).join("")}
          </select>
          <div class="form-hint">Las fichas técnicas y hojas de seguridad salen junto al producto en el portal.</div>
        </div>
        <div class="form-group"><label>¿Qué cliente lo ve?</label>
          <select name="cliente_id">
            <option value="">Todos los clientes</option>
            ${clientes.map((c) => `<option value="${c.id}"${c.id === doc?.cliente_id ? " selected" : ""}>${esc(clienteLabel(c))}</option>`).join("")}
          </select>
        </div>
        <div class="form-group"><label>Número / resolución</label><input name="numero" value="${esc(doc?.numero || "")}" /></div>
        <div class="form-group"><label>Emitido por</label><input name="emitido_por" value="${esc(doc?.emitido_por || "")}" placeholder="Ej. Ministerio de Salud Pública" /></div>
        <div class="form-group"><label>Fecha de emisión</label><input type="date" name="fecha_emision" value="${esc(doc?.fecha_emision || "")}" /></div>
        <div class="form-group"><label>Fecha de vencimiento</label><input type="date" name="fecha_vencimiento" value="${esc(doc?.fecha_vencimiento || "")}" />
          <div class="form-hint">Déjala vacía si no vence (manuales, protocolos).</div></div>
        <div class="form-group"><label>Versión</label><input name="version" value="${esc(doc?.version || "")}" placeholder="Ej. Rev. 3" /></div>
      </div>
      <div class="form-group"><label>Descripción (opcional)</label>
        <textarea name="descripcion" rows="2">${esc(doc?.descripcion || "")}</textarea></div>
      <div class="form-group">
        <label>${doc ? "Reemplazar archivo (opcional)" : "Archivo *"}</label>
        <input type="file" name="archivo" id="fd-archivo"
               accept="${soloPdf ? ".pdf,application/pdf" : ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,application/pdf,image/*"}" ${doc ? "" : "required"} />
        <div class="form-hint">${soloPdf ? "Archivo PDF" : "PDF, imagen, Word o Excel"} · hasta ${DOC_MAX_MB} MB.
          ${doc?.archivo_nombre ? `Actual: <strong>${esc(doc.archivo_nombre)}</strong>.` : ""}</div>
      </div>
      <label class="campo-check"><input type="checkbox" name="visible_cliente" ${doc?.visible_cliente === false ? "" : "checked"} />
        Visible para el hotel en su portal</label>`,
    onMount: () => {
      const sync = () => {
        const esProd = DOC_DE_PRODUCTO.includes($("#fd-cat").value);
        $("#fd-caja-prod").style.display = esProd || $("#fd-prod").value ? "" : "none";
      };
      $("#fd-cat").addEventListener("change", () => {
        sync();
        // Sugerir título si todavía está vacío.
        const t = $("#fd-titulo");
        if (!t.value.trim()) {
          const p = productos.find((x) => x.id === $("#fd-prod").value);
          t.value = DOC_CAT_TXT[$("#fd-cat").value] + (p ? ` — ${p.nombre_comercial}` : "");
        }
      });
      $("#fd-prod").addEventListener("change", sync);
      sync();
      if (!doc && !$("#fd-titulo").value) {
        const p = productos.find((x) => x.id === prodSel);
        $("#fd-titulo").value = categoria ? DOC_CAT_TXT[cat] + (p ? ` — ${p.nombre_comercial}` : "") : "";
      }
    },
    onSubmit: async (fd) => {
      const cuerpo = {
        categoria: fd.get("categoria"),
        titulo: fd.get("titulo"),
        producto_id: fd.get("producto_id") || null,
        cliente_id: fd.get("cliente_id") || null,
        numero: fd.get("numero"),
        emitido_por: fd.get("emitido_por"),
        fecha_emision: fd.get("fecha_emision"),
        fecha_vencimiento: fd.get("fecha_vencimiento"),
        version: fd.get("version"),
        descripcion: fd.get("descripcion"),
        visible_cliente: fd.get("visible_cliente") === "on",
      };
      const archivo = $("#fd-archivo").files[0];
      if (archivo) {
        if (archivo.size > DOC_MAX_MB * 1024 * 1024) throw new Error(`El archivo pesa más de ${DOC_MAX_MB} MB.`);
        if (soloPdf && !/\.pdf$/i.test(archivo.name) && archivo.type !== "application/pdf") throw new Error("Aquí solo se aceptan archivos PDF.");
        $("#asa-modal-submit").textContent = "Subiendo…";
        cuerpo.archivo = { nombre: archivo.name, dataUrl: await leerArchivoComoDataUrl(archivo) };
      } else if (!doc) {
        throw new Error("Falta escoger el archivo.");
      }
      if (doc) await put(`/documentos/${doc.id}`, cuerpo);
      else await post("/documentos", cuerpo);
      closeModal();
      toast(doc ? "Documento actualizado" : "Documento subido ✓");
      pintarDocTab();
    },
  });
}

// ── Productos que utilizamos ─────────────────────────────────────────────
async function docVistaProductos(cuerpo) {
  const editar = puedeEditar("documentos");
  const [productos, listados] = await Promise.all([
    get("/documentos/productos"),
    get("/documentos?categoria=listado_productos").catch(() => []),
  ]);

  const chipsDocs = (p) => p.documentos.length
    ? p.documentos.map((d) => `<button class="btn btn-sm" data-ver="${d.id}" title="${esc(d.titulo)}">📄 ${esc(d.categoria_texto)}</button>`).join(" ")
    : `<span class="muted">Sin documentos</span>`;

  cuerpo.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Listado de productos en PDF</h2>
        <div class="actions">${editar ? `<button class="btn btn-primary" id="prod-subir-pdf">📄 Cargar PDF</button>` : ""}</div>
      </div>
      <p class="text-muted" style="margin-top:0">
        Si ya tienes el listado de productos (o cualquier documento con esa información) en PDF,
        súbelo aquí. El hotel lo ve y lo descarga desde su portal, junto al catálogo de abajo.
      </p>
      <div id="prod-listados"></div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Productos que utilizamos</h2>
        <div class="actions">${editar ? `<button class="btn btn-primary" id="prod-nuevo">+ Nuevo producto</button>` : ""}</div>
      </div>
      <p class="text-muted" style="margin-top:0">
        El hotel ve este listado en su portal con la ficha técnica y la hoja de seguridad de cada producto.
        Los productos marcados "Solo ASA" no se le muestran.
      </p>
      <div id="prod-tabla"></div>
    </div>`;

  $("#prod-tabla").innerHTML = tableHTML(
    [
      { key: "nombre_comercial", label: "Producto", fmt: (p) => `<strong>${esc(p.nombre_comercial)}</strong>` +
          (p.fabricante ? `<br><small class="muted">${esc(p.fabricante)}</small>` : "") +
          (p.visible_cliente === false ? ` <span class="badge badge-gray">Solo ASA</span>` : "") },
      { key: "principio_activo", label: "Ingrediente activo", fmt: (p) => esc(p.principio_activo || "—") +
          (p.presentacion ? `<br><small class="muted">${esc(p.presentacion)}</small>` : "") },
      { key: "registro_agricultura", label: "Registros", fmt: (p) =>
          `${p.registro_agricultura ? `Agricultura: ${esc(p.registro_agricultura)}` : ""}` +
          `${p.registro_sanitario ? `<br>Salud: ${esc(p.registro_sanitario)}` : ""}` +
          `${p.categoria_toxicologica ? `<br><small class="muted">Cat. tox. ${esc(p.categoria_toxicologica)}</small>` : ""}` || "—" },
      { key: "uso", label: "Uso", fmt: (p) => esc(p.uso || "—") },
      { key: "docs", label: "Documentos", fmt: chipsDocs },
      { key: "acc", label: "", fmt: (p) => editar ? `
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
            <button class="btn btn-sm btn-primary" data-adj="${p.id}" data-cat="ficha_tecnica">+ Ficha técnica</button>
            <button class="btn btn-sm" data-adj="${p.id}" data-cat="hoja_seguridad">+ Hoja de seguridad</button>
            <button class="btn btn-sm" data-editar="${p.id}">Editar</button>
          </div>` : "" },
    ],
    productos.map((p) => ({ ...p, _clickable: false })),
    "No hay productos cargados. Agrega los que ASA aplica en los hoteles."
  );

  $("#prod-listados").innerHTML = tableHTML(
    [
      { key: "titulo", label: "Documento", fmt: (d) => `<strong>${esc(d.titulo)}</strong>` +
          (d.archivo_nombre ? `<br><small class="muted">📎 ${esc(d.archivo_nombre)} · ${docPeso(d.archivo_bytes)}</small>` : "") },
      { key: "version", label: "Versión", fmt: (d) => esc(d.version || "—") },
      { key: "fecha_emision", label: "Fecha", fmt: (d) => (d.fecha_emision ? fmtDate(d.fecha_emision + "T12:00:00") : "—") },
      { key: "visible_cliente", label: "Lo ve", fmt: (d) => !d.visible_cliente ? `<span class="badge badge-gray">Solo ASA</span>`
          : d.cliente_nombre ? `<span class="badge badge-cyan">${esc(d.cliente_nombre)}</span>` : `<span class="badge badge-green">Todos los hoteles</span>` },
      { key: "acc", label: "", fmt: (d) => `
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
            <button class="btn btn-sm" data-ver="${d.id}">Ver</button>
            <button class="btn btn-sm" data-bajar="${d.id}">Descargar</button>
            ${editar ? `<button class="btn btn-sm" data-editar-listado="${d.id}">Reemplazar</button>
                        <button class="btn btn-sm btn-danger" data-quitar-listado="${d.id}">Retirar</button>` : ""}
          </div>` },
    ],
    listados.map((d) => ({ ...d, _clickable: false })),
    "Todavía no hay un listado en PDF. Usa “📄 Cargar PDF” para subirlo."
  );

  $("#prod-subir-pdf")?.addEventListener("click", () =>
    formDocumento(null, { productos, categoria: "listado_productos", soloPdf: true }));
  $$("[data-bajar]").forEach((b) => b.addEventListener("click", () => docAbrir(b.dataset.bajar, true)));
  $$("[data-editar-listado]").forEach((b) => b.addEventListener("click", () =>
    formDocumento(listados.find((d) => d.id === b.dataset.editarListado), { productos, soloPdf: true })));
  $$("[data-quitar-listado]").forEach((b) => b.addEventListener("click", async () => {
    const d = listados.find((x) => x.id === b.dataset.quitarListado);
    if (!confirm(`¿Retirar "${d.titulo}"? El hotel dejará de verlo en su portal.`)) return;
    try {
      await api(`/documentos/${d.id}`, { method: "DELETE" });
      toast("Documento retirado");
      pintarDocTab();
    } catch (e) { toast(e.message, true); }
  }));

  $("#prod-nuevo")?.addEventListener("click", () => formProducto(null));
  $$("[data-ver]").forEach((b) => b.addEventListener("click", () => docAbrir(b.dataset.ver)));
  $$("[data-editar]").forEach((b) => b.addEventListener("click", () => formProducto(productos.find((p) => p.id === b.dataset.editar))));
  $$("[data-adj]").forEach((b) => b.addEventListener("click", () =>
    formDocumento(null, { productos, categoria: b.dataset.cat, productoId: b.dataset.adj })));
}

function formProducto(p) {
  openModal({
    title: p ? `Editar ${p.nombre_comercial}` : "Nuevo producto",
    large: true,
    bodyHTML: `
      <div class="form-grid">
        <div class="form-group"><label>Nombre comercial *</label><input name="nombre_comercial" required value="${esc(p?.nombre_comercial || "")}" /></div>
        <div class="form-group"><label>Ingrediente activo</label><input name="principio_activo" value="${esc(p?.principio_activo || "")}" placeholder="Ej. Cipermetrina 25%" /></div>
        <div class="form-group"><label>Fabricante</label><input name="fabricante" value="${esc(p?.fabricante || "")}" /></div>
        <div class="form-group"><label>Presentación</label><input name="presentacion" value="${esc(p?.presentacion || "")}" placeholder="Ej. Concentrado emulsionable, gel, bloque" /></div>
        <div class="form-group"><label>Registro de Agricultura</label><input name="registro_agricultura" value="${esc(p?.registro_agricultura || "")}" /></div>
        <div class="form-group"><label>Registro sanitario</label><input name="registro_sanitario" value="${esc(p?.registro_sanitario || "")}" /></div>
        <div class="form-group"><label>Categoría toxicológica</label>
          <select name="categoria_toxicologica">
            <option value="">—</option>
            ${["I", "II", "III", "IV"].map((c) => `<option${c === p?.categoria_toxicologica ? " selected" : ""}>${c}</option>`).join("")}
          </select></div>
        <div class="form-group"><label>Uso / plagas objetivo</label><input name="uso" value="${esc(p?.uso || "")}" placeholder="Ej. Cucarachas y hormigas en cocinas" /></div>
      </div>
      <div class="form-group"><label>Notas internas</label><textarea name="notas" rows="2">${esc(p?.notas || "")}</textarea></div>
      ${p ? "" : `
      <div class="form-group"><label>Ficha técnica en PDF (opcional)</label>
        <input type="file" id="fp-ficha" accept=".pdf,application/pdf" />
        <div class="form-hint">Si ya la tienes, súbela de una vez. También puedes agregarla después con “+ Ficha técnica”.</div>
      </div>`}
      <label class="campo-check"><input type="checkbox" name="visible_cliente" ${p?.visible_cliente === false ? "" : "checked"} /> Mostrar en el portal del hotel</label>
      ${p ? `<label class="campo-check"><input type="checkbox" name="activo" checked /> Activo (desmarca para darlo de baja)</label>` : ""}`,
    onSubmit: async (fd) => {
      const cuerpo = Object.fromEntries(
        ["nombre_comercial", "principio_activo", "fabricante", "presentacion", "registro_agricultura",
         "registro_sanitario", "categoria_toxicologica", "uso", "notas"].map((k) => [k, fd.get(k)])
      );
      cuerpo.visible_cliente = fd.get("visible_cliente") === "on";
      if (p) {
        cuerpo.activo = fd.get("activo") === "on";
        await put(`/documentos/productos/${p.id}`, cuerpo);
      } else {
        const ficha = $("#fp-ficha")?.files?.[0];
        if (ficha) {
          if (ficha.size > DOC_MAX_MB * 1024 * 1024) throw new Error(`La ficha técnica pesa más de ${DOC_MAX_MB} MB.`);
          if (!/\.pdf$/i.test(ficha.name) && ficha.type !== "application/pdf") throw new Error("La ficha técnica debe ser un PDF.");
        }
        const creado = await post("/documentos/productos", cuerpo);
        if (ficha && creado?.id) {
          $("#asa-modal-submit").textContent = "Subiendo ficha…";
          try {
            await post("/documentos", {
              categoria: "ficha_tecnica",
              titulo: `Ficha técnica — ${creado.nombre_comercial}`,
              producto_id: creado.id,
              visible_cliente: cuerpo.visible_cliente,
              archivo: { nombre: ficha.name, dataUrl: await leerArchivoComoDataUrl(ficha) },
            });
          } catch (e) {
            closeModal();
            toast(`Producto agregado, pero la ficha no se subió: ${e.message}`, true);
            return pintarDocTab();
          }
        }
      }
      closeModal();
      toast(p ? "Producto actualizado" : "Producto agregado");
      pintarDocTab();
    },
  });
}
