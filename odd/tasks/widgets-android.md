# Widgets de Android

Fecha: 2026-10-24. Rama: `feat/widgets-android` (desde `main` tras la release 0.1.26).
Entrega: un commit por tarea, un PR al final. Cada widget se prueba en el emulador Android
(`emulator-5554`, API 35) con un APK local; nada se da por hecho sin verlo en pantalla.

## Pedido

Widgets para la pantalla de inicio de Android, en este orden:

1. Lista o board fijado: pendientes, con marcar como hecho desde el widget.
2. Captura rapida: nueva tarea / nueva nota.
3. Diario de hoy.
4. Atajos a workspaces, carpetas, listas y notas.
5. Dashboard resumen (el ultimo: depende de los demas).

Ideas aparcadas: habitos (rama `habitos` abierta), contador de Sin clasificar, nota fijada.

## Decisiones

- Libreria: `react-native-android-widget` 0.24.0 (peer `expo >=54`, publicada 2026-10-22).
  Alternativa descartada por ahora: Glance/Kotlin con plugin propio (mas control, mas trabajo).
- Local-first: el widget lee de `orbithub.db` (SQLite) y escribe local + encola la operacion,
  como la app. El push lo hace el motor de sync cuando corre; el widget no necesita red.
- Solo Android. En web/iOS no hay nada que registrar.

## Tareas

- [x] W1 Spike: instalar la libreria, plugin en `app.json`, entrada del manejador de tareas,
      un widget "hola" visible en el emulador. Prueba: el widget aparece en el selector y pinta.
- [x] W2 Lista fijada: pantalla de configuracion para elegir la lista, render de pendientes,
      toque = marcar hecho (local + cola), toque en el titulo = abrir la lista.
- [ ] W2b Boards: el widget de lista solo ofrece listas de tareas; un board (columnas) pide su
      propio render (columna elegida) y queda pendiente.
- [x] W3 Captura rapida: botones "Nueva tarea" y "Nueva nota" que abren la hoja de creacion.
- [ ] W4 Diario de hoy: texto del dia y boton de escribir.
- [ ] W5 Atajos: configuracion para elegir hasta N destinos; abren por deep link.
- [ ] W6 Dashboard: resumen de hoy.
- [ ] W7 Regresion en emulador, claro/oscuro, sin conexion, y PR.

## Progreso

- W1 (2026-10-24): libreria 0.24.0, plugin en app.json, entrada apps/mobile/index.ts (main) que registra el manejador solo en Android, widget Hello visible y pintado en el emulador. Ruta: inline (4 archivos pequenos, ya entendido).
- W2 (2026-10-24): widget PinnedList (reconfigurable) con pantalla de configuracion en su propio root RN, datos desde orbithub.db (headless), marcar = localUpdate + cola, titulo = deep link `orbithub://list/<id>`. Verificado en emulador: se anade, elige lista (Mudanza, 13 pendientes), marcar baja a 12 sin abrir la app, la app muestra "2 done", el titulo abre la lista. Tests: test/widget-pinned-list.test.ts (5). Pendiente para W7: claro/oscuro, sin conexion, refresco tras sync (el widget solo se repinta con eventos propios).
- W3 (2026-10-24): widget QuickCapture (4x1, reconfigurable): dos botones OPEN_URI. "Nueva tarea" abre la lista elegida con `?new=1` (panel de crear), "Nueva nota" abre el espacio con `?create=note` (hoja de nota). Config en dos pasos saltables. Por peticion del usuario, el selector de lista (tambien el del widget de lista fijada) es el de siempre: tema de la app (`ThemeProvider`/`I18nProvider` en su propio root), espacios -> toque entra -> carpetas -> listas, con "Subir un nivel" (`list-picker.tsx`, `config-frame.tsx`, filas `Pick`). Verificado en emulador: ambos botones abren su panel, el selector baja por niveles. Fallo encontrado y corregido: `?create=note` solo fijaba el tipo y no abria la hoja.
