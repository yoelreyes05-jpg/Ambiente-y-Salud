-- ============================================================================
-- 40_bloques_villas.sql — Ambiente y Salud RD (ASA SRL)
--
-- Hoteles cuyas habitaciones van por BLOQUES o por VILLAS (Catalonia Bayahibe,
-- Catalonia Royal…). Cada área dice qué es (bloque, villa, edificio, torre) y
-- cada habitación su piso. Se ve en el panel, en el portal del hotel y en la
-- app del técnico: "🏡 Villa Barahona · 2do piso".
--
-- Es idempotente: se puede correr más de una vez.
-- ============================================================================

alter table asa_areas add column if not exists agrupacion text;
alter table asa_areas drop constraint if exists asa_areas_agrupacion_check;
alter table asa_areas add constraint asa_areas_agrupacion_check
  check (agrupacion is null or agrupacion in ('bloque', 'villa', 'edificio', 'torre', 'otro'));

alter table asa_puntos_control add column if not exists piso text;

-- Las áreas que ya se llaman "Villa …" o "Bloque …" quedan marcadas solas
update asa_areas set agrupacion = 'villa'  where agrupacion is null and nombre ~* '^\s*villa\y';
update asa_areas set agrupacion = 'bloque' where agrupacion is null and nombre ~* '^\s*bloque\y';

notify pgrst, 'reload schema';

select agrupacion, count(*) as areas from asa_areas where agrupacion is not null group by agrupacion;
