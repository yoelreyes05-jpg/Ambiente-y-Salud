-- ============================================================================
-- 39_rastreo_tecnicos.sql — Ambiente y Salud RD (ASA SRL)
--
-- Ubicación de los técnicos mientras tienen la app abierta, para ver en el
-- panel dónde está cada uno (como InDrive) y el recorrido que hizo en el día.
--
--   · asa_ubicaciones — un registro cada 30–60 segundos por técnico, solo en el
--     horario de trabajo que se configura en el panel.
--   · asa_sitios.lat / lng / radio_m — dónde queda cada hotel, para saber a
--     qué hora llegó y salió el técnico de cada uno.
--
-- Es idempotente: se puede correr más de una vez.
-- ============================================================================

create table if not exists asa_ubicaciones (
  id            bigserial primary key,
  usuario_id    uuid not null references asa_usuarios(id) on delete cascade,
  empleado_id   uuid references asa_empleados(id) on delete set null,
  lat           double precision not null,
  lng           double precision not null,
  precision_m   real,                       -- radio de error del GPS en metros
  velocidad     real,                       -- m/s, si el teléfono la da
  rumbo         real,                       -- grados, si el teléfono lo da
  bateria       real,                       -- 0..1, si el teléfono la da
  sitio_id      uuid references asa_sitios(id) on delete set null,  -- hotel donde estaba
  registrado_at timestamptz not null,       -- hora en que el teléfono tomó la ubicación
  fecha_local   date not null,              -- día en hora de RD
  created_at    timestamptz not null default now()
);

create index if not exists idx_asa_ubic_usuario_hora on asa_ubicaciones (usuario_id, registrado_at desc);
create index if not exists idx_asa_ubic_dia          on asa_ubicaciones (fecha_local, usuario_id);

-- Dónde queda cada hotel (centro y radio en metros). Si no se llena, el sistema
-- usa el centro del plano georreferenciado del hotel.
alter table asa_sitios add column if not exists lat     double precision;
alter table asa_sitios add column if not exists lng     double precision;
alter table asa_sitios add column if not exists radio_m integer default 400;

-- Que la API de Supabase vea la tabla y las columnas nuevas enseguida
notify pgrst, 'reload schema';

-- Comprobación
select 'asa_ubicaciones lista' as estado, count(*) as registros from asa_ubicaciones;
