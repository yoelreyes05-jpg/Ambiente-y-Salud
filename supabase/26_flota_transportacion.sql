-- ══════════════════════════════════════════════════════════════════════════
-- 26_flota_transportacion.sql — Ambiente y Salud RD (ASA SRL)
--
-- La flota de ASA, traida desde el CRM del taller (donde vivia como
-- migracion_v32_asa_flota.sql sobre el Supabase compartido). Aqui corre sobre
-- el proyecto propio de ASA.
--
-- Lo unico que cambia respecto del original es la tabla de configuracion:
-- `config_sistema` (del CRM) pasa a `asa_config_sistema`, que es la que existe
-- en este proyecto. Las 12 tablas ya venian con prefijo `asa_flota_`, asi que
-- no chocan con nada del sistema de plagas.
--
-- Para traer los DATOS que ya estan cargados en el proyecto del CRM:
--   cd backend && node scripts/copiar-flota-desde-crm.mjs --simular
-- y luego sin --simular. Correr esta migracion primero.
--
-- Idempotente: se puede correr varias veces.
-- ══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- MIGRACION V32 - MODULO ASA (CONTROL DE FLOTA Y TRANSPORTACION)
--
-- Control de los vehiculos de la empresa: quien maneja cual, el parte diario
-- que llena el conductor, las fallas que reporta, las fotos del vehiculo y
-- todo lo que se gasta en el. Con eso el encargado de transportacion sabe
-- cuanto cuesta cada unidad por kilometro y cual conviene reemplazar.
--
-- Prefijo `asa_flota_` en todas las tablas.
--
-- No `asa_` a secas: ese prefijo ya lo ocupan las tablas del ERP de ASA
-- (plagas/IPM, fichas clinicas, mascotas, estetica, POS, nomina,
-- contabilidad). El primer intento de esta migracion uso `asa_`, choco contra
-- el `asa_empleados` de ese ERP -- cuyo id es uuid -- y fallo al crear la
-- llave foranea. Por eso tambien la columna se llama `conductor_id` y no
-- `empleado_id`: confundir los empleados del ERP con los conductores de la
-- flota fue justo el error.
--
-- Tampoco toca `vehiculos`, que son los de los clientes del taller.
--
-- REGLA DE DISENO: el conductor no escribe. Todo el parte diario se llena a
-- toques -- el checklist arranca en BIEN y solo se toca lo que esta mal, el
-- combustible se mueve con flechas, y las fallas se escogen de un catalogo.
-- Lo unico que se teclea es el numero del odometro.
--
-- Idempotente: se puede correr varias veces.
-- Requiere: asa_config_sistema (clave, valor jsonb) -- la crea 12_notificaciones_config.sql.
-- ══════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════
-- 0. PREFLIGHT
--
-- Avisa si alguna tabla `asa_flota_` ya existe con otro tipo de id. Sin esto,
-- el fallo aparece mas abajo como un error de llave foranea que no dice de
-- donde viene el problema -- que fue exactamente lo que paso la primera vez.
-- ══════════════════════════════════════════════════════════════════════════

