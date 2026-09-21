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
function modalPunto(sitioId, punto, areas, tipos, onSaved) {
  const esNuevo = !punto;
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
      (esNuevo
        ? campo("Etiqueta QR ya impresa", `<input name="qr_token" placeholder="C205050474718" />`,
            "Déjalo vacío para que el sistema genere un QR nuevo. Si pegas una etiqueta de las que ya tienes impresas, escribe su código aquí.")
        : `<div class="campo"><span>Etiqueta QR</span><code class="qr-fijo">${esc(punto.qr_token)}</code>
             <small class="ayuda">El QR no se puede cambiar. Si la etiqueta se dañó, desactiva el punto y crea otro.</small></div>`),
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
