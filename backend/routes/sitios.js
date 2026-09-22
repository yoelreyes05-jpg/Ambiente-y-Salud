// routes/sitios.js — Hoteles (sitios) y sus áreas
//
// Jerarquía: cliente → contrato → hotel → área → punto de control.
// Este router cubre los dos niveles del medio.
import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { logAccion } from "../lib/auditoria.js";
import { requireRol, filtrarPorSitio, exigirSitioPermitido } from "../middleware/auth.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// HOTELES / SITIOS
// ─────────────────────────────────────────────────────────────────────────────

// GET /sitios?cliente_id=&contrato_id=&tipo=
router.get("/", async (req, res) => {
  let q = supabase
    .from("asa_sitios")
    .select("*, asa_clientes(id, nombre_contacto, razon_social)")
    .eq("activo", true)
    .order("nombre");

  if (req.query.cliente_id) q = q.eq("cliente_id", req.query.cliente_id);
  if (req.query.tipo) q = q.eq("tipo_sitio", req.query.tipo);
  q = filtrarPorSitio(q, req, "id");

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  // Filtro por contrato: se resuelve con la tabla puente
  if (req.query.contrato_id) {
    const { data: puente } = await supabase
      .from("asa_contrato_sitios")
      .select("sitio_id")
      .eq("contrato_id", req.query.contrato_id);
    const ids = new Set((puente || []).map((p) => p.sitio_id));
    return res.json((data || []).filter((s) => ids.has(s.id)));
  }

  res.json(data);
});

// GET /sitios/:id — ficha del hotel con su avance del día
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  if (!exigirSitioPermitido(req, res, id)) return;

  const [sitio, areas, avance, contratos] = await Promise.all([
    supabase.from("asa_sitios").select("*, asa_clientes(*)").eq("id", id).maybeSingle(),
    supabase.from("asa_areas").select("*").eq("sitio_id", id).eq("activo", true).order("orden"),
    supabase.from("asa_v_avance_dia").select("*").eq("sitio_id", id).maybeSingle(),
    supabase.from("asa_contrato_sitios").select("asa_contratos_plagas(*)").eq("sitio_id", id),
  ]);

  if (!sitio.data) return res.status(404).json({ error: true, mensaje: "Hotel no encontrado" });

  res.json({
    ...sitio.data,
    areas: areas.data || [],
    avance_hoy: avance.data || { puntos_totales: 0, realizados: 0, pendientes: 0 },
    contratos: (contratos.data || []).map((c) => c.asa_contratos_plagas).filter(Boolean),
  });
});

