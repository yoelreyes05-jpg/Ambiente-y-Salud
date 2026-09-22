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
      <button class="tab" data-tab="estados">Estados del punto</button>
      <button class="tab" data-tab="permisos">Permisos por rol</button>
    </div>
    <div id="config-cuerpo"><div class="center-msg">Cargando…</div></div>`;

  const cuerpo = $("#config-cuerpo");
  const pintores = {
    empresa: () => pintarEmpresa(cuerpo),
    estados: () => pintarEstadosPunto(cuerpo),
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

// ── Estados del punto ────────────────────────────────────────────────────
//
// Lo primero que el técnico ve al abrir un punto. Venía clavado del sistema
// anterior: seis botones escritos dentro de la app, repetidos en el backend y
// blindados con un CHECK en la base, así que no se podía cambiar ni una palabra
// desde aquí. Ahora es una lista editable y la app la baja sola.
//
// Dos cosas que no se tocan a propósito:
//   · El código es lo que queda escrito en cada inspección y en los reportes ya
//     entregados. Se puede cambiar el nombre que lee el técnico sin tocarlo; si
//     se cambia el código, los registros viejos se quedan con el anterior.
//   · "Todo bien" y "No pude entrar" no se borran: el primero es el valor por
//     defecto y el segundo es de donde sale todo el reporte de no realizados.
const COLORES_ESTADO = [
  ["#4A7D4D", "Verde — todo en orden"],
  ["#B45309", "Ámbar — ojo con esto"],
  ["#B91C1C", "Rojo — problema"],
  ["#32539C", "Azul — informativo"],
  ["#475569", "Gris — neutro"],
];

async function pintarEstadosPunto(cuerpo) {
  let estados = await get("/config/estados_punto");
  if (!Array.isArray(estados)) estados = [];

  const fila = (e, i) => `
    <tr data-i="${i}">
      <td><input class="est-etiqueta" value="${esc(e.etiqueta || "")}" placeholder="Lo que lee el técnico" /></td>
      <td>
        <input class="est-codigo" value="${esc(e.codigo || "")}" placeholder="codigo_interno"
               ${e.sistema ? "disabled title='Este código no se cambia: lo usan las inspecciones ya guardadas'" : ""} />
      </td>
      <td>
        <select class="est-color">
          ${COLORES_ESTADO.map(([c, n]) => `<option value="${c}"${(e.color || "#475569") === c ? " selected" : ""}>${esc(n)}</option>`).join("")}
        </select>
      </td>
      <td style="text-align:center">
        <input type="checkbox" class="est-motivo" ${e.requiere_motivo ? "checked" : ""}
               ${e.codigo === "no_accesible" ? "disabled title='Este siempre pide motivo'" : ""} />
      </td>
      <td style="text-align:center"><input type="checkbox" class="est-hallazgo" ${e.genera_hallazgo ? "checked" : ""} /></td>
      <td style="text-align:center"><input type="checkbox" class="est-activo" ${e.activo !== false ? "checked" : ""} /></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-sm" data-subir="${i}" title="Subir">↑</button>
        <button class="btn btn-sm" data-bajar="${i}" title="Bajar">↓</button>
        ${e.sistema
          ? `<button class="btn btn-sm" disabled title="No se puede borrar: lo usan inspecciones ya registradas">🔒</button>`
          : `<button class="btn btn-sm" data-borrar="${i}" title="Quitar">✕</button>`}
      </td>
    </tr>`;

  const pintar = () => {
    cuerpo.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h2>Estado del punto</h2>
          <div class="actions">
            <button class="btn" id="est-nuevo">+ Agregar estado</button>
            <button class="btn btn-primary" id="est-guardar">Guardar</button>
          </div>
        </div>
        <p class="text-muted">
          Es la primera pregunta que el técnico ve al escanear un punto. Cambia
          los nombres, agrega los que te falten y desactiva los que no uses: la
          app se actualiza sola la próxima vez que el técnico tenga señal.
          <strong>El código</strong> es lo que queda escrito en la inspección y en
          los reportes ya entregados; cámbiale el nombre cuando quieras, pero el
          código déjalo quieto.
        </p>
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Lo que lee el técnico</th>
                <th>Código guardado</th>
                <th>Color</th>
                <th title="Pide el motivo y se salta el checklist: es lo que marca el servicio como NO REALIZADO">Pide motivo</th>
                <th title="Abre un hallazgo para que quede pendiente de corregir">Abre hallazgo</th>
                <th>Activo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${estados.map(fila).join("")}</tbody>
          </table>
        </div>
        <p class="text-muted" style="margin-top:12px">
          Desactivar un estado lo saca de la app, pero no toca las inspecciones
          que ya lo usaron: el reporte de meses pasados sigue leyéndose igual.
        </p>
      </div>`;

    // Lo escrito en la tabla se guarda en memoria antes de reordenar o borrar,
    // porque volver a pintar la tabla borra lo que no se haya leído.
    const leerTabla = () => {
      cuerpo.querySelectorAll("tbody tr[data-i]").forEach((tr) => {
        const e = estados[Number(tr.dataset.i)];
        if (!e) return;
        e.etiqueta = tr.querySelector(".est-etiqueta").value.trim();
        const cod = tr.querySelector(".est-codigo");
        if (!cod.disabled) e.codigo = cod.value.trim();
        e.color = tr.querySelector(".est-color").value;
        e.requiere_motivo = tr.querySelector(".est-motivo").checked;
        e.genera_hallazgo = tr.querySelector(".est-hallazgo").checked;
        e.activo = tr.querySelector(".est-activo").checked;
      });
      estados.forEach((e, i) => { e.orden = (i + 1) * 10; });
    };

    const mover = (i, salto) => {
      leerTabla();
      const j = i + salto;
      if (j < 0 || j >= estados.length) return;
      [estados[i], estados[j]] = [estados[j], estados[i]];
      pintar();
    };

    cuerpo.querySelectorAll("[data-subir]").forEach((b) =>
      b.addEventListener("click", () => mover(Number(b.dataset.subir), -1)));
    cuerpo.querySelectorAll("[data-bajar]").forEach((b) =>
      b.addEventListener("click", () => mover(Number(b.dataset.bajar), 1)));
    cuerpo.querySelectorAll("[data-borrar]").forEach((b) =>
      b.addEventListener("click", () => {
        leerTabla();
        estados.splice(Number(b.dataset.borrar), 1);
        pintar();
      }));

    $("#est-nuevo").addEventListener("click", () => {
      leerTabla();
      estados.push({
        codigo: "", etiqueta: "", color: "#475569",
        orden: (estados.length + 1) * 10, activo: true,
        sistema: false, requiere_motivo: false, genera_hallazgo: false,
      });
      pintar();
      // El foco en la casilla nueva: agregar un estado y tener que buscar dónde
      // escribir es el tipo de fricción que hace que nadie lo use.
      cuerpo.querySelector("tbody tr:last-child .est-etiqueta")?.focus();
    });

    $("#est-guardar").addEventListener("click", async () => {
      leerTabla();

      // El código se deduce del nombre cuando el estado es nuevo: quien lo está
      // agregando piensa en "Tapa suelta", no en "tapa_suelta".
      for (const e of estados) {
        if (!e.codigo && e.etiqueta) {
          e.codigo = e.etiqueta.toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_ñáéíóúü]/g, "");
        }
      }
      const sinNombre = estados.filter((e) => !e.etiqueta.trim());
      if (sinNombre.length) return toast("Hay un estado sin nombre", true);

      try {
        const r = await put("/config/estados_punto", { valor: estados });
        estados = Array.isArray(r?.valor) ? r.valor : estados;
        pintar();
        toast("Estados guardados. Los técnicos los verán al próximo sincronizar.");
      } catch (e) {
        toast(e.message, true);
      }
    });
  };

  pintar();
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
