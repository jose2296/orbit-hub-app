import {
  listItemsResponseSchema,
  listSchema,
  searchResponseSchema,
} from '@orbit-hub/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

let api: TestServer;

beforeAll(async () => {
  api = await startTestServer();
});

afterAll(async () => {
  await api.close();
});

type OperationInput = {
  entity: string;
  kind: 'create' | 'update' | 'delete';
  entityId: string;
  baseVersion?: number;
  payload?: Record<string, unknown> | null;
  base?: Record<string, unknown> | null;
};

async function sync(user: TestUser, operations: OperationInput[]) {
  return api.post(
    '/sync/push',
    {
      deviceId: randomUUID(),
      lastPulledAt: null,
      operations: operations.map((operation) => ({
        operationId: randomUUID(),
        clientId: 'test-client-lists',
        entityId: operation.entityId,
        baseVersion: operation.baseVersion ?? 0,
        payload: operation.payload ?? null,
        base: operation.base ?? null,
        clientTimestamp: new Date().toISOString(),
        entity: operation.entity,
        kind: operation.kind,
      })),
    },
    user.accessToken,
  );
}

async function createWorkspace(user: TestUser, name: string): Promise<string> {
  const id = randomUUID();
  const response = await sync(user, [
    { entity: 'workspace', kind: 'create', entityId: id, payload: { name } },
  ]);
  expect(response.body.data.results[0].status).toBe('applied');
  return id;
}

async function createList(
  user: TestUser,
  workspaceId: string,
  overrides: Partial<OperationInput['payload']> = {},
): Promise<string> {
  const id = randomUUID();
  const response = await sync(user, [
    {
      entity: 'list',
      kind: 'create',
      entityId: id,
      payload: { workspaceId, kind: 'tasks', title: 'Lista', ...overrides },
    },
  ]);
  expect(response.body.data.results[0].status).toBe('applied');
  return id;
}

async function createItem(
  user: TestUser,
  listId: string,
  overrides: Partial<OperationInput['payload']> = {},
): Promise<string> {
  const id = randomUUID();
  const response = await sync(user, [
    {
      entity: 'list_item',
      kind: 'create',
      entityId: id,
      payload: { listId, title: 'Elemento', ...overrides },
    },
  ]);
  expect(response.body.data.results[0].status).toBe('applied');
  return id;
}

