-- ============================================================================
-- Ambiente y Salud RD (ASA SRL) — INSTALACIÓN COMPLETA (archivo único)
-- ============================================================================
-- POR QUÉ EXISTE ESTE ARCHIVO
--
-- El error `42P01: relation "asa_mascotas" does not exist` ocurre porque el
-- SQL Editor de Supabase ejecuta TODO el script en UNA sola transacción: si
-- una sentencia falla, se revierte el archivo entero. Basta con que falte un
-- tipo ENUM (archivo 01) para que el archivo 02 se revierta completo y
-- `asa_mascotas` nunca llegue a existir; a partir de ahí los archivos 03, 04,
-- 05... fallan en cadena con 42P01.
--
-- Este archivo contiene los 12 módulos en el orden correcto de dependencias,
-- de modo que nunca puede fallar por orden ni por ejecución parcial.
--
-- CÓMO USARLO
--   1. Abre el SQL Editor de Supabase.
--   2. Pega este archivo COMPLETO y ejecuta una sola vez.
--   3. Ejecuta 99_VERIFICAR.sql para confirmar que las 42 tablas existen.
--
-- Es idempotente: se puede volver a correr sin romper nada.
-- Todos los objetos usan el prefijo `asa_` (ver 00_README.md).
-- ============================================================================

-- Fija el esquema de trabajo. Si el search_path no incluye `public`, TODAS las
-- consultas fallan con 42P01 aunque las tablas sí existan en el Table Editor.
set search_path = public, extensions;


-- ============================================================================
-- 01. EXTENSIONES Y TIPOS (ENUM)
-- ============================================================================

-- En Supabase las extensiones viven en el esquema `extensions`; en un Postgres
-- normal, en `public`. Se intentan ambos para que el script sea portable.
do $$
begin
  begin
    create extension if not exists pgcrypto with schema extensions;
  exception when others then
    begin
      create extension if not exists pgcrypto;
    exception when others then null;
    end;
  end;
end $$;

