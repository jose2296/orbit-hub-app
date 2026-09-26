import type { SyncOperation } from '@orbit-hub/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

let api: TestServer;

beforeAll(async () => {
  api = await startTestServer();
});

afterAll(async () => {
  await api.close();
});

function operation(partial: Partial<SyncOperation> & Pick<SyncOperation, 'entity' | 'kind'>): SyncOperation {
  return {
    operationId: randomUUID(),
    clientId: 'test-client-0001',
    entityId: randomUUID(),
    baseVersion: 0,
    payload: {},
    base: null,
    clientTimestamp: new Date().toISOString(),
    ...partial,
  } as SyncOperation;
}

async function push(user: TestUser, operations: SyncOperation[]) {
  return api.post(
    '/sync/push',
    { deviceId: randomUUID(), lastPulledAt: null, operations },
    user.accessToken,
  );
}

async function pull(user: TestUser, cursor: string | null = null, deviceId?: string) {
  return api.post('/sync/pull', { cursor, limit: 100, ...(deviceId ? { deviceId } : {}) }, user.accessToken);
}

/** Creates a workspace through sync and returns its id and version. */
async function createWorkspace(user: TestUser, name: string) {
  const id = randomUUID();
  const response = await push(user, [
    operation({
      entity: 'workspace',
      kind: 'create',
      entityId: id,
      payload: { name },
    }),
  ]);

  const result = response.body.data.results[0];
  expect(result.status).toBe('applied');
  return { id, version: result.version as number };
}

