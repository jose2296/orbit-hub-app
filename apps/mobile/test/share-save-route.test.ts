import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSharedPayloads = vi.fn();
const clearSharedPayloads = vi.fn();
const crear = vi.fn();
const post = vi.fn();

// El modulo nativo no existe en Node: se suple entero porque
// `getSharedPayloads` es sincrono y nativo, no hay `fetch` que interceptar.
vi.mock('expo-sharing', () => ({
  getSharedPayloads: (...args: unknown[]) => getSharedPayloads(...args),
  clearSharedPayloads: (...args: unknown[]) => clearSharedPayloads(...args),
}));

// El actions real toca expo-crypto y la cola offline: aqui solo importa con
// que se le llama y cuantas veces.
vi.mock('../src/lib/bookmarks/actions', () => ({
  createBookmarkAction: (...args: unknown[]) => crear(...args),
}));

// El cliente real saldria a la red: aqui solo importa el path y el cuerpo.
vi.mock('../src/lib/api/client', () => ({
  api: { post: (...args: unknown[]) => post(...args) },
}));

import { triggerExtract } from '../src/lib/api/bookmarks';
import {
  clearShare,
  createBookmarkFromShare,
  resetShareGuard,
  takePendingShare,
} from '../src/lib/bookmarks/share-intent';

const sitio = { workspaceId: 'w1', folderId: 'f1', collectionId: null };
const payload = { url: 'https://ejemplo.com/nota', title: null, text: null };

beforeEach(() => {
  getSharedPayloads.mockReset().mockReturnValue([]);
  clearSharedPayloads.mockReset();
  crear.mockReset();
  post.mockReset().mockResolvedValue(undefined);
  resetShareGuard();
});

describe('takePendingShare', () => {
  it('sin payloads devuelve null', () => {
    expect(takePendingShare()).toBeNull();
  });

  it('con texto con URL devuelve el parseo', () => {
    getSharedPayloads.mockReturnValue([
      { value: 'mira esto https://ejemplo.com/nota que bueno', shareType: 'text' },
    ]);

    expect(takePendingShare()).toEqual({
      url: 'https://ejemplo.com/nota',
      title: 'mira esto que bueno',
      text: 'mira esto https://ejemplo.com/nota que bueno',
    });
  });

  it('una URL sola deja el titulo en null', () => {
    getSharedPayloads.mockReturnValue([
      { value: 'https://ejemplo.com/nota', shareType: 'url' },
    ]);

    expect(takePendingShare()).toEqual({
      url: 'https://ejemplo.com/nota',
      title: null,
      text: 'https://ejemplo.com/nota',
    });
  });

  it('texto sin URL da null', () => {
    getSharedPayloads.mockReturnValue([
      { value: 'solo palabras, ningun enlace', shareType: 'text' },
    ]);

    expect(takePendingShare()).toBeNull();
  });

  it('leer no limpia: el payload sigue en el nativo', () => {
    getSharedPayloads.mockReturnValue([
      { value: 'https://ejemplo.com/nota', shareType: 'url' },
    ]);

    takePendingShare();

    // Leer y limpiar son dos momentos distintos: si leer limpiara y el
    // guardado fallara despues, el enlace se perderia para siempre.
    expect(clearSharedPayloads).not.toHaveBeenCalled();
  });
});

describe('clearShare', () => {
  it('limpia el nativo y deja el guard como nuevo', async () => {
    crear.mockResolvedValueOnce('b1').mockResolvedValueOnce('b2');

    await expect(createBookmarkFromShare(payload, sitio, 'Mi titulo')).resolves.toBe('b1');

    clearShare();

    expect(clearSharedPayloads).toHaveBeenCalledTimes(1);
    // Segunda defensa del doble-guardado: con el guard reseteado, el mismo
    // payload vuelve a crear en vez de devolver el id viejo.
    await expect(createBookmarkFromShare(payload, sitio, 'Mi titulo')).resolves.toBe('b2');
    expect(crear).toHaveBeenCalledTimes(2);
  });
});

describe('triggerExtract', () => {
  it('pide la extraccion del bookmark sin cuerpo', () => {
    triggerExtract('b1');

    expect(post).toHaveBeenCalledWith('/bookmarks/b1/extract', undefined);
  });

  it('es fire-and-forget: no devuelve promesa que esperar', () => {
    expect(triggerExtract('b1')).toBeUndefined();
  });

  it('un fallo de red no revienta al llamador', async () => {
    post.mockRejectedValueOnce(new Error('sin red'));

    expect(() => triggerExtract('b9')).not.toThrow();
    await new Promise((listo) => setTimeout(listo, 0));

    // El error ya queda representado en `extractionState`: aqui se traga sin
    // toast ni reintento, y el bookmark queda `pending`.
    expect(post).toHaveBeenCalledWith('/bookmarks/b9/extract', undefined);
  });
});
