# Bookmarks fase 1: el dominio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear `collections` y `bookmarks` como entidades sincronizables propias, de punta a punta: tablas, contratos, registro en el motor de sync, lecturas REST y las acciones de cliente que las guardan offline.

**Architecture:** Dos tablas nuevas de Drizzle calcadas de `lists` y `notes`. El cliente escribe por sync (`url`, `title`, `collectionId`, `folderId`, `tags`, `position`); el servidor es dueno de `document`, `plainText`, `description`, `imageUrl`, `siteName` y `extractionState`, y esos campos no estan en `SYNC_WRITABLE_FIELDS` para que ningun cliente pueda pisarlos. La lectura es REST mas la cache generica `cached_entities`, que no necesita cambios de esquema.

**Tech Stack:** Drizzle ORM + Postgres (PGlite en tests), Express 5, Zod v4 (`packages/contracts`), Vitest, expo-sqlite + expo-router en el cliente.

**Spec:** `docs/superpowers/specs/2026-10-05-bookmarks-share-target-design.md` — el plan razona desde ahi, y el spec viaja con el. La seccion "La frontera de escritura" y la de "Las cinco fases" son las que gobiernan esta fase.

## Global Constraints

- **Comentarios y prosa en espanol SIN tildes; strings de UI CON tildes, en espanol e ingles.** Las dos cosas, siempre: cada string nuevo va dos veces en `apps/mobile/src/lib/i18n/dictionaries.ts` (es ~linea 816, en ~linea 1832).
- **Ninguna escritura se pierde sin red.** Todo camino de escritura escribe local y encola. Un bookmark se guarda aunque la app no tenga conexion.
- **La autorizacion es del servidor.** Un cliente nunca es una frontera de seguridad. Cualquier `folderId` o `collectionId` que llegue debe verificarse contra el workspace que dice el payload.
- **Los tokens en commit son Conventional Commits, espanol, sin tildes.** Nunca `Co-Authored-By` ni atribucion de IA.
- **Rutas en `apps/api/src/routes/*.ts` y tests en `apps/api/test/*.test.ts`.** No dentro de `src/modules/`.
- **Design tokens only.** Ni un color, espaciado ni radio hardcodeado en cliente: `useTheme()`.
- **No tocar** `apps/api/drizzle/meta/_journal.json` a mano: lo escribe `drizzle-kit generate`. Los `when` existentes no estan ordenados por reloj y regenerarlos rompe el historial.
- **No tocar** `LIST_KINDS`, `list_items`, `apps/mobile/src/lib/shares/pending-node.ts` ni los cuatro sitios literales de `'list_item'` en `local-store.ts`. Ver Task 7 para el porque de cada uno.

## Review Focus

Cinco entradas que la spec promete pero que ninguna tarea exercise todavia, y que son las que mas van a morder. Cada linea tiene su test en la tarea que es duena del codigo.

1. **Un cliente manda `document` y el servidor lo descarta en silencio.** El push responde `applied` y suma `version`, asi que parece que funciono y el articulo no se guardo nunca. *Tarea 5.*
2. **Un `title` de 400 caracteres** contra un `varchar(300)`: sin entrada en `STRING_LIMITS` el troceador aplica su default de 500 y Postgres lanza un error de longitud en vez de una validacion limpia. *Tareas 4 y 5.*
3. **Un `folderId` o `collectionId` de OTRO workspace** (bug de cliente, o cliente manipulado): el bookmark queda archivado en un espacio al que la persona no pertenece, o desaparece del conteo de su espacio. *Tarea 5.*
4. **Borrar una coleccion con 50 bookmarks dentro.** Lo esperable es que los 50 sobrevivan y queden "sin clasificar". Lo facile es que el `ON DELETE` los borre en cascada y la persona pierda 50 enlaces sin aviso. *Tareas 2 y 5.*
5. **Una URL de 5000 caracteres, o un `data:` URI** que un share payload puede traer pegado: `z.url()` acepta `data:` y `text` no tiene tope. Lo esperable es rechazarlo con un error legible, no guardarlo. *Tarea 5.*

## Estructura de archivos

**Crear**
| archivo | responsabilidad |
| --- | --- |
| `apps/api/drizzle/0021_collections.sql` | tabla `collections`, generada |
| `apps/api/drizzle/0022_bookmarks.sql` | tabla `bookmarks` + indices trigram y GIN a mano |
| `packages/contracts/src/bookmarks.ts` | esquemas `collectionSchema`, `bookmarkSchema`, `bookmarkExtractionStateSchema` y sus `*_MAX` |
| `apps/api/src/modules/collections/collection-service.ts` | lecturas y validacion de collections |
| `apps/api/src/modules/bookmarks/bookmark-service.ts` | lecturas y validacion de bookmarks |
| `apps/api/src/routes/collections.ts` | router de collections |
| `apps/api/src/routes/bookmarks.ts` | router de bookmarks |
| `apps/mobile/src/lib/collections/actions.ts` | `createCollectionAction`, `updateCollectionAction` |
| `apps/mobile/src/lib/bookmarks/actions.ts` | `createBookmarkAction`, `updateBookmarkAction` |
| `apps/api/test/collections-sync.test.ts` | sync e2e de collections |
| `apps/api/test/bookmarks-sync.test.ts` | sync e2e de bookmarks, con los cinco Review Focus |
| `apps/api/test/bookmarks-api.test.ts` | lecturas REST de ambos |

**Modificar**
| archivo | que cambia |
| --- | --- |
| `apps/api/src/db/content-schema.ts` | `collections`, `bookmarks`, sus `relations`, `CollectionRow`, `BookmarkRow` |
| `apps/api/src/db/constants.ts` | `BOOKMARK_EXTRACTION_STATES`, `SYNC_ENTITIES`, `SYNC_WRITABLE_FIELDS` |
| `apps/api/src/modules/sync/sync-service.ts` | `STRING_LIMITS`, `sanitisePayload`, `apply` (create/update/delete) |
| `apps/api/src/modules/sync/sync-repository.ts` | `SyncEntityTable`, `table()`, `toEntityName()` |
| `apps/api/src/modules/sync/mounts.ts` | `espacioDe()` y la proyeccion de `workspaceId` |
| `apps/api/src/routes/index.ts` | montar los dos routers |
| `apps/api/test/sync-limits.test.ts` | dos pares mas en el array `columns` |
| `packages/contracts/src/sync.ts` | `syncEntitySchema` |
| `packages/contracts/src/index.ts` | `export * from './bookmarks'` |
| `apps/mobile/src/lib/content-order.ts` | `kind` incluye `'collection'` y `'bookmark'` |
| `apps/mobile/src/lib/content-order-save.ts` | `ENTITY_DE` |

---

### Task 1: La tabla `collections`

**Files:**
- Modify: `apps/api/src/db/content-schema.ts` (anadir `collections` y `collectionsRelations` despues de `listsRelations`, ~linea 400)
- Modify: `apps/api/src/db/constants.ts:57-63` (anadir `BOOKMARK_EXTRACTION_STATES` al lado de `LIST_KINDS`, porque lo necesita el tipo de la Task 2)
- Test: `apps/api/test/collections-table.test.ts`

**Interfaces:**
- Consumes: `workspaces`, `folders` ya declarados en el mismo archivo.
- Produces: `collections` (tabla Drizzle), `collectionsRelations`, `type CollectionRow = typeof collections.$inferSelect`, y `BOOKMARK_EXTRACTION_STATES` / `type BookmarkExtractionStateName` en `constants.ts`, que Task 2 usa en `bookmarks.extractionState`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/collections-table.test.ts`:

```ts
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { collections } from '../src/db/content-schema.js';

