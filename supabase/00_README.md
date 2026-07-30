# Supabase — Ambiente y Salud RD (ASA SRL)

## Por qué existe esta carpeta

Esta base de datos de Supabase es **compartida** con otros sistemas (el CRM del
taller automotriz, una clínica médica, un punto de venta "UL", cafetería, etc.).
Ya existen tablas con nombres genéricos como `clientes`, `citas`, `pacientes`,
`productos`, `ventas`, `facturas`, `usuarios` que **pertenecen a esos otros
sistemas**. Para que los datos de Ambiente y Salud (ASA) nunca se mezclen ni
choquen con esos nombres, **todas las tablas, tipos (enums) y funciones de este
sistema usan el prefijo `asa_`**, siguiendo el mismo patrón que ya usan otros
módulos en esta base de datos (`ul_*` para el POS, `cafeteria_*` para la cafetería).

**Regla de oro: cualquier tabla, tipo o función nueva de este sistema DEBE
empezar con `asa_`.** Nunca reutilices ni modifiques una tabla que no tenga
ese prefijo — no es de este sistema.

## Cómo aplicar las migraciones

### Opción recomendada: un solo archivo

Pega **`00_INSTALL_COMPLETO.sql`** completo en el SQL Editor de Supabase y
ejecútalo una vez. Contiene los 12 módulos en el orden correcto de dependencias,
así que no puede fallar por orden ni por ejecución parcial. Luego ejecuta
**`99_VERIFICAR.sql`** para confirmar que existen las 42 tablas y los 16 tipos.

### Opción por módulos

Ejecuta los archivos **en orden numérico**. Cada archivo es idempotente
(`IF NOT EXISTS`) y ahora incluye una *guarda de dependencias* que, si falta un
archivo previo, aborta con un mensaje claro indicando cuál ejecutar, en vez del
error críptico `42P01`.

### Sobre el error `42P01: relation "asa_mascotas" does not exist`

Tiene dos causas, ambas ya corregidas en estos archivos:

1. **Ejecución parcial revertida.** El SQL Editor de Supabase corre todo el
   script en **una sola transacción**: si una sola sentencia falla, se revierte
   el archivo entero. Bastaba con que faltaran los tipos ENUM del archivo 01
   para que el 02 se revirtiera completo — `asa_clientes`, `asa_sitios` y
   `asa_mascotas` nunca llegaban a crearse — y a partir de ahí los archivos 03
   en adelante fallaban en cadena con 42P01.
2. **`search_path` sin `public`.** Si la sesión no incluye el esquema `public`,
   las consultas fallan con 42P01 *aunque las tablas sí aparezcan* en el Table
   Editor. Ahora todos los archivos empiezan con
   `set search_path = public, extensions;`.

Además, las llaves foráneas que apuntaban a tablas de módulos posteriores
(`asa_empleados`, `asa_citas`, `asa_facturas`, `asa_usuarios`,
`asa_nomina_periodos`) se aplican al final del instalador, cuando ya existen
todas las tablas. Antes eran solo "referencias lógicas" sin integridad real.

| Archivo | Contenido |
|---|---|
| `00_INSTALL_COMPLETO.sql` | **Instalador único.** Los 12 módulos en orden + FKs diferidas + semillas. |
| `01_extensiones_y_tipos.sql` | Extensiones (uuid) y todos los tipos ENUM `asa_*`. |
| `02_clientes_mascotas.sql` | Clientes, sitios (para plagas) y mascotas. |
| `03_veterinaria_fichas_tratamientos.sql` | Fichas clínicas, catálogo y aplicación de vacunas/tratamientos preventivos. |
| `04_citas_estetica.sql` | Agenda de citas y órdenes de estética canina (baño/grooming). |
| `05_plagas_ordenes_ipm.sql` | Contratos, órdenes de trabajo, estaciones IPM, lecturas y permisos regulatorios. |
| `06_inventario_productos.sql` | Catálogo de plaguicidas, catálogo de productos de tienda y movimientos de inventario. |
| `07_tienda_pos.sql` | Ventas de mostrador (POS) y su detalle. |
| `08_facturacion_ecf.sql` | Facturas e-CF (unificadas para las 3 líneas), pagos y cuentas por cobrar. |
| `09_contabilidad.sql` | Plan de cuentas y asientos contables. |
| `10_nomina.sql` | Empleados, comisiones y nómina (TSS/ISR). |
| `11_usuarios_roles_auditoria.sql` | Usuarios del sistema (roles) y bitácora de auditoría. |
| `12_notificaciones_config.sql` | Notificaciones, configuración del sistema y caché propio de RNC/DGII. |
| `99_VERIFICAR.sql` | Diagnóstico: reporta qué tablas/tipos existen y cuáles faltan. No modifica nada. |

## Aislamiento de datos: qué se comparte y qué no

- **Nada de este sistema lee ni escribe en tablas de otros CRMs.** Todas las
  claves foráneas de este esquema apuntan únicamente a tablas `asa_*`.
- El único punto de contacto con el "mundo exterior" es la **consulta a la
  DGII** (servicio externo, no una tabla local de otro sistema). Este sistema
  mantiene su propio caché en `asa_rnc_cache` (ver archivo 12) en lugar de
  usar la tabla `rnc_dgii` que ya usa el CRM automotriz — así, aunque ambos
  sistemas consultan la misma DGII, **cada uno guarda su copia** y uno nunca
  depende de que el otro exista o tenga los permisos correctos.
- Si en el futuro quieres compartir *a propósito* el caché de RNC entre
  sistemas (para no duplicar consultas), es una decisión aparte: se puede
  apuntar `asa_rnc_cache` a la tabla compartida `rnc_dgii`, pero por defecto
  se mantiene separado por seguridad.

## Convención de nombres usada

- Tablas: `asa_sustantivo_plural` (ej. `asa_clientes`, `asa_mascotas`).
- Tipos ENUM: `asa_tipo_singular` (ej. `asa_estado_ot`, `asa_especie`).
- Llaves primarias: `uuid` con `gen_random_uuid()` (evita colisiones de IDs
  numéricos entre sistemas y facilita sincronizar con apps móviles offline).
- Marcas de tiempo: `timestamptz` en vez de `timestamp` (consistente con las
  tablas más nuevas del resto de la base de datos).
- Borrado lógico: columna `activo boolean default true` en vez de borrar filas.
