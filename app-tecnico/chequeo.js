// ═════════════════════════════════════════════════════════════════════════
// chequeo.js — El parte diario del vehículo, dentro de ASA Técnico
//
// Antes vivía en el CRM del taller (solidoautoservicio). Ahora el técnico de
// ASA lo llena desde su propia app: entra como siempre y, además de su ruta de
// puntos, tiene "Chequeo del vehículo".
//
// **No se escribe nada.** El único teclado de toda la pantalla es el numérico
// del odómetro, y sale con el número del día anterior ya puesto para que solo
// se cambie lo que hizo falta:
//
//   · Combustible: flechas ◀ ▶ en octavos — E, ⅛, ¼, ⅜, ½, ⅝, ¾, ⅞, F. El
//     conductor reporta lo que ve en la aguja, no un porcentaje.
//   · Checklist: todos los puntos arrancan en verde. Se toca solo lo que está
//     mal; un segundo toque lo pone en N/A y un tercero lo devuelve a BIEN.
//   · Fallas: se escogen de un catálogo escrito en su idioma — "hala hacia un
//     lado", "bota humo negro" — no en el del mecánico.
//
// Las rutas son públicas (/flota/publico/*) a propósito: no exigen el token
// del técnico, así que el mismo parte lo puede llenar un chofer que no sea
// técnico de plagas desde el enlace suelto.
// ═════════════════════════════════════════════════════════════════════════

const OCTAVOS_TXT = ["E", "⅛", "¼", "⅜", "½", "⅝", "¾", "⅞", "F"];
const ANGULOS = [
  ["FRONTAL", "Frente"],
  ["TRASERA", "Atrás"],
  ["LATERAL_IZQ", "Lado izquierdo"],
  ["LATERAL_DER", "Lado derecho"],
  ["TABLERO", "Tablero"],
];

let FLOTA = null;          // catálogos del arranque
const BORRADOR = "asa_chequeo_borrador";

async function arranqueFlota() {
  if (FLOTA) return FLOTA;
  try {
    FLOTA = await GET("/flota/publico/arranque");
    await guardarCache("flota-arranque", FLOTA);
  } catch {
    FLOTA = await leerCache("flota-arranque");
    if (!FLOTA) throw new Error("Sin señal y sin datos guardados del chequeo. Conéctate una vez para descargarlos.");
  }
  return FLOTA;
}

// El técnico ya entró con su cuenta, así que no se le pregunta quién es: se
// busca su nombre en la lista de conductores. Si no está (un técnico que no
// maneja, o un nombre escrito distinto), entonces sí se le pide que se escoja.
function conductorDelTecnico(conductores) {
  const mio = (USUARIO?.nombre || "").toLowerCase().trim();
  if (!mio) return null;
  const normal = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  return conductores.find((c) => normal(c.nombre) === normal(mio))
      || conductores.find((c) => normal(c.nombre).split(" ")[0] === normal(mio).split(" ")[0])
      || null;
}

// ── Pantalla ─────────────────────────────────────────────────────────────
async function pantallaChequeo() {
  encabezado("Chequeo del vehículo", "Parte del día");
  const cuerpo = document.createElement("div");
  cuerpo.className = "contenido";
  cuerpo.innerHTML = `<div class="cargando">Cargando…</div>`;
  app().appendChild(cuerpo);

  let datos;
  try {
    datos = await arranqueFlota();
  } catch (e) {
    cuerpo.innerHTML = `<div class="vacio"><span class="emoji">🚐</span>${esc(e.message)}</div>`;
    return;
  }

  if (!datos.vehiculos.length) {
    cuerpo.innerHTML = `<div class="vacio"><span class="emoji">🚐</span>
      Todavía no hay vehículos cargados en la flota. Se agregan desde el panel, en Flota → Vehículos.</div>`;
    return;
  }

  const conductor = conductorDelTecnico(datos.conductores);
  const hechos = new Set(datos.chequeos_hoy.map((c) => `${c.vehiculo_id}:${c.turno}`));

  cuerpo.innerHTML = `
    ${conductor
      ? `<div class="tarjeta"><p>Parte a nombre de <strong>${esc(conductor.nombre)}</strong></p></div>`
      : `<div class="campo">
           <label>¿Quién llena el parte?</label>
           <select id="chq-conductor" class="sel-plano">
             <option value="">Elige tu nombre…</option>
             ${datos.conductores.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("")}
           </select>
         </div>`}

    <div class="grupo-area">¿Cuál vehículo?</div>
    <div id="chq-vehiculos">
      ${datos.vehiculos.map((v) => {
        const ya = hechos.has(`${v.id}:SALIDA`);
        return `
        <div class="punto ${ya ? "hecho" : ""}" data-veh="${v.id}">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700">${esc(v.codigo)} · ${esc(v.placa)}</div>
            <div style="font-size:13px;color:var(--gris-600)">
              ${esc([v.marca, v.modelo, v.anio].filter(Boolean).join(" "))}
            </div>
          </div>
          ${ya ? `<span class="etiqueta verde">Ya reportado hoy</span>` : `<span class="etiqueta">Pendiente</span>`}
        </div>`;
      }).join("")}
    </div>
    <p style="color:var(--gris-600);font-size:13px;margin-top:14px">
      Si ya lo reportaste hoy y algo cambió, tócalo otra vez: el parte se reemplaza,
      no se duplica.
    </p>`;

  cuerpo.querySelectorAll("[data-veh]").forEach((el) =>
    el.addEventListener("click", () => {
      const cid = conductor?.id || $("#chq-conductor")?.value;
      if (!cid) return aviso("Primero elige tu nombre", "error");
      formularioChequeo(Number(el.dataset.veh), Number(cid), datos);
    })
  );
}

