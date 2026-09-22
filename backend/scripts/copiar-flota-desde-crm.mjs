// ══════════════════════════════════════════════════════════════════════════
// copiar-flota-desde-crm.mjs — Trae la flota del Supabase del CRM al de ASA
//
// Uso:
//   1. Corre primero supabase/26_flota_transportacion.sql en el proyecto de ASA.
//   2. Agrega al backend/.env las credenciales del proyecto DE ORIGEN:
//        CRM_SUPABASE_URL=https://xxxx.supabase.co
//        CRM_SUPABASE_KEY=<service key del proyecto del CRM>
//   3. node scripts/copiar-flota-desde-crm.mjs --simular    (no escribe nada)
//   4. node scripts/copiar-flota-desde-crm.mjs              (copia de verdad)
//
// Cómo está pensado:
//
// · **Los ids se remapean, no se conservan.** Las tablas usan BIGSERIAL, así
//   que insertar con el id del origen dejaría la secuencia del destino atrás y
//   el primer alta manual chocaría con un id repetido. Se inserta sin id y se
//   guarda la equivalencia viejo→nuevo para las llaves foráneas.
//
// · **El orden importa.** Conductores antes que vehículos, vehículos antes que
//   chequeos: una llave foránea a algo que todavía no existe falla.
//
// · **Es repetible.** Se reconcilia por la clave natural de cada tabla
//   (código del vehículo, cédula o nombre del conductor, vehículo+fecha+turno
//   del chequeo). Correrlo dos veces actualiza en vez de duplicar.
//
// · **Las fotos no se copian como archivos**, solo sus URLs: el bucket del CRM
//   es público y las imágenes siguen sirviéndose desde ahí. Bajar y volver a
//   subir miles de fotos por una migración que se hace una vez no compensa.
//   Si algún día se apaga ese proyecto, las URLs se caen — está anotado aquí a
//   propósito para que sea una decisión y no una sorpresa.
// ══════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { supabase as destino } from "../lib/supabaseClient.js";

const SIMULAR = process.argv.includes("--simular");

const URL_ORIGEN = process.env.CRM_SUPABASE_URL;
const KEY_ORIGEN = process.env.CRM_SUPABASE_KEY;

if (!URL_ORIGEN || !KEY_ORIGEN) {
  console.error(`
Faltan las credenciales del proyecto de origen (el Supabase del CRM).
Agrega al backend/.env:

  CRM_SUPABASE_URL=https://xxxxxxxx.supabase.co
  CRM_SUPABASE_KEY=<service key / sb_secret_... del proyecto del CRM>

Se sacan de: Supabase -> proyecto del CRM -> Settings -> API Keys.
Usa la clave de servidor, no la anon: con la anon, RLS devuelve todo vacio y
el script diria "0 filas" sin error.
`);
  process.exit(1);
}

const origen = createClient(URL_ORIGEN, KEY_ORIGEN);

// ── Utilidades ──────────────────────────────────────────────────────────────
const log = (...a) => console.log(...a);

async function traerTodo(tabla) {
  // De 1,000 en 1,000: PostgREST corta en 1,000 filas por defecto y nadie se
  // entera — el script diria "copiados 1,000 chequeos" con 8,000 en la base.
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await origen.from(tabla).select("*").range(desde, desde + 999).order("id");
    if (error) {
      if (/does not exist/i.test(error.message)) {
        log(`   · ${tabla}: no existe en el origen, se salta`);
        return [];
      }
      throw new Error(`${tabla}: ${error.message}`);
    }
    filas.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return filas;
}

// Inserta (o actualiza) una fila y devuelve su id en el destino.
async function guardar(tabla, fila, claveNatural) {
  const { id: _viejo, created_at: _c, updated_at: _u, ...datos } = fila;

  const filtro = Object.fromEntries(claveNatural.map((k) => [k, datos[k]]));
  let q = destino.from(tabla).select("id");
  for (const [k, v] of Object.entries(filtro)) q = v === null || v === undefined ? q.is(k, null) : q.eq(k, v);
  const { data: ya } = await q.maybeSingle();

  if (SIMULAR) return ya?.id ?? `nuevo:${JSON.stringify(filtro)}`;

  if (ya) {
    const { error } = await destino.from(tabla).update(datos).eq("id", ya.id);
    if (error) throw new Error(`${tabla} (actualizar): ${error.message}`);
    return ya.id;
  }
  const { data, error } = await destino.from(tabla).insert([datos]).select("id").single();
  if (error) throw new Error(`${tabla} (insertar): ${error.message}`);
  return data.id;
}

