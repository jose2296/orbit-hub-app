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
    // A link with no list behind it lands on the index rather than on
    // `/list/undefined`, which is the route the string concatenation used to build.
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