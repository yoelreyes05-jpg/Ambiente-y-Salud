# Subir a GitHub y publicar en la web — paso a paso

El repositorio local **ya está listo**: `git init` hecho, primer commit creado,
y verificado que `backend/.env` y `node_modules/` **no** se suben.

> Ejecuta todos los comandos desde una terminal abierta en la carpeta
> `ambiente-y-salud` (PowerShell o Git Bash en Windows).

---

## Antes de nada — probar en local

Si abres `panel-web/index.html` con doble clic, el panel apunta a
`http://localhost:4000`, así que **necesitas el backend corriendo** o verás un
error en cada módulo.

1. Completa `backend/.env` con tus valores reales de Supabase
   (Project Settings → API):
   - `SUPABASE_URL` = *Project URL*
   - `SUPABASE_KEY` = *service_role secret* — **no** la `anon` key
2. Arranca el backend y **deja esa terminal abierta**:

   ```bash
   cd backend
   npm start
   ```

   Debe imprimir `[ASA] Backend escuchando en puerto 4000`. Si en su lugar
   imprime que el `.env` tiene valores de ejemplo, vuelve al punto 1.
3. Comprueba <http://localhost:4000> en el navegador: debe devolver un JSON.
4. Recién ahí abre `panel-web/index.html`.

---

## Paso 0 — Limpieza obligatoria (30 segundos)

El primer commit se creó desde un entorno Linux que montaba tu carpeta de
Windows, y ese montaje dejó archivos temporales que no pudo borrar. Git se
negará a hacer nada hasta que los elimines. En PowerShell, dentro de
`ambiente-y-salud`:

```powershell
Remove-Item .git\index.lock, .git\HEAD.lock, .git\objects\maintenance.lock -ErrorAction SilentlyContinue
Get-ChildItem .git\objects -Recurse -Filter "tmp_obj_*" | Remove-Item -Force
git status
```

`git status` debe responder sin errores y mostrar 3 cambios pendientes
(`railway.json`, `SUBIR-A-GITHUB.md`, `panel-web/vercel.json`). Confírmalos:

```bash
git add -A
git commit -m "Preparar despliegue: vercel.json, healthcheck y guia"
```

---

## Paso 1 — Conectar tu repo de GitHub y subir

Reemplaza `TU-USUARIO` y `TU-REPO` por los tuyos:

```bash
git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
git branch -M main
git push -u origin main
```

Si GitHub te pide contraseña, **no uses la de tu cuenta**: usa un
*Personal Access Token* (GitHub → Settings → Developer settings → Personal
access tokens → Tokens (classic) → Generate new token, con permiso `repo`).

### Si el repo que creaste ya tiene un README

El push será rechazado porque tiene un commit que tu copia local no conoce:

```bash
git pull origin main --allow-unrelated-histories
git push -u origin main
```

### Antes de subir, confirma que no se filtra nada

```bash
git ls-files | Select-String "\.env$"     # PowerShell — no debe devolver nada
git ls-files | grep -E "\.env$"           # Git Bash  — no debe devolver nada
```

Solo debe aparecer `backend/.env.example` (plantilla sin valores reales).

---

## Paso 2 — Base de datos en Supabase

Si aún no lo hiciste: SQL Editor → pega **`supabase/00_INSTALL_COMPLETO.sql`**
completo → ejecutar. Luego **`supabase/99_VERIFICAR.sql`** debe decir
`INSTALACION COMPLETA` (42 tablas).

---

## Paso 3 — Backend en Railway

1. Railway → **New Project → Deploy from GitHub repo** → elige tu repo.
2. **Settings → Root Directory**: déjalo vacío. El `railway.json` y
   `nixpacks.toml` de la raíz ya hacen `cd backend`.
3. **Settings → Variables** — copia los valores reales desde tu
   `backend/.env` local:

   | Variable | Valor |
   |---|---|
   | `SUPABASE_URL` | tu URL de Supabase |
   | `SUPABASE_KEY` | la *service role key* |
   | `JWT_SECRET` | secreto largo y aleatorio |
   | `CORS_ORIGINS` | *(se completa en el paso 5)* |
   | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN` | vacíos si aún no integras WhatsApp |
   | `ECF_PROVIDER_BASE_URL`, `ECF_PROVIDER_API_KEY` | vacíos mientras no haya proveedor e-CF |

   `PORT` **no** la pongas: Railway la inyecta sola.

4. **Settings → Networking → Generate Domain**. Sin esto la API no tiene URL
   pública. Te dará algo como
   `https://asa-backend-production.up.railway.app`.
