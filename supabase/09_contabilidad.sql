-- ============================================================================
-- Ambiente y Salud RD (ASA SRL) — 09. Contabilidad
-- ============================================================================

set search_path = public, extensions;

-- Este módulo no depende de tablas de otros archivos: solo requiere que
-- gen_random_uuid() esté disponible (extensión pgcrypto, archivo 01).

create table if not exists asa_plan_cuentas (
  id              uuid primary key default gen_random_uuid(),
  codigo          text unique not null,     -- ej. 1-1000, 4-2000
  nombre          text not null,
  tipo            text not null check (tipo in ('activo','pasivo','patrimonio','ingreso','gasto')),
  cuenta_padre_id uuid references asa_plan_cuentas(id) on delete set null,
  activo          boolean not null default true,
  created_at      timestamptz not null default now()
);

create table if not exists asa_asientos_contables (
  id            uuid primary key default gen_random_uuid(),
  fecha         date not null default current_date,
  concepto      text not null,
  origen_tipo   text,        -- 'factura' | 'pago' | 'nomina' | 'compra' | 'ajuste'
  origen_id     uuid,
  usuario       text,
  created_at    timestamptz not null default now()
);

create table if not exists asa_asientos_detalle (
  id            uuid primary key default gen_random_uuid(),
  asiento_id    uuid not null references asa_asientos_contables(id) on delete cascade,
  cuenta_id     uuid not null references asa_plan_cuentas(id),
  centro_costo  text default 'general' check (centro_costo in ('plagas','veterinaria','tienda','general')),
  debito        numeric(12,2) not null default 0,
  credito       numeric(12,2) not null default 0
);
create index if not exists asa_asientos_detalle_asiento_idx on asa_asientos_detalle (asiento_id);
create index if not exists asa_asientos_detalle_cuenta_idx on asa_asientos_detalle (cuenta_id);

-- Cuentas por pagar a suplidores (plaguicidas, vacunas, productos de tienda)
create table if not exists asa_suplidores (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  rnc         text,
  telefono    text,
  email       text,
  direccion   text,
  tipo_suministro text,     -- 'plaguicidas' | 'vacunas' | 'productos_tienda' | 'otro'
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists asa_cuentas_por_pagar (
  id                uuid primary key default gen_random_uuid(),
  suplidor_id       uuid references asa_suplidores(id) on delete set null,
  descripcion       text not null,
  monto_original    numeric(12,2) not null,
  monto_pagado      numeric(12,2) not null default 0,
  fecha_emision     date not null default current_date,
  fecha_vencimiento date not null,
  estado            text not null default 'pendiente' check (estado in ('pendiente','parcial','pagada','vencida')),
  notas             text,
  created_at        timestamptz not null default now()
);
create index if not exists asa_cuentas_por_pagar_suplidor_idx on asa_cuentas_por_pagar (suplidor_id);
