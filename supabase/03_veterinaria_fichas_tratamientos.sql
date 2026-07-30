-- ============================================================================
-- Ambiente y Salud RD (ASA SRL) — 03. Veterinaria: fichas clínicas y vacunación
-- "Llevan fichas para los animales donde se tiene el control de cada uno"
-- ============================================================================

set search_path = public, extensions;

-- ── Guarda de dependencias ──────────────────────────────────────────────────
-- Convierte el críptico `42P01: relation "asa_mascotas" does not exist`
-- en un mensaje que dice exactamente qué archivo falta por ejecutar.
do $$
declare faltan text := '';
begin
  if to_regtype('public.asa_tipo_tratamiento') is null
     or to_regtype('public.asa_especie') is null then
    faltan := faltan || ' 01_extensiones_y_tipos.sql';
  end if;
  if to_regclass('public.asa_mascotas') is null then
    faltan := faltan || ' 02_clientes_mascotas.sql';
  end if;
  if faltan <> '' then
    raise exception
      'DEPENDENCIA FALTANTE. Ejecuta primero:%. O usa 00_INSTALL_COMPLETO.sql, que instala todo en el orden correcto.', faltan;
  end if;
end $$;

-- Nota: asa_empleados se crea en 10_nomina.sql. Se referencia por id (uuid);
-- si se aplica este archivo antes que el de nómina, la FK se agrega al final
-- del archivo 10 con ALTER TABLE (ver comentario allí).

-- Ficha clínica = un evento/consulta en la vida de la mascota (expediente).
create table if not exists asa_fichas_clinicas (
  id                  uuid primary key default gen_random_uuid(),
  mascota_id          uuid not null references asa_mascotas(id) on delete cascade,
  veterinario_id      uuid,                 -- referencia lógica a asa_empleados (rol veterinario)
  cita_id             uuid,                 -- referencia lógica a asa_citas (definida en 04)
  fecha               timestamptz not null default now(),
  motivo_consulta     text,
  diagnostico         text,
  tratamiento_indicado text,
  peso_kg             numeric(6,2),
  temperatura_c       numeric(4,1),
  observaciones       text,
  adjuntos            jsonb default '[]'::jsonb,   -- [{url, tipo, nombre}]
  created_at          timestamptz not null default now()
);
create index if not exists asa_fichas_clinicas_mascota_idx on asa_fichas_clinicas (mascota_id);
create index if not exists asa_fichas_clinicas_fecha_idx on asa_fichas_clinicas (fecha desc);

-- Catálogo de vacunas y tratamientos preventivos (desparasitantes, etc.)
create table if not exists asa_tratamientos_catalogo (
  id                      uuid primary key default gen_random_uuid(),
  tipo                    asa_tipo_tratamiento not null default 'vacuna',
  nombre                  text not null,           -- ej. "Óctuple canina", "Antipulgas oral"
  especie                 asa_especie not null default 'canino',
  fabricante              text,
  intervalo_dias_refuerzo integer,                 -- para calcular próxima dosis/recordatorio
  precio                  numeric(10,2),
  stock_actual            integer default 0,
  stock_minimo            integer default 0,
  activo                  boolean not null default true,
  created_at              timestamptz not null default now()
);

-- Aplicación real de una vacuna/tratamiento a una mascota (lo que alimenta
-- el carnet digital y los recordatorios automáticos).
create table if not exists asa_tratamientos_aplicados (
  id                    uuid primary key default gen_random_uuid(),
  mascota_id            uuid not null references asa_mascotas(id) on delete cascade,
  tratamiento_id        uuid not null references asa_tratamientos_catalogo(id),
  ficha_id              uuid references asa_fichas_clinicas(id) on delete set null,
  veterinario_id        uuid,                     -- referencia lógica a asa_empleados
  lote                  text,
  fecha_vencimiento_lote date,
  fecha_aplicacion      date not null default current_date,
  proxima_fecha         date,                      -- calculada: fecha_aplicacion + intervalo_dias_refuerzo
  recordatorio_enviado  boolean not null default false,
  notas                 text,
  created_at            timestamptz not null default now()
);
create index if not exists asa_tratamientos_aplicados_mascota_idx on asa_tratamientos_aplicados (mascota_id);
create index if not exists asa_tratamientos_aplicados_proxima_idx on asa_tratamientos_aplicados (proxima_fecha) where recordatorio_enviado = false;
