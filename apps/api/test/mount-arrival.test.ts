import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * Placing something has to **re-send** it, every time you place it.
 *
 * A mount is a projection, not a row: nothing about the folder changes when you file it,
 * so nothing about it gets a newer `updatedAt`, and the pull — which is a walk through
 * time — has nothing to say about it. A device that already has the folder in its cache
 * keeps the copy it had, **with the space it was last filed in**, forever. No error, no
 * empty screen, and no way to fix it from the app.
 *
 * The first filing gets away with it — the folder had never reached that device, so there
 * is nothing stale to contradict. **Moving it is what bites**: file a folder in one space,
 * decide it belongs in another, and the row the phone holds still says the old space, so
 * it shows up in the wrong place and reappears in the right one the next time the listing
 * is rebuilt. Both at once, and neither one goes away.
 *
 * That is the same reason sharing stamps the node: not because the content changed, but
 * because who can read it, and where it shows up for them, did.
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

  it('moverla de un espacio a otro la vuelve a mandar, que si no se queda en los dos', async () => {
    const ana = await createVerifiedUser(api, { displayName: 'Ana' });
    const beto = await createVerifiedUser(api, { displayName: 'Beto' });
    const spaceId = randomUUID();
    const suyoUno = randomUUID();
    const suyoDos = randomUUID();
    const carpetaId = randomUUID();
    const listaId = randomUUID();

    await push(ana, [
      { kind: 'create', entity: 'workspace', entityId: spaceId, payload: { name: 'Casa de Ana', color: 'teal' } },
      { kind: 'create', entity: 'folder', entityId: carpetaId, payload: { workspaceId: spaceId, name: 'Shared 3', position: 0 } },
      { kind: 'create', entity: 'list', entityId: listaId, payload: { workspaceId: spaceId, folderId: carpetaId, title: 'Pistas', kind: 'tasks', position: 0 } },
    ]);
    await push(beto, [
      { kind: 'create', entity: 'workspace', entityId: suyoUno, payload: { name: 'Casa de Beto', color: 'fucsia' } },
      { kind: 'create', entity: 'workspace', entityId: suyoDos, payload: { name: 'Trabajo', color: 'amber' } },
    ]);

    const compartida = await api.post(
      '/shares',
      { workspaceId: spaceId, nodeType: 'folder', nodeId: carpetaId, granteeUserId: beto.userId, role: 'editor' },
      ana.accessToken,
    );
    expect(compartida.status).toBe(201);
    const shareId = compartida.body.data.id as string;

    // Filed in the first space, and the device pulls it: this is the row it now holds.
    const primerFichaje = await api.post(
      `/shares/${shareId}/place`,
      { workspaceId: suyoUno, folderId: null, position: 0 },
      beto.accessToken,
    );
    expect(primerFichaje.status).toBe(200);

    await new Promise((r) => setTimeout(r, 5));
    const recibido = await pull(beto, null);
    expect(recibido.cambios.find((c) => c.record['id'] === carpetaId)!.record.workspaceId).toBe(
      suyoUno,
    );
    const cursorEnEsteMomento = recibido.cursor;
    expect(cursorEnEsteMomento).toBeTruthy();

    // Now he changes his mind. Nothing about the folder changed, and nothing was edited.
    await new Promise((r) => setTimeout(r, 5));
    const movida = await api.post(
      `/shares/${shareId}/place`,
      { workspaceId: suyoDos, folderId: null, position: 0 },
      beto.accessToken,
    );
    expect(movida.status).toBe(200);

    // Same cursor, no content touched, and it has to arrive anyway.
    const despues = await pull(beto, cursorEnEsteMomento);
    const reelaborada = despues.cambios.find((c) => c.record['id'] === carpetaId);

    // Without a bump this is `undefined`: the pull has nothing newer to send, so the
    // device keeps the row it had, with the first space, and the folder is in both.
    expect(reelaborada).toBeTruthy();
    expect(reelaborada!.record.workspaceId).toBe(suyoDos);

    // And the contents with it, because a folder that moves alone opens empty.
    const lista = despues.cambios.find((c) => c.record['id'] === listaId);
    expect(lista).toBeTruthy();
    expect(lista!.record.workspaceId).toBe(suyoDos);
  });
});
