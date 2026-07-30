-- ============================================================================
-- Ambiente y Salud RD (ASA SRL) — 02. Clientes, sitios y mascotas
-- Tablas compartidas por las 3 líneas de negocio (plagas, veterinaria, tienda)
-- ============================================================================

set search_path = public, extensions;

-- ── Guarda de dependencias ──────────────────────────────────────────────────
-- Sin esto, si faltan los tipos ENUM del archivo 01 este archivo falla a medias
-- y, como el SQL Editor usa UNA transacción, se revierte completo: asa_clientes,
-- asa_sitios y asa_mascotas nunca llegan a existir. Ese es el origen del error
-- `42P01: relation "asa_mascotas" does not exist` en los archivos 03 en adelante.
do $$
declare faltan text := '';
begin
  if to_regtype('public.asa_especie') is null
     or to_regtype('public.asa_sexo_mascota') is null then
    faltan := faltan || ' 01_extensiones_y_tipos.sql';
  end if;
  if faltan <> '' then
    raise exception
      'DEPENDENCIA FALTANTE. Ejecuta primero:%. O usa 00_INSTALL_COMPLETO.sql, que instala todo en el orden correcto.', faltan;
  end if;
end $$;

-- Cliente único para las 3 líneas. NUNCA usar la tabla genérica "clientes"
-- (pertenece al CRM automotriz) — esta es la propia y aislada de ASA.
create table if not exists asa_clientes (
  id                uuid primary key default gen_random_uuid(),
  tipo_documento    text not null default 'CEDULA' check (tipo_documento in ('RNC','CEDULA','PASAPORTE')),
  rnc_cedula        text,                     -- validado contra DGII (ver asa_rnc_cache)
  razon_social      text,                     -- si es empresa
  nombre_comercial  text,
  nombre_contacto   text not null,            -- nombre de la persona de contacto
  telefono          text,
  telefono_whatsapp text,
  email             text,
  direccion         text,
  tipo_cliente      text not null default 'particular' check (tipo_cliente in ('particular','empresa','gobierno')),
  estado_dgii       text,                     -- ACTIVO/SUSPENDIDO, según última consulta a DGII
  notas             text,
  activo            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists asa_clientes_rnc_cedula_uk on asa_clientes (rnc_cedula) where rnc_cedula is not null;
create index if not exists asa_clientes_nombre_idx on asa_clientes using gin (to_tsvector('spanish', coalesce(nombre_contacto,'') || ' ' || coalesce(razon_social,'')));

-- Sitios / ubicaciones de servicio (línea de plagas): un cliente puede tener
-- varios sitios (almacén, planta, local, casa de playa, etc.)
create table if not exists asa_sitios (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references asa_clientes(id) on delete cascade,
  nombre        text not null,                -- ej. "Almacén principal"
  direccion     text not null,
  tipo_sitio    text not null default 'residencial' check (tipo_sitio in ('residencial','comercial','industrial','alimentos','gobierno')),
  lat           numeric,
  lng           numeric,
  notas         text,
  activo        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists asa_sitios_cliente_idx on asa_sitios (cliente_id);

-- Mascotas (línea veterinaria/estética): expediente base del animal.
-- El "control de cada uno" (ficha clínica) vive en 03_veterinaria_*.sql
create table if not exists asa_mascotas (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references asa_clientes(id) on delete cascade,  -- dueño
  nombre            text not null,
  especie           asa_especie not null default 'canino',
  raza              text,
  sexo              asa_sexo_mascota not null default 'desconocido',
  fecha_nacimiento  date,
  peso_kg           numeric(6,2),
  color             text,
  microchip         text,
  esterilizado      boolean default false,
  foto_url          text,
  alergias          text,
  notas             text,
  activo            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists asa_mascotas_cliente_idx on asa_mascotas (cliente_id);
create unique index if not exists asa_mascotas_microchip_uk on asa_mascotas (microchip) where microchip is not null;
