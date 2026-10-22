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
- [ ] T4 Bookmarks sin workspace (`workspaceId` nullable) (puntos 2 y 3)
- [ ] T5 Drawer: quitar menu generico de bookmarks (9)
- [ ] T6 Sin clasificar: mostrar workspace y carpeta (10)
- [ ] T7 Toolbar de notas contextual (4)
- [ ] T8 Diario: siempre editable, enlaces vivos, swipe coherente (5 parte 2, 7)
- [ ] T9 Diario: copiar/mover nota a otro dia (5 parte 1)
- [ ] T10 Descripcion de tarea en bottom sheet grande (6)
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
