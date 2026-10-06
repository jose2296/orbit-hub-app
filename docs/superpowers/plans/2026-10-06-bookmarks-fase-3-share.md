# Bookmarks fase 3: el share sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compartir una URL desde otra app abre OrbitHub en una hoja que pregunta donde guardarla (workspace, carpeta, coleccion existente o nueva, o sin clasificar), la guarda offline-first y dispara la extraccion en segundo plano.

**Architecture:** El intent nativo lo recibe `expo-sharing` (ya instalado, hoy solo en modo outbound) con su config plugin activado para inbound; un `app/+native-intent.ts` reescribe el path a una ruta propia `app/share/save.tsx` registrada **fuera** del guard de auth (el precedente exacto es `invite/[token].tsx`); la hoja compone un `PlacePicker` extraido de `WhereNoteSheet` mas un selector de colecciones leido de la cache local; el guardado usa `createBookmarkAction` (fase 1) y dispara `POST /bookmarks/:id/extract` (fase 2) fire-and-forget.

**Tech Stack:** `expo-sharing ~57.0.22` (`getSharedPayloads`, `useIncomingShare`, `clearSharedPayloads`), Expo Router (`+native-intent.ts`, `redirectSystemPath`), `useSpacesTree`, `Sheet` propio.

**Spec:** `docs/superpowers/specs/2026-10-05-bookmarks-share-target-design.md` — secciones "El share sheet" y "El share llega en frio". El plan razona desde ahi; los conflictos se resuelven contra el spec.

**Mapping (medido, no re-medir):** handoff de exploracion en la sesion (expo-sharing API, `invite/[token].tsx:21-25,84-101`, `_layout.tsx:146-155`, `(app)/_layout.tsx:70-76`, `sign-in.tsx:24-25,50`, `where-note-sheet.tsx` 195 lineas, `use-spaces-tree.ts:6-21`, `SheetProps` en `ui/sheet.tsx:31-70`, `api.post` en `lib/api/client.ts:387-397`, `POST /:id/extract` -> 204 en `apps/api/src/routes/bookmarks.ts:59-63`).

## Global Constraints

- **Comentarios y prosa en espanol SIN tildes.** Cada string nuevo de UI va **dos veces** en `lib/i18n/dictionaries.ts` (es ~linea 816, en ~1637): sin la segunda, la pantalla se rompe en ingles.
- **Design tokens only**: colores, espaciados y radios desde `useTheme()` (`SPACING`, `RADIUS` en `theme/tokens.ts:216-235`). Nada hardcodeado.
- **La ruta del share vive FUERA de `(app)`**, junto a `invite/[token]`. El guard de `(app)/_layout.tsx:70-76` manda a anonymous a `(onboarding)/welcome` y el enlace se pierde.
- **El payload compartido sobrevive por el store nativo, no por params de ruta.** `sign-up.tsx:59-60` hardcodea `router.replace('/(app)')` y tira `?next=`: un param no sobrevive a esa pantalla. `getSharedPayloads`/`clearSharedPayloads` si.
- **Sin dependencias nuevas.** `expo-sharing` ya esta instalado; solo cambia su configuracion.
- Commits Conventional Commits, espanol, sin tildes. **NUNCA `Co-Authored-By` ni atribucion de IA.**
- `noUnusedLocals` activo.
- **No tocar** `apps/api`, `packages/contracts`, `shares/pending-node.ts`, ni el drawer (las entradas de inbox/bookmarks son fase 4).

## Review Focus

Cinco entradas que la spec promete y que mas van a morder. Cada linea tiene su test en la tarea duena.

1. **Compartir con la app cerrada (cold start).** El intent tiene que abrir la app y aterrizar en la hoja con el enlace. Si solo funciona con la app abierta, la mitad de los shares se pierden. *Tarea 1.*
2. **Compartir sin sesion.** Si no hay token, la hoja no puede guardar; el enlace tiene que sobrevivir al login (incluyendo la pantalla de sign-up, que hoy tira `?next=`). *Tarea 1.*
3. **Un texto compartido que no es una URL** ("mira esto https://..." o texto sin enlace). Lo esperable: extraer la primera URL y usar el resto como titulo sugerido; sin URL, un error legible, no un bookmark roto. *Tarea 3.*
4. **Guardar dos veces el mismo share** (doble tap en Guardar, o reabrir la hoja sin limpiar). Lo esperable: un solo bookmark. *Tareas 3 y 4.*
5. **Crear la coleccion en el momento y que el bookmark caiga en su carpeta.** La regla de la spec (si hay coleccion, carpeta y espacio salen de ella) se resuelve en el servidor (fase 1), pero el cliente tiene que mandar los tres campos coherentes. *Tarea 3.*

