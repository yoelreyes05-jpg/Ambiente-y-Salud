// ═════════════════════════════════════════════════════════════════════════
// admin.js — Módulos de administración del panel ASA
//
// Se carga ANTES que app.js. Define funciones globales y el arreglo
// MODULOS_EXTRA, que app.js concatena a su propia lista de módulos. Se
// separó del app.js para que ese archivo no siga creciendo sin control.
//
// Depende de los ayudantes de app.js ($, get, post, openModal, …), que solo
// se usan dentro de funciones, o sea en tiempo de ejecución, nunca al cargar.
// ═════════════════════════════════════════════════════════════════════════

const FRECUENCIAS = ["diaria", "semanal", "quincenal", "mensual", "trimestral", "por_orden"];

const TIPOS_RESPUESTA = [
  ["si_no", "Sí / No"],
  ["seleccion", "Lista (una opción)"],
  ["multiple", "Lista (varias opciones)"],
  ["numero", "Número"],
  ["texto", "Texto libre"],
  ["foto", "Solo foto"],
  ["escala", "Escala 1–5"],
];

const MODULOS_EXTRA = [
  { key: "estrategias", label: "Estrategias", ic: "📋", seccion: "catalogos",
    roles: ["admin", "operaciones", "comercial"], view: viewEstrategias },
  { key: "tipos_punto", label: "Tipos de punto", ic: "🏷️", seccion: "catalogos",
    roles: ["admin", "operaciones"], view: viewTiposPunto },
  { key: "accesos_hotel", label: "Accesos del hotel", ic: "🏨", seccion: "admin",
    roles: ["admin", "comercial"], view: viewAccesosHotel },
];

// ── Ayudantes ────────────────────────────────────────────────────────────
const del = (path) => api(path, { method: "DELETE" });

function opciones(lista, valorActual, valFn, labelFn) {
  return lista
    .map((x) => {
      const v = valFn(x);
      return `<option value="${esc(v)}"${String(v) === String(valorActual ?? "") ? " selected" : ""}>${esc(labelFn(x))}</option>`;
    })
    .join("");
}

const opcionesFrecuencia = (actual) =>
  opciones(FRECUENCIAS, actual, (f) => f, (f) => f.replace("_", " "));

function campo(label, inputHTML, ayuda) {
  return `<label class="campo">${esc(label)}${inputHTML}${
    ayuda ? `<small class="ayuda">${esc(ayuda)}</small>` : ""
  }</label>`;
}

// Lee un archivo del input y lo devuelve en base64 (sin el prefijo data:)
function leerBase64(file) {
  return new Promise((ok, mal) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(",")[1]);
    fr.onerror = () => mal(new Error("No se pudo leer el archivo"));
    fr.readAsDataURL(file);
  });
}

// ═════════════════════════════════════════════════════════════════════════
// ESTRATEGIAS — el catálogo reutilizable y sus preguntas
//
// La estrategia define QUÉ SE HACE con un punto; el tipo define QUÉ ES. Las
// preguntas se asocian a un tipo de punto: al escanear un cebadero el técnico
// ve las preguntas de cebadero, al escanear una lámpara las de lámpara.
// ═════════════════════════════════════════════════════════════════════════
async function viewEstrategias(content) {
  content.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Estrategias</h2>
        <div class="actions">
          <button class="btn" id="btn-plantilla">Crear plantilla base de ASA</button>
          <button class="btn btn-primary" id="btn-nueva-estrategia">+ Nueva estrategia</button>
        </div>
      </div>
      <p class="text-muted">
        Una estrategia agrupa las preguntas que el técnico responde en campo.
        Se define una vez y se reutiliza en cualquier complejo hotelero.
      </p>
      <div id="estrategias-tabla"><div class="center-msg">Cargando…</div></div>
    </div>`;

  async function cargar() {
    const lista = await get("/estrategias");
    $("#estrategias-tabla").innerHTML = tableHTML(
      [
        { key: "nombre", label: "Estrategia" },
        { key: "descripcion", label: "Descripción", fmt: (e) => esc(e.descripcion || "—") },
        { key: "es_plantilla", label: "Reutilizable", fmt: (e) => (e.es_plantilla ? "Sí" : "No") },
        { key: "preguntas_total", label: "Preguntas", fmt: (e) => e.preguntas_total ?? e.preguntas?.length ?? "—" },
      ],
      lista,
      "Todavía no hay estrategias. Empieza por la plantilla base."
    );
    $("#estrategias-tabla").querySelectorAll("tr[data-id]").forEach((tr) =>
      tr.addEventListener("click", () => abrirEstrategia(tr.dataset.id, cargar))
    );
  }
  await cargar();

  $("#btn-nueva-estrategia").addEventListener("click", () => modalEstrategia(null, cargar));
  $("#btn-plantilla").addEventListener("click", async () => {
    try {
      await post("/estrategias/plantilla-base", {});
      toast("Plantilla base creada");
      cargar();
    } catch (e) {
      toast(e.message, true);
    }
  });
}

function modalEstrategia(estrategia, onSaved) {
  const esNueva = !estrategia;
  openModal({
    title: esNueva ? "Nueva estrategia" : "Editar estrategia",
    bodyHTML:
      campo("Nombre", `<input name="nombre" required value="${esc(estrategia?.nombre || "")}" />`) +
      campo("Descripción", `<textarea name="descripcion" rows="2">${esc(estrategia?.descripcion || "")}</textarea>`) +
      `<label class="campo-check">
         <input type="checkbox" name="es_plantilla" ${estrategia?.es_plantilla !== false ? "checked" : ""} />
         Reutilizable en cualquier cliente
       </label>`,
    async onSubmit(fd) {
      const cuerpo = {
        nombre: (fd.get("nombre") || "").trim(),
        descripcion: (fd.get("descripcion") || "").trim() || null,
        es_plantilla: (fd.get("es_plantilla") === "on"),
      };
      if (esNueva) await post("/estrategias", cuerpo);
      else await put(`/estrategias/${estrategia.id}`, cuerpo);
      closeModal();
      toast("Estrategia guardada");
      onSaved?.();
    },
  });
}

// ── Ficha de estrategia con su editor de preguntas ───────────────────────
async function abrirEstrategia(id, onVolver) {
  const content = $("#content");
  content.innerHTML = `<div class="center-msg">Cargando estrategia…</div>`;

  const [est, tipos] = await Promise.all([get(`/estrategias/${id}`), tiposPunto()]);
  const estrategia = est.estrategia || est;
  const preguntas = est.preguntas || estrategia.preguntas || [];

  const nombreTipo = (tid) => tipos.find((t) => t.id === tid)?.nombre || "Todos los tipos";

  content.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <button class="btn btn-sm" id="volver">← Estrategias</button>
          <h2 style="display:inline-block;margin-left:10px">${esc(estrategia.nombre)}</h2>
        </div>
        <div class="actions">
          <button class="btn" id="btn-editar-est">Editar datos</button>
          <button class="btn btn-primary" id="btn-nueva-pregunta">+ Pregunta</button>
        </div>
      </div>
      <p class="text-muted">${esc(estrategia.descripcion || "")}</p>
      <div id="preguntas-lista"></div>
    </div>`;

  $("#volver").addEventListener("click", () => navigate("estrategias"));
  $("#btn-editar-est").addEventListener("click", () =>
    modalEstrategia(estrategia, () => abrirEstrategia(id, onVolver))
  );
  $("#btn-nueva-pregunta").addEventListener("click", () =>
    modalPregunta(id, null, tipos, () => abrirEstrategia(id, onVolver))
  );

  function pintarPreguntas() {
    const activas = preguntas.filter((p) => p.activa !== false);
    if (!activas.length) {
      $("#preguntas-lista").innerHTML = `
        <div class="center-msg">
          Esta estrategia no tiene preguntas. El técnico no vería nada al escanear.
        </div>`;
      return;
    }
    // Agrupadas por tipo de punto: así se ve de una qué contesta el técnico
    // frente a un cebadero y qué frente a una lámpara.
    const grupos = {};
    for (const p of activas) (grupos[p.tipo_punto_id || ""] = grupos[p.tipo_punto_id || ""] || []).push(p);

    $("#preguntas-lista").innerHTML = Object.entries(grupos)
      .map(
        ([tid, lista]) => `
        <div class="grupo-preguntas">
          <div class="dia-cabecera">${esc(nombreTipo(tid || null))} · ${lista.length}</div>
          ${lista
            .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
            .map(
              (p) => `
            <div class="pregunta" data-id="${p.id}">
              <div class="pregunta-texto">
                ${esc(p.texto)}
                ${p.obligatoria ? `<span class="chip">obligatoria</span>` : ""}
              </div>
              <div class="pregunta-meta">
                ${esc((TIPOS_RESPUESTA.find((t) => t[0] === p.tipo_respuesta) || [])[1] || p.tipo_respuesta)}
                ${p.opciones?.length ? ` · ${esc(p.opciones.join(", "))}` : ""}
              </div>
              <div class="pregunta-acciones">
                <button class="btn btn-sm" data-accion="editar">Editar</button>
                <button class="btn btn-sm btn-danger" data-accion="borrar">Quitar</button>
              </div>
            </div>`
            )
            .join("")}
        </div>`
      )
      .join("");

    $$("#preguntas-lista .pregunta").forEach((el) => {
      const p = activas.find((x) => x.id === el.dataset.id);
      el.querySelector('[data-accion="editar"]').addEventListener("click", () =>
        modalPregunta(id, p, tipos, () => abrirEstrategia(id, onVolver))
      );
      el.querySelector('[data-accion="borrar"]').addEventListener("click", async () => {
        if (!confirm(`¿Quitar la pregunta "${p.texto}"?`)) return;
        await del(`/estrategias/preguntas/${p.id}`);
        toast("Pregunta quitada");
        abrirEstrategia(id, onVolver);
      });
    });
  }
  pintarPreguntas();
}

