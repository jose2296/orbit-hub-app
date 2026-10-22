# Mover items y pulido general

Fecha: 2026-10-22. Rama: `feat/mover-items-y-pulido` (desde `origin/main` 24775cd).
Entrega: todo en esta rama, commits por tarea, un solo PR al final. Verificacion en web
(claro y oscuro); el usuario prueba luego en movil nativo.

## Pedido (11 puntos)

1. Mover cualquier item (lista, nota, carpeta con contenido, bookmark, coleccion) a cualquier
   sitio, incluso a otro workspace.
2. Crear bookmarks sin workspace ("sin asignar").
3. Mover bookmarks de sitio, donde sea. (Aclarado: NO son workspaces anidados; no existen.)
4. Toolbar de notas no fijo arriba: sobre el teclado en movil; flotante junto a la seleccion
   en desktop.
5. Diario: copiar/pasar notas a otro dia; sin modo editar/ver (siempre editable) pero con
   enlaces a otros elementos funcionando.
6. Descripcion de tarea (board y tasks) en un bottom sheet propio, grande, tipo nota.
7. Diario: revisar la incoherencia editable-siempre + swipe entre dias.
8. Buscador de la lista de tareas: revisar flujo, toggle y botones sobre el `+` fijo.
9. Quitar el menu generico de bookmarks del drawer.
10. Bookmarks sin clasificar de cada workspace visibles con workspace y carpeta.
11. Barrido general de bugs visuales y funcionales en web.

## Hechos verificados (exploracion)

- Workspaces son planos; solo las carpetas se anidan (`folders.parent_id`).
- `SYNC_WRITABLE_FIELDS` (`apps/api/src/db/constants.ts:125`): solo `bookmark` acepta mover de
  espacio (`sync-service.ts:1295`). folder/list/note/collection solo cambian de carpeta.
- Tablas con `workspace_id`: folders, lists, collections, bookmarks, notes (list_items cuelgan
  de list). Mover una carpeta de espacio obliga a arrastrar todo su subarbol.
- El cliente indexa su arbol por `workspaceId:parentId` / `workspaceId:folderId`
  (`sync-repository.ts:600-655`): reescribir solo `workspaceId` no basta.
- `odd/tasks/bookmark-without-workspace.md` ya analizo el punto 2 (workspaceId nullable) y
  recomienda la opcion A (nullable de verdad), como feature propia.

## Tareas

- [x] T1 API: mover entre workspaces folder (con subarbol), list, note, collection (+test)
- [x] T2 Contratos + cliente: accion `move` generica y offline
- [x] T3 UI: sheet "Mover a..." en el menu de cada entidad (registro de menus)
- [x] T4 Bookmarks sin workspace (`workspaceId` nullable) (puntos 2 y 3)
- [x] T5 Drawer: quitar menu generico de bookmarks (9)
- [x] T6 Sin clasificar: mostrar workspace y carpeta (10)
- [ ] T7 Toolbar de notas contextual (4)
- [ ] T8 Diario: siempre editable, enlaces vivos, swipe coherente (5 parte 2, 7)
- [ ] T9 Diario: copiar/mover nota a otro dia (5 parte 1)
- [x] T10 Descripcion de tarea en bottom sheet grande (6)
- [ ] T11 Buscador de la lista de tareas y botones sobre el `+` (8)
- [ ] T12 Barrido general en web, claro y oscuro (11)

## Rutas y progreso

(se rellena por tarea: ruta inline/delegada, evidencia RED/GREEN, commit)

## Notas de delegacion