## Estructura de archivos

**Crear**
| archivo | responsabilidad |
| --- | --- |
| `apps/mobile/src/app/+native-intent.ts` | `redirectSystemPath`: intents de `expo-sharing` -> `/share/save`, lo demas pasa |
| `apps/mobile/src/app/share/save.tsx` | ruta fuera del guard: lee el payload, pinta estados, abre la hoja |
| `apps/mobile/src/components/workspace/place-picker.tsx` | selector workspace+carpeta extraido de `WhereNoteSheet`, sin cromo de sheet |
| `apps/mobile/src/components/bookmarks/share-save-sheet.tsx` | la hoja: preview, titulo, destino, guardar |
| `apps/mobile/src/lib/bookmarks/share-intent.ts` | parseo texto->URL, `triggerExtract` fire-and-forget, `takePendingShare`/`clearShare` |
| `apps/api/test/`... nada | fase 3 no toca la API |

**Modificar**
| archivo | que cambia |
| --- | --- |
| `apps/mobile/app.json` | plugin `expo-sharing` con inbound Android+iOS |
| `apps/mobile/src/app/_layout.tsx` | registra `share/save` junto a `invite/[token]` |
| `apps/mobile/src/app/(auth)/sign-up.tsx` | preserva `?next=` como hace sign-in (una linea de lectura + destino) |
| `apps/mobile/src/components/notes/where-note-sheet.tsx` | pasa a envolver `PlacePicker` (mismo props, mismo copy) |
| `apps/mobile/src/hooks/use-spaces-tree.ts` (o nuevo `use-collections.ts`) | lector `collectionsOf(workspaceId, folderId)` desde `cached_entities` |
| `apps/mobile/src/lib/i18n/dictionaries.ts` | strings es+en de la hoja |

---

### Task 1: La plomeria nativa (intent -> ruta, con y sin sesion)

**Files:**
- Modify: `apps/mobile/app.json:46` (plugin `expo-sharing`)
- Create: `apps/mobile/src/app/+native-intent.ts`
- Create: `apps/mobile/src/app/share/save.tsx` (cascaron: estados loading/anonimo/vacio; la hoja llega en Task 3)
- Modify: `apps/mobile/src/app/_layout.tsx:146-155` (registrar `share/save`)
- Modify: `apps/mobile/src/app/(auth)/sign-up.tsx:59-60` (preservar `next`)
- Test: `apps/mobile/test/share-intent.test.ts` (parseo + `redirectSystemPath`, sin nativo)

**Interfaces:**
- Consumes: `APP_SCHEME`/`ANDROID_PACKAGE` de `@/config` si hace falta; nada mas.
- Produces: ruta `/share/save` alcanzable por intent; `redirectSystemPath({path, initial})` exportado; `sign-up` preservando `next`. Tasks 3-4 consumen la ruta.

> **Por que esta tarea va primera y no necesita emulador.** Todo lo verificable aqui es estatico o unitario: que el config genera los filtros, que el redirect mapea bien, que la ruta existe fuera del guard, y que `sign-up` ya no tira el destino. El share sheet de verdad (dedo en otra app, tap en OrbitHub) necesita build nativo y es verificacion manual de la Task 4.

- [ ] **Step 1: Activar inbound en el config plugin**

En `apps/mobile/app.json`, el string pelado `"expo-sharing"` pasa a:

```json
["expo-sharing", {
  "android": { "enabled": true, "singleShareMimeTypes": ["text/plain"] },
  "ios": { "supportsWebUrl": true }
}]
```

**Verificar los nombres exactos de las opciones contra `node_modules/expo-sharing/plugin/src/sharingPlugin.types.ts:75-86` antes de escribir**: si `singleShareMimeTypes` o `supportsWebUrl` no existen con esos nombres, el prebuild los ignora en silencio y el intent-filter no se genera. Solo `text/plain` (un enlace compartido es texto): nada de imagenes ni `VIEW` de `http` (eso secuestraria cada toque de link del sistema).