function modalPregunta(estrategiaId, pregunta, tipos, onSaved) {
  const esNueva = !pregunta;
  openModal({
    title: esNueva ? "Nueva pregunta" : "Editar pregunta",
    large: true,
    bodyHTML:
      campo("Pregunta que ve el técnico",
        `<input name="texto" required value="${esc(pregunta?.texto || "")}" placeholder="¿El cebadero tiene consumo de cebo?" />`) +
      campo("Aplica al tipo de punto",
        `<select name="tipo_punto_id">
           <option value="">Todos los tipos</option>
           ${opciones(tipos, pregunta?.tipo_punto_id, (t) => t.id, (t) => `${t.icono || ""} ${t.nombre}`)}
         </select>`,
        "Si eliges un tipo, la pregunta solo aparece al escanear puntos de ese tipo.") +
      campo("Tipo de respuesta",
        `<select name="tipo_respuesta">
           ${opciones(TIPOS_RESPUESTA, pregunta?.tipo_respuesta || "si_no", (t) => t[0], (t) => t[1])}
         </select>`) +
      campo("Opciones (solo para listas)",
        `<input name="opciones" value="${esc((pregunta?.opciones || []).join(", "))}" placeholder="Sin actividad, Consumo leve, Consumo alto" />`,
        "Sepáralas con comas.") +
      `<label class="campo-check"><input type="checkbox" name="obligatoria" ${pregunta?.obligatoria !== false ? "checked" : ""} /> Obligatoria</label>
       <label class="campo-check"><input type="checkbox" name="foto_si" ${pregunta?.requiere_foto_si ? "checked" : ""} /> Exigir foto cuando la respuesta sea "sí"</label>
       <label class="campo-check"><input type="checkbox" name="hallazgo_si" ${pregunta?.genera_hallazgo_si ? "checked" : ""} /> Abrir un hallazgo cuando la respuesta sea "sí"</label>`,
    async onSubmit(fd) {
      const cuerpo = {
        texto: (fd.get("texto") || "").trim(),
        tipo_punto_id: fd.get("tipo_punto_id") || null,
        tipo_respuesta: fd.get("tipo_respuesta"),
        opciones: String(fd.get("opciones") || "").split(",").map((s) => s.trim()).filter(Boolean),
        obligatoria: (fd.get("obligatoria") === "on"),
        requiere_foto_si: (fd.get("foto_si") === "on") ? { igual: "si" } : null,
        genera_hallazgo_si: (fd.get("hallazgo_si") === "on") ? { igual: "si" } : null,
      };
      if (esNueva) await post(`/estrategias/${estrategiaId}/preguntas`, cuerpo);
      else await put(`/estrategias/preguntas/${pregunta.id}`, cuerpo);
      closeModal();
      toast("Pregunta guardada");
      onSaved?.();
    },
  });
}

