import type { SyncOperation } from '@orbit-hub/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * Notes through sync, which is how the app actually writes them.
 *
 * The REST routes in `notes.test.ts` are not the path a phone takes: it writes
 * locally, enqueues, and pushes. So the two paths can disagree, and they did once
 * already — the sync service had no `note` case and answered "The entity cannot
 * be created" for every note the app ever wrote, while the direct route worked
 * fine. These tests exist because that is a failure with no error message.
 */
let api: TestServer;

beforeAll(async () => {
  api = await startTestServer();
});

afterAll(async () => {
  await api.close();
});

function operation(over: Partial<SyncOperation> & Pick<SyncOperation, 'entity' | 'kind' | 'entityId'>) {
  return {
    operationId: randomUUID(),
    clientId: 'notes-sync-test',
    baseVersion: 0,
    payload: null,
    base: null,
    clientTimestamp: new Date().toISOString(),
    ...over,
  };
}

async function push(user: TestUser, operations: SyncOperation[]) {
  return api.post(
    '/sync/push',
    { deviceId: randomUUID(), lastPulledAt: null, operations },
    user.accessToken,
  );
}

async function createWorkspace(user: TestUser, name: string): Promise<{ id: string; version: number }> {
  const id = randomUUID();
  const response = await push(user, [
    operation({ entity: 'workspace', kind: 'create', entityId: id, payload: { name } }),
  ]);
  expect(response.body.data.results[0].status).toBe('applied');
  return { id, version: response.body.data.results[0].version as number };
}

const DOC = '<h2>Salsa</h2><p>Seis tomates.</p><ul><li>Sal</li></ul>';

describe('the sanitiser names the fields that exist', () => {
  /**
   * A rule that names a field which no longer exists is worse than no rule.
   *
   * `list_items.notes` became `list_items.annotation` in ADR 0008. The allow-list
   * was updated and the coercion rule was not, so every `annotation` a client
   * sent passed the allow-list, fell through every branch of the sanitiser, and
   * was dropped without a word: the push answered `applied` and the remark was
   * gone. Nothing failed, no test failed, and the only symptom was a remark that
   * did not save — which is exactly the "it looked like it worked" failure the
   * comment on `SYNC_WRITABLE_FIELDS` warns about.
   */
  it('writes an annotation through instead of dropping it', async () => {
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Anotaciones');
    const listId = randomUUID();

    const madeList = await push(user, [
      operation({
        entity: 'list',
        kind: 'create',
        entityId: listId,
        payload: { workspaceId: workspace.id, kind: 'tasks', title: 'Compra' },
      }),
    ]);
    expect(madeList.body.data.results[0].status).toBe('applied');

    const itemId = randomUUID();
    const madeItem = await push(user, [
      operation({
        entity: 'list_item',
        kind: 'create',
        entityId: itemId,
        payload: { listId, title: 'Leche', position: 0, annotation: 'traer el propio' },
      }),
    ]);
    expect(madeItem.body.data.results[0].status).toBe('applied');

    const items = await api.get(`/lists/${listId}/items`, user.accessToken);
    const item = items.body.data.items.find((row: { id: string }) => row.id === itemId);
    expect(item?.annotation).toBe('traer el propio');
  });
});

