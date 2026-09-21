# Despliegue ASA — Supabase nuevo + Railway + Vercel

Guía de cero, para el proyecto Supabase **dedicado** (ya no compartido con los
otros CRM) y el repositorio nuevo.

Orden obligatorio: **Supabase → Railway → Vercel → CORS → dominio**. Cada paso
necesita un dato del anterior.

---

## Paso 1 — Crear el proyecto de Supabase

1. <https://supabase.com/dashboard> → **New project**.
   - **Name**: `ambiente-y-salud`
   - **Database Password**: genérala y **guárdala en tu gestor de
     contraseñas**. Supabase no la vuelve a mostrar y la necesitas si algún
     día conectas por `psql` o migras datos.
   - **Region**: `East US (North Virginia)` — es la más cercana a RD y a donde
     corren Railway y Vercel por defecto. Menos latencia por consulta.
2. Espera a que termine de aprovisionar (1–2 min).

## Paso 2 — Cargar el esquema

1. **SQL Editor** → **New query**.
2. Pega completo el contenido de `supabase/00_INSTALL_COMPLETO.sql` → **Run**.
3. Nueva query → pega `supabase/99_VERIFICAR.sql` → **Run**.
   Debe responder `INSTALACION COMPLETA` (42 tablas).

> Si el proyecto es dedicado, el prefijo `asa_` ya no hace falta técnicamente,
> pero quitarlo obliga a reescribir las consultas de los ~20 archivos de
> `backend/routes/`. Déjalo como está.

## Paso 3 — Los 4 datos que necesito (o que necesitas para el `.env`)

Todos salen de **Project Settings → API**:

| Qué buscar en Supabase | Va en la variable | Cómo se ve |
|---|---|---|
| **Project URL** | `SUPABASE_URL` | `https://abcdefghijkl.supabase.co` |
| **API Keys → `sb_secret_...`** (o, en *Legacy API Keys*, la `service_role`) | `SUPABASE_KEY` | `sb_secret_...` o `eyJhbGciOi...` (largo) |
| — (la generas tú) | `JWT_SECRET` | cadena aleatoria de 40+ caracteres |
| — (lo defines tú) | `CORS_ORIGINS` | se completa en el Paso 6 |

**Cuidado con cuál copias.** La `anon` / `publishable` **no sirve**: con RLS
activo devuelve todo vacío sin dar error, y vas a perder una tarde buscando un
bug que no existe. Tiene que ser una clave de servidor (`sb_secret_` o
`service_role`).

### `backend/.env` local — plantilla lista

```env
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_KEY=sb_secret_PEGA-AQUI-LA-CLAVE-DE-SERVIDOR
JWT_SECRET=qLCXWaA0lD2OFKaWyiNWS-wOhCvLDaKmyPwBdLgzlxfNpWxy8uXnGmENb8KDurW2
CORS_ORIGINS=http://localhost:3000,http://localhost:4000,http://localhost:5500
WHATSAPP_TOKEN=
WHATSAPP_PHONE_ID=
WHATSAPP_VERIFY_TOKEN=
ECF_PROVIDER_BASE_URL=
ECF_PROVIDER_API_KEY=
PORT=4000
```

El `JWT_SECRET` de arriba es aleatorio y sirve; si prefieres otro:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### Sobre pasarme la clave por el chat

La `service_role` da **control total** de la base de datos, saltándose RLS. Si
me la pasas para que yo cargue datos o corra migraciones, trátala como
quemada: al terminar, **Supabase → Project Settings → API Keys → rotar**.

Alternativa sin exponerla: corres tú el SQL en el editor de Supabase (es
copiar y pegar un archivo) y me pasas solo la `SUPABASE_URL`, que no es
secreta.

---

## Paso 4 — Backend en Railway

1. <https://railway.app> → **New Project → Deploy from GitHub repo** → elige
   el repo nuevo. Si no lo ves, **Configure GitHub App** y dale acceso.
2. **Settings → Root Directory**: déjalo **vacío**. El `railway.json` y el
   `nixpacks.toml` de la raíz ya hacen `cd backend`.
3. **Variables** → **Raw Editor** → pega el bloque `.env` de arriba completo,
   **pero sin la línea `PORT`** (Railway la inyecta sola; si la pones, la app
   escucha en el puerto equivocado y el health check falla).
4. **Settings → Networking → Generate Domain**. Sin esto la API no tiene URL
   pública. Te da algo como `https://asa-backend-production.up.railway.app`.
5. Abre esa URL en el navegador. Debe devolver un JSON con
   `"sistema": "Ambiente y Salud RD (ASA SRL) - API"`. Si responde eso, vivo.

**Copia esa URL, la necesitas en el paso siguiente.**

## Paso 5 — Panel web en Vercel

`panel-web/` es HTML/CSS/JS puro, sin build.

