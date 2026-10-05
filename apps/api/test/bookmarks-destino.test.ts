import type { SyncOperation } from '@orbit-hub/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { esUrlQueSePuedePedir } from '../src/modules/sync/sync-service.js';
import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * El destino de una coleccion y de un bookmark, y el filtro de la URL, probados
 * por el camino que toma un movil.
 *
 * Los dos son fallos que no se ven leyendo el diff. El destino se resolvia con
 * `folderId === null` cuando `sanitisePayload` devuelve `undefined` para una
 * clave ausente, asi que **una coleccion sin carpeta --el caso normal-- daba
 * 404**. Y el filtro http/https del servidor no lo cubria nada: la unica mitad
 * que estaba probada era la del contrato, que es justamente la que no es una
 * frontera de confianza.
 *
 * Por eso el arnes es el de `notes-sync.test.ts` y no un unit test: la
 * diferencia entre mandar `folderId: null` y no mandar `folderId` **solo** se ve
 * con el payload entero pasando por el sanitizador.
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
    clientId: 'bookmarks-destino-test',
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

async function createWorkspace(user: TestUser, name: string): Promise<string> {
  const id = randomUUID();
  const response = await push(user, [
    operation({ entity: 'workspace', kind: 'create', entityId: id, payload: { name } }),
  ]);
  expect(response.body.data.results[0].status).toBe('applied');
  return id;
}

async function createFolder(user: TestUser, workspaceId: string): Promise<string> {
  const id = randomUUID();
  const response = await push(user, [
    operation({
      entity: 'folder',
      kind: 'create',
      entityId: id,
      payload: { workspaceId, parentId: null, name: 'F', position: 0 },
    }),
  ]);
  expect(response.body.data.results[0].status).toBe('applied');
  return id;
}

/** `over` se aplica sobre un payload que **no** trae `folderId`. */
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
      payload: { workspaceId, name: 'Rust', position: 0, ...over },
    }),
  ]);
  expect(response.body.data.results[0].status).toBe('applied');
  return { id, version: response.body.data.results[0].version as number };
}

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

async function row(user: TestUser, entity: 'collection' | 'bookmark', id: string) {
  const response = await api.post(
    '/sync/pull',
    { deviceId: randomUUID(), lastPulledAt: null },
    user.accessToken,
  );
  return response.body.data.changes.find(
    (change: { entity: string; record: { id: string } }) =>
      change.entity === entity && change.record.id === id,
  ).record;
}

describe('una coleccion se crea sin carpeta, que es el caso normal', () => {
  it('acepta un payload sin la clave folderId y la deja en null', async () => {
    // El fallo era del helper, no del cliente: `sanitisePayload` copia solo las
    // claves presentes, asi que la clave ausente llega como `undefined`, y un
    // guard `=== null` la tomaba por una carpeta que no existe -> 404. Una
    // coleccion sin carpeta es lo normal, y no se podia crear ninguna.
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Personal');

    const id = randomUUID();
    const response = await push(user, [
      operation({
        entity: 'collection',
        kind: 'create',
        entityId: id,
        payload: { workspaceId, name: 'Sin carpeta', position: 0 },
      }),
    ]);

    expect(response.body.data.results[0].status).toBe('applied');
    expect((await row(user, 'collection', id)).folderId).toBeNull();
  });

  it('acepta tambien la clave presente en null, que es la otra forma', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Personal');

    const id = randomUUID();
    const response = await push(user, [
      operation({
        entity: 'collection',
        kind: 'create',
        entityId: id,
        payload: { workspaceId, folderId: null, name: 'Sin carpeta', position: 0 },
      }),
    ]);

    expect(response.body.data.results[0].status).toBe('applied');
    expect((await row(user, 'collection', id)).folderId).toBeNull();
  });

  it('un bookmark sin folderId ni collectionId tambien se crea', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Personal');

    const id = randomUUID();
    const response = await push(user, [
      operation({
        entity: 'bookmark',
        kind: 'create',
        entityId: id,
        payload: { workspaceId, url: 'https://example.com/a', title: 'A', position: 0 },
      }),
    ]);

    expect(response.body.data.results[0].status).toBe('applied');
    const record = await row(user, 'bookmark', id);
    expect(record.folderId).toBeNull();
    expect(record.collectionId).toBeNull();
  });

  it('una carpeta de otro espacio sigue siendo 422, no un 404 de "no existe"', async () => {
    // El guard loose no puede comerse esta comprobacion: sin `folderId` es null,
    // y con una carpeta ajena tiene que seguir diciendo por que.
    const user = await createVerifiedUser(api);
    const otro = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Mio');
    const ajeno = await createFolder(otro, await createWorkspace(otro, 'Suyo'));

    const id = randomUUID();
    const response = await push(user, [
      operation({
        entity: 'collection',
        kind: 'create',
        entityId: id,
        payload: { workspaceId, folderId: ajeno, name: 'Ajena', position: 0 },
      }),
    ]);

    expect(response.body.data.results[0].status).toBe('rejected');
    expect(response.body.data.results[0].error).toBe('That folder is not in this workspace');
  });
});