// ═════════════════════════════════════════════════════════════════════════
// TIPOS DE PUNTO — aquí se define la frecuencia por defecto de cada tipo
// ═════════════════════════════════════════════════════════════════════════
async function viewTiposPunto(content) {
  content.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Tipos de punto de control</h2>
        <div class="actions"><button class="btn btn-primary" id="btn-nuevo-tipo">+ Nuevo tipo</button></div>
      </div>
      <p class="text-muted">
        La frecuencia de aquí es la que se aplica por defecto a los puntos nuevos
        de ese tipo. Un punto puede tener la suya propia si hace falta.
      </p>
      <div id="tipos-tabla"><div class="center-msg">Cargando…</div></div>
    </div>`;

  async function cargar() {
    TIPOS_PUNTO_CACHE = null;
    const lista = await tiposPunto();
    $("#tipos-tabla").innerHTML = tableHTML(
      [
        { key: "icono", label: "", fmt: (t) => t.icono || "" },
        { key: "nombre", label: "Tipo" },
        { key: "codigo", label: "Código" },
        { key: "prefijo_codigo", label: "Prefijo", fmt: (t) => esc(t.prefijo_codigo || "—") },
        { key: "frecuencia_default", label: "Frecuencia", fmt: (t) => badge(t.frecuencia_default) },
        { key: "requiere_foto", label: "Exige foto", fmt: (t) => (t.requiere_foto ? "Sí" : "No") },
      ],
      lista,
      "No hay tipos de punto."
    );
    $("#tipos-tabla").querySelectorAll("tr[data-id]").forEach((tr) =>
      tr.addEventListener("click", () => modalTipoPunto(lista.find((t) => t.id === tr.dataset.id), cargar))
    );
  }
  await cargar();
  $("#btn-nuevo-tipo").addEventListener("click", () => modalTipoPunto(null, cargar));
}

function modalTipoPunto(tipo, onSaved) {
  const esNuevo = !tipo;
  openModal({
    title: esNuevo ? "Nuevo tipo de punto" : `Editar: ${tipo.nombre}`,
    bodyHTML:
      campo("Nombre", `<input name="nombre" required value="${esc(tipo?.nombre || "")}" />`) +
      campo("Código interno", `<input name="codigo" required value="${esc(tipo?.codigo || "")}" ${tipo ? "readonly" : ""} />`,
        tipo ? "El código no se cambia: los puntos existentes lo usan." : "Sin espacios ni tildes: cebadero_roedor") +
      campo("Prefijo para códigos nuevos", `<input name="prefijo_codigo" value="${esc(tipo?.prefijo_codigo || "")}" placeholder="CR" />`) +
      campo("Icono", `<input name="icono" value="${esc(tipo?.icono || "")}" placeholder="🐀" />`) +
      campo("Frecuencia por defecto", `<select name="frecuencia_default">${opcionesFrecuencia(tipo?.frecuencia_default || "mensual")}</select>`) +
      `<label class="campo-check"><input type="checkbox" name="requiere_foto" ${tipo?.requiere_foto ? "checked" : ""} /> Exigir foto en cada inspección</label>`,
    async onSubmit(fd) {
      const cuerpo = {
        nombre: (fd.get("nombre") || "").trim(),
        prefijo_codigo: (fd.get("prefijo_codigo") || "").trim().toUpperCase() || null,
        icono: (fd.get("icono") || "").trim() || null,
        frecuencia_default: fd.get("frecuencia_default"),
        requiere_foto: (fd.get("requiere_foto") === "on"),
      };
      if (esNuevo) await post("/puntos/tipos", { ...cuerpo, codigo: (fd.get("codigo") || "").trim().toLowerCase() });
      else await put(`/puntos/tipos/${tipo.id}`, cuerpo);
      closeModal();
      toast("Tipo guardado");
      onSaved?.();
    },
  });
}

// ═════════════════════════════════════════════════════════════════════════
// ÁREAS
// ═════════════════════════════════════════════════════════════════════════
function modalArea(sitioId, area, onSaved) {
  const esNueva = !area;
  openModal({
    title: esNueva ? "Nueva área" : `Editar área`,
    bodyHTML:
      campo("Nombre", `<input name="nombre" required value="${esc(area?.nombre || "")}" />`,
        "Aquí se corrigen los nombres que vinieron mal del sistema anterior.") +
      campo("Código", `<input name="codigo" value="${esc(area?.codigo || "")}" placeholder="COC" />`,
        "Se usa como prefijo al generar códigos de puntos en masa.") +
      campo("Nivel / planta física", `<input name="nivel" value="${esc(area?.nivel || "")}" placeholder="Piso 3" />`) +
      campo("Descripción", `<textarea name="descripcion" rows="2">${esc(area?.descripcion || "")}</textarea>`),
    async onSubmit(fd) {
      const cuerpo = {
        nombre: (fd.get("nombre") || "").trim(),
        codigo: (fd.get("codigo") || "").trim().toUpperCase() || null,
        nivel: (fd.get("nivel") || "").trim() || null,
        descripcion: (fd.get("descripcion") || "").trim() || null,
      };
      if (esNueva) await post(`/sitios/${sitioId}/areas`, cuerpo);
      else await put(`/sitios/areas/${area.id}`, cuerpo);
      closeModal();
      toast("Área guardada");
      onSaved?.();
    },
  });
}

// ═════════════════════════════════════════════════════════════════════════
// PUNTOS DE CONTROL
// ═════════════════════════════════════════════════════════════════════════
async function modalPunto(sitioId, punto, areas, tipos, onSaved) {
  const esNuevo = !punto;
  // Se cargan antes de pintar: el <select> de estrategia se arma con ellas.
  await estrategiasLista().catch(() => []);
  openModal({
    title: esNuevo ? "Nuevo punto de control" : `Editar ${punto.codigo_visible}`,
    large: true,
    bodyHTML:
      campo("Tipo", `<select name="tipo_punto_id" required>${opciones(tipos, punto?.tipo_punto_id, (t) => t.id, (t) => `${t.icono || ""} ${t.nombre}`)}</select>`) +
      campo("Área", `<select name="area_id"><option value="">Sin área</option>${opciones(areas, punto?.area_id, (a) => a.id, (a) => a.nombre)}</select>`) +
      campo("Código visible", `<input name="codigo_visible" value="${esc(punto?.codigo_visible || "")}" placeholder="Se genera solo si lo dejas vacío" />`) +
      campo("Nombre / referencia", `<input name="nombre" value="${esc(punto?.nombre || "")}" placeholder="Cebadero pasillo cocina" />`) +
      campo("Ubicación", `<input name="ubicacion_descripcion" value="${esc(punto?.ubicacion_descripcion || "")}" placeholder="Detrás de la nevera industrial" />`) +
      campo("Número de habitación", `<input name="numero_habitacion" value="${esc(punto?.numero_habitacion || "")}" />`,
        "Solo si el tipo es Habitación.") +
      campo("Frecuencia", `<select name="frecuencia">${opcionesFrecuencia(punto?.frecuencia)}</select>`) +
      campo("Estrategia",
        `<select name="estrategia_id">
           <option value="">Sin estrategia</option>
           ${opciones(ESTRATEGIAS_CACHE || [], punto?.estrategia_id, (e) => e.id, (e) => e.nombre)}
         </select>`,
        "Decide qué preguntas ve el técnico al escanear este punto.") +
      (esNuevo
        ? campo("Etiqueta QR ya impresa", `<input name="qr_token" placeholder="C205050474718" />`,
            "Déjalo vacío para que el sistema genere un QR nuevo. Si pegas una etiqueta de las que ya tienes impresas, escribe su código aquí.")
        : `<div class="campo"><span>Etiqueta QR</span><code class="qr-fijo">${esc(punto.qr_token)}</code>
             <small class="ayuda">El QR no se puede cambiar. Si la etiqueta se dañó, desactiva el punto y crea otro.</small></div>
           <button type="button" class="btn btn-danger" id="punto-baja" style="margin-top:6px">
             Dar de baja este punto
           </button>`),
    onMount() {
      $("#punto-baja")?.addEventListener("click", () => darDeBajaPunto(punto, onSaved));
    },
    async onSubmit(fd) {
      const cuerpo = {
        sitio_id: sitioId,
        tipo_punto_id: fd.get("tipo_punto_id"),
        area_id: fd.get("area_id") || null,
        codigo_visible: (fd.get("codigo_visible") || "").trim() || undefined,
        nombre: (fd.get("nombre") || "").trim() || null,
        ubicacion_descripcion: (fd.get("ubicacion_descripcion") || "").trim() || null,
        numero_habitacion: (fd.get("numero_habitacion") || "").trim() || null,
        frecuencia: fd.get("frecuencia"),
        estrategia_id: fd.get("estrategia_id") || null,
      };
      if (esNuevo) {
        const qr = (fd.get("qr_token") || "").trim();
        if (qr) cuerpo.qr_token = qr;
        await post("/puntos", cuerpo);
      } else {
        delete cuerpo.sitio_id;
        await put(`/puntos/${punto.id}`, cuerpo);
      }
      closeModal();
      toast("Punto guardado");
      onSaved?.();
    },
  });
}

function modalPuntosMasivo(sitioId, areas, tipos, onSaved) {
  openModal({
    title: "Crear puntos en masa",
    bodyHTML:
      `<p class="text-muted">Genera varios puntos numerados de un mismo tipo dentro de un área.
       Cada uno recibe su propio QR nuevo, listo para imprimir.</p>` +
      campo("Tipo", `<select name="tipo_punto_id" required>${opciones(tipos, null, (t) => t.id, (t) => `${t.icono || ""} ${t.nombre}`)}</select>`) +
      campo("Área", `<select name="area_id"><option value="">Sin área</option>${opciones(areas, null, (a) => a.id, (a) => a.nombre)}</select>`) +
      campo("Cantidad", `<input name="cantidad" type="number" min="1" max="1000" value="10" required />`) +
      campo("Numerar desde", `<input name="desde" type="number" min="1" value="1" />`) +
      campo("Prefijo del código", `<input name="prefijo" placeholder="Se toma del área o del tipo" />`) +
      campo("Frecuencia", `<select name="frecuencia">${opcionesFrecuencia("mensual")}</select>`),
    submitLabel: "Crear",
    async onSubmit(fd) {
      const r = await post("/puntos/masivo", {
        sitio_id: sitioId,
        tipo_punto_id: fd.get("tipo_punto_id"),
        area_id: fd.get("area_id") || null,
        cantidad: Number(fd.get("cantidad")),
        desde: Number(fd.get("desde")) || 1,
        prefijo: (fd.get("prefijo") || "").trim() || undefined,
        frecuencia: fd.get("frecuencia"),
      });
      closeModal();
      toast(`${r.creados} puntos creados`);
      onSaved?.();
    },
  });
}

// Importación desde Excel, con pasada en seco antes de escribir nada
function modalImportarPuntos(sitioId, onSaved) {
  openModal({
    title: "Importar puntos desde Excel",
    large: true,
    bodyHTML:
      `<p class="text-muted">
         Reconoce las columnas del export del sistema anterior (CÓDIGO, ESTRATEGIA,
         ÁREA, CONTRATO, CODIGO QR) y también hojas armadas a mano. <strong>Los QR ya
         impresos se conservan tal cual</strong>: la columna CODIGO QR se respeta.
       </p>` +
      campo("Archivo .xlsx", `<input name="archivo" type="file" accept=".xlsx,.xls,.csv" required />`) +
      campo("Hoja", `<input name="hoja" placeholder="La primera, si lo dejas vacío" />`) +
      campo("Prefijo a recortar de las áreas", `<input name="prefijo_area" placeholder="Iberostar Coral Bavaro" />`,
        "El export repite el nombre del hotel en cada área. Si lo pones aquí, se recorta.") +
      `<div id="previsualizacion"></div>`,
    submitLabel: "Revisar",
    async onSubmit(fd) {
      const file = fd.get("archivo");
      if (!file) throw new Error("Elige un archivo");
      const base = await leerBase64(file);
      const cuerpo = {
        sitio_id: sitioId,
        archivo_base64: base,
        hoja: (fd.get("hoja") || "").trim() || undefined,
        prefijo_area: (fd.get("prefijo_area") || "").trim() || undefined,
      };

      const boton = $("#asa-modal-submit");
      // Primera pasada: simular. Segunda: confirmar.
      if (boton.dataset.confirmar !== "si") {
        const r = await post("/puntos/importar", { ...cuerpo, simular: true });
        $("#previsualizacion").innerHTML = `
          <div class="resumen-import">
            <div><strong>${r.puntos_nuevos ?? r.creados ?? 0}</strong> puntos se crearían</div>
            <div><strong>${r.qr_conservados ?? 0}</strong> QR impresos se conservarían</div>
            <div><strong>${(r.areas_nuevas || []).length}</strong> áreas nuevas</div>
            <div><strong>${(r.estrategias_nuevas || []).length}</strong> estrategias nuevas</div>
            ${
              (r.errores || []).length
                ? `<div class="form-error" style="display:block;margin-top:10px">
                     ${r.errores.length} fila(s) con problema:<br>
                     ${r.errores.slice(0, 8).map((e) => `línea ${e.linea}: ${esc(e.mensaje)}`).join("<br>")}
                   </div>`
                : `<div class="estado-chip hecho" style="margin-top:10px">Sin errores</div>`
            }
          </div>`;
        boton.dataset.confirmar = "si";
        boton.textContent = "Confirmar importación";
        boton.disabled = false;
        return;   // el modal sigue abierto para que revise antes de confirmar
      }

      const r = await post("/puntos/importar", cuerpo);
      closeModal();
      toast(`${r.creados ?? r.puntos_nuevos ?? 0} puntos importados`);
      onSaved?.();
    },
  });
}

function modalFrecuenciaMasiva(sitioId, areas, tipos, onSaved) {
  openModal({
    title: "Cambiar frecuencia en masa",
    bodyHTML:
      `<p class="text-muted">Aplica una frecuencia a todos los puntos que cumplan el filtro.</p>` +
      campo("Área", `<select name="area_id"><option value="">Todas</option>${opciones(areas, null, (a) => a.id, (a) => a.nombre)}</select>`) +
      campo("Tipo", `<select name="tipo_codigo"><option value="">Todos</option>${opciones(tipos, null, (t) => t.codigo, (t) => t.nombre)}</select>`) +
      campo("Nueva frecuencia", `<select name="frecuencia">${opcionesFrecuencia("mensual")}</select>`),
    submitLabel: "Aplicar",
    async onSubmit(fd) {
      const r = await patch("/puntos/frecuencia", {
        sitio_id: sitioId,
        area_id: fd.get("area_id") || undefined,
        tipo_codigo: fd.get("tipo_codigo") || undefined,
        frecuencia: fd.get("frecuencia"),
      });
      closeModal();
      toast(`${r.actualizados} puntos actualizados`);
      onSaved?.();
    },
  });
}

// ═════════════════════════════════════════════════════════════════════════
// ETIQUETAS QR IMPRIMIBLES
//
// Se abre una hoja lista para imprimir y el navegador la guarda como PDF
// ("Destino → Guardar como PDF"). El QR se dibuja en SVG con la librería
// vendorizada en vendor/qrcode.js, así que no depende de internet ni de
// ningún servicio externo.
// ═════════════════════════════════════════════════════════════════════════
async function imprimirEtiquetas(sitioId, areaId) {
  if (typeof qrcode !== "function") {
    toast("No se cargó el generador de QR (vendor/qrcode.js).", true);
    return;
  }

  const qs = new URLSearchParams({ sitio_id: sitioId });
  if (areaId) qs.set("area_id", areaId);
  const r = await get(`/puntos/etiquetas/imprimir?${qs}`);

  if (!r.total) {
    toast("No hay puntos para imprimir con ese filtro", true);
    return;
  }

  // El QR se genera AQUÍ, en la página del panel, y se escribe ya dibujado en
  // la ventana de impresión. Se intentó cargar la librería dentro de esa
  // ventana con un <script src>, pero una ventana abierta con about:blank no
  // ejecuta scripts externos de forma confiable.
  const svgDe = (texto) => {
    const q = qrcode(0, "M");
    q.addData(texto);
    q.make();
    return q.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
  };

  const etiquetas = r.etiquetas
    .map(
      (e) => `
      <div class="etq">
        <div class="qr">${svgDe(e.url_qr)}</div>
        <div class="txt">
          <div class="cod">${esc(e.habitacion || e.codigo)}</div>
          <div class="nom">${esc(e.nombre || "")}</div>
          <div class="are">${esc(e.area || "")}</div>
        </div>
      </div>`
    )
    .join("");

  const ventana = window.open("", "_blank");
  if (!ventana) {
    toast("El navegador bloqueó la ventana. Permite las ventanas emergentes de este sitio.", true);
    return;
  }

  ventana.document.write(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8" />
<title>Etiquetas QR — ${esc(r.hotel)}</title>
<style>
  @page { size: letter; margin: 10mm; }
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; margin:0; padding:10mm; }
  h1 { font-size:14px; margin:0 0 10px; color:#24407C }
  .hoja { display:grid; grid-template-columns:repeat(3,1fr); gap:6mm; }
  .etq { border:1px solid #BAC9E1; border-radius:3mm; padding:4mm;
         display:flex; gap:3mm; align-items:center; break-inside:avoid; }
  .qr svg { width:24mm; height:24mm; display:block }
  .txt { min-width:0 }
  .cod { font-weight:700; font-size:13px; color:#24407C }
  .nom { font-size:10px; color:#333; margin-top:1mm }
  .are { font-size:9px; color:#777; margin-top:1mm }
  .aviso { background:#EAF0F8; border:1px solid #BAC9E1; padding:12px 14px;
           border-radius:6px; margin-bottom:14px; font-size:12.5px; color:#24407C;
           display:flex; align-items:center; justify-content:space-between; gap:14px }
  .aviso button { background:#32539C; color:#fff; border:none; border-radius:6px;
                  padding:9px 16px; font-size:13px; font-weight:700; cursor:pointer }
  @media print { .aviso { display:none } body { padding:0 } }
</style></head>
<body>
  <div class="aviso">
    <span><strong>${r.total} etiquetas — ${esc(r.hotel)}.</strong>
      En el diálogo de impresión elige <em>Destino → Guardar como PDF</em>.</span>
    <button onclick="window.print()">Imprimir / Guardar PDF</button>
  </div>
  <h1>${esc(r.hotel)} — etiquetas de puntos de control</h1>
  <div class="hoja">${etiquetas}</div>
</body></html>`);
  ventana.document.close();
}

