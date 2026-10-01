import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * Two shapes of sharing that look alike from the outside and are not alike inside.
 *
 * **A share inside a space the other person already has.** The space grant is above the
 * list, so they already reach it, and a second grant gives them nothing while leaving a
 * row in their inbox they cannot file. That case is refused, and the refusal has to be
 * a `409` with its own sentence: one rule for both "you already shared this exact
 * thing" and "they already reach it from above" tells the person who shared the space
 * that they shared it twice, which is not what happened.
 *
 * **A share inside a space the other person does not have.** This one must work, and it
 * is the one that has to be proven rather than assumed: the grant lands on a node in
 * somebody else's space, they are not a member, and the whole chain — inbox, place,
 * write — depends on pieces that were each broken at some point.
 *
 * Membership is deliberately *not* "reaching it from above". A colleague in your space
 * can be given one list with a narrower role, and that is a normal thing to want.
 */
describe('compartir dentro de un espacio que el otro ya tiene, y en uno que no tiene', () => {
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
          clientId: 'test-client-share-nesting',
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

  /** A user with a space holding a folder, a list and an item in it. */
  async function conEspacio(nombre: string) {
    const user = await createVerifiedUser(api, { displayName: nombre });
    const workspaceId = randomUUID();
    const folderId = randomUUID();
    const listId = randomUUID();
    const itemId = randomUUID();

    await push(user, [
      { kind: 'create', entity: 'workspace', entityId: workspaceId, payload: { name: `Casa de ${nombre}`, color: 'teal' } },
      { kind: 'create', entity: 'folder', entityId: folderId, payload: { workspaceId, name: 'Viajes', position: 0 } },
      { kind: 'create', entity: 'list', entityId: listId, payload: { workspaceId, folderId, title: 'Compra', kind: 'tasks', position: 0 } },
      { kind: 'create', entity: 'list_item', entityId: itemId, payload: { listId, title: 'Leche', position: 0 } },
    ]);

    return { user, workspaceId, folderId, listId, itemId };
  }

  async function compartir(
    dueno: TestUser,
    objetivo: { workspaceId: string; nodeType: string; nodeId: string },
    conQuien: TestUser,
    role: 'editor' | 'viewer' = 'editor',
  ) {
    return api.post(
      '/shares',
      { ...objetivo, granteeUserId: conQuien.userId, role },
      dueno.accessToken,
    );
  }

  describe('cuando ya tiene el espacio de encima', () => {
    it('compartir una lista de dentro vuelve a decir que ya la tiene por otra via', async () => {
      const ana = await conEspacio('Ana');
      const beto = await createVerifiedUser(api, { displayName: 'Beto' });

      // The space itself first. This is the grant that is "above" everything else.
      const espacio = await compartir(
        ana.user,
        { workspaceId: ana.workspaceId, nodeType: 'workspace', nodeId: ana.workspaceId },
        beto,
      );
      expect(espacio.status).toBe(201);

      const lista = await compartir(
        ana.user,
        { workspaceId: ana.workspaceId, nodeType: 'list', nodeId: ana.listId },
        beto,
      );
      expect(lista.status).toBe(409);
      // Its own sentence, not the duplicate one. Beto does not already have *this
      // list shared*; he reaches it because the space was shared. Telling him
      // otherwise is a sentence about something that did not happen.
      expect(lista.body.error.message).toMatch(/through something else/i);
      expect(lista.body.error.message).not.toMatch(/already shared with that person/i);
    });

    it('y lo mismo con un elemento suelto y con una carpeta', async () => {
      const ana = await conEspacio('Ana');
      const beto = await createVerifiedUser(api, { displayName: 'Beto' });

      await compartir(
        ana.user,
        { workspaceId: ana.workspaceId, nodeType: 'workspace', nodeId: ana.workspaceId },
        beto,
      );

      for (const objetivo of [
        { nodeType: 'list_item', nodeId: ana.itemId },
        { nodeType: 'folder', nodeId: ana.folderId },
      ]) {
        const respuesta = await compartir(
          ana.user,
          { workspaceId: ana.workspaceId, ...objetivo },
          beto,
        );
        expect(respuesta.status).toBe(409);
        expect(respuesta.body.error.message).toMatch(/through something else/i);
      }
    });

    it('el rechazo no deja una fila de mas en la bandeja del otro', async () => {
      const ana = await conEspacio('Ana');
      const beto = await createVerifiedUser(api, { displayName: 'Beto' });

      await compartir(
        ana.user,
        { workspaceId: ana.workspaceId, nodeType: 'workspace', nodeId: ana.workspaceId },
        beto,
      );
      await compartir(
        ana.user,
        { workspaceId: ana.workspaceId, nodeType: 'list', nodeId: ana.listId },
        beto,
      ).catch(() => undefined);

      // The whole cost of the missing check: the space grant reaches Beto, and a list
      // grant would sit in his inbox as something to file that he cannot file,
      // because the list is in a space he is not a member of.
      const bandeja = await api.get('/shares/inbox', beto.accessToken);
      const nodos = bandeja.body.data.items as { nodeId: string }[];
      expect(nodos.filter((i) => i.nodeId === ana.listId)).toEqual([]);
    });

    it('un miembro del espacio puede recibir una lista con un papel mas estrecho', async () => {
      // Membership is **not** "reaching it from above". A colleague in the space can
      // be given one list as viewer while the rest of the space stays editor, and
      // refusing that would make a normal thing impossible.
      const ana = await conEspacio('Ana');
      const beto = await createVerifiedUser(api, { displayName: 'Beto' });

      const miembro = await api.post(
        `/workspaces/${ana.workspaceId}/invitations`,
        { role: 'editor', email: beto.email },
        ana.user.accessToken,
      );
      expect(miembro.status).toBe(201);
      await api.post(
        `/invitations/${miembro.body.data.token}/accept`,
        {},
        beto.accessToken,
      );

      const lista = await compartir(
        ana.user,
        { workspaceId: ana.workspaceId, nodeType: 'list', nodeId: ana.listId },
        beto,
        'viewer',
      );
      expect(lista.status).toBe(201);
    });
  });

  describe('cuando no tiene el espacio', () => {
    it('una lista aislada se comparte, llega a la bandeja y se puede colocar', async () => {
      const ana = await conEspacio('Ana');
      const beto = await createVerifiedUser(api, { displayName: 'Beto' });

      const lista = await compartir(
        ana.user,
        { workspaceId: ana.workspaceId, nodeType: 'list', nodeId: ana.listId },
        beto,
      );
      expect(lista.status).toBe(201);

      // It arrives, and it says what it is and who sent it.
      const bandeja = await api.get('/shares/inbox', beto.accessToken);
      const suya = bandeja.body.data.items.find(
        (i: { nodeId: string }) => i.nodeId === ana.listId,
      );
      expect(suya).toBeTruthy();
      expect(suya!.nodeType).toBe('list');
      expect(suya!.ownerName).toBe('Ana');
      expect(suya!.placedAt).toBeNull();

      // Where it came from. It used to arrive as `''`, on a field the contract calls
      // a uuid: the route hardcoded it because the query never selected it.
      expect(suya!.workspaceId).toBe(ana.workspaceId);

      // He cannot see the space it came from. He was given one list, not the room it
      // is standing in.
      const espacios = await api.get('/workspaces', beto.accessToken);
      expect(espacios.body.data.items.map((w: { id: string }) => w.id)).not.toContain(
        ana.workspaceId,
      );
    });

    it('el elemento suelto se comparte igual, y su lista tambien llega', async () => {
      const ana = await conEspacio('Ana');
      const beto = await createVerifiedUser(api, { displayName: 'Beto' });

      const item = await compartir(
        ana.user,
        { workspaceId: ana.workspaceId, nodeType: 'list_item', nodeId: ana.itemId },
        beto,
      );
      expect(item.status).toBe(201);

      // Only the granted node is in the inbox, and that is right: the inbox is the
      // list of things you have to **put somewhere**, and the list it came from is not
      // something Beto was given — it is context, and it reaches him through the pull.
      // Expecting it here would be asking the wrong question.
      const bandeja = await api.get('/shares/inbox', beto.accessToken);
      const ids = bandeja.body.data.items.map((i: { nodeId: string }) => i.nodeId);
      expect(ids).toContain(ana.itemId);
      expect(ids).not.toContain(ana.listId);

      // And the chain *does* arrive once he files it: item, list, folder and space,
      // because a grant on an item has to reach its list or "share this item" and
      // "share this item in an empty list" are the same thing and he cannot tick
      // anything.
      //
      // Filed, because until then the chain is not in his tree at all. That is the rule
      // now: the inbox is where a received thing waits, and nowhere else.
      const suyo = randomUUID();
      await push(beto, [
        { kind: 'create', entity: 'workspace', entityId: suyo, payload: { name: 'Casa de Beto', color: 'fucsia' } },
      ]);
      const colocada = await api.post(
        `/shares/${item.body.data.id}/place`,
        { workspaceId: suyo, folderId: null, position: 0 },
        beto.accessToken,
      );
      expect(colocada.status).toBe(200);

      const pull = await api.post(
        '/sync/pull',
        { deviceId: randomUUID(), cursor: null, limit: 200 },
        beto.accessToken,
      );
      // A change carries the entity and its `record`, not a flat `entityId`.
      const llegados = pull.body.data.changes.map(
        (c: { record: { id?: string } }) => c.record?.id,
      );
      expect(llegados).toContain(ana.itemId);
      expect(llegados).toContain(ana.listId);
      expect(llegados).toContain(ana.folderId);

      // **Not** the space. The chain needs somewhere to hang from and this used to be it,
      // so being handed one row put Ana's whole space in Beto's list of spaces with a
      // single list in it and a line saying he was not a member — which is what "you
      // shared the space with me" looks like, and is not what happened. Filed nodes are
      // re-pointed at the space Beto chose, so nothing needs the other space to exist.
      expect(llegados).not.toContain(ana.workspaceId);

      // The precondition, so that is not a claim about an empty pull: Beto's own space is
      // there, and the granted list is filed in it.
      const espacios = await api.get('/workspaces', beto.accessToken);
      expect(espacios.body.data.items.map((w: { id: string }) => w.id)).toContain(suyo);
      const lista = pull.body.data.changes.find(
        (c: { record: { id?: string } }) => c.record?.id === ana.listId,
      );
      expect(lista?.record.workspaceId).toBe(suyo);
    });

    it('al colocarlo desaparece de la bandeja y deja de poder colocarse otra vez', async () => {
      const ana = await conEspacio('Ana');
      const beto = await createVerifiedUser(api, { displayName: 'Beto' });

      await compartir(
        ana.user,
        { workspaceId: ana.workspaceId, nodeType: 'list', nodeId: ana.listId },
        beto,
      );

      // Beto needs somewhere to put it. That is the whole point of "place it": the
      // thing came from a space he cannot see, so it has to be filed in one he can.
      const suyo = randomUUID();
      await push(beto, [
        { kind: 'create', entity: 'workspace', entityId: suyo, payload: { name: 'Casa de Beto', color: 'fucsia' } },
      ]);

      const bandeja = await api.get('/shares/inbox', beto.accessToken);
      const suya = bandeja.body.data.items.find(
        (i: { nodeId: string }) => i.nodeId === ana.listId,
      );

      const colocada = await api.post(
        `/shares/${suya!.id}/place`,
        { workspaceId: suyo, folderId: null, position: 0 },
        beto.accessToken,
      );
      expect(colocada.status).toBe(200);

      const despues = await api.get('/shares/inbox', beto.accessToken);
      expect(
        despues.body.data.items.map((i: { nodeId: string }) => i.nodeId),
      ).not.toContain(ana.listId);
    });

    it('la bandeja dice de que espacio viene, y no manda un id vacio', async () => {
      /**
       * `shareSchema` says `workspaceId` is a uuid, and the route answered `''`.
       *
       * A field that is declared as an id and always empty is worse than a field that
       * is missing: the app's own type says it is there, so nothing looks wrong, and
       * the only thing you can do with it is show nothing. It was hardcoded because
       * the query never selected it — the space is not a column on `shares`, it is
       * wherever the node lives, and only `resolveTarget` walks up to find it.
       */
      const ana = await conEspacio('Ana');
      const beto = await createVerifiedUser(api, { displayName: 'Beto' });

      await compartir(
        ana.user,
        { workspaceId: ana.workspaceId, nodeType: 'list', nodeId: ana.listId },
        beto,
      );

      const bandeja = await api.get('/shares/inbox', beto.accessToken);
      const suya = bandeja.body.data.items[0];

      expect(suya.workspaceId).toBe(ana.workspaceId);
      // And it is a uuid, which is what the contract says it is. `expect.any(String)`
      // would pass on the empty string; this does not.
      expect(suya.workspaceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(suya.placedAt).toBeNull();
    });

    it('quien lo recibe como editor puede escribir en el, sin ser miembro del espacio', async () => {
      // The part that was broken once and is worth keeping covered: `assertCanWrite`
      // looked only at the membership of the space, so a shared list was a list you
      // could look at and never touch.
      const ana = await conEspacio('Ana');
      const beto = await createVerifiedUser(api, { displayName: 'Beto' });

      await compartir(
        ana.user,
        { workspaceId: ana.workspaceId, nodeType: 'list', nodeId: ana.listId },
        beto,
      );

      const edicion = await push(beto, [
        {
          kind: 'update',
          entity: 'list_item',
          entityId: ana.itemId,
          baseVersion: 1,
          payload: { title: 'Leche de avena', completed: true },
        },
      ]);

      const resultado = edicion.body.data.results[0];
      expect(resultado.status).toBe('applied');
    });

    it('y en solo lectura no puede, y se le dice por que', async () => {
      const ana = await conEspacio('Ana');
      const beto = await createVerifiedUser(api, { displayName: 'Beto' });

      await compartir(
        ana.user,
        { workspaceId: ana.workspaceId, nodeType: 'list', nodeId: ana.listId },
        beto,
        'viewer',
      );

      const edicion = await push(beto, [
        {
          kind: 'update',
          entity: 'list_item',
          entityId: ana.itemId,
          baseVersion: 1,
          payload: { completed: true },
        },
      ]);

      expect(edicion.body.data.results[0].status).toBe('rejected');
    });
  });
});