**No registrar `VIEW` para `http`/`https`.** Es la decision del spec y tiene motivo: aparecer en cada toque de link no es compartir, es secuestrar la navegacion.

- [ ] **Step 2: Verificar que el prebuild genera los filtros**

Run: `npx expo config --type prebuild --platform android 2>&1 | grep -A6 intent-filter | head -20` (desde `apps/mobile`)
Expected: un `intent-filter` con `ACTION_SEND` y `text/plain`. Si no aparece, el Step 1 esta mal escrito y hay que volver a el: **sin esto, OrbitHub no sale en el share sheet de ninguna app**.

- [ ] **Step 3: `+native-intent.ts`**

```ts
import { getSharedPayloads } from 'expo-sharing';

export async function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  try {
    if (new URL(path).hostname === 'expo-sharing') return '/share/save';
    return path;
  } catch {
    return '/';
  }
}
```

**`getSharedPayloads` se importa pero no se llama aqui**: el import es lo que ata el modulo nativo al arranque en frio. La lectura del payload es de la ruta (Task 4), no del redirect. Si el redirect intentara leer el payload, el arranque en frio lo perderia por carrera.

- [ ] **Step 4: La ruta `app/share/save.tsx`, fuera del guard**

Registrar en `app/_layout.tsx` junto a `invite/[token]` (`:146-148`), con el mismo comentario ("Outside the auth guard on purpose: ..."). En esta tarea la ruta es un cascaron con tres estados, calcado de `invite/[token].tsx:70-101`:

- `status === 'loading'` -> spinner (igual que invite `:70-80`).
- `status === 'anonymous'` -> tarjeta + `router.replace({ pathname: '/(auth)/sign-in', params: { next: '/share/save' } })` (igual que invite `:84-101`). **Sin el `next`, el enlace muere en el welcome.**
- con sesion y sin payload -> vista vacia que dice que no hay nada que guardar (el caso "abri la ruta a mano").

La hoja real (Task 3) y la lectura del payload (Task 4) llegan despues; este cascaron compila y es navegable a mano con `router.push('/share/save')`.

- [ ] **Step 5: `sign-up` preserva `next`, como ya hace sign-in**

`sign-up.tsx:59-60` hardcodea `router.replace('/(app)')`. Cambiar a la forma de `sign-in.tsx:24-25,50`:

```ts
const { next } = useLocalSearchParams();
const destination = next?.startsWith('/') ? next : '/(app)';
router.replace(destination);
```

**Sin esto, registrarse pierde el share**: el flujo anonymous -> sign-up -> `(app)` tira el destino. Es una linea de lectura y una de destino, y es la unica forma de que "compartir sin sesion" sobreviva a las dos pantallas de entrada.

- [ ] **Step 6: Tests sin nativo**

`apps/mobile/test/share-intent.test.ts`:

```ts
describe('redirectSystemPath', () => {
  it('un intent de expo-sharing va a /share/save', ...);   // hostname 'expo-sharing', con y sin initial
  it('cualquier otra cosa pasa', ...);                       // '/invite/x' sigue a '/invite/x'
  it('un path que no es URL va a /', ...);                   // el catch
});
describe('sacarUrlDelTexto', () => {
  it('una URL sola pasa limpia', ...);
  it('"mira esto https://..." saca la URL y deja el resto', ...);  // Review Focus #3
  it('texto sin URL da null con motivo', ...);
});
```

`sacarUrlDelTexto` vive en `lib/bookmarks/share-intent.ts` (se crea en esta tarea como funcion pura, aunque el resto del archivo llegue en la Task 4). **El test del redirect importa la funcion real de `+native-intent.ts`**: si el mapeo cambia, el test lo dice.

- [ ] **Step 7: Run y commit**

Run: `npm run typecheck --workspace` (mobile), `npm run api:test -- share-intent` (o el runner de tests mobile que corresponda)
Expected: PASS.

```bash
git add apps/mobile/app.json apps/mobile/src/app/+native-intent.ts apps/mobile/src/app/share/save.tsx apps/mobile/src/app/_layout.tsx apps/mobile/src/app/\(auth\)/sign-up.tsx apps/mobile/src/lib/bookmarks/share-intent.ts apps/mobile/test/share-intent.test.ts
git commit -m "feat(mobile): el intent nativo aterriza en /share/save, fuera del guard"
```

