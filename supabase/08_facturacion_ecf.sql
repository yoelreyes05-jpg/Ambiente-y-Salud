-- ============================================================================
-- Ambiente y Salud RD (ASA SRL) — 08. Facturación electrónica (e-CF / DGII)
-- Unificada para las 3 líneas: plagas, veterinaria/estética y tienda.
-- ============================================================================

set search_path = public, extensions;

-- ── Guarda de dependencias ──────────────────────────────────────────────────
do $$
declare faltan text := '';
begin
  if to_regtype('public.asa_tipo_ecf') is null
     or to_regtype('public.asa_estado_dgii') is null
     or to_regtype('public.asa_estado_factura') is null
     or to_regtype('public.asa_metodo_pago') is null then
    faltan := faltan || ' 01_extensiones_y_tipos.sql';
  end if;
  if to_regclass('public.asa_clientes') is null then
    faltan := faltan || ' 02_clientes_mascotas.sql';
  end if;
  if faltan <> '' then
    raise exception
      'DEPENDENCIA FALTANTE. Ejecuta primero:%. O usa 00_INSTALL_COMPLETO.sql, que instala todo en el orden correcto.', faltan;
  end if;
end $$;

-- Secuencias internas de e-NCF por tipo de comprobante (control propio antes
-- de enviar al proveedor certificado de e-CF).
create table if not exists asa_secuencias_ecf (
  tipo_ecf    asa_tipo_ecf primary key,
  prefijo     text not null,
  siguiente   integer not null default 1,
  maximo      integer not null default 50000000,
  activo      boolean not null default true
);

create table if not exists asa_facturas (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references asa_clientes(id) on delete restrict,
  tipo_origen     text not null check (tipo_origen in ('plaga','veterinaria','estetica','tienda')),
  origen_id       uuid,                    -- id de asa_ordenes_trabajo / asa_citas / asa_estetica_ordenes / asa_ventas_pos
  tipo_ecf        asa_tipo_ecf not null default 'e32',
  e_ncf           text unique,             -- número de comprobante fiscal electrónico
  subtotal        numeric(12,2) not null default 0,
  itbis           numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  estado_dgii     asa_estado_dgii not null default 'pendiente',
  estado_factura  asa_estado_factura not null default 'emitida',
  acuse_dgii      jsonb,                   -- respuesta cruda del proveedor certificado / DGII
  xml_url         text,
  representacion_impresa_url text,
  fecha_emision   timestamptz not null default now(),
  creado_por      text,
  notas           text,
  created_at      timestamptz not null default now()
);
create index if not exists asa_facturas_cliente_idx on asa_facturas (cliente_id);
create index if not exists asa_facturas_origen_idx on asa_facturas (tipo_origen, origen_id);
create index if not exists asa_facturas_estado_idx on asa_facturas (estado_factura);

create table if not exists asa_factura_items (
  id                uuid primary key default gen_random_uuid(),
  factura_id        uuid not null references asa_facturas(id) on delete cascade,
  descripcion       text not null,
  cantidad          numeric(10,2) not null default 1,
  precio_unitario   numeric(10,2) not null default 0,
  itbis_aplica      boolean not null default true,
  subtotal          numeric(10,2) not null default 0
);
create index if not exists asa_factura_items_factura_idx on asa_factura_items (factura_id);

create table if not exists asa_pagos (
  id            uuid primary key default gen_random_uuid(),
  factura_id    uuid not null references asa_facturas(id) on delete cascade,
  monto         numeric(12,2) not null,
  metodo_pago   asa_metodo_pago not null default 'efectivo',
  fecha         timestamptz not null default now(),
  referencia    text,
  usuario       text,
  created_at    timestamptz not null default now()
);
create index if not exists asa_pagos_factura_idx on asa_pagos (factura_id);

-- Cuentas por cobrar (para clientes con crédito / contratos recurrentes)
create table if not exists asa_cuentas_por_cobrar (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references asa_clientes(id) on delete cascade,
  factura_id        uuid references asa_facturas(id) on delete set null,
  monto_original    numeric(12,2) not null,
  monto_pagado      numeric(12,2) not null default 0,
  fecha_emision     date not null default current_date,
  fecha_vencimiento date not null,
  estado            text not null default 'pendiente' check (estado in ('pendiente','parcial','pagada','vencida')),
  notas             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists asa_cuentas_por_cobrar_cliente_idx on asa_cuentas_por_cobrar (cliente_id);
create index if not exists asa_cuentas_por_cobrar_estado_idx on asa_cuentas_por_cobrar (estado);
