# Bookmarks fase 4: el lector, la lista y el inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Leer un articulo guardado sin conexion, ver todos los bookmarks en una lista, y triar los sin clasificar desde una entrada del menu con contador.

**Architecture:** Tres pantallas Expo Router que leen de la cache local-first (`cached_entities` via hooks con el patron de `useNotes`), un `DocumentView` que renderiza el conjunto cerrado de 12 tags sin editor, y un inbox que es una vista (`collection_id IS NULL`) con triage por `updateBookmarkAction`. La extraccion se dispara al abrir un `pending` (tal como anticipa el comentario de `lib/api/bookmarks.ts:9-10`) y el reintento de un `failed` es `POST extract` otra vez. Nada nuevo en `apps/api`: todo lo que estas pantallas necesitan ya existe.

**Tech Stack:** Expo Router, `useNotes`-pattern hooks sobre `store.listCached`, `Sheet` propio, `ListRow`/`EmptyState`/`Esqueleto`, `Image` de RN con `width`/`height` del documento, `Linking.openURL` para enlaces salientes.

**Spec:** `docs/superpowers/specs/2026-10-05-bookmarks-share-target-design.md` — seccion de UI ("C El lector", "D La lista", "Sin clasificar es una vista"). El plan razona desde ahi; los conflictos se resuelven contra el spec.

**Mapping (medido, no re-medir):** handoff de exploracion en sesion (`notes.tsx` 197 lineas como molde, `note/[noteId].tsx:112,117-118`, `use-notes.ts:51-73`, `use-lists.ts:63-82`, `use-spaces-tree.ts:165-166 collectionsOf`, `drawer.tsx:68-118` + badge de invitaciones `:542-582`, `header-action.tsx:109`, `empty-state.tsx:40`, `Esqueleto` en `item/[itemId].tsx:1164-1178`, `bookmark-service.ts:13,109-124`, `extract-service.ts:219-221,238-250,300-330`, `triggerExtract` en `lib/api/bookmarks.ts:12-14`, `updateBookmarkAction` en `lib/bookmarks/actions.ts:119`).

## Global Constraints

- **Comentarios y prosa en espanol SIN tildes.** Cada string nuevo de UI va **dos veces** en `lib/i18n/dictionaries.ts` (es ~816, en ~1637). La clave `place.unclassified` ("Sin clasificar"/"Unclassified", `:823`/`:1853`) ya existe: reusarla, no duplicarla.
- **Design tokens only**: `useTheme()` (`SPACING`, `RADIUS`, `colors.skeleton` en `theme/tokens.ts:112,129,166`). Nada hardcodeado.
- **Rutas**: lista en `app/(app)/bookmarks.tsx`, detalle en `app/(app)/bookmark/[bookmarkId].tsx`, inbox en `app/(app)/unclassified.tsx` (o la ruta que el drawer use; seguir el patron `route`+`path` de `drawer.tsx:56-67`). Navegacion estilo `router.push({ pathname: "/bookmark/[bookmarkId]", params: { bookmarkId: id } })` como `notes.tsx:170-172` (sin grupo en el string).
- **El lector NUNCA escribe.** Ni cursor, ni autosave, ni `EnrichedTextInput`. Un articulo leido no es una nota editable: servirlo en el editor dejaria pisarlo sin querer (decision de la spec, con la alternativa `NoteEditor readOnly` descartada por ser componente de editor).
- **Los cuatro estados se pintan distinto** porque significan cosas distintas: `pending` -> skeleton + "trayendo el texto"; `ready` -> articulo; `metadata_only` -> portada + "abrir original", **sin boton de reintentar** (`extract-service.ts:305-306`: reintentar no arregla); `failed` -> enlace + "reintentar".
- **`metadata_only` no ofrece reintento. Nunca.** Es la respuesta correcta a un no-articulo, no un error.
- **Sin dependencias nuevas.** `noUnusedLocals` activo.
- Commits Conventional Commits, espanol, sin tildes. **NUNCA `Co-Authored-By` ni atribucion de IA.**
- **No tocar** `apps/api`, `packages/contracts`, `ContentList`/`content-order.ts` (el browser de carpetas es follow-up declarado), ni el arbol `Children` del drawer (solo entradas de nivel superior).

