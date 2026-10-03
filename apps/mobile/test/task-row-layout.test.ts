import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The four things a task row draws, and the three that are only broken on a phone.
 *
 * Every assertion here is about the **source**, not about a rendered tree: this
 * suite runs in `node` with React Native stubbed, so nothing measures a pixel and
 * nothing can catch Yoga. What it can do is stop the four shapes below from
 * coming back, which is what happened once already — see `styles.nombre` in
 * `list/[listId].tsx` for a comment that blamed the wrong file and fixed nothing.
 *
 * The measurements that found them are in the comments on the code they guard, and
 * they were taken on an Android release build (API 35), not reasoned about.
 */
const RAIZ = join(import.meta.dirname, '..');
const src = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8');

const checkbox = src('src/components/ui/checkbox.tsx');
const badge = src('src/components/ui/badge.tsx');
const listId = src('src/app/(app)/list/[listId].tsx');
const appHeader = src('src/components/ui/app-header.tsx');
const screen = src('src/components/ui/screen.tsx');
const spaceBand = src('src/components/workspace/space-band.tsx');

describe('la casilla no se come la fila', () => {
  /**
   * `flex: 1` on an **empty** `Text` grows into the whole row, and the title that
   * shares it gets nothing.
   *
   * Measured: the checkbox took 755 of the row's 754 points of content width, so
   * `styles.flex` measured zero — no title painted, the urgency badge crushed to
   * ten points wide and wrapping one letter per line. An empty element measures
   * zero in a browser however it is styled, which is why this was invisible on the
   * web and on a dev server, and only showed up in a release build.
   *
   * `flex: 1` may stay where it is: the four call sites that pass a label want it
   * to fill the row. What may not come back is an empty one.
   */
  it('no pinta una etiqueta que no le han dado', () => {
    expect(checkbox).toContain('{label ? (');
  });

  it('el nodo de la etiqueta esta dentro de esa condicion', () => {
    // Not "there is no label prop" — there is a prop, and `sign-up` and the item
    // panel pass text to it. The claim is that an empty one is not rendered.
    const etiqueta = checkbox.match(/\{label \? \([\s\S]*?\{label\}[\s\S]*?\) : null\}/);
    expect(etiqueta).not.toBeNull();
    // And it is the only place the label is drawn.
    expect([...checkbox.matchAll(/\{label\}/g)]).toHaveLength(1);
  });
});

describe('la insignia no se aplasta', () => {
  /**
   * A pill that gets narrow is not a pill.
   *
   * Measured on the same build: 53 points wide and 145 tall, "High" ten points
   * wide wrapping one letter per line, and a row four times the height of its
   * content. `flexShrink: 0` is what makes the badge the fixed thing and the
   * labels the thing that yields.
   */
  it('no se encoge', () => {
    expect(badge).toContain('flexShrink: 0');
  });
});

describe('la fila de una tarea no reserva el asa de arrastrar', () => {
  /**
   * 28 points on the right of every row, for a handle that no longer exists: the
   * row stopped being draggable when the order moved into a sheet, and the padding
   * stayed. It is not a decoration, it is width taken from the title on every row
   * of every list.
   */
  it('no tiene paddingRight de asa', () => {
    expect(listId).not.toContain('dragHandle');
  });

  it('la insignia y las etiquetas ceden, y viven en su propia linea', () => {
    // The badge is what must survive twenty labels, so the labels are the ones
    // that shrink. That intent is unchanged.
    //
    // What changed is the line: the icon moved into the line of the title, and
    // the badge and the labels moved to a **second** line under it, so that the
    // icon and the title line up between rows. The badge is still first on that
    // line, so it is still the one that survives.
    expect(listId).toContain('metaTag');
    // And the second line is drawn only when there is something to draw.
    expect(listId).toContain(
      '{item.priority !== "none" || item.tags.length > 0 ? (',
    );
    const meta = listId.slice(listId.indexOf('metaTag: {'));
    expect(meta).toContain('flexShrink: 1');
  });
});

