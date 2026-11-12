-- ============================================================================
-- 44_firmas_por_partes.sql — Ambiente y Salud RD (ASA SRL)
--
-- Firmar la orden del técnico por partes: una firma para todo, o varias
-- (una por área o por responsable: chef, ama de llaves, calidad…).
--   inspecciones → los servicios que cubre esa firma
--   parte        → qué se firmó ("Todo el servicio", "Cocina, Bar", "Ama de llaves")
-- Se quita la regla de "una sola firma por orden".
--
-- Requiere 43_firmas_servicio.sql. Es idempotente.
-- ============================================================================

alter table asa_firmas_servicio add column if not exists inspecciones jsonb;
alter table asa_firmas_servicio add column if not exists parte text;
alter table asa_firmas_servicio drop constraint if exists asa_firmas_servicio_sitio_id_fecha_clave_key;
create index if not exists asa_firmas_servicio_orden on asa_firmas_servicio (sitio_id, fecha, clave);

notify pgrst, 'reload schema';

select count(*) as firmas from asa_firmas_servicio;