describe('POST /sync/push', () => {
  it('rejects unauthenticated calls', async () => {
    const response = await api.post('/sync/push', { deviceId: randomUUID(), operations: [] });
    expect(response.status).toBe(401);
  });

  it('validates the payload', async () => {
    const user = await createVerifiedUser(api);
    const response = await api.post('/sync/push', { operations: 'nope' }, user.accessToken);

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('validation_failed');
  });

  it('creates a workspace and makes the creator its owner', async () => {
    const user = await createVerifiedUser(api);
    const created = await createWorkspace(user, 'Casa');

    const pulled = await pull(user);
    const workspace = pulled.body.data.changes.find(
      (change: { entity: string }) => change.entity === 'workspace',
    );

    expect(workspace).toBeDefined();
    expect(workspace.record.id).toBe(created.id);
    expect(workspace.record.name).toBe('Casa');
    expect(workspace.record.version).toBe(created.version);
  });

  it('ignores fields the sync protocol does not own', async () => {
    const user = await createVerifiedUser(api);
    const id = randomUUID();

    await push(user, [
      operation({
        entity: 'workspace',
        kind: 'create',
        entityId: id,
        payload: { name: 'Seguro', version: 99, userId: randomUUID(), id: 'hijacked' },
      }),
    ]);

    const pulled = await pull(user);
    const workspace = pulled.body.data.changes.find(
      (change: { record: { id: string } }) => change.record.id === id,
    );

    expect(workspace.record.name).toBe('Seguro');
    // The client could not overwrite the version or the id.
    expect(workspace.record.version).toBe(1);
  });

  it('is idempotent: replaying a batch changes nothing', async () => {
    const user = await createVerifiedUser(api);
    const id = randomUUID();
    const batch = [
      operation({ entity: 'workspace', kind: 'create', entityId: id, payload: { name: 'Una vez' } }),
    ];

    const first = await push(user, batch);
    const second = await push(user, batch);

    expect(first.body.data.results[0].status).toBe('applied');
    expect(second.body.data.results[0].status).toBe('duplicate');
    expect(second.body.data.results[0].version).toBe(first.body.data.results[0].version);

    const workspaces = (
      await pull(user)
    ).body.data.changes.filter(
      (change: { entity: string; record: { id: string } }) =>
        change.entity === 'workspace' && change.record.id === id,
    );
    expect(workspaces).toHaveLength(1);
  });

  it('bumps the version on an update with a matching baseVersion', async () => {
    const user = await createVerifiedUser(api);
    const created = await createWorkspace(user, 'Original');

    const response = await push(user, [
      operation({
        entity: 'workspace',
        kind: 'update',
        entityId: created.id,
        baseVersion: created.version,
        payload: { name: 'Renombrado' },
      }),
    ]);

    expect(response.body.data.results[0].status).toBe('applied');
    expect(response.body.data.results[0].version).toBe(created.version + 1);
  });

  it('stores a conflict when the same field changed on both sides', async () => {
    const user = await createVerifiedUser(api);
    const created = await createWorkspace(user, 'Compartido');

    // Another device renames it first.
    await push(user, [
      operation({
        entity: 'workspace',
        kind: 'update',
        entityId: created.id,
        baseVersion: created.version,
        payload: { name: 'Nombre del otro dispositivo' },
      }),
    ]);

    // This device still holds the old version and changes the same field.
    const conflicting = await push(user, [
      operation({
        entity: 'workspace',
        kind: 'update',
        entityId: created.id,
        baseVersion: created.version,
        payload: { name: 'Nombre de este dispositivo' },
      }),
    ]);

    expect(conflicting.body.data.results[0].status).toBe('conflict');

    const conflicts = await api.get('/sync/conflicts', user.accessToken);
    expect(conflicts.status).toBe(200);
    expect(conflicts.body.data).toHaveLength(1);
    expect(conflicts.body.data[0].conflictingFields).toEqual(['name']);
    expect(conflicts.body.data[0].status).toBe('pending');

    // The server value survived: nothing was overwritten.
    const pulled = await pull(user);
    const workspace = pulled.body.data.changes
      .filter((change: { entity: string }) => change.entity === 'workspace')
      .at(-1);
    expect(workspace.record.name).toBe('Nombre del otro dispositivo');
  });

  it('merges automatically when the fields do not overlap', async () => {
    const user = await createVerifiedUser(api);
    const created = await createWorkspace(user, 'Sin choques');

    await push(user, [
      operation({
        entity: 'workspace',
        kind: 'update',
        entityId: created.id,
        baseVersion: created.version,
        payload: { description: 'Otro dispositivo escribió esto' },
      }),
    ]);

    // Stale baseVersion, but this device only touches a field the other one did
    // not. With the base state the server can merge without asking anyone.
    const merged = await push(user, [
      operation({
        entity: 'workspace',
        kind: 'update',
        entityId: created.id,
        baseVersion: created.version,
        base: { emoji: null },
        payload: { emoji: '🏠' },
      }),
    ]);

    expect(merged.body.data.results[0].status).toBe('applied');

    const conflicts = await api.get('/sync/conflicts', user.accessToken);
    expect(conflicts.body.data).toHaveLength(0);

    const workspace = (
      await pull(user)
    ).body.data.changes
      .filter((change: { entity: string }) => change.entity === 'workspace')
      .at(-1);
    expect(workspace.record.emoji).toBe('🏠');
    expect(workspace.record.description).toBe('Otro dispositivo escribió esto');
  });

  it('still reports a conflict when both sides changed the same field', async () => {
    const user = await createVerifiedUser(api);
    const created = await createWorkspace(user, 'Choque real');

    await push(user, [
      operation({
        entity: 'workspace',
        kind: 'update',
        entityId: created.id,
        baseVersion: created.version,
        payload: { name: 'Cambio remoto' },
      }),
    ]);

    const conflict = await push(user, [
      operation({
        entity: 'workspace',
        kind: 'update',
        entityId: created.id,
        baseVersion: created.version,
        base: { name: 'Sin choques' },
        payload: { name: 'Cambio local' },
      }),
    ]);

    expect(conflict.body.data.results[0].status).toBe('conflict');
  });

  it('tombstones a delete instead of removing the row', async () => {
    const user = await createVerifiedUser(api);
    const created = await createWorkspace(user, 'Se va');

    const response = await push(user, [
      operation({ entity: 'workspace', kind: 'delete', entityId: created.id }),
    ]);
    expect(response.body.data.results[0].status).toBe('applied');

    const changes = (await pull(user)).body.data.changes.filter(
      (change: { entity: string; record: { id: string } }) =>
        change.entity === 'workspace' && change.record.id === created.id,
    );
    // The tombstone is visible, which is how other devices learn about it.
    expect(changes.at(-1).record.deletedAt).toBeTruthy();
  });

  it('refuses to write to a workspace the user cannot see', async () => {
    const user = await createVerifiedUser(api);
    const stranger = await createVerifiedUser(api);
    const strangerWorkspace = await createWorkspace(stranger, 'Privada');

    const response = await push(user, [
      operation({
        entity: 'workspace',
        kind: 'update',
        entityId: strangerWorkspace.id,
        baseVersion: strangerWorkspace.version,
        payload: { name: 'Me la quedo' },
      }),
    ]);

    expect(response.body.data.results[0].status).toBe('rejected');
    expect(response.body.data.results[0].error).toContain('not found');
  });

  it('creates folders inside a workspace the user can edit', async () => {
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Con carpetas');
    const folderId = randomUUID();

    const response = await push(user, [
      operation({
        entity: 'folder',
        kind: 'create',
        entityId: folderId,
        payload: { name: 'Documentación', workspaceId: workspace.id, position: 0 },
      }),
    ]);

    expect(response.body.data.results[0].status).toBe('applied');

    const folder = (await pull(user)).body.data.changes.find(
      (change: { entity: string; record: { id: string } }) =>
        change.entity === 'folder' && change.record.id === folderId,
    );
    expect(folder.record.name).toBe('Documentación');
    expect(folder.record.workspaceId).toBe(workspace.id);
  });

  it('rejects a folder created outside any workspace', async () => {
    const user = await createVerifiedUser(api);
    const response = await push(user, [
      operation({
        entity: 'folder',
        kind: 'create',
        entityId: randomUUID(),
        payload: { name: 'Huérfana' },
      }),
    ]);

    expect(response.body.data.results[0].status).toBe('rejected');
    expect(response.body.data.results[0].error).toContain('workspaceId');
  });

  it('rejects entities this build does not sync yet', async () => {
    const user = await createVerifiedUser(api);
    const response = await push(user, [
      operation({ entity: 'note', kind: 'create', payload: { title: 'Nota' } }),
    ]);

    expect(response.body.data.results[0].status).toBe('rejected');
    expect(response.body.data.results[0].error).toContain('not synced yet');
  });
});

