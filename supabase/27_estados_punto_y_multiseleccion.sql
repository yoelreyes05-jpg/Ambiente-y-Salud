-- ============================================================================
-- 27_estados_punto_y_multiseleccion.sql — Ambiente y Salud RD (ASA SRL)
--
-- Dos cosas que quedaron heredadas del sistema anterior y no se podían tocar
-- desde el panel:
--
--   1. "Estado del punto". Los seis estados que ve el técnico estaban clavados
--      en tres sitios a la vez: el JavaScript de la app, el backend y un CHECK
--      de esta tabla. Cambiar uno solo no servía de nada: la base rechazaba el
--      registro. Aquí se quita el CHECK y la lista pasa a vivir en
--      asa_config_sistema, bajo la clave `estados_punto`, editable desde
--      Configuración → Estados del punto.
--
--      El CHECK se quita, pero no queda tierra de nadie: el backend valida
--      contra el catálogo guardado (routes/inspecciones.js), así que sigue sin
--      poder entrar un estado inventado. La diferencia es que ahora la lista de
--      estados válidos la decide ASA y no una migración.
--
--   2. Las preguntas de lista solo dejaban marcar una opción. Las que se
--      cargaron como 'seleccion' pasan a 'multiple' para que el técnico pueda
--      marcar varias (la app ya permite varias en ambos tipos).
--
-- Es idempotente: se puede correr dos veces sin romper nada. No borra ni
-- modifica ninguna inspección ya registrada.
-- Requiere 20_, 24_ y 25_.
-- ============================================================================

begin;

-- ── 1. Quitar el CHECK de estado_punto ──────────────────────────────────────
-- El nombre lo puso Postgres solo (asa_inspecciones_estado_punto_check), pero
-- se busca por columna en vez de por nombre: si la tabla se creó a mano en
-- algún ambiente, el nombre puede ser otro.
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class     rel on rel.oid = con.conrelid
      join pg_namespace ns  on ns.oid  = rel.relnamespace
     where rel.relname = 'asa_inspecciones'
       and ns.nspname  = 'public'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%estado_punto%'
  loop
    execute format('alter table public.asa_inspecciones drop constraint %I', c.conname);
    raise notice 'CHECK quitado: %', c.conname;
  end loop;
end $$;

-- Sigue siendo obligatorio y con valor por defecto: lo que se abre es la lista,
-- no la disciplina del dato.
alter table asa_inspecciones alter column estado_punto set default 'ok';
alter table asa_inspecciones alter column estado_punto set not null;

-- ── 2. El catálogo de estados, ya editable ──────────────────────────────────
--
-- Banderas de cada estado:
--   requiere_motivo  → el técnico tiene que decir POR QUÉ (y se salta el
--                      checklist, el nivel de actividad y el conteo de plagas).
--                      Es lo que marca un servicio como "no realizado".
--   genera_hallazgo  → abre un hallazgo automático para que el hotel lo corrija.
--   sistema          → se puede renombrar, recolorear y reordenar, pero no
--                      borrar: hay inspecciones viejas y reportes que lo usan.
--
-- Solo se siembra si la clave no existe todavía: si ya editaste la lista, esta
-- migración no te la pisa.
insert into asa_config_sistema (clave, valor)
select 'estados_punto', '[
  {"codigo":"ok",           "etiqueta":"Todo bien",     "color":"#4A7D4D", "orden":10, "activo":true, "sistema":true,  "requiere_motivo":false, "genera_hallazgo":false},
  {"codigo":"actividad",    "etiqueta":"Con actividad", "color":"#B45309", "orden":20, "activo":true, "sistema":false, "requiere_motivo":false, "genera_hallazgo":false},
  {"codigo":"dañado",       "etiqueta":"Dañado",        "color":"#B91C1C", "orden":30, "activo":true, "sistema":false, "requiere_motivo":false, "genera_hallazgo":true},
  {"codigo":"faltante",     "etiqueta":"No está",       "color":"#B91C1C", "orden":40, "activo":true, "sistema":false, "requiere_motivo":false, "genera_hallazgo":true},
  {"codigo":"no_accesible", "etiqueta":"No pude entrar","color":"#B91C1C", "orden":50, "activo":true, "sistema":true,  "requiere_motivo":true,  "genera_hallazgo":false},
  {"codigo":"reemplazado",  "etiqueta":"Lo reemplacé",  "color":"#32539C", "orden":60, "activo":true, "sistema":false, "requiere_motivo":false, "genera_hallazgo":false}
]'::jsonb
where not exists (select 1 from asa_config_sistema where clave = 'estados_punto');

-- ── 3. Las preguntas de lista aceptan varias opciones ───────────────────────
-- 'seleccion' (una sola) pasa a 'multiple' (varias). La respuesta se guarda en
-- valor_opciones, que ya existía en asa_inspeccion_respuestas y que tanto el
-- panel como el PDF ya saben leer.
update asa_preguntas
   set tipo_respuesta = 'multiple'
 where tipo_respuesta = 'seleccion';

commit;

-- ── Verificación ────────────────────────────────────────────────────────────
do $$
declare
  n_check   integer;
  n_estados integer;
  n_sel     integer;
begin
  select count(*) into n_check
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
   where rel.relname = 'asa_inspecciones'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%estado_punto%';

  select jsonb_array_length(valor) into n_estados
    from asa_config_sistema where clave = 'estados_punto';

  select count(*) into n_sel from asa_preguntas where tipo_respuesta = 'seleccion';

  if n_check > 0 then raise exception 'Todavía queda un CHECK sobre estado_punto'; end if;
  if coalesce(n_estados, 0) = 0 then raise exception 'El catálogo estados_punto quedó vacío'; end if;
  if n_sel > 0 then raise exception 'Quedaron % preguntas de una sola opción', n_sel; end if;

  raise notice 'OK 27_ — % estados editables desde el panel y las preguntas de lista aceptan varias opciones.', n_estados;
end $$;

-- Lo que verá el técnico en la botonera de "Estado del punto":
select
  x->>'orden'    as "Orden",
  x->>'etiqueta' as "Lo que lee el técnico",
  x->>'codigo'   as "Código guardado",
  case when (x->>'requiere_motivo')::boolean then 'Pide motivo' else '' end as "Nota"
from asa_config_sistema c,
     lateral jsonb_array_elements(c.valor) x
where c.clave = 'estados_punto'
order by (x->>'orden')::int;
