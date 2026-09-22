// ═════════════════════════════════════════════════════════════════════════
// flota.js — Flota y transportación de ASA dentro del panel
//
// El módulo venía del CRM del taller, hecho en Next.js. Aquí está reescrito
// con los mismos ayudantes del panel (get/post/openModal/tableHTML) en vez de
// traerse React: el panel no tiene build step a propósito, y montar uno solo
// para esta pantalla habría convertido "editar el panel" en "compilar el
// panel" para todo lo demás.
//
// Seis pestañas: Tablero, Vehículos, Fallas, Gastos, Reportes y Configuración.
// El parte diario lo llena el conductor desde la app del técnico o desde la
// pantalla pública, no desde aquí.
// ═════════════════════════════════════════════════════════════════════════

const MODULOS_EXTRA_3 = [
  { key: "flota", label: "Flota", ic: "🚐", seccion: "operacion",
    roles: ["admin", "operaciones", "contabilidad"], view: viewFlota },
];

const MONEDA = (n) => `RD$ ${Number(n || 0).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const NUM = (n, d = 0) => Number(n || 0).toLocaleString("es-DO", { minimumFractionDigits: d, maximumFractionDigits: d });

const TIPOS_VEHICULO = ["AUTO", "CAMIONETA", "JEEPETA", "CAMION", "MINIBUS", "AUTOBUS", "MOTOR", "FURGONETA", "OTRO"];
const COMBUSTIBLES = ["GASOLINA", "GASOIL", "GLP", "GNV", "HIBRIDO", "ELECTRICO"];
const ESTADOS_VEHICULO = ["ACTIVO", "EN_TALLER", "FUERA_SERVICIO", "VENDIDO"];
const TIPOS_GASTO = ["COMBUSTIBLE", "MANTENIMIENTO", "REPARACION", "GOMAS", "DOCUMENTOS", "SEGURO", "PEAJE", "PARQUEO", "MULTA", "LAVADO", "ACCESORIOS", "OTRO"];
const TIPOS_DOC = ["MARBETE", "SEGURO", "INSPECCION", "PLACA", "CONTRATO", "GARANTIA", "OTRO"];
const ESTADOS_FALLA = ["ABIERTA", "EN_REVISION", "EN_TALLER", "RESUELTA", "DESCARTADA"];

// La aguja del tanque en octavos, igual que la ve el conductor.
const OCTAVOS = ["E", "⅛", "¼", "⅜", "½", "⅝", "¾", "⅞", "F"];

const apiFlota = {
  get: (ruta) => get(`/flota${ruta}`),
  post: (ruta, cuerpo) => post(`/flota${ruta}`, cuerpo),
  patch: (ruta, cuerpo) => patch(`/flota${ruta}`, cuerpo),
  del: (ruta) => api(`/flota${ruta}`, { method: "DELETE" }),
};

async function viewFlota(content) {
  content.innerHTML = `
    <div class="tabs" id="tabs-flota">
      <button class="tab active" data-tab="tablero">Tablero</button>
      <button class="tab" data-tab="vehiculos">Vehículos</button>
      <button class="tab" data-tab="fallas">Fallas</button>
      <button class="tab" data-tab="gastos">Gastos</button>
      <button class="tab" data-tab="reportes">Reportes</button>
      <button class="tab" data-tab="config">Configuración</button>
    </div>
    <div id="flota-cuerpo"><div class="center-msg">Cargando…</div></div>`;

  const cuerpo = $("#flota-cuerpo");
  const pintores = {
    tablero: () => flotaTablero(cuerpo),
    vehiculos: () => flotaVehiculos(cuerpo),
    fallas: () => flotaFallas(cuerpo),
    gastos: () => flotaGastos(cuerpo),
    reportes: () => flotaReportes(cuerpo),
    config: () => flotaConfig(cuerpo),
  };

  $$("#tabs-flota .tab").forEach((b) =>
    b.addEventListener("click", () => {
      $$("#tabs-flota .tab").forEach((x) => x.classList.toggle("active", x === b));
      cuerpo.innerHTML = `<div class="center-msg">Cargando…</div>`;
      Promise.resolve(pintores[b.dataset.tab]()).catch((e) => {
        cuerpo.innerHTML = `<div class="card"><div class="form-error" style="display:block">${esc(e.message)}</div></div>`;
      });
    })
  );
  await pintores.tablero();
}

// ── Tablero ──────────────────────────────────────────────────────────────
async function flotaTablero(cuerpo) {
  const d = await apiFlota.get(`/dashboard`);
  const k = d.kpis;

  cuerpo.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card ${k.faltan_chequeo ? "r" : "g"}">
        <div class="lbl">No han reportado hoy</div><div class="val">${k.faltan_chequeo}</div>
      </div>
      <div class="kpi-card ${k.no_aptos ? "r" : "g"}">
        <div class="lbl">No deben salir</div><div class="val">${k.no_aptos}</div>
      </div>
      <div class="kpi-card ${k.fallas_graves ? "r" : k.fallas_abiertas ? "w" : "g"}">
        <div class="lbl">Fallas abiertas</div><div class="val">${k.fallas_abiertas}</div>
      </div>
      <div class="kpi-card ${k.documentos_alerta ? "w" : "g"}">
        <div class="lbl">Papeles por vencer</div><div class="val">${k.documentos_alerta}</div>
      </div>
      <div class="kpi-card"><div class="lbl">Unidades activas</div><div class="val">${k.vehiculos_activos}</div></div>
      <div class="kpi-card"><div class="lbl">Gasto del mes</div><div class="val">${MONEDA(k.gasto_mes)}</div></div>
      <div class="kpi-card"><div class="lbl">Costo por km de la flota</div>
        <div class="val">${k.costo_km_flota == null ? "—" : MONEDA(k.costo_km_flota)}</div></div>
      <div class="kpi-card"><div class="lbl">Reportaron hoy</div><div class="val">${k.chequearon_hoy}</div></div>
    </div>

    ${d.sin_chequeo.length ? `
      <div class="card card-rojo">
        <div class="card-head"><h2>Sin parte de hoy — ${d.sin_chequeo.length}</h2></div>
        <p class="text-muted">
          Estas unidades salieron sin que nadie revisara nada. Es el número que
          más conviene mirar antes de las 9 de la mañana.
        </p>
        ${tableHTML(
          [
            { key: "codigo", label: "Unidad", fmt: (v) => `<strong>${esc(v.codigo)}</strong>` },
            { key: "placa", label: "Placa" },
            { key: "conductor", label: "Conductor", fmt: (v) => esc(v.conductor || "Sin asignar") },
            { key: "km_actual", label: "Último km", fmt: (v) => NUM(v.km_actual) },
          ],
          d.sin_chequeo.map((v) => ({ ...v, _clickable: false })),
          "Ninguna."
        )}
      </div>` : `
      <div class="card"><div class="center-msg" style="color:var(--verde,#4A7D4D)">
        Todas las unidades activas reportaron hoy.
      </div></div>`}

    <div class="dos-columnas">
      <div class="card">
        <div class="card-head"><h2>Partes de hoy</h2></div>
        ${tableHTML(
          [
            { key: "vehiculo", label: "Unidad", fmt: (c) => esc(nombreVehiculo(d.vehiculos, c.vehiculo_id)) },
            { key: "conductor_nombre", label: "Conductor", fmt: (c) => esc(c.conductor_nombre || "—") },
            { key: "turno", label: "Turno" },
            { key: "km", label: "Km", fmt: (c) => NUM(c.km) },
            { key: "combustible_octavos", label: "Tanque", fmt: (c) => (c.combustible_octavos == null ? "—" : OCTAVOS[c.combustible_octavos]) },
            { key: "items_mal", label: "Fallos", fmt: (c) => (c.items_mal ? `<span class="estado-chip pendiente">${c.items_mal}</span>` : "0") },
            { key: "apto_circular", label: "Apta", fmt: (c) => (c.apto_circular ? `<span class="estado-chip hecho">Sí</span>` : `<span class="estado-chip pendiente">NO</span>`) },
          ],
          (d.chequeos_hoy || []).map((c) => ({ ...c, _clickable: false })),
          "Todavía no ha entrado ningún parte hoy."
        )}
      </div>

      <div class="card">
        <div class="card-head"><h2>Papeles por vencer</h2></div>
        ${tableHTML(
          [
            { key: "codigo", label: "Unidad" },
            { key: "tipo", label: "Documento" },
            { key: "vence", label: "Vence", fmt: (x) => fmtDate(x.vence) },
            {
              key: "dias_restantes", label: "Faltan",
              fmt: (x) => x.situacion === "VENCIDO"
                ? `<span class="estado-chip pendiente">Vencido hace ${Math.abs(x.dias_restantes)} días</span>`
                : `<span class="estado-chip fuera">${x.dias_restantes} días</span>`,
            },
          ],
          (d.documentos_alerta || []).map((x) => ({ ...x, _clickable: false })),
          "Ningún documento por vencer."
        )}
        <p class="text-muted" style="margin-top:10px">
          El marbete se renueva todos los años y vence el 31 de enero sin prórroga.
        </p>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Fallas abiertas</h2></div>
      ${tableHTML(
        [
          { key: "vehiculo", label: "Unidad", fmt: (f) => esc(nombreVehiculo(d.vehiculos, f.vehiculo_id)) },
          { key: "falla_etiqueta", label: "Falla", fmt: (f) => `<strong>${esc(f.falla_etiqueta || f.falla_codigo)}</strong>` },
          { key: "severidad", label: "Severidad", fmt: (f) => badge(f.severidad) },
          { key: "veces_reportada", label: "Veces", fmt: (f) => (f.veces_reportada > 2 ? `<span class="estado-chip pendiente">${f.veces_reportada}</span>` : f.veces_reportada) },
          { key: "conductor_nombre", label: "Reportó", fmt: (f) => esc(f.conductor_nombre || "—") },
          { key: "ultima_vez", label: "Última vez", fmt: (f) => fmtDate(f.ultima_vez) },
          { key: "estado", label: "Estado", fmt: (f) => badge(f.estado) },
        ],
        d.fallas_abiertas || [],
        "Ninguna falla abierta."
      )}
      <p class="text-muted" style="margin-top:10px">
        Una falla reportada cinco veces y todavía abierta no es problema del
        vehículo: es de gestión. Por eso la columna <strong>Veces</strong> se
        marca en rojo a partir de tres.
      </p>
    </div>`;

  $("#flota-cuerpo").querySelectorAll("tr[data-id]").forEach((tr) => {
    const f = (d.fallas_abiertas || []).find((x) => String(x.id) === tr.dataset.id);
    if (f) tr.addEventListener("click", () => modalFalla(f, () => flotaTablero(cuerpo)));
  });
}

