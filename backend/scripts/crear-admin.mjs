// scripts/crear-admin.mjs — Crea el primer usuario administrador.
//
// Hace falta una sola vez: sin él no puedes entrar al panel, y sin entrar al
// panel no puedes crear usuarios. Este script rompe ese círculo.
//
// Uso (desde la carpeta backend/, con el .env ya configurado):
//
//   node scripts/crear-admin.mjs correo@ambienteysaludrd.com "Tu Nombre" "TuClaveSegura"
//
// Si el correo ya existe, le cambia la contraseña en vez de fallar.
import bcrypt from "bcryptjs";
import { supabase } from "../lib/supabaseClient.js";

const [email, nombre, password] = process.argv.slice(2);

if (!email || !nombre || !password) {
  console.error(`
Faltan datos.

  node scripts/crear-admin.mjs <email> "<nombre completo>" "<contraseña>"

Ejemplo:
  node scripts/crear-admin.mjs admin@ambienteysaludrd.com "Yoel Reyes" "ClaveLarga2026"
`);
  process.exit(1);
}

if (password.length < 8) {
  console.error("La contraseña debe tener al menos 8 caracteres.");
  process.exit(1);
}

const password_hash = await bcrypt.hash(password, 10);

const { data: existente } = await supabase
  .from("asa_usuarios")
  .select("id, rol")
  .eq("email", email)
  .maybeSingle();

if (existente) {
  const { error } = await supabase
    .from("asa_usuarios")
    .update({ password_hash, rol: "admin", activo: true, nombre_completo: nombre })
    .eq("id", existente.id);
  if (error) {
    console.error("No se pudo actualizar:", error.message);
    process.exit(1);
  }
  console.log(`Listo. El usuario ${email} ya existía — se actualizó su contraseña y quedó como admin.`);
} else {
  const { error } = await supabase
    .from("asa_usuarios")
    .insert([{ email, password_hash, nombre_completo: nombre, rol: "admin", activo: true }]);
  if (error) {
    console.error("No se pudo crear:", error.message);
    process.exit(1);
  }
  console.log(`Listo. Administrador creado: ${email}`);
}

console.log("Ya puedes iniciar sesión en el panel con ese correo y contraseña.");
process.exit(0);
