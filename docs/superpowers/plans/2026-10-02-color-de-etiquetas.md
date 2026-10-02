# Color de etiqueta por lista — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every label on a task shows in a colour that is the same across the whole list, derived from the label's own name when nobody has chosen one, and choosable from the label page of the task's sheet.

**Architecture:** A new `tagColors` field on the **list** (a `jsonb` of label → colour), carrying only the colours a person actually chose. The colour a label shows is `chosen[tag] ?? derivedTagColor(tag)`, where the derived one is an FNV-1a hash of the label's name into the twelve-colour palette the app already has for icons. The derivation lives in `packages/contracts` so the server, the client and a future export all answer the same; it is pure and stateless, so nothing is stored and nothing is synced for the default case, and existing labels get a colour with no backfill.

**Tech Stack:** TypeScript, Zod, Drizzle (Postgres + PGlite), React Native / Expo Router, Vitest, Chrome via CDP.

**Spec:** `docs/superpowers/specs/2026-10-02-color-de-etiquetas-design.md` — the plan argues from the spec, so the spec travels with it; executors read both.

## Global Constraints

- **The palette is the twelve that already exist** — `ITEM_ICON_COLORS` in `packages/contracts/src/item-icons.ts`: `neutral`, `accent`, `green`, `olive`, `amber`, `orange`, `red`, `rose`, `purple`, `blue`, `teal`, `brown`. No new colours, no new theme tokens. `AGENTS.md` rule 6.
- **The derivation lives in `packages/contracts`,** not in the app. `docs/superpowers/specs/2026-10-02-color-de-etiquetas-design.md` says why: the export bundle will need it.
- **`tagColors` is on the list, not on the item and not on the account.** See the spec's "Donde vive".
- **Only chosen colours are stored.** The derived one is computed at paint time and is never written.
- **An unknown colour is dropped from the map, never rejected.** The `push` validates the envelope, not each operation's fields — `sanitisePayload` in `apps/api/src/modules/sync/sync-service.ts` is the validator. An icon the app cannot draw is stored as `null` (`apps/api/test/sync.test.ts`); an unknown label colour is stored as absent. No 422.
- **`apps/api/src/db/constants.ts` `list` allowlist is not optional.** A field in the table and the contract but not in `SYNC_WRITABLE_FIELDS.list` is dropped **in silence**: the push answers `applied` and nothing changes. The comment at lines 105-110 of that file records four rounds of this.
- **The derivation does not fold case and does not fold accents.** `Pañales` and `panales` are two different labels everywhere else in this app (`shown.tags.includes(tag)` is exact), so they are two labels and get two colours.
- **Migrations are generated, never hand-written**, and the generated `.sql` and snapshot are committed: `apps/api/test/helpers.ts` applies the committed folder and nothing else.
- **`apps/mobile` tests are `.ts` only** (`apps/mobile/vitest.config.ts`: `include: ['test/**/*.test.ts']`, `environment: 'node'`, React Native stubbed). **There is no component test in this repo.** Anything that renders is verified in a browser, which is why Task 8 exists and why its script is a deliverable rather than a nicety.
- **`packages/contracts` has no test runner.** Tests for contract code live in `apps/mobile/test/`, which already imports from `@orbit-hub/contracts` — see `apps/mobile/test/item-icons.test.ts`. Building the package first is required, because that import resolves to `dist`.
- **Copy is Spanish first.** `apps/mobile/src/lib/i18n/dictionaries.ts` derives `TranslationKey = keyof typeof es` and types `en` as `Record<TranslationKey, string>`, so a key added to the Spanish block and not the English one fails the build.

## Review Focus

Five input classes the spec implies that no task's happy path exercises. Each line has its test in the task named beside it.

1. **Two lists that share a label name, coloured differently.** "Mercadona" green in the shopping list and red in the other one. The colour must be read from the list in hand, never from a module-level map keyed by the label — a `Map` at module scope passes every unit test in the plan and fails this. → Task 8.
2. **A list cached before this feature existed.** The cache outlives the build that wrote it, and `readRecord<T>` in `apps/mobile/src/hooks/use-lists.ts` is a blind cast, so `list.tagColors` is `undefined` on the first run after an update. Every read of a colour must survive that. → Task 3.
3. **A colour chosen while offline.** `AGENTS.md` rule 7: any write path must work offline — write locally, enqueue, sync later. The pill must repaint from the cache at once and reach the server when the connection is back. → Task 8.
4. **Two labels whose names differ only in case or accents.** `Pañales` and `panales` are separate labels and must get separate colours; choosing a colour for one must not touch the other. → Task 1.
5. **A colour stored for a label no item carries any more.** The entry outlives its last use. It must be harmless, must not crash, and must not appear on another list. → Task 1 (sanitiser) and Task 8.

---

## File Structure

**Created**

| File | One job |
| --- | --- |
| `packages/contracts/src/tag-colors.ts` | The label-colour vocabulary: the schema, the derivation, the sanitiser. Pure, no I/O. |
| `apps/mobile/test/tag-colors.test.ts` | Tests for all of the above, plus the list schema's default. The only place contract behaviour is tested. |
| `apps/mobile/src/lib/lists/tag-colors.ts` | The client-side pure planner for a colour change. Testable without React. |
| `apps/mobile/src/components/lists/tag-chip.tsx` | One label rendered as a coloured pill. The only place a label's colour becomes pixels. |
| `apps/mobile/test/list-record.test.ts` | Tests for `withListDefaults` and for the duplication plan carrying the map. |
| `apps/mobile/test/tag-color-plan.test.ts` | Tests for `planTagColorChange`. |
| `scripts/verify-tag-colors.mjs` | Drives a real browser: the pills, the recolour, the two-list isolation, the offline repaint. |

**Modified**

| File | Change |
| --- | --- |
| `packages/contracts/src/workspace.ts` | `tagColors` on `listSchema`; re-export the new module from the package index. |
| `apps/api/src/db/content-schema.ts` | The `tag_colors` column on `lists`. |
| `apps/api/drizzle/*` | The generated migration and its snapshot (created by `db:generate`). |
| `apps/api/src/db/constants.ts` | `tagColors` in `SYNC_WRITABLE_FIELDS.list`. |
| `apps/api/src/modules/sync/sync-service.ts` | The `tagColors` branch in `sanitisePayload`. |
| `apps/api/src/modules/lists/content-query-service.ts` | `tagColors` in the two hand-written list projections (lines ~120 and ~170). |
| `apps/api/test/sync.test.ts` | The push/read-back test, the dropped-colour test, the absent-field test. |
| `apps/mobile/src/lib/lists/item-record.ts` | `withListDefaults`. |
| `apps/mobile/src/hooks/use-lists.ts` | Read through `withListDefaults`; `setTagColor`; export it. |
| `apps/mobile/src/lib/lists/duplicate.ts` | `tagColors` in `DuplicationSource` and in the copy. |
| `apps/mobile/src/components/lists/item-edit-sheet.tsx` | The colour control on the labels page. |
| `apps/mobile/src/lib/i18n/dictionaries.ts` | Four keys, both languages. |
| `apps/mobile/src/app/(app)/list/[listId].tsx` | Pass the list down to the sheet; one pill per label in the row. |
| `docs/roadmap.md` | The entry, in the house style of the other features. |

---