describe('notes through sync', () => {
  it('creates a note and derives the text that search matches on', async () => {
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Cocina');
    const noteId = randomUUID();

    const response = await push(user, [
      operation({
        entity: 'note',
        kind: 'create',
        entityId: noteId,
        payload: {
          workspaceId: workspace.id,
          title: 'Salsa',
          document: DOC,
          // A client that sends this must not be believed.
          plainText: 'algo inventado',
        },
      }),
    ]);

    const result = response.body.data.results[0];
    expect(result.status).toBe('applied');
    expect(result.version).toBe(1);

    const read = await api.get(`/notes/${noteId}`, user.accessToken);
    expect(read.status).toBe(200);
    expect(read.body.data.document).toBe(DOC);
    expect(read.body.data.plainText).toBe('Salsa\nSeis tomates.\nSal');
  });

  it('refuses a note with a document the editor does not produce', async () => {
    // The path a malicious or buggy client takes. The REST route validates and
    // this one has to as well, or the direct route is the only door with a lock.
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Cocina');

    const response = await push(user, [
      operation({
        entity: 'note',
        kind: 'create',
        entityId: randomUUID(),
        payload: {
          workspaceId: workspace.id,
          title: 'Mala',
          document: '<p>hola</p><script>alert(1)</script>',
        },
      }),
    ]);

    // A whole-batch failure would be worse, but the server answers per operation
    // and this one carries a document it will not store.
    expect(['rejected', 'failed']).toContain(response.body.data.results[0].status);
  });

  it('refuses a note with no space, because it cannot be placed', async () => {
    const user = await createVerifiedUser(api);

    const response = await push(user, [
      operation({
        entity: 'note',
        kind: 'create',
        entityId: randomUUID(),
        payload: { title: 'Huerfana', document: '<p>x</p>' },
      }),
    ]);

    expect(response.body.data.results[0].status).toBe('rejected');
    expect(response.body.data.results[0].error).toContain('workspaceId');
  });

  it('refuses a note in a space the caller does not belong to', async () => {
    const owner = await createVerifiedUser(api);
    const stranger = await createVerifiedUser(api);
    const workspace = await createWorkspace(owner, 'Privada');

    const response = await push(stranger, [
      operation({
        entity: 'note',
        kind: 'create',
        entityId: randomUUID(),
        payload: { workspaceId: workspace.id, title: 'No', document: '<p>x</p>' },
      }),
    ]);

    expect(['rejected', 'failed']).toContain(response.body.data.results[0].status);
  });

  it('updates a note and moves its version on', async () => {
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Edicion');
    const noteId = randomUUID();

    await push(user, [
      operation({
        entity: 'note',
        kind: 'create',
        entityId: noteId,
        payload: { workspaceId: workspace.id, title: 'Antes', document: '<p>1</p>' },
      }),
    ]);

    const response = await push(user, [
      operation({
        entity: 'note',
        kind: 'update',
        entityId: noteId,
        baseVersion: 1,
        payload: { document: '<p>2</p>' },
      }),
    ]);

    const result = response.body.data.results[0];
    expect(result.status).toBe('applied');
    expect(result.version).toBe(2);

    const read = await api.get(`/notes/${noteId}`, user.accessToken);
    expect(read.body.data.plainText).toBe('2');
  });

  it('sends a note to a second device through the pull', async () => {
    // The whole reason a note is written locally first: the other device is the
    // proof, and without a pull a note exists on exactly one phone.
    const phone = await createVerifiedUser(api);
    const workspace = await createWorkspace(phone, 'Dos dispositivos');
    const noteId = randomUUID();

    const pulledBefore = await api.post(
      '/sync/pull',
      { cursor: null, limit: 100 },
      phone.accessToken,
    );
    const cursorBefore = pulledBefore.body.data.nextCursor as string;

    await push(phone, [
      operation({
        entity: 'note',
        kind: 'create',
        entityId: noteId,
        payload: { workspaceId: workspace.id, title: 'Compartida', document: '<p>hola</p>' },
      }),
    ]);

    const after = await api.post(
      '/sync/pull',
      { cursor: cursorBefore, limit: 100 },
      phone.accessToken,
    );

    const change = (after.body.data.changes as {
      entity: string;
      record: { id: string; document?: string };
    }[]).find((entry) => entry.entity === 'note' && entry.record.id === noteId);

    expect(change).toBeDefined();
    expect(change?.record.document).toBe('<p>hola</p>');
  });

  it('deletes a note as a tombstone another device can see', async () => {
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Borrado');
    const noteId = randomUUID();

    await push(user, [
      operation({
        entity: 'note',
        kind: 'create',
        entityId: noteId,
        payload: { workspaceId: workspace.id, title: 'Se va', document: '<p>1</p>' },
      }),
    ]);
    const before = await api.post('/sync/pull', { cursor: null, limit: 100 }, user.accessToken);

    const response = await push(user, [
      operation({ entity: 'note', kind: 'delete', entityId: noteId, baseVersion: 1 }),
    ]);
    expect(response.body.data.results[0].status).toBe('applied');

    const after = await api.post(
      '/sync/pull',
      { cursor: before.body.data.nextCursor, limit: 100 },
      user.accessToken,
    );
    const tombstone = (after.body.data.changes as {
      entity: string;
      record: { id: string; deletedAt: string | null };
    }[]).find((entry) => entry.entity === 'note' && entry.record.id === noteId);

    expect(tombstone?.record.deletedAt).toBeTruthy();
  });

  it('does not call a save a conflict when both sides wrote the same thing', async () => {
    /**
     * The bug this covers, found by typing into a new note in the browser.
     *
     * Two saves of one document go out. The first is applied, and the second
     * carries a base from before it, so the server is at version 2 and the client
     * says it saw 1. `serverChanged` and `clientChanged` are both true for
     * `document` — and the two values were byte for byte the same, because it is
     * the same sentence typed once. The field was reported as contested and a
     * conflict appeared in the sync centre for a document nobody disagreed about.
     *
     * Asking somebody to choose between a value and itself is a question with no
     * answer that still leaves something to review, so it has to not be a conflict.
     */
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Mismo valor');
    const noteId = randomUUID();
    const document = '<p>Manzana y canela.</p>';

    await push(user, [
      operation({
        entity: 'note',
        kind: 'create',
        entityId: noteId,
        payload: { workspaceId: workspace.id, title: 'Tarta', document },
      }),
    ]);

    // The first edit lands.
    const first = await push(user, [
      operation({
        entity: 'note',
        kind: 'update',
        entityId: noteId,
        baseVersion: 1,
        payload: { document },
        base: { document },
      }),
    ]);
    expect(first.body.data.results[0].status).toBe('applied');
    const version = first.body.data.results[0].version as number;

    // The second carries a base from before the first and the same value.
    const second = await push(user, [
      operation({
        entity: 'note',
        kind: 'update',
        entityId: noteId,
        baseVersion: 1,
        payload: { document },
        base: { document },
      }),
    ]);

    expect(second.body.data.results[0].status).toBe('applied');
    // And it did not bump the version either: nothing changed, so there is nothing
    // to tell the other devices about.
    expect(second.body.data.results[0].version).toBe(version);
  });

  it('still calls it a conflict when the two sides really do differ', async () => {
    // The counterpart to the test above, because the fix is "no conflict when the
    // values match" and not "no conflicts at all".
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Discrepan');
    const noteId = randomUUID();

    await push(user, [
      operation({
        entity: 'note',
        kind: 'create',
        entityId: noteId,
        payload: { workspaceId: workspace.id, title: 'Receta', document: '<p>base</p>' },
      }),
    ]);
    await push(user, [
      operation({
        entity: 'note',
        kind: 'update',
        entityId: noteId,
        baseVersion: 1,
        payload: { document: '<p>del servidor</p>' },
        base: { document: '<p>base</p>' },
      }),
    ]);

    const stale = await push(user, [
      operation({
        entity: 'note',
        kind: 'update',
        entityId: noteId,
        baseVersion: 1,
        payload: { document: '<p>del movil</p>' },
        base: { document: '<p>base</p>' },
      }),
    ]);

    expect(stale.body.data.results[0].status).toBe('conflict');

    // The server's value survives: the whole design is that it is never
    // last-write-wins on a field both sides moved.
    const read = await api.get(`/notes/${noteId}`, user.accessToken);
    expect(read.body.data.document).toBe('<p>del servidor</p>');
  });

  it('drops a field the sync protocol does not own, in silence on purpose', async () => {
    // `plain_text` and `attachment_count` are the server's to derive. A payload
    // carrying them is sanitised rather than refused, because refusing would fail
    // a whole batch over a field the client was never supposed to send.
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Sanitizado');
    const noteId = randomUUID();

    const response = await push(user, [
      operation({
        entity: 'note',
        kind: 'create',
        entityId: noteId,
        payload: {
          workspaceId: workspace.id,
          title: 'Con extras',
          document: '<p>hola</p>',
          plainText: 'inventado',
          attachmentCount: 99,
          version: 42,
        },
      }),
    ]);

    expect(response.body.data.results[0].status).toBe('applied');
    const read = await api.get(`/notes/${noteId}`, user.accessToken);
    expect(read.body.data.plainText).toBe('hola');
    expect(read.body.data.attachmentCount).toBe(0);
    expect(read.body.data.version).toBe(1);
  });
});
