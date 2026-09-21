-- ============================================================================
-- 21_monitoreo_plagas.sql — Ambiente y Salud RD (ASA SRL)
--
-- Qué agrega, y por qué:
--
-- Hasta ahora una inspección guardaba `nivel_actividad` (ninguna/bajo/medio/
-- alto). Eso sirve para saber si "había algo", pero no para llevar control
-- real: no distingue moscas de cucarachas, no permite ver si una cocina va
-- mejorando o empeorando, y no aguanta una auditoría de hotel, donde piden
-- tendencia por plaga y por área.
--
-- Este archivo agrega tres piezas:
--   1. asa_plagas    — catálogo de plagas (mosca, cucaracha alemana, chinche…)
--   2. asa_capturas  — CUÁNTAS de cada plaga se contaron en cada inspección
--   3. asa_umbrales  — a partir de qué cantidad se dispara una alerta / OT
--
-- Y amarra la orden de trabajo a la plaga y al punto, para que el técnico vea
-- en su app la OT de chinches del cuarto 4312 y no solo un texto suelto.
--
-- Es idempotente: se puede correr dos veces sin romper nada.
-- Requiere: 05_plagas_ordenes_ipm.sql y 20_hoteles_puntos_control.sql.
-- ============================================================================

do $$
declare faltan text := '';
begin
  if to_regclass('public.asa_inspecciones') is null then faltan := faltan || ' asa_inspecciones'; end if;
  if to_regclass('public.asa_ordenes_trabajo') is null then faltan := faltan || ' asa_ordenes_trabajo'; end if;
  if faltan <> '' then
    raise exception 'Faltan tablas previas:%. Corre antes 05_ y 20_.', faltan;
  end if;
end $$;

-- ============================================================================
-- 1. Catálogo de plagas
--    Es tabla y no enum: ASA agrega una plaga nueva desde el panel sin
--    migración. `grupo` sirve para agrupar en los reportes del hotel.
-- ============================================================================
create table if not exists asa_plagas (
  id                uuid primary key default gen_random_uuid(),
  codigo            text unique not null,
  nombre            text not null,
  nombre_cientifico text,
  grupo             text not null default 'otra'
                      check (grupo in ('voladora','rastrera','roedor','otra')),
  icono             text,
  color             text,
  -- Umbral general; el de asa_umbrales lo sobrescribe por planta si hace falta
  umbral_alerta     integer not null default 0,
  orden             integer not null default 0,
  activo            boolean not null default true,
  created_at        timestamptz not null default now()
);

insert into asa_plagas (codigo, nombre, nombre_cientifico, grupo, icono, color, umbral_alerta, orden) values
  ('mosca_domestica',   'Mosca doméstica',      'Musca domestica',        'voladora', '🪰', '#0891b2', 10, 10),
  ('mosca_fruta',       'Mosca de la fruta',    'Drosophila spp.',        'voladora', '🪰', '#06b6d4', 15, 20),
  ('mosquito',          'Mosquito',             'Aedes / Culex spp.',     'voladora', '🦟', '#0e7490',  5, 30),
  ('cucaracha_alemana', 'Cucaracha alemana',    'Blattella germanica',    'rastrera', '🪳', '#b45309',  3, 40),
  ('cucaracha_america', 'Cucaracha americana',  'Periplaneta americana',  'rastrera', '🪳', '#92400e',  2, 50),
  ('chinche',           'Chinche de cama',      'Cimex lectularius',      'rastrera', '🛏️', '#dc2626',  1, 60),
  ('hormiga',           'Hormiga',              'Formicidae',             'rastrera', '🐜', '#78350f', 20, 70),
  ('roedor_raton',      'Ratón',                'Mus musculus',           'roedor',   '🐁', '#57534e',  1, 80),
  ('roedor_rata',       'Rata',                 'Rattus spp.',            'roedor',   '🐀', '#44403c',  1, 90),
  ('termita',           'Termita',              'Isoptera',               'otra',     '🪵', '#854d0e',  1, 100),
  ('otro',              'Otra plaga',            null,                    'otra',     '❓', '#64748b',  1, 999)
on conflict (codigo) do nothing;