describe('lists through sync', () => {
  it('creates a list of each kind', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Con listas');

    for (const kind of ['tasks', 'movies', 'books'] as const) {
      const id = await createList(user, workspaceId, { kind, title: `Lista de ${kind}` });
      const response = await api.get(`/lists/${id}`, user.accessToken);
      expect(response.body.data.kind).toBe(kind);
    }
  });

  it('rejects a list without a workspace', async () => {
    const user = await createVerifiedUser(api);
    const response = await sync(user, [
      { entity: 'list', kind: 'create', entityId: randomUUID(), payload: { title: 'Huerfana' } },
    ]);

    expect(response.body.data.results[0].status).toBe('rejected');
    expect(response.body.data.results[0].error).toContain('workspaceId');
  });

  it('ignores an unknown kind and falls back to tasks', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Kinds');
    const id = await createList(user, workspaceId, { kind: 'albums' });

    const response = await api.get(`/lists/${id}`, user.accessToken);
    expect(response.body.data.kind).toBe('tasks');
  });

  it('refuses to create a list in a workspace of another user', async () => {
    const mine = await createVerifiedUser(api);
    const other = await createVerifiedUser(api);
    const otherWorkspace = await createWorkspace(other, 'Suya');

    const response = await sync(mine, [
      {
        entity: 'list',
        kind: 'create',
        entityId: randomUUID(),
        payload: { workspaceId: otherWorkspace, title: 'Me la quedo' },
      },
    ]);

    expect(response.body.data.results[0].status).toBe('rejected');
    expect(response.body.data.results[0].error).toContain('not found');
  });

  it('rejects an item without a list', async () => {
    const user = await createVerifiedUser(api);
    const response = await sync(user, [
      { entity: 'list_item', kind: 'create', entityId: randomUUID(), payload: { title: 'Suelto' } },
    ]);

    expect(response.body.data.results[0].status).toBe('rejected');
    expect(response.body.data.results[0].error).toContain('listId');
  });

  it('rejects an item whose list belongs to another user', async () => {
    const mine = await createVerifiedUser(api);
    const other = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(other, 'Suya');
    const listId = await createList(other, workspaceId);

    const response = await sync(mine, [
      { entity: 'list_item', kind: 'create', entityId: randomUUID(), payload: { listId, title: 'Intruso' } },
    ]);

    expect(response.body.data.results[0].status).toBe('rejected');
  });

  it('stores provider metadata and external ids for movies and books', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Providers');
    const listId = await createList(user, workspaceId, { kind: 'movies', title: 'Para ver' });

    const itemId = await createItem(user, listId, {
      title: 'Blade Runner',
      externalId: '78',
      metadata: { year: 1982, directors: ['Ridley Scott'] },
    });

    const response = await api.get(`/lists/${listId}/items`, user.accessToken);
    const item = response.body.data.items.find((row: { id: string }) => row.id === itemId);

    expect(item.externalId).toBe('78');
    expect(item.metadata).toEqual({ year: 1982, directors: ['Ridley Scott'] });
  });

  it('drops a priority the server does not know', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Prioridad');
    const listId = await createList(user, workspaceId);
    const itemId = await createItem(user, listId, { title: 'Urgente', priority: 'urgentísimo' });

    const response = await api.get(`/lists/${listId}/items`, user.accessToken);
    const item = response.body.data.items.find((row: { id: string }) => row.id === itemId);

    expect(item.priority).toBe('none');
  });

  it('toggles completion through a versioned update', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Tareas');
    const listId = await createList(user, workspaceId);
    const itemId = await createItem(user, listId, { title: 'Comprar pan' });

    const before = await api.get(`/lists/${listId}/items`, user.accessToken);
    const version = before.body.data.items.find((row: { id: string }) => row.id === itemId).version;

    const response = await sync(user, [
      {
        entity: 'list_item',
        kind: 'update',
        entityId: itemId,
        baseVersion: version,
        base: { completed: false },
        payload: { completed: true },
      },
    ]);

    expect(response.body.data.results[0].status).toBe('applied');

    const done = await api.get(`/lists/${listId}/items?completed=true`, user.accessToken);
    expect(done.body.data.items.map((row: { id: string }) => row.id)).toContain(itemId);
  });

  it('deletes a list with a tombstone that reaches a pull', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Efímera');
    const listId = await createList(user, workspaceId, { title: 'Se va' });

    const pullBefore = await api.post('/sync/pull', { cursor: null, limit: 100 }, user.accessToken);
    await sync(user, [{ entity: 'list', kind: 'delete', entityId: listId }]);

    const pullAfter = await api.post(
      '/sync/pull',
      { cursor: pullBefore.body.data.nextCursor, limit: 100 },
      user.accessToken,
    );
    const tombstone = (pullAfter.body.data.changes as {
      entity: string;
      record: { id: string; deletedAt: string | null };
    }[]).find((change) => change.record.id === listId);

    expect(tombstone?.entity).toBe('list');
    expect(tombstone?.record.deletedAt).toBeTruthy();
  });
});

describe('GET /lists', () => {
  it('requires authentication', async () => {
    expect((await api.get('/lists')).status).toBe(401);
  });

  it('lists the lists of a workspace, filterable by kind', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Mixto');
    await createList(user, workspaceId, { kind: 'tasks', title: 'Tareas' });
    await createList(user, workspaceId, { kind: 'movies', title: 'Peliculas' });
    await createList(user, workspaceId, { kind: 'books', title: 'Libros' });

    const all = await api.get(`/lists?workspaceId=${workspaceId}`, user.accessToken);
    expect(all.status).toBe(200);
    expect(all.body.data.items).toHaveLength(3);
    expect(listSchema.safeParse(all.body.data.items[0]).success).toBe(true);

    const movies = await api.get(`/lists?workspaceId=${workspaceId}&kind=movies`, user.accessToken);
    expect(movies.body.data.items).toHaveLength(1);
    expect(movies.body.data.items[0].title).toBe('Peliculas');
  });

  it('returns the item count in the list detail', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Con items');
    const listId = await createList(user, workspaceId);
    await createItem(user, listId, { title: 'Uno' });
    await createItem(user, listId, { title: 'Dos' });

    const response = await api.get(`/lists/${listId}`, user.accessToken);
    expect(response.body.data.itemCount).toBe(2);
  });

  it('hides lists of a workspace the user cannot see', async () => {
    const mine = await createVerifiedUser(api);
    const other = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(other, 'Suya');
    const listId = await createList(other, workspaceId, { title: 'Secreta' });

    expect((await api.get(`/lists?workspaceId=${workspaceId}`, mine.accessToken)).status).toBe(404);
    expect((await api.get(`/lists/${listId}`, mine.accessToken)).status).toBe(404);
    expect((await api.get(`/lists/${listId}/items`, mine.accessToken)).status).toBe(404);
  });

  it('validates the query', async () => {
    const user = await createVerifiedUser(api);
    const response = await api.get('/lists?kind=albums', user.accessToken);

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('validation_failed');
  });
});

