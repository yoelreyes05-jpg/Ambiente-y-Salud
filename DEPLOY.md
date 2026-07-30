# Cómo publicar Ambiente y Salud RD (ASA SRL)

Mismo patrón que ya usa `crm-automotriz`: **backend en Railway** + **panel-web en Vercel**, ambos apuntando al **mismo proyecto Supabase** que ya compartes con tus otros CRM (las tablas `asa_*` están aisladas, ver `supabase/00_README.md`).

## 0. Requisito: el proyecto en un repositorio Git

Railway y Vercel despliegan desde un repositorio (GitHub, GitLab o Bitbucket). Si `ambiente-y-salud/` todavía no está en un repo, créalo y súbelo antes de continuar (`git init`, `git add .`, `git commit`, y súbelo a GitHub).

## 1. Supabase (base de datos) — una sola vez

1. Entra al proyecto Supabase que ya usas para el CRM automotriz (Dashboard → SQL Editor).
2. Corre, **en este orden**, cada archivo de `supabase/01_...sql` hasta `supabase/12_...sql`. Crean únicamente tablas con prefijo `asa_`; no tocan ni renombran nada de tus otros sistemas.
3. Confirma en el editor de tablas que aparecen las ~40 tablas `asa_*`.

## 2. Backend → Railway

1. En Railway: **New Project → Deploy from GitHub repo** → selecciona el repo de `ambiente-y-salud`.
2. Ya dejé dos configuraciones redundantes para que funcione sin importar cómo Railway detecte la raíz del proyecto:
   - `railway.json` + `nixpacks.toml` en la **raíz** del repo (hacen `cd backend && npm install` / `cd backend && node server.mjs`).
   - `backend/railway.json` (por si en el panel de Railway configuras manualmente **Root Directory = `backend`**).
   Si configuras el Root Directory a `backend/` en el panel de Railway, no hace falta tocar nada más.
3. Variables de entorno (Railway → Settings → Variables) — copia los valores reales de tu `.env` local:
   - `SUPABASE_URL`
   - `SUPABASE_KEY` (service role)
   - `JWT_SECRET`
   - `CORS_ORIGINS` → aquí debes poner los dominios que van a llamar a esta API en producción, separados por coma. Como mínimo: la URL que te dé Vercel para el panel-web y, si aplica, `https://ambienteysalud.online`. Ejemplo:
     `https://asa-panel.vercel.app,https://ambienteysalud.online`
   - `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN` (déjalos vacíos si aún no integras WhatsApp)
   - `ECF_PROVIDER_BASE_URL`, `ECF_PROVIDER_API_KEY` (déjalos vacíos mientras no haya proveedor de e-CF contratado — la facturación queda en modo simulado y avisa por consola, no se debe usar así en producción real)
   - `PORT` no hace falta, Railway la inyecta sola.
4. Deploy. Cuando termine, Railway te da una URL pública tipo `https://asa-backend-production.up.railway.app`. Pruébala abriendo `/` — debe devolver el mismo JSON de "sistema" que ya viste en local.

## 3. Panel-web → Vercel

`panel-web/` es una SPA estática (HTML/CSS/JS puro, sin build step), igual de simple que `solido-web/`.

1. Antes de subir: abre `panel-web/config.js` y reemplaza la URL de ejemplo por la URL real de Railway del paso anterior:
   ```js
   API_BASE: location.hostname === "localhost" ...
     ? "http://localhost:4000"
     : "https://asa-backend-production.up.railway.app",   // ← tu URL real de Railway
   ```
2. En Vercel: **Add New → Project** → importa el mismo repo.
3. Configuración del proyecto:
   - **Root Directory**: `panel-web`
   - **Framework Preset**: "Other" (no es Next.js, no hay build)
   - **Build Command**: (vacío / ninguno)
   - **Output Directory**: `.`
4. Deploy. Vercel te da una URL tipo `https://asa-panel.vercel.app`.
5. Vuelve a Railway y agrega esa URL exacta a `CORS_ORIGINS` (paso 2.3), si no el navegador bloqueará las peticiones por CORS.

## 4. Verificación final

- Abre la URL de Vercel del panel → debe mostrar la pantalla de login.
- Crea el primer usuario admin directamente en Supabase (tabla `asa_usuarios`, con `password_hash` generado con bcrypt) o vía `POST /usuarios` una vez tengas un token válido — hazlo desde local apuntando a Railway si hace falta.
- Inicia sesión en el panel y confirma que Clientes, Dashboard, etc. cargan datos reales desde Supabase a través de Railway.

## Notas de seguridad

- `SUPABASE_KEY` (service role) solo debe existir en el backend (Railway). Nunca la pongas en `panel-web/config.js` ni en ningún archivo que se sirva al navegador.
- `.env` real nunca se sube a Git (ver `.gitignore` en la raíz y en `backend/`).
- `app-cliente/` y `app-personal/` siguen siendo solo documentación (`README.md`) — cuando se construyan como apps reales, seguirán este mismo patrón: consumen la misma API de Railway.