// ═════════════════════════════════════════════════════════════════════════
// PLANTAS Y CLIENTES
// ═════════════════════════════════════════════════════════════════════════
function modalPlanta(clientes, planta, onSaved) {
  const esNueva = !planta;
  openModal({
    title: esNueva ? "Nueva planta" : `Editar ${planta.nombre}`,
    large: true,
    bodyHTML:
      campo("Cliente", `<select name="cliente_id" required ${planta ? "disabled" : ""}>
          ${opciones(clientes, planta?.cliente_id, (c) => c.id, (c) => c.razon_social || c.nombre_comercial || c.nombre_contacto)}
        </select>`) +
      campo("Nombre de la planta", `<input name="nombre" required value="${esc(planta?.nombre || "")}" />`) +
      campo("Dirección", `<input name="direccion" required value="${esc(planta?.direccion || "")}" />`) +
      campo("Código interno", `<input name="codigo" value="${esc(planta?.codigo || "")}" />`) +
      campo("Contacto de calidad del hotel", `<input name="contacto_calidad" value="${esc(planta?.contacto_calidad || "")}" />`) +
      campo("Teléfono de calidad", `<input name="telefono_calidad" value="${esc(planta?.telefono_calidad || "")}" />`) +
      campo("Correo de calidad", `<input name="email_calidad" type="email" value="${esc(planta?.email_calidad || "")}" />`,
        "A este correo se le puede dar acceso al portal del hotel."),
    async onSubmit(fd) {
      const cuerpo = {
        nombre: (fd.get("nombre") || "").trim(),
        direccion: (fd.get("direccion") || "").trim(),
        codigo: (fd.get("codigo") || "").trim() || null,
        contacto_calidad: (fd.get("contacto_calidad") || "").trim() || null,
        telefono_calidad: (fd.get("telefono_calidad") || "").trim() || null,
        email_calidad: (fd.get("email_calidad") || "").trim() || null,
        tipo_sitio: "hotel",
      };
      if (esNueva) await post("/sitios", { ...cuerpo, cliente_id: fd.get("cliente_id") });
      else await put(`/sitios/${planta.id}`, cuerpo);
      closeModal();
      toast("Planta guardada");
      onSaved?.();
    },
  });
}

function modalEditarCliente(cliente, onSaved) {
  openModal({
    title: `Editar ${cliente.razon_social || cliente.nombre_contacto}`,
    large: true,
    bodyHTML:
      campo("Razón social", `<input name="razon_social" value="${esc(cliente.razon_social || "")}" />`) +
      campo("Nombre comercial", `<input name="nombre_comercial" value="${esc(cliente.nombre_comercial || "")}" />`) +
      campo("RNC / Cédula", `<input name="rnc_cedula" value="${esc(cliente.rnc_cedula || "")}" />`) +
      campo("Contacto", `<input name="nombre_contacto" required value="${esc(cliente.nombre_contacto || "")}" />`) +
      campo("Teléfono", `<input name="telefono" value="${esc(cliente.telefono || "")}" />`) +
      campo("Correo", `<input name="email" type="email" value="${esc(cliente.email || "")}" />`) +
      campo("Dirección", `<input name="direccion" value="${esc(cliente.direccion || "")}" />`),
    async onSubmit(fd) {
      await put(`/clientes/${cliente.id}`, {
        razon_social: (fd.get("razon_social") || "").trim() || null,
        nombre_comercial: (fd.get("nombre_comercial") || "").trim() || null,
        rnc_cedula: (fd.get("rnc_cedula") || "").trim() || null,
        nombre_contacto: (fd.get("nombre_contacto") || "").trim(),
        telefono: (fd.get("telefono") || "").trim() || null,
        email: (fd.get("email") || "").trim() || null,
        direccion: (fd.get("direccion") || "").trim() || null,
      });
      closeModal();
      toast("Cliente actualizado");
      onSaved?.();
    },
  });
}

// ═════════════════════════════════════════════════════════════════════════
// HISTOGRAMA DEL DASHBOARD
//
// Barras apiladas en SVG, sin librerías: una barra por día, partida por nivel
// de actividad. Al lado, el avance de hoy (hecho contra pendiente).
// ═════════════════════════════════════════════════════════════════════════
const COLOR_SERIE = {
  ninguna: "#BAC9E1",
  bajo: "#609C63",
  medio: "#d97706",
  alto: "#dc2626",
};