describe('one bad operation in a batch', () => {
  /**
   * A batch is everything a person wrote while offline.
   *
   * Rejecting the whole batch for one operation the server cannot read leaves
   * the outbox unable to drain, and the app silent, because a client that
   * retries gets the same answer every time. This is not hypothetical: one
   * entity had a literal string where a uuid belongs, and from that moment
   * nothing anybody wrote was ever sent again.
   */
  it('rejects only the operation that cannot be read, and applies the rest', async () => {
    const user = await createVerifiedUser(api);
    const { id: workspaceId } = await createWorkspace(user, 'Lote');

    const good = randomUUID();
    const response = await push(user, [
      operation({ entity: 'list', kind: 'create', entityId: good, payload: { workspaceId, title: 'Buena' } }),
      // The literal that broke it: an entity id that is not a uuid.
      operation({ entity: 'dashboard', kind: 'update', entityId: 'dashboard', payload: { layout: [] } }),
      operation({ entity: 'list', kind: 'create', entityId: randomUUID(), payload: { workspaceId, title: 'También buena' } }),
    ]);

    const byStatus = response.body.data.results.map((r: { status: string }) => r.status);
    expect(byStatus).toEqual(['applied', 'rejected', 'applied']);

    const stored = await api.get(`/lists?workspaceId=${workspaceId}`, user.accessToken);
    const titles = stored.body.data.items.map((l: { title: string }) => l.title);
    expect(titles).toContain('Buena');
    expect(titles).toContain('También buena');
  });

  it('says why it was rejected, so the client can drop it instead of retrying', async () => {
    const user = await createVerifiedUser(api);
    const response = await push(user, [
      operation({ entity: 'list', kind: 'create', entityId: 'no-so-un-uuid', payload: {} }),
    ]);

    const result = response.body.data.results[0];
    expect(result.status).toBe('rejected');
    expect(result.error).toBeTruthy();
  });

  it('still applies the batch when nothing in it is wrong', async () => {
    const user = await createVerifiedUser(api);
    const { id: workspaceId } = await createWorkspace(user, 'Entero');

    const ids = [randomUUID(), randomUUID()];
    const response = await push(
      user,
      ids.map((id, index) =>
        operation({ entity: 'list', kind: 'create', entityId: id, payload: { workspaceId, title: `Lista ${index}` } }),
      ),
    );

    expect(response.body.data.results.every((r: { status: string }) => r.status === 'applied')).toBe(true);
  });
});

