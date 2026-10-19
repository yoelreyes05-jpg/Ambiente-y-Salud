-- ============================================================================
-- 42_chat_tecnicos.sql — Ambiente y Salud RD (ASA SRL)
--
-- Chat entre la oficina (panel) y cada técnico (app del técnico), para darle
-- seguimiento a lo que suben. Una conversación por técnico. Un mensaje puede
-- ir amarrado a un servicio (inspeccion_id): "¿por qué marcaste ratas en la
-- 5023?" y desde el mensaje se abre ese servicio.
--
-- Es idempotente: se puede correr más de una vez.
-- ============================================================================

create table if not exists asa_chat_mensajes (
  id              uuid primary key default gen_random_uuid(),
  tecnico_id      uuid not null references asa_usuarios(id) on delete cascade,  -- la conversación
  autor_id        uuid references asa_usuarios(id) on delete set null,
  autor_nombre    text not null,
  de_oficina      boolean not null default false,
  texto           text,
  fotos           jsonb not null default '[]'::jsonb,
  inspeccion_id   uuid references asa_inspecciones(id) on delete set null,
  leido_tecnico   boolean not null default false,
  leido_oficina   boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists asa_chat_mensajes_conv_idx on asa_chat_mensajes (tecnico_id, created_at desc);
create index if not exists asa_chat_mensajes_insp_idx on asa_chat_mensajes (inspeccion_id) where inspeccion_id is not null;

-- Cerrada a la clave pública, como todas (41_seguridad_y_accesos.sql)
alter table asa_chat_mensajes enable row level security;
revoke all on asa_chat_mensajes from anon, authenticated;

notify pgrst, 'reload schema';
select count(*) as mensajes from asa_chat_mensajes;
