-- ============================================================================
-- 25_servicios_evidencia_config.sql — Ambiente y Salud RD (ASA SRL)
--
-- Tres cosas que pidió ASA y que la base todavía no aguantaba:
--
--   1. POR QUÉ no se hizo un servicio. `estado_punto = 'no_accesible'` ya
--      existía, pero no decía nada más. En auditoría la pregunta nunca es
--      "¿se hizo?", es "¿por qué no, y quién lo impidió?" — una habitación con
--      el huésped dentro y una que el hotel no autorizó son dos cosas
--      distintas, y solo una es responsabilidad de ASA.
--
--   2. El MAPA como PDF georreferenciado. El plano venía como imagen y un
--      plano de hotel exportado de QGIS pierde todo al convertirlo a PNG: al
--      agrandarlo en el celular se pixela. Con el PDF se agranda sin perder
--      nada, y con el recuadro de coordenadas la app puede poner al técnico
--      encima del mapa con el GPS.
--
--   3. CONFIGURACIÓN de la empresa y matriz de PERMISOS por rol, en
--      asa_config_sistema, que ya existe como clave/valor.
--
-- Es idempotente: se puede correr varias veces.
-- Requiere: 20_hoteles_puntos_control.sql y 12_notificaciones_config.sql.
-- ============================================================================

set search_path = public, extensions;

do $$
declare faltan text := '';
begin
  if to_regclass('public.asa_inspecciones')   is null then faltan := faltan || ' 20_hoteles_puntos_control.sql'; end if;
  if to_regclass('public.asa_config_sistema') is null then faltan := faltan || ' 12_notificaciones_config.sql'; end if;
  if faltan <> '' then
    raise exception 'DEPENDENCIA FALTANTE. Ejecuta primero:%.', faltan;
  end if;
end $$;

-- ============================================================================
-- 1. Por qué no se pudo hacer un servicio
--
--    `motivo_no_realizado` solo se llena cuando el técnico no pudo trabajar el
--    punto. `impedido_por` es el nombre de quien lo impidió o autorizó — el
--    supervisor de ama de llaves, el jefe de cocina — porque en auditoría el
--    hotel pregunta con quién se habló.
--
--    No se pone NOT NULL ni un CHECK cruzado con estado_punto: hay
--    inspecciones viejas sin motivo y no se va a inventar uno. El backend
--    exige el motivo de aquí en adelante.
-- ============================================================================
alter table asa_inspecciones
  add column if not exists motivo_no_realizado text
    check (motivo_no_realizado in (
      'permiso_denegado',        -- el hotel no autorizó entrar
      'huesped_en_habitacion',   -- habitación ocupada
      'area_ocupada',            -- servicio, evento o personal trabajando
      'sin_llave',               -- no apareció quien abriera
      'en_mantenimiento',        -- obra o reparación en curso
      'punto_inaccesible',       -- tapiado, bloqueado por mercancía
      'evento_en_curso',
      'otro'
    ));

alter table asa_inspecciones add column if not exists impedido_por text;
alter table asa_inspecciones add column if not exists reprogramada_para date;

create index if not exists idx_asa_insp_no_realizadas
  on asa_inspecciones (sitio_id, fecha_local)
  where motivo_no_realizado is not null;

-- Índice del día: es la consulta que corre el panel cada vez que alguien abre
-- una planta, y la que alimenta el reporte de evidencia.
create index if not exists idx_asa_insp_sitio_dia
  on asa_inspecciones (sitio_id, fecha_local desc);

comment on column asa_inspecciones.motivo_no_realizado is
  'Solo cuando el servicio NO se pudo hacer. Null = se hizo.';
comment on column asa_inspecciones.impedido_por is
  'Nombre y cargo de quien impidió o autorizó, para sustentar en auditoría.';

-- ============================================================================
-- 1b. Estrategias: marca de última edición
--
-- asa_estrategias no tenía `updated_at`. El panel ahora deja editar la
-- estrategia (antes no guardaba por un problema de rutas), y sin esta columna
-- el guardado falla con "column updated_at does not exist".
-- ============================================================================
alter table asa_estrategias add column if not exists updated_at timestamptz not null default now();

