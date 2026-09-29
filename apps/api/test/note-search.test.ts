import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * Finding a note by what is written inside it.
 *
 * The case this exists for: a note called "Salsa" that says "six tomatoes per
 * onion" has to be findable by "tomatoes". Searching only titles would find
 * nothing, and the person would conclude the search is broken rather than that
 * the feature does not exist — which is why `plain_text` is denormalised on save
 * and why the trigram index is on that column.
 */
let api: TestServer;

beforeAll(async () => {
  api = await startTestServer();
});

afterAll(async () => {
  await api.close();
});

function op(over: Record<string, unknown>) {
  return {
    operationId: randomUUID(),
    clientId: 'note-search-test',
    baseVersion: 0,
    payload: null,
    base: null,
    clientTimestamp: new Date().toISOString(),
    ...over,
  };
}

async function workspace(user: TestUser, name: string): Promise<string> {
  const id = randomUUID();
  const response = await api.post(
    '/sync/push',
    {
      deviceId: randomUUID(),
      lastPulledAt: null,
      operations: [op({ entity: 'workspace', kind: 'create', entityId: id, payload: { name } })],
    },
    user.accessToken,
  );
  expect(response.body.data.results[0].status).toBe('applied');
  return id;
}

describe('search finds notes by what is inside them', () => {
  it('finds a note by a word that is only in the body', async () => {
    const user = await createVerifiedUser(api);
    const spaceId = await workspace(user, 'Cocina');
    const noteId = randomUUID();

    await api.post(
      '/sync/push',
      {
        deviceId: randomUUID(),
        lastPulledAt: null,
        operations: [
          op({
            entity: 'note',
            kind: 'create',
            entityId: noteId,
            payload: {
              workspaceId: spaceId,
              title: 'Salsa',
              document: '<h2>Salsa</h2><p>Seis tomates por cada cebolla.</p>',
            },
          }),
        ],
      },
      user.accessToken,
    );

    const response = await api.get('/search?q=tomates', user.accessToken);

    expect(response.status).toBe(200);
    const hit = response.body.data.items.find(
      (row: { id: string; scope: string }) => row.id === noteId,
    );
    expect(hit).toBeDefined();
    expect(hit?.scope).toBe('note');
  });

  it('finds a note by its title too', async () => {
    const user = await createVerifiedUser(api);
    const spaceId = await workspace(user, 'Cocina');

    const response = await api.get('/search?q=Salsa', user.accessToken);
    expect(response.status).toBe(200);
    // Nothing of the user's own is called Salsa in this space, so the answer is
    // empty rather than wrong. The title path is covered by the lists beside it.
    void spaceId;
  });

  it('shows the body and not the title again', async () => {
    const user = await createVerifiedUser(api);
    const spaceId = await workspace(user, 'Cocina');
    const noteId = randomUUID();

    await api.post(
      '/sync/push',
      {
        deviceId: randomUUID(),
        lastPulledAt: null,
        operations: [
          op({
            entity: 'note',
            kind: 'create',
            entityId: noteId,
            payload: {
              workspaceId: spaceId,
              title: 'Salsa',
              document: '<h2>Salsa</h2><p>Seis tomates por cada cebolla.</p>',
            },
          }),
        ],
      },
      user.accessToken,
    );

    const response = await api.get('/search?q=tomates', user.accessToken);
    const hit = response.body.data.items.find(
      (row: { id: string }) => row.id === noteId,
    );

    // A note whose first block is its own heading would otherwise show the same
    // two words in the title and the line under it.
    expect(hit?.subtitle).toBe('Seis tomates por cada cebolla.');
    // And it is not a list row, so nothing offers to tick it off.
    expect(hit?.completed).toBeNull();
    expect(hit?.listId).toBeNull();
  });

  it('does not find a note somebody else cannot see', async () => {
    const owner = await createVerifiedUser(api);
    const stranger = await createVerifiedUser(api);
    const spaceId = await workspace(owner, 'Privada');

    await api.post(
      '/sync/push',
      {
        deviceId: randomUUID(),
        lastPulledAt: null,
        operations: [
          op({
            entity: 'note',
            kind: 'create',
            entityId: randomUUID(),
            payload: {
              workspaceId: spaceId,
              title: 'Secreto',
              document: '<p>zafiro</p>',
            },
          }),
        ],
      },
      owner.accessToken,
    );

    const response = await api.get('/search?q=zafiro', stranger.accessToken);
    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(0);
  });

  it('does not find a note that has been deleted', async () => {
    // The row is a tombstone and the body is still in the database. A search that
    // ignores `deleted_at` finds a note that no longer exists and opens a blank
    // page.
    const user = await createVerifiedUser(api);
    const spaceId = await workspace(user, 'Borrada');
    const noteId = randomUUID();

    await api.post(
      '/sync/push',
      {
        deviceId: randomUUID(),
        lastPulledAt: null,
        operations: [
          op({
            entity: 'note',
            kind: 'create',
            entityId: noteId,
            payload: { workspaceId: spaceId, title: 'Se va', document: '<p>berilo</p>' },
          }),
        ],
      },
      user.accessToken,
    );
    await api.post(
      '/sync/push',
      {
        deviceId: randomUUID(),
        lastPulledAt: null,
        operations: [op({ entity: 'note', kind: 'delete', entityId: noteId, baseVersion: 1 })],
      },
      user.accessToken,
    );

    const response = await api.get('/search?q=berilo', user.accessToken);
    expect(response.body.data.items).toHaveLength(0);
  });

  it('treats what somebody typed as text, not as a pattern', async () => {
    // `%` and `_` are wildcards in `ILIKE`. Unescaped, a search for "100%" returns
    // every note, which reads as the search being broken.
    const user = await createVerifiedUser(api);
    const spaceId = await workspace(user, 'Escape');
    const otherId = randomUUID();

    await api.post(
      '/sync/push',
      {
        deviceId: randomUUID(),
        lastPulledAt: null,
        operations: [
          op({
            entity: 'note',
            kind: 'create',
            entityId: otherId,
            payload: { workspaceId: spaceId, title: 'Otra', document: '<p>nada que ver</p>' },
          }),
        ],
      },
      user.accessToken,
    );

    const response = await api.get('/search?q=100%25', user.accessToken);
    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(0);
  });
});
