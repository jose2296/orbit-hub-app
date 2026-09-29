import { beforeEach, describe, expect, it, vi } from 'vitest';

import { STORAGE_KEYS } from '../src/constants';

/**
 * Que se va con la sesion y que se queda.
 *
 * La cache, el outbox y los conflictos ya se borraban, y eso era lo visible: la
 * siguiente persona veia los espacios de la anterior. El cursor se quedaba, y
 * ese no se ve como nada.
 *
 * El cursor es una marca de tiempo y el servidor contesta solo lo posterior a ella
 * (`after = new Date(cursor)` en `sync-repository`). Asi que un cursor heredado
 * hace que el siguiente login empiece a descargar donde termino el anterior, y
 * todo lo que esa cuenta hubiera escrito antes de ahi —o que otro dispositivo suyo
 * hubiera escrito— no llega nunca. El sintoma no son datos ajenos: es una cuenta
 * nueva que aparece vacia y un indicador que dice que esta al dia. Eso es peor
 * que no sincronizar, porque parece que si.
 */

const store = {
  reset: vi.fn(async () => undefined),
  clearCache: vi.fn(async () => undefined),
};

vi.mock('../src/lib/offline/local-store', () => ({
  getLocalStoreReady: async () => store,
}));

/**
 * El almacen de clave-valor va simulado, y por lo que hace `sync-engine.test.ts`
 * tambien: el de verdad importa `expo-sqlite/localStorage/install`, que no se
 * puede cargar en un test de node porque su punto de entrada es un modulo interno
 * de Expo. Un almacen en memoria responde lo mismo.
 */
const datos = new Map<string, string>();

vi.mock('../src/lib/storage/key-value', () => ({
  keyValueStore: {
    get: (key: string) => datos.get(key) ?? null,
    set: (key: string, value: string) => void datos.set(key, value),
    remove: (key: string) => void datos.delete(key),
    getJson: () => null,
    setJson: () => undefined,
  },
}));

beforeEach(() => {
  vi.resetModules();
  datos.clear();
  store.reset.mockClear();
  store.clearCache.mockClear();
});

describe('forgetEverything', () => {
  it('se lleva el cursor del pull', async () => {
    datos.set(STORAGE_KEYS.syncCursor, '2026-01-02T00:00:00.000Z');
    datos.set(STORAGE_KEYS.lastSyncedAt, '2026-01-02T00:00:00.000Z');
    const { forgetEverything } = await import('../src/lib/auth/forget-everything');

    await forgetEverything();

    // Lo que importa: sin cursor el siguiente pull empieza desde el principio y
    // no se salta nada. Con cursor, empieza donde acabo otra sesion.
    expect(datos.get(STORAGE_KEYS.syncCursor)).toBeUndefined();
    expect(datos.get(STORAGE_KEYS.lastSyncedAt)).toBeUndefined();
  });

  it('vacía la cache y el outbox', async () => {
    const { forgetEverything } = await import('../src/lib/auth/forget-everything');

    await forgetEverything();

    expect(store.reset).toHaveBeenCalledTimes(1);
    expect(store.clearCache).toHaveBeenCalledTimes(1);
  });

  it('deja el tema, que es de quien usa el aparato', async () => {
    datos.set(STORAGE_KEYS.appearance, '{"appearance":"dark","accent":"rose"}');
    const { forgetEverything } = await import('../src/lib/auth/forget-everything');

    await forgetEverything();

    // Preguntar el tema en cada cierre de sesion es hacer que alguien elija dos
    // veces lo mismo.
    expect(datos.get(STORAGE_KEYS.appearance)).toBe('{"appearance":"dark","accent":"rose"}');
  });

  /**
   * El identificador del aparato, y no de la cuenta. Es justo lo que tiene que
   * sobrevivir: es lo que le dice al servidor que esto es el mismo telefono, y
   * borrarlo haria que cada cuenta pareciera un dispositivo nuevo.
   */
  it('deja el identificador del aparato', async () => {
    datos.set(STORAGE_KEYS.clientId, 'device-123');
    const { forgetEverything } = await import('../src/lib/auth/forget-everything');

    await forgetEverything();

    expect(datos.get(STORAGE_KEYS.clientId)).toBe('device-123');
  });

  it('acaba igual si el store no responde', async () => {
    vi.doMock('../src/lib/offline/local-store', () => ({
      getLocalStoreReady: async () => {
        throw new Error('no store');
      },
    }));
    datos.set(STORAGE_KEYS.syncCursor, '2026-01-02T00:00:00.000Z');

    const { forgetEverything } = await import('../src/lib/auth/forget-everything');
    await expect(forgetEverything()).resolves.toBeUndefined();

    // El cursor se va igual: no depende de la base de datos, y dejarlo puesto por
    // un fallo ajeno seria el silencio que este modulo existe para evitar.
    expect(datos.get(STORAGE_KEYS.syncCursor)).toBeUndefined();
  });
});
