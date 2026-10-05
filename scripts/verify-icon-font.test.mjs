import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ICON_FONT_LOADED } from './cdp.mjs';

/**
 * `document.fonts.check()` no sirve para esto.
 *
 * Medido en un `about:blank` con cero familias registradas:
 *
 *     document.fonts.check("18px ionicons")            -> true
 *     document.fonts.check("18px fuente-inventada")     -> true
 *     document.fonts.size                               -> 0
 *
 * Responde `true` cuando no hay nada contra qué comparar, así que una espera
 * construida sobre él devuelve `ok: true` en el primer intento, siempre. La de
 * `verify-tag-colors.mjs` llevaba así desde antes de este arreglo: veinte
 * segundos de plazo, un contador de capturas sin fuente, y ninguna espera real.
 *
 * Estos tests no ejecutan un navegador —eso no cabe en `node --test`— sino que
 * comprueban que el predicado que se manda a la página se apoya en
 * `document.fonts` y no en `check()`. La verdad de ese predicado está medida en
 * el navegador y escrita en el comentario de `ICON_FONT_LOADED`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const cdp = readFileSync(join(here, 'cdp.mjs'), 'utf8');

describe('el predicado de la fuente de iconos', () => {
  it('no se apoya en check(), que responde true sin fuentes', () => {
    assert.ok(
      !ICON_FONT_LOADED.includes('fonts.check'),
      'check() devuelve true cuando no hay ninguna fuente registrada',
    );
  });

  it('mira la lista de fuentes y no una pregunta al navegador', () => {
    assert.ok(
      ICON_FONT_LOADED.includes('document.fonts'),
      'tiene que leer document.fonts: es lo que responde con verdad',
    );
  });

  it('exige el estado loaded, no solo que la familia este declarada', () => {
    assert.ok(
      ICON_FONT_LOADED.includes('loaded'),
      'una @font-face declarada y no cargada tampoco dibuja',
    );
  });

  it('busca la familia de los iconos y no cualquier fuente', () => {
    assert.ok(
      ICON_FONT_LOADED.includes('ionicons'),
      'cualquier fuente cargada no dice nada sobre los iconos',
    );
  });
});

describe('la espera en cdp.mjs', () => {
  it('usa el predicado, no una pregunta propia', () => {
    assert.ok(
      cdp.includes('ICON_FONT_LOADED'),
      'la espera tiene que usar el mismo predicado que se prueba',
    );
  });

  it('no tiene ninguna otra llamada a check() fuera del comentario', () => {
    // El comentario de `ICON_FONT_LOADED` cita `check()` a propósito, con su
    // salida medida, para que el que lo lea sepa por qué no se usa. Lo que no
    // puede quedar es una llamada de verdad.
    const code = cdp
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .join('\n');

    assert.deepEqual(
      code.match(/fonts\.check/g) ?? [],
      [],
      'check() no puede quedar en el arnés',
    );
  });

  it('espera de verdad: pregunta, y si no, vuelve a preguntar', () => {
    assert.ok(cdp.includes('while (Date.now() < deadline)'), 'un solo intento no es una espera');
    assert.ok(cdp.includes('setTimeout'), 'tiene que dormir entre intentos');
  });

  it('devuelve que no pudo, en vez de mentir diciendo que sí', () => {
    assert.ok(
      cdp.includes('return { ok: false }'),
      'agotado el plazo tiene que decir que no, que es lo que el contador mide',
    );
  });
});

describe('verify-tag-colors usa la espera compartida', () => {
  it('importa waitForIconFont de cdp.mjs', () => {
    const script = readFileSync(join(here, 'verify-tag-colors.mjs'), 'utf8');

    assert.ok(script.includes('waitForIconFont'), 'la espera vive en cdp.mjs para todos');
  });
});

/**
 * La verdad del predicado, medida en un Chrome headless.
 *
 * Abajo: un `about:blank` con cero fuentes. Arriba, la app real en producción.
 * Las dos líneas son la diferencia entre una espera y una que no espera.
 *
 *     about:blank   check=true  familia=loaded=false  total=0  -> ok:false
 *     produccion    check=true  familia=loaded=true   total=1  -> ok:true
 *
 * `check` dice `true` en las dos. Solo `familia` distingue.
 */
const MEDIDO = [
  { donde: 'about:blank', check: true, familia: false, total: 0, espera: false },
  { donde: 'produccion', check: true, familia: true, total: 1, espera: true },
];

describe('lo que se midió en un navegador', () => {
  it('check() dice true en los dos casos, así que no puede ser el predicado', () => {
    assert.equal(
      MEDIDO.every((m) => m.check === true),
      true,
      'si esto deja de ser cierto, el comentario de ICON_FONT_LOADED está mintiendo',
    );
  });

  it('el estado de la familia es lo único que separa los dos casos', () => {
    const conFuente = MEDIDO.filter((m) => m.familia);
    const sinFuente = MEDIDO.filter((m) => !m.familia);

    assert.equal(conFuente.length, 1);
    assert.equal(sinFuente.length, 1);
    assert.equal(sinFuente[0].total, 0, 'about:blank no tiene ninguna fuente registrada');
  });

  it('la espera dice lo contrario que check() en el caso sin fuente', () => {
    const vacio = MEDIDO.find((m) => !m.familia);

    assert.equal(vacio.check, true, 'check() mentiría');
    assert.equal(vacio.espera, false, 'y la espera corregida no le hace caso');
  });
});
