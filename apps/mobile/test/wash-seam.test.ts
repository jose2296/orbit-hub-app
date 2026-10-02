import { describe, expect, it } from 'vitest';

import {
  ALTO_CABECERA,
  ALTO_LAVADO,
  SOBRO_BANDA,
  altoCabeceraDe,
  altoLavadoDe,
} from '@/lib/workspace/wash';

/**
 * The wash is **one** gradient cut in two, and these are the numbers that decide
 * where the cut lands.
 *
 * The header's bar paints the top half and the band below paints the bottom half.
 * They only agree if both are measured against the same bar height — and the bar
 * grew by `insets.top` when it started spending the status bar's height, which is
 * what broke them. Measured on an Android release build with a 24-point inset: the
 * bar went on painting the gradient to 80 while the band started its half at 56,
 * and the two met at different points of the same ramp. **36 of 255** across a
 * single line, at the bottom edge of the bar, on every screen of every space.
 *
 * A step of saturation exactly where the design says there is nothing to step at:
 * the bar is supposed to cut the colour in half a piece and the band is supposed to
 * pick it up from there. These assertions are what keeps that true on a device
 * with a notch, which is the only place anybody would have noticed.
 */
describe('el lavado partido en dos', () => {
  it('sin hueco de barra de estado, es el de siempre', () => {
    // The web, and a phone with no cutout. This must not move: every screen that
    // was measured before the inset existed is on this number.
    expect(altoCabeceraDe(0)).toBe(56);
    expect(altoLavadoDe(0)).toBe(156);
  });

  it('la mitad de arriba y la de abajo se cortan en el mismo punto', () => {
    // The whole claim, as arithmetic: the band's box starts where the bar ends,
    // and its wash starts `altoBarra` above that box, so what shows is the tail
    // of the same ramp the bar was painting the head of.
    for (const inset of [0, 24, 44, 59]) {
      const barra = altoCabeceraDe(inset);

      // The band sits one bar-height above the content area, i.e. flush with the
      // bottom of the bar. No overlap and no gap.
      expect(barra).toBe(ALTO_CABECERA + inset);

      // And the gradient it shows starts exactly at the bar's bottom edge: bar
      // height + band height is the whole wash, at every inset.
      expect(barra + SOBRO_BANDA).toBe(altoLavadoDe(inset));
    }
  });

  it('un hueco mayor agranda las dos mitades y no solo una', () => {
    const sinHueco = altoLavadoDe(0);
    const conHueco = altoLavadoDe(24);

    expect(conHueco - sinHueco).toBe(24);
    expect(altoCabeceraDe(24) - ALTO_CABECERA).toBe(24);
  });

  it('la suma de las dos mitades es el lavado entero, siempre', () => {
    // A second, independent statement of the same thing, in the direction the
    // arithmetic is actually read: bar, then band, equals the whole gradient.
    for (const inset of [0, 24, 44]) {
      expect(altoCabeceraDe(inset) + SOBRO_BANDA).toBe(ALTO_LAVADO + inset);
    }
  });
});