const nombreVehiculo = (lista, id) => {
  const v = (lista || []).find((x) => x.id === id);
  return v ? `${v.codigo} · ${v.placa}` : `#${id}`;
};

// ── Vehículos ────────────────────────────────────────────────────────────
async function flotaVehiculos(cuerpo) {
  cuerpo.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Vehículos de la empresa</h2>
        <div class="actions">
          <label class="campo-check" style="margin:0"><input type="checkbox" id="fv-bajas" /> Ver dados de baja</label>
          <button class="btn btn-primary" id="fv-nuevo">+ Vehículo</button>
        </div>
      </div>
      <div id="fv-tabla"><div class="center-msg">Cargando…</div></div>
    </div>`;

  async function cargar() {
    const r = await apiFlota.get(`/vehiculos${$("#fv-bajas").checked ? "?incluir_inactivos=1" : ""}`);
    // El backend devuelve los numeros calculados dentro de `resumen` (vienen de
    // la vista asa_flota_v_resumen_vehiculo). Se aplanan aqui para que la tabla
    // no tenga que preguntar por dos niveles en cada celda.
    const lista = (r.vehiculos || []).map((v) => ({
      ...v,
      conductor: v.asa_flota_conductores?.nombre || v.resumen?.conductor || null,
      costo_por_km: v.resumen?.costo_por_km ?? null,
      km_por_galon: v.resumen?.km_por_galon ?? null,
      fallas_abiertas: v.resumen?.fallas_abiertas ?? 0,
      km_recorridos: v.resumen?.km_recorridos ?? null,
    }));
    $("#fv-tabla").innerHTML = tableHTML(
      [
        { key: "codigo", label: "Unidad", fmt: (v) => `<strong>${esc(v.codigo)}</strong>` },
        { key: "placa", label: "Placa" },
        { key: "vehiculo", label: "Vehículo", fmt: (v) => esc([v.marca, v.modelo, v.anio].filter(Boolean).join(" ")) },
        { key: "conductor", label: "Conductor", fmt: (v) => esc(v.conductor || "Sin asignar") },
        { key: "km_actual", label: "Km", fmt: (v) => NUM(v.km_actual) },
        { key: "costo_por_km", label: "Costo/km", fmt: (v) => (v.costo_por_km == null ? "—" : MONEDA(v.costo_por_km)) },
        { key: "km_por_galon", label: "Km/galón", fmt: (v) => (v.km_por_galon == null ? "—" : NUM(v.km_por_galon, 1)) },
        { key: "fallas_abiertas", label: "Fallas", fmt: (v) => (v.fallas_abiertas ? `<span class="estado-chip pendiente">${v.fallas_abiertas}</span>` : "0") },
        { key: "estado", label: "Estado", fmt: (v) => badge(v.estado) },
      ],
      lista,
      "Todavía no hay vehículos cargados."
    );
    $("#fv-tabla").querySelectorAll("tr[data-id]").forEach((tr) =>
      tr.addEventListener("click", () => fichaVehiculo(tr.dataset.id, cuerpo))
    );
  }

  $("#fv-bajas").addEventListener("change", cargar);
  $("#fv-nuevo").addEventListener("click", () => modalVehiculo(null, cargar));
  await cargar();
}

async function modalVehiculo(v, onSaved) {
  const conductores = (await apiFlota.get("/conductores")).conductores || [];
  const esNuevo = !v;

  openModal({
    title: esNuevo ? "Nuevo vehículo" : `Editar ${v.codigo}`,
    large: true,
    bodyHTML: `
      <div class="form-grid">
        <div class="form-group"><label>Código *</label><input name="codigo" required value="${esc(v?.codigo || "")}" placeholder="ASA-01" /></div>
        <div class="form-group"><label>Placa *</label><input name="placa" required value="${esc(v?.placa || "")}" /></div>
        <div class="form-group"><label>Marca</label><input name="marca" value="${esc(v?.marca || "")}" /></div>
        <div class="form-group"><label>Modelo</label><input name="modelo" value="${esc(v?.modelo || "")}" /></div>
        <div class="form-group"><label>Año</label><input name="anio" type="number" value="${esc(v?.anio || "")}" /></div>
        <div class="form-group"><label>Color</label><input name="color" value="${esc(v?.color || "")}" /></div>
        <div class="form-group"><label>Tipo</label>
          <select name="tipo">${TIPOS_VEHICULO.map((t) => `<option${v?.tipo === t ? " selected" : ""}>${t}</option>`).join("")}</select></div>
        <div class="form-group"><label>Combustible</label>
          <select name="combustible">${COMBUSTIBLES.map((t) => `<option${v?.combustible === t ? " selected" : ""}>${t}</option>`).join("")}</select></div>
        <div class="form-group"><label>Capacidad del tanque (galones)</label><input name="capacidad_tanque" type="number" step="any" value="${esc(v?.capacidad_tanque || "")}" /></div>
        <div class="form-group"><label>Conductor asignado</label>
          <select name="conductor_id"><option value="">Sin asignar</option>
            ${conductores.map((c) => `<option value="${c.id}"${String(v?.conductor_id) === String(c.id) ? " selected" : ""}>${esc(c.nombre)}</option>`).join("")}
          </select></div>
        <div class="form-group"><label>Estado</label>
          <select name="estado">${ESTADOS_VEHICULO.map((t) => `<option${v?.estado === t ? " selected" : ""}>${t}</option>`).join("")}</select></div>
        <div class="form-group"><label>Departamento</label><input name="departamento" value="${esc(v?.departamento || "")}" /></div>
        <div class="form-group"><label>Km al entrar a la flota *</label>
          <input name="km_inicial" type="number" step="any" required value="${esc(v?.km_inicial ?? 0)}" />
          <div class="form-hint">
            Es la línea base del costo por kilómetro. Si la unidad ya venía usada,
            pon el odómetro del día que entró — no cero. Puesto mal, el costo por
            km sale en centavos y el reporte no sirve.
          </div>
        </div>
        <div class="form-group"><label>Km actual</label><input name="km_actual" type="number" step="any" value="${esc(v?.km_actual ?? 0)}" /></div>
        <div class="form-group"><label>Fecha de adquisición</label><input name="fecha_adquisicion" type="date" value="${esc(v?.fecha_adquisicion || "")}" /></div>
        <div class="form-group"><label>Costo de adquisición</label><input name="costo_adquisicion" type="number" step="any" value="${esc(v?.costo_adquisicion || "")}" /></div>
        <div class="form-group full"><label>Notas</label><textarea name="notas" rows="2">${esc(v?.notas || "")}</textarea></div>
      </div>
      <label class="campo-check"><input type="checkbox" name="requiere_chequeo" ${v?.requiere_chequeo !== false ? "checked" : ""} /> Entra en el parte diario</label>
      <label class="campo-check"><input type="checkbox" name="requiere_fotos" ${v?.requiere_fotos !== false ? "checked" : ""} /> Exigir fotos en el parte</label>`,
    async onSubmit(fd) {
      const cuerpo = {};
      for (const [k, val] of fd.entries()) {
        if (val === "") { cuerpo[k] = null; continue; }
        cuerpo[k] = ["anio", "km_inicial", "km_actual", "capacidad_tanque", "costo_adquisicion", "conductor_id"].includes(k) ? Number(val) : val;
      }
      cuerpo.requiere_chequeo = fd.get("requiere_chequeo") === "on";
      cuerpo.requiere_fotos = fd.get("requiere_fotos") === "on";

      if (esNuevo) await apiFlota.post("/vehiculos", cuerpo);
      else await apiFlota.patch(`/vehiculos/${v.id}`, cuerpo);
      closeModal();
      toast("Vehículo guardado");
      onSaved?.();
    },
  });
}

async function fichaVehiculo(id, contenedor) {
  contenedor.innerHTML = `<div class="center-msg">Cargando ficha…</div>`;
  const f = await apiFlota.get(`/vehiculos/${id}/ficha`);
  const v = f.vehiculo;
  const r = f.resumen || {};

  const rendimientoMedio = f.rendimientos.length
    ? f.rendimientos.reduce((a, b) => a + b.km_galon, 0) / f.rendimientos.length
    : null;

  contenedor.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <button class="btn btn-sm" id="fv-volver">← Vehículos</button>
          <h2 style="display:inline-block;margin-left:10px">${esc(v.codigo)} · ${esc(v.placa)}</h2>
        </div>
        <div class="actions">
          <button class="btn" id="fv-editar">Editar</button>
          <button class="btn" id="fv-gasto">+ Gasto</button>
          <button class="btn" id="fv-doc">+ Documento</button>
          <button class="btn btn-danger" id="fv-borrar">Eliminar</button>
        </div>
      </div>
      <p class="text-muted">
        ${esc([v.marca, v.modelo, v.anio, v.color].filter(Boolean).join(" · "))}
        ${r.conductor ? ` · Conductor: <strong>${esc(r.conductor)}</strong>` : " · Sin conductor asignado"}
      </p>

      <div class="kpi-grid">
        <div class="kpi-card"><div class="lbl">Km recorridos</div><div class="val">${NUM(r.km_recorridos)}</div></div>
        <div class="kpi-card"><div class="lbl">Gasto acumulado</div><div class="val">${MONEDA(r.total_gastado)}</div></div>
        <div class="kpi-card"><div class="lbl">Costo por km</div><div class="val">${r.costo_por_km == null ? "—" : MONEDA(r.costo_por_km)}</div></div>
        <div class="kpi-card"><div class="lbl">Km por galón</div>
          <div class="val">${rendimientoMedio == null ? "—" : NUM(rendimientoMedio, 1)}</div></div>
      </div>

      <div class="tabs" id="tabs-ficha">
        <button class="tab active" data-t="partes">Partes (${f.chequeos.length})</button>
        <button class="tab" data-t="fallas">Fallas (${f.fallas.length})</button>
        <button class="tab" data-t="gastos">Gastos (${f.gastos.length})</button>
        <button class="tab" data-t="mant">Mantenimiento</button>
        <button class="tab" data-t="docs">Documentos</button>
        <button class="tab" data-t="fotos">Fotos (${f.fotos.length})</button>
      </div>
      <div id="ficha-cuerpo"></div>
    </div>`;

  const cf = $("#ficha-cuerpo");
  const vistas = {
    partes: () => tableHTML(
      [
        { key: "fecha", label: "Fecha", fmt: (c) => fmtDate(c.fecha) },
        { key: "turno", label: "Turno" },
        { key: "conductor_nombre", label: "Conductor", fmt: (c) => esc(c.conductor_nombre || "—") },
        { key: "km", label: "Km", fmt: (c) => NUM(c.km) },
        { key: "km_recorrido", label: "Recorrió", fmt: (c) => (c.km_recorrido == null ? "—" : NUM(c.km_recorrido)) },
        { key: "combustible_octavos", label: "Tanque", fmt: (c) => (c.combustible_octavos == null ? "—" : OCTAVOS[c.combustible_octavos]) },
        { key: "items_mal", label: "Fallos" },
        { key: "apto_circular", label: "Apta", fmt: (c) => (c.apto_circular ? "Sí" : `<span class="estado-chip pendiente">NO</span>`) },
      ],
      f.chequeos.map((c) => ({ ...c, _clickable: false })),
      "Sin partes registrados."
    ),
    fallas: () => tableHTML(
      [
        { key: "falla_etiqueta", label: "Falla", fmt: (x) => `<strong>${esc(x.falla_etiqueta || x.falla_codigo)}</strong>` },
        { key: "severidad", label: "Severidad", fmt: (x) => badge(x.severidad) },
        { key: "veces_reportada", label: "Veces" },
        { key: "primera_vez", label: "Primera vez", fmt: (x) => fmtDate(x.primera_vez) },
        { key: "estado", label: "Estado", fmt: (x) => badge(x.estado) },
        { key: "costo_reparacion", label: "Costo", fmt: (x) => (x.costo_reparacion ? MONEDA(x.costo_reparacion) : "—") },
      ],
      f.fallas, "Sin fallas reportadas."
    ),
    gastos: () => tableHTML(
      [
        { key: "fecha", label: "Fecha", fmt: (g) => fmtDate(g.fecha) },
        { key: "tipo", label: "Tipo", fmt: (g) => badge(g.tipo) },
        { key: "descripcion", label: "Descripción", fmt: (g) => esc(g.descripcion || "—") },
        { key: "galones", label: "Galones", fmt: (g) => (g.galones ? NUM(g.galones, 2) : "—") },
        { key: "km", label: "Km", fmt: (g) => (g.km ? NUM(g.km) : "—") },
        { key: "monto", label: "Monto", fmt: (g) => MONEDA(g.monto) },
        { key: "suplidor", label: "Suplidor", fmt: (g) => esc(g.suplidor || "—") },
      ],
      f.gastos.map((g) => ({ ...g, _clickable: false })),
      "Sin gastos registrados."
    ),
    mant: () => `
      ${tableHTML(
        [
          { key: "etiqueta", label: "Mantenimiento", fmt: (m) => `<strong>${esc(m.etiqueta)}</strong>` },
          { key: "intervalo_km", label: "Cada", fmt: (m) => (m.intervalo_km ? `${NUM(m.intervalo_km)} km` : m.intervalo_dias ? `${m.intervalo_dias} días` : "—") },
          { key: "km_ultimo", label: "Último a los", fmt: (m) => (m.km_ultimo ? NUM(m.km_ultimo) : "—") },
          { key: "faltan_km", label: "Faltan", fmt: (m) => (m.faltan_km == null ? "—" : m.vencido ? `<span class="estado-chip pendiente">Vencido</span>` : `${NUM(m.faltan_km)} km`) },
          { key: "taller", label: "Taller", fmt: (m) => esc(m.taller || "—") },
        ],
        f.mantenimientos.map((m) => ({ ...m, _clickable: false })),
        "Sin planes de mantenimiento."
      )}
      <p class="text-muted" style="margin-top:10px">
        El kilometraje que dispara esto entra por el parte diario del conductor.
        Sin parte, el cambio de aceite se hace cuando alguien se acuerda.
      </p>`,
    docs: () => tableHTML(
      [
        { key: "tipo", label: "Documento", fmt: (d) => badge(d.tipo) },
        { key: "numero", label: "Número", fmt: (d) => esc(d.numero || "—") },
        { key: "compania", label: "Compañía", fmt: (d) => esc(d.compania || "—") },
        { key: "vence", label: "Vence", fmt: (d) => fmtDate(d.vence) },
        { key: "monto", label: "Monto", fmt: (d) => (d.monto ? MONEDA(d.monto) : "—") },
      ],
      f.documentos.map((d) => ({ ...d, _clickable: false })),
      "Sin documentos cargados."
    ),
    fotos: () => f.fotos.length
      ? `<div class="fs-fotos">${f.fotos.map((x) => `
          <figure><img src="${esc(x.url)}" alt="${esc(x.angulo)}" loading="lazy" />
            <figcaption>${esc(x.angulo)} · ${fmtDate(x.fecha)}</figcaption></figure>`).join("")}</div>`
      : `<div class="center-msg">Sin fotos.</div>`,
  };

  const pintar = (t) => { cf.innerHTML = vistas[t](); };
  $$("#tabs-ficha .tab").forEach((b) =>
    b.addEventListener("click", () => {
      $$("#tabs-ficha .tab").forEach((x) => x.classList.toggle("active", x === b));
      pintar(b.dataset.t);
    })
  );
  pintar("partes");

  $("#fv-volver").addEventListener("click", () => flotaVehiculos(contenedor));
  $("#fv-editar").addEventListener("click", () => modalVehiculo(v, () => fichaVehiculo(id, contenedor)));
  $("#fv-gasto").addEventListener("click", () => modalGasto(null, v.id, () => fichaVehiculo(id, contenedor)));
  $("#fv-doc").addEventListener("click", () => modalDocumento(v.id, () => fichaVehiculo(id, contenedor)));
  $("#fv-borrar").addEventListener("click", () => borrarVehiculo(v, () => flotaVehiculos(contenedor)));
}

