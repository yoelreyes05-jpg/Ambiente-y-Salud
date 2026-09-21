-- ============================================================================
-- 20_hoteles_puntos_control.sql
-- Ambiente y Salud RD (ASA SRL) — Control de plagas en clientes hoteleros
--
-- Extiende el esquema base (archivos 01..12) con la jerarquía real de trabajo:
--
--   Cliente (grupo hotelero)
--     └── Contrato
--           └── Hotel / sitio            (un contrato puede cubrir varios)
--                 └── Área               (cocina, lobby, piso 3, almacén...)
--                       └── Punto de control   (QR inmutable)
--                             └── Inspección   (respuestas al checklist)
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- Requiere que 00_INSTALL_COMPLETO.sql (o 01..12) ya se haya ejecutado.
-- ============================================================================
set search_path = public, extensions;

-- ── Guarda de dependencias ──────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.asa_sitios') is null then
    raise exception
      'Falta el esquema base. Ejecuta primero supabase/00_INSTALL_COMPLETO.sql y luego este archivo.';
  end if;
end $$;

-- ── Rol nuevo: personal de calidad del hotel (acceso de solo lectura al suyo) ─
-- Nota: PostgreSQL no permite USAR un valor de enum recién agregado dentro de
-- la misma transacción que lo agrega. Por eso aquí solo se declara; las
-- semillas de más abajo no lo referencian.
alter type asa_rol_usuario add value if not exists 'cliente_calidad';

-- ============================================================================
-- 1. Un contrato puede cubrir VARIOS hoteles
-- ============================================================================
alter table asa_contratos_plagas alter column sitio_id drop not null;
alter table asa_contratos_plagas add column if not exists codigo      text;
alter table asa_contratos_plagas add column if not exists nombre      text;
alter table asa_contratos_plagas add column if not exists dias_servicio jsonb default '[]'::jsonb;

create unique index if not exists idx_asa_contratos_codigo
  on asa_contratos_plagas (codigo) where codigo is not null;