// ── Copia ───────────────────────────────────────────────────────────────────
async function copiar() {
  log(SIMULAR ? "\n== SIMULACION: no se escribe nada ==\n" : "\n== COPIANDO LA FLOTA ==\n");

  const resumen = {};
  const mapa = { conductores: new Map(), vehiculos: new Map(), chequeos: new Map() };

  // 1. Catálogos: se reconcilian por su código, que es único en las dos bases.
  for (const tabla of ["asa_flota_checklist_items", "asa_flota_fallas_catalogo"]) {
    const filas = await traerTodo(tabla);
    for (const f of filas) await guardar(tabla, f, ["codigo"]);
    resumen[tabla] = filas.length;
    log(`   ${tabla}: ${filas.length}`);
  }

  // 2. Conductores. Clave natural: la cédula si la tienen, si no el nombre.
  const conductores = await traerTodo("asa_flota_conductores");
  for (const c of conductores) {
    const clave = c.cedula ? ["cedula"] : ["nombre"];
    mapa.conductores.set(c.id, await guardar("asa_flota_conductores", c, clave));
  }
  resumen.conductores = conductores.length;
  log(`   conductores: ${conductores.length}`);

  // 3. Vehículos. El código (ASA-01) es único.
  const vehiculos = await traerTodo("asa_flota_vehiculos");
  for (const v of vehiculos) {
    const fila = { ...v, conductor_id: mapa.conductores.get(v.conductor_id) ?? null };
    mapa.vehiculos.set(v.id, await guardar("asa_flota_vehiculos", fila, ["codigo"]));
  }
  resumen.vehiculos = vehiculos.length;
  log(`   vehiculos: ${vehiculos.length}`);

  // 4. Asignaciones, documentos y mantenimientos: cuelgan del vehículo.
  const conVehiculo = [
    ["asa_flota_asignaciones", ["vehiculo_id", "conductor_id", "desde"]],
    ["asa_flota_documentos", ["vehiculo_id", "tipo", "vence"]],
    ["asa_flota_mantenimientos", ["vehiculo_id", "tipo"]],
  ];
  for (const [tabla, clave] of conVehiculo) {
    const filas = await traerTodo(tabla);
    let n = 0;
    for (const f of filas) {
      const vehiculo_id = mapa.vehiculos.get(f.vehiculo_id);
      if (!vehiculo_id) continue;   // vehículo borrado en el origen: su historial no tiene dónde colgar
      await guardar(tabla, {
        ...f,
        vehiculo_id,
        ...(f.conductor_id !== undefined ? { conductor_id: mapa.conductores.get(f.conductor_id) ?? null } : {}),
      }, clave);
      n++;
    }
    resumen[tabla] = n;
    log(`   ${tabla}: ${n}`);
  }

  // 5. Chequeos. Clave natural: vehículo + fecha + turno (el índice único que
  //    ya existe en la tabla).
  const chequeos = await traerTodo("asa_flota_chequeos");
  let nChequeos = 0;
  for (const c of chequeos) {
    const vehiculo_id = mapa.vehiculos.get(c.vehiculo_id);
    if (!vehiculo_id) continue;
    const nuevo = await guardar("asa_flota_chequeos", {
      ...c,
      vehiculo_id,
      conductor_id: mapa.conductores.get(c.conductor_id) ?? null,
    }, ["vehiculo_id", "fecha", "turno"]);
    mapa.chequeos.set(c.id, nuevo);
    nChequeos++;
  }
  resumen.chequeos = nChequeos;
  log(`   chequeos: ${nChequeos}`);

  // 6. Lo que cuelga del chequeo
  const delChequeo = [
    ["asa_flota_chequeo_items", ["chequeo_id", "item_codigo"]],
    ["asa_flota_fotos", ["vehiculo_id", "fecha", "angulo", "url"]],
  ];
  for (const [tabla, clave] of delChequeo) {
    const filas = await traerTodo(tabla);
    let n = 0;
    for (const f of filas) {
      const vehiculo_id = mapa.vehiculos.get(f.vehiculo_id);
      if (!vehiculo_id) continue;
      await guardar(tabla, {
        ...f,
        vehiculo_id,
        ...(f.chequeo_id !== undefined ? { chequeo_id: mapa.chequeos.get(f.chequeo_id) ?? null } : {}),
        ...(f.conductor_id !== undefined ? { conductor_id: mapa.conductores.get(f.conductor_id) ?? null } : {}),
      }, clave);
      n++;
    }
    resumen[tabla] = n;
    log(`   ${tabla}: ${n}`);
  }

  // 7. Fallas reportadas y gastos
  const fallas = await traerTodo("asa_flota_fallas_reportadas");
  let nFallas = 0;
  for (const f of fallas) {
    const vehiculo_id = mapa.vehiculos.get(f.vehiculo_id);
    if (!vehiculo_id) continue;
    await guardar("asa_flota_fallas_reportadas", {
      ...f,
      vehiculo_id,
      chequeo_id: mapa.chequeos.get(f.chequeo_id) ?? null,
      conductor_id: mapa.conductores.get(f.conductor_id) ?? null,
    }, ["vehiculo_id", "falla_codigo", "primera_vez"]);
    nFallas++;
  }
  resumen.fallas = nFallas;
  log(`   fallas reportadas: ${nFallas}`);

  const gastos = await traerTodo("asa_flota_gastos");
  let nGastos = 0;
  for (const g of gastos) {
    const vehiculo_id = mapa.vehiculos.get(g.vehiculo_id);
    if (!vehiculo_id) continue;
    await guardar("asa_flota_gastos", {
      ...g,
      vehiculo_id,
      conductor_id: mapa.conductores.get(g.conductor_id) ?? null,
    }, ["vehiculo_id", "fecha", "tipo", "monto"]);
    nGastos++;
  }
  resumen.gastos = nGastos;
  log(`   gastos: ${nGastos}`);

  // 8. Configuración del módulo
  const { data: cfg } = await origen.from("config_sistema").select("valor").eq("clave", "asa_flota_config").maybeSingle();
  if (cfg && !SIMULAR) {
    await destino.from("asa_config_sistema").upsert([{ clave: "asa_flota_config", valor: cfg.valor }], { onConflict: "clave" });
    log("   configuracion del modulo: copiada");
  }

  log(`\n${SIMULAR ? "Simulacion terminada" : "Copia terminada"}.`);
  if (SIMULAR) log("Vuelve a correrlo sin --simular para escribir de verdad.\n");
  else log("Las fotos siguen sirviendose desde el bucket del CRM (solo se copiaron las URLs).\n");

  return resumen;
}

copiar().catch((e) => {
  console.error("\nFALLO:", e.message, "\n");
  process.exit(1);
});