`AGENTS.md` obliga a subagentes con el modelo `Space Bunny Free`, que no es seleccionable
desde la herramienta de agentes. Por esa regla ("si un subagente necesita otro modelo, se
hace la tarea aqui") el trabajo se hace inline.

### T1 (inline)
- RED: 8/8 fallan en `apps/api/test/move-between-workspaces.test.ts`, incluido el bookmark: `workspaceId` estaba en la lista blanca pero `sanitisePayload` no lo asignaba, asi que mover un bookmark de espacio se perdia en silencio.
- GREEN: 8/8. Suite API 830 passed, `tsc` limpio (hubo que reconstruir `packages/contracts/dist`).
- Diseno: `prepararMudanza` valida origen y destino, resuelve el contenedor contra el destino y deja la raiz si no viene; `seguirMudanza` arrastra el subarbol de una carpeta y los bookmarks de una coleccion.

### T2 + T3 (inline)
- RED: `apps/mobile/test/move-plan.test.ts` (modulo inexistente). GREEN: 6/6.
- `lib/move/plan.ts` (puro) decide campos y filas arrastradas; `lib/move/actions.ts` hace un `localUpdate` por la fila movida y refleja en cache lo que el servidor arrastra, sin encolar.
- Registro: accion `move` en las cinco entidades, antes de `delete`; oculta si `shared` o `viewer`. Pagina `MovePage` (reusa `PlacePicker`, nuevo `excludeFolderId`).
- Los tests de paridad del menu se actualizaron a mano tras leer cada diff: era solo la fila `move` y la etiqueta `move.title`.
- Suite mobile 1905 passed, `tsc` limpio.
- PENDIENTE: verificacion visual en web (claro/oscuro) del flujo mover; se hace en T12 con la app levantada.

### T5 (inline)
- RED: `bookmarks-list.test.ts` afirma que el drawer ya no declara `/bookmarks`. GREEN: quitada la entrada; la pantalla `bookmarks.tsx` se conserva porque la abren los espacios. Mobile 1906 passed, `tsc` limpio.

### T6 (inline)
- Entrada "Sin clasificar" por espacio/carpeta (`UnclassifiedEntry`, montada en `ContentList`): abre `/bookmarks` con `collectionId=unclassified`. El inbox global muestra `Espacio › Carpeta` en cada fila (`LinkRow.lugar`, `SpacesTree.pathOf`).
- Sin RED: es UI sobre hooks de React que Node no puede montar; se cubre con typecheck, el guard de rutas refinado (`collection-screen.test.ts`) y la verificacion visual en T12. Mobile 1906 passed, `tsc` limpio.

### T4 (inline)
- Decision: opcion A de `bookmark-without-workspace.md` (nullable de verdad). `bookmarks.workspace_id` nullable + `owner_id` + CHECK (migracion 0027). La pertenencia de un enlace sin espacio sale de `owner_id`; `assertCanWrite(null)` pasa sin mirar, asi que se anade `assertOwnsUnassigned` en update y delete.
- RED: `apps/api/test/bookmarks-unassigned.test.ts` (4 fallan). GREEN: 6/6. Mas dos tests en `move-between-workspaces.test.ts` tras ver que la mudanza de un bookmark descartaba la coleccion de destino que manda `AssignSheet`.
- Pull: el bloque de bookmarks ya no depende de `hayAlgoQueTraer` (quien no tiene espacios tambien tiene enlaces sin asignar). No se pueden compartir ni llevar carpeta/coleccion.
- Cliente: `ShareSaveSheet` gana "Guardar sin espacio" (`lugarDeGuardado`, RED/GREEN en `share-intent.test.ts`); `AssignSheet` asigna/desasigna y deja de fijar el selector al espacio original (bug previo: el picker recibia `bookmark.workspaceId`); el inbox agrupa "Sin asignar".
- Tres guards refinados con motivo: shares CHECK ("la ultima que lo menciona"), triage sin `folderId` salvo asignar, tabla nullable. API 838 passed, mobile 1909 passed, `tsc` limpio.
- Fuera de alcance: compartir un enlace sin espacio (se rechaza con 422).

### T10 (inline)
- La descripcion (`list_items.annotation`, 2000 chars, texto plano) pasa de un `TextField` de tres lineas a una pagina propia `description` dentro de `ItemEditSheet` (mismo patron que `icon`/`tags`: morph, volver con la flecha). La pagina de edicion solo lleva una fila-resumen.
- El titulo queda como unico campo: se quita `useFieldChain` (un "siguiente" sin destino). Guard de teclado actualizado con motivo.
- Tests de fuente en `item-description-page.test.ts` (UI de React no montable en Node). Mobile 1912 passed, `tsc` limpio.
- DECISION PENDIENTE DEL USUARIO: "que sea una nota" (formato rico) no se hizo. Requiere una columna `document` en `list_items` con la misma sanitizacion que las notas, y reusar el editor; queda como tarea aparte. Las imagenes dependen de S3, como se dijo.
