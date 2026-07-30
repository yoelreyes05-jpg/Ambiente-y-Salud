# Panel web administrativo — Ambiente y Salud RD (ASA SRL)

Panel para el personal de oficina: comercial, operaciones, contabilidad,
nómina y administración. Consume la misma API del `backend/`.

## Enfoque sugerido
Igual que tu sitio actual de Sólido Auto Servicio: una **SPA de una sola
página** (HTML/CSS/JS) con pestañas/paneles por módulo, sirviendo estático
(sin build step), para que sea rápido de mantener y desplegar. Alternativa:
React si se prefiere un panel más grande a futuro.

## Módulos (pestañas) y su fuente de datos

| Módulo | Endpoints principales |
|---|---|
| Dashboard | combinación de varios GET (ordenes, citas, ventas, cuentas por cobrar) |
| Clientes | `/clientes` (+ `/rnc/:rnc` para autocompletar al crear) |
| Plagas — Órdenes de trabajo | `/plagas/ordenes`, `/plagas/contratos` |
| Plagas — IPM | `/ipm/estaciones`, `/ipm/lecturas` |
| Plagas — Cumplimiento | `/ipm/permisos`, `/ipm/permisos/por-vencer` |
| Veterinaria | `/mascotas`, `/veterinaria/fichas`, `/veterinaria/tratamientos-*` |
| Citas | `/citas` |
| Estética | `/estetica/catalogo`, `/estetica/ordenes` |
| Inventario | `/inventario/plaguicidas`, `/inventario/productos`, `/inventario/movimientos`, `/inventario/alertas-stock` |
| Tienda (POS) | `/pos/ventas`, `/pos/cuadre-caja` |
| Facturación (e-CF) | `/facturacion` |
| Contabilidad | `/contabilidad/plan-cuentas`, `/contabilidad/asientos`, `/contabilidad/balance-comprobacion` |
| Cuentas por pagar | `/contabilidad/suplidores`, `/contabilidad/cuentas-por-pagar` |
| Nómina | `/nomina/empleados`, `/nomina/periodos`, `/nomina/comisiones` |
| Usuarios | `/usuarios` (solo admin) |
| Notificaciones | `/notificaciones` |

## Roles y qué debería ver cada uno
Igual que `asa_rol_usuario`: admin (todo), comercial (clientes/contratos),
operaciones (órdenes/agenda), contabilidad (facturación/contabilidad),
nómina (empleados/nómina). El panel debe ocultar pestañas según el rol del
usuario autenticado (`GET /usuarios/me`).

## Estructura sugerida (patrón SPA como solido-web/index.html)

```
panel-web/
  index.html        (estructura, pestañas, estilos con la paleta de marca ASA)
  app.js            (fetch a la API, render de tablas/formularios por módulo)
  config.js         (API_BASE, igual patrón que CONFIG en solido-web)
```

## Pendiente para implementar (próximos pasos)
- Definir la paleta exacta con el logo (verde/azul cian de ASA) — ver PDF de
  estructura ya entregado para la referencia de colores.
- Construir cada pestaña siguiendo el mismo patrón usado en
  `solido-web/index.html` (panels + tabs + fetch a la API).
