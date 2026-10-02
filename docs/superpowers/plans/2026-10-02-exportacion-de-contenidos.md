# Exportar el contenido — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que se pueda bajar una copia de todo el contenido de la cuenta en JSON, y una lista concreta en JSON o CSV, desde Ajustes y desde el menú de esa lista.

**Architecture:** El servidor construye el fichero y devuelve bytes con `Content-Disposition`; el cliente sólo lo guarda. Dos endpoints (`/account/export`, `/lists/:listId/export`), un serializador puro sin base de datos, y un camino de bytes en el cliente que todavía no existe porque `apiRequest` acaba siempre en `JSON.parse`.

**Tech Stack:** Zod 4 + TypeScript (contratos), Express 5 + Drizzle (API), Expo SDK 57 / React Native 0.86 (app), Vitest 5 en las dos workspaces.

**Spec:** `docs/superpowers/specs/2026-10-02-exportacion-de-contenidos-design.md` — el plan razona desde el spec, así que **léete los dos**. Difieren en dos puntos que el código real ya tenía resueltos y que el spec no sabía: el no-miembro es **404**, no 403; y el formato inválido es **422 `validation_failed`**, no un 400 con un código `invalid_format` que no existe.

## Global Constraints

- **Todo el trabajo ocurre en el worktree `/Users/jose/code/orbit-hub/.worktrees/exportar-contenidos`, en la rama `exportar-contenidos`.** No en el checkout principal. Todos los comandos de este plan se ejecutan con ese directorio como working directory.
- `npm run typecheck` (raíz) y `npm run test` (raíz) pasan antes de dar cualquier tarea por buena. Cada una construye `@orbit-hub/contracts` primero, así que un cambio en el contrato se ve en la API en la misma orden.
- **`git add` siempre con rutas explícitas.** Nunca `git add -A`, nunca `git add .`, nunca `git add -u`. En el checkout principal hay trabajo sin commitear de otra persona (`package.json`, `with-upload-signing.js`, `floating-button.tsx`, `screen.tsx`, `space-band.tsx`, `list/[listId].tsx`, `use-lists.ts`) y un `git add` sin rutas lo metería todo en un commit. En el worktree el árbol está limpio, pero la costumbre es lo que protege cuando se mergee.
- Fichero **sin tildes en el nombre**: `orbit-hub-<slug>-<YYYY-MM-DD>.<json|csv>`. El correo nunca aparece en él.
- CSV: delimitador `;`, UTF-8 **con BOM**, CRLF, comillas siempre, etiquetas de una celda unidas con `|`.
- El sobre JSON lleva `format: "orbit-hub.export"` y `version: 1`, arrays **planos**, `metadata` **sin aplanar**, `deletedAt` **incluido**, `counts` arriba del todo.
- `storageKey` no sale de la API en ninguna respuesta.
- Ningún endpoint de export pasa por `sendData`. Los dos llevan `require-auth`.
- Los ficheros del móvil se leen **con comillas dobles y 2 espacios** salvo `settings.tsx`, que usa comillas simples: copia el fichero que estás tocando, no el de al lado.
- Imports del workspace `api` llevan extensión `.js`. Los del workspace `mobile` no.
- `packages/contracts` **no tiene script de test**. Lo que se prueba desde allí se prueba desde `apps/mobile/test` o `apps/api/test`.

## Review Focus

Cinco formas de entrada que el spec insinúa y que ninguna regla del repo cubre. Cada una tiene su test en la tarea indicada; van en el orden en que más daño hacen.

1. **Una fila borrada en silencio tiene que seguir ahí.** `deletedAt` se exporta a propósito, pero el servicio de lectura de listas filtra con `isNull(deletedAt)` en todas sus consultas. Un implementador que copie sus consultas pierde los borrados sin avisar, y una copia de la que se han caído las cosas que borraste parece completa. → Task 3.
2. **Una comilla, un punto y coma o un salto de línea en un título.** Si el CSV no cita bien, una fila se parte en dos y en Excel aparece como dos elementos que no existen. Se prueban `"`, `;`, `\n` y `\r\n` en `title` y en `annotation`. → Task 2.
3. **`metadata` con el tipo equivocado.** `releaseDate` es una fecha, pero la columna es `jsonb` sin tipar y el día que un proveedor mande un array ahí, `if (value)` lo convierte en texto y la celda sale con `a,b` o con `[object Object]`. El tipo se comprueba y la celda va vacía. → Task 2.
4. **Una cuenta recién creada, sin nada dentro.** Todos los `counts` a cero, los arrays presentes y vacíos, y un 200 con JSON válido. Un export que da error cuando no hay contenido es un export que falla el primer día. → Task 3.
5. **Una etiqueta que contiene `|`.** El separador dentro de la celda es `|`, así que una etiqueta con `|` dentro se parte en dos al releerla. Y `release_date` tiene que salir de `releaseDate` **o** de `publishedDate`, porque un libro no tiene fecha de estreno. → Task 2.

---

## File Structure

**Nuevo, en el contrato** — `packages/contracts/src/export.ts`: el sobre, los dos esquemas de query y la regla del nombre de fichero. El nombre va aquí porque **los dos lados tienen que producir exactamente el mismo nombre**: el servidor lo pone en `Content-Disposition` y el móvil lo necesita como destino en disco y como atributo `download`. Duplicar el `slug` en dos sitios es la forma segura de que un fichero se llame distinto según dónde se guarde. El precedente de que el contrato lleve funciones puras además de esquemas es `note-document.ts` (`noteDocumentToPlainText`, `notePreviewBelowTitle`).

**Nuevo, en la API**
- `src/modules/export/export-builders.ts` — **sin base de datos, sin Express, sin `Response`**. Dado un conjunto de filas ya mapeadas a los tipos del contrato, produce el sobre JSON y el CSV. Un solo constructor de registros y dos escritores, para que el JSON y el CSV no puedan discrepar.
- `src/modules/export/export-service.ts` — lee de Postgres y llama a los builders. Es el único fichero que sabe de Drizzle.
- `src/routes/account.ts` — `GET /account/export`.

**Modificado, en la API**
- `src/routes/respond.ts` — añadir `sendFile()`, al lado de `sendData()`.
- `src/routes/lists.ts` — `GET /:id/export`, junto a `/:id/items` que ya es un sub-recurso de la lista.
- `src/routes/index.ts` — montar `accountRouter`.
- `docs/architecture/api-conventions.md` — documentar la excepción.

**Nuevo, en el móvil**
- `src/lib/export/save.ts` — web: `blob` + `<a download>`. Nativo: `expo-file-system` y `expo-sharing`, importados perezosamente y con `Platform.OS === 'web'` **antes** de tocarlos.
- `src/lib/export/errors.ts` — `ApiError` → clave de traducción. Puro, sin `react-native`, y por eso sí se puede probar.
- `src/hooks/use-export.ts` — estado y orchestration; lo usan las dos pantallas.
- `src/components/export/export-result-sheet.tsx` — los `counts` y dónde ha caído el fichero.

**Modificado, en el móvil**
- `src/lib/api/client.ts` — `apiRaw()`.
- `src/app/(app)/settings.tsx` — la fila que hoy no hace nada.
- `src/components/lists/list-menu-sheet.tsx` — página `export` antes de `delete`.
- `src/lib/i18n/dictionaries.ts` — claves nuevas en `es` y `en`.

