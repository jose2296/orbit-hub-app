# Bookmarks sin clasificar: poder verlos y poder moverlos

Pedido del usuario (2026-10-08). Tres puntos. **Mapeados el 2026-10-09**: los tres son
posibles, pero no cuestan lo mismo, y uno es profundo.

## 1. Poder entrar a verlos — UI pura, barato

`unclassified.tsx:63` ya sabe pedirlos: `useBookmarks({ collectionId: "unclassified" })`, y
`use-bookmarks.ts:85` tiene el centinela documentado. La app ya filtra; lo que falta es
**una pantalla a la que entrar**.

Hoy se ve la lista de filas, pero no se puede abrir nada, y para clasificar un enlace hace
falta saber cual es.

**No hace falta cambio de contrato.** La opcion que parece natural — reusar la pantalla de
coleccion con `collectionId: null` — es tentadora y probablemente este mal: una cosa es un
bucket vacio y otra una coleccion con nombre, icono y acciones propias. Pero **tambien** es
cierto que la fila de enlace ya es una sola (`components/bookmarks/link-row.tsx`, montada
desde las tres pantallas), asi que el coste de una pantalla propia es bajo.

## 2. Mover uno a otro sitio — cambio de contrato, medio

El bloqueo esta escrito en el codigo, en `assign-sheet.tsx:38`:

> *"Sin cambio de espacio: el bookmark no se muda (`updateBookmarkAction` no acepta
> `workspaceId`, igual que una nota), asi que el espacio queda fijo al suyo"*

Y el picker **vuelve activamente** al espacio del bookmark si tocas otro (`:80`: `if
(lugar.workspaceId !== bookmark.workspaceId)` → resetea carpeta y coleccion).

Lo que haria falta, en orden:

1. `BookmarkChanges` (`actions.ts:104`) gana `workspaceId?: string | null`.
2. `updateBookmarkAction` (`:119`) lo pasa a `cambios`.
3. **La ruta de la API** acepte `workspaceId` en el update de un bookmark.
4. El picker (`assign-sheet.tsx:73-86`) deje de saltar al espacio suyo.

**`bookmarkSchema.workspaceId` sigue siendo obligatorio** (`bookmarks.ts:91`,
`uuidSchema`), asi que esto es *cambiar* el espacio, no quitarlo. No toca la propiedad ni
los permisos: es mas superficial de lo que parece.

El propio `assign-sheet.tsx:35-36` dice que reasignar es "una hoja de cien lineas que reusa
`PlacePicker`", y que si las dos convergen, fusionarlas es borrar una.

## 3. Crear uno sin espacio — profundo, es su propia feature

`bookmarkSchema.workspaceId` es `uuidSchema`, **no nullable**. Y no es un detalle de forma:
`createBookmarkAction` (`:93`) lo manda en el payload del create, y el servicio de la API lo
usa para **de quien es**.

Hacerlo nullable riega:

- la ruta de create de la API,
- todas las consultas que filtran por `workspaceId` (incluida la inbox y los grants de
  compartir, que T10 acaba de ensanchar),
- los chequeos de propiedad del servidor, que `AGENTS.md` pone del lado de la API y nunca
  del cliente.

**Esto no es una fila mas.** Es su propia spec y su propio plan, y conviene hacerlo cuando
no haya nada a medias.

## Lo que NO es de aca

Nada de esto es T10 del registro de menus. T10 era compartir una coleccion o un enlace.

## Relacion con lo que ya esta hecho

- La fila de enlace ya es **una** (`LinkRow`), montada desde `bookmarks.tsx`,
  `unclassified.tsx` y `collection/[collectionId].tsx`. Eso abarata el punto 1.
- `assign-sheet.tsx:203` calcula el titulo del enlace **sin el `host`**, o sea ya
  divergente de `tituloDeBookmark`. Queda pendiente unificarlo, y es de aqui.
