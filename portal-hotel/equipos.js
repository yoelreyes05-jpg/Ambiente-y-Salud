// equipos.js — Portal del hotel: pestaña Equipos
//
// Dispensadores de aerosol y lámparas atrapamoscas: se escoge el tipo, sale
// cada equipo del hotel con su último servicio, y al tocar uno se despliega
// todo lo que se le ha hecho en el período (cambio de pega, recambio de
// aerosol, revisiones…). Cada servicio abre su ficha con fotos y respuestas.
//
// Se carga antes de app.js; usa sus utilidades en tiempo de ejecución.

const GRUPOS_EQ = [
  { k: "dispensador", t: "🧴 Dispensadores de aerosol", prueba: /dispens|aerosol/ },
  { k: "lampara", t: "💡 Lámparas atrapamoscas", prueba: /lampara|atrapamosc|insectocut|mosquero/ },
];
let EQ = { grupo: "dispensador", dias: "90", abierto: null };
const normEq = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

async function vistaEquipos(cuerpo) {
  cuerpo.innerHTML = `<div class="cargando">Cargando…</div>`;
  let estado;
  try { estado = await GET(`/puntos/estado?sitio_id=${PLANTA.id}`); }
  catch (e) { cuerpo.innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
  const puntos = estado.puntos || [];
  const deGrupo = (g) => puntos.filter((p) => g.prueba.test(normEq(`${p.tipo_nombre} ${p.tipo_codigo}`)));
  const grupos = GRUPOS_EQ.map((g) => ({ ...g, lista: deGrupo(g) }));
  if (!grupos.some((g) => g.lista.length)) {
    cuerpo.innerHTML = `<div class="vacio"><span class="emoji">🧴</span>Este hotel no tiene dispensadores de aerosol ni lámparas atrapamoscas registrados.</div>`;
    return;
  }
  if (!grupos.find((g) => g.k === EQ.grupo)?.lista.length) EQ.grupo = grupos.find((g) => g.lista.length).k;
  const g = grupos.find((x) => x.k === EQ.grupo);
  const hoy = hoyLocal();
  const desde = masDiasP(hoy, -(Number(EQ.dias) - 1));

  cuerpo.innerHTML = `
    <div class="tarjeta">
      <div class="eq-tipos">
        ${grupos.map((x) => `<button type="button" class="btn${x.k === EQ.grupo ? " principal" : ""}" data-eq-grupo="${x.k}" ${x.lista.length ? "" : "disabled"}>${x.t} (${x.lista.length})</button>`).join("")}
      </div>
      <label class="eq-periodo">Período
        <select class="btn" id="eq-dias">
          ${[["30", "Últimos 30 días"], ["90", "Últimos 90 días"], ["180", "Últimos 6 meses"], ["365", "Último año"]].map(([v, t]) => `<option value="${v}"${v === EQ.dias ? " selected" : ""}>${t}</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="tarjeta">
      <h2>${g.t}</h2>
      <p class="pl-nota">Toca un equipo para ver lo que se le ha hecho del ${esc(fecha(desde))} al ${esc(fecha(hoy))}.</p>
      ${g.lista.map((p) => `
        <div class="eq-item${EQ.abierto === p.id ? " abierto" : ""}" data-eq="${esc(p.id)}">
          <div class="registro clicable eq-cab">
            <div class="cab">
              <div>
                <div class="punto">${esc(p.punto_nombre || p.codigo_visible)}</div>
                <div class="meta">${esc([p.codigo_visible, p.area_nombre].filter(Boolean).join(" · "))}</div>
              </div>
              <div class="fecha">${p.ultima_inspeccion ? `Último: ${esc(fecha(String(p.ultima_inspeccion).slice(0, 10)))}` : "Sin servicios"}
                <div class="marca ${p.estado === "por_hacer" ? "alerta" : p.estado === "no_realizado" ? "nopudo" : "ok"}" style="margin-top:4px">${p.estado === "por_hacer" ? "Le toca" : p.estado === "no_realizado" ? "No se pudo" : "Al día"}</div></div>
            </div>
          </div>
          <div class="eq-hist" ${EQ.abierto === p.id ? "" : "hidden"}></div>
        </div>`).join("")}
    </div>`;

  $$("[data-eq-grupo]", cuerpo).forEach((b) => b.addEventListener("click", () => { EQ.grupo = b.dataset.eqGrupo; EQ.abierto = null; vistaEquipos(cuerpo); }));
  $("#eq-dias").addEventListener("change", (e) => { EQ.dias = e.target.value; vistaEquipos(cuerpo); });

  const abrir = async (item) => {
    const caja = $(".eq-hist", item);
    const id = item.dataset.eq;
    if (EQ.abierto === id && !caja.hidden) { caja.hidden = true; item.classList.remove("abierto"); EQ.abierto = null; return; }
    $$(".eq-item", cuerpo).forEach((x) => { x.classList.remove("abierto"); $(".eq-hist", x).hidden = true; });
    EQ.abierto = id; item.classList.add("abierto"); caja.hidden = false;
    caja.innerHTML = `<div class="cargando">Cargando…</div>`;
    let lista;
    try { lista = await GET(`/inspecciones?sitio_id=${PLANTA.id}&punto_id=${id}&desde=${desde}&hasta=${hoy}&limite=500`); }
    catch (e) { caja.innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
    lista = Array.isArray(lista) ? lista : lista.inspecciones || [];
    caja.innerHTML = lista.length ? `
      <p class="pl-nota">${lista.length} servicio${lista.length === 1 ? "" : "s"} en el período. Toca uno para ver qué se hizo y sus fotos.</p>
      ${lista.map((i) => {
        const noHecho = !!i.motivo_no_realizado;
        const nivel = i.nivel_actividad && i.nivel_actividad !== "ninguna";
        const nf = Array.isArray(i.fotos) ? i.fotos.length : 0;
        return `
        <div class="registro clicable" data-insp="${esc(i.id)}">
          <div class="cab">
            <div>
              <div class="punto">${esc(fecha(String(i.fecha_local || i.fecha).slice(0, 10)))}
                <span class="marca ${noHecho ? "nopudo" : nivel ? "alerta" : "ok"}">${esc(noHecho ? "No realizado" : nivel ? NIVEL_TEXTO[i.nivel_actividad] : "Conforme")}</span></div>
              <div class="meta">${esc([ESTADO_TEXTO[i.estado_punto] || i.estado_punto, i.asa_empleados?.nombre_completo].filter(Boolean).join(" · "))}</div>
              ${i.notas ? `<div class="meta">${esc(i.notas)}</div>` : ""}
            </div>
            <div class="fecha">${esc(horaCorta(i.fecha))}${nf ? `<div class="marca neutra" style="margin-top:4px">${nf} fotos</div>` : ""}</div>
          </div>
        </div>`;
      }).join("")}`
      : `<div class="vacio">No hay servicios de este equipo en el período.</div>`;
    engancharServicios(caja);
  };
  $$(".eq-item", cuerpo).forEach((item) => $(".eq-cab", item).addEventListener("click", () => abrir(item)));
  if (EQ.abierto) { const it = cuerpo.querySelector(`.eq-item[data-eq="${CSS.escape(EQ.abierto)}"]`); if (it) { EQ.abierto = null; abrir(it); } }
}
