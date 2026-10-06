import { describe, expect, it, vi } from 'vitest';

// El modulo nativo no existe en Node: se suple la unica funcion que el
// redirect importa (y no llama).
vi.mock('expo-sharing', () => ({ getSharedPayloads: () => [] }));

import { redirectSystemPath } from '../src/app/+native-intent';
import { sacarUrlDelTexto } from '../src/lib/bookmarks/share-intent';

describe('redirectSystemPath', () => {
  it("un intent de expo-sharing va a /share/save, con y sin initial", async () => {
    await expect(redirectSystemPath({ path: 'expo-sharing://expo-sharing', initial: true })).resolves.toBe(
      '/share/save',
    );
    await expect(
      redirectSystemPath({ path: 'expo-sharing://expo-sharing', initial: false }),
    ).resolves.toBe('/share/save');
  });

  it('cualquier otra cosa pasa', async () => {
    await expect(redirectSystemPath({ path: '/invite/abc', initial: false })).resolves.toBe(
      '/invite/abc',
    );
  });

  it('un path que no es URL va a /', async () => {
    await expect(redirectSystemPath({ path: 'no-es-una-url', initial: true })).resolves.toBe('/');
  });
});

describe('sacarUrlDelTexto', () => {
  it('una URL sola pasa limpia', () => {
    expect(sacarUrlDelTexto('https://ejemplo.com/nota')).toEqual({
      url: 'https://ejemplo.com/nota',
      resto: '',
    });
  });

  it('mira esto https://... saca la URL y deja el resto', () => {
    expect(sacarUrlDelTexto('mira esto https://ejemplo.com/nota que bueno')).toEqual({
      url: 'https://ejemplo.com/nota',
      resto: 'mira esto que bueno',
    });
  });

  it('texto sin URL da null', () => {
    expect(sacarUrlDelTexto('solo palabras, ningun enlace')).toBeNull();
  });
});
