// ═════════════════════════════════════════════════════════════════════════
// configuracion.js — Datos de la empresa, permisos por rol y auditoría
//
// Se carga después de admin.js. Aporta MODULOS_EXTRA_2, que app.js concatena
// a su lista de módulos.
//
// La matriz de permisos NO sustituye al control del backend: el servidor sigue
// rechazando por rol en cada ruta. Esto decide qué módulos se dibujan y qué
// botones salen — que es lo que hace que la secretaria no vea diez entradas
// que no puede usar.
// ═════════════════════════════════════════════════════════════════════════

const MODULOS_EXTRA_2 = [
  { key: "configuracion", label: "Configuración", ic: "⚙️", seccion: "admin",
    roles: ["admin"], view: viewConfiguracion },
  { key: "auditoria", label: "Auditoría", ic: "🧾", seccion: "admin",
    roles: ["admin"], view: viewAuditoria },
];

// ── Configuración ────────────────────────────────────────────────────────
async function viewConfiguracion(content) {
  content.innerHTML = `
    <div class="tabs" id="tabs-config">
      <button class="tab active" data-tab="empresa">Mi empresa</button>
      <button class="tab" data-tab="permisos">Permisos por rol</button>
    </div>
    <div id="config-cuerpo"><div class="center-msg">Cargando…</div></div>`;

  const cuerpo = $("#config-cuerpo");
  const pintores = {
    empresa: () => pintarEmpresa(cuerpo),
    permisos: () => pintarPermisos(cuerpo),
  };

  $$("#tabs-config .tab").forEach((b) =>
    b.addEventListener("click", () => {
      $$("#tabs-config .tab").forEach((x) => x.classList.toggle("active", x === b));
      cuerpo.innerHTML = `<div class="center-msg">Cargando…</div>`;
      Promise.resolve(pintores[b.dataset.tab]()).catch((e) => {
        cuerpo.innerHTML = `<div class="form-error" style="display:block">${esc(e.message)}</div>`;
      });
    })
  );
  await pintores.empresa();
}

const CAMPOS_EMPRESA = [
  ["nombre", "Nombre comercial", "Ambiente y Salud RD"],
  ["razon_social", "Razón social", "Ambiente y Salud RD, SRL"],
  ["siglas", "Siglas", "ASA SRL"],
  ["rnc", "RNC", "1-31-12345-6"],
  ["telefono", "Teléfono principal", "+1 (829) 260-5444"],
  ["telefono_alterno", "Teléfono alterno", ""],
  ["email", "Correo", "info@ambienteysaludrd.com"],
  ["web", "Página web", "ambienteysalud.online"],
  ["direccion", "Dirección", "Av. Prof. Juan Bosch, Santo Domingo Este"],
  ["licencia_sanitaria", "Licencia sanitaria", "Número que exige Salud Pública"],
  ["registro_mip", "Registro del programa MIP", ""],
  ["responsable_tecnico", "Responsable técnico", "Quien firma los reportes"],
  ["logo_url", "URL del logo", "https://…"],
];