describe('la tabla collections', () => {
  it('declara el nombre con el ancho que el contrato tambien exige', () => {
    const columns = getTableColumns(collections);
    expect(columns.name).toBeDefined();
    expect('length' in columns.name ? columns.name.length : null).toBe(120);
  });

  it('cuelga de un workspace y de una carpeta opcional', () => {
    const columns = getTableColumns(collections);
    expect(columns.workspaceId).toBeDefined();
    expect(columns.folderId).toBeDefined();
    expect(columns.version).toBeDefined();
    expect(columns.deletedAt).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run api:test -- collections-table`
Expected: FAIL, porque `../src/db/content-schema.js` no exporta `collections`.

- [ ] **Step 3: Declarar `BOOKMARK_EXTRACTION_STATES` en `constants.ts`**

Junto a `LIST_KINDS` (~linea 57), con la misma forma `as const`:

```ts
/**
 * Los estados de la extraccion de un bookmark. Escribi los cuatro valores en
 * `packages/contracts/src/bookmarks.ts` tambien: ahi vive el `z.enum` que
 * valida la red, y aca el tipo que usa la columna. Es el mismo duplicado que
 * `LIST_KINDS` y `listKindSchema`.
 */
export const BOOKMARK_EXTRACTION_STATES = [
  'pending',
  'ready',
  'metadata_only',
  'failed',
] as const;
export type BookmarkExtractionStateName = (typeof BOOKMARK_EXTRACTION_STATES)[number];
```

- [ ] **Step 4: Declarar `collections` en `content-schema.ts`**

Inmediatamente despues de `listsRelations`. FK a `workspaces` con cascade, y `folderId` **con** `.references(() => folders.id, { onDelete: 'cascade' })`, siguiendo a `notes.folderId` y no a `lists.folderId`: una coleccion colgada de una carpeta tiene que caer con la carpeta, y sin la FK no habria quien lo borre.

```ts
export const collections = pgTable(
  'collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    description: varchar('description', { length: 500 }),
    emoji: varchar('emoji', { length: 16 }),
    position: integer('position').notNull().default(0),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('collections_workspace_updated_at_idx').on(table.workspaceId, table.updatedAt),
    index('collections_folder_idx').on(table.folderId),
    index('collections_deleted_at_idx').on(table.deletedAt),
  ],
);

export const collectionsRelations = relations(collections, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [collections.workspaceId], references: [workspaces.id] }),
  folder: one(folders, { fields: [collections.folderId], references: [folders.id] }),
  bookmarks: many(bookmarks),
}));

export type CollectionRow = typeof collections.$inferSelect;
```

La linea `bookmarks: many(bookmarks)` **todavia no compila**: `bookmarks` se declara en la Task 2. Dejala escrita y sigue; el typecheck de la Task 1 se corre en el Step 6, no antes.

Anadir `BookmarkExtractionStateName` a la lista de tipos importados desde `./constants.js` en el bloque `import type { ... }` que ya esta (~linea 20-27).

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run api:test -- collections-table`
Expected: PASS, los dos tests.

- [ ] **Step 6: Generar la migracion**

Run: `npm run db:generate --workspace @orbit-hub/api`
Expected: escribe `apps/api/drizzle/0021_collections.sql`, `apps/api/drizzle/meta/0021_snapshot.json` y agrega la entrada `idx: 21` a `_journal.json`. Verificar que el SQL contiene `CREATE TABLE "collections"` y los tres `CREATE INDEX`.

No editar el SQL a mano en esta tarea: `drizzle.config.ts` esta en `strict: true`, y lo que genera ya es el DDL final.

- [ ] **Step 7: Comprobar que la migracion aplica**

Run: `npm run api:test -- notes-sync`
Expected: PASS. Si el SQL de la migracion estuviera mal, `startTestServer()` (`test/helpers.ts:24`, que corre `runMigrations`) fallaria y caeria **toda** la suite, no este archivo.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/db/content-schema.ts apps/api/src/db/constants.ts \
  apps/api/drizzle/0021_collections.sql apps/api/drizzle/meta/ \
  apps/api/test/collections-table.test.ts
git commit -m "feat(db): la tabla collections, con su FK a carpetas y workspace"
```

---

### Task 2: La tabla `bookmarks`

**Files:**
- Modify: `apps/api/src/db/content-schema.ts` (anadir `bookmarks` y `bookmarksRelations` despues de `collectionsRelations`)
- Modify: `apps/api/drizzle/0022_bookmarks.sql` (anadir los indices a mano)
- Test: `apps/api/test/bookmarks-table.test.ts`

**Interfaces:**
- Consumes: `collections` y `collectionsRelations` (Task 1), `BookmarkExtractionStateName` (Task 1).
- Produces: `bookmarks`, `bookmarksRelations`, `type BookmarkRow = typeof bookmarks.$inferSelect`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/bookmarks-table.test.ts`:

```ts
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { bookmarks } from '../src/db/content-schema.js';

describe('la tabla bookmarks', () => {
  it('guarda la URL sin tope, y el sitio y el error de extraccion acotados', () => {
    const columns = getTableColumns(bookmarks);
    expect('length' in columns.url ? columns.url.length : 'sin-tope').toBe('sin-tope');
    expect('length' in columns.siteName ? columns.siteName.length : null).toBe(120);
    expect('length' in columns.extractionError ? columns.extractionError.length : null).toBe(200);
  });

  it('arranca pending, con el documento vacio', () => {
    const columns = getTableColumns(bookmarks);
    expect(columns.document).toBeDefined();
    expect(columns.plainText).toBeDefined();
    expect(columns.extractionState).toBeDefined();
  });

  it('colga de workspace, carpeta y coleccion', () => {
    const columns = getTableColumns(bookmarks);
    expect(columns.workspaceId).toBeDefined();
    expect(columns.folderId).toBeDefined();
    expect(columns.collectionId).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run api:test -- bookmarks-table`
Expected: FAIL, `bookmarks` no esta exportado todavia.

- [ ] **Step 3: Declarar `bookmarks` en `content-schema.ts`**

Despues de `collectionsRelations`. La columna que define Review Focus #4 es `collectionId`:

```ts
export const bookmarks = pgTable(
  'bookmarks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'cascade' }),
    collectionId: uuid('collection_id').references(() => collections.id, { onDelete: 'set null' }),
    url: text('url').notNull(),
    title: varchar('title', { length: 300 }).notNull().default(''),
    siteName: varchar('site_name', { length: 120 }),
    description: text('description'),
    imageUrl: text('image_url'),
    document: text('document').notNull().default(''),
    plainText: text('plain_text').notNull().default(''),
    extractionState: varchar('extraction_state', { length: 16 })
      .$type<BookmarkExtractionStateName>()
      .notNull()
      .default('pending'),
    extractionError: varchar('extraction_error', { length: 200 }),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    position: integer('position').notNull().default(0),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('bookmarks_workspace_updated_at_idx').on(table.workspaceId, table.updatedAt),
    index('bookmarks_folder_idx').on(table.folderId),
    index('bookmarks_collection_idx').on(table.collectionId),
    index('bookmarks_deleted_at_idx').on(table.deletedAt),
  ],
);

export const bookmarksRelations = relations(bookmarks, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [bookmarks.workspaceId], references: [workspaces.id] }),
  folder: one(folders, { fields: [bookmarks.folderId], references: [folders.id] }),
  collection: one(collections, { fields: [bookmarks.collectionId], references: [collections.id] }),
}));

export type BookmarkRow = typeof bookmarks.$inferSelect;
```

**`onDelete: 'set null'` en `collectionId` no es una eleccion de estilo, es la regla de la spec escrita en el esquema.** Con `cascade` —que es lo que hacen las otras FKs de este archivo— borrar una coleccion se lleva por delante sus 50 bookmarks y la persona pierde 50 enlaces sin que nadie le avise. Con `set null` los 50 sobreviven y quedan "sin clasificar", que es exactamente lo que la spec promete. El test de Review Focus #4 lo verifica por comportamiento en la Task 5.

