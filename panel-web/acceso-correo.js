// acceso-correo.js — Entrar con Google, Microsoft (Hotmail/Outlook) o un
// código por correo. Lo usan las tres apps: panel (/admin), portal del hotel
// (/hotel) y app del técnico (/tecnico).
//
// HAY UNA COPIA IGUAL EN panel-web/, portal-hotel/ y app-tecnico/: cada app se
// publica sola en Vercel y no ve las carpetas de las otras. Si cambias una,
// copia el archivo a las otras dos.
//
// Supabase Auth hace la parte difícil (OAuth y el código por correo) y nos da
// un token que solo prueba "esta persona es dueña de este correo". El backend
// (POST /usuarios/login-correo) le pregunta a Supabase de quién es ese token y
// decide si ese correo tiene acceso y con qué cuenta.
//
// Cuenta de hotel con personas autorizadas: primero va el correo + clave del
// hotel (formulario normal); el backend responde { requiere_persona, ticket } y
// la app vuelve a llamar montar() con ese ticket, para que la persona confirme
// con SU correo. El ticket se guarda en sessionStorage porque Google y
// Microsoft sacan a la persona de la página y la devuelven después.
//
//   AccesoCorreo.montar({
//     contenedor,           // elemento donde van los botones
//     api,                  // CONFIG.API_BASE
//     alEntrar(r),          // r = { token, usuario } — igual que /usuarios/login
//     ticket?, cuenta?,     // paso 2 de la cuenta de hotel
//   })
//   AccesoCorreo.pedirPersona(r) → true si la respuesta del login pide el paso 2