## Review Focus

1. **Un `document` con tags fuera del conjunto cerrado.** Readability devuelve `div`/`span`/`sup`/`figure`; la reduccion de fase 2 los desenvuelve, pero un documento viejo o manipulado puede traer cualquier cosa. Lo esperable: lo no permitido no se renderiza ni rompe la pantalla (se omite el nodo o se muestra su texto plano), nunca un crash ni HTML crudo en pantalla. *Tarea 2.*
2. **Una imagen remota que no carga o es `169.254.x.x`.** La fase 2 filtra literales en la reduccion y resuelve `og:image` en servidor, pero un `src` con nombre DNS interno o una URL muerta llega igual. Lo esperable: placeholder o nada, jamas un crash ni un reintento infinito. *Tarea 2.*
3. **Abrir un `pending` sin red.** Lo esperable: skeleton + enlace guardado visible, sin spinner eterno ni error. El disparo de extraccion es best-effort y su fallo es silencioso. *Tarea 4.*
4. **Borrar una coleccion con 50 bookmarks mientras se mira el inbox.** Caen 50 filas a "sin clasificar" de golpe (`deleteCollection` los huerfana a proposito). Lo esperable: el contador sube y la lista los muestra, sin crash por filas que cambian bajo los pies. *Tarea 5.*
5. **Un enlace saliente (`<a href>`) con `javascript:` o sin esquema.** Lo esperable: solo `http(s)` se abre; el resto no hace nada. Un tap nunca ejecuta codigo. *Tarea 2.*

## Estructura de archivos

**Crear**
| archivo | responsabilidad |
| --- | --- |
| `apps/mobile/src/hooks/use-bookmarks.ts` | `useBookmarks(filters)` + `useBookmark(id)` + `useUnclassifiedCount(workspaceId?)`, patron `useNotes` |
| `apps/mobile/src/components/bookmarks/document-view.tsx` | render del conjunto cerrado, sin edicion |
| `apps/mobile/src/app/(app)/bookmarks.tsx` | lista (molde `notes.tsx`), filtro por coleccion, `useHeaderAction` |
| `apps/mobile/src/app/(app)/bookmark/[bookmarkId].tsx` | lector con los cuatro estados |
| `apps/mobile/src/app/(app)/unclassified.tsx` | inbox agrupado por espacio + triage |
| `apps/mobile/src/components/bookmarks/assign-sheet.tsx` | hoja para asignar coleccion a un bookmark existente (reusa `PlacePicker`) |

**Modificar**
| archivo | que cambia |
| --- | --- |
| `apps/mobile/src/components/layout/drawer.tsx` | entradas Bookmarks + Sin clasificar (con `Badge` como la fila de invitaciones `:572-580`) |
| `apps/mobile/src/lib/i18n/dictionaries.ts` | strings es+en |
| `apps/mobile/src/hooks/use-local-search.ts` (o donde viva `useLocalSearch`) | sumar `bookmark` al alcance (titulo + `plainText`), con su cap |
| `apps/mobile/src/app/share/save.tsx` | `onSaved` navega con `highlight` (cierra el `TODO(fase-4)` de `:57`) |
| `apps/mobile/src/lib/bookmarks/actions.ts` | `deleteBookmarkAction` si no existe (tombstone, molde `deleteNoteAction`) |

---

### Task 1: Los datos (`useBookmarks`, conteo, busqueda)

**Files:**
- Create: `apps/mobile/src/hooks/use-bookmarks.ts`
- Modify: el archivo de `useLocalSearch` (sumar `bookmark` al alcance)
- Test: `apps/mobile/test/use-bookmarks.test.ts` (o el arnes que usen los tests de hooks/store)

