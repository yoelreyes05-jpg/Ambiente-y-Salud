-- ============================================================================
-- 30_solicitudes_hotel.sql — Ambiente y Salud RD (ASA SRL)
--
-- Solicitudes del hotel: además de reportar una plaga, el hotel puede mandar
-- una LISTA DE HABITACIONES (las que ya salieron los huéspedes) para que el
-- técnico las trabaje. Es la hoja que hoy le entregan en papel.
--
-- Los tres lados ven lo mismo:
--   hotel   — crea la solicitud desde el portal y ve cada habitación en verde
--             o en rojo a medida que el técnico avanza
--   panel   — ve que el hotel la creó (queda "nueva" hasta que alguien la abre)
--   técnico — la ve arriba de su ruta; al inspeccionar una habitación de la
--             lista, esa habitación se marca sola como hecha
--
-- Cada solicitud tiene su hilo de mensajes entre los tres.
--
-- Se reutiliza asa_ordenes_trabajo (misma numeración ASA-000123, mismo
-- historial de estados) en vez de inventar otra tabla de órdenes.
--
-- Es idempotente. Requiere 05, 11, 20 y 25.
-- ============================================================================

set search_path = public, extensions;

-- ── 1. Columnas nuevas en la orden ─────────────────────────────────────────
alter table asa_ordenes_trabajo
  add column if not exists tipo_solicitud text not null default 'plaga',
  add column if not exists creado_por_usuario_id uuid references asa_usuarios(id) on delete set null,
  add column if not exists creado_por_nombre text,
  add column if not exists creado_por_rol text,
  add column if not exists fecha_requerida date,
  add column if not exists visto_admin_at timestamptz,
  add column if not exists visto_admin_nombre text,
  add column if not exists recibido_tecnico_at timestamptz,
  add column if not exists recibido_tecnico_nombre text;

do $$ begin
  alter table asa_ordenes_trabajo
    add constraint asa_ot_tipo_solicitud_chk check (tipo_solicitud in ('plaga', 'habitaciones', 'puntos', 'otro'));
exception when duplicate_object then null; end $$;

create index if not exists idx_asa_ot_sitio_estado on asa_ordenes_trabajo (sitio_id, estado);
create index if not exists idx_asa_ot_no_vistas on asa_ordenes_trabajo (created_at) where visto_admin_at is null;

-- ── 2. Habitaciones / puntos de cada solicitud ─────────────────────────────
create table if not exists asa_orden_puntos (
  id                  uuid primary key default gen_random_uuid(),
  orden_id            uuid not null references asa_ordenes_trabajo(id) on delete cascade,
  punto_id            uuid not null references asa_puntos_control(id) on delete cascade,
  estado              text not null default 'pendiente'
                        check (estado in ('pendiente', 'hecho', 'no_realizado', 'cancelado')),
  inspeccion_id       uuid references asa_inspecciones(id) on delete set null,
  motivo_no_realizado text,
  atendido_at         timestamptz,
  created_at          timestamptz not null default now(),
  unique (orden_id, punto_id)
);
create index if not exists idx_asa_orden_puntos_orden on asa_orden_puntos (orden_id);
create index if not exists idx_asa_orden_puntos_punto on asa_orden_puntos (punto_id) where estado in ('pendiente', 'no_realizado');

-- ── 3. Mensajes de la solicitud (hotel ↔ ASA ↔ técnico) ────────────────────
create table if not exists asa_orden_mensajes (
  id           uuid primary key default gen_random_uuid(),
  orden_id     uuid not null references asa_ordenes_trabajo(id) on delete cascade,
  usuario_id   uuid references asa_usuarios(id) on delete set null,
  autor_nombre text,
  autor_rol    text,
  texto        text not null check (length(trim(texto)) > 0),
  created_at   timestamptz not null default now()
);
create index if not exists idx_asa_orden_mensajes_orden on asa_orden_mensajes (orden_id, created_at);

-- ── 4. La habitación se marca sola cuando el técnico la inspecciona ────────
--
-- Corre en la base y no en el backend a propósito: la app del técnico sube
-- inspecciones por dos caminos (en línea y la cola offline) y así ninguno de
-- los dos se puede olvidar de marcar la solicitud.
--
-- Una inspección cuenta para la solicitud si es POSTERIOR a su creación.
-- Un "no pude entrar" deja la habitación en no_realizado (roja, con motivo);
-- si más tarde se hace, pasa a hecho.
create or replace function asa_marcar_solicitudes() returns trigger
language plpgsql as $$
declare
  o record;
  quedan int;
begin
  for o in
    select op.id as op_id, ot.id as orden_id, ot.estado
      from asa_orden_puntos op
      join asa_ordenes_trabajo ot on ot.id = op.orden_id
     where op.punto_id = new.punto_id
       and op.estado in ('pendiente', 'no_realizado')
       and ot.estado in ('solicitada', 'agendada', 'en_ruta', 'en_sitio')
       and new.fecha >= ot.created_at
  loop
    update asa_orden_puntos
       set estado = case when new.motivo_no_realizado is null then 'hecho' else 'no_realizado' end,
           inspeccion_id = new.id,
           motivo_no_realizado = new.motivo_no_realizado,
           atendido_at = new.fecha
     where id = o.op_id;

    select count(*) into quedan
      from asa_orden_puntos
     where orden_id = o.orden_id and estado in ('pendiente', 'no_realizado');

    if quedan = 0 then
      update asa_ordenes_trabajo
         set estado = 'ejecutada', fecha_ejecucion = now(), updated_at = now()
       where id = o.orden_id;
      insert into asa_ordenes_trabajo_log (orden_id, estado_anterior, estado_nuevo, usuario_nombre, motivo)
      values (o.orden_id, o.estado, 'ejecutada', 'Sistema', 'Todas las habitaciones de la solicitud quedaron hechas');
    elsif o.estado in ('solicitada', 'agendada', 'en_ruta') then
      update asa_ordenes_trabajo set estado = 'en_sitio', updated_at = now() where id = o.orden_id;
      insert into asa_ordenes_trabajo_log (orden_id, estado_anterior, estado_nuevo, usuario_nombre, motivo)
      values (o.orden_id, o.estado, 'en_sitio', 'Sistema', 'El técnico empezó a trabajar la solicitud');
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists trg_asa_marcar_solicitudes on asa_inspecciones;
create trigger trg_asa_marcar_solicitudes
  after insert on asa_inspecciones
  for each row execute function asa_marcar_solicitudes();

-- ── 5. Verificación ────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.columns
    where table_name = 'asa_ordenes_trabajo' and column_name = 'tipo_solicitud') as "columna tipo_solicitud",
  (select count(*) from information_schema.tables where table_name = 'asa_orden_puntos')   as "tabla orden_puntos",
  (select count(*) from information_schema.tables where table_name = 'asa_orden_mensajes') as "tabla orden_mensajes",
  (select count(*) from pg_trigger where tgname = 'trg_asa_marcar_solicitudes')            as "trigger";
