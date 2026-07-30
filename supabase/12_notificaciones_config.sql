-- ============================================================================
-- Ambiente y Salud RD (ASA SRL) — 12. Notificaciones, configuración y RNC
-- ============================================================================

set search_path = public, extensions;

-- ── Guarda de dependencias ──────────────────────────────────────────────────
do $$
declare faltan text := '';
begin
  if to_regclass('public.asa_clientes') is null then
    faltan := faltan || ' 02_clientes_mascotas.sql';
  end if;
  if to_regclass('public.asa_secuencias_ecf') is null then
    faltan := faltan || ' 08_facturacion_ecf.sql';
  end if;
  if to_regclass('public.asa_usuarios') is null then
    faltan := faltan || ' 11_usuarios_roles_auditoria.sql';
  end if;
  if faltan <> '' then
    raise exception
      'DEPENDENCIA FALTANTE. Ejecuta primero:%. O usa 00_INSTALL_COMPLETO.sql, que instala todo en el orden correcto.', faltan;
  end if;
end $$;

create table if not exists asa_notificaciones (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid references asa_usuarios(id) on delete cascade,
  cliente_id    uuid references asa_clientes(id) on delete cascade,
  tipo          text not null,   -- 'recordatorio_vacuna' | 'ot_actualizada' | 'cita_confirmada' | 'factura_emitida' | 'recordatorio_ipm'
  titulo        text not null,
  mensaje       text not null,
  canal         text not null default 'push' check (canal in ('push','whatsapp','email')),
  leida         boolean not null default false,
  enviado_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists asa_notificaciones_cliente_idx on asa_notificaciones (cliente_id);
create index if not exists asa_notificaciones_usuario_idx on asa_notificaciones (usuario_id);

-- Configuración general del sistema (clave/valor flexible)
create table if not exists asa_config_sistema (
  clave       text primary key,
  valor       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Caché PROPIO de RNC/Cédula consultado a la DGII. Aislado a propósito de la
-- tabla "rnc_dgii" que ya usa el CRM automotriz (ver 00_README.md).
create table if not exists asa_rnc_cache (
  rnc               text primary key,
  razon_social      text,
  nombre_comercial  text,
  actividad         text,
  estado            text,        -- ACTIVO / SUSPENDIDO / etc.
  tipo              text,        -- RNC | CEDULA
  fuente            text,        -- 'dgii' | 'megaplus-fallback' | 'cache'
  updated_at        timestamptz not null default now()
);

-- Semillas mínimas de configuración (ajustar valores reales antes de producción)
insert into asa_config_sistema (clave, valor) values
  ('empresa', jsonb_build_object(
      'nombre', 'Ambiente y Salud RD (ASA SRL)',
      'telefono', '+1 (829) 260-5444',
      'email', 'info@ambienteysaludrd.com',
      'direccion', 'Av. Prof. Juan Bosch, Santo Domingo Este'
  )),
  ('itbis_porcentaje', '18'::jsonb)
on conflict (clave) do nothing;

insert into asa_secuencias_ecf (tipo_ecf, prefijo, siguiente, maximo, activo) values
  ('e31', 'E31', 1, 50000000, true),
  ('e32', 'E32', 1, 50000000, true),
  ('e33', 'E33', 1, 50000000, true),
  ('e34', 'E34', 1, 50000000, true)
on conflict (tipo_ecf) do nothing;