---

### Task 2: El destino como componente (`PlacePicker` + colecciones)

**Files:**
- Create: `apps/mobile/src/components/workspace/place-picker.tsx`
- Modify: `apps/mobile/src/components/notes/where-note-sheet.tsx` (pasa a envolverlo)
- Modify-or-create: lector `collectionsOf` (extender `hooks/use-spaces-tree.ts` o crear `hooks/use-collections.ts`)
- Modify: `apps/mobile/src/lib/i18n/dictionaries.ts` (solo strings que el picker necesite, si alguno nuevo)
- Test: `apps/mobile/test/place-picker.test.ts` (o el archivo de tests que corresponda al lector)

**Interfaces:**
- Consumes: `useSpacesTree` (`hooks/use-spaces-tree.ts:6-21`), `store.listCached(entity)` con `SyncEntity` ya ampliado (fase 1).
- Produces: `PlacePicker { workspaceId, folderId, collectionId, onChange }` y `collectionsOf(workspaceId, folderId): Collection[]`. Task 3 consume ambos.

> **Extraer, no duplicar.** `WhereNoteSheet` (195 lineas) ya sabe elegir workspace+carpeta. Si el share sheet copia esa logica, el proximo cambio de orden se hace en dos hojas. El picker es la decision sin el cromo.

- [ ] **Step 1: El lector de colecciones, primero porque el picker lo necesita**

`collectionsOf(workspaceId: string, folderId: string | null): Collection[]` leido de `cached_entities` con entity `'collection'`, filtrando por `workspaceId` y por `folderId` (null = raiz del espacio), excluyendo `deletedAt`, y ordenando por `position` como hacen `foldersOf` y `listsOf`.

**Donde vive**: si `use-spaces-tree.ts` tiene `listsOf` al lado de `foldersOf`, ahi mismo (es el mismo arbol); si no, `hooks/use-collections.ts` nuevo con el mismo patron de suscripcion a `local-store` (`use-spaces-tree.ts:86-98`). **Mirar el archivo antes de decidir y seguir lo que haya.**

- [ ] **Step 2: Write the failing test — el lector**

Con el patron de los tests existentes de hooks/store (mirar `apps/mobile/test/` y copiar el arnes):

```ts
it('devuelve las colecciones de una carpeta, sin las borradas', ...);
it('una coleccion sin carpeta sale en la raiz del espacio', ...);
it('ordenadas por position, como carpetas y listas', ...);
```

- [ ] **Step 3: `PlacePicker`, extraido de `WhereNoteSheet`**

```tsx
export interface PlacePickerProps {
  workspaceId: string | null;
  folderId: string | null;
  collectionId: string | null;
  onChange: (place: { workspaceId: string; folderId: string | null; collectionId: string | null }) => void;
  showCollections?: boolean;  // default true; WhereNoteSheet lo usa en false
}
```

Composicion, de arriba abajo: espacios (`tree.spaces()`), carpetas del espacio (`tree.foldersOf`), colecciones (`collectionsOf`), fila "sin clasificar" (`collectionId: null`, siempre visible). **Sin `Sheet`, sin titulo, sin botones**: es un `View` con listas, y el cromo lo pone el llamador.

Los tres casos del arbol que `WhereNoteSheet` ya resuelve y que hay que conservar: **sin espacios** (mensaje + CTA a crear uno), **un solo espacio** (atajo sin pedir dos veces), y **carpeta raiz del espacio** como fila ("en este espacio, sin carpeta").

- [ ] **Step 4: `WhereNoteSheet` pasa a envolverlo**

El archivo queda en ~20 lineas: `Sheet` + `PlacePicker showCollections={false}` + `onPick` adaptado a `{ workspaceId, folderId }`. **Mismo props, mismo copy, mismos tests**: si algun test existente de `WhereNoteSheet` cambia de resultado, la extraccion rompio algo y hay que volver atras.

- [ ] **Step 5: Run y commit**

Run: tests del lector + tests existentes de notas (los que toquen `WhereNoteSheet`) + typecheck.
Expected: PASS, y `WhereNoteSheet` con el mismo comportamiento observable.