async function pintarEmpresa(cuerpo) {
  const e = await get("/config/empresa");

  cuerpo.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>Datos de Ambiente y Salud</h2></div>
      <p class="text-muted">
        Estos datos salen impresos en la cabecera de cada reporte de evidencia
        que se entrega al hotel. La licencia sanitaria y el responsable técnico
        son los dos que pide una auditoría, así que conviene tenerlos llenos.
      </p>
      <form id="form-empresa">
        <div class="form-grid">
          ${CAMPOS_EMPRESA.map(([k, etiqueta, ayuda]) => `
            <div class="form-group${k === "direccion" || k === "logo_url" ? " full" : ""}">
              <label>${esc(etiqueta)}</label>
              <input name="${k}" value="${esc(e?.[k] || "")}" placeholder="${esc(ayuda)}" />
            </div>`).join("")}
          <div class="form-group full">
            <label>Pie de los reportes</label>
            <textarea name="pie_reportes" rows="2">${esc(e?.pie_reportes || "")}</textarea>
          </div>
        </div>
        <div class="actions" style="margin-top:14px">
          <button class="btn btn-primary" type="submit">Guardar datos de la empresa</button>
        </div>
      </form>
    </div>`;

  $("#form-empresa").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const valor = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v).trim()]));
    try {
      await put("/config/empresa", { valor });
      CONFIG_EMPRESA = valor;
      toast("Datos de la empresa guardados");
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ── Permisos ─────────────────────────────────────────────────────────────
async function pintarPermisos(cuerpo) {
  const c = await get("/config");
  const permisos = c.permisos || {};
  const modulos = c._catalogos?.modulos || [];
  const niveles = c._catalogos?.niveles || [];

  // Los roles que existen de verdad en el sistema. Se toman de los permisos
  // guardados más los del listado de usuarios, para que un rol nuevo no quede
  // fuera de la tabla solo porque nadie lo configuró todavía.
  const roles = [...new Set([...Object.keys(permisos), "admin", "operaciones", "comercial", "tecnico_plagas", "contabilidad", "nomina"])];

  cuerpo.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Qué puede hacer cada rol</h2>
        <div class="actions"><button class="btn btn-primary" id="perm-guardar">Guardar permisos</button></div>
      </div>
      <p class="text-muted">
        Esto decide qué módulos ve cada persona al entrar y qué botones le
        aparecen. <strong>No es la única defensa</strong>: el servidor sigue
        rechazando por rol en cada ruta, así que quitar un módulo de aquí no abre
        un hueco si alguien escribe la dirección a mano.
      </p>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr><th>Módulo</th>${roles.map((r) => `<th>${esc(etiquetaRol(r))}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${modulos.map(([mk, mlabel]) => `
              <tr>
                <td><strong>${esc(mlabel)}</strong></td>
                ${roles.map((r) => `
                  <td>
                    <select data-rol="${esc(r)}" data-modulo="${esc(mk)}" ${r === "admin" ? "disabled" : ""}>
                      ${niveles.map(([nk, nlabel]) => {
                        const actual = r === "admin" ? "todo" : (permisos[r]?.[mk] || "ninguno");
                        return `<option value="${esc(nk)}"${actual === nk ? " selected" : ""}>${esc(nlabel)}</option>`;
                      }).join("")}
                    </select>
                  </td>`).join("")}
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <p class="text-muted" style="margin-top:12px">
        El administrador queda fijo en <strong>todo</strong> a propósito: si se
        pudiera bajar, un clic dejaría al sistema sin quién lo administre y sin
        forma de arreglarlo desde la pantalla.
      </p>
    </div>`;

  $("#perm-guardar").addEventListener("click", async () => {
    const nuevo = {};
    $$("#config-cuerpo select[data-rol]").forEach((sel) => {
      const r = sel.dataset.rol;
      (nuevo[r] = nuevo[r] || {})[sel.dataset.modulo] = sel.value;
    });
    // El admin no se toca
    nuevo.admin = Object.fromEntries(modulos.map(([mk]) => [mk, "todo"]));
    try {
      await put("/config/permisos", { valor: nuevo });
      PERMISOS = nuevo;
      toast("Permisos guardados. Cada quien los verá al volver a entrar.");
    } catch (e) {
      toast(e.message, true);
    }
  });
}

// ── Auditoría ────────────────────────────────────────────────────────────
const ACCION_ETIQUETA = {
  crear: "Creó", actualizar: "Modificó", eliminar: "Eliminó",
  cambio_estado: "Cambió estado", login: "Entró",
};

async function viewAuditoria(content) {
  content.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>Bitácora: quién hizo qué</h2></div>
      <p class="text-muted">
        Cada acción que modifica datos queda registrada con el nombre de quien la
        hizo. El nombre se guarda congelado: si después borras esa cuenta, lo que
        hizo sigue apareciendo con su nombre. Una bitácora que se vacía al
        despedir a alguien no sirve de nada.
      </p>
      <div class="toolbar">
        <select id="au-usuario"><option value="">Todo el personal</option></select>
        <select id="au-modulo"><option value="">Todos los módulos</option></select>
        <select id="au-accion"><option value="">Todas las acciones</option></select>
        <input type="date" id="au-desde" />
        <input type="date" id="au-hasta" />
        <input type="search" id="au-buscar" placeholder="Buscar en la descripción…" />
        <button class="btn btn-sm" id="au-limpiar">Limpiar</button>
      </div>
      <div id="au-resumen"></div>
      <div id="au-tabla"><div class="center-msg">Cargando…</div></div>
    </div>`;

  get("/auditoria/filtros").then((f) => {
    $("#au-usuario").innerHTML = `<option value="">Todo el personal</option>` +
      f.usuarios.map((u) => `<option value="${esc(u.nombre)}">${esc(u.nombre)}</option>`).join("");
    $("#au-modulo").innerHTML = `<option value="">Todos los módulos</option>` +
      f.modulos.map((m) => `<option value="${esc(m)}">${esc(m.replace(/_/g, " "))}</option>`).join("");
    $("#au-accion").innerHTML = `<option value="">Todas las acciones</option>` +
      f.acciones.map((a) => `<option value="${esc(a)}">${esc(ACCION_ETIQUETA[a] || a)}</option>`).join("");
  }).catch(() => {});

  get("/auditoria/resumen?dias=30").then((r) => {
    if (!r.total) return;
    $("#au-resumen").innerHTML = `
      <div class="kpi-grid" style="margin-bottom:12px">
        <div class="kpi-card"><div class="lbl">Acciones en 30 días</div><div class="val">${r.total}</div></div>
        ${r.por_usuario.slice(0, 3).map((u) => `
          <div class="kpi-card"><div class="lbl">${esc(u.usuario)}</div><div class="val">${u.total}</div></div>`).join("")}
      </div>`;
  }).catch(() => {});

  async function cargar() {
    const qs = new URLSearchParams();
    const pon = (id, clave) => { const v = $(id).value.trim(); if (v) qs.set(clave, v); };
    pon("#au-usuario", "usuario");
    pon("#au-modulo", "modulo");
    pon("#au-accion", "accion");
    pon("#au-desde", "desde");
    pon("#au-hasta", "hasta");
    pon("#au-buscar", "buscar");

    const r = await get(`/auditoria?${qs}`);
    $("#au-tabla").innerHTML = `
      ${r.total > r.registros.length
        ? `<p class="text-muted">Mostrando los ${r.registros.length} más recientes de ${r.total}. Afina los filtros para ver el resto.</p>`
        : ""}
      ${tableHTML(
        [
          { key: "created_at", label: "Cuándo", fmt: (x) => fmtDateTime(x.created_at) },
          { key: "usuario_nombre", label: "Quién", fmt: (x) => `<strong>${esc(x.usuario_nombre || "Sistema")}</strong>` },
          { key: "accion", label: "Qué hizo", fmt: (x) => badge(ACCION_ETIQUETA[x.accion] || x.accion) },
          { key: "modulo", label: "Dónde", fmt: (x) => esc((x.modulo || "").replace(/_/g, " ")) },
          { key: "descripcion", label: "Detalle", fmt: (x) => esc(x.descripcion || "—") },
        ],
        r.registros.map((x) => ({ ...x, _clickable: false })),
        "No hay acciones registradas con esos filtros."
      )}`;
  }

  ["#au-usuario", "#au-modulo", "#au-accion", "#au-desde", "#au-hasta"].forEach((id) =>
    $(id).addEventListener("change", cargar)
  );
  let t;
  $("#au-buscar").addEventListener("input", () => { clearTimeout(t); t = setTimeout(cargar, 300); });
  $("#au-limpiar").addEventListener("click", () => {
    ["#au-usuario", "#au-modulo", "#au-accion", "#au-desde", "#au-hasta", "#au-buscar"].forEach((id) => ($(id).value = ""));
    cargar();
  });

  await cargar();
}
