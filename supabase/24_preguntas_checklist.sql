-- ============================================================================
-- 24_preguntas_checklist.sql — Ambiente y Salud RD (ASA SRL)
--
-- El diagnóstico dio 0 preguntas en las 10 combinaciones: las estrategias se
-- importaron del sistema anterior con su nombre, pero sin contenido. Por eso
-- el técnico solo ve "estado del punto" y "nivel de actividad".
--
-- Este archivo carga el checklist de cada estrategia, separado por tipo de
-- punto. Al escanear un cebadero el técnico ve las preguntas de cebadero; al
-- escanear una habitación, las de habitación. Todo queda editable desde el
-- panel (Estrategias → abrir una → Pregunta), así que esto es el punto de
-- partida, no algo fijo.
--
-- Criterio de las preguntas: lo que un programa de MIP necesita poder
-- demostrar en auditoría hotelera — estado del dispositivo, evidencia
-- encontrada, acción tomada y foto cuando hay hallazgo.
--
-- Es idempotente: no duplica una pregunta que ya exista con el mismo texto en
-- la misma estrategia. Si ya editaste alguna, no se toca.
-- Requiere 20_ y la carga inicial (22_).
-- ============================================================================

begin;

with entradas (estrategia, tipo, texto, tipo_respuesta, opciones, unidad,
               obligatoria, foto_si, hallazgo_si, orden) as (values

  -- ── HABITACIONES ────────────────────────────────────────────────────────
  -- Ciclo mensual. Lo que el hotel pregunta en auditoría es qué se aplicó,
  -- dónde, y si había evidencia.
  ('Prevención y Matenimiento','habitacion','¿Se realizó el tratamiento en la habitación?','si_no','[]',null,true,false,false,10),
  ('Prevención y Matenimiento','habitacion','Áreas tratadas','multiple',
     '["Baño","Clóset","Detrás de muebles","Zócalos","Balcón o terraza","Minibar"]',null,true,false,false,20),
  ('Prevención y Matenimiento','habitacion','Producto aplicado','texto','[]',null,false,false,false,30),
  ('Prevención y Matenimiento','habitacion','¿Se encontró evidencia de plagas?','si_no','[]',null,true,true,true,40),
  ('Prevención y Matenimiento','habitacion','¿Qué se encontró?','multiple',
     '["Cucarachas","Hormigas","Chinches","Roedores","Moscas","Otros"]',null,false,false,false,50),
  ('Prevención y Matenimiento','habitacion','Foto de la habitación tratada','foto','[]',null,false,false,false,60),

  -- ── ÁREAS GENERALES / RECORRIDOS ────────────────────────────────────────
  ('Prevención y Matenimiento','area_general','Actividad realizada','multiple',
     '["Inspección visual","Aplicación residual","Nebulización","Cebado en gel","Limpieza de foco","Solo monitoreo"]',null,true,false,false,10),
  ('Prevención y Matenimiento','area_general','¿Se observó actividad de plagas?','si_no','[]',null,true,true,true,20),
  ('Prevención y Matenimiento','area_general','Plagas observadas','multiple',
     '["Moscas","Cucarachas","Hormigas","Roedores","Mosquitos","Otros"]',null,false,false,false,30),
  ('Prevención y Matenimiento','area_general','Condiciones que favorecen plagas','multiple',
     '["Acumulación de basura","Derrames o residuos","Humedad o filtración","Almacenamiento inadecuado","Drenaje sin rejilla","Puerta sin sellar","Ninguna"]',null,false,false,false,40),

  ('Monitoreo Post-Tratamiento','area_general','¿Persiste la actividad tras el tratamiento?','si_no','[]',null,true,true,true,10),
  ('Monitoreo Post-Tratamiento','area_general','Nivel comparado con la visita anterior','seleccion',
     '["Eliminada","Menor","Igual","Mayor"]',null,true,false,false,20),
  ('Monitoreo Post-Tratamiento','area_general','¿Requiere una nueva aplicación?','si_no','[]',null,true,false,true,30),

  ('Actividades de control','area_general','Tipo de control aplicado','seleccion',
     '["Químico residual","Cebado","Nebulización","Físico o mecánico","Saneamiento"]',null,true,false,false,10),
  ('Actividades de control','area_general','Producto y dosis','texto','[]',null,true,false,false,20),
  ('Actividades de control','area_general','Foto del área tratada','foto','[]',null,false,false,false,30),

  -- ── CEBADEROS PARA ROEDORES ─────────────────────────────────────────────
  -- El consumo de cebo es el indicador que sostiene todo el programa de
  -- roedores: sin ese dato no hay forma de mostrar tendencia.
  ('Monitoreo permanente con estaciones de cebaderos','cebadero_roedor','Estado de la estación','seleccion',
     '["Buena","Dañada","Falta","Bloqueada o inaccesible","Húmeda"]',null,true,false,false,10),
  ('Monitoreo permanente con estaciones de cebaderos','cebadero_roedor','Consumo de cebo','seleccion',
     '["Sin consumo","Leve (menos de 25%)","Moderado (25 a 50%)","Alto (más de 50%)","Total"]',null,true,false,false,20),
  ('Monitoreo permanente con estaciones de cebaderos','cebadero_roedor','¿Se repuso cebo?','si_no','[]',null,true,false,false,30),
  ('Monitoreo permanente con estaciones de cebaderos','cebadero_roedor','Cebo repuesto','numero','[]','gramos',false,false,false,40),
  ('Monitoreo permanente con estaciones de cebaderos','cebadero_roedor','¿Hubo captura de roedor?','si_no','[]',null,true,true,true,50),
  ('Monitoreo permanente con estaciones de cebaderos','cebadero_roedor','Indicios encontrados','multiple',
     '["Heces","Roeduras","Sendas o manchas de grasa","Madrigueras","Ninguno"]',null,false,false,false,60),

  ('Estación de Cebo','cebadero_roedor','Estado de la estación','seleccion',
     '["Buena","Dañada","Falta","Bloqueada o inaccesible","Húmeda"]',null,true,false,false,10),
  ('Estación de Cebo','cebadero_roedor','Consumo de cebo','seleccion',
     '["Sin consumo","Leve (menos de 25%)","Moderado (25 a 50%)","Alto (más de 50%)","Total"]',null,true,false,false,20),
  ('Estación de Cebo','cebadero_roedor','¿Se repuso cebo?','si_no','[]',null,true,false,false,30),
  ('Estación de Cebo','cebadero_roedor','Cebo repuesto','numero','[]','gramos',false,false,false,40),
  ('Estación de Cebo','cebadero_roedor','¿Hubo captura de roedor?','si_no','[]',null,true,true,true,50),

  -- ── LÁMPARAS PARA MOSCAS ────────────────────────────────────────────────
  -- El conteo de la lámina es lo que alimenta la tendencia de moscas.
  ('Lámpara ultravioletas atrapa moscas','lampara_moscas','Estado de la lámpara','seleccion',
     '["Funcionando","Apagada","Tubo fundido","Sucia","Mal ubicada"]',null,true,false,false,10),
  ('Lámpara ultravioletas atrapa moscas','lampara_moscas','Insectos contados en la lámina','numero','[]','unidades',true,false,false,20),
  ('Lámpara ultravioletas atrapa moscas','lampara_moscas','¿Se cambió la lámina?','si_no','[]',null,true,false,false,30),
  ('Lámpara ultravioletas atrapa moscas','lampara_moscas','Foto de la lámina antes de cambiarla','foto','[]',null,false,false,false,40),

  ('Lámina pegante para moscas','trampa_pegajosa','Insectos contados','numero','[]','unidades',true,false,false,10),
  ('Lámina pegante para moscas','trampa_pegajosa','Estado de la lámina','seleccion',
     '["Limpia","Saturada","Sucia o húmeda","Despegada"]',null,true,false,false,20),
  ('Lámina pegante para moscas','trampa_pegajosa','¿Se cambió la lámina?','si_no','[]',null,true,false,false,30),

  -- ── DISPENSADORES DE AEROSOL ────────────────────────────────────────────
  ('Dispensador de aerosol','dispensador_aerosol','Estado del equipo','seleccion',
     '["Funcionando","Sin carga","Dañado","Apagado","Falta"]',null,true,false,false,10),
  ('Dispensador de aerosol','dispensador_aerosol','¿Se reemplazó la carga?','si_no','[]',null,true,false,false,20),
  ('Dispensador de aerosol','dispensador_aerosol','Vencimiento de la carga instalada','texto','[]',null,false,false,false,30),
  ('Dispensador de aerosol','dispensador_aerosol','Nivel de batería','seleccion',
     '["Bien","Baja","Agotada","No aplica"]',null,false,false,false,40),

  -- ── APERTURAS / PUNTOS DE SELLADO ───────────────────────────────────────
  -- Aquí el hallazgo es el producto: es lo que ASA reporta y el hotel corrige.
  ('Aperturas en las áreas','apertura','Estado de la apertura','seleccion',
     '["Sellada","Deteriorada","Abierta","Con malla dañada"]',null,true,false,false,10),
  ('Aperturas en las áreas','apertura','¿Requiere corrección por parte del hotel?','si_no','[]',null,true,true,true,20),
  ('Aperturas en las áreas','apertura','Qué se necesita','texto','[]',null,false,false,false,30),

  -- ── PARA TODOS LOS TIPOS ────────────────────────────────────────────────
  -- tipo = null hace que la pregunta salga en cualquier punto de esa
  -- estrategia, sin importar el dispositivo.
  ('Prevención y Matenimiento',null,'Observaciones','texto','[]',null,false,false,false,900),
  ('Monitoreo permanente con estaciones de cebaderos',null,'Observaciones','texto','[]',null,false,false,false,900),
  ('Estación de Cebo',null,'Observaciones','texto','[]',null,false,false,false,900),
  ('Lámpara ultravioletas atrapa moscas',null,'Observaciones','texto','[]',null,false,false,false,900),
  ('Lámina pegante para moscas',null,'Observaciones','texto','[]',null,false,false,false,900),
  ('Dispensador de aerosol',null,'Observaciones','texto','[]',null,false,false,false,900),
  ('Aperturas en las áreas',null,'Observaciones','texto','[]',null,false,false,false,900),
  ('Monitoreo Post-Tratamiento',null,'Observaciones','texto','[]',null,false,false,false,900),
  ('Actividades de control',null,'Observaciones','texto','[]',null,false,false,false,900)
)
insert into asa_preguntas
  (estrategia_id, tipo_punto_id, texto, tipo_respuesta, opciones, unidad,
   obligatoria, requiere_foto_si, genera_hallazgo_si, orden, activa)
select
  e.id,
  t.id,
  x.texto,
  x.tipo_respuesta,
  x.opciones::jsonb,
  x.unidad,
  x.obligatoria,
  case when x.foto_si    then '{"igual":"si"}'::jsonb else null end,
  case when x.hallazgo_si then '{"igual":"si"}'::jsonb else null end,
  x.orden,
  true
from entradas x
join asa_estrategias e
  on lower(e.nombre) = lower(x.estrategia)
 and e.activo
left join asa_tipos_punto t
  on t.codigo = x.tipo
where not exists (
  select 1 from asa_preguntas q
   where q.estrategia_id = e.id
     and lower(q.texto) = lower(x.texto)
     and q.tipo_punto_id is not distinct from t.id
);

commit;

-- ── Verificación: esto es exactamente lo que verá el técnico ───────────────
select
  tipo_nombre                        as "Tipo de punto",
  coalesce(estrategia_nombre, '— sin estrategia —') as "Estrategia asignada",
  count(*)                           as "Puntos",
  max(preguntas_total)               as "Preguntas que ve el técnico"
from asa_v_puntos_estado
group by 1, 2
order by 3 desc;
