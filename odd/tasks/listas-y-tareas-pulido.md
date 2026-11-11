# Listas y tareas: pulido y correcciones

## Objetivo

Resolver en una sola rama 15 puntos de pulido sobre listas (tareas y tablero),
exportes, bookmarks, carpetas y confirmaciones de borrado.

## Problema

Varios flujos de listas y bookmarks son confusos o fallan: el export JSON de un
tablero no deja ver el estado de cada tarea, no se puede marcar un estado como
Done, el modal de crear tareas tiene demasiado padding, clasificar un bookmark da
error, no se puede borrar una carpeta vacia, los borrados no piden confirmacion
de forma uniforme, las etiquetas de tareas son confusas y el check de tareas es
dificil de tocar.

## Alcance

Incluido: los 15 puntos listados abajo, en `apps/api`, `packages/contracts` y
`apps/mobile`.

Fuera de alcance: push, PR y merge (decision del usuario). Cambios de esquema
sin migracion.

## Restricciones

- Contratos primero: lo que cruza la red se define en `packages/contracts`.
- Tokens de diseno, sin colores ni espacios hardcodeados (`useTheme()`).
- Escritura local primero (offline-sync).
- Autorizacion en el API.
- Verificacion: `npm run check`; UI en web (claro y oscuro) y, cuando sea posible,
  en el emulador Android (`emulator-5554`).

## Checklist

Estado: `[ ]` pendiente, `[~]` parcial, `[x]` hecho.

- [x] T1 Export JSON de lista con el titulo del estado en cada item. (bf0a1bb)
- [x] T2 Columna Done en el tablero: sus tareas quedan finalizadas. (c455a95; verificado en web)
- [x] T3 Exportar solo una columna del tablero, JSON o CSV. (7c91847; test de API y menu en la UI; la descarga no se ha probado en navegador)
- [x] T4 Padding del modal de crear tarea. (5c15ca5; medido: el contenido queda alineado con el titulo)
- [x] T5 Descripcion de tarea: nota o texto libre. (a9ca6df; verificado en web)
- [~] T6 Clasificar bookmark: (4144b58) la hoja abre en la carpeta del enlace y muestra sus colecciones; la creacion de coleccion ya no encola un update fallido. El "Error inesperado" NO se ha reproducido en web en cinco variantes. Pendiente: el mensaje exacto en el movil (ahora la hoja muestra el texto real del fallo).
- [x] T7 Borrar carpeta vacia o con contenido. (aba36aa; verificado en web)
- [x] T8 Confirmacion al borrar: item (hoja de edicion, opciones y swipe), carpeta, etiqueta, quitar de lista de medios, adjunto de nota y plantilla. El resto de borrados ya pasaba por la pagina de borrado del menu o por su hoja propia.
- [x] T9 Swipe a la izquierda en tareas: baldosas redondeadas Hecha/Borrar, fondo propio de la fila, y un toque al soltar o con la fila abierta ya no abre la tarea. Verificado en Chromium en modo touch (CDP): abrir, soltar sin abrir la hoja, tocar cierra, Borrar pide confirmacion. Extendido a las filas de contenido (carpetas, listas, notas, colecciones) y a los enlaces, con el componente compartido SwipeRow y la pulsacion larga abriendo sus opciones.
- [x] T10 Fila entera pulsable en tareas. (ef2b245; verificado en web)
- [x] T11 Sheet de opciones con el nombre completo. (ef2b245; verificado)
- [x] T12 Cabecera sin parpadeo al cambiar de espacio. Medido en touch: A a B y casa a A saltan al color del espacio sin pasar por el gris neutro.
- [x] T13 Borrar carpeta con todo lo que hay dentro, avisando. (aba36aa; cascada en servidor con test; copy nuevo)
- [x] T14 Checkbox: area de toque mayor, respuesta visual, check optimista. (ef2b245; verificado en web)
- [x] T15 Etiquetas de la lista: la tarea asigna y crea; renombrar, colorear y borrar en la pagina "Gestionar etiquetas". Borrar pregunta y quita la etiqueta de todas sus tareas. (f2e13e3; verificado en web: crear, renombrar y borrar)

## Verificacion por tarea

Cada tarea cierra con su commit Conventional Commit en esta rama, con tests junto
al comportamiento. Se registra aqui el hash del commit y el resultado de los checks.

## Progreso y evidencia

- Hallazgo anterior a esta rama (ya estaba en 0.1.30): la hoja de tarea no sembraba su borrador, y guardar el nombre reseteaba prioridad, icono, etiquetas y estado. Corregido en f2e13e3 y verificado en web.

- Verificacion en navegador (Playwright, Chromium headless) contra la API local y Expo web en 8082. Usuario de QA: qa2.listas@example.com (datos de prueba en la base local de PGlite).
- Tests: API 849/849 (1 todo), movil 1993/1993, typecheck limpio.
- Hallazgo: en Chromium touch (CDP) la pulsacion larga de la fila no dispara (con raton si); no esta claro si es del gesto sintetico. Pendiente confirmar en el emulador Android (no esta arrancado).
- Pendiente de verificar en emulador Android (`emulator-5554`): swipe (T9), header (T12), pulsacion larga y checkbox en nativo (T10, T14).
- Hallazgo: Metro en web no recarga algunos modulos en caliente; tras editar hay que reiniciar Expo con `--clear` antes de verificar.

## Siguiente paso

1. T6: capturar el mensaje exacto del "Error inesperado" en el movil.
2. T15: implementar la gestion de etiquetas (decision propuesta arriba).
3. T8/T9: auditar borrados restantes y extender el swipe a notas, bookmarks y colecciones si se quiere.
4. Verificar T9, T10, T12 y T14 en el emulador Android.
