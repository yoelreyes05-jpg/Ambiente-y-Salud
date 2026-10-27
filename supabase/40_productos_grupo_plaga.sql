-- 40_productos_grupo_plaga.sql — Para qué plagas es cada producto
-- "rastreros", "voladores", "roedores" o varios separados por coma
-- ("rastreros,voladores"). Vacío = el sistema lo deduce del nombre, el
-- ingrediente activo y el uso. El portal ordena las fichas y hojas por esto.
alter table asa_plaguicidas_catalogo add column if not exists grupo_plaga text;