-- ── Roles y personas ────────────────────────────────────────────────────────
do $$ begin
  create type asa_rol_usuario as enum (
    'admin', 'comercial', 'operaciones', 'tecnico_plagas',
    'veterinario', 'groomer', 'cajero', 'contabilidad', 'nomina', 'cliente'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type asa_especie as enum ('canino', 'felino', 'otro');
exception when duplicate_object then null; end $$;

do $$ begin
  create type asa_sexo_mascota as enum ('macho', 'hembra', 'desconocido');
exception when duplicate_object then null; end $$;

-- ── Línea: Salud Ambiental / Control de Plagas ──────────────────────────────
do $$ begin
  create type asa_estado_ot as enum (
    'solicitada', 'agendada', 'en_ruta', 'en_sitio',
    'ejecutada', 'control_calidad', 'facturada', 'cerrada', 'cancelada'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type asa_origen_ot as enum ('contrato', 'app_cliente', 'llamada', 'inspeccion', 'mostrador');
exception when duplicate_object then null; end $$;

do $$ begin
  create type asa_prioridad as enum ('baja', 'normal', 'alta', 'urgente');
exception when duplicate_object then null; end $$;

do $$ begin
  create type asa_frecuencia_contrato as enum ('mensual', 'bimensual', 'trimestral', 'semestral', 'anual', 'unico');
exception when duplicate_object then null; end $$;

-- ── Línea: Veterinaria y Estética ───────────────────────────────────────────
do $$ begin
  create type asa_tipo_tratamiento as enum ('vacuna', 'desparasitante', 'otro_preventivo');
exception when duplicate_object then null; end $$;

do $$ begin
  create type asa_tipo_servicio_cita as enum ('consulta', 'vacunacion', 'desparasitacion', 'estetica', 'cirugia', 'emergencia', 'seguimiento');
exception when duplicate_object then null; end $$;

do $$ begin
  create type asa_estado_cita as enum ('solicitada', 'confirmada', 'en_curso', 'completada', 'cancelada', 'no_asistio');
exception when duplicate_object then null; end $$;

-- ── Línea: Tienda / Facturación / Finanzas ──────────────────────────────────
do $$ begin
  create type asa_metodo_pago as enum ('efectivo', 'tarjeta', 'transferencia', 'cheque', 'credito');
exception when duplicate_object then null; end $$;

-- Tipos de e-CF vigentes según la Ley 32-23 (DGII República Dominicana)
do $$ begin
  create type asa_tipo_ecf as enum (
    'e31', -- Crédito Fiscal
    'e32', -- Consumo
    'e33', -- Nota de Débito
    'e34', -- Nota de Crédito
    'e41', -- Compras
    'e43', -- Gastos Menores
    'e44', -- Regímenes Especiales
    'e45', -- Gubernamental
    'e46', -- Exportaciones
    'e47'  -- Pagos al Exterior
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type asa_estado_dgii as enum ('pendiente', 'en_proceso', 'aceptado', 'rechazado', 'contingencia', 'anulado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type asa_estado_factura as enum ('borrador', 'emitida', 'pagada', 'parcial', 'vencida', 'anulada');
exception when duplicate_object then null; end $$;

-- ── Cumplimiento regulatorio ─────────────────────────────────────────────────
do $$ begin
  create type asa_tipo_permiso as enum (
    'ministerio_agricultura', 'ministerio_salud_publica', 'ministerio_medio_ambiente',
    'certificacion_sso', 'otro'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type asa_estado_permiso as enum ('vigente', 'por_vencer', 'vencido', 'en_tramite');
exception when duplicate_object then null; end $$;


-- ============================================================================
-- 02. CLIENTES, SITIOS Y MASCOTAS
-- ============================================================================

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

-- Sitios / ubicaciones de servicio (línea de plagas)
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


-- ============================================================================
-- 03. VETERINARIA: FICHAS CLÍNICAS Y VACUNACIÓN
-- ============================================================================

-- Ficha clínica = un evento/consulta en la vida de la mascota (expediente).
create table if not exists asa_fichas_clinicas (
  id                  uuid primary key default gen_random_uuid(),
  mascota_id          uuid not null references asa_mascotas(id) on delete cascade,
  veterinario_id      uuid,                 -- FK a asa_empleados, se agrega al final
  cita_id             uuid,                 -- FK a asa_citas, se agrega al final
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

-- Aplicación real de una vacuna/tratamiento a una mascota (carnet digital).
create table if not exists asa_tratamientos_aplicados (
  id                    uuid primary key default gen_random_uuid(),
  mascota_id            uuid not null references asa_mascotas(id) on delete cascade,
  tratamiento_id        uuid not null references asa_tratamientos_catalogo(id),
  ficha_id              uuid references asa_fichas_clinicas(id) on delete set null,
  veterinario_id        uuid,                     -- FK a asa_empleados, se agrega al final
  lote                  text,
  fecha_vencimiento_lote date,
  fecha_aplicacion      date not null default current_date,
  proxima_fecha         date,                      -- fecha_aplicacion + intervalo_dias_refuerzo
  recordatorio_enviado  boolean not null default false,
  notas                 text,
  created_at            timestamptz not null default now()
);
create index if not exists asa_tratamientos_aplicados_mascota_idx on asa_tratamientos_aplicados (mascota_id);
create index if not exists asa_tratamientos_aplicados_proxima_idx on asa_tratamientos_aplicados (proxima_fecha) where recordatorio_enviado = false;


-- ============================================================================
-- 04. CITAS Y ESTÉTICA CANINA
-- ============================================================================

-- OJO: esta es asa_citas — NO confundir con la tabla genérica "citas" que ya
-- usa la clínica médica humana en esta misma base de datos.
create table if not exists asa_citas (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid not null references asa_clientes(id) on delete cascade,
  mascota_id          uuid references asa_mascotas(id) on delete set null,
  tipo_servicio       asa_tipo_servicio_cita not null default 'consulta',
  especialista_id     uuid,                 -- FK a asa_empleados, se agrega al final
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
  groomer_id    uuid,                       -- FK a asa_empleados, se agrega al final
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


-- ============================================================================
-- 05. SALUD AMBIENTAL / CONTROL DE PLAGAS
-- ============================================================================

-- Contratos / planes recurrentes por sitio
create table if not exists asa_contratos_plagas (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references asa_clientes(id) on delete cascade,
  sitio_id          uuid not null references asa_sitios(id) on delete cascade,
  frecuencia        asa_frecuencia_contrato not null default 'mensual',
  precio            numeric(10,2) not null default 0,
  alcance           text,
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
  numero_orden          text unique,
  cliente_id            uuid not null references asa_clientes(id) on delete cascade,
  sitio_id              uuid not null references asa_sitios(id) on delete cascade,
  contrato_id           uuid references asa_contratos_plagas(id) on delete set null,
  tecnico_id            uuid,                      -- FK a asa_empleados, se agrega al final
  origen                asa_origen_ot not null default 'app_cliente',
  estado                asa_estado_ot not null default 'solicitada',
  prioridad             asa_prioridad not null default 'normal',
  tipo_plaga_reportada  text,
  descripcion_cliente   text,
  fotos_cliente         jsonb default '[]'::jsonb,
  diagnostico           text,
  plan_tratamiento      text,
  fecha_solicitud       timestamptz not null default now(),
  fecha_agendada        timestamptz,
  fecha_ejecucion       timestamptz,
  evidencias_tecnico    jsonb default '[]'::jsonb, -- fotos antes/después
  firma_cliente         text,
  observaciones_qc      text,
  aprobado_qc           boolean,
  factura_id            uuid,                      -- FK a asa_facturas, se agrega al final
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists asa_ordenes_trabajo_cliente_idx on asa_ordenes_trabajo (cliente_id);
create index if not exists asa_ordenes_trabajo_sitio_idx on asa_ordenes_trabajo (sitio_id);
create index if not exists asa_ordenes_trabajo_estado_idx on asa_ordenes_trabajo (estado);

-- Bitácora inmutable de cambios de estado de la OT
create table if not exists asa_ordenes_trabajo_log (
  id                uuid primary key default gen_random_uuid(),
  orden_id          uuid not null references asa_ordenes_trabajo(id) on delete cascade,
  estado_anterior   asa_estado_ot,
  estado_nuevo      asa_estado_ot not null,
  usuario_id        uuid,                -- FK a asa_usuarios, se agrega al final
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
  tecnico_id          uuid,               -- FK a asa_empleados, se agrega al final
  fecha               timestamptz not null default now(),
  actividad_detectada text,
  nivel_actividad     text default 'ninguna' check (nivel_actividad in ('ninguna','bajo','medio','alto')),
  foto_url            text,
  notas               text
);
create index if not exists asa_ipm_lecturas_estacion_idx on asa_ipm_lecturas (estacion_id);

-- Permisos y cumplimiento regulatorio
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


-- ============================================================================
-- 06. INVENTARIO: PLAGUICIDAS Y TIENDA
-- ============================================================================

-- Catálogo de plaguicidas (línea de plagas) con datos regulatorios
create table if not exists asa_plaguicidas_catalogo (
  id                    uuid primary key default gen_random_uuid(),
  nombre_comercial      text not null,
  principio_activo      text,
  categoria_toxicologica text,             -- I, II, III, IV
  registro_sanitario    text,
  ficha_seguridad_url   text,              -- SDS
  unidad_medida         text default 'ml',
  precio_costo          numeric(10,2),
  stock_actual          numeric(12,2) default 0,
  stock_minimo          numeric(12,2) default 0,
  activo                boolean not null default true,
  created_at            timestamptz not null default now()
);

-- Registro de cada aplicación de plaguicida durante una OT (trazabilidad)
create table if not exists asa_aplicaciones_productos (
  id                uuid primary key default gen_random_uuid(),
  orden_trabajo_id  uuid not null references asa_ordenes_trabajo(id) on delete cascade,
  producto_id       uuid not null references asa_plaguicidas_catalogo(id),
  lote              text,
  dosis             text,
  metodo_aplicacion text,
  area_tratada      text,
  cantidad_usada    numeric(10,2),
  tecnico_id        uuid,                 -- FK a asa_empleados, se agrega al final
  created_at        timestamptz not null default now()
);
create index if not exists asa_aplicaciones_productos_orden_idx on asa_aplicaciones_productos (orden_trabajo_id);

-- Catálogo de productos de tienda (alimentos, higiene, accesorios, etc.)
create table if not exists asa_productos_tienda (
  id              uuid primary key default gen_random_uuid(),
  codigo_barra    text unique,
  nombre          text not null,
  categoria       text,
  descripcion     text,
  precio_venta    numeric(10,2) not null default 0,
  precio_costo    numeric(10,2),
  itbis_aplica    boolean not null default true,
  unidad_medida   text default 'unidad',
  stock_actual    integer default 0,
  stock_minimo    integer default 0,
  imagen_url      text,
  activo          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists asa_productos_tienda_nombre_idx on asa_productos_tienda using gin (to_tsvector('spanish', nombre));

-- Ledger único de movimientos de inventario para las 3 fuentes de stock
create table if not exists asa_inventario_movimientos (
  id                uuid primary key default gen_random_uuid(),
  tipo_item         text not null check (tipo_item in ('plaguicida','producto_tienda','tratamiento')),
  item_id           uuid not null,          -- id en la tabla catálogo correspondiente
  tipo_movimiento   text not null check (tipo_movimiento in ('entrada','salida','ajuste','venta','aplicacion','merma')),
  cantidad          numeric(12,2) not null,
  stock_antes       numeric(12,2),
  stock_despues     numeric(12,2),
  referencia_tipo   text,                   -- 'orden_trabajo' | 'venta_pos' | 'tratamiento_aplicado' | 'compra'
  referencia_id     uuid,
  usuario           text,
  notas             text,
  created_at        timestamptz not null default now()
);
create index if not exists asa_inventario_movimientos_item_idx on asa_inventario_movimientos (tipo_item, item_id);


-- ============================================================================
-- 07. TIENDA / PUNTO DE VENTA (POS)
-- ============================================================================

create table if not exists asa_ventas_pos (
  id              uuid primary key default gen_random_uuid(),
  numero          text unique,             -- correlativo interno (no es el e-NCF)
  cliente_id      uuid references asa_clientes(id) on delete set null,  -- nullable: venta anónima
  cajero_id       uuid,                    -- FK a asa_empleados, se agrega al final
  subtotal        numeric(10,2) not null default 0,
  itbis           numeric(10,2) not null default 0,
  descuento       numeric(10,2) not null default 0,
  total           numeric(10,2) not null default 0,
  metodo_pago     asa_metodo_pago not null default 'efectivo',
  factura_id      uuid,                    -- FK a asa_facturas, se agrega al final
  anulada         boolean not null default false,
  motivo_anulacion text,
  created_at      timestamptz not null default now()
);
create index if not exists asa_ventas_pos_cliente_idx on asa_ventas_pos (cliente_id);
create index if not exists asa_ventas_pos_fecha_idx on asa_ventas_pos (created_at desc);

create table if not exists asa_ventas_pos_detalle (
  id            uuid primary key default gen_random_uuid(),
  venta_id      uuid not null references asa_ventas_pos(id) on delete cascade,
  producto_id   uuid not null references asa_productos_tienda(id),
  cantidad      integer not null default 1,
  precio_unitario numeric(10,2) not null default 0,
  itbis         numeric(10,2) not null default 0,
  subtotal      numeric(10,2) not null default 0
);
create index if not exists asa_ventas_pos_detalle_venta_idx on asa_ventas_pos_detalle (venta_id);

-- Arqueo de caja por turno/día (tienda)
create table if not exists asa_pos_cuadre_caja (
  id                  uuid primary key default gen_random_uuid(),
  fecha               date not null default current_date,
  usuario             text,
  ventas_efectivo     numeric(10,2) default 0,
  ventas_tarjeta      numeric(10,2) default 0,
  ventas_transferencia numeric(10,2) default 0,
  ventas_total        numeric(10,2) default 0,
  transacciones_count integer default 0,
  efectivo_inicial    numeric(10,2) default 0,
  efectivo_contado    numeric(10,2) default 0,
  diferencia          numeric(10,2) default 0,
  cerrado             boolean not null default false,
  notas               text,
  created_at          timestamptz not null default now()
);
create index if not exists asa_pos_cuadre_caja_fecha_idx on asa_pos_cuadre_caja (fecha);


-- ============================================================================
-- 08. FACTURACIÓN ELECTRÓNICA (e-CF / DGII)
-- ============================================================================

-- Secuencias internas de e-NCF por tipo de comprobante
create table if not exists asa_secuencias_ecf (
  tipo_ecf    asa_tipo_ecf primary key,
  prefijo     text not null,
  siguiente   integer not null default 1,
  maximo      integer not null default 50000000,
  activo      boolean not null default true
);

create table if not exists asa_facturas (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references asa_clientes(id) on delete restrict,
  tipo_origen     text not null check (tipo_origen in ('plaga','veterinaria','estetica','tienda')),
  origen_id       uuid,                    -- id de OT / cita / orden estética / venta POS
  tipo_ecf        asa_tipo_ecf not null default 'e32',
  e_ncf           text unique,             -- número de comprobante fiscal electrónico
  subtotal        numeric(12,2) not null default 0,
  itbis           numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  estado_dgii     asa_estado_dgii not null default 'pendiente',
  estado_factura  asa_estado_factura not null default 'emitida',
  acuse_dgii      jsonb,                   -- respuesta cruda del proveedor certificado / DGII
  xml_url         text,
  representacion_impresa_url text,
  fecha_emision   timestamptz not null default now(),
  creado_por      text,
  notas           text,
  created_at      timestamptz not null default now()
);
create index if not exists asa_facturas_cliente_idx on asa_facturas (cliente_id);
create index if not exists asa_facturas_origen_idx on asa_facturas (tipo_origen, origen_id);
create index if not exists asa_facturas_estado_idx on asa_facturas (estado_factura);

create table if not exists asa_factura_items (
  id                uuid primary key default gen_random_uuid(),
  factura_id        uuid not null references asa_facturas(id) on delete cascade,
  descripcion       text not null,
  cantidad          numeric(10,2) not null default 1,
  precio_unitario   numeric(10,2) not null default 0,
  itbis_aplica      boolean not null default true,
  subtotal          numeric(10,2) not null default 0
);
create index if not exists asa_factura_items_factura_idx on asa_factura_items (factura_id);

create table if not exists asa_pagos (
  id            uuid primary key default gen_random_uuid(),
  factura_id    uuid not null references asa_facturas(id) on delete cascade,
  monto         numeric(12,2) not null,
  metodo_pago   asa_metodo_pago not null default 'efectivo',
  fecha         timestamptz not null default now(),
  referencia    text,
  usuario       text,
  created_at    timestamptz not null default now()
);
create index if not exists asa_pagos_factura_idx on asa_pagos (factura_id);

-- Cuentas por cobrar (clientes con crédito / contratos recurrentes)
create table if not exists asa_cuentas_por_cobrar (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references asa_clientes(id) on delete cascade,
  factura_id        uuid references asa_facturas(id) on delete set null,
  monto_original    numeric(12,2) not null,
  monto_pagado      numeric(12,2) not null default 0,
  fecha_emision     date not null default current_date,
  fecha_vencimiento date not null,
  estado            text not null default 'pendiente' check (estado in ('pendiente','parcial','pagada','vencida')),
  notas             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists asa_cuentas_por_cobrar_cliente_idx on asa_cuentas_por_cobrar (cliente_id);
create index if not exists asa_cuentas_por_cobrar_estado_idx on asa_cuentas_por_cobrar (estado);


-- ============================================================================
-- 09. CONTABILIDAD
-- ============================================================================

create table if not exists asa_plan_cuentas (
  id              uuid primary key default gen_random_uuid(),
  codigo          text unique not null,     -- ej. 1-1000, 4-2000
  nombre          text not null,
  tipo            text not null check (tipo in ('activo','pasivo','patrimonio','ingreso','gasto')),
  cuenta_padre_id uuid references asa_plan_cuentas(id) on delete set null,
  activo          boolean not null default true,
  created_at      timestamptz not null default now()
);

create table if not exists asa_asientos_contables (
  id            uuid primary key default gen_random_uuid(),
  fecha         date not null default current_date,
  concepto      text not null,
  origen_tipo   text,        -- 'factura' | 'pago' | 'nomina' | 'compra' | 'ajuste'
  origen_id     uuid,
  usuario       text,
  created_at    timestamptz not null default now()
);

create table if not exists asa_asientos_detalle (
  id            uuid primary key default gen_random_uuid(),
  asiento_id    uuid not null references asa_asientos_contables(id) on delete cascade,
  cuenta_id     uuid not null references asa_plan_cuentas(id),
  centro_costo  text default 'general' check (centro_costo in ('plagas','veterinaria','tienda','general')),
  debito        numeric(12,2) not null default 0,
  credito       numeric(12,2) not null default 0
);
create index if not exists asa_asientos_detalle_asiento_idx on asa_asientos_detalle (asiento_id);
create index if not exists asa_asientos_detalle_cuenta_idx on asa_asientos_detalle (cuenta_id);

-- Suplidores (plaguicidas, vacunas, productos de tienda)
create table if not exists asa_suplidores (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  rnc         text,
  telefono    text,
  email       text,
  direccion   text,
  tipo_suministro text,     -- 'plaguicidas' | 'vacunas' | 'productos_tienda' | 'otro'
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists asa_cuentas_por_pagar (
  id                uuid primary key default gen_random_uuid(),
  suplidor_id       uuid references asa_suplidores(id) on delete set null,
  descripcion       text not null,
  monto_original    numeric(12,2) not null,
  monto_pagado      numeric(12,2) not null default 0,
  fecha_emision     date not null default current_date,
  fecha_vencimiento date not null,
  estado            text not null default 'pendiente' check (estado in ('pendiente','parcial','pagada','vencida')),
  notas             text,
  created_at        timestamptz not null default now()
);
create index if not exists asa_cuentas_por_pagar_suplidor_idx on asa_cuentas_por_pagar (suplidor_id);


-- ============================================================================
-- 10. EMPLEADOS, COMISIONES Y NÓMINA (TSS/ISR)
-- ============================================================================

create table if not exists asa_empleados (
  id                uuid primary key default gen_random_uuid(),
  nombre_completo   text not null,
  cedula            text unique,
  rol               asa_rol_usuario not null default 'tecnico_plagas',
  especialidad      text,            -- para veterinarios
  licencia_profesional text,         -- colegio médico veterinario, etc.
  telefono          text,
  email             text,
  salario_base      numeric(10,2) default 0,
  fecha_ingreso     date default current_date,
  activo            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists asa_comisiones (
  id            uuid primary key default gen_random_uuid(),
  empleado_id   uuid not null references asa_empleados(id) on delete cascade,
  origen_tipo   text not null check (origen_tipo in ('orden_trabajo','cita','venta_pos','estetica')),
  origen_id     uuid not null,
  monto         numeric(10,2) not null default 0,
  periodo_nomina_id uuid,           -- FK a asa_nomina_periodos, se agrega al final
  pagada        boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists asa_comisiones_empleado_idx on asa_comisiones (empleado_id);

create table if not exists asa_nomina_periodos (
  id            uuid primary key default gen_random_uuid(),
  fecha_inicio  date not null,
  fecha_fin     date not null,
  estado        text not null default 'abierto' check (estado in ('abierto','calculado','pagado','cerrado')),
  total_bruto   numeric(12,2) default 0,
  total_neto    numeric(12,2) default 0,
  created_at    timestamptz not null default now()
);

create table if not exists asa_nomina_detalle (
  id                uuid primary key default gen_random_uuid(),
  periodo_id        uuid not null references asa_nomina_periodos(id) on delete cascade,
  empleado_id       uuid not null references asa_empleados(id) on delete cascade,
  salario_bruto     numeric(10,2) not null default 0,
  comisiones        numeric(10,2) not null default 0,
  horas_extra       numeric(10,2) not null default 0,
  tss_sfs           numeric(10,2) not null default 0,   -- Seguro Familiar de Salud
  tss_afp           numeric(10,2) not null default 0,   -- Pensiones (AFP)
  tss_riesgo_laboral numeric(10,2) not null default 0,
  isr               numeric(10,2) not null default 0,
  infotep           numeric(10,2) not null default 0,
  otros_descuentos  numeric(10,2) not null default 0,
  salario_neto      numeric(10,2) not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists asa_nomina_detalle_periodo_idx on asa_nomina_detalle (periodo_id);
create index if not exists asa_nomina_detalle_empleado_idx on asa_nomina_detalle (empleado_id);


-- ============================================================================
-- 11. USUARIOS, ROLES Y AUDITORÍA
-- ============================================================================

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

create table if not exists asa_log_auditoria (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid references asa_usuarios(id) on delete set null,
  usuario_nombre text,
  accion        text not null,        -- 'crear' | 'actualizar' | 'eliminar' | 'cambio_estado'
  modulo        text not null,        -- 'clientes' | 'ordenes_trabajo' | 'facturacion' | ...
  registro_id   uuid,
  descripcion   text,
  detalle       jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists asa_log_auditoria_modulo_idx on asa_log_auditoria (modulo, created_at desc);
create index if not exists asa_log_auditoria_usuario_idx on asa_log_auditoria (usuario_id);


-- ============================================================================
-- 12. NOTIFICACIONES, CONFIGURACIÓN Y CACHÉ RNC
-- ============================================================================

create table if not exists asa_notificaciones (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid references asa_usuarios(id) on delete cascade,
  cliente_id    uuid references asa_clientes(id) on delete cascade,
  tipo          text not null,   -- 'recordatorio_vacuna' | 'ot_actualizada' | 'cita_confirmada' | ...
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


-- ============================================================================
-- 13. LLAVES FORÁNEAS DIFERIDAS
-- ----------------------------------------------------------------------------
-- Estas FK apuntan a tablas creadas en módulos posteriores (asa_empleados,
-- asa_citas, asa_facturas, asa_usuarios, asa_nomina_periodos). Se agregan aquí,
-- al final, cuando ya existen todas las tablas — así ningún módulo depende del
-- orden de ejecución y desaparece la causa raíz del error 42P01.
-- Cada ALTER se salta silenciosamente si la constraint ya existe.
-- ============================================================================

do $$
declare
  fk record;
begin
  for fk in
    select * from (values
      ('asa_ordenes_trabajo',        'asa_ot_tecnico_fk',          'tecnico_id',       'asa_empleados'),
      ('asa_fichas_clinicas',        'asa_ficha_vet_fk',           'veterinario_id',   'asa_empleados'),
      ('asa_fichas_clinicas',        'asa_ficha_cita_fk',          'cita_id',          'asa_citas'),
      ('asa_citas',                  'asa_citas_especialista_fk',  'especialista_id',  'asa_empleados'),
      ('asa_estetica_ordenes',       'asa_estetica_groomer_fk',    'groomer_id',       'asa_empleados'),
      ('asa_ipm_lecturas',           'asa_ipm_tecnico_fk',         'tecnico_id',       'asa_empleados'),
      ('asa_aplicaciones_productos', 'asa_aplic_tecnico_fk',       'tecnico_id',       'asa_empleados'),
      ('asa_ventas_pos',             'asa_ventas_cajero_fk',       'cajero_id',        'asa_empleados'),
      ('asa_ventas_pos',             'asa_ventas_factura_fk',      'factura_id',       'asa_facturas'),
      ('asa_tratamientos_aplicados', 'asa_trat_vet_fk',            'veterinario_id',   'asa_empleados'),
      ('asa_ordenes_trabajo',        'asa_ot_factura_fk',          'factura_id',       'asa_facturas'),
      ('asa_ordenes_trabajo_log',    'asa_ot_log_usuario_fk',      'usuario_id',       'asa_usuarios'),
      ('asa_comisiones',             'asa_comisiones_periodo_fk',  'periodo_nomina_id','asa_nomina_periodos')
    ) as t(tabla, constraint_name, columna, tabla_ref)
  loop
    if not exists (
      select 1 from pg_constraint
      where conname = fk.constraint_name
        and conrelid = to_regclass('public.' || fk.tabla)
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references public.%I(id) on delete set null',
        fk.tabla, fk.constraint_name, fk.columna, fk.tabla_ref
      );
    end if;
  end loop;
end $$;


-- ============================================================================
-- 14. SEMILLAS DE CONFIGURACIÓN
-- ============================================================================

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


-- ============================================================================
-- FIN. Ejecuta 99_VERIFICAR.sql para confirmar que las 42 tablas existen.
-- ============================================================================
