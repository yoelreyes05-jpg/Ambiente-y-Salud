// extras.js — Portal del hotel: Cronograma y Chinche / código rosa
//
// Se carga antes de app.js; usa sus utilidades (GET, esc, fecha, fechaHora,
// PLANTA, TOKEN, CONFIG) en tiempo de ejecución.
//
//   Cronograma — en cronograma.js; aquí quedan las utilidades de fechas.
//   Chinche    — los casos de chinche / código rosa de la planta, en qué van,
//                y el certificado (español / inglés) cuando la verificación
//                dio negativo.

const TZ_P = { timeZone: "America/Santo_Domingo" };
const DIAS_P = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const fechaRDp = (iso) => new Date(iso).toLocaleDateString("en-CA", TZ_P);
// Hora en 12 h, como se trabaja en el campo: "6:30 p. m."
const horaRDp = (iso) => {
  if (!iso) return "";
  const [h, m] = new Date(iso).toLocaleTimeString("en-GB", { ...TZ_P, hour: "2-digit", minute: "2-digit" }).split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
};
const masDiasP = (f, n) => {
  const d = new Date(f + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const lunesP = (f) => masDiasP(f, -((new Date(f + "T12:00:00Z").getUTCDay() + 6) % 7));
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

// ── ¿Este texto del cronograma menciona esta área? ─────────────────────────
// El cronograma no guarda el área: la trae escrita ("Áreas: Cocina Palapa, Bar
// Barco…", "Fumigación buffet cocina central"). Se compara por palabras, sin
// acentos ni mayúsculas, tolerando plurales ("cocina"/"cocinas") y un error
// de una letra ("Sotanos"/"Sótano", "Cancamos"/"Cárcamos").
const VACIAS_AREA = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "a", "en", "al", "con", "para", "por", "area", "areas", "zona", "zonas", "incluyendo"]);
const normArea = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
// Palabras del servicio, no del lugar: "Tratamientos sótanos" es el área "sótanos"
const DEL_SERVICIO = new Set(["tratamiento", "tratamientos", "control", "monitoreo", "fumigacion", "aplicacion", "inspeccion", "recorrido", "servicio", "nocturno", "diario"]);
const palabrasArea = (t) => normArea(t).split(" ").filter((p) => p && !VACIAS_AREA.has(p));
const lugarArea = (t) => { const p = palabrasArea(t); const l = p.filter((x) => !DEL_SERVICIO.has(x)); return l.length ? l : p; };
function palabraIgual(a, b) {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)) && Math.abs(a.length - b.length) <= 2) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  // una letra distinta, de más o de menos
  let i = 0, j = 0, dif = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++dif > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return dif + (a.length - i) + (b.length - j) <= 1;
}
const contienePalabras = (todas, de) => de.length > 0 && de.every((p) => todas.some((q) => palabraIgual(p, q)));
function coincideArea(texto, nombreArea) {
  // Un área con nombre compuesto ("Registros y cárcamos", "Bar Lobby y Star
  // Prestige"): cuenta si cada parte aparece en el texto.
  const partesArea = String(nombreArea || "").split(/[,;/]| y /i).map((x) => x.trim()).filter((x) => lugarArea(x).length);
  if (partesArea.length > 1) return partesArea.every((pa) => coincideArea(texto, pa));
  const area = lugarArea(nombreArea);
  if (!area.length) return false;
  // Cada parte de la lista por separado: "Bar Lobby, Star Prestige" no es "Bar
  // Star", ni "Cocina Palapa, Buffet Central" es "Cocina Central".
  const partes = String(texto || "").split(/[,;·•:\n/()]| y /i).map(lugarArea).filter((p) => p.length);
  for (const parte of partes) {
    if (contienePalabras(parte, area)) return true;      // la parte trae todas las palabras del área
    if (contienePalabras(area, parte) && parte.length >= Math.min(2, area.length)) return true; // el área contiene la parte entera
  }
  // Escrito corrido, sin lista ("Fumigación buffet cocina central")
  return partes.length <= 1 && contienePalabras(lugarArea(texto), area);
}