**Interfaces:**
- Consumes: `store.listCached("bookmark")` / `store.getCached("bookmark", id)` (mismo `local-store` que `use-notes.ts:62`), `subscribeToLocalStore` (`use-notes.ts:68-73`), `SyncEntity` ya ampliado (fase 1).
- Produces: `useBookmarks(filters: { workspaceId?; folderId?: string|null; collectionId?: string|null|'unclassified'; })`, `useBookmark(id: string|null)`, `useUnclassifiedCount(workspaceId?: string)`. Tasks 3-5 los consumen.

- [ ] **Step 1: `useBookmarks` + `useBookmark`, calcados de `useNotes`**

`use-notes.ts:51-73` es el molde linea por linea: `listCached("bookmark")`, merge de pending sobre servidor (mirar `readNoteFromRow :33-49` y hacer el equivalente `readBookmarkFromRow`), filtro por workspace/carpeta/coleccion, orden `updatedAt desc` (es "leer despues": lo ultimo guardado arriba; distinto del `createdAt` de notas y a proposito), suscripcion con `subscribeToLocalStore`, y el truco `filterKey=JSON.stringify(filters)` (`:58`) para las deps.

`collectionId: 'unclassified'` filtra por `IS NULL` en cliente (`collectionId == null`); `undefined` es "sin opinion" (igual que `folderId` en `notes.tsx:41-47`).

`useBookmark(id)` como `useNote` (`use-notes.ts:89-103`): `getCached`, tombstone -> null. **Ojo**: la fila cacheada puede no traer `document`/`plainText` si vino del listado REST (el listado los recorta, `bookmark-service.ts:109-117`); el lector (Task 4) decide de donde leer el texto completo. Este hook devuelve lo que haya en cache sin inventar.

- [ ] **Step 2: `useUnclassifiedCount`, para el badge del drawer**

```ts
export function useUnclassifiedCount(workspaceId?: string): number {
  // store.listCached("bookmark") -> filtrar workspaceId (si viene) + collectionId==null + !deletedAt -> .length
  // suscrito a subscribeToLocalStore, como useNotes
}
```

Una lectura cacheada, sin red, con live-update. El patron a copiar es el filtro puro `selectCollections` (`use-spaces-tree.ts:196-213`): funcion pura exportada + hook fino que la llama, para testearla sin React. **Sin endpoint de conteo en servidor**: un round-trip por render del drawer se queda rancio offline, que es justo cuando el badge mas importa.

- [ ] **Step 3: Sumar `bookmark` a la busqueda local**

`useLocalSearch` itera `workspace|folder|list|list_item|note` y en notas casa `title`+`plainText` con cap 50. Agregar `bookmark` al alcance con `title`+`plainText` (es el indice trigram del cliente, analogo al del servidor en `0022`). **Aditivo (~10 lineas)**: no reescribir el buscador, no tocar el `/search` del servidor.

- [ ] **Step 4: Tests**

```ts
describe('useBookmarks', () => {
  it('filtra por coleccion y por sin-clasificar', ...);
  it('ordena por updatedAt descendente', ...);
  it('una tombstone no sale', ...);
});
describe('useUnclassifiedCount', () => {
  it('cuenta solo vivos sin coleccion del espacio', ...);
  it('borrar una coleccion sube el conteo', ...);  // Review Focus #4, lado datos
});
```

El segundo de conteo es Review Focus #4 en su forma de datos: simular el huerfanado (50 filas con `collectionId` a null) y afirmar 50.

- [ ] **Step 5: Run y commit**

Run: tests nuevos + suite mobile + typecheck. Expected: PASS.

```bash
git add apps/mobile/src/hooks/use-bookmarks.ts apps/mobile/src/hooks/ apps/mobile/test/use-bookmarks.test.ts
git commit -m "feat(mobile): hooks de bookmarks y conteo de sin-clasificar, desde la cache"
```