-- ============================================================================
-- 2. Capturas — el conteo real, por inspección y por plaga
--
--    Una fila por plaga encontrada. Si el técnico no encontró nada, no se
--    escribe ninguna fila: la ausencia ES el dato (la inspección existe con
--    nivel_actividad = 'ninguna'). Así la tabla no se llena de ceros.
-- ============================================================================
create table if not exists asa_capturas (
  id            uuid primary key default gen_random_uuid(),
  inspeccion_id uuid not null references asa_inspecciones(id) on delete cascade,
  plaga_id      uuid not null references asa_plagas(id),
  cantidad      integer not null default 0 check (cantidad >= 0),
  -- 'conteo' = contadas una por una; 'estimado' = a ojo (lámparas muy cargadas)
  metodo        text not null default 'conteo'
                  check (metodo in ('conteo','estimado','presencia')),
  etapa         text check (etapa in ('adulto','ninfa','huevo','indicios')),
  observacion   text,
  created_at    timestamptz not null default now()
);
-- Una sola fila por (inspección, plaga, etapa). Va como índice y no como
-- constraint porque Postgres no acepta expresiones (coalesce) en UNIQUE.
create unique index if not exists ux_asa_capturas_unica
  on asa_capturas (inspeccion_id, plaga_id, coalesce(etapa, ''));
create index if not exists idx_asa_capturas_inspeccion on asa_capturas (inspeccion_id);
create index if not exists idx_asa_capturas_plaga      on asa_capturas (plaga_id);

-- ============================================================================
-- 3. Umbrales — cuándo deja de ser normal
--
--    Alcance de más general a más específico: la fila con sitio_id lleno gana
--    sobre la que lo tiene en null. Permite que en cocina del Coral Bávaro
--    3 cucarachas sean alerta y en áreas verdes no.
-- ============================================================================
create table if not exists asa_umbrales (
  id             uuid primary key default gen_random_uuid(),
  plaga_id       uuid not null references asa_plagas(id) on delete cascade,
  sitio_id       uuid references asa_sitios(id) on delete cascade,
  area_id        uuid references asa_areas(id) on delete cascade,
  tipo_punto_id  uuid references asa_tipos_punto(id) on delete cascade,
  cantidad       integer not null check (cantidad > 0),
  -- Qué pasa al superarlo
  genera_alerta  boolean not null default true,
  genera_orden   boolean not null default false,
  prioridad_orden text not null default 'alta',
  nota           text,
  activo         boolean not null default true,
  created_at     timestamptz not null default now()
);
create index if not exists idx_asa_umbrales_plaga on asa_umbrales (plaga_id) where activo;
create index if not exists idx_asa_umbrales_sitio on asa_umbrales (sitio_id) where activo;

-- ============================================================================
-- 4. La orden de trabajo, amarrada a la plaga y al lugar exacto
--
--    `tipo_plaga_reportada` (texto libre) se conserva: es lo que escribe el
--    cliente en su app. `plaga_id` es la clasificación que hace ASA, y es la
--    que se puede contar y graficar.
-- ============================================================================
alter table asa_ordenes_trabajo add column if not exists plaga_id uuid references asa_plagas(id) on delete set null;
alter table asa_ordenes_trabajo add column if not exists area_id  uuid references asa_areas(id) on delete set null;
alter table asa_ordenes_trabajo add column if not exists punto_id uuid references asa_puntos_control(id) on delete set null;
alter table asa_ordenes_trabajo add column if not exists inspeccion_origen_id uuid references asa_inspecciones(id) on delete set null;

create index if not exists idx_asa_ot_plaga  on asa_ordenes_trabajo (plaga_id);
create index if not exists idx_asa_ot_tecnico_estado on asa_ordenes_trabajo (tecnico_id, estado);
create index if not exists idx_asa_ot_sitio_fecha    on asa_ordenes_trabajo (sitio_id, fecha_agendada);

-- ============================================================================
-- 5. Vista de tendencia — lo que alimenta las gráficas del panel y del hotel
--
--    Una fila por día / planta / área / plaga con el total contado. Es sobre
--    esto que se dibuja "moscas en Cocina El Faro, últimos 90 días".
-- ============================================================================
create or replace view asa_v_capturas_diarias as
select
  i.fecha_local            as fecha,
  i.sitio_id,
  s.nombre                 as sitio,
  i.area_id,
  a.nombre                 as area,
  c.plaga_id,
  p.nombre                 as plaga,
  p.grupo                  as grupo_plaga,
  count(distinct i.id)     as inspecciones,
  sum(c.cantidad)          as total,
  max(c.cantidad)          as maximo_en_un_punto
from asa_capturas c
join asa_inspecciones i on i.id = c.inspeccion_id
join asa_plagas p       on p.id = c.plaga_id
left join asa_sitios s  on s.id = i.sitio_id
left join asa_areas  a  on a.id = i.area_id
group by 1,2,3,4,5,6,7,8;

-- ============================================================================
-- 6. Verificación
-- ============================================================================
do $$
begin
  raise notice 'Monitoreo de plagas instalado. Plagas en catálogo: %',
    (select count(*) from asa_plagas);
end $$;
