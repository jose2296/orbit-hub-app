import type { SyncOperation } from '@orbit-hub/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * Mover cualquier cosa a otro espacio, por sync, de punta a punta.
 *
 * Una carpeta no viaja sola: arrastra su subarbol. Si solo cambiara el
 * `workspaceId` de la carpeta, las listas y notas de dentro quedarian en el espacio
 * viejo apuntando a una carpeta del nuevo, que es una fila que ninguna pantalla
 * dibuja.
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
    clientId: 'move-between-workspaces-test',
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

async function create(
  user: TestUser,
  entity: SyncOperation['entity'],
  payload: Record<string, unknown>,
): Promise<{ id: string; version: number }> {
  const id = randomUUID();
  const response = await push(user, [operation({ entity, kind: 'create', entityId: id, payload })]);
  expect(response.body.data.results[0].status).toBe('applied');
  return { id, version: response.body.data.results[0].version as number };
}

const workspace = (user: TestUser, name: string) => create(user, 'workspace', { name });
const folder = (user: TestUser, workspaceId: string, parentId: string | null = null) =>
  create(user, 'folder', { workspaceId, parentId, name: 'F', position: 0 });
const list = (user: TestUser, workspaceId: string, folderId: string | null = null) =>
  create(user, 'list', { workspaceId, folderId, kind: 'tasks', title: 'L' });
const note = (user: TestUser, workspaceId: string, folderId: string | null = null) =>
  create(user, 'note', { workspaceId, folderId, title: 'N', document: '<p>x</p>' });
const collection = (user: TestUser, workspaceId: string, folderId: string | null = null) =>
  create(user, 'collection', { workspaceId, folderId, name: 'C', position: 0 });
const bookmark = (user: TestUser, workspaceId: string, over: Record<string, unknown> = {}) =>
  create(user, 'bookmark', {
    workspaceId,
    url: 'https://example.com/a',
    title: 'A',
    tags: [],
    position: 0,
    ...over,
  });

async function move(
  user: TestUser,
  entity: SyncOperation['entity'],
  target: { id: string; version: number },
  payload: Record<string, unknown>,
) {
  const response = await push(user, [
    operation({
      entity,
      kind: 'update',
      entityId: target.id,
      baseVersion: target.version,
      payload,
    }),
  ]);
  return response.body.data.results[0] as { status: string; version?: number; message?: string };
}

async function pull(user: TestUser) {
  const response = await api.post('/sync/pull', { cursor: null, limit: 500 }, user.accessToken);
  expect(response.status).toBe(200);
  const changes = response.body.data.changes as {
    entity: string;
    record: Record<string, unknown> & { id: string };
  }[];
  return (entity: string, id: string) =>
    changes.find((change) => change.entity === entity && change.record.id === id)?.record;
}