**Tests** — `apps/api/test/export-builders.test.ts` (puro, sin servidor), `apps/api/test/export.test.ts` (HTTP), `apps/mobile/test/export.test.ts` (nombre de fichero y claves de error).

---

### Task 1: El contrato — el sobre, las queries y el nombre del fichero

**Files:**
- Create: `packages/contracts/src/export.ts`
- Modify: `packages/contracts/src/index.ts` (añadir `export * from './export';` en orden alfabético, entre `./common` y `./note-document`)

**Interfaces:**
- Consumes: `uuidSchema`, `emailSchema`, `isoDateTimeSchema`, `countSchema` de `./common`; `workspaceSchema`, `folderSchema`, `listSchema`, `listItemSchema`, `noteSchema`, `noteTemplateSchema`, `folderSchema` de `./workspace`.
- Produces:
  - `exportFormatSchema = z.enum(['json', 'csv'])`
  - `EXPORT_FORMAT_VERSION = 1`
  - `accountExportQuerySchema` — `z.object({ format: z.literal('json').default('json') })`
  - `listExportQuerySchema` — `z.object({ format: exportFormatSchema.default('json') })`
  - `exportedAttachmentSchema = attachmentSchema.omit({ storageKey: true })`
  - `accountExportSchema`, `listExportSchema`
  - Tipos: `ExportFormat`, `AccountExport`, `ListExport`, `ExportedAttachment`, `AccountExportQuery`, `ListExportQuery`
  - `exportFilename(args: { title: string; fallbackId: string; extension: ExportFormat; date: string }): string`
  - `LIST_EXPORT_CSV_COLUMNS: readonly string[]` — la cabecera, en orden, **una sola definición** que usan el builder y el test.

`accountExportQuerySchema` usa `z.literal('json')` y no `exportFormatSchema` **a propósito**: `?format=csv` contra la cuenta tiene que ser un 422 del `parse`, no algo que el endpoint tenga que decidir. El CSV de cuenta necesita un contenedor con varias hojas y no se hace; que el contrato lo rechace es lo que hace la omisión explícita en vez de un descuido.

- [ ] **Step 1: Escribir el test que falla**

`apps/mobile/test/export.test.ts`, nuevo. Empieza sólo con el nombre de fichero, que es la parte pura que este paquete puede probar.

```ts
import { exportFilename } from '@orbit-hub/contracts';
import { describe, expect, it } from 'vitest';

describe('exportFilename', () => {
  it('deja un nombre sin espacios ni acentos', () => {
    expect(
      exportFilename({ title: 'Películas para ver', fallbackId: 'x', extension: 'csv', date: '2026-10-02' }),
    ).toBe('orbit-hub-peliculas-para-ver-2026-10-02.csv');
  });

  it('quita los emojis y los simbolos, no los tira todos', () => {
    expect(
      exportFilename({ title: 'Café ☕ & cosas', fallbackId: 'x', extension: 'json', date: '2026-10-02' }),
    ).toBe('orbit-hub-cafe-cosas-2026-10-02.json');
  });

  it('cae al id cuando el titulo no deja nada', () => {
    expect(
      exportFilename({ title: '🎬🎬', fallbackId: 'a1b2c3d4', extension: 'csv', date: '2026-10-02' }),
    ).toBe('orbit-hub-a1b2c3d4-2026-10-02.csv');
  });

  it('corta el slug a 40 caracteres sin comerse el guion', () => {
    const slug = exportFilename({
      title: 'a'.repeat(80), fallbackId: 'x', extension: 'csv', date: '2026-10-02',
    });
    expect(slug).toBe(`orbit-hub-${'a'.repeat(40)}-2026-10-02.csv`);
  });

  it('produce el nombre de la cuenta sin titulo', () => {
    expect(
      exportFilename({ title: 'export', fallbackId: 'export', extension: 'json', date: '2026-10-02' }),
    ).toBe('orbit-hub-export-2026-10-02.json');
  });
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

```
cd apps/mobile && npx vitest run test/export.test.ts
```
Expected: FAIL. El fallo concreto es que `@orbit-hub/contracts` resuelve a `dist/`, que se construyó antes de que existiera `export.ts`: el error es un "no export named `exportFilename`" desde el paquete ya construido, no un módulo inexistente. **Lo que importa es que falla antes del Step 3**, por la razón que sea.

- [ ] **Step 3: Escribir `packages/contracts/src/export.ts`**

`exportFilename`: normaliza a NFD, quita los diacríticos con el rango `\u0300-\u036f`, pasa a minúsculas, **sustituye cada racha de caracteres que no sean `[a-z0-9]` por un solo guion**, quita guiones de los extremos, corta a 40. Si queda vacío, usa `fallbackId`. Devuelve `` `orbit-hub-${slug}-${date}.${extension}` ``.

`LIST_EXPORT_CSV_COLUMNS` es exactamente, en este orden:

```
id; titulo; tipo; completado; prioridad; tags; posicion; anotacion;
year; release_date; image_url; provider; external_id; created_at; updated_at
```

`accountExportSchema`, con `counts` contando **los siete** arrays y `templates` incluido:

```ts
{
  format: z.literal('orbit-hub.export'),
  version: z.literal(EXPORT_FORMAT_VERSION),
  exportedAt: isoDateTimeSchema,
  account: z.object({ id: uuidSchema, email: emailSchema, displayName: z.string() }),
  counts: z.object({
    workspaces: countSchema, folders: countSchema, lists: countSchema,
    items: countSchema, notes: countSchema, attachments: countSchema,
    templates: countSchema,
  }),
  workspaces: z.array(workspaceSchema),
  folders: z.array(folderSchema),
  lists: z.array(listSchema),
  items: z.array(listItemSchema),
  notes: z.array(noteSchema),
  attachments: z.array(exportedAttachmentSchema),
  templates: z.array(noteTemplateSchema),
}
```

`listExportSchema` lleva `format`, `version`, `exportedAt`, `account` (sin `displayName`: un fichero de una lista no necesita el nombre de la cuenta), `workspace: z.object({ id, name })`, `folder: z.object({ id, name }).nullable()`, `list: listSchema`, `items: z.array(listItemSchema)`, `counts: z.object({ items: countSchema })`.

`noteTemplateSchema` y `workspaceSchema` **no** extienden `nodeAccessSchema`, así que no llevan `role` ni `shared` y su fila mapea directa.

**`folderSchema`, `listSchema`, `listItemSchema` y `noteSchema` sí lo extienden** —son las cuatro únicas que lo hacen, en `workspace.ts` líneas 221, 337, 401 y 428— y `role: membershipRoleSchema` **no tiene `.default()`**, o sea que es obligatorio en las cuatro. Las tablas no tienen esa columna: la pone el servicio (ver Task 3). Olvidarse de las carpetas rompe `accountExportSchema.parse` en la primera fila de carpeta que salga.

Añade la línea a `index.ts`.

- [ ] **Step 4: Correr el test y verlo pasar**

```
npm run build:packages && cd apps/mobile && npx vitest run test/export.test.ts
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck del contrato**