```bash
git add apps/mobile/src/components/workspace/place-picker.tsx apps/mobile/src/components/notes/where-note-sheet.tsx apps/mobile/src/hooks/ apps/mobile/test/
git commit -m "refactor(mobile): el destino sale de WhereNoteSheet a PlacePicker, y suma colecciones"
```

---

### Task 3: `ShareSaveSheet` (la hoja, en dos paginas)

**Files:**
- Create: `apps/mobile/src/components/bookmarks/share-save-sheet.tsx`
- Modify: `apps/mobile/src/lib/i18n/dictionaries.ts` (strings es+en)
- Modify: `apps/mobile/src/lib/bookmarks/share-intent.ts` (`createBookmarkFromShare`, el guard de doble-guardado)
- Test: `apps/mobile/test/share-save-sheet.test.ts` (logica de guardado, no el gesto)

**Interfaces:**
- Consumes: `PlacePicker` (Task 2), `collectionsOf` (Task 2), `createBookmarkAction` (`lib/bookmarks/actions.ts:79`), `createCollectionAction` (`lib/collections/actions.ts:56`), `Sheet` (`ui/sheet.tsx:31-70`), `takePendingShare` (Task 4, pero la firma se fija aqui).
- Produces: `ShareSaveSheet { payload: SharedPayload; visible; onClose; onSaved: (id: string) => void }`. Task 4 la monta en `/share/save`.

> **Por que dos paginas y no una.** Tres salidas (coleccion existente, crearla en el momento, sin clasificar) no entran en una lista sin apretar. `SheetProps.onBack` existe exactamente para esto: el comentario de `sheet.tsx` dice que **siete hojas tienen mas de una pagina**. Un `onBack` aqui es el patron de la casa, no una excepcion.

- [ ] **Step 1: El contrato con la ruta**

```tsx
export interface SharedPayload { url: string; title: string | null; text: string | null; }
export interface ShareSaveSheetProps {
  payload: SharedPayload;
  visible: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}
```

`payload.title` es lo que el usuario escribio o lo que venia en el texto compartido; `payload.text` es el texto crudo por si hace falta. La URL ya viene extraida por `sacarUrlDelTexto` (Task 1).

- [ ] **Step 2: Pagina 1 — preview, titulo, destino, guardar**

`Sheet` con `scrollable={false}`, compuesto como `children`:

- **`artwork`** con la miniatura si `imageUrl` se conoce (no se conoce todavia: la metadata la trae la fase 2 **despues** de guardar; dejar el slot con el favicon/host como placeholder, no un `fetch` en el cliente).
- **Titulo editable**, con placeholder que dice que vacio se usa el del enlace. Lo que se escribe aqui es el `title` del create: si queda vacio, el servidor lo rellena (fase 1, `title` default `''`).
- **`PlacePicker`** scrolleando por dentro.
- **Boton Guardar** fijo abajo, calcado de `place-share-sheet.tsx:263-276`: `disabled` sin `workspaceId` o mientras `saving`, y Cancel ghost debajo.

- [ ] **Step 3: Pagina 2 — crear la coleccion sin salir**

Si el destino elegido es "nueva coleccion": segunda pagina con nombre (+ emoji opcional, como `lists`), boton Crear que llama `createCollectionAction({ workspaceId, folderId, name })` y **vuelve a la pagina 1 con la coleccion ya elegida**. `onBack` vuelve sin crear.

**La coleccion se crea en el espacio y carpeta elegidos**: son los que `PlacePicker` ya tiene. No se pregunta dos veces.

- [ ] **Step 4: El guardado, y el guard de doble-guardado**

```ts
// en lib/bookmarks/share-intent.ts
let savedForPayload: string | null = null;  // id del bookmark ya creado para este payload
export async function createBookmarkFromShare(
  payload: SharedPayload,
  place: { workspaceId: string; folderId: string | null; collectionId: string | null },
  title: string,
): Promise<string> {
  if (savedForPayload !== null) return savedForPayload;   // Review Focus #4
  const id = await createBookmarkAction({ ...place, url: payload.url, title, tags: [] });
  savedForPayload = id;
  void triggerExtract(id);   // fire-and-forget, Task 4 lo define; aqui solo se llama
  return id;
}
export function resetShareGuard(): void { savedForPayload = null; }
```

