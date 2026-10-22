import type { SyncOperation } from '@orbit-hub/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * Un bookmark sin espacio: de quien lo creo y de nadie mas.
 *
 * Hoy la pertenencia de una fila sale de su espacio. Sin espacio no hay de donde
 * sacarla, asi que el bookmark lleva `ownerId`, y es lo unico que lo protege: sin ese
 * chequeo cualquiera que supiera el id podria leerlo, moverlo o borrarlo.
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
    clientId: 'bookmarks-unassigned-test',
    baseVersion: 0,
    payload: null,
    base: null,
    clientTimestamp: new Date().toISOString(),
    ...over,
  };
}

async function push(user: TestUser, operations: SyncOperation[]) {
  const response = await api.post(
    '/sync/push',
    { deviceId: randomUUID(), lastPulledAt: null, operations },
    user.accessToken,
  );
  return response.body.data.results as { status: string; version?: number; message?: string }[];
}

async function createWorkspace(user: TestUser, name: string) {
  const id = randomUUID();
  const [result] = await push(user, [
    operation({ entity: 'workspace', kind: 'create', entityId: id, payload: { name } }),
  ]);
  expect(result?.status).toBe('applied');
  return id;
}

async function createBookmark(user: TestUser, over: Record<string, unknown> = {}) {
  const id = randomUUID();
  const [result] = await push(user, [
    operation({
      entity: 'bookmark',
      kind: 'create',
      entityId: id,
      payload: { workspaceId: null, url: 'https://example.com/a', title: 'A', tags: [], position: 0, ...over },
    }),
  ]);
  return { id, result: result as { status: string; version?: number; message?: string } };
}

async function pull(user: TestUser) {
  const response = await api.post('/sync/pull', { cursor: null, limit: 500 }, user.accessToken);
  expect(response.status).toBe(200);
  const changes = response.body.data.changes as {
    entity: string;
    record: Record<string, unknown> & { id: string };
  }[];
  return (id: string) =>
    changes.find((change) => change.entity === 'bookmark' && change.record.id === id)?.record;
}

describe('un bookmark sin espacio', () => {
  it('se crea sin espacio y le llega a su dueno', async () => {
    const user = await createVerifiedUser(api);
    const { id, result } = await createBookmark(user);

    expect(result.status).toBe('applied');
    const record = (await pull(user))(id);
    expect(record).toBeDefined();
    expect(record?.workspaceId).toBeNull();
    expect(record?.folderId).toBeNull();
  });

  it('no le llega a nadie mas', async () => {
    const user = await createVerifiedUser(api);
    const otra = await createVerifiedUser(api);
    const { id } = await createBookmark(user);

    expect((await pull(otra))(id)).toBeUndefined();
  });

  it('no puede llevar carpeta ni coleccion: son de un espacio', async () => {
    const user = await createVerifiedUser(api);
    const espacio = await createWorkspace(user, 'A');
    const carpeta = randomUUID();
    await push(user, [
      operation({
        entity: 'folder',
        kind: 'create',
        entityId: carpeta,
        payload: { workspaceId: espacio, parentId: null, name: 'F', position: 0 },
      }),
    ]);

    const { result } = await createBookmark(user, { folderId: carpeta });

    expect(result.status).not.toBe('applied');
  });

  it('otro usuario no lo puede editar ni borrar', async () => {
    const user = await createVerifiedUser(api);
    const otra = await createVerifiedUser(api);
    const { id, result } = await createBookmark(user);

    const [editar] = await push(otra, [
      operation({
        entity: 'bookmark',
        kind: 'update',
        entityId: id,
        baseVersion: result.version ?? 1,
        payload: { title: 'Mio ahora' },
      }),
    ]);
    const [borrar] = await push(otra, [
      operation({
        entity: 'bookmark',
        kind: 'delete',
        entityId: id,
        baseVersion: result.version ?? 1,
      }),
    ]);

    expect(editar?.status).not.toBe('applied');
    expect(borrar?.status).not.toBe('applied');
    expect((await pull(user))(id)?.title).toBe('A');
  });

  it('el dueno lo asigna a un espacio, y puede dejarlo otra vez sin espacio', async () => {
    const user = await createVerifiedUser(api);
    const espacio = await createWorkspace(user, 'A');
    const { id, result } = await createBookmark(user);

    const [asignar] = await push(user, [
      operation({
        entity: 'bookmark',
        kind: 'update',
        entityId: id,
        baseVersion: result.version ?? 1,
        payload: { workspaceId: espacio },
      }),
    ]);
    expect(asignar?.status).toBe('applied');
    expect((await pull(user))(id)?.workspaceId).toBe(espacio);

    const [soltar] = await push(user, [
      operation({
        entity: 'bookmark',
        kind: 'update',
        entityId: id,
        baseVersion: asignar?.version ?? 2,
        payload: { workspaceId: null },
      }),
    ]);
    expect(soltar?.status).toBe('applied');
    expect((await pull(user))(id)?.workspaceId).toBeNull();
  });

  it('no se puede asignar a un espacio ajeno', async () => {
    const user = await createVerifiedUser(api);
    const otra = await createVerifiedUser(api);
    const ajeno = await createWorkspace(otra, 'Ajeno');
    const { id, result } = await createBookmark(user);

    const [asignar] = await push(user, [
      operation({
        entity: 'bookmark',
        kind: 'update',
        entityId: id,
        baseVersion: result.version ?? 1,
        payload: { workspaceId: ajeno },
      }),
    ]);

    expect(asignar?.status).not.toBe('applied');
    expect((await pull(user))(id)?.workspaceId).toBeNull();
  });
});
