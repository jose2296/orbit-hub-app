# Tablero de estados — Plan de implementacion

> **Para agentes:** SUB-SKILL OBLIGATORIO: usa `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para ejecutar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`) para llevar el seguimiento.

**Objetivo:** Un tipo de lista nuevo, `kind: 'board'`, cuyas tareas tienen un estado configurable, se ven de uno en uno en movil con un swipe horizontal que cambia de estado, y de varios en uno en web ancha.

**Arquitectura:** Los estados son un array `jsonb` en la fila de la lista (`lists.states`) y cada tarea apunta a uno por `list_items.state_id`. El orden del array es el orden de las columnas. Editar los estados es **una sola operacion de sync**, porque son un campo. Ninguna tabla nueva, ninguna entidad de sync nueva, ningun indice nuevo.

**Stack:** Expo SDK 57, expo-router, React Native Web 0.21, react-native-gesture-handler 2.32, Reanimated 4.5.1, Drizzle ORM 0.31.11 sobre PostgreSQL, Zod, Vitest en las dos apps.

**Spec:** `docs/superpowers/specs/2026-10-03-tablero-de-estados-design.md`. El plan razona desde el spec y el spec viaja con el: implementador, lee los dos.

## Restricciones globales

Linea por linea. Cada requisito de cada tarea los incluye implicitamente.

- **El SQL commiteado es la verdad.** `apps/api/test/helpers.ts` aplica `apps/api/drizzle/` y nada mas. Cambiar `meta/*_snapshot.json` no cambia lo que ve la base de datos de las pruebas. **Cambiar `meta/_journal.json` si**, porque `readMigrationFiles` recorre sus entradas: una migracion que no este en el journal es una migracion que las pruebas no aplican.
- **No existe `drizzle-kit up` en ningun script.** Los tres scripts de drizzle son `db:generate`, `db:migrate` y `db:studio`.
- **Un campo nuevo que se anada a la tabla y al contrato pero no a `SYNC_WRITABLE_FIELDS` se descarta en silencio** y el push responde `applied` aunque no haya pasado nada. La cicatriz esta en el commit `2bbcba8` y en el comentario del propio archivo. Es el primer sitio donde mirar al escribir codigo.
- **`kind` es un `varchar(24)`, no un enum de Postgres.** Anadir `'board'` es tocar una constante de TypeScript; no lleva `ALTER TYPE` ni `ALTER TABLE`.
- **Las escrituras de listas e items no tienen ruta REST.** Todo va por `POST /sync/push` con operaciones de diff de campos. No existe `POST /lists/:id/items`.
- **Sin tests de componentes.** Este repo no los tiene y no se van a inventar: la suite corre en `node` con React Native sustituido. Lo que se renderiza se comprueba en un navegador.
- **Sin colores, espacios ni radios escritos a mano en pantalla.** Todo sale de `useTheme()` (`apps/mobile/src/theme`).
- **Sin secretos.** Solo `.env.example`.
- **El cliente no es una frontera de seguridad.** Los permisos van en la API.
- **Comandos.** Pruebas de un fichero: `npm run test -w @orbit-hub/api -- test/lists.test.ts` y `npm run test -w @orbit-hub/mobile -- test/board.test.ts`. Suite entera: `npm run check`.
- **Comentarios del codigo en ingles.** Los documentos de `docs/architecture/` y `docs/product/` en ingles; `docs/roadmap.md` y este plan en espanol.

## Foco de revision

Las cinco clases de entrada que el spec insinua pero que ninguna prueba suya ejercita, y que es mas probable que muerdan a alguien. Cada linea tiene su prueba en la tarea que es duena del codigo.

1. **Una tarea llega con un `stateId` que ya no existe en la lista.** Pasa de verdad: otro dispositivo borro el estado y el pull lo trae. Se espera que se pinte en la **primera columna**, no que desaparezca ni que rompa el tablero. -> Tarea 5
2. **Una tarea creada sin `stateId` en un tablero.** Se espera que salga en la primera columna, porque `null` significa "el primero". -> Tarea 5
3. **Se borra el primer estado y hay tareas con `state_id` nulo dentro.** Se espera que se **muevan** al destino elegido, no que salten solas al nuevo primero. -> Tarea 5 y Tarea 12
4. **Un tablero llega a 24 estados y se pulsa "Anadir".** Se espera que no se cree un estado que luego no se puede guardar. -> Tarea 11
5. **El rol es `viewer`.** Se espera que no se monte ni la hoja de mover ni la de editar estados, con el aviso de solo lectura que ya tiene la pantalla de listas. -> Tarea 14

---

### Task 1: Los contratos

**Ficheros:**
- Crear: `packages/contracts/src/board.ts`
- Modificar: `packages/contracts/src/index.ts` (anadir `export * from './board';`)
- Modificar: `packages/contracts/src/workspace.ts:236-250` (`listKindSchema` y `listKindLabelKey`), y los dos `listSchema`/`listItemSchema` de `workspace.ts:314-356` y `363-420`

**Interfaces:**
- Consume: `ITEM_ICON_COLORS` de `packages/contracts/src/item-icons.ts:317`. El color de un estado se declara `z.enum(ITEM_ICON_COLORS)`, igual que hace `workspace.ts:400` e `item-icons.ts`. **No existe un `itemIconColorSchema` con ese nombre; no lo busques.**
- Produce: `MAX_BOARD_STATES: 24`, `boardStateSchema`, `boardStatesSchema`, `BoardState`, `BoardStates`, `firstStateId()`, `stateOf()`, `isKnownStateId()`. Todas las tareas siguientes usan estos nombres exactos.

- [ ] **Paso 1: el entregable verificable de esta tarea es que compile**

`packages/contracts` no tiene vitest, asi que todavia no hay ninguna prueba que escribir aqui: su comprobacion es que el paquete **construye** y que el resto del monorepo **sigue compilando** contra el contrato nuevo. Las pruebas de comportamiento de estas funciones llegan en la Tarea 5, que es donde vive el codigo que las usa.

- [ ] **Paso 2: crear `packages/contracts/src/board.ts`**

Tres firmas y una decision:

```ts
import { z } from 'zod';

import { ITEM_ICON_COLORS } from './item-icons.js';

/** Un tablero tiene estados de uno a este numero, y el limite sale de aqui. */
export const MAX_BOARD_STATES = 24;

export const boardStateSchema = z.object({
  id: z.string().min(1).max(36),
  title: z.string().trim().min(1).max(40),
  color: z.enum(ITEM_ICON_COLORS),
});
export type BoardState = z.infer<typeof boardStateSchema>;

export const boardStatesSchema = z.array(boardStateSchema).max(MAX_BOARD_STATES);
export type BoardStates = z.infer<typeof boardStatesSchema>;

/** El id del primer estado, que es donde cae una tarea sin estado. `null` si no hay. */
export function firstStateId(states: BoardStates): string | null;

/**
 * El estado de una tarea.
 *
 * Un `stateId` nulo **y** un `stateId` que no esta en la lista devuelven el
 * primero. No son la misma situacion —la primera es normal y la segunda llega de
 * otro dispositivo que borro el estado— pero se pintan igual y no hay ninguna
 * forma honesta de distinguirlas en la fila.
 *
 * Si esto devuelve `null` para un id desconocido en vez de devolver el primero,
 * las tareas desaparecen del tablero sin que nada falle. Por eso lleva cuerpo.
 */
export function stateOf(
  states: BoardStates,
  stateId: string | null | undefined,
): BoardState | null {
  if (states.length === 0) return null;
  if (stateId !== null && stateId !== undefined) {
    const found = states.find((state) => state.id === stateId);
    if (found) return found;
  }
  return states[0] ?? null;
}

/**
 * El invariante: el `stateId` de una tarea es nulo, o uno de la lista.
 *
 * `null` es valido siempre y significa "el primero". Un id desconocido es
 * invalido, y esa es la comprobacion que el servidor hace al escribir.
 */
export function isKnownStateId(
  states: BoardStates,
  stateId: string | null | undefined,
): boolean;
```

`firstStateId` es `states[0]?.id ?? null`. `isKnownStateId` es `true` con `null` o `undefined`, y si no `states.some(...)`. Los dos son de una linea y sus cuerpos estan determinados por sus firmas; `stateOf` no, y por eso lleva el suyo.

El comentario de `stateOf` explica por que un id desconocido cae en el primero. Es el punto 1 del foco de revision y no es evidente: sin el, alguien "arregla" la funcion para que un id desconocido no resuelva, y las tareas desaparecen.

