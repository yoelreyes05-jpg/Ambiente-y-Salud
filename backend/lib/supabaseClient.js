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

export const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
