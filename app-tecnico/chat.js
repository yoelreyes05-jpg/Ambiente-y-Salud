// chat.js — Mensajes con la oficina (GET/POST /chat/mio, 42_chat_tecnicos.sql)
//
// La oficina le da seguimiento a lo que sube el técnico: le pregunta por un
// servicio ("¿por qué marcaste ratas en la 5023?") y él responde con texto o
// foto. Los mensajes que vienen de un servicio muestran cuál (habitación,
// área, día).
//
// Se carga antes de app.js; app.js manda #/chat a pantallaChat() y pone el
// aviso de mensajes nuevos con vigilarMensajes().

let CHAT_TIMER = null;
let CHAT_AVISO_TIMER = null;

const horaChat = (d) => {
  const f = new Date(d);
  const hoy = new Date().toDateString() === f.toDateString();
  const hora = f.toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit", timeZone: "America/Santo_Domingo" });
  return hoy ? hora : `${f.toLocaleDateString("es-DO", { day: "2-digit", month: "2-digit", timeZone: "America/Santo_Domingo" })} ${hora}`;
};

(function estilosChat() {
  const s = document.createElement("style");
  s.textContent = `
    .chat-lista{display:flex;flex-direction:column;gap:8px;padding-bottom:90px}
    .chat-msg{max-width:84%;padding:9px 12px;border-radius:14px;background:#fff;border:1px solid var(--gris-200,#e2e8f0);align-self:flex-start;word-wrap:break-word}
    .chat-msg.mio{align-self:flex-end;background:#e8f3ea;border-color:#c9e3cd}
    .chat-msg .quien{font-size:12px;font-weight:700;color:var(--gris-600,#475569);margin-bottom:2px}
    .chat-msg .hora{font-size:11px;color:#94a3b8;text-align:right;margin-top:3px}
    .chat-msg .texto{white-space:pre-wrap;font-size:15px;line-height:1.4}
    .chat-serv{display:block;margin:2px 0 6px;padding:7px 9px;border-radius:9px;background:#eef3fb;border-left:3px solid #32539C;font-size:13px;line-height:1.35}
    .chat-fotos{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
    .chat-fotos img{width:110px;height:110px;object-fit:cover;border-radius:8px}
    .chat-barra{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid #e2e8f0;padding:8px 10px calc(8px + env(safe-area-inset-bottom));display:flex;gap:8px;align-items:flex-end;z-index:40}
    .chat-barra textarea{flex:1;resize:none;min-height:42px;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:18px;padding:9px 12px;font:inherit;font-size:15px;max-height:120px}
    .chat-barra button{border:none;border-radius:50%;width:42px;height:42px;font-size:19px;flex:0 0 auto}
    .chat-barra .enviar{background:#4A7D4D;color:#fff}
    .chat-barra .camara{background:#eef3fb}
    .chat-previa{display:flex;gap:6px;flex-wrap:wrap;padding:0 10px}
    .chat-previa img{width:56px;height:56px;object-fit:cover;border-radius:8px}
    .chat-pastilla{position:fixed;left:50%;transform:translateX(-50%);top:calc(64px + env(safe-area-inset-top));z-index:60;background:#32539C;color:#fff;border:none;border-radius:20px;padding:8px 16px;font-weight:700;box-shadow:0 4px 14px rgba(0,0,0,.2)}
  `;
  document.head.appendChild(s);
})();

function burbujaChat(m) {
  const s = m.servicio;
  return `
    <div class="chat-msg ${m.mio ? "mio" : ""}">
      ${m.mio ? "" : `<div class="quien">${esc(m.de_oficina ? `${m.autor_nombre} · Oficina` : m.autor_nombre)}</div>`}
      ${s ? `<span class="chat-serv">📋 <strong>${esc(s.punto || "")}</strong>${s.area ? ` · ${esc(s.area)}` : ""}<br>
              ${esc(s.planta || "")}${s.fecha ? ` · ${esc(horaChat(s.fecha))}` : ""}${s.no_realizado ? " · no realizado" : ""}</span>` : ""}
      ${m.texto ? `<div class="texto">${esc(m.texto)}</div>` : ""}
      ${(m.fotos || []).length ? `<div class="chat-fotos">${m.fotos.map((f) => `<a href="${esc(f)}" target="_blank" rel="noopener"><img src="${esc(f)}" alt="Foto" loading="lazy" /></a>`).join("")}</div>` : ""}
      <div class="hora">${esc(horaChat(m.created_at))}</div>
    </div>`;
}

