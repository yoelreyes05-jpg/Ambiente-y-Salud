// routes/auditoria.js — La bitacora: quien hizo que, cuando y sobre que
//
// La tabla asa_log_auditoria ya se llenaba sola (lib/auditoria.js escribe en
// cada accion sensible), pero no habia forma de verla. Esto la expone filtrada,
// que es lo unico que la hace util: "todo lo que hizo Maria en puntos de
// control la semana pasada" en vez de diez mil filas en orden de llegada.
//
// Guarda `usuario_nombre` congelado, asi que un usuario borrado sigue
// apareciendo con su nombre en lo que hizo. Eso es a proposito: una bitacora
// que se vacia cuando despides a alguien no sirve de nada.
import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { requireRol } from "../middleware/auth.js";

const router = express.Router();

const haceDias = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

// Solo admin: la bitacora dice quien hizo que, y eso no lo ve todo el mundo.
router.use(requireRol("admin"));

// GET /auditoria?usuario=&modulo=&accion=&desde=&hasta=&buscar=&limite=
router.get("/", async (req, res) => {
  const { usuario, modulo, accion, desde, hasta, buscar } = req.query;
  const limite = Math.min(Number(req.query.limite) || 200, 1000);

  let q = supabase
    .from("asa_log_auditoria")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(limite);

  if (usuario) q = q.or(`usuario_id.eq.${usuario},usuario_nombre.ilike.%${usuario}%`);
  if (modulo) q = q.eq("modulo", modulo);
  if (accion) q = q.eq("accion", accion);
  if (desde) q = q.gte("created_at", `${desde}T00:00:00`);
  if (hasta) q = q.lte("created_at", `${hasta}T23:59:59`);
  if (buscar) q = q.ilike("descripcion", `%${buscar}%`);

  const { data, error, count } = await q;
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  res.json({ total: count ?? (data || []).length, limite, registros: data || [] });
});

// GET /auditoria/filtros — que valores existen de verdad en la bitacora.
// Se sacan de los datos y no de una lista fija: si manana se agrega un modulo,
// el filtro lo muestra sin tocar nada.
router.get("/filtros", async (req, res) => {
  const { data, error } = await supabase
    .from("asa_log_auditoria")
    .select("usuario_id, usuario_nombre, modulo, accion")
    .gte("created_at", haceDias(365))
    .limit(20000);
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const usuarios = new Map();
  const modulos = new Set();
  const acciones = new Set();
  for (const r of data || []) {
    if (r.usuario_nombre) usuarios.set(r.usuario_nombre, r.usuario_id || null);
    if (r.modulo) modulos.add(r.modulo);
    if (r.accion) acciones.add(r.accion);
  }

  res.json({
    usuarios: [...usuarios.entries()].map(([nombre, id]) => ({ nombre, id })).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    modulos: [...modulos].sort(),
    acciones: [...acciones].sort(),
  });
});

// GET /auditoria/resumen?dias=30 — actividad por persona y por modulo
router.get("/resumen", async (req, res) => {
  const dias = Math.min(Number(req.query.dias) || 30, 365);
  const { data, error } = await supabase
    .from("asa_log_auditoria")
    .select("usuario_nombre, modulo, accion, created_at")
    .gte("created_at", haceDias(dias))
    .limit(50000);
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const porUsuario = new Map();
  const porModulo = new Map();
  for (const r of data || []) {
    const u = r.usuario_nombre || "Sistema";
    if (!porUsuario.has(u)) porUsuario.set(u, { usuario: u, total: 0, crear: 0, actualizar: 0, eliminar: 0, ultima: null });
    const fu = porUsuario.get(u);
    fu.total++;
    if (fu[r.accion] !== undefined) fu[r.accion]++;
    if (!fu.ultima || r.created_at > fu.ultima) fu.ultima = r.created_at;

    const m = r.modulo || "otro";
    porModulo.set(m, (porModulo.get(m) || 0) + 1);
  }

  res.json({
    dias,
    total: (data || []).length,
    por_usuario: [...porUsuario.values()].sort((a, b) => b.total - a.total),
    por_modulo: [...porModulo.entries()].map(([modulo, total]) => ({ modulo, total })).sort((a, b) => b.total - a.total),
  });
});

export default router;
