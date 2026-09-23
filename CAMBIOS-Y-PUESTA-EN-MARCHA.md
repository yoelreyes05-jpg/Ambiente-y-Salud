# Cambios de esta tanda y cómo ponerlos a andar

Todo está en el repo, sin commitear. Orden recomendado: **base de datos →
backend → paneles**. Nada de abajo rompe lo que ya funcionaba.

---

## 1. Base de datos (primero, siempre)

En el SQL editor del proyecto de Supabase **de ASA** (`qjzn…`), en este orden:

| Archivo | Qué hace | Obligatorio para |
|---|---|---|
| `supabase/25_servicios_evidencia_config.sql` | Motivo de "no realizado", planos en PDF con coordenadas, datos de la empresa, permisos por rol, vista `asa_v_servicios_dia`, `updated_at` en estrategias | Pestaña de no realizados, mapa con GPS, configuración, auditoría |
| `supabase/26_flota_transportacion.sql` | Las 12 tablas de la flota, sus 3 vistas, el bucket de fotos y los catálogos (25 puntos de checklist, 43 fallas) | Módulo de Flota |

Los dos son idempotentes: se pueden correr de nuevo sin romper nada. Los dos
se probaron contra un PostgreSQL 16 real antes de entregarlos, con datos de
prueba, incluidas las restricciones (un recuadro de coordenadas a medias se
rechaza, un motivo inventado se rechaza).

### Traer los datos de la flota que ya están en el CRM

Hay **dos caminos**, y hacen exactamente lo mismo. Elige uno:

#### A. Por Excel (recomendado si no quieres mover claves)

1. En el CRM del taller: **ASA → Configuración → Exportar → Descargar la flota
   en Excel**. Sale un `.xlsx` con una hoja por tabla.
2. En Ambiente y Salud: **Flota → Configuración → Traer la flota desde el CRM**.
   Subes el archivo y le das primero a **Probar sin escribir**: no toca nada y
   te dice cuántas filas entrarían en cada hoja. Si cuadra, **Importar de verdad**.

Ventaja: el archivo queda como respaldo legible y no hay que poner la clave del
Supabase del CRM dentro de este backend. Se puede repetir: subir el mismo
archivo dos veces actualiza, no duplica.

> No cambies los nombres de las hojas ni la primera fila del archivo: el
> importador busca por esos nombres.

#### B. Directo de base a base (script)

La flota vive hoy en el Supabase del CRM del taller. Para copiarla:

Más rápido para volúmenes grandes, pero exige tener a mano la clave de
servidor del Supabase del CRM.

```bash
# 1. En backend/.env agrega las credenciales del proyecto DE ORIGEN:
CRM_SUPABASE_URL=https://axzdtgcouczgdxjopikn.supabase.co
CRM_SUPABASE_KEY=<service key del proyecto del CRM>

# 2. Primero en seco: no escribe nada, solo cuenta lo que traería
cd backend && node scripts/copiar-flota-desde-crm.mjs --simular

# 3. Si los números cuadran, de verdad
node scripts/copiar-flota-desde-crm.mjs
```

Se puede correr dos veces: reconcilia por código de vehículo, cédula del
conductor y vehículo+fecha+turno del parte, así que actualiza en vez de
duplicar. **Las fotos no se copian como archivos**, solo sus URLs: siguen
sirviéndose desde el bucket del CRM. Si algún día apagas ese proyecto, se caen
— queda dicho aquí a propósito para que sea decisión y no sorpresa.

---

## 2. Backend

Dependencia nueva: `pdfkit` (ya está en `package.json` e instalada).

```bash
cd backend && npm install && npm start
```

Rutas nuevas:

```
GET  /inspecciones/dia?sitio_id=&fecha=&tipo=     todos los servicios del día
GET  /inspecciones/:id/desglose                   el detalle completo de uno
GET  /reportes/evidencia?...                      los datos del reporte en JSON
GET  /reportes/pdf?...                            el PDF de auditoría
GET  /plagas/catalogo                             catálogo de plagas (lo usa el técnico)
GET|PUT /config/:clave                            datos de la empresa y permisos
GET  /auditoria  ·  /auditoria/filtros  ·  /auditoria/resumen
GET  /flota/publico/*                             pantalla del conductor (sin token)
GET  /flota/*                                     el resto del módulo de flota
PATCH /sitios/planos/:id                          coordenadas de un plano
PATCH|DELETE /usuarios/:id  ·  /usuarios/portal/:id
POST /usuarios/portal/:id/password
PUT|PATCH|DELETE /estrategias/:id  ·  POST /estrategias/:id/duplicar
POST /flota/importar-excel                        carga el .xlsx del CRM
```

Y en el **CRM del taller** (`crm-backend`), una sola ruta nueva:

```
GET /asa/exportar-excel     baja la flota completa en un .xlsx
```

> Ese backend necesita `npm install exceljs` y un redespliegue en Railway: es la
> única dependencia nueva del lado del CRM.

> **Ojo con el orden de las rutas.** El bug de "modifico la estrategia y no
> guarda" era eso: `PUT /estrategias/preguntas/<id>` entraba por
> `PUT /estrategias/:id` con `id="preguntas"`, no encontraba nada y la edición
> se perdía sin dar error. Todo lo que tenga un segmento literal va **arriba**
> de la ruta con `:parametro`.

---

## 3. Paneles y apps

Solo hay que desplegarlos (Vercel). Archivos nuevos que deben subir:

- `panel-web/servicios.js`, `panel-web/configuracion.js`, `panel-web/flota.js`
- `app-tecnico/mapa.js`, `app-tecnico/chequeo.js`
- `index.html` de los dos ya los carga en el orden correcto

El service worker de la app del técnico subió a `asa-tecnico-v4`, así que los
teléfonos se actualizan solos al abrirla con señal.

---

## 4. Lo que hay que cargar a mano después

1. **Configuración → Mi empresa.** El RNC, la licencia sanitaria y el
   responsable técnico salen impresos en cada reporte de auditoría. Si están
   vacíos, el reporte sale con rayas donde el auditor espera números.
2. **Configuración → Permisos.** Vienen unos por defecto razonables; ajústalos
   antes de darle cuenta a alguien nuevo.
3. **Flota → Configuración → Conductores**, y después **Vehículos** (si no
   corriste el script de copia).
   > El campo **Km al entrar a la flota** es la línea base del costo por
   > kilómetro. Si la unidad ya venía usada, pon el odómetro del día que entró,
   > no cero. Puesto mal, el costo por km sale en centavos y el reporte no sirve.
4. **Mapa de cada planta.** Sube el PDF que exportas de QGIS. Si lo exportas
   marcando *«Crear GeoPDF»*, el sistema le lee las coordenadas solo; si no, se
   las escribes en el botón **Coordenadas**. Sin coordenadas el plano se ve y se
   agranda igual, pero el GPS no ubica al técnico encima.

---

## 5. Dos huecos que aparecieron al revisar, y quedaron tapados

**La app del técnico nunca registraba qué plaga ni cuántas.** La tabla
`asa_capturas` estaba vacía y no había forma de llenarla: el formulario solo
mandaba "nivel de actividad". Por eso el bloque de plagas del dashboard no
podía tener datos nunca, ni el reporte mostrar tendencia por plaga — que es lo
primero que pide una auditoría hotelera. Ahora el técnico cuenta a toques
(+/−, sin teclado) desde el catálogo de plagas.

**"No pude entrar" se guardaba sin motivo.** `estado_punto = 'no_accesible'`
existía desde el principio, pero no decía nada más. En auditoría la pregunta
nunca es "¿se hizo?", es "¿por qué no, y quién lo impidió?" — una habitación
con el huésped dentro y una que el hotel no autorizó son dos cosas distintas y
solo una es responsabilidad de ASA. Ahora el motivo es obligatorio, se guarda
con quién lo informó, abre un hallazgo solo con el responsable correcto, y sale
en rojo tanto en el panel como en el PDF.

**Y uno menor:** editar una pregunta del checklist destruía su regla. Las
preguntas sembradas con reglas como `{ mayor_que: 0, severidad: "alta" }` se
convertían en `{ igual: "sí" }` al guardarlas desde el panel, y dejaban de
abrir hallazgos sin que nadie lo notara. Ahora la regla se conserva y se
muestra escrita en palabras debajo de las casillas.