- [ ] **Paso 3: anadir `'board'` al tipo de lista y el mapa de etiquetas**

En `workspace.ts:236`, anade `'board'` a `listKindSchema`, y en `listKindLabelKey` (linea 244) anade `board: "lists.kind.board",`. El mapa es `Record<ListKind, string>` con `satisfies`, asi que el compilador avisa si falta la entrada.

- [ ] **Paso 4: anadir `states` y `stateId` a los esquemas**

`listSchema` gana `states: boardStatesSchema.default([])`, con el import desde `./board.js`. `listItemSchema` gana `stateId: z.string().min(1).max(36).nullable().default(null)`.

El `.nullable().default(null)` es lo que hace que una tarea antigua, o escrita por un cliente que no sabe de estados, se lea sin romperse: es el mismo patron que ya usan `annotation` y `metadata`.

- [ ] **Paso 5: exportar el modulo**

Anade `export * from './board';` a `packages/contracts/src/index.ts`, keeping el orden alfabetico del archivo.

- [ ] **Paso 6: compilar los paquetes y pasar el typecheck**

```
cd /Users/jose/orca/workspaces/orbit-hub/Kanban && npm run build:packages && npm run typecheck
```

Expected: compila. Si falla en `apps/mobile/src/lib/lists/kind.ts` por los tres mapas exhaustivos, eso es la Tarea 8 y se deja para ahi, porque el fallo lo provoca el compilador y no se pierde nada; si falla en otro sitio, es que esta tarea ha tocado algo que no debia.

---

### Task 2: La migracion, el esquema y el campo hasta la fila

Anade las columnas y lleva el campo nuevo desde la fila de Postgres hasta el tipo
que pinta la pantalla. Las dos cosas son la misma idea: en Zod v4 un `.default()` hace
el campo **obligatorio en el tipo de salida**, asi que en cuanto `states` y `stateId`
existen en el contrato, todos los sitios que construyen un `List` o un `ListItem` a
mano tienen que decir el campo nuevo. Si esta tarea solo anadiera las columnas, el
monorepo se quedaria sin compilar y `npm run check` —que es la definicion de hecho de
`AGENTS.md`— no se podria ni mirar hasta el final.

**Ficheros:**
- Crear: `apps/api/drizzle/0021_board_states.sql` (lo escribe `db:generate`)
- Modificar: `apps/api/drizzle/meta/_journal.json` (comprobar que tiene la entrada 21)
- Modificar: `apps/api/src/db/content-schema.ts:303-344` (`lists`) y `350-395` (`listItems`)
- Modificar: `apps/api/src/db/constants.ts:52-60` (`LIST_KINDS`) y `104-145` (`SYNC_WRITABLE_FIELDS`)
- Modificar: `apps/mobile/src/hooks/use-lists.ts:681-727` (`updateItem`)
- Modificar: `apps/api/src/modules/lists/content-query-service.ts:120,171,220` (los tres mapeos fila -> contrato)
- Modificar: `apps/api/src/modules/export/export-service.ts:82,112`
- Modificar: `apps/mobile/src/lib/lists/item-record.ts:54,101` y `lib/lists/duplicate.ts:162`
- Modificar: los ocho ficheros de test con fixtures que nombra el paso 12

**Interfaces:**
- Consume: de la Task 1, `BoardStates` y `ListKind` con `'board'`.
- Produce: `lists.states` (`jsonb`, `notNull`, `default []`), `listItems.stateId` (`varchar(36)`, nullable), `ListKindName` incluyendo `'board'`, `SYNC_WRITABLE_FIELDS.list` con `'states'` y `.list_item` con `'stateId'`, **`updateItem` aceptando `stateId`**, y **el monorepo entero compilando**.

- [ ] **Paso 1: escribir el test que falla**

Anade a `apps/api/test/lists.test.ts`, en el bloque de listas:

```ts
it('los estados de un tablero se vuelven a leer tal cual', async () => {
  // El servidor NO siembra estados: el cliente los genera con
  // crypto.randomUUID() y los manda. Lo que se comprueba aqui es el viaje de
  // vuelta, no una siembra que no existe.
  const states = [
    { id: 's1', title: 'Backlog', color: 'neutral' },
    { id: 's2', title: 'Ready', color: 'blue' },
  ];
  const { list } = await createList(api, { kind: 'board', states });
  expect(list.states).toEqual(states);
});
```

El helper `createList` de ese fichero escribe por `/sync/push` porque no hay ruta REST de escritura. Si no admite `kind` ni `states`, amplialo; si ya los admite, usalo tal cual.

- [ ] **Paso 2: ejecutarlo y verlo fallar**

```
cd /Users/jose/orca/workspaces/orbit-hub/Kanban && npm run test -w @orbit-hub/api -- test/lists.test.ts
```

Expected: FAIL. `states` no existe todavia en el contrato ni en la tabla.

- [ ] **Paso 3: anadir las columnas al esquema Drizzle**

En `content-schema.ts`, dentro de `lists` y despues de `orderMode`:

```ts
states: jsonb('states').$type<BoardStates>().notNull().default([]),
```

En `listItems`, en un lugar que no rompa el orden logico de las columnas:

```ts
stateId: varchar('state_id', { length: 36 }),
```

Los dos usan `jsonb`/`varchar` importados ya en ese archivo. El tipo `$type<BoardStates>()` viene del contrato.

- [ ] **Paso 4: generar la migracion**

```
cd /Users/jose/orca/workspaces/orbit-hub/Kanban && npm run db:generate -w @orbit-hub/api
```

Expected: escribe `apps/api/drizzle/0021_*.sql`. **Comprueba el contenido:** tiene que ser exactamente

```sql
ALTER TABLE "lists" ADD COLUMN "states" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN "state_id" varchar(36);
```

Si genera mas cosas, o genera un nombre que no contenga `states`, **para**: el README de esa carpeta cuenta dos veces que `generate` salio con codigo 0 sin escribir nada. Si no escribe nada, escribe el `.sql` a mano con esas dos lineas y el `--> statement-breakpoint` de en medio, y sigue al paso 5.

- [ ] **Paso 5: comprobar el journal**

Abre `apps/api/drizzle/meta/_journal.json`. Tiene que existir una entrada con `"idx": 21`, `"version": "7"`, `"tag": "0021_<lo que sea>"`, `"breakpoints": true`, y su `when` mayor que el de 0020 (1790935154581). **Sin esta entrada la migracion no se aplica en las pruebas y el test del paso 1 sigue fallando por otra razon.** Este fichero se edita a mano si hace falta.

- [ ] **Paso 6: anadir `'board'` y los dos campos escribibles**

En `constants.ts`, `LIST_KINDS` gana `'board'`. En `SYNC_WRITABLE_FIELDS`, `'states'` al final del array de `list`, y `'stateId'` al final del de `list_item`. Actualiza el comentario de `SYNC_WRITABLE_FIELDS` para nombrar los dos campos, porque ese comentario es la unica defensa que tiene el siguiente que llega.

- [ ] **Paso 7: `updateItem` acepta `stateId`**

En `apps/mobile/src/hooks/use-lists.ts:681`, anade `stateId?: string | null;` al tipo de `changes`. **Firmate en la firma, no en el cuerpo**: la que se llama es `updateItem(item, changes)`, con la fila entera y no su id, y todo el plan llama asi. Sin esto el tablero no puede mover una tarea y no hay ninguna prueba que lo delate, porque el resto de la app no escribe ese campo.

- [ ] **Paso 8: la lectura, de la fila al contrato**

En `apps/api/src/modules/lists/content-query-service.ts` hay **tres** mapeos de fila a
contrato y los tres necesitan el campo: el de `listLists` (~120), el de `getList`
(~171) y el de la busqueda (~220). Los dos primeros anaden `states: row.states` y el
tercero `stateId: row.stateId`.

Este fichero no lo toca ninguna otra tarea del plan, y sin el no hay forma de que un
estado llegue nunca a la pantalla.

- [ ] **Paso 9: los literales de la exportacion**

`apps/api/src/modules/export/export-service.ts:82,112` construye `List` y `ListItem` a
mano para el sobre de exportacion. Anade `states` y `stateId`. El JSON de una lista sin
estados sale con `states: []`, que es lo que el contrato dice de una fila que no los
tiene.

- [ ] **Paso 10: los constructores del cliente**

