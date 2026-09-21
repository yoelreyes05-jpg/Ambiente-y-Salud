// routes/clientes.js — Clientes (grupos hoteleros) y su árbol de hoteles
//
// Jerarquía: cliente → contrato → hotel (planta) → área → punto de control.
// La pestaña Clientes del panel se arma con GET /clientes y GET /clientes/:id.
import express from "express";
import ExcelJS from "exceljs";
import { supabase } from "../lib/supabaseClient.js";
import { logAccion } from "../lib/auditoria.js";
import { requireRol, filtrarPorSitio } from "../middleware/auth.js";

const router = express.Router();

// GET /clientes?buscar=texto — con el conteo de hoteles y puntos de cada uno
router.get("/", async (req, res) => {
  let q = supabase.from("asa_clientes").select("*").eq("activo", true).order("razon_social");
  if (req.query.buscar) {
    q = q.or(`nombre_contacto.ilike.%${req.query.buscar}%,razon_social.ilike.%${req.query.buscar}%,rnc_cedula.ilike.%${req.query.buscar}%`);
  }
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  let qs = supabase.from("asa_sitios").select("id, cliente_id").eq("activo", true);
  qs = filtrarPorSitio(qs, req, "id");
  const { data: sitios } = await qs;

  const { data: puntos } = await supabase.from("asa_puntos_control").select("sitio_id").eq("activo", true);
  const puntosPorSitio = {};
  for (const p of puntos || []) puntosPorSitio[p.sitio_id] = (puntosPorSitio[p.sitio_id] || 0) + 1;

  const porCliente = {};
  for (const s of sitios || []) {
    const c = (porCliente[s.cliente_id] = porCliente[s.cliente_id] || { hoteles: 0, puntos: 0 });
    c.hoteles++;
    c.puntos += puntosPorSitio[s.id] || 0;
  }

  // Un usuario de hotel solo ve el cliente al que pertenece su hotel
  const visibles = req.sitiosPermitidos === null ? data : (data || []).filter((c) => porCliente[c.id]);

  res.json((visibles || []).map((c) => ({ ...c, ...(porCliente[c.id] || { hoteles: 0, puntos: 0 }) })));
});

// GET /clientes/:id — el desglose completo: contratos, hoteles, áreas y puntos
router.get("/:id", async (req, res) => {
  const { id } = req.params;

  const [cliente, sitios, contratos, estrategias] = await Promise.all([
    supabase.from("asa_clientes").select("*").eq("id", id).maybeSingle(),
    supabase.from("asa_sitios").select("*").eq("cliente_id", id).eq("activo", true).order("nombre"),
    supabase.from("asa_contratos_plagas").select("*").eq("cliente_id", id).eq("activo", true),
    supabase.from("asa_estrategias").select("id, nombre").eq("cliente_id", id).eq("activo", true),
  ]);

  if (cliente.error) return res.status(500).json({ error: true, mensaje: cliente.error.message });
  if (!cliente.data) return res.status(404).json({ error: true, mensaje: "Cliente no encontrado" });

  const permitidos = req.sitiosPermitidos;
  const hoteles = (sitios.data || []).filter((s) => permitidos === null || permitidos.includes(s.id));
  const ids = hoteles.map((s) => s.id);

  const [puentes, areas, puntos, avance] = await Promise.all([
    ids.length ? supabase.from("asa_contrato_sitios").select("contrato_id, sitio_id").in("sitio_id", ids) : { data: [] },
    ids.length ? supabase.from("asa_areas").select("id, sitio_id, nombre").in("sitio_id", ids).eq("activo", true) : { data: [] },
    ids.length ? supabase.from("asa_puntos_control").select("sitio_id, area_id").in("sitio_id", ids).eq("activo", true) : { data: [] },
    ids.length ? supabase.from("asa_v_avance_dia").select("*").in("sitio_id", ids) : { data: [] },
  ]);

  const contarPorSitio = (lista) =>
    (lista || []).reduce((a, x) => ({ ...a, [x.sitio_id]: (a[x.sitio_id] || 0) + 1 }), {});
  const areasPorSitio = contarPorSitio(areas.data);
  const puntosPorSitio = contarPorSitio(puntos.data);
  const avancePorSitio = Object.fromEntries((avance.data || []).map((a) => [a.sitio_id, a]));
  const contratoPorSitio = {};
  for (const p of puentes.data || []) contratoPorSitio[p.sitio_id] = p.contrato_id;

  res.json({
    ...cliente.data,
    estrategias: estrategias.data || [],
    contratos: (contratos.data || []).map((c) => ({
      ...c,
      hoteles: hoteles
        .filter((s) => contratoPorSitio[s.id] === c.id)
        .map((s) => enriquecer(s, areasPorSitio, puntosPorSitio, avancePorSitio)),
    })),
    // Hoteles que todavía no están ligados a ningún contrato
    hoteles_sin_contrato: hoteles
      .filter((s) => !contratoPorSitio[s.id])
      .map((s) => enriquecer(s, areasPorSitio, puntosPorSitio, avancePorSitio)),
    totales: {
      hoteles: hoteles.length,
      areas: Object.values(areasPorSitio).reduce((a, b) => a + b, 0),
      puntos: Object.values(puntosPorSitio).reduce((a, b) => a + b, 0),
    },
  });
});

