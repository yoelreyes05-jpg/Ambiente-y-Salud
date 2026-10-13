-- ============================================================================
-- 37_supervisor_planta.sql — Ambiente y Salud RD (ASA SRL)
--
-- Cada hotel tiene su supervisor de área asignado. Se asigna desde el panel al
-- entrar a la planta ("Supervisor asignado") y sale impreso en el reporte de
-- servicios y evidencias.
--
-- Es idempotente: se puede correr más de una vez.
-- ============================================================================

alter table asa_sitios add column if not exists supervisor text;
alter table asa_sitios add column if not exists supervisor_telefono text;

-- Que la API de Supabase vea las columnas nuevas enseguida
notify pgrst, 'reload schema';

select nombre, supervisor, supervisor_telefono from asa_sitios order by nombre;
