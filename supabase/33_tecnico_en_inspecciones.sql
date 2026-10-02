-- ============================================================================
-- 33_tecnico_en_inspecciones.sql — Ambiente y Salud RD (ASA SRL)
--
-- Problema: en el reporte, en la ficha del servicio y en el portal del hotel
-- no salía el nombre del técnico. Solo salía "Registrado por: busqueda".
--
-- Causa: la inspección guarda `tecnico_id` tomándolo del `empleado_id` de la
-- cuenta del técnico, y las cuentas se crean desde el panel sin ficha de
-- empleado vinculada. El servicio quedaba con `tecnico_id` vacío y nadie sabía
-- quién lo hizo, aunque la cuenta que lo subió (`usuario_id`) sí estaba.
--
-- Arreglo:
--   1. Cada cuenta de técnico/operaciones queda vinculada a su ficha de
--      empleado (se busca por nombre; si no existe, se crea).
--   2. Los servicios viejos sin técnico toman el de la cuenta que los subió.
--   3. Un trigger lo hace solo de aquí en adelante: aunque el teléfono tenga
--      una sesión vieja, el servicio queda con su técnico.
--   4. La vista del reporte usa el nombre de la cuenta como respaldo.
--
-- Es idempotente: se puede correr más de una vez.
-- Requiere 11_usuarios_roles_auditoria.sql, 20_ y 25_.
-- ============================================================================

set search_path = public, extensions;

-- ── 1. Vincular cada cuenta de técnico con su ficha de empleado ────────────
-- Primero por nombre: si el empleado ya existe, se reutiliza.
update asa_usuarios u
   set empleado_id = e.id,
       updated_at  = now()
  from asa_empleados e
 where u.empleado_id is null
   and u.rol in ('tecnico_plagas', 'operaciones')
   and lower(trim(e.nombre_completo)) = lower(trim(u.nombre_completo));

-- Los que no tienen ficha: se les crea una con su nombre y su correo.
with nuevos as (
  insert into asa_empleados (nombre_completo, email, rol, activo)
  select u.nombre_completo, u.email, u.rol, true
    from asa_usuarios u
   where u.empleado_id is null
     and u.rol in ('tecnico_plagas', 'operaciones')
  returning id, email
)
update asa_usuarios u
   set empleado_id = n.id,
       updated_at  = now()
  from nuevos n
 where u.email = n.email
   and u.empleado_id is null;

-- ── 2. Servicios viejos sin técnico: el de la cuenta que los subió ─────────
update asa_inspecciones i
   set tecnico_id = u.empleado_id
  from asa_usuarios u
 where i.tecnico_id is null
   and i.usuario_id = u.id
   and u.empleado_id is not null;

-- ── 3. De aquí en adelante, automático ─────────────────────────────────────
create or replace function asa_inspeccion_completar_tecnico()
returns trigger
language plpgsql
as $$
begin
  if new.tecnico_id is null and new.usuario_id is not null then
    select empleado_id into new.tecnico_id
      from asa_usuarios
     where id = new.usuario_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_asa_inspeccion_tecnico on asa_inspecciones;
create trigger trg_asa_inspeccion_tecnico
  before insert or update of usuario_id, tecnico_id on asa_inspecciones
  for each row execute function asa_inspeccion_completar_tecnico();

-- Índice para el ranking de técnicos del panel
create index if not exists idx_asa_inspecciones_tecnico_fecha
  on asa_inspecciones (tecnico_id, fecha_local);

-- ── 4. Vista del reporte: nombre de la cuenta como respaldo ────────────────
-- Misma vista que 25_, con una sola diferencia: `tecnico` cae al nombre de la
-- cuenta que subió el servicio si no hay ficha de empleado.
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
  coalesce(e.nombre_completo, u.nombre_completo) as tecnico,
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
left join asa_empleados e on e.id = i.tecnico_id
left join asa_usuarios u  on u.id = i.usuario_id;

-- ── Verificación ───────────────────────────────────────────────────────────
-- Las dos primeras columnas deberían quedar en 0. Si "servicios_sin_tecnico"
-- no es 0, son servicios sin cuenta (importados): no hay de dónde sacar quién
-- los hizo.
select
  (select count(*) from asa_usuarios
    where rol in ('tecnico_plagas', 'operaciones') and empleado_id is null) as "cuentas_sin_empleado",
  (select count(*) from asa_inspecciones where tecnico_id is null)          as "servicios_sin_tecnico",
  (select count(*) from pg_trigger where tgname = 'trg_asa_inspeccion_tecnico') as "trigger";