Por eso `collectionsRelations` declara `bookmarks: many(bookmarks)` y esta tabla declara `collection: one(collections, ...)`: la relacion es de ida y vuelta y las dos puntas tienen que existir.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run api:test -- bookmarks-table`
Expected: PASS, los tres.

- [ ] **Step 5: Generar la migracion**

Run: `npm run db:generate --workspace @orbit-hub/api`
Expected: escribe `apps/api/drizzle/0022_bookmarks.sql`, su snapshot, y la entrada `idx: 22` en el journal.

- [ ] **Step 6: Anadir los dos indices que drizzle-kit no sabe expresar**

Al final de `apps/api/drizzle/0022_bookmarks.sql`, copiando el bloque y el comentario de `0012_notes_and_attachments.sql:38-54`. Los indices trigram sobre `notes.plain_text` y GIN sobre `notes.tags` se escribieron a mano por ahi, y el porque esta en ese comentario: **buscar una palabra dentro de un articulo guardado**. Sin trigram, buscar un texto es un `ILIKE '%palabra%'` que recorre la tabla.

```sql
-- Lo que drizzle-kit no sabe expresar, escrito a mano como en 0012_notes_and_attachments.sql.
--
-- Buscar dentro de un articulo guardado. Un btree sobre una columna de frases no
-- contesta "un bookmark que hable de algo", asi que hacen falta los dos: GIN para
-- las etiquetas, que son un array, y trigram para el texto, que es prosa.
--
-- pg_trgm ya se activo en 0012 con CREATE EXTENSION IF NOT EXISTS, asi que aqui
-- no se repite.

CREATE INDEX bookmarks_tags_gin_idx ON bookmarks USING gin (tags jsonb_path_ops);
--> statement-breakpoint
CREATE INDEX bookmarks_plain_text_trgm_idx ON bookmarks USING gin (plain_text gin_trgm_ops);
```

En PGlite la extension ya esta cargada (`src/db/client.ts:57`, `new PGlite({ dataDir, extensions: { pg_trgm } })`), asi que los tests pueden aplicar la migracion.

- [ ] **Step 7: Comprobar que la migracion aplica con los indices**

Run: `npm run api:test -- notes-sync`
Expected: PASS. Si `gin_trgm_ops` fallara, `startTestServer()` caeria y toda la suite se caeria.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/db/content-schema.ts apps/api/drizzle/0022_bookmarks.sql \
  apps/api/drizzle/meta/ apps/api/test/bookmarks-table.test.ts
git commit -m "feat(db): la tabla bookmarks, con trigram para buscar dentro del articulo"
```

---

### Task 3: Los contratos

**Files:**
- Create: `packages/contracts/src/bookmarks.ts`
- Modify: `packages/contracts/src/sync.ts:4-6`
- Modify: `packages/contracts/src/index.ts`
- Test: `apps/api/test/bookmarks-contracts.test.ts`

**Interfaces:**
- Consumes: `syncableEntitySchema` de `api.ts`, `uuidSchema` de `common.ts`, `nodeAccessSchema` y `TAG_MAX` de `workspace.ts`.
- Produces: `collectionSchema`, `bookmarkSchema`, `bookmarkExtractionStateSchema`, `type Collection`, `type Bookmark`, `type BookmarkExtractionState`, y los `*_MAX`. Tasks 4-7 los importan; el motor de sync los usa para validar el `create`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/bookmarks-contracts.test.ts`:

```ts
import {
  bookmarkExtractionStateSchema,
  bookmarkSchema,
  collectionSchema,
} from '@orbit-hub/contracts';
import { describe, expect, it } from 'vitest';

describe('los contratos de bookmarks', () => {
  it('un bookmark acepta una URL y arranca pending', () => {
    const parsed = bookmarkSchema.parse({
      id: crypto.randomUUID(),
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
      workspaceId: crypto.randomUUID(),
      folderId: null,
      collectionId: null,
      url: 'https://example.com/articulo',
      position: 0,
    });
    expect(parsed.extractionState).toBe('pending');
    expect(parsed.title).toBe('');
    expect(parsed.document).toBe('');
    expect(parsed.tags).toEqual([]);
  });

  it('sin coleccion es una forma valida, no un error', () => {
    const parsed = bookmarkSchema.parse({
      id: crypto.randomUUID(),
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
      workspaceId: crypto.randomUUID(),
      folderId: null,
      collectionId: null,
      url: 'https://example.com',
      position: 0,
    });
    expect(parsed.collectionId).toBeNull();
  });

  it('los cuatro estados de extraccion son los de la spec', () => {
    for (const state of ['pending', 'ready', 'metadata_only', 'failed']) {
      expect(bookmarkExtractionStateSchema.parse(state)).toBe(state);
    }
  });

  it('una coleccion exige nombre y acepta carpeta vacia', () => {
    const parsed = collectionSchema.parse({
      id: crypto.randomUUID(),
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
      workspaceId: crypto.randomUUID(),
      folderId: null,
      name: 'Rust',
      position: 0,
    });
    expect(parsed.bookmarkCount).toBe(0);
  });

  it('una URL de 5000 caracteres o un data: URI no pasan', () => {
    const base = {
      id: crypto.randomUUID(),
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
      workspaceId: crypto.randomUUID(),
      folderId: null,
      collectionId: null,
      position: 0,
    };
    expect(() => bookmarkSchema.parse({ ...base, url: `https://e.com/${'a'.repeat(5000)}` })).toThrow();
    expect(() => bookmarkSchema.parse({ ...base, url: 'data:text/plain,hola' })).toThrow();
  });
});
```

Los dos ultimos `it` son Review Focus #5, y estan aqui a proposito y no en la Task 5: `data:` **pasa** `z.url()`, asi que el filtro de esquema no puede vivir solo en el contrato. Queda una comprobacion mas en la Task 5, en el servicio, y las dos mitades hacen falta.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:contracts` si existe, si no `npm run api:test -- bookmarks-contracts`. Antes de nada hay que compilar el paquete: `npm run build:packages`.
Expected: FAIL, los exports no existen todavia.

- [ ] **Step 3: Crear `packages/contracts/src/bookmarks.ts`**

Con el estilo del paquete: `z.object`/`syncableEntitySchema.extend`, `export type X = z.infer<typeof xSchema>` inmediatamente despues, y los `*_MAX` como `const` exportados al principio (`workspace.ts:179-188` es el molde). Los anchos salen de las columnas de la Task 1 y 2: `120`, `500`, `16`, `300`, `120`, `200`.

```ts
export const COLLECTION_NAME_MAX = 120;
export const COLLECTION_DESCRIPTION_MAX = 500;
export const COLLECTION_EMOJI_MAX = 16;

export const BOOKMARK_TITLE_MAX = 300;
export const BOOKMARK_SITE_NAME_MAX = 120;
export const BOOKMARK_EXTRACTION_ERROR_MAX = 200;
export const BOOKMARK_URL_MAX = 2048;
export const BOOKMARK_TAGS_MAX = 20;

/**
 * Los cuatro estados. `metadata_only` no es un fallo: es la respuesta correcta a
 * un sitio que no es un articulo, como un video de YouTube, y se muestra sin
 * disculpa. Mezclarlo con `failed` hace que compartir un video parezca un error.
 */
export const bookmarkExtractionStateSchema = z.enum(['pending', 'ready', 'metadata_only', 'failed']);
export type BookmarkExtractionState = z.infer<typeof bookmarkExtractionStateSchema>;

/** Solo `http` y `https`. Un `data:` URI pasa `z.url()` y no es una pagina. */
const bookmarkUrlSchema = z
  .string()
  .trim()
  .max(BOOKMARK_URL_MAX)
  .refine((value) => value.startsWith('http://') || value.startsWith('https://'), {
    message: 'A bookmark URL has to be http or https',
  });

export const collectionSchema = syncableEntitySchema
  .extend({
    workspaceId: uuidSchema,
    folderId: uuidSchema.nullable().default(null),
    name: z.string().trim().min(1).max(COLLECTION_NAME_MAX),
    description: z.string().max(COLLECTION_DESCRIPTION_MAX).nullable().default(null),
    emoji: z.string().max(COLLECTION_EMOJI_MAX).nullable().default(null),
    position: z.number().int().min(0),
    bookmarkCount: z.int().min(0).default(0),
  })
  .extend(nodeAccessSchema.shape);
export type Collection = z.infer<typeof collectionSchema>;

export const bookmarkSchema = syncableEntitySchema
  .extend({
    workspaceId: uuidSchema,
    folderId: uuidSchema.nullable().default(null),
    collectionId: uuidSchema.nullable().default(null),
    url: bookmarkUrlSchema,
    title: z.string().max(BOOKMARK_TITLE_MAX).default(''),
    siteName: z.string().max(BOOKMARK_SITE_NAME_MAX).nullable().default(null),
    description: z.string().nullable().default(null),
    imageUrl: z.string().nullable().default(null),
    document: z.string().default(''),
    plainText: z.string().default(''),
    extractionState: bookmarkExtractionStateSchema.default('pending'),
    extractionError: z.string().max(BOOKMARK_EXTRACTION_ERROR_MAX).nullable().default(null),
    tags: z.array(z.string().trim().min(1).max(TAG_MAX)).max(BOOKMARK_TAGS_MAX).default([]),
    position: z.number().int().min(0),
  })
  .extend(nodeAccessSchema.shape);
export type Bookmark = z.infer<typeof bookmarkSchema>;
```

