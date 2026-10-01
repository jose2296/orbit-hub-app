import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * What arrives, and when, for something that was shared with you.
 *
 * The rule, and it is one rule:
 *
 * - **Nothing arrives until you say where it goes.** Not the folder, not its lists, not
 *   the space it lives in. A row in your inbox is the whole of it, and that row already
 *   carries the title and who sent it.
 * - **A whole space is the exception**, because there is nothing to choose: it arrives at
 *   the root of your spaces, marked as shared, and you are in it.
 *
 * What this replaced: every live grant built a chain the moment it was shared, so being
 * handed one folder put the **space** in your list of spaces with that folder in it and
 * nothing else. It read as "you shared the whole space with me" — and the difference
 * matters, because a space you are not in is not something you can organise. It also left
 * a folder that could be browsed but not filed, which is the same dead end from the other
 * side.
 *
 * Everything here runs against a real Postgres. The pull is a walk through time, so the
 * cursor is the whole subject of several of these tests and a device with no cursor would
 * pass most of them without the code being right.
 */
describe('lo que te han compartido: primero la bandeja, despues tu arbol', () => {
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
          clientId: 'test-client-share-visibility',
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

  /**
   * Ana: `Casa > Viajes > {2026 > {Pistas}}`, a row in that list, and a list in a
   * folder that is **not** shared — the neighbour that must never come along.
   */
  async function anaConArbol() {
    const ana = await createVerifiedUser(api, { displayName: 'Ana' });
    const beto = await createVerifiedUser(api, { displayName: 'Beto' });
    const spaceId = randomUUID();
    const suyoId = randomUUID();
    const viajes = randomUUID();
    const anio = randomUUID();
    const pistas = randomUUID();
    const item = randomUUID();
    /** The neighbour's folder and its list: the share must not bring either. */
    const privada = randomUUID();
    const listaPrivada = randomUUID();

    await push(ana, [
      { kind: 'create', entity: 'workspace', entityId: spaceId, payload: { name: 'Casa de Ana', color: 'teal' } },
      { kind: 'create', entity: 'folder', entityId: viajes, payload: { workspaceId: spaceId, name: 'Viajes', position: 0 } },
      { kind: 'create', entity: 'folder', entityId: anio, payload: { workspaceId: spaceId, parentId: viajes, name: '2026', position: 0 } },
      { kind: 'create', entity: 'list', entityId: pistas, payload: { workspaceId: spaceId, folderId: anio, title: 'Pistas', kind: 'tasks', position: 0 } },
      { kind: 'create', entity: 'list_item', entityId: item, payload: { listId: pistas, title: 'Roma', position: 0 } },
      { kind: 'create', entity: 'folder', entityId: privada, payload: { workspaceId: spaceId, name: 'Privado', position: 1 } },
      { kind: 'create', entity: 'list', entityId: listaPrivada, payload: { workspaceId: spaceId, folderId: privada, title: 'No compartir', kind: 'tasks', position: 0 } },
    ]);
    await push(beto, [
      { kind: 'create', entity: 'workspace', entityId: suyoId, payload: { name: 'Casa de Beto', color: 'fucsia' } },
    ]);

    return {
      ana,
      beto,
      spaceId,
      suyoId,
      viajes,
      anio,
      pistas,
      item,
      listaPrivada,
    };
  }

  async function pull(user: TestUser, cursor: string | null = null) {
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
      de: (id: string) =>
        respuesta.body.data.changes.find(
          (c: { record: { id?: string } }) => c.record?.id === id,
        ),
    };
  }

  async function compartirCarpeta(
    ana: TestUser,
    spaceId: string,
    carpeta: string,
    beto: TestUser,
    role: 'editor' | 'viewer' = 'editor',
  ) {
    const respuesta = await api.post(
      '/shares',
      {
        workspaceId: spaceId,
        nodeType: 'folder',
        nodeId: carpeta,
        granteeUserId: beto.userId,
        role,
      },
      ana.accessToken,
    );
    expect(respuesta.status).toBe(201);
    return respuesta.body.data.id as string;
  }

  it('hasta que no lo confirmes no aparece ni la carpeta ni el espacio', async () => {
    const { ana, beto, spaceId, suyoId, viajes, pistas } = await anaConArbol();
    await compartirCarpeta(ana, spaceId, viajes, beto);

    const arbol = await pull(beto);

    // None of it. Not the folder, not its contents, and **not the space it lives in**.
    expect(arbol.de(viajes)).toBeUndefined();
    expect(arbol.de(pistas)).toBeUndefined();
    expect(arbol.de(spaceId)).toBeUndefined();

    // What he does have: his own space, and nothing else from Ana.
    expect(arbol.de(suyoId)).toBeTruthy();

    // And the inbox says it, with the title and who sent it — the row is the whole of
    // it until he decides.
    const bandeja = await api.get('/shares/inbox', beto.accessToken);
    const suya = bandeja.body.data.items.find(
      (i: { nodeId: string }) => i.nodeId === viajes,
    );
    expect(suya).toBeTruthy();
    expect(suya!.title).toBe('Viajes');
    expect(suya!.ownerName).toBe('Ana');
  });

  it('al colocarlo llega todo, en el espacio elegido y con su contenido', async () => {
    const { ana, beto, spaceId, suyoId, viajes, anio, pistas, item, listaPrivada } =
      await anaConArbol();
    const shareId = await compartirCarpeta(ana, spaceId, viajes, beto);

    await new Promise((r) => setTimeout(r, 5));
    const antes = await pull(beto);
    expect(antes.cursor).toBeTruthy();

    const colocada = await api.post(
      `/shares/${shareId}/place`,
      { workspaceId: suyoId, folderId: null, position: 0 },
      beto.accessToken,
    );
    expect(colocada.status).toBe(200);

    await new Promise((r) => setTimeout(r, 5));
    const despues = await pull(beto, antes.cursor);

    // Every level of the tree, in his space. One of them not doing it is a folder that
    // opens empty, and that symptom reads as a share that failed.
    expect(despues.de(viajes)!.record.workspaceId).toBe(suyoId);
    expect(despues.de(anio)!.record.workspaceId).toBe(suyoId);
    expect(despues.de(pistas)!.record.workspaceId).toBe(suyoId);
    expect(despues.de(item)!.record.workspaceId).toBe(suyoId);

    // And still nothing from beside it.
    expect(despues.de(listaPrivada)).toBeUndefined();

    // It leaves the inbox when it is filed.
    const bandeja = await api.get('/shares/inbox', beto.accessToken);
    expect(
      bandeja.body.data.items.map((i: { nodeId: string }) => i.nodeId),
    ).not.toContain(viajes);
  });

  it('los hijos conservan a quien es su padre, que es lo que los mantiene colgando', async () => {
    const { ana, beto, spaceId, suyoId, anio, pistas, viajes } = await anaConArbol();
    const shareId = await compartirCarpeta(ana, spaceId, viajes, beto);
    await api.post(
      `/shares/${shareId}/place`,
      { workspaceId: suyoId, folderId: null, position: 0 },
      beto.accessToken,
    );

    const arbol = await pull(beto);
    expect(arbol.de(anio)!.record['parentId']).toBe(viajes);
    expect(arbol.de(pistas)!.record['folderId']).toBe(anio);
  });

  it('un espacio entero si aparece, solo, en la raiz: no hay donde colocarlo', async () => {
    const { ana, beto, spaceId } = await anaConArbol();

    const compartida = await api.post(
      '/shares',
      {
        workspaceId: spaceId,
        nodeType: 'workspace',
        nodeId: spaceId,
        granteeUserId: beto.userId,
        role: 'editor',
      },
      ana.accessToken,
    );
    expect(compartida.status).toBe(201);

    const arbol = await pull(beto);
    const espacio = arbol.de(spaceId);

    // Here there is nothing to confirm: a space is not filed inside another space. So it
    // arrives, it is in his list of spaces, and it is marked as shared.
    expect(espacio).toBeTruthy();
    expect(espacio!.record['shared']).toBe(true);
    expect(espacio!.record['role']).toBe('editor');

    // And it is not in the inbox, because there is nothing to file.
    const bandeja = await api.get('/shares/inbox', beto.accessToken);
    expect(
      bandeja.body.data.items.map((i: { nodeType: string }) => i.nodeType),
    ).not.toContain('workspace');
  });

  it('quien ya es miembro del espacio no lo ve movido de sitio', async () => {
    const { ana, beto, spaceId, suyoId, pistas } = await anaConArbol();

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

    const arbol = await pull(beto);
    // Already in the space, and it belongs there. Rewriting it would take it out of the
    // space it lives in to put it somewhere the owner cannot see it from.
    expect(arbol.de(pistas)!.record.workspaceId).toBe(spaceId);
  });

  it('borrar el espacio donde se monto lo devuelve a su dueno, no lo pierde', async () => {
    const { ana, beto, suyoId, spaceId, viajes } = await anaConArbol();
    const shareId = await compartirCarpeta(ana, spaceId, viajes, beto);
    await api.post(
      `/shares/${shareId}/place`,
      { workspaceId: suyoId, folderId: null, position: 0 },
      beto.accessToken,
    );

    expect((await pull(beto)).de(viajes)!.record.workspaceId).toBe(suyoId);

    // The delete is logical, so the cascade on the mount never fires and the row would
    // outlive the space, rewriting the folder into one the client filters out — the thing
    // would disappear entirely, which is worse than not having moved.
    await push(beto, [
      { kind: 'delete', entity: 'workspace', entityId: suyoId, baseVersion: 1, payload: {} },
    ]);

    expect((await pull(beto)).de(viajes)!.record.workspaceId).toBe(spaceId);
  });
});