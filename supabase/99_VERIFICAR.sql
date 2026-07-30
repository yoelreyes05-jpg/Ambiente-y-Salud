-- ============================================================================
-- Ambiente y Salud RD (ASA SRL) — VERIFICACIÓN DE INSTALACIÓN
-- ----------------------------------------------------------------------------
-- Ejecuta este archivo DESPUÉS de 00_INSTALL_COMPLETO.sql.
-- No modifica nada: solo reporta qué existe y qué falta.
-- Si alguna fila sale con estado 'FALTA', vuelve a correr el instalador.
-- ============================================================================

set search_path = public, extensions;

-- ── 1. Diagnóstico de entorno (causa frecuente del error 42P01) ─────────────
-- Si `search_path_actual` no incluye `public`, las tablas existen pero las
-- consultas fallan con: relation "asa_mascotas" does not exist.
select
  current_database()        as base_de_datos,
  current_schema()          as esquema_actual,
  current_setting('search_path') as search_path_actual,
  current_user              as usuario;


-- ── 2. Tipos ENUM esperados (16) ────────────────────────────────────────────
with esperados(nombre) as (
  values ('asa_rol_usuario'),('asa_especie'),('asa_sexo_mascota'),
         ('asa_estado_ot'),('asa_origen_ot'),('asa_prioridad'),
         ('asa_frecuencia_contrato'),('asa_tipo_tratamiento'),
         ('asa_tipo_servicio_cita'),('asa_estado_cita'),('asa_metodo_pago'),
         ('asa_tipo_ecf'),('asa_estado_dgii'),('asa_estado_factura'),
         ('asa_tipo_permiso'),('asa_estado_permiso')
)
select
  e.nombre as tipo_enum,
  case when t.typname is null then 'FALTA' else 'OK' end as estado
from esperados e
left join pg_type t
  on t.typname = e.nombre
 and t.typnamespace = 'public'::regnamespace
order by estado desc, e.nombre;


-- ── 3. Tablas esperadas (42) ────────────────────────────────────────────────
with esperadas(modulo, tabla) as (
  values
    ('02 clientes',      'asa_clientes'),
    ('02 clientes',      'asa_sitios'),
    ('02 clientes',      'asa_mascotas'),
    ('03 veterinaria',   'asa_fichas_clinicas'),
    ('03 veterinaria',   'asa_tratamientos_catalogo'),
    ('03 veterinaria',   'asa_tratamientos_aplicados'),
    ('04 citas',         'asa_citas'),
    ('04 citas',         'asa_estetica_servicios_catalogo'),
    ('04 citas',         'asa_estetica_ordenes'),
    ('04 citas',         'asa_estetica_orden_detalle'),
    ('05 plagas',        'asa_contratos_plagas'),
    ('05 plagas',        'asa_ordenes_trabajo'),
    ('05 plagas',        'asa_ordenes_trabajo_log'),
    ('05 plagas',        'asa_ipm_estaciones'),
    ('05 plagas',        'asa_ipm_lecturas'),
    ('05 plagas',        'asa_permisos_regulatorios'),
    ('06 inventario',    'asa_plaguicidas_catalogo'),
    ('06 inventario',    'asa_aplicaciones_productos'),
    ('06 inventario',    'asa_productos_tienda'),
    ('06 inventario',    'asa_inventario_movimientos'),
    ('07 pos',           'asa_ventas_pos'),
    ('07 pos',           'asa_ventas_pos_detalle'),
    ('07 pos',           'asa_pos_cuadre_caja'),
    ('08 facturacion',   'asa_secuencias_ecf'),
    ('08 facturacion',   'asa_facturas'),
    ('08 facturacion',   'asa_factura_items'),
    ('08 facturacion',   'asa_pagos'),
    ('08 facturacion',   'asa_cuentas_por_cobrar'),
    ('09 contabilidad',  'asa_plan_cuentas'),
    ('09 contabilidad',  'asa_asientos_contables'),
    ('09 contabilidad',  'asa_asientos_detalle'),
    ('09 contabilidad',  'asa_suplidores'),
    ('09 contabilidad',  'asa_cuentas_por_pagar'),
    ('10 nomina',        'asa_empleados'),
    ('10 nomina',        'asa_comisiones'),
    ('10 nomina',        'asa_nomina_periodos'),
    ('10 nomina',        'asa_nomina_detalle'),
    ('11 usuarios',      'asa_usuarios'),
    ('11 usuarios',      'asa_log_auditoria'),
    ('12 config',        'asa_notificaciones'),
    ('12 config',        'asa_config_sistema'),
    ('12 config',        'asa_rnc_cache')
)
select
  e.modulo,
  e.tabla,
  case when to_regclass('public.' || e.tabla) is null then 'FALTA' else 'OK' end as estado