// Borrar un vehículo se lleva su historial completo. Antes de preguntar se
// cuenta lo que se va a perder y se obliga a escribir el código: un
// "¿estás seguro?" no frena a nadie, un conteo sí.
async function borrarVehiculo(v, onDone) {
  const dep = await apiFlota.get(`/vehiculos/${v.id}/dependencias`);
  const d = dep.dependencias || {};
  const piezas = Object.entries(d)
    .filter(([, n]) => Number(n) > 0)
    .map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`);

  const baja = confirm(
    `${v.codigo} · ${v.placa}\n\n` +
    `DAR DE BAJA (aceptar): la unidad desaparece de las pantallas, el historial ` +
    `queda entero y se puede reactivar marcando "Ver dados de baja".\n\n` +
    `ELIMINAR DE VERDAD (cancelar y te pregunto de nuevo): ` +
    (piezas.length ? `se pierden ${piezas.join(", ")}.` : "no tiene historial asociado.") +
    `\n\n¿Dar de baja?`
  );

  if (baja) {
    await apiFlota.del(`/vehiculos/${v.id}`);
    toast("Unidad dada de baja");
    return onDone?.();
  }

  if (!confirm(`¿Eliminar ${v.codigo} DE VERDAD?\n\nEsto no se puede deshacer.`)) return;
  const escrito = prompt(`Escribe el código de la unidad para confirmar: ${v.codigo}`);
  if (escrito !== v.codigo) return toast("El código no coincide: no se borró nada");

  await apiFlota.del(`/vehiculos/${v.id}?definitivo=1`);
  toast("Unidad eliminada");
  onDone?.();
}

// ── Fallas ───────────────────────────────────────────────────────────────
async function flotaFallas(cuerpo) {
  cuerpo.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>Fallas reportadas por los conductores</h2></div>
      <div class="toolbar">
        <select id="ff-estado">
          <option value="">Abiertas (todas las que siguen sin resolver)</option>
          ${ESTADOS_FALLA.map((e) => `<option value="${e}">${e.replace(/_/g, " ")}</option>`).join("")}
        </select>
      </div>
      <div id="ff-tabla"><div class="center-msg">Cargando…</div></div>
      <div id="ff-frecuentes"></div>
    </div>`;

  async function cargar() {
    const filtro = $("#ff-estado").value;
    const r = await apiFlota.get(`/fallas${filtro ? `?estado=${filtro}` : ""}`);
    const lista = r.fallas || [];

    $("#ff-tabla").innerHTML = tableHTML(
      [
        { key: "vehiculo", label: "Unidad", fmt: (f) => esc(f.asa_flota_vehiculos ? `${f.asa_flota_vehiculos.codigo} · ${f.asa_flota_vehiculos.placa}` : `#${f.vehiculo_id}`) },
        { key: "falla_etiqueta", label: "Falla", fmt: (f) => `<strong>${esc(f.falla_etiqueta || f.falla_codigo)}</strong>` },
        { key: "categoria", label: "Categoría", fmt: (f) => esc(f.categoria || "—") },
        { key: "severidad", label: "Severidad", fmt: (f) => badge(f.severidad) },
        { key: "veces_reportada", label: "Veces", fmt: (f) => (f.veces_reportada > 2 ? `<span class="estado-chip pendiente">${f.veces_reportada}</span>` : f.veces_reportada) },
        { key: "conductor_nombre", label: "Reportó", fmt: (f) => esc(f.conductor_nombre || "—") },
        { key: "ultima_vez", label: "Última vez", fmt: (f) => fmtDate(f.ultima_vez) },
        { key: "estado", label: "Estado", fmt: (f) => badge(f.estado) },
      ],
      lista, "Ninguna falla con ese filtro."
    );
    $("#ff-tabla").querySelectorAll("tr[data-id]").forEach((tr) =>
      tr.addEventListener("click", () => modalFalla(lista.find((f) => String(f.id) === tr.dataset.id), cargar))
    );

    const frec = r.frecuentes || [];
    $("#ff-frecuentes").innerHTML = frec.length ? `
      <h4 style="margin-top:22px">Las que más se repiten</h4>
      <p class="text-muted">
        Si un mismo código sale en tres unidades distintas, mira el suplidor o la
        ruta antes que el vehículo.
      </p>
      ${tableHTML(
        [
          { key: "falla_etiqueta", label: "Falla" },
          { key: "vehiculos_afectados", label: "Unidades" },
          { key: "veces_total", label: "Reportes" },
          { key: "abiertas", label: "Abiertas" },
          { key: "costo_acumulado", label: "Costo", fmt: (x) => MONEDA(x.costo_acumulado) },
        ],
        frec.map((x) => ({ ...x, _clickable: false })),
        ""
      )}` : "";
  }

  $("#ff-estado").addEventListener("change", cargar);
  await cargar();
}

