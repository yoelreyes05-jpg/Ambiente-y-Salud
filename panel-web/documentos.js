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
// Para qué plagas es cada producto: así se ordenan en el portal del hotel.
const GRUPOS_PLAGA_DOC = [["rastreros", "Insectos rastreros"], ["voladores", "Insectos voladores"], ["roedores", "Roedores"]];
// Lo que se escoge en la tabla de productos. "" = que lo deduzca el sistema.
const GRUPO_OPCIONES_DOC = [
  ["", "Automático"],
  ["rastreros", "Insectos rastreros"],
  ["voladores", "Insectos voladores"],
  ["rastreros,voladores", "Rastreros y voladores"],
  ["roedores", "Roedores"],
  ["otros", "Otros productos"],
];
const textoGrupos = (gs) => (gs || []).length
  ? gs.map((g) => (GRUPOS_PLAGA_DOC.find(([k]) => k === g) || [, g])[1]).join(" y ")
  : "otros productos";

// De qué tipo y de qué producto es un archivo, por su nombre:
// "FICHA_TECNICA_FENDONA.pdf" → ficha técnica de Fendona. La misma regla usa
// el servidor (backend/lib/productoDeArchivo.js), que además crea el producto
// si no estaba en el catálogo.
const normDoc = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function categoriaDeArchivoDoc(nombre) {
  const t = normDoc(nombre).replace(/[_\-.]+/g, " ");
  if (/\b(hoja\s*(de\s*)?(datos\s*(de\s*)?)?seguridad|m?sds|fds|hds)\b/.test(t)) return "hoja_seguridad";
  if (/\bficha\s*tecnica\b|\bficha\b|\btds\b/.test(t)) return "ficha_tecnica";
  if (/listado\s*(de\s*)?productos/.test(t)) return "listado_productos";
  if (/licencia\s*ambiental|medio\s*ambiente/.test(t)) return "licencia_ambiental";
  if (/licencia\s*sanitaria/.test(t)) return "licencia_sanitaria";
  if (/no\s*objecion/.test(t)) return "no_objecion_salud";
  if (/registro\s*(de\s*)?agricultura|agricultura/.test(t)) return "registro_agricultura";
  if (/regencia|regente/.test(t)) return "regencia";
  if (/manual/.test(t)) return "manual_operaciones";
  if (/protocolo/.test(t)) return "protocolo_trabajo";
  return null;
}
function productoDeArchivoDoc(nombre) {
  let t = String(nombre || "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/_+/g, " ");
  t = t.replace(/(hoja\s*(de\s*)?(datos\s*(de\s*)?)?seguridad|ficha\s*t[eé]cnica|\bficha\b|\bm?sds\b|\bfds\b|\bhds\b|\btds\b|\bversi[oó]n\b\s*\d*|\brev\.?\s*\d+)/gi, " ")
    .replace(/^[\s\d.\-–:)]+/, "").replace(/[\s\-–:.]+$/, "").replace(/\s{2,}/g, " ").trim();
  if (t && t === t.toUpperCase()) t = t.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  return t || "";
}
const mismoProductoDoc = (a, b) => normDoc(a).replace(/[^a-z0-9]/g, "") === normDoc(b).replace(/[^a-z0-9]/g, "");

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
        <div class="actions">${editar ? `
          <button class="btn btn-primary" id="doc-varios">📄 Subir varios archivos</button>
          <button class="btn" id="doc-nuevo">+ Adjuntar documento</button>` : ""}</div>
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
  $("#doc-varios")?.addEventListener("click", () => formVariosDocumentos({ productos }));
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
          <input name="producto_nombre" id="fd-prod-nuevo" placeholder="…o escribe el nombre de un producto nuevo" style="margin-top:6px" />
          <div class="form-hint">Las fichas técnicas y hojas de seguridad salen en el listado de productos del portal, con el nombre del producto. Al escoger el archivo se llenan solos.</div>
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
      // Al escoger el archivo: tipo y producto salen de su nombre
      $("#fd-archivo").addEventListener("change", () => {
        const f = $("#fd-archivo").files[0];
        if (!f || doc) return;
        const cat = categoriaDeArchivoDoc(f.name);
        if (cat && !categoria) $("#fd-cat").value = cat;
        if (DOC_DE_PRODUCTO.includes($("#fd-cat").value) && !$("#fd-prod").value) {
          const nombre = productoDeArchivoDoc(f.name);
          const p = productos.find((x) => mismoProductoDoc(x.nombre_comercial, nombre));
          if (p) $("#fd-prod").value = p.id; else if (nombre) $("#fd-prod-nuevo").value = nombre;
          const pn = p ? p.nombre_comercial : nombre;
          if (pn) $("#fd-titulo").value = `${DOC_CAT_TXT[$("#fd-cat").value]} — ${pn}`;
        }
        sync();
      });
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
        producto_nombre: fd.get("producto_id") ? null : (fd.get("producto_nombre") || "").trim() || null,
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
        <div class="actions">${editar ? `
          <button class="btn btn-primary" id="prod-subir-varios">📄 Subir varias fichas y hojas</button>
          <button class="btn" id="prod-nuevo">+ Nuevo producto</button>` : ""}</div>
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
      { key: "grupo", label: "Grupo de plaga", fmt: (p) => {
          const actual = p.grupo_plaga || "";
          const sel = `<select class="prod-grupo" data-prod-grupo="${p.id}"${editar ? "" : " disabled"}>
            ${GRUPO_OPCIONES_DOC.map(([v, t]) => `<option value="${v}"${v === actual ? " selected" : ""}>${esc(v === "" ? `Automático${p.grupo_deducido ? `: ${textoGrupos(p.grupos_plaga)}` : ""}` : t)}</option>`).join("")}
          </select>`;
          return sel + (p.uso ? `<br><small class="muted">${esc(p.uso)}</small>` : "");
        } },
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
  // Grupo de plaga directo en la tabla: se guarda al escogerlo y el portal
  // agrupa las fichas y hojas según esto.
  $$("[data-prod-grupo]").forEach((sel) => sel.addEventListener("change", async () => {
    sel.disabled = true;
    try {
      const r = await put(`/documentos/productos/${sel.dataset.prodGrupo}`, { grupo_plaga: sel.value });
      // Supabase rechazó la columna: o no existe, o no ha recargado su lista
      // de columnas (pasa justo después de crearla). Las dos líneas lo arreglan.
      if (r?.aviso_grupo) {
        sel.disabled = false;
        return alert(`El grupo no se guardó: Supabase todavía no reconoce la columna grupo_plaga.\n\nEn Supabase → SQL Editor pega y ejecuta estas dos líneas:\n\nalter table asa_plaguicidas_catalogo add column if not exists grupo_plaga text;\nnotify pgrst, 'reload schema';\n\nLuego vuelve a escoger el grupo.\n\n(Detalle: ${r.aviso_grupo})`);
      }
      // Dos cosas pueden faltar, y cada una se arregla en un lugar distinto
      if (r && !("grupo_plaga" in r)) {
        sel.disabled = false;
        return alert("El grupo no se guardó: falta la columna en Supabase.\n\nEn Supabase → SQL Editor pega y ejecuta:\n\nalter table asa_plaguicidas_catalogo add column if not exists grupo_plaga text;");
      }
      if (r && (r.grupo_plaga || "") !== sel.value) {
        sel.disabled = false;
        // Qué versión tiene de verdad el servidor (la raíz de la API la dice)
        let ver = "desconocida";
        try { ver = (await fetch(`${CONFIG.API_BASE}/`, { cache: "no-store" }).then((x) => x.json())).version || ver; } catch { /* sin red */ }
        return alert(ver === "2.0-plagas" || ver === "desconocida"
          ? `El grupo no se guardó: el servidor (Railway) sigue con la versión vieja (${ver}). La nueva es 2.2.0 o mayor.\n\nEn Railway: abre el servicio → Deployments. Revisa que el último despliegue diga "Active" y no "Failed"/"Building", y que sea del commit más reciente de main. Si falló, abre sus logs y mándame una captura.\n\nPara comprobar: abre ${CONFIG.API_BASE} en el navegador; debe decir "version":"2.2.0".`
          : `El grupo no se guardó aunque el servidor ya tiene la versión ${ver}.\nEl servidor respondió: ${JSON.stringify({ grupo_plaga: r.grupo_plaga ?? null })}\nMándame una captura de este mensaje.`);
      }
      toast("Grupo guardado ✓");
      pintarDocTab();
    } catch (e) {
      toast(e.message, true);
      sel.disabled = false;
    }
  }));
  $("#prod-subir-varios")?.addEventListener("click", () => formVariosDocumentos({ productos, porDefecto: "ficha_tecnica" }));
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
      <div class="form-group"><label>¿Para qué plagas es?</label>
        <div style="display:flex;gap:16px;flex-wrap:wrap">
          ${GRUPOS_PLAGA_DOC.map(([k, t]) => `<label class="campo-check"><input type="checkbox" name="grupo_plaga" value="${k}"${(p?.grupos_plaga || []).includes(k) ? " checked" : ""} /> ${t}</label>`).join("")}
        </div>
        <div class="form-hint">En el portal, las fichas técnicas y hojas de seguridad salen ordenadas por esto.${p?.grupo_deducido && p?.grupos_plaga?.length ? " Lo marcado ahora lo dedujo el sistema por el nombre o el ingrediente; corrígelo si hace falta." : ""}</div>
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
      cuerpo.grupo_plaga = fd.getAll("grupo_plaga").join(",") || (p?.grupo_plaga === "otros" ? "otros" : "");
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