`apps/mobile/src/lib/lists/item-record.ts` tiene el sitio donde se construye una fila
para escribir, y su comentario ya avisa de que *"el campo que falta es el ultimo que se
anochio"*. Anade `stateId` en `newListItem` y su tipo de entrada, y `states` donde se
construye una lista.

`apps/mobile/src/lib/lists/duplicate.ts:162` propaga `stateId` al duplicar una tarea.
**Si no se propaga, duplicar una tarea en Ready la deja en el primer estado**, y es un
fallo silencioso: la duplicada aparece, y en la columna equivocada.

- [ ] **Paso 11: `newListItem` acepta un estado**

`NewListItemInput` gana `stateId?: string | null`, para que crear una tarea en un
tablero siga siendo el mismo camino que crearla en cualquier otra lista. El tablero no
lo usa todavia —crea siempre en el primero— pero el campo tiene que existir ya, porque
anadirlo despues es volver a romper los quince sitios.

- [ ] **Paso 12: las fixtures de los tests**

Ocho ficheros. Los que declaran el campo como opcional (`stateId?: string | null`) y el
tipo de salida lo exige presente: `apps/mobile/test/done-match.test.ts`,
`item-presentation.test.ts`, `media-card.test.ts`, `media-filter.test.ts`,
`provider-ref.test.ts` y `pin.test.ts` (este con `states: []`). Y en la API,
`apps/api/test/export-builders.test.ts`.

**Ojo con `export-builders.test.ts`: la Task 5 vuelve a tocarlo.** Anade solo la fixture
y deja las cinco aserciones que cuentan columnas como estan.

- [ ] **Paso 13: el typecheck entero, en verde**

```
cd /Users/jose/orca/workspaces/orbit-hub/Kanban && npm run build:packages && npm run typecheck
```

Expected: **todo pasa.** Los unicos dos fallos que se permiten son los de
`apps/mobile/src/lib/lists/kind.ts` (los tres mapas exhaustivos, que son de la Task 8 y
los provoca el compilador). Cualquier otro error significa que queda un sitio por
propagar.

- [ ] **Paso 14: pasar los tests de los ficheros tocados**

```
cd /Users/jose/orca/workspaces/orbit-hub/Kanban && npm run test -w @orbit-hub/api && npm run test -w @orbit-hub/mobile
```

Expected: PASS los dos. La API levanta PGlite con la migracion 0021 ya aplicada, asi que
esto tambien comprueba que el SQL de la migracion es valido de verdad y no solo que
TypeScript lo acepta.

---

### Task 3: El invariante en el servidor

Esta es la tarea que hace que un tablero no pueda quedar corrupto, y la que evita que el proximo que anada un campo repita la cicatriz.

**Ficheros:**
- Modificar: `apps/api/src/modules/sync/sync-service.ts:466-476` (`workspaceOfListItem`), `:580-606` (`case 'list_item'` en el create) y `:706-709` (el bloque de `assertCanWrite` del update)
- Test: `apps/api/test/lists.test.ts`

**Interfaces:**
- Consume: `isKnownStateId(states, stateId)` de `@orbit-hub/contracts` (tarea 1), `BoardStates`.
- Produce: nada nuevo hacia adelante. El servidor rechaza con `HttpError.validation`.

- [ ] **Paso 1: escribir el test que falla**

Anade a `apps/api/test/lists.test.ts`, en el bloque de `list_item`:

```ts
it('rechaza una tarea que apunta a un estado que su lista no tiene', async () => {
  // El servidor no puede dejar una tarea en un limbo que ninguna pantalla sabe
  // pintar, y el rechazo tiene que ser un rechazo: no un applied que no cambio
  // nada, que es la cicatriz de SYNC_WRITABLE_FIELDS.
  await expect(
    sync(api, { kind: 'create', entity: 'list_item', payload: {
      listId, title: 'Huerfana', stateId: 'no-existe',
    }}),
  ).rejects.toThrow(/estado/i);
});
```

- [ ] **Paso 2: ejecutarlo y verlo fallar**

```
cd /Users/jose/orca/workspaces/orbit-hub/Kanban && npm run test -w @orbit-hub/api -- test/lists.test.ts
```

Expected: FAIL, porque hoy se acepta cualquier `stateId`.

- [ ] **Paso 3: exponer la lista, no solo su workspace**

Hoy `workspaceOfListItem` (linea 466) hace `findEntity('list', listId)` y **solo devuelve el `workspaceId`**, tirando la fila entera. Para validar el estado hace falta el array, y la fila ya esta en memoria: no hace falta una segunda consulta.

Sustituye ese metodo por dos:

```ts
/** La lista a la que pertenece una fila. `null` si la fila no dice cual es. */
private async listOfItem(item: StoredEntity): Promise<StoredEntity | null> {
  const listId = item['listId'] as string | null;
  if (!listId) return null;
  const list = await syncRepository.findEntity('list', listId);
  if (!list) throw HttpError.notFound('List not found');
  return list;
}

/** El espacio al que pertenece una fila, leido de la fila que ya tiene. */
private async workspaceOfListItem(item: StoredEntity, userId: string): Promise<string | null> {
  const list = await this.listOfItem(item);
  if (list === null) return null;
  void userId;
  return (list['workspaceId'] as string | null) ?? null;
}
```

Mismo comportamiento, misma consulta. El `void userId` estaba ya y se conserva.

- [ ] **Paso 4: rechazar en el create**

En `case 'list_item'` (linea 580), la fila `owner` **ya esta** cargada por el `findEntity` que hace para traducir el workspace. Immediately despues del `assertCanWrite`, antes del `insertEntity`:

```ts
const states = (owner['states'] as BoardStates) ?? [];
const stateId = (payload['stateId'] as string | null) ?? null;
if (!isKnownStateId(states, stateId)) {
  throw HttpError.validation('An item needs a state its list has');
}
```

- [ ] **Paso 5: rechazar en el update**

En el bloque `else if (entity === 'list_item')` del update (linea 706). Sanitiza **una sola vez** y guarda el resultado, porque el `payload` crudo trae campos que no son escribibles y hay que mirar los mismos que se van a escribir:

```ts
} else if (entity === 'list_item') {
  const list = await this.listOfItem(existing);
  await this.assertCanWrite((list?.['workspaceId'] as string | null) ?? null, userId, {
    nodeType: 'list_item',
    nodeId: operation.entityId,
  });

  const limpio = sanitisePayload('list_item', operation.payload);
  if ('stateId' in limpio) {
    const states = (list?.['states'] as BoardStates) ?? [];
    if (!isKnownStateId(states, (limpio['stateId'] as string | null) ?? null)) {
      throw HttpError.validation('An item needs a state its list has');
    }
  }
}
```

La guarda `'stateId' in limpio` importa: un update que no toca el estado **no se invalida** porque otro dispositivo haya borrado ese estado. Solo se comprueba cuando el campo viene en el payload, y se comprueba ya sanitizado, no en crudo.

- [ ] **Paso 6: pasar el test**

```
cd /Users/jose/orca/workspaces/orbit-hub/Kanban && npm run test -w @orbit-hub/api -- test/lists.test.ts
```

Expected: PASS.

---

### Task 4: La exportacion

**Ficheros:**
- Modificar: `packages/contracts/src/export.ts` (al final, junto a `LIST_EXPORT_CSV_COLUMNS`)
- Modificar: `apps/api/src/modules/export/export-builders.ts:125-150`
- Test: `apps/api/test/export-builders.test.ts`

**Interfaces:**
- Consume: `ListKind` del contrato.
- Produce: `BOARD_EXPORT_CSV_COLUMNS`, `exportCsvColumnsFor(kind)`.

**`LIST_EXPORT_CSV_COLUMNS` no se toca.** Esta fijada en cinco aserciones de dos ficheros (`export.test.ts:572,587` y `export-builders.test.ts:376,503,520,548`, una de ellas `toHaveLength(15)` y otra con el comentario *"year es la columna 9"*). Convertirla en funcion las rompe todas. Se **anade** una funcion al lado.

- [ ] **Paso 1: escribir el test que falla**

En `apps/api/test/export-builders.test.ts`:

