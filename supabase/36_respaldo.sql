-- ═════════════════════════════════════════════════════════════════════════
-- 36_respaldo.sql — Ajuste de contadores después de restaurar un respaldo
--
-- Al restaurar el respaldo en Excel (Panel → Respaldo de datos), las filas
-- entran con su id de siempre. Las tablas de flota usan números seguidos
-- (bigserial) y las incidencias usan INC-00001, INC-00002…: si el contador no
-- se pone al día, lo próximo que se cree choca con lo restaurado.
--
-- Esta función lleva cada contador al mayor número que ya existe. La llama el
-- backend solo al terminar de restaurar. Correrla de más no hace daño.
-- ═════════════════════════════════════════════════════════════════════════

create or replace function asa_reajustar_secuencias()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
  seq text;
  maximo bigint;
begin
  -- Tablas con id numérico seguido (bigserial)
  foreach t in array array[
    'asa_flota_conductores', 'asa_flota_vehiculos', 'asa_flota_asignaciones',
    'asa_flota_checklist_items', 'asa_flota_fallas_catalogo', 'asa_flota_chequeos',
    'asa_flota_chequeo_items', 'asa_flota_fallas_reportadas', 'asa_flota_fotos',
    'asa_flota_gastos', 'asa_flota_documentos', 'asa_flota_mantenimientos'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    seq := pg_get_serial_sequence('public.' || t, 'id');
    if seq is null then continue; end if;
    execute format('select coalesce(max(id), 0) from %I', t) into maximo;
    if maximo > 0 then perform setval(seq, maximo, true); end if;
  end loop;

  -- Número de caso de chinche: INC-00042 → 42
  if to_regclass('public.asa_incidencias') is not null and to_regclass('public.asa_incidencias_seq') is not null then
    select coalesce(max(nullif(regexp_replace(numero, '\D', '', 'g'), '')::bigint), 0) into maximo from asa_incidencias;
    if maximo > 0 then perform setval('asa_incidencias_seq', maximo, true); end if;
  end if;
end $$;

grant execute on function asa_reajustar_secuencias() to service_role;
