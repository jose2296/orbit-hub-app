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

Estado: `[ ]` pendiente, `[x]` hecho y verificado.

- [x] T1 Export JSON de lista: cada item con su estado resuelto (titulo), no solo `stateId`. Revisar tambien el export CSV y el de cuenta. (bf0a1bb; `listExportItemSchema` + `listExportItem`; tests API 84/84, typecheck limpio. CSV ya resolvia el titulo; export de cuenta sin cambios.)
- [ ] T2 Tablero: poder marcar un estado como Done (las tareas quedan finalizadas).
- [ ] T3 Tablero: exportar solo los datos de un estado.
- [ ] T4 Modal de crear tarea: padding horizontal alineado y reducido.
- [ ] T5 Tareas: elegir entre descripcion tipo nota o texto libre en textarea.
- [ ] T6 Clasificar un bookmark en una coleccion: corregir el error.
- [ ] T7 Borrar carpeta vacia (o con bookmarks sin clasificar): corregir el borrado.
- [ ] T8 Confirmacion uniforme para cualquier eliminacion (dialogo de confirmacion tipico).
- [ ] T9 Swipe a la izquierda en filas de listas para abrir acciones (eliminar, etc.).
- [ ] T10 Toda la fila es pulsable (no solo el nombre), en listas de tareas y en mas sitios.
- [ ] T11 Sheet de opciones de un item (long press): mostrar el nombre completo.
- [ ] T12 Movil: transicion de color del header al cambiar de item/carpeta/workspace sin parpadeo.
- [ ] T13 Borrar carpeta: avisar de su contenido y confirmar; el borrado es permanente y en cascada.
- [ ] T14 Checkbox de tareas: hit slot mayor, feedback visual y actualizacion optimista.
- [ ] T15 Etiquetas de tareas: crear, editar y borrar de forma sencilla.

## Verificacion por tarea

Cada tarea cierra con su commit Conventional Commit en esta rama, con tests junto
al comportamiento. Se registra aqui el hash del commit y el resultado de los checks.

## Progreso y evidencia

- T1 hecho (bf0a1bb).
- T6 diagnostico parcial, sin reproducir: el servidor (`sync-service.ts`, rama de
  `collectionId` en update) tiene tests que cubren clasificar; el payload del cliente
  (`localUpdate` en `lib/offline/sync-service.ts`) solo manda `collectionId`. Causa
  sin confirmar. Hay que reproducir en web con el error exacto del toast.
- T7 diagnostico parcial: `deleteFolder` en `hooks/use-workspaces.ts` solo mueve las
  listas al padre y tombstonea la carpeta. No toca bookmarks, notas ni subcarpetas
  que apuntan a ella. El servidor (`sync-service.ts`, rama `folder` de delete) no
  comprueba contenido. Hay que reproducir para ver que falla de verdad.
- T13 relacionado con T7: las FK de bookmarks, notas y colecciones a carpetas son
  `onDelete: cascade` (`db/content-schema.ts`), pero el delete del servidor es soft
  (tombstone), asi que la cascada no ocurre. Decidir el comportamiento antes de tocar.

## Siguiente paso

Levantar web y API para reproducir T6 y T7 con el error exacto; luego T2-T5 y T8-T15.
