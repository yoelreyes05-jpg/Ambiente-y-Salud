-- ============================================================================
-- 34_cronograma_e_incidencias.sql — Ambiente y Salud RD (ASA SRL)
--
-- Dos cosas nuevas:
--
-- 1. CRONOGRAMA DE TRABAJO (asa_cronograma)
--    La programación de servicios que hoy sale en Excel ("PROG. SERVICIO"):
--    qué se hace, en qué planta, qué día y a qué hora, y con qué equipo. Se
--    sube el Excel desde el panel, o se agrega y corrige a mano. Lo ven la
--    oficina, los técnicos (en su app) y el hotel (en su portal), cada uno
--    solo de sus plantas.
--
-- 2. INCIDENCIAS DE CHINCHE / CÓDIGO ROSA (asa_incidencias)
--    Cuando el hotel reporta chinche (o código rosa) en una habitación, se
--    abre un caso con su protocolo:
--      a. verificaciones (checklist que se marca una por una),
--      b. resultado: ¿hay chinche o no?
--      c. si hay: condiciones encontradas y las directrices del tratamiento
--         (pasos con fecha), que se pueden trazar y ajustar caso por caso;
--      d. si no hay (o al cerrar el tratamiento con verificación negativa):
--         certificado en español e inglés para el hotel.
--    La plantilla del protocolo (verificaciones, condiciones y directrices)
--    vive en asa_config_sistema, clave 'protocolo_chinche', y se edita desde
--    el panel.
--
-- Es idempotente: se puede correr dos veces.
-- Requiere 05, 11, 20 y 30.
-- ============================================================================

set search_path = public, extensions;

-- ── 1. Cronograma ──────────────────────────────────────────────────────────
create table if not exists asa_cronograma (
  id            uuid primary key default gen_random_uuid(),
  sitio_id      uuid references asa_sitios(id) on delete cascade,
  -- Lo que decía el Excel en PLANTA / CLIENTE / CONTRATO. Se guarda aunque la
  -- planta se haya reconocido, para poder revisar de dónde vino cada fila.
  planta_texto  text,
  cliente_texto text,
  contrato      text,
  tipo          text not null default 'SERVICIO',
  titulo        text not null,
  fecha_inicio  timestamptz not null,
  fecha_fin     timestamptz,
  estado        text not null default 'pendiente'
                  check (estado in ('pendiente', 'realizado', 'cancelado', 'reprogramado')),
  equipo        text,           -- "Santo Liranzo, Amarilis Castro, ..."
  notas         text,           -- "Recorrido diario/Inspección de áreas..."
  origen        text not null default 'manual' check (origen in ('excel', 'manual', 'repetido')),
  lote          uuid,           -- qué subida de Excel lo creó
  creado_por    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (fecha_fin is null or fecha_fin >= fecha_inicio)
);
create index if not exists idx_asa_cronograma_sitio_fecha on asa_cronograma (sitio_id, fecha_inicio);
create index if not exists idx_asa_cronograma_fecha on asa_cronograma (fecha_inicio);
create index if not exists idx_asa_cronograma_lote on asa_cronograma (lote) where lote is not null;

-- ── 2. Incidencias de chinche / código rosa ────────────────────────────────
create sequence if not exists asa_incidencias_seq;

create table if not exists asa_incidencias (
  id                  uuid primary key default gen_random_uuid(),
  numero              text unique not null
                        default ('INC-' || lpad(nextval('asa_incidencias_seq')::text, 5, '0')),
  sitio_id            uuid not null references asa_sitios(id) on delete cascade,
  punto_id            uuid references asa_puntos_control(id) on delete set null,
  numero_habitacion   text not null,
  hotel_nombre        text,          -- como sale en el certificado ("Iberostar Bávaro"); vacío = nombre de la planta
  tipo                text not null default 'chinche' check (tipo in ('chinche', 'codigo_rosa')),
  orden_id            uuid references asa_ordenes_trabajo(id) on delete set null,
  fecha_reporte       timestamptz not null default now(),
  reportado_por       text,          -- quién del hotel lo reportó
  dirigido_a          text,          -- a quién va el certificado ("Leticia Álvarez")
  descripcion         text,
  estado              text not null default 'abierta'
                        check (estado in ('abierta', 'en_tratamiento', 'negativa', 'cerrada', 'cancelada')),
  -- null mientras no se verifica; 'positivo' = hay chinche; 'negativo' = no hay
  resultado           text check (resultado in ('positivo', 'negativo')),
  verificaciones      jsonb not null default '[]'::jsonb,  -- [{id, texto, hecho, nota, por, at}]
  condiciones         jsonb not null default '[]'::jsonb,  -- [códigos de condición marcados]
  nivel               text check (nivel in ('leve', 'moderado', 'severo')),
  protocolo           jsonb not null default '[]'::jsonb,  -- [{id, texto, dia, fecha, hecho, nota, por, at}]
  fecha_verificacion  timestamptz,
  verificado_por      text,
  fecha_cierre        timestamptz,
  certificado_at      timestamptz,   -- primera vez que se emitió el certificado
  notas               text,
  creado_por          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
-- Si la tabla ya existía de una corrida anterior, se le agrega lo que falte.
alter table asa_incidencias add column if not exists hotel_nombre text;

create index if not exists idx_asa_incidencias_sitio on asa_incidencias (sitio_id, estado);
create index if not exists idx_asa_incidencias_orden on asa_incidencias (orden_id) where orden_id is not null;

-- Bitácora del caso: quién hizo qué y cuándo (lo que pide el auditor).
create table if not exists asa_incidencias_log (
  id             uuid primary key default gen_random_uuid(),
  incidencia_id  uuid not null references asa_incidencias(id) on delete cascade,
  usuario_nombre text,
  accion         text not null,
  detalle        text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_asa_incidencias_log on asa_incidencias_log (incidencia_id, created_at);

-- ── 3. Verificación ────────────────────────────────────────────────────────
do $$
declare faltan text := '';
begin
  if to_regclass('public.asa_cronograma') is null then faltan := faltan || ' asa_cronograma'; end if;
  if to_regclass('public.asa_incidencias') is null then faltan := faltan || ' asa_incidencias'; end if;
  if to_regclass('public.asa_incidencias_log') is null then faltan := faltan || ' asa_incidencias_log'; end if;
  if faltan <> '' then raise exception 'Quedó incompleto:%', faltan; end if;
  raise notice 'OK 34_ — cronograma de trabajo e incidencias de chinche / código rosa.';
end $$;
