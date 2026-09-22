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

// Valores por defecto: si la fila no existe todavia, el panel igual dibuja algo
// en vez de una pantalla vacia que parece un error.
const POR_DEFECTO = {
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
  const valor = req.body?.valor !== undefined ? req.body.valor : req.body;
  if (valor === undefined || valor === null) {
    return res.status(400).json({ error: true, mensaje: "Falta el valor a guardar" });
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