```ts
it('el CSV de un tablero lleva estado y no completado', () => {
  expect(exportCsvColumnsFor('board')).toBe(BOARD_EXPORT_CSV_COLUMNS);
  expect(exportCsvColumnsFor('board')).not.toContain('completado');
  expect(exportCsvColumnsFor('tasks')).toBe(LIST_EXPORT_CSV_COLUMNS);
  // Y el estado ocupa el sitio que ocupaba completado, para que las demas
  // columnas no se muevan y el indice de year siga siendo el mismo.
  expect(BOARD_EXPORT_CSV_COLUMNS.indexOf('estado')).toBe(
    LIST_EXPORT_CSV_COLUMNS.indexOf('completado'),
  );
  expect(BOARD_EXPORT_CSV_COLUMNS).toHaveLength(LIST_EXPORT_CSV_COLUMNS.length);
});
```

- [ ] **Paso 2: ejecutarlo y verlo fallar**

```
cd /Users/jose/orca/workspaces/orbit-hub/Kanban && npm run test -w @orbit-hub/api -- test/export-builders.test.ts
```

Expected: FAIL, no existen los dos simbolos.

- [ ] **Paso 3: las columnas del tablero**

En `packages/contracts/src/export.ts`, despues de `LIST_EXPORT_CSV_COLUMNS`: copia las quince columnas y cambia `completado` por `estado` en la posicion 3. Mismo orden, mismo numero.

```ts
export const BOARD_EXPORT_CSV_COLUMNS = [
  'id', 'titulo', 'tipo', 'estado', 'prioridad', 'tags', 'posicion', 'anotacion',
  'year', 'release_date', 'image_url', 'provider', 'external_id',
  'created_at', 'updated_at',
] as const;

/** Las columnas de un CSV de items, segun el tipo de lista. */
export function exportCsvColumnsFor(kind: ListKind): readonly string[] {
  return kind === 'board' ? BOARD_EXPORT_CSV_COLUMNS : LIST_EXPORT_CSV_COLUMNS;
}
```

El comentario explica por que `estado` va donde iba `completado` y no al final: porque asi `year` sigue en el indice 8 y las cinco aserciones existentes, y el comentario que las explica, siguen siendo ciertas.

- [ ] **Paso 4: el builder usa la funcion y resuelve el titulo**

`itemsToCsv` (linea 125) cambia la cabecera a `exportCsvColumnsFor(args.list.kind).join(';')`. En `itemToCsvRow`, la celda que hoy es `String(item.completed)` pasa a ser:

```ts
list.kind === 'board' ? csvStateCell(list, item) : String(item.completed),
```

Y una funcion nueva junto a `metadataCell`:

```ts
/**
 * La celda del estado: el titulo del estado al que pertenece la tarea.
 *
 * Una tarea sin estado, o con un estado que ya no existe, cae en el primero, que
 * es lo mismo que hace la pantalla. Escribir el id en vez del titulo haria que
 * el CSV no significara nada para quien lo abre.
 */
export function csvStateCell(list: List, item: ListItem): string {
  return stateOf(list.states, item.stateId)?.title ?? '';
}
```

Usa `stateOf` del contrato. Si `List.states` llega `undefined` desde una fila antigua, `stateOf([] , …)` devuelve `null` y la celda queda vacia, que es el resultado correcto.

- [ ] **Paso 5: pasar los dos ficheros de test**

```
cd /Users/jose/orca/workspaces/orbit-hub/Kanban && npm run test -w @orbit-hub/api -- test/export-builders.test.ts test/export.test.ts
```

Expected: PASS los dos, **sin tocar ninguna de las cinco aserciones existentes**.

---

### Task 5: La logica pura del tablero

Todo el comportamiento del tablero que se puede probar de verdad va aqui, como funciones puras. Es la tarea mas grande del lado movil y la que mas pruebas lleva.

**Ficheros:**
- Crear: `apps/mobile/src/lib/lists/board.ts`
- Crear: `apps/mobile/test/board.test.ts`

**Interfaces:**
- Consume: `BoardState`, `BoardStates`, `MAX_BOARD_STATES`, `stateOf` del contrato (tarea 1); `ListItem`.
- Produce: `defaultStates()`, `newState()`, `tasksInState()`, `countInState()`, `renumberWithinState()`, `moveState()`, `editState()`, `removeState()`, `canDeleteState()`. La pantalla (tareas 8-14) solo usa estos nombres.

- [ ] **Paso 1: escribir el test que falla**

`apps/mobile/test/board.test.ts`. Sigue el estilo del repo: vitest con `globals: true`, helpers locales para construir un `ListItem` minimo, y un comentario en cada `describe` que explique **por que** ese caso importa.

```ts
describe('una tarea sin estado cae en el primero', () => {
  it('null y un id que no existe se pintan en el primero', () => {
    // El caso de un id que no existe no es teoria: otro dispositivo borro el
    // estado y el pull lo trae. Si esto devuelve null en vez del primero, las
    // tareas desaparecen del tablero sin avisar.
    const states = defaultStates();
    const item = itemDe({ stateId: null });
    expect(stateOf(states, item.stateId)?.id).toBe(states[0].id);
    expect(stateOf(states, 'borrado-en-otro-dispositivo')?.id).toBe(states[0].id);
  });
});
```

Y el caso 3 del foco de revision:

```ts
describe('contar incluye las nulas cuando el estado es el primero', () => {
  it('sin esto, borrar el primero las haria saltar solas', () => {
    const states = defaultStates();
    const items = [itemDe({ stateId: null }), itemDe({ stateId: states[1].id })];
    // El primero se lleva las nulas; el segundo solo las suyas.
    expect(countInState(items, states, states[0].id)).toBe(1);
    expect(countInState(items, states, states[1].id)).toBe(1);
  });
});
```

Los cinco focos de esta tarea: los tres de arriba mas el reordenado y el borrado. Cubre tambien `defaultStates()` devolviendo cuatro estados con ids distintos y los cuatro colores del spec (gris, azul, ambar, verde de `ITEM_ICON_COLORS`: `neutral`, `blue`, `amber`, `green`); `newState()` devuelve `null` al llegar a `MAX_BOARD_STATES` y coloca el nuevo al final; `tasksInState()` ordena por `position` y luego por `createdAt`, el mismo criterio que `useListItems`; `renumberWithinState()` devuelve `Map<string, number>` solo con las tareas de ese estado, numeradas `0..n-1`, y **no toca las de los otros estados**; `moveState()` mueve dentro del array y devuelve el mismo array si el destino esta fuera de rango; `editState()` conserva el `id` cuando cambia el titulo o el color, que es el invariante que hace que renombrar no mueva cuarenta tareas; `canDeleteState()` es `false` con un solo estado.

- [ ] **Paso 2: ejecutarlo y verlo fallar**

```
cd /Users/jose/orca/workspaces/orbit-hub/Kanban && npm run test -w @orbit-hub/mobile -- test/board.test.ts
```

Expected: FAIL, el modulo no existe.

- [ ] **Paso 3: `defaultStates`, `newState`, `tasksInState`, `countInState`**

`defaultStates()` devuelve los cuatro del spec con `crypto.randomUUID()`, en ese orden y con esos colores. El comentario dice que el orden es el de las columnas y por eso es un array y no un objeto.

`newState(states, title): BoardState | null` devuelve `null` si `states.length >= MAX_BOARD_STATES`, si no el estado nuevo con id de `crypto.randomUUID()`, color `neutral` y **al final**.

**Las dos funciones de filtrado reciben `states`, no solo el id:**

```ts
export function tasksInState(
  items: ListItem[],
  states: BoardStates,
  stateId: string | null,
): ListItem[];

export function countInState(
  items: ListItem[],
  states: BoardStates,
  stateId: string | null,
): number;
```

Filtran comparando contra `stateOf(states, item.stateId).id` en vez de contra `item.stateId`. Es la unica forma de que las dos reglas —"null es el primero" e "id desconocido es el primero"— no puedan contradecirse: si compararan contra `item.stateId`, una tarea huerfana **no apareceria en ninguna columna**, que es el fallo 1 del foco de revision convertido en pantalla vacia.

- [ ] **Paso 4: `renumberWithinState`, `moveState`, `editState`, `removeState`, `canDeleteState`**

`renumberWithinState(items, stateId): Map<string, number>` devuelve **solo** las tareas de ese estado, renumeradas `0..n-1` en su orden actual. No devuelve un array de items: devuelve el mapa de cambios, porque quien lo llama lo que quiere es saber que `position` escribe en cada fila.

`canDeleteState(states, index): boolean` es `states.length > 1 && index >= 0 && index < states.length`.

- [ ] **Paso 5: pasar el test**

```
cd /Users/jose/orca/workspaces/orbit-hub/Kanban && npm run test -w @orbit-hub/mobile -- test/board.test.ts
```

