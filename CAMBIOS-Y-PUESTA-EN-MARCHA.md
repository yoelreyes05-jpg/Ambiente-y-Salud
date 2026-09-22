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
