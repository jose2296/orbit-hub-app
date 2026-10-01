import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * Everything that went wrong when a whole **space** was shared.
 *
 * Four separate bugs, all from the same handful of lines, and all of them found by
 * sharing one space and then looking at what the other person ended up with. They are
 * in one file because they are one story: a space is a bigger grant than a list, and
 * every place that only knew about lists treated it like a list.
 *
 * The two that are not cosmetic — an empty shared space and a lent note that its
 * borrower could delete — were **data** problems, not wording.
 */
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
        clientId: 'test-client-space-share',
        baseVersion: 0,
        payload: {},
        clientTimestamp: new Date().toISOString(),
        ...operation,
      })),
    },
    user.accessToken,
  );
}

/** A space with a folder, a list and a note inside it. */
async function espacioConCosas(displayName: string) {
  const user = await createVerifiedUser(api, { displayName });
  const workspaceId = randomUUID();
  const folderId = randomUUID();
  const listId = randomUUID();
  const itemId = randomUUID();
  const noteId = randomUUID();
  await push(user, [
    { kind: 'create', entity: 'workspace', entityId: workspaceId, payload: { name: 'Casa', color: 'teal' } },
    { kind: 'create', entity: 'folder', entityId: folderId, payload: { workspaceId, name: 'Viajes', position: 0 } },
    { kind: 'create', entity: 'list', entityId: listId, payload: { workspaceId, folderId, title: 'Compra', kind: 'tasks', position: 0 } },
    { kind: 'create', entity: 'list_item', entityId: itemId, payload: { listId, title: 'Leche', position: 0 } },
    { kind: 'create', entity: 'note', entityId: noteId, payload: { workspaceId, folderId: null, title: 'Notas', document: '<p>x</p>' } },
  ]);
  return { user, workspaceId, folderId, listId, itemId, noteId };
}

async function pull(user: TestUser) {
  const r = await api.post(
    '/sync/pull',
    { deviceId: randomUUID(), cursor: null, limit: 400 },
    user.accessToken,
  );
  return (r.body?.data?.changes ?? []) as { entity: string; record: Record<string, any> }[];
}

const de = (cambios: { entity: string; record: Record<string, any> }[], entidad: string) =>
  cambios.filter((c) => c.entity === entidad);

