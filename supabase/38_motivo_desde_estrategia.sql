-- ============================================================================
-- 38_motivo_desde_estrategia.sql — Ambiente y Salud RD (ASA SRL)
--
-- Habitaciones en las que el técnico contestó en la ESTRATEGIA por qué no se
-- pudo hacer ("¿Por qué no se pudo realizar?", "Motivo…") pero quedaron como
-- REALIZADAS (en verde). Pasan a "no realizado" con el motivo que escribió, así
-- vuelven a quedar pendientes y en amarillo, y el hotel ve por qué no se hizo.
-- Si estaban en una solicitud del hotel, esa habitación pasa a "no se pudo".
--
-- No toca las que tienen "Sí" en "¿Se realizó…?". Es idempotente.
-- ============================================================================

set search_path = public, extensions;

with motivo as (
  select distinct on (r.inspeccion_id)
         r.inspeccion_id,
         trim(concat_ws(', ', nullif(trim(r.valor_texto), ''),
              nullif((select string_agg(x, ', ') from jsonb_array_elements_text(coalesce(r.valor_opciones, '[]'::jsonb)) x), ''))) as texto
    from asa_inspeccion_respuestas r
   where r.pregunta_texto ~* '(no\s+se\s+(pudo|realiz|hizo)|por\s*qu[eé]\s+no|motivo|raz[oó]n)'
     and not (r.pregunta_texto ~* 'se\s+realiz' and r.valor_bool is not null)
   order by r.inspeccion_id
),
validos as (
  select m.*
    from motivo m
    join asa_inspecciones i on i.id = m.inspeccion_id
   where i.motivo_no_realizado is null
     and m.texto <> ''
     and m.texto !~* '^(n/?a|no aplica|ninguno|ninguna|-+|\.)$'
     and not exists (                              -- contestó "Sí, se realizó"
       select 1 from asa_inspeccion_respuestas s
        where s.inspeccion_id = m.inspeccion_id
          and s.pregunta_texto ~* 'se\s+realiz' and s.valor_bool = true)
)
update asa_inspecciones i
   set motivo_no_realizado = case
         when v.texto ~* '(hu[eé]sped|cliente dentro|no molestar|dnd)'        then 'huesped_en_habitacion'
         when v.texto ~* '(llave|nadie abr|no abr|cerrad)'                     then 'sin_llave'
         when v.texto ~* '(permiso|autoriz|no (me |nos )?dej|neg)'            then 'permiso_denegado'
         when v.texto ~* '(mantenimiento|obra|reparaci|remodel)'               then 'en_mantenimiento'
         when v.texto ~* 'evento'                                              then 'evento_en_curso'
         when v.texto ~* '(ocupad|limpiando|camarer)'                          then 'area_ocupada'
         when v.texto ~* '(bloquead|inaccesib|tapiad)'                         then 'punto_inaccesible'
         else 'otro' end,
       estado_punto    = 'no_accesible',
       nivel_actividad = 'ninguna',
       notas = concat_ws(' · ', nullif(i.notas, ''), 'No se pudo: ' || v.texto)
  from validos v
 where i.id = v.inspeccion_id;

update asa_orden_puntos op
   set estado = 'no_realizado',
       motivo_no_realizado = i.motivo_no_realizado
  from asa_inspecciones i
 where op.inspeccion_id = i.id
   and op.estado = 'hecho'
   and i.motivo_no_realizado is not null;

-- Comprobación: cuántas quedaron como no realizadas por esta regla
select count(*) as habitaciones_corregidas
  from asa_inspecciones
 where notas like '%No se pudo: %';