// ── Formulario del parte ─────────────────────────────────────────────────
async function formularioChequeo(vehiculoId, conductorId, datos) {
  const vehiculo = datos.vehiculos.find((v) => v.id === vehiculoId);
  encabezado(`${vehiculo.codigo} · ${vehiculo.placa}`, "Parte del día");
  const cuerpo = document.createElement("div");
  cuerpo.className = "contenido";
  cuerpo.innerHTML = `<div class="cargando">Buscando el último parte…</div>`;
  app().appendChild(cuerpo);

  let estado;
  try {
    estado = await GET(`/flota/publico/vehiculo/${vehiculoId}/estado`);
  } catch {
    estado = { km_sugerido: vehiculo.km_actual || 0, combustible_anterior: 4, fallas_abiertas: [] };
  }

  // Borrador: si entra una llamada o se cae la señal a media pantalla, al
  // volver está todo ahí. Se guarda por vehículo y día.
  const claveBorrador = `${BORRADOR}:${vehiculoId}:${hoy()}`;
  const previo = leerJSON(claveBorrador) || {};

  const porCategoria = {};
  for (const i of datos.checklist) (porCategoria[i.categoria] = porCategoria[i.categoria] || []).push(i);

  const fallasPorCategoria = {};
  for (const f of datos.fallas) (fallasPorCategoria[f.categoria] = fallasPorCategoria[f.categoria] || []).push(f);

  cuerpo.innerHTML = `
    ${estado.fallas_abiertas?.length ? `
      <div class="tarjeta" style="background:var(--ambar-claro);border-color:var(--ambar)">
        <strong>Fallas todavía abiertas en esta unidad:</strong>
        <div style="margin-top:6px">${estado.fallas_abiertas.map((f) => `<span class="etiqueta ambar">${esc(f.falla_etiqueta)}</span>`).join(" ")}</div>
      </div>` : ""}

    <form id="form-chequeo">
      <div class="grupo-area">Turno</div>
      <div class="campo">
        ${botonera("turno", [["SALIDA", "Salida"], ["ENTRADA", "Entrada"]], previo.turno || "SALIDA", "dos")}
      </div>

      <div class="grupo-area">Kilometraje</div>
      <div class="campo">
        <label for="chq-km">Lo que marca el odómetro ahora</label>
        <input type="number" id="chq-km" inputmode="numeric" step="1"
               value="${esc(previo.km ?? estado.km_sugerido)}" />
        <small class="ayuda">Viene con el número del último parte: cámbialo solo si hace falta.</small>
      </div>

      <div class="grupo-area">Combustible</div>
      <div class="campo">
        <div class="combustible">
          <button type="button" class="comb-btn" id="comb-menos">◀</button>
          <div class="comb-valor" id="comb-valor">${OCTAVOS_TXT[previo.combustible ?? estado.combustible_anterior ?? 4]}</div>
          <button type="button" class="comb-btn" id="comb-mas">▶</button>
        </div>
        <div class="comb-barra"><span id="comb-relleno"></span></div>
        <small class="ayuda">Reporta lo que ves en la aguja, no un porcentaje.</small>
      </div>

      <div class="grupo-area">Revisión — toca solo lo que está mal</div>
      ${Object.entries(porCategoria).map(([cat, items]) => `
        <div class="campo">
          <label>${esc(cat)}</label>
          <div class="chk-lista">
            ${items.map((i) => `
              <div class="chk-item ${previo.items?.[i.codigo] || "bien"}" data-item="${esc(i.codigo)}"
                   data-critico="${i.critico ? "1" : ""}" data-etiqueta="${esc(i.etiqueta)}">
                <span class="chk-ic">${esc(i.icono || "•")}</span>
                <span class="chk-txt">${esc(i.etiqueta)}${i.critico ? ` <b>·</b>` : ""}</span>
                <span class="chk-estado">BIEN</span>
              </div>`).join("")}
          </div>
        </div>`).join("")}
      <p style="color:var(--gris-600);font-size:13px">
        Un toque lo pone en MAL, otro en N/A, otro lo devuelve a BIEN. Lo que no
        toques queda como BIEN.
      </p>

      <div class="grupo-area">¿Algo que reportar?</div>
      ${Object.entries(fallasPorCategoria).map(([cat, fs]) => `
        <div class="campo">
          <label>${esc(cat)}</label>
          <div class="chk-lista">
            ${fs.map((f) => `
              <div class="falla-item ${previo.fallas?.includes(f.codigo) ? "activa" : ""}" data-falla="${esc(f.codigo)}">
                <span class="chk-ic">${esc(f.icono || "•")}</span>
                <span class="chk-txt">${esc(f.etiqueta)}</span>
              </div>`).join("")}
          </div>
        </div>`).join("")}

      <div class="grupo-area">Fotos</div>
      <div class="campo">
        <div class="fotos-angulos">
          ${ANGULOS.map(([codigo, etiqueta]) => `
            <label class="foto-angulo" data-angulo="${codigo}">
              <input type="file" accept="image/*" capture="environment" hidden />
              <span class="fa-txt">${esc(etiqueta)}</span>
              <span class="fa-marca">+</span>
            </label>`).join("")}
        </div>
        <small class="ayuda">Cinco ángulos. Se achican en el teléfono antes de subirlas.</small>
      </div>

      <div class="campo">
        <label for="chq-obs">Observación (opcional)</label>
        <textarea id="chq-obs" rows="2">${esc(previo.observacion || "")}</textarea>
      </div>

      <div class="pie-fijo">
        <button class="btn" type="submit" id="chq-guardar">✓ Guardar el parte</button>
      </div>
    </form>`;

  // ── Combustible ────────────────────────────────────────────────────────
  let octavos = previo.combustible ?? estado.combustible_anterior ?? 4;
  const pintarComb = () => {
    $("#comb-valor").textContent = OCTAVOS_TXT[octavos];
    $("#comb-relleno").style.width = `${(octavos / 8) * 100}%`;
  };
  $("#comb-menos").addEventListener("click", () => { octavos = Math.max(0, octavos - 1); pintarComb(); vibrar(10); });
  $("#comb-mas").addEventListener("click", () => { octavos = Math.min(8, octavos + 1); pintarComb(); vibrar(10); });
  pintarComb();

  // ── Botoneras (turno) ──────────────────────────────────────────────────
  cuerpo.querySelectorAll("[data-grupo]").forEach((grupo) => {
    grupo.addEventListener("click", (e) => {
      const op = e.target.closest(".opcion");
      if (!op) return;
      grupo.querySelectorAll(".opcion").forEach((o) => o.classList.remove("activa"));
      op.classList.add("activa");
      grupo.dataset.valor = op.dataset.valor;
      vibrar(15);
    });
  });

  // ── Checklist de tres estados ──────────────────────────────────────────
  const CICLO = { bien: "mal", mal: "na", na: "bien" };
  const TEXTO = { bien: "BIEN", mal: "MAL", na: "N/A" };
  cuerpo.querySelectorAll(".chk-item").forEach((el) => {
    const pintar = () => {
      const est = el.classList.contains("mal") ? "mal" : el.classList.contains("na") ? "na" : "bien";
      el.querySelector(".chk-estado").textContent = TEXTO[est];
    };
    pintar();
    el.addEventListener("click", () => {
      const actual = el.classList.contains("mal") ? "mal" : el.classList.contains("na") ? "na" : "bien";
      const siguiente = CICLO[actual];
      el.classList.remove("bien", "mal", "na");
      el.classList.add(siguiente);
      pintar();
      vibrar(siguiente === "mal" ? 30 : 10);
      guardarBorrador();
    });
  });

  cuerpo.querySelectorAll(".falla-item").forEach((el) =>
    el.addEventListener("click", () => {
      el.classList.toggle("activa");
      vibrar(20);
      guardarBorrador();
    })
  );

  // ── Fotos ──────────────────────────────────────────────────────────────
  const fotos = {};
  cuerpo.querySelectorAll(".foto-angulo").forEach((label) => {
    label.querySelector("input").addEventListener("change", async (e) => {
      const archivo = e.target.files[0];
      if (!archivo) return;
      const dataUrl = await reducirImagen(archivo, 1280, 0.65);
      fotos[label.dataset.angulo] = dataUrl;
      label.classList.add("lista");
      label.style.backgroundImage = `url(${dataUrl})`;
      label.querySelector(".fa-marca").textContent = "✓";
    });
  });

  function estadoActual() {
    const items = {};
    cuerpo.querySelectorAll(".chk-item").forEach((el) => {
      const est = el.classList.contains("mal") ? "mal" : el.classList.contains("na") ? "na" : "bien";
      if (est !== "bien") items[el.dataset.item] = est;
    });
    return {
      turno: cuerpo.querySelector('[data-grupo="turno"]').dataset.valor || "SALIDA",
      km: Number($("#chq-km").value) || null,
      combustible: octavos,
      items,
      fallas: [...cuerpo.querySelectorAll(".falla-item.activa")].map((el) => el.dataset.falla),
      observacion: $("#chq-obs").value.trim() || null,
    };
  }

  const guardarBorrador = () => guardarJSON(claveBorrador, estadoActual());
  $("#chq-km").addEventListener("input", guardarBorrador);
  $("#chq-obs").addEventListener("input", guardarBorrador);

  // ── Guardar ────────────────────────────────────────────────────────────
  $("#form-chequeo").addEventListener("submit", async (e) => {
    e.preventDefault();
    const boton = $("#chq-guardar");
    const s = estadoActual();

    if (!s.km) return aviso("Escribe el kilometraje", "error");

    // El kilometraje no retrocede: casi siempre es un dígito de menos al
    // teclear. No se rechaza el parte — dejar a alguien trancado a las 7am es
    // peor que un dato marcado — pero sí se pregunta.
    if (estado.km_sugerido && s.km < estado.km_sugerido) {
      if (!confirm(
        `El último parte marcaba ${estado.km_sugerido} km y escribiste ${s.km}.\n\n` +
        `¿Está bien así? Si te faltó un dígito, cancela y corrígelo.`
      )) return;
    }

    const cuerpoEnvio = {
      vehiculo_id: vehiculoId,
      conductor_id: conductorId,
      turno: s.turno,
      km: s.km,
      combustible_octavos: s.combustible,
      items_mal: Object.entries(s.items).map(([codigo, valor]) => ({ codigo, valor: valor.toUpperCase() })),
      fallas: s.fallas,
      fotos: Object.entries(fotos).map(([angulo, dataUrl]) => ({ angulo, dataUrl })),
      observacion: s.observacion,
    };

    boton.disabled = true;
    boton.textContent = "Guardando…";
    try {
      const r = await POST("/flota/publico/chequeo", cuerpoEnvio);
      localStorage.removeItem(claveBorrador);
      FLOTA = null;   // que el listado vuelva a pedir los partes del día
      aviso(r?.apto_circular === false
        ? "Parte guardado — la unidad quedó marcada como NO APTA"
        : "Parte guardado ✓", r?.apto_circular === false ? "error" : "exito");
      vibrar([40, 30, 80]);
      location.hash = "#/chequeo";
    } catch (err) {
      boton.disabled = false;
      boton.textContent = "✓ Guardar el parte";
      // A diferencia de las inspecciones, el parte no se encola: lleva fotos
      // pesadas y un upsert por vehículo/día/turno. Se guarda el borrador y se
      // avisa, que es más honesto que decir "guardado" y perderlo.
      guardarBorrador();
      aviso(`No se pudo enviar: ${err.message}. Lo que llenaste quedó guardado en el teléfono.`, "error");
    }
  });
}