async function pantallaChat() {
  clearInterval(CHAT_TIMER);
  encabezado("Mensajes", "Con la oficina");
  const cuerpo = document.createElement("div");
  cuerpo.className = "contenido";
  cuerpo.innerHTML = `<div class="cargando">Cargando mensajes…</div>`;
  app().appendChild(cuerpo);

  const barra = document.createElement("div");
  barra.innerHTML = `
    <div class="chat-barra">
      <button type="button" class="camara" id="chat-foto" aria-label="Agregar foto">📷</button>
      <input type="file" id="chat-archivo" accept="image/*" capture="environment" hidden />
      <div style="flex:1;display:flex;flex-direction:column;gap:6px">
        <div class="chat-previa" id="chat-previa"></div>
        <textarea id="chat-texto" rows="1" placeholder="Escribe a la oficina…"></textarea>
      </div>
      <button type="button" class="enviar" id="chat-enviar" aria-label="Enviar">➤</button>
    </div>`;
  app().appendChild(barra);

  let fotos = [];
  let ultimaFirma = "";

  const pintar = (d, forzarAbajo) => {
    if (!cuerpo.isConnected) return;
    const firma = d.mensajes.map((m) => m.id).join(",");
    if (firma === ultimaFirma && !forzarAbajo) return;
    ultimaFirma = firma;
    const abajo = forzarAbajo || window.innerHeight + window.scrollY >= document.body.scrollHeight - 80;
    cuerpo.innerHTML = d.mensajes.length
      ? `<div class="chat-lista">${d.mensajes.map(burbujaChat).join("")}</div>`
      : `<div class="vacio"><span class="emoji">💬</span>Todavía no hay mensajes. Aquí la oficina te escribe sobre los servicios que subes, y tú le puedes responder.</div>`;
    if (abajo) window.scrollTo(0, document.body.scrollHeight);
  };

  const cargar = async (forzar) => {
    try {
      pintar(await GET("/chat/mio"), forzar);
      pintarAvisoChat(0);
    } catch (e) {
      if (!ultimaFirma && cuerpo.isConnected) {
        cuerpo.innerHTML = `<div class="vacio"><span class="emoji">📡</span>${esc(e.status ? e.message : "Necesitas señal para ver los mensajes.")}</div>`;
      }
    }
  };
  await cargar(true);
  // Mientras la pantalla esté abierta se revisa cada 15 segundos
  CHAT_TIMER = setInterval(() => {
    if (!cuerpo.isConnected) return clearInterval(CHAT_TIMER);
    if (document.visibilityState === "visible" && navigator.onLine) cargar(false);
  }, 15000);

  const texto = $("#chat-texto");
  texto.addEventListener("input", () => { texto.style.height = "auto"; texto.style.height = Math.min(texto.scrollHeight, 120) + "px"; });
  $("#chat-foto").addEventListener("click", () => $("#chat-archivo").click());
  $("#chat-archivo").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const dataUrl = await reducirImagen(f, 1280, 0.7);
    if (!/^data:image\/(jpeg|png|webp)/.test(dataUrl)) return aviso("No se pudo leer esa foto", "error");
    fotos = [...fotos, dataUrl].slice(0, 4);
    $("#chat-previa").innerHTML = fotos.map((x) => `<img src="${x}" alt="" />`).join("");
  });
  $("#chat-enviar").addEventListener("click", async () => {
    const t = texto.value.trim();
    if (!t && !fotos.length) return;
    const b = $("#chat-enviar");
    b.disabled = true;
    try {
      await POST("/chat/mio", { texto: t, fotos });
      texto.value = "";
      texto.style.height = "auto";
      fotos = [];
      $("#chat-previa").innerHTML = "";
      await cargar(true);
    } catch (e) {
      aviso(e.status ? e.message : "Sin señal: el mensaje no se envió. Inténtalo cuando tengas señal.", "error");
    } finally {
      b.disabled = false;
    }
  });
}

// Pastilla "💬 2 mensajes nuevos" arriba, en cualquier pantalla
function pintarAvisoChat(n) {
  let el = document.getElementById("chat-pastilla");
  if (!n || location.hash === "#/chat") { el?.remove(); return; }
  if (!el) {
    el = document.createElement("button");
    el.id = "chat-pastilla";
    el.className = "chat-pastilla";
    el.addEventListener("click", () => { el.remove(); location.hash = "#/chat"; });
    document.body.appendChild(el);
  }
  el.textContent = `💬 ${n} mensaje${n === 1 ? "" : "s"} nuevo${n === 1 ? "" : "s"} de la oficina`;
}

let CHAT_NO_LEIDOS = 0;
async function revisarMensajes() {
  if (!TOKEN || !navigator.onLine || document.visibilityState !== "visible") return;
  try {
    const r = await GET("/chat/no-leidos");
    CHAT_NO_LEIDOS = r.total || 0;
    pintarAvisoChat(CHAT_NO_LEIDOS);
  } catch {}
}

function vigilarMensajes() {
  clearInterval(CHAT_AVISO_TIMER);
  revisarMensajes();
  CHAT_AVISO_TIMER = setInterval(revisarMensajes, 60000);
}
window.addEventListener("hashchange", () => { if (location.hash === "#/chat") pintarAvisoChat(0); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") revisarMensajes(); });
