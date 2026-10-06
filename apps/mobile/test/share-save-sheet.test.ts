import { beforeEach, describe, expect, it, vi } from 'vitest';

// `share-intent` importa `expo-sharing` en estatico y el modulo nativo no
// existe en Node: se suple entero.
vi.mock('expo-sharing', () => ({
  getSharedPayloads: () => [],
  clearSharedPayloads: () => {},
}));

const crear = vi.fn();

// El actions real toca expo-crypto y la cola offline: aqui solo importa con
// que se le llama y cuantas veces.
vi.mock('../src/lib/bookmarks/actions', () => ({
  createBookmarkAction: (...args: unknown[]) => crear(...args),
}));

import {
  createBookmarkFromShare,
  resetShareGuard,
} from '../src/lib/bookmarks/share-intent';

const payload = { url: 'https://ejemplo.com/nota', title: null, text: null };
const sitio = { workspaceId: 'w1', folderId: 'f1', collectionId: null };

beforeEach(() => {
  crear.mockReset();
  resetShareGuard();
});

describe('createBookmarkFromShare', () => {
  it('dos llamadas con el mismo payload crean un solo bookmark', async () => {
    crear.mockResolvedValue('b1');

    const primero = await createBookmarkFromShare(payload, sitio, 'Mi titulo');
    const segundo = await createBookmarkFromShare(payload, sitio, 'Mi titulo');

    expect(primero).toBe('b1');
    expect(segundo).toBe('b1');
    expect(crear).toHaveBeenCalledTimes(1);
  });

  it('el titulo vacio viaja vacio y lo rellena el servidor', async () => {
    crear.mockResolvedValue('b2');

    await createBookmarkFromShare(payload, sitio, '');

    expect(crear).toHaveBeenCalledTimes(1);
    expect(crear).toHaveBeenCalledWith({
      workspaceId: 'w1',
      folderId: 'f1',
      collectionId: null,
      url: 'https://ejemplo.com/nota',
      title: '',
      tags: [],
    });
  });

  it('sin workspaceId no se llama al create', async () => {
    await expect(
      createBookmarkFromShare(payload, { ...sitio, workspaceId: null }, 'Mi titulo'),
    ).rejects.toThrow();
    expect(crear).not.toHaveBeenCalled();
  });
});