```
npm run typecheck --workspace @orbit-hub/contracts
```
Expected: sin salida, código 0.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/export.ts packages/contracts/src/index.ts apps/mobile/test/export.test.ts
git commit -m "El sobre de la exportacion y el nombre del fichero, que es el mismo en los dos lados"
```

---

### Task 2: Los escritores — el sobre JSON y el CSV

**Files:**
- Create: `apps/api/src/modules/export/export-builders.ts`
- Test: `apps/api/test/export-builders.test.ts`

**Interfaces:**
- Consumes: `LIST_EXPORT_CSV_COLUMNS`, `EXPORT_FORMAT_VERSION` y los tipos del contrato de Task 1.
- Produces:
  - `accountExportEnvelope(rows: AccountExportRows): AccountExport`
  - `listExportEnvelope(args: { account: { id: string; email: string }; workspace: { id: string; name: string }; folder: { id: string; name: string } | null; list: List; items: ListItem[]; exportedAt: string }): ListExport`
  - `itemsToCsv(args: { list: List; items: ListItem[] }): string`
  - `metadataCell(metadata: Record<string, unknown> | null, key: string): string` — **exportada** para que los tests la ataquen directamente.

`AccountExportRows` es `{ account: { id: string; email: string; displayName: string }; exportedAt: string; workspaces: Workspace[]; folders: Folder[]; lists: List[]; items: ListItem[]; notes: Note[]; attachments: ExportedAttachment[]; templates: NoteTemplate[] }`.

**Este fichero no importa nada de `../../db/` ni de `express`.** Es la razón por la que sus tests corren en milisegundos: sin `startTestServer`, sin Postgres, sin migraciones.

- [ ] **Step 1: Escribir los tests que fallan**

`apps/api/test/export-builders.test.ts`. **Sin `beforeAll` y sin `startTestServer`** — este fichero no arranca nada. Imports explícitos de `vitest`: el `vitest.config.ts` de la API tiene `globals: false`.

Un helper de fixtures que devuelve filas completas del contrato, porque los esquemas tienen `.default()` y un `ListItem` a medio rellenar no es un `ListItem`:

```ts
function item(over: Partial<ListItem> = {}): ListItem {
  return {
    id: 'i1', listId: 'l1', title: 'Pan', position: 0, completed: false,
    priority: 'none', icon: null, iconStyle: 'outline', iconColor: 'neutral',
    tags: [], externalId: null, metadata: null, annotation: null,
    role: 'owner', shared: false, version: 1,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
    deletedAt: null, ...over,
  };
}
```

Los casos, con sus valores exactos:

- `accountExportEnvelope` con dos items: `counts.items` es `2` y `counts` cuadra con la longitud de cada array.
- Un item con `deletedAt: '2026-03-01T00:00:00.000Z'` sobrevive: `expect(envelope.items[0].deletedAt).toBe('2026-03-01T00:00:00.000Z')`.
- `metadata: { imageUrl: 'x.jpg', AlgoRaro: { anidado: true } }` sale **exacto**: `expect(envelope.items[0].metadata).toEqual({ imageUrl: 'x.jpg', AlgoRaro: { anidado: true } })`. Un aplanar o un `JSON.parse(JSON.stringify())` con un `undefined` de por medio rompe esto.
- Una cuenta sin nada: los siete `counts` a `0` y los siete arrays `[]`.
- `JSON.parse(JSON.stringify(envelope))` vuelve a ser igual: el sobre sobrevive a un viaje de ida y vuelta.
- `itemsToCsv` empieza con `LIST_EXPORT_CSV_COLUMNS.join(';')` y con `\uFEFF` delante.
- `itemsToCsv` termina en CRLF y usa `;`.
- Un item con `metadata: { year: 1994, releaseDate: '1994-09-10', imageUrl: 'https://x/y.jpg', provider: 'tmdb' }` da `year` `1994` y `release_date` `1994-09-10`.
- El mismo item con `metadata: { publishedDate: '2005-03-02' }` da `release_date` `2005-03-02` — **un libro no tiene fecha de estreno**.
- `metadata: null` (una tareanormal) deja `year`, `release_date`, `image_url` y `provider` **vacíos**, y el texto `undefined` no aparece en el CSV: `expect(csv).not.toContain('undefined')`.
- `metadata: { releaseDate: ['a', 'b'] }` deja `release_date` vacía, no `a,b`: `expect(csv).not.toContain('a,b')`.
- `tags: ['Mercadona', 'urgente']` produce la celda `Mercadona|urgente`.
- Un `title` con `"` y `;` y `\n`: la fila se cita y sigue siendo **una** fila. Cuenta las líneas: `expect(csv.trim().split('\r\n')).toHaveLength(3)` con dos items, sea cual sea el contenido de los títulos.
- Un `annotation` con `\r\n` no parte la fila (misma aserción de líneas).
- `completed: true` escribe `true` y `false` escribe `false`.
- `LIST_EXPORT_CSV_COLUMNS` tiene 15 entradas, para que añadir una columna sea un cambio visible y no un olvido.

- [ ] **Step 2: Correr los tests y verlos fallar**

```
cd apps/api && npx vitest run test/export-builders.test.ts
```
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar `export-builders.ts`**

`accountExportEnvelope` y `listExportEnvelope` son_field por field, sin lógica.

`metadataCell(metadata, key)`: devuelve `''` si `metadata` es `null`/undefined, si la clave no está, o **si el valor no es `string` ni `number`**. Ese último caso es el que evita `[object Object]` y `a,b` de una lista. Devuelve `String(value)` en el resto.

`itemsToCsv` extrae con `metadataCell`, con dos reglas fijas:
- `year`: `metadataCell(metadata, 'year')`; si sale vacía, los **cuatro primeros caracteres** de `releaseDate` o `publishedDate` cuando ése existe y es un string.
- `release_date`: `metadataCell(metadata, 'releaseDate') || metadataCell(metadata, 'publishedDate')`.
- `tags`: `item.tags.join('|')`.

`csvCell(value)`: envuelve **siempre** entre comillas dobles y duplica las comillas dobles de dentro (`"` → `""`), que es lo que dice RFC 4180. Citar siempre es más simple que decidir, y no puede salir mal.

**La cabecera va SIN comillas.** Es una constante fija de ASCII sin nada que citar, y dejarla desnuda es lo que hace que la primera línea sea literalmente `LIST_EXPORT_CSV_COLUMNS.join(';')` — que es justo lo que la aserción del test comprueba y lo que da sentido a que esa constante exista y se comparta. Citar también la cabecera sería CSV igual de válido, pero haría que la constante no sirviera para nada.

El cuerpo entero empieza por `'\uFEFF'` — sin el BOM, Excel abre `El niño` como `El niÃ±o`.

`accountExportEnvelope` cuenta con `rows.X.length` para los siete. Los `counts` se calculan, no se pasan: un `counts` que el llamador tiene que mantener sincronizado es un `counts` que algún día no lo está.

- [ ] **Step 4: Correr los tests y verlos pasar**