const enriquecer = (s, areas, puntos, avance) => ({
  ...s,
  areas_total: areas[s.id] || 0,
  puntos_total: puntos[s.id] || 0,
  avance_hoy: avance[s.id] || { puntos_totales: puntos[s.id] || 0, realizados: 0, pendientes: puntos[s.id] || 0 },
});

// POST /clientes — crear cliente (idealmente ya validado por RNC vía /rnc/:rnc antes)
router.post("/", async (req, res) => {
  const { data, error } = await supabase.from("asa_clientes").insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  logAccion(req, { accion: "crear", modulo: "clientes", registroId: data.id, descripcion: `Cliente creado: ${data.nombre_contacto}` });
  res.status(201).json(data);
});

// PUT /clientes/:id
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from("asa_clientes")
    .update({ ...req.body, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  logAccion(req, { accion: "actualizar", modulo: "clientes", registroId: id });
  res.json(data);
});

// DELETE /clientes/:id — borrado lógico (activo=false), nunca borrado físico
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from("asa_clientes").update({ activo: false }).eq("id", id);
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  logAccion(req, { accion: "eliminar", modulo: "clientes", registroId: id });
  res.json({ ok: true });
});

// ── Sitios (línea de plagas) ────────────────────────────────────────────────
router.post("/:id/sitios", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from("asa_sitios").insert([{ ...req.body, cliente_id: id }]).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /clientes/importar — carga el Cliente.xlsx del sistema anterior
//
// Body: { archivo_base64, simular? }
//
// Lee las tres hojas del export ("CLIENTES", "PLANTAS", "CONTACTOS") y arma
// la jerarquía: cada cliente con su RNC, y cada PLANTA como un hotel colgando
// de su cliente. Si el archivo solo trae una hoja, usa la que encuentre.
//
// Es idempotente por RNC y por nombre de hotel: volver a correrlo actualiza
// en vez de duplicar.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/importar", requireRol("comercial", "operaciones"), async (req, res) => {
  const { archivo_base64, simular = false } = req.body;
  if (!archivo_base64) return res.status(400).json({ error: true, mensaje: "archivo_base64 es requerido" });

  let hojas;
  try {
    hojas = await leerLibro(archivo_base64);
  } catch (e) {
    return res.status(400).json({ error: true, mensaje: `No se pudo leer el archivo: ${e.message}` });
  }

  const filasClientes = hojas.CLIENTES || hojas[Object.keys(hojas)[0]] || [];
  const filasPlantas = hojas.PLANTAS || [];
  const filasContactos = hojas.CONTACTOS || [];

  // Contacto principal de cada cliente (el primero que aparezca)
  const contactoDe = {};
  for (const f of filasContactos) {
    const cli = norm(campo(f, ["cliente"]));
    if (!cli || contactoDe[cli]) continue;
    const nombre = [campo(f, ["nombrecontacto"]), campo(f, ["apellidosdecontacto"])].filter(Boolean).join(" ").trim();
    contactoDe[cli] = {
      nombre_contacto: nombre || null,
      telefono: campo(f, ["celular", "telefono"]),
      email: campo(f, ["correocontacto", "correo", "email"]),
    };
  }

  const clientes = [];
  for (const f of filasClientes) {
    const comercial = campo(f, ["nombrecomercial", "nombre", "cliente"]);
    if (!comercial) continue;
    const social = campo(f, ["razonsocial"]) || comercial;
    const rnc = limpiarRNC(campo(f, ["idfiscal", "rnc", "rnccedula", "identificacion"]));
    const giro = campo(f, ["giro", "actividad"]);
    const contacto = contactoDe[norm(comercial)] || {};

    clientes.push({
      _clave: norm(comercial),
      _giro: giro,
      nombre_comercial: String(comercial).trim(),
      razon_social: String(social).trim(),
      rnc_cedula: rnc,
      tipo_documento: rnc && rnc.length === 11 ? "CEDULA" : "RNC",
      tipo_cliente: "empresa",
      direccion: campo(f, ["direccion"]) || null,
      nombre_contacto: contacto.nombre_contacto || String(comercial).trim(),
      telefono: contacto.telefono || null,
      telefono_whatsapp: contacto.telefono || null,
      email: contacto.email || null,
      activo: !/inactiv/i.test(String(campo(f, ["estado"]) || "activo")),
    });
  }

  // Plantas = hoteles
  const hoteles = [];
  for (const f of filasPlantas) {
    const cli = campo(f, ["cliente"]);
    const planta = campo(f, ["planta", "nombre", "sitio"]);
    if (!planta) continue;
    const licencia = campo(f, ["licenciasanitaria", "licencia"]);
    const giroCliente = clientes.find((c) => c._clave === norm(cli))?._giro;

    hoteles.push({
      _cliente_clave: norm(cli),
      nombre: String(planta).trim(),
      direccion: campo(f, ["direccion"]) || "Por definir",
      codigo: siglasDe(planta),
      tipo_sitio: /hotel/i.test(String(giroCliente || "")) ? "hotel" : "comercial",
      notas: licencia ? `Licencia sanitaria: ${licencia}` : null,
    });
  }

  const resumen = {
    clientes_leidos: clientes.length,
    hoteles_leidos: hoteles.length,
    contactos_leidos: Object.keys(contactoDe).length,
    hojas: Object.keys(hojas),
    sin_cliente: hoteles.filter((h) => !clientes.some((c) => c._clave === h._cliente_clave)).map((h) => h.nombre),
  };

  if (simular) {
    return res.json({
      simulado: true,
      ...resumen,
      clientes: clientes.map(({ _clave, _giro, ...c }) => c),
      hoteles: hoteles.map(({ _cliente_clave, ...h }) => h),
    });
  }
  if (!clientes.length) {
    return res.status(400).json({ error: true, mensaje: "No se encontró ninguna fila de cliente", ...resumen });
  }

  // 1) Clientes: se reconcilian por RNC, y si no hay RNC, por razón social
  const { data: existentes } = await supabase.from("asa_clientes").select("id, rnc_cedula, razon_social, nombre_comercial");
  const porRNC = new Map((existentes || []).filter((c) => c.rnc_cedula).map((c) => [c.rnc_cedula, c]));
  const porNombre = new Map((existentes || []).map((c) => [norm(c.nombre_comercial || c.razon_social), c]));

  const idPorClave = {};
  let creados = 0;
  let actualizados = 0;

  for (const { _clave, _giro, ...c } of clientes) {
    const ya = (c.rnc_cedula && porRNC.get(c.rnc_cedula)) || porNombre.get(_clave);
    if (ya) {
      await supabase.from("asa_clientes").update(c).eq("id", ya.id);
      idPorClave[_clave] = ya.id;
      actualizados++;
    } else {
      const { data, error } = await supabase.from("asa_clientes").insert([c]).select("id").single();
      if (error) return res.status(500).json({ error: true, mensaje: `${c.razon_social}: ${error.message}`, ...resumen });
      idPorClave[_clave] = data.id;
      creados++;
    }
  }

  // 2) Hoteles
  const { data: sitiosExistentes } = await supabase.from("asa_sitios").select("id, cliente_id, nombre");
  const sitioClave = (clienteId, nombre) => `${clienteId}::${norm(nombre)}`;
  const sitiosPorClave = new Map((sitiosExistentes || []).map((s) => [sitioClave(s.cliente_id, s.nombre), s]));

  let hotelesCreados = 0;
  let hotelesOmitidos = 0;
  const hotelesResultado = [];

  for (const { _cliente_clave, ...h } of hoteles) {
    const cliente_id = idPorClave[_cliente_clave];
    if (!cliente_id) {
      hotelesOmitidos++;
      continue;
    }
    const ya = sitiosPorClave.get(sitioClave(cliente_id, h.nombre));
    if (ya) {
      await supabase.from("asa_sitios").update(h).eq("id", ya.id);
      hotelesResultado.push({ id: ya.id, nombre: h.nombre, nuevo: false });
    } else {
      const { data, error } = await supabase.from("asa_sitios").insert([{ ...h, cliente_id }]).select("id").single();
      if (error) return res.status(500).json({ error: true, mensaje: `${h.nombre}: ${error.message}`, ...resumen });
      hotelesResultado.push({ id: data.id, nombre: h.nombre, nuevo: true });
      hotelesCreados++;
    }
  }

  logAccion(req, {
    accion: "crear",
    modulo: "clientes",
    descripcion: `Importación: ${creados} clientes nuevos, ${hotelesCreados} hoteles nuevos`,
  });

  res.status(201).json({
    ...resumen,
    clientes_creados: creados,
    clientes_actualizados: actualizados,
    hoteles_creados: hotelesCreados,
    hoteles_omitidos_sin_cliente: hotelesOmitidos,
    hoteles: hotelesResultado,
  });
});

