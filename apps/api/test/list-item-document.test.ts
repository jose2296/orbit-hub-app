import type { SyncOperation } from '@orbit-hub/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * La descripcion de una tarea es un documento, como el de una nota.
 *
 * `annotation` sigue existiendo y pasa a ser el texto plano **derivado** del documento: la
 * vista previa de la fila, el export y la busqueda leen ese campo, y un cliente que pudiera
 * escribir los dos por separado haria que la fila dijera una cosa y la hoja otra.
 */
let api: TestServer;

beforeAll(async () => {
  api = await startTestServer();
});

afterAll(async () => {
  await api.close();
});

const operation = (
  over: Partial<SyncOperation> & Pick<SyncOperation, 'entity' | 'kind' | 'entityId'>,
) => ({
  operationId: randomUUID(),
  clientId: 'list-item-document-test',
  baseVersion: 0,
  payload: null,
  base: null,
  clientTimestamp: new Date().toISOString(),
  ...over,
});

async function push(user: TestUser, operations: SyncOperation[]) {
  const response = await api.post(
    '/sync/push',
    { deviceId: randomUUID(), lastPulledAt: null, operations },
    user.accessToken,
  );
  return response.body.data.results as { status: string; version?: number; error?: string }[];
}

async function listOfUser(user: TestUser) {
  const workspaceId = randomUUID();
  await push(user, [
    operation({ entity: 'workspace', kind: 'create', entityId: workspaceId, payload: { name: 'W' } }),
  ]);
  const listId = randomUUID();
  await push(user, [
    operation({
      entity: 'list',
      kind: 'create',
      entityId: listId,
      payload: { workspaceId, kind: 'tasks', title: 'L' },
    }),
  ]);
  return listId;
}

async function readItem(user: TestUser, id: string) {
  const response = await api.post('/sync/pull', { cursor: null, limit: 500 }, user.accessToken);
  const changes = response.body.data.changes as { entity: string; record: Record<string, unknown> }[];
  return changes.filter((c) => c.entity === 'list_item' && c.record['id'] === id).at(-1)?.record;
}

describe('la descripcion de una tarea es un documento', () => {
  it('se guarda con su formato y la anotacion sale del texto plano', async () => {
    const user = await createVerifiedUser(api);
    const listId = await listOfUser(user);
    const id = randomUUID();

    const [result] = await push(user, [
      operation({
        entity: 'list_item',
        kind: 'create',
        entityId: id,
        payload: { listId, title: 'T', position: 0, document: '<p>hola <b>mundo</b></p><ul><li>uno</li></ul>' },
      }),
    ]);

    expect(result?.status).toBe('applied');
    const item = await readItem(user, id);
    expect(item?.['document']).toBe('<p>hola <b>mundo</b></p><ul><li>uno</li></ul>');
    expect(item?.['annotation']).toContain('hola mundo');
    expect(item?.['annotation']).toContain('uno');
  });

  it('un update del documento rehace la anotacion', async () => {
    const user = await createVerifiedUser(api);
    const listId = await listOfUser(user);
    const id = randomUUID();
    const [created] = await push(user, [
      operation({
        entity: 'list_item',
        kind: 'create',
        entityId: id,
        payload: { listId, title: 'T', position: 0, document: '<p>antes</p>' },
      }),
    ]);

    const [updated] = await push(user, [
      operation({
        entity: 'list_item',
        kind: 'update',
        entityId: id,
        baseVersion: created?.version ?? 1,
        payload: { document: '<p>despues</p>' },
      }),
    ]);

    expect(updated?.status).toBe('applied');
    const item = await readItem(user, id);
    expect(item?.['annotation']).toBe('despues');
  });

  it('un documento que el editor no produce se rechaza, y no se guarda', async () => {
    const user = await createVerifiedUser(api);
    const listId = await listOfUser(user);
    const id = randomUUID();

    const [result] = await push(user, [
      operation({
        entity: 'list_item',
        kind: 'create',
        entityId: id,
        payload: { listId, title: 'T', position: 0, document: '<p>x</p><script>alert(1)</script>' },
      }),
    ]);

    expect(result?.status).not.toBe('applied');
    expect(await readItem(user, id)).toBeUndefined();
  });

  it('una tarea antigua con solo anotacion sigue legible: document vacio', async () => {
    const user = await createVerifiedUser(api);
    const listId = await listOfUser(user);
    const id = randomUUID();

    await push(user, [
      operation({
        entity: 'list_item',
        kind: 'create',
        entityId: id,
        payload: { listId, title: 'T', position: 0, annotation: 'texto plano' },
      }),
    ]);

    const item = await readItem(user, id);
    expect(item?.['annotation']).toBe('texto plano');
    expect(item?.['document']).toBe('');
  });
});
