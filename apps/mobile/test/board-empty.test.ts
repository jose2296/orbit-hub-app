import { describe, expect, it } from 'vitest';

import { dictionaries } from '@/lib/i18n/dictionaries';
import { pluralKey } from '@/lib/i18n/plural';

/**
 * Which sentence a board column says when it has nothing to draw.
 *
 * **There is no rendering here and there cannot be one.** `board-column.tsx` draws
 * `EmptyState`, `TaskRow` and a `Gesture`, and the repository's tests answer
 * `Platform` and a handful of configuration files through a stub — see
 * `vitest.config.ts` — with no renderer in the box at all. `list-kinds.test.ts` says
 * the same thing about itself: *"Esta suite no pinta nada"*. So a test that asserted
 * what the column renders would have to invent a renderer for one assertion, and the
 * browser walkthrough already does the rendering for real: `scripts/verify-state-editor.mjs`
 * block 22.3 reads both empty states off the live DOM, in light and in dark, and
 * asserts the words.
 *
 * **What is left for a test is the thing that a renderer would not protect anyway:
 * that the two sentences exist, that they are not the same sentence, and that the
 * filtered one carries the count.** Those are properties of the dictionary, they are
 * what "always say it's the filter" would break, and they hold without a DOM.
 */
const es = dictionaries.es;
const en = dictionaries.en;

/** The two phrases each language offers for an empty column, as the screen asks for them. */
function frases(locale: 'es' | 'en', base: string, count: number): string {
  const clave = pluralKey(base, count);
  const valor = (locale === 'es' ? es : en)[clave as 'board.emptyColumn'];
  return (valor ?? '').replace(/\{count\}/g, String(count));
}

describe('el estado vacio de una columna de tablero', () => {
  /**
   * **The defect itself, in the form it can fail.** One column held two tasks, a
   * filter hid them, and the column said *"No tasks"* under a tab that said *"2"* —
   * which reads as a column that lost two tasks. So the sentence for the filtered case
   * has to name the filter, and these are the two assertions that make that
   * impossible to break by accident.
   */
  it('la frase de la columna filtrada nombra el filtro y lleva el numero que esconde', () => {
    for (const locale of ['es', 'en'] as const) {
      const una = frases(locale, 'board.emptyColumnFiltered', 1);
      const dos = frases(locale, 'board.emptyColumnFiltered', 2);

      expect(una).toMatch(/filtro|filter/i);
      expect(dos).toMatch(/filtro|filter/i);
      // The number of the tab, said in the sentence. Without it the two figures on
      // screen have to be reconciled by the reader, which is the whole problem.
      expect(una).toContain('1');
      expect(dos).toContain('2');
    }
  });

  /**
   * **And it is not the same sentence as the empty one.** If these two were equal,
   * the change would pass every other check in this file and lie to everybody with
   * an empty column — which is the one-line version of the bug.
   */
  it('la columna vaciada por el filtro y la que no tiene tareas **no** dicen lo mismo', () => {
    for (const locale of ['es', 'en'] as const) {
      const vacia = (locale === 'es' ? es : en)['board.emptyColumn'];
      const filtrada = frases(locale, 'board.emptyColumnFiltered', 2);

      expect(vacia.trim().length).toBeGreaterThan(0);
      expect(filtrada.trim()).not.toBe(vacia.trim());
      // And the empty sentence must not blame a filter that never touched it.
      expect(vacia).not.toMatch(/filtro|filter/i);
    }
  });

  /**
   * **The two forms differ in something other than the count.**
   *
   * Comparing "1 task" with "2 tasks" is not enough and **has been measured passing
   * a broken dictionary**: with `board.emptyColumnFiltered.one` written as
   * *"{count} tareas"*, both forms still come out different once the number is
   * substituted in — "1 tareas" and "2 tareas" — so that comparison stays green over
   * the exact mistake the `plural` module exists in this codebase to prevent, which
   * is a singular with a plural noun.
   *
   * So the count is taken **out** and what is left is compared. The two forms of a
   * counted phrase that differ only by the number are the same phrase written twice,
   * and in both of this repository's languages the noun is what changes.
   */
  it('el singular y el plural se diferencian en algo mas que en el numero', () => {
    for (const locale of ['es', 'en'] as const) {
      const sinNumero = (clave: string): string =>
        ((locale === 'es' ? es : en)[clave as 'board.emptyColumn'] ?? '')
          .replace(/\{count\}/g, '')
          .trim();

      expect(sinNumero('board.emptyColumnFiltered.one')).not.toBe(
        sinNumero('board.emptyColumnFiltered.other'),
      );
    }
  });

  /**
   * **What to do about it is a phrase of its own, and it talks about the column.**
   *
   * "Remove the filter to see them" would have to change its pronoun with the count
   * — *see it* with one, *see them* with two — and a sentence about the whole column
   * has nothing to agree with. The hint is therefore checked for the absence of a
   * count-dependent pronoun rather than for a wording: any wording that survives a
   * change of count is acceptable, and one that does not is not.
   */
  it('la pista no depende del numero, y por eso no hay dos formas de ella', () => {
    const pista = es['board.emptyColumnFilteredHint'];
    expect(pista.trim().length).toBeGreaterThan(0);
    expect(pista).not.toContain('{count}');
    expect(en['board.emptyColumnFilteredHint'].trim()).not.toBe(pista.trim());
  });

  /**
   * **Both languages have all four keys, and both plural forms.**
   *
   * `translations.test.ts` already refuses a one-sided key and a half-written
   * family; this is the narrower statement that *these* keys are among the ones it
   * covers, so a rename that quietly drops one of them fails here by name instead of
   * only in that suite's generic diff.
   */
  it('las cuatro claves existen en las dos lenguas y con sus dos formas', () => {
    const claves = [
      'board.emptyColumn',
      'board.emptyColumnFiltered.one',
      'board.emptyColumnFiltered.other',
      'board.emptyColumnFilteredHint',
    ] as const;

    for (const clave of claves) {
      expect(es[clave], `es ${clave}`).toBeTruthy();
      expect(en[clave], `en ${clave}`).toBeTruthy();
    }
  });
});