-- ============================================================================
-- 2. Planos: PDF y georreferencia
--
--    El recuadro (norte/sur/este/oeste) en grados decimales WGS84 es lo que
--    QGIS muestra en el diseñador de impresión. Con esos cuatro números la app
--    convierte la posición del GPS a un porcentaje del ancho y del alto del
--    plano, y pinta al técnico encima. Sin ellos el plano sigue sirviendo, solo
--    que sin ubicación en vivo.
-- ============================================================================
alter table asa_planos add column if not exists tipo_archivo text not null default 'imagen'
  check (tipo_archivo in ('imagen','pdf'));
alter table asa_planos add column if not exists tipo_mime text;
alter table asa_planos add column if not exists paginas integer;
alter table asa_planos add column if not exists geo_norte numeric;   -- latitud máxima
alter table asa_planos add column if not exists geo_sur   numeric;   -- latitud mínima
alter table asa_planos add column if not exists geo_este  numeric;   -- longitud máxima
alter table asa_planos add column if not exists geo_oeste numeric;   -- longitud mínima
alter table asa_planos add column if not exists geo_fuente text
  check (geo_fuente in ('pdf','manual','calibrado'));
alter table asa_planos add column if not exists rotacion_grados numeric not null default 0;

-- Un recuadro a medias es peor que ninguno: pondría al técnico en el lugar
-- equivocado con toda confianza. O están los cuatro, o ninguno.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'asa_planos_geo_completa') then
    alter table asa_planos add constraint asa_planos_geo_completa check (
      (geo_norte is null and geo_sur is null and geo_este is null and geo_oeste is null)
      or (geo_norte is not null and geo_sur is not null and geo_este is not null and geo_oeste is not null
          and geo_norte > geo_sur and geo_este > geo_oeste)
    );
  end if;
end $$;

comment on column asa_planos.geo_norte is
  'Recuadro del mapa en grados WGS84, tal como lo muestra QGIS. Los cuatro o ninguno.';

-- ============================================================================
-- 3. Configuración de la empresa y permisos por rol
-- ============================================================================
insert into asa_config_sistema (clave, valor) values
  ('empresa', jsonb_build_object(
      'nombre',            'Ambiente y Salud RD',
      'razon_social',      'Ambiente y Salud RD, SRL',
      'siglas',            'ASA SRL',
      'rnc',               '',
      'telefono',          '+1 (829) 260-5444',
      'telefono_alterno',  '',
      'email',             'info@ambienteysaludrd.com',
      'web',               'ambienteysalud.online',
      'direccion',         'Av. Prof. Juan Bosch, Santo Domingo Este',
      'licencia_sanitaria','',
      'registro_mip',      '',
      'responsable_tecnico','',
      'logo_url',          '',
      'pie_reportes',      'Documento generado por el sistema de gestión de Ambiente y Salud RD.'
  ))
on conflict (clave) do update
  -- Respeta lo que ya esté lleno: la semilla solo agrega las llaves nuevas.
  set valor = excluded.valor || asa_config_sistema.valor,
      updated_at = now();

-- Matriz de permisos: rol → módulo → acciones. El backend ya frena por rol en
-- las rutas; esto es lo que decide qué módulos se dibujan y qué botones salen,
-- y se edita desde el panel sin desplegar nada.
insert into asa_config_sistema (clave, valor) values
  ('permisos', jsonb_build_object(
    'admin', jsonb_build_object(
      'dashboard','ver', 'clientes','todo', 'plantas','todo', 'puntos','todo',
      'estrategias','todo', 'tipos_punto','todo', 'reportes','todo',
      'accesos_hotel','todo', 'usuarios','todo', 'auditoria','ver',
      'configuracion','todo', 'flota','todo'),
    'operaciones', jsonb_build_object(
      'dashboard','ver', 'clientes','ver', 'plantas','todo', 'puntos','todo',
      'estrategias','todo', 'tipos_punto','todo', 'reportes','todo',
      'accesos_hotel','ninguno', 'usuarios','ninguno', 'auditoria','ninguno',
      'configuracion','ver', 'flota','operar'),
    'comercial', jsonb_build_object(
      'dashboard','ver', 'clientes','todo', 'plantas','ver', 'puntos','ver',
      'estrategias','ver', 'tipos_punto','ninguno', 'reportes','todo',
      'accesos_hotel','todo', 'usuarios','ninguno', 'auditoria','ninguno',
      'configuracion','ninguno', 'flota','ninguno'),
    'tecnico_plagas', jsonb_build_object(
      'dashboard','ninguno', 'clientes','ninguno', 'plantas','ver', 'puntos','ver',
      'estrategias','ninguno', 'tipos_punto','ninguno', 'reportes','ninguno',
      'accesos_hotel','ninguno', 'usuarios','ninguno', 'auditoria','ninguno',
      'configuracion','ninguno', 'flota','chequeo'),
    'contabilidad', jsonb_build_object('dashboard','ver', 'reportes','ver', 'flota','ver'),
    'nomina',       jsonb_build_object('dashboard','ver', 'flota','ver')
  ))