describe('compartir un espacio entero', () => {
  it('LLEGA CON TODO DENTRO: carpetas, listas, items y notas', async () => {
    /*
     * The one that mattered most, and it was silent.
     *
     * Sharing a space delivered the **space row** and none of its contents: the query
     * for folders, lists, items and notes each asked "is the grantee a member of the
     * space, or was this exact node granted", and a space grant is neither. So the
     * recipient's drawer listed the space, marked it shared, and it was empty — which
     * reads as the share having failed rather than as half of it working. Reported as
     * "the space no longer shows as shared".
     */
    const ana = await espacioConCosas('Ana');
    const beto = await createVerifiedUser(api, { displayName: 'Beto' });

    const creada = await api.post(
      '/shares',
      { nodeType: 'workspace', nodeId: ana.workspaceId, granteeUserId: beto.userId, role: 'editor' },
      ana.user.accessToken,
    );
    expect(creada.status).toBe(201);

    const cambios = await pull(beto);
    const espacios = de(cambios, 'workspace');
    expect(espacios.map((c) => c.record.id)).toContain(ana.workspaceId);
    expect(espacios.find((c) => c.record.id === ana.workspaceId)?.record.shared).toBe(true);

    // And now the contents, which is the half that was missing.
    expect(de(cambios, 'folder').map((c) => c.record.id)).toContain(ana.folderId);
    expect(de(cambios, 'list').map((c) => c.record.id)).toContain(ana.listId);
    expect(de(cambios, 'list_item').map((c) => c.record.id)).toContain(ana.itemId);
    expect(de(cambios, 'note').map((c) => c.record.id)).toContain(ana.noteId);
  });

  it('compartir UNA lista dentro no regala el espacio entero', async () => {
    /*
     * The other side of the fix, and the mistake it was one line away from.
     *
     * `cadenas` carries the containing space of *every* grant, so filtering it for
     * workspace ids without checking the node type would hand somebody the whole space
     * when they were given one list in it. That is the same class of mistake as the
     * re-share hole: over-delivery is a breach, not an inconvenience.
     */
    const ana = await espacioConCosas('Ana dos');
    const beto = await createVerifiedUser(api, { displayName: 'Beto dos' });
    const otra = await espacioConCosas('Otra dueña');

    await api.post(
      '/shares',
      { nodeType: 'list', nodeId: ana.listId, granteeUserId: beto.userId, role: 'viewer' },
      ana.user.accessToken,
    );

    const cambios = await pull(beto);
    expect(de(cambios, 'list').map((c) => c.record.id)).toContain(ana.listId);

    // The folder the list is filed in **does** come, and it should: the person cannot
    // put the list anywhere without knowing where it lives. What must not come is
    // anything else in that folder or that space — the note beside it, above all.
    expect(de(cambios, 'folder').map((c) => c.record.id)).toContain(ana.folderId);
    expect(de(cambios, 'note').map((c) => c.record.id)).not.toContain(ana.noteId);

    // And another person's space is nowhere in sight, which is the line this test
    // exists for.
    expect(de(cambios, 'workspace').map((c) => c.record.id)).not.toContain(otra.workspaceId);
  });

  it('NO se puede compartir con alguien lo que ya tiene por el espacio', async () => {
    /*
     * The redundant grant. It gave the person nothing and then sat in their inbox as
     * an item to file that they could not file, because the node is in a space they
     * are not a member of. So one share of a space produced two unfileable items.
     *
     * The picker already greyed them out, from `whoHas`. This asserts the **API**,
     * because a rule that only exists in the client is a rule the API does not have:
     * share by typed email and it used to go straight in.
     */
    const ana = await espacioConCosas('Ana tres');
    const beto = await createVerifiedUser(api, { displayName: 'Beto tres' });

    await api.post(
      '/shares',
      { nodeType: 'workspace', nodeId: ana.workspaceId, granteeUserId: beto.userId, role: 'editor' },
      ana.user.accessToken,
    );

    const dentro = await api.post(
      '/shares',
      { nodeType: 'list', nodeId: ana.listId, granteeUserId: beto.userId, role: 'viewer' },
      ana.user.accessToken,
    );
    expect(dentro.status).toBe(409);
    expect(dentro.body.error.message).toMatch(/already has this/);
  });

  it('con el espacio entero compartido, su contenido NO sale en "compartido conmigo"', async () => {
    /*
     * Two birds: the workspace grant is not in the filing inbox, and neither is the
     * list that is inside it — because that one cannot even be created (above).
     *
     * A space is not something you file inside another space. Listing it offered a
     * panel that could only answer `You can only file it in one of your own spaces`,
     * which is true and useless, because the problem was never the space picked.
     */
    const ana = await espacioConCosas('Ana cuatro');
    const beto = await createVerifiedUser(api, { displayName: 'Beto cuatro' });

    await api.post(
      '/shares',
      { nodeType: 'workspace', nodeId: ana.workspaceId, granteeUserId: beto.userId, role: 'editor' },
      ana.user.accessToken,
    );

    const bandeja = await api.get('/shares/inbox', beto.accessToken);
    const tipos = (bandeja.body?.data?.items ?? []).map((i: { nodeType: string }) => i.nodeType);
    expect(tipos).not.toContain('workspace');
    expect(tipos).not.toContain('list');
  });
});

