import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { routeForList } from '../src/lib/lists/route';

describe('una lista se abre en la pantalla que le toca', () => {
  it('un tablero va a /board y todo lo demas a /list', () => {
    // Several places wrote `/list/${id}` by hand. With a sixth kind, whichever one
    // is left behind does not fail: it opens the task screen of a board, which is
    // similar enough to it not to look broken, and no assertion catches it.
    expect(routeForList({ id: 'a', kind: 'board' })).toBe('/board/a');
    expect(routeForList({ id: 'a', kind: 'tasks' })).toBe('/list/a');
    expect(routeForList({ id: 'a', kind: 'movies' })).toBe('/list/a');
    // A lookup that came back empty lands on the index of the lists, which is
    // somewhere to be, instead of nowhere.
    expect(routeForList(null)).toBe('/lists');
  });

  it('los otros cuatro tipos tambien van a /list', () => {
    // The kinds that are not boards are all the same screen, so this is the same
    // claim five times: the rule is "a board is not a list screen", not "tasks is".
    expect(routeForList({ id: 'a', kind: 'series' })).toBe('/list/a');
    expect(routeForList({ id: 'a', kind: 'movies_and_series' })).toBe('/list/a');
    expect(routeForList({ id: 'a', kind: 'books' })).toBe('/list/a');
    // Nothing at all is the index too, and undefined is what a lookup that missed
    // hands over.
    expect(routeForList(undefined)).toBe('/lists');
  });
});

/**
 * Nothing spells out the route of a list, because the one place that does not
 * know how to spell it is the bug this whole file exists for.
 *
 * The seven links that used to write `` `/list/${id}` `` by hand are the reason.
 * Leaving one of them behind is not a crash: it opens the task screen of a
 * board, which is close enough to the board that nobody reports it and no test
 * of a rendered screen would notice — this suite runs in `node`, paints nothing
 * and cannot click a row. So the shape is read **out of the source** and
 * refused, in the spirit of `task-row-layout.test.ts`: the app cannot measure
 * what it is about to get wrong, and a file can.
 *
 * A comment that quotes the old form counts as a hit too, on purpose. A comment
 * is where a shape comes back from, and there is nothing to fix in a file whose
 * only offence is explaining what it used to do.
 *
 * `dictionaries.ts` mentions "the note/list/folder/space" in a sentence about
 * who deleted a record, which is the name of an entity and not a route, and the
 * pattern below is narrow enough to leave it alone.
 */
const RAIZ = join(import.meta.dirname, '..');
const SRC = join(RAIZ, 'src');

/** The one file allowed to build the route: the function that decides it. */
const LA_FUNCION = 'lib/lists/route.ts';

/** Every source file of the app, because a route can grow in any of them. */
function fuentes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const ruta = join(dir, entry.name);
    if (entry.isDirectory()) return fuentes(ruta);
    return /\.tsx?$/.test(entry.name) ? [ruta] : [];
  });
}

/**
 * A route of a list written out in a file: the template `` `/list/${id}` `` and
 * the concatenation `"/list/" + id`, which is the same decision written twice.
 *
 * `/lists/${id}/export` in `list-menu-sheet.tsx` is not one of these: the export
 * is an API path and not a screen, and the slash after `lists` is what keeps it
 * out of this pattern.
 */
const RUTA_A_MANO = /\/list\/(\$\{|\s*['"]\s*\+)/;

describe('la ruta de una lista no se escribe a mano', () => {
  it('no aparece en ningun fuente de la aplicacion', () => {
    const leidos = fuentes(SRC);
    // A walk that quietly reads nothing leaves this test green and wrong, so
    // the count is part of the claim: it is the whole app, not one folder.
    expect(leidos.length).toBeGreaterThan(50);

    const infractores: string[] = [];
    for (const ruta of leidos) {
      const relativo = relative(SRC, ruta).split(sep).join('/');
      if (relativo === LA_FUNCION) continue;
      readFileSync(ruta, 'utf8').split('\n').forEach((linea, i) => {
        if (RUTA_A_MANO.test(linea)) infractores.push(`${relativo}:${i + 1}  ${linea.trim()}`);
      });
    }

    expect(
      infractores,
      'una ruta de lista escrita a mano: imports routeForList y quita el literal',
    ).toEqual([]);
  });
});