Los imports son de `./api.js` (`syncableEntitySchema`), `./common.js` (`uuidSchema`) y `./workspace.js` (`nodeAccessSchema`, `TAG_MAX`). `TAG_MAX` **ya existe** en `workspace.ts:186`: importarlo, no redefinirlo. Con `extending` los `.extend(nodeAccessSchema.shape)` se siguen a `listSchema` (`workspace.ts:379-421`), que es donde `role` y `shared` entran al objeto.

`imageUrl` y `description` son `string().nullable()` sin refinamiento de esquema: se escriben en la fase 2 desde el OG de un sitio, y un filtro aqui solo seria unaopinion sobre URLs que hoy no existen. La validacion de que sean http/https llega con la extraccion.

- [ ] **Step 4: Anadir las dos entidades a `syncEntitySchema`**

`packages/contracts/src/sync.ts:4-6`. Este enum tiene **ocho** valores y el `SYNC_ENTITIES` del servidor tiene **seis**: son dos listas distintas y el mismo error documentado en el repo las ha desincronizado antes. Las dos hay que tocarlas, o el cliente manda una entidad que el servidor rechaza con *"The entity x is not synced yet"*.

```ts
export const syncEntitySchema = z.enum([
  'workspace','membership','folder','list','list_item','note','attachment','dashboard',
  'collection','bookmark',
]);
```

- [ ] **Step 5: Anadir el archivo al barril**

`packages/contracts/src/index.ts`, en orden alfabetico, entre `'auth'` y `'catalog'`:

```ts
export * from './bookmarks';
```

- [ ] **Step 6: Compilar y correr**

Run: `npm run build:packages && npm run api:test -- bookmarks-contracts`
Expected: PASS, los cinco tests. Si `data:` pasara, el quinto falla y hay que revisar el `refine`.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/bookmarks.ts packages/contracts/src/sync.ts \
  packages/contracts/src/index.ts apps/api/test/bookmarks-contracts.test.ts
git commit -m "feat(contracts): los esquemas de collections y bookmarks, y su entidad de sync"
```

---

### Task 4: Registro en el motor de sync

**Files:**
- Modify: `apps/api/src/db/constants.ts:38-46` y `:109-150`
- Modify: `apps/api/src/modules/sync/sync-service.ts:113-120`, `:171-199`, `:562-731`, `:765-772`, `:783-850`
- Modify: `apps/api/src/modules/sync/sync-repository.ts:41-48`, `:110-137`
- Modify: `apps/api/src/modules/sync/mounts.ts:219-253`
- Modify: `apps/api/test/sync-limits.test.ts:157-163`
- Test: `apps/api/test/bookmarks-registration.test.ts`

**Interfaces:**
- Consumes: `collections`, `bookmarks` (Tasks 1-2), `bookmarkSchema`, `collectionSchema` (Task 3), `HttpError` y `noteFieldsForWrite` del mismo archivo.
- Produces: `sanitisePayload` que acepta `collectionId` y `url`, y el push que crea y actualiza las dos entidades. La Task 5 depende de este comportamiento para probarlo.

> **El comentario de `constants.ts:110-115` dice "cuatro" lugares. No son cuatro.** La lista real, que es la parte mas cara de esta fase, son **doce**, y estan en este task y en la Task 7. Omitir el segundo no falla ruidoso: falla mudo.

- [ ] **Step 1: Write the failing test**

`apps/api/test/bookmarks-registration.test.ts`. Este test no necesita servidor: lee las constantes y el codigo del sanitizador, que es exactamente donde el fallo es mudo.

```ts
import { describe, expect, it } from 'vitest';

import { SYNC_ENTITIES, SYNC_WRITABLE_FIELDS } from '../src/db/constants.js';
import { sanitisePayload } from '../src/modules/sync/sync-service.js';

describe('las entidades nuevas estan registradas donde tienen que estar', () => {
  it('las dos estan en SYNC_ENTITIES y en los campos escribibles', () => {
    expect(SYNC_ENTITIES).toContain('collection');
    expect(SYNC_ENTITIES).toContain('bookmark');
    expect(SYNC_WRITABLE_FIELDS.collection).toBeDefined();
    expect(SYNC_WRITABLE_FIELDS.bookmark).toBeDefined();
  });

  it('el servidor se queda con el documento: no es un campo escribible', () => {
    expect(SYNC_WRITABLE_FIELDS.bookmark).not.toContain('document');
    expect(SYNC_WRITABLE_FIELDS.bookmark).not.toContain('plainText');
    expect(SYNC_WRITABLE_FIELDS.bookmark).not.toContain('extractionState');
    expect(SYNC_WRITABLE_FIELDS.bookmark).not.toContain('imageUrl');
  });

  it('el cliente escribe la URL, el titulo, el destino, las etiquetas y la posicion', () => {
    expect([...SYNC_WRITABLE_FIELDS.bookmark].sort()).toEqual([
      'collectionId', 'folderId', 'position', 'tags', 'title', 'url',
    ]);
  });

  it('un bookmark nuevo no puede mover su workspace', () => {
    expect(SYNC_WRITABLE_FIELDS.bookmark).not.toContain('workspaceId');
  });

  it('sanitisePayload pasa la URL limpia y deja la coleccion como texto o null', () => {
    const out = sanitisePayload('bookmark', {
      url: '  https://example.com/a  ',
      collectionId: 'abc',
      folderId: null,
    });
    expect(out.url).toBe('https://example.com/a');
    expect(out.collectionId).toBe('abc');
    expect(out.folderId).toBeNull();
  });
});
```

Los dos primeros son la frontera de escritura de la spec, escrita como test. El quinto falla hasta que `sanitisePayload` sepa de `url` y `collectionId`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run api:test -- bookmarks-registration`
Expected: FAIL en los cinco: `SYNC_WRITABLE_FIELDS.collection` es `undefined`.

- [ ] **Step 3: `SYNC_ENTITIES` y `SYNC_WRITABLE_FIELDS`**

`apps/api/src/db/constants.ts:38-46`:

```ts
export const SYNC_ENTITIES = [
  'workspace', 'folder', 'list', 'list_item', 'note', 'dashboard',
  'collection', 'bookmark',
] as const;
```

`apps/api/src/db/constants.ts:109-150`. Las dos entradas, y el orden de las dos listas tiene que coincidir con lo que el Step 1 del Task 4 verifica:

```ts
  collection: ['folderId', 'name', 'description', 'emoji', 'position'],
  bookmark: ['url', 'title', 'collectionId', 'folderId', 'tags', 'position'],
```

Lo que **no** aparece en `bookmark` es el corazon de la decision: `document`, `plainText`, `extractionState`, `extractionError`, `description`, `imageUrl` y `siteName` son del servidor. `workspaceId` tampoco, y por el mismo motivo que en `note`: el servidor es dueno de ese campo, porque un cliente que pudiera mover un bookmark entre espacios lo archivaria donde el dueno nunca lo puso.

- [ ] **Step 4: `STRING_LIMITS`**

`apps/api/src/modules/sync/sync-service.ts:113-120`. Sin esta entrada, `sanitisePayload` aplica su default de **500** caracteres a cualquier string, y un `title` de 350 contra un `varchar(300)` revienta en Postgres con un error de longitud en vez de una validacion limpia. Review Focus #2, y `sync-limits.test.ts` lo detecta solo si se anaden los pares del Step 6.

