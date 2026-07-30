-- ============================================================================
-- Ambiente y Salud RD (ASA SRL) — 05. Salud Ambiental / Control de Plagas
-- Contratos, órdenes de trabajo, IPM (estaciones/lecturas) y permisos
-- ============================================================================

set search_path = public, extensions;

-- ── Guarda de dependencias ──────────────────────────────────────────────────
do $$
declare faltan text := '';
begin
  if to_regtype('public.asa_frecuencia_contrato') is null
     or to_regtype('public.asa_estado_ot') is null
     or to_regtype('public.asa_origen_ot') is null
     or to_regtype('public.asa_prioridad') is null
     or to_regtype('public.asa_tipo_permiso') is null
     or to_regtype('public.asa_estado_permiso') is null then
    faltan := faltan || ' 01_extensiones_y_tipos.sql';
  end if;
  if to_regclass('public.asa_clientes') is null
     or to_regclass('public.asa_sitios') is null then
    faltan := faltan || ' 02_clientes_mascotas.sql';
  end if;
  if faltan <> '' then
    raise exception
      'DEPENDENCIA FALTANTE. Ejecuta primero:%. O usa 00_INSTALL_COMPLETO.sql, que instala todo en el orden correcto.', faltan;
  end if;
end $$;

-- Contratos / planes recurrentes por sitio
create table if not exists asa_contratos_plagas (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references asa_clientes(id) on delete cascade,
  sitio_id          uuid not null references asa_sitios(id) on delete cascade,
  frecuencia        asa_frecuencia_contrato not null default 'mensual',
  precio            numeric(10,2) not null default 0,
  alcance           text,                 -- descripción del alcance del servicio
  fecha_inicio      date not null default current_date,
  fecha_fin         date,
  condiciones_pago  text,
  activo            boolean not null default true,
  created_at        timestamptz not null default now()
);
create index if not exists asa_contratos_plagas_cliente_idx on asa_contratos_plagas (cliente_id);
create index if not exists asa_contratos_plagas_sitio_idx on asa_contratos_plagas (sitio_id);

-- Orden de trabajo (OT): el corazón del flujo "reportar plaga → OT" de la app.
create table if not exists asa_ordenes_trabajo (
  id                    uuid primary key default gen_random_uuid(),
  numero_orden          text unique,               -- generado por trigger/función (ver 12)
  cliente_id            uuid not null references asa_clientes(id) on delete cascade,
  sitio_id              uuid not null references asa_sitios(id) on delete cascade,
  contrato_id           uuid references asa_contratos_plagas(id) on delete set null,
  tecnico_id            uuid,                      -- referencia lógica a asa_empleados
  origen                asa_origen_ot not null default 'app_cliente',
  estado                asa_estado_ot not null default 'solicitada',
  prioridad             asa_prioridad not null default 'normal',
  tipo_plaga_reportada  text,                       -- lo que indica el cliente en la app
  descripcion_cliente   text,                       -- comentario libre del cliente
  fotos_cliente         jsonb default '[]'::jsonb,
  diagnostico           text,
  plan_tratamiento       text,
  fecha_solicitud        timestamptz not null default now(),
  fecha_agendada         timestamptz,
  fecha_ejecucion        timestamptz,
  evidencias_tecnico     jsonb default '[]'::jsonb, -- fotos antes/después
  firma_cliente          text,                      -- imagen base64/url
  observaciones_qc       text,
  aprobado_qc            boolean,
  factura_id             uuid,                      -- referencia lógica a asa_facturas (08)
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists asa_ordenes_trabajo_cliente_idx on asa_ordenes_trabajo (cliente_id);
create index if not exists asa_ordenes_trabajo_sitio_idx on asa_ordenes_trabajo (sitio_id);
create index if not exists asa_ordenes_trabajo_estado_idx on asa_ordenes_trabajo (estado);

-- Bitácora inmutable de cambios de estado de la OT (auditoría del flujo)
create table if not exists asa_ordenes_trabajo_log (
  id                uuid primary key default gen_random_uuid(),
  orden_id          uuid not null references asa_ordenes_trabajo(id) on delete cascade,
  estado_anterior   asa_estado_ot,
  estado_nuevo      asa_estado_ot not null,
  usuario_id        uuid,                -- referencia lógica a asa_usuarios (11)
  usuario_nombre    text,
  motivo            text,
  created_at        timestamptz not null default now()
);
create index if not exists asa_ordenes_trabajo_log_orden_idx on asa_ordenes_trabajo_log (orden_id);

-- Estaciones de monitoreo IPM (cebo/trampas) por sitio, con QR propio
create table if not exists asa_ipm_estaciones (
  id                  uuid primary key default gen_random_uuid(),
  sitio_id            uuid not null references asa_sitios(id) on delete cascade,
  codigo_qr           text unique not null,
  tipo_estacion       text not null default 'cebo_roedor'
                        check (tipo_estacion in ('cebo_roedor','trampa_insecto','luz_uv','trampa_pegajosa','otro')),
  ubicacion_descripcion text,
  activo              boolean not null default true,
  created_at          timestamptz not null default now()
);
create index if not exists asa_ipm_estaciones_sitio_idx on asa_ipm_estaciones (sitio_id);

-- Lecturas/inspecciones de cada estación (tendencias y alertas de umbral)
create table if not exists asa_ipm_lecturas (
  id                  uuid primary key default gen_random_uuid(),
  estacion_id         uuid not null references asa_ipm_estaciones(id) on delete cascade,
  orden_trabajo_id    uuid references asa_ordenes_trabajo(id) on delete set null,
  tecnico_id          uuid,               -- referencia lógica a asa_empleados
  fecha               timestamptz not null default now(),
  actividad_detectada text,
  nivel_actividad     text default 'ninguna' check (nivel_actividad in ('ninguna','bajo','medio','alto')),
  foto_url            text,
  notas                text
);
create index if not exists asa_ipm_lecturas_estacion_idx on asa_ipm_lecturas (estacion_id);

-- Permisos y cumplimiento regulatorio (Agricultura, Salud Pública, Medio Ambiente, SSO)
create table if not exists asa_permisos_regulatorios (
  id                uuid primary key default gen_random_uuid(),
  tipo              asa_tipo_permiso not null,
  numero_documento  text,
  entidad_emisora   text,
  fecha_emision     date,
  fecha_vencimiento date,
  archivo_url       text,
  estado            asa_estado_permiso not null default 'vigente',
  notas             text,
  created_at        timestamptz not null default now()
);
create index if not exists asa_permisos_regulatorios_venc_idx on asa_permisos_regulatorios (fecha_vencimiento);
