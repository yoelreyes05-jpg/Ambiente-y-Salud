-- ============================================================================
-- Ambiente y Salud RD (ASA SRL) — 07. Tienda / Punto de Venta (POS)
-- ============================================================================

set search_path = public, extensions;

-- ── Guarda de dependencias ──────────────────────────────────────────────────
do $$
declare faltan text := '';
begin
  if to_regtype('public.asa_metodo_pago') is null then
    faltan := faltan || ' 01_extensiones_y_tipos.sql';
  end if;
  if to_regclass('public.asa_clientes') is null then
    faltan := faltan || ' 02_clientes_mascotas.sql';
  end if;
  if to_regclass('public.asa_productos_tienda') is null then
    faltan := faltan || ' 06_inventario_productos.sql';
  end if;
  if faltan <> '' then
    raise exception
      'DEPENDENCIA FALTANTE. Ejecuta primero:%. O usa 00_INSTALL_COMPLETO.sql, que instala todo en el orden correcto.', faltan;
  end if;
end $$;

create table if not exists asa_ventas_pos (
  id              uuid primary key default gen_random_uuid(),
  numero          text unique,             -- correlativo interno (no confundir con e-NCF)
  cliente_id      uuid references asa_clientes(id) on delete set null,  -- nullable: venta anónima de mostrador
  cajero_id       uuid,                    -- referencia lógica a asa_empleados
  subtotal        numeric(10,2) not null default 0,
  itbis           numeric(10,2) not null default 0,
  descuento       numeric(10,2) not null default 0,
  total           numeric(10,2) not null default 0,
  metodo_pago     asa_metodo_pago not null default 'efectivo',
  factura_id      uuid,                    -- referencia lógica a asa_facturas (08)
  anulada         boolean not null default false,
  motivo_anulacion text,
  created_at      timestamptz not null default now()
);
create index if not exists asa_ventas_pos_cliente_idx on asa_ventas_pos (cliente_id);
create index if not exists asa_ventas_pos_fecha_idx on asa_ventas_pos (created_at desc);

create table if not exists asa_ventas_pos_detalle (
  id            uuid primary key default gen_random_uuid(),
  venta_id      uuid not null references asa_ventas_pos(id) on delete cascade,
  producto_id   uuid not null references asa_productos_tienda(id),
  cantidad      integer not null default 1,
  precio_unitario numeric(10,2) not null default 0,
  itbis         numeric(10,2) not null default 0,
  subtotal      numeric(10,2) not null default 0
);
create index if not exists asa_ventas_pos_detalle_venta_idx on asa_ventas_pos_detalle (venta_id);

-- Arqueo de caja por turno/día (tienda)
create table if not exists asa_pos_cuadre_caja (
  id                  uuid primary key default gen_random_uuid(),
  fecha               date not null default current_date,
  usuario             text,
  ventas_efectivo     numeric(10,2) default 0,
  ventas_tarjeta      numeric(10,2) default 0,
  ventas_transferencia numeric(10,2) default 0,
  ventas_total        numeric(10,2) default 0,
  transacciones_count integer default 0,
  efectivo_inicial    numeric(10,2) default 0,
  efectivo_contado    numeric(10,2) default 0,
  diferencia          numeric(10,2) default 0,
  cerrado             boolean not null default false,
  notas               text,
  created_at          timestamptz not null default now()
);
create index if not exists asa_pos_cuadre_caja_fecha_idx on asa_pos_cuadre_caja (fecha);