async function pintarHistograma(destino) {
  destino.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Actividad registrada</h2>
        <div class="actions">
          <select id="hist-por">
            <option value="actividad">Por nivel de actividad</option>
            <option value="tipo">Por tipo de punto</option>
            <option value="area">Por área</option>
          </select>
          <select id="hist-agrupar">
            <option value="dia">Por día</option>
            <option value="semana">Por semana</option>
            <option value="mes">Por mes</option>
          </select>
        </div>
      </div>
      <div id="hist-cuerpo"><div class="center-msg">Cargando…</div></div>
    </div>`;

  async function cargar() {
    const por = $("#hist-por").value;
    const agrupar = $("#hist-agrupar").value;
    const r = await get(`/reportes/histograma?por=${por}&agrupar=${agrupar}`);
    const cuerpo = $("#hist-cuerpo");

    if (!r.datos?.length) {
      cuerpo.innerHTML = `<div class="center-msg">
        Todavía no hay inspecciones registradas. El histograma se llena cuando
        los técnicos empiecen a escanear puntos.</div>`;
      return;
    }

    const maximo = Math.max(...r.datos.map((d) => d.total)) || 1;
    const series = r.series;
    const ancho = 100 / r.datos.length;

    cuerpo.innerHTML = `
      <div class="hist">
        ${r.datos
          .map((d, i) => {
            let acumulado = 0;
            const partes = series
              .map((s) => {
                const v = d[s] || 0;
                if (!v) return "";
                const alto = (v / maximo) * 100;
                const y = 100 - acumulado - alto;
                acumulado += alto;
                return `<rect x="${i * ancho + ancho * 0.15}" y="${y}"
                          width="${ancho * 0.7}" height="${alto}"
                          fill="${COLOR_SERIE[s] || "#4A6FB5"}"><title>${esc(s)}: ${v}</title></rect>`;
              })
              .join("");
            return partes;
          })
          .join("")
          .replace(/^/, `<svg viewBox="0 0 100 100" preserveAspectRatio="none" class="hist-svg">`) + `</svg>`}
        <div class="hist-ejes">
          <span>${esc(r.datos[0].periodo)}</span>
          <span>${esc(r.datos[r.datos.length - 1].periodo)}</span>
        </div>
        <div class="hist-leyenda">
          ${series
            .map(
              (s) =>
                `<span class="serie"><i style="background:${COLOR_SERIE[s] || "#4A6FB5"}"></i>${esc(s)}</span>`
            )
            .join("")}
        </div>
      </div>`;
  }

  $("#hist-por").addEventListener("change", cargar);
  $("#hist-agrupar").addEventListener("change", cargar);
  await cargar();
}

// ═════════════════════════════════════════════════════════════════════════
// DASHBOARD
//
// Reemplaza al tablero genérico anterior. Fuera inventario y facturación
// (módulos congelados); dentro lo que se mira todos los días en control de
// plagas: qué se hizo hoy, qué plaga está subiendo, quién trabaja con menos
// incidencias y qué tan rápido se atiende una orden.
// ═════════════════════════════════════════════════════════════════════════
const ICONO_TENDENCIA = { sube: "▲", baja: "▼", estable: "=", nueva: "•" };
const CLASE_TENDENCIA = { sube: "sube", baja: "baja", estable: "estable", nueva: "nueva" };

async function tableroASA(content) {
  content.innerHTML = `
    <div class="toolbar">
      <select id="tab-dias">
        <option value="7">Últimos 7 días</option>
        <option value="30" selected>Últimos 30 días</option>
        <option value="90">Últimos 90 días</option>
      </select>
      <select id="tab-sitio"><option value="">Todas las plantas</option></select>
    </div>
    <div id="tab-cuerpo"><div class="center-msg">Cargando…</div></div>`;

  // El selector de planta es opcional: si falla, el tablero igual funciona
  // con todas las plantas juntas.
  get("/sitios")
    .then((ss) => {
      $("#tab-sitio").innerHTML =
        `<option value="">Todas las plantas</option>` +
        ss.map((s) => `<option value="${s.id}">${esc(s.nombre)}</option>`).join("");
    })
    .catch(() => {});

  async function cargar() {
    const dias = $("#tab-dias").value;
    const sitio = $("#tab-sitio").value;
    const cuerpo = $("#tab-cuerpo");
    cuerpo.innerHTML = `<div class="center-msg">Cargando…</div>`;

    const qs = new URLSearchParams({ dias });
    if (sitio) qs.set("sitio_id", sitio);

    const [t, ordenesAbiertas] = await Promise.all([
      get(`/reportes/tablero?${qs}`),
      get("/plagas/ordenes?estado=solicitada").catch(() => []),
    ]);

    const op = t.operacion;
    const ot = t.ordenes;

    cuerpo.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card g">
          <div class="lbl">Inspecciones hoy</div>
          <div class="val">${op.inspecciones_hoy}</div>
        </div>
        <div class="kpi-card ${op.cumplimiento_pct >= 90 ? "g" : op.cumplimiento_pct >= 75 ? "w" : "r"}">
          <div class="lbl">Cumplimiento de frecuencia</div>
          <div class="val">${op.cumplimiento_pct}%</div>
        </div>
        <div class="kpi-card ${op.puntos_vencidos ? "r" : "g"}">
          <div class="lbl">Puntos vencidos</div>
          <div class="val">${op.puntos_vencidos}</div>
        </div>
        <div class="kpi-card w">
          <div class="lbl">Órdenes por atender</div>
          <div class="val">${ordenesAbiertas.length || ot.abiertas}</div>
        </div>
        <div class="kpi-card ${ot.horas_mediana == null ? "" : ot.horas_mediana <= 24 ? "g" : "w"}">
          <div class="lbl">Respuesta a una orden</div>
          <div class="val">${ot.horas_mediana == null ? "—" : horasLegibles(ot.horas_mediana)}</div>
        </div>
      </div>

      <div class="dos-columnas">
        <div class="card">
          <div class="card-head"><h2>Plagas — qué está subiendo</h2></div>
          ${bloquePlagas(t.plagas)}
        </div>

        <div class="card">
          <div class="card-head"><h2>Técnicos — menos incidencias</h2></div>
          ${bloqueTecnicos(t.tecnicos)}
        </div>
      </div>

      <div class="dos-columnas">
        <div class="card">
          <div class="card-head"><h2>Frecuencia de operación</h2></div>
          ${bloqueOperacion(op)}
        </div>

        <div class="card">
          <div class="card-head"><h2>Rapidez de atención de órdenes</h2></div>
          ${bloqueOrdenes(ot)}
        </div>
      </div>

      <div id="dash-histograma"></div>`;

    if (typeof pintarHistograma === "function") {
      try {
        await pintarHistograma($("#dash-histograma"));
      } catch (e) {
        $("#dash-histograma").innerHTML =
          `<div class="card"><div class="form-error" style="display:block">${esc(e.message)}</div></div>`;
      }
    }
  }

  $("#tab-dias").addEventListener("change", cargar);
  $("#tab-sitio").addEventListener("change", cargar);
  await cargar();
}

