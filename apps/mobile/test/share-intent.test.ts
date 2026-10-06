import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * El `next` tiene que sobrevivir a las dos pantallas de entrada: sign-in lo
 * lee y sign-up lo usa, pero entre medias hay un Link de una a la otra. Si
 * ese Link no reenvia el param, el camino por registro pierde el share.
 * Sin render: se lee la expresion del href en la fuente, como hacen otros
 * tests de este repo con lo que el compilador no ve.
 */
describe('el link de sign-in a sign-up conserva next', () => {
  const fuente = readFileSync(join(import.meta.dirname, '..', 'src', 'app', '(auth)', 'sign-in.tsx'), 'utf8');

  // La expresion completa del href del Link que apunta a sign-up.
  function hrefASignUp(): string {
    const marca = '/(auth)/sign-up';
    const uso = fuente.indexOf(marca);
    expect(uso).toBeGreaterThan(-1);
    const apertura = fuente.lastIndexOf('<Link', uso);
    expect(apertura).toBeGreaterThan(-1);
    // La etiqueta abre y cierra con llaves anidadas: se equilibran a mano.
    let llaves = 0;
    for (let i = apertura; i < fuente.length; i++) {
      const letra = fuente[i];
      if (letra === '{') llaves += 1;
      if (letra === '}') {
        llaves -= 1;
        if (llaves === 0) return fuente.slice(apertura, i + 1);
      }
    }
    throw new Error('el Link a sign-up no se pudo delimitar');
  }

  it('reenvia next cuando existe', () => {
    expect(hrefASignUp()).toContain('params: { next }');
  });

  it('no mete params basura cuando no existe', () => {
    expect(hrefASignUp()).toContain(`: '/(auth)/sign-up'`);
  });
});
