import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * A folder arrives **empty**, and that is what "no se ha generado la carpeta" was.
 *
 * The filters are right — a folder grant admits the lists filed in it — and it makes no
 * difference, because every filter ends in `gt(updatedAt, after)`. The contents of a
 * folder were created before the share and nobody has touched them since, so they sit
 * *behind* the other person's cursor and are never sent. What does arrive is the folder
 * itself, its parent and the space, because sharing bumps those three clocks.
 *
 * So the recipient gets a folder they can open and a folder with nothing in it, and
 * both halves look like a working feature.
 *
 * The fix is the same idea as `tocaElNodo` and not a new one: sharing changes **who can
 * read** the contents, not just the folder, so the contents' clocks have to move too.
 * There is no other way to do it with a cursor, and there is no cursor-less pull to
 * fall back on.
 *
 * The scenario that matters is a device that **has already pulled**. A first pull with
 * no cursor sends everything and hides the bug completely — which is very likely why
 * it survived: every test that shared a folder looked at it with a fresh device.
 */
describe('compartir una carpeta: lo que hay dentro tambien tiene que llegar', () => {
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
          clientId: 'test-client-folder-share',
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

  /** Ana with a space holding `Viajes > {Pistas, Compras}` and a note in one list. */
  async function anaConCarpeta() {
    const ana = await createVerifiedUser(api, { displayName: 'Ana' });
    const workspaceId = randomUUID();
    const carpetaId = randomUUID();
    const listaId = randomUUID();
    const itemId = randomUUID();
    const otraCarpetaId = randomUUID();
    const listaHermanaId = randomUUID();

    await push(ana, [
      { kind: 'create', entity: 'workspace', entityId: workspaceId, payload: { name: 'Casa', color: 'teal' } },
      { kind: 'create', entity: 'folder', entityId: carpetaId, payload: { workspaceId, name: 'Viajes', position: 0 } },
      { kind: 'create', entity: 'list', entityId: listaId, payload: { workspaceId, folderId: carpetaId, title: 'Pistas', kind: 'tasks', position: 0 } },
      { kind: 'create', entity: 'list_item', entityId: itemId, payload: { listId: listaId, title: 'Roma', position: 0 } },
      // A folder nested in the shared one, and a list in a folder that is NOT shared.
      { kind: 'create', entity: 'folder', entityId: otraCarpetaId, payload: { workspaceId, parentId: carpetaId, name: '2026', position: 1 } },
      { kind: 'create', entity: 'list', entityId: listaHermanaId, payload: { workspaceId, folderId: randomUUID(), title: 'No compartir', kind: 'tasks', position: 0 } },
    ]);

    return { ana, workspaceId, carpetaId, listaId, itemId, otraCarpetaId, listaHermanaId };
  }

  async function pull(user: TestUser, cursor: string | null) {
    const respuesta = await api.post(
      '/sync/pull',
      { deviceId: randomUUID(), cursor, limit: 200 },
      user.accessToken,
    );
    return {
      cursor: respuesta.body.data.nextCursor as string | null,
      ids: respuesta.body.data.changes.map(
        (c: { record: { id?: string } }) => c.record?.id,
      ) as string[],
    };
  }

  it('lo que hay dentro de la carpeta llega, y lo de al lado no', async () => {
    const { ana, workspaceId, carpetaId, listaId, itemId, otraCarpetaId, listaHermanaId } =
      await anaConCarpeta();
    const beto = await createVerifiedUser(api, { displayName: 'Beto' });

    /*
      Beto pulls **first**, with nothing to do with Ana. This is the ordinary case: a
      phone that has been in use for a week has a cursor, and it is the only case where
      the folder arrives empty.
    */
    const antes = await pull(beto, null);
    expect(antes.ids).not.toContain(carpetaId);

    const compartida = await api.post(
      '/shares',
      {
        workspaceId,
        nodeType: 'folder',
        nodeId: carpetaId,
        granteeUserId: beto.userId,
        role: 'editor',
      },
      ana.accessToken,
    );
    expect(compartida.status).toBe(201);

    const despues = await pull(beto, antes.cursor);

    // The folder itself, its space and its parent: sharing bumps those clocks.
    expect(despues.ids).toContain(carpetaId);
    expect(despues.ids).toContain(workspaceId);

    // **And what is inside it.** This is the assertion that was missing, and the one
    // that was failing: the list, its item and the nested folder were created before
    // the share and nothing has touched them since, so they are behind the cursor.
    expect(despues.ids).toContain(listaId);
    expect(despues.ids).toContain(itemId);
    expect(despues.ids).toContain(otraCarpetaId);

    // And nothing from beside it. A folder grant is not the space.
    expect(despues.ids).not.toContain(listaHermanaId);
  });

  it('el cursor advanced: el movil no se queda esperando lo que ya le han mandado', async () => {
    const { ana, workspaceId, carpetaId, listaId } = await anaConCarpeta();
    const beto = await createVerifiedUser(api, { displayName: 'Beto' });

    const antes = await pull(beto, null);

    await api.post(
      '/shares',
      { workspaceId, nodeType: 'folder', nodeId: carpetaId, granteeUserId: beto.userId, role: 'editor' },
      ana.accessToken,
    );

    const primero = await pull(beto, antes.cursor);
    // The next pull starts after everything this one sent, so the contents are not
    // re-sent. Without the clocks moving, the cursor would stop at the folder and the
    // same empty folder would be asked for again on every pull, forever.
    expect(primero.cursor).toBeTruthy();

    const segundo = await pull(beto, primero.cursor);
    expect(segundo.ids).not.toContain(listaId);
  });
});
/**
 * What a mount actually does to the other person's tree.
 *
 * `placeShare` writes a `share_mounts` row and stops. The client's tree is keyed by
 * `workspaceId:parentId` (`useSpacesTree`), so where a node shows up is decided by the
 * `workspaceId` the **pull** sent — and the pull sends the owner's space, because that
 * is where the row lives.
 *
 * So the answer to "where do I put what is shared with me" today is: nowhere of your
 * own. It appears under the owner's space, and choosing a space changes what the server
 * remembers and nothing that anybody sees.
 */
