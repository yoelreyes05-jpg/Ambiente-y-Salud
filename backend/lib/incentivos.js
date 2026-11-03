// lib/incentivos.js — Evaluación de desempeño e incentivo mensual (pago del día 5)
//
// Copia el "Formulario de Evaluación de Personal" de ASA:
//   · Cada colaborador se evalúa en 9 renglones (I.1 … II.1). Cada pregunta se
//     califica de 1 a 10 y tiene su ponderación; el puntaje del renglón es
//     Σ calificación × ponderación (máximo 10).
//   · % de evaluación = promedio de los 9 renglones × 10   (hoja: W102)
//   · Incentivo = quincena (sueldo × 50 %) × % de evaluación  (Resultado: H = F × G)
//   · Total a pagar = incentivo − días no trabajados + trabajos adicionales
//     + días libres trabajados + bono + Santiago − préstamos + combustible
//     + reembolso de gastos.
//
// Diferencia con el Excel: una pregunta marcada "N/A" no cuenta (su peso se
// reparte entre las demás del renglón). En el Excel se ponía 0 y bajaba la nota.
//
// Todo se guarda en asa_config_sistema (no hace falta tocar la base):
//   incentivos_colaboradores  → [{ id, nombre, zona, cliente, sueldo, base, activo }]
//   evaluacion_AAAA-MM        → { colaborador_id: evaluación }
//   incentivo_AAAA-MM         → { colaborador_id: ajustes del mes }

import { supabase } from "./supabaseClient.js";

export const PLANTILLA = [
  { id: "I.1", titulo: "Conocimientos y habilidades técnicas", preguntas: [
    ["El empleado demuestra el conocimiento necesario para desempeñar su puesto.", 0.5],
    ["El empleado comprende el propósito de las tareas asignadas.", 0.25],
    ["El empleado desarrolla planes y estrategias adecuados considerando las necesidades de cada cliente.", 0.25],
  ] },
  { id: "I.2", titulo: "Utilización efectiva y desarrollo del personal", preguntas: [
    ["Asigna tareas de forma adecuada según la experiencia del personal.", 0.5],
    ["Promueve su capacitación mediante el trabajo y supervisa y evalúa correctamente el cumplimiento de los programas establecidos.", 0.5],
  ] },
  { id: "I.3", titulo: "Asistencia y puntualidad", preguntas: [
    ["Cumple con el horario laboral, evita ausencias injustificadas.", 0.6],
    ["Llega a tiempo tanto al trabajo como a los servicios asignados.", 0.4],
  ] },
  { id: "I.4", titulo: "Cumplimiento de procedimientos y seguridad", preguntas: [
    ["Utiliza correctamente el equipo de protección personal, sigue los protocolos de seguridad.", 0.5],
    ["Mantiene equipos y vehículos en buen estado y limpios.", 0.5],
  ] },
  { id: "I.5", titulo: "Calidad del trabajo", preguntas: [
    ["Realiza los servicios de forma adecuada según el plan.", 0.2],
    ["Mantiene buena actitud y trato hacia los clientes.", 0.2],
    ["Resuelve problemas que surgen durante las operaciones.", 0.2],
    ["Responde y está atento a las quejas del cliente.", 0.2],
    ["Identifica y resuelve situaciones.", 0.1],
    ["Eficiencia en el trabajo.", 0.1],
  ] },
  { id: "I.6", titulo: "Responsabilidad y organización", preguntas: [
    ["Usa los recursos de la empresa responsablemente.", 0.4],
    ["Cumple con la entrega de rutas e informes en tiempo.", 0.3],
    ["Demuestra iniciativa y compromiso con la organización.", 0.3],
  ] },
  { id: "I.7", titulo: "Trabajo en equipo y conducta", preguntas: [
    ["Colabora con compañeros y supervisores.", 0.4],
    ["Se comunica de manera clara y respetuosa.", 0.2],
    ["Mantiene buena conducta dentro y fuera del trabajo.", 0.2],
    ["Presenta habilidades para trabajar en equipo y apoyar a los demás.", 0.2],
  ] },
  { id: "I.8", titulo: "Actitud", preguntas: [
    ["Mantiene una actitud positiva y sabe escuchar sugerencias.", 0.3],
    ["Tiene habilidad para delegar y supervisar.", 0.4],
    ["Posee hábito de trabajo para cumplir con los requerimientos del cliente oportunamente.", 0.3],
  ] },
  { id: "II.1", titulo: "Características personales", preguntas: [
    ["Posee confianza en sí mismo y la proyecta de una manera aceptable.", 0.1],
    ["Se ocupa del cuidado y presentación personal (sin barba, uniformado, pelo recortado, etc.).", 0.5],
    ["Posee integridad y valores éticos.", 0.1],
    ["Mantiene la higiene en el alojamiento.", 0.2],
    ["Mantiene la independencia y ética profesional.", 0.1],
  ] },
].map((s) => ({ ...s, preguntas: s.preguntas.map(([texto, peso], i) => ({ id: `${s.id}.${String.fromCharCode(97 + i)}`, texto, peso })) }));

