-- ============================================================================
-- 28_tipo_punto_estrategias_y_plagas.sql — Ambiente y Salud RD (ASA SRL)
--
-- El técnico abría un dispensador de aerosol y veía el conteo de plagas de las
-- habitaciones, con sus botones de + y −. Y en puntos sin estrategia propia
-- veía preguntas de estrategias que no eran las suyas. Dos fugas, dos causas
-- distintas:
--
--   1. El catálogo de plagas era UNO SOLO para todo. `GET /plagas/catalogo`
--      devolvía las once plagas del sistema y la app las pintaba en cualquier
--      punto: chinches de cama en una lámpara de moscas, moscas en un cebadero.
--
--   2. `preguntasDelPunto` hacía esto: si el punto no tiene estrategia asignada,
--      usar TODAS las estrategias del hotel o del cliente. Casi todos los puntos
--      importados del sistema anterior vinieron sin estrategia, así que casi
--      todos caían en ese camino y arrastraban las preguntas generales de las
--      nueve estrategias a la vez (nueve veces "Observaciones", por ejemplo).
--
-- Este archivo crea las dos amarras que faltaban —qué estrategias y qué plagas
-- lleva cada TIPO de punto— y las siembra con lo que ya hay configurado, sin
-- inventar nada:
--
--   · Las estrategias de cada tipo se deducen de las preguntas que ya existen:
--     si una estrategia tiene preguntas para cebadero, esa estrategia es de
--     cebadero. Es la misma relación que ya estaba escrita en asa_preguntas,
--     nada más que ahora explícita y editable desde el panel.
--   · Las plagas de cada tipo se siembran con criterio de campo: en una lámpara
--     se cuentan voladoras, en un cebadero roedores, en una habitación chinches
--     y rastreras. Todo se edita después en Tipos de punto.
--
-- Un tipo de punto NUEVO nace sin estrategias y sin plagas: nada queda amarrado
-- solo. Una estrategia nueva tampoco se pega sola a ningún tipo.
--
-- Es idempotente y no toca ninguna inspección ya registrada.
-- Requiere 20_, 21_ y 24_.
-- ============================================================================

begin;

-- ── 1. Qué estrategias aplican a cada tipo de punto ─────────────────────────
-- Es el respaldo del punto que no tiene estrategia propia. El punto que sí la
-- tiene asignada sigue mandando: esto no lo pisa.
create table if not exists asa_tipo_punto_estrategias (
  tipo_punto_id uuid not null references asa_tipos_punto(id) on delete cascade,
  estrategia_id uuid not null references asa_estrategias(id) on delete cascade,
  orden         integer not null default 0,
  created_at    timestamptz not null default now(),
  primary key (tipo_punto_id, estrategia_id)
);

create index if not exists asa_tpe_tipo_idx on asa_tipo_punto_estrategias(tipo_punto_id);

-- ── 2. Qué plagas se cuentan en cada tipo de punto ──────────────────────────
create table if not exists asa_tipo_punto_plagas (
  tipo_punto_id uuid not null references asa_tipos_punto(id) on delete cascade,
  plaga_id      uuid not null references asa_plagas(id) on delete cascade,
  orden         integer not null default 0,
  created_at    timestamptz not null default now(),
  primary key (tipo_punto_id, plaga_id)
);

create index if not exists asa_tpp_tipo_idx on asa_tipo_punto_plagas(tipo_punto_id);

-- ── 3. Sembrar las estrategias desde las preguntas que ya existen ───────────
-- No se inventa ninguna relación: si la estrategia "Lámpara ultravioletas
-- atrapa moscas" tiene preguntas para el tipo lampara_moscas, entonces esa
-- estrategia es de las lámparas. Punto.
insert into asa_tipo_punto_estrategias (tipo_punto_id, estrategia_id, orden)
select distinct p.tipo_punto_id, p.estrategia_id, 0
  from asa_preguntas p
  join asa_estrategias e on e.id = p.estrategia_id and e.activo
 where p.tipo_punto_id is not null
   and p.activa
on conflict do nothing;