describe('lo que hace colocar algo: nada todavia', () => {
  let api: TestServer;

  beforeAll(async () => {
    api = await startTestServer();
  });

  afterAll(async () => {
    await api.close();
  });

  it('la carpeta sigue saliendo bajo el espacio del dueno, no bajo el elegido', async () => {
    const ana = await createVerifiedUser(api, { displayName: 'Ana' });
    const beto = await createVerifiedUser(api, { displayName: 'Beto' });
    const spaceId = randomUUID();
    const carpetaId = randomUUID();
    const suyoId = randomUUID();

    const creado = await api.post(
      '/sync/push',
      {
        deviceId: randomUUID(),
        lastPulledAt: null,
        operations: [
          { operationId: randomUUID(), clientId: 'test-client-mount', kind: 'create', entity: 'workspace', entityId: spaceId, baseVersion: 0, payload: { name: 'Casa de Ana', color: 'teal' }, base: null, clientTimestamp: new Date().toISOString() },
          { operationId: randomUUID(), clientId: 'test-client-mount', kind: 'create', entity: 'folder', entityId: carpetaId, baseVersion: 0, payload: { workspaceId: spaceId, name: 'Viajes', position: 0 }, base: null, clientTimestamp: new Date().toISOString() },
        ],
      },
      ana.accessToken,
    );
    if (creado.body.data.results[0]?.status !== 'applied') {
      throw new Error('push fallo: ' + JSON.stringify(creado.body.data.results));
    }
    await api.post(
      '/sync/push',
      {
        deviceId: randomUUID(),
        lastPulledAt: null,
        operations: [
          { operationId: randomUUID(), clientId: 'test-client-mount', kind: 'create', entity: 'workspace', entityId: suyoId, baseVersion: 0, payload: { name: 'Casa de Beto', color: 'fucsia' }, base: null, clientTimestamp: new Date().toISOString() },
        ],
      },
      beto.accessToken,
    );

    const compartida = await api.post(
      '/shares',
      { workspaceId: spaceId, nodeType: 'folder', nodeId: carpetaId, granteeUserId: beto.userId, role: 'editor' },
      ana.accessToken,
    );
    expect(compartida.status).toBe(201);
    const shareId = compartida.body.data.id;

    const colocada = await api.post(
      `/shares/${shareId}/place`,
      { workspaceId: suyoId, folderId: null, position: 0 },
      beto.accessToken,
    );
    expect(colocada.status).toBe(200);

    const pull = await api.post(
      '/sync/pull',
      { deviceId: randomUUID(), cursor: null, limit: 200 },
      beto.accessToken,
    );
    const carpeta = pull.body.data.changes.find(
      (c: { record: { id?: string } }) => c.record?.id === carpetaId,
    );

    // **The gap, written down so it cannot be quietly forgotten:** Beto filed it in
    // his own space and the pull still says it belongs to Ana's.
    expect(carpeta.record.workspaceId).toBe(spaceId);
    expect(carpeta.record.workspaceId).not.toBe(suyoId);
  });
});