describe('GET /lists/:id/items', () => {
  it('orders items by position and filters by completion', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Orden');
    const listId = await createList(user, workspaceId);

    const second = await createItem(user, listId, { title: 'Segundo', position: 1 });
    const first = await createItem(user, listId, { title: 'Primero', position: 0 });
    const done = await createItem(user, listId, { title: 'Hecho', position: 2, completed: true });

    const response = await api.get(`/lists/${listId}/items`, user.accessToken);
    expect(listItemsResponseSchema.safeParse(response.body.data).success).toBe(true);
    expect(response.body.data.items.map((row: { id: string }) => row.id)).toEqual([
      first,
      second,
      done,
    ]);

    const pending = await api.get(`/lists/${listId}/items?completed=false`, user.accessToken);
    expect(pending.body.data.items.map((row: { id: string }) => row.id)).toEqual([first, second]);
  });
});

describe('GET /search', () => {
  it('requires authentication', async () => {
    expect((await api.get('/search?q=algo')).status).toBe(401);
  });

  it('finds workspaces, folders, lists and items', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Vacaciones');
    const folderId = randomUUID();

    await sync(user, [
      {
        entity: 'folder',
        kind: 'create',
        entityId: folderId,
        payload: { workspaceId, name: 'Itinerarios' },
      },
    ]);

    const listId = await createList(user, workspaceId, { title: 'Playas 2026' });
    await createItem(user, listId, { title: 'Menorca' });

    const response = await api.get('/search?q=2026', user.accessToken);
    expect(response.status).toBe(200);
    expect(searchResponseSchema.safeParse(response.body.data).success).toBe(true);

    const scopes = (response.body.data.items as { scope: string }[]).map((row) => row.scope);
    expect(scopes).toContain('list');

    const byPlayas = await api.get('/search?q=playas', user.accessToken);
    expect(byPlayas.body.data.items[0].title).toBe('Playas 2026');
  });

  it('searches items and points at their list', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Libros');
    const listId = await createList(user, workspaceId, { kind: 'books', title: 'Pendientes' });
    await createItem(user, listId, { title: 'Neuhausen' });

    const response = await api.get('/search?q=neuhausen', user.accessToken);
    const hit = response.body.data.items[0];

    expect(hit.scope).toBe('list_item');
    expect(hit.listId).toBe(listId);
    expect(hit.kind).toBe('books');
    expect(hit.subtitle).toBe('Pendientes');
  });

  it('filters by kind', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Mezcla');
    await createList(user, workspaceId, { kind: 'movies', title: 'Cine 2026' });
    await createList(user, workspaceId, { kind: 'books', title: 'Libros 2026' });

    const movies = await api.get('/search?q=2026&kind=movies', user.accessToken);
    expect(movies.body.data.items.every((row: { kind: string }) => row.kind === 'movies')).toBe(true);
    expect(movies.body.data.items).toHaveLength(1);
  });

  it('never returns another user data', async () => {
    const mine = await createVerifiedUser(api);
    const other = await createVerifiedUser(api);
    await createWorkspace(other, 'Documentos confidentiales');

    const response = await api.get('/search?q=confidenciales', mine.accessToken);
    expect(response.body.data.items).toHaveLength(0);
  });

  it('ignores wildcards the user typed', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Coche');
    await createList(user, workspaceId, { title: 'Mantenimiento' });

    const response = await api.get('/search?q=%25', user.accessToken);
    expect(response.body.data.items).toHaveLength(0);
  });

  it('rejects an empty query', async () => {
    const user = await createVerifiedUser(api);
    const response = await api.get('/search?q=', user.accessToken);

    expect(response.status).toBe(422);
  });
});
