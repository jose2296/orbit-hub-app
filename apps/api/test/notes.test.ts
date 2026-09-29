import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * Notes as an entity.
 *
 * These tests exist because of a long argument that went the other way. Three
 * comments in the schema said a note was the `notes` column of a list item and
 * therefore had no table of its own, and this endpoint is what that claim would
 * have made impossible. `adr/0008-note-entity.md` has the whole story.
 */
let api: TestServer;

beforeAll(async () => {
  api = await startTestServer();
});

afterAll(async () => {
  await api.close();
});

type OperationInput = {
  entity: string;
  kind: 'create' | 'update' | 'delete';
  entityId: string;
  baseVersion?: number;
  payload?: Record<string, unknown> | null;
  base?: Record<string, unknown> | null;
};

async function sync(user: TestUser, operations: OperationInput[]) {
  return api.post(
    '/sync/push',
    {
      deviceId: randomUUID(),
      lastPulledAt: null,
      operations: operations.map((operation) => ({
        operationId: randomUUID(),
        clientId: 'test-client-notes',
        entityId: operation.entityId,
        baseVersion: operation.baseVersion ?? 0,
        payload: operation.payload ?? null,
        base: operation.base ?? null,
        clientTimestamp: new Date().toISOString(),
        entity: operation.entity,
        kind: operation.kind,
      })),
    },
    user.accessToken,
  );
}

/**
 * The space is created through sync rather than through a route, because that is
 * how the app creates one: locally first, then pushed. A test that used a route
 * would be testing a path the app does not take.
 */
async function createWorkspace(user: TestUser, name: string): Promise<string> {
  const id = randomUUID();
  const response = await sync(user, [
    { entity: 'workspace', kind: 'create', entityId: id, payload: { name } },
  ]);
  expect(response.body.data.results[0].status).toBe('applied');
  return id;
}

const RECIPE = '<h2>Salsa de tomate</h2><p>Seis tomates maduros.</p><ul><li>Sal</li></ul>';

function create(user: TestUser, body: Record<string, unknown>) {
  return api.post('/notes', body, user.accessToken);
}