---

### Task 2: `DocumentView` (el lector sin editor)

**Files:**
- Create: `apps/mobile/src/components/bookmarks/document-view.tsx`
- Test: `apps/mobile/test/document-view.test.ts`

**Interfaces:**
- Consumes: `noteDocumentSchema`-validado `document: string` (el lector lo recibe ya validado; si no valida, no se renderiza — ver Step 5), `IMAGE_DIMENSIONS`/`MAX_IMAGE_EDGE` (`note-document.ts:46-47`, tope 16384), `useTheme()`.
- Produces: `<DocumentView document={...} />` que solo lee. Task 4 lo monta.

> **Por que esto existe y no se reusa el editor.** `NoteEditor readOnly` es un componente de editor (`EnrichedTextInput` nativo) usado una vez para previsualizar plantillas. Un articulo con imagenes remotas y enlaces salientes en modo solo-lectura no esta verificado ahi, y el editor trae cursor, teclado y autosave a una pantalla que no los quiere. Doce tags son acotados; un renderer propio es mas chico que auditar el editor.

- [ ] **Step 1: El parser minimo, sin DOM y sin dependencias**

El `document` es HTML del conjunto cerrado. Parsearlo con un tokenizer a mano (o con las mismas primitivas que `note-document.ts` expone si son importables desde mobile): pila de tags, texto entre tags, atributos `href`/`src`/`width`/`height`/`alt`. **Sin `jsdom`, sin `WebView`, sin `RenderHtml`**: el formato es tan chico que un parser completo es mas superficie que el problema.

- [ ] **Step 2: Un componente por familia, con tokens**

