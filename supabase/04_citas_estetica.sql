-- ============================================================================
-- Ambiente y Salud RD (ASA SRL) — 04. Citas y estética canina (lavado/grooming)
-- ============================================================================

set search_path = public, extensions;

-- ── Guarda de dependencias ──────────────────────────────────────────────────
do $$
declare faltan text := '';
begin
  if to_regtype('public.asa_tipo_servicio_cita') is null
     or to_regtype('public.asa_estado_cita') is null then
    faltan := faltan || ' 01_extensiones_y_tipos.sql';
  end if;
  if to_regclass('public.asa_clientes') is null
     or to_regclass('public.asa_mascotas') is null then
    faltan := faltan || ' 02_clientes_mascotas.sql';
  end if;
  if faltan <> '' then
    raise exception
      'DEPENDENCIA FALTANTE. Ejecuta primero:%. O usa 00_INSTALL_COMPLETO.sql, que instala todo en el orden correcto.', faltan;
  end if;
end $$;

-- Agenda unificada: consultas, vacunación, desparasitación y estética.
-- OJO: esta es asa_citas — NO confundir con la tabla genérica "citas" que ya
-- usa la clínica médica humana en esta misma base de datos.
create table if not exists asa_citas (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid not null references asa_clientes(id) on delete cascade,
  mascota_id          uuid references asa_mascotas(id) on delete set null,
  tipo_servicio       asa_tipo_servicio_cita not null default 'consulta',
  especialista_id     uuid,                 -- referencia lógica a asa_empleados (veterinario/groomer)
  fecha_hora          timestamptz not null,
  duracion_minutos    integer not null default 30,
  estado              asa_estado_cita not null default 'solicitada',
  motivo              text,
  notas               text,
  recordatorio_enviado boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists asa_citas_cliente_idx on asa_citas (cliente_id);
create index if not exists asa_citas_mascota_idx on asa_citas (mascota_id);
create index if not exists asa_citas_fecha_idx on asa_citas (fecha_hora);

-- Catálogo de servicios de estética (baño, corte, uñas, paquetes, etc.)
create table if not exists asa_estetica_servicios_catalogo (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null,          -- ej. "Baño + corte", "Uñas"
  descripcion       text,
  precio            numeric(10,2) not null default 0,
  duracion_minutos  integer default 45,
  activo            boolean not null default true,
  created_at        timestamptz not null default now()
);

-- Orden de estética ejecutada (vinculada opcionalmente a una cita)
create table if not exists asa_estetica_ordenes (
  id            uuid primary key default gen_random_uuid(),
  cita_id       uuid references asa_citas(id) on delete set null,
  mascota_id    uuid not null references asa_mascotas(id) on delete cascade,
  groomer_id    uuid,                       -- referencia lógica a asa_empleados
  estado        asa_estado_cita not null default 'solicitada',
  fecha         timestamptz not null default now(),
  fotos_antes   jsonb default '[]'::jsonb,
  fotos_despues jsonb default '[]'::jsonb,
  notas         text,
  created_at    timestamptz not null default now()
);
create index if not exists asa_estetica_ordenes_mascota_idx on asa_estetica_ordenes (mascota_id);

-- Detalle de servicios incluidos en una orden de estética (permite combos)
create table if not exists asa_estetica_orden_detalle (
  id            uuid primary key default gen_random_uuid(),
  orden_id      uuid not null references asa_estetica_ordenes(id) on delete cascade,
  servicio_id   uuid not null references asa_estetica_servicios_catalogo(id),
  precio        numeric(10,2) not null default 0,
  notas         text
);
create index if not exists asa_estetica_orden_detalle_orden_idx on asa_estetica_orden_detalle (orden_id);