describe('el filtro de la URL del servidor', () => {
  it('rechaza las variantes de esquema que no son http ni https', () => {
    // El punto es que una variante colada **no se acepte**, no que el error se
    // vea bonito. `data:` es el payload pegado del share sheet, y `http:/` con
    // una sola barra es la forma de escribirlo sin que `z.url()` se queje.
    expect(esUrlQueSePuedePedir('data:text/plain,hola')).toBe(false);
    expect(esUrlQueSePuedePedir('http:/\\evil.com')).toBe(false);
    expect(esUrlQueSePuedePedir('ftp://example.com')).toBe(false);
    expect(esUrlQueSePuedePedir('javascript:alert(1)')).toBe(false);
  });

  it('rechaza las mayusculas, y lo hace a proposito', () => {
    // HTTPS:// es una URL valida para un navegador y no la acepta ninguna de las
    // dos capas. Se fija aqui porque es una decision, no un descuido: si alguien
    // "arregla" el filtro con `toLowerCase()` hay que volver a pensarlo, y este
    // test es lo que lo hace notar.
    expect(esUrlQueSePuedePedir('HTTPS://example.com')).toBe(false);
    expect(esUrlQueSePuedePedir('Https://example.com')).toBe(false);
  });

  it('rechaza una URL mas larga que el techo', () => {
    expect(esUrlQueSePuedePedir('https://example.com')).toBe(true);
    expect(esUrlQueSePuedePedir(`https://example.com/${'a'.repeat(2048 - 20)}`)).toBe(true);
    expect(esUrlQueSePuedePedir(`https://example.com/${'a'.repeat(5000)}`)).toBe(false);
  });

  it('no acepta un valor que no es un texto', () => {
    expect(esUrlQueSePuedePedir(undefined)).toBe(false);
    expect(esUrlQueSePuedePedir(null)).toBe(false);
    expect(esUrlQueSePuedePedir(42)).toBe(false);
  });

  it('create y update rechazan el mismo valor: la simetria es la defensa', async () => {
    // Si uno de los dos caminos no filtra, la otra capa no importa: un cliente
    // que no valida --un script, una version vieja-- elige el que quiera.
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Personal');

    const creado = randomUUID();
    const enCreate = await push(user, [
      operation({
        entity: 'bookmark',
        kind: 'create',
        entityId: creado,
        payload: { workspaceId, url: 'data:text/plain,hola', title: 'A', position: 0 },
      }),
    ]);
    expect(enCreate.body.data.results[0].status).toBe('rejected');

    const { id, version } = await createBookmark(user, workspaceId);
    const enUpdate = await push(user, [
      operation({
        entity: 'bookmark',
        kind: 'update',
        entityId: id,
        baseVersion: version,
        payload: { url: 'data:text/plain,hola' },
      }),
    ]);
    expect(enUpdate.body.data.results[0].status).toBe('rejected');

    // Y la fila que si se creo sigue con la URL buena.
    expect((await row(user, 'bookmark', id)).url).toBe('https://example.com/a');
  });
});

