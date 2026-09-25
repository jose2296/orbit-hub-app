import {
  dashboardLayoutSchema,
  listFoldersResponseSchema,
  listWorkspaceMembersResponseSchema,
  listWorkspacesResponseSchema,
  workspaceSchema,
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

/** Creates a workspace through the sync engine, like the app does. */
async function createWorkspace(user: TestUser, name: string, emoji?: string) {
  const id = randomUUID();
  const response = await api.post(
    '/sync/push',
    {
      deviceId: randomUUID(),
      lastPulledAt: null,
      operations: [
        {
          operationId: randomUUID(),
          clientId: 'test-client-workspaces',
          entity: 'workspace',
          kind: 'create',
          entityId: id,
          baseVersion: 0,
          payload: { name, ...(emoji ? { emoji } : {}) },
          base: null,
          clientTimestamp: new Date().toISOString(),
        },
      ],
    },
    user.accessToken,
  );

  expect(response.body.data.results[0].status).toBe('applied');
  return id;
}

async function createFolder(
  user: TestUser,
  workspaceId: string,
  name: string,
  parentId: string | null = null,
  position = 0,
) {
  const id = randomUUID();
  const response = await api.post(
    '/sync/push',
    {
      deviceId: randomUUID(),
      lastPulledAt: null,
      operations: [
        {
          operationId: randomUUID(),
          clientId: 'test-client-workspaces',
          entity: 'folder',
          kind: 'create',
          entityId: id,
          baseVersion: 0,
          payload: { name, workspaceId, parentId, position },
          base: null,
          clientTimestamp: new Date().toISOString(),
        },
      ],
    },
    user.accessToken,
  );

  expect(response.body.data.results[0].status).toBe('applied');
  return id;
}

describe('GET /workspaces', () => {
  it('requires authentication', async () => {
    expect((await api.get('/workspaces')).status).toBe(401);
  });

  it('returns only the workspaces the user belongs to', async () => {
    const mine = await createVerifiedUser(api);
    const other = await createVerifiedUser(api);

    await createWorkspace(mine, 'Mi casa');
    await createWorkspace(mine, 'Mi trabajo');
    const strangerWorkspace = await createWorkspace(other, 'La otra');

    const response = await api.get('/workspaces', mine.accessToken);
    expect(response.status).toBe(200);

    const parsed = listWorkspacesResponseSchema.safeParse(response.body.data);
    expect(parsed.success).toBe(true);

    const names = response.body.data.items.map((item: { name: string }) => item.name);
    expect(names).toEqual(expect.arrayContaining(['Mi casa', 'Mi trabajo']));
    expect(names).not.toContain('La otra');
    expect(response.body.data.items.map((i: { id: string }) => i.id)).not.toContain(strangerWorkspace);
  });

  it('returns a contract valid workspace with role and member count', async () => {
    const user = await createVerifiedUser(api);
    const id = await createWorkspace(user, 'Con emoji', '🏡');

    const response = await api.get('/workspaces', user.accessToken);
    const workspace = response.body.data.items.find((item: { id: string }) => item.id === id);

    expect(workspaceSchema.safeParse(workspace).success).toBe(true);
    expect(workspace.role).toBe('owner');
    expect(workspace.memberCount).toBe(1);
    expect(workspace.emoji).toBe('🏡');
    expect(workspace.deletedAt).toBeNull();
  });

  it('hides a deleted workspace from the list', async () => {
    const user = await createVerifiedUser(api);
    const id = await createWorkspace(user, 'Efímera');

    await api.post(
      '/sync/push',
      {
        deviceId: randomUUID(),
        lastPulledAt: null,
        operations: [
          {
            operationId: randomUUID(),
            clientId: 'test-client-workspaces',
            entity: 'workspace',
            kind: 'delete',
            entityId: id,
            baseVersion: 0,
            payload: null,
            base: null,
            clientTimestamp: new Date().toISOString(),
          },
        ],
      },
      user.accessToken,
    );

    const response = await api.get('/workspaces', user.accessToken);
    expect(response.body.data.items.map((i: { id: string }) => i.id)).not.toContain(id);
  });

  it('paginates with a cursor', async () => {
    const user = await createVerifiedUser(api);
    await createWorkspace(user, 'A');
    await createWorkspace(user, 'B');
    await createWorkspace(user, 'C');

    const first = await api.get('/workspaces?limit=2', user.accessToken);
    expect(first.body.data.items).toHaveLength(2);
    expect(first.body.data.nextCursor).toBeTruthy();

    const second = await api.get(
      `/workspaces?limit=2&cursor=${encodeURIComponent(first.body.data.nextCursor)}`,
      user.accessToken,
    );
    const firstIds = first.body.data.items.map((i: { id: string }) => i.id);
    const secondIds = second.body.data.items.map((i: { id: string }) => i.id);

    expect(secondIds.length).toBeGreaterThan(0);
    expect(firstIds.some((id: string) => secondIds.includes(id))).toBe(false);
  });

  it('validates the query', async () => {
    const user = await createVerifiedUser(api);
    const response = await api.get('/workspaces?limit=9999', user.accessToken);

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('validation_failed');
  });
});

describe('GET /workspaces/:id', () => {
  it('returns a workspace the user belongs to', async () => {
    const user = await createVerifiedUser(api);
    const id = await createWorkspace(user, 'Detalle');

    const response = await api.get(`/workspaces/${id}`, user.accessToken);

    expect(response.status).toBe(200);
    expect(workspaceSchema.safeParse(response.body.data).success).toBe(true);
  });

  it('answers 404 for a workspace of another user', async () => {
    const mine = await createVerifiedUser(api);
    const other = await createVerifiedUser(api);
    const otherWorkspace = await createWorkspace(other, 'Privada');

    const response = await api.get(`/workspaces/${otherWorkspace}`, mine.accessToken);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_found');
  });

  it('rejects a malformed id', async () => {
    const user = await createVerifiedUser(api);
    const response = await api.get('/workspaces/not-a-uuid', user.accessToken);

    expect(response.status).toBe(422);
  });
});

describe('GET /workspaces/:id/folders', () => {
  it('lists folders ordered by position', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Con carpetas');

    await createFolder(user, workspaceId, 'Segundo', null, 1);
    await createFolder(user, workspaceId, 'Primero', null, 0);

    const response = await api.get(`/workspaces/${workspaceId}/folders`, user.accessToken);

    expect(response.status).toBe(200);
    expect(listFoldersResponseSchema.safeParse(response.body.data).success).toBe(true);
    expect(response.body.data.items.map((f: { name: string }) => f.name)).toEqual([
      'Primero',
      'Segundo',
    ]);
  });

  it('filters to the root level with parentId=root', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Anidada');

    const root = await createFolder(user, workspaceId, 'Raíz');
    await createFolder(user, workspaceId, 'Hija', root);

    const response = await api.get(
      `/workspaces/${workspaceId}/folders?parentId=root`,
      user.accessToken,
    );

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].name).toBe('Raíz');
    expect(response.body.data.items[0].parentId).toBeNull();
  });

  it('does not leak folders of a workspace the user cannot see', async () => {
    const mine = await createVerifiedUser(api);
    const other = await createVerifiedUser(api);
    const otherWorkspace = await createWorkspace(other, 'Secreta');
    await createFolder(other, otherWorkspace, 'Documentos');

    const response = await api.get(`/workspaces/${otherWorkspace}/folders`, mine.accessToken);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_found');
  });

  it('ignores a soft deleted folder', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Con baja');
    const folderId = await createFolder(user, workspaceId, 'Se va');

    await api.post(
      '/sync/push',
      {
        deviceId: randomUUID(),
        lastPulledAt: null,
        operations: [
          {
            operationId: randomUUID(),
            clientId: 'test-client-workspaces',
            entity: 'folder',
            kind: 'delete',
            entityId: folderId,
            baseVersion: 0,
            payload: null,
            base: null,
            clientTimestamp: new Date().toISOString(),
          },
        ],
      },
      user.accessToken,
    );

    const response = await api.get(`/workspaces/${workspaceId}/folders`, user.accessToken);
    expect(response.body.data.items).toHaveLength(0);
  });
});