```ts
  collection: { name: 120, description: 500, emoji: 16 },
  bookmark: { title: 300 },
```

`url` **no** lleva entrada a proposito: la columna es `text` sin tope y `STRING_LIMITS` solo existe para acotar a un `varchar`. El techo de 2048 lo pone el contrato (Task 3), que corre antes.

- [ ] **Step 5: `sanitisePayload` reconoce `collectionId` y `url`**

`apps/api/src/modules/sync/sync-service.ts:171-199`. La cadena de `if` tiene ramas para `name`/`description`/`emoji`, para `position`, y para `parentId`. `folderId` y `collectionId` van juntos, porque los dos son una FK opcional: `null` o texto, y nada mas:

```ts
    if (key === 'folderId' || key === 'collectionId') {
      clean[key] = value === null ? null : String(value);
      continue;
    }
    if (key === 'url') { clean[key] = String(value).trim(); continue; }
```

Sin esto, `collectionId` se va por la rama generica sin castear, y un UUID que llega como objeto o como numero se escribe en la columna como `[object Object]`.

- [ ] **Step 6: `sync-repository.ts`: la tabla y el tipo**

`apps/api/src/modules/sync/sync-repository.ts:110-137`. La union `SyncEntityTable` y el `switch` de `table()` van juntos; sin los dos, `findEntity`, `insertEntity` y `updateEntity` tiran `Unsupported sync entity`. Anadir `collections` y `bookmarks` a la union y sus dos `case` al `switch`.

`apps/api/src/modules/sync/sync-repository.ts:41-48`, `toEntityName()`: anadir `if (nodeType === 'collection') return 'collection';` y lo mismo con `'bookmark'`. Esta tabla traduce el tipo de nodo de un enlace compartido, y son las dos unicas ramas que quedan.

- [ ] **Step 7: `sync-service.ts` — la creacion**

`sync-service.ts:562-731`. Hoy el `switch (entity)` de la creacion tiene un `default: throw HttpError.validation(...)`, asi que sin este paso un bookmark nuevo da *"The entity bookmark cannot be created"*.

`case 'collection'` y `case 'bookmark'`, con la forma de `case 'note'` (~:692-726):

