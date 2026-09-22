// routes/configuracion.js — Datos de la empresa y matriz de permisos
//
// Todo vive en asa_config_sistema (clave/valor jsonb), que ya existia. Se
// expone por clave y no como un objeto gigante para que guardar los datos de la
// empresa no pise la matriz de permisos y al contrario: dos pantallas distintas
// escribiendo la misma fila es como se pierde configuracion sin darse cuenta.
import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { logAccion } from "../lib/auditoria.js";
import { requireRol } from "../middleware/auth.js";

const router = express.Router();

// ── Estados del punto ────────────────────────────────────────────────────────
//
// La lista que el tecnico ve arriba de todo al abrir un punto. Vivia clavada en
// tres sitios (la app, este backend y un CHECK de la base), asi que no se podia
// cambiar una palabra sin tocar codigo. Ahora es un catalogo editable desde
// Configuracion -> Estados del punto, y esto de aqui es solo el arranque: lo que
// se ve mientras nadie lo haya editado.
//
// Banderas:
//   requiere_motivo → el tecnico tiene que decir por que, y se le salta el
//                     checklist, el nivel de actividad y el conteo de plagas.
//                     Es lo que marca el servicio como NO REALIZADO.
//   genera_hallazgo → abre un hallazgo para que el hotel lo corrija.
//   sistema         → se renombra y se reordena, pero no se borra: hay
//                     inspecciones viejas y reportes que lo usan.
export const ESTADOS_PUNTO_DEFECTO = [
  { codigo: "ok",           etiqueta: "Todo bien",      color: "#4A7D4D", orden: 10, activo: true, sistema: true,  requiere_motivo: false, genera_hallazgo: false },
  { codigo: "actividad",    etiqueta: "Con actividad",  color: "#B45309", orden: 20, activo: true, sistema: false, requiere_motivo: false, genera_hallazgo: false },
  { codigo: "dañado",       etiqueta: "Dañado",         color: "#B91C1C", orden: 30, activo: true, sistema: false, requiere_motivo: false, genera_hallazgo: true  },
  { codigo: "faltante",     etiqueta: "No está",        color: "#B91C1C", orden: 40, activo: true, sistema: false, requiere_motivo: false, genera_hallazgo: true  },
  { codigo: "no_accesible", etiqueta: "No pude entrar", color: "#B91C1C", orden: 50, activo: true, sistema: true,  requiere_motivo: true,  genera_hallazgo: false },
  { codigo: "reemplazado",  etiqueta: "Lo reemplacé",   color: "#32539C", orden: 60, activo: true, sistema: false, requiere_motivo: false, genera_hallazgo: false },
];

// Los dos que no se pueden borrar: 'ok' es el valor por defecto de la columna y
// 'no_accesible' es el que el backend sigue usando para "no se pudo hacer".
const ESTADOS_SISTEMA = ["ok", "no_accesible"];

// Un codigo se guarda en la base y sale en reportes viejos, asi que se deja
// manso: minusculas, sin espacios y sin signos raros. La etiqueta —lo que lee el
// tecnico— puede decir lo que sea.
const codigoEstado = (v) =>
  String(v || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_ñáéíóúü]/g, "")
    .slice(0, 40);

export function normalizarEstadosPunto(lista) {
  const entrada = Array.isArray(lista) ? lista : [];
  const vistos = new Set();
  const salida = [];

  entrada.forEach((e, i) => {
    const codigo = codigoEstado(e?.codigo || e?.etiqueta);
    const etiqueta = String(e?.etiqueta || "").trim();
    if (!codigo || !etiqueta || vistos.has(codigo)) return;
    vistos.add(codigo);
    salida.push({
      codigo,
      etiqueta: etiqueta.slice(0, 60),
      color: /^#[0-9a-f]{6}$/i.test(e?.color || "") ? e.color : "#475569",
      orden: Number.isFinite(Number(e?.orden)) ? Number(e.orden) : (i + 1) * 10,
      activo: e?.activo !== false,
      sistema: ESTADOS_SISTEMA.includes(codigo),
      requiere_motivo: codigo === "no_accesible" ? true : !!e?.requiere_motivo,
      genera_hallazgo: !!e?.genera_hallazgo,
    });
  });

  // Los del sistema vuelven solos si alguien los borro desde una llamada suelta.
  for (const base of ESTADOS_PUNTO_DEFECTO) {
    if (base.sistema && !vistos.has(base.codigo)) salida.push({ ...base });
  }

  return salida.sort((a, b) => a.orden - b.orden);
}

