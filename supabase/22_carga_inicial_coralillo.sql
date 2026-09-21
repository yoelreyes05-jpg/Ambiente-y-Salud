-- ============================================================================
-- 22_carga_inicial_coralillo.sql — Ambiente y Salud RD (ASA SRL)
--
-- Carga los datos reales exportados del sistema anterior el 19/09/2026:
--   · 8 clientes
--   · 21 plantas
--   · 2 contratos (ICB001 Coral Bávaro, IC001 Comunes)
--   · 9 estrategias reutilizables
--   · 58 áreas
--   · 1012 puntos de control CON SU CÓDIGO QR YA IMPRESO
--
-- LOS QR SE CONSERVAN TAL CUAL. No hay que reimprimir una sola etiqueta.
--
-- Es idempotente: correrlo dos veces no duplica nada (todo va con
-- 'where not exists' o 'on conflict do nothing').
-- Requiere: 00_INSTALL_COMPLETO.sql, 20_ y 21_ ya ejecutados.
-- ============================================================================

begin;

-- ── 1. Clientes ────────────────────────────────────────────────────────────
insert into asa_clientes (tipo_documento, rnc_cedula, razon_social, nombre_comercial, nombre_contacto, telefono, email, direccion, tipo_cliente)
select 'RNC', '401031329', 'CASA DE ESPAÑA EN STO DGO INC', 'CASA DE ESPAÑA EN STO DGO INC', 'No definido', null, null, 'Autopista 30 de Mayo 11b, Santo Domingo', 'empresa'
where not exists (select 1 from asa_clientes where razon_social = 'CASA DE ESPAÑA EN STO DGO INC');
insert into asa_clientes (tipo_documento, rnc_cedula, razon_social, nombre_comercial, nombre_contacto, telefono, email, direccion, tipo_cliente)
select 'RNC', '101029226', 'COSTASUR DOMINICANA', 'COSTASUR DOMINICANA', 'No definido', null, null, 'Carretera La Romana - Higuey Hwy, La Romana', 'empresa'
where not exists (select 1 from asa_clientes where razon_social = 'COSTASUR DOMINICANA');
insert into asa_clientes (tipo_documento, rnc_cedula, razon_social, nombre_comercial, nombre_contacto, telefono, email, direccion, tipo_cliente)
select 'RNC', '101853621', 'EQUINOCCIO BAVARO', 'EQUINOCCIO BAVARO', 'No definido', null, null, 'Carretera El Cortecito, Av Barcelo, BAVARO', 'empresa'
where not exists (select 1 from asa_clientes where razon_social = 'EQUINOCCIO BAVARO');
insert into asa_clientes (tipo_documento, rnc_cedula, razon_social, nombre_comercial, nombre_contacto, telefono, email, direccion, tipo_cliente)
select 'RNC', '130786089', 'GRUPO HODELPA', 'GRUPO HODELPA', 'No definido', null, null, 'Santo Domingo', 'empresa'
where not exists (select 1 from asa_clientes where razon_social = 'GRUPO HODELPA');
insert into asa_clientes (tipo_documento, rnc_cedula, razon_social, nombre_comercial, nombre_contacto, telefono, email, direccion, tipo_cliente)
select 'RNC', '101719257', 'INVERSIONES PUNTA LAGUNA SAS', 'IBEROSTAR HACIENDA DOMINICUS', 'No definido', null, null, 'Bayahibe, Romana', 'empresa'
where not exists (select 1 from asa_clientes where razon_social = 'INVERSIONES PUNTA LAGUNA SAS');
insert into asa_clientes (tipo_documento, rnc_cedula, razon_social, nombre_comercial, nombre_contacto, telefono, email, direccion, tipo_cliente)
select 'RNC', '101712325', 'INVERSIONES AZUL DEL ESTE DOMINICANA S A', 'INVERSIONES AZUL DEL ESTE DOMINICANA S A', 'No definido', null, null, 'Bavaro, Cabeza de Toro', 'empresa'
where not exists (select 1 from asa_clientes where razon_social = 'INVERSIONES AZUL DEL ESTE DOMINICANA S A');
insert into asa_clientes (tipo_documento, rnc_cedula, razon_social, nombre_comercial, nombre_contacto, telefono, email, direccion, tipo_cliente)
select 'RNC', '101563372', 'INVERSIONES CORALILLO', 'INVERSIONES CORALILLO S A S', 'No definido', null, null, 'Bavaro, Punta Cana', 'empresa'
where not exists (select 1 from asa_clientes where razon_social = 'INVERSIONES CORALILLO');
insert into asa_clientes (tipo_documento, rnc_cedula, razon_social, nombre_comercial, nombre_contacto, telefono, email, direccion, tipo_cliente)
select 'RNC', '131471226', 'MEGEVE INVESTMENT OFFICE', 'MEGEVE INVESTMENT OFFICE', 'No definido', null, null, 'SANTO DOMINGO', 'empresa'
where not exists (select 1 from asa_clientes where razon_social = 'MEGEVE INVESTMENT OFFICE');

-- ── 2. Plantas (hoteles) ───────────────────────────────────────────────────
insert into asa_sitios (cliente_id, nombre, direccion, tipo_sitio)
select c.id, 'BLUE SEA PLAYA DORADA', 'Puerto Plata', 'hotel' from asa_clientes c
where (c.razon_social = 'GRUPO HODELPA' or c.nombre_comercial = 'GRUPO HODELPA')
  and not exists (select 1 from asa_sitios s where s.nombre = 'BLUE SEA PLAYA DORADA');
insert into asa_sitios (cliente_id, nombre, direccion, tipo_sitio)
select c.id, 'CARIDELPA', 'Santiago', 'hotel' from asa_clientes c
where (c.razon_social = 'GRUPO HODELPA' or c.nombre_comercial = 'GRUPO HODELPA')
  and not exists (select 1 from asa_sitios s where s.nombre = 'CARIDELPA');
insert into asa_sitios (cliente_id, nombre, direccion, tipo_sitio)
select c.id, 'CASA DE ESPAÑA EN STO DGO INC', 'Autopista 30 de Mayo 11b, Santo Domingo', 'hotel' from asa_clientes c
where (c.razon_social = 'CASA DE ESPAÑA EN STO DGO INC' or c.nombre_comercial = 'CASA DE ESPAÑA EN STO DGO INC')
  and not exists (select 1 from asa_sitios s where s.nombre = 'CASA DE ESPAÑA EN STO DGO INC');
insert into asa_sitios (cliente_id, nombre, direccion, tipo_sitio)
select c.id, 'COBEGA', 'Juan Dolio', 'hotel' from asa_clientes c
where (c.razon_social = 'GRUPO HODELPA' or c.nombre_comercial = 'GRUPO HODELPA')
  and not exists (select 1 from asa_sitios s where s.nombre = 'COBEGA');
insert into asa_sitios (cliente_id, nombre, direccion, tipo_sitio)
select c.id, 'CONDOMINIO CEIBAS IBEROSTATE PREMIUM CONDOS', 'CONDOMINIO CEIBAS IBEROSTATE PREMIUM CONDOS', 'hotel' from asa_clientes c
where (c.razon_social = 'INVERSIONES CORALILLO S A S' or c.nombre_comercial = 'INVERSIONES CORALILLO S A S')
  and not exists (select 1 from asa_sitios s where s.nombre = 'CONDOMINIO CEIBAS IBEROSTATE PREMIUM CONDOS');
insert into asa_sitios (cliente_id, nombre, direccion, tipo_sitio)
select c.id, 'COSTASUR DOMINICANA', 'Carretera La Romana - Higuey Hwy, La Romana', 'hotel' from asa_clientes c
where (c.razon_social = 'COSTASUR DOMINICANA' or c.nombre_comercial = 'COSTASUR DOMINICANA')
  and not exists (select 1 from asa_sitios s where s.nombre = 'COSTASUR DOMINICANA');
insert into asa_sitios (cliente_id, nombre, direccion, tipo_sitio)
select c.id, 'EMBASSY SUITES HOTEL.', 'Juan Dolio', 'hotel' from asa_clientes c
where (c.razon_social = 'GRUPO HODELPA' or c.nombre_comercial = 'GRUPO HODELPA')
  and not exists (select 1 from asa_sitios s where s.nombre = 'EMBASSY SUITES HOTEL.');
insert into asa_sitios (cliente_id, nombre, direccion, tipo_sitio)
select c.id, 'HODELPA CENTRO PLAZA', 'Santiago', 'hotel' from asa_clientes c
where (c.razon_social = 'GRUPO HODELPA' or c.nombre_comercial = 'GRUPO HODELPA')
  and not exists (select 1 from asa_sitios s where s.nombre = 'HODELPA CENTRO PLAZA');
insert into asa_sitios (cliente_id, nombre, direccion, tipo_sitio)
select c.id, 'HOTELES CATALONIA BAVARO', 'BAVARO, CABEZA DE TORO', 'hotel' from asa_clientes c
where (c.razon_social = 'INVERSIONES AZUL DEL ESTE DOMINICANA S A' or c.nombre_comercial = 'INVERSIONES AZUL DEL ESTE DOMINICANA S A')
  and not exists (select 1 from asa_sitios s where s.nombre = 'HOTELES CATALONIA BAVARO');
insert into asa_sitios (cliente_id, nombre, direccion, tipo_sitio)
select c.id, 'HOTELES CATALONIA BAVARO PERLS', 'BAVARO', 'hotel' from asa_clientes c
where (c.razon_social = 'INVERSIONES AZUL DEL ESTE DOMINICANA S A' or c.nombre_comercial = 'INVERSIONES AZUL DEL ESTE DOMINICANA S A')
  and not exists (select 1 from asa_sitios s where s.nombre = 'HOTELES CATALONIA BAVARO PERLS');
insert into asa_sitios (cliente_id, nombre, direccion, tipo_sitio)
select c.id, 'HOTELES CATALONIA BAVARO ROYAL', 'BAVARO, CABEZA DE TORO', 'hotel' from asa_clientes c
where (c.razon_social = 'INVERSIONES AZUL DEL ESTE DOMINICANA S A' or c.nombre_comercial = 'INVERSIONES AZUL DEL ESTE DOMINICANA S A')
  and not exists (select 1 from asa_sitios s where s.nombre = 'HOTELES CATALONIA BAVARO ROYAL');
insert into asa_sitios (cliente_id, nombre, direccion, tipo_sitio)
select c.id, 'HOTELES CATALONIA BAYAHIBE', 'BAYAHIBE, ROMANA', 'hotel' from asa_clientes c
where (c.razon_social = 'INVERSIONES AZUL DEL ESTE DOMINICANA S A' or c.nombre_comercial = 'INVERSIONES AZUL DEL ESTE DOMINICANA S A')
  and not exists (select 1 from asa_sitios s where s.nombre = 'HOTELES CATALONIA BAYAHIBE');
insert into asa_sitios (cliente_id, nombre, direccion, tipo_sitio)
select c.id, 'HOTELES CATALONIA BAYAHIBE ROYAL', 'BAYAHIBE, ROMANA', 'hotel' from asa_clientes c
where (c.razon_social = 'INVERSIONES AZUL DEL ESTE DOMINICANA S A' or c.nombre_comercial = 'INVERSIONES AZUL DEL ESTE DOMINICANA S A')
  and not exists (select 1 from asa_sitios s where s.nombre = 'HOTELES CATALONIA BAYAHIBE ROYAL');
insert into asa_sitios (cliente_id, nombre, direccion, tipo_sitio)
select c.id, 'HOTELES CATALONIA SANTO DOMINGO', 'SANTO DOMINGO, ESQUINA MAXIMO GOMEZ', 'hotel' from asa_clientes c
where (c.razon_social = 'INVERSIONES AZUL DEL ESTE DOMINICANA S A' or c.nombre_comercial = 'INVERSIONES AZUL DEL ESTE DOMINICANA S A')
  and not exists (select 1 from asa_sitios s where s.nombre = 'HOTELES CATALONIA SANTO DOMINGO');
insert into asa_sitios (cliente_id, nombre, direccion, tipo_sitio)
select c.id, 'IBEROSTAR COMUNES', 'BAVARO, PUNTA CANA', 'hotel' from asa_clientes c
where (c.razon_social = 'INVERSIONES CORALILLO S A S' or c.nombre_comercial = 'INVERSIONES CORALILLO S A S')
  and not exists (select 1 from asa_sitios s where s.nombre = 'IBEROSTAR COMUNES');