### Task 1: The contract knows what a label's colour is

**Files:**
- Create: `packages/contracts/src/tag-colors.ts`
- Create: `apps/mobile/test/tag-colors.test.ts`
- Modify: `packages/contracts/src/workspace.ts` (add `tagColors` to `listSchema`; re-export)

**Interfaces:**
- Consumes: `ITEM_ICON_COLORS`, `ItemIconColor` from `packages/contracts/src/item-icons.ts` (already exported by the contract's index).
- Produces, for every later task:
  - `type TagColors = Record<string, ItemIconColor>`
  - `const tagColorSchema: z.ZodType<TagColors>` — keys `z.string().trim().min(1).max(40)`, values `z.enum(ITEM_ICON_COLORS)`
  - `derivedTagColor(tag: string): ItemIconColor`
  - `sanitiseTagColors(value: unknown): TagColors`
  - `List["tagColors"]: TagColors` (always present after `parse`, `{}` by default)

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/test/tag-colors.test.ts`:

```ts
import { ITEM_ICON_COLORS, listSchema } from "@orbit-hub/contracts";
import { describe, expect, it } from "vitest";

import { derivedTagColor, sanitiseTagColors } from "@orbit-hub/contracts";

describe("el color que deduce el nombre de una etiqueta", () => {
  it("es el mismo siempre para el mismo nombre", () => {
    // El que no puede fallar: un `Math.random()` en el render daria un color
    // distinto en cada paints, y una lista donde los colores cambian sola es una
    // animacion, no una lista.
    const primera = derivedTagColor("Mercadona");
    for (let i = 0; i < 100; i += 1) {
      expect(derivedTagColor("Mercadona")).toBe(primera);
    }
  });

  it("solo devuelve colores que la app sabe pintar", () => {
    const nombres = ["Mercadona", "Alcampo", "casa", "urgente", "", "Ñandú", "🛒"];
    for (const nombre of nombres) {
      expect(ITEM_ICON_COLORS).toContain(derivedTagColor(nombre));
    }
  });

  it("no junta las etiquetas que solo se parecen en como se escriben", () => {
    // `Pañales` y `panales` son dos etiquetas distintas en toda la app —el
    // `includes` es exacto— asi que aqui tambien, y por eso el hash no pliega
    // mayusculas ni acentos: si los plegara, dos etiquetas distintas tendrian el
    // mismo color y elegirse una cambiaria la otra de color sin avisar.
    expect(derivedTagColor("Pañales")).not.toBe(derivedTagColor("panales"));
  });
});

describe("el mapa de colores que se guarda", () => {
  it("deja fuera lo que no es un color y conserva lo demas", () => {
    expect(sanitiseTagColors({ Mercadona: "green", Alcampo: "ultralight" })).toEqual({
      Mercadona: "green",
    });
  });

  it("descarta lo que no es un mapa", () => {
    expect(sanitiseTagColors(undefined)).toEqual({});
    expect(sanitiseTagColors(null)).toEqual({});
    expect(sanitiseTagColors("Mercadona")).toEqual({});
    expect(sanitiseTagColors(42)).toEqual({});
  });

  it("descarta las claves que no son una etiqueta", () => {
    expect(sanitiseTagColors({ "   ": "green", Mercadona: "green" })).toEqual({
      Mercadona: "green",
    });
  });
});

describe("el campo de la lista", () => {
  it("viene vacio cuando nadie ha elegido nada", () => {
    const lista = listSchema.parse({
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      kind: "tasks",
      title: "Compra",
      position: 0,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      role: "owner",
      shared: false,
    });
    expect(lista.tagColors).toEqual({});
  });

  it("conserva lo que se le mando", () => {
    const lista = listSchema.parse({
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      kind: "tasks",
      title: "Compra",
      position: 0,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      role: "owner",
      shared: false,
      tagColors: { Mercadona: "green" },
    });
    expect(lista.tagColors).toEqual({ Mercadona: "green" });
  });

  it("rechaza un color que no esta en la paleta", () => {
    expect(() =>
      listSchema.parse({
        id: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
        kind: "tasks",
        title: "Compra",
        position: 0,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        role: "owner",
        shared: false,
        tagColors: { Mercadona: "ultralight" },
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

```
npm run build:packages && npm run test --workspace @orbit-hub/mobile -- tag-colors
```

Expected: FAIL — `derivedTagColor` is not exported by `@orbit-hub/contracts`.

- [ ] **Step 3: Implement `packages/contracts/src/tag-colors.ts`**

```ts
import { z } from 'zod';

import { ITEM_ICON_COLORS } from './item-icons.js';
import type { ItemIconColor } from './item-icons.js';

/**
 * The colours a label can have are the colours an icon can have, and not a new
 * set: the app draws these twelve already, so a label is never a colour nobody
 * can read and the palette is not two lists that have drifted apart.
 */
export const tagColorSchema = z.record(
  z.string().trim().min(1).max(40),
  z.enum(ITEM_ICON_COLORS),
);
export type TagColors = z.infer<typeof tagColorSchema>;

/**
 * The colour a label gets when nobody has chosen one for it.
 *
 * A hash of the name, and that is the whole design: the colour is **obligatory**
 * and choosing it is **optional**, so the default case has to exist without
 * anybody deciding anything — and it has to be a colour and not a grey, or "nobody
 * chose" and "this name happens to be grey" would look the same.
 *
 * FNV-1a, 32 bits, over the UTF-16 units of the name, modulo the palette length.
 * `Math.imul` keeps the multiply exact in 32 bits in every engine and
 * `charCodeAt` reads the same everywhere, so two phones and a server land on the
 * same colour for the same word. That is what makes it safe **not to store it**:
 * there is nothing to sync for the default case, and the labels that already
 * exist get a colour the moment this ships, with no backfill.
 *
 * **Case and accents are not folded.** `Pañales` and `panales` are two different
 * labels everywhere else in this app —the membership check is exact— so folding
 * them here would give two labels one colour, and choosing a colour for one would
 * silently recolour the other.
 */
export function derivedTagColor(tag: string): ItemIconColor {
  let hash = 0x811c9dc5;
  for (let index = 0; index < tag.length; index += 1) {
    hash ^= tag.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return ITEM_ICON_COLORS[hash % ITEM_ICON_COLORS.length];
}

/**
 * A map of colours made only of colours this build knows.
 *
 * On both sides of the wire, which is why it is here and not in either app: the
 * server runs it over a payload it has not validated, and the client runs it over
 * a cache row written by a build that may predate the field.
 *
 * An entry that is dropped is **not** a failure. It means "no colour chosen",
 * which is a state the map already has — an absent key — so the label falls back
 * to `derivedTagColor`. Rejecting the whole write would lose every other label's
 * colour because of one bad key, and would punish whoever did not type that key.
 */
export function sanitiseTagColors(value: unknown): TagColors;
export function sanitiseTagColors(value: unknown): TagColors {
  // Not an object, or an array, is no map: `{}`. Otherwise copy entry by entry,
  // skipping a key that is not 1-40 characters once trimmed, and a value that is
  // not one of the twelve. `ITEM_ICON_COLORS.includes` needs the cast: the value
  // out of `Object.entries` is `unknown`.
}
```

- [ ] **Step 4: Wire it into `listSchema` and export it**

In `packages/contracts/src/workspace.ts`, add to the `listSchema` extend (after the `tags` line at 319):

```ts
    /**
     * The colours of the labels of this list, and only the ones somebody chose.
     *
     * A label's colour is a property of the **list**, so everyone looking at a
     * shared list sees "Mercadona" in the same colour, and changing it recolours
     * every task that carries it at once. On the task it would mean two tasks
     * with the same label in two colours, and then the colour says nothing.
     *
     * Absent means "nobody chose", and that is not the same as neutral: the label
     * falls back to `derivedTagColor(tag)`, which is why existing labels get a
     * colour the moment this ships and why there is no backfill to run.
     */
    tagColors: tagColorSchema.default({}),
```

Add the import next to the existing `ITEM_ICON_COLORS` import at the top of the file, and re-export from the contract's index alongside the `item-icons.js` re-export block at lines 263-270:

```ts
export { tagColorSchema, derivedTagColor, sanitiseTagColors } from './tag-colors.js';
export type { TagColors } from './tag-colors.js';
```

- [ ] **Step 5: Run the tests to see them pass**

```
npm run build:packages && npm run test --workspace @orbit-hub/mobile -- tag-colors
```

Expected: PASS, 9 tests.

- [ ] **Step 6: Typecheck the contract and the client, not the API yet**

```
npm run build:packages && npm run typecheck --workspace @orbit-hub/contracts && npm run typecheck --workspace @orbit-hub/mobile
```

Expected: clean. **`npm run typecheck` at the root fails at this point, and that is expected**: `content-query-service.ts` builds `List` objects by hand in two places, so the moment `List` carries a required `tagColors` those two projections are wrong — and the typecheck is pointing at exactly the two lines Task 2 has to change. Do not silence it; Task 2 makes it green.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/tag-colors.ts packages/contracts/src/workspace.ts apps/mobile/test/tag-colors.test.ts
git commit -m "El color de una etiqueta, deducido de su nombre"
```

---

### Task 2: The server keeps it, and does not drop it in silence

**Files:**
- Modify: `apps/api/src/db/content-schema.ts` (the `lists` table, after `tags` at line 315)
- Create (generated): `apps/api/drizzle/0020_*.sql` and `apps/api/drizzle/meta/*`
- Modify: `apps/api/src/db/constants.ts` (`SYNC_WRITABLE_FIELDS.list`, lines 113-122)
- Modify: `apps/api/src/modules/sync/sync-service.ts` (`sanitisePayload`, after the `tags` branch at line 251-256)
- Modify: `apps/api/src/modules/lists/content-query-service.ts` (the two list projections, lines ~120 and ~170)
- Test: `apps/api/test/sync.test.ts`

**Interfaces:**
- Consumes: `TagColors`, `sanitiseTagColors` from `@orbit-hub/contracts` (Task 1).
- Produces: `lists.tagColors` is readable and writable through `/sync/push`, and returned by `GET /lists/:id` and by the workspace list read. Nothing else consumes it yet.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe` block in `apps/api/test/sync.test.ts`, next to the test at line 634 named `'keeps every field of a create, not only the ones the insert names'`:

```ts
  it('keeps the colours of a list, and does not keep the ones it cannot draw', async () => {
    // The shape of the bug: a field in the table and in the contract but not in
    // `SYNC_WRITABLE_FIELDS.list` is dropped in silence — the push answers
    // `applied`, the version goes up, and nothing anywhere says so. It has
    // happened four times (`wash` and `colorTo` among them). This test is the
    // one that would have caught it.
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Colores');
    const listId = randomUUID();

    await push(user, [
      operation({
        entity: 'list',
        kind: 'create',
        entityId: listId,
        payload: {
          workspaceId: workspace.id,
          title: 'Compra',
          kind: 'tasks',
          tagColors: { Mercadona: 'green', Alcampo: 'ultralight' },
        },
      }),
    ]);

    const list = await api.get(`/lists/${listId}`, user.accessToken);
    // The colour this build can draw is there...
    expect(list.body.data.tagColors).toEqual({ Mercadona: 'green' });
    // ...and the one it cannot was dropped rather than stored: the map is not
    // the whole write, and the label it belonged to simply has no colour chosen,
    // which is a state the map already has.
    expect(list.body.data.tagColors).not.toHaveProperty('Alcampo');
  });

  it('leaves the colours of a list that was created without them at empty', async () => {
    // The other half: a client that knows nothing about colours sends none, and
    // the list is read with an empty map rather than with no key — the client
    // would read `undefined` and every colour lookup would have to survive that.
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Sin colores');
    const listId = randomUUID();

    await push(user, [
      operation({
        entity: 'list',
        kind: 'create',
        entityId: listId,
        payload: { workspaceId: workspace.id, title: 'Vacia', kind: 'tasks' },
      }),
    ]);

    const list = await api.get(`/lists/${listId}`, user.accessToken);
    expect(list.body.data.tagColors).toEqual({});
  });
```

- [ ] **Step 2: Run the test to see it fail**

```
npm run test --workspace @orbit-hub/api -- sync
```

Expected: FAIL — `list.body.data.tagColors` is `undefined`.

- [ ] **Step 3: Add the column**

In `apps/api/src/db/content-schema.ts`, in the `lists` table, after the `tags` line:

```ts
    /**
     * The colours of this list's labels, and only the ones somebody chose.
     *
     * Empty is the normal state and it is a real one: a label with no colour
     * here falls back to the colour deduced from its name, which is computed and
     * not stored, so the common list carries `{}` forever.
     */
    tagColors: jsonb('tag_colors').$type<TagColors>().notNull().default({}),
```

Add `TagColors` to the type import at the top of that file from `@orbit-hub/contracts`.

- [ ] **Step 4: Generate the migration**

```
npm run db:generate --workspace @orbit-hub/api
```

Expected: a new `apps/api/drizzle/0020_*.sql` containing one `ALTER TABLE "lists" ADD COLUMN "tag_colors" jsonb DEFAULT '{}' NOT NULL;` and a matching snapshot, plus a new entry in `meta/_journal.json`.

**Do not hand-write the SQL and do not edit the snapshot.** `apps/api/test/helpers.ts` applies the committed folder and nothing else, so a migration that is not committed is a column the tests do not have.

- [ ] **Step 5: Add the field to the allowlist**

In `apps/api/src/db/constants.ts`, in `SYNC_WRITABLE_FIELDS.list`, after `'tags',`:

```ts
    'tagColors',
```

- [ ] **Step 6: Sanitise the payload**

In `apps/api/src/modules/sync/sync-service.ts`, in `sanitisePayload`, after the `tags` branch:

```ts
    if (key === 'tagColors') {
      // The only labels whose colour somebody chose. A colour this build cannot
      // draw is dropped rather than replaced with `neutral`: dropping leaves the
      // label with no colour chosen, which is a state the map already has and
      // which sends it back to the colour deduced from its name. Replacing it
      // with `neutral` would be a choice nobody made, and it would be stored.
      clean[key] = sanitiseTagColors(value);
      continue;
    }
```

Add `sanitiseTagColors` to the `@orbit-hub/contracts` import at the top of that file.

- [ ] **Step 7: Return it from both read paths**

In `apps/api/src/modules/lists/content-query-service.ts`, add `tagColors: row.tagColors ?? {},` to **both** hand-written list projections — the `const items: List[] = rows.map(...)` at line ~120 and the `return {` at ~170. `?? {}` and not `row.tagColors`: the column is `notNull` for anything this build wrote, but a row from a build that predates the column arrives through PGlite's and Postgres' own defaults, and the projection is what the client reads.

- [ ] **Step 8: Run the test to see it pass**

```
npm run test --workspace @orbit-hub/api -- sync
```

Expected: PASS.

- [ ] **Step 9: Run the whole API suite and the typecheck**

```
npm run test --workspace @orbit-hub/api && npm run typecheck
```

Expected: all API tests pass, typecheck clean.

- [ ] **Step 10: Commit**

```bash
git add apps/api/drizzle apps/api/src/db/content-schema.ts apps/api/src/db/constants.ts apps/api/src/modules/sync/sync-service.ts apps/api/src/modules/lists/content-query-service.ts apps/api/test/sync.test.ts
git commit -m "El servidor guarda el color de las etiquetas de una lista"
```

---

### Task 3: The client reads a list that may predate the field

**Files:**
- Modify: `apps/mobile/src/lib/lists/item-record.ts` (after `withListItemDefaults`, line 144)
- Modify: `apps/mobile/src/hooks/use-lists.ts` (`load`, line ~61)
- Modify: `apps/mobile/src/lib/lists/duplicate.ts` (`DuplicationSource` line 16-24, the copy at ~line 134)
- Create: `apps/mobile/test/list-record.test.ts`
- Modify: `apps/mobile/test/duplicate-list.test.ts`

**Interfaces:**
- Consumes: `List`, `TagColors`, `sanitiseTagColors` from `@orbit-hub/contracts` (Task 1). `derivedTagColor` is **not** needed here — nothing in this task computes a colour.
- Produces: `withListDefaults(value: unknown): List`; `DuplicationSource.tagColors: TagColors`.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/test/list-record.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { withListDefaults } from "@/lib/lists/item-record";

/** A list as the cache holds it: only the fields that build wrote. */
function listRow(extra: Record<string, unknown> = {}) {
  return {
    id: "lista-1",
    version: 3,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
    workspaceId: "espacio-1",
    folderId: null,
    kind: "tasks",
    title: "Compra",
    description: null,
    emoji: null,
    tags: [],
    position: 0,
    itemCount: 0,
    orderMode: "manual",
    role: "owner",
    shared: false,
    deletedAt: null,
    ...extra,
  };
}

describe("una lista leida de la cache", () => {
  it("viene con el mapa de colores aunque la cache no lo tenga", () => {
    // La cache sobrevive a la build que la escribio. Una lista guardada antes de
    // que existiera este campo llega sin la clave, y `readRecord` hace un cast
    // sin mirar: sin esto `list.tagColors` es `undefined` y toda lectura de un
    // color tiene que sobrevivir a eso.
    expect(withListDefaults(listRow()).tagColors).toEqual({});
  });

  it("descarta del mapa lo que no es un color, y conserva lo demas", () => {
    // Una fila de una build futura puede escribir una clave que este build no
    // sabe pintar. Se cae la clave, no el mapa.
    expect(
      withListDefaults(
        listRow({ tagColors: { Mercadona: "green", Alcampo: "ultralight" } }),
      ).tagColors,
    ).toEqual({ Mercadona: "green" });
  });

  it("no pierde ningun otro campo de la lista", () => {
    const lista = withListDefaults(
      listRow({ tagColors: { Mercadona: "red" } }),
    );
    expect(lista.id).toBe("lista-1");
    expect(lista.title).toBe("Compra");
    expect(lista.orderMode).toBe("manual");
    expect(lista.tagColors).toEqual({ Mercadona: "red" });
  });
});
```

Then add the duplication test to the **existing** `apps/mobile/test/duplicate-list.test.ts`, which already has a `source()` factory and the right call shape — do not write a second factory for the same thing:

```ts
  it('takes the label colours with it', () => {
    // A copy of a list whose labels come out in one colour and that duplicates
    // into another is a list that changed the moment it was duplicated, and
    // nobody asked for it.
    const plan = planDuplication(source({ tagColors: { pendiente: 'green' } }), items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    expect(plan.list.tagColors).toEqual({ pendiente: 'green' });
  });

  it('copies the label colours by value, not by reference', () => {
    // Same reason as the tags above it: a later write to the copy must not reach
    // back into the original's map.
    const plan = planDuplication(source({ tagColors: { pendiente: 'green' } }), items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    plan.list.tagColors.pendiente = 'red';
    expect(plan.list.tagColors).toEqual({ pendiente: 'red' });
    expect(source({ tagColors: { pendiente: 'green' } }).tagColors).toEqual({
      pendiente: 'green',
    });
  });
```

Note `DuplicationOptions.newListId` is a **`string`**, not a function, while `newItemId` is a function — check `apps/mobile/src/lib/lists/duplicate.ts:63-68` before writing the call.

- [ ] **Step 2: Run the tests to see them fail**

```
npm run test --workspace @orbit-hub/mobile -- list-record
```

Expected: FAIL — `withListDefaults` is not exported by `@/lib/lists/item-record`.

- [ ] **Step 3: Implement `withListDefaults`**

In `apps/mobile/src/lib/lists/item-record.ts`, after `withListItemDefaults`:

```ts
/**
 * A list read from the cache or from the server, with what is missing filled in.
 *
 * The same reason as `withListItemDefaults`, and the same hazard with a sharper
 * edge: `readRecord` in `use-lists.ts` is a cast, not a parse, so a list that
 * was cached before `tagColors` existed arrives with **no key at all** — not
 * with an empty map. Every colour lookup would then be reading `undefined`, and
 * the failure would show up as a row that paints no labels.
 */
export function withListDefaults(value: unknown): List {
  const record = (value ?? {}) as Record<string, unknown>;

  return {
    ...(record as unknown as List),
    tagColors: sanitiseTagColors(record.tagColors),
  };
}
```

Add `sanitiseTagColors` to the `@orbit-hub/contracts` import at the top of the file.

- [ ] **Step 4: Read lists through it**

In `apps/mobile/src/hooks/use-lists.ts`, in `load`, change

```ts
      .map((row) => readRecord<List>(row))
```

to

```ts
      .map((row) => withListDefaults(readRecord<List>(row)))
```

and add `withListDefaults` to the import from `@/lib/lists/item-record` (which already imports `newListItem` and `withListItemDefaults` from there).

- [ ] **Step 5: Carry the map through a duplication**

In `apps/mobile/src/lib/lists/duplicate.ts`:

- add to `DuplicationSource`, after `orderMode`:
```ts
  /** The chosen colours of the labels, so the copy reads the same way. */
  tagColors: TagColors;
```
- add to the object literal that builds the copy, after `orderMode: source.orderMode,`:
```ts
      tagColors: { ...source.tagColors },
```
- add `TagColors` to the type import from `@orbit-hub/contracts`.

The spread is the whole rule, and it is the same rule the tags two lines above already follow with the comment *"Copied by value: a later push to the copy must not touch the original."* A copy sharing the map by reference is a write to one list recolouring the other.

- [ ] **Step 6: Run the tests to see them pass**

```
npm run test --workspace @orbit-hub/mobile -- list-record duplicate-list
```

Expected: PASS, 3 tests in `list-record` and the existing `duplicate-list` suite plus 2 more.

- [ ] **Step 7: Run the whole mobile suite and the typecheck**

```
npm run test --workspace @orbit-hub/mobile && npm run typecheck
```

Expected: all pass, typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/lib/lists/item-record.ts apps/mobile/src/hooks/use-lists.ts apps/mobile/src/lib/lists/duplicate.ts apps/mobile/test/list-record.test.ts
git commit -m "La lista se lee con el mapa de colores, aunque la cache no lo tenga"
```

---

### Task 4: Choosing a colour, planned as a pure function

**Files:**
- Create: `apps/mobile/src/lib/lists/tag-colors.ts`
- Create: `apps/mobile/test/tag-color-plan.test.ts`
- Modify: `apps/mobile/src/hooks/use-lists.ts` (next to `setOrderMode`, line 295)

**Interfaces:**
- Consumes: `TagColors`, `ItemIconColor` from `@orbit-hub/contracts`.
- Produces:
  - `planTagColorChange(current: TagColors, tag: string, color: ItemIconColor | null): TagColors`
  - `useLists(...).setTagColor(list: List, tag: string, color: ItemIconColor | null): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/test/tag-color-plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { planTagColorChange } from "@/lib/lists/tag-colors";

describe("cambiar el color de una etiqueta", () => {
  it("guarda el color que se ha elegido", () => {
    expect(planTagColorChange({}, "Mercadona", "green")).toEqual({
      Mercadona: "green",
    });
  });

  it("no toca los colores de las demas etiquetas", () => {
    // El mapa entero viaja en una sola operacion del sync, asi que una
    // escritura que pierde un color ajeno pierde el de otra persona sin que
    // ninguna de las dos se entere.
    expect(
      planTagColorChange({ Alcampo: "red", casa: "blue" }, "Mercadona", "green"),
    ).toEqual({ Alcampo: "red", casa: "blue", Mercadona: "green" });
  });

  it("cambia el color de una etiqueta que ya tenia uno", () => {
    expect(planTagColorChange({ Mercadona: "red" }, "Mercadona", "green")).toEqual({
      Mercadona: "green",
    });
  });

  it("quitar el color devuelve la etiqueta al que se deduce de su nombre", () => {
    // No es "sin color": es el estado de "no hay color guardado", que es el que
    // hace que la etiqueta vuelva al deducido. Por eso la opcion se llama
    // "volver al deducido" y no "quitar".
    expect(planTagColorChange({ Mercadona: "green", Alcampo: "red" }, "Mercadona", null)).toEqual({
      Alcampo: "red",
    });
  });

  it("quitar el color de una etiqueta que no tenia ninguno no cambia nada", () => {
    expect(planTagColorChange({ Alcampo: "red" }, "Mercadona", null)).toEqual({
      Alcampo: "red",
    });
  });

  it("no muta el mapa que le pasan", () => {
    const original = { Mercadona: "red" as const };
    planTagColorChange(original, "Mercadona", "green");
    expect(original).toEqual({ Mercadona: "red" });
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

```
npm run test --workspace @orbit-hub/mobile -- tag-color-plan
```

Expected: FAIL — `@/lib/lists/tag-colors` does not exist.

- [ ] **Step 3: Implement the planner**

Create `apps/mobile/src/lib/lists/tag-colors.ts`:

```ts
import type { ItemIconColor, TagColors } from "@orbit-hub/contracts";

/**
 * What writing a label's colour should leave in the map.
 *
 * A pure function and not a line inside the hook, for the reason the rest of
 * this folder is made of pure functions: this is the rule that decides what
 * happens to the **other** labels when one colour changes, and the map travels
 * whole in a single sync operation, so getting it wrong loses somebody else's
 * colour without either of them finding out.
 *
 * `color: null` is not "no colour" — there is no such state, and a label always
 * has one. It is "no colour **chosen**", which is an absent key, and that is
 * what sends the label back to `derivedTagColor(tag)`.
 */
export function planTagColorChange(
  current: TagColors,
  tag: string,
  color: ItemIconColor | null,
): TagColors {
  // Start from a copy, so the map the caller passed is not the map that changes.
  // `null` deletes the key; anything else sets it. Nothing else in the map moves.
}
```

- [ ] **Step 4: Write it, local-first**

In `apps/mobile/src/hooks/use-lists.ts`, after `setOrderMode` (line 301):

```ts
  /**
   * The colour of one of this list's labels, for every task that carries it.
   *
   * A property of the list and not of the task, which is why the write lands on
   * the list: one write recolours every row that has the label, and no task is
   * touched at all.
   *
   * Local-first like every other write here — the label repaints from the cache
   * at once and the operation waits in the outbox, so choosing a colour on a
   * train is a colour when the train stops.
   */
  const setTagColor = useCallback(
    async (list: List, tag: string, color: ItemIconColor | null) => {
      await localUpdate("list", list.id, {
        tagColors: planTagColorChange(list.tagColors ?? {}, tag, color),
      });
      await load();
    },
    [load],
  );
```

Add `planTagColorChange` to the import from `@/lib/lists/tag-colors`, and `ItemIconColor` to the type import from `@orbit-hub/contracts`. Add `setTagColor` to the object the hook returns (line 324-332).

- [ ] **Step 5: Run the tests to see them pass**

```
npm run test --workspace @orbit-hub/mobile -- tag-color-plan
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Typecheck**

```
npm run typecheck
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/lib/lists/tag-colors.ts apps/mobile/src/hooks/use-lists.ts apps/mobile/test/tag-color-plan.test.ts
git commit -m "Elegir el color de una etiqueta es un cambio de la lista, no de la tarea"
```

---

### Task 5: The pill — one component, one colour

**Files:**
- Create: `apps/mobile/src/components/lists/tag-chip.tsx`

**Interfaces:**
- Consumes: `TagColors`, `derivedTagColor` from `@orbit-hub/contracts`; `iconColor` from `@/lib/lists/item-icons`.
- Produces:
  ```ts
  export function TagChip({
    tag, colors, size, children,
  }: {
    tag: string;
    colors: TagColors | undefined;
    size?: "regular" | "compact";
    children?: ReactNode;
  }): JSX.Element
  ```
  `colors` is the **list's** map and is passed in, never read from anywhere else — that is what keeps two lists from sharing a colour. `children` is what goes inside the pill (the sheet's remove button).

**There is no test for this task.** `apps/mobile/vitest.config.ts` includes only `test/**/*.test.ts` with React Native stubbed, so a component cannot be rendered by any test in this repo. Its verification is Steps 4-6 plus Task 8, and that is the reason Task 8 exists rather than a nicety.

- [ ] **Step 1: Write the component**

Create `apps/mobile/src/components/lists/tag-chip.tsx`:

```tsx
import { useTheme } from "@/theme";
import type { TagColors } from "@orbit-hub/contracts";
import { derivedTagColor } from "@orbit-hub/contracts";
import { StyleSheet, View } from "react-native";
import type { ReactNode } from "react";

import { iconColor } from "@/lib/lists/item-icons";
import { AppText } from "../ui/text";

/**
 * One label, in the colour this list gives it.
 *
 * The colour arrives in the `colors` prop and is **not** looked up from anywhere
 * else — not a module-level map, not the item, not a hook. That is the whole
 * reason this is a component with a prop: two lists in the same app can hold
 * "Mercadona" in two colours, and a lookup that did not take the list in hand
 * would paint both of them the same one.
 *
 * A tag with nothing chosen is not grey: it is `derivedTagColor(tag)`, the same
 * colour every other device computes for it. There is no state in which a label
 * has no colour, which is why this component has no "empty" branch.
 */
export function TagChip({
  tag,
  colors,
  size = "regular",
  children,
}: {
  tag: string;
  colors: TagColors | undefined;
  size?: "regular" | "compact";
  children?: ReactNode;
}) {
  const theme = useTheme();
  const compacto = size === "compact";

  return (
    <View
      style={[
        styles.chip,
        {
          borderRadius: theme.radius.pill,
          backgroundColor: theme.colors.surfaceMuted,
          paddingHorizontal: compacto ? theme.spacing.xs : theme.spacing.sm,
          paddingVertical: compacto ? 1 : theme.spacing.xxs,
          gap: theme.spacing.xxs,
        },
      ]}
    >
      <AppText
        variant="caption"
        style={{ color: iconColor(colors?.[tag] ?? derivedTagColor(tag)) }}
      >
        {tag}
      </AppText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
  },
});
```

**The colours in `ICON_COLORS` are flat — one value for both schemes — and this is why the pill's colour is the *text* and the fill is `surfaceMuted`.** A filled pill would need a soft variant per colour per scheme, which is 24 values that do not exist and that this task must not invent. Text in the colour on the app's own muted surface is what the icon already does, and it reads the same in both themes.

- [ ] **Step 2: Confirm it compiles and the theme tokens are the ones used**

```
npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Read the palette mapping back**

```
grep -n "surfaceMuted" apps/mobile/src/theme/tokens.ts
```

Expected: a `surfaceMuted` key in both the light and the dark neutrals. If it is missing from one, the pill is invisible on one scheme and the fix is to use a key that is in both — say which in the commit.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/lists/tag-chip.tsx
git commit -m "La pastilla de una etiqueta, en el color que le toca"
```

---

### Task 6: Choosing the colour, from the sheet

**Files:**
- Modify: `apps/mobile/src/components/lists/item-edit-sheet.tsx` (the labels page, lines 533-626; props interface at 27-43)
- Modify: `apps/mobile/src/app/(app)/list/[listId].tsx` (the `<ItemEditSheet>` call, line ~781)
- Modify: `apps/mobile/src/lib/i18n/dictionaries.ts`

**Interfaces:**
- Consumes: `TagChip` (Task 5), `setTagColor` (Task 4), `ICON_COLOR_KEYS` and `ICON_COLOR_LABEL` from `@/lib/lists/item-icons` (both already exist — the twelve swatch labels are already translated in both languages).
- Produces, on `ItemEditSheetProps`:
  ```ts
  tagColors: TagColors;
  onTagColor: (tag: string, color: ItemIconColor | null) => void;
  ```
  Four new translation keys: `tags.color`, `tags.changeColor`, `tags.backToDerived`, `tags.backToDerivedOf`.

- [ ] **Step 1: Add the four keys, Spanish first**

In `apps/mobile/src/lib/i18n/dictionaries.ts`, in the `es` block near the other `tags.*` keys (line 255-256):

```ts
  "tags.color": "Color",
  "tags.changeColor": "Cambiar el color de {name}, ahora {color}",
  "tags.backToDerived": "Volver al color deducido",
  "tags.backToDerivedOf": "Volver al color deducido de {name}",
```

and in the `en` block (line 1214-1215):

```ts
  "tags.color": "Colour",
  "tags.changeColor": "Change the colour of {name}, now {color}",
  "tags.backToDerived": "Back to the derived colour",
  "tags.backToDerivedOf": "Back to the derived colour of {name}",
```

**The English block is not optional.** `TranslationKey = keyof typeof es` and `en` is typed `Record<TranslationKey, string>`, so a Spanish key with no English one fails the build. The `{name}` and `{color}` substitutions are filled with `t(key, { name, color })`.

- [ ] **Step 2: Add the props**

In `item-edit-sheet.tsx`, add to `ItemEditSheetProps`:

```ts
  /** This list's chosen label colours, and the only ones there are. */
  tagColors: TagColors;
  /**
   * Called with the colour chosen for a label, or `null` for the one that sends
   * it back to the colour deduced from its name.
   *
   * It lands on the list and not on the task, which is why the signature has no
   * task in it: one write recolours every row that carries the label.
   */
  onTagColor: (tag: string, color: ItemIconColor | null) => void;
```

destructure both in the component signature, and add `ItemIconColor` and `TagColors` to the type import from `@orbit-hub/contracts`.

- [ ] **Step 3: Build the swatch strip as a local component**

In `item-edit-sheet.tsx`, add a component below `ItemEditSheet` that renders the twelve swatches plus the "back to derived" option. It takes `tag`, the currently chosen colour (`ItemIconColor | undefined`), and `onPick: (color: ItemIconColor | null) => void`. Use the shapes the icon picker already uses (`apps/mobile/src/components/lists/icon-picker.tsx` lines 148-181): a `View` of `ICON_COLOR_KEYS.map(...)`, each a `Pressable` with `accessibilityRole="button"`, `accessibilityState={{ selected }}`, `accessibilityLabel={t(ICON_COLOR_LABEL[option])}`, `testID={`tag-color-${tag}-${option}`}`, and a 30×30 round swatch with `backgroundColor: iconColor(option)`, `borderRadius: 15`, and a 3-point border in `theme.colors.text` when selected and `borderWidth: 0` when not — the border occupies its place always, or the row jumps when you choose.

**Define the swatch style in `item-edit-sheet.tsx`; do not import it.** `styles.swatch` in `icon-picker.tsx` is module-private to that file, and the alternative — exporting a style object out of a sibling screen — is the sort of coupling this plan is not introducing.

Its **first** item is not a colour: a `Pressable` labelled `t("tags.backToDerivedOf", { name: tag })` with `testID={`tag-color-${tag}-derived`}` and an Ionicons `"color-wand-outline"` at `size={18}` in `iconColor(derivedTagColor(tag))` — the colour the label would go back to — with `accessibilityState={{ selected: chosen === undefined }}`. Its `onPress` calls `onPick(null)`.

Add `ICON_COLOR_KEYS`, `ICON_COLOR_LABEL` and `iconColor` to the import from `@/lib/lists/item-icons`, and `derivedTagColor` to the `@orbit-hub/contracts` import.

- [ ] **Step 4: Give each label a colour button**

In the labels page, replace the task's own tags `Pressable` chips with a row per label: `TagChip` wrapping a small `Pressable` holding the remove `x` (keeping the existing `tags.remove` label and the existing `toggleTag`), and a second small `Pressable` holding a 10-point `Ionicons name="color-palette-outline"` whose `accessibilityLabel` is `t("tags.changeColor", { name: tag, color: t(ICON_COLOR_LABEL[effective]) })`, whose `onPress` sets local state to the tag whose strip is open, and whose `testID` is `tag-color-button-${tag}`.

Track the open strip in one piece of state next to `newTag`:

```ts
const [colorDe, setColorDe] = useState<string | null>(null);
```

and render `<TagColorStrip …/>` under the row whose tag is `colorDe`, calling `onTagColor(tag, option)` then `setColorDe(null)`.

**Do not save on close.** Every other field on this panel saves as you go, and a colour is one tap; a strip that needed a confirm button is a strip with two ways to be wrong.

- [ ] **Step 5: Give the "used in this list" chips the same control**

The chips at lines 584-603 show `tag · count`. Render each as a `TagChip` with `children` being the remove-style `Pressable` that puts the label on (`tags.put`) **and** the same colour button, so a label can be given a colour from a task that does not carry it. This is the only place where that is possible, and the spec says so.

- [ ] **Step 6: A new label arrives with its derived colour**

The `TextField` + "add" button path (`addTag`, line 190) stays exactly as it is: a label typed and added gets no chosen colour and is painted with `derivedTagColor`. Nothing in this task writes a colour for a new label — choosing one is optional and blocking on it would mean nobody could ever add a label without making a decision about colour.

- [ ] **Step 7: Pass the list down from the screen**

In `[listId].tsx`, on the `<ItemEditSheet>` call:

```tsx
      <ItemEditSheet
        item={editingItem}
        listId={listId}
        tagColors={list?.tagColors ?? {}}
        onTagColor={(tag, color) => {
          if (list) void setTagColor(list, tag, color);
        }}
        …
      />
```

add `setTagColor` to the `useLists({})` destructure on line 106. The screen already has `list` (line 108), which is why the sheet takes the map as a prop instead of calling `useLists` a second time.

- [ ] **Step 8: Typecheck and run everything**

```
npm run typecheck && npm run test
```

Expected: clean, all suites pass.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/components/lists/item-edit-sheet.tsx "apps/mobile/src/app/(app)/list/[listId].tsx" apps/mobile/src/lib/i18n/dictionaries.ts
git commit -m "El color de una etiqueta se elige en la hoja de etiquetas"
```

---

### Task 7: The row shows one pill per label

**Files:**
- Modify: `apps/mobile/src/app/(app)/list/[listId].tsx` (`TaskRow` and the `renderEntry` call at line ~410)

**Interfaces:**
- Consumes: `TagChip` (Task 5), `TagColors` from `@orbit-hub/contracts`.
- Produces: `TaskRow` takes `tagColors: TagColors`, passed down from the screen's `list`.

- [ ] **Step 1: Replace the joined labels with one pill each**

In `TaskRow`, replace the tags `AppText` inside the `meta` view with:

```tsx
            {item.tags.map((tag) => (
              <TagChip key={tag} tag={tag} colors={tagColors} size="compact" />
            ))}
```

Delete the `metaTags` style, which only existed for the joined string.

- [ ] **Step 2: Let the pills wrap, and keep the badge whole**

In the `meta` style, keep `flexDirection: "row"`, `alignItems: "center"` and **add**:

```ts
    flexWrap: "wrap",
```

The `Badge` above it is the first child and carries no `flexShrink`, so it keeps its size and the pills take what is left and wrap under it. The row's `AppText` above has `numberOfLines={2}` and stays as it is.

**Wrap and do not truncate.** `docs/roadmap.md` already says it about a label beside a name: a label cut in half is not a label. A pill cut in half is worse, because the colour is on the pill and a half-pill reads as a different colour.

- [ ] **Step 3: Pass the list's map into the row**

Add `tagColors: TagColors` to `TaskRow`'s props and to the `TaskRow` call in `renderEntry`:

```tsx
        tagColors={list?.tagColors ?? {}}
```

- [ ] **Step 4: Typecheck and run everything**

```
npm run typecheck && npm run test
```

Expected: clean, all suites pass.

- [ ] **Step 5: Commit**

```bash
git add "apps/mobile/src/app/(app)/list/[listId].tsx"
git commit -m "La fila muestra una pastilla por etiqueta, en el color de la lista"
```

---

### Task 8: Look at it in a browser, and leave something that does it again

**Files:**
- Create: `scripts/verify-tag-colors.mjs`
- Modify: `docs/roadmap.md`

**Interfaces:**
- Consumes: `launchChrome`, `openTab`, `seedSession`, `collectProblems` from `scripts/cdp.mjs` (all exist).
- Produces: `node scripts/verify-tag-colors.mjs` exits non-zero on any failure, and writes screenshots to `capturas/`.

**This is the only task that can see the feature.** The other seven are green on a screen that paints nothing: a component that returns `null` is a correct component, and the typecheck and the unit tests are both satisfied by one. `docs/verificacion-en-navegador.md` is the house procedure and it says a block is not committed without driving the app for real.

- [ ] **Step 1: Write the script**

Create `scripts/verify-tag-colors.mjs` following `scripts/verify-card-marks.mjs` exactly in shape: `APP`/`API` constants, `logOfTheApi()` for the verification-email log, an `api()` helper, an `account()` that registers, reads the token out of the log and logs in, a `push()` of seed operations, `launchChrome()`, `openTab()`, `seedSession()`, `Emulation.setDeviceMetricsOverride` at 390×844, and a `check(name, ok, detail)` that counts failures.

The seed is **two lists in one workspace**, both of kind `tasks`, and this is the point of the script:

- List A, "Compra": `Pan` (`icon: "pan"`, `tags: ["Mercadona"]`), `Leche` (`tags: []`), `Huevos` (`tags: ["Mercadona", "urgente"]`, `priority: "high"`).
- List B, "Semana": `Pan` (`tags: ["Mercadona"]`) — the same label name, so the two-list isolation check has something to compare.

Seeded through `POST /sync/push`, never through the interface, and assert every operation came back `applied` — a push whose operations are all rejected is still a 200.

Then the checks, in this order:

1. **`collectProblems(tab)` is empty.** A console error is a bug even when the screen looks right.
2. **Every pill on screen is one of the twelve colours.** Read the pills' text colour off the computed style of the label text inside each `TagChip` and assert each is in `ICON_COLORS`. This is what proves "a tag always has a colour": there is no grey case to allow, because `neutral` is in the palette on purpose.
3. **Two lists holding the same label name do not share its colour.** List A has "Mercadona" chosen as `green`; list B has the same label with nothing chosen. Read the pill colour for "Mercadona" in A and in B, then drive the UI to choose `red` for A's, and assert **A's pill is now red and B's pill is byte-for-byte the colour it was before the change**. B's colour is not asserted to a fixed value — it is whatever the hash gives it — only that it did not move. This is Review Focus #1, and a module-level `Map` keyed by label name passes every unit test in this plan and fails exactly here.
4. **Changing one colour changes every row that carries the label.** In list A, change "Mercadona" to `red` from the labels page of the "Pan" task, close the sheet, and assert that the "Mercadona" pill on **"Huevos"** — a task the write never mentioned — is now red too. This is the promise in the spec's first section.
5. **A label with nothing chosen paints a derived colour, and it is the same on a second load.** Record the colour of the "urgente" pill, reload the page, assert it is identical.
6. **An offline colour change reaches the server.** With the browser set offline (`Network.emulateNetworkConditions` with `offline: true`), change "urgente" to `blue` in the UI, assert the pill is blue **without a reload** (the local-first path), set the browser back online, wait for the outbox to drain, and then read the value back from `GET /lists/:id` with the session token and assert `blue`. This is Review Focus #3 and `AGENTS.md` rule 7.
7. **Two lists, two colour maps, in the API.** Assert `GET /lists/:id` for A has `tagColors.urgente === "blue"` and for B has no `Mercadona` key.

Take screenshots of the list and of the labels page **in both schemes**, using `Emulation.setEmulatedMedia` with `prefers-color-scheme` set to `light` and then to `dark`, and write them to `capturas/`.

**Fail the script on any non-zero exit**, so it can be run from a terminal and its result is a number, not a claim.

- [ ] **Step 2: Start the two servers**

```
make -C apps/api dev
make web
```

**The API needs `EMAIL_TRANSPORT=console` in the shell for this script**, because the local `.env` has `EMAIL_TRANSPORT=resend` and Resend refuses `@example.com`, so no verification link is ever written to the log the script reads:

```
EMAIL_TRANSPORT=console make -C apps/api dev
```

`dotenv.config()` does not override a variable that is already in the environment, so the shell value wins and the `.env` file is not modified. Do not edit `apps/api/.env` to do this.

- [ ] **Step 3: Run it and read what it says**

```
node scripts/verify-tag-colors.mjs
```

Expected: every check `ok`. Then **open the screenshots and look at them.** A script that passes and a screen that is legible are two different claims: check that the pill text is readable on `surfaceMuted` in both schemes, that the amber and orange pills are not the same colour to the eye, and that a long list of labels does not push the priority badge off the right edge.

**If the contrast is not good enough, fix the pill in Task 5's component and re-run.** Do not paper over it in this task.

- [ ] **Step 4: Fix whatever it found, and re-run until green**

Each fix gets its own commit, and each one names what was wrong and how it was seen.

- [ ] **Step 5: Write the roadmap entry**

Add a section to `docs/roadmap.md` in the style of the other features: what it does, the files (`packages/contracts/src/tag-colors.ts`, `apps/mobile/src/components/lists/tag-chip.tsx`, the four i18n keys, `scripts/verify-tag-colors.mjs`), and — in the house manner — the thing that was nearly got wrong and the thing that was **not** checked. The second half is not optional in this repo's voice: say plainly that nothing was measured on a phone or an emulator, because a pill's width and a wrapped label row are exactly what the browser cannot tell you.

- [ ] **Step 6: Run the whole gate**

```
npm run check
```

Expected: typecheck, both test suites and the expo config all clean.

- [ ] **Step 7: Commit**

```bash
git add scripts/verify-tag-colors.mjs docs/roadmap.md capturas/
git commit -m "Los colores de las etiquetas, mirados en un navegador"
```

---

### Task 9: El icono y el titulo en su propia linea

**Anadida despues de la Tarea 8, a peticion.** No venia en el plan: el titulo y el icono
ya estaban uno al lado del otro, pero **no alineados entre filas**, y eso es lo que se
corri aqui.

**Files:**
- Modify: `apps/mobile/src/app/(app)/list/[listId].tsx` (`TaskRow` and its styles)

**Interfaces:**
- Consumes: `TagChip`, `PRIORITY_ICON`, `PRIORITY_TONE`, `ItemIcon` — all as they are.
- Produces: nothing new. No signature changes anywhere.

- [ ] **Step 1: Mueve el icono dentro de la columna del titulo**

Hoy el icono es un hermano de la columna del titulo, y `styles.item` lleva
`alignItems: "center"`, asi que se centra contra **titulo + etiquetas**. En una tarea con
insignia el icono baja respecto al titulo y en una sin ella queda centrado: de ahi que
no cuadren entre filas.

Saca el `Pressable`/`View` del icono de ahi y ponlo **dentro** de `styles.flex`, en una
primera linea junto al texto. Esa linea es una `View` con `flexDirection: "row"` y
`alignItems: "center"`, para que el icono quede centrado **en la linea del titulo**.

El icono conserva su `Pressable`, su `testID={`item-icon-${item.id}`}`, su
`accessibilityLabel`, su `hitSlop` y su `style={styles.iconSlot}`. Lo unico que cambia es
donde vive.

**Y sin hueco reservado**, por decision de la persona: cuando no hay icono no se dibuja
nada, ni un `View` vacio. Los titulos de las filas con icono empiezan unas posiciones mas
a la derecha que los de las que no lo tienen. Ya se pidio asi antes y se volvio a
confirmar al cambiar la disposicion.

- [ ] **Step 2: La segunda linea solo si hay algo**

`styles.meta` —la insignia y las pastillas— pasa a ser la segunda linea de la columna, y
el `View` que la envuelve se dibuja **solo** si `item.priority !== "none" || item.tags.length > 0`. Eso ya es asi; lo que cambia es que ahora es la segunda linea y no comparte linea con el titulo.

Conserva en `styles.meta` el `flexWrap: "wrap"` y el `alignItems: "center"`, y sus
comentarios: explican cosas ciertas y verificadas en la Tarea 7 (que el `alignSelf` de la
pastilla gana al `alignItems` de la fila, y que el `flexWrap` es lo que salva a la
insignia, no el `flexShrink`).

- [ ] **Step 3: La casilla se queda como esta**

`styles.item` conserva `alignItems: "center"` y la `Checkbox` no se mueve. Solo se le
pide al icono y al titulo que cuadren entre si. Si prefieres que la casilla se alinee con
la linea del titulo en vez de centrarse en la fila entera, es un cambio de una linea en un
`alignItems` — pero no es lo pedido, asi que no se hace.

Anade un `flexShrink: 1` a la linea del titulo? No: el texto ya lleva
`numberOfLines={2}` y la columna padre lleva `minWidth: 0`, que es lo que evita que un
titulo largo empuje el resto de la fila. No tocar lo que ya funciona.

- [ ] **Step 4: Typecheck y todo**

```
npm run typecheck && npm run test
```

- [ ] **Step 5: Vuelve a correr la comprobacion del navegador**

```
EMAIL_TRANSPORT=console make -C apps/api dev   # en otra terminal
make web
node scripts/verify-tag-colors.mjs
```

La comprobacion de la Tarea 8 media esta fila, asi que **sus numeros quedan viejos** y hay
que volver a mirarlos. Lo que hay que mirar de verdad aqui es lo que **no** se habia
visto nunca: el icono centrado en la linea del titulo, y dos filas —una con insignia y
etiquetas y otra sin nada— con el icono y el titulo a la **misma altura**. Mide las
coordenadas y dilo con numeros; si no cuadran, no lo digas de otra manera.

- [ ] **Step 6: Commit**

```bash
git add "apps/mobile/src/app/(app)/list/[listId].tsx" capturas/
git commit -m "El icono y el titulo en su linea, y las etiquetas en la de abajo"
```

---

## What this plan does not cover

- **Notes.** `notes.tags` is untouched; the spec says the request was about task labels.
- **A list's own labels.** `lists.tags` is a different thing and stays as it is.
- **The export bundle.** It will need `derivedTagColor` when it renders colours, which is why the function lives in the contract rather than in the app — but whether the export prints colours is the export feature's decision.
- **Concurrent colour edits.** The whole map travels in one operation, so two people changing colours at once means one version survives. The spec names this as the accepted cost of not adding a sync entity.
- **Android and iOS.** No device is attached to this machine. Every claim in these tasks is a claim about the web target.