Review Focus #4 (doble tap en Guardar): el boton se deshabilita con `saving`, **y** el guard devuelve el id ya creado si se llama dos veces. Dos defensas porque el gesto rapido atraviesa una sola.

Review Focus #5 (los tres campos coherentes): el payload del create lleva `workspaceId`, `folderId` y `collectionId` tal cual los resolvio el picker (la coleccion manda, y si se creo en el momento ya trae su carpeta). El servidor valida y deriva (fase 1, Task 4): si el cliente se equivoca, el `rejected` es limpio.

- [ ] **Step 5: Los strings, dos veces**

Cada string nuevo en `dictionaries.ts`, en es y en en, junto a los de `note.where.*`. Titulos, placeholders, "sin clasificar", "nueva coleccion", "guardar", "guardando", y los dos errores (sin URL, sin espacios).

- [ ] **Step 6: Tests de la logica (no del gesto)**

```ts
describe('createBookmarkFromShare', () => {
  it('dos llamadas con el mismo payload crean un solo bookmark', ...);  // Review Focus #4
  it('el titulo vacio viaja vacio y lo rellena el servidor', ...);
  it('sin workspaceId no se llama al create', ...);
});
```

El gesto (taps, navegacion) no se testea aqui: lo cubre la verificacion manual de la Task 4 y el recorrido Maestro de la fase 4.

- [ ] **Step 7: Run y commit**

```bash
git add apps/mobile/src/components/bookmarks/ apps/mobile/src/lib/bookmarks/share-intent.ts apps/mobile/src/lib/i18n/dictionaries.ts apps/mobile/test/share-save-sheet.test.ts
git commit -m "feat(mobile): la hoja de guardar, con destino, coleccion nueva y guard de doble-guardado"
```

---

### Task 4: La ruta `/share/save` (frio, caliente, limpieza)

**Files:**
- Modify: `apps/mobile/src/app/share/save.tsx` (la hoja montada + estados)
- Modify: `apps/mobile/src/lib/bookmarks/share-intent.ts` (`takePendingShare`, `triggerExtract`)
- Modify: `apps/mobile/src/lib/api/` (o donde viva el cliente de bookmarks; si no existe, crearlo: `triggerExtract`)
- Test: `apps/mobile/test/share-save-route.test.ts` (los caminos, con el modulo nativo mockeado)

**Interfaces:**
- Consumes: `useIncomingShare` / `getSharedPayloads` / `clearSharedPayloads` de `expo-sharing`, `ShareSaveSheet` (Task 3), `api.post` (`lib/api/client.ts:387-397`), `resetShareGuard` (Task 3).
- Produces: el gesto completo verificable a mano. Nada mas lo consume: es una hoja del arbol de rutas.

- [ ] **Step 1: `takePendingShare` — leer y limpiar, en ese orden**

```ts
export interface PendingShare { url: string; title: string | null; text: string | null; }
export function takePendingShare(): PendingShare | null {
  const [first] = getSharedPayloads();          // sincronico, frio y caliente
  if (!first) return null;
  const parsed = sacarUrlDelTexto(first.value); // Task 1
  if (!parsed) return null;
  return { url: parsed.url, title: parsed.title, text: first.value };
}
export function clearShare(): void {
  clearSharedPayloads();
  resetShareGuard();
}
```

**Leer y limpiar son dos momentos distintos a proposito**: se lee al abrir la ruta, se limpia **despues** de guardar (`onSaved`), no al montar. Si se limpia al montar y el guardado falla, el enlace se pierde para siempre. Si no se limpia nunca, reabrir la ruta re-guardaria lo mismo.

- [ ] **Step 2: La ruta con sus cuatro caminos**

`app/share/save.tsx`:

1. `status === 'loading'` -> spinner (ya esta, Task 1).
2. `status === 'anonymous'` -> redirect a sign-in con `next` (ya esta, Task 1).
3. Con sesion, `takePendingShare()` -> null -> vista "nada que guardar" (ya esta, Task 1).
4. **NUEVO**: con sesion y payload -> `<ShareSaveSheet payload visible onClose onSaved />`. `onSaved`: `clearShare()` + `router.replace('/(app)/bookmarks?highlight=<id>')` o a la coleccion destino. `onClose` sin guardar: **no limpia** (el usuario puede volver atras y el payload sigue ahi).

