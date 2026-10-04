-- ============================================================================
-- diagnostico_lopesan_caoba.sql — SOLO LECTURA (no cambia nada)
--
-- Para saber por qué la app del técnico no muestra los cambios de estrategia
-- y los puntos nuevos de Lopesan Caoba. Córrelo completo en el SQL Editor de
-- Supabase y mira los 4 resultados. Si el hotel se llama distinto en tu base,
-- cambia '%caoba%' en la primera línea de cada consulta.
-- ============================================================================

-- 1) ¿Cuántas "plantas" se llaman Caoba? Si hay más de una, los puntos nuevos
--    pueden estar en una y el técnico trabajando en la otra.
select s.id, s.nombre,
       (select count(*) from asa_puntos_control p where p.sitio_id = s.id and p.activo) as puntos_activos
  from asa_sitios s
 where s.nombre ilike '%caoba%';

-- 2) Puntos creados o modificados en los últimos 7 días y lo que verá el técnico.
--    · frecuencia = 'por_orden'  → NO salen en la ruta del día (solo por búsqueda)
--    · estrategia NULL           → el checklist sale de la estrategia del TIPO
--    · preguntas_que_vera = 0    → la estrategia no tiene preguntas para ese tipo
select p.codigo_visible, p.nombre, t.nombre as tipo, a.nombre as area,
       p.frecuencia, p.activo, e.nombre as estrategia_del_punto, e.activo as estrategia_activa,
       (select count(*) from asa_preguntas q
         where q.estrategia_id = p.estrategia_id and q.activa
           and (q.tipo_punto_id = p.tipo_punto_id or q.tipo_punto_id is null)) as preguntas_que_vera,
       p.created_at, p.updated_at
  from asa_puntos_control p
  join asa_sitios s on s.id = p.sitio_id
  join asa_tipos_punto t on t.id = p.tipo_punto_id
  left join asa_areas a on a.id = p.area_id
  left join asa_estrategias e on e.id = p.estrategia_id
 where s.nombre ilike '%caoba%'
   and (p.created_at > now() - interval '7 days' or p.updated_at > now() - interval '7 days')
 order by greatest(p.created_at, p.updated_at) desc;

-- 3) Qué estrategia tienen los puntos del hotel, agrupado. Si editaste la
--    estrategia "A" pero los puntos siguen apuntando a "B" (por ejemplo, la
--    duplicaste y editaste la copia), aquí se ve.
select t.nombre as tipo, coalesce(e.nombre, '(sin estrategia: usa la del tipo)') as estrategia,
       e.activo as estrategia_activa, count(*) as puntos
  from asa_puntos_control p
  join asa_sitios s on s.id = p.sitio_id
  join asa_tipos_punto t on t.id = p.tipo_punto_id
  left join asa_estrategias e on e.id = p.estrategia_id
 where s.nombre ilike '%caoba%' and p.activo
 group by 1, 2, 3
 order by 1, 4 desc;

-- 4) Preguntas activas de cada estrategia, por tipo de punto. Una pregunta con
--    tipo distinto al del punto NO le sale al técnico.
select e.nombre as estrategia, e.activo,
       coalesce(t.nombre, '(todos los tipos)') as tipo_de_la_pregunta,
       count(*) filter (where q.activa) as preguntas_activas,
       max(q.created_at) as ultima_pregunta_creada
  from asa_estrategias e
  left join asa_preguntas q on q.estrategia_id = e.id
  left join asa_tipos_punto t on t.id = q.tipo_punto_id
 where e.updated_at > now() - interval '15 days'
    or e.id in (select p.estrategia_id from asa_puntos_control p
                  join asa_sitios s on s.id = p.sitio_id
                 where s.nombre ilike '%caoba%')
 group by 1, 2, 3
 order by 1, 3;
