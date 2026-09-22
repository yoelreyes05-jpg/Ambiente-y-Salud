// ═════════════════════════════════════════════════════════════════════════
// etiquetas.js — Etiquetas QR ya impresas que no abren ningún punto
//
// El QR principal de un punto no se puede cambiar. Para aprovechar las
// etiquetas que ya están impresas y pegadas, a un punto se le cuelgan
// etiquetas ADICIONALES: escanear cualquiera abre el mismo punto.
//
// Desde aquí la oficina:
//   - verifica un código (escrito o desde una FOTO del QR): si es del grupo
//     impreso por ASA y si ya abre algún punto
//   - lo asigna al punto correcto
//   - carga el grupo de etiquetas impresas (lista de la imprenta)
//   - ve las etiquetas que los técnicos escanearon y no abrieron nada
//
// Se carga antes de app.js. Lo usan tabPuntos (botón "Etiquetas QR") y
// modalPunto (sección de etiquetas adicionales).
// ═════════════════════════════════════════════════════════════════════════

// Lee el QR de una foto (BarcodeDetector si hay; si no, jsQR desde cdnjs).
let _jsqrPromesa = null;
function cargarJsQRPanel() {
  if (window.jsQR) return Promise.resolve();
  _jsqrPromesa ||= new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.js";
    s.onload = ok;
    s.onerror = () => { _jsqrPromesa = null; ko(new Error("No se pudo cargar el lector de QR (¿sin internet?)")); };
    document.head.appendChild(s);
  });
  return _jsqrPromesa;
}
async function leerQRFotoPanel(archivo) {
  const bitmap = await createImageBitmap(archivo);
  if ("BarcodeDetector" in window) {
    try {
      const r = await new BarcodeDetector({ formats: ["qr_code"] }).detect(bitmap);
      if (r.length) return r[0].rawValue;
    } catch {}
  }
  await cargarJsQRPanel();
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d", { willReadFrequently: true });
  for (const lado of [1600, 1000, 700, 2400]) {
    const k = Math.min(1, lado / Math.max(bitmap.width, bitmap.height));
    c.width = Math.round(bitmap.width * k); c.height = Math.round(bitmap.height * k);
    ctx.drawImage(bitmap, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
    if (r?.data) return r.data;
  }
  return null;
}

// Un botón "📷 Desde foto" que devuelve el texto del QR a `alLeer`.
function botonFotoQR(id) {
  return `<label class="btn btn-sm" style="cursor:pointer">📷 Desde foto
            <input type="file" id="${id}" accept="image/*" capture="environment" hidden /></label>`;
}
function engancharFotoQR(input, alLeer, alFallar) {
  input.addEventListener("change", async () => {
    const f = input.files?.[0];
    input.value = "";
    if (!f) return;
    try {
      const texto = await leerQRFotoPanel(f);
      if (!texto) return alFallar("No se encontró un QR en la foto. Que salga nítido y de frente.");
      alLeer(texto);
    } catch (e) {
      alFallar(e.message);
    }
  });
}

// Selector de punto con buscador (los puntos de la planta).
async function elegirPuntoDePlanta(sitioId, contenedor, alElegir) {
  const r = await get(`/puntos?sitio_id=${sitioId}`);
  const todos = [...(r.realizados || []), ...(r.pendientes || [])];
  contenedor.innerHTML = `
    <input type="search" class="et-buscar" placeholder="Busca el punto: habitación, código, área…" style="width:100%" />
    <div class="et-resultados"></div>`;
  const inp = contenedor.querySelector(".et-buscar");
  const res = contenedor.querySelector(".et-resultados");
  const pintar = () => {
    const f = inp.value.trim().toLowerCase();
    const lista = f
      ? todos.filter((p) => `${p.codigo_visible} ${p.numero_habitacion || ""} ${p.punto_nombre || p.nombre || ""} ${p.area_nombre || ""} ${p.tipo_nombre || ""}`.toLowerCase().includes(f))
      : [];
    res.innerHTML = f
      ? lista.length
        ? lista.slice(0, 30).map((p) => `
            <div class="et-item" data-id="${esc(p.id)}" data-cod="${esc(p.codigo_visible)}">
              <strong>${esc(p.codigo_visible)}</strong>
              <span class="text-muted">${esc([p.tipo_icono, p.numero_habitacion ? `Hab. ${p.numero_habitacion}` : p.punto_nombre, p.area_nombre].filter(Boolean).join(" · "))}</span>
            </div>`).join("")
        : `<div class="text-muted" style="padding:8px">Nada con "${esc(inp.value)}".</div>`
      : "";
    res.querySelectorAll(".et-item").forEach((el) => el.addEventListener("click", () => alElegir(el.dataset.id, el.dataset.cod)));
  };
  inp.addEventListener("input", pintar);
  inp.focus();
}

// ── Ventana "Etiquetas QR" de una planta ─────────────────────────────────
async function modalEtiquetasQR(sitioId, onSaved) {
  openModal({
    title: "Etiquetas QR impresas",
    large: true,
    bodyHTML: `
      <div class="et-seccion">
        <h4>1. Verificar y asignar una etiqueta</h4>
        <p class="text-muted">Escribe el código o toma una foto del QR. Te dice si es de las etiquetas impresas
          por ASA y si ya abre algún punto; si está libre, la asignas al punto donde está pegada.</p>
        <div class="toolbar">
          <input id="et-codigo" placeholder="C205050474718 o el texto del QR" style="flex:1;min-width:220px" />
          <button type="button" class="btn btn-sm btn-primary" id="et-verificar">Verificar</button>
          ${botonFotoQR("et-foto")}
        </div>
        <div id="et-resultado"></div>
      </div>

      <div class="et-seccion">
        <h4>2. Escaneadas sin asignar en esta planta</h4>
        <p class="text-muted">Cada vez que un técnico escanea una etiqueta que no abre nada, queda aquí.</p>
        <div id="et-norec"><div class="center-msg" style="padding:14px">Cargando…</div></div>
      </div>

      <div class="et-seccion">
        <h4>3. Grupo de etiquetas impresas</h4>
        <div id="et-lotes" class="text-muted">Cargando…</div>
        <details style="margin-top:8px">
          <summary>Cargar códigos de la imprenta</summary>
          <p class="text-muted">Pega los códigos (uno por línea, o separados por coma) o elige un archivo .txt / .csv.
            Los repetidos se ignoran.</p>
          <div class="toolbar">
            <input id="et-lote" placeholder="Nombre del lote (ej. Imprenta junio 2026)" style="flex:1" />
            <label class="btn btn-sm" style="cursor:pointer">Archivo…<input type="file" id="et-archivo" accept=".txt,.csv,text/plain,text/csv" hidden /></label>
          </div>
          <textarea id="et-lista" rows="4" style="width:100%" placeholder="C205050474718&#10;C205050474719&#10;…"></textarea>
          <button type="button" class="btn btn-sm btn-primary" id="et-cargar" style="margin-top:6px">Cargar al grupo</button>
          <span id="et-cargar-msg" class="text-muted"></span>
        </details>
      </div>`,
    onMount(ov) {
      const q = (s) => ov.querySelector(s);
      let archivoNombre = null;

      async function verificar(texto) {
        const destino = q("#et-resultado");
        const codigo = String(texto || "").trim();
        if (!codigo) return;
        destino.innerHTML = `<div class="text-muted">Verificando…</div>`;
        try {
          const r = await get(`/puntos/etiquetas/estado/${encodeURIComponent(codigo)}`);
          const grupo = r.en_lote
            ? `<span class="estado-chip hecho">Es del grupo impreso${r.lote ? ` · ${esc(r.lote)}` : ""}</span>`
            : `<span class="estado-chip pendiente">No está en el grupo impreso</span>`;
          if (r.asignado) {
            destino.innerHTML = `<div class="et-caja">Código <code>${esc(r.token)}</code> ${grupo}<br>
              ✅ Ya abre el punto <strong>${esc(r.punto?.codigo_visible || "")}</strong>
              ${r.punto ? `· ${esc([r.punto.numero_habitacion ? `Hab. ${r.punto.numero_habitacion}` : r.punto.nombre, r.punto.asa_areas?.nombre, r.punto.asa_sitios?.nombre].filter(Boolean).join(" · "))}` : ""}
              ${r.via === "etiqueta" ? `<br><button type="button" class="btn btn-sm btn-danger" id="et-soltar" style="margin-top:6px">Quitar esta etiqueta de ese punto</button>` : `<br><small class="text-muted">Es el QR principal del punto.</small>`}
            </div>`;
            q("#et-soltar")?.addEventListener("click", async () => {
              if (!confirm(`¿Quitar la etiqueta ${r.token} del punto ${r.punto?.codigo_visible}? Dejará de abrirlo.`)) return;
              try { await api(`/puntos/etiquetas/${encodeURIComponent(r.token)}`, { method: "DELETE" }); toast("Etiqueta quitada"); verificar(r.token); }
              catch (e) { toast(e.message, true); }
            });
            return;
          }
          destino.innerHTML = `<div class="et-caja">Código <code>${esc(r.token)}</code> ${grupo}<br>
              🏷️ <strong>Libre:</strong> no abre ningún punto. ¿Dónde está pegada?
              ${r.en_lote ? "" : `<br><small style="color:#b91c1c">Ojo: no es de las etiquetas que ASA mandó a imprimir. Asígnala solo si estás seguro.</small>`}
              <div id="et-elegir" style="margin-top:8px"></div></div>`;
          await elegirPuntoDePlanta(sitioId, q("#et-elegir"), async (puntoId, cod) => {
            if (!confirm(`¿Asignar la etiqueta ${r.token} al punto ${cod}?`)) return;
            try {
              await post(`/puntos/${puntoId}/etiquetas`, { token: r.token, origen: archivoFoto ? "foto" : "panel" });
              toast(`La etiqueta ${r.token} ya abre ${cod}`);
              verificar(r.token);
              cargarNoReconocidas();
              onSaved?.();
            } catch (e) { toast(e.message, true); }
          });
        } catch (e) {
          destino.innerHTML = `<div class="form-error">${esc(e.message)}</div>`;
        }
      }

      let archivoFoto = false;
      q("#et-verificar").addEventListener("click", () => { archivoFoto = false; verificar(q("#et-codigo").value); });
      q("#et-codigo").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); archivoFoto = false; verificar(q("#et-codigo").value); } });
      engancharFotoQR(q("#et-foto"), (texto) => { archivoFoto = true; q("#et-codigo").value = texto; verificar(texto); },
        (msg) => { q("#et-resultado").innerHTML = `<div class="form-error">${esc(msg)}</div>`; });

      async function cargarNoReconocidas() {
        const caja = q("#et-norec");
        try {
          const lista = await get(`/puntos/etiquetas/no-reconocidas?sitio_id=${sitioId}`);
          caja.innerHTML = tableHTML(
            [
              { key: "token", label: "Código", fmt: (x) => `<code>${esc(x.token)}</code>` },
              { key: "en_lote", label: "¿Impresa por ASA?", fmt: (x) => (x.en_lote ? `<span class="estado-chip hecho">Sí${x.lote ? ` · ${esc(x.lote)}` : ""}</span>` : `<span class="estado-chip pendiente">No</span>`) },
              { key: "veces", label: "Veces" },
              { key: "ultimo_escaneo", label: "Último escaneo", fmt: (x) => `${fmtDateTime(x.ultimo_escaneo)}<br><small class="text-muted">${esc(x.ultimo_usuario_nombre || "")}</small>` },
              { key: "accion", label: "", fmt: () => `<button type="button" class="btn btn-sm">Asignar…</button>` },
            ],
            lista,
            "No hay etiquetas escaneadas sin asignar en esta planta. ✅"
          );
          caja.querySelectorAll("tr[data-id]").forEach((tr) =>
            tr.addEventListener("click", () => {
              q("#et-codigo").value = tr.dataset.id;
              archivoFoto = false;
              verificar(tr.dataset.id);
              q("#et-codigo").scrollIntoView({ behavior: "smooth", block: "center" });
            })
          );
        } catch (e) {
          caja.innerHTML = `<div class="form-error">${esc(e.message)}</div>`;
        }
      }

      async function cargarLotes() {
        try {
          const r = await get("/puntos/etiquetas/impresos/resumen");
          q("#et-lotes").innerHTML = r.total
            ? `<strong>${r.total}</strong> etiquetas en el grupo impreso: ` + r.lotes.map((l) => `${esc(l.lote)} (${l.total})`).join(" · ")
            : `Todavía no se ha cargado el grupo de etiquetas impresas. Sin él, el sistema no puede decir si una etiqueta es de ASA.`;
        } catch (e) {
          q("#et-lotes").innerHTML = `<span class="form-error">${esc(e.message)}</span>`;
        }
      }

      q("#et-archivo").addEventListener("change", async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        archivoNombre = f.name;
        q("#et-lista").value = await f.text();
        if (!q("#et-lote").value) q("#et-lote").value = f.name.replace(/\.[^.]+$/, "");
      });
      q("#et-cargar").addEventListener("click", async () => {
        const tokens = q("#et-lista").value.split(/[\s,;]+/).map((t) => t.trim().replace(/^"|"$/g, "")).filter(Boolean);
        if (!tokens.length) return (q("#et-cargar-msg").textContent = "Pega al menos un código.");
        q("#et-cargar-msg").textContent = "Cargando…";
        try {
          const r = await post("/puntos/etiquetas/impresos", { tokens, lote: q("#et-lote").value.trim() || null, archivo: archivoNombre });
          q("#et-cargar-msg").textContent = `Listo: ${r.nuevos} nuevas, ${r.repetidos} ya estaban.`;
          q("#et-lista").value = "";
          cargarLotes();
          cargarNoReconocidas();
        } catch (err) {
          q("#et-cargar-msg").textContent = err.message;
        }
      });

      cargarNoReconocidas();
      cargarLotes();
    },
  });
  // Esta ventana no guarda nada con el botón de abajo: todo se hace dentro.
  // Un Enter en cualquier campo no debe enviar el formulario del modal.
  document.querySelector("#asa-modal-form")?.addEventListener("submit", (e) => e.preventDefault());
  const pie = document.querySelector("#asa-modal-overlay .modal-foot");
  if (pie) pie.innerHTML = `<button type="button" class="btn" onclick="closeModal()">Cerrar</button>`;
}