insert into asa_sitios (cliente_id, nombre, direccion, tipo_sitio)
select c.id, 'IBEROSTAR CORAL BAVARO', 'BAVARO, PUNTA CANA', 'hotel' from asa_clientes c
where (c.razon_social = 'INVERSIONES CORALILLO S A S' or c.nombre_comercial = 'INVERSIONES CORALILLO S A S')
  and not exists (select 1 from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO');
insert into asa_sitios (cliente_id, nombre, direccion, tipo_sitio)
select c.id, 'IBEROSTAR DOMINICANO', 'BAVARO, PUNTA CANA', 'hotel' from asa_clientes c
where (c.razon_social = 'INVERSIONES CORALILLO S A S' or c.nombre_comercial = 'INVERSIONES CORALILLO S A S')
  and not exists (select 1 from asa_sitios s where s.nombre = 'IBEROSTAR DOMINICANO');
insert into asa_sitios (cliente_id, nombre, direccion, tipo_sitio)
select c.id, 'IBEROSTAR HACIENDA DOMINICUS', 'Romanaa Bayahibe', 'hotel' from asa_clientes c
where (c.razon_social = 'IBEROSTAR HACIENDA DOMINICUS' or c.nombre_comercial = 'IBEROSTAR HACIENDA DOMINICUS')
  and not exists (select 1 from asa_sitios s where s.nombre = 'IBEROSTAR HACIENDA DOMINICUS');
insert into asa_sitios (cliente_id, nombre, direccion, tipo_sitio)
select c.id, 'IBEROSTAR JOIA', 'BAVARO, PUNTA CANA', 'hotel' from asa_clientes c
where (c.razon_social = 'INVERSIONES CORALILLO S A S' or c.nombre_comercial = 'INVERSIONES CORALILLO S A S')
  and not exists (select 1 from asa_sitios s where s.nombre = 'IBEROSTAR JOIA');
insert into asa_sitios (cliente_id, nombre, direccion, tipo_sitio)
select c.id, 'IBEROSTATE REPUBLICA DOMINICANA', 'Carretera Arena Gorda, Playa Bavaro', 'hotel' from asa_clientes c
where (c.razon_social = 'INVERSIONES CORALILLO S A S' or c.nombre_comercial = 'INVERSIONES CORALILLO S A S')
  and not exists (select 1 from asa_sitios s where s.nombre = 'IBEROSTATE REPUBLICA DOMINICANA');
insert into asa_sitios (cliente_id, nombre, direccion, tipo_sitio)
select c.id, 'LOPESAN', 'Carretera El Cortecito, Av Barcelo, BAVARO', 'hotel' from asa_clientes c
where (c.razon_social = 'EQUINOCCIO BAVARO' or c.nombre_comercial = 'EQUINOCCIO BAVARO')
  and not exists (select 1 from asa_sitios s where s.nombre = 'LOPESAN');

-- ── 3. Contratos ───────────────────────────────────────────────────────────
insert into asa_contratos_plagas (cliente_id, sitio_id, codigo, nombre, frecuencia, alcance)
select s.cliente_id, s.id, 'ICB001', 'Control de plagas — Iberostar Coral Bavaro', 'mensual',
       'Migrado del sistema anterior (export 19/09/2026)'
from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_contratos_plagas x where x.codigo = 'ICB001');
insert into asa_contratos_plagas (cliente_id, sitio_id, codigo, nombre, frecuencia, alcance)
select s.cliente_id, s.id, 'IC001', 'Control de plagas — Iberostar Comunes', 'mensual',
       'Migrado del sistema anterior (export 19/09/2026)'
from asa_sitios s where s.nombre = 'IBEROSTAR COMUNES'
  and not exists (select 1 from asa_contratos_plagas x where x.codigo = 'IC001');

-- ── 4. Estrategias (catálogo reutilizable en cualquier complejo) ───────────
insert into asa_estrategias (nombre, es_plantilla, descripcion)
select 'Lámpara ultravioletas atrapa moscas', true, 'Importada del sistema anterior'
where not exists (select 1 from asa_estrategias where upper(nombre) = upper('Lámpara ultravioletas atrapa moscas'));
insert into asa_estrategias (nombre, es_plantilla, descripcion)
select 'Dispensador de aerosol', true, 'Importada del sistema anterior'
where not exists (select 1 from asa_estrategias where upper(nombre) = upper('Dispensador de aerosol'));
insert into asa_estrategias (nombre, es_plantilla, descripcion)
select 'Aperturas en las áreas', true, 'Importada del sistema anterior'
where not exists (select 1 from asa_estrategias where upper(nombre) = upper('Aperturas en las áreas'));
insert into asa_estrategias (nombre, es_plantilla, descripcion)
select 'Prevención y Matenimiento', true, 'Importada del sistema anterior'
where not exists (select 1 from asa_estrategias where upper(nombre) = upper('Prevención y Matenimiento'));
insert into asa_estrategias (nombre, es_plantilla, descripcion)
select 'Actividades de control', true, 'Importada del sistema anterior'
where not exists (select 1 from asa_estrategias where upper(nombre) = upper('Actividades de control'));
insert into asa_estrategias (nombre, es_plantilla, descripcion)
select 'Lámina pegante para moscas', true, 'Importada del sistema anterior'
where not exists (select 1 from asa_estrategias where upper(nombre) = upper('Lámina pegante para moscas'));
insert into asa_estrategias (nombre, es_plantilla, descripcion)
select 'Monitoreo Post-Tratamiento', true, 'Importada del sistema anterior'
where not exists (select 1 from asa_estrategias where upper(nombre) = upper('Monitoreo Post-Tratamiento'));
insert into asa_estrategias (nombre, es_plantilla, descripcion)
select 'Monitoreo permanente con estaciones de cebaderos', true, 'Importada del sistema anterior'
where not exists (select 1 from asa_estrategias where upper(nombre) = upper('Monitoreo permanente con estaciones de cebaderos'));
insert into asa_estrategias (nombre, es_plantilla, descripcion)
select 'Estación de Cebo', true, 'Importada del sistema anterior'
where not exists (select 1 from asa_estrategias where upper(nombre) = upper('Estación de Cebo'));

-- ── 5. Áreas ───────────────────────────────────────────────────────────────
insert into asa_areas (sitio_id, nombre)
select s.id, 'Cocina central en general' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Cocina central en general'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Cuartos de Basura área de recibo' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Cuartos de Basura área de recibo'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Cocina El Faro en general' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Cocina El Faro en general'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Cocina Palapa Buffet' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Cocina Palapa Buffet'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Room service' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Room service'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Comedor' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Comedor'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'ENTRADA DE COCINA' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('ENTRADA DE COCINA'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Buffet' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Buffet'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Star Café' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Star Café'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Star prestige Bavaro' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Star prestige Bavaro'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'GRIL' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('GRIL'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'PALAPA' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('PALAPA'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'PASTELERIA ENTRADA' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('PASTELERIA ENTRADA'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Cocina Salt and Soul' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Cocina Salt and Soul'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Restaurante Jambalaja' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Restaurante Jambalaja'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Restaurante La Couple' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Restaurante La Couple'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Restaurante Brave' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Restaurante Brave'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Restaurante' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Restaurante'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Pantry Leguimer' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Pantry Leguimer'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Retaurante Salt and soul' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Retaurante Salt and soul'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Buffet central' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Buffet central'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Retaurante Break' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Retaurante Break'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Restaurante Dorada' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Restaurante Dorada'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Restaurante Kauki' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Restaurante Kauki'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Restaurante Italiano' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Restaurante Italiano'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Restauante' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Restauante'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Buffet El faro' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Buffet El faro'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Cocina' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Cocina'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Cocina Jambalaja' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Cocina Jambalaja'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Cocina Couple' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Cocina Couple'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Nocturna Brave' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Nocturna Brave'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Star prestige Coral' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Star prestige Coral'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Cocina Palapa Restaurante' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Cocina Palapa Restaurante'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Cocina mediteraneo' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Cocina mediteraneo'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Cocina Japones' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Cocina Japones'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Áreas verdes' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Áreas verdes'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Teatro' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Teatro'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Office camarista' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Office camarista'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Termonebulizador' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Termonebulizador'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Habitación huested' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Habitación huested'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Cocina coral' from asa_sitios s where s.nombre = 'IBEROSTAR CORAL BAVARO'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Cocina coral'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Área exterior' from asa_sitios s where s.nombre = 'IBEROSTAR COMUNES'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Área exterior'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Área de basura del comedor' from asa_sitios s where s.nombre = 'IBEROSTAR COMUNES'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Área de basura del comedor'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Pasillo de cocina' from asa_sitios s where s.nombre = 'IBEROSTAR COMUNES'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Pasillo de cocina'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Cocina' from asa_sitios s where s.nombre = 'IBEROSTAR COMUNES'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Cocina'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Carniceria' from asa_sitios s where s.nombre = 'IBEROSTAR COMUNES'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Carniceria'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Despensa cocina central' from asa_sitios s where s.nombre = 'IBEROSTAR COMUNES'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Despensa cocina central'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Pantry cocina central' from asa_sitios s where s.nombre = 'IBEROSTAR COMUNES'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Pantry cocina central'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Panadería' from asa_sitios s where s.nombre = 'IBEROSTAR COMUNES'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Panadería'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Economato' from asa_sitios s where s.nombre = 'IBEROSTAR COMUNES'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Economato'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Comedor' from asa_sitios s where s.nombre = 'IBEROSTAR COMUNES'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Comedor'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Campo de golf' from asa_sitios s where s.nombre = 'IBEROSTAR COMUNES'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Campo de golf'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Pasillo de cámara fría' from asa_sitios s where s.nombre = 'IBEROSTAR COMUNES'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Pasillo de cámara fría'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Perola' from asa_sitios s where s.nombre = 'IBEROSTAR COMUNES'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Perola'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Despensa' from asa_sitios s where s.nombre = 'IBEROSTAR COMUNES'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Despensa'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Apartados' from asa_sitios s where s.nombre = 'IBEROSTAR COMUNES'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Apartados'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Área Múltiple (Iberostar Comunes cocina, Iberostar Comunes comedor, Iberostar Comunes Alojamiento empleados, Iberostar Comunes Punto verde, Iberostar Comunes Panaderia, Iberostar Comunes patio de maniobra, Iberostar Comunes cuartos de basuras, Iberostar Comunes Camión de la cocina, Iberostar Comunes Spa, Iberostar Comunes Gym, Iberostar Comunes registros, Iberostar Comunes Campo de golf, Iberostar Comunes Registros, Iberostar Comunes Campo de Golf cocina, Iberostar Comunes Area reciclaje, Iberostar Comunes Lavanderia, Iberostar Comunes Economato, Iberostar Comunes Lockers de empleados, Iberostar Comunes Termonebulizador, Iberostar Comunes pasillo de cocina, Iberostar Comunes carniceria, Iberostar Comunes pantry cocina central, Iberostar Comunes apartados, Iberostar Comunes Área exterior, Iberostar Comunes Área de basura del comedor, Iberostar Comunes despensa cocina central, Iberostar Comunes panadería, Iberostar Comunes cámara fría, Iberostar Comunes Despensa, Iberostar Comunes Perola, Iberostar Comunes pasillo de cámara fría)' from asa_sitios s where s.nombre = 'IBEROSTAR COMUNES'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Área Múltiple (Iberostar Comunes cocina, Iberostar Comunes comedor, Iberostar Comunes Alojamiento empleados, Iberostar Comunes Punto verde, Iberostar Comunes Panaderia, Iberostar Comunes patio de maniobra, Iberostar Comunes cuartos de basuras, Iberostar Comunes Camión de la cocina, Iberostar Comunes Spa, Iberostar Comunes Gym, Iberostar Comunes registros, Iberostar Comunes Campo de golf, Iberostar Comunes Registros, Iberostar Comunes Campo de Golf cocina, Iberostar Comunes Area reciclaje, Iberostar Comunes Lavanderia, Iberostar Comunes Economato, Iberostar Comunes Lockers de empleados, Iberostar Comunes Termonebulizador, Iberostar Comunes pasillo de cocina, Iberostar Comunes carniceria, Iberostar Comunes pantry cocina central, Iberostar Comunes apartados, Iberostar Comunes Área exterior, Iberostar Comunes Área de basura del comedor, Iberostar Comunes despensa cocina central, Iberostar Comunes panadería, Iberostar Comunes cámara fría, Iberostar Comunes Despensa, Iberostar Comunes Perola, Iberostar Comunes pasillo de cámara fría)'));
insert into asa_areas (sitio_id, nombre)
select s.id, 'Punto verde' from asa_sitios s where s.nombre = 'IBEROSTAR COMUNES'
  and not exists (select 1 from asa_areas a where a.sitio_id = s.id and upper(a.nombre) = upper('Punto verde'));

