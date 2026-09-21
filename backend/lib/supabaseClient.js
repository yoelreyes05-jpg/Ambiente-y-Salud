// lib/supabaseClient.js
// Fuente unica del cliente Supabase para evitar dependencias circulares
// entre server.mjs y los routers/servicios. Importar SIEMPRE desde aqui.
//
// IMPORTANTE: en ESM, los "import" de un archivo se evaluan ANTES que el
// codigo propio de quien lo importa. Eso significa que si server.mjs hace
// `import dotenv from "dotenv"; dotenv.config();` y luego
// `import { supabase } from "./lib/supabaseClient.js"`, este archivo se
// evalua (y llama a createClient) ANTES de que dotenv.config() se ejecute,
// dejando process.env.SUPABASE_URL vacio ("supabaseUrl is required").
// Por eso este archivo carga el .env por su cuenta, con el import de efecto
// secundario "dotenv/config", garantizando el orden correcto sin depender
// de lo que haga quien lo importe.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  throw new Error(
    "Faltan SUPABASE_URL y/o SUPABASE_KEY. Verifica que exista un archivo .env " +
      "(copiado desde .env.example) en la carpeta backend/ con esos valores completados."
  );
}

// Los valores de .env.example son placeholders válidos como texto, así que
// createClient() los acepta sin quejarse y el servidor arranca "bien" — pero
// después TODAS las consultas fallan sin una causa evidente. Mejor detenerse
// aquí con un mensaje que diga exactamente qué falta.
const PLACEHOLDERS = [
  "https://xxxxxxxx.supabase.co",
  "coloca-aqui-la-service-role-key",
  "cambia-esto-por-un-secreto-largo-y-aleatorio",
];
const sinConfigurar = [
  ["SUPABASE_URL", process.env.SUPABASE_URL],
  ["SUPABASE_KEY", process.env.SUPABASE_KEY],
].filter(([, v]) => PLACEHOLDERS.includes(v) || /^x+$/i.test(v) || v.includes("xxxxxxxx"));

const DONDE_ENCONTRARLAS =
  "Dónde encontrarlas: Supabase → tu proyecto → Settings → API Keys\n" +
  "    SUPABASE_URL = Project URL (pestaña 'API' o el diálogo 'Connect')\n" +
  "    SUPABASE_KEY = clave de servidor. Dos formatos válidos:\n" +
  "       · sb_secret_...  → pestaña 'API Keys' (recomendada; las legacy se\n" +
  "                          retiran a finales de 2026)\n" +
  "       · eyJ... service_role → pestaña 'Legacy API Keys'\n" +
  "    NUNCA uses la anon / publishable: es de navegador y RLS te devolverá\n" +
  "    todo vacío sin dar error.";

if (sinConfigurar.length) {
  throw new Error(
    `backend/.env todavía tiene los valores de ejemplo en: ${sinConfigurar
      .map(([k]) => k)
      .join(", ")}.\n` +
      "Ábrelo y reemplázalos por los reales de tu proyecto Supabase.\n" +
      DONDE_ENCONTRARLAS +
      "\nLuego vuelve a arrancar con: npm start"
  );
}

if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(process.env.SUPABASE_URL.trim())) {
  console.warn(
    `[ASA] Aviso: SUPABASE_URL ("${process.env.SUPABASE_URL}") no tiene la forma ` +
      "https://xxxx.supabase.co — revísala si las consultas fallan."
  );
}

// ── Verificar que la clave sea de servidor, no de navegador ─────────────────
// Este es el error silencioso más caro: con la clave anon/publishable el
// backend arranca perfecto y las consultas no dan error — simplemente devuelven
// listas vacías, porque RLS las bloquea. Parece "base de datos sin datos".
const KEY = process.env.SUPABASE_KEY.trim();

function rolDeJwtLegacy(k) {
  try {
    const payload = JSON.parse(Buffer.from(k.split(".")[1], "base64").toString());
    return payload.role || null;
  } catch {
    return null;
  }
}

if (KEY.startsWith("sb_publishable_") || rolDeJwtLegacy(KEY) === "anon") {
  throw new Error(
    "SUPABASE_KEY es una clave de NAVEGADOR (anon / publishable), no de servidor.\n" +
      "Con ella el servidor arranca pero RLS bloquea todo y verás las tablas\n" +
      "vacías sin ningún mensaje de error.\n" +
      DONDE_ENCONTRARLAS
  );
}

if (!KEY.startsWith("sb_secret_") && rolDeJwtLegacy(KEY) !== "service_role") {
  console.warn(
    "[ASA] Aviso: SUPABASE_KEY no parece una clave de servidor conocida " +
      "(ni sb_secret_..., ni un JWT con role=service_role). Si las consultas " +
      "devuelven vacío, revisa que sea la correcta."
  );
}

export const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