DO $preflight$
DECLARE
  t       text;
  tipo_id text;
  chocan  text := '';
  tablas  text[] := ARRAY[
    'asa_flota_conductores', 'asa_flota_vehiculos', 'asa_flota_asignaciones',
    'asa_flota_checklist_items', 'asa_flota_fallas_catalogo', 'asa_flota_chequeos',
    'asa_flota_chequeo_items', 'asa_flota_fallas_reportadas', 'asa_flota_fotos',
    'asa_flota_gastos', 'asa_flota_documentos', 'asa_flota_mantenimientos'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    SELECT data_type INTO tipo_id
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = t AND column_name = 'id';
    IF tipo_id IS NOT NULL AND tipo_id <> 'bigint' THEN
      chocan := chocan || t || ' (id ' || tipo_id || '), ';
    END IF;
  END LOOP;

  IF chocan <> '' THEN
    RAISE EXCEPTION
      'Ya existen tablas asa_flota_ con otro tipo de id: %. Revisalas antes de seguir.',
      rtrim(chocan, ', ');
  END IF;
END $preflight$;


-- ══════════════════════════════════════════════════════════════════════════
-- 1. CONDUCTORES
--
-- Tabla propia y no `usuarios`: el conductor no entra al CRM, solo abre la
-- pantalla de chequeo y toca su nombre. Darle una cuenta del sistema seria
-- darle acceso a cosas que no necesita.
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS asa_flota_conductores (
  id                 BIGSERIAL PRIMARY KEY,
  nombre             TEXT NOT NULL,
  cedula             TEXT,
  telefono           TEXT,
  cargo              TEXT DEFAULT 'Conductor',
  licencia_numero    TEXT,
  licencia_categoria TEXT,
  licencia_vence     DATE,
  foto_url           TEXT,
  color              TEXT DEFAULT '#3b82f6',    -- para el boton en la pantalla de chequeo
  orden              INT  NOT NULL DEFAULT 0,
  activo             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asaflota_emp_activo ON asa_flota_conductores(activo);


-- ══════════════════════════════════════════════════════════════════════════
-- 2. VEHICULOS DE LA FLOTA
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS asa_flota_vehiculos (
  id                BIGSERIAL PRIMARY KEY,
  codigo            TEXT NOT NULL UNIQUE,            -- ASA-01
  placa             TEXT NOT NULL,
  marca             TEXT,
  modelo            TEXT,
  anio              INT,
  color             TEXT,
  chasis            TEXT,
  tipo              TEXT NOT NULL DEFAULT 'CAMIONETA'
                      CHECK (tipo IN ('AUTO','CAMIONETA','JEEPETA','CAMION','MINIBUS','AUTOBUS','MOTOR','FURGONETA','OTRO')),
  combustible       TEXT NOT NULL DEFAULT 'GASOLINA'
                      CHECK (combustible IN ('GASOLINA','GASOIL','GLP','GNV','HIBRIDO','ELECTRICO')),
  capacidad_tanque  NUMERIC(6,2),                    -- galones
  km_inicial        NUMERIC(12,1) NOT NULL DEFAULT 0,  -- odometro al entrar a la flota
  km_actual         NUMERIC(12,1) NOT NULL DEFAULT 0,  -- ultimo leido en un chequeo
  km_actualizado    TIMESTAMPTZ,
  conductor_id       BIGINT REFERENCES asa_flota_conductores(id) ON DELETE SET NULL,
  departamento      TEXT,
  estado            TEXT NOT NULL DEFAULT 'ACTIVO'
                      CHECK (estado IN ('ACTIVO','EN_TALLER','FUERA_SERVICIO','VENDIDO')),
  requiere_chequeo  BOOLEAN NOT NULL DEFAULT TRUE,   -- entra en el pendiente diario
  requiere_fotos    BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_adquisicion DATE,
  costo_adquisicion NUMERIC(14,2),
  foto_url          TEXT,
  notas             TEXT,
  activo            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asaflota_veh_activo   ON asa_flota_vehiculos(activo);
CREATE INDEX IF NOT EXISTS idx_asaflota_veh_estado   ON asa_flota_vehiculos(estado);
CREATE INDEX IF NOT EXISTS idx_asaflota_veh_conductor ON asa_flota_vehiculos(conductor_id);
CREATE INDEX IF NOT EXISTS idx_asaflota_veh_placa    ON asa_flota_vehiculos(placa);


-- ══════════════════════════════════════════════════════════════════════════
-- 3. ASIGNACIONES (HISTORICO DE QUIEN MANEJA QUE)
--
-- `asa_flota_vehiculos.conductor_id` dice quien lo tiene HOY. Esta tabla dice quien
-- lo tenia el dia que aparecio el golpe. Sin el historico, el reclamo por un
-- dano siempre cae en el que maneja ahora.
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS asa_flota_asignaciones (
  id           BIGSERIAL PRIMARY KEY,
  vehiculo_id  BIGINT NOT NULL REFERENCES asa_flota_vehiculos(id) ON DELETE CASCADE,
  conductor_id  BIGINT NOT NULL REFERENCES asa_flota_conductores(id) ON DELETE CASCADE,
  desde        DATE NOT NULL DEFAULT CURRENT_DATE,
  hasta        DATE,
  km_entrega   NUMERIC(12,1),
  km_devuelve  NUMERIC(12,1),
  motivo       TEXT,
  asignado_por TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asaflota_asig_veh    ON asa_flota_asignaciones(vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_asaflota_asig_activa ON asa_flota_asignaciones(vehiculo_id) WHERE hasta IS NULL;


-- ══════════════════════════════════════════════════════════════════════════
-- 4. CATALOGO DEL CHECKLIST
--
-- El conductor ve esta lista y toca solo lo que esta MAL. Todo lo que no toca
-- se guarda como BIEN. Editable desde la interfaz sin migracion nueva.
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS asa_flota_checklist_items (
  id        BIGSERIAL PRIMARY KEY,
  codigo    TEXT NOT NULL UNIQUE,
  categoria TEXT NOT NULL,
  etiqueta  TEXT NOT NULL,
  icono     TEXT,
  critico   BOOLEAN NOT NULL DEFAULT FALSE,   -- si sale MAL, el vehiculo no debe salir
  orden     INT NOT NULL DEFAULT 0,
  activo    BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO asa_flota_checklist_items (codigo, categoria, etiqueta, icono, critico, orden) VALUES
  ('luces_delanteras','LUCES','Luces delanteras','💡',TRUE, 10),
  ('luces_traseras','LUCES','Luces traseras y de freno','🔴',TRUE, 20),
  ('direccionales','LUCES','Direccionales','🔶',TRUE, 30),
  ('luz_retroceso','LUCES','Luz de retroceso','⬅️',FALSE,40),
  ('aceite_motor','FLUIDOS','Nivel de aceite','🛢️',TRUE, 50),
  ('refrigerante','FLUIDOS','Agua / refrigerante','💧',TRUE, 60),
  ('liquido_frenos','FLUIDOS','Líquido de frenos','🧪',TRUE, 70),
  ('agua_limpiaparabrisas','FLUIDOS','Agua del limpiaparabrisas','🚿',FALSE,80),
  ('gomas_delanteras','GOMAS','Gomas delanteras','🛞',TRUE, 90),
  ('gomas_traseras','GOMAS','Gomas traseras','🛞',TRUE,100),
  ('goma_repuesto','GOMAS','Goma de repuesto','🔘',FALSE,110),
  ('gato_llave','GOMAS','Gato y llave de rueda','🔧',FALSE,120),
  ('frenos','SEGURIDAD','Frenos','🛑',TRUE,130),
  ('freno_mano','SEGURIDAD','Freno de mano','🅿️',TRUE,140),
  ('bocina','SEGURIDAD','Bocina','📢',FALSE,150),
  ('cinturones','SEGURIDAD','Cinturones de seguridad','🔗',TRUE,160),
  ('espejos','SEGURIDAD','Espejos','🪞',FALSE,170),
  ('limpiaparabrisas','SEGURIDAD','Limpiaparabrisas','🌧️',FALSE,180),
  ('extintor','SEGURIDAD','Extintor','🧯',FALSE,190),
  ('triangulo','SEGURIDAD','Triángulo de seguridad','🔺',FALSE,200),
  ('marbete','DOCUMENTOS','Marbete al día','🏷️',TRUE,210),
  ('seguro_abordo','DOCUMENTOS','Seguro a bordo','📄',FALSE,220),
  ('licencia','DOCUMENTOS','Licencia del conductor','🪪',TRUE,230),
  ('limpieza_interior','LIMPIEZA','Interior limpio','🧽',FALSE,240),
  ('limpieza_exterior','LIMPIEZA','Exterior limpio','✨',FALSE,250)
ON CONFLICT (codigo) DO UPDATE SET
  categoria = EXCLUDED.categoria,
  etiqueta  = EXCLUDED.etiqueta,
  icono     = EXCLUDED.icono,
  critico   = EXCLUDED.critico,
  orden     = EXCLUDED.orden;


-- ══════════════════════════════════════════════════════════════════════════
-- 5. CATALOGO DE FALLAS
--
-- Escrito en el idioma del conductor ("hala hacia un lado", "bota humo"), no
-- en el del mecanico. Si la lista no se parece a como el hablaria, termina
-- escogiendo "Otro" y se pierde el dato.
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS asa_flota_fallas_catalogo (
  id               BIGSERIAL PRIMARY KEY,
  codigo           TEXT NOT NULL UNIQUE,
  categoria        TEXT NOT NULL,
  etiqueta         TEXT NOT NULL,
  icono            TEXT,
  severidad        TEXT NOT NULL DEFAULT 'MODERADA'
                     CHECK (severidad IN ('LEVE','MODERADA','GRAVE')),
  detiene_vehiculo BOOLEAN NOT NULL DEFAULT FALSE,  -- no debe salir a la calle asi
  orden            INT NOT NULL DEFAULT 0,
  activo           BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO asa_flota_fallas_catalogo (codigo, categoria, etiqueta, icono, severidad, detiene_vehiculo, orden) VALUES
  ('no_arranca','MOTOR','No arranca','🔌','GRAVE',TRUE,10),
  ('arranca_dificil','MOTOR','Le cuesta arrancar','🔑','MODERADA',FALSE,20),
  ('se_calienta','MOTOR','Se calienta','🌡️','GRAVE',TRUE,30),
  ('humo_negro','MOTOR','Bota humo negro','💨','MODERADA',FALSE,40),
  ('humo_blanco','MOTOR','Bota humo blanco','☁️','GRAVE',TRUE,50),
  ('pierde_fuerza','MOTOR','Pierde fuerza al subir','📉','MODERADA',FALSE,60),
  ('ruido_motor','MOTOR','Ruido raro en el motor','🔊','MODERADA',FALSE,70),
  ('check_engine','MOTOR','Luz de check engine encendida','⚠️','MODERADA',FALSE,80),
  ('bota_aceite','MOTOR','Está botando aceite','🛢️','MODERADA',FALSE,90),
  ('bota_agua','MOTOR','Está botando agua','💧','GRAVE',TRUE,100),
  ('frenos_suenan','FRENOS','Los frenos suenan','🛑','MODERADA',FALSE,110),
  ('pedal_bajo','FRENOS','El pedal del freno se va abajo','⬇️','GRAVE',TRUE,120),
  ('vibra_frenar','FRENOS','Vibra al frenar','📳','MODERADA',FALSE,130),
  ('hala_frenar','FRENOS','Hala hacia un lado al frenar','↔️','GRAVE',TRUE,140),
  ('freno_mano_flojo','FRENOS','El freno de mano no agarra','🅿️','MODERADA',FALSE,150),
  ('hala_lado','SUSPENSION','Hala hacia un lado al guiar','↩️','MODERADA',FALSE,160),
  ('vibra_guiar','SUSPENSION','Vibra el guía','🎯','MODERADA',FALSE,170),
  ('suena_hoyos','SUSPENSION','Suena al pasar hoyos','🕳️','LEVE',FALSE,180),
  ('guia_duro','SUSPENSION','El guía está duro','💪','MODERADA',FALSE,190),
  ('goma_baja','GOMAS','Goma baja','🛞','MODERADA',FALSE,200),
  ('goma_gastada','GOMAS','Goma gastada / lisa','🪫','GRAVE',TRUE,210),
  ('goma_rota','GOMAS','Goma rota o con burbuja','💥','GRAVE',TRUE,220),
  ('sin_repuesto','GOMAS','No tiene goma de repuesto','🚫','LEVE',FALSE,230),
  ('bateria_debil','ELECTRICO','La batería se descarga','🔋','MODERADA',FALSE,240),
  ('luces_fundidas','ELECTRICO','Luces fundidas','💡','MODERADA',FALSE,250),
  ('no_da_corriente','ELECTRICO','No da corriente','⚡','GRAVE',TRUE,260),
  ('radio_no_sirve','ELECTRICO','Radio no sirve','📻','LEVE',FALSE,270),
  ('cristales_no_suben','ELECTRICO','Los cristales no suben','🪟','LEVE',FALSE,280),
  ('aire_no_enfria','AIRE','El aire no enfría','❄️','MODERADA',FALSE,290),
  ('aire_huele','AIRE','El aire huele mal','👃','LEVE',FALSE,300),
  ('abanico_no_sopla','AIRE','El abanico no sopla','🌀','LEVE',FALSE,310),
  ('cambia_duro','TRANSMISION','Cambia duro','🔗','MODERADA',FALSE,320),
  ('patina','TRANSMISION','Patina / se queda en falso','🌀','GRAVE',TRUE,330),
  ('ruido_cambios','TRANSMISION','Ruido al cambiar','🔊','MODERADA',FALSE,340),
  ('clutch_flojo','TRANSMISION','El clutch está flojo','🦶','MODERADA',FALSE,350),
  ('golpe_nuevo','CARROCERIA','Golpe o abolladura nueva','🚗','LEVE',FALSE,360),
  ('cristal_roto','CARROCERIA','Cristal roto o estrellado','🪟','MODERADA',FALSE,370),
  ('espejo_roto','CARROCERIA','Espejo roto','🪞','LEVE',FALSE,380),
  ('puerta_no_cierra','CARROCERIA','Puerta no cierra bien','🚪','MODERADA',FALSE,390),
  ('asiento_danado','CARROCERIA','Asiento dañado','💺','LEVE',FALSE,400),
  ('marbete_vencido','DOCUMENTOS','Marbete vencido','🏷️','GRAVE',TRUE,410),
  ('sin_seguro','DOCUMENTOS','No tiene el seguro a bordo','📄','MODERADA',FALSE,420),
  ('otro','OTRO','Otro (explicar al encargado)','❓','MODERADA',FALSE,900)
ON CONFLICT (codigo) DO UPDATE SET
  categoria        = EXCLUDED.categoria,
  etiqueta         = EXCLUDED.etiqueta,
  icono            = EXCLUDED.icono,
  severidad        = EXCLUDED.severidad,
  detiene_vehiculo = EXCLUDED.detiene_vehiculo,
  orden            = EXCLUDED.orden;


-- ══════════════════════════════════════════════════════════════════════════
-- 6. CHEQUEOS (EL PARTE DIARIO)
--
-- `combustible_octavos` guarda la aguja en octavos: 0 = vacio (E), 4 = mitad,
-- 8 = lleno (F). Se mueve con flechas en la pantalla; el conductor nunca
-- escribe un porcentaje.
--
-- `respuestas` es la foto completa del checklist tal como quedo ese dia.
-- Sirve de respaldo si manana alguien cambia el catalogo de items.
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS asa_flota_chequeos (
  id                  BIGSERIAL PRIMARY KEY,
  vehiculo_id         BIGINT NOT NULL REFERENCES asa_flota_vehiculos(id) ON DELETE CASCADE,
  conductor_id         BIGINT REFERENCES asa_flota_conductores(id) ON DELETE SET NULL,
  conductor_nombre     TEXT,                             -- congelado por si el conductor se borra
  fecha               DATE NOT NULL DEFAULT CURRENT_DATE,
  turno               TEXT NOT NULL DEFAULT 'SALIDA'
                        CHECK (turno IN ('SALIDA','ENTRADA')),
  km                  NUMERIC(12,1),
  km_recorrido        NUMERIC(12,1),                    -- contra el chequeo anterior
  combustible_octavos INT CHECK (combustible_octavos BETWEEN 0 AND 8),
  respuestas          JSONB NOT NULL DEFAULT '{}'::jsonb,
  items_mal           INT NOT NULL DEFAULT 0,
  fallas_reportadas   INT NOT NULL DEFAULT 0,
  fotos_subidas       INT NOT NULL DEFAULT 0,
  fotos_completas     BOOLEAN NOT NULL DEFAULT FALSE,
  apto_circular       BOOLEAN NOT NULL DEFAULT TRUE,    -- FALSE si hay algo critico
  observacion         TEXT,                             -- opcional, casi nunca se usa
  lat                 NUMERIC(10,6),
  lng                 NUMERIC(10,6),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Un parte por vehiculo, dia y turno. El indice unico es lo que hace que
-- tocar "Guardar" dos veces no genere dos partes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_asaflota_chq_unico
  ON asa_flota_chequeos(vehiculo_id, fecha, turno);
CREATE INDEX IF NOT EXISTS idx_asaflota_chq_fecha ON asa_flota_chequeos(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_asaflota_chq_veh   ON asa_flota_chequeos(vehiculo_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_asaflota_chq_emp   ON asa_flota_chequeos(conductor_id, fecha DESC);


-- Solo se guardan los items que NO salieron bien. Lo que no esta aqui, esta
-- bien. 25 items por vehiculo por dia serian 9,000 filas al ano por unidad
-- para decir casi siempre lo mismo.
CREATE TABLE IF NOT EXISTS asa_flota_chequeo_items (
  id            BIGSERIAL PRIMARY KEY,
  chequeo_id    BIGINT NOT NULL REFERENCES asa_flota_chequeos(id) ON DELETE CASCADE,
  vehiculo_id   BIGINT NOT NULL REFERENCES asa_flota_vehiculos(id) ON DELETE CASCADE,
  fecha         DATE NOT NULL DEFAULT CURRENT_DATE,
  item_codigo   TEXT NOT NULL,
  item_etiqueta TEXT,
  valor         TEXT NOT NULL DEFAULT 'MAL' CHECK (valor IN ('MAL','NA')),
  critico       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asaflota_chqit_chq  ON asa_flota_chequeo_items(chequeo_id);
CREATE INDEX IF NOT EXISTS idx_asaflota_chqit_item ON asa_flota_chequeo_items(item_codigo, fecha DESC);


-- ══════════════════════════════════════════════════════════════════════════
-- 7. FALLAS REPORTADAS
--
-- Una falla vive hasta que alguien la cierra. Si el conductor la vuelve a
-- reportar manana, se suma a la misma (`veces_reportada`) en vez de abrir
-- otra -- si no, el tablero se llena de duplicados de la misma goma baja.
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS asa_flota_fallas_reportadas (
  id               BIGSERIAL PRIMARY KEY,
  vehiculo_id      BIGINT NOT NULL REFERENCES asa_flota_vehiculos(id) ON DELETE CASCADE,
  chequeo_id       BIGINT REFERENCES asa_flota_chequeos(id) ON DELETE SET NULL,
  conductor_id      BIGINT REFERENCES asa_flota_conductores(id) ON DELETE SET NULL,
  conductor_nombre  TEXT,
  falla_codigo     TEXT NOT NULL,
  falla_etiqueta   TEXT,
  categoria        TEXT,
  severidad        TEXT NOT NULL DEFAULT 'MODERADA',
  detiene_vehiculo BOOLEAN NOT NULL DEFAULT FALSE,
  km_reporte       NUMERIC(12,1),
  estado           TEXT NOT NULL DEFAULT 'ABIERTA'
                     CHECK (estado IN ('ABIERTA','EN_REVISION','EN_TALLER','RESUELTA','DESCARTADA')),
  veces_reportada  INT NOT NULL DEFAULT 1,
  primera_vez      TIMESTAMPTZ DEFAULT NOW(),
  ultima_vez       TIMESTAMPTZ DEFAULT NOW(),
  resuelta_en      TIMESTAMPTZ,
  resuelta_por     TEXT,
  costo_reparacion NUMERIC(14,2),
  nota             TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asaflota_falla_veh    ON asa_flota_fallas_reportadas(vehiculo_id, estado);
CREATE INDEX IF NOT EXISTS idx_asaflota_falla_estado ON asa_flota_fallas_reportadas(estado);
-- Una sola falla abierta por vehiculo y codigo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_asaflota_falla_abierta_unica
  ON asa_flota_fallas_reportadas(vehiculo_id, falla_codigo)
  WHERE estado IN ('ABIERTA','EN_REVISION','EN_TALLER');


-- ══════════════════════════════════════════════════════════════════════════
-- 8. FOTOS
--
-- Los archivos van a Supabase Storage (bucket `asa-flota-fotos`); aqui solo la URL.
-- Guardar la imagen en la tabla como base64 -- que es lo que hace hoy la
-- cafeteria -- multiplicaria por vehiculos x angulos x 365 dias.
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS asa_flota_fotos (
  id          BIGSERIAL PRIMARY KEY,
  vehiculo_id BIGINT NOT NULL REFERENCES asa_flota_vehiculos(id) ON DELETE CASCADE,
  chequeo_id  BIGINT REFERENCES asa_flota_chequeos(id) ON DELETE CASCADE,
  conductor_id BIGINT REFERENCES asa_flota_conductores(id) ON DELETE SET NULL,
  fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
  angulo      TEXT NOT NULL DEFAULT 'OTRO'
                CHECK (angulo IN ('FRONTAL','TRASERA','LATERAL_IZQ','LATERAL_DER','TABLERO','INTERIOR','DANO','RECIBO','OTRO')),
  url         TEXT NOT NULL,
  ruta        TEXT,                                  -- path dentro del bucket, para borrarla
  bytes       INT,
  nota        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asaflota_flota_fotos_veh ON asa_flota_fotos(vehiculo_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_asaflota_flota_fotos_chq ON asa_flota_fotos(chequeo_id);


-- ══════════════════════════════════════════════════════════════════════════
-- 9. GASTOS
--
-- Todo lo que se le mete al vehiculo. `galones` y `km` solo aplican a
-- combustible, y son los que permiten calcular km/galon sin pedir otro dato.
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS asa_flota_gastos (
  id             BIGSERIAL PRIMARY KEY,
  vehiculo_id    BIGINT NOT NULL REFERENCES asa_flota_vehiculos(id) ON DELETE CASCADE,
  conductor_id    BIGINT REFERENCES asa_flota_conductores(id) ON DELETE SET NULL,
  fecha          DATE NOT NULL DEFAULT CURRENT_DATE,
  tipo           TEXT NOT NULL DEFAULT 'COMBUSTIBLE'
                   CHECK (tipo IN ('COMBUSTIBLE','MANTENIMIENTO','REPARACION','GOMAS','DOCUMENTOS','SEGURO','PEAJE','PARQUEO','MULTA','LAVADO','ACCESORIOS','OTRO')),
  descripcion    TEXT,
  monto          NUMERIC(14,2) NOT NULL DEFAULT 0,
  galones        NUMERIC(8,3),
  precio_galon   NUMERIC(10,2),
  km             NUMERIC(12,1),
  tanque_lleno   BOOLEAN NOT NULL DEFAULT TRUE,       -- el rendimiento asume tanqueos llenos
  suplidor       TEXT,
  ncf            TEXT,
  metodo_pago    TEXT DEFAULT 'EFECTIVO',
  foto_recibo    TEXT,
  registrado_por TEXT,
  notas          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asaflota_flota_gastos_veh   ON asa_flota_gastos(vehiculo_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_asaflota_flota_gastos_tipo  ON asa_flota_gastos(tipo, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_asaflota_flota_gastos_fecha ON asa_flota_gastos(fecha DESC);


-- ══════════════════════════════════════════════════════════════════════════
-- 10. DOCUMENTOS (MARBETE, SEGURO, INSPECCION)
--
-- En RD el marbete se renueva todos los anos y vence el 31 de enero sin
-- prorroga. Que se le pase a una unidad es multa segura, y con varias
-- unidades nadie lo lleva de memoria.
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS asa_flota_documentos (
  id          BIGSERIAL PRIMARY KEY,
  vehiculo_id BIGINT NOT NULL REFERENCES asa_flota_vehiculos(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL DEFAULT 'MARBETE'
                CHECK (tipo IN ('MARBETE','SEGURO','INSPECCION','PLACA','CONTRATO','GARANTIA','OTRO')),
  numero      TEXT,
  compania    TEXT,
  emitido     DATE,
  vence       DATE,
  monto       NUMERIC(14,2),
  alerta_dias INT NOT NULL DEFAULT 30,
  archivo_url TEXT,
  notas       TEXT,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asaflota_doc_veh   ON asa_flota_documentos(vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_asaflota_doc_vence ON asa_flota_documentos(vence) WHERE activo;


-- ══════════════════════════════════════════════════════════════════════════
-- 11. MANTENIMIENTO PREVENTIVO POR KILOMETRAJE
--
-- El kilometraje que entra por el parte diario es lo que dispara esto. Sin
-- el, el cambio de aceite se hace "cuando alguien se acuerda".
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS asa_flota_mantenimientos (
  id             BIGSERIAL PRIMARY KEY,
  vehiculo_id    BIGINT NOT NULL REFERENCES asa_flota_vehiculos(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL,                        -- ACEITE, GOMAS, FRENOS, CORREA...
  etiqueta       TEXT NOT NULL,
  intervalo_km   NUMERIC(10,1),
  intervalo_dias INT,
  km_ultimo      NUMERIC(12,1),
  fecha_ultimo   DATE,
  costo_ultimo   NUMERIC(14,2),
  taller         TEXT,
  activo         BOOLEAN NOT NULL DEFAULT TRUE,
  notas          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_asaflota_mant_unico ON asa_flota_mantenimientos(vehiculo_id, tipo);
CREATE INDEX IF NOT EXISTS idx_asaflota_mant_veh ON asa_flota_mantenimientos(vehiculo_id);


-- ══════════════════════════════════════════════════════════════════════════
-- 12. VISTAS DE ANALISIS
-- ══════════════════════════════════════════════════════════════════════════

-- Resumen por vehiculo: km recorridos, gasto acumulado y costo por km.
DROP VIEW IF EXISTS asa_flota_v_resumen_vehiculo;
CREATE VIEW asa_flota_v_resumen_vehiculo AS
SELECT
  v.id,
  v.codigo,
  v.placa,
  v.marca,
  v.modelo,
  v.anio,
  v.estado,
  v.km_inicial,
  v.km_actual,
  GREATEST(v.km_actual - v.km_inicial, 0)                      AS km_recorridos,
  e.nombre                                                     AS conductor,
  COALESCE(g.total_gastado, 0)                                 AS total_gastado,
  COALESCE(g.total_combustible, 0)                             AS total_combustible,
  COALESCE(g.total_mantenimiento, 0)                           AS total_mantenimiento,
  COALESCE(g.total_reparacion, 0)                              AS total_reparacion,
  COALESCE(g.total_documentos, 0)                              AS total_documentos,
  COALESCE(g.total_multas, 0)                                  AS total_multas,
  COALESCE(g.galones, 0)                                       AS galones_totales,
  -- Costo por km: el numero con el que se comparan dos unidades entre si.
  CASE WHEN GREATEST(v.km_actual - v.km_inicial, 0) > 0
       THEN ROUND(COALESCE(g.total_gastado,0) / GREATEST(v.km_actual - v.km_inicial, 1), 2)
       ELSE NULL END                                           AS costo_por_km,
  CASE WHEN COALESCE(g.galones,0) > 0
       THEN ROUND(GREATEST(v.km_actual - v.km_inicial, 0) / g.galones, 2)
       ELSE NULL END                                           AS km_por_galon,
  c.ultimo_chequeo,
  c.chequeos_total,
  COALESCE(f.fallas_abiertas, 0)                               AS fallas_abiertas
FROM asa_flota_vehiculos v
LEFT JOIN asa_flota_conductores e ON e.id = v.conductor_id
LEFT JOIN (
  SELECT vehiculo_id,
         SUM(monto)                                                    AS total_gastado,
         SUM(monto) FILTER (WHERE tipo = 'COMBUSTIBLE')                AS total_combustible,
         SUM(monto) FILTER (WHERE tipo IN ('MANTENIMIENTO','GOMAS','LAVADO')) AS total_mantenimiento,
         SUM(monto) FILTER (WHERE tipo = 'REPARACION')                 AS total_reparacion,
         SUM(monto) FILTER (WHERE tipo IN ('DOCUMENTOS','SEGURO'))     AS total_documentos,
         SUM(monto) FILTER (WHERE tipo IN ('MULTA','PEAJE','PARQUEO')) AS total_multas,
         SUM(galones)                                                  AS galones
  FROM asa_flota_gastos GROUP BY vehiculo_id
) g ON g.vehiculo_id = v.id
LEFT JOIN (
  SELECT vehiculo_id, MAX(fecha) AS ultimo_chequeo, COUNT(*) AS chequeos_total
  FROM asa_flota_chequeos GROUP BY vehiculo_id
) c ON c.vehiculo_id = v.id
LEFT JOIN (
  SELECT vehiculo_id, COUNT(*) AS fallas_abiertas
  FROM asa_flota_fallas_reportadas
  WHERE estado IN ('ABIERTA','EN_REVISION','EN_TALLER')
  GROUP BY vehiculo_id
) f ON f.vehiculo_id = v.id
WHERE v.activo;


-- Documentos por vencer o vencidos.
DROP VIEW IF EXISTS asa_flota_v_documentos_alerta;
CREATE VIEW asa_flota_v_documentos_alerta AS
SELECT
  d.id, d.vehiculo_id, v.codigo, v.placa, d.tipo, d.numero, d.compania,
  d.vence, d.alerta_dias,
  (d.vence - CURRENT_DATE) AS dias_restantes,
  CASE
    WHEN d.vence < CURRENT_DATE                  THEN 'VENCIDO'
    WHEN d.vence <= CURRENT_DATE + d.alerta_dias THEN 'POR_VENCER'
    ELSE 'VIGENTE'
  END AS situacion
FROM asa_flota_documentos d
JOIN asa_flota_vehiculos v ON v.id = d.vehiculo_id
WHERE d.activo AND v.activo AND d.vence IS NOT NULL;


-- Las fallas que mas se repiten. Un mismo codigo saliendo en tres unidades
-- distintas no es mala suerte: es el suplidor o el tipo de ruta.
DROP VIEW IF EXISTS asa_flota_v_fallas_frecuentes;
CREATE VIEW asa_flota_v_fallas_frecuentes AS
SELECT
  falla_codigo, falla_etiqueta, categoria, severidad,
  COUNT(*)                                        AS reportes,
  SUM(veces_reportada)                            AS veces_total,
  COUNT(DISTINCT vehiculo_id)                     AS vehiculos_afectados,
  COUNT(*) FILTER (WHERE estado IN ('ABIERTA','EN_REVISION','EN_TALLER')) AS abiertas,
  SUM(COALESCE(costo_reparacion,0))               AS costo_acumulado
FROM asa_flota_fallas_reportadas
GROUP BY falla_codigo, falla_etiqueta, categoria, severidad;


-- ══════════════════════════════════════════════════════════════════════════
-- 13. CONFIGURACION DEL MODULO
-- ══════════════════════════════════════════════════════════════════════════

INSERT INTO asa_config_sistema (clave, valor)
VALUES ('asa_flota_config', '{
  "nombre_modulo": "ASA",
  "exigir_fotos": true,
  "frecuencia_fotos": "DIARIA",
  "angulos_requeridos": ["FRONTAL","TRASERA","LATERAL_IZQ","LATERAL_DER","TABLERO"],
  "hora_limite_chequeo": "09:00",
  "alerta_documentos_dias": 30,
  "precio_galon_referencia": 290,
  "moneda": "RD$"
}'::jsonb)
ON CONFLICT (clave) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════
-- 14. BUCKET DE FOTOS
--
-- Publico en lectura: las URLs son largas y aleatorias, y el encargado tiene
-- que poder abrir la foto desde el celular sin token. No se guarda nada
-- sensible ahi, solo fotos de los vehiculos de la empresa.
-- ══════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public)
VALUES ('asa-flota-fotos', 'asa-flota-fotos', TRUE)
ON CONFLICT (id) DO UPDATE SET public = TRUE;

-- La escritura la hace el backend con la service key, que salta RLS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'asa_flota_fotos_lectura_publica'
  ) THEN
    CREATE POLICY asa_flota_fotos_lectura_publica ON storage.objects
      FOR SELECT USING (bucket_id = 'asa-flota-fotos');
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- VERIFICACION
-- ══════════════════════════════════════════════════════════════════════════
-- SELECT COUNT(*) FROM asa_flota_checklist_items;    -- 25
-- SELECT COUNT(*) FROM asa_flota_fallas_catalogo;    -- 43
-- SELECT * FROM asa_flota_v_resumen_vehiculo;
-- SELECT * FROM asa_flota_v_documentos_alerta WHERE situacion <> 'VIGENTE';
--
-- Vehiculos que no reportaron hoy:
-- SELECT v.codigo, v.placa FROM asa_flota_vehiculos v
--  WHERE v.activo AND v.requiere_chequeo
--    AND NOT EXISTS (SELECT 1 FROM asa_flota_chequeos c
--                     WHERE c.vehiculo_id = v.id AND c.fecha = CURRENT_DATE);