// Lo usan inspecciones.js (para validar lo que manda la app) y reportes.js
// (para que el PDF imprima la etiqueta nueva y no el codigo pelado).
export async function leerEstadosPunto() {
  try {
    const { data } = await supabase
      .from("asa_config_sistema")
      .select("valor")
      .eq("clave", "estados_punto")
      .maybeSingle();
    const lista = normalizarEstadosPunto(data?.valor);
    return lista.length ? lista : ESTADOS_PUNTO_DEFECTO;
  } catch {
    return ESTADOS_PUNTO_DEFECTO;
  }
}

// Valores por defecto: si la fila no existe todavia, el panel igual dibuja algo
// en vez de una pantalla vacia que parece un error.
const POR_DEFECTO = {
  estados_punto: ESTADOS_PUNTO_DEFECTO,
  empresa: {
    nombre: "Ambiente y Salud RD",
    razon_social: "Ambiente y Salud RD, SRL",
    siglas: "ASA SRL",
    rnc: "",
    telefono: "",
    telefono_alterno: "",
    email: "",
    web: "",
    direccion: "",
    licencia_sanitaria: "",
    registro_mip: "",
    responsable_tecnico: "",
    logo_url: "",
    pie_reportes: "Documento generado por el sistema de gestion de Ambiente y Salud RD.",
  },
  permisos: {},
};

// Los modulos y los niveles que entiende el panel. Se exponen para que la
// pantalla de permisos se dibuje sola y no haya que mantener dos listas.
export const MODULOS_PERMISOS = [
  ["dashboard", "Dashboard"],
  ["clientes", "Clientes"],
  ["plantas", "Plantas"],
  ["puntos", "Puntos de control"],
  ["estrategias", "Estrategias"],
  ["tipos_punto", "Tipos de punto"],
  ["reportes", "Reportes"],
  ["accesos_hotel", "Accesos del hotel"],
  ["usuarios", "Usuarios"],
  ["auditoria", "Auditoria"],
  ["configuracion", "Configuracion"],
  ["flota", "Flota y transportacion"],
];

export const NIVELES_PERMISO = [
  ["ninguno", "Sin acceso"],
  ["ver", "Solo ver"],
  ["operar", "Ver y registrar"],
  ["todo", "Todo (crear, editar, borrar)"],
];

// GET /config — todas las claves de configuracion de una vez
router.get("/", async (req, res) => {
  const { data, error } = await supabase.from("asa_config_sistema").select("clave, valor, updated_at");
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const salida = { ...POR_DEFECTO };
  for (const fila of data || []) {
    salida[fila.clave] =
      fila.valor && typeof fila.valor === "object" && !Array.isArray(fila.valor) && POR_DEFECTO[fila.clave]
        ? { ...POR_DEFECTO[fila.clave], ...fila.valor }
        : fila.valor;
  }
  res.json({ ...salida, _catalogos: { modulos: MODULOS_PERMISOS, niveles: NIVELES_PERMISO } });
});

// GET /config/:clave
router.get("/:clave", async (req, res) => {
  const { data, error } = await supabase
    .from("asa_config_sistema")
    .select("valor, updated_at")
    .eq("clave", req.params.clave)
    .maybeSingle();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  const base = POR_DEFECTO[req.params.clave];
  if (!data) return res.json(base ?? null);
  res.json(base && typeof data.valor === "object" && !Array.isArray(data.valor) ? { ...base, ...data.valor } : data.valor);
});

// PUT /config/:clave — reemplaza el valor completo de esa clave
router.put("/:clave", requireRol("admin"), async (req, res) => {
  let valor = req.body?.valor !== undefined ? req.body.valor : req.body;
  if (valor === undefined || valor === null) {
    return res.status(400).json({ error: true, mensaje: "Falta el valor a guardar" });
  }

  // Los estados del punto pasan por el normalizador antes de guardarse: es lo
  // que evita dos estados con el mismo codigo, un estado sin nombre o que se
  // pierda "no pude entrar", que es de donde sale el reporte de no realizados.
  if (req.params.clave === "estados_punto") {
    valor = normalizarEstadosPunto(valor);
    if (!valor.length) {
      return res.status(400).json({ error: true, mensaje: "Deja al menos un estado del punto" });
    }
  }

  const { data, error } = await supabase
    .from("asa_config_sistema")
    .upsert([{ clave: req.params.clave, valor, updated_at: new Date().toISOString() }], { onConflict: "clave" })
    .select()
    .single();
  if (error) return res.status(500).json({ error: true, mensaje: error.message });

  logAccion(req, {
    accion: "actualizar",
    modulo: "configuracion",
    descripcion: `Configuracion "${req.params.clave}" guardada`,
    // Se guarda el valor nuevo en la bitacora: si alguien deja a un rol sin
    // acceso a algo, se puede ver quien y cuando, y volver atras.
    detalle: { clave: req.params.clave, valor },
  });
  res.json(data);
});

export default router;
