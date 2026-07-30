-- ============================================================================
-- Ambiente y Salud RD (ASA SRL) — 06. Inventario: plaguicidas y tienda
-- ============================================================================

set search_path = public, extensions;

-- ── Guarda de dependencias ──────────────────────────────────────────────────
do $$
declare faltan text := '';
begin
  if to_regclass('public.asa_ordenes_trabajo') is null then
    faltan := faltan || ' 05_plagas_ordenes_ipm.sql';
  end if;
  if faltan <> '' then
    raise exception
      'DEPENDENCIA FALTANTE. Ejecuta primero:%. O usa 00_INSTALL_COMPLETO.sql, que instala todo en el orden correcto.', faltan;
  end if;
end $$;

-- Catálogo de plaguicidas (línea de plagas) con datos regulatorios
create table if not exists asa_plaguicidas_catalogo (
  id                    uuid primary key default gen_random_uuid(),
  nombre_comercial      text not null,
  principio_activo      text,
  categoria_toxicologica text,             -- I, II, III, IV
  registro_sanitario    text,
  ficha_seguridad_url   text,              -- SDS
  unidad_medida         text default 'ml',
  precio_costo          numeric(10,2),
  stock_actual          numeric(12,2) default 0,
  stock_minimo          numeric(12,2) default 0,
  activo                boolean not null default true,
  created_at            timestamptz not null default now()
);

-- Registro de cada aplicación de plaguicida durante una OT (trazabilidad)
create table if not exists asa_aplicaciones_productos (
  id                uuid primary key default gen_random_uuid(),
  orden_trabajo_id  uuid not null references asa_ordenes_trabajo(id) on delete cascade,
  producto_id       uuid not null references asa_plaguicidas_catalogo(id),
  lote              text,
  dosis             text,
  metodo_aplicacion text,
  area_tratada      text,
  cantidad_usada    numeric(10,2),
  tecnico_id        uuid,                 -- referencia lógica a asa_empleados
  created_at        timestamptz not null default now()
);
create index if not exists asa_aplicaciones_productos_orden_idx on asa_aplicaciones_productos (orden_trabajo_id);

-- Catálogo de productos de tienda (venta al detalle: alimentos, higiene, accesorios, etc.)
create table if not exists asa_productos_tienda (
  id              uuid primary key default gen_random_uuid(),
  codigo_barra    text unique,
  nombre          text not null,
  categoria       text,
  descripcion     text,
  precio_venta    numeric(10,2) not null default 0,
  precio_costo    numeric(10,2),
  itbis_aplica    boolean not null default true,
  unidad_medida   text default 'unidad',
  stock_actual    integer default 0,
  stock_minimo    integer default 0,
  imagen_url      text,
  activo          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists asa_productos_tienda_nombre_idx on asa_productos_tienda using gin (to_tsvector('spanish', nombre));

-- Ledger único de movimientos de inventario para las 3 fuentes de stock
-- (plaguicidas, productos de tienda, tratamientos/vacunas) — auditoría central.
create table if not exists asa_inventario_movimientos (
  id                uuid primary key default gen_random_uuid(),
  tipo_item         text not null check (tipo_item in ('plaguicida','producto_tienda','tratamiento')),
  item_id           uuid not null,          -- id en la tabla catálogo correspondiente
  tipo_movimiento   text not null check (tipo_movimiento in ('entrada','salida','ajuste','venta','aplicacion','merma')),
  cantidad          numeric(12,2) not null,
  stock_antes       numeric(12,2),
  stock_despues     numeric(12,2),
  referencia_tipo   text,                   -- 'orden_trabajo' | 'venta_pos' | 'tratamiento_aplicado' | 'compra'
  referencia_id     uuid,
  usuario           text,
  notas             text,
  created_at        timestamptz not null default now()
);
create index if not exists asa_inventario_movimientos_item_idx on asa_inventario_movimientos (tipo_item, item_id);
