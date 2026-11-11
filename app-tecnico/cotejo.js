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

const cotNorm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
// Preguntas que el técnico llena una vez para toda la lista (tipo de
// tratamiento, áreas, producto…). Las de Sí/No, plaga y observaciones se
// contestan solas o quedan vacías.
const cotPreguntaManual = (q) => {
  const t = cotNorm(q.texto);
  if (/observ|nota|coment/.test(t)) return false;
  if (/plaga|actividad|incidencia|presencia|evidencia|indicio|hallazgo|captur|especie|conteo|individuo/.test(t)) return false;
  return ["seleccion", "multiple", "numero", "texto"].includes(q.tipo_respuesta);
};
const cotLeerDatos = (eid) => { try { return JSON.parse(localStorage.getItem(`cotejo-datos:${eid}`) || "{}"); } catch { return {}; } };
const cotGuardarDatos = (eid, d) => { try { localStorage.setItem(`cotejo-datos:${eid}`, JSON.stringify(d)); } catch {} };

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

  // marcados: punto_id → { hora, plagas: { plaga_id: cantidad }, notas }
  const marcados = new Map();
  // Datos del servicio por estrategia: { pregunta_id: valor } (se recuerdan)
  const preguntasDe = new Map((datos.estrategias || []).map((e) => [e.id, (e.preguntas || []).filter(cotPreguntaManual)]));
  const datosServ = new Map((datos.estrategias || []).map((e) => [e.id, cotLeerDatos(e.id)]));
  const faltantes = (eid) => (preguntasDe.get(eid) || []).filter((q) => {
    const v = datosServ.get(eid)?.[q.id];
    return q.obligatoria && (v == null || v === "" || (Array.isArray(v) && !v.length));
  });
  const bloqueDatos = (e) => {
    const qs = preguntasDe.get(e.id) || [];
    if (!qs.length) return "";
    const d = datosServ.get(e.id) || {};
    return `<div class="cot-datos" data-estr="${esc(e.id)}">
      <div class="cot-datos-t">📋 Datos del servicio${datos.estrategias.length > 1 ? ` · ${esc(e.nombre)}` : ""}</div>
      <small class="ayuda">Se ponen en todos los puntos que marques de esta lista.</small>
      ${qs.map((q) => {
        const v = d[q.id];
        const ob = q.obligatoria ? ` <b class="cot-ob">*</b>` : "";
        if (q.tipo_respuesta === "seleccion" || q.tipo_respuesta === "multiple") {
          const sel = Array.isArray(v) ? v : v ? [v] : [];
          return `<div class="cot-q"><div class="cot-q-t">${esc(q.texto)}${ob}${q.tipo_respuesta === "multiple" ? ` <small>(varias)</small>` : ""}</div>
            <div class="cot-ops">${(q.opciones || []).map((o) => `<button type="button" class="cot-op ${sel.includes(String(o)) ? "activa" : ""}" data-q="${esc(q.id)}" data-tipo="${esc(q.tipo_respuesta)}" data-op="${esc(o)}">${esc(o)}</button>`).join("")}</div></div>`;
        }
        return `<div class="cot-q"><div class="cot-q-t">${esc(q.texto)}${ob}</div>
          <input class="cot-in" data-q="${esc(q.id)}" ${q.tipo_respuesta === "numero" ? 'type="number" inputmode="decimal"' : 'type="text"'} value="${esc(v ?? "")}"></div>`;
      }).join("")}
    </div>`;
  };
  // Lo que se manda al servidor: por id y por texto (la misma pregunta puede
  // tener otro id en otro tipo de punto)
  const baseDe = (eid) => {
    const d = datosServ.get(eid) || {}, out = {};
    for (const q of preguntasDe.get(eid) || []) {
      const v = d[q.id];
      if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
      out[q.id] = v; out[cotNorm(q.texto)] = v;
    }
    return out;
  };
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
      ${datos.estrategias.filter((e) => !COTEJO_FILTRO || e.id === COTEJO_FILTRO).map(bloqueDatos).join("")}
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
                ${txtPl ? ` · <b class="cot-pl">${esc(txtPl)}</b>` : ""}${m?.notas ? ` · 📝 ${esc(m.notas)}` : ""}</div>
            </div>
            ${m ? `<button type="button" class="cot-bplaga" data-plaga-de="${esc(p.id)}">🐜 ${pl.length || m.notas ? "Detalle ▾" : "¿Plaga? / nota"}</button>` : ""}
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
              <div class="cot-det-t" style="margin-top:10px">Observaciones (opcional)</div>
              <textarea class="cot-nota" data-nota-de="${esc(p.id)}" rows="2" placeholder="Solo si hay algo que anotar">${esc(m.notas || "")}</textarea>
              <button type="button" class="btn secundario" data-cerrar-det style="margin-top:8px">Listo</button>
            </div>` : ""}`;
      }).join("")}
      <div class="pie-fijo"><button class="btn" id="cot-guardar" ${marcados.size ? "" : "disabled"}>✓ Guardar ${marcados.size} marcado${marcados.size === 1 ? "" : "s"}</button></div>`;
  };

  const ahora = () => new Date().toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit" });

  cuerpo.addEventListener("input", (ev) => {
    const nota = ev.target.closest("[data-nota-de]");
    if (nota) { const m = marcados.get(nota.dataset.notaDe); if (m) m.notas = nota.value; return; }
    const inp = ev.target.closest(".cot-in[data-q]");
    if (inp) {
      const eid = inp.closest("[data-estr]").dataset.estr;
      const d = datosServ.get(eid) || {};
      d[inp.dataset.q] = inp.value.trim();
      datosServ.set(eid, d); cotGuardarDatos(eid, d);
    }
  });

  cuerpo.addEventListener("click", async (ev) => {
    const op = ev.target.closest(".cot-op");
    if (op) {
      const eid = op.closest("[data-estr]").dataset.estr;
      const d = datosServ.get(eid) || {};
      const q = op.dataset.q, o = op.dataset.op;
      if (op.dataset.tipo === "multiple") {
        const sel = new Set(Array.isArray(d[q]) ? d[q] : d[q] ? [d[q]] : []);
        sel.has(o) ? sel.delete(o) : sel.add(o);
        d[q] = [...sel];
      } else d[q] = d[q] === o ? "" : o;
      datosServ.set(eid, d); cotGuardarDatos(eid, d);
      vibrar(8);
      return pintar();
    }

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
      // Las obligatorias de "Datos del servicio" de las listas con puntos marcados
      const estrMarcadas = new Set(datos.puntos.filter((p) => marcados.has(p.id)).map((p) => p.estrategia_id));
      for (const eid of estrMarcadas) {
        const f = faltantes(eid);
        if (f.length) {
          const nom = datos.estrategias.find((e) => e.id === eid)?.nombre || "";
          aviso(`Falta en Datos del servicio${nom ? ` (${nom})` : ""}: ${f.map((q) => q.texto).join(", ")}`, "error");
          if (COTEJO_FILTRO && COTEJO_FILTRO !== eid) { COTEJO_FILTRO = eid; pintar(); }
          cuerpo.querySelector(`[data-estr="${CSS.escape(eid)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
      }
      boton.disabled = true;
      const estrDe = new Map(datos.puntos.map((p) => [p.id, p.estrategia_id]));
      let enviados = 0, enCola = 0;
      const lugar = typeof ubicacionActual === "function" ? ubicacionActual() || {} : {};
      for (const [punto_id, m] of marcados) {
        boton.textContent = `Guardando ${enviados + enCola + 1} de ${marcados.size}…`;
        const pd = datos.puntos.find((x) => x.id === punto_id);
        const inspeccion = {
          punto_id,
          _punto: [pd?.nombre, pd?.codigo, SITIO?.nombre].filter(Boolean).join(" · "),
          cotejo: true,
          capturas: Object.entries(m.plagas).filter(([, n]) => n > 0).map(([plaga_id, cantidad]) => ({ plaga_id, cantidad })),
          respuestas_base: baseDe(estrDe.get(punto_id)),
          // Observaciones: solo lo que escribió el técnico
          ...(String(m.notas || "").trim() ? { notas: String(m.notas).trim() } : {}),
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
