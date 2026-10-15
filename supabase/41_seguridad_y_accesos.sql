-- ============================================================================
-- 41_seguridad_y_accesos.sql — Ambiente y Salud RD (ASA SRL)
--
-- 1. Personas autorizadas en cada cuenta de hotel (asa_usuario_personas).
--    La cuenta del hotel (hotel@ambienteysaludrd.com + clave) es compartida;
--    además de la clave, cada persona confirma quién es con SU correo (Google,
--    Microsoft/Hotmail o un código). Si no está en esta lista, o está
--    desactivada, no entra aunque sepa la clave.
--
-- 2. Seguridad de la base (RLS): nadie entra a las tablas con la clave pública
--    (anon) de Supabase. Solo el servidor de ASA, que usa la service key, lee
--    y escribe. La clave pública queda solo para el inicio de sesión con
--    Google / Microsoft / código, que no toca ninguna tabla.
--
-- Es idempotente: se puede correr más de una vez.
-- ============================================================================

create table if not exists asa_usuario_personas (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null references asa_usuarios(id) on delete cascade,
  nombre        text not null,
  email         text not null,
  activo        boolean not null default true,
  ultimo_acceso timestamptz,
  creado_por    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists asa_usuario_personas_email_uk on asa_usuario_personas (usuario_id, lower(email));
create index if not exists asa_usuario_personas_email_idx on asa_usuario_personas (lower(email));

-- Solo Google / Microsoft / código para el personal (menos admin), cuando se active
insert into asa_config_sistema (clave, valor)
values ('acceso', '{"solo_correo_personal": false}'::jsonb)
on conflict (clave) do nothing;

-- ── RLS en TODAS las tablas del esquema public ──────────────────────────────
-- Sin políticas = nadie con anon/authenticated puede leer ni escribir. El
-- backend usa service_role, que salta RLS, así que el sistema sigue igual.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- Las vistas no tienen RLS propia: se les quita el permiso directamente.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from anon, authenticated;
-- Lo que se cree después nace igual de cerrado
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

notify pgrst, 'reload schema';

-- Resultado: tablas_sin_rls debe ser 0
select
  (select count(*) from pg_tables where schemaname = 'public') as tablas,
  (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity) as tablas_sin_rls,
  (select count(*) from asa_usuario_personas) as personas_autorizadas;
