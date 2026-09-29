import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The drawer's push, as the native layer sees it.
 *
 * A phone cannot open this app without the drawer rendering, and the drawer moves
 * the whole app to push it aside. That movement is an `Animated.Value`, and
 * `interpolate` hands back a node rather than a number — a node only
 * `Animated.View` knows how to resolve. On a plain `View` the node travels
 * straight through to Yoga, which reads it as the value of a transform and
 * refuses the whole tree:
 *
 *   Transform with key of "translateX" must be number or a percentage.
 *   Passed value: {"translateX":0}
 *
 * Nothing in a test suite catches that: a `View` renders the app perfectly in the
 * browser, where the same style is fine, and the web build was what the feature
 * was checked on. The failure is only on a device.
 *
 * So this reads the file. Awkward, and the reason is in the first paragraph: the
 * bug lives in which JSX element carries an animated style, and there is no way to
 * observe that without rendering React Native, which does not run here.
 */
const drawer = readFileSync(
  fileURLToPath(new URL('../src/components/layout/drawer.tsx', import.meta.url)),
  'utf8',
);

describe('la pantalla que se empuja', () => {
  it('es un Animated.View, no un View', () => {
    // The element with `testID="drawer-app"` is the one that carries the
    // transform, and it has to be the animated one.
    const at = drawer.indexOf('testID="drawer-app"');
    expect(at, 'no encuentro el elemento que se empuja').toBeGreaterThan(-1);

    const openTag = drawer.lastIndexOf('<', at);
    expect(drawer.slice(openTag, at)).toMatch(/<Animated\.View/);
  });

  it('cierra como se abre', () => {
    // Half-fixed is the worst outcome: the app renders once the close tag is
    // right, and a mismatched pair is a component that swallows its own children.
    const at = drawer.indexOf('testID="drawer-app"');
    const openTag = drawer.slice(drawer.lastIndexOf('<', at), at);
    const close = drawer.indexOf('</Animated.View>', at);
    expect(close, 'el Animated.View no se cierra').toBeGreaterThan(at);
    expect(openTag).not.toBe('');
  });

  it('lleva el transform animado dentro y no fuera', () => {
    // A transform on a parent does not move the app past the menu, and the
    // comment in the file explains why it has to be on the app itself.
    const at = drawer.indexOf('translateX: progress.interpolate');
    expect(at, 'el transform del empuje ha desaparecido').toBeGreaterThan(-1);

    const elementStart = drawer.lastIndexOf('<Animated.View', at);
    const elementEnd = drawer.indexOf('</Animated.View>', at);
    expect(elementStart).toBeGreaterThan(-1);
    expect(elementEnd).toBeGreaterThan(at);
  });

  it('no deja ningun transform animado en un View normal', () => {
    // The general rule, so the next animated transform someone adds to a plain
    // View fails here rather than on a phone.
    const plainViews = drawer.match(/<View[^>]*>/g) ?? [];
    for (const tag of plainViews) {
      expect(tag, 'un View normal con un estilo animado').not.toContain(
        'progress.interpolate',
      );
    }
  });
});