1. Primero, en tu PC, edita `panel-web/config.js` y sustituye el placeholder
   por la URL real de Railway:

   ```js
   API_BASE: ES_LOCAL
     ? "http://localhost:4000"
     : "https://asa-backend-production.up.railway.app",
   ```

   Haz lo mismo en `app-tecnico/config.js` (tiene el mismo placeholder), y
   sube los dos cambios:

   ```powershell
   git add panel-web/config.js app-tecnico/config.js
   git commit -m "Apuntar frontends a la API de Railway"
   git push
   ```

2. <https://vercel.com> → **Add New → Project** → importa el repo.
3. Configuración:
   - **Root Directory**: `panel-web`
   - **Framework Preset**: `Other`
   - **Build Command** / **Install Command**: vacíos
   - **Output Directory**: `.`
4. **Deploy** → te da `https://algo.vercel.app`.

### La app del técnico es un segundo proyecto en Vercel

`app-tecnico/` es una PWA instalable aparte. Repite el paso 3 con
**Root Directory: `app-tecnico`**. Mismo repo, otro proyecto, otra URL.

> Una PWA **solo se instala en el teléfono si se sirve por HTTPS**. Vercel da
> HTTPS automático, así que recién aquí el técnico podrá instalarla.

## Paso 6 — Cerrar el círculo con CORS

Railway → **Variables** → `CORS_ORIGINS`, con las URLs **exactas**, separadas
por coma y **sin barra final**:

```
https://asa-panel.vercel.app,https://asa-tecnico.vercel.app,https://ambienteysalud.org
```

Railway redespliega solo (~1 min).

**Este paso no es opcional.** Sin él el panel carga pero ninguna pestaña trae
datos: el navegador bloquea las peticiones y solo lo ves en la consola (F12).

## Paso 7 — Primer usuario admin

Las tablas están vacías, todavía no puedes entrar. Genera el hash:

```powershell
cd backend
node -e "console.log(require('bcryptjs').hashSync('TU-PASSWORD', 10))"
```

Supabase → SQL Editor:

```sql
insert into asa_usuarios (email, password_hash, nombre_completo, rol, activo)
values ('yoelreyes05@gmail.com', 'PEGA-AQUI-EL-HASH', 'Yoel Reyes', 'admin', true)
on conflict (email) do nothing;
```

---

## Paso 8 — El dominio `.org`

1. Regístralo en Cloudflare, Namecheap o Porkbun (~US$12–15/año). Cloudflare
   lo vende a precio de costo y no sube al renovar.
2. Vercel → proyecto del panel → **Settings → Domains → Add** → escribe tu
   dominio. Vercel te dice exactamente qué registros crear.
3. En el registrador, crea lo que te pidió Vercel. El reparto normal:

   | Subdominio | Apunta a | Para |
   |---|---|---|
   | `ambienteysalud.org` y `www` | Vercel | sitio / panel |
   | `app.ambienteysalud.org` | Vercel (proyecto app-tecnico) | PWA del técnico |
   | `api.ambienteysalud.org` | Railway (*Custom Domain*, registro CNAME) | backend |

4. Si usas `api.` propio, cambia `API_BASE` en los dos `config.js` a
   `https://api.ambienteysalud.org` y vuelve a hacer push.
5. Agrega los dominios nuevos a `CORS_ORIGINS` en Railway (paso 6).

El DNS tarda entre minutos y unas horas en propagar. El certificado HTTPS lo
emiten Vercel y Railway solos una vez que ven los registros.

---

## Verificación final

| Comprobación | Esperado |
|---|---|
| `99_VERIFICAR.sql` | `INSTALACION COMPLETA` |
| URL de Railway en el navegador | JSON con `"ok": true` |
| URL de Vercel | pantalla de login |
| Login con el admin | entra al dashboard |
| Pestaña Clientes | carga sin errores en consola (F12) |

## Si algo falla

| Síntoma | Causa casi siempre |
|---|---|
| Panel carga, ninguna pestaña trae datos | `CORS_ORIGINS` sin la URL de Vercel, o con barra final |
| `Failed to fetch` en consola | `config.js` quedó con el placeholder, o Railway sin dominio generado |
| Railway: "Application failed to respond" | Falta `SUPABASE_URL` / `SUPABASE_KEY`, o pusiste `PORT` a mano |
| Todo responde pero las tablas vienen vacías | Copiaste la `anon` key en vez de la de servidor |
| `relation "asa_..." does not exist` | Falta correr `00_INSTALL_COMPLETO.sql` |
| Login dice credenciales inválidas | No existe el usuario en `asa_usuarios` (paso 7) |

## Seguridad

- La clave de servidor vive **solo** en Railway. Nunca en `config.js` ni en
  nada que llegue al navegador.
- `backend/.env` está en `.gitignore`. Confírmalo antes de cada push:
  `git ls-files | Select-String "\.env$"` — solo debe salir `.env.example`.
- Si subiste una clave por error, **rótala**. Borrarla del repo no basta:
  queda en el historial de Git.
