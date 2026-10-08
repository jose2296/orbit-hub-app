import { journalEntryIdFor } from '@orbit-hub/contracts';
import type { SyncOperation } from '@orbit-hub/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * The journal through sync, which is the only path the app writes it by.
 *
 * The entry is owned by an account and not by a space, so the checks here are the
 * ones that matter for that: the id has to be the one the account and the day
 * derive, a second write of the same day is one row, another account cannot touch
 * the entry, and a document is checked on every write rather than only the first.
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
    clientId: 'journal-sync-test',
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

async function firstResult(user: TestUser, operations: SyncOperation[]) {
  const response = await push(user, operations);
  expect(response.status).toBe(200);
  return response.body.data.results[0] as { status: string; version: number | null; error: string | null };
}

const DAY = '2026-10-08';

describe('journal entries through sync', () => {
  it('creates the entry under the id its account and day derive', async () => {
    const user = await createVerifiedUser(api);
    const id = journalEntryIdFor(user.userId, DAY);

    const result = await firstResult(user, [
      operation({
        entity: 'journal_entry',
        kind: 'create',
        entityId: id,
        payload: { day: DAY, document: '<p>Hacer la compra</p>' },
      }),
    ]);

    expect(result.status).toBe('applied');
    expect(result.version).toBe(1);
  });

  it('refuses a create whose id is not the one for its account and day', async () => {
    const user = await createVerifiedUser(api);

    const result = await firstResult(user, [
      operation({
        entity: 'journal_entry',
        kind: 'create',
        entityId: randomUUID(),
        payload: { day: DAY, document: '<p>Hola</p>' },
      }),
    ]);

    expect(result.status).toBe('rejected');
    expect(result.error).toMatch(/does not belong to this day/);
  });

  it('keeps one entry per day when a second device creates it, and shows the clash', async () => {
    const phone = await createVerifiedUser(api);
    const id = journalEntryIdFor(phone.userId, '2026-10-09');

    const first = await firstResult(phone, [
      operation({
        entity: 'journal_entry',
        kind: 'create',
        entityId: id,
        payload: { day: '2026-10-09', document: '<p>Desde el móvil</p>' },
      }),
    ]);
    const second = await firstResult(phone, [
      operation({
        entity: 'journal_entry',
        kind: 'create',
        entityId: id,
        payload: { day: '2026-10-09', document: '<p>Desde la tablet</p>' },
      }),
    ]);

    expect(first.status).toBe('applied');
    // Other words for the same day are a conflict the person chooses from, never a
    // second row and never a silent overwrite.
    expect(second.status).toBe('conflict');

    const pulled = await api.post('/sync/pull', { cursor: null, limit: 200 }, phone.accessToken);
    const rows = (pulled.body.data.changes as Array<{ entity: string; record: Record<string, unknown> }>)
      .filter((item) => item.entity === 'journal_entry' && item.record['day'] === '2026-10-09');
    expect(rows).toHaveLength(1);
  });

  it('refuses a document outside the note format, on create', async () => {
    const user = await createVerifiedUser(api);

    const result = await firstResult(user, [
      operation({
        entity: 'journal_entry',
        kind: 'create',
        entityId: journalEntryIdFor(user.userId, DAY),
        payload: { day: DAY, document: '<p>Hola</p><script>alert(1)</script>' },
      }),
    ]);

    expect(result.status).toBe('rejected');
  });

  it('refuses a day that is not on the calendar', async () => {
    const user = await createVerifiedUser(api);

    const result = await firstResult(user, [
      operation({
        entity: 'journal_entry',
        kind: 'create',
        entityId: journalEntryIdFor(user.userId, '2026-02-30'),
        payload: { day: '2026-02-30', document: '<p>Hola</p>' },
      }),
    ]);

    expect(result.status).toBe('rejected');
  });

  it('refuses a document outside the format on update, which is where it used to get through', async () => {
    const user = await createVerifiedUser(api);
    const id = journalEntryIdFor(user.userId, '2026-10-10');
    await firstResult(user, [
      operation({
        entity: 'journal_entry',
        kind: 'create',
        entityId: id,
        payload: { day: '2026-10-10', document: '<p>Limpio</p>' },
      }),
    ]);

    const result = await firstResult(user, [
      operation({
        entity: 'journal_entry',
        kind: 'update',
        entityId: id,
        baseVersion: 1,
        payload: { document: '<img src=x onerror=alert(1)>' },
      }),
    ]);

    expect(result.status).toBe('rejected');
  });

  it('applies an update from the version the client last saw, and derives its text', async () => {
    const user = await createVerifiedUser(api);
    const id = journalEntryIdFor(user.userId, '2026-10-11');
    await firstResult(user, [
      operation({
        entity: 'journal_entry',
        kind: 'create',
        entityId: id,
        payload: { day: '2026-10-11', document: '<p>Primero</p>' },
      }),
    ]);

    const result = await firstResult(user, [
      operation({
        entity: 'journal_entry',
        kind: 'update',
        entityId: id,
        baseVersion: 1,
        base: { document: '<p>Primero</p>' },
        payload: { document: '<p>Segundo</p>' },
      }),
    ]);

    expect(result.status).toBe('applied');
    expect(result.version).toBe(2);
  });

  it('reports a conflict when two devices changed the same entry from one base', async () => {
    const user = await createVerifiedUser(api);
    const id = journalEntryIdFor(user.userId, '2026-10-12');
    await firstResult(user, [
      operation({
        entity: 'journal_entry',
        kind: 'create',
        entityId: id,
        payload: { day: '2026-10-12', document: '<p>Base</p>' },
      }),
    ]);
    await firstResult(user, [
      operation({
        entity: 'journal_entry',
        kind: 'update',
        entityId: id,
        baseVersion: 1,
        base: { document: '<p>Base</p>' },
        payload: { document: '<p>Desde el móvil</p>' },
      }),
    ]);

    // The tablet still has version 1 and its own edit.
    const result = await firstResult(user, [
      operation({
        entity: 'journal_entry',
        kind: 'update',
        entityId: id,
        baseVersion: 1,
        base: { document: '<p>Base</p>' },
        payload: { document: '<p>Desde la tablet</p>' },
      }),
    ]);

    expect(result.status).toBe('conflict');
  });

  it('keeps another account out of an entry, on update and on delete', async () => {
    const owner = await createVerifiedUser(api);
    const stranger = await createVerifiedUser(api);
    const id = journalEntryIdFor(owner.userId, '2026-10-13');
    await firstResult(owner, [
      operation({
        entity: 'journal_entry',
        kind: 'create',
        entityId: id,
        payload: { day: '2026-10-13', document: '<p>Privado</p>' },
      }),
    ]);

    const update = await firstResult(stranger, [
      operation({
        entity: 'journal_entry',
        kind: 'update',
        entityId: id,
        baseVersion: 1,
        payload: { document: '<p>Intruso</p>' },
      }),
    ]);
    const remove = await firstResult(stranger, [
      operation({ entity: 'journal_entry', kind: 'delete', entityId: id, baseVersion: 1 }),
    ]);

    expect(update.status).toBe('rejected');
    expect(remove.status).toBe('rejected');
  });

  it('shows a delete to the other devices of the account through the pull', async () => {
    const user = await createVerifiedUser(api);
    const id = journalEntryIdFor(user.userId, '2026-10-14');
    await firstResult(user, [
      operation({
        entity: 'journal_entry',
        kind: 'create',
        entityId: id,
        payload: { day: '2026-10-14', document: '<p>Para borrar</p>' },
      }),
    ]);
    const deleted = await firstResult(user, [
      operation({ entity: 'journal_entry', kind: 'delete', entityId: id, baseVersion: 1 }),
    ]);
    expect(deleted.status).toBe('applied');

    const pulled = await api.post('/sync/pull', { cursor: null, limit: 200 }, user.accessToken);
    const change = (pulled.body.data.changes as Array<{ entity: string; record: Record<string, unknown> }>)
      .find((item) => item.entity === 'journal_entry' && item.record['id'] === id);

    expect(change).toBeDefined();
    expect(change?.record['deletedAt']).not.toBeNull();
  });

  it('pulls only the entries of the account asking', async () => {
    const mine = await createVerifiedUser(api);
    const theirs = await createVerifiedUser(api);
    const theirId = journalEntryIdFor(theirs.userId, '2026-10-15');
    await firstResult(theirs, [
      operation({
        entity: 'journal_entry',
        kind: 'create',
        entityId: theirId,
        payload: { day: '2026-10-15', document: '<p>Ajeno</p>' },
      }),
    ]);

    const pulled = await api.post('/sync/pull', { cursor: null, limit: 200 }, mine.accessToken);
    const ids = (pulled.body.data.changes as Array<{ entity: string; record: Record<string, unknown> }>)
      .filter((item) => item.entity === 'journal_entry')
      .map((item) => item.record['id']);

    expect(ids).not.toContain(theirId);
  });
});

