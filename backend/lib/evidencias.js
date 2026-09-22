// lib/evidencias.js — Las fotos del tecnico van a Supabase Storage, no a la tabla
//
// La app del tecnico manda las fotos como data URL en base64 (asi puede
// guardarlas en el celular y mandarlas cuando recupere senal). Guardarlas tal
// cual dentro de asa_inspecciones.fotos era comodo y es una bomba de tiempo:
// cinco fotos de ~150KB por punto, por dia, en base64 (que pesa 33% mas) hacen
// que cada consulta que toque la tabla de inspecciones arrastre megas. Con 600
// puntos en una planta son gigas en meses, y el historial de inspecciones se
// vuelve imposible de consultar.
//
// Aqui se sube cada foto al bucket y en la tabla queda la URL. Lo que ya estaba
// guardado en base64 sigue funcionando: el reporte y el panel aceptan las dos
// formas (ver `esDataUrl`), asi que no hace falta migrar nada de golpe.
import { supabase } from "./supabaseClient.js";

export const BUCKET_EVIDENCIAS = "asa-evidencias";

const EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const esDataUrl = (v) => typeof v === "string" && v.startsWith("data:");

let bucketListo = false;
async function asegurarBucket() {
  if (bucketListo) return;
  const { data } = await supabase.storage.getBucket(BUCKET_EVIDENCIAS);
  if (!data) {
    await supabase.storage.createBucket(BUCKET_EVIDENCIAS, {
      public: true,
      fileSizeLimit: 8 * 1024 * 1024,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    });
  }
  bucketListo = true;
}

// Sube una foto en data URL y devuelve su URL publica.
// Si algo falla, devuelve null y el llamador decide: nunca tira la foto.
async function subirUna(dataUrl, carpeta) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const ext = EXT[mime];
  if (!ext) return null;

  const buffer = Buffer.from(m[2], "base64");
  if (!buffer.length) return null;

  const nombre = `${carpeta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET_EVIDENCIAS)
    .upload(nombre, buffer, { contentType: mime, upsert: false });
  if (error) {
    console.warn("[evidencias] no se pudo subir la foto:", error.message);
    return null;
  }
  const { data } = supabase.storage.from(BUCKET_EVIDENCIAS).getPublicUrl(nombre);
  return data?.publicUrl || null;
}

// Recibe la lista de fotos como viene de la app (data URLs, URLs ya subidas, o
// mezcla) y devuelve la lista con todo convertido a URL.
//
// Si la subida falla se CONSERVA el base64 en su lugar: perder la evidencia
// fotografica de una inspeccion por un problema de red del servidor seria peor
// que tener una fila pesada. Se reintenta en la siguiente edicion.
export async function guardarFotos(fotos, carpeta = "inspecciones") {
  if (!Array.isArray(fotos) || !fotos.length) return fotos || [];
  const hayBase64 = fotos.some(esDataUrl);
  if (!hayBase64) return fotos;

  await asegurarBucket();
  return Promise.all(
    fotos.map(async (f) => {
      if (!esDataUrl(f)) return f;
      return (await subirUna(f, carpeta)) || f;
    })
  );
}