function modalFalla(f, onSaved) {
  if (!f) return;
  openModal({
    title: f.falla_etiqueta || f.falla_codigo,
    bodyHTML: `
      <p class="text-muted">
        Reportada ${f.veces_reportada} ${f.veces_reportada === 1 ? "vez" : "veces"},
        la primera el ${fmtDate(f.primera_vez)}.
        ${f.detiene_vehiculo ? `<br><strong style="color:#b91c1c">Con esta falla el vehículo no debe salir.</strong>` : ""}
      </p>
      <div class="form-grid">
        <div class="form-group"><label>Estado</label>
          <select name="estado">${ESTADOS_FALLA.map((e) => `<option${f.estado === e ? " selected" : ""}>${e}</option>`).join("")}</select>
        </div>
        <div class="form-group"><label>Costo de la reparación</label>
          <input name="costo_reparacion" type="number" step="any" value="${esc(f.costo_reparacion || "")}" /></div>
        <div class="form-group"><label>Quién la resolvió</label>
          <input name="resuelta_por" value="${esc(f.resuelta_por || "")}" /></div>
        <div class="form-group full"><label>Nota</label>
          <textarea name="nota" rows="2">${esc(f.nota || "")}</textarea></div>
      </div>`,
    async onSubmit(fd) {
      await apiFlota.patch(`/fallas/${f.id}`, {
        estado: fd.get("estado"),
        costo_reparacion: fd.get("costo_reparacion") ? Number(fd.get("costo_reparacion")) : null,
        resuelta_por: (fd.get("resuelta_por") || "").trim() || null,
        nota: (fd.get("nota") || "").trim() || null,
      });
      closeModal();
      toast("Falla actualizada");
      onSaved?.();
    },
  });
}

