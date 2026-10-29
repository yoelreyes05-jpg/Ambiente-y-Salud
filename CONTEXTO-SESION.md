# Contexto para continuar el trabajo (Ambiente y Salud RD — ASA SRL)

Copia este texto completo al iniciar una sesión nueva. Resume cómo trabajamos,
cómo está montado el sistema y qué quedó hecho y pendiente hasta el 29/10/2026.

---

## 1. Cómo trabajamos (reglas que debes seguir)

- **Idioma:** todo en español. El usuario trabaja mayormente desde el celular.
- **Cada cambio se sube al sistema:** commit en la rama `claude/verificacion-ahora-9slgm1`
  y luego también a `main`:
  `git push -u origin claude/verificacion-ahora-9slgm1 && git push origin HEAD:main`
  (antes hacer `git fetch origin main` y revisar que no haya nada nuevo en main).
- **No crear Pull Requests.** No poner nombres de modelo en los commits.
- **Antes de subir:** probar (node --check, pruebas con base simulada, capturas con
  Playwright). Mandar capturas o muestras al usuario cuando el cambio sea visual.
- **Si pide "muestra" o "genéralo cuando te diga":** primero una vista previa (imagen),
  y no tocar el sistema hasta que lo autorice.
- **SQL para Supabase:** dar líneas cortas para pegar en el SQL Editor desde el celular,
  y recordar: "si al pegarlo queda un ')' suelto al final, bórralo".
- **Evitar columnas nuevas en Supabase cuando se pueda:** Supabase tardó en reconocer
  una columna nueva (caché de esquema). Se usa la tabla `asa_config_sistema`
  (clave → valor JSON) para guardar configuraciones nuevas.
- **Despliegues:** si un cambio del servidor no aparece, subir la versión en
  `backend/package.json` y hacer push; el usuario comprueba en
  https://ambiente-y-salud-production.up.railway.app que `version` sea la nueva.

## 2. Cómo está montado

- **Repositorio:** `yoelreyes05-jpg/Ambiente-y-Salud` (GitHub).
- **Servidor (API):** `backend/` — Node/Express + Supabase, desplegado en **Railway**
  (`ambiente-y-salud-production.up.railway.app`). Railway compila con Node 18/24
  (nixpacks). Versión actual: **2.4.1**. La raíz `/` muestra la versión.
- **Base de datos:** Supabase (tablas con prefijo `asa_`). Migraciones en `supabase/`.
- **Páginas (Vercel, dominio asa.solidpest.online):**
  - `/admin` → `panel-web/` (panel de ASA)
  - `/hotel` → `portal-hotel/` (portal del hotel / cliente)
  - `/tecnico` → `app-tecnico/` (app PWA del técnico, con service worker `sw.js`)
  - Solo se publica `main` (la rama de trabajo tiene `deploymentEnabled: false`).
  - Los `.js/.css` del panel y portal llevan `?v=AAAAMMDDx` en `index.html` para que
    el navegador no use copias viejas: cambiar ese valor cuando haya cambios.
  - App del técnico: subir `VERSION` en `sw.js` y `VERSION_APP` en `rastreo.js`.
- **Pruebas locales:** importar las rutas del backend con un `supabase.from` simulado
  (variables `SUPABASE_URL`, `SUPABASE_KEY` (JWT con role service_role), `JWT_SECRET=x`);
  Playwright en `/opt/node-tools/node_modules/playwright`, Chromium en `/opt/pw-browsers`.
  La red de la sesión NO llega a Railway, Vercel ni asa.solidpest.online.

## 3. Lo que se hizo en esta etapa (ya subido)

### Portal del hotel
- **Historial** reúne todo con una sola barra de filtros (Área, Desde, Hasta, botones
  7/30/90 días y 1 año): última fumigación del área con evidencias e "Imprimir con
  evidencias", próximo programado, plagas encontradas (tocar una plaga muestra dónde se
  encontró), servicios del período por día, "Imprimir lo que se ve", reporte de auditoría
  PDF y reporte de no realizados con esas fechas. (Archivo `portal-hotel/areas.js`.)
- **Cucarachas como una sola plaga:** alemana, americana, etc. suman como "Cucarachas"
  en reportes, estadísticas y fichas (`backend/lib/plagasUnificadas.js`).
- **Cronograma** (`portal-hotel/cronograma.js`): vistas Año / Mes / Semana / Fechas;
  sin el texto "MANEJO INTEGRADO DE PLAGAS"; mes por Semana 1-5; tocar semana abre el
  calendario; en Fechas, cada día muestra lo registrado por el técnico con enlace a
  Historial; imprimir en cada vista.