from esperadas e
order by estado desc, e.modulo, e.tabla;


-- ── 4. Resumen: cuántas faltan ──────────────────────────────────────────────
with esperadas(tabla) as (
  values ('asa_clientes'),('asa_sitios'),('asa_mascotas'),
         ('asa_fichas_clinicas'),('asa_tratamientos_catalogo'),('asa_tratamientos_aplicados'),
         ('asa_citas'),('asa_estetica_servicios_catalogo'),('asa_estetica_ordenes'),('asa_estetica_orden_detalle'),
         ('asa_contratos_plagas'),('asa_ordenes_trabajo'),('asa_ordenes_trabajo_log'),
         ('asa_ipm_estaciones'),('asa_ipm_lecturas'),('asa_permisos_regulatorios'),
         ('asa_plaguicidas_catalogo'),('asa_aplicaciones_productos'),('asa_productos_tienda'),('asa_inventario_movimientos'),
         ('asa_ventas_pos'),('asa_ventas_pos_detalle'),('asa_pos_cuadre_caja'),
         ('asa_secuencias_ecf'),('asa_facturas'),('asa_factura_items'),('asa_pagos'),('asa_cuentas_por_cobrar'),
         ('asa_plan_cuentas'),('asa_asientos_contables'),('asa_asientos_detalle'),('asa_suplidores'),('asa_cuentas_por_pagar'),
         ('asa_empleados'),('asa_comisiones'),('asa_nomina_periodos'),('asa_nomina_detalle'),
         ('asa_usuarios'),('asa_log_auditoria'),
         ('asa_notificaciones'),('asa_config_sistema'),('asa_rnc_cache')
)
select
  count(*)                                                              as esperadas,
  count(*) filter (where to_regclass('public.' || tabla) is not null)   as existentes,
  count(*) filter (where to_regclass('public.' || tabla) is null)       as faltantes,
  case when count(*) filter (where to_regclass('public.' || tabla) is null) = 0
       then 'INSTALACION COMPLETA'
       else 'INCOMPLETA — vuelve a ejecutar 00_INSTALL_COMPLETO.sql'
  end                                                                   as veredicto
from esperadas;


-- ── 5. Tablas asa_* que existen pero NO están en la lista esperada ──────────
-- Útil para detectar sobras de intentos anteriores o nombres mal escritos.
select tablename as tabla_asa_no_esperada
from pg_tables
where schemaname = 'public'
  and tablename like 'asa\_%'
  and tablename not in (
    'asa_clientes','asa_sitios','asa_mascotas',
    'asa_fichas_clinicas','asa_tratamientos_catalogo','asa_tratamientos_aplicados',
    'asa_citas','asa_estetica_servicios_catalogo','asa_estetica_ordenes','asa_estetica_orden_detalle',
    'asa_contratos_plagas','asa_ordenes_trabajo','asa_ordenes_trabajo_log',
    'asa_ipm_estaciones','asa_ipm_lecturas','asa_permisos_regulatorios',
    'asa_plaguicidas_catalogo','asa_aplicaciones_productos','asa_productos_tienda','asa_inventario_movimientos',
    'asa_ventas_pos','asa_ventas_pos_detalle','asa_pos_cuadre_caja',
    'asa_secuencias_ecf','asa_facturas','asa_factura_items','asa_pagos','asa_cuentas_por_cobrar',
    'asa_plan_cuentas','asa_asientos_contables','asa_asientos_detalle','asa_suplidores','asa_cuentas_por_pagar',
    'asa_empleados','asa_comisiones','asa_nomina_periodos','asa_nomina_detalle',
    'asa_usuarios','asa_log_auditoria',
    'asa_notificaciones','asa_config_sistema','asa_rnc_cache'
  )
order by 1;
