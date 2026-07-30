// routes/rnc.js — Validación de empresas/personas por RNC ante la DGII
// Usa services/dgiiService.js con caché propio en asa_rnc_cache (aislado).
import express from "express";
import { consultarRNC } from "../services/dgiiService.js";

const router = express.Router();

// GET /rnc/:rnc — ej. GET /rnc/130263241
router.get("/:rnc", async (req, res) => {
  try {
    const datos = await consultarRNC(req.params.rnc);
    res.json({ error: false, datos });
  } catch (err) {
    res.status(err.codigo || 500).json({ error: true, mensaje: err.mensaje || "Error consultando RNC" });
  }
});

export default router;