5. Abre esa URL en el navegador. Debe responder un JSON con
   `"sistema": "Ambiente y Salud RD (ASA SRL) - API"`. Si responde eso, el
   backend está vivo.

---

## Paso 4 — Panel web en Vercel

1. Edita **`panel-web/config.js`** y reemplaza el placeholder por tu URL real
   de Railway:

   ```js
   API_BASE: ES_LOCAL
     ? "http://localhost:4000"
     : "https://asa-backend-production.up.railway.app",   // ← tu URL de Railway
   ```

   Guarda y sube el cambio:

   ```bash
   git add panel-web/config.js
   git commit -m "Apuntar panel-web a la API de Railway"
   git push
   ```

2. Vercel → **Add New → Project** → importa el mismo repo.
3. Configuración:
   - **Root Directory**: `panel-web`
   - **Framework Preset**: `Other`
   - Build Command / Install Command: déjalos vacíos
     (el `panel-web/vercel.json` ya lo deja configurado)
4. Deploy. Te dará una URL tipo `https://asa-panel.vercel.app`.

---

## Paso 5 — Cerrar el círculo con CORS

Vuelve a Railway → Variables → `CORS_ORIGINS` y pon **la URL exacta de Vercel**
(sin barra final), separando por comas si son varias:

```
https://asa-panel.vercel.app,https://ambienteysalud.online
```

Railway redespliega solo. **Sin este paso el panel carga pero no trae datos**:
el navegador bloquea las peticiones y verás errores de CORS en la consola (F12).

---

## Paso 6 — Crear el primer usuario admin

Las tablas están vacías, así que todavía no puedes iniciar sesión. Genera un
hash bcrypt de tu contraseña:

```bash
cd backend
node -e "console.log(require('bcryptjs').hashSync('TU-PASSWORD-AQUI', 10))"
```

Copia el hash y en Supabase → SQL Editor:

```sql
insert into asa_usuarios (email, password_hash, nombre_completo, rol, activo)
values (
  'yoelreyes05@gmail.com',
  'PEGA-AQUI-EL-HASH',
  'Yoel Reyes',
  'admin',
  true
)
on conflict (email) do nothing;
```

Ahora entra a la URL de Vercel e inicia sesión.

---

## Verificación final

| Comprobación | Resultado esperado |
|---|---|
| `99_VERIFICAR.sql` en Supabase | `INSTALACION COMPLETA` |
| URL de Railway en el navegador | JSON con `"ok": true` |
| URL de Vercel | pantalla de login del panel |
| Login con el usuario admin | entra al dashboard |
| Pestaña Clientes | carga sin errores en consola (F12) |

---

## Si algo falla

| Síntoma | Causa casi siempre |
|---|---|
| Panel carga pero ninguna pestaña trae datos | `CORS_ORIGINS` no incluye la URL de Vercel, o la incluye con barra final |
| `Failed to fetch` en consola | `API_BASE` en `config.js` quedó con el placeholder, o Railway no tiene dominio generado |
| Railway: "Application failed to respond" | Falta `SUPABASE_URL` / `SUPABASE_KEY` en Variables |
| Login dice credenciales inválidas | No existe el usuario admin en `asa_usuarios` (paso 6) |
| `relation "asa_..." does not exist` | Falta correr `00_INSTALL_COMPLETO.sql` |

---

## Seguridad — no lo pierdas de vista

- `SUPABASE_KEY` (service role) **solo** vive en Railway. Nunca en
  `panel-web/config.js` ni en nada que llegue al navegador.
- `backend/.env` está en `.gitignore` y se confirmó que no entra al repo.
- Si alguna vez subiste una clave por error, **rotarla** en Supabase: borrarla
  del repo no basta, queda en el historial de Git.
