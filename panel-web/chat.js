// chat.js — Chat con los técnicos (backend/routes/chat.js, 42_chat_tecnicos.sql)
//
// Una conversación por técnico para darle seguimiento a lo que suben. A la
// izquierda los técnicos (los que tienen mensajes nuevos arriba); a la derecha
// la conversación. Un mensaje puede ir amarrado a un servicio: desde el
// desglose de cualquier servicio, "💬 Comentar con el técnico" abre su chat
// con ese servicio puesto, y en el chat el servicio se abre con un clic.
//
// Se carga antes de app.js y aporta MODULOS_EXTRA_13.

const MODULOS_EXTRA_13 = [
  { key: "chat", label: "Chat con técnicos", ic: "💬", seccion: "operacion", roles: ["admin", "operaciones", "comercial"], view: viewChat },
];

let CHAT_SEL = null;          // técnico abierto
let CHAT_REF = null;          // { id, texto } servicio al que se refiere el próximo mensaje
let CHAT_TIMER_P = null;
let CHAT_AVISO_P = null;

const horaChatP = (d) => {
  const f = new Date(d);
  const hoy = new Date().toDateString() === f.toDateString();
  const hora = f.toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit", timeZone: "America/Santo_Domingo" });
  return hoy ? hora : `${f.toLocaleDateString("es-DO", { day: "2-digit", month: "2-digit", timeZone: "America/Santo_Domingo" })} ${hora}`;
};

// Desde el desglose de un servicio
async function comentarServicioConTecnico(inspeccionId, textoServicio) {
  try {
    const t = await get(`/chat/servicio/${inspeccionId}`);
    CHAT_SEL = t.tecnico_id;
    CHAT_REF = { id: inspeccionId, texto: textoServicio };
    closeModal();
    navigate("chat");
  } catch (e) {
    toast(e.message, true);
  }
}

// Achica una foto en el navegador antes de mandarla
function achicarFotoChat(archivo, maxLado = 1280) {
  return new Promise((ok) => {
    const lector = new FileReader();
    lector.onload = () => {
      const img = new Image();
      img.onload = () => {
        const esc2 = Math.min(1, maxLado / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * esc2);
        c.height = Math.round(img.height * esc2);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        ok(c.toDataURL("image/jpeg", 0.75));
      };
      img.onerror = () => ok(null);
      img.src = lector.result;
    };
    lector.onerror = () => ok(null);
    lector.readAsDataURL(archivo);
  });
}

