import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * Placing something has to **re-send** it.
 *
 * A mount is a projection, not a row: nothing about the folder changes when you file it,
 * so nothing about it gets a newer `updatedAt`, and the pull — which is a walk through
 * time — has nothing to say about it. A device that already had the folder in its cache
 * keeps the copy it had, **with the owner's `workspaceId`**, forever. No error, no empty
 * screen, and no way to fix it from the app.
 *
 * That is the same reason sharing stamps the node: not because the content changed, but
 * because the set of people who can read it did. Filing it changes what the reader sees,
 * and that is the same kind of news.
 */
describe('colocar algo lo vuelve a mandar', () => {
  let api: TestServer;

  beforeAll(async () => {
    api = await startTestServer();
  });

  afterAll(async () => {
    await api.close();
  });

  async function push(user: TestUser, operations: Record<string, unknown>[]) {
    return api.post(
      '/sync/push',
      {
        deviceId: randomUUID(),
        lastPulledAt: null,
        operations: operations.map((operation) => ({
          operationId: randomUUID(),
          clientId: 'test-client-mount-arrival',
          baseVersion: 0,
          payload: {},
          base: null,
          clientTimestamp: new Date().toISOString(),
          ...operation,
        })),
      },
      user.accessToken,
    );
  }

  async function pull(user: TestUser, cursor: string | null) {
    const respuesta = await api.post(
      '/sync/pull',
      { deviceId: randomUUID(), cursor, limit: 200 },
      user.accessToken,
    );
    return {
      cursor: respuesta.body.data.nextCursor as string | null,
      cambios: respuesta.body.data.changes as {
        entity: string;
        record: Record<string, unknown>;
      }[],
    };
  }

  it('la carpeta vuelve a mandarse con el espacio nuevo despues de colocarla', async () => {
    const ana = await createVerifiedUser(api, { displayName: 'Ana' });
    const beto = await createVerifiedUser(api, { displayName: 'Beto' });
    const spaceId = randomUUID();
    const suyoId = randomUUID();
    const carpetaId = randomUUID();
    const listaId = randomUUID();

    await push(ana, [
      { kind: 'create', entity: 'workspace', entityId: spaceId, payload: { name: 'Casa de Ana', color: 'teal' } },
      { kind: 'create', entity: 'folder', entityId: carpetaId, payload: { workspaceId: spaceId, name: 'Shared 3', position: 0 } },
      { kind: 'create', entity: 'list', entityId: listaId, payload: { workspaceId: spaceId, folderId: carpetaId, title: 'Pistas', kind: 'tasks', position: 0 } },
    ]);
    await push(beto, [
      { kind: 'create', entity: 'workspace', entityId: suyoId, payload: { name: 'Casa de Beto', color: 'fucsia' } },
    ]);

    const compartida = await api.post(
      '/shares',
      { workspaceId: spaceId, nodeType: 'folder', nodeId: carpetaId, granteeUserId: beto.userId, role: 'editor' },
      ana.accessToken,
    );
    expect(compartida.status).toBe(201);

    // Beto receives it. **This is the device that already has the folder cached**, which
    // is the whole point: a fresh device would pass even with the bug.
    await new Promise((r) => setTimeout(r, 5));
    const recibido = await pull(beto, null);
    const antesDeColocar = recibido.cambios.find((c) => c.record['id'] === carpetaId);
    expect(antesDeColocar!.record.workspaceId).toBe(spaceId);
    const cursorEnEsteMomento = recibido.cursor;
    expect(cursorEnEsteMomento).toBeTruthy();

    await new Promise((r) => setTimeout(r, 5));
    const colocada = await api.post(
      `/shares/${compartida.body.data.id}/place`,
      { workspaceId: suyoId, folderId: null, position: 0 },
      beto.accessToken,
    );
    expect(colocada.status).toBe(200);

    // And now: same cursor, no content touched, and it has to arrive anyway.
    const despues = await pull(beto, cursorEnEsteMomento);
    const reelaborada = despues.cambios.find((c) => c.record['id'] === carpetaId);

    // Without a bump this is `undefined`: the pull has nothing newer to send, so the
    // device keeps the row it had, with Ana's space, and the folder stays invisible.
    expect(reelaborada).toBeTruthy();
    expect(reelaborada!.record.workspaceId).toBe(suyoId);

    // And the contents with it, because a folder that moves alone opens empty.
    const lista = despues.cambios.find((c) => c.record['id'] === listaId);
    expect(lista!.record.workspaceId).toBe(suyoId);
  });
});