// ── Subir varios archivos de una vez ─────────────────────────────────────
// Se escogen todos juntos. Cada uno sale en una fila con su tipo (del nombre
// del archivo: "18.1-_Hoja_Seguridad_Klerat.pdf" → hoja de seguridad) y, si es
// ficha u hoja, su producto (Klerat). Se revisa, se corrige lo que haga falta
// y se suben en fila. El servidor cuelga cada ficha / hoja de su producto y lo
// crea si no estaba en el catálogo.
async function formVariosDocumentos({ productos = [], porDefecto = "otro" } = {}) {
  const clientes = await getClientesCache().catch(() => []);
  let filas = [];
  const tituloDe = (f) => f.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/^[\s\d.\-–)]+/, "").trim();

  openModal({
    title: "Subir varios archivos",
    large: true,
    submitLabel: "Subir todos",
    bodyHTML: `
      <div class="form-group">
        <label>Archivos *</label>
        <input type="file" id="fv-archivos" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,application/pdf,image/*" />
        <div class="form-hint">Escoge todos los que quieras a la vez (Ctrl o Shift en la computadora; en el celular, mantén presionado).
          El tipo y el producto salen del nombre de cada archivo; revísalos abajo antes de subir. Hasta ${DOC_MAX_MB} MB cada uno.</div>
      </div>
      <div class="form-grid">
        <div class="form-group"><label>¿Qué cliente los ve?</label>
          <select id="fv-cliente"><option value="">Todos los clientes</option>
            ${clientes.map((c) => `<option value="${c.id}">${esc(clienteLabel(c))}</option>`).join("")}</select></div>
        <div class="form-group"><label>Fecha de vencimiento (opcional, para todos)</label><input type="date" id="fv-vence" /></div>
      </div>
      <label class="campo-check"><input type="checkbox" id="fv-visible" checked /> Visibles para el hotel en su portal</label>
      <div id="fv-lista" style="margin-top:12px"></div>
      <datalist id="fv-productos">${productos.map((p) => `<option value="${esc(p.nombre_comercial)}"></option>`).join("")}</datalist>`,
    onMount: () => {
      const pintar = () => {
        $("#fv-lista").innerHTML = filas.length ? `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Archivo</th><th>Tipo</th><th>Producto / título</th><th></th></tr></thead>
            <tbody>${filas.map((x, i) => `
              <tr data-i="${i}">
                <td><small>📎 ${esc(x.f.name)}</small><br><small class="muted">${docPeso(x.f.size)}</small></td>
                <td><select data-campo="cat">${DOC_CATEGORIAS.map(([k, t]) => `<option value="${k}"${k === x.cat ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></td>
                <td>${DOC_DE_PRODUCTO.includes(x.cat)
                  ? `<input data-campo="prod" list="fv-productos" value="${esc(x.prod)}" placeholder="Nombre del producto" />`
                  : `<input data-campo="titulo" value="${esc(x.titulo)}" placeholder="Título" />`}</td>
                <td><button type="button" class="btn btn-sm btn-danger" data-quitar-fila="${i}">✕</button></td>
              </tr>`).join("")}</tbody>
          </table></div>
          <div class="form-hint">${filas.length} archivo(s). Las fichas técnicas y hojas de seguridad salen en el portal bajo "Listado de productos", con el nombre del producto.</div>`
          : "";
        $$("#fv-lista tr[data-i]").forEach((tr) => {
          const x = filas[Number(tr.dataset.i)];
          tr.querySelector('[data-campo="cat"]').addEventListener("change", (e) => { x.cat = e.target.value; pintar(); });
          tr.querySelector('[data-campo="prod"]')?.addEventListener("input", (e) => { x.prod = e.target.value; });
          tr.querySelector('[data-campo="titulo"]')?.addEventListener("input", (e) => { x.titulo = e.target.value; });
        });
        $$("[data-quitar-fila]").forEach((b) => b.addEventListener("click", () => { filas.splice(Number(b.dataset.quitarFila), 1); pintar(); }));
      };
      $("#fv-archivos").addEventListener("change", (e) => {
        for (const f of e.target.files) {
          const cat = categoriaDeArchivoDoc(f.name) || porDefecto;
          const prod = productoDeArchivoDoc(f.name);
          const p = productos.find((x) => mismoProductoDoc(x.nombre_comercial, prod));
          filas.push({ f, cat, prod: p ? p.nombre_comercial : prod, titulo: tituloDe(f) });
        }
        e.target.value = "";   // así se pueden agregar más en otra tanda
        pintar();
      });
    },
    onSubmit: async () => {
      if (!filas.length) throw new Error("Escoge al menos un archivo.");
      const grandes = filas.filter((x) => x.f.size > DOC_MAX_MB * 1024 * 1024);
      if (grandes.length) throw new Error(`Pesan más de ${DOC_MAX_MB} MB: ${grandes.map((x) => x.f.name).join(", ")}`);
      const sinProd = filas.filter((x) => DOC_DE_PRODUCTO.includes(x.cat) && x.cat !== "registro_agricultura" && !String(x.prod || "").trim());
      if (sinProd.length) throw new Error(`Falta el producto de: ${sinProd.map((x) => x.f.name).join(", ")}`);
      const boton = $("#asa-modal-submit");
      const ok = [], mal = [];
      for (const [i, x] of [...filas].entries()) {
        boton.textContent = `Subiendo ${i + 1} de ${filas.length}…`;
        try {
          const esProd = DOC_DE_PRODUCTO.includes(x.cat) && String(x.prod || "").trim();
          const p = esProd ? productos.find((y) => mismoProductoDoc(y.nombre_comercial, x.prod)) : null;
          const r = await post("/documentos", {
            categoria: x.cat,
            titulo: esProd ? `${DOC_CAT_TXT[x.cat]} — ${p ? p.nombre_comercial : x.prod.trim()}` : (x.titulo || tituloDe(x.f)),
            producto_id: p?.id || null,
            producto_nombre: esProd && !p ? x.prod.trim() : null,
            cliente_id: $("#fv-cliente").value || null,
            fecha_vencimiento: $("#fv-vence").value || null,
            visible_cliente: $("#fv-visible").checked,
            archivo: { nombre: x.f.name, dataUrl: await leerArchivoComoDataUrl(x.f) },
          });
          ok.push(x);
          if (r.producto_creado) productos.push({ id: r.producto_id, nombre_comercial: r.producto_nombre });
        } catch (e) { mal.push(`${x.f.name}: ${e.message}`); }
      }
      // Lo que subió sale de la lista; si algo falló, queda para reintentar.
      filas = filas.filter((x) => !ok.includes(x));
      if (mal.length) {
        boton.textContent = "Reintentar los que fallaron";
        $("#fv-lista").insertAdjacentHTML("afterbegin", `<div class="form-hint" style="color:#b91c1c">
          ${ok.length} subido(s). No se pudieron subir:<br>${mal.map(esc).join("<br>")}</div>`);
        throw new Error(`${mal.length} archivo(s) no se pudieron subir.`);
      }
      closeModal();
      toast(`${ok.length} archivo(s) subido(s) ✓`);
      pintarDocTab();
    },
  });
}
