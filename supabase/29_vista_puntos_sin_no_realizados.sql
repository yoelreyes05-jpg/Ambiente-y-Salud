-- ============================================================================
-- 29_vista_puntos_sin_no_realizados.sql — Ambiente y Salud RD (ASA SRL)
--
-- La vista asa_v_puntos_estado tomaba como "última inspección" cualquier
-- registro, incluido un NO REALIZADO ("huésped en la habitación", "sin
-- llave"...). Resultado: una habitación a la que no dejaron entrar quedaba en
-- verde, dentro de su frecuencia, durante todo el ciclo.
--
-- Ahora la última inspección es la última REALIZADA. Así el semáforo verde /
-- rojo del panel ("Pendientes por área") y del portal del hotel ("Por hacer")
-- deja en rojo lo que se intentó y no se pudo hacer.
--
-- Es idempotente. Requiere 23_vista_puntos_estado.sql y
-- 25_servicios_evidencia_config.sql (columna motivo_no_realizado).
-- ============================================================================

drop view if exists asa_v_puntos_estado;

create view asa_v_puntos_estado as
select
  p.id                 as id,
  p.id                 as punto_id,      -- compatibilidad con el código previo
  p.qr_token,
  p.sitio_id,
  p.area_id,
  a.nombre             as area_nombre,
  p.codigo_visible,
  p.nombre             as punto_nombre,
  p.numero_habitacion,
  p.frecuencia,
  p.tipo_punto_id,
  t.codigo             as tipo_codigo,
  t.nombre             as tipo_nombre,
  t.icono              as tipo_icono,
  t.color              as tipo_color,
  p.estrategia_id,
  e.nombre             as estrategia_nombre,
  -- Cuántas preguntas verá el técnico en ESTE punto: las de su estrategia que
  -- apliquen a su tipo, más las que aplican a todos los tipos. Si sale 0, la
  -- app solo mostrará estado y nivel de actividad.
  (
    select count(*)
      from asa_preguntas q
     where q.estrategia_id = p.estrategia_id
       and q.activa
       and (q.tipo_punto_id = p.tipo_punto_id or q.tipo_punto_id is null)
  )                    as preguntas_total,
  ult.fecha            as ultima_inspeccion,
  ult.estado_punto     as ultimo_estado,
  ult.nivel_actividad  as ultimo_nivel,
  case p.frecuencia
    when 'diaria'     then 1
    when 'semanal'    then 7
    when 'quincenal'  then 15
    when 'mensual'    then 30
    when 'trimestral' then 90
    else null
  end                  as dias_ciclo,
  case
    when ult.fecha is null then true
    when p.frecuencia = 'por_orden' then false
    else (now() - ult.fecha) >= (
      case p.frecuencia
        when 'diaria'     then interval '1 day'
        when 'semanal'    then interval '7 days'
        when 'quincenal'  then interval '15 days'
        when 'mensual'    then interval '30 days'
        when 'trimestral' then interval '90 days'
      end)
  end                  as vencido
from asa_puntos_control p
join asa_tipos_punto t      on t.id = p.tipo_punto_id
left join asa_areas a       on a.id = p.area_id
left join asa_estrategias e on e.id = p.estrategia_id
left join lateral (
  select i.fecha, i.estado_punto, i.nivel_actividad
    from asa_inspecciones i
   where i.punto_id = p.id
     and i.motivo_no_realizado is null        -- un "no pude entrar" NO cuenta como hecho
   order by i.fecha desc
   limit 1
) ult on true
where p.activo;