describe('la cabecera se gasta el hueco de la barra de estado', () => {
  /**
   * The navigator draws the header from the top of the window and does not inset
   * it, and `Screen` insets the *content* — so the bar's buttons sat under the
   * clock while everything below them was correctly placed.
   *
   * Measured on the same build: the bar was exactly its own 56 points at y = 0,
   * its buttons at y = 8..48, and the status bar at y = 0..24.
   */
  it('la cabecera toma insets.top', () => {
    expect(appHeader).toContain('useSafeAreaInsets');
    expect(appHeader).toContain('paddingTop: insets.top');
    // And grows by it, so the wash still paints from the very top edge.
    expect(appHeader).toContain('minHeight: ALTO + insets.top');
  });

  /**
   * Only the bar takes it. Both taking it is the gap measured twice, which is how
   * a bar of 24 points ends up above a page that starts another 24 points down.
   */
  it('la pantalla no lo vuelve a tomar cuando la cabecera ya lo ha tomado', () => {
    expect(screen).toContain('useHeaderOwnsTopInset');
    expect(screen).toContain(
      'edges={cabeceraArriba ? ["left", "right"] : ["top", "left", "right"]}',
    );
  });
});

describe('el lavado no se parte en dos puntos distintos', () => {
  /**
   * The header got taller and the band did not.
   *
   * The wash is one gradient cut in two, and the cut is the bottom edge of the
   * bar. The bar grew by `insets.top`; `SpaceBand` was still told the bar is 56,
   * so it started its half 24 points too low and the two halves met at different
   * points of the same ramp — a step of 36/255 measured across one line, on every
   * screen of every space, which is exactly what the design says cannot happen.
   *
   * Both halves now read the bar's real height. The arithmetic that keeps them
   * agreeing is in `wash-seam.test.ts`; these two are the wiring, because a helper
   * nobody calls fixes nothing.
   */
  it('las dos mitades se miden contra la altura real de la barra', () => {
    // The bar grows, and paints the taller wash.
    expect(appHeader).toContain('minHeight: ALTO + insets.top');
    expect(appHeader).toContain('height: altoLavadoDe(insets.top)');
    // The band is told where the bar ends, and offsets its wash by the same number.
    expect(spaceBand).toContain('const altoBarra = altoCabeceraDe(insets.top)');
    expect(spaceBand).toContain('marginTop: -altoBarra');
    expect(spaceBand).toContain('altoLavadoDe(insets.top)');

    // And neither of them may go back to the bare constant: that is the exact shape
    // the bug had, and it is a constant so nothing else would fail if it did.
    expect(spaceBand).not.toContain('marginTop: -ALTO_CABECERA');
  });

  /**
   * The band starts **where the bar ends**, and that is `top: 0`.
   *
   * This is the cut the design says cannot exist, and it was in the code since
   * before the safe-area change: the band's box was lifted a whole bar-height with
   * `top: -ALTO_CABECERA`, so on the web it sat at y = 0..100 instead of 56..156 —
   * and because its fade is pinned to the box's bottom (`bottom: 0`, 82% tall), the
   * fade started at y = 18, **38 points above the join**. By the height of the bar's
   * bottom edge the fade was already 46% done: the bar cuts the colour in half a
   * piece and the band underneath was already half faded. Measured at 390 wide in
   * both themes, a step of **32/255 across one line**, on every screen of a space.
   *
   * The comment on that style used to say `top: 0` was the thing causing a white
   * line under the bar — which was this bug wearing the wrong explanation.
   *
   * Measured after the fix: band at y = 56..156, fade from y = 74, largest step in
   * the whole column **3** (dark theme **2**), nothing above 6 anywhere.
   */
  it('la banda arranca donde acaba la barra, no mas arriba', () => {
    // Scoped to the `banda` style, with its comment stripped. `top: 0` also appears
    // on the veil and on the fade inside it, so asserting on the whole file passes
    // even with the band lifted a whole bar-height — which is the thing to stop.
    // And the comment on that style quotes the old `top: -56` while explaining why
    // it went, so the comment has to go before anything can match `top:`.
    const sinComentarios = spaceBand.replace(/\/\*[\s\S]*?\*\//g, '');
    const banda = sinComentarios.slice(
      sinComentarios.indexOf('banda: {'),
      sinComentarios.indexOf('lavado: {'),
    );
    expect(banda).toContain('top: 0');
    expect(banda).not.toMatch(/top:\s*-/);

    // The fade is pinned to the bottom of the box, so the box's top is the only
    // thing that decides where the colour starts going. It has to be the bar's edge.
    expect(sinComentarios).not.toContain('top: -altoBarra');
    expect(sinComentarios).not.toContain('top: -ALTO_CABECERA');
  });
});