// POST /sitios
router.post("/", requireRol("comercial", "operaciones"), async (req, res) => {
  const { contrato_id, ...sitio } = req.body;
  if (!sitio.cliente_id || !sitio.nombre) {
    return res.status(400).json({ error: true, mensaje: "cliente_id y nombre son requeridos" });
  }

  const { data, error } = await supabase
    .from("asa_sitios")
    .insert([{ ...sitio, direccion: sitio.direccion || "Por definir" }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  if (contrato_id) {
    await supabase.from("asa_contrato_sitios").insert([{ contrato_id, sitio_id: data.id }]);
  }

  logAccion(req, { accion: "crear", modulo: "sitios", registroId: data.id, descripcion: `Hotel ${data.nombre}` });
  res.status(201).json(data);
});

// PUT /sitios/:id
router.put("/:id", requireRol("comercial", "operaciones"), async (req, res) => {
  if (!exigirSitioPermitido(req, res, req.params.id)) return;
  const { id: _omit, ...cambios } = req.body;
  const { data, error } = await supabase.from("asa_sitios").update(cambios).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  logAccion(req, { accion: "actualizar", modulo: "sitios", registroId: req.params.id });
  res.json(data);
});

// POST /sitios/:id/contratos — vincular el hotel a un contrato existente
router.post("/:id/contratos", requireRol("comercial"), async (req, res) => {
  const { contrato_id } = req.body;
  const { data, error } = await supabase
    .from("asa_contrato_sitios")
    .insert([{ contrato_id, sitio_id: req.params.id }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});

// ─────────────────────────────────────────────────────────────────────────────
// ÁREAS
// ─────────────────────────────────────────────────────────────────────────────

// GET /sitios/:id/areas — con el conteo de puntos de cada una
router.get("/:id/areas", async (req, res) => {
  if (!exigirSitioPermitido(req, res, req.params.id)) return;

  const { data, error } = await supabase
    .from("asa_areas")
    .select("*")
    .eq("sitio_id", req.params.id)
    .eq("activo", true)
    .order("orden")
    .order("nombre");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const { data: puntos } = await supabase
    .from("asa_puntos_control")
    .select("area_id")
    .eq("sitio_id", req.params.id)
    .eq("activo", true);

  const conteo = {};
  for (const p of puntos || []) conteo[p.area_id] = (conteo[p.area_id] || 0) + 1;

  res.json((data || []).map((a) => ({ ...a, puntos_total: conteo[a.id] || 0 })));
});

// POST /sitios/:id/areas — una área, o varias de golpe
// Body: { nombre, codigo, nivel, orden }  ó  { areas: [{nombre, codigo}, ...] }
router.post("/:id/areas", requireRol("comercial", "operaciones"), async (req, res) => {
  const sitio_id = req.params.id;
  if (!exigirSitioPermitido(req, res, sitio_id)) return;

  const entrada = Array.isArray(req.body.areas) ? req.body.areas : [req.body];
  const filas = entrada
    .filter((a) => a && a.nombre)
    .map((a, i) => ({
      sitio_id,
      nombre: String(a.nombre).trim(),
      codigo: a.codigo ? String(a.codigo).trim().toUpperCase() : null,
      nivel: a.nivel || null,
      descripcion: a.descripcion || null,
      orden: a.orden ?? i,
    }));

  if (!filas.length) return res.status(400).json({ error: true, mensaje: "Se requiere al menos un nombre de área" });

  // upsert para que volver a cargar la misma lista no duplique nada
  const { data, error } = await supabase
    .from("asa_areas")
    .upsert(filas, { onConflict: "sitio_id,nombre", ignoreDuplicates: false })
    .select();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  logAccion(req, { accion: "crear", modulo: "areas", registroId: sitio_id, descripcion: `${data.length} área(s)` });
  res.status(201).json(data);
});

// PUT /sitios/areas/:areaId
router.put("/areas/:areaId", requireRol("comercial", "operaciones"), async (req, res) => {
  const { id: _omit, sitio_id: _omit2, ...cambios } = req.body;
  const { data, error } = await supabase.from("asa_areas").update(cambios).eq("id", req.params.areaId).select().single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json(data);
});

// DELETE /sitios/areas/:areaId — baja lógica; los puntos quedan sin área
router.delete("/areas/:areaId", requireRol("operaciones"), async (req, res) => {
  const { error } = await supabase.from("asa_areas").update({ activo: false }).eq("id", req.params.areaId);
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLANOS
// ─────────────────────────────────────────────────────────────────────────────

// GET /sitios/:id/planos — con los puntos ya posicionados encima
router.get("/:id/planos", async (req, res) => {
  if (!exigirSitioPermitido(req, res, req.params.id)) return;

  const { data: planos, error } = await supabase
    .from("asa_planos")
    .select("*")
    .eq("sitio_id", req.params.id)
    .eq("activo", true)
    .order("orden");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const { data: puntos } = await supabase
    .from("asa_puntos_control")
    .select("id, qr_token, codigo_visible, nombre, plano_id, plano_x, plano_y, tipo_punto_id, asa_tipos_punto(codigo, icono, color)")
    .eq("sitio_id", req.params.id)
    .eq("activo", true)
    .not("plano_id", "is", null);

  res.json(
    (planos || []).map((pl) => ({
      ...pl,
      puntos: (puntos || []).filter((p) => p.plano_id === pl.id),
    }))
  );
});

// POST /sitios/:id/planos — { nombre, imagen_url, area_id?, ancho_px?, alto_px? }
router.post("/:id/planos", requireRol("operaciones"), async (req, res) => {
  if (!exigirSitioPermitido(req, res, req.params.id)) return;
  const { data, error } = await supabase
    .from("asa_planos")
    .insert([{ ...req.body, sitio_id: req.params.id }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.status(201).json(data);
});



// ─────────────────────────────────────────────────────────────────────────────
// POST /sitios/areas/:areaId/fusionar — unir dos áreas duplicadas
//
// El export del sistema anterior dejó áreas repetidas que solo cambian en
// mayúsculas o en una palabra ("buffet" y "Buffet central"). Esto mueve todos
// los puntos del área origen a la destino y da de baja la origen.
//
// Body: { destino_id, simular? }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/areas/:areaId/fusionar", requireRol("operaciones"), async (req, res) => {
  const origenId = req.params.areaId;
  const { destino_id, simular = false } = req.body;

  if (!destino_id) return res.status(400).json({ error: true, mensaje: "destino_id es requerido" });
  if (destino_id === origenId) {
    return res.status(400).json({ error: true, mensaje: "El área origen y la destino son la misma" });
  }

  const { data: areas, error: errA } = await supabase
    .from("asa_areas")
    .select("id, sitio_id, nombre")
    .in("id", [origenId, destino_id]);
  if (errA) return res.status(500).json({ error: true, mensaje: errA.message });

  const origen = (areas || []).find((a) => a.id === origenId);
  const destino = (areas || []).find((a) => a.id === destino_id);
  if (!origen || !destino) return res.status(404).json({ error: true, mensaje: "Alguna de las dos áreas no existe" });
  if (origen.sitio_id !== destino.sitio_id) {
    return res.status(400).json({ error: true, mensaje: "Las dos áreas tienen que ser de la misma planta" });
  }
  if (!exigirSitioPermitido(req, res, origen.sitio_id)) return;

  const { count } = await supabase
    .from("asa_puntos_control")
    .select("id", { count: "exact", head: true })
    .eq("area_id", origenId);

  if (simular) {
    return res.json({
      simulado: true,
      moverian: count || 0,
      origen: origen.nombre,
      destino: destino.nombre,
    });
  }

  const { data: movidos, error } = await supabase
    .from("asa_puntos_control")
    .update({ area_id: destino_id })
    .eq("area_id", origenId)
    .select("id");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  // Los planos que apuntaban al área origen también se reapuntan, si no
  // quedarían colgando de un área dada de baja.
  await supabase.from("asa_planos").update({ area_id: destino_id }).eq("area_id", origenId);

  // Baja lógica de la origen: no se borra, por si hay que revisar el histórico
  const { error: errBaja } = await supabase.from("asa_areas").update({ activo: false }).eq("id", origenId);
  if (errBaja) return res.status(500).json({ error: true, mensaje: errBaja.message });

  logAccion(req, {
    accion: "actualizar",
    modulo: "areas",
    registroId: destino_id,
    descripcion: `"${origen.nombre}" fusionada en "${destino.nombre}" (${movidos.length} puntos)`,
  });

  res.json({ movidos: movidos.length, origen: origen.nombre, destino: destino.nombre });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sitios/:id/planos/subir — sube la imagen del plano y crea el registro
//
// El plano llega en base64 desde el panel y se guarda en Supabase Storage, en
// el bucket público `asa-planos`. Se guarda la URL, no la imagen, porque un
// plano de hotel pesa megas y meterlo en la tabla haría lentas todas las
// consultas que la tocan.
//
// El bucket se crea solo la primera vez, así no hay un paso manual en la
// consola de Supabase que alguien vaya a olvidar.
// ─────────────────────────────────────────────────────────────────────────────
const BUCKET_PLANOS = "asa-planos";

const TIPOS_PLANO = ["image/png", "image/jpeg", "image/webp", "image/svg+xml", "application/pdf"];

async function asegurarBucket() {
  const { data } = await supabase.storage.getBucket(BUCKET_PLANOS);
  if (!data) {
    await supabase.storage.createBucket(BUCKET_PLANOS, {
      public: true,
      fileSizeLimit: 40 * 1024 * 1024,
      allowedMimeTypes: TIPOS_PLANO,
    });
    return;
  }
  // El bucket ya existia de antes de que se aceptaran PDF. Si no los permite,
  // se actualiza: sin esto, subir el mapa exportado de QGIS falla con un
  // "mime type not supported" que no dice donde arreglarlo.
  const permitidos = data.allowed_mime_types || data.allowedMimeTypes || null;
  if (permitidos && !permitidos.includes("application/pdf")) {
    await supabase.storage.updateBucket(BUCKET_PLANOS, {
      public: true,
      fileSizeLimit: 40 * 1024 * 1024,
      allowedMimeTypes: TIPOS_PLANO,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Georreferencia de un PDF exportado de QGIS
//
// QGIS, al exportar con "Crear GeoPDF", mete en el documento un diccionario
// /Measure con /GPTS: los cuatro vertices del mapa en grados (lat, lon), y
// /BBox con el rectangulo que ocupan dentro de la pagina. Con eso se saca el
// recuadro sin pedirle nada al usuario.
//
// Se lee con una expresion regular sobre el PDF en crudo y no con una libreria:
// es un unico dato, siempre en el mismo formato, y meter un parser de PDF al
// servidor por esto costaria mas de lo que resuelve. Si no aparece, no pasa
// nada: el panel pide las cuatro coordenadas a mano.
// ─────────────────────────────────────────────────────────────────────────────
function leerGeoDePdf(binario) {
  try {
    const texto = binario.toString("latin1");
    const m = /\/GPTS\s*\[([^\]]+)\]/.exec(texto);
    if (!m) return null;

    const nums = m[1].trim().split(/\s+/).map(Number).filter((n) => Number.isFinite(n));
    // Vienen en pares lat lon, normalmente cuatro pares (las esquinas).
    if (nums.length < 4 || nums.length % 2 !== 0) return null;

    const lats = nums.filter((_, i) => i % 2 === 0);
    const lons = nums.filter((_, i) => i % 2 === 1);
    const geo = {
      geo_norte: Math.max(...lats),
      geo_sur: Math.min(...lats),
      geo_este: Math.max(...lons),
      geo_oeste: Math.min(...lons),
      geo_fuente: "pdf",
    };

    // Coordenadas fuera de rango o un recuadro de area cero significan que se
    // leyo otra cosa. Mejor no georreferenciar que poner al tecnico en el mar.
    if (Math.abs(geo.geo_norte) > 90 || Math.abs(geo.geo_sur) > 90) return null;
    if (Math.abs(geo.geo_este) > 180 || Math.abs(geo.geo_oeste) > 180) return null;
    if (geo.geo_norte <= geo.geo_sur || geo.geo_este <= geo.geo_oeste) return null;
    return geo;
  } catch {
    return null;
  }
}

router.post("/:id/planos/subir", requireRol("operaciones"), async (req, res) => {
  const sitio_id = req.params.id;
  if (!exigirSitioPermitido(req, res, sitio_id)) return;

  const {
    nombre, archivo_base64, tipo_mime = "image/png", area_id, ancho_px, alto_px,
    geo_norte, geo_sur, geo_este, geo_oeste,
  } = req.body;
  if (!nombre || !archivo_base64) {
    return res.status(400).json({ error: true, mensaje: "nombre y archivo_base64 son requeridos" });
  }
  if (!TIPOS_PLANO.includes(tipo_mime)) {
    return res.status(400).json({ error: true, mensaje: `Tipo de archivo no aceptado (${tipo_mime}). Sube PNG, JPG, WEBP, SVG o PDF.` });
  }

  let binario;
  try {
    binario = Buffer.from(String(archivo_base64).replace(/^data:[^,]+,/, ""), "base64");
  } catch {
    return res.status(400).json({ error: true, mensaje: "El archivo no es base64 válido" });
  }
  if (!binario.length) return res.status(400).json({ error: true, mensaje: "El archivo llegó vacío" });
  if (binario.length > 40 * 1024 * 1024) {
    return res.status(400).json({ error: true, mensaje: "El plano no puede pasar de 40 MB" });
  }

  try {
    await asegurarBucket();
  } catch (e) {
    return res.status(500).json({ error: true, mensaje: `No se pudo preparar el almacenamiento: ${e.message}` });
  }

  const esPdf = tipo_mime === "application/pdf";
  const ext = esPdf ? "pdf" : (tipo_mime.split("/")[1] || "png").replace("svg+xml", "svg");

  // Recuadro de coordenadas: primero lo que traiga el propio PDF, y si no, lo
  // que haya escrito el usuario a mano. Los cuatro o ninguno (lo exige la base):
  // un recuadro a medias pondria al tecnico en el lugar equivocado con toda
  // confianza, que es peor que no ubicarlo.
  let geo = esPdf ? leerGeoDePdf(binario) : null;
  const manual = [geo_norte, geo_sur, geo_este, geo_oeste].map((v) => (v === "" || v === undefined || v === null ? null : Number(v)));
  if (!geo && manual.every((v) => v !== null && Number.isFinite(v))) {
    const [n, sur, e2, o] = manual;
    if (n <= sur || e2 <= o) {
      return res.status(400).json({
        error: true,
        mensaje: "El recuadro esta al reves: norte tiene que ser mayor que sur, y este mayor que oeste (en el pais las longitudes son negativas, -68.4 es mayor que -68.5).",
      });
    }
    geo = { geo_norte: n, geo_sur: sur, geo_este: e2, geo_oeste: o, geo_fuente: "manual" };
  }
  const ruta = `${sitio_id}/${Date.now()}-${String(nombre).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}.${ext}`;

  const { error: errSubida } = await supabase.storage
    .from(BUCKET_PLANOS)
    .upload(ruta, binario, { contentType: tipo_mime, upsert: false });
  if (errSubida) {
    return res.status(500).json({ error: true, mensaje: `No se pudo subir el plano: ${errSubida.message}` });
  }

  const { data: pub } = supabase.storage.from(BUCKET_PLANOS).getPublicUrl(ruta);

  const { data, error } = await supabase
    .from("asa_planos")
    .insert([{
      sitio_id,
      area_id: area_id || null,
      nombre,
      imagen_url: pub.publicUrl,
      tipo_archivo: esPdf ? "pdf" : "imagen",
      tipo_mime,
      ancho_px: ancho_px || null,
      alto_px: alto_px || null,
      ...(geo || {}),
    }])
    .select()
    .single();
  if (error) {
    // Si falla el insert, el archivo subido quedaría huérfano ocupando espacio
    await supabase.storage.from(BUCKET_PLANOS).remove([ruta]).catch(() => {});
    return res.status(500).json({ error: true, mensaje: error.message });
  }

  res.status(201).json({
    ...data,
    aviso_georreferencia: esPdf && !geo
      ? "El PDF no trae la georreferencia de QGIS (exportalo marcando 'Crear GeoPDF') y no se escribieron las coordenadas a mano. El plano funciona, pero la app del tecnico no podra ubicarlo con el GPS hasta que le pongas el recuadro."
      : null,
  });
});

// PATCH /sitios/planos/:planoId — nombre, area y el recuadro de coordenadas
//
// Es la segunda oportunidad: si el PDF se subio sin georreferencia, aqui se le
// escriben las cuatro coordenadas sin tener que volver a subir el archivo.
router.patch("/planos/:planoId", requireRol("operaciones"), async (req, res) => {
  const cambios = {};
  if (req.body.nombre !== undefined) cambios.nombre = String(req.body.nombre).trim();
  if (req.body.area_id !== undefined) cambios.area_id = req.body.area_id || null;
  if (req.body.orden !== undefined) cambios.orden = Number(req.body.orden) || 0;
  if (req.body.rotacion_grados !== undefined) cambios.rotacion_grados = Number(req.body.rotacion_grados) || 0;

  const geo = ["geo_norte", "geo_sur", "geo_este", "geo_oeste"];
  if (geo.some((k) => req.body[k] !== undefined)) {
    const vals = geo.map((k) => (req.body[k] === "" || req.body[k] === null ? null : Number(req.body[k])));
    if (vals.every((v) => v === null)) {
      geo.forEach((k) => (cambios[k] = null));
      cambios.geo_fuente = null;
    } else if (vals.every((v) => v !== null && Number.isFinite(v))) {
      const [n, sur, e2, o] = vals;
      if (n <= sur || e2 <= o) {
        return res.status(400).json({
          error: true,
          mensaje: "El recuadro esta al reves: norte mayor que sur, y este mayor que oeste.",
        });
      }
      geo.forEach((k, i) => (cambios[k] = vals[i]));
      cambios.geo_fuente = "manual";
    } else {
      return res.status(400).json({ error: true, mensaje: "Hacen falta las cuatro coordenadas, o ninguna." });
    }
  }

  if (!Object.keys(cambios).length) return res.status(400).json({ error: true, mensaje: "Nada que cambiar" });

  const { data, error } = await supabase.from("asa_planos").update(cambios).eq("id", req.params.planoId).select();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  if (!data?.length) return res.status(404).json({ error: true, mensaje: "Plano no encontrado" });
  logAccion(req, { accion: "actualizar", modulo: "planos", registroId: req.params.planoId, descripcion: data[0].nombre });
  res.json(data[0]);
});

// DELETE /sitios/planos/:planoId — baja lógica
//
// No se borra el archivo ni se limpian los pines: los puntos conservan su
// posición, así que si se vuelve a subir el mismo plano no hay que recolocar
// 170 cebaderos a mano.
router.delete("/planos/:planoId", requireRol("operaciones"), async (req, res) => {
  const { error } = await supabase.from("asa_planos").update({ activo: false }).eq("id", req.params.planoId);
  if (error) return res.status(500).json({ error: true, mensaje: error.message });
  res.json({ ok: true });
});

export default router;
