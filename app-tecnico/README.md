# App del técnico — Ambiente y Salud RD (ASA SRL)

PWA instalable para que los técnicos hagan sus inspecciones diarias en los
hoteles. No hay tiendas de apps de por medio: el técnico abre un enlace, le da
a "Agregar a pantalla de inicio" y queda como una app más en el teléfono.
Cuando publicas una versión nueva, la tienen al abrirla — no hay que
reinstalar nada.

## Qué hace

**Escanear un punto.** El QR contiene la URL del punto, así que sirven las dos
vías: el botón de escanear dentro de la app, o la cámara normal del teléfono
apuntando a la calcomanía. En los dos casos se abre la ficha con su checklist.

**Buscar por nombre.** Cuando la calcomanía está despegada, rayada o
sencillamente no lee, el técnico busca por código, nombre del punto o número
de habitación. Nunca se queda trancado frente a un QR roto.

**Checklist según el punto.** Las preguntas salen de la estrategia del cliente
y del tipo de dispositivo: un cebadero pregunta consumo de cebo y capturas;
una lámpara, el estado del tubo y el conteo. Se configuran desde el panel, sin
tocar código.

**Funciona sin señal.** La ruta del día se guarda en el teléfono. Si no hay
cobertura —sótanos, cuartos de máquinas, áreas verdes— la inspección se
encola en el teléfono y se envía sola al recuperar conexión. La app avisa
cuántas quedan por enviar y el técnico puede forzar el envío tocando el aviso.

**Plano.** Si el hotel tiene planos cargados, el técnico ve dónde queda el
punto que no conoce, con el pin resaltado.

## Publicar

Es estático, sin build step — igual que `panel-web/`.

1. Abre `config.js` y pon la URL real de Railway en `API_BASE`.
2. En Vercel: **Add New → Project**, importa el repo.
   - Root Directory: `app-tecnico`
   - Framework Preset: Other
   - Build Command: vacío
   - Output Directory: `.`
3. Agrega la URL que te dé Vercel a `CORS_ORIGINS` en Railway.
4. En Railway, pon `APP_TECNICO_URL` con esa misma URL. **Esto importa**: es la
   URL que se codifica en los QR nuevos que generes. Si la cambias después,
   los QR ya impresos dejan de abrir la app.

Hace falta **HTTPS** para que funcionen la cámara y la instalación como app.
Vercel lo da automáticamente; en local usa `localhost`, que el navegador
también acepta.

## Instalar en el teléfono del técnico

- **Android / Chrome**: abrir el enlace → menú ⋮ → "Instalar aplicación".
- **iPhone / Safari**: abrir el enlace → compartir → "Agregar a inicio".

El escáner integrado usa la cámara: en Android va por `BarcodeDetector`, que
es nativo y muy rápido; en iPhone cae a un lector en JavaScript. En los dos
casos, la cámara del sistema también abre el punto directamente.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | Caparazón; todo se dibuja desde `app.js`. |
| `app.js` | Pantallas, escáner, checklist y cola offline. |
| `estilos.css` | Botones grandes y contraste alto: se usa con guantes. |
| `config.js` | `API_BASE` por entorno. Es lo único que se edita al desplegar. |
| `sw.js` | Service worker: guarda el caparazón para abrir sin señal. |
| `manifest.json` | Nombre, iconos y accesos directos de la app instalada. |
