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

  $("#sem-ant").addEventListener("click", () => { SEMANA_P = masDiasP(SEMANA_P, -7); vistaCronograma(cuerpo); });
  $("#sem-sig").addEventListener("click", () => { SEMANA_P = masDiasP(SEMANA_P, 7); vistaCronograma(cuerpo); });
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
