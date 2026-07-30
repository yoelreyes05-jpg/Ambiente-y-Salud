# App móvil del PERSONAL — Ambiente y Salud RD (ASA SRL)

Una sola app, con pantallas que se habilitan según el `rol` del usuario
autenticado (`asa_rol_usuario`): técnico de plagas, veterinario, groomer,
cajero. Debe funcionar con conectividad intermitente (modo offline en campo).

## Stack sugerido
React Native (Expo) + almacenamiento local (SQLite/AsyncStorage) para poder
trabajar sin señal y sincronizar al recuperar conexión.

## Mapa de pantallas por rol → endpoints del backend

### Técnico de plagas
| Pantalla | Endpoint(s) |
|---|---|
| Mi ruta del día | `GET /plagas/ordenes?tecnico_id=&estado=agendada` |
| Detalle de la OT | `GET /plagas/ordenes/:id` |
| Escanear estación IPM (QR) | `GET /ipm/estaciones/qr/:codigo` |
| Registrar lectura IPM | `POST /ipm/lecturas` |
| Ejecutar servicio (fotos, firma, productos aplicados) | `POST /plagas/ordenes/:id/ejecutar` |
| Cambiar estado de la OT | `PATCH /plagas/ordenes/:id/estado` |

### Veterinario
| Pantalla | Endpoint(s) |
|---|---|
| Mi agenda de citas | `GET /citas?estado=confirmada` |
| Ficha clínica de la mascota | `GET /mascotas/:id`, `POST /veterinaria/fichas` |
| Aplicar vacuna/tratamiento | `POST /veterinaria/tratamientos-aplicados` |
| Catálogo de vacunas | `GET /veterinaria/tratamientos-catalogo` |

### Groomer (estética canina)
| Pantalla | Endpoint(s) |
|---|---|
| Órdenes de estética del día | `GET /estetica/ordenes?estado=solicitada` |
| Registrar orden (fotos antes/después) | `POST /estetica/ordenes`, `PATCH /estetica/ordenes/:id/estado` |

### Cajero (tienda)
| Pantalla | Endpoint(s) |
|---|---|
| Buscar producto / escanear código | `GET /inventario/productos/codigo/:codigo` |
| Registrar venta | `POST /pos/ventas` |
| Cuadre de caja | `POST /pos/cuadre-caja` |

## Estructura de carpetas sugerida

```
app-personal/
  App.tsx
  src/
    api/
    screens/
      tecnico/   (RutaDelDiaScreen, EjecutarOTScreen, EscanearQRScreen)
      veterinario/ (AgendaScreen, FichaClinicaScreen, AplicarTratamientoScreen)
      groomer/   (OrdenesEsteticaScreen)
      cajero/    (POSScreen, CuadreCajaScreen)
    navigation/  (navegación condicional según rol del usuario autenticado)
    offline/     (cola de sincronización: guarda acciones localmente y reintenta)
    context/     (AuthContext)
```

## Pendiente para implementar (próximos pasos)
- Cola de sincronización offline (guardar POST/PATCH localmente si no hay red).
- Escaneo de QR/código de barras (expo-barcode-scanner o similar).
- Captura de firma digital (react-native-signature-canvas o similar).
