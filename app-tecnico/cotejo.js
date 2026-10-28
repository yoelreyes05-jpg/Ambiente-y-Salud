// cotejo.js — Cotejo de fumigación (app del técnico)
//
// Offices, carritos, registros… se trabajan en serie: abrir el formulario
// completo en cada uno no tiene sentido. Aquí salen todos los puntos del hotel
// cuya estrategia ASA marcó "En el cotejo" en el panel; el técnico marca la
// casilla al hacer cada uno y, si encontró plaga, dice cuál y cuántas.
//
// Cada punto marcado se guarda como una inspección normal con `cotejo: true`:
// el servidor contesta solo las preguntas de su estrategia (sin incidencia, o
// con la plaga). Sin señal va a la cola como cualquier inspección.
//
// Se carga antes de app.js; usa sus utilidades (GET, encolar, SITIO, aviso…)
// en tiempo de ejecución.

let COTEJO_FILTRO = "";

async function pantallaCotejo() {
  encabezado("Cotejo de fumigación", SITIO?.nombre);
  const cuerpo = document.createElement("div");
  cuerpo.className = "contenido cotejo";
  cuerpo.innerHTML = `<div class="cargando">Cargando…</div>`;
  app().appendChild(cuerpo);

  let datos;
  try {
    datos = await GET(`/puntos/cotejo?sitio_id=${SITIO.id}`);
    await guardarCache(`cotejo:${SITIO.id}`, datos);
  } catch (e) {
    datos = esSinSenal(e) ? await leerCache(`cotejo:${SITIO.id}`) : null;
    if (!datos) {
      cuerpo.innerHTML = `<div class="vacio"><span class="emoji">⚠️</span>${esc(e.message)}</div>`;
      return;
    }
    aviso("Sin señal: lista guardada en el teléfono");
  }

  if (!datos.puntos?.length) {
    cuerpo.innerHTML = `
      <div class="vacio"><span class="emoji">☑️</span>
        No hay puntos en el cotejo de este hotel.<br>
        <small>En el panel, en <strong>Estrategias</strong>, pon <strong>“En el cotejo”</strong> en Sí
        a las que quieras (Office y carritos, Registros…).</small></div>`;
    return;
  }

  // marcados: punto_id → { hora, plagas: { plaga_id: cantidad } }
  const marcados = new Map();
  let abierto = null;
  const plagas = datos.plagas || [];

  const pintar = () => {
    const lista = datos.puntos.filter((p) => !COTEJO_FILTRO || p.estrategia_id === COTEJO_FILTRO);
    const conPlaga = [...marcados.values()].filter((m) => Object.values(m.plagas).some((n) => n > 0)).length;
    let grupo = "";
    cuerpo.innerHTML = `
      ${datos.estrategias.length > 1 ? `<div class="cot-filtros">
        <button type="button" class="cot-chip ${!COTEJO_FILTRO ? "activa" : ""}" data-filtro="">Todos (${datos.puntos.length})</button>
        ${datos.estrategias.map((e) => `<button type="button" class="cot-chip ${COTEJO_FILTRO === e.id ? "activa" : ""}" data-filtro="${esc(e.id)}">${esc(e.nombre)} (${e.total})</button>`).join("")}
      </div>` : ""}
      <div class="cot-resumen">
        <span class="etiqueta verde">✓ ${marcados.size} marcado${marcados.size === 1 ? "" : "s"}</span>
        ${conPlaga ? `<span class="etiqueta ambar">🐜 ${conPlaga} con plaga</span>` : ""}
        <button type="button" class="cot-todos" id="cot-todos">Marcar todos</button>
      </div>
      ${lista.map((p) => {
        const titulo = `${p.estrategia} · ${p.area}`;
        const cab = titulo !== grupo ? `<div class="grupo-area">${esc(titulo)}</div>` : "";
        grupo = titulo;
        const m = marcados.get(p.id);
        const pl = m ? Object.entries(m.plagas).filter(([, n]) => n > 0) : [];
        const txtPl = pl.map(([id, n]) => `${plagas.find((x) => String(x.id) === id)?.nombre || "Plaga"} (${n})`).join(", ");
        return `${cab}
          <div class="cot ${m ? (pl.length ? "inc" : "hecho") : p.hecho_hoy ? "ya" : ""}" data-punto="${esc(p.id)}">
            <div class="cot-caja">${m ? "✓" : ""}</div>
            <div class="cot-txt">
              <div class="cot-n">${esc(p.nombre)}</div>
              <div class="cot-s">${esc(p.codigo)}${m ? ` · marcado ${esc(m.hora)}` : p.hecho_hoy ? ` · ya hecho hoy ${esc(new Date(p.hecho_hoy).toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit" }))}` : " · toca para marcar"}
                ${txtPl ? ` · <b class="cot-pl">${esc(txtPl)}</b>` : ""}</div>
            </div>
            ${m ? `<button type="button" class="cot-bplaga" data-plaga-de="${esc(p.id)}">🐜 ${pl.length ? "Plaga ▾" : "¿Plaga?"}</button>` : ""}
          </div>
          ${abierto === p.id && m ? `
            <div class="cot-det">
              <div class="cot-det-t">¿Qué plaga encontraste y cuántas?</div>
              ${plagas.map((x) => {
                const n = m.plagas[x.id] || 0;
                return `<div class="plaga" data-cot-plaga="${esc(x.id)}">
                  <span class="pl-ic">${esc(x.icono || "•")}</span><span class="pl-nom">${esc(x.nombre)}</span>
                  <button type="button" class="pl-btn" data-paso="-1">−</button><span class="pl-cant">${n}</span>
                  <button type="button" class="pl-btn" data-paso="1">+</button></div>`;
              }).join("")}
              <small class="ayuda">Si lo dejas todo en cero, el checklist se guarda como <b>sin incidencia</b>.</small>
              <button type="button" class="btn secundario" data-cerrar-det style="margin-top:8px">Listo</button>
            </div>` : ""}`;
      }).join("")}
      <div class="pie-fijo"><button class="btn" id="cot-guardar" ${marcados.size ? "" : "disabled"}>✓ Guardar ${marcados.size} marcado${marcados.size === 1 ? "" : "s"}</button></div>`;
  };

  const ahora = () => new Date().toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit" });

  cuerpo.addEventListener("click", async (ev) => {
    const filtro = ev.target.closest("[data-filtro]");
    if (filtro) { COTEJO_FILTRO = filtro.dataset.filtro; abierto = null; return pintar(); }

    if (ev.target.closest("#cot-todos")) {
      for (const p of datos.puntos) {
        if ((!COTEJO_FILTRO || p.estrategia_id === COTEJO_FILTRO) && !marcados.has(p.id)) marcados.set(p.id, { hora: ahora(), plagas: {} });
      }
      vibrar(20);
      return pintar();
    }

    if (ev.target.closest("[data-cerrar-det]")) { abierto = null; return pintar(); }

    const bPlaga = ev.target.closest("[data-plaga-de]");
    if (bPlaga) { abierto = abierto === bPlaga.dataset.plagaDe ? null : bPlaga.dataset.plagaDe; return pintar(); }

    const paso = ev.target.closest("[data-cot-plaga] .pl-btn");
    if (paso) {
      const fila = paso.closest("[data-cot-plaga]");
      const m = marcados.get(abierto);
      const id = fila.dataset.cotPlaga;
      m.plagas[id] = Math.max(0, (m.plagas[id] || 0) + Number(paso.dataset.paso));
      vibrar(10);
      return pintar();
    }

    const fila = ev.target.closest(".cot[data-punto]");
    if (fila) {
      const id = fila.dataset.punto;
      if (marcados.has(id)) {
        const conPl = Object.values(marcados.get(id).plagas).some((n) => n > 0);
        if (conPl && !confirm("Este punto tiene plaga anotada. ¿Desmarcarlo?")) return;
        marcados.delete(id);
        if (abierto === id) abierto = null;
      } else {
        marcados.set(id, { hora: ahora(), plagas: {} });
        vibrar(15);
      }
      return pintar();
    }

    if (ev.target.closest("#cot-guardar")) {
      const boton = ev.target.closest("#cot-guardar");
      boton.disabled = true;
      let enviados = 0, enCola = 0;
      const lugar = typeof ubicacionActual === "function" ? ubicacionActual() || {} : {};
      for (const [punto_id, m] of marcados) {
        boton.textContent = `Guardando ${enviados + enCola + 1} de ${marcados.size}…`;
        const inspeccion = {
          punto_id,
          cotejo: true,
          capturas: Object.entries(m.plagas).filter(([, n]) => n > 0).map(([plaga_id, cantidad]) => ({ plaga_id, cantidad })),
          notas: `Marcado ${m.hora}`,
          fotos: [],
          ...lugar,
        };
        try {
          if (!navigator.onLine) throw new Error("sin señal");
          await POST("/inspecciones", inspeccion);
          enviados++;
        } catch (e) {
          // Si el servidor dijo que no (punto de otro hotel, dado de baja) no
          // se encola: se avisa. Sin señal, sí.
          if (!esSinSenal(e)) { aviso(e.message, "error"); continue; }
          await encolar(inspeccion);
          enCola++;
        }
      }
      await actualizarContadorPendientes();
      vibrar([40, 30, 80]);
      aviso(enCola ? `${enviados} guardados · ${enCola} se enviarán al haber señal` : `${enviados} guardados ✓`, "exito");
      location.hash = "#/ruta";
    }
  });

  pintar();
}