---

## 6. Tanda del 22/09/2026 — estados editables, listas de varias opciones, fotos de la galería y el PDF sin hojas en blanco

### Qué hay que correr

| Archivo | Qué hace |
|---|---|
| `supabase/27_estados_punto_y_multiseleccion.sql` | Quita el `CHECK` de `asa_inspecciones.estado_punto`, siembra el catálogo de estados en `asa_config_sistema` y pasa a "varias opciones" las preguntas de lista |

Es idempotente y no toca ninguna inspección ya registrada. Después hay que
desplegar **backend, panel y app del técnico**: el backend valida los estados
contra el catálogo y la app los baja de ahí.

> La app del técnico es una PWA: la versión del caché subió a `asa-tecnico-v5`,
> así que los teléfonos se actualizan solos la próxima vez que abran con señal.

### 1. "Estado del punto" ya se edita desde el panel

Era la lista heredada del sistema anterior y estaba clavada en tres sitios a la
vez —la app, el backend y un `CHECK` de la base—, así que cambiar una palabra
no servía de nada: la base rechazaba el registro. Ahora vive en
**Configuración → Estados del punto**: se renombra, se reordena, se agrega, se
desactiva y se le pone color.

Dos banderas por estado:

- **Pide motivo** — el técnico tiene que decir por qué, se le salta el checklist
  y el servicio cuenta como NO REALIZADO. "No pude entrar" viene así.
- **Abre hallazgo** — deja el pendiente registrado para que el hotel lo corrija.
  "Dañado" y "No está" vienen así.

El **código** es lo que queda escrito en cada inspección y en los reportes ya
entregados: el nombre se cambia cuando quieras, el código conviene dejarlo
quieto. "Todo bien" y "No pude entrar" no se pueden borrar — el primero es el
valor por defecto de la columna y el segundo es de donde sale todo el reporte de
no realizados.

### 2. Las listas del checklist aceptan varias opciones

"Áreas tratadas" estaba configurada en el panel como *Lista (varias opciones)*,
pero la app pintaba **toda** pregunta de lista con la botonera de una sola: al
marcar "Clóset" se apagaba "Baño". Por eso en campo se registraba una sola área
de las cuatro que se trataban.

Ahora cualquier pregunta de lista deja marcar todas las que apliquen (con su
casilla de check delante, para que se vea sin leer la ayuda) y la respuesta
viaja en `valor_opciones`, que el panel y el PDF ya sabían leer. La migración
convierte a "varias opciones" las preguntas que estaban como una sola.

### 3. Fotos: tomarlas o escogerlas del teléfono

En la inspección hay dos botones — **Tomar foto** y **Elegir de mis fotos** — y
cada miniatura se puede quitar con la ✕, que es lo que hacía falta cuando se
escoge la foto equivocada del carrete. En el chequeo del vehículo se le quitó el
`capture` a los cinco ángulos, así que el teléfono pregunta si se toma ahora o
se busca una ya tomada. Se siguen achicando igual antes de subirlas.

### 4. El PDF ya no trae hojas en blanco

No era el contenido: era el pie de página. Se escribe a 34 puntos del borde, o
sea **por debajo del margen inferior** (52), y cuando a `doc.text` se le pasa un
`width`, pdfkit lo trata como texto normal, ve que no cabe y **abre una hoja
nueva** para escribirlo ahí. Una hoja por cada pie — y como el total de páginas
ya estaba contado, esas hojas extra ni siquiera llevaban número: salían con esa
línea suelta arriba, que es lo que se veía como "hoja vacía con un encabezado".

Medido con un reporte de prueba de 120 servicios: **138 hojas, 92 de ellas
vacías → 46 hojas, ninguna vacía.**

De paso quedaron tapados dos huecos más pequeños del mismo archivo: el
`addPage()` del detalle se saltaba aunque la hoja estuviera limpia, y un
encabezado de tabla podía quedar solo al final de una hoja con su primera fila
en la siguiente.

