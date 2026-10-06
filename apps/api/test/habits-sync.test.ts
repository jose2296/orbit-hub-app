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
    clientId: 'test-client-habits',
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

async function pull(user: TestUser, cursor: string | null = null) {
  return api.post('/sync/pull', { cursor, limit: 100 }, user.accessToken);
}

function habitPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Leer',
    description: 'Veinte paginas al dia',
    schedule: { kind: 'rrule', rule: 'FREQ=DAILY' },
    timezone: 'Europe/Madrid',
    startDate: '2026-01-01',
    ...overrides,
  };
}

/** Creates a habit through sync and returns its id and version. */
async function createHabit(user: TestUser, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const response = await push(user, [
    operation({ entity: 'habit', kind: 'create', entityId: id, payload: habitPayload(overrides) }),
  ]);

  const result = response.body.data.results[0];
  expect(result.status).toBe('applied');
  return { id, version: result.version as number };
}

function entryPayload(habitId: string, overrides: Record<string, unknown> = {}) {
  return {
    habitId,
    date: '2026-10-01',
    status: 'done',
    amount: null,
    note: null,
    ...overrides,
  };
}

describe('los habitos en el motor de sync', () => {
  it('una entrada creada por sync llega al pull', async () => {
    const user = await createVerifiedUser(api);
    const habit = await createHabit(user);
    const entryId = randomUUID();

    const pushed = await push(user, [
      operation({
        entity: 'habit_entry',
        kind: 'create',
        entityId: entryId,
        payload: entryPayload(habit.id),
      }),
    ]);
    expect(pushed.body.data.results[0].status).toBe('applied');

    const changes = (await pull(user)).body.data.changes as {
      entity: string;
      record: Record<string, unknown>;
    }[];

    const seenHabit = changes.find(
      (change) => change.entity === 'habit' && change.record.id === habit.id,
    );
    expect(seenHabit).toBeDefined();
    expect(seenHabit?.record.name).toBe('Leer');

    const seenEntry = changes.find(
      (change) => change.entity === 'habit_entry' && change.record.id === entryId,
    );
    expect(seenEntry).toBeDefined();
    expect(seenEntry?.record.status).toBe('done');
    expect(seenEntry?.record.habitId).toBe(habit.id);
  });

  it('el pull no devuelve el habito de otra persona', async () => {
    const mine = await createVerifiedUser(api);
    const other = await createVerifiedUser(api);

    const habit = await createHabit(other);
    await push(other, [
      operation({
        entity: 'habit_entry',
        kind: 'create',
        entityId: randomUUID(),
        payload: entryPayload(habit.id),
      }),
    ]);

    const changes = (await pull(mine)).body.data.changes as {
      entity: string;
      record: Record<string, unknown>;
    }[];
    const ajenos = changes.filter(
      (change) => change.entity === 'habit' || change.entity === 'habit_entry',
    );

    expect(ajenos).toHaveLength(0);
  });

  it('un habito no pasa por la comprobacion de workspace', async () => {
    // habits no tiene workspace_id. Si se cuela por la rama de lista o de
    // nota, la comprobacion de pertenencia revienta o pide un workspace que
    // no existe. La prueba manda un workspaceId ajeno en el payload: tiene
    // que sobrar y no mandar.
    const user = await createVerifiedUser(api);
    const stranger = await createVerifiedUser(api);
    const habit = await createHabit(user);

    const renamed = await push(user, [
      operation({
        entity: 'habit',
        kind: 'update',
        entityId: habit.id,
        baseVersion: habit.version,
        payload: { name: 'Leer mas', workspaceId: randomUUID() },
      }),
    ]);
    expect(renamed.body.data.results[0].status).toBe('applied');

    const changes = (await pull(user)).body.data.changes as {
      entity: string;
      record: Record<string, unknown>;
    }[];
    const seen = changes.find(
      (change) => change.entity === 'habit' && change.record.id === habit.id,
    );
    expect(seen?.record.name).toBe('Leer mas');
    expect(seen?.record.workspaceId).toBeUndefined();

    // Y el habito ajeno es 404 para el extrano, no 403: confirmar que
    // existe ya dice que existe.
    const ajeno = await push(stranger, [
      operation({
        entity: 'habit',
        kind: 'update',
        entityId: habit.id,
        baseVersion: habit.version + 1,
        payload: { name: 'Me lo quedo' },
      }),
    ]);
    expect(ajeno.body.data.results[0].status).toBe('rejected');
  });

  it('una entrada no se escribe en el habito de otra persona', async () => {
    const owner = await createVerifiedUser(api);
    const stranger = await createVerifiedUser(api);
    const habit = await createHabit(owner);

    const attempt = await push(stranger, [
      operation({
        entity: 'habit_entry',
        kind: 'create',
        entityId: randomUUID(),
        payload: entryPayload(habit.id),
      }),
    ]);
    expect(attempt.body.data.results[0].status).toBe('rejected');
  });

  it('remarcar el mismo dia no acumula', async () => {
    // El UNIQUE (habito, dia) es la regla y el sync la respeta: la segunda
    // marca reescribe la primera en vez de sumar una fila.
    const user = await createVerifiedUser(api);
    const habit = await createHabit(user);

    const first = await push(user, [
      operation({
        entity: 'habit_entry',
        kind: 'create',
        entityId: randomUUID(),
        payload: entryPayload(habit.id, { status: 'skipped' }),
      }),
    ]);
    expect(first.body.data.results[0].status).toBe('applied');

    const second = await push(user, [
      operation({
        entity: 'habit_entry',
        kind: 'create',
        entityId: randomUUID(),
        payload: entryPayload(habit.id, { status: 'done', note: 'Por la manana' }),
      }),
    ]);
    expect(second.body.data.results[0].status).toBe('applied');

    const changes = (await pull(user)).body.data.changes as {
      entity: string;
      record: Record<string, unknown>;
    }[];
    const entries = changes.filter(
      (change) => change.entity === 'habit_entry' && change.record.habitId === habit.id,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.record.status).toBe('done');
  });

  it('el dueno borra su habito sin ser dueno de ningun espacio', async () => {
    // Sin rama personal, el borrado pediria un rol de dueno en un espacio
    // que no existe. El habito cuelga del usuario: basta con ser el.
    const user = await createVerifiedUser(api);
    const habit = await createHabit(user);

    const deleted = await push(user, [
      operation({ entity: 'habit', kind: 'delete', entityId: habit.id }),
    ]);
    expect(deleted.body.data.results[0].status).toBe('applied');

    const changes = (await pull(user)).body.data.changes as {
      entity: string;
      record: Record<string, unknown>;
    }[];
    const tombstone = changes.find(
      (change) => change.entity === 'habit' && change.record.id === habit.id,
    );
    expect(tombstone?.record.deletedAt).toBeTruthy();
  });
});