function horasLegibles(h) {
  if (h == null) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h} h`;
  return `${(h / 24).toFixed(1)} días`;
}

function bloquePlagas(plagas) {
  if (!plagas.length) {
    return `<div class="center-msg">
      Sin conteos de plagas en el período. Se llena cuando los técnicos
      registren capturas en las inspecciones.</div>`;
  }
  const max = Math.max(...plagas.map((p) => p.total)) || 1;
  return `<div class="lista-barras">
    ${plagas
      .slice(0, 8)
      .map(
        (p) => `
      <div class="fila-barra">
        <div class="fb-nombre">${esc(p.plaga)}</div>
        <div class="fb-pista">
          <span style="width:${(p.total / max) * 100}%;background:${esc(p.color || "#4A6FB5")}"></span>
        </div>
        <div class="fb-valor">${p.total}</div>
        <div class="fb-tend ${CLASE_TENDENCIA[p.tendencia]}">
          ${ICONO_TENDENCIA[p.tendencia]}
          ${p.variacion_pct == null ? (p.tendencia === "nueva" ? "nueva" : "") : `${p.variacion_pct > 0 ? "+" : ""}${p.variacion_pct}%`}
        </div>
      </div>`
      )
      .join("")}
  </div>
  <p class="text-muted" style="margin-top:12px">
    La tendencia compara la mitad reciente del período contra la mitad anterior.
  </p>`;
}

function bloqueTecnicos(tecnicos) {
  const conVolumen = tecnicos.filter((t) => t.inspecciones >= 5);
  const lista = conVolumen.length ? conVolumen : tecnicos;
  if (!lista.length) return `<div class="center-msg">Sin inspecciones en el período.</div>`;

  return (
    tableHTML(
      [
        { key: "nombre", label: "Técnico" },
        { key: "inspecciones", label: "Inspecciones" },
        { key: "incidencias", label: "Con incidencia" },
        {
          key: "tasa_incidencia",
          label: "Tasa",
          fmt: (t) =>
            `<span class="estado-chip ${t.tasa_incidencia <= 10 ? "hecho" : t.tasa_incidencia <= 25 ? "fuera" : "pendiente"}">${t.tasa_incidencia}%</span>`,
        },
      ],
      lista.slice(0, 10),
      "Sin inspecciones en el período."
    ) +
    (conVolumen.length
      ? `<p class="text-muted" style="margin-top:10px">
           Solo se listan técnicos con 5 o más inspecciones: con menos, el
           porcentaje no dice nada.
         </p>`
      : "")
  );
}

function bloqueOperacion(op) {
  return `
    <div class="mini-kpis">
      <div><span class="mk-val">${op.promedio_diario}</span><span class="mk-lbl">inspecciones por día trabajado</span></div>
      <div><span class="mk-val">${op.dias_trabajados}</span><span class="mk-lbl">de ${op.dias_periodo} días con operación</span></div>
      <div><span class="mk-val">${op.inspecciones_periodo}</span><span class="mk-lbl">inspecciones en el período</span></div>
    </div>
    <div style="margin-top:16px">
      <div class="text-muted">Puntos al día (${op.puntos_programables - op.puntos_vencidos} de ${op.puntos_programables})</div>
      <div class="barra"><span style="width:${op.cumplimiento_pct}%"></span></div>
    </div>
    <p class="text-muted" style="margin-top:12px">
      Los puntos con frecuencia "por orden" no cuentan aquí: no tienen ciclo que vencer.
    </p>`;
}

function bloqueOrdenes(ot) {
  if (!ot.recibidas) {
    return `<div class="center-msg">No entraron órdenes de trabajo en el período.</div>`;
  }
  const pct = ot.atendidas ? Math.round((ot.dentro_24h / ot.atendidas) * 100) : 0;
  return `
    <div class="mini-kpis">
      <div><span class="mk-val">${ot.recibidas}</span><span class="mk-lbl">recibidas</span></div>
      <div><span class="mk-val">${ot.atendidas}</span><span class="mk-lbl">atendidas</span></div>
      <div><span class="mk-val">${horasLegibles(ot.horas_mediana)}</span><span class="mk-lbl">mediana de respuesta</span></div>
    </div>
    <div style="margin-top:16px">
      <div class="text-muted">Atendidas dentro de 24 horas (${ot.dentro_24h} de ${ot.atendidas})</div>
      <div class="barra"><span style="width:${pct}%"></span></div>
    </div>
    <p class="text-muted" style="margin-top:12px">
      Se usa la mediana y no el promedio: una orden que quedó abierta tres
      semanas no debe arruinar el indicador de todo el mes.
    </p>`;
}

// ═════════════════════════════════════════════════════════════════════════
// MAPA / PLANOS
//
// Un plano es la imagen que ASA ya tiene del hotel (PDF exportado a imagen,
// foto del cartel de evacuación, croquis hecho a mano). Encima se colocan los
// puntos como pines.
//
// Las coordenadas se guardan en PORCENTAJE (0–100), no en píxeles: así el
// mismo pin cae en el mismo lugar en el panel de escritorio y en el teléfono
// del técnico, sin importar a qué tamaño se muestre la imagen.
// ═════════════════════════════════════════════════════════════════════════
async function tabMapa(cuerpo, sitioId, areas) {
  cuerpo.innerHTML = `<div class="center-msg">Cargando planos…</div>`;
  const planos = await get(`/sitios/${sitioId}/planos`);

  if (!planos.length) {
    cuerpo.innerHTML = `
      <div class="center-msg" style="padding:30px">
        <p>Esta planta todavía no tiene planos cargados.</p>
        <p class="text-muted">
          Sube la imagen del plano y después coloca encima los puntos de control.
          El técnico la verá en su app cuando no sepa dónde queda un punto.
        </p>
        <button class="btn btn-primary" id="mapa-subir">Subir un plano</button>
      </div>`;
    $("#mapa-subir").addEventListener("click", () =>
      modalSubirPlano(sitioId, areas, () => tabMapa(cuerpo, sitioId, areas))
    );
    return;
  }

  cuerpo.innerHTML = `
    <div class="toolbar">
      <select id="mapa-plano">
        ${planos.map((p) => `<option value="${p.id}">${esc(p.nombre)} · ${p.puntos.length} puntos</option>`).join("")}
      </select>
      <span class="toolbar-sep"></span>
      <button class="btn btn-sm" id="mapa-subir">+ Plano</button>
      <button class="btn btn-sm btn-danger" id="mapa-borrar">Quitar plano</button>
    </div>
    <div class="mapa-wrap">
      <div class="mapa-lienzo" id="mapa-lienzo"></div>
      <aside class="mapa-lateral">
        <div class="mapa-ayuda" id="mapa-ayuda">
          Elige un punto de la lista y después toca el plano para colocarlo.
        </div>
        <input type="search" id="mapa-buscar" placeholder="Buscar punto…" />
        <div id="mapa-pendientes"></div>
      </aside>
    </div>`;

  let planoActual = planos[0];
  let puntoArmado = null;
  let sinUbicar = [];

  async function cargarSinUbicar() {
    const r = await get(`/puntos?sitio_id=${sitioId}`);
    const todos = [...(r.realizados || []), ...(r.pendientes || [])];
    const colocados = new Set(planoActual.puntos.map((p) => p.id));
    sinUbicar = todos.filter((p) => !colocados.has(p.id) && !p.plano_id);
    pintarLateral();
  }

  function pintarLateral(filtro = "") {
    const f = filtro.toLowerCase();
    const lista = sinUbicar.filter(
      (p) => !f || `${p.codigo_visible} ${p.nombre || ""} ${p.area_nombre || ""}`.toLowerCase().includes(f)
    );
    $("#mapa-pendientes").innerHTML = lista.length
      ? `<div class="text-muted" style="margin:8px 0">${sinUbicar.length} sin colocar</div>` +
        lista
          .slice(0, 80)
          .map(
            (p) => `
          <div class="pto-item${puntoArmado?.id === p.id ? " armado" : ""}" data-id="${p.id}">
            <span>${p.tipo_icono || "📍"}</span>
            <div>
              <div class="pto-cod">${esc(p.numero_habitacion || p.codigo_visible)}</div>
              <div class="pto-area">${esc(p.area_nombre || "")}</div>
            </div>
          </div>`
          )
          .join("")
      : `<div class="center-msg">Todos los puntos están colocados. 🎉</div>`;

    $$("#mapa-pendientes .pto-item").forEach((el) =>
      el.addEventListener("click", () => {
        puntoArmado = sinUbicar.find((p) => p.id === el.dataset.id);
        $("#mapa-ayuda").innerHTML =
          `Ahora toca el plano donde está <strong>${esc(puntoArmado.codigo_visible)}</strong>.`;
        $("#mapa-ayuda").classList.add("activa");
        pintarLateral($("#mapa-buscar").value);
      })
    );
  }

  function pintarPlano() {
    $("#mapa-lienzo").innerHTML = `
      <div class="plano" id="plano">
        <img src="${esc(planoActual.imagen_url)}" alt="${esc(planoActual.nombre)}" />
        ${planoActual.puntos
          .map(
            (p) => `
          <button class="pin" data-id="${p.id}"
                  style="left:${p.plano_x}%;top:${p.plano_y}%;background:${esc(p.asa_tipos_punto?.color || "#32539C")}"
                  title="${esc(p.codigo_visible)}">
            ${p.asa_tipos_punto?.icono || "•"}
          </button>`
          )
          .join("")}
      </div>`;

    const plano = $("#plano");

    plano.addEventListener("click", async (ev) => {
      if (!puntoArmado || ev.target.closest(".pin")) return;
      const img = plano.querySelector("img");
      const caja = img.getBoundingClientRect();
      const x = ((ev.clientX - caja.left) / caja.width) * 100;
      const y = ((ev.clientY - caja.top) / caja.height) * 100;
      if (x < 0 || x > 100 || y < 0 || y > 100) return;

      try {
        await patch(`/puntos/${puntoArmado.id}/plano`, {
          plano_id: planoActual.id,
          plano_x: Number(x.toFixed(2)),
          plano_y: Number(y.toFixed(2)),
        });
        toast(`${puntoArmado.codigo_visible} colocado`);
        puntoArmado = null;
        $("#mapa-ayuda").classList.remove("activa");
        $("#mapa-ayuda").textContent = "Elige un punto de la lista y después toca el plano para colocarlo.";
        await tabMapa(cuerpo, sitioId, areas);   // recargar con el pin nuevo
      } catch (e) {
        toast(e.message, true);
      }
    });

    $$("#plano .pin").forEach((pin) =>
      pin.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const p = planoActual.puntos.find((x) => x.id === pin.dataset.id);
        if (!confirm(`¿Quitar ${p.codigo_visible} del plano? El punto no se borra, solo deja de tener posición.`)) return;
        await patch(`/puntos/${p.id}/plano`, { plano_id: null, plano_x: null, plano_y: null });
        toast("Punto quitado del plano");
        await tabMapa(cuerpo, sitioId, areas);
      })
    );
  }

  $("#mapa-plano").addEventListener("change", async (e) => {
    planoActual = planos.find((p) => p.id === e.target.value);
    pintarPlano();
    await cargarSinUbicar();
  });
  $("#mapa-subir").addEventListener("click", () =>
    modalSubirPlano(sitioId, areas, () => tabMapa(cuerpo, sitioId, areas))
  );
  $("#mapa-borrar").addEventListener("click", async () => {
    if (!confirm(`¿Quitar el plano "${planoActual.nombre}"? Los puntos conservan su posición por si lo vuelves a subir.`)) return;
    await del(`/sitios/planos/${planoActual.id}`);
    toast("Plano quitado");
    await tabMapa(cuerpo, sitioId, areas);
  });
  $("#mapa-buscar").addEventListener("input", (e) => pintarLateral(e.target.value.trim()));

  pintarPlano();
  await cargarSinUbicar();
}

function modalSubirPlano(sitioId, areas, onSaved) {
  openModal({
    title: "Subir un plano",
    bodyHTML:
      `<p class="text-muted">
         Sirve cualquier imagen del hotel: un PDF exportado a PNG, la foto del
         cartel de evacuación o un croquis. Máximo 20 MB.
       </p>` +
      campo("Nombre", `<input name="nombre" required placeholder="Planta baja — cocinas" />`) +
      campo("Área (opcional)", `<select name="area_id"><option value="">Toda la planta</option>${opciones(areas, null, (a) => a.id, (a) => a.nombre)}</select>`) +
      campo("Imagen", `<input name="archivo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" required />`),
    submitLabel: "Subir",
    async onSubmit(fd) {
      const file = fd.get("archivo");
      if (!file || !file.size) throw new Error("Elige una imagen");
      if (file.size > 20 * 1024 * 1024) throw new Error("La imagen pasa de 20 MB");

      await post(`/sitios/${sitioId}/planos/subir`, {
        nombre: (fd.get("nombre") || "").trim(),
        area_id: fd.get("area_id") || null,
        tipo_mime: file.type || "image/png",
        archivo_base64: await leerBase64(file),
      });
      closeModal();
      toast("Plano subido");
      onSaved?.();
    },
  });
}

// ═════════════════════════════════════════════════════════════════════════
// CORRECCIÓN MASIVA DE ÁREAS
//
// Dos cosas distintas que se confunden seguido:
//
//   · RENOMBRAR un área ("Habitación huested" → "Habitación huésped") ya
//     afecta a todos sus puntos de una vez. No hay nada masivo que hacer: los
//     puntos cuelgan del área por id, no guardan el texto. Se edita una vez y
//     los 583 quedan corregidos.
//
//   · Lo que sí hacía falta es arreglar cuando los PUNTOS quedaron en el área
//     equivocada. Para eso están las dos funciones de abajo: fusionar áreas
//     duplicadas y mover puntos de un área a otra.
//
// Las dos muestran primero cuántos puntos se van a tocar y solo escriben al
// confirmar, porque son operaciones que agarran cientos de filas de un golpe.
// ═════════════════════════════════════════════════════════════════════════

function modalFusionarAreas(sitioId, areas, onSaved) {
  if (areas.length < 2) {
    toast("Hacen falta al menos dos áreas para fusionar", true);
    return;
  }
  const etiqueta = (a) => `${a.nombre}${a.puntos_total != null ? ` (${a.puntos_total} puntos)` : ""}`;

  openModal({
    title: "Fusionar dos áreas",
    large: true,
    bodyHTML:
      `<p class="text-muted">
         Para áreas duplicadas del sistema anterior, del tipo "buffet" y
         "Buffet central". Los puntos del área que desaparece se pasan a la que
         se queda.
       </p>` +
      campo("Área que desaparece",
        `<select name="origen" required>${opciones(areas, null, (a) => a.id, etiqueta)}</select>`) +
      campo("Área que se queda",
        `<select name="destino" required>${opciones(areas, null, (a) => a.id, etiqueta)}</select>`) +
      `<div id="fusion-previa"></div>`,
    submitLabel: "Revisar",
    async onSubmit(fd) {
      const origen = fd.get("origen");
      const destino = fd.get("destino");
      if (origen === destino) throw new Error("Elegiste la misma área dos veces");

      const boton = $("#asa-modal-submit");
      if (boton.dataset.confirmar !== "si") {
        const r = await post(`/sitios/areas/${origen}/fusionar`, { destino_id: destino, simular: true });
        $("#fusion-previa").innerHTML = `
          <div class="resumen-import">
            Se moverían <strong>${r.moverian}</strong> punto(s) de
            <strong>${esc(r.origen)}</strong> a <strong>${esc(r.destino)}</strong>,
            y <strong>${esc(r.origen)}</strong> quedaría dada de baja.
          </div>`;
        boton.dataset.confirmar = "si";
        boton.textContent = "Confirmar fusión";
        boton.disabled = false;
        return;
      }

      const r = await post(`/sitios/areas/${origen}/fusionar`, { destino_id: destino });
      closeModal();
      toast(`${r.movidos} puntos movidos a ${r.destino}`);
      onSaved?.();
    },
  });
}

function modalMoverPuntos(sitioId, areas, tipos, onSaved) {
  const etiqueta = (a) => `${a.nombre}${a.puntos_total != null ? ` (${a.puntos_total})` : ""}`;

  openModal({
    title: "Mover puntos de área",
    large: true,
    bodyHTML:
      `<p class="text-muted">
         Mueve de golpe todos los puntos que cumplan el filtro. Útil cuando una
         carga quedó apuntando al área equivocada.
       </p>` +
      campo("Vienen de",
        `<select name="origen">
           <option value="">Cualquier área</option>
           <option value="null">Sin área asignada</option>
           ${opciones(areas, null, (a) => a.id, etiqueta)}
         </select>`) +
      campo("Solo del tipo",
        `<select name="tipo"><option value="">Todos los tipos</option>${opciones(tipos, null, (t) => t.codigo, (t) => t.nombre)}</select>`) +
      campo("Pasan a",
        `<select name="destino" required>${opciones(areas, null, (a) => a.id, etiqueta)}</select>`) +
      `<div id="mover-previa"></div>`,
    submitLabel: "Revisar",
    async onSubmit(fd) {
      const cuerpo = {
        sitio_id: sitioId,
        area_origen_id: fd.get("origen") || undefined,
        tipo_codigo: fd.get("tipo") || undefined,
        area_destino_id: fd.get("destino"),
      };

      const boton = $("#asa-modal-submit");
      if (boton.dataset.confirmar !== "si") {
        const r = await patch("/puntos/area", { ...cuerpo, simular: true });
        if (!r.moverian) {
          $("#mover-previa").innerHTML =
            `<div class="resumen-import">Ningún punto cumple ese filtro. Revisa el origen y el tipo.</div>`;
          boton.disabled = false;
          return;
        }
        $("#mover-previa").innerHTML = `
          <div class="resumen-import">Se moverían <strong>${r.moverian}</strong> punto(s).</div>`;
        boton.dataset.confirmar = "si";
        boton.textContent = "Confirmar";
        boton.disabled = false;
        return;
      }

      const r = await patch("/puntos/area", cuerpo);
      closeModal();
      toast(`${r.movidos} puntos movidos`);
      onSaved?.();
    },
  });
}

// ═════════════════════════════════════════════════════════════════════════
// BAJA DE PUNTOS DE CONTROL
//
// Es baja lógica: el punto queda inactivo, desaparece de la ruta del técnico
// y de los reportes, pero su historial de inspecciones sigue existiendo. Un
// borrado real arrastraría en cascada las inspecciones, que es justo lo que el
// hotel exige conservar en auditoría.
//
// Efecto colateral bueno: el QR sigue reservado, así que una baja por error se
// deshace sin reimprimir la etiqueta.
// ═════════════════════════════════════════════════════════════════════════
async function darDeBajaPunto(punto, onSaved) {
  if (!confirm(
    `¿Dar de baja ${punto.codigo_visible}?\n\n` +
    `Deja de aparecer en la ruta del técnico y en los reportes. Su historial ` +
    `se conserva y la etiqueta QR queda reservada, así que se puede reactivar.`
  )) return;

  try {
    await del(`/puntos/${punto.id}`);
    closeModal();
    toast(`${punto.codigo_visible} dado de baja`);
    onSaved?.();
  } catch (e) {
    toast(e.message, true);
  }
}

function modalEliminarPuntos(sitioId, areas, tipos, onSaved) {
  openModal({
    title: "Dar de baja puntos en masa",
    large: true,
    bodyHTML:
      `<p class="text-muted">
         Da de baja todos los puntos que cumplan el filtro. Hace falta al menos
         un filtro: sin él borrarías la planta completa de un clic.
       </p>` +
      campo("Área", `<select name="area_id"><option value="">Todas</option>${opciones(areas, null, (a) => a.id, (a) => a.nombre)}</select>`) +
      campo("Tipo", `<select name="tipo_codigo"><option value="">Todos</option>${opciones(tipos, null, (t) => t.codigo, (t) => t.nombre)}</select>`) +
      `<div id="baja-previa"></div>`,
    submitLabel: "Revisar",
    async onSubmit(fd) {
      const area_id = fd.get("area_id") || undefined;
      const tipo_codigo = fd.get("tipo_codigo") || undefined;
      if (!area_id && !tipo_codigo) throw new Error("Elige al menos un área o un tipo");

      const cuerpo = { sitio_id: sitioId, area_id, tipo_codigo };
      const boton = $("#asa-modal-submit");

      if (boton.dataset.confirmar !== "si") {
        const r = await post("/puntos/eliminar", { ...cuerpo, simular: true });
        if (!r.eliminarian) {
          $("#baja-previa").innerHTML =
            `<div class="resumen-import">Ningún punto cumple ese filtro.</div>`;
          boton.disabled = false;
          return;
        }
        $("#baja-previa").innerHTML = `
          <div class="resumen-import" style="background:#fef2f2;color:#b91c1c">
            Se darían de baja <strong>${r.eliminarian}</strong> punto(s).
            Su historial se conserva y se pueden reactivar.
          </div>`;
        boton.dataset.confirmar = "si";
        boton.textContent = `Dar de baja ${r.eliminarian}`;
        boton.classList.add("btn-danger");
        boton.disabled = false;
        return;
      }

      const r = await post("/puntos/eliminar", cuerpo);
      closeModal();
      toast(`${r.eliminados} puntos dados de baja`);
      onSaved?.();
    },
  });
}

// ═════════════════════════════════════════════════════════════════════════
// ACCESOS DEL HOTEL
//
// Cuentas de solo lectura para el personal de calidad. Cada cuenta ve
// ÚNICAMENTE las plantas que se le asignen: la encargada de calidad de
// Iberostar Comunes no ve nada de Coral Bávaro, porque son dependencias
// distintas con responsables distintos.
//
// El filtro no es cosa de la interfaz: el backend lo aplica en cada consulta
// (middleware cargarAlcance + filtrarPorSitio contra asa_usuario_sitios), así
// que aunque alguien llame la API a mano no puede ver otra planta.
// ═════════════════════════════════════════════════════════════════════════
async function viewAccesosHotel(content) {
  content.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Accesos del hotel</h2>
        <div class="actions">
          <button class="btn btn-primary" id="btn-nuevo-acceso">+ Nueva cuenta</button>
        </div>
      </div>
      <p class="text-muted">
        Cuentas de solo lectura para el personal de calidad de cada hotel.
        Ven en tiempo real lo que el técnico registra, solo de las plantas
        que les asignes.
      </p>
      <div id="accesos-tabla"><div class="center-msg">Cargando…</div></div>
    </div>`;

  async function cargar() {
    const [cuentas, plantas] = await Promise.all([get("/usuarios/portal"), get("/sitios")]);

    $("#accesos-tabla").innerHTML = tableHTML(
      [
        { key: "nombre_completo", label: "Persona", fmt: (u) => esc(u.nombre_completo || "—") },
        { key: "email", label: "Correo" },
        {
          key: "plantas",
          label: "Plantas que ve",
          fmt: (u) => {
            const ss = (u.asa_usuario_sitios || []).map((s) => s.asa_sitios?.nombre).filter(Boolean);
            return ss.length
              ? ss.map((n) => `<span class="chip">${esc(n)}</span>`).join(" ")
              : `<span class="estado-chip pendiente">Sin plantas</span>`;
          },
        },
        {
          key: "activo",
          label: "Estado",
          fmt: (u) =>
            u.activo
              ? `<span class="estado-chip hecho">Activa</span>`
              : `<span class="estado-chip fuera">Desactivada</span>`,
        },
        { key: "ultimo_acceso", label: "Último acceso", fmt: (u) => (u.ultimo_acceso ? fmtDateTime(u.ultimo_acceso) : "Nunca entró") },
      ],
      cuentas,
      "Todavía no hay cuentas de hotel. Crea una por cada encargado de calidad."
    );

    $("#accesos-tabla").querySelectorAll("tr[data-id]").forEach((tr) =>
      tr.addEventListener("click", () =>
        modalAcceso(cuentas.find((u) => u.id === tr.dataset.id), plantas, cargar)
      )
    );

    $("#btn-nuevo-acceso").onclick = () => modalAcceso(null, plantas, cargar);
  }
  await cargar();
}