async function viewChat(content) {
  clearInterval(CHAT_TIMER_P);
  content.innerHTML = `
    <div class="card chat-p">
      <div class="chat-p-lista" id="chat-p-lista"><div class="center-msg">Cargando…</div></div>
      <div class="chat-p-conv" id="chat-p-conv"><div class="center-msg text-muted">Elige un técnico para ver la conversación.</div></div>
    </div>`;

  let conversaciones = [];
  let firma = "";

  async function cargarLista() {
    try {
      conversaciones = await get("/chat/conversaciones");
    } catch (e) {
      $("#chat-p-lista").innerHTML = `<div class="form-error" style="display:block">${esc(e.message)}</div>`;
      return;
    }
    const caja = $("#chat-p-lista");
    if (!caja) return;
    caja.innerHTML = conversaciones.length
      ? conversaciones.map((c) => `
          <div class="chat-p-item ${c.tecnico_id === CHAT_SEL ? "activo" : ""}" data-tec="${esc(c.tecnico_id)}">
            <div class="chat-p-nombre">${esc(c.nombre)}${c.no_leidos ? `<span class="chat-p-nuevos">${c.no_leidos}</span>` : ""}</div>
            <div class="chat-p-ult">${c.ultimo ? `${c.ultimo.de_oficina ? "Tú: " : ""}${esc(c.ultimo.texto || "")}` : `<span class="text-muted">Sin mensajes</span>`}</div>
            ${c.ultimo ? `<div class="chat-p-hora">${esc(horaChatP(c.ultimo.fecha))}</div>` : ""}
          </div>`).join("")
      : `<div class="center-msg text-muted">No hay técnicos activos.</div>`;
    caja.querySelectorAll("[data-tec]").forEach((el) =>
      el.addEventListener("click", () => {
        if (CHAT_SEL !== el.dataset.tec) CHAT_REF = null;
        CHAT_SEL = el.dataset.tec;
        firma = "";
        abrirConversacion(true);
        caja.querySelectorAll("[data-tec]").forEach((x) => x.classList.toggle("activo", x === el));
      })
    );
  }

  const burbuja = (m) => {
    const s = m.servicio;
    return `
      <div class="chat-p-msg ${m.de_oficina ? "oficina" : ""}">
        <div class="chat-p-autor">${esc(m.autor_nombre)}${m.de_oficina ? "" : " · técnico"}</div>
        ${s ? `<button type="button" class="chat-p-serv" data-insp="${esc(s.id)}" title="Abrir el servicio">
                 📋 <strong>${esc(s.punto || "")}</strong>${s.area ? ` · ${esc(s.area)}` : ""} · ${esc(s.planta || "")}${s.fecha ? ` · ${esc(horaChatP(s.fecha))}` : ""}${s.no_realizado ? " · no realizado" : ""}
               </button>` : ""}
        ${m.texto ? `<div class="chat-p-texto">${esc(m.texto)}</div>` : ""}
        ${(m.fotos || []).length ? `<div class="chat-p-fotos">${m.fotos.map((f) => `<a href="${esc(f)}" target="_blank" rel="noopener"><img src="${esc(f)}" alt="Foto" loading="lazy" /></a>`).join("")}</div>` : ""}
        <div class="chat-p-hora">${esc(horaChatP(m.created_at))}${m.de_oficina ? (m.leido_tecnico ? " · ✓✓ visto" : " · ✓ enviado") : ""}</div>
      </div>`;
  };

  async function abrirConversacion(forzar) {
    if (!CHAT_SEL) return;
    const conv = $("#chat-p-conv");
    if (!conv) return;
    if (forzar) {
      conv.innerHTML = `
        <div class="chat-p-cab" id="chat-p-cab"></div>
        <div class="chat-p-msgs" id="chat-p-msgs"><div class="center-msg">Cargando…</div></div>
        <div class="chat-p-ref" id="chat-p-ref"></div>
        <div class="chat-p-previa" id="chat-p-previa"></div>
        <div class="chat-p-barra">
          <button type="button" class="btn" id="chat-p-foto" title="Agregar foto">📷</button>
          <input type="file" id="chat-p-archivo" accept="image/*" hidden />
          <textarea id="chat-p-texto" rows="2" placeholder="Escribe al técnico… (Enter envía, Shift+Enter nueva línea)"></textarea>
          <button type="button" class="btn btn-primary" id="chat-p-enviar">Enviar</button>
        </div>`;
      montarBarra();
    }
    pintarRef();
    let d;
    try {
      d = await get(`/chat/${CHAT_SEL}`);
    } catch (e) {
      $("#chat-p-msgs").innerHTML = `<div class="form-error" style="display:block">${esc(e.message)}</div>`;
      return;
    }
    $("#chat-p-cab").innerHTML = `<strong>${esc(d.tecnico.nombre)}</strong> <span class="text-muted">· técnico</span>`;
    const nueva = d.mensajes.map((m) => `${m.id}${m.leido_tecnico ? 1 : 0}`).join(",");
    if (nueva === firma && !forzar) return;
    firma = nueva;
    const caja = $("#chat-p-msgs");
    caja.innerHTML = d.mensajes.length
      ? d.mensajes.map(burbuja).join("")
      : `<div class="center-msg text-muted">Todavía no hay mensajes con ${esc(d.tecnico.nombre)}.</div>`;
    caja.scrollTop = caja.scrollHeight;
    caja.querySelectorAll("[data-insp]").forEach((b) => b.addEventListener("click", () => abrirDesglose(b.dataset.insp)));
    // Al abrirla, sus mensajes quedan leídos: se refresca el contador
    const c = conversaciones.find((x) => x.tecnico_id === CHAT_SEL);
    if (c?.no_leidos) { c.no_leidos = 0; cargarLista(); revisarChatPanel(); }
  }

  function pintarRef() {
    const ref = $("#chat-p-ref");
    if (!ref) return;
    ref.innerHTML = CHAT_REF
      ? `<span>📋 Sobre el servicio: <strong>${esc(CHAT_REF.texto)}</strong></span> <button type="button" class="btn btn-sm" id="chat-p-quitar-ref" title="Quitar">✕</button>`
      : "";
    $("#chat-p-quitar-ref")?.addEventListener("click", () => { CHAT_REF = null; pintarRef(); });
  }

  let fotos = [];
  function montarBarra() {
    const texto = $("#chat-p-texto");
    $("#chat-p-foto").addEventListener("click", () => $("#chat-p-archivo").click());
    $("#chat-p-archivo").addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      const url = await achicarFotoChat(f);
      if (!url) return toast("No se pudo leer esa foto", true);
      fotos = [...fotos, url].slice(0, 4);
      $("#chat-p-previa").innerHTML = fotos.map((x) => `<img src="${x}" alt="" />`).join("");
    });
    const enviar = async () => {
      const t = texto.value.trim();
      if (!t && !fotos.length) return;
      const b = $("#chat-p-enviar");
      b.disabled = true;
      try {
        await post(`/chat/${CHAT_SEL}`, { texto: t, fotos, inspeccion_id: CHAT_REF?.id || undefined });
        texto.value = "";
        fotos = [];
        CHAT_REF = null;
        $("#chat-p-previa").innerHTML = "";
        pintarRef();
        firma = "";
        await abrirConversacion(false);
        cargarLista();
      } catch (e) {
        toast(e.message, true);
      } finally {
        b.disabled = false;
      }
    };
    $("#chat-p-enviar").addEventListener("click", enviar);
    texto.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } });
    texto.focus();
  }

  await cargarLista();
  if (CHAT_SEL) await abrirConversacion(true);
  // Mientras el módulo esté abierto: cada 15 segundos
  CHAT_TIMER_P = setInterval(() => {
    if (!$("#chat-p-lista")) return clearInterval(CHAT_TIMER_P);
    if (document.visibilityState !== "visible") return;
    cargarLista();
    abrirConversacion(false);
  }, 15000);
}

// Número de mensajes nuevos en el menú de la izquierda
async function revisarChatPanel() {
  if (!TOKEN || document.visibilityState !== "visible") return;
  const item = document.querySelector('.nav-item[data-key="chat"]');
  if (!item) return;
  try {
    const r = await get("/chat/no-leidos");
    let b = item.querySelector(".chat-p-nuevos");
    if (!r.total) { b?.remove(); return; }
    if (!b) { b = document.createElement("span"); b.className = "chat-p-nuevos"; item.appendChild(b); }
    b.textContent = r.total;
  } catch {}
}
function iniciarAvisoChatPanel() {
  clearInterval(CHAT_AVISO_P);
  revisarChatPanel();
  CHAT_AVISO_P = setInterval(revisarChatPanel, 60000);
}