// ── Sección dentro de la ficha de un punto ───────────────────────────────
async function pintarEtiquetasPunto(caja, punto) {
  if (!caja || !punto) return;
  async function cargar() {
    let lista = [];
    try { lista = await get(`/puntos/${punto.id}/etiquetas`); } catch {}
    caja.innerHTML = `
      <div class="campo"><span>Etiquetas adicionales</span>
        ${lista.length
          ? lista.map((e) => `<div class="et-fila"><code class="qr-fijo">${esc(e.token)}</code>
               <small class="text-muted">${esc(e.creado_por_nombre || "")} · ${fmtDate(e.created_at)}</small>
               <button type="button" class="btn btn-sm" data-soltar="${esc(e.token)}">Quitar</button></div>`).join("")
          : `<small class="ayuda">Ninguna. Si en este punto hay pegada otra etiqueta impresa que no abre nada, agrégala aquí.</small>`}
        <div class="toolbar" style="margin-top:6px">
          <input id="et-nueva" placeholder="Código de la etiqueta" style="flex:1" />
          <button type="button" class="btn btn-sm" id="et-agregar">Agregar</button>
          ${botonFotoQR("et-foto-punto")}
        </div>
        <small id="et-msg" class="ayuda"></small>
      </div>`;
    const msg = caja.querySelector("#et-msg");
    const agregar = async (texto, origen) => {
      if (!String(texto || "").trim()) return;
      msg.textContent = "Agregando…";
      try {
        const r = await post(`/puntos/${punto.id}/etiquetas`, { token: texto, origen });
        toast(`Etiqueta ${r.token} agregada${r.en_lote ? "" : " (no está en el grupo impreso)"}`);
        cargar();
      } catch (e) { msg.textContent = e.message; }
    };
    caja.querySelector("#et-agregar").addEventListener("click", () => agregar(caja.querySelector("#et-nueva").value, "panel"));
    // Enter aquí agrega la etiqueta; no guarda (ni cierra) la ficha del punto.
    caja.querySelector("#et-nueva").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); agregar(e.target.value, "panel"); }
    });
    engancharFotoQR(caja.querySelector("#et-foto-punto"), (t) => agregar(t, "foto"), (m) => (msg.textContent = m));
    caja.querySelectorAll("[data-soltar]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!confirm(`¿Quitar la etiqueta ${b.dataset.soltar}? Dejará de abrir este punto.`)) return;
        try { await api(`/puntos/etiquetas/${encodeURIComponent(b.dataset.soltar)}`, { method: "DELETE" }); cargar(); }
        catch (e) { msg.textContent = e.message; }
      })
    );
  }
  cargar();
}
