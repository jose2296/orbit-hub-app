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
      Beto has a space of his own and pulls **first**, so the cursor he gets back is a
      real one.

      The first version of this test gave him an account with nothing in it. His first
      pull returned no rows, `nextCursor` fell back to the cursor he sent — `null` — and
      the second pull was therefore a **full** one. Every assertion passed, and none of
      them had exercised the thing that was broken: the contents are older than his
      cursor and have to be made newer to arrive. A test that passes for the wrong
      reason is worse than one that fails.
    */
    await api.post(
      '/sync/push',
      {
        deviceId: randomUUID(),
        lastPulledAt: null,
        operations: [
          {
            operationId: randomUUID(),
            clientId: 'test-client-folder-share',
            kind: 'create',
            entity: 'workspace',
            entityId: randomUUID(),
            baseVersion: 0,
            payload: { name: 'Casa de Beto', color: 'fucsia' },
            base: null,
            clientTimestamp: new Date().toISOString(),
          },
        ],
      },
      beto.accessToken,
    );

    const antes = await pull(beto, null);
    expect(antes.ids).not.toContain(carpetaId);
    // The whole test rests on this line: a cursor that is really a cursor.
    expect(antes.cursor).toBeTruthy();

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

    // Two milliseconds. The cursor is a timestamp and the share stamps "now", so a
    // test that shares in the same millisecond Beto's own row was written is testing
    // the clock of the machine and not the code.
    await new Promise((r) => setTimeout(r, 5));

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
describe('lo que hace colocar algo: sale donde lo colocaste', () => {
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

    // Filed in his own space, and the pull says so. This is the same assertion as the
    // one above with the other value, which is the whole change: the mount is
    // projected, so where a received thing shows up is where the recipient put it.
    expect(carpeta.record.workspaceId).toBe(suyoId);
    expect(carpeta.record.workspaceId).not.toBe(spaceId);

    // And it is still **shared**, because it still belongs to Ana. Moving where you
    // filed something is not a way of saying you made it, and a badge that said
    // otherwise would be how somebody ends up editing a list that is not theirs
    // without being told.
    expect(carpeta.record.shared).toBe(true);
    expect(carpeta.record.role).toBe('editor');
  });
});

/**
 * The part that makes a mount a mount and not a relabelling: **the contents come too.**
 *
 * The client tree is keyed by `workspaceId:parentId`. Rewriting only the folder leaves
 * its lists carrying the owner's space, and they are then looked up under
 * `ownerSpace:mountedFolder` while the recipient asks `theirSpace:mountedFolder` — a
 * folder that opens and has nothing in it, which is the same symptom as a share that
 * did not work and reads as one.
 */
