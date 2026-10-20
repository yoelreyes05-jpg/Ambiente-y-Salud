// lib/tanqueos.js — Qué pasó entre un tanqueo y el siguiente
//
// Para cada carga de combustible de una unidad dice cuánto recorrió y cuántos
// días pasaron desde la carga anterior, y cuánto costó cada km. El km/galón
// se calcula de tanque lleno a tanque lleno (sumando las cargas parciales del
// medio), que es lo único honesto: con una carga parcial no se sabe cuánto
// combustible se gastó.
//
// "Consumió más" = su km/galón quedó 10% o más por debajo del promedio de la
// unidad (o, si no hay km/galón, su costo por km 10% o más por encima).

const DIA = 86400000;
const r2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

function diasEntre(a, b) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DIA);
}

/**
 * @param gastos gastos de UNA unidad (cualquier tipo; se usan los de COMBUSTIBLE)
 * @returns { cargas: [...] del más viejo al más nuevo, promedio: {...}, peor: carga|null }
 */
export function analizarTanqueos(gastos) {
  const cargas = (gastos || [])
    .filter((g) => g.tipo === "COMBUSTIBLE")
    .map((g) => ({ ...g, km: num(g.km), galones: num(g.galones), monto: num(g.monto) || 0, fecha: String(g.fecha).slice(0, 10) }))
    // Por fecha; el mismo día, por km y luego por el que se registró primero
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.km ?? 0) - (b.km ?? 0) || Number(a.id) - Number(b.id));

  const filas = [];
  let ultimaLlena = null;      // índice de la última carga con tanque lleno y km
  let galonesDesdeLlena = 0;   // galones cargados después de esa carga llena
  for (let i = 0; i < cargas.length; i++) {
    const c = cargas[i];
    const ant = i > 0 ? cargas[i - 1] : null;
    const f = {
      id: c.id, fecha: c.fecha, km: c.km, galones: c.galones, monto: r2(c.monto),
      precio_galon: num(c.precio_galon), tanque_lleno: c.tanque_lleno !== false,
      anterior: ant ? { id: ant.id, fecha: ant.fecha, km: ant.km } : null,
      km_recorridos: null, dias: null, km_dia: null, costo_km: null, costo_dia: null,
      km_galon: null, km_galon_tramo: null, galones_tramo: null,
    };
    if (ant) {
      f.dias = diasEntre(ant.fecha, c.fecha);
      if (c.km != null && ant.km != null && c.km > ant.km) {
        f.km_recorridos = r2(c.km - ant.km);
        if (f.monto > 0) f.costo_km = r2(f.monto / f.km_recorridos);
        if (f.dias > 0) f.km_dia = r2(f.km_recorridos / f.dias);
      }
      if (f.dias > 0 && f.monto > 0) f.costo_dia = r2(f.monto / f.dias);
    }
    // km/galón de lleno a lleno
    if (c.galones > 0) galonesDesdeLlena += c.galones;
    if (f.tanque_lleno && c.km != null) {
      if (ultimaLlena !== null) {
        const dkm = c.km - cargas[ultimaLlena].km;
        if (dkm > 0 && galonesDesdeLlena > 0) {
          f.km_galon = r2(dkm / galonesDesdeLlena);
          f.km_galon_tramo = r2(dkm);
          f.galones_tramo = r2(galonesDesdeLlena);
        }
      }
      ultimaLlena = i;
      galonesDesdeLlena = 0;
    }
    filas.push(f);
  }

  const prom = (xs) => (xs.length ? r2(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const promedio = {
    km_galon: prom(filas.map((f) => f.km_galon).filter((x) => x != null)),
    costo_km: prom(filas.map((f) => f.costo_km).filter((x) => x != null)),
    km_dia: prom(filas.map((f) => f.km_dia).filter((x) => x != null)),
    dias: prom(filas.map((f) => f.dias).filter((x) => x != null && x > 0)),
    km_recorridos: prom(filas.map((f) => f.km_recorridos).filter((x) => x != null)),
    monto: prom(filas.map((f) => f.monto).filter((x) => x > 0)),
  };

  for (const f of filas) {
    f.vs_promedio = null; f.consumio_mas = false;
    if (f.km_galon != null && promedio.km_galon) {
      f.vs_promedio = { medida: "km_galon", pct: r2(((f.km_galon - promedio.km_galon) / promedio.km_galon) * 100) };
      f.consumio_mas = f.km_galon <= promedio.km_galon * 0.9;
    } else if (f.costo_km != null && promedio.costo_km) {
      f.vs_promedio = { medida: "costo_km", pct: r2(((f.costo_km - promedio.costo_km) / promedio.costo_km) * 100) };
      f.consumio_mas = f.costo_km >= promedio.costo_km * 1.1;
    }
  }

  // La de más consumo: peor km/galón; si ninguna tiene, la de mayor costo por km
  const conKmGal = filas.filter((f) => f.km_galon != null);
  const conCosto = filas.filter((f) => f.costo_km != null);
  const peor = conKmGal.length > 1 ? conKmGal.reduce((a, b) => (b.km_galon < a.km_galon ? b : a))
    : conCosto.length > 1 ? conCosto.reduce((a, b) => (b.costo_km > a.costo_km ? b : a)) : null;

  return { cargas: filas, promedio, peor_id: peor?.id ?? null };
}
