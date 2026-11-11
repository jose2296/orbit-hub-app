import type { SyncOperation } from '@orbit-hub/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * Exportar una sola columna de un tablero.
 *
 * Con `stateId` en el query, el fichero trae solo las tareas de ese estado, en JSON
 * y en CSV, y el recuento cuadra con lo que viaja. Sin el, la lista entera.
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
    clientId: 'list-export-state-test',
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

async function download(user: TestUser, path: string) {
  const response = await fetch(`${api.url}${path}`, {
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
  return { status: response.status, text: await response.text() };
}

describe('exportar una columna de un tablero', () => {
  it('sale solo con las tareas de ese estado, en JSON y en CSV', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await create(user, 'workspace', { name: 'Personal' });
    const pendiente = randomUUID();
    const hecha = randomUUID();
    const listId = await create(user, 'list', {
      workspaceId,
      folderId: null,
      kind: 'board',
      title: 'Tablero',
      states: [
        { id: pendiente, title: 'Pendiente', color: 'neutral' },
        { id: hecha, title: 'Hecha', color: 'green', done: true },
      ],
    });
    await create(user, 'list_item', { listId, title: 'Tarea en pendiente', stateId: pendiente, position: 0, completed: false });
    await create(user, 'list_item', { listId, title: 'Tarea en hecha', stateId: hecha, position: 1, completed: false });

    const json = await download(user, `/lists/${listId}/export?format=json&stateId=${hecha}`);
    expect(json.status).toBe(200);
    const sobre = JSON.parse(json.text) as { items: { title: string; stateTitle: string | null }[]; counts: { items: number } };
    expect(sobre.items.map((item) => item.title)).toEqual(['Tarea en hecha']);
    expect(sobre.items[0]?.stateTitle).toBe('Hecha');
    expect(sobre.counts.items).toBe(1);

    const csv = await download(user, `/lists/${listId}/export?format=csv&stateId=${hecha}`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('Tarea en hecha');
    expect(csv.text).not.toContain('Tarea en pendiente');
  });

  it('sin stateId exporta la lista entera', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await create(user, 'workspace', { name: 'Personal' });
    const estado = randomUUID();
    const listId = await create(user, 'list', {
      workspaceId,
      folderId: null,
      kind: 'board',
      title: 'Tablero',
      states: [{ id: estado, title: 'Pendiente', color: 'neutral' }],
    });
    await create(user, 'list_item', { listId, title: 'Una', stateId: estado, position: 0, completed: false });
    await create(user, 'list_item', { listId, title: 'Dos', stateId: null, position: 1, completed: false });

    const json = await download(user, `/lists/${listId}/export?format=json`);
    const sobre = JSON.parse(json.text) as { items: unknown[] };
    expect(sobre.items).toHaveLength(2);
  });
});
