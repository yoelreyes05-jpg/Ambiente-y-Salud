// scripts/verificar-seguridad.mjs — Prueba de humo: ninguna ruta debe quedar abierta.
//
// Levanta el servidor con credenciales de mentira (no toca Supabase real) y
// comprueba que cada módulo exige token, que las rutas públicas siguen siendo
// públicas, y que una cuenta de hotel no puede escribir.
//
//   cd backend && node scripts/verificar-seguridad.mjs
//
// Córrelo cada vez que agregues un router nuevo.
process.env.SUPABASE_URL = "https://verificacionlocal.supabase.co";
process.env.SUPABASE_KEY = "sb_secret_verificacion_local_no_real";
process.env.JWT_SECRET   = "secreto-solo-para-esta-verificacion";
process.env.NODE_ENV     = "test";

const { app } = await import("../server.mjs");
const http = await import("node:http");
const jwt = (await import("jsonwebtoken")).default;

const PUERTO = 4111;
const srv = http.createServer(app).listen(PUERTO);
await new Promise((r) => srv.once("listening", r));

const pedir = async (metodo, ruta, token) => {
  const res = await fetch(`http://127.0.0.1:${PUERTO}${ruta}`, {
    method: metodo,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res.status;
};

const RUTAS = [
  "/clientes", "/sitios", "/puntos/tipos", "/inspecciones", "/estrategias",
  "/hallazgos", "/reportes/resumen", "/plagas/ordenes", "/ipm/estaciones",
  "/inventario/productos", "/notificaciones", "/facturacion",
  "/contabilidad/plan-cuentas", "/nomina/empleados", "/pos/ventas", "/citas",
  "/mascotas", "/veterinaria/tratamientos-catalogo", "/estetica/catalogo",
];

let fallas = 0;
const revisar = (ok, descripcion, detalle = "") => {
  console.log(`${ok ? "  OK  " : " FALLA"}  ${descripcion}${detalle ? ` — ${detalle}` : ""}`);
  if (!ok) fallas++;
};

console.log("\nRutas protegidas (sin token deben dar 401)");
for (const r of RUTAS) {
  const s = await pedir("GET", r);
  revisar(s === 401, r, s === 401 ? "" : `devolvió ${s}`);
}

console.log("\nRutas públicas");
revisar((await pedir("GET", "/")) === 200, "GET /");
revisar((await pedir("GET", "/salud")) === 200, "GET /salud");

console.log("\nCuenta de hotel (solo lectura)");
const tokenHotel = jwt.sign({ id: "u1", rol: "cliente_calidad", nombre: "Calidad" }, process.env.JWT_SECRET);
revisar((await pedir("POST", "/puntos", tokenHotel)) === 403, "no puede crear puntos");
revisar((await pedir("POST", "/inspecciones", tokenHotel)) === 403, "no puede registrar inspecciones");

console.log("\nToken inválido");
revisar((await pedir("GET", "/clientes", "token-falso")) === 401, "se rechaza");

srv.close();
console.log(fallas ? `\n${fallas} verificación(es) fallaron.\n` : "\nTodo correcto: no hay rutas abiertas.\n");
process.exit(fallas ? 1 : 0);
