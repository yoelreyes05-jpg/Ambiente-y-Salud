# Seguridad, accesos con correo y respaldos — Ambiente y Salud RD

Tres cosas, en este orden:

1. **Políticas de la base (RLS)** — `supabase/41_seguridad_y_accesos.sql`
2. **Entrar con Google, Microsoft/Hotmail o un código por correo** — panel, portal del hotel y app del técnico
3. **Respaldo diario** que se descarga a la laptop, y cómo restaurarlo

---

## 1. Políticas de la base (RLS)

Pega `supabase/41_seguridad_y_accesos.sql` en el SQL Editor de Supabase y córrelo. Hace:

- Activa RLS en **todas** las tablas y quita el permiso a la clave pública (`anon`) y a `authenticated` sobre tablas, vistas y funciones. Lo que se cree después nace cerrado igual.
- El sistema sigue igual: el backend usa la **service key**, que salta RLS.
- Crea `asa_usuario_personas` (personas autorizadas en cada cuenta de hotel).

Al final muestra `tablas_sin_rls`: tiene que ser **0**.

> Si alguna otra aplicación usara esta misma base de Supabase con la clave pública, dejaría de leer datos. Las apps de ASA no: todas pasan por el backend.

---

## 2. Entrar con el correo personal

### Cómo queda

| App | Cómo se entra |
|---|---|
| Panel administrativo (`/admin`) | Correo + clave, **o** Google / Microsoft / código por correo |
| App del técnico (`/tecnico`) | Correo + clave, **o** Google / Microsoft / código por correo |
| Portal del hotel (`/hotel`) | Correo + clave **de la cuenta del hotel**, y después **la persona confirma con su propio correo** |

Para Google / Microsoft / código, el correo de la persona tiene que ser el mismo que tiene su usuario en el sistema (Usuarios del panel).

**Cuentas de hotel con varias personas.** La cuenta es compartida (por ejemplo `iberostar@ambienteysaludrd.com` con su clave). En el panel → **Accesos del hotel** → abre la cuenta → **Personas que usan esta cuenta** → agrega a cada gerente de calidad con su nombre y su correo personal (Gmail, Hotmail, Outlook o el de la empresa).

- Al entrar: correo y clave del hotel → *Paso 2: ¿quién eres?* → entra con **su** correo.
- Si su correo no está en la lista, **no entra aunque sepa la clave**.
- **Quitar acceso** (cuando renuncia): la saca al momento, incluso si tenía la sesión abierta (a más tardar en 30 segundos).
- En la bitácora de auditoría queda el nombre de la persona en cada cosa que hace, y cada intento rechazado.
- Si la lista está vacía, la cuenta funciona como antes (basta la clave).

**Solo correo personal para el personal de ASA (opcional).** Cuando todos hayan entrado una vez con Google/Microsoft, puedes obligarlo para todo el personal menos admin (admin siempre puede con la clave, para no quedarse afuera):

```sql
update asa_config_sistema set valor = '{"solo_correo_personal": true}' where clave = 'acceso';
```

### Configuración (una sola vez)

Supabase hace el inicio de sesión con Google, Microsoft y el código. Hay que darle las llaves de Google y Microsoft.

En todo lo de abajo, **`TU-PROYECTO`** es el identificador de tu proyecto de Supabase (sale en la dirección `https://TU-PROYECTO.supabase.co`) y **`TU-DOMINIO`** es el dominio de Vercel donde abres `/admin`, `/hotel` y `/tecnico`.

**A. Supabase → Authentication → URL Configuration**
- *Site URL*: `https://TU-DOMINIO`
- *Redirect URLs*: agrega `https://TU-DOMINIO/**`

**B. Google** (para cuentas Gmail)
1. https://console.cloud.google.com → crea un proyecto "ASA Acceso".
2. *APIs y servicios → Pantalla de consentimiento de OAuth*: tipo **Externo**, nombre "Ambiente y Salud RD", tu correo. Publícala (*Publicar app*).
3. *Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web*.
   - *URI de redireccionamiento autorizados*: `https://TU-PROYECTO.supabase.co/auth/v1/callback`
4. Copia el *ID de cliente* y el *Secreto*.
5. Supabase → *Authentication → Sign In / Providers → Google* → actívalo y pega los dos.

**C. Microsoft** (Hotmail, Outlook, Live y correos de empresa con Office 365)
1. https://portal.azure.com → *Microsoft Entra ID → Registros de aplicaciones → Nuevo registro*.
   - Tipos de cuenta: **Cuentas de cualquier directorio organizativo y cuentas Microsoft personales**.
   - URI de redirección (Web): `https://TU-PROYECTO.supabase.co/auth/v1/callback`
