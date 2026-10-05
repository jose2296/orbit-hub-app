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
 * `components/lists/task-row.tsx` for a comment that blamed the wrong file and
 * fixed nothing.
 *
 * The measurements that found them are in the comments on the code they guard, and
 * they were taken on an Android release build (API 35), not reasoned about.
 */
const RAIZ = join(import.meta.dirname, '..');
const src = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8');

const checkbox = src('src/components/ui/checkbox.tsx');
const badge = src('src/components/ui/badge.tsx');
const listId = src('src/app/(app)/list/[listId].tsx');
const taskRow = src('src/components/lists/task-row.tsx');
const appHeader = src('src/components/ui/app-header.tsx');
const screen = src('src/components/ui/screen.tsx');
const spaceBand = src('src/components/workspace/space-band.tsx');
const statePickerSheet = src('src/components/lists/state-picker-sheet.tsx');
const boardScreen = src('src/app/(app)/board/[listId].tsx');

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
    // `taskRow` and not the screen: the row is a component of its own, and a
    // `not.toContain` on a file the row no longer lives in would pass for the
    // wrong reason. The screen is still asserted on, below, for the shapes it
    // decides itself.
    expect(taskRow).not.toContain('dragHandle');
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
    expect(taskRow).toContain('metaTag');
    // And the second line is drawn only when there is something to draw.
    expect(taskRow).toContain(
      '{item.priority !== "none" || item.tags.length > 0 ? (',
    );
    const meta = taskRow.slice(taskRow.indexOf('metaTag: {'));
    expect(meta).toContain('flexShrink: 1');
  });
});

/**
 * The row is shared by two screens now, and a shared component that one of them
 * cannot use is not shared.
 *
 * Two of the three below are the differences between a list row and a board row:
 * the checkbox, which a board row does not draw, and the colour down the left
 * edge, which a list row does not paint. The third is not a difference between
 * the two rows — it is about there being **one** row at all.
 *
 * All three assert on the source for the same reason as everything else here: the
 * question is whether the **optional** parts are optional, and the only way to
 * see that in `node` is to read the props and the condition.
 */
describe('la fila sabe dibujarse sin casilla y con filo de estado', () => {
  it('la casilla se dibuja solo si hay algo que marque', () => {
    // Optional in the props, and **not defaulted to a no-op**: a `onToggle` that
    // did nothing would draw a box that lies about the task being tickable.
    expect(taskRow).toContain('onToggle?: () => void');
    // And the box is inside a condition on it, not rendered and hidden.
    expect(taskRow).toContain('{onToggle ? (');
    // The empty label stays. This is the one that measured 755 of 754 points.
    expect(taskRow).toContain('onToggle={onToggle} label=""');
  });

  it('el filo de color solo existe cuando le pasan un color', () => {
    expect(taskRow).toContain('edgeColor?: string');
    // Conditional, not `edgeColor ?? theme.colors.border`: the flat list must draw
    // exactly what it drew before this prop existed, and a default colour would
    // put an edge on every row of every list.
    expect(taskRow).toContain('...(edgeColor');
    expect(taskRow).toContain('borderLeftColor: edgeColor');
  });

  /**
   * The card of a board has **two** doors to the task panel, and only one of them
   * is drawn per card.
   *
   * A tap on a board card opens the **state** sheet — the spec's own sentence,
   * *"Tocar la tarjeta abre la hoja de estado"* — and the card's other target is the
   * icon, which is drawn **only when the task has one**: `{item.icon ? … : null}`,
   * and `icon` is `null` on every task created in the app (`item-record.ts`). So on
   * an icon-less card the icon is not a second door, it is no door at all.
   *
   * That is not hypothetical: it is what the first review of Task 10 found. A card
   * tap opened the state sheet, the sheet had no link to the task panel, and the
   * **description — which the spec says lives in the edit sheet — had no route at
   * all**. The comment in the screen claimed the panel was reachable through the
   * icon, and it was reachable on no card the walkthrough had ever seeded.
   *
   * So the second door is a row of the state sheet (`state-picker-edit-task`), and
   * these assertions are here because a route that exists only in someone's head
   * is exactly what went missing. The browser walkthrough proves the door opens;
   * these prove it is still in the source, without a browser.
   */
  it('la tarjeta de un tablero tiene dos puertas al panel, y una solo se dibuja con icono', () => {
    // The icon is conditional — this is the fact the whole second door rests on.
    expect(taskRow).toContain('{item.icon ? (');
    // And the state sheet has the door for the card that has no icon.
    expect(statePickerSheet).toContain('testID="state-picker-edit-task"');
    expect(statePickerSheet).toContain('onEditTask');
    // It is wired, not declared: a prop nobody passes is a row that does nothing,
    // and that is a no-op dressed as a feature.
    expect(boardScreen).toContain('onEditTask={');
    // And the row asks the screen for the task that was tapped rather than
    // guessing: the screen reads it out of `cambiandoEstado`, which is the state
    // that knows whether there is a task, and the press and the close are one
    // commit so it is still the right id when this runs.
    expect(boardScreen).toContain('const fila = tareaEstado;');
    expect(statePickerSheet).toContain('onEditTask();');
  });

  it('la pantalla de listas usa la fila del componente, y no una suya', () => {
    // **One** screen uses it today; the board is Task 8. So this does not claim
    // anything about who passes what: it claims that the list screen draws the
    // shared row and does not carry a second copy of it, because two
    // `function TaskRow` in the repo is the thing this move exists to stop.
    //
    // Nothing here would notice who passes `onToggle` and who does not. That is
    // not what this test is for, and a title that said it was would be the reason
    // nobody notices.
    expect(listId).toContain('from "@/components/lists/task-row"');
    expect(listId).not.toContain('function TaskRow');
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