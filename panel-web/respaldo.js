// ═════════════════════════════════════════════════════════════════════════
// respaldo.js — Respaldo de datos en Excel y restauración (solo administrador)
//
// · Bajar respaldo: un .xlsx con una hoja por tabla, con todo lo del sistema.
// · Restaurar: subir ese archivo. Primero se revisa qué trae (sin escribir) y
//   luego se carga: "solo lo que falta" o "reemplazar con el respaldo".
//   Nunca borra nada.
//
// Se carga antes de app.js y aporta MODULOS_EXTRA_11.
// ═════════════════════════════════════════════════════════════════════════

const MODULOS_EXTRA_11 = [
  { key: "respaldo", label: "Respaldo de datos", ic: "💾", seccion: "admin", roles: ["admin"], view: viewRespaldo },
];

async function viewRespaldo(content) {
  if (USUARIO.rol !== "admin") {
    content.innerHTML = `<div class="card"><div class="form-error" style="display:block">Solo el administrador puede bajar o restaurar respaldos.</div></div>`;
    return;
  }
  content.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>💾 Bajar respaldo completo</h2></div>
      <p class="text-muted">Un archivo Excel con <strong>todos los datos del sistema</strong>: clientes, plantas, áreas, puntos de control,
        inspecciones, plagas, órdenes, cronograma, flota, facturación, usuarios… una hoja por tabla.
        Guárdalo en un lugar seguro (Google Drive, OneDrive o un disco externo): trae datos de clientes y las contraseñas cifradas de los usuarios.</p>
      <p class="text-muted">Las fotos y documentos subidos no van dentro del Excel; va el enlace de cada uno.
        Recomendación: bajarlo <strong>una vez por semana</strong> y conservar los últimos.</p>
      <button class="btn btn-primary" id="rs-bajar">⬇ Bajar respaldo en Excel</button>
      <span class="text-muted" id="rs-bajar-estado" style="margin-left:10px"></span>
    </div>

    <div class="card">
      <div class="card-head"><h2>♻ Restaurar desde un respaldo</h2></div>
      <p class="text-muted">Sube un respaldo bajado de aquí. Primero se revisa qué trae, sin escribir nada; después eliges cómo cargarlo.
        <strong>Nunca se borra nada</strong> del sistema.</p>
      <div class="form-grid">
        <div class="form-group"><label>Archivo del respaldo (.xlsx)</label><input type="file" id="rs-archivo" accept=".xlsx" /></div>
        <div class="form-group"><label>Cómo cargarlo</label>
          <select id="rs-modo">
            <option value="agregar">Solo agregar lo que falta (lo que ya existe no se toca)</option>
            <option value="reemplazar">Reemplazar con lo del respaldo (lo que existe con el mismo id se sobrescribe)</option>
          </select></div>
      </div>
      <button class="btn" id="rs-revisar">1. Revisar el archivo</button>
      <button class="btn btn-danger" id="rs-cargar" disabled>2. Cargar al sistema</button>
      <div id="rs-resultado" style="margin-top:14px"></div>
    </div>`;

  $("#rs-bajar").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    $("#rs-bajar-estado").textContent = "Preparando… puede tardar un par de minutos.";
    try {
      await descargarPdf("/respaldo/excel", `respaldo-ambiente-y-salud-${hoyLocal()}.xlsx`);
      $("#rs-bajar-estado").textContent = "Listo.";
    } catch (err) {
      $("#rs-bajar-estado").textContent = "";
      toast(err.message, true);
    } finally {
      b.disabled = false;
    }
  });

  const enviar = async (simular) => {
    const f = $("#rs-archivo").files[0];
    if (!f) throw new Error("Elige el archivo del respaldo");
    const qs = new URLSearchParams({ modo: $("#rs-modo").value });
    if (simular) qs.set("simular", "1");
    const res = await fetch(`${CONFIG.API_BASE}/respaldo/restaurar?${qs}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/octet-stream" },
      body: f,
    });
    const datos = await res.json().catch(() => ({}));
    if (!res.ok || datos.error) throw new Error(datos.mensaje || `El servidor respondió ${res.status}`);
    return datos;
  };

  $("#rs-archivo").addEventListener("change", () => { $("#rs-cargar").disabled = true; $("#rs-resultado").innerHTML = ""; });

  $("#rs-revisar").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    $("#rs-resultado").innerHTML = `<div class="center-msg">Leyendo el archivo…</div>`;
    try {
      const r = await enviar(true);
      $("#rs-resultado").innerHTML = `
        <p><strong>El respaldo trae ${r.total} fila(s) en ${r.tablas.length} tabla(s).</strong></p>
        ${tableHTML([{ key: "tabla", label: "Tabla", fmt: (t) => esc(t.tabla.replace(/^asa_/, "")) }, { key: "filas", label: "Filas" }],
          r.tablas.map((t) => ({ ...t, _clickable: false })))}`;
      $("#rs-cargar").disabled = false;
    } catch (err) {
      $("#rs-resultado").innerHTML = `<div class="form-error" style="display:block">${esc(err.message)}</div>`;
    } finally {
      b.disabled = false;
    }
  });

  $("#rs-cargar").addEventListener("click", async (e) => {
    const modo = $("#rs-modo").value;
    const aviso = modo === "reemplazar"
      ? "Se van a SOBRESCRIBIR los registros que tengan el mismo id con lo que dice el respaldo. ¿Seguir?"
      : "Se van a agregar los registros del respaldo que falten. Lo que ya existe no se toca. ¿Seguir?";
    if (!confirm(aviso)) return;
    if (prompt('Para confirmar escribe RESTAURAR') !== "RESTAURAR") return toast("No se restauró nada", true);
    const b = e.currentTarget;
    b.disabled = true;
    $("#rs-resultado").innerHTML = `<div class="center-msg">Cargando… no cierres esta pantalla, puede tardar varios minutos.</div>`;
    try {
      const r = await enviar(false);
      const conError = r.tablas.filter((t) => t.error);
      $("#rs-resultado").innerHTML = `
        <p><strong>Listo: ${r.cargadas} de ${r.total} fila(s) procesadas.</strong> Contadores: ${esc(r.secuencias)}</p>
        ${conError.length ? `<div class="form-error" style="display:block">${conError.length} tabla(s) con problemas: revisa abajo.</div>` : ""}
        ${tableHTML([
          { key: "tabla", label: "Tabla", fmt: (t) => esc(t.tabla.replace(/^asa_/, "")) },
          { key: "filas", label: "En el respaldo" },
          { key: "cargadas", label: "Procesadas" },
          { key: "error", label: "Problema", fmt: (t) => (t.error ? `<span style="color:#b91c1c">${esc(t.error)}</span>` : "—") },
        ], r.tablas.map((t) => ({ ...t, _clickable: false })))}`;
      toast("Respaldo restaurado");
    } catch (err) {
      $("#rs-resultado").innerHTML = `<div class="form-error" style="display:block">${esc(err.message)}</div>`;
      b.disabled = false;
    }
  });
}