- **Programa anual oficial del Iberostar JOIA 2026:** copiado tal cual del PDF del
  usuario (38 áreas × 52 semanas, productos, métodos, plagas). Está en
  `backend/assets/programas/iberostar-joia-2026.json` y una copia en
  `portal-hotel/programas/` (el portal lo usa aunque el servidor no lo tenga). En el JOIA
  el cronograma abre en "Año" y muestra este programa; el texto solo dice
  "Programa anual 2026". Imprime en una hoja horizontal. (El original trae "Marzo" dos
  veces y el número 28 repetido; se dejó igual.)
- **Documentos:** títulos en mayúscula (PERMISOS Y LICENCIAS, MANUALES Y PROTOCOLOS,
  LISTADO DE PRODUCTOS, FICHAS TÉCNICAS Y HOJAS DE SEGURIDAD, OTROS DOCUMENTOS).
  Por producto: ficha técnica y debajo su hoja de seguridad; lo que no se ha subido no se
  menciona. Se agrupan por tipo de plaga solo si el usuario lo escogió a mano.

### Panel de ASA
- **Documentos:** "Subir varios archivos" (en Permisos y en Productos): detecta tipo y
  producto por el nombre del archivo (`FICHA_TECNICA_FENDONA.pdf` → Ficha técnica de
  Fendona; crea el producto si no existe). `backend/lib/productoDeArchivo.js`.
- **Grupo de plaga por producto:** selector en la tabla de productos (Sin grupo,
  Insectos rastreros, Insectos voladores, Rastreros y voladores, Roedores, Otros). Solo
  cuenta lo escogido a mano (se quitó la deducción automática). Se guarda en
  `asa_config_sistema`, clave `grupos_plaga_productos` (no depende de la columna
  `grupo_plaga`).
- **Cotejo de fumigación** (lo último):
  - Panel → Estrategias: interruptor **"En el cotejo"** por estrategia (clave
    `estrategias_cotejo` en `asa_config_sistema`). Ruta `PUT /estrategias/:id/cotejo`.
  - App del técnico: botón **"☑️ Cotejo de fumigación"** en la ruta (`app-tecnico/cotejo.js`):
    lista de puntos cuya estrategia está en el cotejo (Office y carritos, Registros…),
    agrupados por estrategia y área, filtros, "Marcar todos", casilla por punto,
    "¿Plaga?" con plaga y cantidad, guardar todos; sin señal va a la cola.
  - Servidor: `GET /puntos/cotejo?sitio_id=` y `POST /inspecciones` con `cotejo: true`:
    contesta solas las preguntas de la estrategia (sin incidencia, o con la plaga), pone
    nivel de actividad y estado "Con actividad" si hubo plaga (`backend/lib/cotejo.js`).

### Mapas (cartografía, trabajo en archivos aparte, no en el sistema)
- Mapa del Iberostar Dominicano en PDF con fondo OpenStreetMap (imagen del usuario,
  ubicada por rotondas, error ~2-3 m), sin perímetro, 118 puntos (73 cebaderos,
  45 registros), sin los 10 registros del lado del Iberostar Bávaro. Se le dio al
  usuario el paso a paso para recrearlo en QGIS (en inglés) y un zip con
  puntos (.geojson), estilo (.qml) y fondo (.tif). Error "could not compute
  geotransform" en QGIS: revisar rotación del mapa = 0, Reference map, CRS EPSG:32619,
  o exportar sin GeoPDF.

## 4. Pendiente / por confirmar

1. **Railway debe estar en 2.4.1** (o mayor). Con versión vieja, el interruptor
   "En el cotejo" da error 404 y el cotejo del técnico no funciona.
2. En el panel → Estrategias, poner en **Sí** "Office y carritos" y "Registros", y probar
   el cotejo en la app con un técnico (cerrar y abrir la app para cargar la versión nueva).
3. Confirmar que el grupo de plaga de los productos ya se guarda ("Grupo guardado ✓").
4. Vercel: revisar que publique los cambios (antes pareció detenerse; posible límite
   diario de despliegues).
5. Supabase (opcional, ya no imprescindible):
   `update asa_plagas set nombre = 'Cucarachas' where codigo = 'cucaracha_alemana';`
   `update asa_plagas set activo = false where codigo like 'cucaracha%' and codigo <> 'cucaracha_alemana';`
   (para que el técnico vea un solo contador de cucarachas).
6. Programas anuales de otras plantas: cuando el usuario mande el PDF, crear
   `iberostar-xxx-2026.json` en `backend/assets/programas/` y en `portal-hotel/programas/`
   (con su entrada en `indice.json`).
7. Mapas de los demás hoteles con el mismo modelo (imagen OSM + puntos), cuando el
   usuario envíe la imagen y el archivo de puntos de cada uno.