function modalAcceso(cuenta, plantas, onSaved) {
  const esNueva = !cuenta;
  const asignadas = new Set((cuenta?.asa_usuario_sitios || []).map((s) => s.sitio_id));

  const listaPlantas = plantas
    .map(
      (p) => `
      <label class="campo-check">
        <input type="checkbox" name="sitio" value="${p.id}" ${asignadas.has(p.id) ? "checked" : ""} />
        ${esc(p.nombre)}
      </label>`
    )
    .join("");

  openModal({
    title: esNueva ? "Nueva cuenta de hotel" : `Editar acceso de ${cuenta.nombre_completo || cuenta.email}`,
    large: true,
    bodyHTML:
      (esNueva
        ? campo("Nombre de la persona", `<input name="nombre_completo" required placeholder="Leticia Álvarez" />`) +
          campo("Correo", `<input name="email" type="email" required placeholder="calidad.comunes@iberostar.com" />`) +
          campo("Contraseña", `<input name="password" type="password" required minlength="8" />`,
            "Mínimo 8 caracteres. Entrégasela a la persona por un canal seguro; el sistema guarda solo un hash.")
        : `<div class="campo"><span>Correo</span>
             <code class="qr-fijo">${esc(cuenta.email)}</code>
             <small class="ayuda">El correo no se cambia. Si hace falta otro, desactiva esta cuenta y crea una nueva.</small>
           </div>`) +
      `<div class="campo">
         <span>Plantas que puede ver</span>
         <div class="lista-plantas">${listaPlantas}</div>
         <small class="ayuda">
           Solo verá estas. Es el mismo filtro que aplica el servidor en cada
           consulta, no un escondite de la pantalla.
         </small>
       </div>` +
      (esNueva
        ? ""
        : `<button type="button" class="btn btn-danger" id="acceso-estado" style="margin-top:6px">
             ${cuenta.activo ? "Desactivar esta cuenta" : "Reactivar esta cuenta"}
           </button>`),
    onMount() {
      const b = $("#acceso-estado");
      if (!b) return;
      b.addEventListener("click", async () => {
        try {
          await patch(`/usuarios/${cuenta.id}/activo`, { activo: !cuenta.activo });
          closeModal();
          toast(cuenta.activo ? "Cuenta desactivada" : "Cuenta reactivada");
          onSaved?.();
        } catch (e) {
          toast(e.message, true);
        }
      });
    },
    async onSubmit(fd) {
      const sitios = fd.getAll("sitio");
      if (!sitios.length) throw new Error("Asigna al menos una planta: sin plantas la cuenta no ve nada");

      if (esNueva) {
        await post("/usuarios/portal", {
          nombre_completo: (fd.get("nombre_completo") || "").trim(),
          email: (fd.get("email") || "").trim().toLowerCase(),
          password: fd.get("password"),
          sitios,
        });
      } else {
        await put(`/usuarios/portal/${cuenta.id}/sitios`, { sitios });
      }
      closeModal();
      toast(esNueva ? "Cuenta creada" : "Plantas actualizadas");
      onSaved?.();
    },
  });
}

