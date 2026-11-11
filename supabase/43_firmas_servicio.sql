-- ============================================================================
-- 43_firmas_servicio.sql — Ambiente y Salud RD (ASA SRL)
--
-- Firma de quien recibe el servicio. Lo que sube un técnico en un hotel en un
-- día es su ORDEN de ese día: queda "En proceso" hasta que alguien del hotel
-- (en el teléfono del técnico o en el portal del hotel) revisa lo que hizo y
-- firma. Con la firma la orden queda "Finalizada".
--
-- clave = el técnico de la orden (su tecnico_id, o "n:" + su nombre si la
-- inspección no tiene tecnico_id).
--
-- Es idempotente: se puede correr más de una vez.
-- ============================================================================

create table if not exists asa_firmas_servicio (
  id               uuid primary key default gen_random_uuid(),
  sitio_id         uuid not null references asa_sitios(id) on delete cascade,
  fecha            date not null,
  clave            text not null,
  tecnico_nombre   text,
  firmante_nombre  text not null,
  firmante_cargo   text,
  firma            text not null,          -- imagen PNG (data URL)
  comentario       text,
  origen           text not null default 'portal' check (origen in ('tecnico', 'portal', 'panel')),
  firmado_por      uuid,                   -- cuenta con la que se firmó
  firmado_por_nombre text,
  servicios        int not null default 0, -- cuántos servicios tenía la orden al firmar
  created_at       timestamptz not null default now(),
  unique (sitio_id, fecha, clave)
);

create index if not exists asa_firmas_servicio_sitio_fecha on asa_firmas_servicio (sitio_id, fecha);

alter table asa_firmas_servicio enable row level security;

notify pgrst, 'reload schema';

select count(*) as firmas from asa_firmas_servicio;