describe('lo que hay dentro de lo colocado tambien sale ahi', () => {
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
          clientId: 'test-client-mount-tree',
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

  /** Ana: `Viajes > {2026 > {Pistas}}` and a list with a row in it. */
  async function arbol() {
    const ana = await createVerifiedUser(api, { displayName: 'Ana' });
    const beto = await createVerifiedUser(api, { displayName: 'Beto' });
    const spaceId = randomUUID();
    const suyoId = randomUUID();
    const viajes = randomUUID();
    const anio = randomUUID();
    const pistas = randomUUID();
    const item = randomUUID();

    await push(ana, [
      { kind: 'create', entity: 'workspace', entityId: spaceId, payload: { name: 'Casa de Ana', color: 'teal' } },
      { kind: 'create', entity: 'folder', entityId: viajes, payload: { workspaceId: spaceId, name: 'Viajes', position: 0 } },
      { kind: 'create', entity: 'folder', entityId: anio, payload: { workspaceId: spaceId, parentId: viajes, name: '2026', position: 0 } },
      { kind: 'create', entity: 'list', entityId: pistas, payload: { workspaceId: spaceId, folderId: anio, title: 'Pistas', kind: 'tasks', position: 0 } },
      { kind: 'create', entity: 'list_item', entityId: item, payload: { listId: pistas, title: 'Roma', position: 0 } },
    ]);
    await push(beto, [
      { kind: 'create', entity: 'workspace', entityId: suyoId, payload: { name: 'Casa de Beto', color: 'fucsia' } },
    ]);

    const compartida = await api.post(
      '/shares',
      {
        workspaceId: spaceId,
        nodeType: 'folder',
        nodeId: viajes,
        granteeUserId: beto.userId,
        role: 'editor',
      },
      ana.accessToken,
    );
    expect(compartida.status).toBe(201);

    return { ana, beto, spaceId, suyoId, viajes, anio, pistas, item, shareId: compartida.body.data.id };
  }

  async function pullDe(user: TestUser, cursor: string | null = null) {
    const respuesta = await api.post(
      '/sync/pull',
      { deviceId: randomUUID(), cursor, limit: 200 },
      user.accessToken,
    );
    return respuesta.body.data.changes as {
      entity: string;
      record: Record<string, unknown>;
    }[];
  }

  it('la carpeta, la de dentro, la lista y su fila salen todas en el espacio elegido', async () => {
    const { beto, suyoId, spaceId, viajes, anio, pistas, item, shareId } = await arbol();

    const colocada = await api.post(
      `/shares/${shareId}/place`,
      { workspaceId: suyoId, folderId: null, position: 0 },
      beto.accessToken,
    );
    expect(colocada.status).toBe(200);

    const cambios = await pullDe(beto);
    const de = (id: string) => cambios.find((c) => c.record['id'] === id);

    // Every level of the tree hangs from Beto's space. One of them not doing it is a
    // folder that opens empty, and that symptom reads as a share that failed.
    expect(de(viajes)!.record.workspaceId).toBe(suyoId);
    expect(de(anio)!.record.workspaceId).toBe(suyoId);
    expect(de(pistas)!.record.workspaceId).toBe(suyoId);
    expect(de(item)!.record.workspaceId).toBe(suyoId);

    for (const id of [viajes, anio, pistas, item]) {
      expect(de(id)!.record.workspaceId).not.toBe(spaceId);
    }
  });

  it('los hijos conservan a quien es su padre, que es lo que los mantiene colgando', async () => {
    const { beto, suyoId, anio, pistas, viajes, shareId } = await arbol();
    await api.post(
      `/shares/${shareId}/place`,
      { workspaceId: suyoId, folderId: null, position: 0 },
      beto.accessToken,
    );

    const cambios = await pullDe(beto);
    const de = (id: string) => cambios.find((c) => c.record['id'] === id);

    // The tree resolves a child by its own id plus its parent. Rewriting only the space
    // would break exactly this, so the parent link is left alone.
    expect(de(anio)!.record['parentId']).toBe(viajes);
    expect(de(pistas)!.record['folderId']).toBe(anio);
  });

  it('quien ya es miembro del espacio no lo ve movido de sitio', async () => {
    /*
      The one carve-out, and it is not a detail.

      Somebody invited into Ana's space and handed one of her lists already sees it, in
      Ana's space, where it belongs. Rewriting it would take it out of the space it
      lives in, to file it somewhere the owner cannot see it from — and a shared thing
      showing in two places is worse than one place that is not the one you asked for.
    */
    const { ana, beto, spaceId, suyoId, pistas } = await arbol();

    const invitacion = await api.post(
      `/workspaces/${spaceId}/invitations`,
      { role: 'editor', email: beto.email },
      ana.accessToken,
    );
    expect(invitacion.status).toBe(201);
    await api.post(`/invitations/${invitacion.body.data.token}/accept`, {}, beto.accessToken);

    const lista = await api.post(
      '/shares',
      {
        workspaceId: spaceId,
        nodeType: 'list',
        nodeId: pistas,
        granteeUserId: beto.userId,
        role: 'viewer',
      },
      ana.accessToken,
    );
    expect(lista.status).toBe(201);

    await api.post(
      `/shares/${lista.body.data.id}/place`,
      { workspaceId: suyoId, folderId: null, position: 0 },
      beto.accessToken,
    );

    const cambios = await pullDe(beto);
    const esa = cambios.find((c) => c.record['id'] === pistas);
    expect(esa!.record.workspaceId).toBe(spaceId);
  });

  it('borrar el espacio donde se monto deshace el montaje y lo devuelve a su dueno', async () => {
    const { beto, suyoId, spaceId, viajes, shareId } = await arbol();
    await api.post(
      `/shares/${shareId}/place`,
      { workspaceId: suyoId, folderId: null, position: 0 },
      beto.accessToken,
    );

    const antes = await pullDe(beto);
    expect(antes.find((c) => c.record['id'] === viajes)!.record.workspaceId).toBe(suyoId);

    // The mount hangs off the space with `onDelete: cascade`, so deleting the space
    // deletes the mount: the thing leaves your view and is only Ana's again. It is not
    // lost and it was never copied — there was only ever one row.
    await push(beto, [
      { kind: 'delete', entity: 'workspace', entityId: suyoId, baseVersion: 1, payload: {} },
    ]);

    const despues = await pullDe(beto, null);
    const carpeta = despues.find((c) => c.record['id'] === viajes);
    expect(carpeta!.record.workspaceId).toBe(spaceId);
  });
});