export const ESCALA = [
  { rango: "9-10", texto: "Cumplimiento de metas que va mucho más allá de las exigencias razonables de desempeño." },
  { rango: "7-8", texto: "Demuestra claramente el desempeño que se exige para cumplir con los requerimientos del puesto." },
  { rango: "4-5-6", texto: "Completa la mayoría de sus tareas, pero necesita mejorar en algunos aspectos." },
  { rango: "1-2-3", texto: "Su trabajo en calidad y cantidad está obviamente por debajo de lo requerido." },
];

// Columnas de la hoja "Resultado" que se llenan a mano cada mes.
// signo -1: se escribe el monto en positivo y se resta.
export const AJUSTES = [
  { campo: "dias_no_trabajados", nombre: "Descuentos días no trabajados", signo: -1 },
  { campo: "trabajos_adicionales", nombre: "Trabajos adicionales", signo: 1 },
  { campo: "dias_libres", nombre: "Días libres trabajados", signo: 1 },
  { campo: "bono", nombre: "Bono", signo: 1 },
  { campo: "santiago", nombre: "Santiago", signo: 1 },
  { campo: "prestamos", nombre: "Descuento préstamos", signo: -1 },
  { campo: "combustible", nombre: "Combustible", signo: 1 },
  { campo: "reembolso", nombre: "Reembolso de gastos", signo: 1 },
];

// Lista inicial: la hoja "Resultado" de septiembre 2026 (se edita en el panel)
const INICIALES = [
  ["Wilmen Encarnación Terrero", "Santo Domingo", "", 22000],
  ["Jeikin Perez", "Santo Domingo", "", 18000],
  ["Manuel Starling Encarnacion", "Santo Domingo", "", 18000],
  ["Hidelson Montilla", "Bavaro", "Lopesan", 22000, 18000],
  ["Luciano Flores Lopez", "Bavaro", "Lopesan", 18000],
  ["Jose Almando Perez", "Romana", "Casa de Campo", 22000],
  ["Romiro Castro", "Romana", "Casa de Campo", 18000],
  ["Andy Cali Antonio", "Romana", "Catalonia Bayahibe", 18000],
  ["Elvin Bismal Valenzuela Mendez", "Bavaro", "Iberostar", 18000],
  ["Wander Encarnación Terrero", "Bavaro", "Iberostar", 60000],
  ["Deidy Montas Rosso", "Bavaro", "Catalonia Bavaro", 20000],
  ["Walter Vargas De La Paz", "Bavaro", "Lopesan", 18000],
  ["Yeiquin Baez Acevedo", "Bavaro", "Iberostar", 18000],
  ["Rafa Antonio Franco", "Juan Dolio", "Garden/Emotions", 18000],
  ["Jose Alexander Santos Suero", "Puerto Plata", "Emotions", 18000],
  ["Fleuri Alexander Rosario Gonzalez", "Puerto Plata", "Emotions", 18000],
  ["Samuel Starling Gabriel Florimon", "Romana", "Iberostar Hacienda", 18000],
  ["Augusto Gabriel Rosado Sanchez", "Bavaro", "Catalonia Bavaro", 20000],
  ["Yaison Lemos Sanchez", "Bavaro", "Lopesan", 18000],
  ["Hector Rafael Santana Guerrero", "Bavaro", "Iberostar", 18000],
  ["Danilson Valdez", "Bavaro", "Catalonia Bavaro", 18000],
  ["Carlos Manuel de la Rosa Adon", "Bavaro", "Iberostar", 18000],
  ["Saury Mercedes", "Romana", "Iberostar Hacienda", 18000],
  ["Wilman Javier Valdez", "Bavaro", "Lopesan", 18000],
  ["Eduard Cristobal Paniagua", "Bavaro", "Lopesan", 18000],
  ["Flaudy Garcia Suero", "Bavaro", "Iberostar", 18000],
  ["Yoel Reyes", "Santo Domingo", "", 50000],
  ["Matlin Sabino", "Bavaro", "Iberostar", 20000],
  ["Deyvi Michel Herra", "Romana", "Catalonia Bayahibe", 18000],
  ["Victor Omar Donastorg De Los Santos", "Romana", "Casa de Campo", 20000],
].map(([nombre, zona, cliente, sueldo, base], i) => ({
  id: `col-${String(i + 1).padStart(2, "0")}`, nombre, zona, cliente, sueldo, base: base ?? null, posicion: "Técnico", activo: true,
}));