on conflict (clave) do nothing;

-- ============================================================================
-- 4. Vista del día: TODOS los servicios, no solo habitaciones
--
--    ASA sube muchos más servicios que habitaciones (recorridos de áreas,
--    cebaderos, lámparas, aplicaciones puntuales). Esta vista los devuelve
--    todos con lo que hace falta para la tarjeta del panel, sin que el panel
--    tenga que unir seis tablas a mano.
-- ============================================================================
create or replace view asa_v_servicios_dia as
select
  i.id                       as inspeccion_id,
  i.fecha,
  i.fecha_local,
  i.sitio_id,
  s.nombre                   as planta,
  i.area_id,
  a.nombre                   as area,
  a.nivel                    as nivel,
  i.punto_id,
  p.codigo_visible,
  p.nombre                   as punto_nombre,
  p.numero_habitacion,
  t.codigo                   as tipo_codigo,
  t.nombre                   as tipo_nombre,
  t.icono                    as tipo_icono,
  t.color                    as tipo_color,
  i.tecnico_id,
  e.nombre_completo          as tecnico,
  i.estado_punto,
  i.nivel_actividad,
  i.metodo_acceso,
  i.motivo_no_realizado,
  i.impedido_por,
  (i.motivo_no_realizado is not null) as no_realizado,
  i.notas,
  jsonb_array_length(coalesce(i.fotos, '[]'::jsonb))   as fotos_total,
  (select count(*) from asa_inspeccion_respuestas r where r.inspeccion_id = i.id) as respuestas_total,
  (select coalesce(sum(c.cantidad), 0) from asa_capturas c where c.inspeccion_id = i.id) as plagas_total,
  (select count(distinct c.plaga_id) from asa_capturas c where c.inspeccion_id = i.id)   as plagas_tipos
from asa_inspecciones i
join asa_puntos_control p on p.id = i.punto_id
join asa_tipos_punto t    on t.id = p.tipo_punto_id
left join asa_sitios s    on s.id = i.sitio_id
left join asa_areas a     on a.id = i.area_id
left join asa_empleados e on e.id = i.tecnico_id;

-- ============================================================================
-- 5. Verificación
-- ============================================================================
do $$
declare faltan text := '';
begin
  if not exists (select 1 from information_schema.columns
                  where table_name='asa_inspecciones' and column_name='motivo_no_realizado')
    then faltan := faltan || ' asa_inspecciones.motivo_no_realizado'; end if;
  if not exists (select 1 from information_schema.columns
                  where table_name='asa_planos' and column_name='geo_norte')
    then faltan := faltan || ' asa_planos.geo_norte'; end if;
  if to_regclass('public.asa_v_servicios_dia') is null
    then faltan := faltan || ' vista asa_v_servicios_dia'; end if;
  if not exists (select 1 from information_schema.columns
                  where table_name='asa_estrategias' and column_name='updated_at')
    then faltan := faltan || ' asa_estrategias.updated_at'; end if;
  if faltan <> '' then raise exception 'Quedó incompleto:%', faltan; end if;

  raise notice 'OK 25_ — motivo de no realizado, planos en PDF con georreferencia, configuración de empresa, permisos y vista del día.';
end $$;