describe('borrar lo que te compartieron', () => {
  it('un editor NO puede borrar la nota de su dueña: se queda con ella', async () => {
    /*
     * Data loss, not wording.
     *
     * A delete in sync is a **tombstone**, and a tombstone is global. The gate was
     * `assertCanWrite`, which returns success for anybody whose access is `edit` — so
     * a person lent a note as `editor` (a role the share menu offers, and the one the
     * badge calls "Puedes editarlo") could erase it, and it disappeared from the
     * **owner's** note in every space and on every device. Observed before this was
     * fixed: `status: "applied"` and the owner's record came back with `deletedAt`.
     *
     * Editing somebody's note is what the role means and it stays allowed. Deleting it
     * is a different power and nobody granted it.
     */
    const ana = await espacioConCosas('Ana cinco');
    const beto = await createVerifiedUser(api, { displayName: 'Beto cinco' });

    /*
     * Beto is an **editor of her space**, invited the ordinary way, and not merely
     * lent the note. That is the case that reproduces, and it is why the first
     * version of this test passed with the fix reverted: a plain grantee is stopped
     * one step earlier, by the `view` branch of `assertCanWrite`, and so never
     * reached the gate this test is about.
     *
     * A space editor is different in the worst way: `roleInWorkspace` answers
     * `editor`, `assertCanWrite` returns immediately, and the tombstone goes in.
     * It is also the realistic one — it is what "we share the workspace" produces.
     */
    const invitacion = await api.post(
      `/workspaces/${ana.workspaceId}/invitations`,
      { role: 'editor', email: beto.email },
      ana.user.accessToken,
    );
    expect(invitacion.status).toBe(201);
    const acepta = await api.post(
      `/invitations/${invitacion.body.data.token}/accept`,
      {},
      beto.accessToken,
    );
    expect(acepta.status).toBe(200);

    await api.post(
      '/shares',
      { nodeType: 'note', nodeId: ana.noteId, granteeUserId: beto.userId, role: 'editor' },
      ana.user.accessToken,
    );

    const borrado = await push(beto, [{ kind: 'delete', entity: 'note', entityId: ana.noteId }]);
    const resultado = borrado.body?.data?.results?.[0];
    expect(resultado?.status).not.toBe('applied');

    // The part that is the actual harm: it is still there for her.
    const despues = await pull(ana.user);
    const suya = de(despues, 'note').find((c) => c.record.id === ana.noteId);
    expect(suya?.record.deletedAt ?? null).toBeNull();
  });

  it('un editor NO puede borrar la lista de su dueña', async () => {
    // The same hole on a list, asserted separately because the delete branch has a
    // line per entity and one of them being wrong is invisible to a test on another.
    const ana = await espacioConCosas('Ana seis');
    const beto = await createVerifiedUser(api, { displayName: 'Beto seis' });

    // Editor of her space, for the reason given in the note test above.
    const invitacion = await api.post(
      `/workspaces/${ana.workspaceId}/invitations`,
      { role: 'editor', email: beto.email },
      ana.user.accessToken,
    );
    await api.post(`/invitations/${invitacion.body.data.token}/accept`, {}, beto.accessToken);

    await api.post(
      '/shares',
      { nodeType: 'list', nodeId: ana.listId, granteeUserId: beto.userId, role: 'editor' },
      ana.user.accessToken,
    );

    const borrado = await push(beto, [{ kind: 'delete', entity: 'list', entityId: ana.listId }]);
    expect(borrado.body?.data?.results?.[0]?.status).not.toBe('applied');

    const despues = await pull(ana.user);
    const suya = de(despues, 'list').find((c) => c.record.id === ana.listId);
    expect(suya?.record.deletedAt ?? null).toBeNull();
  });

  it('la dueña SIGUE podido borrar lo suyo, incluido lo que compartio', async () => {
    // The other direction. Without it the fix above reads as "nobody can delete".
    const ana = await espacioConCosas('Ana siete');
    const beto = await createVerifiedUser(api, { displayName: 'Beto siete' });

    await api.post(
      '/shares',
      { nodeType: 'note', nodeId: ana.noteId, granteeUserId: beto.userId, role: 'editor' },
      ana.user.accessToken,
    );

    const borrado = await push(ana.user, [{ kind: 'delete', entity: 'note', entityId: ana.noteId }]);
    expect(borrado.body?.data?.results?.[0]?.status).toBe('applied');
  });

  it('un editor SI puede editar la nota que le prestaron', async () => {
    /*
     * The other half, and the reason the gate is ownership and not "can do anything".
     * A fix that stopped editors writing would have been a worse bug than the one it
     * fixed: the role exists to let them change things.
     */
    const ana = await espacioConCosas('Ana ocho');
    const beto = await createVerifiedUser(api, { displayName: 'Beto ocho' });

    await api.post(
      '/shares',
      { nodeType: 'note', nodeId: ana.noteId, granteeUserId: beto.userId, role: 'editor' },
      ana.user.accessToken,
    );

    // `baseVersion` has to be the version it really is, which is why this says 1 and
    // not 0: with 0 the operation is a conflict and the test would be asserting that
    // editors are blocked for a reason that has nothing to do with editors.
    const editado = await push(beto, [
      {
        kind: 'update',
        entity: 'note',
        entityId: ana.noteId,
        baseVersion: 1,
        payload: { title: 'Cambiada por Beto' },
      },
    ]);
    expect(editado.body?.data?.results?.[0]?.status).toBe('applied');
  });
});
/**
 * What has arrived, for the badge.
 *
 * Separate from the inbox because of one case: a whole shared space is something that
 * **arrived** and is not something you **file**. Counting the badge off the inbox made
 * sharing a whole workspace the one kind of sharing that never said anything, and all
 * three kinds are supposed to.
 */