// ═════════════════════════════════════════════════════════════════════════
// ESTRATEGIA DE LOS PUNTOS
//
// La cadena completa, que es donde se pierde todo el mundo:
//
//   punto → estrategia_id → preguntas de esa estrategia
//                           cuyo tipo_punto_id sea el del punto (o "todos")
//
// Si el técnico no ve preguntas, es uno de estos tres casos:
//   · el punto no tiene estrategia asignada
//   · la estrategia que tiene no es la que estás editando
//   · las preguntas están en esa estrategia pero para OTRO tipo de punto
//
// La columna "Preguntas" del listado de puntos muestra el resultado final de
// esa cadena, así no hay que adivinar.
// ═════════════════════════════════════════════════════════════════════════
let ESTRATEGIAS_CACHE = null;

async function estrategiasLista() {
  if (!ESTRATEGIAS_CACHE) ESTRATEGIAS_CACHE = await get("/estrategias");
  return ESTRATEGIAS_CACHE;
}

function modalEstrategiaMasiva(sitioId, areas, tipos, estrategias, onSaved) {
  openModal({
    title: "Asignar estrategia en masa",
    large: true,
    bodyHTML:
      `<p class="text-muted">
         La estrategia decide qué preguntas ve el técnico al escanear. Filtra
         por tipo para aplicar la estrategia correcta a cada grupo de puntos.
       </p>` +
      campo("Área", `<select name="area_id"><option value="">Todas</option>${opciones(areas, null, (a) => a.id, (a) => a.nombre)}</select>`) +
      campo("Tipo de punto", `<select name="tipo_codigo"><option value="">Todos</option>${opciones(tipos, null, (t) => t.codigo, (t) => t.nombre)}</select>`) +
      campo("Estrategia a aplicar",
        `<select name="estrategia_id" required>${opciones(estrategias, null, (e) => e.id, (e) => e.nombre)}</select>`) +
      `<div id="estr-previa"></div>`,
    submitLabel: "Revisar",
    async onSubmit(fd) {
      const cuerpo = {
        sitio_id: sitioId,
        area_id: fd.get("area_id") || undefined,
        tipo_codigo: fd.get("tipo_codigo") || undefined,
        estrategia_id: fd.get("estrategia_id"),
      };
      const boton = $("#asa-modal-submit");

      if (boton.dataset.confirmar !== "si") {
        const r = await patch("/puntos/estrategia", { ...cuerpo, simular: true });
        const aviso =
          r.preguntas_para_ese_tipo === 0
            ? `<div style="margin-top:8px;color:#b91c1c">
                 Ojo: esa estrategia no tiene ninguna pregunta para ese tipo de punto.
                 El técnico seguiría viendo solo estado y nivel de actividad.
               </div>`
            : r.preguntas_para_ese_tipo != null
            ? `<div style="margin-top:8px">El técnico vería <strong>${r.preguntas_para_ese_tipo}</strong> pregunta(s).</div>`
            : "";
        $("#estr-previa").innerHTML = `
          <div class="resumen-import">
            Se cambiarían <strong>${r.cambiarian}</strong> punto(s).${aviso}
          </div>`;
        boton.dataset.confirmar = "si";
        boton.textContent = "Confirmar";
        boton.disabled = false;
        return;
      }

      const r = await patch("/puntos/estrategia", cuerpo);
      ESTRATEGIAS_CACHE = null;
      closeModal();
      toast(`${r.actualizados} puntos actualizados`);
      onSaved?.();
    },
  });
}