---

## 7. Cada tipo de punto lleva lo suyo (y nada más)

### Qué hay que correr

| Archivo | Qué hace |
|---|---|
| `supabase/28_tipo_punto_estrategias_y_plagas.sql` | Crea `asa_tipo_punto_estrategias` y `asa_tipo_punto_plagas` y las siembra con lo que ya está configurado |

Va después del 27_. Es idempotente, no toca ninguna inspección registrada y
termina imprimiendo **qué le quedó a cada tipo** y **qué puntos siguen sin
checklist**, que es la lista de lo que falta por configurar.

### El problema eran dos fugas, no una

**Las plagas eran una sola lista para todo el sistema.** `GET /plagas/catalogo`
devolvía las once plagas y la app las pintaba en cualquier punto: chinches de
cama en una lámpara de moscas, moscas en un cebadero. Ahora cada tipo lleva las
suyas y viajan dentro de la ficha del punto, así que también funcionan sin señal.
Si un tipo no tiene ninguna marcada, el bloque de contadores no aparece.

**El checklist se desbordaba cuando el punto no tenía estrategia propia.** El
backend hacía esto: *si el punto no tiene estrategia, usar todas las del hotel*.
Como casi ningún punto importado del sistema anterior trae estrategia, casi
todos caían ahí. Medido con datos de prueba sobre las nueve estrategias
importadas, un dispensador de aerosol mostraba **13 preguntas — nueve de ellas
"Observaciones" repetida, una por estrategia. Ahora muestra 5, las suyas.**

El orden nuevo es corto y explícito:

1. La estrategia asignada al punto, si la tiene. Manda siempre.
2. Si no, las estrategias **de su tipo** (lo que marcas en Tipos de punto).
3. Si su tipo no tiene ninguna, no hay checklist — y la app lo dice en pantalla
   en vez de callarse, para que alguien lo configure.

Además, cuando un tipo lleva dos estrategias que traen la misma pregunta (el
cebadero quedó con *Monitoreo permanente* y *Estación de Cebo*, casi gemelas del
import), la pregunta sale una sola vez: **13 → 7 en el cebadero**. Si prefieres,
desmarca una de las dos en el panel.

### Dónde se edita

**Tipos de punto**. La tabla ahora muestra cuántas estrategias y cuántas plagas
lleva cada tipo, y marca en rojo el que quedó en cero — un tipo en cero es un
tipo que sale pelado en la app. Al abrirlo salen las dos listas de casillas.

Lo que se sembró, para que sepas de dónde salió:

- **Estrategias:** se dedujeron de las preguntas que ya existen. Si una
  estrategia tiene preguntas para cebadero, es una estrategia de cebadero. No se
  inventó ninguna relación.
- **Plagas:** con criterio de campo — lámpara, trampa y aerosol cuentan
  voladoras; cebadero y estación perimetral, roedores; habitación, chinches y
  rastreras; apertura, lo que entra por ahí; recorrido de área general, todas.
  "Otra plaga" va en todos, porque en campo siempre aparece algo fuera de lista.

**Nada queda amarrado solo.** Un tipo de punto nuevo nace sin estrategias y sin
plagas (al crearlo el panel te lo vuelve a abrir para que elijas), y una
estrategia nueva no se pega sola a ningún tipo: la marcas donde la quieras.

---

## Días anteriores, pendientes por área y semáforo del portal (22-sep-2026)

**Qué cambió**

- **Panel → Planta → Días anteriores.** Ahora lista cada día con TODO lo que se
  hizo (todos los tipos, no solo habitaciones), con rango de 7/30/90/180 días.
  Al tocar un día se abre el día completo; cada servicio abre su desglose
  (preguntas, plagas y fotos). Botón "← Días anteriores" para regresar.
- **Panel → Planta → Pendientes por área** (antes "Inspecciones de hoy"). Se
  elige el tipo de punto (habitaciones, cebaderos, lámparas...) y se ve SOLO ese
  tipo, agrupado por área, con filtro de área y "solo lo que falta".
  Verde = hecho hoy / al día; rojo = por hacer; rojo punteado = se intentó hoy y
  no se pudo.