Expected: PASS.

---

### Task 6: `routeForList` y el registro de la ruta

**Ficheros:**
- Crear: `apps/mobile/src/lib/lists/route.ts`
- Crear: `apps/mobile/test/board-route.test.ts`
- Modificar: `apps/mobile/src/app/(app)/_layout.tsx` (registrar la pantalla)
- Crear (vacio, el cuerpo llega en la tarea 8): `apps/mobile/src/app/(app)/board/[listId].tsx`

**Interfaces:**
- Consume: `ListKind`.
- Produce: `routeForList(list): string`.

- [ ] **Paso 1: escribir el test que falla**

```ts
describe('una lista se abre en la pantalla que le toca', () => {
  it('un tablero va a /board y todo lo demas a /list', () => {
    // Hoy hay varios sitios que escriben `/list/${id}` a mano. Con un kind mas,
    // el que se quede sin cambiar enseña la pantalla equivocada en silencio.
    expect(routeForList({ id: 'a', kind: 'board' })).toBe('/board/a');
    expect(routeForList({ id: 'a', kind: 'tasks' })).toBe('/list/a');
    expect(routeForList({ id: 'a', kind: 'movies' })).toBe('/list/a');
    expect(routeForList(null)).toBe('/lists');
  });
});
```

- [ ] **Paso 2: ejecutarlo y verlo fallar**

```
cd /Users/jose/orca/workspaces/orbit-hub/Kanban && npm run test -w @orbit-hub/mobile -- test/board-route.test.ts
```

Expected: FAIL.

- [ ] **Paso 3: la funcion**

```ts
/**
 * La ruta de una lista, segun su tipo.
 *
 * Un tablero se abre en `/board` y el resto en `/list`. Esta es la unica fuente
 * de esa regla: en cuanto haya dos sitios, uno se queda sin cambiar.
 */
export function routeForList(
  list: Pick<List, 'id' | 'kind'> | null | undefined,
): string {
  if (!list) return '/lists';
  return list.kind === 'board' ? `/board/${list.id}` : `/list/${list.id}`;
}
```

- [ ] **Paso 4: que todo el mundo pase por aqui**