describe('mover a otro espacio', () => {
  it('un bookmark cambia de espacio y el pull lo trae en el nuevo', async () => {
    const user = await createVerifiedUser(api);
    const a = await workspace(user, 'A');
    const b = await workspace(user, 'B');
    const item = await bookmark(user, a.id);

    const result = await move(user, 'bookmark', item, { workspaceId: b.id, folderId: null });

    expect(result.status).toBe('applied');
    expect((await pull(user))('bookmark', item.id)?.workspaceId).toBe(b.id);
  });

  it('una lista se va a la raiz del espacio nuevo y suelta la carpeta vieja', async () => {
    const user = await createVerifiedUser(api);
    const a = await workspace(user, 'A');
    const b = await workspace(user, 'B');
    const carpeta = await folder(user, a.id);
    const item = await list(user, a.id, carpeta.id);

    const result = await move(user, 'list', item, { workspaceId: b.id, folderId: null });

    expect(result.status).toBe('applied');
    const record = (await pull(user))('list', item.id);
    expect(record?.workspaceId).toBe(b.id);
    expect(record?.folderId).toBeNull();
  });

  it('una nota se va a una carpeta del espacio nuevo', async () => {
    const user = await createVerifiedUser(api);
    const a = await workspace(user, 'A');
    const b = await workspace(user, 'B');
    const destino = await folder(user, b.id);
    const item = await note(user, a.id);

    const result = await move(user, 'note', item, { workspaceId: b.id, folderId: destino.id });

    expect(result.status).toBe('applied');
    const record = (await pull(user))('note', item.id);
    expect(record?.workspaceId).toBe(b.id);
    expect(record?.folderId).toBe(destino.id);
  });

  it('una coleccion arrastra sus bookmarks', async () => {
    const user = await createVerifiedUser(api);
    const a = await workspace(user, 'A');
    const b = await workspace(user, 'B');
    const item = await collection(user, a.id);
    const dentro = await bookmark(user, a.id, { collectionId: item.id });

    const result = await move(user, 'collection', item, { workspaceId: b.id, folderId: null });

    expect(result.status).toBe('applied');
    const read = await pull(user);
    expect(read('collection', item.id)?.workspaceId).toBe(b.id);
    expect(read('bookmark', dentro.id)?.workspaceId).toBe(b.id);
    expect(read('bookmark', dentro.id)?.collectionId).toBe(item.id);
  });

  it('una carpeta arrastra todo su subarbol', async () => {
    const user = await createVerifiedUser(api);
    const a = await workspace(user, 'A');
    const b = await workspace(user, 'B');
    const raiz = await folder(user, a.id);
    const hija = await folder(user, a.id, raiz.id);
    const lista = await list(user, a.id, hija.id);
    const nota = await note(user, a.id, raiz.id);
    const coleccion = await collection(user, a.id, hija.id);
    const enlace = await bookmark(user, a.id, { folderId: hija.id });
    const ajena = await list(user, a.id);

    const result = await move(user, 'folder', raiz, { workspaceId: b.id, parentId: null });

    expect(result.status).toBe('applied');
    const read = await pull(user);
    for (const [entity, id] of [
      ['folder', raiz.id],
      ['folder', hija.id],
      ['list', lista.id],
      ['note', nota.id],
      ['collection', coleccion.id],
      ['bookmark', enlace.id],
    ] as const) {
      expect(read(entity, id)?.workspaceId, `${entity} ${id}`).toBe(b.id);
    }
    // La jerarquia interna se conserva: nada se aplana.
    expect(read('folder', hija.id)?.parentId).toBe(raiz.id);
    expect(read('list', lista.id)?.folderId).toBe(hija.id);
    // Y lo que estaba fuera de la carpeta se queda donde estaba.
    expect(read('list', ajena.id)?.workspaceId).toBe(a.id);
  });

  it('no se puede mover a un espacio ajeno', async () => {
    const user = await createVerifiedUser(api);
    const otra = await createVerifiedUser(api);
    const a = await workspace(user, 'A');
    const ajeno = await workspace(otra, 'Ajeno');
    const item = await note(user, a.id);

    const result = await move(user, 'note', item, { workspaceId: ajeno.id, folderId: null });

    expect(result.status).not.toBe('applied');
    expect((await pull(user))('note', item.id)?.workspaceId).toBe(a.id);
  });

  it('no se puede mover a una carpeta de otro espacio', async () => {
    const user = await createVerifiedUser(api);
    const a = await workspace(user, 'A');
    const b = await workspace(user, 'B');
    const enA = await folder(user, a.id);
    const item = await list(user, a.id);

    // Destino B, pero la carpeta es de A: la fila quedaria en un sitio que no existe.
    const result = await move(user, 'list', item, { workspaceId: b.id, folderId: enA.id });

    expect(result.status).not.toBe('applied');
    expect((await pull(user))('list', item.id)?.workspaceId).toBe(a.id);
  });

  it('una carpeta no se puede meter dentro de si misma ni de su subarbol', async () => {
    const user = await createVerifiedUser(api);
    const a = await workspace(user, 'A');
    const b = await workspace(user, 'B');
    const raiz = await folder(user, a.id);
    const hija = await folder(user, a.id, raiz.id);

    const result = await move(user, 'folder', raiz, { workspaceId: b.id, parentId: hija.id });

    expect(result.status).not.toBe('applied');
  });
});
