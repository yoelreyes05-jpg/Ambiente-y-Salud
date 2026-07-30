# Ambiente y Salud RD (ASA SRL) — Sistema integral

Sistema de gestión para las 3 líneas de negocio de ASA: **Salud Ambiental /
Control de Plagas**, **Veterinaria y Estética Canina** (vacunación, lavado,
fichas clínicas) y **Tienda / Venta de Productos al Detalle**. Incluye
facturación electrónica (e-CF / DGII), contabilidad, nómina y validación de
clientes por RNC.

Datos de la empresa: Tel. +1 (829) 260-5444 · info@ambienteysaludrd.com ·
Av. Prof. Juan Bosch, Santo Domingo Este · ambienteysalud.online

## Estructura de este proyecto

```
ambiente-y-salud/
├── supabase/         ← Todas las tablas de Supabase (SQL), prefijo asa_*
│                        Empieza por aquí: supabase/00_README.md
├── backend/          ← API (Node.js + Express + Supabase), código real y funcional
├── panel-web/         Panel administrativo (estructura documentada, por construir)
├── app-cliente/        App móvil del cliente (estructura documentada, por construir)
└── app-personal/       App móvil del personal (estructura documentada, por construir)
```

## ⚠️ Lo más importante: aislamiento de datos

Tu base de datos de Supabase es **compartida** con otros sistemas (el CRM del
taller automotriz, una clínica médica, un POS, etc.), que ya usan nombres de
tabla genéricos (`clientes`, `citas`, `pacientes`, `productos`, `ventas`,
`facturas`...). **Todas las tablas de este sistema usan el prefijo `asa_`**
(40 tablas, 16 tipos ENUM) y se verificó programáticamente que ninguna choca
con las 70 tablas ya existentes de los otros sistemas. Detalle completo en
[`supabase/00_README.md`](./supabase/00_README.md).

## Qué es código funcional vs. qué es estructura por construir

- **`supabase/*.sql`** — Listo para ejecutar en Supabase (SQL Editor o CLI),
  en orden numérico. Es el entregable principal que pediste.
- **`backend/`** — Backend Express completo y funcional: 15 módulos de rutas,
  autenticación JWT, servicio de consulta RNC/DGII con caché propio, y el
  flujo completo "reportar plaga → Orden de Trabajo". Sintaxis verificada
  (0 errores en los 18 archivos).
- **`panel-web/`, `app-cliente/`, `app-personal/`** — Estructura y mapa de
  pantallas → endpoints documentados en su propio README, listos para
  empezar a construirse (no son código de app terminado; son el plano).

## Cómo poner en marcha el backend

```bash
cd backend
cp .env.example .env      # completar SUPABASE_URL, SUPABASE_KEY, JWT_SECRET, etc.
npm install
npm start                 # http://localhost:4000
```

Antes de arrancar, ejecuta las migraciones de `supabase/*.sql` (en orden) en
tu proyecto de Supabase.

Despliegue: mismo patrón que `crm-backend` (Railway, `railway.json` incluido).

## Próximos pasos sugeridos

1. Ejecutar las migraciones SQL en Supabase.
2. Configurar `.env` con las credenciales reales y un proveedor de e-CF
   certificado (`ECF_PROVIDER_BASE_URL` / `ECF_PROVIDER_API_KEY`).
3. Cargar catálogos iniciales: plaguicidas, vacunas/tratamientos, productos
   de tienda y plan de cuentas contable.
4. Construir el panel web y las apps móviles siguiendo los README de cada
   carpeta.
