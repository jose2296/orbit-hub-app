import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * What a whole shared space actually lets you do.
 *
 * Not about the badge, which is `node-access.test.ts`. This is about whether the permission
 * the app *says* about a space is the permission it *enforces* inside it, because a space
 * handed over whole carries its contents with it — and the contents are the part a person
 * actually works in.
 *
 * A space grant is not a membership: the person is not an owner of the room and does not
 * appear in its member list. So the only thing telling them what they may do with a list
 * inside it is the grant that came with the space, and if that grant does not reach the
 * list then `role: viewer` on a list they are being asked to tick off boxes in.
 */
describe('un espacio entero entregado de golpe: lo de dentro tambien', () => {
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
          clientId: 'test-client-whole-space',
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

  it('lo que hay dentro de un espacio entregado con permiso de editar se puede editar', async () => {
    const ana = await createVerifiedUser(api, { displayName: 'Ana' });
    const beto = await createVerifiedUser(api, { displayName: 'Beto' });
    const spaceId = randomUUID();
    const listaId = randomUUID();
    const filaId = randomUUID();

    await push(ana, [
      { kind: 'create', entity: 'workspace', entityId: spaceId, payload: { name: 'Casa de Ana', color: 'teal' } },
      { kind: 'create', entity: 'list', entityId: listaId, payload: { workspaceId: spaceId, folderId: null, title: 'Compra', kind: 'tasks', position: 0 } },
      { kind: 'create', entity: 'list_item', entityId: filaId, payload: { listId: listaId, title: 'Leche', position: 0 } },
    ]);

    const compartida = await api.post(
      '/shares',
      { workspaceId: spaceId, nodeType: 'workspace', nodeId: spaceId, granteeUserId: beto.userId, role: 'editor' },
      ana.accessToken,
    );
    expect(compartida.status).toBe(201);

    // Tachar una fila de la lista de Ana, desde la cuenta de Beto y por la via normal.
    const tachado = await push(beto, [
      {
        kind: 'update',
        entity: 'list_item',
        entityId: filaId,
        baseVersion: 1,
        payload: { done: true },
        base: { done: false },
      },
    ]);
    const resultado = tachado.body.data.results[0];

    /*
     * This is the assertion the file exists for, and it is the *server's* answer, not the
     * label the pull hands the app. A `viewer` on a list shared as `editor` is a bug the
     * other test can see; what cannot be seen from there is which of the two is lying.
     */
    expect(resultado.status).toBe('applied');
  });
});