describe('the kinds of a list', () => {
  /**
   * Every kind survives the trip to the server.
   *
   * This was a list of three in two places, and the copy in the field sanitis
   * silently turned a list of series into a list of tasks: the person created
   * it, saw it appear as tasks, and had no idea why. A kind that is quietly
   * replaced is worse than one that is rejected, so each of the five is pinned
   * here against the real push.
   */
  it('keeps all five, one list at a time', async () => {
    const user = await createVerifiedUser(api);
    const { id: workspaceId } = await createWorkspace(user, 'Kinds');

    const kinds = ['tasks', 'movies', 'series', 'movies_and_series', 'books'] as const;
    const ids = kinds.map(() => randomUUID());

    const response = await push(
      user,
      ids.map((id, index) =>
        operation({
          entity: 'list',
          kind: 'create',
          entityId: id,
          payload: { workspaceId, title: `Lista ${kinds[index]}`, kind: kinds[index] },
        }),
      ),
    );

    for (const result of response.body.data.results) {
      expect(result.status).toBe('applied');
    }

    // Read them back from the list endpoint rather than from the push response,
    // so what is checked is what was stored.
    const stored = await api.get(`/lists?workspaceId=${workspaceId}`, user.accessToken);
    const byTitle = new Map(
      (stored.body.data.items ?? []).map((list: { title: string; kind: string }) => [list.title, list.kind]),
    );

    for (const kind of kinds) {
      expect(byTitle.get(`Lista ${kind}`)).toBe(kind);
    }
  });

  it('turns a kind that does not exist into tasks rather than failing', async () => {
    // The field is a string from a client that may be a newer build, so an
    // unknown value is a fallback and not a rejection: rejecting it would leave
    // the operation in the outbox forever with nothing to show for it.
    const user = await createVerifiedUser(api);
    const { id: workspaceId } = await createWorkspace(user, 'Kinds');

    const id = randomUUID();
    const response = await push(user, [
      operation({
        entity: 'list',
        kind: 'create',
        entityId: id,
        payload: { workspaceId, title: 'Inventada', kind: 'films' },
      }),
    ]);

    expect(response.body.data.results[0].status).toBe('applied');
    const stored = await api.get(`/lists?workspaceId=${workspaceId}`, user.accessToken);
    expect(stored.body.data.items[0].kind).toBe('tasks');
  });
});

