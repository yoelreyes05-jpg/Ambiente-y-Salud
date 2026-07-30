-- ============================================================================
-- Ambiente y Salud RD (ASA SRL) — 11. Usuarios, roles y auditoría
-- ============================================================================

set search_path = public, extensions;

-- ── Guarda de dependencias ──────────────────────────────────────────────────
do $$
declare faltan text := '';
begin
  if to_regtype('public.asa_rol_usuario') is null then
    faltan := faltan || ' 01_extensiones_y_tipos.sql';
  end if;
  if to_regclass('public.asa_clientes') is null then
    faltan := faltan || ' 02_clientes_mascotas.sql';
  end if;
  if to_regclass('public.asa_empleados') is null then
    faltan := faltan || ' 10_nomina.sql';
  end if;
  if faltan <> '' then
    raise exception
      'DEPENDENCIA FALTANTE. Ejecuta primero:%. O usa 00_INSTALL_COMPLETO.sql, que instala todo en el orden correcto.', faltan;
  end if;
end $$;

-- Usuarios del sistema: incluye personal interno (admin/técnico/veterinario/
-- groomer/cajero/contabilidad/nómina) y clientes (login de la app móvil).
create table if not exists asa_usuarios (
  id              uuid primary key default gen_random_uuid(),
  email           text unique not null,
  password_hash   text not null,
  nombre_completo text not null,
  rol             asa_rol_usuario not null default 'cliente',
  empleado_id     uuid references asa_empleados(id) on delete set null,  -- si es personal interno
  cliente_id      uuid references asa_clientes(id) on delete set null,   -- si es cliente (app)
  activo          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  ultimo_acceso   timestamptz
);
create index if not exists asa_usuarios_rol_idx on asa_usuarios (rol);

-- Bitácora de auditoría (quién hizo qué y cuándo, por módulo)
create table if not exists asa_log_auditoria (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid references asa_usuarios(id) on delete set null,
  usuario_nombre text,
  accion        text not null,        -- 'crear' | 'actualizar' | 'eliminar' | 'cambio_estado' | etc.
  modulo        text not null,        -- 'clientes' | 'ordenes_trabajo' | 'facturacion' | ...
  registro_id   uuid,
  descripcion   text,
  detalle       jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists asa_log_auditoria_modulo_idx on asa_log_auditoria (modulo, created_at desc);
create index if not exists asa_log_auditoria_usuario_idx on asa_log_auditoria (usuario_id);