- **Portal del hotel → Por hacer.** Mismo semáforo por tipo y área: verde lo
  hecho, rojo lo que falta. Debajo sigue el detalle de lo que no se pudo hacer hoy.

**Archivos**

- `backend/routes/puntos.js` — nuevo `GET /puntos/estado?sitio_id=&tipo=&area_id=`
- `backend/routes/inspecciones.js` — nuevo `GET /inspecciones/dias?sitio_id=&dias=`
- `panel-web/servicios.js`, `panel-web/app.js`, `panel-web/styles.css`
- `portal-hotel/app.js`, `portal-hotel/estilos.css`
- `supabase/29_vista_puntos_sin_no_realizados.sql`

**Puesta en marcha**

1. Ejecutar `supabase/29_vista_puntos_sin_no_realizados.sql` en el SQL Editor.
   Sin esto todo funciona, pero una habitación a la que "no dejaron entrar"
   se sigue contando como hecha (verde) durante su ciclo.
2. Subir a GitHub: Railway redespliega el backend y Vercel el panel y el portal.

---

## Solicitudes del hotel (hotel ↔ ASA ↔ técnico) y Mapa en el portal (22-sep-2026)

**Para qué.** Hay hoteles que solo liberan las habitaciones cuando sale el
huésped y le entregan al técnico una lista en papel. Ahora esa lista viaja por
el sistema y los tres lados ven lo mismo en tiempo real.

**Cómo funciona**

1. **Hotel (portal → Solicitudes):** "Enviar habitaciones". Escribe o pega los
   números (`4312, 4315, 4320-4325`) o las toca en la cuadrícula; avisa si un
   número no existe. Elige para cuándo, urgencia y deja una nota. También
   "Reportar una plaga", que ahora cae en la misma lista.
2. **Panel (menú → Solicitudes):** globito rojo con las que nadie ha abierto y
   aviso cuando entra una nueva. Al abrirla queda registrado quién la vio. Se
   asigna técnico, se cambia el estado y se escribe en el hilo.
3. **Técnico (app):** arriba de su ruta, "Pedidas por el hotel". Botón "La
   recibí — avisar al hotel". Toca una habitación, hace la inspección normal y
   vuelve a la solicitud.
4. **Automático:** al guardar la inspección de una habitación de la lista, esa
   habitación se pone VERDE sola (lo hace la base de datos, también con lo que
   se sube sin señal). Si "no se pudo" (huésped dentro, sin llave…) queda ROJA
   con el motivo. Cuando todas están hechas, la solicitud se completa sola.
5. **Mensajes:** cada solicitud tiene su hilo entre hotel, oficina y técnico.
   Un mensaje del hotel vuelve a marcarla como nueva en el panel.

**Extras incluidos**

- El hotel puede **agregar habitaciones** a una solicitud abierta (siguen
  saliendo huéspedes durante el día) y **cancelarla**.
- La oficina puede **crear una solicitud** por el hotel (si llamaron o
  escribieron por WhatsApp).
- El portal refresca la solicitud abierta cada 30 segundos.
- Pasos visibles para el hotel: Enviada → Recibida por ASA → En proceso → Completada.
- **Mapa (portal → Mapa):** el hotel ve los planos de su planta. En planos de
  imagen, cada punto sale en verde (hecho) o rojo (por hacer); en PDF (QGIS) se
  ve el plano tal cual, con botón de pantalla completa. El portal no recibe los
  códigos QR.
- Corregido: en la app del técnico, un punto abierto desde la búsqueda se
  guardaba como si fuera escaneado por QR.

**Archivos**

- `supabase/30_solicitudes_hotel.sql` (tablas `asa_orden_puntos`,
  `asa_orden_mensajes`, columnas nuevas en `asa_ordenes_trabajo` y el trigger)
- `backend/routes/solicitudes.js` (nuevo), `backend/server.mjs`,
  `backend/middleware/auth.js`, `backend/routes/sitios.js`,
  `backend/routes/configuracion.js`
- `portal-hotel/app.js`, `portal-hotel/estilos.css`
- `panel-web/solicitudes.js` (nuevo), `panel-web/index.html`, `panel-web/app.js`,
  `panel-web/styles.css`
