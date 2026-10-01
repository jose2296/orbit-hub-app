import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The drawer's push, as the native layer and as the person using it see it.
 *
 * Two bugs have lived here, and both are invisible to a typecheck.
 *
 * **The push happened twice.** The column is in the row, so its width already
 * displaces everything to its right — that *is* the push. The app also carried a
 * `translateX` of the same amount. Two 284 px pushes make 568, and on a 430 wide
 * phone the app starts past the right edge, so the menu opened and the screen it
 * interrupted was not there any more. Each half was defensible; the sum was the
 * opposite of a push.
 *
 * **And a transform on a plain `View` crashes on a device.** `interpolate` hands
 * back a node rather than a number, and a node only `Animated.View` resolves. On
 * a plain `View` it goes straight to Yoga, which reads it as the value of a
 * transform and refuses the tree:
 *
 *   Transform with key of "translateX" must be number or a percentage.
 *   Passed value: {"translateX":0}
 *
 * A `View` renders the app perfectly in the browser, where the same style is fine,
 * so the web build passed and the failure was only on a phone.
 *
 * So this reads the file. The bug is in *which* movement pushes the app and in
 * which JSX element carries an animated style, and there is no render to assert on
 * here — the panel draws a file tree out of a local store, and a test of it would
 * be a test of react-native. What can be checked is the movement, and the pixels,
 * in `scripts/verify-drawer.mjs`.
 */
const drawer = readFileSync(
  fileURLToPath(new URL('../src/components/layout/drawer.tsx', import.meta.url)),
  'utf8',
);

/**
 * The same file with its comments taken out.
 *
 * Because the reason a `translateX` is not there is written next to the code that
 * would put it back, and a comment that names a property is a comment that makes
 * every check for that property fail on the explanation instead of on the bug.
 */
const sinComentarios = drawer
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** The `style` array of the element that carries `testID="drawer-app"`. */
function estiloDeLaApp(): string {
  const at = sinComentarios.indexOf('testID="drawer-app"');
  expect(at, 'no encuentro el elemento que se empuja').toBeGreaterThan(-1);

  const cierre = sinComentarios.indexOf('>', at);
  return sinComentarios.slice(at, cierre);
}

describe('la pantalla que se empuja', () => {
  /**
   * Once, and only once.
   *
   * The column's animated width is the whole push. A second movement on the app —
   * a transform, a margin, an offset — adds to it instead of replacing it, and the
   * app lands past the right edge of the phone, where there is nothing of it to
   * see. That is the whole bug, so it is the whole test.
   */
  it('no se empuja dos veces', () => {
    const estilo = estiloDeLaApp();

    expect(
      estilo,
      'el empuje lo hace la columna con su ancho; un transform aqui lo repite'
    ).not.toContain('translateX');
    expect(estilo).not.toContain('marginLeft');
    expect(estilo).not.toContain('left:');
  });

  it('la columna que tiene al lado es la que se ensancha', () => {
    // The other half of the same claim, from the other side: if the column ever
    // stops taking width, the app is not pushed at all and the menu draws over a
    // screen that never moved.
    expect(sinComentarios).toContain(
      '<Animated.View style={[styles.column, { width: columnWidth }]}>',
    );

    const desde = sinComentarios.indexOf('const columnWidth = progress.interpolate');
    expect(desde, 'la columna ya no se anima con el progreso del menu').toBeGreaterThan(-1);
    expect(sinComentarios.slice(desde, sinComentarios.indexOf('}', desde))).toContain(
      'outputRange: [0, menuWidth]',
    );
  });

  it('la app es un View normal, sin nada animado que resolver', () => {
    // With the transform gone there is no animated node on this element, so it is
    // not an `Animated.View` any more. This is also the crash from the file header
    // in its simplest form: the moment an animated style comes back, this element
    // has to become an `Animated.View` again or a phone throws on boot.
    const at = sinComentarios.indexOf('testID="drawer-app"');
    const openTag = sinComentarios.slice(sinComentarios.lastIndexOf('<', at), at);
    expect(openTag, 'la app no deberia llevar estilos animados').toMatch(/<View/);
  });

  it('no deja ningun transform animado en un View normal', () => {
    // The general rule, so the next animated transform someone adds to a plain
    // View fails here rather than on a phone.
    const plainViews = sinComentarios.match(/<View[^>]*>/g) ?? [];
    for (const tag of plainViews) {
      expect(tag, 'un View normal con un estilo animado').not.toContain(
        'progress.interpolate',
      );
    }
  });

  /**
   * And the strip of app left behind has to be worth looking at.
   *
   * A push that leaves 40 px is a menu that covers the screen, which is the thing
   * this layout was chosen over. The numbers are pinned so a change to the fraction
   * has to argue with them.
   */
  it('deja una franja de app, y se mide en el navegador', () => {
    const ancho = /franja|appX/.test(
      readFileSync(
        fileURLToPath(new URL('../../../scripts/verify-drawer.mjs', import.meta.url)),
        'utf8',
      ),
    );
    expect(ancho, 'la comprobacion del empuje en el navegador ha desaparecido').toBe(true);
  });
});