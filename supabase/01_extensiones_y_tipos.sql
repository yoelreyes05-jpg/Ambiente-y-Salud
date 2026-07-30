-- ============================================================================
-- Ambiente y Salud RD (ASA SRL) — 01. Extensiones y tipos (ENUM)
-- Prefijo obligatorio: asa_   (ver 00_README.md — aislamiento de datos)
-- Todas las tablas de este archivo/proyecto son EXCLUSIVAS de ASA.
-- ESTE ARCHIVO DEBE EJECUTARSE PRIMERO. Si falta, el archivo 02 se revierte
-- entero (el SQL Editor usa una sola transacción) y a partir de ahí todos los
-- demás fallan con `42P01: relation "asa_mascotas" does not exist`.
-- Alternativa recomendada: ejecutar 00_INSTALL_COMPLETO.sql (todo en orden).
-- ============================================================================

-- Fija el esquema. Si el search_path no incluye `public`, TODAS las consultas
-- fallan con 42P01 aunque las tablas sí existan en el Table Editor.
set search_path = public, extensions;

-- En Supabase las extensiones viven en el esquema `extensions`; en un Postgres
-- normal, en `public`. Se intentan ambos para que el script sea portable.
do $$
begin
  begin
    create extension if not exists pgcrypto with schema extensions;
  exception when others then
    begin
      create extension if not exists pgcrypto;   -- gen_random_uuid()
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