describe('coleccion y carpeta no pueden discrepar', () => {
  it('create: los dos campos en conflicto se rechazan con el motivo', async () => {
    // La regla de la spec es que el destino sale de la coleccion. Aceptar los
    // dos y creerse el del cliente deja el bookmark clasificado en A y archivado
    // en F2, que es un estado que ninguna pantalla sabe dibujar.
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Personal');
    const f1 = await createFolder(user, workspaceId);
    const f2 = await createFolder(user, workspaceId);
    const coleccion = await createCollection(user, workspaceId, { folderId: f1 });

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
          position: 0,
          collectionId: coleccion.id,
          folderId: f2,
        },
      }),
    ]);

    expect(response.body.data.results[0].status).toBe('rejected');
    expect(response.body.data.results[0].error).toMatch(/collection/i);
  });

  it('create: los dos campos de acuerdo se aceptan', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Personal');
    const f1 = await createFolder(user, workspaceId);
    const coleccion = await createCollection(user, workspaceId, { folderId: f1 });

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
          position: 0,
          collectionId: coleccion.id,
          folderId: f1,
        },
      }),
    ]);

    expect(response.body.data.results[0].status).toBe('applied');
    expect((await row(user, 'bookmark', id)).folderId).toBe(f1);
  });

  it('update: cambiar de coleccion deja la fila en la carpeta de la nueva', async () => {
    // La invariante que create establece tiene que sobrevivir a la primera
    // edicion. Antes, un update que mandaba solo `collectionId` dejaba el
    // `folderId` viejo, que ya no era el de la coleccion: la regla era cierta al
    // crear y falsa a partir de la primera edicion.
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Personal');
    const f1 = await createFolder(user, workspaceId);
    const f2 = await createFolder(user, workspaceId);
    const una = await createCollection(user, workspaceId, { folderId: f1 });
    const otra = await createCollection(user, workspaceId, { folderId: f2 });

    const bookmark = await createBookmark(user, workspaceId, {
      collectionId: una.id,
      folderId: f1,
    });

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
    const record = await row(user, 'bookmark', bookmark.id);
    expect(record.collectionId).toBe(otra.id);
    expect(record.folderId).toBe(f2);
  });

  it('update: los dos campos en conflicto se rechazan con el motivo', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Personal');
    const f1 = await createFolder(user, workspaceId);
    const f2 = await createFolder(user, workspaceId);
    const coleccion = await createCollection(user, workspaceId, { folderId: f1 });
    const bookmark = await createBookmark(user, workspaceId);

    const response = await push(user, [
      operation({
        entity: 'bookmark',
        kind: 'update',
        entityId: bookmark.id,
        baseVersion: bookmark.version,
        payload: { collectionId: coleccion.id, folderId: f2 },
      }),
    ]);

    expect(response.body.data.results[0].status).toBe('rejected');
    expect(response.body.data.results[0].error).toMatch(/collection/i);
  });

  it('update: sacar el bookmark de la coleccion lo deja sin carpeta, no con la vieja', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Personal');
    const f1 = await createFolder(user, workspaceId);
    const coleccion = await createCollection(user, workspaceId, { folderId: f1 });
    const bookmark = await createBookmark(user, workspaceId, {
      collectionId: coleccion.id,
      folderId: f1,
    });

    const response = await push(user, [
      operation({
        entity: 'bookmark',
        kind: 'update',
        entityId: bookmark.id,
        baseVersion: bookmark.version,
        payload: { collectionId: null },
      }),
    ]);

    expect(response.body.data.results[0].status).toBe('applied');
    expect((await row(user, 'bookmark', bookmark.id)).folderId).toBeNull();
  });

  it('update: mover solo la carpeta sigue funcionando sin coleccion', async () => {
    // La regla no es "el destino no se toca": es que la coleccion manda cuando
    // hay. Sin coleccion, la carpeta es una decision consciente y se respeta.
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Personal');
    const f2 = await createFolder(user, workspaceId);
    const bookmark = await createBookmark(user, workspaceId);

    const response = await push(user, [
      operation({
        entity: 'bookmark',
        kind: 'update',
        entityId: bookmark.id,
        baseVersion: bookmark.version,
        payload: { folderId: f2 },
      }),
    ]);

    expect(response.body.data.results[0].status).toBe('applied');
    expect((await row(user, 'bookmark', bookmark.id)).folderId).toBe(f2);
  });
});