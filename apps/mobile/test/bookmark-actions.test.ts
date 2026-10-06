import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CachedEntity } from '../src/lib/offline/local-store';

// `actions` importa `expo-crypto` en estatico y el modulo nativo no existe en
// Node: se suple entero. El delete no lo usa, pero el import si se evalua.
vi.mock('expo-crypto', () => ({
  randomUUID: () => 'uuid-falso',
}));

const { falsoUpsert, falsoGet, falsoEnqueue } = vi.hoisted(() => ({
  falsoUpsert: vi.fn(),
  falsoGet: vi.fn(),
  falsoEnqueue: vi.fn(),
}));

vi.mock('@/lib/offline', () => ({
  getLocalStoreReady: () =>
    Promise.resolve({
      getCached: (...args: unknown[]) => falsoGet(...args),
      upsertCached: (...args: unknown[]) => falsoUpsert(...args),
    }),
  enqueueOperation: (...args: unknown[]) => falsoEnqueue(...args),
  localUpdate: vi.fn(),
}));

import { deleteBookmarkAction } from '../src/lib/bookmarks/actions';

/**
 * El borrado de un bookmark, verbo por verbo.
 *
 * Un delete no es un update: necesita su `enqueueOperation kind:'delete'`
 * explicito, igual que `deleteNoteAction`. Un verbo menos en el outbox y el
 * servidor nunca se entera; uno de mas y el enlace vuelve como conflicto.
 * Asi que aqui se cuenta: una escritura local y exactamente una operacion.
 */

function fila(version = 3): CachedEntity {
  return {
    entity: 'bookmark',
    entityId: 'b1',
    version,
    updatedAt: '2026-01-02T00:00:00.000Z',
    deletedAt: null,
    payload: JSON.stringify({ id: 'b1', url: 'https://ejemplo.test/salsa' }),
    pending: null,
  };
}

beforeEach(() => {
  falsoUpsert.mockReset();
  falsoGet.mockReset();
  falsoEnqueue.mockReset();
  falsoGet.mockResolvedValue(fila());
  falsoUpsert.mockResolvedValue(undefined);
  falsoEnqueue.mockResolvedValue('op-1');
});

describe('deleteBookmarkAction', () => {
  it('marca el tombstone en local sin quitar la fila', async () => {
    await deleteBookmarkAction('b1');

    expect(falsoUpsert).toHaveBeenCalledTimes(1);
    const escrito = falsoUpsert.mock.calls[0]?.[0] as CachedEntity[];
    expect(escrito).toHaveLength(1);
    expect(escrito[0]?.entity).toBe('bookmark');
    expect(escrito[0]?.entityId).toBe('b1');
    // La fila se marca y no se quita: un aparato que la tenia se entera de
    // que ya no esta cuando vuelva, en vez de leerla como que nunca existio.
    expect(escrito[0]?.deletedAt).toBeTruthy();
    expect(escrito[0]?.version).toBe(3);
    expect(escrito[0]?.pending).toBeNull();
  });

  it('encola exactamente una operacion, y es un delete', async () => {
    await deleteBookmarkAction('b1');

    expect(falsoEnqueue).toHaveBeenCalledTimes(1);
    expect(falsoEnqueue).toHaveBeenCalledWith({
      kind: 'delete',
      entity: 'bookmark',
      entityId: 'b1',
      baseVersion: 3,
    });
  });

  it('sin fila previa usa version 0 y un payload minimo', async () => {
    falsoGet.mockResolvedValue(null);

    await deleteBookmarkAction('nuevo');

    const escrito = falsoUpsert.mock.calls[0]?.[0] as CachedEntity[];
    expect(escrito[0]?.version).toBe(0);
    expect(JSON.parse(escrito[0]?.payload as string)).toEqual({ id: 'nuevo' });
    expect(falsoEnqueue).toHaveBeenCalledWith({
      kind: 'delete',
      entity: 'bookmark',
      entityId: 'nuevo',
      baseVersion: 0,
    });
  });
});