**Caliente vs frio**: con la app abierta, `useIncomingShare` re-lee en `AppState === 'active'` (`useIncomingShare.ts:80-84`); la ruta montada vuelve a llamar `takePendingShare()` al enfocarse. Con la app cerrada, `+native-intent.ts` la abre directo en `/share/save`. Los dos caminos terminan en el mismo `takePendingShare()`: **un solo lector, dos entradas**.

- [ ] **Step 3: `triggerExtract` — fire-and-forget de verdad**

```ts
export function triggerExtract(bookmarkId: string): void {
  void api.post(`/bookmarks/${bookmarkId}/extract`, undefined).catch(() => {});
}
```

Sin `await` en el llamador, sin reintento aqui, sin toast de error. El endpoint responde 204 y el texto llega por el pull (fase 2). Si no hay red, el bookmark queda `pending` y la fase 4 lo reintenta al abrirlo. **Un `catch` vacio con comentario es correcto aqui**: el error ya esta representado en `extractionState`, y un toast por un fetch de fondo es ruido.

Donde vive `api.post('/bookmarks/...')`: si no hay cliente de bookmarks en `lib/api`, se crea `lib/api/bookmarks.ts` con `triggerExtract` y nada mas. **No** un cliente CRUD completo: las escrituras son del sync (fase 1) y las lecturas llegan en fase 4.

- [ ] **Step 4: Tests de los caminos (modulo nativo mockeado)**

```ts
jest.mock('expo-sharing', () => ({ getSharedPayloads: jest.fn(), clearSharedPayloads: jest.fn() }));
describe('takePendingShare', () => {
  it('sin payloads devuelve null', ...);
  it('con texto con URL devuelve el parseo', ...);
  it('clearShare limpia el nativo y el guard', ...);  // Review Focus #4, segunda defensa
});
```

El mock es de modulo entero porque `getSharedPayloads` es sincrono y nativo: no hay `fetch` que interceptar.

- [ ] **Step 5: Verificacion manual en dispositivo (la unica que vale para esta tarea)**

No hay test que sustituya al gesto. Con un build nativo (dev-client o preview):

1. App **cerrada** -> compartir URL desde el navegador -> OrbitHub abre la hoja con el enlace. (Review Focus #1)
2. App **abierta** -> mismo gesto -> misma hoja. (Review Focus #1)
3. **Sin sesion** -> compartir -> login -> la hoja sigue con el enlace. (Review Focus #2, por sign-in **y** por sign-up)
4. Doble tap en Guardar -> **un** bookmark. (Review Focus #4)
5. Guardar en coleccion nueva -> el bookmark cae en su carpeta. (Review Focus #5)

**Si no hay build nativo disponible, esta tarea queda en `partial` y se dice**: un intent no se puede simular bien, y afirmarlo sin probarlo es la clase de deuda que la fase 1 vino a evitar.

- [ ] **Step 6: Run y commit**

Run: tests nuevos + typecheck + suite mobile.
Expected: PASS (con el Step 5 en `partial` si no hubo dispositivo).

```bash
git add apps/mobile/src/app/share/save.tsx apps/mobile/src/lib/bookmarks/share-intent.ts apps/mobile/src/lib/api/ apps/mobile/test/share-save-route.test.ts
git commit -m "feat(mobile): /share/save lee el payload, guarda y dispara la extraccion sin esperar"
```

---

## Fuera de esta fase

- **Entradas del drawer** (inbox "sin clasificar", lista de bookmarks): fase 4. La navegacion `onSaved` apunta a rutas que todavia no existen; dejar el `router.replace` hacia `/(app)` con un `TODO(fase-4)` y comentario, no inventar la ruta.
- **Reintento de extraccion al abrir un `pending`**: fase 4.
- **iOS Share Extension UI**: `expo-sharing` la trae con el plugin; si pide App Group por el bundle-id distinto (`com.orbithub.app` vs `com.jrzlabs.orbithub`), es configuracion, no codigo.
- **Deteccion de duplicados**: fuera de toda la spec.
- **`linkedom` vs `jsdom`**: decision abierta de la fase 2, no se reabre aqui.

## Decisiones reversibles

**`sign-up` preservando `next`** (Task 1, Step 5). Si el flujo de alta cambia, revertir son dos lineas. Lo que **no** es reversible barato es perder shares silenciosamente, asi que mientras tanto se preserva.