describe('the journal in the account export', () => {
  it('carries the account own entries, and nobody else', async () => {
    const user = await createVerifiedUser(api);
    const other = await createVerifiedUser(api);
    const day = '2026-10-16';
    await firstResult(user, [
      operation({
        entity: 'journal_entry',
        kind: 'create',
        entityId: journalEntryIdFor(user.userId, day),
        payload: { day, document: '<p>Para la copia</p>' },
      }),
    ]);
    await firstResult(other, [
      operation({
        entity: 'journal_entry',
        kind: 'create',
        entityId: journalEntryIdFor(other.userId, day),
        payload: { day, document: '<p>Ajeno</p>' },
      }),
    ]);

    const response = await api.get('/account/export', user.accessToken);
    const exported = response.body.data ?? response.body;
    const journal = exported.journal as Array<{ day: string; document: string }>;

    expect(journal.map((entry) => entry.day)).toEqual([day]);
    expect(journal[0]?.document).toBe('<p>Para la copia</p>');
    expect(exported.counts.journal).toBe(1);
  });
});

describe('two devices writing the same day before they have met', () => {
  it('absorbs a create that carries the same words', async () => {
    const user = await createVerifiedUser(api);
    const id = journalEntryIdFor(user.userId, '2026-10-17');
    await firstResult(user, [
      operation({
        entity: 'journal_entry',
        kind: 'create',
        entityId: id,
        payload: { day: '2026-10-17', document: '<p>Igual</p>' },
      }),
    ]);

    const again = await firstResult(user, [
      operation({
        entity: 'journal_entry',
        kind: 'create',
        entityId: id,
        payload: { day: '2026-10-17', document: '<p>Igual</p>' },
      }),
    ]);

    expect(again.status).toBe('duplicate');
  });

  it('turns a create with other words into a conflict, so nothing is dropped in silence', async () => {
    const user = await createVerifiedUser(api);
    const id = journalEntryIdFor(user.userId, '2026-10-18');
    await firstResult(user, [
      operation({
        entity: 'journal_entry',
        kind: 'create',
        entityId: id,
        payload: { day: '2026-10-18', document: '<p>Del móvil</p>' },
      }),
    ]);

    const fromTablet = await firstResult(user, [
      operation({
        entity: 'journal_entry',
        kind: 'create',
        entityId: id,
        payload: { day: '2026-10-18', document: '<p>De la tablet</p>' },
      }),
    ]);

    expect(fromTablet.status).toBe('conflict');
  });
});
