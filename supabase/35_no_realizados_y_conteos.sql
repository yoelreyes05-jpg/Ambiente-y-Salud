-- ============================================================================
-- 35_no_realizados_y_conteos.sql — Ambiente y Salud RD (ASA SRL)
--
-- Corrige lo que ya está guardado de los dos problemas arreglados en el código:
--
-- 1. Servicios en los que el técnico respondió "No" a "¿Se realizó el
--    tratamiento / la aplicación?" pero quedaron como REALIZADOS (en verde).
--    Pasan a "no realizado" (motivo "otro"), así el punto vuelve a quedar
--    pendiente y en amarillo. Si estaban en una solicitud del hotel, esa
--    habitación vuelve a "no se pudo".
--
-- 2. Los conteos de plagas (asa_capturas) que la app mandaba se perdían por un
--    error del servidor. Esos números NO se pueden recuperar: nunca llegaron a
--    la base. Este archivo no toca capturas; solo deja dicho por qué faltan.
--
-- Es idempotente: se puede correr dos veces.
-- ============================================================================

set search_path = public, extensions;

with mal as (
  select distinct i.id
    from asa_inspecciones i
    join asa_inspeccion_respuestas r on r.inspeccion_id = i.id
   where i.motivo_no_realizado is null
     and r.valor_bool = false
     and r.pregunta_texto ~* 'se\s+realiz'
)
update asa_inspecciones i
   set motivo_no_realizado = 'otro',
       estado_punto        = 'no_accesible',
       nivel_actividad     = 'ninguna',
       notas = concat_ws(' · ', nullif(i.notas, ''), 'Corregido: el técnico respondió que NO se realizó')
  from mal
 where i.id = mal.id;

update asa_orden_puntos op
   set estado = 'no_realizado',
       motivo_no_realizado = 'otro'
  from asa_inspecciones i
 where op.inspeccion_id = i.id
   and op.estado = 'hecho'
   and i.motivo_no_realizado is not null;

-- Comprobación: cuántos servicios quedaron marcados como no realizados por esta regla
select count(*) as servicios_corregidos
  from asa_inspecciones
 where notas like '%Corregido: el técnico respondió que NO se realizó%';