describe('GET /workspaces/:id/members', () => {
  it('lists the members with their role', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Compartida');

    const response = await api.get(`/workspaces/${workspaceId}/members`, user.accessToken);

    expect(response.status).toBe(200);
    expect(listWorkspaceMembersResponseSchema.safeParse(response.body.data).success).toBe(true);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].role).toBe('owner');
    expect(response.body.data.items[0].user.id).toBe(user.userId);
  });

  it('hides the member list of a workspace the user cannot see', async () => {
    const mine = await createVerifiedUser(api);
    const other = await createVerifiedUser(api);
    const otherWorkspace = await createWorkspace(other, 'Suya');

    expect((await api.get(`/workspaces/${otherWorkspace}/members`, mine.accessToken)).status).toBe(404);
  });
});

describe('GET /dashboard', () => {
  it('requires authentication', async () => {
    expect((await api.get('/dashboard')).status).toBe(401);
  });

  it('returns an empty layout when the user has never customised it', async () => {
    const user = await createVerifiedUser(api);
    const response = await api.get('/dashboard', user.accessToken);

    expect(response.status).toBe(200);
    expect(dashboardLayoutSchema.safeParse(response.body.data).success).toBe(true);
    expect(response.body.data.layout).toEqual([]);
    expect(response.body.data.version).toBe(0);
  });

  it('returns the saved layout after a sync write', async () => {
    const user = await createVerifiedUser(api);

    const layout = [
      { id: 'recent', kind: 'recent_lists', x: 0, y: 0, w: 6, h: 4, pinned: true },
      { id: 'tasks', kind: 'tasks', x: 6, y: 0, w: 6, h: 4, pinned: false },
    ];

    const response = await api.post(
      '/sync/push',
      {
        deviceId: randomUUID(),
        lastPulledAt: null,
        operations: [
          {
            operationId: randomUUID(),
            clientId: 'test-client-workspaces',
            entity: 'dashboard',
            kind: 'update',
            entityId: randomUUID(),
            baseVersion: 0,
            payload: { layout },
            base: null,
            clientTimestamp: new Date().toISOString(),
          },
        ],
      },
      user.accessToken,
    );

    expect(response.body.data.results[0].status).toBe('applied');

    const dashboard = await api.get('/dashboard', user.accessToken);
    expect(dashboardLayoutSchema.safeParse(dashboard.body.data).success).toBe(true);
    expect(dashboard.body.data.layout).toEqual(layout);
    expect(dashboard.body.data.version).toBe(1);
  });

  it('never returns another user layout', async () => {
    const mine = await createVerifiedUser(api);
    const other = await createVerifiedUser(api);

    await api.post(
      '/sync/push',
      {
        deviceId: randomUUID(),
        lastPulledAt: null,
        operations: [
          {
            operationId: randomUUID(),
            clientId: 'test-client-workspaces',
            entity: 'dashboard',
            kind: 'update',
            entityId: randomUUID(),
            baseVersion: 0,
            payload: { layout: [{ id: 'a', kind: 'stats', x: 0, y: 0, w: 4, h: 2, pinned: false }] },
            base: null,
            clientTimestamp: new Date().toISOString(),
          },
        ],
      },
      other.accessToken,
    );

    const mineDashboard = await api.get('/dashboard', mine.accessToken);
    expect(mineDashboard.body.data.layout).toEqual([]);
  });
});