2. *Certificados y secretos → Nuevo secreto de cliente* → copia el **Valor** (no el Id).
3. Copia el *Id. de aplicación (cliente)* de la página de Información general.
4. Supabase → *Providers → Azure* → actívalo, pega el Id y el secreto, y en *Azure Tenant URL* pon `https://login.microsoftonline.com/common`.

**D. Código por correo** (para quien no use Google ni Microsoft)
- Viene activo en Supabase (*Providers → Email*).
- *Authentication → Emails → Magic Link*: agrega el código a la plantilla, por ejemplo: `Tu código para entrar es: {{ .Token }}`.
- El servicio de correo gratis de Supabase manda pocos correos por hora. Para uso diario configura tu propio SMTP en *Authentication → Emails → SMTP Settings* (por ejemplo el correo de ambienteysaludrd.com).

**E. Railway → backend → Variables**
- `SUPABASE_ANON_KEY` = la *anon / publishable key* de Supabase (*Project Settings → API Keys*). Es pública por diseño; con el paso 1 no da acceso a ninguna tabla.
- (Opcional) `ACCESO_PROVEEDORES` = `google,azure,email` — quita el que no quieras mostrar.

Sin `SUPABASE_ANON_KEY` los botones no salen y todo sigue con correo y clave.

---

## 3. Respaldo diario

### Cómo funciona

`.github/workflows/respaldo-diario.yml` corre **todos los días a las 3:15 a.m.** en GitHub:
- Saca una copia completa de la base (todas las tablas y sus datos).
- La guarda en un `.7z` **cifrado con tu clave**. Sin la clave no se puede abrir.
- GitHub la guarda **30 días**. Puedes sacar uno en cualquier momento con *Run workflow*.

Las fotos y documentos (Storage de Supabase) no van en el respaldo: van sus enlaces.

### Configurarlo (una sola vez)

En GitHub → el repositorio → *Settings → Secrets and variables → Actions → New repository secret*:

| Nombre | Valor |
|---|---|
| `SUPABASE_DB_URL` | Supabase → botón **Connect** → **Session pooler** → copia la cadena (empieza con `postgresql://postgres.`…) y cambia `[YOUR-PASSWORD]` por la contraseña de la base. Usa la de *Session pooler*, no la *Direct*: GitHub no llega a la directa. |
| `RESPALDO_CLAVE` | Una clave larga que inventes para cifrar los respaldos. **Guárdala aparte** (gestor de claves o papel en lugar seguro). |

Después: *Actions → Respaldo diario → Run workflow* para probar que sale verde.

### Descargarlo a la laptop

1. GitHub → *Actions → Respaldo diario* → la corrida del día.
2. Abajo, en **Artifacts**, descarga `respaldo-asa-AAAA-MM-DD_HHMM`. Baja un `.zip` con el `.7z` adentro.
3. Ábrelo con **7-Zip** (https://www.7-zip.org) y la clave `RESPALDO_CLAVE`. Adentro:
   - `base.dump` — para restaurar
   - `base.sql` — lo mismo en texto
   - `filas-por-tabla.txt` — cuántas filas tenía cada tabla

Guarda el `.7z` así, cifrado, en la laptop y en un disco o nube aparte.

### Restaurar

**Opción 1 — Desde GitHub (la más fácil).**
*Actions → Restaurar respaldo → Run workflow*:
- `corrida`: el número de la corrida del respaldo. Sale en la dirección de esa página: `…/actions/runs/ESTE_NÚMERO`.
- `confirmar`: escribe `RESTAURAR`.

Antes de tocar nada saca un respaldo de cómo está la base ahora (`antes-de-restaurar-…`, en los Artifacts de esa corrida), por si hay que deshacer. Después reemplaza los datos y vuelve a aplicar la seguridad del paso 1.

**Opción 2 — Desde la laptop** (necesita PostgreSQL 17 instalado, https://www.postgresql.org/download/):

```bash
pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction --schema=public \
  -d "CADENA_SESSION_POOLER" base.dump
```

Después pega otra vez `supabase/41_seguridad_y_accesos.sql` en el SQL Editor.

**Opción 3 — Algo puntual.** El panel tiene **Respaldo de datos** (Excel) con restauración en modo *agregar* (solo lo que falta) o *reemplazar*. Sirve para recuperar filas borradas sin tocar el resto.

> Supabase también guarda respaldos propios en los planes pagos (*Database → Backups*), pero solo se restauran desde Supabase y no se descargan. Este respaldo es tuyo y lo tienes en tu laptop.
