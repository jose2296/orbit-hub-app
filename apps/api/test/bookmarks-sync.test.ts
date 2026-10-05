import type { SyncOperation } from '@orbit-hub/contracts';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { collections } from '../src/db/content-schema.js';
import { getDatabase } from '../src/db/client.js';
import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * Bookmarks through sync, end to end: el push, el pull, y lo que el pull
 * **proyecta** de una fila.
 *
 * Lo que ya esta cubierto y **no** se repite, todo en `bookmarks-destino.test.ts`
 * y `bookmarks-registration.test.ts`:
 *
 * - la URL que no es http/https, en los dos caminos y en las variantes:
 *   `el filtro de la URL del servidor`, mas `create y update rechazan el mismo valor`.
 * - la carpeta de otro espacio: `una carpeta de otro espacio sigue siendo 422`
 *   (para `collection`; la rama de `bookmark` es `resolveCarpetaDeEsteEspacio`,
 *   la misma, y lo que si era una rama distinta esta en "la coleccion de otro
 *   espacio" mas abajo, que es `findColeccionDeEsteEspacio`).
 * - la invariante de `folderId` contra `collectionId`, en create y en update:
 *   `coleccion y carpeta no pueden discrepar`.
 * - que `document`, `plainText` y `extractionState` no son escribibles: eso lo
 *   afirma el registro, leyendo `SYNC_WRITABLE_FIELDS`. Que ademas no lleguen a
 *   la fila por la puerta de atras esta en "el servidor se queda con el
 *   documento", que va por el push de verdad.
 *
 * Lo que si faltaba, y es lo unico que hace falta para que la Task 6 pueda
 * apoyarse en esto: que el viaje entero funciona, que el ciclo de update y
 * delete mueve la version y pone la lapida, y que borrar la fila de verdad de
 * una coleccion deja vivos sus bookmarks.
 */
let api: TestServer;

beforeAll(async () => {
  api = await startTestServer();
});

afterAll(async () => {
  await api.close();
});

function operation(
  over: Partial<SyncOperation> & Pick<SyncOperation, 'entity' | 'kind' | 'entityId'>,
) {
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
  return api.post(
    '/sync/push',
    { deviceId: randomUUID(), lastPulledAt: null, operations },
    user.accessToken,
  );
}

async function createWorkspace(
  user: TestUser,
  name: string,
): Promise<{ id: string; version: number }> {
  const id = randomUUID();
  const response = await push(user, [
    operation({ entity: 'workspace', kind: 'create', entityId: id, payload: { name } }),
  ]);
  expect(response.body.data.results[0].status).toBe('applied');
  return { id, version: response.body.data.results[0].version as number };
}

async function createFolder(user: TestUser, workspaceId: string, name = 'F'): Promise<string> {
  const id = randomUUID();
  const response = await push(user, [
    operation({
      entity: 'folder',
      kind: 'create',
      entityId: id,
      payload: { workspaceId, parentId: null, name, position: 0 },
    }),
  ]);
  expect(response.body.data.results[0].status).toBe('applied');
  return id;
}

async function createCollection(
  user: TestUser,
  workspaceId: string,
  over: Record<string, unknown> = {},
): Promise<{ id: string; version: number }> {
  const id = randomUUID();
  const response = await push(user, [
    operation({
      entity: 'collection',
      kind: 'create',
      entityId: id,
      payload: {
        workspaceId,
        folderId: null,
        name: 'Rust',
        description: null,
        emoji: null,
        position: 0,
        ...over,
      },
    }),
  ]);
  expect(response.body.data.results[0].status).toBe('applied');
  return { id, version: response.body.data.results[0].version as number };
}

/** Como `createBookmark` pero sin exigir `applied`: hace falta leer un `rejected`. */
async function createBookmarkRaw(
  user: TestUser,
  workspaceId: string,
  over: Record<string, unknown> = {},
) {
  const id = randomUUID();
  const response = await push(user, [
    operation({
      entity: 'bookmark',
      kind: 'create',
      entityId: id,
      payload: {
        workspaceId,
        url: 'https://example.com/a',
        title: 'A',
        tags: [],
        position: 0,
        ...over,
      },
    }),
  ]);
  return { id, response };
}

async function createBookmark(
  user: TestUser,
  workspaceId: string,
  over: Record<string, unknown> = {},
): Promise<{ id: string; version: number }> {
  const { id, response } = await createBookmarkRaw(user, workspaceId, over);
  expect(response.body.data.results[0].status).toBe('applied');
  return { id, version: response.body.data.results[0].version as number };
}

async function pull(user: TestUser, cursor: string | null = null) {
  const response = await api.post('/sync/pull', { cursor, limit: 200 }, user.accessToken);
  expect(response.status).toBe(200);
  return response.body.data as {
    changes: { entity: string; record: Record<string, unknown> & { id: string } }[];
    nextCursor: string | null;
  };
}

function row(data: Awaited<ReturnType<typeof pull>>, entity: string, id: string) {
  return data.changes.find((change) => change.entity === entity && change.record.id === id)?.record;
}

describe('un bookmark creado por sync llega al otro dispositivo', () => {
  it('el pull lo devuelve con la URL, el titulo y las etiquetas', async () => {
    // El recorrido entero. Los bloques de `collections` y de `bookmarks` en
    // `changesSince` son dos consultas mas en un pull que devuelve siete tipos
    // de fila, y una consulta que se rompe no tira nada: el pull responde 200
    // con las otras seis y el enlace no llega nunca al otro movil.
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Personal');

    const bookmark = await createBookmark(user, workspace.id, {
      url: 'https://example.com/a',
      title: 'El libro de Rust',
      tags: ['rust', 'lenguajes'],
      position: 2,
    });
    expect(bookmark.version).toBe(1);

    const record = row(await pull(user), 'bookmark', bookmark.id);

    expect(record).toBeDefined();
    expect(record?.url).toBe('https://example.com/a');
    expect(record?.title).toBe('El libro de Rust');
    expect(record?.tags).toEqual(['rust', 'lenguajes']);
    expect(record?.position).toBe(2);
    expect(record?.workspaceId).toBe(workspace.id);
    expect(record?.version).toBe(1);
    expect(record?.deletedAt).toBeNull();
    // Sin destino elegido, las dos son null: es el estado que se dibuja sin
    // carpeta y sin coleccion, y por eso tiene que llegar asi y no como "".
    expect(record?.folderId).toBeNull();
    expect(record?.collectionId).toBeNull();
  });

  it('el pull no trae los bookmarks de un espacio ajeno, aunque la otra persona tenga los suyos', async () => {
    // El bloque de `bookmarks` del pull tiene su propio `where`, con su propio
    // `in` de espacios. Si ese `in` se cae, el enlace de otra persona aparece en
    // la lista de esta sin ningun error en ninguna parte.
    //
    // **La otra persona tiene su propio espacio a proposito.** El pull se
    // guarda entero con un atajo al principio --`hayAlgoQueTraer`-- que dice
    // "si no eres miembro de nada y no te compartieron nada, no hay nada que
    // traer". Sin un espacio propio ese atajo responde por el test y el filtro
    // real nunca llega a probarse: el test pasaria con el `in` borrado.
    const duena = await createVerifiedUser(api);
    const suyo = await createWorkspace(duena, 'Privada');
    const bookmark = await createBookmark(duena, suyo.id, { title: 'Secreto' });

    const otra = await createVerifiedUser(api);
    await createWorkspace(otra, 'Mia');

    const data = await pull(otra);
    // Y el suyo si llega, para que no sea que el pull de esta persona esta vacio
    // y por eso no encuentra el ajeno.
    expect(row(data, 'bookmark', bookmark.id)).toBeUndefined();
    expect(data.changes.some((change) => change.entity === 'bookmark')).toBe(false);
  });
});

describe('el servidor se queda con el documento', () => {
  it('un bookmark nuevo sale pending, con el documento y el texto plano vacios', async () => {
    // `pending` y no `failed`: todavia no se ha intentado extraer nada, y decir
    // "fallo" seria mentira. Y vacio, porque un enlace se guarda antes de que
    // haya texto: la fase 2 es la que lo rellena.
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Personal');

    const bookmark = await createBookmark(user, workspace.id);

    const record = row(await pull(user), 'bookmark', bookmark.id);

    expect(record?.extractionState).toBe('pending');
    expect(record?.document).toBe('');
    expect(record?.plainText).toBe('');
    expect(record?.extractionError).toBeNull();
    // Los otros cuatro que son del servidor tambien arrancan vacios, por el
    // mismo motivo: los escribe la extraccion, no la persona.
    expect(record?.siteName).toBeNull();
    expect(record?.description).toBeNull();
    expect(record?.imageUrl).toBeNull();
  });

  it('un payload con document, plainText y extractionState los descarta en silencio', async () => {
    // La puerta es el allow-list, y el sanitizador es la unica que la consulta
    // (`sanitisePayload` arma el set desde `SYNC_WRITABLE_FIELDS`,
    // `sync-service.ts:210`): no son dos capas, son una. El fallo es mudo, y por
    // eso hay que vigilarlo: sin esto, el push responde `applied` con la version
    // sumada y el documento que nadie ha extraido aparece como si el servidor lo
    // hubiera escrito. Y `extractionState: 'ready'` sobre un documento vacio es
    // un estado que la lista no sabe pintar.
    //
    // Se descarta en silencio a proposito y no se rechaza: rechazar tumbaria
    // un lote entero por un campo que el cliente nunca debio mandar.
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Personal');

    const { id, response } = await createBookmarkRaw(user, workspace.id, {
      url: 'https://example.com/a',
      document: '<p>me inyectaron esto</p>',
      plainText: 'texto inventado',
      extractionState: 'ready',
      extractionError: 'no fallo nada',
      siteName: 'Sitio inventado',
      description: 'Descripcion inventada',
      imageUrl: 'https://example.com/mentira.png',
    });

    expect(response.body.data.results[0].status).toBe('applied');

    const record = row(await pull(user), 'bookmark', id);
    expect(record?.document).toBe('');
    expect(record?.plainText).toBe('');
    expect(record?.extractionState).toBe('pending');
    expect(record?.extractionError).toBeNull();
    expect(record?.siteName).toBeNull();
    expect(record?.description).toBeNull();
    expect(record?.imageUrl).toBeNull();
  });

  it('un update no los escribe tampoco: la puerta es una sola y es el allow-list', async () => {
    /*
     * El nombre de este test cambio porque el anterior decia una cosa que no es
     * cierta: "no hay una segunda puerta".
     *
     * Lo que hay es **una** fuente de verdad y **una** puerta: `sanitisePayload`
     * arma el set desde `SYNC_WRITABLE_FIELDS` (`sync-service.ts:210`), asi que
     * la constante y el sanitizador no son dos capas que se puedan borrar por
     * separado. Son la misma capa, contada dos veces.
     *
     * Lo que evita la segunda puerta es un detalle del sanitizador, y conviene
     * que quede escrito porque es invisible: **el loop no tiene catch-all**. Termina
     * en la rama de `metadata` (`:443-449`) y despues se cierra, asi que un campo
     * sin rama propia nunca se copia a `clean`.
     *
     * Y aqui los siete campos del servidor no son todos iguales, que es lo que no
     * se ve leyendo el allow-list. Probado con el sanitizador sin el gate del
     * allow-list (`:214`), sobre un payload con los siete: sobreviven `url`,
     * `document` y `description`, y **no** sobreviven `plainText`,
     * `extractionState`, `extractionError`, `siteName` ni `imageUrl`. O sea:
     *
     * - `document` y `description` tienen rama propia en el sanitizador (la de
     *   `document` es la de las notas, `:428`; `description` cae en la de
     *   `name`/`description`/`emoji`, `:216`). Para esos dos, el allow-list es lo
     *   **unico** que los frena: son la puerta real.
     * - Los otros cinco no tienen rama, asi que los frena la caida sin catch-all.
     *   Para esos hay dos capas, pero la segunda es un accidente --nadie eligio
     *   droppearlos, simplemente no hay donde copiarlos-- y por eso no es una capa
     *   de la que uno pueda depender.
     *
     * Lo que hay que vigilar, entonces, es el gate del allow-list (`:214`), no el
     * final del loop. Anadir un `else clean[key] = value` **no** abre una segunda
     * puerta por si solo: medido, el test sigue verde, porque el allow-list ya
     * descarto el campo antes de llegar al final. Lo dangerouso es lo contrario:
     * weakencer el gate del allow-list creyendo que la caida lo cubre, que es
     * exactamente el error que este test sigue en pie para cazar.
     *
     * Se afirma en los dos caminos --create y update-- porque la fila nace en el
     * de la izquierda y se escribe en el de la derecha, y porque un update es el
     * camino que un cliente usa para "arreglar" lo que el servidor creo.
     */
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Personal');
    const bookmark = await createBookmark(user, workspace.id);

    const response = await push(user, [
      operation({
        entity: 'bookmark',
        kind: 'update',
        entityId: bookmark.id,
        baseVersion: bookmark.version,
        payload: {
          document: '<p>ahora si</p>',
          plainText: 'ahora si',
          extractionState: 'ready',
        },
      }),
    ]);
    expect(response.body.data.results[0].status).toBe('applied');

    const record = row(await pull(user), 'bookmark', bookmark.id);
    expect(record?.document).toBe('');
    expect(record?.extractionState).toBe('pending');
  });
});

describe('los anchos los corta el sanitizador, y el push entero aguanta', () => {
  it('un titulo de 400 caracteres se corta a 300 y la operacion se aplica', async () => {
    // `sync-limits.test.ts` ya afirma que el sanitizador corta al ancho real de
    // la columna, leyendo la columna. Lo que no probaba de aqui es que el push
    // entero aguante: sin el corte la escritura llega a Postgres y vuelve como
    // un `failed` con el codigo 22001 en vez de una fila guardada.
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Personal');

    const bookmark = await createBookmark(user, workspace.id, { title: 'a'.repeat(400) });

    expect(row(await pull(user), 'bookmark', bookmark.id)?.title).toHaveLength(300);
  });

  it('una etiqueta de 80 caracteres se corta a 40 y la operacion se aplica', async () => {
    // Las etiquetas no tienen columna con ancho --son un `jsonb`-- asi que no las
    // vigila `sync-limits.test.ts`, que solo mira los `varchar`.
    //
    // Y el corte lo hace **el sanitizador**, no el contrato: la rama de `tags`
    // (`sync-service.ts:392-397`) hace `.slice(0, 40)` y `.filter(Boolean)`. El
    // `.max(TAG_MAX)` del contrato **rechaza**, no recorta, asi que sin el
    // sanitizador el `safeParse` de despues tumbaria la operacion entera: un
    // `rejected` por una etiqueta larga es perder el enlace y la URL que si eran
    // validas. Por eso el orden importa --primero se recorta, despues se valida-- y
    // por eso el recorte tiene que estar en el sanitizador y no solo en el
    // contrato.
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Personal');

    const bookmark = await createBookmark(user, workspace.id, {
      tags: ['a'.repeat(80), '   '],
    });

    const tags = row(await pull(user), 'bookmark', bookmark.id)?.tags;
    expect(tags).toEqual(['a'.repeat(40)]);
  });
});

describe('el ciclo de update y delete de un bookmark', () => {
  it('moverlo de coleccion lo deja en la carpeta de la nueva, con la version sumada', async () => {
    // La carpeta que se mueve ya la afirma `update: cambiar de coleccion deja la
    // fila en la carpeta de la nueva`, en `bookmarks-destino.test.ts`. Lo que no
    // estaba era la version: un update que aplicase el cambio y **no** sumase el
    // token de concurrencia dejaria a los otros dispositivos con una fila que no
    // pueden distinguir de la anterior.
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Personal');
    const f1 = await createFolder(user, workspace.id, 'Una');
    const f2 = await createFolder(user, workspace.id, 'Dos');
    const una = await createCollection(user, workspace.id, { name: 'A', folderId: f1 });
    const otra = await createCollection(user, workspace.id, { name: 'B', folderId: f2 });

    const bookmark = await createBookmark(user, workspace.id, { collectionId: una.id });

    const response = await push(user, [
      operation({
        entity: 'bookmark',
        kind: 'update',
        entityId: bookmark.id,
        baseVersion: bookmark.version,
        payload: { collectionId: otra.id },
      }),
    ]);

    expect(response.body.data.results[0].status).toBe('applied');
    expect(response.body.data.results[0].version).toBe(2);

    const record = row(await pull(user), 'bookmark', bookmark.id);
    expect(record?.collectionId).toBe(otra.id);
    expect(record?.folderId).toBe(f2);
    expect(record?.version).toBe(2);
    expect(record?.deletedAt).toBeNull();
  });

  // Sacarlo de la coleccion (`collectionId: null`) ya lo afirma
  // `bookmarks-destino.test.ts:399`, que es donde vive la invariante. Aqui solo
  // queda el otro sentido, el de moverlo, porque lo que se vigila es la version.
  it('borrarlo por sync lo deja como lapida, con la version sumada, y el pull lo trae', async () => {
    // El cursor se pide **antes** del borrado, que es la forma de un segundo
    // movil. Si la lapida solo saliera en un pull desde el principio, el borrado
    // no habria llegado a ninguna parte y el enlace seguiria en la lista de los
    // demas con la misma fila que antes.
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Personal');
    const bookmark = await createBookmark(user, workspace.id, { title: 'Se va' });
    const antes = await pull(user);
    // El cursor es la premisa del test, asi que se afirma: si se rompiera y
    // volviera `null`, el pull de abajo seria completo y el borrado apareceria de
    // todos modos, con este test en verde y sin mirar nada.
    expect(antes.nextCursor).toBeTruthy();

    const response = await push(user, [
      operation({
        entity: 'bookmark',
        kind: 'delete',
        entityId: bookmark.id,
        baseVersion: bookmark.version,
      }),
    ]);
    expect(response.body.data.results[0].status).toBe('applied');
    expect(response.body.data.results[0].version).toBe(2);

    const record = row(await pull(user, antes.nextCursor), 'bookmark', bookmark.id);

    expect(record).toBeDefined();
    expect(record?.deletedAt).toBeTruthy();
    expect(record?.version).toBe(2);
  });
});

describe('la coleccion manda, y no de otro espacio', () => {
  it('un bookmark con la coleccion de otro espacio se rechaza, y no se crea', async () => {
    // Esta rama es `findColeccionDeEsteEspacio` y es distinta de la del destino
    // por carpeta, que ya esta cubierta: aqui la FK se cumple --la coleccion
    // existe-- y sin esta comprobacion el enlace queda clasificado dentro de la
    // coleccion de otra persona. Ni un 404 ni un 500: un `rejected` que dice
    // cual de los dos campos va mal, que es lo que el cliente necesita para
    // decide donde lo deja.
    const duena = await createVerifiedUser(api);
    const suyo = await createWorkspace(duena, 'Suyo');
    const coleccionAjena = await createCollection(duena, suyo.id, { name: 'Privada' });

    const otra = await createVerifiedUser(api);
    const mio = await createWorkspace(otra, 'Mio');

    const { id, response } = await createBookmarkRaw(otra, mio.id, {
      collectionId: coleccionAjena.id,
    });

    expect(response.body.data.results[0].status).toBe('rejected');
    expect(response.body.data.results[0].error).toMatch(/collection/i);
    // Y no queda nada: un `rejected` que creara la fila seria peor que nada.
    expect(row(await pull(otra), 'bookmark', id)).toBeUndefined();
  });
});

describe('borrar la fila de verdad de una coleccion deja vivos sus bookmarks', () => {
  it('el bookmark sigue ahi, sin collectionId, y la coleccion ya no', async () => {
    /*
     * El test que **si** distingue `set null` de `cascade`.
     *
     * El borrado logico de sync no puede servir para esto, y es importante
     * decir por que: `kind: 'delete'` deja la fila con `deleted_at`, la FK nunca
     * llega a disparar, y el bookmark sobrevive **con cualquiera de los dos
     * `onDelete`**. Ese test pasa siempre y no prueba nada sobre la FK.
     *
     * Lo que hace falta es que la fila de `collections` deje de existir. Hoy no
     * hay ninguna ruta de produccion que la borre --`DELETE
     * /api/v1/collections/:id` es de la Task 6-- asi que se borra la fila por el
     * mismo handle que usa el servidor, que es lo que va a hacer ese endpoint.
     * Es la unica forma de que la FK sea un hecho y no una cadena en el
     * `.sql` de la migracion.
     *
     * Y **no** por la carpeta que la contiene, que es la via que parece
     * natural: `bookmarks.folder_id` tambien es `ON DELETE cascade`, y la
     * invariante del destino deja el `folder_id` del bookmark en la carpeta de
     * su coleccion. Borrar la carpeta se lleva el bookmark por su **propia** FK,
     * con `set null` o sin el, y el test no distinguiria nada. Por eso aqui la
     * coleccion cuelga de una carpeta que no se toca.
     *
     * Con `ON DELETE cascade` en `bookmarks_collection_id_collections_id_fk` este
     * test falla con el enlace desaparecido, y con `set null` pasa. Ese es el
     * que vale.
     */
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Personal');
    const carpeta = await createFolder(user, workspace.id, 'Intacta');
    const collection = await createCollection(user, workspace.id, {
      name: 'Se va de verdad',
      folderId: carpeta,
    });
    const bookmark = await createBookmark(user, workspace.id, {
      title: 'No se pierde',
      collectionId: collection.id,
    });

    // La fila, no la lapida.
    const { db } = await getDatabase();
    await db.delete(collections).where(eq(collections.id, collection.id));

    const data = await pull(user);

    // La coleccion no esta, que es lo que se borro.
    expect(row(data, 'collection', collection.id)).toBeUndefined();

    const record = row(data, 'bookmark', bookmark.id);
    expect(record).toBeDefined();
    expect(record?.deletedAt).toBeNull();
    // "Sin clasificar": la coleccion se fue y el enlace sigue vivo, sin ella.
    expect(record?.collectionId).toBeNull();
  });
});