-- ── 6. Puntos de control ───────────────────────────────────────────────────
-- Se cargan por tabla temporal y un solo insert con joins: mucho más rápido
-- que 1012 inserts sueltos, y deja ver de una qué fila no encontró su área.
create temporary table tmp_puntos (
  planta text, contrato text, qr text, codigo text,
  area text, estrategia text, tipo text, habitacion text
) on commit drop;

insert into tmp_puntos (planta, contrato, qr, codigo, area, estrategia, tipo, habitacion) values
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536172','IBCLAMPARAUV003','Cocina central en general','Lámpara ultravioletas atrapa moscas','lampara_moscas',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536173','IBCLAMPARAUV001','Cuartos de Basura área de recibo','Lámpara ultravioletas atrapa moscas','lampara_moscas',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536174','IBCLAMPARAUV002','Cocina El Faro en general','Lámpara ultravioletas atrapa moscas','lampara_moscas',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536175','IBCLAMPARAUV004','Cocina Palapa Buffet','Lámpara ultravioletas atrapa moscas','lampara_moscas',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536176','IBCLAMPARAUV005','Cocina Palapa Buffet','Lámpara ultravioletas atrapa moscas','lampara_moscas',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536177','IBCLAMPARAUV010','Cocina Palapa Buffet','Lámpara ultravioletas atrapa moscas','lampara_moscas',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536178','IBAEROSOLCBRS001','Room service','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536179','IBAEROSOLCBRS002','Comedor','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536180','IBAEROSOLCBRS003','ENTRADA DE COCINA','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536181','IBAEROSOLB004','Buffet','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536182','IBAEROSOLB005','Buffet','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536183','IBAEROSOLB006','Buffet','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536184','IBAEROSOLB007','Buffet','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536185','IBAEROSOLSC008','Star Café','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536186','IBAEROSOLCF009','Cocina El Faro en general','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536187','IBAEROSOLCF010','Cocina El Faro en general','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536188','IBAEROSOLCF011','Cocina El Faro en general','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536189','IBAEROSOLCF012','Cocina El Faro en general','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536190','IBAEROSOLCF013','Cocina El Faro en general','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536191','IBAEROSOLCF014','Cocina El Faro en general','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536192','IBAEROSOLSTB015','Star prestige Bavaro','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536193','IBAEROSOLSTB016','Star prestige Bavaro','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536194','IBAEROSOLSTB017','Star prestige Bavaro','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536195','IBAEROSOLG018','GRIL','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536196','IBAEROSOLG019','GRIL','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536197','IBAEROSOLBP020','PALAPA','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536198','IBAEROSOLBP021','PALAPA','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536199','IBCLAMPARAUV006','ENTRADA DE COCINA','Lámpara ultravioletas atrapa moscas','lampara_moscas',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536200','IBCLAMPARAUV007','PASTELERIA ENTRADA','Lámpara ultravioletas atrapa moscas','lampara_moscas',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536201','IBCLAMPARAUV008','Cocina Salt and Soul','Lámpara ultravioletas atrapa moscas','lampara_moscas',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536202','IBCLAMPARAUV009','Cocina Salt and Soul','Lámpara ultravioletas atrapa moscas','lampara_moscas',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536203','IBCRS1','Room service','Aperturas en las áreas','apertura',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536204','IBCRJ1','Restaurante Jambalaja','Aperturas en las áreas','apertura',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536205','IBCRC3','Restaurante La Couple','Aperturas en las áreas','apertura',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536206','ICBRRC4','Restaurante Brave','Aperturas en las áreas','apertura',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536207','IBCR5','Restaurante','Aperturas en las áreas','apertura',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536208','ICBPL6','Pantry Leguimer','Aperturas en las áreas','apertura',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536209','ISBRR7','Retaurante Salt and soul','Aperturas en las áreas','apertura',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536210','ICBBC9','Buffet central','Aperturas en las áreas','apertura',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536211','ICBRB13','Retaurante Break','Aperturas en las áreas','apertura',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536212','IBCB11','Buffet','Aperturas en las áreas','apertura',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536213','81','Restaurante Dorada','Aperturas en las áreas','apertura',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536214','IBC3410','Restaurante Kauki','Aperturas en las áreas','apertura',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536215','ICBRI8','Restaurante Italiano','Aperturas en las áreas','apertura',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536216','ICBR12','Restauante','Aperturas en las áreas','apertura',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536217','ICBRF15','Buffet El faro','Aperturas en las áreas','apertura',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536218','IBCRS16','Room service','Aperturas en las áreas','apertura',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536219','IBCC011','Cocina','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536220','IBCC12','Comedor','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536221','IBCRS3','Room service','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536222','ICBRJ4','Restaurante Jambalaja','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536223','ICBRLC5','Restaurante La Couple','Aperturas en las áreas','apertura',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536224','IBCBRB5','Restaurante Brave','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536225','IBCBCJ6','Cocina Jambalaja','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536226','IBCBCC7','Cocina Couple','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536227','ICBC11','Restaurante','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536228','IBCB12','Nocturna Brave','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536229','IBCPL13','Pantry Leguimer','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536230','IMCRSS14','Retaurante Salt and soul','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536231','IBCRSS15','Retaurante Salt and soul','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536232','ICBCFG17','Cocina El Faro en general','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536233','IBCBC18','Buffet central','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536234','ICBPB19','Cocina Palapa Buffet','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536235','ICBSPB20','Star prestige Bavaro','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536236','ICBSPC21','Star prestige Coral','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536237','ICBCPR24','Cocina Palapa Restaurante','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536238','ICBRS27','Room service','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536239','ICBRS29','Room service','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536240','ICBBREAK30','Retaurante Break','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536241','ICBCM31','Cocina mediteraneo','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536242','ICBCJ32','Cocina Japones','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536243','ICBRD33','Restaurante Dorada','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536244','ICBRHAUHI34','Restaurante Kauki','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536245','ICBRITA35','Restaurante Italiano','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536246','ICBCSS38','Cocina Salt and Soul','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536247','ICBRC39','Restauante','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536248','ICBBF40','Buffet El faro','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536249','ICBRS41','Room service','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536250','ICBBUF42','Buffet','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536251','ICBAB3','Áreas verdes','Actividades de control','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536252','ICBARRE19','Cuartos de Basura área de recibo','Actividades de control','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536253','ICBTEA42','Teatro','Actividades de control','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536254','IBCOC43','Office camarista','Actividades de control','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536255','IBCEC44','ENTRADA DE COCINA','Actividades de control','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536256','IBCPAS45','PASTELERIA ENTRADA','Actividades de control','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536257','ICB46','PALAPA','Actividades de control','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536258','ICBT1','Termonebulizador','Actividades de control','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536259','ICB346','Áreas verdes','Actividades de control','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536260','ICBHAB1','Habitación huested','Lámina pegante para moscas','trampa_pegajosa',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536261','ICBC1','Cocina','Monitoreo Post-Tratamiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536262','ICBCJ8','Cocina Jambalaja','Monitoreo Post-Tratamiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536263','ICBCC9','Cocina Couple','Monitoreo Post-Tratamiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536264','ICBCF16','Cocina El Faro en general','Monitoreo Post-Tratamiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536265','IBCRBRA11','Nocturna Brave','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536266','ICBCC17','Cocina central en general','Monitoreo Post-Tratamiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536267','ICBCPB19','Cocina Palapa Buffet','Monitoreo Post-Tratamiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536268','ICBCP19','Cocina Palapa Buffet','Monitoreo Post-Tratamiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536269','ICBCP24','Cocina Palapa Restaurante','Monitoreo Post-Tratamiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536270','ICBCME31','Cocina mediteraneo','Monitoreo Post-Tratamiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536271','ICBCC37','Cocina coral','Monitoreo Post-Tratamiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536272','ICBCJAP32','Cocina Japones','Monitoreo Post-Tratamiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536273','IBEROSTAR CORAL BAVARO STAR CAFE14','Star Café','Aperturas en las áreas','apertura',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536274','CCBAVARO001','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536275','CCBAVARO002','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536276','CCBAVARO003','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536277','CCBAVARO004','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536278','CCBAVARO005','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536279','CCBAVARO006','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536280','CCBAVARO007','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536281','CCBAVARO008','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536282','CCBAVARO009','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536283','CCBAVARO010','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536284','CCBAVARO011','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536285','CCBAVARO012','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536286','CCBAVARO013','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536287','CCBAVARO014','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536288','CCBAVARO015','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536289','CCBAVARO016','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536290','CCBAVARO017','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536291','CCBAVARO018','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536292','CCBAVARO019','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536293','CCBAVARO020','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536294','CCBAVARO021','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536295','CCBAVARO022','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536296','CCBAVARO023','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536297','CCBAVARO024','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536298','CCBAVARO025','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536299','CCBAVARO026','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536300','CCBAVARO027','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536301','CCBAVARO028','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536302','CCBAVARO029','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536303','CCBAVARO030','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536304','CCBAVARO031','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536305','CCBAVARO032','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536306','CCBAVARO033','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536307','CCBAVARO034','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536308','CCBAVARO035','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536309','CCBAVARO036','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536310','CCBAVARO037','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536311','CCBAVARO038','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536312','CCBAVARO039','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536313','CCBAVARO040','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536314','CCBAVARO041','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536315','CCBAVARO042','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536316','CCBAVARO043','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536317','CCBAVARO044','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536318','CCBAVARO045','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536319','CCBAVARO046','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536320','CCBAVARO047','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536321','CCBAVARO048','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536322','CCBAVARO049','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536323','CCBAVARO050','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536324','CCBAVARO051','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536325','CCBAVARO052','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536326','CCBAVARO053','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536327','CCBAVARO054','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536328','CCBAVARO055','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536329','CCBAVARO056','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536330','CCBAVARO057','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536331','CCBAVARO058','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536332','CCBAVARO059','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536333','CCBAVARO060','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536334','CCBAVARO061','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536335','CCBAVARO062','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536336','CCBAVARO063','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536337','CCBAVARO064','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536338','CCBAVARO065','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536339','CCBAVARO066','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536340','CCBAVARO067','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536341','CCBAVARO068','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536342','CCBAVARO069','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536343','CCBAVARO070','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536344','CCBAVARO071','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536345','CCBAVARO072','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536346','CCBAVARO073','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536347','CCBAVARO074','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536348','CCBAVARO075','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536349','CCBAVARO076','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536350','CCBAVARO077','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536351','CCBAVARO078','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536352','CCBAVARO079','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536353','CCBAVARO080','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536354','CCBAVARO081','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536355','CCBAVARO082','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536356','CCBAVARO083','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536357','CCBAVARO084','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536358','CCBAVARO085','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536359','CCBAVARO086','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536360','CCBAVARO087','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536361','CCBAVARO088','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536362','CCBAVARO089','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536363','CCBAVARO090','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536364','CCBAVARO091','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536365','CCBAVARO092','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536366','CCBAVARO093','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536367','CCBAVARO094','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536368','CCBAVARO095','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536369','CCBAVARO096','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536370','CCBAVARO097','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536371','CCBAVARO098','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536372','CCBAVARO099','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536373','CCBAVARO100','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536374','CCBAVARO101','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536375','CCBAVARO102','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536376','CCBAVARO103','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536377','CCBAVARO104','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536378','CCBAVARO105','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536379','CCBAVARO106','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536380','CCBAVARO107','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536381','CCBAVARO108','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536382','CCBAVARO109','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536383','CCBAVARO110','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536384','CCBAVARO111','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536385','CCBAVARO112','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536386','CCBAVARO113','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536387','CCBAVARO114','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536388','CCBAVARO115','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536389','CCBAVARO116','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536390','CCBAVARO117','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536391','CCBAVARO118','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536392','CCBAVARO119','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536393','CCBAVARO120','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536394','CCBAVARO121','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536395','CCBAVARO122','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536396','CCBAVARO123','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536397','CCBAVARO124','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536398','CCBAVARO125','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536399','CCBAVARO126','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536400','CCBAVARO127','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536401','CCBAVARO128','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536402','CCBAVARO129','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536403','CCBAVARO130','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536404','CCBAVARO131','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536405','CCBAVARO132','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536406','CCBAVARO133','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536407','CCBAVARO134','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536408','CCBAVARO135','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536409','CCBAVARO136','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536410','CCBAVARO137','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536411','CCBAVARO138','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536412','CCBAVARO139','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536413','CCBAVARO140','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536414','CCBAVARO141','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536415','CCBAVARO142','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536416','CCBAVARO143','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536417','CCBAVARO144','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536418','CCBAVARO145','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536419','CCBAVARO146','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536420','CCBAVARO147','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536421','CCBAVARO148','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536422','CCBAVARO149','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536423','CCBAVARO150','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536424','CCBAVARO151','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536425','CCBAVARO152','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536426','CCBAVARO153','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536427','CCBAVARO154','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536428','CCBAVARO155','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536429','CCBAVARO156','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536430','CCBAVARO157','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536431','CCBAVARO158','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536432','CCBAVARO159','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536433','CCBAVARO160','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536434','CCBAVARO161','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536435','CCBAVARO162','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536436','CCBAVARO163','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536437','CCBAVARO164','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536438','CCBAVARO165','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536439','CCBAVARO166','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536440','CCBAVARO167','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536441','CCBAVARO168','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536442','CCBAVARO169','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536443','CCBAVARO170','Áreas verdes','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536444','H2618','Habitación huested','Prevención y Matenimiento','habitacion','2618'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536445','H2496','Habitación huested','Prevención y Matenimiento','habitacion','2496'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536446','H3935','Habitación huested','Prevención y Matenimiento','habitacion','3935'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536447','H2491','Habitación huested','Prevención y Matenimiento','habitacion','2491'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536448','H2684','Habitación huested','Prevención y Matenimiento','habitacion','2684'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536449','H2487','Habitación huested','Prevención y Matenimiento','habitacion','2487'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536450','H2687','Habitación huested','Prevención y Matenimiento','habitacion','2687'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536451','20505-1297','Habitación huested','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536452','H2383','Habitación huested','Prevención y Matenimiento','habitacion','2383'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536453','H3852','Habitación huested','Prevención y Matenimiento','habitacion','3852'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536454','H2502','Habitación huested','Prevención y Matenimiento','habitacion','2502'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536455','H2506','Habitación huested','Prevención y Matenimiento','habitacion','2506'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536456','H2347','Habitación huested','Prevención y Matenimiento','habitacion','2347'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536457','H2371','Habitación huested','Prevención y Matenimiento','habitacion','2371'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536458','H2401','Habitación huested','Prevención y Matenimiento','habitacion','2401'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536459','H2407','Habitación huested','Prevención y Matenimiento','habitacion','2407'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536460','H2408','Habitación huested','Prevención y Matenimiento','habitacion','2408'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536461','H3881','Habitación huested','Prevención y Matenimiento','habitacion','3881'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536462','H3918','Habitación huested','Prevención y Matenimiento','habitacion','3918'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536463','H3932','Habitación huested','Prevención y Matenimiento','habitacion','3932'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536464','H3937','Habitación huested','Prevención y Matenimiento','habitacion','3937'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536465','H1052','Habitación huested','Prevención y Matenimiento','habitacion','1052'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536466','ICBC37','Cocina coral','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536467','H1091','Habitación huested','Prevención y Matenimiento','habitacion','1091'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536468','H1092','Habitación huested','Prevención y Matenimiento','habitacion','1092'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536469','H1093','Habitación huested','Prevención y Matenimiento','habitacion','1093'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536470','H1094','Habitación huested','Prevención y Matenimiento','habitacion','1094'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536471','H1095','Habitación huested','Prevención y Matenimiento','habitacion','1095'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536472','H1096','Habitación huested','Prevención y Matenimiento','habitacion','1096'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536473','H1097','Habitación huested','Prevención y Matenimiento','habitacion','1097'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536474','H1098','Habitación huested','Prevención y Matenimiento','habitacion','1098'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536475','H1101','Habitación huested','Prevención y Matenimiento','habitacion','1101'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536476','H1102','Habitación huested','Prevención y Matenimiento','habitacion','1102'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536477','H1103','Habitación huested','Prevención y Matenimiento','habitacion','1103'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536478','H1104','Habitación huested','Prevención y Matenimiento','habitacion','1104'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536479','H1105','Habitación huested','Prevención y Matenimiento','habitacion','1105'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536480','H1106','Habitación huested','Prevención y Matenimiento','habitacion','1106'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536481','H1107','Habitación huested','Prevención y Matenimiento','habitacion','1107'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536482','H1108','Habitación huested','Prevención y Matenimiento','habitacion','1108'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536483','H1111','Habitación huested','Prevención y Matenimiento','habitacion','1111'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536484','H1112','Habitación huested','Prevención y Matenimiento','habitacion','1112'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536485','H1113','Habitación huested','Prevención y Matenimiento','habitacion','1113'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536486','H1114','Habitación huested','Prevención y Matenimiento','habitacion','1114'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536487','H1115','Habitación huested','Prevención y Matenimiento','habitacion','1115'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536488','H1116','Habitación huested','Prevención y Matenimiento','habitacion','1116'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536489','H1117','Habitación huested','Prevención y Matenimiento','habitacion','1117'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536490','H1118','Habitación huested','Prevención y Matenimiento','habitacion','1118'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536491','H1121','Habitación huested','Prevención y Matenimiento','habitacion','1121'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536492','H1122','Habitación huested','Prevención y Matenimiento','habitacion','1122'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536493','H1123','Habitación huested','Prevención y Matenimiento','habitacion','1123'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536494','H1124','Habitación huested','Prevención y Matenimiento','habitacion','1124'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536495','H1125','Habitación huested','Prevención y Matenimiento','habitacion','1125'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536496','H1126','Habitación huested','Prevención y Matenimiento','habitacion','1126'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536497','H1127','Habitación huested','Prevención y Matenimiento','habitacion','1127'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536498','H1128','Habitación huested','Prevención y Matenimiento','habitacion','1128'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536499','H1131','Habitación huested','Prevención y Matenimiento','habitacion','1131'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536500','H1132','Habitación huested','Prevención y Matenimiento','habitacion','1132'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536501','H1133','Habitación huested','Prevención y Matenimiento','habitacion','1133'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536502','H1134','Habitación huested','Prevención y Matenimiento','habitacion','1134'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536503','H1135','Habitación huested','Prevención y Matenimiento','habitacion','1135'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536504','H1001','Habitación huested','Prevención y Matenimiento','habitacion','1001'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536505','H1002','Habitación huested','Prevención y Matenimiento','habitacion','1002'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536506','H1003','Habitación huested','Prevención y Matenimiento','habitacion','1003'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536507','H1004','Habitación huested','Prevención y Matenimiento','habitacion','1004'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536508','H1005','Habitación huested','Prevención y Matenimiento','habitacion','1005'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536509','H1006','Habitación huested','Prevención y Matenimiento','habitacion','1006'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536510','H1007','Habitación huested','Prevención y Matenimiento','habitacion','1007'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536511','H1008','Habitación huested','Prevención y Matenimiento','habitacion','1008'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536512','H1011','Habitación huested','Prevención y Matenimiento','habitacion','1011'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536513','H1012','Habitación huested','Prevención y Matenimiento','habitacion','1012'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536514','H1013','Habitación huested','Prevención y Matenimiento','habitacion','1013'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536515','H1014','Habitación huested','Prevención y Matenimiento','habitacion','1014'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536516','H1015','Habitación huested','Prevención y Matenimiento','habitacion','1015'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536517','H1016','Habitación huested','Prevención y Matenimiento','habitacion','1016'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536518','H1017','Habitación huested','Prevención y Matenimiento','habitacion','1017'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536519','H1018','Habitación huested','Prevención y Matenimiento','habitacion','1018'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536520','H1021','Habitación huested','Prevención y Matenimiento','habitacion','1021'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536521','H1022','Habitación huested','Prevención y Matenimiento','habitacion','1022'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536522','H1023','Habitación huested','Prevención y Matenimiento','habitacion','1023'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536523','H1024','Habitación huested','Prevención y Matenimiento','habitacion','1024'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536524','H1025','Habitación huested','Prevención y Matenimiento','habitacion','1025'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536525','H1026','Habitación huested','Prevención y Matenimiento','habitacion','1026'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536526','H1027','Habitación huested','Prevención y Matenimiento','habitacion','1027'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536527','H1028','Habitación huested','Prevención y Matenimiento','habitacion','1028'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536528','H1031','Habitación huested','Prevención y Matenimiento','habitacion','1031'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536529','H1032','Habitación huested','Prevención y Matenimiento','habitacion','1032'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536530','H1033','Habitación huested','Prevención y Matenimiento','habitacion','1033'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536531','H1034','Habitación huested','Prevención y Matenimiento','habitacion','1034'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536532','H1035','Habitación huested','Prevención y Matenimiento','habitacion','1035'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536533','H1036','Habitación huested','Prevención y Matenimiento','habitacion','1036'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536534','H1037','Habitación huested','Prevención y Matenimiento','habitacion','1037'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536535','H1038','Habitación huested','Prevención y Matenimiento','habitacion','1038'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536536','H1051','Habitación huested','Prevención y Matenimiento','habitacion','1051'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536537','H1053','Habitación huested','Prevención y Matenimiento','habitacion','1053'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536538','H1054','Habitación huested','Prevención y Matenimiento','habitacion','1054'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536539','H1056','Habitación huested','Prevención y Matenimiento','habitacion','1056'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536540','H1057','Habitación huested','Prevención y Matenimiento','habitacion','1057'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536541','H1058','Habitación huested','Prevención y Matenimiento','habitacion','1058'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536542','H1041','Habitación huested','Prevención y Matenimiento','habitacion','1041'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536543','H1042','Habitación huested','Prevención y Matenimiento','habitacion','1042'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536544','H1043','Habitación huested','Prevención y Matenimiento','habitacion','1043'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536545','H1044','Habitación huested','Prevención y Matenimiento','habitacion','1044'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536546','H1045','Habitación huested','Prevención y Matenimiento','habitacion','1045'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536547','H1046','Habitación huested','Prevención y Matenimiento','habitacion','1046'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536548','H1047','Habitación huested','Prevención y Matenimiento','habitacion','1047'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536549','H1048','Habitación huested','Prevención y Matenimiento','habitacion','1048'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536550','H1061','Habitación huested','Prevención y Matenimiento','habitacion','1061'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536551','H1062','Habitación huested','Prevención y Matenimiento','habitacion','1062'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536552','H1063','Habitación huested','Prevención y Matenimiento','habitacion','1063'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536553','H1064','Habitación huested','Prevención y Matenimiento','habitacion','1064'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536554','H1065','Habitación huested','Prevención y Matenimiento','habitacion','1065'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536555','H1066','Habitación huested','Prevención y Matenimiento','habitacion','1066'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536556','H1067','Habitación huested','Prevención y Matenimiento','habitacion','1067'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536557','H1068','Habitación huested','Prevención y Matenimiento','habitacion','1068'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536558','H1071','Habitación huested','Prevención y Matenimiento','habitacion','1071'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536559','H1072','Habitación huested','Prevención y Matenimiento','habitacion','1072'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536560','H1073','Habitación huested','Prevención y Matenimiento','habitacion','1073'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536561','H1074','Habitación huested','Prevención y Matenimiento','habitacion','1074'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536562','H1075','Habitación huested','Prevención y Matenimiento','habitacion','1075'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536563','H1076','Habitación huested','Prevención y Matenimiento','habitacion','1076'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536564','H1077','Habitación huested','Prevención y Matenimiento','habitacion','1077'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536565','H1078','Habitación huested','Prevención y Matenimiento','habitacion','1078'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536566','H1201','Habitación huested','Prevención y Matenimiento','habitacion','1201'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536567','H1202','Habitación huested','Prevención y Matenimiento','habitacion','1202'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536568','H1203','Habitación huested','Prevención y Matenimiento','habitacion','1203'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536569','H1204','Habitación huested','Prevención y Matenimiento','habitacion','1204'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536570','H1205','Habitación huested','Prevención y Matenimiento','habitacion','1205'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536571','H1206','Habitación huested','Prevención y Matenimiento','habitacion','1206'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536572','H1207','Habitación huested','Prevención y Matenimiento','habitacion','1207'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536573','H1208','Habitación huested','Prevención y Matenimiento','habitacion','1208'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536574','H1211','Habitación huested','Prevención y Matenimiento','habitacion','1211'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536575','H1212','Habitación huested','Prevención y Matenimiento','habitacion','1212'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536576','H1213','Habitación huested','Prevención y Matenimiento','habitacion','1213'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536577','H1214','Habitación huested','Prevención y Matenimiento','habitacion','1214'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536578','H1136','Habitación huested','Prevención y Matenimiento','habitacion','1136'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536579','H1137','Habitación huested','Prevención y Matenimiento','habitacion','1137'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536580','H1138','Habitación huested','Prevención y Matenimiento','habitacion','1138'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536581','H1141','Habitación huested','Prevención y Matenimiento','habitacion','1141'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536582','H1142','Habitación huested','Prevención y Matenimiento','habitacion','1142'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536583','H1143','Habitación huested','Prevención y Matenimiento','habitacion','1143'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536584','H1144','Habitación huested','Prevención y Matenimiento','habitacion','1144'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536585','H1145','Habitación huested','Prevención y Matenimiento','habitacion','1145'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536586','H1146','Habitación huested','Prevención y Matenimiento','habitacion','1146'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536587','H1147','Habitación huested','Prevención y Matenimiento','habitacion','1147'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536588','H1148','Habitación huested','Prevención y Matenimiento','habitacion','1148'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536589','H1151','Habitación huested','Prevención y Matenimiento','habitacion','1151'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536590','H1152','Habitación huested','Prevención y Matenimiento','habitacion','1152'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536591','H1153','Habitación huested','Prevención y Matenimiento','habitacion','1153'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536592','H1154','Habitación huested','Prevención y Matenimiento','habitacion','1154'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536593','H1155','Habitación huested','Prevención y Matenimiento','habitacion','1155'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536594','H1156','Habitación huested','Prevención y Matenimiento','habitacion','1156'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536595','H1157','Habitación huested','Prevención y Matenimiento','habitacion','1157'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536596','H1158','Habitación huested','Prevención y Matenimiento','habitacion','1158'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536597','H1161','Habitación huested','Prevención y Matenimiento','habitacion','1161'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536598','H1162','Habitación huested','Prevención y Matenimiento','habitacion','1162'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536599','H1163','Habitación huested','Prevención y Matenimiento','habitacion','1163'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536600','H1164','Habitación huested','Prevención y Matenimiento','habitacion','1164'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536601','H1165','Habitación huested','Prevención y Matenimiento','habitacion','1165'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536602','H1166','Habitación huested','Prevención y Matenimiento','habitacion','1166'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536603','H1167','Habitación huested','Prevención y Matenimiento','habitacion','1167'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536604','H1168','Habitación huested','Prevención y Matenimiento','habitacion','1168'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536605','H1171','Habitación huested','Prevención y Matenimiento','habitacion','1171'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536606','H1172','Habitación huested','Prevención y Matenimiento','habitacion','1172'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536607','H1173','Habitación huested','Prevención y Matenimiento','habitacion','1173'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536608','H1174','Habitación huested','Prevención y Matenimiento','habitacion','1174'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536609','H1175','Habitación huested','Prevención y Matenimiento','habitacion','1175'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536610','H1176','Habitación huested','Prevención y Matenimiento','habitacion','1176'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536611','H1177','Habitación huested','Prevención y Matenimiento','habitacion','1177'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536612','H1178','Habitación huested','Prevención y Matenimiento','habitacion','1178'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536613','H1181','Habitación huested','Prevención y Matenimiento','habitacion','1181'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536614','H1182','Habitación huested','Prevención y Matenimiento','habitacion','1182'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536615','H1183','Habitación huested','Prevención y Matenimiento','habitacion','1183'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536616','H1184','Habitación huested','Prevención y Matenimiento','habitacion','1184'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536617','H1185','Habitación huested','Prevención y Matenimiento','habitacion','1185'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536618','H1186','Habitación huested','Prevención y Matenimiento','habitacion','1186'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536619','H1187','Habitación huested','Prevención y Matenimiento','habitacion','1187'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536620','H1188','Habitación huested','Prevención y Matenimiento','habitacion','1188'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536621','H1191','Habitación huested','Prevención y Matenimiento','habitacion','1191'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536622','H1192','Habitación huested','Prevención y Matenimiento','habitacion','1192'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536623','H1193','Habitación huested','Prevención y Matenimiento','habitacion','1193'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536624','H1194','Habitación huested','Prevención y Matenimiento','habitacion','1194'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536625','H1195','Habitación huested','Prevención y Matenimiento','habitacion','1195'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536626','H1196','Habitación huested','Prevención y Matenimiento','habitacion','1196'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536627','H1197','Habitación huested','Prevención y Matenimiento','habitacion','1197'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536628','H1198','Habitación huested','Prevención y Matenimiento','habitacion','1198'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536629','H2411','Habitación huested','Prevención y Matenimiento','habitacion','2411'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536630','H2412','Habitación huested','Prevención y Matenimiento','habitacion','2412'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536631','H2413','Habitación huested','Prevención y Matenimiento','habitacion','2413'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536632','H1215','Habitación huested','Prevención y Matenimiento','habitacion','1215'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536633','H1216','Habitación huested','Prevención y Matenimiento','habitacion','1216'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536634','H1217','Habitación huested','Prevención y Matenimiento','habitacion','1217'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536635','H1218','Habitación huested','Prevención y Matenimiento','habitacion','1218'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536636','H1221','Habitación huested','Prevención y Matenimiento','habitacion','1221'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536637','H1222','Habitación huested','Prevención y Matenimiento','habitacion','1222'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536638','H1223','Habitación huested','Prevención y Matenimiento','habitacion','1223'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536639','H1224','Habitación huested','Prevención y Matenimiento','habitacion','1224'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536640','H1225','Habitación huested','Prevención y Matenimiento','habitacion','1225'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536641','H1226','Habitación huested','Prevención y Matenimiento','habitacion','1226'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536642','H1227','Habitación huested','Prevención y Matenimiento','habitacion','1227'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536643','H1228','Habitación huested','Prevención y Matenimiento','habitacion','1228'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536644','H1231','Habitación huested','Prevención y Matenimiento','habitacion','1231'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536645','H1232','Habitación huested','Prevención y Matenimiento','habitacion','1232'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536646','H1233','Habitación huested','Prevención y Matenimiento','habitacion','1233'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536647','H1234','Habitación huested','Prevención y Matenimiento','habitacion','1234'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536648','H1235','Habitación huested','Prevención y Matenimiento','habitacion','1235'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536649','H1236','Habitación huested','Prevención y Matenimiento','habitacion','1236'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536650','H1237','Habitación huested','Prevención y Matenimiento','habitacion','1237'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536651','H1238','Habitación huested','Prevención y Matenimiento','habitacion','1238'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536652','H1241','Habitación huested','Prevención y Matenimiento','habitacion','1241'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536653','H1242','Habitación huested','Prevención y Matenimiento','habitacion','1242'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536654','H1243','Habitación huested','Prevención y Matenimiento','habitacion','1243'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536655','H1244','Habitación huested','Prevención y Matenimiento','habitacion','1244'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536656','H1245','Habitación huested','Prevención y Matenimiento','habitacion','1245'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536657','H1246','Habitación huested','Prevención y Matenimiento','habitacion','1246'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536658','H1247','Habitación huested','Prevención y Matenimiento','habitacion','1247'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536659','H1248','Habitación huested','Prevención y Matenimiento','habitacion','1248'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536660','H1251','Habitación huested','Prevención y Matenimiento','habitacion','1251'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536661','H1252','Habitación huested','Prevención y Matenimiento','habitacion','1252'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536662','H1253','Habitación huested','Prevención y Matenimiento','habitacion','1253'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536663','H1254','Habitación huested','Prevención y Matenimiento','habitacion','1254'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536664','H1255','Habitación huested','Prevención y Matenimiento','habitacion','1255'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536665','H1256','Habitación huested','Prevención y Matenimiento','habitacion','1256'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536666','H1257','Habitación huested','Prevención y Matenimiento','habitacion','1257'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536667','H1258','Habitación huested','Prevención y Matenimiento','habitacion','1258'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536668','H1261','Habitación huested','Prevención y Matenimiento','habitacion','1261'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536669','H1262','Habitación huested','Prevención y Matenimiento','habitacion','1262'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536670','H1263','Habitación huested','Prevención y Matenimiento','habitacion','1263'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536671','H1264','Habitación huested','Prevención y Matenimiento','habitacion','1264'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536672','H1265','Habitación huested','Prevención y Matenimiento','habitacion','1265'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536673','H1267','Habitación huested','Prevención y Matenimiento','habitacion','1267'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536674','H1268','Habitación huested','Prevención y Matenimiento','habitacion','1268'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536675','H1271','Habitación huested','Prevención y Matenimiento','habitacion','1271'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536676','H1272','Habitación huested','Prevención y Matenimiento','habitacion','1272'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536677','H1273','Habitación huested','Prevención y Matenimiento','habitacion','1273'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536678','H1274','Habitación huested','Prevención y Matenimiento','habitacion','1274'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536679','H1275','Habitación huested','Prevención y Matenimiento','habitacion','1275'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536680','H1276','Habitación huested','Prevención y Matenimiento','habitacion','1276'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536681','H1277','Habitación huested','Prevención y Matenimiento','habitacion','1277'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536682','H1278','Habitación huested','Prevención y Matenimiento','habitacion','1278'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536683','H1281','Habitación huested','Prevención y Matenimiento','habitacion','1281'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536684','H1282','Habitación huested','Prevención y Matenimiento','habitacion','1282'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536685','H1283','Habitación huested','Prevención y Matenimiento','habitacion','1283'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536686','H1284','Habitación huested','Prevención y Matenimiento','habitacion','1284'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536687','H1285','Habitación huested','Prevención y Matenimiento','habitacion','1285'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536688','H1286','Habitación huested','Prevención y Matenimiento','habitacion','1286'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536689','H1287','Habitación huested','Prevención y Matenimiento','habitacion','1287'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536690','H1288','Habitación huested','Prevención y Matenimiento','habitacion','1288'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536691','H1291','Habitación huested','Prevención y Matenimiento','habitacion','1291'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536692','H1292','Habitación huested','Prevención y Matenimiento','habitacion','1292'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536693','H1293','Habitación huested','Prevención y Matenimiento','habitacion','1293'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536694','H1294','Habitación huested','Prevención y Matenimiento','habitacion','1294'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536695','H1295','Habitación huested','Prevención y Matenimiento','habitacion','1295'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536696','H1296','Habitación huested','Prevención y Matenimiento','habitacion','1296'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536697','H1297','Habitación huested','Prevención y Matenimiento','habitacion','1297'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536698','H1298','Habitación huested','Prevención y Matenimiento','habitacion','1298'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536699','H1301','Habitación huested','Prevención y Matenimiento','habitacion','1301'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536700','H1302','Habitación huested','Prevención y Matenimiento','habitacion','1302'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536701','H1303','Habitación huested','Prevención y Matenimiento','habitacion','1303'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536702','H1304','Habitación huested','Prevención y Matenimiento','habitacion','1304'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536703','H1305','Habitación huested','Prevención y Matenimiento','habitacion','1305'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536704','H1306','Habitación huested','Prevención y Matenimiento','habitacion','1306'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536705','H1307','Habitación huested','Prevención y Matenimiento','habitacion','1307'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536706','H1308','Habitación huested','Prevención y Matenimiento','habitacion','1308'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536707','H1311','Habitación huested','Prevención y Matenimiento','habitacion','1311'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536708','H1312','Habitación huested','Prevención y Matenimiento','habitacion','1312'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536709','H1313','Habitación huested','Prevención y Matenimiento','habitacion','1313'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536710','H1314','Habitación huested','Prevención y Matenimiento','habitacion','1314'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536711','H1315','Habitación huested','Prevención y Matenimiento','habitacion','1315'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536712','H1316','Habitación huested','Prevención y Matenimiento','habitacion','1316'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536713','H1317','Habitación huested','Prevención y Matenimiento','habitacion','1317'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536714','H1318','Habitación huested','Prevención y Matenimiento','habitacion','1318'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536715','H1321','Habitación huested','Prevención y Matenimiento','habitacion','1321'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536716','H1322','Habitación huested','Prevención y Matenimiento','habitacion','1322'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536717','H1323','Habitación huested','Prevención y Matenimiento','habitacion','1323'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536718','H1324','Habitación huested','Prevención y Matenimiento','habitacion','1324'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536719','H1325','Habitación huested','Prevención y Matenimiento','habitacion','1325'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536720','H1326','Habitación huested','Prevención y Matenimiento','habitacion','1326'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536721','H1327','Habitación huested','Prevención y Matenimiento','habitacion','1327'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536722','H1328','Habitación huested','Prevención y Matenimiento','habitacion','1328'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536723','H2414','Habitación huested','Prevención y Matenimiento','habitacion','2414'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536724','H2415','Habitación huested','Prevención y Matenimiento','habitacion','2415'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536725','H2416','Habitación huested','Prevención y Matenimiento','habitacion','2416'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536726','H2417','Habitación huested','Prevención y Matenimiento','habitacion','2417'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536727','H2418','Habitación huested','Prevención y Matenimiento','habitacion','2418'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536728','H2421','Habitación huested','Prevención y Matenimiento','habitacion','2421'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536729','H2422','Habitación huested','Prevención y Matenimiento','habitacion','2422'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536730','H2423','Habitación huested','Prevención y Matenimiento','habitacion','2423'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536731','H2424','Habitación huested','Prevención y Matenimiento','habitacion','2424'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536732','H2425','Habitación huested','Prevención y Matenimiento','habitacion','2425'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536733','H2426','Habitación huested','Prevención y Matenimiento','habitacion','2426'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536734','H2427','Habitación huested','Prevención y Matenimiento','habitacion','2427'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536735','H2428','Habitación huested','Prevención y Matenimiento','habitacion','2428'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536736','H2431','Habitación huested','Prevención y Matenimiento','habitacion','2431'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536737','H2432','Habitación huested','Prevención y Matenimiento','habitacion','2432'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536738','H2433','Habitación huested','Prevención y Matenimiento','habitacion','2433'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536739','H2434','Habitación huested','Prevención y Matenimiento','habitacion','2434'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536740','H2435','Habitación huested','Prevención y Matenimiento','habitacion','2435'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536741','H2436','Habitación huested','Prevención y Matenimiento','habitacion','2436'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536742','H2437','Habitación huested','Prevención y Matenimiento','habitacion','2437'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536743','H2438','Habitación huested','Prevención y Matenimiento','habitacion','2438'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536744','H2441','Habitación huested','Prevención y Matenimiento','habitacion','2441'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536745','H2442','Habitación huested','Prevención y Matenimiento','habitacion','2442'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536746','H2443','Habitación huested','Prevención y Matenimiento','habitacion','2443'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536747','H2444','Habitación huested','Prevención y Matenimiento','habitacion','2444'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536748','H2445','Habitación huested','Prevención y Matenimiento','habitacion','2445'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536749','H2446','Habitación huested','Prevención y Matenimiento','habitacion','2446'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536750','H2447','Habitación huested','Prevención y Matenimiento','habitacion','2447'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536751','H2448','Habitación huested','Prevención y Matenimiento','habitacion','2448'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536752','H2451','Habitación huested','Prevención y Matenimiento','habitacion','2451'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536753','H2452','Habitación huested','Prevención y Matenimiento','habitacion','2452'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536754','H2453','Habitación huested','Prevención y Matenimiento','habitacion','2453'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536755','H2454','Habitación huested','Prevención y Matenimiento','habitacion','2454'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536756','H2455','Habitación huested','Prevención y Matenimiento','habitacion','2455'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536757','H2456','Habitación huested','Prevención y Matenimiento','habitacion','2456'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536758','H2457','Habitación huested','Prevención y Matenimiento','habitacion','2457'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536759','H2458','Habitación huested','Prevención y Matenimiento','habitacion','2458'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536760','H2461','Habitación huested','Prevención y Matenimiento','habitacion','2461'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536761','H2462','Habitación huested','Prevención y Matenimiento','habitacion','2462'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536762','H2463','Habitación huested','Prevención y Matenimiento','habitacion','2463'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536763','H2464','Habitación huested','Prevención y Matenimiento','habitacion','2464'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536764','H2465','Habitación huested','Prevención y Matenimiento','habitacion','2465'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536765','H2466','Habitación huested','Prevención y Matenimiento','habitacion','2466'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536766','H2467','Habitación huested','Prevención y Matenimiento','habitacion','2467'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536767','H2468','Habitación huested','Prevención y Matenimiento','habitacion','2468'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536768','H2471','Habitación huested','Prevención y Matenimiento','habitacion','2471'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536769','H2472','Habitación huested','Prevención y Matenimiento','habitacion','2472'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536770','H2473','Habitación huested','Prevención y Matenimiento','habitacion','2473'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536772','H2475','Habitación huested','Prevención y Matenimiento','habitacion','2475'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536773','H2476','Habitación huested','Prevención y Matenimiento','habitacion','2476'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536774','H2477','Habitación huested','Prevención y Matenimiento','habitacion','2477'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536775','H2478','Habitación huested','Prevención y Matenimiento','habitacion','2478'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536776','H2481','Habitación huested','Prevención y Matenimiento','habitacion','2481'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536777','H2482','Habitación huested','Prevención y Matenimiento','habitacion','2482'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536778','H2483','Habitación huested','Prevención y Matenimiento','habitacion','2483'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536779','H2484','Habitación huested','Prevención y Matenimiento','habitacion','2484'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536780','H2485','Habitación huested','Prevención y Matenimiento','habitacion','2485'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536781','H2486','Habitación huested','Prevención y Matenimiento','habitacion','2486'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536782','H2488','Habitación huested','Prevención y Matenimiento','habitacion','2488'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536783','H2601','Habitación huested','Prevención y Matenimiento','habitacion','2601'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536784','H2602','Habitación huested','Prevención y Matenimiento','habitacion','2602'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536785','H2603','Habitación huested','Prevención y Matenimiento','habitacion','2603'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536786','H2604','Habitación huested','Prevención y Matenimiento','habitacion','2604'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536787','H2605','Habitación huested','Prevención y Matenimiento','habitacion','2605'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536788','H2606','Habitación huested','Prevención y Matenimiento','habitacion','2606'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536789','H2607','Habitación huested','Prevención y Matenimiento','habitacion','2607'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536790','H2608','Habitación huested','Prevención y Matenimiento','habitacion','2608'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536791','H2611','Habitación huested','Prevención y Matenimiento','habitacion','2611'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536792','H2612','Habitación huested','Prevención y Matenimiento','habitacion','2612'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536793','H2613','Habitación huested','Prevención y Matenimiento','habitacion','2613'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536794','H2614','Habitación huested','Prevención y Matenimiento','habitacion','2614'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536795','H2615','Habitación huested','Prevención y Matenimiento','habitacion','2615'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536796','H2616','Habitación huested','Prevención y Matenimiento','habitacion','2616'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536797','H2617','Habitación huested','Prevención y Matenimiento','habitacion','2617'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536798','H2621','Habitación huested','Prevención y Matenimiento','habitacion','2621'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536799','H2622','Habitación huested','Prevención y Matenimiento','habitacion','2622'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536800','H2623','Habitación huested','Prevención y Matenimiento','habitacion','2623'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536801','H2624','Habitación huested','Prevención y Matenimiento','habitacion','2624'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536802','H2625','Habitación huested','Prevención y Matenimiento','habitacion','2625'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536803','H2626','Habitación huested','Prevención y Matenimiento','habitacion','2626'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536804','H2627','Habitación huested','Prevención y Matenimiento','habitacion','2627'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536805','H2628','Habitación huested','Prevención y Matenimiento','habitacion','2628'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536806','H2631','Habitación huested','Prevención y Matenimiento','habitacion','2631'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536807','H2632','Habitación huested','Prevención y Matenimiento','habitacion','2632'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536808','H2633','Habitación huested','Prevención y Matenimiento','habitacion','2633'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536809','H2634','Habitación huested','Prevención y Matenimiento','habitacion','2634'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536810','H2636','Habitación huested','Prevención y Matenimiento','habitacion','2636'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536811','H2637','Habitación huested','Prevención y Matenimiento','habitacion','2637'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536812','H2638','Habitación huested','Prevención y Matenimiento','habitacion','2638'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536813','H2641','Habitación huested','Prevención y Matenimiento','habitacion','2641'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536814','H2642','Habitación huested','Prevención y Matenimiento','habitacion','2642'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536815','H2643','Habitación huested','Prevención y Matenimiento','habitacion','2643'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536816','H2644','Habitación huested','Prevención y Matenimiento','habitacion','2644'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536817','H2645','Habitación huested','Prevención y Matenimiento','habitacion','2645'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536818','H2646','Habitación huested','Prevención y Matenimiento','habitacion','2646'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536819','H2647','Habitación huested','Prevención y Matenimiento','habitacion','2647'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536820','H2648','Habitación huested','Prevención y Matenimiento','habitacion','2648'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536821','H2651','Habitación huested','Prevención y Matenimiento','habitacion','2651'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536822','H2652','Habitación huested','Prevención y Matenimiento','habitacion','2652'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536823','H2653','Habitación huested','Prevención y Matenimiento','habitacion','2653'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536824','H2654','Habitación huested','Prevención y Matenimiento','habitacion','2654'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536825','H2655','Habitación huested','Prevención y Matenimiento','habitacion','2655'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536826','H2656','Habitación huested','Prevención y Matenimiento','habitacion','2656'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536827','H2657','Habitación huested','Prevención y Matenimiento','habitacion','2657'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536828','H2658','Habitación huested','Prevención y Matenimiento','habitacion','2658'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536829','H2661','Habitación huested','Prevención y Matenimiento','habitacion','2661'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536830','H2662','Habitación huested','Prevención y Matenimiento','habitacion','2662'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536831','H2492','Habitación huested','Prevención y Matenimiento','habitacion','2492'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536832','H2501','Habitación huested','Prevención y Matenimiento','habitacion','2501'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536833','H2503','Habitación huested','Prevención y Matenimiento','habitacion','2503'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536834','H2504','Habitación huested','Prevención y Matenimiento','habitacion','2504'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536835','H2505','Habitación huested','Prevención y Matenimiento','habitacion','2505'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536836','H2507','Habitación huested','Prevención y Matenimiento','habitacion','2507'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536837','H2508','Habitación huested','Prevención y Matenimiento','habitacion','2508'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536838','H2511','Habitación huested','Prevención y Matenimiento','habitacion','2511'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536839','H2512','Habitación huested','Prevención y Matenimiento','habitacion','2512'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536840','H2513','Habitación huested','Prevención y Matenimiento','habitacion','2513'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536841','H2514','Habitación huested','Prevención y Matenimiento','habitacion','2514'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536842','H2515','Habitación huested','Prevención y Matenimiento','habitacion','2515'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536843','H2516','Habitación huested','Prevención y Matenimiento','habitacion','2516'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536844','H2517','Habitación huested','Prevención y Matenimiento','habitacion','2517'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536845','H2518','Habitación huested','Prevención y Matenimiento','habitacion','2518'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536846','H2521','Habitación huested','Prevención y Matenimiento','habitacion','2521'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536847','H2522','Habitación huested','Prevención y Matenimiento','habitacion','2522'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536848','H2523','Habitación huested','Prevención y Matenimiento','habitacion','2523'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536849','H2524','Habitación huested','Prevención y Matenimiento','habitacion','2524'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536850','H2525','Habitación huested','Prevención y Matenimiento','habitacion','2525'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536851','H2526','Habitación huested','Prevención y Matenimiento','habitacion','2526'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536852','H2527','Habitación huested','Prevención y Matenimiento','habitacion','2527'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536853','H2528','Habitación huested','Prevención y Matenimiento','habitacion','2528'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536854','H2531','Habitación huested','Prevención y Matenimiento','habitacion','2531'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536855','H2532','Habitación huested','Prevención y Matenimiento','habitacion','2532'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536856','H2533','Habitación huested','Prevención y Matenimiento','habitacion','2533'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536857','H2534','Habitación huested','Prevención y Matenimiento','habitacion','2534'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536858','H2535','Habitación huested','Prevención y Matenimiento','habitacion','2535'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536859','H2536','Habitación huested','Prevención y Matenimiento','habitacion','2536'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536860','H2537','Habitación huested','Prevención y Matenimiento','habitacion','2537'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536861','H2538','Habitación huested','Prevención y Matenimiento','habitacion','2538'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536862','H2541','Habitación huested','Prevención y Matenimiento','habitacion','2541'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536863','H2542','Habitación huested','Prevención y Matenimiento','habitacion','2542'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536864','H2543','Habitación huested','Prevención y Matenimiento','habitacion','2543'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536865','H2544','Habitación huested','Prevención y Matenimiento','habitacion','2544'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536866','H2545','Habitación huested','Prevención y Matenimiento','habitacion','2545'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536867','H2546','Habitación huested','Prevención y Matenimiento','habitacion','2546'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536868','H2547','Habitación huested','Prevención y Matenimiento','habitacion','2547'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536869','H2548','Habitación huested','Prevención y Matenimiento','habitacion','2548'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536870','H2551','Habitación huested','Prevención y Matenimiento','habitacion','2551'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536871','H2552','Habitación huested','Prevención y Matenimiento','habitacion','2552'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536872','H2553','Habitación huested','Prevención y Matenimiento','habitacion','2553'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536873','H2554','Habitación huested','Prevención y Matenimiento','habitacion','2554'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536874','H2555','Habitación huested','Prevención y Matenimiento','habitacion','2555'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536875','H2556','Habitación huested','Prevención y Matenimiento','habitacion','2556'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536876','H2557','Habitación huested','Prevención y Matenimiento','habitacion','2557'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536877','H2558','Habitación huested','Prevención y Matenimiento','habitacion','2558'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536878','H2561','Habitación huested','Prevención y Matenimiento','habitacion','2561'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536879','H2562','Habitación huested','Prevención y Matenimiento','habitacion','2562'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536880','H2563','Habitación huested','Prevención y Matenimiento','habitacion','2563'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536881','H2564','Habitación huested','Prevención y Matenimiento','habitacion','2564'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536882','H2565','Habitación huested','Prevención y Matenimiento','habitacion','2565'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536883','H2566','Habitación huested','Prevención y Matenimiento','habitacion','2566'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536884','H2567','Habitación huested','Prevención y Matenimiento','habitacion','2567'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536885','H2568','Habitación huested','Prevención y Matenimiento','habitacion','2568'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536886','H2571','Habitación huested','Prevención y Matenimiento','habitacion','2571'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536887','H2572','Habitación huested','Prevención y Matenimiento','habitacion','2572'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536888','H2573','Habitación huested','Prevención y Matenimiento','habitacion','2573'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536889','H2574','Habitación huested','Prevención y Matenimiento','habitacion','2574'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536890','H2575','Habitación huested','Prevención y Matenimiento','habitacion','2575'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536891','H2576','Habitación huested','Prevención y Matenimiento','habitacion','2576'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536892','H2577','Habitación huested','Prevención y Matenimiento','habitacion','2577'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536893','H2578','Habitación huested','Prevención y Matenimiento','habitacion','2578'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536894','H2581','Habitación huested','Prevención y Matenimiento','habitacion','2581'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536895','H2582','Habitación huested','Prevención y Matenimiento','habitacion','2582'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536896','H2583','Habitación huested','Prevención y Matenimiento','habitacion','2583'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536897','H2584','Habitación huested','Prevención y Matenimiento','habitacion','2584'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536898','H2585','Habitación huested','Prevención y Matenimiento','habitacion','2585'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536899','H2586','Habitación huested','Prevención y Matenimiento','habitacion','2586'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536900','H2587','Habitación huested','Prevención y Matenimiento','habitacion','2587'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536901','H2588','Habitación huested','Prevención y Matenimiento','habitacion','2588'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536902','H2591','Habitación huested','Prevención y Matenimiento','habitacion','2591'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536903','H2592','Habitación huested','Prevención y Matenimiento','habitacion','2592'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536904','H2593','Habitación huested','Prevención y Matenimiento','habitacion','2593'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536905','H2594','Habitación huested','Prevención y Matenimiento','habitacion','2594'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536906','H2595','Habitación huested','Prevención y Matenimiento','habitacion','2595'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536907','H2596','Habitación huested','Prevención y Matenimiento','habitacion','2596'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536908','H2597','Habitación huested','Prevención y Matenimiento','habitacion','2597'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536909','H2598','Habitación huested','Prevención y Matenimiento','habitacion','2598'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536910','H3701','Habitación huested','Prevención y Matenimiento','habitacion','3701'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536911','H3702','Habitación huested','Prevención y Matenimiento','habitacion','3702'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536912','H3703','Habitación huested','Prevención y Matenimiento','habitacion','3703'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536913','H3704','Habitación huested','Prevención y Matenimiento','habitacion','3704'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536914','H3705','Habitación huested','Prevención y Matenimiento','habitacion','3705'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536915','H3706','Habitación huested','Prevención y Matenimiento','habitacion','3706'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536916','H3707','Habitación huested','Prevención y Matenimiento','habitacion','3707'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536917','H3708','Habitación huested','Prevención y Matenimiento','habitacion','3708'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536918','H3711','Habitación huested','Prevención y Matenimiento','habitacion','3711'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536919','H3712','Habitación huested','Prevención y Matenimiento','habitacion','3712'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536920','H3713','Habitación huested','Prevención y Matenimiento','habitacion','3713'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536921','H3714','Habitación huested','Prevención y Matenimiento','habitacion','3714'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536922','H3715','Habitación huested','Prevención y Matenimiento','habitacion','3715'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536923','H3716','Habitación huested','Prevención y Matenimiento','habitacion','3716'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536924','H3717','Habitación huested','Prevención y Matenimiento','habitacion','3717'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536925','H3718','Habitación huested','Prevención y Matenimiento','habitacion','3718'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536926','H3721','Habitación huested','Prevención y Matenimiento','habitacion','3721'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536927','H3722','Habitación huested','Prevención y Matenimiento','habitacion','3722'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536928','H3723','Habitación huested','Prevención y Matenimiento','habitacion','3723'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536929','H3724','Habitación huested','Prevención y Matenimiento','habitacion','3724'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536930','H3725','Habitación huested','Prevención y Matenimiento','habitacion','3725'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536931','H3726','Habitación huested','Prevención y Matenimiento','habitacion','3726'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536932','H3727','Habitación huested','Prevención y Matenimiento','habitacion','3727'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536933','H3728','Habitación huested','Prevención y Matenimiento','habitacion','3728'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536934','H3731','Habitación huested','Prevención y Matenimiento','habitacion','3731'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536935','H3732','Habitación huested','Prevención y Matenimiento','habitacion','3732'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536936','H3733','Habitación huested','Prevención y Matenimiento','habitacion','3733'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536937','H3734','Habitación huested','Prevención y Matenimiento','habitacion','3734'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536938','H3735','Habitación huested','Prevención y Matenimiento','habitacion','3735'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536939','H3736','Habitación huested','Prevención y Matenimiento','habitacion','3736'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536940','H3737','Habitación huested','Prevención y Matenimiento','habitacion','3737'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536941','H2663','Habitación huested','Prevención y Matenimiento','habitacion','2663'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536942','H2664','Habitación huested','Prevención y Matenimiento','habitacion','2664'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536943','H2665','Habitación huested','Prevención y Matenimiento','habitacion','2665'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536944','H2666','Habitación huested','Prevención y Matenimiento','habitacion','2666'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536945','H2667','Habitación huested','Prevención y Matenimiento','habitacion','2667'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536946','H2668','Habitación huested','Prevención y Matenimiento','habitacion','2668'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536947','H2671','Habitación huested','Prevención y Matenimiento','habitacion','2671'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536948','H2672','Habitación huested','Prevención y Matenimiento','habitacion','2672'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536949','H2673','Habitación huested','Prevención y Matenimiento','habitacion','2673'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536950','H2674','Habitación huested','Prevención y Matenimiento','habitacion','2674'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536951','H2675','Habitación huested','Prevención y Matenimiento','habitacion','2675'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536952','H2676','Habitación huested','Prevención y Matenimiento','habitacion','2676'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536953','H2677','Habitación huested','Prevención y Matenimiento','habitacion','2677'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536954','H2678','Habitación huested','Prevención y Matenimiento','habitacion','2678'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536955','H2681','Habitación huested','Prevención y Matenimiento','habitacion','2681'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536956','H2682','Habitación huested','Prevención y Matenimiento','habitacion','2682'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536957','H2683','Habitación huested','Prevención y Matenimiento','habitacion','2683'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536958','H2685','Habitación huested','Prevención y Matenimiento','habitacion','2685'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536959','H2686','Habitación huested','Prevención y Matenimiento','habitacion','2686'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536960','H2688','Habitación huested','Prevención y Matenimiento','habitacion','2688'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536961','H2691','Habitación huested','Prevención y Matenimiento','habitacion','2691'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536962','H2692','Habitación huested','Prevención y Matenimiento','habitacion','2692'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536963','H2693','Habitación huested','Prevención y Matenimiento','habitacion','2693'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536964','H2694','Habitación huested','Prevención y Matenimiento','habitacion','2694'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536965','H2695','Habitación huested','Prevención y Matenimiento','habitacion','2695'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536966','H2696','Habitación huested','Prevención y Matenimiento','habitacion','2696'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536967','H2697','Habitación huested','Prevención y Matenimiento','habitacion','2697'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536968','H2698','Habitación huested','Prevención y Matenimiento','habitacion','2698'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536969','H3738','Habitación huested','Prevención y Matenimiento','habitacion','3738'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536970','H3741','Habitación huested','Prevención y Matenimiento','habitacion','3741'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536971','H3742','Habitación huested','Prevención y Matenimiento','habitacion','3742'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536972','H3743','Habitación huested','Prevención y Matenimiento','habitacion','3743'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536973','H3744','Habitación huested','Prevención y Matenimiento','habitacion','3744'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536974','H3745','Habitación huested','Prevención y Matenimiento','habitacion','3745'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536975','H3746','Habitación huested','Prevención y Matenimiento','habitacion','3746'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536976','H3747','Habitación huested','Prevención y Matenimiento','habitacion','3747'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536977','H3748','Habitación huested','Prevención y Matenimiento','habitacion','3748'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536978','H3751','Habitación huested','Prevención y Matenimiento','habitacion','3751'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536979','H3752','Habitación huested','Prevención y Matenimiento','habitacion','3752'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536980','H3753','Habitación huested','Prevención y Matenimiento','habitacion','3753'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536981','H3754','Habitación huested','Prevención y Matenimiento','habitacion','3754'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536982','H3755','Habitación huested','Prevención y Matenimiento','habitacion','3755'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536983','H3756','Habitación huested','Prevención y Matenimiento','habitacion','3756'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536984','H3757','Habitación huested','Prevención y Matenimiento','habitacion','3757'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536985','H3758','Habitación huested','Prevención y Matenimiento','habitacion','3758'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536986','H3825','Habitación huested','Prevención y Matenimiento','habitacion','3825'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536987','H3826','Habitación huested','Prevención y Matenimiento','habitacion','3826'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536988','H3801','Habitación huested','Prevención y Matenimiento','habitacion','3801'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536989','H3802','Habitación huested','Prevención y Matenimiento','habitacion','3802'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536990','H3803','Habitación huested','Prevención y Matenimiento','habitacion','3803'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536991','H3804','Habitación huested','Prevención y Matenimiento','habitacion','3804'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536992','H3805','Habitación huested','Prevención y Matenimiento','habitacion','3805'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536993','H3806','Habitación huested','Prevención y Matenimiento','habitacion','3806'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536994','H3807','Habitación huested','Prevención y Matenimiento','habitacion','3807'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536995','H3808','Habitación huested','Prevención y Matenimiento','habitacion','3808'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536996','H3811','Habitación huested','Prevención y Matenimiento','habitacion','3811'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536997','H3812','Habitación huested','Prevención y Matenimiento','habitacion','3812'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536998','H3813','Habitación huested','Prevención y Matenimiento','habitacion','3813'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536999','H3814','Habitación huested','Prevención y Matenimiento','habitacion','3814'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537000','H3815','Habitación huested','Prevención y Matenimiento','habitacion','3815'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537001','H3816','Habitación huested','Prevención y Matenimiento','habitacion','3816'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537002','H3817','Habitación huested','Prevención y Matenimiento','habitacion','3817'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537003','H3818','Habitación huested','Prevención y Matenimiento','habitacion','3818'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537004','H3821','Habitación huested','Prevención y Matenimiento','habitacion','3821'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537005','H3822','Habitación huested','Prevención y Matenimiento','habitacion','3822'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537006','H3823','Habitación huested','Prevención y Matenimiento','habitacion','3823'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537007','H3824','Habitación huested','Prevención y Matenimiento','habitacion','3824'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537008','H3827','Habitación huested','Prevención y Matenimiento','habitacion','3827'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537009','H3828','Habitación huested','Prevención y Matenimiento','habitacion','3828'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537010','H3831','Habitación huested','Prevención y Matenimiento','habitacion','3831'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537011','H3832','Habitación huested','Prevención y Matenimiento','habitacion','3832'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537012','H3833','Habitación huested','Prevención y Matenimiento','habitacion','3833'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537013','H3834','Habitación huested','Prevención y Matenimiento','habitacion','3834'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537014','H3835','Habitación huested','Prevención y Matenimiento','habitacion','3835'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537015','H3836','Habitación huested','Prevención y Matenimiento','habitacion','3836'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537016','H3837','Habitación huested','Prevención y Matenimiento','habitacion','3837'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537017','H3838','Habitación huested','Prevención y Matenimiento','habitacion','3838'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537018','H3841','Habitación huested','Prevención y Matenimiento','habitacion','3841'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537019','H3842','Habitación huested','Prevención y Matenimiento','habitacion','3842'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537020','H3843','Habitación huested','Prevención y Matenimiento','habitacion','3843'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537021','H3844','Habitación huested','Prevención y Matenimiento','habitacion','3844'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537022','H3845','Habitación huested','Prevención y Matenimiento','habitacion','3845'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537023','H3846','Habitación huested','Prevención y Matenimiento','habitacion','3846'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537024','H3847','Habitación huested','Prevención y Matenimiento','habitacion','3847'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537025','H3848','Habitación huested','Prevención y Matenimiento','habitacion','3848'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537026','H1266','Habitación huested','Prevención y Matenimiento','habitacion','1266'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537027','H1055','Habitación huested','Prevención y Matenimiento','habitacion','1055'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537028','IBAEROSOLB1','Buffet central','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537029','IBAEROSOLB2','Buffet central','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537030','IBAEROSOLB3','Buffet central','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537031','IBAEROSOLB4','Buffet central','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050537032','H2635','Habitación huested','Prevención y Matenimiento','habitacion','2635'),
  ('IBEROSTAR CORAL BAVARO','ICB001','C205050536771','H2474','Habitación huested','Prevención y Matenimiento','habitacion','2474'),
  ('IBEROSTAR COMUNES','IC001','C205050533181','18','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533182','19','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533183','20','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533184','21','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533185','22','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533186','23','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533187','24','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533188','25','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533189','26','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533190','27','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533191','28','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533192','29','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533193','30','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533194','31','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533195','32','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533196','33','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533197','34','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533198','4','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533199','5','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533200','6','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533201','7','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533202','8','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533203','9','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533204','10','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533205','11','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533206','12','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533207','13','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533208','14','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533209','15','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533210','16','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533211','17','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533212','35','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533213','36','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533214','37','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533215','38','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533216','39','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533217','40','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533218','1','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533219','2','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533220','3','Área exterior','Estación de Cebo','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533221','IBCBCLAMPARA002','Área de basura del comedor','Lámpara ultravioletas atrapa moscas','lampara_moscas',null),
  ('IBEROSTAR COMUNES','IC001','C205050533222','IBPCLAMPARA003','Pasillo de cocina','Lámpara ultravioletas atrapa moscas','lampara_moscas',null),
  ('IBEROSTAR COMUNES','IC001','C205050533223','IBCCLAMPARA004','Cocina','Lámpara ultravioletas atrapa moscas','lampara_moscas',null),
  ('IBEROSTAR COMUNES','IC001','C205050533224','IBCCARLAMPARA005','Carniceria','Lámpara ultravioletas atrapa moscas','lampara_moscas',null),
  ('IBEROSTAR COMUNES','IC001','C205050533225','IBCDCCLAMPARA006','Despensa cocina central','Lámpara ultravioletas atrapa moscas','lampara_moscas',null),
  ('IBEROSTAR COMUNES','IC001','C205050533226','IBCPCCLAMPARA007','Pantry cocina central','Lámpara ultravioletas atrapa moscas','lampara_moscas',null),
  ('IBEROSTAR COMUNES','IC001','C205050533227','IBCPLAMPARA008','Panadería','Lámpara ultravioletas atrapa moscas','lampara_moscas',null),
  ('IBEROSTAR COMUNES','IC001','C205050533228','IBCPLAMPARA010','Panadería','Lámpara ultravioletas atrapa moscas','lampara_moscas',null),
  ('IBEROSTAR COMUNES','IC001','C205050533229','IBCELAMPARA011','Economato','Lámpara ultravioletas atrapa moscas','lampara_moscas',null),
  ('IBEROSTAR COMUNES','IC001','C205050533230','IBCELAMPARA012','Economato','Lámpara ultravioletas atrapa moscas','lampara_moscas',null),
  ('IBEROSTAR COMUNES','IC001','C205050533231','IBCPLAMPARA009','Panadería','Lámpara ultravioletas atrapa moscas','lampara_moscas',null),
  ('IBEROSTAR COMUNES','IC001','C205050533232','IBCELAMPARA013','Economato','Lámpara ultravioletas atrapa moscas','lampara_moscas',null),
  ('IBEROSTAR COMUNES','IC001','C205050533233','IBCCAEROSOL009','Comedor','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR COMUNES','IC001','C205050533234','IBCCAEROSOL010','Carniceria','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR COMUNES','IC001','C205050533235','IBCCGAEROSOL013','Campo de golf','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR COMUNES','IC001','C205050533236','IBCCGAEROSOL014','Campo de golf','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR COMUNES','IC001','C205050533237','IBCCAEROSOL013','Carniceria','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR COMUNES','IC001','C205050533238','IBCCFAEROSOL018','Pasillo de cámara fría','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR COMUNES','IC001','C205050533239','IBCPEAEROSOL020','Perola','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR COMUNES','IC001','C205050533240','IBCCAEROSOL003','Comedor','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR COMUNES','IC001','C205050533241','IBCCAEROSOL017','Comedor','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR COMUNES','IC001','C205050533242','IBCPCAEROSOL019','Pasillo de cocina','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR COMUNES','IC001','C205050533243','IBCDAEROSOLD001','Despensa','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR COMUNES','IC001','C205050533244','IBCAEROSOL002','Apartados','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR COMUNES','IC001','C205050533245','IBCEAEROSOL015','Economato','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR COMUNES','IC001','C205050533246','IBCPAEROSOL016','Panadería','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR COMUNES','IC001','C205050533247','IBCCAEROSOL004','Comedor','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR COMUNES','IC001','C205050533248','IBCCAEROSOL005','Comedor','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR COMUNES','IC001','C205050533249','IBCPAEROSOL006','Panadería','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR COMUNES','IC001','C205050533250','IBCPAEROSOL007','Panadería','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR COMUNES','IC001','C205050533251','IBCPAEROSOL008','Panadería','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR COMUNES','IC001','C205050533252','IBCEAEROSOL010','Economato','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR COMUNES','IC001','C205050533253','IBCCGAEROSOL011','Campo de golf','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR COMUNES','IC001','C205050533254','IBCCGAEROSOL012','Campo de golf','Dispensador de aerosol','dispensador_aerosol',null),
  ('IBEROSTAR COMUNES','IC001','C205050533255','20505-181','Área Múltiple (Iberostar Comunes cocina, Iberostar Comunes comedor, Iberostar Comunes Alojamiento empleados, Iberostar Comunes Punto verde, Iberostar Comunes Panaderia, Iberostar Comunes patio de maniobra, Iberostar Comunes cuartos de basuras, Iberostar Comunes Camión de la cocina, Iberostar Comunes Spa, Iberostar Comunes Gym, Iberostar Comunes registros, Iberostar Comunes Campo de golf, Iberostar Comunes Registros, Iberostar Comunes Campo de Golf cocina, Iberostar Comunes Area reciclaje, Iberostar Comunes Lavanderia, Iberostar Comunes Economato, Iberostar Comunes Lockers de empleados, Iberostar Comunes Termonebulizador, Iberostar Comunes pasillo de cocina, Iberostar Comunes carniceria, Iberostar Comunes pantry cocina central, Iberostar Comunes apartados, Iberostar Comunes Área exterior, Iberostar Comunes Área de basura del comedor, Iberostar Comunes despensa cocina central, Iberostar Comunes panadería, Iberostar Comunes cámara fría, Iberostar Comunes Despensa, Iberostar Comunes Perola, Iberostar Comunes pasillo de cámara fría)','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR COMUNES','IC001','C205050533256','20505-182','Cocina','Aperturas en las áreas','apertura',null),
  ('IBEROSTAR COMUNES','IC001','C205050533257','20505-183','Comedor','Aperturas en las áreas','apertura',null),
  ('IBEROSTAR COMUNES','IC001','C205050533258','1CC1','Cocina','Actividades de control','area_general',null),
  ('IBEROSTAR COMUNES','IC001','C205050533259','CCEBADEROS01','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533260','CCEBADEROS02','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533261','CCEBADEROS03','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533262','CCEBADEROS04','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533263','CCEBADEROS05','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533264','CCEBADEROS06','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533265','CCEBADEROS07','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533266','CCEBADEROS08','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533267','CCEBADEROS09','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533268','CCEBADEROS10','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533269','CCEBADEROS11','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533270','CCEBADEROS12','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533271','CCEBADEROS13','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533272','CCEBADEROS14','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533273','CCEBADEROS15','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533274','CCEBADEROS16','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533275','CCEBADEROS17','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533276','CCEBADEROS18','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533277','CCEBADEROS19','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533278','CCEBADEROS20','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533279','CCEBADEROS21','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533280','CCEBADEROS22','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533281','CCEBADEROS23','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533282','CCEBADEROS24','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533283','CCEBADEROS25','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533284','CCEBADEROS26','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533285','CCEBADEROS27','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533286','CCEBADEROS28','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533287','CCEBADEROS29','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533288','CCEBADEROS30','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533289','CCEBADEROS31','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533290','CCEBADEROS32','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533291','CCEBADEROS33','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533292','CCEBADEROS34','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533293','CCEBADEROS35','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533294','CCEBADEROS36','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533295','CCEBADEROS37','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533296','CCEBADEROS38','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533297','CCEBADEROS39','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533298','CCEBADEROS40','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533299','CCEBADEROS41','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533300','CCEBADEROS42','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533301','CCEBADEROS43','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533302','CCEBADEROS44','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533303','CCEBADEROS45','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533304','CCEBADEROS46','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533305','CCEBADEROS47','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533306','CCEBADEROS48','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533307','CCEBADEROS49','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533308','CCEBADEROS50','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533309','CCEBADEROS51','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533310','CCEBADEROS52','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533311','CCEBADEROS53','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533312','CCEBADEROS54','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533313','CCEBADEROS55','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533314','CCEBADEROS56','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533315','CCEBADEROS57','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533316','CCEBADEROS58','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533317','CCEBADEROS59','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533318','CCEBADEROS60','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533319','CCEBADEROS61','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533320','CCEBADEROS62','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533321','CCEBADEROS63','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533322','CCEBADEROS64','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533323','CCEBADEROS65','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533324','CCEBADEROS66','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533325','CCEBADEROS67','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533326','CCEBADEROS68','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533327','CCEBADEROS69','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533328','CCEBADEROS70','Área exterior','Monitoreo permanente con estaciones de cebaderos','cebadero_roedor',null),
  ('IBEROSTAR COMUNES','IC001','C205050533329','IBCCLAMPARA001','Comedor','Lámpara ultravioletas atrapa moscas','lampara_moscas',null),
  ('IBEROSTAR COMUNES','IC001','C205050533330','IBBEROSTAR COMUNES SARGAZO','Área exterior','Prevención y Matenimiento','area_general',null),
  ('IBEROSTAR COMUNES','IC001','C205050533331','PUNTO VERDE','Punto verde','Prevención y Matenimiento','area_general',null);