-- ── 4. Sembrar las plagas de cada tipo ──────────────────────────────────────
-- "Otra plaga" va en todos: en campo siempre aparece algo que no está en la
-- lista, y sin esa opción el técnico no lo reporta.
with reparto (tipo, plaga) as (values
  -- Roedores: solo roedores. Contar moscas en un cebadero no significa nada.
  ('cebadero_roedor',    'roedor_raton'),
  ('cebadero_roedor',    'roedor_rata'),
  ('cebadero_roedor',    'otro'),
  ('estacion_exterior',  'roedor_raton'),
  ('estacion_exterior',  'roedor_rata'),
  ('estacion_exterior',  'otro'),

  -- Voladoras: lo que cae en una lámina o lo que el aerosol controla.
  ('lampara_moscas',     'mosca_domestica'),
  ('lampara_moscas',     'mosca_fruta'),
  ('lampara_moscas',     'mosquito'),
  ('lampara_moscas',     'otro'),
  ('trampa_pegajosa',    'mosca_domestica'),
  ('trampa_pegajosa',    'mosca_fruta'),
  ('trampa_pegajosa',    'mosquito'),
  ('trampa_pegajosa',    'cucaracha_alemana'),
  ('trampa_pegajosa',    'otro'),
  ('dispensador_aerosol','mosca_domestica'),
  ('dispensador_aerosol','mosca_fruta'),
  ('dispensador_aerosol','mosquito'),
  ('dispensador_aerosol','otro'),

  -- Habitación: lo que se busca en una revisión de cuarto de hotel.
  ('habitacion',         'chinche'),
  ('habitacion',         'cucaracha_alemana'),
  ('habitacion',         'cucaracha_america'),
  ('habitacion',         'hormiga'),
  ('habitacion',         'mosquito'),
  ('habitacion',         'otro'),

  -- Aperturas y sellado: por dónde entra lo que entra.
  ('apertura',           'roedor_raton'),
  ('apertura',           'roedor_rata'),
  ('apertura',           'cucaracha_america'),
  ('apertura',           'hormiga'),
  ('apertura',           'termita'),
  ('apertura',           'otro'),

  -- Recorrido de área general: es el comodín, va con todas.
  ('area_general',       'mosca_domestica'),
  ('area_general',       'mosca_fruta'),
  ('area_general',       'mosquito'),
  ('area_general',       'cucaracha_alemana'),
  ('area_general',       'cucaracha_america'),
  ('area_general',       'chinche'),
  ('area_general',       'hormiga'),
  ('area_general',       'roedor_raton'),
  ('area_general',       'roedor_rata'),
  ('area_general',       'termita'),
  ('area_general',       'otro')
)
insert into asa_tipo_punto_plagas (tipo_punto_id, plaga_id, orden)
select t.id, pl.id, pl.orden
  from reparto r
  join asa_tipos_punto t on t.codigo = r.tipo
  join asa_plagas      pl on pl.codigo = r.plaga
on conflict do nothing;

commit;

-- Supabase guarda en memoria el mapa de tablas y relaciones que usa su API. Dos
-- tablas recién creadas no existen para esa API hasta que lo recarga, y el
-- backend respondería "could not find a relationship". El editor SQL suele
-- recargarlo solo; esto lo asegura.
notify pgrst, 'reload schema';

-- ── Verificación: esto es exactamente lo que verá el técnico por tipo ───────
select
  t.icono || ' ' || t.nombre                                  as "Tipo de punto",
  coalesce(count(distinct e.estrategia_id), 0)                as "Estrategias",
  coalesce(count(distinct pl.plaga_id), 0)                    as "Plagas que cuenta",
  coalesce(string_agg(distinct p2.nombre, ', '), '—')         as "Cuáles"
from asa_tipos_punto t
left join asa_tipo_punto_estrategias e on e.tipo_punto_id = t.id
left join asa_tipo_punto_plagas     pl on pl.tipo_punto_id = t.id
left join asa_plagas                p2 on p2.id = pl.plaga_id
where t.activo
group by t.id, t.icono, t.nombre, t.orden
order by t.orden;

-- Puntos que siguen sin checklist: no tienen estrategia propia Y su tipo
-- tampoco tiene ninguna. Son los que hay que atender desde el panel.
select
  t.nombre                as "Tipo de punto",
  count(*)                as "Puntos sin checklist"
from asa_puntos_control pc
join asa_tipos_punto t on t.id = pc.tipo_punto_id
where pc.activo
  and pc.estrategia_id is null
  and not exists (select 1 from asa_tipo_punto_estrategias e where e.tipo_punto_id = pc.tipo_punto_id)
group by t.nombre
order by 2 desc;
