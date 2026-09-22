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