insert into asa_puntos_control (
  sitio_id, area_id, tipo_punto_id, estrategia_id, codigo_visible, qr_token,
  numero_habitacion, frecuencia, codigo_contrato_origen)
select s.id, a.id, t.id, e.id, p.codigo, p.qr, p.habitacion,
       t.frecuencia_default, p.contrato
from tmp_puntos p
join asa_sitios s      on s.nombre = p.planta
join asa_tipos_punto t on t.codigo = p.tipo
left join asa_areas a  on a.sitio_id = s.id and upper(a.nombre) = upper(p.area)
left join asa_estrategias e on upper(e.nombre) = upper(p.estrategia)
where not exists (select 1 from asa_puntos_control x where x.qr_token = p.qr);

-- Total de habitaciones por planta, para el tablero verde/rojo
update asa_sitios s set habitaciones_total = sub.n
from (select pc.sitio_id, count(*) n from asa_puntos_control pc
      join asa_tipos_punto tp on tp.id = pc.tipo_punto_id
      where tp.codigo = 'habitacion' and pc.activo group by pc.sitio_id) sub
where sub.sitio_id = s.id;

commit;

-- ── Verificación ───────────────────────────────────────────────────────────
select 'clientes' t, count(*) from asa_clientes
union all select 'plantas', count(*) from asa_sitios
union all select 'contratos', count(*) from asa_contratos_plagas
union all select 'estrategias', count(*) from asa_estrategias
union all select 'areas', count(*) from asa_areas
union all select 'puntos', count(*) from asa_puntos_control
union all select 'puntos sin area', count(*) from asa_puntos_control where area_id is null
union all select 'habitaciones', count(*) from asa_puntos_control pc join asa_tipos_punto t on t.id=pc.tipo_punto_id where t.codigo='habitacion';