describe('POST /sync/pull', () => {
  it('returns everything the user can see, ordered by updatedAt', async () => {    const user = await createVerifiedUser(api);
    await createWorkspace(user, 'Primero');
    await createWorkspace(user, 'Segundo');

    const response = await pull(user);

    expect(response.status).toBe(200);
    const changes = response.body.data.changes as { entity: string; record: { updatedAt: string } }[];
    expect(changes.length).toBeGreaterThanOrEqual(2);

    const timestamps = changes.map((change) => new Date(change.record.updatedAt).getTime());
    expect([...timestamps].sort((a, b) => a - b)).toEqual(timestamps);
    expect(response.body.data.hasMore).toBe(false);
  });

  /**
   * The Phase 3 exit criterion: a list written on one device while offline
   * arrives on another exactly once, in order.
   *
   * The interesting part is "exactly once". The phone queues its writes with no
   * connection, so the batch is replayed when it lands, and a replayed
   * operationId must not produce a second row. A second device with its own
   * cursor is what makes the ordering visible.
   */
  it('delivers an offline list once and in order on another device', async () => {
    const phone = await createVerifiedUser(api);
    const laptop = await api.post('/auth/login', {
      email: phone.email,
      password: phone.password,
      device: { label: 'Portátil', platform: 'web' },
    });
    const laptopToken = laptop.body.data.session.accessToken;

    const workspace = await createWorkspace(phone, 'Avión');
    const listId = randomUUID();

    // The phone is offline: the batch sits in its outbox and goes out later.
    const queued = [
      operation({
        entity: 'list',
        kind: 'create',
        entityId: listId,
        payload: { workspaceId: workspace.id, title: 'Pendiente en el avión', kind: 'tasks' },
      }),
      ...['Primero', 'Segundo', 'Tercero'].map((title, index) =>
        operation({
          entity: 'list_item',
          kind: 'create',
          entityId: randomUUID(),
          payload: { listId, title, position: index },
        }),
      ),
    ];

    // Sent twice, as a client that reconnects and retries would.
    await push(phone, queued);
    const replay = await push(phone, queued);
    expect(replay.body.data.results.every((r: { status: string }) => r.status === 'duplicate')).toBe(
      true,
    );

    const fromLaptop = await api.post('/sync/pull', { cursor: null, limit: 100 }, laptopToken);
    const changes = fromLaptop.body.data.changes as {
      entity: string;
      record: { id: string; listId?: string; title: string; position: number };
    }[];

    const lists = changes.filter((change) => change.entity === 'list' && change.record.id === listId);
    expect(lists).toHaveLength(1);

    const items = changes
      .filter((change) => change.entity === 'list_item' && change.record.listId === listId)
      .sort((a, b) => a.record.position - b.record.position);

    expect(items.map((item) => item.record.title)).toEqual(['Primero', 'Segundo', 'Tercero']);
    expect(items.map((item) => item.record.position)).toEqual([0, 1, 2]);
  });

  it('keeps every field of a create, not only the ones the insert names', async () => {
    // The bug this stops: the create spelled out its fields one by one, so a
    // field the validator accepted and the column had was still dropped on the
    // floor by the insert, and nothing anywhere said so. The icon of a row, its
    // labels and the order of a list all arrived as nothing.
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Iconos');
    const listId = randomUUID();
    const itemId = randomUUID();

    await push(user, [
      operation({
        entity: 'list',
        kind: 'create',
        entityId: listId,
        payload: { workspaceId: workspace.id, title: 'Compra', kind: 'tasks', orderMode: 'alphabetical' },
      }),
      operation({
        entity: 'list_item',
        kind: 'create',
        entityId: itemId,
        payload: {
          listId,
          title: 'Pan',
          position: 0,
          icon: 'bread',
          tags: ['Mercadona', 'urgente'],
        },
      }),
    ]);

    const items = await api.get(`/lists/${listId}/items`, user.accessToken);
    const row = items.body.data.items.find((entry: { id: string }) => entry.id === itemId);
    expect(row.icon).toBe('bread');
    expect(row.tags).toEqual(['Mercadona', 'urgente']);

    const list = await api.get(`/lists/${listId}`, user.accessToken);
    expect(list.body.data.orderMode).toBe('alphabetical');
  });

  it('leaves a field that was not sent at the value the contract gives it', async () => {
    // The other half: spreading the payload must not invent values. A client
    // that knows nothing about labels sends none, and the row is read with an
    // empty list of them rather than with none of the key.
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Sin etiquetas');
    const listId = randomUUID();
    const itemId = randomUUID();

    await push(user, [
      operation({
        entity: 'list',
        kind: 'create',
        entityId: listId,
        payload: { workspaceId: workspace.id, title: 'Vacia', kind: 'tasks' },
      }),
      operation({
        entity: 'list_item',
        kind: 'create',
        entityId: itemId,
        payload: { listId, title: 'Leche', position: 0 },
      }),
    ]);

    const items = await api.get(`/lists/${listId}/items`, user.accessToken);
    const row = items.body.data.items.find((entry: { id: string }) => entry.id === itemId);
    expect(row.tags).toEqual([]);
    expect(row.icon).toBeNull();
  });

  it('refuses an icon the app cannot draw and keeps the rest of the row', async () => {
    // An icon is a key and not free text, and a key nobody can draw is a blank
    // space where the picture should be. Refusing it must not cost the labels.
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Iconos raros');
    const listId = randomUUID();
    const itemId = randomUUID();

    await push(user, [
      operation({
        entity: 'list',
        kind: 'create',
        entityId: listId,
        payload: { workspaceId: workspace.id, title: 'Rara', kind: 'tasks' },
      }),
      operation({
        entity: 'list_item',
        kind: 'create',
        entityId: itemId,
        payload: { listId, title: 'Algo', position: 0, icon: 'unicorn', tags: ['Raro'] },
      }),
    ]);

    const items = await api.get(`/lists/${listId}/items`, user.accessToken);
    const row = items.body.data.items.find((entry: { id: string }) => entry.id === itemId);
    expect(row.icon).toBeNull();
    expect(row.tags).toEqual(['Raro']);
  });

  it('carries the role and member count a workspace list needs', async () => {
    // The client cache is the app's only read model, including offline, so the
    // workspace projection has to include the view fields. Without them the
    // list renders a workspace with no role and no member count.
    const owner = await createVerifiedUser(api);
    const workspace = await createWorkspace(owner, 'Con rol');

    const response = await pull(owner);
    const change = (response.body.data.changes as { entity: string; record: Record<string, unknown> }[]).find(
      (item) => item.entity === 'workspace' && item.record.id === workspace.id,
    );

    expect(change).toBeDefined();
    expect(change?.record.role).toBe('owner');
    expect(change?.record.memberCount).toBe(1);
  });

  it('counts the items of a list in the projection', async () => {
    // itemCount is derived, not stored, so the projection has to compute it.
    // A list arriving without it renders the literal `{count}` placeholder.
    const user = await createVerifiedUser(api);
    const workspace = await createWorkspace(user, 'Con items');
    const listId = randomUUID();

    const created = await push(user, [
      operation({
        entity: 'list',
        kind: 'create',
        entityId: listId,
        payload: { workspaceId: workspace.id, title: 'Películas', kind: 'movies' },
      }),
    ]);
    expect(created.body.data.results[0].status).toBe('applied');

    const empty = await pull(user);
    const before = (empty.body.data.changes as { record: Record<string, unknown> }[]).find(
      (change) => change.record.id === listId,
    );
    expect(before?.record.itemCount).toBe(0);

    const withItem = await push(user, [
      operation({
        entity: 'list_item',
        kind: 'create',
        entityId: randomUUID(),
        payload: { listId, title: 'Arrival' },
      }),
    ]);
    expect(withItem.body.data.results[0].status).toBe('applied');

    await push(user, [
      // Touch the list so it falls inside a fresh pull window.
      operation({
        entity: 'list',
        kind: 'update',
        entityId: listId,
        baseVersion: created.body.data.results[0].version as number,
        payload: { title: 'Películas 2026' },
      }),
    ]);

    const after = await pull(user, null);
    const withItems = (after.body.data.changes as { record: Record<string, unknown> }[]).find(
      (change) => change.record.id === listId && change.record.title === 'Películas 2026',
    );
    expect(withItems?.record.itemCount).toBe(1);
  });

  it('never leaks another user data', async () => {
    const mine = await createVerifiedUser(api);
    const other = await createVerifiedUser(api);
    const otherWorkspace = await createWorkspace(other, 'Secreta');

    const response = await pull(mine);
    const ids = (response.body.data.changes as { record: { id: string } }[]).map((c) => c.record.id);

    expect(ids).not.toContain(otherWorkspace.id);
  });

  it('only returns changes after the cursor', async () => {
    const user = await createVerifiedUser(api);
    await createWorkspace(user, 'Antes del cursor');

    const first = await pull(user);
    expect(first.body.data.changes.length).toBeGreaterThan(0);

    const cursor = first.body.data.nextCursor as string;
    expect(cursor).toBeTruthy();

    // Nothing new yet.
    const empty = await pull(user, cursor);
    expect(empty.body.data.changes).toHaveLength(0);

    await createWorkspace(user, 'Después del cursor');
    const after = await pull(user, cursor);
    const names = (after.body.data.changes as { record: { name: string } }[]).map(
      (change) => change.record.name,
    );
    expect(names).toContain('Después del cursor');
    expect(names).not.toContain('Antes del cursor');
  });

  it('keeps a cursor per device', async () => {
    const user = await createVerifiedUser(api);
    const deviceA = randomUUID();
    const deviceB = randomUUID();

    await createWorkspace(user, 'Del dispositivo A');
    const pullA = await pull(user, null, deviceA);
    expect(pullA.body.data.changes.length).toBeGreaterThan(0);

    // Device B has never synced, so it sees everything.
    const pullB = await pull(user, null, deviceB);
    expect(pullB.body.data.changes.length).toBeGreaterThan(0);

    // Device A only sees what changed after its own cursor.
    await createWorkspace(user, 'Para A');
    const pullAAgain = await pull(user, pullA.body.data.nextCursor, deviceA);
    const names = (pullAAgain.body.data.changes as { record: { name: string } }[]).map(
      (change) => change.record.name,
    );
    expect(names).toEqual(['Para A']);
  });

  it('reports hasMore when a page is full', async () => {
    const user = await createVerifiedUser(api);
    await createWorkspace(user, 'A');
    await createWorkspace(user, 'B');
    await createWorkspace(user, 'C');

    const response = await pull(user, null, undefined);
    expect(response.body.data.hasMore).toBe(false);

    const page = await api.post('/sync/pull', { cursor: null, limit: 2 }, user.accessToken);
    expect(page.body.data.changes).toHaveLength(2);
    expect(page.body.data.hasMore).toBe(true);
  });
});