Esta funcion no sirve de nada si solo la usa un sitio. Busca cada `` `/list/${ `` que exista en `apps/mobile/src` y cambialo por `routeForList(...)`. Como minimo estan los enlaces de la pantalla de listas, el cajon, la lista de listas y los resultados de busqueda.

Justo lo contrario: uno de esos enlaces sin cambiar **no falla**, enseña la pantalla de tareas de un tablero, que se parece lo suficiente para no ser obviamente rota. Por eso es un paso con su propio sitio y no una nota al final.

- [ ] **Paso 5: registrar la pantalla en el layout**

En `app/(app)/_layout.tsx`, anade `<Stack.Screen name="board/[listId]" .../>` con las mismas opciones que las demas pantallas de contenido, incluida su entrada en el drawer si la hay. **Una ruta que no se declara aqui se queda sin titulo**, que es como se encuentra el bug.

- [ ] **Paso 6: pasar el test y el typecheck**

```
cd /Users/jose/orca/workspaces/orbit-hub/Kanban && npm run test -w @orbit-hub/mobile -- test/board-route.test.ts && npm run typecheck
```

Expected: PASS. El typecheck falla porque la pantalla nueva esta vacia: ponle un `export default function BoardScreen() { return null; }` valido para esta tarea.

---

### Task 7: Extraer `TaskRow` y arreglar el test de fuente

Esta tarea no añade nada al tablero. Deshace un riesgo: la `TaskRow` vive dentro de `list/[listId].tsx`, un fichero de 1240 lineas, y el tablero necesita la misma fila sin casilla. Copiarla es una fila de mas que se va a desincronizar; importarla desde un fichero de ruta es peor.

**Ficheros:**
- Crear: `apps/mobile/src/components/lists/task-row.tsx`
- Modificar: `apps/mobile/src/app/(app)/list/[listId].tsx` (quitar la `TaskRow` local, importarla)
- Modificar: `apps/mobile/test/task-row-layout.test.ts`

**Interfaces:**
- Consume: `ListItem`, `TagColors`, `ItemIcon`, `Badge`, `TagChip`, `useLongPressText`, `useA11yHint`, `Checkbox`, `AppText`, `useTheme`.
- Produce:
```ts
export function TaskRow(props: {
  item: ListItem;
  tagColors: TagColors;
  onToggle?: () => void;      // sin esta prop no se dibuja la casilla
  onEdit: () => void;
  onIcon: () => void;
  edgeColor?: string;         // el filo de color del estado, en un tablero
}): JSX.Element;
```

- [ ] **Paso 1: ver el test que hay, y leerlo antes de tocar nada**

```
cd /Users/jose/orca/workspaces/orbit-hub/Kanban && npm run test -w @orbit-hub/mobile -- test/task-row-layout.test.ts
```

Expected: PASS. Este test **lee el texto fuente de `list/[listId].tsx`** y afirma sobre cadenas de dentro: `metaTag: {`, `flexShrink: 1`, y `{item.priority !== "none" || item.tags.length > 0 ? (`. Si mueves la fila y no lo arreglas, falla por una razon que no tiene nada que ver con lo que has cambiado.

- [ ] **Paso 2: mover el componente tal cual**

Copia el bloque `function TaskRow` de `list/[listId].tsx:833-1059` al fichero nuevo, con sus estilos y sus comentarios **intactos**. Los comentarios de `styles.nombre` y `styles.titulo` explican cosas medidas en un build de Android y son la razon por la que ese codigo es como es; moverlos es mover la explicacion con el codigo, que es lo que hay que hacer.

No cambies el JSX en esta tarea. La casilla se vuelve opcional en el paso 4.

- [ ] **Paso 3: sustituir el uso en la pantalla de listas**

En `list/[listId].tsx`, quita el bloque local, importa de `@/components/lists/task-row`, y pasa `onToggle={...}` en los dos sitios que ya lo pasan.

- [ ] **Paso 4: la casilla pasa a ser opcional**

En el componente, envuelve la casilla en `onToggle ? (<Checkbox checked={item.completed} onToggle={onToggle} label="" />) : null`. **El `label=""` no se toca**: hay un test que vigila que un `Checkbox` sin etiqueta no se dibuja, y en un tablero no hay casilla queuing.

El `edgeColor` se pinta como un `borderLeftWidth`/`borderLeftColor` en `styles.item` **solo cuando viene**. En la pantalla de listas no se pasa y la fila se queda igual.

- [ ] **Paso 5: apuntar el test al fichero nuevo**

En `task-row-layout.test.ts`, anade `const taskRow = src('src/components/lists/task-row.tsx');` y mueve ahi las cuatro aserciones que le tocan: `metaTag: {`, `flexShrink: 1`, el condicional de la segunda linea, y `not.toContain('dragHandle')`. **Las de `checkbox`, `badge`, `appHeader`, `screen` y `spaceBand` no se mueven**: apuntan a componentes que no cambian.

- [ ] **Paso 6: pasar el test y el typecheck**

```
cd /Users/jose/orca/workspaces/orbit-hub/Kanban && npm run test -w @orbit-hub/mobile -- test/task-row-layout.test.ts && npm run typecheck
```

Expected: PASS los dos.

---

### Task 8: La pantalla, sin gesto todavia

**Ficheros:**
- Modificar: `apps/mobile/src/app/(app)/board/[listId].tsx`
- Crear: `apps/mobile/src/components/lists/board-tabs.tsx`
- Crear: `apps/mobile/src/components/lists/board-column.tsx`
- Modificar: `apps/mobile/src/lib/lists/kind.ts` (los tres mapas)
- Modificar: `apps/mobile/src/lib/i18n/dictionaries.ts` (los dos diccionarios)
- Modificar: `apps/mobile/src/app/(app)/lists.tsx` (el formulario de lista nueva)
- Modificar: `apps/mobile/src/app/(app)/list/[listId].tsx` (la redireccion)

**Interfaces:**
- Consume: `useLists()`, `useListItems(listId)`, `Screen`, `ListControls`, `TaskRow`, `defaultStates`, `tasksInState`, `countInState`, `stateOf`, `routeForList`.
- Produce:
```ts
export function BoardTabs(props: {
  states: BoardStates;
  counts: Map<string, number>;
  currentId: string | null;
  onSelect(id: string): void;
}): JSX.Element;

export function BoardColumn(props: {
  state: BoardState;
  tasks: ListItem[];
  tagColors: TagColors;
  readOnly: boolean;
  onOpenTask(item: ListItem): void;
  onOpenIcon(item: ListItem): void;
}): JSX.Element;
```

- [ ] **Paso 1: hacer que el compilador senale lo que falta**

```
cd /Users/jose/orca/workspaces/orbit-hub/Kanban && npm run typecheck
```

Expected: FAIL en `lib/lists/kind.ts` y en `contracts/src/workspace.ts` (si la tarea 1 no lo hizo). Los tres mapas de `kind.ts` son `Record<ListKind, …>` y el compilador los señala uno a uno.

- [ ] **Paso 2: los tres mapas y los dos diccionarios**

En `kind.ts`: `LIST_KIND_ICON.board` con un icono de `Ionicons.glyphMap` que ya exista en el set; `LIST_KIND_LABEL.board` con la clave `lists.kind.board`; `LIST_KIND_ORDER` con `'board'` **despues de `'tasks'`**, porque un tablero es una lista de tareas con estados y va al lado. En `dictionaries.ts`, `lists.kind.board` en las dos tablas (la de las lineas ~937 y la de las ~1910), con el texto que toque en cada idioma.

- [ ] **Paso 3: `board-tabs.tsx`**

Un `ScrollView` horizontal con una pastilla por estado: punto de color, titulo y contador. La pastilla activa se dibuja con el color de texto del tema, no con el color del estado, porque el color de la pastilla no llega a 4.5:1 en todos los casos — es el mismo problema que documento el spec de color de etiqueta. Accepta `onSelect` y `currentId`. Cuando el estado actual no cabe en pantalla, hace `scrollTo` para centrarlo.

- [ ] **Paso 4: `board-column.tsx`**

Cabecera con punto, nombre y contador; despues las `TaskRow` de `tasks` **sin `onToggle`** y con `edgeColor={state.color}`; y si no hay ninguna, un `EmptyState` con el texto de "sin tareas". El separador entre columnas es `theme.spacing.md`, su borde `theme.colors.border`, su relleno `theme.colors.surfaceMuted`. Nada escrito a mano.

- [ ] **Paso 5: la pantalla**

`BoardScreen()` lee `listId` de `useLocalSearchParams`, saca la lista de `useLists()` y los items de `useListItems(listId)`, calcula `states` y `counts` con las funciones puras de la tarea 5 envueltas en `useMemo`, y monta `Screen` con `Scroll` horizontal y un `BoardTabs` arriba. Si `kind !== 'board'`, hace `router.replace(routeForList(list))`.

**La pista usa `pagingEnabled`, no `snapToInterval`.** En web, react-native-web 0.21 no implementa `snapToInterval` y solo implementa `pagingEnabled` como scroll-snap; el carrusel vertical de medios ya dejo el motivo escrito en su codigo, y por eso el ancho de columna **no** puede venir de un `snapToInterval`.

- [ ] **Paso 6: el ancho, y por que son dos comportamientos y no dos pantallas**

Un `onLayout` mide el ancho y hay un solo umbral:

- **por debajo de ~720 pt**: un estado a pantalla completa, uno visible;
- **por encima**: cada columna mide `Math.max(230, ancho / cuantosCaben)` y se reparten; si no caben todas hay scroll horizontal con anclaje.

Se eligio la columna estrecha de ~230 pt y no la ancha de ~320 porque caben cinco o seis estados de golpe, que es lo que hace legible un tablero de un vistazo. Y se eligio **una sola pantalla** y no dos porque dos pantallas significan dos listas de cosas que se rompen por separado, y el ancho ya decide solo.

La tira de pestañas **se queda en los dos casos**: en web ancha sigue siendo el salto rapido a un estado que no se ve.

- [ ] **Paso 7: crear un tablero**

Sin esto no hay nada que abrir, y el resto de la tarea no se puede comprobar en un navegador.

En el formulario de lista nueva, `'board'` aparece en el selector de tipo con su icono y su etiqueta (ya anadidos en el paso 2). Cuando `kind === 'board'`, el payload de creacion lleva `states: defaultStates()` y el `orderMode: 'manual'`. **La siembra es del cliente, nunca del servidor**: los ids los genera `crypto.randomUUID()` y el servidor guarda lo que llega sin inventar nada.

`defaultStates()` se llama en el momento de crear, no antes, para que los ids sean nuevos cada vez y dos tableros no compartan estados.

- [ ] **Paso 8: la redireccion desde la pantalla de listas**

En `list/[listId].tsx`, despues de resolver la lista, si `list.kind === 'board'` hace `router.replace(`/board/${listId}`)` y devuelve `null` mientras tanto. Es lo que evita que un enlace viejo enseñe la pantalla de tareas de un tablero.

- [ ] **Paso 9: comprobarlo en un navegador**

```
cd /Users/jose/orca/workspaces/orbit-hub/Kanban && npm run web
```

Abre un tablero en claro y en oscuro y anota en el terminal **lo que ves y que se rompio**. Segun `docs/verificacion-en-navegador.md`, esto no se sustituye con ninguna suposicion.

---

### Task 9: El gesto de swipe

**Ficheros:**
- Modificar: `apps/mobile/src/app/(app)/board/[listId].tsx`
- Crear: `apps/mobile/src/lib/lists/board-paging.ts`
- Crear: `apps/mobile/test/board-paging.test.ts`

**Interfaces:**
- Consume: los gestos de `components/dashboard/panel-grid.tsx`.
- Produce: `nextPageFor(offset: number, velocity: number, count: number, current: number): number`, puro y probado.

- [ ] **Paso 1: escribir el test que falla**

```ts
describe('a donde cae la pagina', () => {
  it('un arrastre corto y lento no cambia de pagina', () => {
    // Si un toque corto moviera de columna, tocar una tarjeta en el borde
    // llevaria a otra columna y nadie sabria por que.
    expect(nextPageFor(-20, -60, 4, 1)).toBe(1);
  });
  it('un arrastre largo o rapido avanza una sola vez', () => {
    expect(nextPageFor(-140, 0, 4, 1)).toBe(2);
    expect(nextPageFor(-20, -600, 4, 1)).toBe(2);
    // Y nunca mas de una, aunque el arrastre sea enorme.
    expect(nextPageFor(-900, -2000, 4, 1)).toBe(2);
  });
  it('no se sale por los extremos', () => {
    expect(nextPageFor(-900, 0, 4, 3)).toBe(3);
    expect(nextPageFor(900, 0, 4, 0)).toBe(0);
  });
});
```

Los tres casos se cognizcan de `panel-grid.tsx`: `SWIPE_DISTANCE = 56`, `SWIPE_VELOCITY = 420`. La funcion los recibe como parametros con esos valores por defecto.

- [ ] **Paso 2: ejecutarlo y verlo fallar**

```
cd /Users/jose/orca/workspaces/orbit-hub/Kanban && npm run test -w @orbit-hub/mobile -- test/board-paging.test.ts
```

Expected: FAIL.

- [ ] **Paso 3: la funcion pura**

```ts
/**
 * A que pagina cae un arrastre.
 *
 * `advancePage` es lo que decide el `PanelGrid` del panel y sus numeros estan
 * medidos, no inventados: 56 puntos de distancia o 420 de velocidad bastan para
 * cambiar de pagina. Se repite aqui con los mismos porque es el mismo gesto
 * haciendo lo mismo.
 */
export function nextPageFor(
  offset: number,
  velocity: number,
  count: number,
  current: number,
  distance = 56,
  minVelocity = 420,
): number {
  const passed =
    Math.abs(offset) >= distance || Math.abs(velocity) >= minVelocity;
  const step = passed ? Math.sign(offset || velocity) : 0;
  return Math.max(0, Math.min(count - 1, current + step));
}
```

- [ ] **Paso 4: el gesto en la pantalla**

Copia el patron de `panel-grid.tsx:1473-1530` tal cual: `Gesture.Pan().activeOffsetX([-14, 14]).failOffsetY([-12, 12])`, un `trackX` compartido con `useSharedValue`, `translateX` derivado, `runOnJS` al soltar y `withTiming` para asentar. `failOffsetY` es lo que reserva el vertical para reordenar tareas.

- [ ] **Paso 5: el paralaje de las pestañas**

`BoardTabs` **gana una prop nueva**, `progress: number` en 0..1, y con ella el desplazamiento del contenido a `progress * anchoDeLasPestanas * 0.35`. El factor 0.35 es el que hace que el paralaje se note sin marear.

La idea es la de `components/ui/media-carousel.tsx`: se ve por donde vas antes de llegar. El progreso sale del mismo gesto, del `trackX` dividido por el ancho de la pagina.

- [ ] **Paso 6: comprobarlo en un navegador, con dedo y con trackpad**

Un swipe corto **no** cambia de columna; uno largo cambia **una** columna, ni una mas; en el primer y en el ultimo estado no hay nada fuera. Y las pestañas se mueven mientras deslizas.

Comprueba los tres en el navegador con el dedo **y con el raton**: el gesto es el mismo pero el arrastre con trackpad llega con velocidades distintas, y un umbral de velocidad afinado solo para el dedo puede quedar en el sitio equivocado en web.

---

### Task 10: La hoja de estado

**Ficheros:**
- Crear: `apps/mobile/src/components/lists/state-picker-sheet.tsx`

**Interfaces:**
- Consume: `useListItems(listId).updateItem`, `addState` de la pantalla.
- Produce:
```ts
export function StatePickerSheet(props: {
  item: ListItem | null;
  states: BoardStates;
  counts: Map<string, number>;
  readOnly: boolean;
  onPick(stateId: string): void;
  onCreate(title: string): void;
  onEditStates(): void;
  onClose(): void;
}): JSX.Element;
```

- [ ] **Paso 1: montarla y abrirla**

La hoja se monta **siempre montada** con `item` a `null` cuando esta cerrada, como hace `list/[listId].tsx` con `ListMenuSheet` y su comentario explica. Una hoja que se monta al abrir y se desmonta al cerrar pierde la animacion de salida.

- [ ] **Paso 2: el contenido**

Una fila por estado: punto de color, titulo, contador. El estado actual de la tarea sale marcado arriba, con el mismo `row` pero resaltado. Abajo, el «+ Nuevo estado…» y un enlace al editor completo. Tocar un estado llama `onPick` y cierra.

`readOnly` a `true` **no monta la hoja**: es el punto 5 del foco de revision. `readOnly` sale del rol que ya estampan `useListItems` y `useLists`.

- [ ] **Paso 3: el conteo de una fila**

Cada fila muestra el contador que le pasa la pantalla, que viene de `countInState`. Ojo con el detalle: el estado actual tiene un conteo que **incluye a la propia tarea**, y moverla ahi no cambia nada. Se dibuja igual y no se corrige, porque el numero que la gente quiere es "cuantas hay en esta columna".

- [ ] **Paso 4: comprobarla en un navegador**

Toca una tarea, cambia de estado, cierra. **Comprueba que la tarea se mueve sin que desaparezca de ninguna parte**, y que moverla a la columna en la que ya estaba no encola nada. Al cerrar la app y volver, el estado tiene que seguir ahi: eso es el outbox.

---

### Task 11: El editor de estados, parte 1

**Ficheros:**
- Crear: `apps/mobile/src/components/lists/state-editor-sheet.tsx`

**Interfaces:**
- Consume: `updateList` de `useLists()`, `newState`, `editState`, `defaultStates`, `IconPickerPanel` para el color.
- Produce: `StateEditorSheet` con las props de abajo. La parte 2 (reordenar y borrar) es la tarea 12 y las **anade**, no las cambia.
```ts
export function StateEditorSheet(props: {
  list: List | null;
  states: BoardStates;
  counts: Map<string, number>;
  readOnly: boolean;
  onChange(states: BoardStates): void;
  onClose(): void;
}): JSX.Element;
```

- [ ] **Paso 1: el esqueleto y el alto de estados**

Una fila por estado con **punto, titulo y contador**, mas un «+ Anadir» abajo. **El «+ Anadir» se apaga con un texto que lo diga cuando `states.length >= MAX_BOARD_STATES`** — es el punto 4 del foco de revision, y crear un estado que el contrato rechaza despues es la peor version de este fallo: el usuario ve el estado aparecer y desaparecer.

- [ ] **Paso 2: anadir un estado**

`onChange([...states, nuevo])`. El id lo genera `crypto.randomUUID()` dentro de `newState`. **No se manda nada al servidor hasta que se cierra la hoja**: cada cambio de la hoja es un estado local, y al cerrar se llama `updateList(list, { states })` **una vez**. Editar cuatro colores seguidos es un push, no cuatro.

- [ ] **Paso 3: renombrar y colorear**

Tocar el titulo abre la hoja de edicion de ese estado —titulo y color— reutilizando el patron de `icon-picker.tsx` para la tira de colores, con los doce de `ITEM_ICON_COLORS`. Al guardar, `editState(states, id, { title })` **conserva el id**. El comentario de `board.ts` explica por que eso no se toca nunca.

- [ ] **Paso 4: la entrada desde los controles del tablero**

Registra la hoja en el mismo sitio donde `ListScreen` registra `ListMenuSheet`, con la entrada "Estados del tablero". La otra entrada es la hoja de estado (tarea 10).

- [ ] **Paso 5: comprobarla en un navegador**

Anade un estado, renombralo, cambiale el color, **cierra y vuelve a abrir el tablero**. Los cuatro cambios tienen que estar ahi. Y con 24 estados, el boton tiene que estar apagado y decirlo.

---

### Task 12: El editor de estados, parte 2

La parte que no puede perder datos. Esta tarea es la que mas se revisa.

**Ficheros:**
- Modificar: `apps/mobile/src/components/lists/state-editor-sheet.tsx`
- Crear: `apps/mobile/src/components/lists/state-delete-sheet.tsx`

**Interfaces:**
- Consume: `moveState`, `removeState`, `canDeleteState`, `countInState`, `updateList`, `updateItem`.
- Produce: `StateDeleteSheet`:
```ts
export function StateDeleteSheet(props: {
  state: BoardState | null;
  count: number;                      // cuantas tareas tiene, nulas incluidas
  others: BoardStates;                // los destinos
  counts: Map<string, number>;
  onChoose(destinationId: string): void;
  onClose(): void;
}): JSX.Element;
```

- [ ] **Paso 1: escribir el test que falta antes de codificar**

En `apps/mobile/test/board.test.ts`, un caso mas para `removeState` con tareas: la funcion no mueve tareas —eso lo hace quien la llama, porque las tareas son de otra entidad— y eso hay que dejarlo dicho en el test, porque es la parte que se puede equivocar:

```ts
it('borrar un estado no cambia el estado de las tareas', () => {
  // Mover las tareas es de quien llama: una funcion que receipta solo un array de
  // estados no puede mover filas de otra tabla, y fingirlo seria mentir.
  const states = defaultStates();
  expect(removeState(states, states[0].id)).toHaveLength(3);
});
```

- [ ] **Paso 2: el asa de arrastrar**

En cada fila, un asa a la izquierda. Es la decision que se tomo: lo rapido y lo que la gente espera, ocupando sitio en todas las filas y habiendo que acertarla en web. Al soltar, `moveState(states, from, to)` y `onChange`. **Las dos columnas de arrastre de la app no se pisan** porque la hoja tapa el tablero y solo hay una en pantalla.

- [ ] **Paso 3: el borrado de un estado vacio**

Si `count === 0`, `onChange(removeState(...))` y ya. **Sin confirmar.** Se pierde un nombre y un color.

- [ ] **Paso 4: el borrado de un estado ocupado, y el caso de las nulas**

Si `count > 0`, se abre `StateDeleteSheet`: dice cuantas hay y **pregunta a cual de los otros estados van**, cada uno con su contador. **El destino no se calcula solo**: lo elige la persona.

Al confirmar, el orden de las operaciones importa:

```ts
const destino = onChoose;                                   // la hoja devuelve el id elegido
const affected = tasksInState(items, states, state.id);      // incluye las de state_id nulo
// Primero mover, y con `stateId` explicito, nunca null.
for (const item of affected) {
  await updateItem(item, { stateId: destino });
}
// Y despues quitar el estado del array.
onChange(removeState(states, state.id));
```

**Las tareas con `state_id` nulo se mueven con el `stateId` del destino escrito a mano.** Si se dejaran como `null`, al quitar el primero pasarian a ser "el primero" del array nuevo, que es otro estado, sin que nadie lo pidiera. Es el punto 3 del foco de revision y es un fallo silencioso: la tarea aparece en otra columna y nada falla.

- [ ] **Paso 5: el ultimo estado**

`canDeleteState(states, 0)` es `false` con un solo estado, y la papelera sale **apagada con el motivo escrito**, no oculta: "no se puede borrar el ultimo estado". Sin ese bloqueo un tablero se queda sin estados y todas sus tareas apuntan a algo que no existe.

- [ ] **Paso 6: comprobarla en un navegador**

Tres pruebas, en este orden porque cada una depende de la anterior:

1. Crear tres tareas en el **primer** estado sin tocar su estado. Borrar ese estado eligiendo "Ready". **Las tres tienen que estar en Ready**, no en el nuevo primero.
2. Borrar un estado vacio: se va sin preguntar.
3. Con un solo estado, la papelera sale apagada y dice por que.

---

### Task 13: Reordenar tareas dentro de un estado

**Ficheros:**
- Modificar: `apps/mobile/src/app/(app)/board/[listId].tsx`
- Modificar: `apps/mobile/src/components/lists/board-column.tsx`

- [ ] **Paso 1: la pulsacion larga levanta la tarjeta**

`Gesture.Pan()` con un `LongPress` delante, o un `Gesture.Simultaneous` con el gesto de pagina si hace falta. Al tomar la carta, se eleva con `withTiming` usando el `shadow.floating` del tema.

**No puede ser el mismo gesto que pagina.** El de pagina tiene `failOffsetY([-12, 12])`, asi que un gesto claramente vertical nunca llega aqui. Ese es el mecanismo entero de que un solo gesto horizontal no rompa el reordenado, y por eso no se toca.

- [ ] **Paso 2: el destino**

Mientras se arrastra, se calcula el destino con `renumberWithinState(items, stateId)` y una funcion pura de destino en `lib/lists/reorder.ts` que ya existe para las listas: `dropTargetIndex` y `nextOrderFromDrop` de `apps/mobile/src/lib/lists/drag.ts` y `drag-shift.ts`. **Reutiliza esas, no escribas otras**: la aritmetica de soltar en un hueco ya esta probada y ya se rompio una vez.

- [ ] **Paso 3: al soltar**

Se escribe `position` con `updateItem` para cada tarea que cambia, segun el `Map<string, number>` que devuelve `renumberWithinState`. **Solo las del estado que se reordena.** Un update por fila, coalescidos por el outbox si no han salido todavia.

- [ ] **Paso 4: comprobarla en un navegador**

Reordena dentro de una columna, **sal de la pantalla sin tocar nada mas, y vuelve**. El orden tiene que estar ahi. Y reordena en una columna, cambia de columna, y comprueba que **la otra columna no se ha movido**: ese es el fallo que firma `renumberWithinState` al devolver solo las suyas.

---

### Task 14: Filtros, modo de orden fijo y solo lectura

**Ficheros:**
- Modificar: `apps/mobile/src/app/(app)/board/[listId].tsx`
- Modificar: `apps/mobile/src/lib/lists/kind.ts`

- [ ] **Paso 1: los filtros**

Monta el mismo `ListControls` que la pantalla de listas, y pasa su resultado a `filterItems(items, { tags, completed: undefined, priority, text })` de `lib/lists/item-presentation.ts`. **`completed` va apagado**: en un tablero no existe, y una columna que se vacia porque el filtro de completadas esta puesto es un fallo que no se puede explicar.

- [ ] **Paso 2: `orderMode` fijo**

El tablero fija `orderMode: 'manual'` y `ListControls` no ofrece los otros seis modos. Anade un predicado en `kind.ts`:

```ts
/** Las listas en las que el orden manual es el unico que significa algo. */
export function isManualOrderOnly(kind: ListKind | null | undefined): boolean {
  return kind === 'board' || kind === 'tasks';
}
```

Ojo: `tasks` **ya** usa `canReorder` para decidir si se puede arrastrar, y ese comportamiento **no se toca**.

- [ ] **Paso 3: solo lectura**

Cuando el rol es `viewer`: ni la hoja de estado ni la de editor se montan, y sale el mismo aviso de solo lectura que ya tiene `ListScreen`. **El servidor lo impide igual** —`assertCanWrite` exige `editor`—, pero el cliente no enseña un boton que no va a funcionar.

- [ ] **Paso 4: comprobarla en un navegador**

Filtra por etiqueta en el tablero: solo desaparecen las que no la tienen, y **el contador de las pestañas sigue contando todas**, no las filtradas. Esa diferencia es deliberada y hay que mirar que no se lee como un error.

---

### Task 15: Verificacion en navegador

No es un extra: es la unica forma de comprobar lo que se dibuja, porque este repo no tiene tests de componentes.

**Ficheros:**
- Crear si el recorrido lo necesita: nada. Los ficheros de `docs/verificacion-en-navegador.md` ya dicen donde se anota.

- [ ] **Paso 1: el recorrido minimo en claro**

Abre un tablero con cuatro estados y al menos dos tareas en cada uno. Recorre, en este orden, y **anota en el terminal lo que ves y que se rompio** al terminar cada punto:

1. Las cuatro pestañas con sus contadores. El primero activo.
2. Swipe corto: no cambia. Swipe largo: cambia **una** columna. En el ultimo: no sale de rango.
3. Toca una tarea, mueve a otro estado, cierra. La tarea esta en la columna nueva y **no esta en ninguna otra**.
4. Anade un estado, renombralo, colorealo. Cierra y vuelve a abrir. Todo ahi.
5. Borra un estado con tareas: pregunta a donde van. Elige uno. **Las tareas estan ahi.**
6. Reordena dos tareas dentro de una columna, cambia de columna, vuelve. El orden esta y la otra columna no se movio.
7. Filtra por etiqueta.
8. Exporta a CSV. Abre el fichero: la cabecera tiene `estado` y no tiene `completado`.

- [ ] **Paso 2: lo mismo en oscuro**

Repite del 1 al 8 con el tema oscuro. El filo de color de la tarjeta y el punto de la pestaña son los que mas cambian.

- [ ] **Paso 3: el recorrido de Android que pide el spec**

`docs/superpowers/specs/2026-10-03-regresion-e2e-android-design.md` pide que cada pantalla nueva llegue con un recorrido. Este tablero es una pantalla nueva, asi que le toca. Anota tambien **lo que no se puede comprobar sin un dispositivo** —un asa de seleccion nativa, el teclado del sistema— en vez de afirmar que funciona.

- [ ] **Paso 4: el fallo silencioso mas probable**

Repite el punto 3 **con la app sin conexion**. La tarea se mueve en pantalla y sobrevive a cerrar y abrir. Si algo de esto falla, es que algo se esta escribiendo en el servidor en vez de en el outbox, y eso se arregla antes de seguir.

---

### Task 16: Los documentos

**Ficheros:**
- Modificar: `docs/roadmap.md` (Fase 3)
- Modificar: `docs/architecture/data-model.md` (**en ingles**)
- Modificar: `docs/architecture/offline-sync.md` (**en ingles**)
- Modificar: `docs/product/scope.md` (**en ingles**)

- [ ] **Paso 1: el roadmap, en espanol**

Su Fase 3 es la de listas. Di **como ha quedado de verdad**: el tablero es un `kind` nuevo, los estados son un `jsonb` en la lista, el swipe solo pagina y mover es por hoja. El roadmap dice la realidad, no la intencion.

- [ ] **Paso 2: el modelo de datos, en ingles**

Las dos columnas nuevas, con la misma forma que las demas de esa tabla. **Y una frase que no es obvia y por eso vale la pena escribir**: `state_id` no tiene indice a proposito, porque el filtro por estado es de cliente igual que el de `completed`.

- [ ] **Paso 3: los limites del sync, en ingles**

En la seccion de limites conocidos de `offline-sync.md`: los estados son un campo unico, asi que si dos personas editan el mismo tablero a la vez **gana la ultima, entera**, y no hay fusion estado a estado. Que el servidor lo detecta y no lo resuelve por dentro.

- [ ] **Paso 4: el alcance de producto, en ingles**

El tablero en la tabla de contenido del MVP. Y los limites WIP **fuera**, porque es una decision y no un olvido: no esta porque se descarto, no porque no se pensara.

---

## Fuera de alcance

Dicho aqui para que no aparezca a mitad de la implementacion. Esta lista es la del spec, sin cambios.

Limites WIP. Arrastrar tarjetas entre columnas. Vistas de tabla y calendario. Automatizaciones al entrar en un estado. Reglas de bloqueo de columna. Historial de cambios de estado. Estados compartidos entre tableros. Mas de una plantilla. Archivado de estados.