1. Exigir `workspaceId` no vacio con `HttpError.validation`.
2. `assertCanWrite(workspaceId, userId, { nodeType: 'collection' | 'bookmark', nodeId: operation.entityId })`.
3. **Resolver el destino**, antes de validar nada, y en este orden:
   - Si `collectionId` no es null, cargar la coleccion. Si no existe, `HttpError.notFound`. Si su `workspaceId` **no es** el del payload, `HttpError.validation` diciendo que la coleccion no pertenece a ese espacio.
   - Si `collectionId` no es null y `folderId` **es** null, **`folderId` se deriva de la coleccion**. Esto es la regla de la spec hecha verdadera en el servidor y no solo en el cliente: un cliente que mande `folderId: null` con una coleccion que si tiene carpeta igual termina en la carpeta correcta, en vez de quedar flotando.
   - Si `folderId` no es null, cargar la carpeta; si no existe, `HttpError.notFound`; si su `workspaceId` no es el del payload, `HttpError.validation` (**Review Focus #3**).
4. Validar con `collectionSchema.safeParse` / `bookmarkSchema.safeParse` sobre el objeto ya resuelto, y sobre lo que se va a **insertar**: `document`, `plainText`, `extractionState`, `siteName`, `description` e `imageUrl` van a sus defaults (`''`, `''`, `'pending'`, `null`, `null`, `null`) sin mirar lo que haya llegado en el payload. Esos seis son del servidor y `sanitisePayload` ya los tira; forzarlos aqui deja el invariante explicito en el unico lugar que inserta.
5. `insertEntity` con `id: operation.entityId`.

El punto 3 es el que hace que la regla de la spec no dependa de que todos los clientes la hagan bien. Un cliente que manda los tres campos y se equivoca en uno recibe un `rejected` limpio; uno que manda `folderId: null` recibe la carpeta de su coleccion.

- [ ] **Step 8: `sync-service.ts` — actualizar y borrar**

`sync-service.ts:783-850`, la escalera de `workspaceId` del update: anadir las dos ramas. `bookmark` resuelve por su propia columna `workspace_id`, y `collection` tambien. Ninguna de las dos necesita el cruce de `list_item` contra su lista, porque ambas lo tienen denormalizado. El update **tampoco** deriva `folderId` de la coleccion: en un update el destino es una decision consciente de la persona y por eso va en el payload.

`sync-service.ts:765-772`, la escalera del delete: mismo criterio. El borrado es logico via `sync-repository.updateEntity(..., { tombstone: true })` (`sync-repository.ts:198-222`), asi que las dos filas quedan con `deletedAt` y `version` sumada, y ninguna se borra de verdad.

- [ ] **Step 9: `mounts.ts`: el `espacioDe` sin `else` final**

`apps/api/src/modules/sync/mounts.ts:219-253`. Este es el que muerde sin avisar: la rama de `note` es un **fall-through** sin `else`, asi que un `nodeType` desconocido se consulta contra `notes`, no encuentra nada, y devuelve `null` como si el nodo no existiera. Hay que insertar las dos ramas **antes** de la de notas:

```ts
  if (nodeType === 'collection') {
    const fila = await db.select({ workspaceId: collections.workspaceId }).from(collections)
      .where(eq(collections.id, nodeId)).limit(1);
    return fila[0]?.workspaceId ?? null;
  }
  if (nodeType === 'bookmark') {
    const fila = await db.select({ workspaceId: bookmarks.workspaceId }).from(bookmarks)
      .where(eq(bookmarks.id, nodeId)).limit(1);
    return fila[0]?.workspaceId ?? null;
  }
```

Ademas, la proyeccion que reescribe `workspaceId` por entidad (alrededor de `mounts.ts:120-167`) recorre las tablas montadas para que un nodo compartido aparezca bajo el workspace de quien lo recibio. Las dos tablas nuevas **no** entran ahi: un bookmark o una coleccion compartidos no son parte de esta fase, y entrar sin el modelo de montaje seria justo la clase de bug que ese archivo existe para evitar. Dejarlo asi, y dejar un comentario que diga por que.

- [ ] **Step 10: Anadir los pares al test de limites**

`apps/api/test/sync-limits.test.ts:157-163`. El array `columns` es lo que hace que el test corra sobre las columnas nuevas:

```ts
      [collections, 'collection'],
      [bookmarks, 'bookmark'],
```

Con eso el `for` de :165-186 prueba `collection.name`, `collection.description`, `collection.emoji`, `bookmark.title` y `bookmark.extractionError` contra el ancho **real** de la columna, leido con `getTableColumns`. Ese test es el que falla si el Step 4 se olvida.

- [ ] **Step 11: Run test to verify it passes**

Run: `npm run api:test -- bookmarks-registration sync-limits`
Expected: PASS en los dos archivos.

- [ ] **Step 12: El typecheck, que es el que encuentra los `case` que faltan**

Run: `npm run typecheck`
Expected: PASS. `SYNC_ENTITIES` y `SYNC_WRITABLE_FIELDS` estan tipados como `Record<SyncEntityName, ...>`, asi que anadir dos entidades **rompe el typecheck** en cada `switch` exhaustivo que las switch sobre `SyncEntityName`. Es el和网络 de seguridad de los doce lugares: cualquier sitio olvidado sale con un error de compilacion en vez de en silencio.

- [ ] **Step 13: Commit**

```bash
git add apps/api/src/db/constants.ts apps/api/src/modules/sync/ apps/api/test/
git commit -m "feat(sync): collections y bookmarks en los doce lugares del motor"
```

---

### Task 5: Los tests de sync de punta a punta

**Files:**
- Create: `apps/api/test/collections-sync.test.ts`
- Create: `apps/api/test/bookmarks-sync.test.ts`
- Test: los dos archivos de arriba

**Interfaces:**
- Consumes: el push/pull de `notes-sync.test.ts:1-54` (`operation`, `push`, `createWorkspace`), `createVerifiedUser` y `startTestServer` de `test/helpers.ts`, y todo lo que registro la Task 4.
- Produces: cobertura de los cinco Review Focus. Ninguna tarea posterior depende de esto mas alla de que los tests sigan verdes.

- [ ] **Step 1: El arnes, copiado de `notes-sync.test.ts:1-54`**

Los dos archivos empiezan con el mismo bloque, porque el arnes es el arnes:

```ts
import type { SyncOperation } from '@orbit-hub/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

let api: TestServer;
beforeAll(async () => { api = await startTestServer(); });
afterAll(async () => { await api.close(); });

function operation(over: Partial<SyncOperation> & Pick<SyncOperation, 'entity' | 'kind' | 'entityId'>) {
  return {
    operationId: randomUUID(),
    clientId: 'bookmarks-sync-test',
    baseVersion: 0,
    payload: null,
    base: null,
    clientTimestamp: new Date().toISOString(),
    ...over,
  };
}

async function push(user: TestUser, operations: SyncOperation[]) {
  return api.post('/sync/push',
    { deviceId: randomUUID(), lastPulledAt: null, operations },
    user.accessToken);
}

async function createWorkspace(user: TestUser, name: string): Promise<{ id: string; version: number }> {
  const id = randomUUID();
  const response = await push(user, [
    operation({ entity: 'workspace', kind: 'create', entityId: id, payload: { name } }),
  ]);
  expect(response.body.data.results[0].status).toBe('applied');
  return { id, version: response.body.data.results[0].version as number };
}
```

Un helper local a `bookmarks-sync.test.ts`, `createCollection(user, workspaceId, over = {})`, que hace el push de `kind: 'create'` con `payload: { workspaceId, folderId: null, name: 'Rust', description: null, emoji: null, position: 0, ...over }` y devuelve `{ id, version }` leyendo `results[0]`, igual que `createWorkspace`. El helper existe para que los cinco Review Focus se escriban en una linea cada uno.

- [ ] **Step 2: Write the failing test — la creacion y el recorrido**

En `collections-sync.test.ts`:

```ts
it('crea una coleccion y la devuelve en el pull', async () => {
  const user = await createVerifiedUser(api);
  const workspace = await createWorkspace(user, 'Personal');
  const collection = await createCollection(user, workspace.id, { name: 'Rust' });

  const pull = await api.post('/sync/pull',
    { deviceId: randomUUID(), lastPulledAt: null }, user.accessToken);

  const row = pull.body.data.rows.find((r: any) => r.entity === 'collection' && r.entityId === collection.id);
  expect(row).toBeDefined();
  expect(row.payload.name).toBe('Rust');
});
```

En `bookmarks-sync.test.ts`:

```ts
it('crea un bookmark con la URL y el destino, y lo devuelve en el pull', async () => {
  const user = await createVerifiedUser(api);
  const workspace = await createWorkspace(user, 'Personal');
  const bookmark = await createBookmark(user, workspace.id, { url: 'https://example.com/a' });

  const pull = await api.post('/sync/pull',
    { deviceId: randomUUID(), lastPulledAt: null }, user.accessToken);

  const row = pull.body.data.rows.find((r: any) => r.entity === 'bookmark' && r.entityId === bookmark.id);
  expect(row.payload.url).toBe('https://example.com/a');
  expect(row.payload.extractionState).toBe('pending');
});
```

Si el `pull` devuelve las filas con otra forma, copiar la de `notes-sync.test.ts` en vez de adivinar el envelope.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run api:test -- collections-sync bookmarks-sync`
Expected: FAIL, porque las filas no aparecen todavia.

- [ ] **Step 4: Ver los cinco Review Focus, uno por test**

Los cinco van con `it` explicitos, y cada uno nombra el numero de la seccion Review Focus de este plan:

```ts
// Review Focus 1: el documento es del servidor, y si no el push lo dice en mudo.
it('un payload con document y extractionState los descarta, y el pull los trae vacios', async () => {
  const created = await createBookmark(user, workspace.id, {
    url: 'https://example.com/a',
    document: '<p>me inyectaron esto</p>',
    extractionState: 'ready',
  } as never);
  const pull = await api.post('/sync/pull', { deviceId: randomUUID(), lastPulledAt: null }, user.accessToken);
  const row = pull.body.data.rows.find((r: any) => r.entityId === created.id);
  expect(row.payload.document).toBe('');
  expect(row.payload.extractionState).toBe('pending');
});

// Review Focus 2: sin STRING_LIMITS el titulo llega troceado a 500 y Postgres truena.
it('un titulo de 400 caracteres se corta a 300, no revienta', async () => {
  const created = await createBookmark(user, workspace.id, {
    url: 'https://example.com/a', title: 'a'.repeat(400),
  });
  const pull = await api.post('/sync/pull', { deviceId: randomUUID(), lastPulledAt: null }, user.accessToken);
  const row = pull.body.data.rows.find((r: any) => r.entityId === created.id);
  expect(row.payload.title).toHaveLength(300);
});

// Review Focus 3: una carpeta de otro workspace no se puede usar de destino.
it('rechaza una carpeta que es de otro workspace', async () => {
  const otro = await createWorkspace(user, 'Otro');
  const ajena = await createFolder(user, otro.id, 'Privada');
  const response = await createBookmarkRaw(user, workspace.id, {
    url: 'https://example.com/a', folderId: ajena.id,
  });
  expect(response.body.data.results[0].status).toBe('rejected');
});

// Review Focus 4: borrar una coleccion deja a sus bookmarks sin clasificar.
it('borrar una coleccion no borra sus bookmarks: quedan sin collectionId', async () => {
  const collection = await createCollection(user, workspace.id, { name: 'Se va' });
  const bookmark = await createBookmark(user, workspace.id, {
    url: 'https://example.com/a', collectionId: collection.id,
  });
  await push(user, [operation({
    entity: 'collection', kind: 'delete', entityId: collection.id,
    baseVersion: collection.version,
  })]);

  const pull = await api.post('/sync/pull', { deviceId: randomUUID(), lastPulledAt: null }, user.accessToken);
  const row = pull.body.data.rows.find((r: any) => r.entityId === bookmark.id);
  expect(row.deletedAt).toBeNull();
  expect(row.payload.collectionId).toBeNull();
});

// Review Focus 5: un data: URI pasa z.url(), asi que el filtro va tambien aca.
it('rechaza una URL que no sea http ni https', async () => {
  const response = await createBookmarkRaw(user, workspace.id, { url: 'data:text/plain,hola' });
  expect(response.body.data.results[0].status).toBe('rejected');
});
```

`createBookmarkRaw` es `createBookmark` sin la asercion de `applied`: existe para poder leer el resultado de un push **rechazado**. `createFolder` replica el helper de workspace pero con `entity: 'folder'` y `payload: { workspaceId, parentId: null, name }`.

El Review Focus #4 es el que justifica el `onDelete: 'set null'` de la Task 2: si el `delete` de sync es logico y no borra la fila de `collections`, la FK no llega a disparar, asi que este test pasa **tambien** con `cascade`. El test que de verdad distingue los dos es el de borrar la fila de verdad, que lo hace la API de carpetas borradas en cascada en la Task 6.

- [ ] **Step 5: Anadir el test que si distingue la FK**

En `bookmarks-sync.test.ts`, borrando la **fila** de la coleccion por la via que si la borra (una carpeta borrada en cascada, o el endpoint de la Task 6):

```ts
it('borrar la fila de la coleccion deja los bookmarks vivos y sin collectionId', async () => {
  const collection = await createCollection(user, workspace.id, { name: 'Se va' });
  const bookmark = await createBookmark(user, workspace.id, {
    url: 'https://example.com/a', collectionId: collection.id,
  });
  await api.delete(`/api/v1/collections/${collection.id}`, user.accessToken);

  const pull = await api.post('/sync/pull', { deviceId: randomUUID(), lastPulledAt: null }, user.accessToken);
  const row = pull.body.data.rows.find((r: any) => r.entityId === bookmark.id);
  expect(row).toBeDefined();
  expect(row.deletedAt).toBeNull();
  expect(row.payload.collectionId).toBeNull();
});
```

Con `onDelete: 'cascade'` este test falla con el bookmark desaparecido, y con `set null` pasa. **Ese es el que vale.**

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run api:test -- collections-sync bookmarks-sync`
Expected: PASS en todos. Si el Review Focus #3 falla con `applied` en vez de `rejected`, la validacion de destino del Step 7 de la Task 4 no esta.

- [ ] **Step 7: Commit**

```bash
git add apps/api/test/collections-sync.test.ts apps/api/test/bookmarks-sync.test.ts
git commit -m "test(sync): el sync de bookmarks y collections, con los cinco casos que muerden"
```

---

### Task 6: Lecturas REST

**Files:**
- Create: `apps/api/src/modules/collections/collection-service.ts`
- Create: `apps/api/src/modules/bookmarks/bookmark-service.ts`
- Create: `apps/api/src/routes/collections.ts`
- Create: `apps/api/src/routes/bookmarks.ts`
- Modify: `apps/api/src/routes/index.ts:53-54`
- Test: `apps/api/test/bookmarks-api.test.ts`

**Interfaces:**
- Consumes: `collectionSchema`, `bookmarkSchema` (Task 3), `nodeAccessSchema` (de donde sale `role` y `shared` que los dos schemas exigen), `requireAuth` de `middleware/require-auth.js`, `sendData` de `routes/respond.js`, el patron de `routes/notes.ts`.
- Produces: `GET /api/v1/collections`, `GET /api/v1/collections/:id`, `GET /api/v1/bookmarks`, `GET /api/v1/bookmarks/:id`, y el borrado logico de `DELETE /api/v1/collections/:id` que usa el Review Focus #4 de la Task 5.

**Lo que NO tiene esta tarea: escrituras por REST.** Las escrituras son del sync, que es la arquitectura entera de este dominio. Un `POST /bookmarks` seria un segundo camino para la misma fila y nadie lo necesita hasta que exista el share sheet, y ese usa sync.

- [ ] **Step 1: Write the failing test**

`apps/api/test/bookmarks-api.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

let api: TestServer;
beforeAll(async () => { api = await startTestServer(); });
afterAll(async () => { await api.close(); });

describe('las lecturas de bookmarks', () => {
  it('lista los de un workspace y filtra por coleccion', async () => {
    const user = await createVerifiedUser(api);
    // crear workspace, collection y dos bookmarks por /sync/push, como en la Task 5
    const all = await api.get('/bookmarks?workspaceId=' + workspace.id, user.accessToken);
    expect(all.status).toBe(200);
    const filtered = await api.get(
      `/bookmarks?workspaceId=${workspace.id}&collectionId=${collection.id}`, user.accessToken);
    expect(filtered.body.data.items).toHaveLength(1);
  });

  it('el que no es miembro del workspace no ve nada', async () => {
    const user = await createVerifiedUser(api);
    const otro = await createVerifiedUser(api);
    const response = await api.get(`/bookmarks?workspaceId=${workspace.id}`, otro.accessToken);
    expect(response.status).toBe(404);
  });
});
```

El segundo es la regla 8 de `AGENTS.md` aplicada a una lectura: un workspace ajeno responde 404 y no 403, para no confirmar que existe.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run api:test -- bookmarks-api`
Expected: FAIL con 404 en la ruta, porque los routers no existen.

- [ ] **Step 3: `collection-service.ts`**

Con la forma de `note-service.ts`. El tipo de la fila que sale de la consulta es `CollectionRow` (Task 1) y `select()` devuelve un tipo compatible con el: no redeclarar la forma de la fila aqui, porque un cambio de columna se veria en dos archivos.

Dos funciones exportadas:

```ts
export async function listCollections(
  userId: string,
  filters: { workspaceId: string; folderId?: string | null; includeEmpty?: boolean },
): Promise<Collection[]>
export async function getCollection(userId: string, id: string): Promise<Collection>
export async function deleteCollection(userId: string, id: string): Promise<void>
```

- `listCollections` resuelve el rol con el mismo camino que `noteService.list`, tira `HttpError.notFound` si la persona no es miembro, y devuelve cada fila parseada con `collectionSchema.parse({ ...row, bookmarkCount, role, shared })`. El conteo de `bookmarkCount` es un `COUNT(*)` sobre `bookmarks` agrupado por `collectionId`, con `deleted_at IS NULL`; es el mismo truco que `listItems.attachmentCount`, y el motivo es el mismo: sin el, una lista de colecciones se vuelve una consulta por fila.
- `getCollection` tira `HttpError.notFound` si no existe o si la persona no es miembro.
- `deleteCollection` es **logico**: `update({ deletedAt: new Date() })` y nada mas. **No borra la fila**, y por eso los bookmarks quedan vivos con `collectionId` en null por la FK. Si se borrara la fila, el `ON DELETE SET NULL` tambien los salvaria, pero entonces el pull no veria el cambio y el cliente no sabria que.collection desaparecio.

- [ ] **Step 4: `bookmark-service.ts`**

```ts
export async function listBookmarks(
  userId: string,
  filters: { workspaceId: string; folderId?: string | null; collectionId?: string | null },
): Promise<Bookmark[]>
export async function getBookmark(userId: string, id: string): Promise<Bookmark>
```

Mismo esqueleto, con `BookmarkRow` (Task 2) como tipo de fila.

`collectionId: undefined` **no** puede significar "sin clasificar", porque `z.object` no distingue ausente de `null` en el query string, y la vista "sin clasificar" es `collection_id IS NULL`. El filtro va como el literal `'unclassified'` en `listBookmarksQuerySchema`, con un comentario que diga que un `?collectionId=` a secas significaria lo contrario de lo que parece. La distincion esta anotada porque es la clase de detalle que alguien rompe sin querer y sin ver un fallo: devuelve la lista de bookmarks sin clasificar cuando queria todos, o al reves.

`listBookmarks` **no** devuelve `document` ni `plainText`: son hasta 512 KB y el listado no los usa. `getBookmark` si los devuelve. Es la misma decision que tomo `listItemsQuerySchema` con el limite de 200 items.

- [ ] **Step 5: Los dos routers**

`apps/api/src/routes/collections.ts` y `apps/api/src/routes/bookmarks.ts`, calcados de `routes/notes.ts:1-46`:

```ts
export const collectionsRouter = Router();
collectionsRouter.use(requireAuth);

const collectionParams = z.object({ id: uuidSchema });
const listCollectionsQuery = z.object({
  workspaceId: uuidSchema,
  folderId: uuidSchema.optional(),
  includeEmpty: z.coerce.boolean().default(true),
});

collectionsRouter.get('/', async (req, res) => {
  sendData(res, 200, await listCollections(caller(req), listCollectionsQuery.parse(req.query)));
});
collectionsRouter.get('/:id', async (req, res) => {
  const { id } = collectionParams.parse(req.params);
  sendData(res, 200, await getCollection(caller(req), id));
});
collectionsRouter.delete('/:id', async (req, res) => {
  const { id } = collectionParams.parse(req.params);
  await deleteCollection(caller(req), id);
  sendData(res, 204, null);
});
```

El helper `caller(req)` que tira si `req.auth` no esta, y `requireAuth` como primera linea, son **copia literal** de `routes/notes.ts:9-13`. El 404 de "no es miembro" lo tira el servicio, no el router.

- [ ] **Step 6: Montar los routers**

`apps/api/src/routes/index.ts`, junto a las lineas 53-54 que ya montan `notesRouter`:

```ts
  apiRouter.use("/collections", collectionsRouter);
  apiRouter.use("/bookmarks", bookmarksRouter);
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run api:test -- bookmarks-api`
Expected: PASS.

- [ ] **Step 8: La suite entera, y el typecheck**

Run: `npm run api:test && npm run typecheck`
Expected: PASS en los dos. La suite entera es la que verifica que las dos migraciones nuevas aplican en cada `startTestServer()` y que no rompieron las seis entidades que ya existian.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/collections apps/api/src/modules/bookmarks \
  apps/api/src/routes/ apps/api/test/bookmarks-api.test.ts
git commit -m "feat(api): lecturas REST de collections y bookmarks"
```

---

### Task 7: El lado del cliente

**Files:**
- Create: `apps/mobile/src/lib/collections/actions.ts`
- Create: `apps/mobile/src/lib/bookmarks/actions.ts`
- Modify: `apps/mobile/src/lib/content-order.ts:13` y `:190`
- Modify: `apps/mobile/src/lib/content-order-save.ts:7-11`
- Test: ninguno nuevo; `npm run typecheck` y `npm run check` son la prueba.

**Interfaces:**
- Consumes: `enqueueOperation` (`lib/offline/sync-service.ts:70`) y `localUpdate` (`:486`) con las firmas exactas, `newNote` como molde de la fila local, `SyncEntity` de `@orbit-hub/contracts` ya ampliado en la Task 3.
- Produces: `createCollectionAction`, `createBookmarkAction`, y el tipo `ContentRow['kind']` ampliado. La Task 3 de la fase siguiente (el share sheet) los llama.

> **Cuatro cosas que este task NO toca, y el porque importa mas que lo que toca.** `local-store.ts` **no** necesita DDL nuevo: `cached_entities` (`local-store.ts:104-160`) es una tabla generica con `(entity, entity_id)` y `upsertCached` (`local-store.ts:57`) no sabe que entidades existen. Los cuatro sitios literales de `'list_item'` (`:316-330`, `:342-350`, `:655-666`, `:677-687`) cuentan items por lista y no aplican. Y `shares/pending-node.ts:33` **no** se toca: su `SHAREABLE` es `['folder','list','list_item','note']` y compartir un bookmark con otra persona no esta en ninguna de las cinco fases del spec.

- [ ] **Step 1: Verificar que el typecheck falla antes de tocar nada**

Run: `npm run typecheck`
Expected: FAIL en `content-order.ts` y `content-order-save.ts`. Si pasa, estas leyendo mal el repo: la widened `SyncEntity` no se propaga sola a los unions de `kind`.

Si no falla, la razon es que `kind` esta tipado como un string suelto en algun punto. Comprobar con `grep -n 'kind:' apps/mobile/src/lib/content-order.ts` antes de seguir.

- [ ] **Step 2: `content-order.ts` y `content-order-save.ts`**

`content-order.ts:13` y `:190` pasan de `"folder" | "list" | "note"` a `"folder" | "list" | "note" | "collection" | "bookmark"`. `content-order-save.ts:7-11` sigue:

```ts
const ENTITY_DE: Record<ContentRow["kind"], SyncEntity> = {
  folder: "folder",
  list: "list",
  note: "note",
  collection: "collection",
  bookmark: "bookmark",
};
```

El `Record` con valor total es el que obliga a que las dos entradas existan: anadir `kind` sin tocar este mapa es error de compilacion, no un `undefined` en el outbox.

Las colecciones van en el browser de carpeta porque su `position` tiene que poder compararse con el de las notas, las listas y las carpetas, que es el motivo por el que esa columna existe en las tres.

- [ ] **Step 3: Run typecheck to verify it passes**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: `lib/collections/actions.ts`**

Molde exacto de `lib/notes/actions.ts:20-52`, con el mismo comentario sobre por que `workspaceId` viaja en el payload y no en `base`:

```ts
export interface NewCollectionInput {
  workspaceId: string;
  folderId?: string | null;
  name: string;
  description?: string | null;
  emoji?: string | null;
}

export async function createCollectionAction(input: NewCollectionInput): Promise<string> {
  const id = Crypto.randomUUID();
  const collection = newCollection({ id, ...input });

  await localUpdate("collection", id, { ...collection });
  await enqueueOperation({
    kind: "create",
    entity: "collection",
    entityId: id,
    baseVersion: 0,
    // El espacio viaja en el payload porque una coleccion no se puede colocar
    // sin uno. No esta en `base`: ese campo es del servidor, y un cliente que
    // pudiera mover una coleccion entre espacios la archivaria donde el dueno
    // nunca la puso.
    payload: {
      workspaceId: collection.workspaceId,
      folderId: collection.folderId,
      name: collection.name,
      description: collection.description,
      emoji: collection.emoji,
    },
  });
  return id;
}
```

Mas `updateCollectionAction(input: { id: string; baseVersion: number } & Partial<NewCollectionInput>)`, que hace `localUpdate("collection", id, cambios)` y encola `kind: 'update'`.

`newCollection` es el constructor de la fila local: `id` generado, `workspaceId`, `folderId: input.folderId ?? null`, `name`, `description: input.description ?? null`, `emoji: input.emoji ?? null`, `version: 1`, y `extractionState` **no aparece** porque un bookmark todavia no lo tiene (Task 5).

- [ ] **Step 5: `lib/bookmarks/actions.ts`**

Misma forma. La diferencia esta en el payload, y es la frontera de escritura escrita en el cliente:

```ts
export interface NewBookmarkInput {
  workspaceId: string;
  folderId?: string | null;
  collectionId?: string | null;
  url: string;
  /** Vacio o ausente: lo rellena el servidor con el titulo del enlace. */
  title?: string;
  tags?: string[];
}

export async function createBookmarkAction(input: NewBookmarkInput): Promise<string> {
  const id = Crypto.randomUUID();
  const bookmark = newBookmark({ id, ...input });

  // Se escribe local y se encola. La UI nunca espera a la red, y el texto del
  // articulo llega despues por el pull: un bookmark se guarda aunque no haya
  // conexion, y esa es la razon de que la extraccion no vaya dentro de este push.
  await localUpdate("bookmark", id, { ...bookmark });
  await enqueueOperation({
    kind: "create",
    entity: "bookmark",
    entityId: id,
    baseVersion: 0,
    payload: {
      workspaceId: bookmark.workspaceId,
      folderId: bookmark.folderId,
      collectionId: bookmark.collectionId,
      url: bookmark.url,
      title: bookmark.title,
      tags: bookmark.tags,
    },
  });
  return id;
}
```

`document`, `plainText`, `extractionState`, `siteName`, `description` e `imageUrl` **no estan en el payload** y no estan en la fila local. No es que seolviden: si el cliente los mandara, `sanitisePayload` los tira en silencio y el `pull` los devuelve vacios igual, pero habria que entender por que antes. `position: 0` tampoco va en el payload de la creacion, porque `sanitisePayload` lo fuerza a un entero no negativo y el default de la columna ya es 0.

`updateBookmarkAction` acepta `url`, `title`, `folderId`, `collectionId` y `tags`. **No acepta `workspaceId`**: por la regla de `lib/notes/actions.ts:38-41`, un bookmark no se muda de workspace.

- [ ] **Step 6: La prueba que hace que esto valga**

Run: `npm run check`
Expected: PASS (typecheck + test + expo config).

Y despues, una comprobacion manual que ninguna suite puede hacer todavia: `npx expo export --platform web` no debe fallar. El cliente nuevo no se renderiza en ninguna pantalla todavia (eso es la fase 4), asi que que el bundle compila es todo lo que se puede exigir aqui.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/lib/collections apps/mobile/src/lib/bookmarks \
  apps/mobile/src/lib/content-order.ts apps/mobile/src/lib/content-order-save.ts
git commit -m "feat(mobile): crear collections y bookmarks offline, y ordenarlas en la carpeta"
```

---

## Fuera de esta fase

- **Ninguna UI.** El share sheet es la fase 3, el lector y el inbox la 4.
- **La extraccion.** El endpoint `POST /bookmarks/:id/extract`, el guard de SSRF, Readability, OG y oEmbed son la fase 2. Por eso `extractionState` arranca en `pending` y no se mueve solo: en esta fase **nadie** lo cambia, y eso es lo correcto.
- **`syncEntitySchema` en el cliente.** La Task 3 lo amplia y el cliente lo reexporta; no hay nada mas que registrar en `apps/mobile` para que el outbox acepte las entidades.
- **Compartir bookmarks con otra persona.** `shares/pending-node.ts` no se toca.
- **Borrar en cascada de una carpeta.** Una carpeta con colecciones dentro las borre porque la FK lo hace, y los bookmarks de esas colecciones sobreviven por `set null`; que el cliente lo vea es trabajo de la fase 4.