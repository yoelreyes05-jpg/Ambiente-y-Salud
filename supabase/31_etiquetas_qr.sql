-- ============================================================================
-- 31_etiquetas_qr.sql — Ambiente y Salud RD (ASA SRL)
--
-- Etiquetas QR que ya están impresas y pegadas pero no abren ningún punto.
--
-- 1. asa_qr_impresos — EL GRUPO de etiquetas que ASA mandó a imprimir (se
--    carga desde los archivos de la imprenta). Sirve para saber si una
--    etiqueta que alguien escanea es "nuestra" o es un QR ajeno.
--
-- 2. asa_qr_etiquetas — etiquetas ADICIONALES de un punto. El QR original de
--    un punto sigue sin poder cambiarse (trg_asa_qr_inmutable); en vez de
--    tocarlo, se le cuelgan etiquetas extra. Escanear cualquiera de ellas abre
--    el mismo punto, con su mismo historial.
--
-- 3. asa_qr_no_reconocidos — cada vez que alguien escanea una etiqueta que no
--    abre nada, queda anotada (qué código, en qué planta, cuántas veces), para
--    que la oficina las asigne desde el panel sin tener que ir a buscarlas.
--
-- Un mismo código nunca puede abrir dos puntos: lo garantizan los triggers
-- de abajo, en los dos sentidos.
--
-- Es idempotente. Requiere 20_hoteles_puntos_control.sql.
-- ============================================================================

set search_path = public, extensions;

create table if not exists asa_qr_impresos (
  token      text primary key,
  lote       text,
  archivo    text,
  notas      text,
  created_at timestamptz not null default now()
);

create table if not exists asa_qr_etiquetas (
  id                uuid primary key default gen_random_uuid(),
  token             text not null unique,
  punto_id          uuid not null references asa_puntos_control(id) on delete cascade,
  origen            text not null default 'panel' check (origen in ('panel', 'foto', 'escaneo', 'lote')),
  creado_por        uuid references asa_usuarios(id) on delete set null,
  creado_por_nombre text,
  created_at        timestamptz not null default now()
);
create index if not exists idx_asa_qr_etiquetas_punto on asa_qr_etiquetas (punto_id);

create table if not exists asa_qr_no_reconocidos (
  token                 text primary key,
  sitio_id              uuid references asa_sitios(id) on delete set null,
  veces                 integer not null default 1,
  primer_escaneo        timestamptz not null default now(),
  ultimo_escaneo        timestamptz not null default now(),
  ultimo_usuario_nombre text,
  texto_original        text
);
create index if not exists idx_asa_qr_no_rec_sitio on asa_qr_no_reconocidos (sitio_id, ultimo_escaneo desc);

-- Una etiqueta extra no puede ser el QR principal de otro punto…
create or replace function asa_fn_qr_etiqueta_unica() returns trigger
language plpgsql as $$
begin
  new.token := upper(trim(new.token));
  if exists (select 1 from asa_puntos_control where upper(qr_token) = new.token) then
    raise exception 'La etiqueta % ya es el QR principal de otro punto.', new.token;
  end if;
  return new;
end $$;
drop trigger if exists trg_asa_qr_etiqueta_unica on asa_qr_etiquetas;
create trigger trg_asa_qr_etiqueta_unica before insert or update on asa_qr_etiquetas
  for each row execute function asa_fn_qr_etiqueta_unica();

-- …ni un punto nuevo puede nacer con un QR que ya es etiqueta extra de otro.
create or replace function asa_fn_qr_principal_libre() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from asa_qr_etiquetas where token = upper(trim(new.qr_token))) then
    raise exception 'El QR % ya está asignado como etiqueta de otro punto.', new.qr_token;
  end if;
  delete from asa_qr_no_reconocidos where token = upper(trim(new.qr_token));
  return new;
end $$;
drop trigger if exists trg_asa_qr_principal_libre on asa_puntos_control;
create trigger trg_asa_qr_principal_libre before insert on asa_puntos_control
  for each row execute function asa_fn_qr_principal_libre();

-- Al asignarla, deja de estar en la lista de no reconocidas.
create or replace function asa_fn_qr_limpiar_no_reconocido() returns trigger
language plpgsql as $$
begin
  delete from asa_qr_no_reconocidos where token = new.token;
  return new;
end $$;
drop trigger if exists trg_asa_qr_limpiar_no_rec on asa_qr_etiquetas;
create trigger trg_asa_qr_limpiar_no_rec after insert on asa_qr_etiquetas
  for each row execute function asa_fn_qr_limpiar_no_reconocido();

-- Verificación
select
  (select count(*) from information_schema.tables where table_name = 'asa_qr_impresos')       as "qr_impresos",
  (select count(*) from information_schema.tables where table_name = 'asa_qr_etiquetas')      as "qr_etiquetas",
  (select count(*) from information_schema.tables where table_name = 'asa_qr_no_reconocidos') as "qr_no_reconocidos";