(function () {
  const SB_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js";
  const CLAVE_TICKET = "asa_acceso_ticket";
  const CLAVE_CUENTA = "asa_acceso_cuenta";
  let configPromesa = null;
  let clientePromesa = null;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function cargarScript(src) {
    return new Promise((ok, mal) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = ok;
      s.onerror = () => mal(new Error("No se pudo cargar el inicio de sesión con correo. Revisa la conexión."));
      document.head.appendChild(s);
    });
  }

  function config(api) {
    if (!configPromesa) {
      configPromesa = fetch(`${api}/usuarios/acceso-config`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    }
    return configPromesa;
  }

  async function cliente(api) {
    const c = await config(api);
    if (!c?.oauth) return null;
    if (!clientePromesa) {
      clientePromesa = (async () => {
        if (!window.supabase?.createClient) await cargarScript(SB_CDN);
        return window.supabase.createClient(c.supabase_url, c.anon_key, {
          auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, storageKey: "asa-acceso-correo" },
        });
      })();
    }
    return clientePromesa;
  }

  // Vuelve a la misma pantalla de la app, sin ?code= ni #...
  const volverA = () => location.origin + location.pathname;
  const limpiarURL = () => history.replaceState(null, "", location.pathname);
  const vieneDeVuelta = () => /[?&](code|error_description|error)=/.test(location.search) || /access_token=|error_description=/.test(location.hash);

  async function canjear(api, sb) {
    const { data } = await sb.auth.getSession();
    const sesion = data?.session;
    if (!sesion) return null;
    const ticket = sessionStorage.getItem(CLAVE_TICKET) || undefined;
    let r, cuerpo;
    try {
      r = await fetch(`${api}/usuarios/login-correo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: sesion.access_token, ticket }),
      });
      cuerpo = await r.json().catch(() => ({}));
    } finally {
      // La sesión de Supabase ya no hace falta: la app usa el token de ASA
      await sb.auth.signOut({ scope: "local" }).catch(() => {});
    }
    if (!r.ok) throw new Error(cuerpo.mensaje || "No se pudo entrar con ese correo");
    return cuerpo;
  }

  const ICONOS = {
    google: `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`,
    azure: `<svg width="18" height="18" viewBox="0 0 23 23" aria-hidden="true"><path fill="#f35325" d="M1 1h10v10H1z"/><path fill="#81bc06" d="M12 1h10v10H12z"/><path fill="#05a6f0" d="M1 12h10v10H1z"/><path fill="#ffba08" d="M12 12h10v10H12z"/></svg>`,
    email: `<span aria-hidden="true" style="font-size:16px">✉️</span>`,
  };
  const TEXTOS = { google: "Entrar con Google", azure: "Entrar con Microsoft / Hotmail", email: "Recibir un código en mi correo" };
  const ESTILO_BTN = "display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:11px 12px;margin-top:8px;border:1px solid #d0d7e2;border-radius:9px;background:#fff;color:#1c2433;font:inherit;font-weight:600;cursor:pointer";

  async function montar({ contenedor, api, alEntrar, ticket, cuenta }) {
    if (!contenedor) return;
    if (ticket) {
      sessionStorage.setItem(CLAVE_TICKET, ticket);
      if (cuenta) sessionStorage.setItem(CLAVE_CUENTA, cuenta);
    }
    const pasoPersona = !!sessionStorage.getItem(CLAVE_TICKET);
    const cfg = await config(api);
    if (!cfg?.oauth) {
      contenedor.innerHTML = pasoPersona
        ? `<div style="color:#b91c1c;margin-top:10px">El acceso con correo no está configurado en el servidor.</div>`
        : "";
      return;
    }

    const mensaje = (texto, error) => {
      let m = contenedor.querySelector("[data-ac-msg]");
      if (!m) {
        m = document.createElement("div");
        m.dataset.acMsg = "";
        m.style.cssText = "margin-top:10px;font-size:13.5px;line-height:1.4";
        contenedor.appendChild(m);
      }
      m.style.color = error ? "#b91c1c" : "#475569";
      m.textContent = texto || "";
    };

    const entrar = async (sb) => {
      const r = await canjear(api, sb);
      if (!r) return false;
      if (r.requiere_persona) {
        // Entró con el correo de la cuenta del hotel: falta la persona
        montar({ contenedor, api, alEntrar, ticket: r.ticket, cuenta: r.cuenta });
        return true;
      }
      sessionStorage.removeItem(CLAVE_TICKET);
      sessionStorage.removeItem(CLAVE_CUENTA);
      await alEntrar(r);
      return true;
    };

    const cuentaTxt = sessionStorage.getItem(CLAVE_CUENTA);
    contenedor.innerHTML = `
      ${pasoPersona
        ? `<div style="margin-top:6px;padding:12px;border-radius:10px;background:#eef3fb;color:#1c2433;font-size:14px;line-height:1.45">
             <strong>Paso 2: ¿quién eres?</strong><br>
             ${cuentaTxt ? `La cuenta <strong>${esc(cuentaTxt)}</strong> la usan varias personas. ` : ""}Entra con <strong>tu</strong> correo personal; tiene que estar autorizado por Ambiente y Salud.
           </div>`
        : `<div style="display:flex;align-items:center;gap:10px;margin:18px 0 4px;color:#94a3b8;font-size:13px">
             <span style="flex:1;height:1px;background:#e2e8f0"></span>o<span style="flex:1;height:1px;background:#e2e8f0"></span>
           </div>`}
      ${cfg.proveedores.map((p) => TEXTOS[p] ? `<button type="button" data-ac="${p}" style="${ESTILO_BTN}">${ICONOS[p]} ${TEXTOS[p]}</button>` : "").join("")}
      <div data-ac-codigo hidden style="margin-top:10px">
        <input type="email" data-ac-correo placeholder="tu@correo.com" autocomplete="email" style="width:100%;padding:11px 12px;border:1px solid #d0d7e2;border-radius:9px;box-sizing:border-box" />
        <button type="button" data-ac-enviar style="${ESTILO_BTN}">Enviarme el código</button>
        <div data-ac-paso2 hidden>
          <input inputmode="numeric" data-ac-num placeholder="Código de 6 dígitos" maxlength="10" style="width:100%;padding:11px 12px;margin-top:8px;border:1px solid #d0d7e2;border-radius:9px;box-sizing:border-box;letter-spacing:3px" />
          <button type="button" data-ac-verificar style="${ESTILO_BTN}">Entrar con el código</button>
        </div>
      </div>
      ${pasoPersona ? `<button type="button" data-ac-cancelar style="${ESTILO_BTN};border:none;background:none;color:#64748b;font-weight:500">Cancelar</button>` : ""}`;

    const ocupado = (b, si, texto) => { if (!b) return; b.disabled = si; if (texto) b.dataset.t = b.dataset.t || b.innerHTML; b.innerHTML = si ? texto : b.dataset.t || b.innerHTML; };

    contenedor.querySelectorAll("[data-ac]").forEach((b) =>
      b.addEventListener("click", async () => {
        const proveedor = b.dataset.ac;
        if (proveedor === "email") {
          contenedor.querySelector("[data-ac-codigo]").hidden = false;
          contenedor.querySelector("[data-ac-correo]").focus();
          return;
        }
        try {
          ocupado(b, true, "Abriendo…");
          const sb = await cliente(api);
          const { error } = await sb.auth.signInWithOAuth({
            provider: proveedor,
            options: {
              redirectTo: volverA(),
              scopes: proveedor === "azure" ? "email openid profile" : undefined,
              queryParams: { prompt: "select_account" },
            },
          });
          if (error) throw error;
        } catch (e) {
          ocupado(b, false);
          mensaje(e.message, true);
        }
      })
    );

    let correoCodigo = "";
    contenedor.querySelector("[data-ac-enviar]")?.addEventListener("click", async (ev) => {
      const b = ev.currentTarget;
      correoCodigo = contenedor.querySelector("[data-ac-correo]").value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correoCodigo)) return mensaje("Escribe un correo válido", true);
      try {
        ocupado(b, true, "Enviando…");
        const sb = await cliente(api);
        const { error } = await sb.auth.signInWithOtp({ email: correoCodigo, options: { shouldCreateUser: true, emailRedirectTo: volverA() } });
        if (error) throw error;
        contenedor.querySelector("[data-ac-paso2]").hidden = false;
        contenedor.querySelector("[data-ac-num]").focus();
        mensaje(`Te enviamos un código a ${correoCodigo}. Revisa también el correo no deseado.`);
      } catch (e) {
        mensaje(/rate|seconds|limit/i.test(e.message) ? "Espera un minuto antes de pedir otro código." : e.message, true);
      } finally {
        ocupado(b, false);
      }
    });

    contenedor.querySelector("[data-ac-verificar]")?.addEventListener("click", async (ev) => {
      const b = ev.currentTarget;
      const token = contenedor.querySelector("[data-ac-num]").value.replace(/\s/g, "");
      if (!token) return mensaje("Escribe el código que te llegó", true);
      try {
        ocupado(b, true, "Verificando…");
        const sb = await cliente(api);
        const { error } = await sb.auth.verifyOtp({ email: correoCodigo, token, type: "email" });
        if (error) throw new Error("El código no es válido o ya venció. Pide otro.");
        await entrar(sb);
      } catch (e) {
        mensaje(e.message, true);
      } finally {
        ocupado(b, false);
      }
    });

    contenedor.querySelector("[data-ac-cancelar]")?.addEventListener("click", () => {
      sessionStorage.removeItem(CLAVE_TICKET);
      sessionStorage.removeItem(CLAVE_CUENTA);
      location.replace(volverA());
    });

    // De vuelta de Google / Microsoft / el enlace del correo
    if (vieneDeVuelta()) {
      const err = new URLSearchParams(location.search).get("error_description") || new URLSearchParams(location.hash.slice(1)).get("error_description");
      if (err) {
        limpiarURL();
        mensaje(`No se pudo entrar: ${err}`, true);
        return;
      }
      mensaje("Verificando tu correo…");
      try {
        const sb = await cliente(api);
        const listo = await entrar(sb);
        limpiarURL();
        if (!listo) mensaje("No se pudo completar la entrada. Inténtalo de nuevo.", true);
      } catch (e) {
        limpiarURL();
        mensaje(e.message, true);
      }
    }
  }

  window.AccesoCorreo = {
    montar,
    pedirPersona: (r) => !!r?.requiere_persona,
  };
})();
