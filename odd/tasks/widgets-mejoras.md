# Widgets de Android: mejoras

Fecha: 2026-10-24. Rama: `feat/widgets-mejoras` (desde `main` tras la release 0.1.27).
Entrega: un commit por tarea, un PR al final. Cada cambio se prueba en el emulador (APK local).

## Pedido

"Haz mas cosas interesantes para los widgets". Se parte de lo aparcado en `widgets-android.md`.

## Tareas

- [x] M1 Claro/oscuro: los widgets siguen el tema del sistema (`{ light, dark }` de la libreria).
- [x] M2 Boards en el widget de lista fijada (columna elegida).
- [x] M3 Nota fijada: texto de una nota en la pantalla de inicio, un toque la abre.
- [x] M4 Sin clasificar: contador de enlaces por clasificar en el resumen.

## Progreso
- M1 (2026-10-24): paleta clara y oscura (`palette.ts`); cada widget recibe `palette` y `viewOf` devuelve `{light, dark}` (`bothLooks`), tambien las vistas previas de las pantallas de config. Verificado en emulador: `cmd uimode night yes/no` cambia el widget de blanco a azul oscuro.
- M2 (2026-10-24): el widget de lista fijada acepta boards: columnas en orden (punto de color si es hex, nombre, cuantas pendientes) y dos tareas bajo cada una; toque abre `/board/<id>`. Tests en widget-pinned-list.test.ts. NO verificado en emulador: la cuenta de prueba no tiene un board.
- M3 (2026-10-24): widget PinnedNote (4x3, reconfigurable): titulo y hasta 14 lineas del `plainText` (con la edicion pendiente encima), toque abre `/note/<id>`; el selector ofrece las notas de cada nivel. Verificado en emulador con "Bombilla del bano". Tests: test/widget-note.test.ts (3).
- M4 (2026-10-24): el resumen cuenta los enlaces sin coleccion ("Sin clasificar: N", toque abre `/unclassified`). Verificado en emulador (1 enlace). Todo en un solo commit porque M1 toca todos los widgets.
