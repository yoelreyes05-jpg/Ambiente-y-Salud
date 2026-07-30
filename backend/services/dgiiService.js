// services/dgiiService.js
// Consulta RNC/Cedula contra la DGII, con cache en memoria (24h) y
// persistencia en la tabla PROPIA de ASA: asa_rnc_cache (aislada del resto
// de sistemas que comparten esta base de datos — ver 00_README.md).
import axios from "axios";
import { supabase } from "../lib/supabaseClient.js";

const cacheMemoria = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function obtenerDeMemoria(rnc) {
  const entrada = cacheMemoria.get(rnc);
  if (!entrada) return null;
  if (Date.now() - entrada.timestamp > CACHE_TTL_MS) {
    cacheMemoria.delete(rnc);
    return null;
  }
  return entrada.data;
}
function guardarEnMemoria(rnc, data) {
  cacheMemoria.set(rnc, { data, timestamp: Date.now() });
}

function validarFormatoRNC(rnc) {
  const limpio = String(rnc).replace(/[-\s]/g, "");
  if (!/^\d{9}$/.test(limpio) && !/^\d{11}$/.test(limpio)) {
    return { valido: false, limpio, mensaje: "El RNC debe tener 9 dígitos o la cédula 11 dígitos" };
  }
  return { valido: true, limpio };
}

async function guardarEnTablaAsa(resultado) {
  try {
    await supabase.from("asa_rnc_cache").upsert(
      {
        rnc: resultado.rnc,
        razon_social: resultado.razonSocial,
        nombre_comercial: resultado.nombreComercial,
        actividad: resultado.actividad,
        estado: resultado.estado,
        tipo: resultado.tipo,
        fuente: resultado.fuente,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "rnc" }
    );
  } catch (e) {
    console.warn("[ASA][asa_rnc_cache] no se pudo guardar:", e.message);
  }
}

export async function consultarRNC(rnc) {
  const { valido, limpio, mensaje } = validarFormatoRNC(rnc);
  if (!valido) throw { codigo: 400, mensaje };

  const enMemoria = obtenerDeMemoria(limpio);
  if (enMemoria) return { ...enMemoria, fuente: "cache" };

  // Cache persistente propio de ASA (evita llamadas repetidas entre reinicios)
  const { data: enTabla } = await supabase.from("asa_rnc_cache").select("*").eq("rnc", limpio).maybeSingle();
  if (enTabla) {
    const resultado = {
      rnc: enTabla.rnc,
      razonSocial: enTabla.razon_social,
      nombreComercial: enTabla.nombre_comercial,
      estado: enTabla.estado,
      actividad: enTabla.actividad,
      tipo: enTabla.tipo,
      fuente: "asa_rnc_cache",
    };
    guardarEnMemoria(limpio, resultado);
    return resultado;
  }

  try {
    const respuesta = await axios.get(`https://api-dgii.dominicantechnology.com/api/v1/rnc/${limpio}`, {
      timeout: 8000,
      headers: { Accept: "application/json", "User-Agent": "ASA-CRM/1.0" },
    });
    const datos = respuesta.data?.data || respuesta.data;
    const resultado = {
      rnc: limpio,
      razonSocial: datos.razon_social || datos.nombre || null,
      nombreComercial: datos.nombre_comercial || null,
      estado: datos.estado || null,
      actividad: datos.actividad_economica || null,
      tipo: limpio.length === 11 ? "CEDULA" : "RNC",
      fuente: "dgii",
    };
    guardarEnMemoria(limpio, resultado);
    await guardarEnTablaAsa(resultado);
    return resultado;
  } catch (error) {
    if (error.response?.status === 404) {
      throw { codigo: 404, mensaje: `El RNC/Cédula ${limpio} no está registrado en la DGII` };
    }
    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
      return await consultarRNCFallback(limpio);
    }
    if (error.request) throw { codigo: 503, mensaje: "No se pudo conectar con el servicio de la DGII" };
    if (error.codigo) throw error;
    throw { codigo: 500, mensaje: "Error inesperado consultando la DGII" };
  }
}

async function consultarRNCFallback(limpio) {
  try {
    const respuesta = await axios.get(`https://rnc.megaplus.com.do/api/rnc/${limpio}`, {
      timeout: 8000,
      headers: { Accept: "application/json" },
    });
    const datos = respuesta.data;
    if (datos.error) throw { codigo: 404, mensaje: `El RNC/Cédula ${limpio} no está registrado en la DGII` };
    const resultado = {
      rnc: limpio,
      razonSocial: datos.razon_social || null,
      nombreComercial: datos.nombre_comercial || null,
      estado: datos.estado || null,
      actividad: datos.actividad || null,
      tipo: limpio.length === 11 ? "CEDULA" : "RNC",
      fuente: "megaplus-fallback",
    };
    guardarEnMemoria(limpio, resultado);
    await guardarEnTablaAsa(resultado);
    return resultado;
  } catch (error) {
    if (error.codigo) throw error;
    throw { codigo: 503, mensaje: "Todos los servicios de DGII no disponibles. Intente más tarde." };
  }
}
