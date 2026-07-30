# App móvil del CLIENTE — Ambiente y Salud RD (ASA SRL)

App para que el cliente reporte plagas, agende servicios veterinarios/estética,
consulte el carnet de vacunas de sus mascotas, compre productos y pague en línea.

## Stack sugerido
React Native (Expo) — un solo código para iOS y Android. Consume directamente
la API del `backend/` (ver rutas abajo). Autenticación con JWT
(`POST /usuarios/login`, guardar el token y enviarlo como
`Authorization: Bearer <token>`).

## Mapa de pantallas → endpoints del backend

| Pantalla | Endpoint(s) |
|---|---|
| Login / Registro | `POST /usuarios/login`, `POST /usuarios/registrar-cliente` |
| Home (mis sitios y mascotas) | `GET /clientes/:id` |
| **Reportar plaga** (flujo estrella) | `POST /plagas/reportar` |
| Seguimiento de mi Orden de Trabajo | `GET /plagas/ordenes?cliente_id=` , `GET /plagas/ordenes/:id` |
| Mis mascotas | `GET /mascotas?cliente_id=` |
| Ficha / carnet de vacunas de una mascota | `GET /mascotas/:id/carnet` |
| Agendar cita (consulta/vacuna/estética) | `POST /citas` |
| Mis citas | `GET /citas?cliente_id=` |
| Tienda (catálogo simple) | `GET /inventario/productos` |
| Mis facturas (e-CF) | `GET /facturacion?cliente_id=` |
| Registrar un pago | `POST /facturacion/:id/pagos` |
| Notificaciones | `GET /notificaciones?cliente_id=`, `PATCH /notificaciones/:id/leida` |

## Flujo destacado: "Reportar plaga → Orden de Trabajo"

1. El cliente selecciona el sitio afectado (o registra uno nuevo).
2. Completa: tipo de plaga, descripción, fotos (subir a almacenamiento de
   archivos y enviar las URLs).
3. `POST /plagas/reportar` con `{ cliente_id, sitio_id, tipo_plaga_reportada,
   descripcion_cliente, fotos_cliente: [...] }`.
4. El backend crea automáticamente la Orden de Trabajo en estado `solicitada`
   y devuelve el `numero_orden` (ej. `ASA-000123`) para que el cliente la seleccione en la app y siga su estado.

## Estructura de carpetas sugerida (a crear con `npx create-expo-app`)

```
app-cliente/
  App.tsx
  src/
    api/            (cliente HTTP + funciones por módulo: clientes.ts, plagas.ts, mascotas.ts, citas.ts, facturacion.ts)
    screens/
      LoginScreen.tsx
      HomeScreen.tsx
      ReportarPlagaScreen.tsx
      SeguimientoOTScreen.tsx
      MascotasScreen.tsx
      CarnetVacunasScreen.tsx
      AgendarCitaScreen.tsx
      TiendaScreen.tsx
      FacturasScreen.tsx
      NotificacionesScreen.tsx
    components/
    navigation/     (React Navigation: stack + tabs)
    context/        (AuthContext con el JWT y el cliente_id logueado)
```

## Pendiente para implementar (próximos pasos)
- Definir el proveedor de subida de fotos/firma (almacenamiento S3-compatible).
- Integrar notificaciones push (Expo Notifications) + WhatsApp como canal alterno.
- Conectar la pasarela de pago en línea.