describe('lo que te ha llegado', () => {
  it('incluye el ESPACIO entero, que en la bandeja no puede estar', async () => {
    const ana = await espacioConCosas('Ana nueve');
    const beto = await createVerifiedUser(api, { displayName: 'Beto nueve' });

    await api.post(
      '/shares',
      { nodeType: 'workspace', nodeId: ana.workspaceId, granteeUserId: beto.userId, role: 'editor' },
      ana.user.accessToken,
    );

    const bandeja = await api.get('/shares/inbox', beto.accessToken);
    const tiposEnBandeja = (bandeja.body?.data?.items ?? []).map((i: { nodeType: string }) => i.nodeType);
    expect(tiposEnBandeja).not.toContain('workspace');

    const llegado = await api.get('/shares/incoming', beto.accessToken);
    const tipos = (llegado.body?.data?.items ?? []).map((i: { nodeType: string }) => i.nodeType);
    expect(tipos).toContain('workspace');
  });

  it('cada cosa lleva su titulo, quien la mando y cuando llego', async () => {
    // The badge is a count, but the list next to it is read by a person, and a row
    // that says "algo" teaches nothing.
    const ana = await espacioConCosas('Ana diez');
    const beto = await createVerifiedUser(api, { displayName: 'Beto diez' });

    await api.post(
      '/shares',
      { nodeType: 'list', nodeId: ana.listId, granteeUserId: beto.userId, role: 'viewer' },
      ana.user.accessToken,
    );

    const r = await api.get('/shares/incoming', beto.accessToken);
    const mio = (r.body?.data?.items ?? [])[0];
    expect(mio.title).toBe('Compra');
    expect(mio.ownerName).toBe('Ana diez');
    expect(Number.isFinite(Date.parse(mio.createdAt))).toBe(true);
  });

  it('lo que se ha retirado ya no avisa', async () => {
    // A revoked grant is not news. Counting it would put a number on the menu for
    // something the person no longer has any way to act on.
    const ana = await espacioConCosas('Ana once');
    const beto = await createVerifiedUser(api, { displayName: 'Beto once' });

    const creada = await api.post(
      '/shares',
      { nodeType: 'list', nodeId: ana.listId, granteeUserId: beto.userId, role: 'viewer' },
      ana.user.accessToken,
    );
    expect(creada.status).toBe(201);

    await api.delete(`/shares/${creada.body.data.id}`, ana.user.accessToken);

    const r = await api.get('/shares/incoming', beto.accessToken);
    expect(r.body?.data?.items ?? []).toHaveLength(0);
  });

  it('pide sesion, como todo lo que cuenta lo que te han dado', async () => {
    const r = await api.get('/shares/incoming');
    expect(r.status).toBe(401);
  });
});