// ── Lectura / escritura en asa_config_sistema ───────────────────────────────
export async function leer(clave, defecto) {
  const { data, error } = await supabase.from("asa_config_sistema").select("valor").eq("clave", clave).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.valor ?? defecto;
}
export async function escribir(clave, valor) {
  const { error } = await supabase.from("asa_config_sistema")
    .upsert([{ clave, valor, updated_at: new Date().toISOString() }], { onConflict: "clave" });
  if (error) throw new Error(error.message);
  return valor;
}

// Parámetros de la evaluación (renglones, preguntas y ponderaciones). ASA los
// puede cambiar en el panel; si nunca se cambiaron, son los del formulario.
export async function plantilla() {
  const v = await leer("evaluacion_plantilla", null);
  return Array.isArray(v) && v.length ? v : PLANTILLA;
}

export function limpiarPlantilla(secciones) {
  if (!Array.isArray(secciones)) throw new Error("Parámetros inválidos");
  const ids = new Set();
  const salida = secciones.map((s, i) => {
    const id = String(s.id || "").trim() || `S${i + 1}`;
    if (ids.has(id)) throw new Error(`El código ${id} está repetido`);
    ids.add(id);
    const preguntas = (s.preguntas || []).filter((p) => String(p.texto || "").trim()).map((p, j) => {
      let pid = String(p.id || "").trim() || `${id}.${Date.now().toString(36)}${j}`;
      while (ids.has(pid)) pid += "x";
      ids.add(pid);
      const peso = Number(p.peso);
      if (!(peso > 0)) throw new Error(`Ponderación inválida en "${String(p.texto).slice(0, 40)}"`);
      return { id: pid, texto: String(p.texto).trim(), peso };
    });
    if (!String(s.titulo || "").trim()) throw new Error(`Falta el nombre del renglón ${id}`);
    if (!preguntas.length) throw new Error(`El renglón "${s.titulo}" no tiene preguntas`);
    return { id, titulo: String(s.titulo).trim(), preguntas };
  });
  if (!salida.length) throw new Error("Debe haber al menos un renglón");
  return salida;
}

export async function colaboradores() {
  const v = await leer("incentivos_colaboradores", null);
  return Array.isArray(v) ? v : INICIALES;
}

export const mesValido = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ""));

// ── Cálculos ────────────────────────────────────────────────────────────────
const num = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? 0 : Number(v));
const r2 = (n) => Math.round(n * 100) / 100;

/** calificaciones: { "I.1.a": 9, "I.4.a": "NA", … } → { renglones, porcentaje, completa } */
export function calcularEvaluacion(calificaciones = {}, secciones = PLANTILLA) {
  let faltan = 0;
  const renglones = secciones.map((s) => {
    let suma = 0, pesos = 0;
    for (const p of s.preguntas) {
      const v = calificaciones[p.id];
      if (v === "NA") continue;
      if (v === "" || v == null) { faltan++; continue; }
      suma += Math.min(10, Math.max(0, Number(v))) * p.peso;
      pesos += p.peso;
    }
    return { id: s.id, titulo: s.titulo, puntaje: pesos ? r2(suma / pesos) : null };
  });
  const validos = renglones.filter((r) => r.puntaje != null);
  const porcentaje = validos.length ? r2((validos.reduce((a, r) => a + r.puntaje, 0) / validos.length) * 10) : 0;
  return { renglones, porcentaje, completa: faltan === 0 };
}

export function filaIncentivo(col, evaluacion, ajustes = {}) {
  const sueldo = num(col.sueldo);
  const quincena = col.base != null && col.base !== "" ? num(col.base) : sueldo * 0.5;
  const desdeEval = evaluacion?.porcentaje != null;
  const porcentaje = desdeEval ? Number(evaluacion.porcentaje)
    : ajustes.porcentaje_manual !== "" && ajustes.porcentaje_manual != null ? num(ajustes.porcentaje_manual) : null;
  const resultado = r2(quincena * (porcentaje || 0) / 100);
  const fila = { colaborador_id: col.id, nombre: col.nombre, zona: col.zona || "", cliente: col.cliente || "", sueldo, quincena,
    porcentaje, origen_porcentaje: desdeEval ? "evaluacion" : porcentaje != null ? "manual" : "sin_evaluar", resultado, notas: ajustes.notas || "" };
  let total = resultado;
  for (const a of AJUSTES) { fila[a.campo] = num(ajustes[a.campo]); total += a.signo * fila[a.campo]; }
  fila.total = r2(total);
  return fila;
}

/** Fecha de pago: día 5 del mes siguiente al evaluado */
export function fechaPago(mes) {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(m === 12 ? a + 1 : a, m === 12 ? 0 : m, 5));
}
export const ultimoDia = (mes) => { const [a, m] = mes.split("-").map(Number); return new Date(Date.UTC(a, m, 0)); };
