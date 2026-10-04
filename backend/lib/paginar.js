// lib/paginar.js — Traer TODAS las filas de una consulta, no solo las primeras 1000
//
// PostgREST (la API de Supabase) corta cada respuesta en 1000 filas y no avisa:
// la consulta "sale bien" pero incompleta. Lopesan Caoba tiene más de 1000
// puntos, así que la ruta del técnico mostraba exactamente 1000 (999 por hacer
// + 1 hecho, todos habitaciones) y las áreas generales nunca llegaban.
//
// `armarConsulta` tiene que devolver una consulta NUEVA cada vez (un builder de
// supabase no se puede reutilizar entre páginas) y con un orden estable que
// termine en una columna única (id): sin eso, entre una página y otra se
// pueden repetir o saltar filas.
export async function traerTodo(armarConsulta, tamPagina = 1000) {
  const out = [];
  for (let desde = 0; ; desde += tamPagina) {
    const { data, error } = await armarConsulta().range(desde, desde + tamPagina - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < tamPagina) break;
  }
  return out;
}

// Igual, pero con la forma { data, error } de supabase para no tener que
// reescribir el código que ya consumía la respuesta así.
export async function traerTodoComoRespuesta(armarConsulta) {
  try {
    return { data: await traerTodo(armarConsulta), error: null };
  } catch (error) {
    return { data: null, error };
  }
}