- `app-tecnico/app.js`, `app-tecnico/estilos.css`, `app-tecnico/sw.js` (caché `asa-tecnico-v6`)

**Puesta en marcha**

1. Ejecutar `supabase/30_solicitudes_hotel.sql` en el SQL Editor (y el 29 si no
   se ha corrido). Al final muestra una fila con 1 · 1 · 1 · 1.
2. Subir a GitHub: Railway redespliega el backend; Vercel el panel, el portal y la app.
3. Si usas la matriz de **Permisos por rol**, dale acceso a "Solicitudes del
   hotel" a operaciones/comercial (el admin la ve siempre).
4. Los técnicos deben tener su **empleado** con rol técnico para aparecer en
   "Técnico asignado".

---

## Etiquetas QR impresas que no abren nada (22-sep-2026)

**Idea.** El QR principal de un punto sigue sin poder cambiarse. Para
aprovechar las etiquetas ya impresas y pegadas, a un punto se le cuelgan
**etiquetas adicionales**: escanear cualquiera abre el mismo punto, con su
mismo historial.

**Qué hay**

- **Grupo impreso** (`asa_qr_impresos`): la lista de códigos que ASA mandó a
  imprimir. Con ella el sistema dice si una etiqueta "es nuestra".
- **Panel → Plantas → planta → Puntos de control → "Etiquetas QR"**:
  1. Verificar un código escribiéndolo o con **foto del QR** → dice si es del
     grupo impreso y si ya abre algún punto; si está libre, se busca el punto y
     se asigna.
  2. Lista de etiquetas que los técnicos **escanearon sin que abrieran nada**
     en esa planta (cuántas veces, cuándo, quién) para asignarlas de un clic.
  3. Cargar el grupo impreso: pegar códigos o subir .txt/.csv.
- **Ficha de un punto** (panel): sección "Etiquetas adicionales" para agregar
  (escrito o por foto) o quitar.
- **App del técnico**:
  - Botón "📷 No lee — tomar foto del QR" en el escáner (etiquetas gastadas o
    con reflejo).
  - Si el QR no abre nada y quien escanea es **admin u operaciones**, sale
    "Etiqueta sin asignar" con buscador: se toca el punto y queda asignada;
    desde ese momento abre ese punto.
  - Si es un técnico, se le avisa y queda anotada para la oficina.
- El servidor entiende códigos en minúsculas, con espacios o dentro de una URL
  de otro sistema (`...?code=C2050...`, `.../C2050...`).
- Un mismo código nunca puede abrir dos puntos (lo garantiza la base).

**Archivos**

- `supabase/31_etiquetas_qr.sql`
- `backend/routes/puntos.js`
- `panel-web/etiquetas.js` (nuevo), `panel-web/admin.js`, `panel-web/app.js`,
  `panel-web/index.html`, `panel-web/styles.css`
- `app-tecnico/app.js`, `app-tecnico/sw.js` (caché `asa-tecnico-v7`)

**Puesta en marcha**

1. Ejecutar `supabase/31_etiquetas_qr.sql` (muestra 1 · 1 · 1).
2. Subir a GitHub.
3. Cargar el grupo impreso (panel → Etiquetas QR → 3), o pasarle los archivos
   a Claude para que los procese.

**Corrección (22-sep-2026):** el lector de QR por foto (jsQR 1.4.0) ya no se
descarga de cdnjs: va incluido en `panel-web/vendor/jsQR.js` y
`app-tecnico/jsQR.js` (en el caché de la app, caché `asa-tecnico-v8`). Funciona
sin internet y no depende de que el navegador pueda llegar al CDN.

---

## Documentos para el hotel y fotos del chequeo del vehículo (23-sep-2026)

**Documentos (panel → Catálogos → Documentos · portal → pestaña "Documentos").**
La carpeta que el hotel pide en cada auditoría, siempre disponible en su portal:

