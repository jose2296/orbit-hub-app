import type { SyncOperation } from '@orbit-hub/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * Collections through sync, end to end: the push, and the row that comes back out
 * of the pull.
 *
 * `bookmarks-destino.test.ts` ya cubre lo que muerde al **crear**: el payload sin
 * `folderId`, la carpeta de otro espacio, la invariante del destino. Eso no se
 * repite aqui.
 *
 * Lo que faltaba era el viaje entero, y es lo que no se ve leyendo el diff: los
 * bloques de `changesSince` que proyectan `collections` son una consulta mas en un
 * pull que devuelve siete tipos de fila, y una consulta que se rompe no tira
 * nada -- el `pull` responde 200 con las otras seis y el enlace no llega nunca al
 * otro dispositivo. Por eso el arnes es el de `notes-sync.test.ts` y no un unit
 * test: hace falta el servidor entero para que la fila llegue.
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
    clientId: 'collections-sync-test',
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

async function createWorkspace(user: TestUser, name: string): Promise<{ id: string; version: number }> {
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

/** Como el de `bookmarks-destino.test.ts`, y por el mismo motivo: la clave que falta no es la clave que vale `null`. */
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

/** Local a este archivo, igual que los demas helpers: nada se importa de otros tests. */
async function createBookmark(
  user: TestUser,
  workspaceId: string,
  over: Record<string, unknown> = {},
): Promise<{ id: string; version: number }> {
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
  expect(response.body.data.results[0].status).toBe('applied');
  return { id, version: response.body.data.results[0].version as number };
}

/** El pull entero, como lo pide un movil que acaba de abrirse. */
async function pull(user: TestUser, cursor: string | null = null) {
  const response = await api.post(
    '/sync/pull',
    { cursor, limit: 200 },
    user.accessToken,
  );
  expect(response.status).toBe(200);
  return response.body.data as {
    changes: { entity: string; record: Record<string, unknown> & { id: string } }[];
    nextCursor: string | null;
  };
}

/** La fila de una entidad concreta en el pull, o `undefined` si no vino. */
function row(data: Awaited<ReturnType<typeof pull>>, entity: string, id: string) {
  return data.changes.find((change) => change.entity === entity && change.record.id === id)?.record;
}

describe('una coleccion creada por sync llega al otro dispositivo', () => {
  it('el pull la devuelve con lo que se escribio', async () => {
    // El recorrido entero, que es lo que no existia: crear por sync y leer por
    // pull. Cada asercion es un campo que la pantalla tiene que dibujar, y cada
    // uno puede faltar sin que nada falle antes.
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Personal');

    const collection = await createCollection(user, workspace.id, {
      name: 'Rust',
      emoji: '🦀',
      description: 'Lenguajes de sistemas',
      position: 3,
    });
    expect(collection.version).toBe(1);

    const record = row(await pull(user), 'collection', collection.id);

    expect(record).toBeDefined();
    expect(record?.name).toBe('Rust');
    expect(record?.emoji).toBe('🦀');
    expect(record?.description).toBe('Lenguajes de sistemas');
    expect(record?.position).toBe(3);
    expect(record?.workspaceId).toBe(workspace.id);
    expect(record?.version).toBe(1);
    // Una fila nueva no esta borrada, y el pull no la trae como lapida: si el
    // `deletedAt` saliera puesto, el movil la esconderia sin avisar.
    expect(record?.deletedAt).toBeNull();
  });

  it('la de una carpeta llega con esa carpeta, y con quien la puede tocar', async () => {
    // `role` y `shared` no son adorno: son lo que decide si la fila lleva un
    // lapiz. Vienen de `accesoDe` y la proyeccion es del bloque de `collections`,
    // asi que llegan aqui o no llegan nunca.
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Personal');
    const folder = await createFolder(user, workspace.id, 'Programacion');

    const collection = await createCollection(user, workspace.id, {
      name: 'En una carpeta',
      folderId: folder,
    });

    const record = row(await pull(user), 'collection', collection.id);

    expect(record?.folderId).toBe(folder);
    expect(record?.role).toBe('owner');
    expect(record?.shared).toBe(false);
  });

  it('el pull no trae la coleccion de un espacio ajeno, aunque la otra persona tenga el suyo', async () => {
    // El filtro del bloque de `collections` es `workspace_id in (los espacios
    // donde es miembro)`. Si ese `in` se cae, el pull de cualquiera devuelve las
    // colecciones de los demas -- y no con un error: con una fila de mas, que es
    // la forma de fugo que no se ve en ningun log.
    //
    // **La otra persona tiene su propio espacio a proposito.** El pull se
    // guarda entero con un atajo al principio --`hayAlgoQueTraer`-- que dice
    // "si no eres miembro de nada y no te compartieron nada, no hay nada que
    // traer". Sin un espacio propio ese atajo responde por el test y el filtro
    // real nunca llega a probarse: pasaria con el `in` borrado.
    const duena = await createVerifiedUser(api);
    const suyo = await createWorkspace(duena, 'Privada');
    const collection = await createCollection(duena, suyo.id, { name: 'Secreta' });

    const otra = await createVerifiedUser(api);
    await createWorkspace(otra, 'Mia');

    const data = await pull(otra);

    expect(row(data, 'collection', collection.id)).toBeUndefined();
    expect(data.changes.some((change) => change.entity === 'collection')).toBe(false);
  });
});

describe('el ciclo de update y delete de una coleccion', () => {
  it('renombrarla por sync la deja en el pull con la version sumada', async () => {
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Personal');
    const collection = await createCollection(user, workspace.id, { name: 'Antes' });

    const response = await push(user, [
      operation({
        entity: 'collection',
        kind: 'update',
        entityId: collection.id,
        baseVersion: collection.version,
        payload: { name: 'Despues' },
      }),
    ]);

    expect(response.body.data.results[0].status).toBe('applied');
    expect(response.body.data.results[0].version).toBe(2);

    const record = row(await pull(user), 'collection', collection.id);
    expect(record?.name).toBe('Despues');
    expect(record?.version).toBe(2);
  });

  it('borrarla por sync la deja como lapida, con la version sumada, y el pull lo trae', async () => {
    // El cursor se pide **antes** del borrado, que es la forma de un segundo
    // movil: si la lapida solo saliera en un pull desde el principio, el
    // borrado no habria llegado a ningun dispositivo y el enlace seguiria en la
    // lista de los demos con la misma fila que antes.
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Personal');
    const collection = await createCollection(user, workspace.id, { name: 'Se va' });
    const antes = await pull(user);
    // El cursor es la premisa del test, asi que se afirma: si se rompiera y
    // volviera `null`, el pull de abajo seria completo y la lapida apareceria de
    // todos modos, con este test en verde y sin mirar nada.
    expect(antes.nextCursor).toBeTruthy();

    const response = await push(user, [
      operation({
        entity: 'collection',
        kind: 'delete',
        entityId: collection.id,
        baseVersion: collection.version,
      }),
    ]);
    expect(response.body.data.results[0].status).toBe('applied');
    expect(response.body.data.results[0].version).toBe(2);

    const record = row(await pull(user, antes.nextCursor), 'collection', collection.id);

    // La fila viene, con `deletedAt` puesto: es lo que el otro dispositivo
    // necesita para borrar de su copia local. Si el `pull` se la comiera, el
    // borrado seria un misterio.
    expect(record).toBeDefined();
    expect(record?.deletedAt).toBeTruthy();
    expect(record?.version).toBe(2);
  });

  it('mover la coleccion de carpeta arrastra a sus bookmarks', async () => {
    // La carpeta de un bookmark clasificado es la de su coleccion: si A pasa
    // de F1 a F2 y sus miembros se quedan en F1, quedan clasificados en A y
    // archivados en F1. La cascada los mueve en la misma operacion, por el
    // camino normal, asi que cada uno suma version y el proximo pull los trae.
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Personal');
    const f1 = await createFolder(user, workspace.id, 'F1');
    const f2 = await createFolder(user, workspace.id, 'F2');
    const collection = await createCollection(user, workspace.id, {
      name: 'Rust',
      folderId: f1,
    });
    const bookmark = await createBookmark(user, workspace.id, {
      collectionId: collection.id,
      folderId: f1,
    });

    const response = await push(user, [
      operation({
        entity: 'collection',
        kind: 'update',
        entityId: collection.id,
        baseVersion: collection.version,
        payload: { folderId: f2 },
      }),
    ]);
    expect(response.body.data.results[0].status).toBe('applied');

    const data = await pull(user);
    expect(row(data, 'collection', collection.id)?.folderId).toBe(f2);

    const miembro = row(data, 'bookmark', bookmark.id);
    expect(miembro?.collectionId).toBe(collection.id);
    expect(miembro?.folderId).toBe(f2);
    expect(miembro?.version).toBe(bookmark.version + 1);
  });
});