-- Hoteles cubiertos por cada contrato
create table if not exists asa_contrato_sitios (
  id           uuid primary key default gen_random_uuid(),
  contrato_id  uuid not null references asa_contratos_plagas(id) on delete cascade,
  sitio_id     uuid not null references asa_sitios(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (contrato_id, sitio_id)
);
create index if not exists idx_asa_contrato_sitios_contrato on asa_contrato_sitios (contrato_id);
create index if not exists idx_asa_contrato_sitios_sitio    on asa_contrato_sitios (sitio_id);

-- Migrar los contratos existentes (1 sitio) al modelo nuevo, sin perder nada
insert into asa_contrato_sitios (contrato_id, sitio_id)
select c.id, c.sitio_id
  from asa_contratos_plagas c
 where c.sitio_id is not null
on conflict (contrato_id, sitio_id) do nothing;

-- ── El sitio ahora puede ser un hotel ───────────────────────────────────────
alter table asa_sitios add column if not exists codigo            text;
alter table asa_sitios add column if not exists contacto_calidad  text;
alter table asa_sitios add column if not exists telefono_calidad  text;
alter table asa_sitios add column if not exists email_calidad     text;
alter table asa_sitios add column if not exists habitaciones_total integer;

do $$
begin
  alter table asa_sitios drop constraint if exists asa_sitios_tipo_sitio_check;
  alter table asa_sitios add constraint asa_sitios_tipo_sitio_check
    check (tipo_sitio in ('residencial','comercial','industrial','alimentos','gobierno',
                          'hotel','apartamento','casa','restaurante','otro'));
end $$;

create unique index if not exists idx_asa_sitios_codigo
  on asa_sitios (codigo) where codigo is not null;

-- ============================================================================
-- 2. Áreas del hotel
-- ============================================================================
create table if not exists asa_areas (
  id          uuid primary key default gen_random_uuid(),
  sitio_id    uuid not null references asa_sitios(id) on delete cascade,
  nombre      text not null,                  -- "Cocina principal", "Piso 3", "Lobby"
  codigo      text,                           -- "COC", "P3" — para los códigos de punto
  nivel       text,                           -- piso / planta, si aplica
  orden       integer not null default 0,     -- para ordenar la vista del técnico
  descripcion text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (sitio_id, nombre)
);
create index if not exists idx_asa_areas_sitio on asa_areas (sitio_id) where activo;

-- ============================================================================
-- 3. Catálogo de tipos de punto de control
--    Es una TABLA y no un enum a propósito: así se agregan tipos nuevos desde
--    el panel, sin migración de base de datos.
-- ============================================================================
create table if not exists asa_tipos_punto (
  id                 uuid primary key default gen_random_uuid(),
  codigo             text unique not null,    -- 'cebadero_roedor', 'habitacion'...
  nombre             text not null,
  prefijo_codigo     text,                    -- prefijo sugerido al generar en masa: "CR"
  icono              text,                    -- emoji o nombre de icono para la app
  color              text,                    -- color del pin en el plano
  frecuencia_default text not null default 'mensual'
                       check (frecuencia_default in ('diaria','semanal','quincenal','mensual','trimestral','por_orden')),
  requiere_foto      boolean not null default false,
  orden              integer not null default 0,
  activo             boolean not null default true,
  created_at         timestamptz not null default now()
);

insert into asa_tipos_punto (codigo, nombre, prefijo_codigo, icono, color, frecuencia_default, requiere_foto, orden) values
  ('cebadero_roedor',    'Cebadero para roedores',  'CR', '🐀', '#b45309', 'semanal',  true,  10),
  ('lampara_moscas',     'Lámpara para moscas',     'LM', '💡', '#0891b2', 'semanal',  false, 20),
  ('dispensador_aerosol','Dispensador de aerosol',  'DA', '🧴', '#7c3aed', 'mensual',  false, 30),
  ('habitacion',         'Habitación',              'HAB','🛏️', '#16a34a', 'mensual',  false, 40),
  ('trampa_pegajosa',    'Trampa pegajosa',         'TP', '🪤', '#ca8a04', 'semanal',  true,  50),
  ('estacion_exterior',  'Estación perimetral',     'EP', '🌳', '#65a30d', 'mensual',  true,  60),
  ('apertura',           'Apertura / punto de sellado','AP','🚪','#dc2626', 'mensual',  true,  65),
  ('area_general',       'Área general / recorrido','AG', '📍', '#475569', 'diaria',   false, 70)
on conflict (codigo) do nothing;

-- ============================================================================
-- 4. Planos (para que el técnico ubique un punto que no conoce)
-- ============================================================================
create table if not exists asa_planos (
  id         uuid primary key default gen_random_uuid(),
  sitio_id   uuid not null references asa_sitios(id) on delete cascade,
  area_id    uuid references asa_areas(id) on delete set null,
  nombre     text not null,                   -- "Planta baja", "Nivel 3"
  imagen_url text not null,
  ancho_px   integer,
  alto_px    integer,
  orden      integer not null default 0,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_asa_planos_sitio on asa_planos (sitio_id) where activo;

-- ============================================================================
-- 5. PUNTOS DE CONTROL — el corazón del sistema
--
--    qr_token es inmutable: se genera una sola vez y un trigger impide
--    cambiarlo. Puedes renombrar el punto, moverlo de área o cambiarle el
--    código visible — la calcomanía pegada en la pared sigue siendo válida.
-- ============================================================================
create table if not exists asa_puntos_control (
  id                    uuid primary key default gen_random_uuid(),
  qr_token              text unique not null
                          default replace(gen_random_uuid()::text, '-', ''),
  sitio_id              uuid not null references asa_sitios(id) on delete cascade,
  area_id               uuid references asa_areas(id) on delete set null,
  tipo_punto_id         uuid not null references asa_tipos_punto(id),
  codigo_visible        text not null,        -- "CR-001" — este SÍ se puede cambiar
  nombre                text,                 -- "Cebadero pasillo cocina"
  ubicacion_descripcion text,                 -- "Detrás de la nevera industrial"
  frecuencia            text not null default 'mensual'
                          check (frecuencia in ('diaria','semanal','quincenal','mensual','trimestral','por_orden')),
  numero_habitacion     text,                 -- solo cuando el tipo es 'habitacion'
  plano_id              uuid references asa_planos(id) on delete set null,
  plano_x               numeric,              -- 0..100, porcentaje del ancho del plano
  plano_y               numeric,              -- 0..100, porcentaje del alto
  lat                   numeric,
  lng                   numeric,
  fecha_instalacion     date default current_date,
  notas                 text,
  activo                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (sitio_id, codigo_visible)
);
create index if not exists idx_asa_puntos_sitio  on asa_puntos_control (sitio_id) where activo;
create index if not exists idx_asa_puntos_area   on asa_puntos_control (area_id)  where activo;
create index if not exists idx_asa_puntos_tipo   on asa_puntos_control (tipo_punto_id);
create index if not exists idx_asa_puntos_qr     on asa_puntos_control (qr_token);

-- El QR nunca cambia, pase lo que pase con el resto del registro
create or replace function asa_fn_qr_inmutable() returns trigger as $$
begin
  if new.qr_token is distinct from old.qr_token then
    raise exception 'El código QR de un punto de control no se puede modificar (punto %). '
                    'Si necesitas un QR nuevo, desactiva este punto y crea otro.', old.codigo_visible;
  end if;
  new.updated_at := now();
  return new;
end $$ language plpgsql;

drop trigger if exists trg_asa_qr_inmutable on asa_puntos_control;
create trigger trg_asa_qr_inmutable before update on asa_puntos_control
  for each row execute function asa_fn_qr_inmutable();

-- ============================================================================
-- 6. Estrategias y preguntas del checklist
--    La estrategia se define al dar de alta el cliente/contrato. Sus preguntas
--    se asocian a un tipo de punto: al escanear un cebadero, el técnico ve las
--    preguntas de cebadero; al escanear una lámpara, las de lámpara.
-- ============================================================================
create table if not exists asa_estrategias (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid references asa_clientes(id) on delete cascade,
  contrato_id uuid references asa_contratos_plagas(id) on delete cascade,
  sitio_id    uuid references asa_sitios(id) on delete cascade,
  nombre      text not null,
  descripcion text,
  es_plantilla boolean not null default false,  -- plantilla reutilizable de ASA
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_asa_estrategias_cliente on asa_estrategias (cliente_id) where activo;

create table if not exists asa_preguntas (
  id             uuid primary key default gen_random_uuid(),
  estrategia_id  uuid not null references asa_estrategias(id) on delete cascade,
  tipo_punto_id  uuid references asa_tipos_punto(id) on delete cascade,  -- null = todos
  texto          text not null,
  tipo_respuesta text not null default 'si_no'
                   check (tipo_respuesta in ('si_no','numero','texto','seleccion','multiple','foto','escala')),
  opciones       jsonb default '[]'::jsonb,   -- para seleccion / multiple
  unidad         text,                        -- "%", "gramos", "unidades"
  obligatoria    boolean not null default true,
  requiere_foto_si jsonb,                     -- {"igual":"si"} → exige foto con esa respuesta
  genera_hallazgo_si jsonb,                   -- {"igual":"si"} → abre un hallazgo automático
  orden          integer not null default 0,
  activa         boolean not null default true,
  created_at     timestamptz not null default now()
);
create index if not exists idx_asa_preguntas_estrategia on asa_preguntas (estrategia_id) where activa;
create index if not exists idx_asa_preguntas_tipo       on asa_preguntas (tipo_punto_id);

-- Cada punto lleva su estrategia, como en el sistema que ASA usa hoy: el
-- Excel de puntos de control trae una columna ESTRATEGIA ("Estación de Cebo",
-- "Prevención y Mantenimiento", "Aperturas en las áreas"...) que es la que
-- decide qué preguntas ve el técnico. El tipo de punto dice QUÉ es el
-- dispositivo; la estrategia dice QUÉ SE HACE con él.
alter table asa_puntos_control
  add column if not exists estrategia_id uuid references asa_estrategias(id) on delete set null;
create index if not exists idx_asa_puntos_estrategia on asa_puntos_control (estrategia_id);

-- Código del contrato al que pertenece el punto en el sistema anterior
-- (ICB001, IC001). Se conserva para poder cruzar datos durante la migración.
alter table asa_puntos_control add column if not exists codigo_contrato_origen text;

-- ============================================================================
-- 7. Inspecciones — lo que el técnico registra al escanear
-- ============================================================================
create table if not exists asa_inspecciones (
  id               uuid primary key default gen_random_uuid(),
  punto_id         uuid not null references asa_puntos_control(id) on delete cascade,
  sitio_id         uuid not null references asa_sitios(id) on delete cascade,
  area_id          uuid references asa_areas(id) on delete set null,
  orden_trabajo_id uuid references asa_ordenes_trabajo(id) on delete set null,
  tecnico_id       uuid,                      -- FK a asa_empleados (diferida abajo)
  usuario_id       uuid references asa_usuarios(id) on delete set null,
  fecha            timestamptz not null default now(),
  fecha_local      date not null default (now() at time zone 'America/Santo_Domingo')::date,
  metodo_acceso    text not null default 'qr'
                     check (metodo_acceso in ('qr','busqueda','plano','manual')),
  estado_punto     text not null default 'ok'
                     check (estado_punto in ('ok','actividad','dañado','faltante','no_accesible','reemplazado')),
  nivel_actividad  text not null default 'ninguna'
                     check (nivel_actividad in ('ninguna','bajo','medio','alto')),
  requiere_accion  boolean not null default false,
  acciones         jsonb default '[]'::jsonb, -- productos aplicados, reemplazos, etc.
  fotos            jsonb default '[]'::jsonb,
  notas            text,
  lat              numeric,
  lng              numeric,
  sincronizada_offline boolean not null default false,
  created_at       timestamptz not null default now()
);
create index if not exists idx_asa_insp_punto  on asa_inspecciones (punto_id, fecha desc);
create index if not exists idx_asa_insp_sitio  on asa_inspecciones (sitio_id, fecha_local desc);
create index if not exists idx_asa_insp_fecha  on asa_inspecciones (fecha_local desc);
create index if not exists idx_asa_insp_ot     on asa_inspecciones (orden_trabajo_id);

create table if not exists asa_inspeccion_respuestas (
  id            uuid primary key default gen_random_uuid(),
  inspeccion_id uuid not null references asa_inspecciones(id) on delete cascade,
  pregunta_id   uuid references asa_preguntas(id) on delete set null,
  pregunta_texto text not null,               -- copia histórica: si editan la pregunta,
                                              -- el reporte viejo sigue diciendo lo que se preguntó
  valor_texto   text,
  valor_numero  numeric,
  valor_bool    boolean,
  valor_opciones jsonb default '[]'::jsonb,
  fotos         jsonb default '[]'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists idx_asa_resp_inspeccion on asa_inspeccion_respuestas (inspeccion_id);

-- ============================================================================
-- 8. Hallazgos / condiciones abiertas
--    Lo que ASA reporta y el hotel debe corregir (puerta que no sella, drenaje
--    sin rejilla). Deja constancia de que se reportó — sirve en auditorías.
-- ============================================================================
create table if not exists asa_hallazgos (
  id            uuid primary key default gen_random_uuid(),
  sitio_id      uuid not null references asa_sitios(id) on delete cascade,
  area_id       uuid references asa_areas(id) on delete set null,
  punto_id      uuid references asa_puntos_control(id) on delete set null,
  inspeccion_id uuid references asa_inspecciones(id) on delete set null,
  titulo        text not null,
  descripcion   text,
  severidad     text not null default 'media' check (severidad in ('baja','media','alta','critica')),
  responsable   text not null default 'cliente' check (responsable in ('cliente','asa')),
  estado        text not null default 'abierto'
                  check (estado in ('abierto','en_proceso','corregido','aceptado_riesgo')),
  fotos         jsonb default '[]'::jsonb,
  fecha_reporte timestamptz not null default now(),
  fecha_limite  date,
  fecha_cierre  timestamptz,
  cerrado_por   uuid references asa_usuarios(id) on delete set null,
  nota_cierre   text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_asa_hallazgos_sitio on asa_hallazgos (sitio_id, estado);

-- ============================================================================
-- 9. Portal del hotel: qué sitios puede ver cada usuario de calidad
-- ============================================================================
create table if not exists asa_usuario_sitios (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references asa_usuarios(id) on delete cascade,
  sitio_id   uuid not null references asa_sitios(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (usuario_id, sitio_id)
);
create index if not exists idx_asa_usuario_sitios_usuario on asa_usuario_sitios (usuario_id);

-- ============================================================================
-- 10. Vistas de apoyo: el semáforo de "hechos hoy" vs "pendientes"
-- ============================================================================

-- Última inspección de cada punto
create or replace view asa_v_puntos_estado as
select
  p.id                 as punto_id,
  p.qr_token,
  p.sitio_id,
  p.area_id,
  a.nombre             as area_nombre,
  p.codigo_visible,
  p.nombre             as punto_nombre,
  p.numero_habitacion,
  p.frecuencia,
  t.codigo             as tipo_codigo,
  t.nombre             as tipo_nombre,
  t.icono              as tipo_icono,
  t.color              as tipo_color,
  ult.fecha            as ultima_inspeccion,
  ult.estado_punto     as ultimo_estado,
  ult.nivel_actividad  as ultimo_nivel,
  case p.frecuencia
    when 'diaria'     then 1
    when 'semanal'    then 7
    when 'quincenal'  then 15
    when 'mensual'    then 30
    when 'trimestral' then 90
    else null
  end                  as dias_ciclo,
  case
    when ult.fecha is null then true
    when p.frecuencia = 'por_orden' then false
    else (now() - ult.fecha) >= (
      case p.frecuencia
        when 'diaria'     then interval '1 day'
        when 'semanal'    then interval '7 days'
        when 'quincenal'  then interval '15 days'
        when 'mensual'    then interval '30 days'
        when 'trimestral' then interval '90 days'
      end)
  end                  as vencido
from asa_puntos_control p
join asa_tipos_punto t on t.id = p.tipo_punto_id
left join asa_areas a  on a.id = p.area_id
left join lateral (
  select i.fecha, i.estado_punto, i.nivel_actividad
    from asa_inspecciones i
   where i.punto_id = p.id
   order by i.fecha desc
   limit 1
) ult on true
where p.activo;

-- Qué se hizo hoy y qué falta, por hotel
create or replace view asa_v_avance_dia as
select
  p.sitio_id,
  (now() at time zone 'America/Santo_Domingo')::date as fecha,
  count(*)                                        as puntos_totales,
  count(*) filter (where hoy.punto_id is not null) as realizados,
  count(*) filter (where hoy.punto_id is null)     as pendientes
from asa_puntos_control p
left join lateral (
  select i.punto_id
    from asa_inspecciones i
   where i.punto_id = p.id
     and i.fecha_local = (now() at time zone 'America/Santo_Domingo')::date
   limit 1
) hoy on true
where p.activo
group by p.sitio_id;

-- ============================================================================
-- 11. Llaves foráneas diferidas (asa_empleados ya existe a esta altura)
-- ============================================================================
do $$
begin
  if to_regclass('public.asa_empleados') is not null
     and not exists (select 1 from pg_constraint where conname = 'fk_asa_insp_tecnico') then
    alter table asa_inspecciones
      add constraint fk_asa_insp_tecnico
      foreign key (tecnico_id) references asa_empleados(id) on delete set null;
  end if;
end $$;

-- ============================================================================
-- 12. Verificación
-- ============================================================================
do $$
declare faltan text := '';
begin
  foreach faltan in array array[
    'asa_contrato_sitios','asa_areas','asa_tipos_punto','asa_planos',
    'asa_puntos_control','asa_estrategias','asa_preguntas',
    'asa_inspecciones','asa_inspeccion_respuestas','asa_hallazgos','asa_usuario_sitios'
  ] loop
    if to_regclass('public.' || faltan) is null then
      raise exception 'No se creó la tabla %', faltan;
    end if;
  end loop;
  raise notice 'OK — 11 tablas nuevas, 2 vistas y el catálogo de tipos de punto están listos.';
end $$;
