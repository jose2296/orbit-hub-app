import type { SyncOperation } from '@orbit-hub/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * Borrar una carpeta se lleva todo lo que hay dentro, de punta a punta.
 *
 * Antes el borrado solo tombstoneaba la carpeta: sus listas, notas, colecciones y
 * enlaces seguian vivos apuntando a una carpeta que ya no existe. Aqui se comprueba
 * que el pull trae cada uno ya borrado, y que lo que esta fuera no se toca.
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
    clientId: 'folder-delete-cascade-test',
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
): Promise<string> {
  const id = randomUUID();
  const response = await push(user, [operation({ entity, kind: 'create', entityId: id, payload })]);
  expect(response.body.data.results[0].status).toBe('applied');
  return id;
}

async function remove(user: TestUser, entity: SyncOperation['entity'], id: string, version: number) {
  const response = await push(user, [
    operation({ entity, kind: 'delete', entityId: id, baseVersion: version }),
  ]);
  return response.body.data.results[0] as { status: string };
}

async function pull(user: TestUser) {
  const response = await api.post('/sync/pull', { cursor: null, limit: 500 }, user.accessToken);
  expect(response.status).toBe(200);
  const changes = response.body.data.changes as {
    entity: string;
    record: Record<string, unknown> & { id: string; deletedAt: string | null };
  }[];
  return (entity: string, id: string) =>
    changes.find((change) => change.entity === entity && change.record.id === id)?.record;
}

describe('borrar una carpeta', () => {
  it('se lleva su contenido y no toca lo que esta fuera', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await create(user, 'workspace', { name: 'Personal' });
    const folderId = await create(user, 'folder', {
      workspaceId,
      parentId: null,
      name: 'Carpeta',
      position: 0,
    });
    const subfolderId = await create(user, 'folder', {
      workspaceId,
      parentId: folderId,
      name: 'Dentro',
      position: 0,
    });
    const listId = await create(user, 'list', {
      workspaceId,
      folderId,
      kind: 'tasks',
      title: 'Lista',
    });
    const noteId = await create(user, 'note', {
      workspaceId,
      folderId: subfolderId,
      title: 'Nota',
      document: '<p>x</p>',
    });
    const collectionId = await create(user, 'collection', {
      workspaceId,
      folderId,
      name: 'Coleccion',
      position: 0,
    });
    const bookmarkInFolder = await create(user, 'bookmark', {
      workspaceId,
      folderId,
      url: 'https://example.com/a',
      title: 'Enlace en carpeta',
      tags: [],
      position: 0,
    });
    const bookmarkInCollection = await create(user, 'bookmark', {
      workspaceId,
      url: 'https://example.com/b',
      title: 'Enlace en coleccion',
      collectionId,
      tags: [],
      position: 0,
    });
    const outside = await create(user, 'bookmark', {
      workspaceId,
      url: 'https://example.com/c',
      title: 'Enlace fuera',
      tags: [],
      position: 0,
    });

    const result = await remove(user, 'folder', folderId, 1);
    expect(result.status).toBe('applied');

    const find = await pull(user);
    expect(find('folder', folderId)?.deletedAt).not.toBeNull();
    expect(find('folder', subfolderId)?.deletedAt).not.toBeNull();
    expect(find('list', listId)?.deletedAt).not.toBeNull();
    expect(find('note', noteId)?.deletedAt).not.toBeNull();
    expect(find('collection', collectionId)?.deletedAt).not.toBeNull();
    expect(find('bookmark', bookmarkInFolder)?.deletedAt).not.toBeNull();
    expect(find('bookmark', bookmarkInCollection)?.deletedAt).not.toBeNull();
    expect(find('bookmark', outside)?.deletedAt).toBeNull();
  });
});