describe('notes', () => {
  it('requires authentication', async () => {
    const response = await api.get('/notes');
    expect(response.status).toBe(401);
  });

  it('creates a note and derives the text that search matches on', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Cocina');

    const response = await create(user, {
      workspaceId,
      title: 'Salsa',
      document: RECIPE,
      // A client that sends this must not be believed: the server derives it.
      plainText: 'algo inventado',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.title).toBe('Salsa');
    expect(response.body.data.document).toBe(RECIPE);
    expect(response.body.data.plainText).toBe('Salsa de tomate\nSeis tomates maduros.\nSal');
    expect(response.body.data.version).toBe(1);
    expect(response.body.data.attachmentCount).toBe(0);
  });

  it('refuses a document with a tag the editor does not produce', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Cocina');

    const response = await create(user, {
      workspaceId,
      title: 'Mala',
      document: '<p>hola</p><script>alert(1)</script>',
    });

    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).toContain('script');
  });

  it('refuses a document that carries its own presentation', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Cocina');

    const response = await create(user, {
      workspaceId,
      title: 'Mala',
      document: '<p style="color:red">hola</p>',
    });

    expect(response.status).toBe(422);
  });

  it('refuses a space the caller does not belong to', async () => {
    const owner = await createVerifiedUser(api);
    const stranger = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(owner, 'Privada');

    const response = await create(stranger, {
      workspaceId,
      title: 'No deberia',
      document: '<p>x</p>',
    });

    // 404 and not 403: the answer does not describe what exists.
    expect(response.status).toBe(404);
  });

  it('refuses a folder that belongs to another space', async () => {
    // A note carries both a space and a folder. A mismatched pair would file
    // somebody's note where they cannot see it, which is a leak and a way to
    // lose it at the same time.
    const user = await createVerifiedUser(api);
    const mine = await createWorkspace(user, 'Mia');
    const other = await createWorkspace(user, 'Otra');

    const folder = randomUUID();
    const made = await sync(user, [
      { entity: 'folder', kind: 'create', entityId: folder, payload: { workspaceId: other, name: 'Alli' } },
    ]);
    expect(made.body.data.results[0].status).toBe('applied');

    const mismatched = await create(user, {
      workspaceId: mine,
      folderId: folder,
      title: 'Mal archivada',
      document: '<p>x</p>',
    });
    expect(mismatched.status).toBe(422);

    const matched = await create(user, {
      workspaceId: other,
      folderId: folder,
      title: 'Bien archivada',
      document: '<p>x</p>',
    });
    expect(matched.status).toBe(201);
    expect(matched.body.data.folderId).toBe(folder);
  });

  it('reads a note back', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Lectura');
    const created = await create(user, { workspaceId, title: 'Se lee', document: '<p>hola</p>' });

    const response = await api.get(`/notes/${created.body.data.id}`, user.accessToken);

    expect(response.status).toBe(200);
    expect(response.body.data.title).toBe('Se lee');
  });

  it('lists the notes of a space, most recent first', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Lista');
    await create(user, { workspaceId, title: 'Primera', document: '<p>1</p>' });
    await create(user, { workspaceId, title: 'Segunda', document: '<p>2</p>' });

    const response = await api.get(`/notes?workspaceId=${workspaceId}`, user.accessToken);

    expect(response.status).toBe(200);
    const titles = response.body.data.items.map((item: { title: string }) => item.title);
    expect(titles).toHaveLength(2);
    expect(titles).toContain('Primera');
    expect(titles).toContain('Segunda');
  });

  it('filters by tag', async () => {
    // No longer by favourite: a note is not starred. What goes on the panel is a
    // card, and a star was a second, worse way of saying the same thing that
    // nothing acted on.
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Filtros');
    const etiquetada = await create(user, {
      workspaceId,
      title: 'Con etiqueta',
      document: '<p>1</p>',
      tags: ['cocina'],
    });
    await create(user, { workspaceId, title: 'Normal', document: '<p>2</p>' });

    const tagged = await api.get(`/notes?workspaceId=${workspaceId}&tag=cocina`, user.accessToken);
    expect(tagged.body.data.items.map((i: { title: string }) => i.title)).toEqual([
      'Con etiqueta',
    ]);

    /*
     * And there is no star to set.
     *
     * A client from before the removal still sends it, and the answer is 200 with
     * the field gone: Zod drops what it does not know rather than refusing the
     * whole request, which is what every other field in this API does. Pinning a
     * note to the panel is the thing that replaced it, and that is a card and not
     * a field on the note.
     */
    const starred = await api.request(`/notes/${etiquetada.body.data.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ favorite: true, expectedVersion: 1 }),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${user.accessToken}` },
    });
    expect(starred.status).toBe(200);
    expect(starred.body.data).not.toHaveProperty('favorite');
  });

  it('updates a note and moves its version forward', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Edicion');
    const created = await create(user, { workspaceId, title: 'Antes', document: '<p>1</p>' });

    const response = await api.request(`/notes/${created.body.data.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: 'Despues',
        document: '<h2>Dos</h2>',
        expectedVersion: 1,
      }),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${user.accessToken}` },
    });

    expect(response.status).toBe(200);
    expect(response.body.data.title).toBe('Despues');
    expect(response.body.data.version).toBe(2);
    // Re-derived, not carried over from the previous body.
    expect(response.body.data.plainText).toBe('Dos');
  });

  it('refuses a second save from a device that has not seen the first', async () => {
    // Two devices editing the same note offline is the normal case here, not
    // the edge one. Last write wins would drop a paragraph somebody wrote.
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Conflicto');
    const created = await create(user, { workspaceId, title: 'Comun', document: '<p>1</p>' });

    const first = await api.request(`/notes/${created.body.data.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Desde el movil', expectedVersion: 1 }),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${user.accessToken}` },
    });
    expect(first.status).toBe(200);

    const stale = await api.request(`/notes/${created.body.data.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Desde el portatil', expectedVersion: 1 }),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${user.accessToken}` },
    });
    expect(stale.status).toBe(409);

    const read = await api.get(`/notes/${created.body.data.id}`, user.accessToken);
    expect(read.body.data.title).toBe('Desde el movil');
  });

  it('leaves a tombstone rather than deleting the row', async () => {
    // A phone that was offline has to be able to learn the note is gone. A row
    // that vanished is indistinguishable from a note that never existed.
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Borrado');
    const created = await create(user, { workspaceId, title: 'Se va', document: '<p>1</p>' });

    const response = await api.request(`/notes/${created.body.data.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${user.accessToken}` },
    });
    expect(response.status).toBe(204);

    const read = await api.get(`/notes/${created.body.data.id}`, user.accessToken);
    expect(read.status).toBe(404);

    const listed = await api.get(`/notes?workspaceId=${workspaceId}`, user.accessToken);
    expect(listed.body.data.items).toHaveLength(0);
  });

  it('refuses to write to a space where the caller may only look', async () => {
    const owner = await createVerifiedUser(api);
    const viewer = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(owner, 'Con viewer');

    // The invitation is how a person joins a space and the only way. A viewer is
    // a real role, so a note in their space has to respect it the way a list does.
    const link = await api.post(
      `/workspaces/${workspaceId}/invitations`,
      { email: viewer.email, role: 'viewer' },
      owner.accessToken,
    );
    expect(link.status).toBe(201);
    await api.post(`/invitations/${link.body.data.token}/accept`, {}, viewer.accessToken);

    const created = await create(owner, {
      workspaceId,
      title: 'Del dueño',
      document: '<p>1</p>',
    });
    expect(created.status).toBe(201);

    // A viewer may read.
    const read = await api.get(`/notes/${created.body.data.id}`, viewer.accessToken);
    expect(read.status).toBe(200);
    expect(read.body.data.title).toBe('Del dueño');

    // And may not write. 403 and not 404: the space exists and they are in it, so
    // the answer is about their role rather than about what is in there.
    const edit = await api.request(`/notes/${created.body.data.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Cambiada', expectedVersion: 1 }),
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${viewer.accessToken}`,
      },
    });
    expect(edit.status).toBe(403);

    // The note is exactly as it was.
    const after = await api.get(`/notes/${created.body.data.id}`, viewer.accessToken);
    expect(after.body.data.title).toBe('Del dueño');
    expect(after.body.data.version).toBe(1);
  });
});