- **Permisos y documentos:** licencia ambiental, licencia sanitaria, no objeción
  de Salud Pública, registro de Agricultura, regencia, manual de operaciones,
  protocolo de trabajo, listado de productos y "otro". Cada uno con número,
  quién lo emite, fecha de emisión y **vencimiento** (el panel y el portal
  marcan Vigente / Por vencer (≤30 días) / Vencido).
- **Productos que utilizamos:** el listado (nombre, ingrediente activo,
  presentación, registro de Agricultura y sanitario, categoría toxicológica,
  uso) con su **ficha técnica** y **hoja de seguridad** colgadas. Botones
  "+ Ficha técnica" / "+ Hoja de seguridad" en cada producto.
- **Adjuntar:** "+ Adjuntar documento" → PDF, imagen, Word o Excel hasta 15 MB.
  "Editar" permite reemplazar el archivo; "Retirar" lo quita del portal (el
  archivo se conserva).
- **Quién lo ve:** "Todos los clientes" o un cliente en particular, y la casilla
  "Visible para el hotel" para dejar algo solo para ASA.
- Arriba, **"Carpeta del hotel"** dice qué falta o está vencido.
- Los archivos van a un bucket **privado** (`asa-documentos`); el portal recibe
  un enlace que vence en 1 hora.

**Chequeo del vehículo — la foto no abría la cámara.** En Android 14+ el campo
de foto sin `capture` abre el selector de fotos del sistema, que no trae
cámara. Ahora cada ángulo tiene **📷 Cámara** (abre la cámara trasera directo;
tocar el recuadro hace lo mismo) y **🖼️ Fotos** (escoger una ya tomada). La
reducción de la foto usa `createImageBitmap` (orientación correcta, fotos
grandes sin colgar el teléfono) y si una foto no se puede leer se avisa en vez
de mandarla y que el servidor la rechace.

**Archivos**

- `supabase/32_documentos_regulatorios.sql` (nuevo)
- `backend/routes/documentos.js` (nuevo), `backend/server.mjs`, `backend/routes/configuracion.js`
- `panel-web/documentos.js` (nuevo), `panel-web/index.html`, `panel-web/app.js`
- `portal-hotel/app.js`, `portal-hotel/estilos.css`
- `app-tecnico/chequeo.js`, `app-tecnico/app.js`, `app-tecnico/estilos.css`, `app-tecnico/sw.js` (caché `asa-tecnico-v9`)

**Puesta en marcha**

1. Ejecutar `supabase/32_documentos_regulatorios.sql` (muestra 1 · 1 · 1).
2. Subir a GitHub: Railway redespliega el backend; Vercel el panel, el portal y la app.
3. Si usas **Permisos por rol**, dale "Documentos y productos" a operaciones/comercial.
4. En el panel: cargar los productos y adjuntar licencias, manual, protocolo y fichas.
5. En los celulares, cerrar y abrir la app del técnico para que tome la versión v9.

---

## Borrar datos de prueba — solo administrador (23-sep-2026)

**Panel → Administración → 🧹 Borrar datos de prueba** (no aparece para otros roles
y el servidor rechaza a quien no sea admin).

1. Escoge qué revisar: inspecciones, hallazgos, solicitudes, chequeos de
   vehículos, fallas, gastos de flota, QR sin asignar, documentos, productos,
   bitácora; o datos base: clientes, plantas, puntos, vehículos, conductores,
   usuarios. Al lado sale cuántos hay.
2. Filtra por planta, fechas o texto.
3. Marca uno por uno (o "Marcar todos los que se ven") → "Borrar marcados" →
   escribe **BORRAR**.

- Solo se borra lo marcado; se borra de verdad, con sus fotos/archivos en Storage.
- Los datos base avisan en rojo lo que arrastran (borrar un cliente borra sus
  plantas, puntos e inspecciones).
- Al borrar chequeos, el kilometraje del vehículo se recalcula.
- No te deja borrar tu propia cuenta ni quedarte sin administrador.
- Queda anotado en la Auditoría quién borró cuántos.

**Archivos:** `backend/routes/limpieza.js` (nuevo), `backend/server.mjs`,
`panel-web/limpieza.js` (nuevo), `panel-web/index.html`, `panel-web/app.js`.
No requiere SQL. Solo subir a GitHub.