`h1`-`h6` -> `AppText` con escala tipografica del theme; `p` implicito (el texto suelto de Readability vive en `<p>`); `b/i/u/s/code` -> inline; `a` -> texto con `onPress={() => void Linking.openURL(href)}` **solo si `href` empieza por `http://` o `https://`** (Review Focus #5: un tap nunca ejecuta codigo); `blockquote`/`codeblock` -> bloque con fondo `surfaceSunken`; `ul`/`ol` -> filas con vineta/numero; `img` -> `<Image source={{ uri: src }}>` con `width`/`height` del documento capados por `MAX_IMAGE_EDGE`, y **placeholder/error silencioso** si no carga (Review Focus #2: jamas un crash ni reintento infinito); `br` -> salto.

Todo con `useTheme()`: ni un color, espaciado ni radio hardcodeado.

- [ ] **Step 3: Lo que NO se renderiza**

Cualquier tag fuera del conjunto (un `div` que sobrevivio, un `sup`, un `script`): **se omite el nodo y se conserva su texto plano** si lo tiene (misma regla que la reduccion de fase 2: unwrap, no descartar). **Jamas HTML crudo en pantalla.** Un `img` sin `src` http(s) valido se omite entero (con su `alt`: sin imagen no hay nada que describir en un lector).

- [ ] **Step 4: Write the failing tests — los cinco Review Focus en forma de test**

```ts
describe('DocumentView', () => {
  it('un div con texto se muestra como texto, sin crash', ...);          // RF #1
  it('un script no se ejecuta ni se muestra', ...);                       // RF #1
  it('una imagen rota muestra placeholder y no rompe la pantalla', ...);  // RF #2
  it('un a[href="javascript:"] no hace nada al tocarlo', ...);            // RF #5
  it('un a[href] relativo no se abre', ...);                              // RF #5
  it('doce tags exactos renderizan sin perdidas', ...);                   // un doc con los 12
});
```

- [ ] **Step 5: La guarda de entrada**

`DocumentView` valida su prop con `noteDocumentSchema.safeParse` (o recibe el resultado ya parseado del llamador): si no valida, renderiza **nada** (o un `EmptyState` de "no se puede mostrar") en vez de intentar adivinar. Un documento invalido en pantalla es el fallo que la frontera de seguridad existe para evitar.

- [ ] **Step 6: Run y commit**

Run: tests nuevos + suite + typecheck. Expected: PASS.

```bash
git add apps/mobile/src/components/bookmarks/document-view.tsx apps/mobile/test/document-view.test.ts
git commit -m "feat(mobile): DocumentView lee los doce tags, sin editor ni ejecucion"
```

---

### Task 3: La lista + el drawer

**Files:**
- Create: `apps/mobile/src/app/(app)/bookmarks.tsx`
- Modify: `apps/mobile/src/components/layout/drawer.tsx` (dos entradas)
- Modify: `apps/mobile/src/lib/i18n/dictionaries.ts` (es+en)
- Modify-or-create: `deleteBookmarkAction` en `apps/mobile/src/lib/bookmarks/actions.ts` (solo si no existe)
- Test: lo que pida el patron de tests de pantallas/listas del repo

**Interfaces:**
- Consumes: `useBookmarks` (Task 1), `useHeaderAction` (`header-action.tsx:109`), `ListRow`/`EmptyState` (patron `notes.tsx:136-175,155-159`), `deleteBookmarkAction` (tombstone).
- Produces: rutas `/bookmarks` y entradas del drawer. Task 4 enlaza el detalle desde aqui.

- [ ] **Step 1: `deleteBookmarkAction`, solo si no existe**

Verificar si existe en `lib/bookmarks/actions.ts`. Si no: tombstone calcado de `deleteNoteAction` (`lib/notes/actions.ts:101-130`): `upsertCached` con `deletedAt` + `enqueueOperation({ kind: 'delete', ... })` explicito.

**Verificado al escribir el plan, no hace falta re-verificarlo**: `localUpdate` (`sync-service.ts:479-514`) **si encola solo** un `update` (`:507-514`), asi que `updateBookmarkAction` (solo `localUpdate`, sin enqueue explicito) mete **una** operacion y esta bien. Pero un delete **no** es un update: necesita el `enqueueOperation kind:'delete'` explicito como hace `deleteNoteAction`. Un verbo menos o uno de mas en el outbox es el defecto, y aqui el verbo correcto esta decidido.

- [ ] **Step 2: La lista, calcada de `notes.tsx` (197 lineas, el molde)**

`useBookmarks({ workspaceId, folderId?, collectionId? })` desde params de ruta (filtro por coleccion opcional, para reusar la lista dentro de una coleccion); filas `{ id, title, subtitle: host + estado, icon, rightLabel: siteName }` en `ListRow` con chevron; `onPress` -> `router.push({ pathname: "/bookmark/[bookmarkId]", params: { bookmarkId: id } })` (forma de `notes.tsx:170-172`); `EmptyState` con copy propio; **sin pull-to-refresh** (la pantalla molde no lo tiene: no inventar patrones).

La fila muestra el **estado de extraccion** (un punto o icono por `pending`/`ready`/`metadata_only`/`failed`): es lo que distingue esta lista de la de notas, y lo que hace visible el pipeline de fase 2.

- [ ] **Step 3: El drawer, con el patron de invitaciones**

Dos entradas en `DESTINATIONS` (`drawer.tsx:68-118`): Bookmarks y Sin clasificar, con `route`+`path` segun la convencion (`:56-67`). La de inbox con `<Badge label={String(n)}>` condicional a `n > 0`, calcado de la fila de invitaciones (`:542-580`, `testID` propio para el badge). **No tocar el arbol `Children`**: solo entradas de nivel superior (gotcha del mapeo: el arbol muestra carpetas+listas y las colecciones ahi son follow-up).

- [ ] **Step 4: Strings, orden y commit**

Strings en es+en. **Orden por defecto `updatedAt desc`** (spec, seccion D: "leer despues" es lo ultimo guardado arriba; distinto del `createdAt` de notas y a proposito).

```bash
git add apps/mobile/src/app/\(app\)/bookmarks.tsx apps/mobile/src/components/layout/drawer.tsx apps/mobile/src/lib/i18n/dictionaries.ts apps/mobile/src/lib/bookmarks/actions.ts
git commit -m "feat(mobile): la lista de bookmarks y sus dos entradas en el drawer"
```

---

### Task 4: El lector (los cuatro estados)

**Files:**
- Create: `apps/mobile/src/app/(app)/bookmark/[bookmarkId].tsx`
- Modify: `apps/mobile/src/app/share/save.tsx` (`onSaved` con `highlight`, cierra el `TODO(fase-4)`)
- Test: lo que pida el patron

**Interfaces:**
- Consumes: `useBookmark(id)` (Task 1), `DocumentView` (Task 2), `triggerExtract` (`lib/api/bookmarks.ts:12-14`), `noteDocumentToPlainText` si hace falta fallback (no reimplementar).
- Produces: la pantalla de lectura. Nada mas lo consume salvo la lista (Task 3) y el inbox (Task 5).

- [ ] **Step 1: La pantalla con sus cuatro ramas**

```tsx
const { bookmarkId } = useLocalSearchParams<{ bookmarkId: string }>();
const { bookmark, isLoading } = useBookmark(bookmarkId ?? null);
```

- `isLoading` o sin fila -> `Esqueleto` (copiar el patron local de `item/[itemId].tsx:1164-1178` con `colors.skeleton`, a11y-hidden) — **no hay `Skeleton` generico en el repo**, no crear uno global por esta pantalla.
- `pending` -> skeleton + titulo/host si se conocen + **disparo de extraccion al montar** (best-effort, sin await, sin toast; si no hay red no pasa nada y el estado sigue `pending`). Es lo que anticipa el comentario de `lib/api/bookmarks.ts:9-10`.
- `ready` -> portada si hay `imageUrl`, titulo, host, fecha, `<DocumentView document={bookmark.document} />`. **El texto sale de la fila completa**: si la cache solo tiene el recorte del listado (sin `document`), pedir `GET /:id` (detail completo, `bookmark-service.ts:120-124`) o esperar al pull. Decidir en codigo con un comentario: cache-con-documento vs fetch.
- `metadata_only` -> portada + metadata + **"abrir original"** (`Linking.openURL(url)`), **sin boton de reintentar**.
- `failed` -> enlace + motivo corto (`extractionError`) + **"reintentar"** (= `triggerExtract` otra vez; el servidor no-op si ya esta `ready`).

Header con accion "abrir original" (`useHeaderAction`, patron `notes.tsx:134`).

- [ ] **Step 2: `share/save.tsx` cierra su `TODO(fase-4)`**

`onSaved`: `clearShare()` + `router.replace({ pathname: '/bookmark/[bookmarkId]', params: { bookmarkId: id } })` (o a la lista con `highlight`; decidir una y coordinar el nombre del param con la Task 2 del mapping: el `TODO` decia `highlight=<id>`). **Una sola forma de navegar tras guardar**, no dos segun el humor.

- [ ] **Step 3: Tests + commit**

Los cuatro estados con filas fabricadas (pending sin red simulada, ready con doc de 12 tags, metadata_only sin boton de retry, failed con retry que llama `triggerExtract`).

```bash
git add apps/mobile/src/app/\(app\)/bookmark/ apps/mobile/src/app/share/save.tsx
git commit -m "feat(mobile): el lector con sus cuatro estados, y el share aterriza en el"
```

---

### Task 5: El inbox ("Sin clasificar", con triage)

**Files:**
- Create: `apps/mobile/src/app/(app)/unclassified.tsx`
- Create-or-reuse: hoja de asignar coleccion (`assign-sheet.tsx` nuevo o `ShareSaveSheet` en modo asignar)
- Test: lo que pida el patron

**Interfaces:**
- Consumes: `useBookmarks({ collectionId: 'unclassified' })` o por espacio, `useUnclassifiedCount` (Task 1), `PlacePicker` (fase 3), `updateBookmarkAction` (fase 1), `deleteBookmarkAction` (Task 3 si se creo).
- Produces: el triage. Es la ultima pieza visible del feature.

- [ ] **Step 1: La vista, agrupada por espacio**

`WHERE collection_id IS NULL` cruzando espacios, agrupado por workspace (el inbox no es un lugar: es una vista). Cada fila: titulo/host/estado + accion "clasificar". Contador arriba que coincide con el badge del drawer (misma fuente: `useUnclassifiedCount`).

**Review Focus #4 en forma de pantalla**: simular 50 huerfanos (test) y afirmar que la pantalla los muestra sin crash. Las filas cambian bajo los pies cuando se borra una coleccion; la suscripcion del hook lo absorbe.

- [ ] **Step 2: El triage (clasificar sin salir)**

Al tocar "clasificar": hoja con `PlacePicker` (colecciones del espacio + crear nueva + sin cambio de espacio). Al elegir: `updateBookmarkAction({ id, collectionId })` y **nada mas** — el `folderId` lo deriva el servidor de la coleccion (invariante de fase 1, Task 4). No mandar `folderId` a mano: mandarlo y que discrepe es 422.

¿Hoja nueva o `ShareSaveSheet` en modo asignar? **Hoja nueva y chica** (`assign-sheet.tsx`): `ShareSaveSheet` crea bookmarks nuevos con su guard de doble-guardado y su `onSaved`; adaptarla a "reasignar uno existente" es mas friccion que una hoja de 100 lineas que reusa `PlacePicker`. Decidir en codigo y dejarlo escrito.

- [ ] **Step 3: Borrar desde el inbox y desde la lista**

Si `deleteBookmarkAction` existe (Task 3): las dos pantallas lo usan con confirmacion (`Sheet` con doble boton, patron `place-share-sheet.tsx:263-276`). Si no existe: no inventarlo aqui, vuelve a la Task 3.

- [ ] **Step 4: Verificacion de la fase (web + emulador, segun AGENTS.md)**

UI nueva = verificar en **web, en claro y en oscuro** (regla del repo). Ademas, al menos el lector con un articulo real en el emulador Android (`emulator-5554`, patron `adb reverse` + `monkey` + `screencap` de AGENTS.md), porque web no dice nada de `Image` remotas ni de `Linking`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/app/\(app\)/unclassified.tsx apps/mobile/src/components/bookmarks/assign-sheet.tsx
git commit -m "feat(mobile): el inbox de sin-clasificar, con triage a coleccion"
```

---

## Fuera de esta fase

- **Colecciones y bookmarks en el browser de carpetas** (`ContentList` + `toRow` + `Children` del drawer): los tipos estan listos (`ContentRow.kind`, `ENTITY_DE`), faltan los dos mappers. Follow-up declarado, no de esta fase.
- **`useLocalSearch` del servidor** (`GET /search`): solo se extiende el cliente. El servidor es otro trabajo.
- **Reintento con backoff / cola de trabajos**: `extractionState` lo soporta; hoy es best-effort al abrir.
- **Duplicados, busqueda semantica, `linkedom`**: fuera de toda la spec.
- **Verificacion manual del share en dispositivo** (fase 3, `partial` declarado): sigue pendiente de build nativo y no lo cubre esta fase.

## Decisiones reversibles

**`assign-sheet.tsx` nuevo en vez de reusar `ShareSaveSheet`** (Task 5, Step 2). Si la hoja de asignar y la de guardar convergen, fusionarlas es borrar una. Lo que **no** es reversible barato es acoplar el triage al flujo de creacion (guard de doble-guardado, `onSaved` con navegacion): por eso se separan.