```
cd apps/api && npx vitest run test/export-builders.test.ts
```
Expected: PASS, todos.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/export/export-builders.ts apps/api/test/export-builders.test.ts
git commit -m "El sobre y el CSV salen de los mismos registros, para que no puedan discrepar"
```

---

### Task 3: Los dos endpoints, el servicio, y el documento que deja de mentir

**Files:**
- Create: `apps/api/src/modules/export/export-service.ts`
- Create: `apps/api/src/routes/account.ts`
- Modify: `apps/api/src/routes/respond.ts` (añadir `sendFile`)
- Modify: `apps/api/src/routes/lists.ts` (añadir `GET /:id/export`)
- Modify: `apps/api/src/routes/index.ts` (montar `accountRouter`)
- Modify: `docs/architecture/api-conventions.md`
- Test: `apps/api/test/export.test.ts`

**Interfaces:**
- Consumes: todo lo de Task 1 y Task 2.
- Produces:
  - `sendFile(res: Response, status: number, file: { body: string | Buffer; contentType: string; filename: string }): void`
  - `ExportService.accountJson(userId: string): Promise<ExportFile>`
  - `ExportService.listJson(userId: string, listId: string): Promise<ExportFile>`
  - `ExportService.listCsv(userId: string, listId: string): Promise<ExportFile>`
  - `export const exportService: ExportService`

Los tres devuelven `ExportFile = { body: string; contentType: string; filename: string }`, que es exactamente lo que `sendFile` consume. **El nombre sale del servicio y no de la ruta, a propósito**: el servicio es lo único que ha cargado la lista, y si el nombre lo calculara la ruta tendría que volver a cargarla o recibirla como parámetro. Devolver el nombre junto al cuerpo es lo que hace imposible que el fichero se llame de una cosa en la cabecera y de otra en el móvil, que es lo que pasó cuando `listCsv` devolvía sólo el CSV y se quedaba sin título con el que nombrarlo.

`sendFile` pone cuatro cabeceras y luego `res.status(status).send(body)`:
`content-type` con `; charset=utf-8`, `cache-control: no-store`,
`content-disposition` como `attachment; filename="<ascii>"; filename*=UTF-8''<percent-encoded>`,
y `content-length` con `Buffer.byteLength(body)`.

El `filename` en ASCII es el slug con todo lo no-ASCII sustituido por `_`, entre comillas dobles — hace falta porque **algunos clientes sólo leen ese y no el `filename*`**. El `filename*` lleva el nombre real con `encodeURIComponent`.

**El servicio no filtra nada por `deletedAt`.** Ésta es la línea donde un export se diferencia de un listado, y es la que Review Focus #1 vigila. Las consultas de `contentQueryService` llevan `isNull(lists.deletedAt)` en todas partes; **el servicio de export no lleva ninguno**.

- [ ] **Step 1: Escribir los tests que fallan**

`apps/api/test/export.test.ts`. Cabecera estándar: `startTestServer` en `beforeAll`, `api.close()` en `afterAll`, `createVerifiedUser` y `espacioPropio` de `./helpers`.

**Las respuestas de export no pasan por `api.get()`.** El `request()` de `helpers.ts` hace `JSON.parse(text)` siempre y reventaría con un CSV. Se llama a `fetch` directamente, que es el precedente de `test/attachments.test.ts`:

```ts
async function bajar(api: TestServer, path: string, token: string) {
  const response = await fetch(`${api.url}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return {
    status: response.status,
    headers: response.headers,
    text: await response.text(),
    body: await response.json().catch(() => null),
  };
}
```

Fixtures: listas e items se crean por `/sync/push`, igual que en `test/lists.test.ts` — `espacioPropio` da el espacio y el `sync()` local da el resto. Copia la forma exacta de `createList` y `createItem` de ese fichero (`entity: 'list'` con `payload: { workspaceId, kind, title }`, `entity: 'list_item'` con `payload: { listId, title }`), y **no** los importes de ahí: son locales a ese fichero.

**Crea también al menos una CARPETA y mete una lista dentro de ella** (`entity: 'folder'` con `payload: { workspaceId, name }`, y la lista con `folderId`). Sin una carpeta en los fixtures, el error de `role` en las carpetas no lo caza nadie: un `accountExportSchema.parse()` sobre un sobre sin carpetas pasa igual, y el fallo sale en producción la primera vez que alguien tiene una carpeta. La carpeta es lo que convierte esa aserción en una puerta y no en un adorno.

Los casos:

- `GET /account/export` da 200, `content-type` empieza por `application/json`, `content-disposition` empieza por `attachment;`, `cache-control` es `no-store`.
- El sobre pasa `accountExportSchema.parse()` del contrato.
- `counts` cuadra con cada array, y `items` tiene los que se crearon.
- **Un item borrado sigue en el JSON con su `deletedAt`**: créalo, bórralo por `/sync/push` con `kind: 'delete'`, y el export lo trae con `deletedAt` distinto de `null`.
- **Una lista borrada sigue en el JSON con sus items, y su `deletedAt` distinto de `null`**: bórrala por `/sync/push` con `kind: 'delete'` y comprueba que la lista **y** sus items salen. Es el caso donde un `isNull(deletedAt)` copiado del servicio de lectura se nota, porque la lista desaparece de `GET /lists` y aun así tiene que estar en el export.
- **Un adjunto no lleva `storageKey`**: `expect(text).not.toContain('storageKey')` sobre el JSON entero.
- `metadata` con una clave desconocida sale intacta.
- Una cuenta recién creada sin nada: 200, `counts` todo a cero, los siete arrays vacíos.
- `GET /lists/:id/export?format=csv` da 200, `content-type` empieza por `text/csv`, y el texto empieza por `\uFEFF`.
- El CSV de una lista de películas trae el `year` de un item cuyo `metadata` lo tiene.
- **Otro usuario contra una lista que no es suya recibe 404, no 403.** El cuerpo trae `error.code === 'not_found'`.
- `GET /account/export?format=csv` da **422** con `error.code === 'validation_failed'`.
- `GET /lists/<uuid-inexistente>/export` da 404.
- Sin token, 401 en los dos endpoints.
- `content-disposition` de una lista cuyo título tiene acentos: **`filename` y `filename*` traen el mismo slug ASCII, sin acento**. El slug sin acentos es deliberado —un móvil escribiendo en caché no puede nombrar un fichero con `á`— y como consecuencia no hay dos nombres distintos que poner: `exportFilename` ya devuelve ASCII, así que el `filename*` no lleva nada que percent-codificar. Un nombre con acento en `filename*` sería **peor**: hay clientes que ignoran `filename*` y se quedan con el ASCII, y los que lo honran escriben un fichero cuyo nombre no es el que dijo el servidor.

- [ ] **Step 2: Correr los tests y verlos fallar**

```
cd apps/api && npx vitest run test/export.test.ts
```
Expected: FAIL — 404 en todas las peticiones, el módulo no existe.

- [ ] **Step 3: `sendFile` en `respond.ts`**

Debajo de `sendData`, con el comentario que explica por qué existe una excepción: los dos endpoints de export devuelven bytes con `Content-Disposition` y no el sobre, así que son los primeros 2xx de la API que no pasan por `sendData`.

- [ ] **Step 4: El servicio**

`export-service.ts` sigue la forma de `note-service.ts`: `private async db(): Promise<Database> { return (await getDatabase()).db; }` y un singleton al final.

El camino de autorización es **exactamente** el que ya usa el resto: `visibleWorkspaceIds(userId)` para la cuenta, y para una lista, cargarla y comprobar su espacio con la misma pregunta que hace `getList`. **Copia ese comportamiento, incluida la frase de por qué la comprobación va después de la carga**: un recurso invisible y uno inexistente devuelven lo mismo, y por eso sale 404 y no 403.

`role` en cada fila sale de `memberships.role` para su espacio; `shared: false`. Es lo que hace `contentQueryService` y `note-service.ts` y no hay una razon distinta para hacerlo de otra manera aquí.

**`role` va en CARPETAS, listas, items y notas.** Son las cuatro entidades que extienden `nodeAccessSchema` (`workspace.ts` 221, 337, 401, 428) y `role: membershipRoleSchema` no tiene `.default()`: es obligatorio. `workspaceSchema` y `noteTemplateSchema` **no** lo llevan y sus filas mapean directas. Este es el error más fácil de cometer de toda la tarea, porque `contentQueryService` casi nunca devuelve carpetas y copiarse sus filtros y sus mapeos hace que las carpetas se olviden en silencio.

Los siete select: `workspaces`, `folders`, `lists`, `listItems`, `notes`, `attachments`, `noteTemplates`. Los tres últimos cuelgan de los anteriores por id, no por rango. **Ninguno con `isNull(deletedAt)`.**

**Las plantillas se eligen por espacio O por authorship, no sólo por espacio.** Una plantilla personal tiene `workspaceId: null` —ahí vive, según su propio comentario del contrato—, así que filtrar por `eq(noteTemplates.workspaceId, id)` deja fuera justo las plantillas que el usuario escribió sin espacio. Y al revés, `workspaceId IS NULL` a secas trae las de otros. El filtro es `(inArray(workspaceId, wsIds) OR eq(createdBy, userId))`. Así entran las del espacio y las personales propias, y quedan fuera las de otros y **las que trae la aplicación** —`builtInKey` no nulo, `createdBy` nulo— que se reinstalan solas y no tienen por qué ocupar espacio en cada copia.

El map de `metadata` es identidad: `metadata: row.metadata`. Sin `JSON.parse`, sin `JSON.stringify`, sin Selecting claves.

El map de `attachments` **omite `storageKey`**: destructuring del resto, o `.omit({ storageKey: true })` sobre el tipo. Lo que sale es el `ExportedAttachment` del contrato.

`accountJson` calcula `exportedAt` una vez, en UTC: `new Date().toISOString()`.

Las fechas van como `row.createdAt.toISOString()` y `row.deletedAt ? row.deletedAt.toISOString() : null` — la convención del repo, y en el export la segunda rama es la que se exercise de verdad.

- [ ] **Step 5: Las rutas**

`routes/account.ts` — el patrón de `routes/lists.ts` entero: `Router()`, `accountRouter.use(requireAuth)`, un `caller(req)` **de la variante que lanza `HttpError.unauthorized()`** (la de `lists.ts` y `workspaces.ts`, no la de `notes.ts`), `accountExportQuerySchema.parse(req.query)`, y `sendFile`.

En `routes/lists.ts`, `GET /:id/export` va **después** de `/:id/items` y antes de nada más. Comparte el `listParams` que ya está declarado.

En `routes/index.ts`: `apiRouter.use("/account", accountRouter);` — ponlo **después** de `/auth` y antes de `/workspaces`, y comenta que existe porque `DELETE /auth/account` es la cuenta pero esto no es autenticación.

- [ ] **Step 6: El documento**

`docs/architecture/api-conventions.md`, debajo del párrafo de las líneas 35-37 que ya habla de "a response that is not an envelope": un párrafo corto que dice que hay dos respuestas que no llevan sobre —los ficheros de export— que salen por `sendFile` con `Content-Disposition` y `Cache-Control: no-store`, y que `errorHandler` se aparta en cuanto `res.headersSent` es cierto, así que un error después de empezar a escribir no se puede convertir en JSON.

- [ ] **Step 7: Correr los tests y verlos pasar**

```
cd apps/api && npx vitest run test/export.test.ts
```
Expected: PASS, todos.

- [ ] **Step 8: La suite entera de la API, por el efecto en el resto**

```
cd apps/api && npx vitest run
```
Expected: PASS. Si algo falla y no es de export, es porque `sendFile` cambió algo compartido — párate y mira antes de seguir.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/export/export-service.ts apps/api/src/routes/account.ts apps/api/src/routes/respond.ts apps/api/src/routes/lists.ts apps/api/src/routes/index.ts apps/api/test/export.test.ts docs/architecture/api-conventions.md
git commit -m "Sacar el contenido de la cuenta y de una lista, y lo que se borra tambien sale"
```

---

### Task 4: `apiRaw` — que el cliente pueda pedir bytes sin parsearlos

**Files:**
- Modify: `apps/mobile/src/lib/api/client.ts`
- Modify: `apps/mobile/test/export.test.ts`

**Interfaces:**
- Consumes: `getAccessToken`, `onUnauthorized`, `buildUrl`, `createRequestSignal` — **todos ya están en ese fichero y son privados hoy**.
- Produces:
  - `interface PendingRequest { url: string; headers: Record<string, string>; send(): Promise<Response> }`
  - `apiRaw(path: string, options?: RequestOptions): Promise<PendingRequest>`

Por qué `PendingRequest` y no un `Response`: **en un móvil la respuesta tiene que llegar a un fichero, no a la memoria.** Un `Response` obliga a la app a leer varios megas de JSON en JS y pasarlos por base64, que es justo lo que `lib/notes/attachments.ts` ya explica que no se hace. `expo-file-system` escribe la respuesta directamente a disco desde la URL. Por eso esto devuelve URL y cabeceras y deja el envío para `send()`.

- [ ] **Step 1: Escribir el test que falla**

En `apps/mobile/test/export.test.ts`, un `describe` nuevo para la composition de la petición. No necesita red: `apiRaw` devuelve la petición **sin enviarla**, así que el test sólo mira lo que returns.

```ts
import { apiRaw, configureApiClient } from '@/lib/api/client';

/**
 * `configureApiClient` muta estado a nivel de módulo, así que **los tres tests
 * configuran su propio token**. Si uno depende del que dejó el anterior, el test
 * pasa por casualidad y no porque el código sea correcto.
 */
describe('apiRaw', () => {
  it('pone el token en las cabeceras sin enviar nada todavia', async () => {
    configureApiClient({ getAccessToken: async () => 'tok-123' });
    const pending = await apiRaw('/account/export', { query: { format: 'json' } });

    expect(pending.url).toContain('/account/export');
    expect(pending.url).toContain('format=json');
    expect(pending.headers.Authorization).toBe('Bearer tok-123');
  });

  it('no manda Authorization cuando la peticion es anonima', async () => {
    configureApiClient({ getAccessToken: async () => 'tok-123' });
    const pending = await apiRaw('/health', { anonymous: true });

    expect(pending.headers.Authorization).toBeUndefined();
  });

  it('permite al llamante cambiar el Accept', async () => {
    configureApiClient({ getAccessToken: async () => 'tok-123' });
    const pending = await apiRaw('/lists/l1/export', {
      headers: { Accept: 'text/csv' },
    });

    expect(pending.headers.Accept).toBe('text/csv');
  });
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

```
cd apps/mobile && npx vitest run test/export.test.ts
```
Expected: FAIL — `apiRaw` no está exportado.

- [ ] **Step 3: Implementarlo**

Saca el núcleo que hoy vive dentro de `apiRequest` a un `request()` privado que las dos rutas usan: construir URL, la cabecera `Accept`, `Authorization` si no es anónima, el timeout con `createRequestSignal`, y el `execute` con su `catch`. `apiRequest` se queda como está encima de ese núcleo, con su parseo del sobre; **no lo reescribas, llámalo.** La razón de que sea un núcleo compartido y no dos copias es que el refresh de 401 y el timeout no pueden portarse de una forma en un camino y de otra en el otro.

`apiRaw` hace `await getAccessToken()` y devuelve `{ url, headers, send }` donde `send()` es un `fetch` con esas cabeceras, el método y el `signal`, y que en un 401 llama a `onUnauthorized()` y reintenta **una** vez.

- [ ] **Step 4: Correr los tests y verlos pasar**

```
cd apps/mobile && npx vitest run test/export.test.ts
```
Expected: PASS, los 5 de `exportFilename` y los 3 de `apiRaw`.

- [ ] **Step 5: Typecheck**

```
npm run typecheck --workspace @orbit-hub/mobile
```
Expected: código 0.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/api/client.ts apps/mobile/test/export.test.ts
git commit -m "Pedir bytes sin parsearlos, que en un movil la respuesta va a un fichero"
```

---

### Task 5: La entrega — instalar `expo-sharing`, guardar el fichero, y saber qué fallo

**Files:**
- Modify: `apps/mobile/package.json` (mediante `npx expo install expo-sharing`)
- Create: `apps/mobile/src/lib/export/save.ts`
- Create: `apps/mobile/src/lib/export/errors.ts`
- Create: `apps/mobile/src/hooks/use-export.ts`
- Modify: `apps/mobile/test/export.test.ts`

**Interfaces:**
- Consumes: `apiRaw` de Task 4, `exportFilename` del contrato, `exportErrorKey` se consume en Task 6.
- Produces:
  - `export const EXPORT_TIMEOUT_MS = 120_000`
  - `saveExport(args: { pending: PendingRequest; filename: string }): Promise<'downloaded' | 'shared'>`
  - `readSavedEnvelope(args: { path: string; format: 'json' | 'csv' }): Promise<AccountExport | ListExport | null>` — **sólo nativo**
  - `exportErrorKey(error: unknown): TranslationKey | null`
  - `useExport(): UseExport`, donde `UseExport` expone `{ running: boolean; error: ApiError | null; filename: string | null; result: ExportResult | null; run(args: { path: string; format: 'json' | 'csv'; title: string; fallbackId: string }): Promise<ExportResult | null> }` y `ExportResult` es `{ counts: AccountExport['counts'] | ListExport['counts']; how: 'downloaded' | 'shared'; filename: string }`

**Los `counts` salen del fichero, y eso obliga a que las dos plataformas los consigan de forma distinta.** En web, `send()` devuelve un `Response` cuyo `blob()` hay que leer igualmente, así que se parsea ese mismo `Response` y se le pasa a `saveExport` — un solo envío. En nativo **no hay ningún `Response` que parsear**: `File.downloadFileAsync` lleva los bytes del `Response` a un fichero de la caché y el `Response` no existe. La única forma de tener los `counts` ahí es releer el fichero recién escrito.

Y releerlo es además lo correcto: **los números que se enseñan salen del fichero que ha quedado en disco**, no de una respuesta que nadie ha mirado. Si el fichero se escribió mal, los números no cuadran y se ve.

`run()` lee `Platform.OS` una vez para decidir, y **ningún módulo nativo se importa fuera de `save.ts`**. Eso es lo que mantiene `save.ts` importable desde un test con el stub de `react-native`.

El superset de `UseExport` —`error`, `filename`, `result`— no es adorno: sin ellos la Task 6 no puede pintar `export.saved` ni un error reintentable, y la hoja de resultado necesita el `how` para decir si el fichero se descargó o se compartió.

`EXPORT_TIMEOUT_MS` es explícito y grande a propósito: `DEFAULT_TIMEOUT_MS` está puesto para JSON pequeño, y un export de varios megas lo termina contra un error de timeout que no es un timeout.

`exportErrorKey` **no importa `react-native`** y por eso es lo único de esta tarea que lleva test. Devuelve `null` para lo que no es un error de API.

- [ ] **Step 1: Escribir los tests que fallan**

En `apps/mobile/test/export.test.ts`, sobre `exportErrorKey`. `ApiError` se importa de `@/lib/api/client`; es una clase de error normal y se puede construir en un test.

```ts
import { ApiError, toApiError } from '@/lib/api/client';
import { exportErrorKey } from '@/lib/export/errors';

describe('exportErrorKey', () => {
  it('dice que se puede reintentar cuando se corta la red', () => {
    expect(exportErrorKey(new ApiError({ kind: 'network', message: 'x' })))
      .toBe('export.error.network');
  });

  it('trata un timeout como reintentable', () => {
    expect(exportErrorKey(new ApiError({ kind: 'timeout', message: 'x' })))
      .toBe('export.error.network');
  });

  it('avisa cuando el servidor dice que no hay permiso', () => {
    expect(exportErrorKey(new ApiError({ kind: 'forbidden', message: 'x', status: 403 })))
      .toBe('export.error.forbidden');
  });

  it('avisa cuando no encuentra la lista', () => {
    expect(exportErrorKey(new ApiError({ kind: 'not_found', message: 'x', status: 404 })))
      .toBe('export.error.notFound');
  });

  it('no inventa una clave para un error que no es de la API', () => {
    expect(exportErrorKey(new Error('boom'))).toBeNull();
  });
});
```

`kind: 'network'` y `kind: 'timeout'` dan la misma clave a propósito: para quien está mirando, "se cortó" y "tardó demasiado" son el mismo problema con la misma solución, que es volver a pulsar.

- [ ] **Step 2: Correrlos y verlos fallar**

```
cd apps/mobile && npx vitest run test/export.test.ts
```
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Instalar `expo-sharing`**

```
cd apps/mobile && npx expo install expo-sharing
```

**No escribas la versión a mano.** `npx expo install` la saca de `node_modules/expo/bundledNativeModules.json`, que dice `"expo-sharing": "~57.0.22"`, y el CI corre `npx --yes expo-doctor@latest apps/mobile`, que falla si la versión no encaja con el SDK. Escribir `^` o una versión inventada rompe el CI aunque la app funcione en local. Debe quedar en `dependencies` con `~`, en orden alfabético entre `expo-router` y `expo-secure-store`.

**El lockfile está en la raíz y en ningún otro sitio.** `apps/mobile/package-lock.json` no existe: es un solo `package-lock.json` en la raíz del monorepo. Es ése —y sólo ése— el que hay que stagear con la dependencia nueva.

- [ ] **Step 4: Las claves de traducción — aquí, no en la Task 6**

Van en esta tarea y no en la siguiente, por una razón que no es de orden sino de compilar: `exportErrorKey` devuelve `TranslationKey`, y `TranslationKey` es `keyof typeof es`. Si las claves no existen todavía, el typecheck de esta tarea falla antes de haber empezado aovable la que hay después.

En `es` y en `en`, dentro del bloque de `settings.*` que ya existe, y manteniendo los dos en el mismo orden:

```
"export.title":              "Exportar mis datos"
"export.running":            "Preparando el fichero…"
"export.done.one":           "{count} elemento"
"export.done.other":         "{count} elementos"
"export.counts":             "{lists} listas · {items} elementos · {notes} notas"
"export.saved":              "Guardado como {name}"
"export.retry":              "Reintentar"
"export.close":              "Cerrar"
"export.error.network":      "No se pudo descargar. Comprueba la conexión y reinténtalo."
"export.error.forbidden":    "No tienes permiso para exportar esto."
"export.error.notFound":     "Ya no está, o nunca estuvo donde la buscabas."
"export.error.rateLimited":  "Demasiadas exportaciones seguidas. Espera un momento."
"export.error.unauthorized": "Tu sesión ha caducado. Vuelve a entrar."
"export.error.internal":     "Algo falló al preparar el fichero."
"export.format":             "Formato"
"export.format.csv":         "CSV — para Excel y Google Sheets"
"export.format.json":        "JSON — copia completa"
```

En inglés: `"Export my data"`, `"A copy of all your content, in JSON."`, `"Preparing the file…"`, `"{count} item"` / `"{count} items"`, `"{lists} lists · {items} items · {notes} notes"`, `"Saved as {name}"`, `"Try again"`, `"Close"`, `"The file could not be downloaded. Check your connection and try again."`, `"You do not have permission to export this."`, `"It is gone, or it was never where you looked."`, `"Too many exports in a row. Give it a moment."`, `"Your session expired. Sign in again."`, `"Something went wrong while preparing the file."`, `"Format"`, `"CSV — for Excel and Google Sheets"`, `"JSON — full backup"`.

`export.done` es un par **`.one`/`.other`** a propósito: `lib/i18n/plural.ts` construye la clave desde la base, y una base sin las dos formas no compila.

`export.counts` lleva tres `{placeholders}` en una sola cadena en vez de tres claves: son una línea sobre otra, no tres frases, y `translations.test.ts` ya recorre los `src/**` y falla si una clave con `{name}` se llama sin el segundo argumento.

`export.format` y `export.format.csv` / `export.format.json` no se pintan hasta la Task 6. Se escriben ahora porque son del mismo grupo y dejarlas para después haría que esta tarea pasara su typecheck sólo por casualidad.

- [ ] **Step 5: `errors.ts`**

Puro. `ApiError` y `toApiError` son lo único que importa. Un `switch` sobre `error.kind` con `network`/`timeout`/`offline` juntos, `forbidden`, `not_found`, `rate_limited`, `unauthorized`, y `null` para el resto. `exportErrorKey` envuelve con `toApiError` y devuelve `null` si lo que le pasaron no era un error.

- [ ] **Step 6: `save.ts`**

El patrón de `lib/notes/image-store.ts` **exacto**: `Platform.OS === 'web'` primero, y los módulos nativos con `await import(...)` dentro de la rama, nunca arriba. En web el import nativo no llega a ejecutarse; en un test de Node el stub de `react-native` da `Platform.OS === 'web'` y por eso el fichero es importable desde un test aunque no se pueda probar su rama nativa.

- **Web**: `const response = await pending.send(); const blob = await response.blob();` — el `response.text()` de `apiRequest` no sirve aquí. Luego `URL.createObjectURL`, un `<a download={filename}>` que no está en el documento, `click()`, `remove()`, y **`URL.revokeObjectURL` en el `finally`**. El `revokeObjectURL` es lo único que `image-store.ts` no hace y es lo único que no es opcional: `image-store` guarda las URLs en un mapa porque las reutiliza para pintar imágenes; una descarga se usa una vez, y sin liberarla se fuga un blob entero por cada export.
- **Nativo**: `await File.downloadFileAsync(pending.url, destino, pending.headers)` con `destino` en `Paths.cache`, y luego `Sharing.shareAsync(destino.uri, { mimeType, dialogTitle: filename })`. El `mimeType` es `text/csv` o `application/json` según lo pedido.

El destino **no** lleva el `filename` que devuelve `exportFilename` como nombre de carpeta: el fichero sí, y es el `dialogTitle` del `shareAsync`. `downloadFileAsync` quiere una ruta de fichero, no un directorio.

- [ ] **Step 7: `use-export.ts`**

`run()` es un `async` que: monta `running`, limpia `error` y `result`, llama a `apiRaw(path, { query: { format }, timeoutMs: EXPORT_TIMEOUT_MS })`, llama a `exportFilename` con `new Date().toISOString().slice(0, 10)`, y entrega el fichero a `saveExport`. Los `counts` salen del sobre, y **la forma de llegar al sobre depende de la plataforma** — ver la sección de Interfaces de esta misma tarea.

El tipo que devuelve `run` es `AccountExport['counts'] | ListExport['counts']`, **derivado de los tipos del contrato y escrito así**. No declares una interfaz `ExportCounts` propia: una segunda definición de la forma de los `counts` es una que se queda vieja en cuanto el contrato cambie, y el typecheck no la caza.

Un fallo de red o timeout **no** borra el estado ni lanza: deja `error` a mano para que la hoja lo pinte como reintentable. Un `forbidden` o un `not_found` tampoco.

- [ ] **Step 8: Correr los tests y verlos pasar**

```
cd apps/mobile && npx vitest run test/export.test.ts
```
Expected: PASS, 13 en total.

- [ ] **Step 9: Typecheck y el doctor**

```
npm run typecheck --workspace @orbit-hub/mobile && npx --yes expo-doctor@latest apps/mobile
```
Expected: typecheck 0, y el doctor sin quejas sobre `expo-sharing`.

- [ ] **Step 10: Commit**

MIRA `git status` antes de stagear. `npx expo install` toca `apps/mobile/package.json` y el `package-lock.json` **de la raíz**. Si el `package.json` de la raíz también aparece modificado, no lo stages sin mirar por qué: en este worktree ese fichero estaba limpio, así que un cambio ahí es del comando y probablemente no deba commitearse.

```bash
git add apps/mobile/package.json package-lock.json apps/mobile/src/lib/export/save.ts apps/mobile/src/lib/export/errors.ts apps/mobile/src/hooks/use-export.ts apps/mobile/src/lib/i18n/dictionaries.ts apps/mobile/test/export.test.ts
git commit -m "Guardar el fichero en los tres sistemas, y expo-sharing porque no hay otra manera"
```

---

### Task 6: Las dos superficies — el menú de la lista, la fila de Ajustes y las traducciones

**Files:**
- Modify: `apps/mobile/src/components/lists/list-menu-sheet.tsx`
- Modify: `apps/mobile/src/app/(app)/settings.tsx`
- Create: `apps/mobile/src/components/export/export-result-sheet.tsx`

**Interfaces:**
- Consumes: `useExport` de Task 5, `exportErrorKey` de Task 5, `Sheet`/`SheetOptions`/`useLastValue`, `LIST_KIND_LABEL` de `@/lib/lists/kind`, y **las claves `export.*`, que ya están escritas desde la Task 5** —esta tarea las lee, no las crea.
- Produces: nada que otra tarea consuma.

**Las claves de traducción van en la Task 5 y no aquí**, porque `exportErrorKey` devuelve `TranslationKey` y `TranslationKey` es `keyof typeof es`: escribirlas aquí haría que la Task 5 no pasara su typecheck. Si este fichero necesita una clave que no está, **vuelve a la Task 5 y añádela en los dos idiomas a la vez**.

**Ninguna de estas dos superficies lleva test de componente, y no porque no se pueda escribir.** `apps/mobile/vitest.config.ts` tiene `include: ['test/**/*.test.ts']` — sólo `.ts`, no `.tsx` — y el `react-native` del proyecto está aliaseado a un stub que exporta `Platform`, `AppState`, `StyleSheet`, `PixelRatio`, `Dimensions`, `Linking` y `Alert`, y nada más. Una prueba de render no se puede escribir hoy sin montar un harness que este repo no tiene. El portón de esta tarea es `npm run typecheck` más la Task 7, y **esa es la razón por la que la Task 7 no es opcional**.

- [ ] **Step 1: La página `export` del menú de lista**

`type Page` pasa a ser `"options" | "rename" | "share" | "export" | "delete"`.

El `SheetOption` va entre el de compartir y el de borrar: `key: "export"`, `icon: "download-outline"`, `label: t("export.list.title")`, `description: t("export.list.body")`, `onPress: () => setPage("export")`.

La página es un `SheetOptions` con dos filas —`export.format.json` y `export.format.csv`, en ese orden— y `onPress` en cada una que hace `onClose()` y luego `void run(...)`. **`onClose()` antes de `run()`, no después**, por lo mismo que hace `duplicateList` en el fichero: la hoja se va y el trabajo sigue.

El `subtitle` es un ternario más sobre `page`, y `export` cae en la línea de "en qué formato".

Borra de paso **el bloque de comentario duplicado** que hay encima de `const list = useLastValue(pedido)`: hay dos copias del mismo párrafo, una de las dos se cortó a mitad ("and the caller's own argument"). Es basura de edición de otra persona en un fichero que vas a tocar de todos modos, y no es un cambio de comportamiento.

- [ ] **Step 2: La hoja de resultado**

`export-result-sheet.tsx`: `Sheet` con `useLastValue` como los demás, `title={t("export.title")}`, y dentro los `counts` con `export.counts`, el nombre del fichero con `export.saved`, y un `Button` de cerrar. Cuando hay error, el texto del error y un botón de reintentar que **vuelve a llamar a `run` con los mismos argumentos**, no a algo nuevo: reintentar tiene que ser la misma petición otra vez.

- [ ] **Step 3: La fila de Ajustes**

El `onPress` vacío y su comentario desaparecen. En su lugar, un `useExport()` y un estado de resultado.

**`ListRow` no tiene prop `loading`** — sus props son `leading`, `title`, `subtitle`, `icon`, `onPress`, `rightLabel`, `chevron`, `destructive`, `disabled` y `style`. El estado de trabajo va con las que sí existen: `disabled={running}` para que no se pueda pulsar dos veces, y el `subtitle` cambia de `t("settings.export.body")` a `t("export.running")` mientras corre. **No añadas una prop a `ListRow`** para esto: es el componente que usan todas las pantallas y una prop que sólo lee un sitio es una prop que otro acabará usando mal.

La pantalla usa `useI18n()` y comillas simples; `list-menu-sheet.tsx` usa `useTranslation()` y comillas dobles. Cada fichero, con lo suyo.

Al terminar, `export-result-sheet` se abre con los `counts`. Sin hoja de formato —el formato ya está decidido— y sin confirmación: el subtítulo de la fila ya dice "Descarga una copia de todo tu contenido".

- [ ] **Step 4: Que los dos idiomas sigan siendo el mismo conjunto**

```
cd apps/mobile && npx vitest run test/translations.test.ts
```
Expected: PASS. Este test es el que dice que es y en tienen exactamente las mismas claves, así que una traducción sin su pareja es un test rojo y no algo que se note en la aplicación.

- [ ] **Step 5: Typecheck de los dos workspaces**

```
npm run typecheck --workspace @orbit-hub/mobile && npm run typecheck --workspace @orbit-hub/api
```
Expected: ambos 0.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/components/lists/list-menu-sheet.tsx apps/mobile/src/app/\(app\)/settings.tsx apps/mobile/src/components/export/export-result-sheet.tsx
git commit -m "Exportar desde el menu de la lista y desde Ajustes, y decir cuantas cosas salieron"
```

---

### Task 7: Abrirlo en un navegador y mirarlo

No es código y no se commitea. Es el portón que AGENTS.md pone a un cambio de interfaz, y es el único que de verdad importa aquí.

**No hay emulador ni dispositivo en esta máquina.** Android e iOS no se comprueban, y el spec lo dice en vez de suponerlo. Lo que se puede mirar es la web.

- [ ] **Step 1: Levantar la API y la web**

```
npm run dev --workspace @orbit-hub/api
npm run web --workspace @orbit-hub/mobile
```

- [ ] **Step 2: Ajustes → la fila que antes no hacía nada**

En claro y en oscuro. La fila "Exportar mis datos" ahora hace algo: se ve el estado de trabajo, y al terminar la hoja con los `counts`. Comprueba que los `counts` **coinciden con lo que hay en la cuenta** — cuentas un par de listas y dos notas y mira que los números son esos.

- [ ] **Step 3: Descargar el fichero y abrirlo**

Que el navegador baje un `.json`. Ábrelo con un editor de texto y comprueba **que `counts` cuadra con la longitud de cada array**. Es la aserción que el fichero lleva para poder ser comprobado, y es la que falla en silencio cuando el export sale a medias.

- [ ] **Step 4: Una lista → exportar → CSV**

Desde el menú de una lista con acentos en el título. Que el fichero se llame con el acento y que al abrirlo en una hoja se vea **una columna por columna**, con los acentos correctos y las etiquetas en una celda. Si el BOM se pierde, `El niño` sale como `El niÃ±o` — ése es el fallo que se busca aquí.

- [ ] **Step 5: El caso del spec, en el navegador**

Una lista con una anotación de varias líneas: en la hoja tiene que ocupar **una** celda con saltos de línea dentro, y no ocupar tres filas. Ése es el Review Focus #2 viéndose en la pantalla en vez de en un test.

- [ ] **Step 6: La lista de unión, en el navegador**

Una lista de cine con `year`, `release_date` e `image_url` llenas, al lado de una lista de tareas con esas tres columnas vacías. Vacío es lo correcto para una tarea; `undefined` escrito dentro de la celda no lo es.

- [ ] **Step 7: Fallar a propósito, en el navegador**

Con el servidor parado, pulsar exportar: sale el mensaje de red y el botón de reintentar, no una pantalla en blanco y no un fallo silencioso. Ése es el estado que se pinte desde `exportErrorKey`.

---

## Self-Review

**Cobertura del spec.** Cada sección del spec tiene tarea: el sobre y el nombre → 1; JSON y CSV → 2; endpoints, autorización, `sendFile`, el documento → 3; `apiRaw` y el timeout → 4; las tres plataformas, `expo-sharing` y el `revokeObjectURL` → 5; Ajustes, menú, hoja de resultado e i18n → 6; el navegador en claro y oscuro → 7. El `.zip`, el trabajo en segundo plano, el CSV de cuenta y la importación están explícitamente fuera en la última sección del spec, y el contrato rechaza el CSV de cuenta en la Task 1 — que es lo que hace que esa omisión sea una decisión y no un olvido.

**Barrido de pasos.** Los pasos de test traen los valores exactos del spec. Los de código traen firma y fichero; el cuerpo aparece sólo donde la firma y los tests no determinan el cuerpo —el `slug` de `exportFilename`, la normalización de NFD, el `metadataCell`—. Ningún paso dice "añadir validación" ni "manejar los casos límite": los casos límite son los tests.

**Consistencia de tipos.** `PendingRequest` se crea en la 4 y lo consumen la 5. `exportErrorKey` se crea en la 5 y lo consume la 6. `EXPORT_TIMEOUT_MS` y `saveExport` nacen en la 5. `LIST_EXPORT_CSV_COLUMNS` nace en la 1 y lo usan el builder de la 2 y su test. `sendFile` nace en la 3. `accountExportSchema` y `listExportSchema` nacen en la 1, los valida el servicio de la 3 y los parsea `useExport` en la 5.

**Review Focus.** Los cinco tienen su test: el 1 y el 4 en `export.test.ts` (Task 3), el 2, el 3 y el 5 en `export-builders.test.ts` (Task 2). Los cinco se vuelven a mirar en el navegador en la Task 7.

**Proporción.** Ocho tareas, un commit cada una, cada paso con un resultado comprobable. Lo que no tiene test —los componentes y la rama nativa— lo dice la propia tarea en vez de fingir que sí.