// ── Gastos ───────────────────────────────────────────────────────────────
async function flotaGastos(cuerpo) {
  const veh = (await apiFlota.get("/vehiculos")).vehiculos || [];
  const mes = new Date().toISOString().slice(0, 8) + "01";

  cuerpo.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Gastos de la flota</h2>
        <div class="actions"><button class="btn btn-primary" id="fg-nuevo">+ Gasto</button></div>
      </div>
      <div class="toolbar">
        <select id="fg-veh"><option value="">Todas las unidades</option>
          ${veh.map((v) => `<option value="${v.id}">${esc(v.codigo)} · ${esc(v.placa)}</option>`).join("")}
        </select>
        <select id="fg-tipo"><option value="">Todos los tipos</option>
          ${TIPOS_GASTO.map((t) => `<option>${t}</option>`).join("")}
        </select>
        <input type="date" id="fg-desde" value="${mes}" />
        <input type="date" id="fg-hasta" value="${hoyLocal()}" />
        <span class="text-muted" id="fg-total"></span>
      </div>
      <div id="fg-tabla"><div class="center-msg">Cargando…</div></div>
    </div>`;

  async function cargar() {
    const qs = new URLSearchParams();
    if ($("#fg-veh").value) qs.set("vehiculo_id", $("#fg-veh").value);
    if ($("#fg-tipo").value) qs.set("tipo", $("#fg-tipo").value);
    if ($("#fg-desde").value) qs.set("desde", $("#fg-desde").value);
    if ($("#fg-hasta").value) qs.set("hasta", $("#fg-hasta").value);

    const lista = (await apiFlota.get(`/gastos?${qs}`)).gastos || [];
    const total = lista.reduce((a, g) => a + Number(g.monto || 0), 0);
    $("#fg-total").textContent = `${lista.length} gastos · ${MONEDA(total)}`;

    $("#fg-tabla").innerHTML = tableHTML(
      [
        { key: "fecha", label: "Fecha", fmt: (g) => fmtDate(g.fecha) },
        { key: "vehiculo", label: "Unidad", fmt: (g) => esc(nombreVehiculo(veh, g.vehiculo_id)) },
        { key: "tipo", label: "Tipo", fmt: (g) => badge(g.tipo) },
        { key: "descripcion", label: "Descripción", fmt: (g) => esc(g.descripcion || "—") },
        { key: "galones", label: "Galones", fmt: (g) => (g.galones ? NUM(g.galones, 2) : "—") },
        { key: "monto", label: "Monto", fmt: (g) => `<strong>${MONEDA(g.monto)}</strong>` },
        { key: "suplidor", label: "Suplidor", fmt: (g) => esc(g.suplidor || "—") },
        { key: "_x", label: "", fmt: (g) => `<button class="btn btn-sm btn-danger" data-borrar="${g.id}">Borrar</button>` },
      ],
      lista, "Sin gastos en ese rango."
    );

    $("#fg-tabla").querySelectorAll("tr[data-id]").forEach((tr) =>
      tr.addEventListener("click", () => modalGasto(lista.find((g) => String(g.id) === tr.dataset.id), null, cargar))
    );
    $$("#fg-tabla [data-borrar]").forEach((b) =>
      b.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        if (!confirm("¿Borrar este gasto? No se puede deshacer.")) return;
        await apiFlota.del(`/gastos/${b.dataset.borrar}?definitivo=1`);
        toast("Gasto borrado");
        cargar();
      })
    );
  }

  ["#fg-veh", "#fg-tipo", "#fg-desde", "#fg-hasta"].forEach((id) => $(id).addEventListener("change", cargar));
  $("#fg-nuevo").addEventListener("click", () => modalGasto(null, $("#fg-veh").value || null, cargar));
  await cargar();
}

async function modalGasto(g, vehiculoId, onSaved) {
  const veh = (await apiFlota.get("/vehiculos")).vehiculos || [];
  const esNuevo = !g;

  openModal({
    title: esNuevo ? "Registrar gasto" : "Editar gasto",
    large: true,
    bodyHTML: `
      <div class="form-grid">
        <div class="form-group"><label>Unidad *</label>
          <select name="vehiculo_id" required>
            <option value="">Elige…</option>
            ${veh.map((v) => `<option value="${v.id}"${String(g?.vehiculo_id || vehiculoId) === String(v.id) ? " selected" : ""}>${esc(v.codigo)} · ${esc(v.placa)}</option>`).join("")}
          </select></div>
        <div class="form-group"><label>Fecha *</label><input name="fecha" type="date" required value="${esc(g?.fecha || hoyLocal())}" /></div>
        <div class="form-group"><label>Tipo *</label>
          <select name="tipo" id="fg-m-tipo">${TIPOS_GASTO.map((t) => `<option${g?.tipo === t ? " selected" : ""}>${t}</option>`).join("")}</select></div>
        <div class="form-group"><label>Monto *</label><input name="monto" type="number" step="any" required value="${esc(g?.monto ?? "")}" /></div>
        <div class="form-group full"><label>Descripción</label><input name="descripcion" value="${esc(g?.descripcion || "")}" /></div>
        <div class="form-group"><label>Suplidor</label><input name="suplidor" value="${esc(g?.suplidor || "")}" /></div>
        <div class="form-group"><label>NCF</label><input name="ncf" value="${esc(g?.ncf || "")}" /></div>
      </div>
      <div id="fg-combustible" class="form-grid" style="display:none">
        <div class="form-group"><label>Galones</label><input name="galones" type="number" step="any" value="${esc(g?.galones || "")}" /></div>
        <div class="form-group"><label>Precio por galón</label><input name="precio_galon" type="number" step="any" value="${esc(g?.precio_galon || "")}" /></div>
        <div class="form-group"><label>Kilometraje al tanquear</label><input name="km" type="number" step="any" value="${esc(g?.km || "")}" /></div>
        <div class="form-group full">
          <label class="campo-check"><input type="checkbox" name="tanque_lleno" ${g?.tanque_lleno !== false ? "checked" : ""} /> Se llenó el tanque</label>
          <div class="form-hint">
            El rendimiento se calcula de tanqueo lleno a tanqueo lleno. Marcar esto
            mal ensucia el km/galón de toda la unidad, así que si fue una carga
            parcial, desmárcalo.
          </div>
        </div>
      </div>`,
    onMount() {
      const ver = () => {
        $("#fg-combustible").style.display = $("#fg-m-tipo").value === "COMBUSTIBLE" ? "" : "none";
      };
      $("#fg-m-tipo").addEventListener("change", ver);
      ver();
    },
    async onSubmit(fd) {
      const cuerpo = {
        vehiculo_id: Number(fd.get("vehiculo_id")),
        fecha: fd.get("fecha"),
        tipo: fd.get("tipo"),
        monto: Number(fd.get("monto")),
        descripcion: (fd.get("descripcion") || "").trim() || null,
        suplidor: (fd.get("suplidor") || "").trim() || null,
        ncf: (fd.get("ncf") || "").trim() || null,
      };
      if (cuerpo.tipo === "COMBUSTIBLE") {
        cuerpo.galones = fd.get("galones") ? Number(fd.get("galones")) : null;
        cuerpo.precio_galon = fd.get("precio_galon") ? Number(fd.get("precio_galon")) : null;
        cuerpo.km = fd.get("km") ? Number(fd.get("km")) : null;
        cuerpo.tanque_lleno = fd.get("tanque_lleno") === "on";
      }
      if (esNuevo) await apiFlota.post("/gastos", cuerpo);
      else await apiFlota.patch(`/gastos/${g.id}`, cuerpo);
      closeModal();
      toast("Gasto guardado");
      onSaved?.();
    },
  });
}

async function modalDocumento(vehiculoId, onSaved) {
  openModal({
    title: "Documento del vehículo",
    bodyHTML: `
      <div class="form-grid">
        <div class="form-group"><label>Tipo</label>
          <select name="tipo">${TIPOS_DOC.map((t) => `<option>${t}</option>`).join("")}</select></div>
        <div class="form-group"><label>Número</label><input name="numero" /></div>
        <div class="form-group"><label>Compañía</label><input name="compania" /></div>
        <div class="form-group"><label>Emitido</label><input name="emitido" type="date" /></div>
        <div class="form-group"><label>Vence *</label><input name="vence" type="date" required /></div>
        <div class="form-group"><label>Monto</label><input name="monto" type="number" step="any" /></div>
        <div class="form-group"><label>Avisar con</label><input name="alerta_dias" type="number" value="30" /><div class="form-hint">días de anticipación</div></div>
      </div>`,
    async onSubmit(fd) {
      await apiFlota.post("/documentos", {
        vehiculo_id: Number(vehiculoId),
        tipo: fd.get("tipo"),
        numero: (fd.get("numero") || "").trim() || null,
        compania: (fd.get("compania") || "").trim() || null,
        emitido: fd.get("emitido") || null,
        vence: fd.get("vence"),
        monto: fd.get("monto") ? Number(fd.get("monto")) : null,
        alerta_dias: Number(fd.get("alerta_dias")) || 30,
      });
      closeModal();
      toast("Documento guardado");
      onSaved?.();
    },
  });
}

// ── Reportes ─────────────────────────────────────────────────────────────
async function flotaReportes(cuerpo) {
  const anio = new Date().getFullYear();
  cuerpo.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>Costo por kilómetro y cumplimiento</h2></div>
      <div class="toolbar">
        <input type="date" id="fr-desde" value="${anio}-01-01" />
        <input type="date" id="fr-hasta" value="${hoyLocal()}" />
        <button class="btn btn-sm" id="fr-csv">Descargar CSV</button>
      </div>
      <div id="fr-cuerpo"><div class="center-msg">Cargando…</div></div>
    </div>`;

  let ultimo = null;

  async function cargar() {
    const qs = `desde=${$("#fr-desde").value}&hasta=${$("#fr-hasta").value}`;
    const [costos, conductores] = await Promise.all([
      apiFlota.get(`/reportes/costos?${qs}`),
      apiFlota.get(`/reportes/conductores?${qs}`),
    ]);
    ultimo = costos;

    // El promedio de costo por km de la flota es la vara de medir: una unidad
    // 30% por encima se marca en rojo. El total gastado, por sí solo, siempre
    // castiga a la que más rueda.
    const conCosto = costos.por_vehiculo.filter((v) => v.costo_km != null);
    const promedio = conCosto.length ? conCosto.reduce((a, v) => a + v.costo_km, 0) / conCosto.length : null;

    $("#fr-cuerpo").innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="lbl">Gasto del período</div><div class="val">${MONEDA(costos.totales.total)}</div></div>
        <div class="kpi-card"><div class="lbl">Km recorridos</div><div class="val">${NUM(costos.totales.km)}</div></div>
        <div class="kpi-card"><div class="lbl">Costo por km de la flota</div>
          <div class="val">${costos.totales.costo_km == null ? "—" : MONEDA(costos.totales.costo_km)}</div></div>
        <div class="kpi-card"><div class="lbl">Galones</div><div class="val">${NUM(costos.totales.galones, 1)}</div></div>
      </div>

      <h4>Por unidad</h4>
      ${tableHTML(
        [
          { key: "codigo", label: "Unidad", fmt: (v) => `<strong>${esc(v.codigo)}</strong>` },
          { key: "vehiculo", label: "Vehículo", fmt: (v) => esc(v.vehiculo || "—") },
          { key: "km_periodo", label: "Km", fmt: (v) => NUM(v.km_periodo) },
          { key: "total", label: "Gasto", fmt: (v) => MONEDA(v.total) },
          {
            key: "costo_km", label: "Costo/km",
            fmt: (v) => v.costo_km == null ? "—"
              : promedio && v.costo_km > promedio * 1.3
                ? `<span class="estado-chip pendiente">${MONEDA(v.costo_km)}</span>`
                : MONEDA(v.costo_km),
          },
          { key: "km_galon", label: "Km/galón", fmt: (v) => (v.km_galon == null ? "—" : NUM(v.km_galon, 1)) },
          { key: "movimientos", label: "Gastos" },
        ],
        costos.por_vehiculo.map((v) => ({ ...v, _clickable: false })),
        "Sin datos en el período."
      )}
      ${promedio ? `<p class="text-muted">
        Promedio de la flota: ${MONEDA(promedio)} por km. En rojo, las unidades
        que pasan 30% de ese promedio — es el único número que compara de verdad
        una camioneta vieja con una nueva.
      </p>` : ""}

      <h4 style="margin-top:22px">Cumplimiento por conductor</h4>
      ${tableHTML(
        [
          { key: "nombre", label: "Conductor", fmt: (c) => `<strong>${esc(c.nombre)}</strong>` },
          { key: "partes", label: "Partes" },
          { key: "dias_reportados", label: "Días" },
          { key: "km_recorrido", label: "Km", fmt: (c) => NUM(c.km_recorrido) },
          { key: "fallas_reportadas", label: "Fallas reportadas" },
          {
            key: "cumplimiento_fotos", label: "Fotos completas",
            fmt: (c) => c.cumplimiento_fotos == null ? "—"
              : `<span class="estado-chip ${c.cumplimiento_fotos >= 90 ? "hecho" : c.cumplimiento_fotos >= 60 ? "fuera" : "pendiente"}">${c.cumplimiento_fotos}%</span>`,
          },
        ],
        (conductores.conductores || []).map((c) => ({ ...c, _clickable: false })),
        "Sin partes en el período."
      )}
      <p class="text-muted">
        Un conductor con cero fallas reportadas en todo un mes no siempre es buena
        noticia: puede que esté llenando el parte de corrido sin mirar el vehículo.
      </p>`;
  }

  ["#fr-desde", "#fr-hasta"].forEach((id) => $(id).addEventListener("change", cargar));
  $("#fr-csv").addEventListener("click", () => {
    if (!ultimo) return;
    const filas = [
      ["Unidad", "Vehiculo", "Km", "Gasto", "Costo por km", "Km por galon", "Gastos"],
      ...ultimo.por_vehiculo.map((v) => [v.codigo, v.vehiculo, v.km_periodo, v.total, v.costo_km ?? "", v.km_galon ?? "", v.movimientos]),
    ];
    const csv = filas.map((f) => f.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `flota-costos-${ultimo.desde}-a-${ultimo.hasta}.csv`;
    a.click();
  });

  await cargar();
}

// ── Configuración del módulo ─────────────────────────────────────────────
async function flotaConfig(cuerpo) {
  const [cond, checklist, catFallas, cfg] = await Promise.all([
    apiFlota.get("/conductores"),
    apiFlota.get("/checklist"),
    apiFlota.get("/catalogo-fallas"),
    apiFlota.get("/config"),
  ]);

  const enlaceChequeo = `${location.origin}${location.pathname.replace(/[^/]*$/, "")}../app-tecnico/#/chequeo`;

  cuerpo.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Conductores</h2>
        <div class="actions"><button class="btn btn-primary" id="fc-nuevo-cond">+ Conductor</button></div>
      </div>
      <p class="text-muted">
        No llevan cuenta del sistema a propósito: abren la pantalla del chequeo y
        tocan su nombre. Darle acceso al panel a cada conductor sería abrirle
        clientes y reportes para que avise de una goma baja.
      </p>
      <div id="fc-cond"></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Traer la flota desde el CRM del taller</h2></div>
      <p class="text-muted">
        En <strong>CRM Sólido → ASA → Configuración → Exportar</strong> descargas el
        Excel con toda la flota. Aquí lo subes. Primero hazlo en
        <strong>modo prueba</strong>: no escribe nada y te dice exactamente qué
        entraría.
      </p>
      <div class="toolbar">
        <input type="file" id="fc-archivo" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
        <button class="btn btn-sm" id="fc-probar">Probar sin escribir</button>
        <button class="btn btn-sm btn-primary" id="fc-importar">Importar de verdad</button>
      </div>
      <div id="fc-resultado"></div>
      <p class="text-muted" style="margin-top:10px">
        Subir el mismo archivo dos veces <strong>actualiza, no duplica</strong>: cada hoja
        se reconcilia por su clave (código del vehículo, cédula del conductor,
        vehículo + fecha + turno del parte). Las fotos no vienen en el archivo,
        solo sus enlaces, que siguen apuntando al almacenamiento del CRM.
      </p>
    </div>

    <div class="card">
      <div class="card-head"><h2>Enlace del chequeo para los conductores</h2></div>
      <p class="text-muted">Mándalo por WhatsApp y que lo guarden en la pantalla de inicio del celular.</p>
      <div class="toolbar">
        <input id="fc-enlace" readonly value="${esc(enlaceChequeo)}" style="flex:1" />
        <button class="btn btn-sm" id="fc-copiar">Copiar</button>
      </div>
    </div>

    <div class="dos-columnas">
      <div class="card">
        <div class="card-head"><h2>Checklist del parte diario (${(checklist.checklist || []).length})</h2></div>
        <p class="text-muted">
          El conductor ve esta lista y toca solo lo que está mal. Lo marcado como
          <strong>crítico</strong> deja la unidad como "no debe salir".
        </p>
        <div id="fc-check"></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Catálogo de fallas (${(catFallas["catalogo-fallas"] || []).length})</h2></div>
        <p class="text-muted">
          Escrito en el idioma del conductor ("hala hacia un lado", "bota humo"),
          no en el del mecánico. Si la lista no se parece a como él hablaría,
          termina escogiendo "Otro" y se pierde el dato.
        </p>
        <div id="fc-fallas"></div>
      </div>
    </div>`;

  $("#fc-cond").innerHTML = tableHTML(
    [
      { key: "nombre", label: "Nombre", fmt: (c) => `<strong>${esc(c.nombre)}</strong>` },
      { key: "cargo", label: "Cargo", fmt: (c) => esc(c.cargo || "—") },
      { key: "telefono", label: "Teléfono", fmt: (c) => esc(c.telefono || "—") },
      { key: "licencia_vence", label: "Licencia vence", fmt: (c) => (c.licencia_vence ? fmtDate(c.licencia_vence) : "—") },
      { key: "activo", label: "Activo", fmt: (c) => (c.activo ? "Sí" : "No") },
    ],
    cond.conductores || [], "Todavía no hay conductores."
  );
  $("#fc-cond").querySelectorAll("tr[data-id]").forEach((tr) =>
    tr.addEventListener("click", () =>
      modalConductor((cond.conductores || []).find((c) => String(c.id) === tr.dataset.id), () => flotaConfig(cuerpo))
    )
  );

  $("#fc-check").innerHTML = tableHTML(
    [
      { key: "etiqueta", label: "Punto a revisar" },
      { key: "categoria", label: "Categoría" },
      { key: "critico", label: "Crítico", fmt: (i) => (i.critico ? `<span class="estado-chip pendiente">Sí</span>` : "No") },
    ],
    (checklist.checklist || []).map((x) => ({ ...x, _clickable: false })), ""
  );

  $("#fc-fallas").innerHTML = tableHTML(
    [
      { key: "etiqueta", label: "Falla" },
      { key: "categoria", label: "Categoría" },
      { key: "severidad", label: "Severidad", fmt: (f) => badge(f.severidad) },
      { key: "detiene_vehiculo", label: "Detiene", fmt: (f) => (f.detiene_vehiculo ? "Sí" : "No") },
    ],
    (catFallas["catalogo-fallas"] || []).map((x) => ({ ...x, _clickable: false })), ""
  );

  $("#fc-probar").addEventListener("click", () => importarFlota(true, cuerpo));
  $("#fc-importar").addEventListener("click", () => importarFlota(false, cuerpo));
  $("#fc-nuevo-cond").addEventListener("click", () => modalConductor(null, () => flotaConfig(cuerpo)));
  $("#fc-copiar").addEventListener("click", () => {
    $("#fc-enlace").select();
    navigator.clipboard?.writeText($("#fc-enlace").value);
    toast("Enlace copiado");
  });
}

function modalConductor(c, onSaved) {
  const esNuevo = !c;
  openModal({
    title: esNuevo ? "Nuevo conductor" : `Editar ${c.nombre}`,
    bodyHTML: `
      <div class="form-grid">
        <div class="form-group full"><label>Nombre *</label><input name="nombre" required value="${esc(c?.nombre || "")}" /></div>
        <div class="form-group"><label>Cédula</label><input name="cedula" value="${esc(c?.cedula || "")}" /></div>
        <div class="form-group"><label>Teléfono</label><input name="telefono" value="${esc(c?.telefono || "")}" /></div>
        <div class="form-group"><label>Cargo</label><input name="cargo" value="${esc(c?.cargo || "Conductor")}" /></div>
        <div class="form-group"><label>Licencia</label><input name="licencia_numero" value="${esc(c?.licencia_numero || "")}" /></div>
        <div class="form-group"><label>Categoría</label><input name="licencia_categoria" value="${esc(c?.licencia_categoria || "")}" /></div>
        <div class="form-group"><label>Licencia vence</label><input name="licencia_vence" type="date" value="${esc(c?.licencia_vence || "")}" /></div>
      </div>
      ${esNuevo ? "" : `
        <div class="actions" style="margin-top:12px">
          <button type="button" class="btn btn-danger" id="fc-baja-cond">
            ${c.activo ? "Dar de baja" : "Reactivar"}
          </button>
        </div>
        <p class="text-muted" style="margin-top:8px">
          Dar de baja lo saca de la pantalla del chequeo. Sus partes y gastos
          quedan: llevan el nombre congelado.
        </p>`}`,
    onMount() {
      $("#fc-baja-cond")?.addEventListener("click", async () => {
        if (c.activo) await apiFlota.del(`/conductores/${c.id}`);
        else await apiFlota.patch(`/conductores/${c.id}`, { activo: true });
        closeModal();
        toast(c.activo ? "Conductor dado de baja" : "Conductor reactivado");
        onSaved?.();
      });
    },
    async onSubmit(fd) {
      const cuerpo = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v).trim() || null]));
      if (esNuevo) await apiFlota.post("/conductores", cuerpo);
      else await apiFlota.patch(`/conductores/${c.id}`, cuerpo);
      closeModal();
      toast("Conductor guardado");
      onSaved?.();
    },
  });
}


// ── Importar la flota desde el Excel del CRM ─────────────────────────────
//
// Dos botones y no uno: la prueba primero. Una importación que ya escribió no
// se deshace con un botón, y ver el conteo antes es lo que evita descubrir a
// mitad de camino que el archivo era el equivocado.
async function importarFlota(simular, contenedor) {
  const input = $("#fc-archivo");
  const archivo = input?.files?.[0];
  const salida = $("#fc-resultado");

  if (!archivo) {
    salida.innerHTML = `<div class="form-error" style="display:block">Elige primero el archivo .xlsx</div>`;
    return;
  }
  if (!simular && !confirm(
    `Se va a cargar "${archivo.name}" en la flota de Ambiente y Salud.\n\n` +
    `Lo que ya exista se actualiza; lo que no, se crea. ¿Seguir?`
  )) return;

  salida.innerHTML = `<div class="center-msg">${simular ? "Revisando" : "Importando"} el archivo… puede tardar un minuto.</div>`;

  try {
    const base64 = await new Promise((ok, mal) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result).split(",")[1]);
      fr.onerror = () => mal(new Error("No se pudo leer el archivo"));
      fr.readAsDataURL(archivo);
    });

    const r = await apiFlota.post("/importar-excel", { archivo_base64: base64, simular });

    salida.innerHTML = `
      <div class="card" style="margin-top:12px;border-left:4px solid ${simular ? "#32539C" : "#4A7D4D"}">
        <div class="card-head">
          <h2>${simular ? "Prueba — no se escribió nada" : "Importación terminada"}</h2>
          <span class="text-muted">
            ${r.totales.nuevos} nuevos · ${r.totales.actualizados} actualizados${r.totales.saltados ? ` · ${r.totales.saltados} saltados` : ""}
          </span>
        </div>
        ${tableHTML(
          [
            { key: "hoja", label: "Hoja", fmt: (x) => `<strong>${esc(x.hoja)}</strong>` },
            { key: "leidas", label: "Filas en el archivo" },
            { key: "nuevos", label: simular ? "Entrarían" : "Nuevos" },
            { key: "actualizados", label: "Actualizados" },
            {
              key: "saltados", label: "Saltados",
              fmt: (x) => (x.saltados ? `<span class="estado-chip pendiente">${x.saltados}</span>` : "0"),
            },
          ],
          r.resumen.map((x) => ({ ...x, _clickable: false })),
          "El archivo no traía filas."
        )}
        ${r.totales.saltados ? `<p class="text-muted">
          Las filas saltadas son las que apuntan a algo que no vino en el archivo
          — un parte de un vehículo que ya no existe, por ejemplo. No es un error:
          es lo que evita dejar registros huérfanos.
        </p>` : ""}
        ${r.avisos?.length ? `<p class="text-muted">${r.avisos.map(esc).join("<br>")}</p>` : ""}
        <p class="text-muted">${esc(r.nota || "")}</p>
      </div>`;

    if (!simular) {
      toast(`Flota importada: ${r.totales.nuevos} nuevos, ${r.totales.actualizados} actualizados`);
      // Se recarga la pantalla para que los conductores nuevos aparezcan ya,
      // pero después de que se haya podido leer el resumen.
      setTimeout(() => flotaConfig(contenedor), 4000);
    }
  } catch (e) {
    salida.innerHTML = `<div class="form-error" style="display:block">${esc(e.message)}</div>`;
  }
}