describe('two devices', () => {
  it('propagates a change made on one device to the other', async () => {
    const phone = await createVerifiedUser(api);
    const laptop = await api.post('/auth/login', {
      email: phone.email,
      password: phone.password,
      device: { label: 'Portátil', platform: 'web' },
    });
    const laptopToken = laptop.body.data.session.accessToken;

    const created = await createWorkspace(phone, 'Sincronizada');

    const fromLaptop = await api.post(
      '/sync/pull',
      { cursor: null, limit: 100 },
      laptopToken,
    );
    const names = (fromLaptop.body.data.changes as { record: { name: string } }[]).map(
      (change) => change.record.name,
    );
    expect(names).toContain('Sincronizada');

    // The phone deletes it; the laptop must learn about it.
    await push(phone, [
      operation({ entity: 'workspace', kind: 'delete', entityId: created.id }),
    ]);

    const afterDelete = await api.post(
      '/sync/pull',
      { cursor: fromLaptop.body.data.nextCursor, limit: 100 },
      laptopToken,
    );
    const tombstone = (afterDelete.body.data.changes as {
      entity: string;
      record: { id: string; deletedAt: string | null };
    }[]).find((change) => change.record.id === created.id);

    expect(tombstone).toBeDefined();
    expect(tombstone?.record.deletedAt).toBeTruthy();
  });
});
