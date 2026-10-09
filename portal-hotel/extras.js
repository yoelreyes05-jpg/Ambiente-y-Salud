// extras.js — Portal del hotel: Cronograma y Chinche / código rosa
//
// Se carga antes de app.js; usa sus utilidades (GET, esc, fecha, fechaHora,
// PLANTA, TOKEN, CONFIG) en tiempo de ejecución.
//
//   Cronograma — la programación de servicios de ESTA planta, por semana.
//   Chinche    — los casos de chinche / código rosa de la planta, en qué van,
//                y el certificado (español / inglés) cuando la verificación
//                dio negativo.

const TZ_P = { timeZone: "America/Santo_Domingo" };
const DIAS_P = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const fechaRDp = (iso) => new Date(iso).toLocaleDateString("en-CA", TZ_P);
const horaRDp = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { ...TZ_P, hour: "2-digit", minute: "2-digit" }) : "");
const masDiasP = (f, n) => {
  const d = new Date(f + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const lunesP = (f) => masDiasP(f, -((new Date(f + "T12:00:00Z").getUTCDay() + 6) % 7));
let SEMANA_P = null;

async function vistaCronograma(cuerpo) {
  const hoyRD = fechaRDp(new Date());
  if (!SEMANA_P) SEMANA_P = lunesP(hoyRD);
  const hasta = masDiasP(SEMANA_P, 6);
  const r = await GET(`/cronograma?sitio_id=${PLANTA.id}&desde=${SEMANA_P}&hasta=${hasta}`);
  const dias = [...Array(7)].map((_, i) => masDiasP(SEMANA_P, i));

  cuerpo.innerHTML = `
    <div class="acciones" style="align-items:center">
      <button class="btn" id="sem-ant">◀ Semana anterior</button>
      <strong style="flex:1;text-align:center">Semana del ${SEMANA_P.slice(8)}/${SEMANA_P.slice(5, 7)} al ${hasta.slice(8)}/${hasta.slice(5, 7)}/${hasta.slice(0, 4)}</strong>
      <button class="btn" id="sem-sig">Semana siguiente ▶</button>
      <button class="btn principal" id="cr-imprimir-p">🖨 Imprimir</button>
    </div>
    <div class="tarjeta" id="cr-imp-p" style="display:none">
      <h2>Imprimir cronograma</h2>
      <div class="acciones" style="margin:0 0 8px">
        <select class="btn" id="ip-rango-p">
          <option value="semana">Esta semana</option>
          <option value="mes">El mes</option>
          <option value="otro">Otro rango de fechas</option>
          <option value="todo">Todo lo programado</option>
        </select>
        <span id="ip-fechas-p" style="display:none;gap:6px;align-items:center">
          <input type="date" class="btn" id="ip-desde-p" value="${SEMANA_P}" />
          <input type="date" class="btn" id="ip-hasta-p" value="${masDiasP(SEMANA_P, 27)}" />
        </span>
        <label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="ip-estado-p" /> Incluir estado</label>
        <button class="btn principal" id="ip-ok-p">Imprimir / PDF</button>
      </div>
    </div>
    ${r.filas.length ? `
      <div class="kpis">
        <div class="kpi"><div class="n">${r.filas.length}</div><div class="t">Servicios programados</div></div>
        <div class="kpi ok"><div class="n">${r.filas.filter((f) => f.estado === "realizado").length}</div><div class="t">Realizados</div></div>
      </div>
      <div class="cr-semana-p">
        ${dias.map((d, i) => {
          const del = r.filas.filter((f) => fechaRDp(f.fecha_inicio) === d);
          return `
            <div class="tarjeta cr-dia-p ${d === hoyRD ? "hoy" : ""}">
              <h2>${DIAS_P[i]} <span style="color:var(--suave);font-weight:500">${d.slice(8)}/${d.slice(5, 7)}</span></h2>
              ${del.length ? del.map((f) => `
                <div class="cr-item-p ${f.estado}">
                  <div class="h">${horaRDp(f.fecha_inicio)}${f.fecha_fin ? ` – ${horaRDp(f.fecha_fin)}` : ""}
                    ${f.estado === "realizado" ? ` <span class="marca ok">realizado</span>` : f.estado === "cancelado" ? ` <span class="marca neutra">cancelado</span>` : ""}</div>
                  <div>${esc(f.notas || f.titulo)}</div>
                  ${f.notas ? `<div class="s">${esc(f.titulo)}</div>` : ""}
                </div>`).join("") : `<div class="s">Sin servicios</div>`}
            </div>`;
        }).join("")}
      </div>` : `<div class="vacio"><span class="emoji">📅</span>No hay servicios programados esta semana.</div>`}`;

  $("#cr-imprimir-p").addEventListener("click", () => {
    const caja = $("#cr-imp-p");
    caja.style.display = caja.style.display === "none" ? "" : "none";
  });
  $("#ip-rango-p").addEventListener("change", (e) => { $("#ip-fechas-p").style.display = e.target.value === "otro" ? "inline-flex" : "none"; });
  $("#ip-ok-p").addEventListener("click", () => imprimirCronogramaP($("#ip-rango-p").value, $("#ip-desde-p").value, $("#ip-hasta-p").value, $("#ip-estado-p").checked));
  $("#sem-ant").addEventListener("click", () => { SEMANA_P = masDiasP(SEMANA_P, -7); vistaCronograma(cuerpo); });
  $("#sem-sig").addEventListener("click", () => { SEMANA_P = masDiasP(SEMANA_P, 7); vistaCronograma(cuerpo); });
}

// Hoja imprimible del cronograma de ESTA planta (semana, mes, rango o todo).
// El servidor solo devuelve lo de las plantas de la cuenta.
async function imprimirCronogramaP(rango, desdeSel, hastaSel, conEstado) {
  const [y, m] = SEMANA_P.split("-").map(Number);
  const iniMes = `${y}-${String(m).padStart(2, "0")}-01`;
  const finMes = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const desde = { semana: SEMANA_P, mes: iniMes, todo: "2000-01-01" }[rango] || desdeSel;
  const hasta = { semana: masDiasP(SEMANA_P, 6), mes: finMes, todo: "2099-12-31" }[rango] || hastaSel;
  if (!desde || !hasta || hasta < desde) return alert("Revisa las fechas");

  // Se abre antes del await: si no, el navegador la bloquea como emergente.
  const v = window.open("", "_blank");
  if (!v) return alert("El navegador bloqueó la ventana. Permite las ventanas emergentes de este sitio.");
  v.document.write("<p style='font-family:sans-serif;padding:20px'>Preparando el cronograma…</p>");
  let r;
  try { r = await GET(`/cronograma?sitio_id=${PLANTA.id}&desde=${desde}&hasta=${hasta}`); }
  catch (e) { v.close(); return alert(e.message); }

  const corta = (f) => `${f.slice(8)}/${f.slice(5, 7)}`;
  const larga = (f) => {
    const t = new Date(f + "T12:00:00Z").toLocaleDateString("es-DO", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const ESTADOS = { pendiente: "Pendiente", realizado: "Realizado", cancelado: "Cancelado", reprogramado: "Reprogramado" };
  const porSemana = new Map();
  for (const f of r.filas) {
    const d = fechaRDp(f.fecha_inicio), sem = lunesP(d);
    if (!porSemana.has(sem)) porSemana.set(sem, new Map());
    const dias = porSemana.get(sem);
    if (!dias.has(d)) dias.set(d, []);
    dias.get(d).push(f);
  }
  const cols = ["Hora", "Servicio", ...(conEstado ? ["Estado"] : [])];
  const cuerpoHtml = [...porSemana.keys()].sort().map((sem) => `
    <section><h2>Semana del ${corta(sem)} al ${corta(masDiasP(sem, 6))}/${masDiasP(sem, 6).slice(0, 4)}</h2>
      <table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
      ${[...porSemana.get(sem).keys()].sort().map((d) => `<tbody>
        <tr class="dia"><td colspan="${cols.length}">${esc(larga(d))}</td></tr>
        ${porSemana.get(sem).get(d).map((f) => `<tr>
          <td class="hora">${horaRDp(f.fecha_inicio)}${f.fecha_fin ? `–${horaRDp(f.fecha_fin)}` : ""}</td>
          <td><strong>${esc(f.notas || f.titulo)}</strong>${f.notas && f.titulo !== f.notas ? `<div class="sub">${esc(f.titulo)}</div>` : ""}</td>
          ${conEstado ? `<td>${esc(ESTADOS[f.estado] || f.estado)}</td>` : ""}</tr>`).join("")}
      </tbody>`).join("")}</table></section>`).join("");
  const periodo = rango === "todo" ? "Todo lo programado" : `Del ${corta(desde)}/${desde.slice(0, 4)} al ${corta(hasta)}/${hasta.slice(0, 4)}`;
  const logo = new URL("assets/logo-asa.png", location.href).href;

  v.document.open();
  v.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Cronograma — ${esc(PLANTA.nombre)}</title>
<style>
  @page { size: letter; margin: 12mm; }
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color:#1c2433; margin:0; padding:12mm; font-size:11px }
  .cab { display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid #4A7D4D; padding-bottom:8px; margin-bottom:12px; gap:10px }
  .cab img { height:42px } .cab .t { text-align:right }
  .cab h1 { margin:0; font-size:17px; color:#24407C } .cab p { margin:2px 0 0; color:#555 }
  section { margin-bottom:14px }
  h2 { font-size:13px; color:#fff; background:#32539C; padding:5px 8px; margin:0; border-radius:4px 4px 0 0 }
  table { width:100%; border-collapse:collapse }
  th { text-align:left; font-size:10px; color:#555; border-bottom:1px solid #BAC9E1; padding:4px 6px; background:#EAF0F8 }
  td { padding:4px 6px; border-bottom:1px solid #e3e8ef; vertical-align:top }
  tr.dia td { background:#f5f7fa; font-weight:700; color:#24407C }
  td.hora { white-space:nowrap; width:80px } .sub { color:#777; font-size:10px }
  tbody { break-inside:avoid } .vacio { padding:30px; text-align:center; color:#777 }
  .aviso { background:#EAF0F8; border:1px solid #BAC9E1; padding:10px 12px; border-radius:6px; margin-bottom:12px;
           display:flex; justify-content:space-between; align-items:center; gap:12px; font-size:12px }
  .aviso button { background:#32539C; color:#fff; border:0; border-radius:6px; padding:8px 14px; font-weight:700; cursor:pointer }
  @media print { .aviso { display:none } body { padding:0 } }
</style></head><body>
  <div class="aviso"><span><strong>${r.filas.length} servicio(s).</strong> Para PDF elige <em>Guardar como PDF</em>.</span>
    <button onclick="window.print()">Imprimir / Guardar PDF</button></div>
  <div class="cab"><img src="${esc(logo)}" alt="Ambiente y Salud" />
    <div class="t"><h1>Cronograma de trabajo</h1><p><strong>${esc(PLANTA.nombre)}</strong></p><p>${esc(periodo)}</p></div></div>
  ${cuerpoHtml || `<div class="vacio">No hay servicios programados en ese período.</div>`}
</body></html>`);
  v.document.close();
}

const ESTADO_INC_P = {
  abierta: ["Por verificar", "alerta"],
  en_tratamiento: ["En tratamiento", "mal"],
  negativa: ["Sin chinche", "ok"],
  cerrada: ["Liberada", "ok"],
  cancelada: ["Cancelada", "neutra"],
};

async function vistaIncidencias(cuerpo) {
  const lista = await GET(`/incidencias?sitio_id=${PLANTA.id}&estado=todas`);
  if (!lista.length) {
    cuerpo.innerHTML = `<div class="vacio"><span class="emoji">🛏️</span>
      No hay casos de chinche ni código rosa en esta planta.<br>
      Para reportar uno, ve a Solicitudes → Reportar una plaga y elige Chinches o Código rosa con el número de habitación.</div>`;
    return;
  }
  const abiertas = lista.filter((i) => ["abierta", "en_tratamiento"].includes(i.estado));
  const cerradas = lista.filter((i) => !["abierta", "en_tratamiento"].includes(i.estado));
  const fila = (i) => {
    const [t, c] = ESTADO_INC_P[i.estado] || [i.estado, "neutra"];
    return `
      <div class="registro">
        <div class="cab">
          <div style="flex:1">
            <div class="punto">Habitación ${esc(i.numero_habitacion)} <span class="marca ${c}">${esc(t)}</span></div>
            <div class="meta">${esc(i.numero)} · ${i.tipo === "codigo_rosa" ? "Código rosa" : "Chinche"}${i.reportado_por ? ` · reportado por ${esc(i.reportado_por)}` : ""}</div>
            <div class="meta">Verificación ${i.verificaciones_hechas}/${i.verificaciones_total}${i.protocolo_total ? ` · tratamiento ${i.protocolo_hechos}/${i.protocolo_total} pasos` : ""}${i.nivel ? ` · nivel ${esc(i.nivel)}` : ""}</div>
            ${i.puede_certificar ? `
              <div class="acciones" style="margin:8px 0 0">
                <button class="btn principal" data-cert="${esc(i.id)}" data-idioma="es" data-hab="${esc(i.numero_habitacion)}">Certificado (español)</button>
                <button class="btn principal" data-cert="${esc(i.id)}" data-idioma="en" data-hab="${esc(i.numero_habitacion)}">Certificate (English)</button>
              </div>` : ""}
          </div>
          <div class="fecha">${fechaHora(i.fecha_reporte)}</div>
        </div>
      </div>`;
  };
  cuerpo.innerHTML = `
    ${abiertas.length ? `<div class="tarjeta borde-rojo"><h2>En curso · ${abiertas.length}</h2>${abiertas.map(fila).join("")}</div>` : ""}
    ${cerradas.length ? `<div class="tarjeta"><h2>Cerradas</h2>${cerradas.map(fila).join("")}</div>` : ""}`;

  $$("[data-cert]").forEach((b) => b.addEventListener("click", async () => {
    const original = b.textContent;
    b.disabled = true; b.textContent = "Generando…";
    try {
      const res = await fetch(`${CONFIG.API_BASE}/incidencias/${b.dataset.cert}/certificado?idioma=${b.dataset.idioma}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      if (!res.ok) {
        let m = `El servidor respondió ${res.status}`;
        try { m = (await res.json()).mensaje || m; } catch {}
        throw new Error(m);
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${b.dataset.idioma === "en" ? "Certificate" : "Certificado"}-hab-${b.dataset.hab}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`No se pudo generar el certificado: ${e.message}`);
    } finally {
      b.disabled = false; b.textContent = original;
    }
  }));
}

// ── Certificado desde la orden (Solicitudes) ─────────────────────────────
//
// En una orden de chinche / código rosa: cuando la orden está completada o
// cerrada y la verificación dio negativo, el hotel baja el certificado ahí
// mismo, en español, en inglés o los dos juntos.
function bloqueCertificadoOrden(o) {
  const deChinche = o.tipo_solicitud === "plaga" && /chinche|rosa/i.test(o.tipo_plaga_reportada || "");
  const inc = o.incidencia;
  if (!deChinche && !inc) return "";

  let cuerpo;
  if (inc?.certificado) {
    cuerpo = `
      <p style="margin:0 0 10px">✅ La habitación <strong>${esc(inc.numero_habitacion)}</strong> se verificó y no tiene chinche.
        Descarga el certificado:</p>
      <div class="acciones" style="margin:0">
        <button class="btn principal" data-cert-orden="${esc(o.id)}" data-hab="${esc(inc.numero_habitacion)}" data-idioma="es">Certificado (español)</button>
        <button class="btn principal" data-cert-orden="${esc(o.id)}" data-hab="${esc(inc.numero_habitacion)}" data-idioma="en">Certificate (English)</button>
        <button class="btn" data-cert-orden="${esc(o.id)}" data-hab="${esc(inc.numero_habitacion)}" data-idioma="ambos">Los dos idiomas (1 PDF)</button>
      </div>`;
  } else if (!inc) {
    cuerpo = `<p style="margin:0;color:var(--suave)">Cuando el técnico verifique la habitación y la orden quede completada, aquí podrás descargar el certificado en español e inglés.</p>`;
  } else if (inc.estado === "en_tratamiento") {
    cuerpo = `<p style="margin:0">🔴 Se encontró chinche en la habitación <strong>${esc(inc.numero_habitacion)}</strong> y está en tratamiento (caso ${esc(inc.numero)}). El certificado sale cuando la verificación final dé negativo.</p>`;
  } else if (["negativa", "cerrada"].includes(inc.estado)) {
    cuerpo = `<p style="margin:0;color:var(--suave)">La verificación dio negativo. El certificado estará disponible cuando la orden quede completada o cerrada.</p>`;
  } else if (inc.estado === "cancelada") {
    cuerpo = `<p style="margin:0;color:var(--suave)">El caso ${esc(inc.numero)} fue cancelado.</p>`;
  } else {
    cuerpo = `<p style="margin:0;color:var(--suave)">El técnico todavía está verificando la habitación <strong>${esc(inc.numero_habitacion)}</strong> (caso ${esc(inc.numero)}).</p>`;
  }
  return `<div class="tarjeta"><h2>📄 Certificado de la habitación</h2>${cuerpo}</div>`;
}

function engancharCertificadoOrden(raiz) {
  raiz.querySelectorAll("[data-cert-orden]").forEach((b) =>
    b.addEventListener("click", async () => {
      const original = b.textContent;
      b.disabled = true; b.textContent = "Generando…";
      try {
        const res = await fetch(`${CONFIG.API_BASE}/solicitudes/${b.dataset.certOrden}/certificado?idioma=${b.dataset.idioma}`, {
          headers: { Authorization: `Bearer ${TOKEN}` },
        });
        if (!res.ok) {
          let m = `El servidor respondió ${res.status}`;
          try { m = (await res.json()).mensaje || m; } catch {}
          throw new Error(m);
        }
        // La cabecera con el nombre del archivo no llega entre dominios (CORS): se arma aquí.
        const sufijo = { es: "espanol", en: "english", ambos: "es-en" }[b.dataset.idioma] || "es-en";
        const nombre = `Certificado-${PLANTA.nombre.replace(/[^\w]+/g, "-")}-hab-${b.dataset.hab}-${sufijo}.pdf`;
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement("a");
        a.href = url; a.download = nombre; a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        alert(`No se pudo generar el certificado: ${e.message}`);
      } finally {
        b.disabled = false; b.textContent = original;
      }
    })
  );
}
