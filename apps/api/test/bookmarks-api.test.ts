import type { SyncOperation } from '@orbit-hub/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * Las lecturas REST de collections y bookmarks.
 *
 * Las escrituras son del sync y no se repiten aqui: los helpers de
 * workspace/coleccion por `/sync/push` son locales a este archivo.
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
    clientId: 'bookmarks-api-test',
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

async function createWorkspace(user: TestUser, name: string): Promise<{ id: string }> {
  const id = randomUUID();
  const response = await push(user, [
    operation({ entity: 'workspace', kind: 'create', entityId: id, payload: { name } }),
  ]);
  expect(response.body.data.results[0].status).toBe('applied');
  return { id };
}

async function createCollection(
  user: TestUser,
  workspaceId: string,
  over: Record<string, unknown> = {},
): Promise<{ id: string }> {
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
  return { id };
}

async function createBookmark(
  user: TestUser,
  workspaceId: string,
  over: Record<string, unknown> = {},
): Promise<{ id: string }> {
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
  return { id };
}

describe('las lecturas de collections', () => {
  it('lista las de un workspace con su conteo y filtra las vacias', async () => {
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Personal');
    const llena = await createCollection(user, workspace.id, { name: 'Llena' });
    await createCollection(user, workspace.id, { name: 'Vacia' });
    await createBookmark(user, workspace.id, { collectionId: llena.id });

    const all = await api.get(`/collections?workspaceId=${workspace.id}`, user.accessToken);
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(2);
    const conteos = new Map(all.body.data.map((c: { id: string; bookmarkCount: number }) => [c.id, c.bookmarkCount]));
    expect(conteos.get(llena.id)).toBe(1);

    const sinVacias = await api.get(
      `/collections?workspaceId=${workspace.id}&includeEmpty=false`,
      user.accessToken,
    );
    expect(sinVacias.status).toBe(200);
    expect(sinVacias.body.data).toHaveLength(1);
    expect(sinVacias.body.data[0].id).toBe(llena.id);
  });

  it('el detalle de una coleccion trae su conteo', async () => {
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Personal');
    const collection = await createCollection(user, workspace.id, { name: 'Rust' });
    await createBookmark(user, workspace.id, { collectionId: collection.id });
    await createBookmark(user, workspace.id, { collectionId: collection.id });

    const response = await api.get(`/collections/${collection.id}`, user.accessToken);
    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(collection.id);
    expect(response.body.data.bookmarkCount).toBe(2);
  });

  it('borrar una coleccion es logico y sus bookmarks quedan vivos sin clasificar', async () => {
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Personal');
    const collection = await createCollection(user, workspace.id, { name: 'Se va' });
    const bookmark = await createBookmark(user, workspace.id, { collectionId: collection.id });

    const borrado = await api.delete(`/collections/${collection.id}`, user.accessToken);
    expect(borrado.status).toBe(204);

    const ausente = await api.get(`/collections/${collection.id}`, user.accessToken);
    expect(ausente.status).toBe(404);

    const vivo = await api.get(`/bookmarks/${bookmark.id}`, user.accessToken);
    expect(vivo.status).toBe(200);
    expect(vivo.body.data.collectionId).toBeNull();
  });

  it('el que no es miembro del workspace no ve nada', async () => {
    const user = await createVerifiedUser(api);
    const otro = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Personal');
    const collection = await createCollection(user, workspace.id);

    const lista = await api.get(`/collections?workspaceId=${workspace.id}`, otro.accessToken);
    expect(lista.status).toBe(404);

    const detalle = await api.get(`/collections/${collection.id}`, otro.accessToken);
    expect(detalle.status).toBe(404);
  });
});

describe('las lecturas de bookmarks', () => {
  it('lista los de un workspace y filtra por coleccion', async () => {
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Personal');
    const collection = await createCollection(user, workspace.id, { name: 'Rust' });
    await createBookmark(user, workspace.id, { collectionId: collection.id, title: 'Clasificado' });
    await createBookmark(user, workspace.id, { title: 'Sin clasificar' });

    const all = await api.get(`/bookmarks?workspaceId=${workspace.id}`, user.accessToken);
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(2);

    const filtered = await api.get(
      `/bookmarks?workspaceId=${workspace.id}&collectionId=${collection.id}`,
      user.accessToken,
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].title).toBe('Clasificado');

    const unclassified = await api.get(
      `/bookmarks?workspaceId=${workspace.id}&collectionId=unclassified`,
      user.accessToken,
    );
    expect(unclassified.status).toBe(200);
    expect(unclassified.body.data).toHaveLength(1);
    expect(unclassified.body.data[0].title).toBe('Sin clasificar');
  });

  it('el listado no trae el documento y el detalle si', async () => {
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Personal');
    const bookmark = await createBookmark(user, workspace.id);

    const all = await api.get(`/bookmarks?workspaceId=${workspace.id}`, user.accessToken);
    expect(all.status).toBe(200);
    expect(all.body.data[0]).not.toHaveProperty('document');
    expect(all.body.data[0]).not.toHaveProperty('plainText');

    const detalle = await api.get(`/bookmarks/${bookmark.id}`, user.accessToken);
    expect(detalle.status).toBe(200);
    expect(detalle.body.data).toHaveProperty('document');
    expect(detalle.body.data).toHaveProperty('plainText');
  });

  it('el que no es miembro del workspace no ve nada', async () => {
    const user = await createVerifiedUser(api);
    const otro = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Personal');
    const bookmark = await createBookmark(user, workspace.id);

    const lista = await api.get(`/bookmarks?workspaceId=${workspace.id}`, otro.accessToken);
    expect(lista.status).toBe(404);

    const detalle = await api.get(`/bookmarks/${bookmark.id}`, otro.accessToken);
    expect(detalle.status).toBe(404);
  });
});
