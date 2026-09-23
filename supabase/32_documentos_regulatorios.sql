-- ============================================================================
-- 32_documentos_regulatorios.sql — Ambiente y Salud RD (ASA SRL)
--
-- La "carpeta de documentos" que el hotel le pide a ASA en cada auditoría:
--
--   · Productos que utilizamos (listado), cada uno con su ficha técnica y su
--     hoja de seguridad.
--   · Manual de operaciones y protocolo de trabajo.
--   · Licencia ambiental, licencia sanitaria, no objeción de Salud Pública,
--     registro de Agricultura y regencia.
--
-- ASA sube los archivos desde el panel (Catálogos → Documentos) y el hotel
-- los ve y descarga desde su portal, pestaña "Documentos", cuando los
-- necesite. Nadie tiene que mandarlos por WhatsApp otra vez.
--
-- Los archivos van al bucket PRIVADO "asa-documentos" (lo crea el backend la
-- primera vez). El portal nunca recibe la ruta del archivo: pide un enlace
-- firmado que vence en una hora.
--
-- Es idempotente. Requiere 06_inventario_productos.sql y 02 (asa_clientes).
-- ============================================================================

set search_path = public, extensions;

-- ── 1. El catálogo de productos gana lo que el hotel necesita ver ──────────
alter table asa_plaguicidas_catalogo add column if not exists fabricante           text;
alter table asa_plaguicidas_catalogo add column if not exists registro_agricultura text;
alter table asa_plaguicidas_catalogo add column if not exists uso                  text;  -- plagas objetivo / dónde se aplica
alter table asa_plaguicidas_catalogo add column if not exists presentacion         text;  -- EC, WP, gel, cebo en bloque…
alter table asa_plaguicidas_catalogo add column if not exists visible_cliente      boolean not null default true;
alter table asa_plaguicidas_catalogo add column if not exists notas                text;
alter table asa_plaguicidas_catalogo add column if not exists updated_at           timestamptz not null default now();

-- ── 2. Documentos ──────────────────────────────────────────────────────────
create table if not exists asa_documentos (
  id                uuid primary key default gen_random_uuid(),
  categoria         text not null check (categoria in (
                      'ficha_tecnica', 'hoja_seguridad', 'listado_productos',
                      'manual_operaciones', 'protocolo_trabajo',
                      'licencia_ambiental', 'licencia_sanitaria', 'no_objecion_salud',
                      'registro_agricultura', 'regencia', 'otro')),
  titulo            text not null,
  descripcion       text,
  producto_id       uuid references asa_plaguicidas_catalogo(id) on delete set null,
  -- null = lo ven todos los clientes; con valor = solo ese cliente (ej. un
  -- protocolo hecho a la medida de un hotel).
  cliente_id        uuid references asa_clientes(id) on delete cascade,
  numero            text,          -- número de licencia / registro / resolución
  emitido_por       text,          -- Medio Ambiente, Salud Pública, Agricultura…
  fecha_emision     date,
  fecha_vencimiento date,
  version           text,
  archivo_ruta      text,          -- ruta dentro del bucket asa-documentos
  archivo_nombre    text,
  archivo_tipo      text,
  archivo_bytes     integer,
  visible_cliente   boolean not null default true,
  activo            boolean not null default true,
  creado_por        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_asa_documentos_cat      on asa_documentos (categoria) where activo;
create index if not exists idx_asa_documentos_producto on asa_documentos (producto_id) where activo;
create index if not exists idx_asa_documentos_cliente  on asa_documentos (cliente_id) where activo;

-- ── 3. Bucket privado (el backend también lo crea si falta) ────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('asa-documentos', 'asa-documentos', false, 20971520)
on conflict (id) do nothing;

-- Verificación
select
  (select count(*) from information_schema.tables  where table_name = 'asa_documentos') as "documentos",
  (select count(*) from information_schema.columns where table_name = 'asa_plaguicidas_catalogo'
                                                    and column_name = 'registro_agricultura') as "productos_ampliados",
  (select count(*) from storage.buckets where id = 'asa-documentos') as "bucket";