// ── Utilidades del importador ───────────────────────────────────────────────
const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

function campo(fila, claves) {
  for (const k of claves) {
    const col = Object.keys(fila).find((c) => norm(c) === k);
    if (col && fila[col] !== null && String(fila[col]).trim() !== "") return fila[col];
  }
  return null;
}

const limpiarRNC = (v) => (v ? String(v).replace(/[^\d]/g, "") || null : null);

const siglasDe = (t) =>
  String(t)
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6) || null;

// Lee TODAS las hojas del libro y devuelve { NOMBRE_HOJA: [{col: valor}] }
export async function leerLibro(base64) {
  const buffer = Buffer.from(String(base64).replace(/^data:[^;]+;base64,/, ""), "base64");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const salida = {};
  for (const ws of wb.worksheets) {
    // El encabezado es la fila más ancha de las primeras 20 (los export traen
    // título, fecha de descarga y filtros arriba).
    let filaEncabezado = 1;
    let mejor = 0;
    for (let r = 1; r <= Math.min(ws.rowCount, 20); r++) {
      const n = (ws.getRow(r).values || []).filter(
        (v) => v !== null && v !== undefined && String(v.text ?? v).trim() !== ""
      ).length;
      if (n > mejor) {
        mejor = n;
        filaEncabezado = r;
      }
    }
    if (mejor < 2) continue;

    const enc = [];
    ws.getRow(filaEncabezado).eachCell({ includeEmpty: true }, (c, col) => {
      enc[col] = String(c.value ?? "").trim();
    });

    const filas = [];
    for (let r = filaEncabezado + 1; r <= ws.rowCount; r++) {
      const fila = {};
      let algo = false;
      ws.getRow(r).eachCell({ includeEmpty: false }, (celda, col) => {
        const clave = enc[col];
        if (!clave) return;
        let v = celda.value;
        if (v && typeof v === "object") v = v.text ?? v.result ?? v.hyperlink ?? String(v);
        if (v !== null && String(v).trim() !== "") algo = true;
        fila[clave] = v;
      });
      if (algo) filas.push(fila);
    }
    salida[ws.name.toUpperCase()] = filas;
  }
  return salida;
}

export default router;
