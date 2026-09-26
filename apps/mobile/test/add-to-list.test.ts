import { describe, expect, it } from 'vitest';

import { nextPosition, planAddToList } from '../src/lib/lists/add-to-list';

/**
 * Adding one title to another list.
 *
 * The rules are the ones a person would not think about and would notice when
 * they are wrong: the same film in two lists is a duplicate and not a copy, and
 * a hand written row has to be able to be added twice.
 */
describe('planAddToList', () => {
  it('adds a title that is not in the list yet', () => {
    expect(planAddToList([{ externalId: 'movie:1' }], { externalId: 'movie:2' })).toEqual({
      added: true,
    });
  });

  it('refuses a title the list already has', () => {
    expect(
      planAddToList(
        [{ externalId: 'movie:1' }, { externalId: 'movie:2' }],
        { externalId: 'movie:1' },
      ),
    ).toEqual({ added: false, reason: 'already-there' });
  });

  it('adds a title with no provider id, because nothing can match it', () => {
    // A hand written row has no id, so comparing ids would call every one of
    // them a duplicate of the others and the list could never grow by hand.
    expect(planAddToList([{ externalId: null }], { externalId: null })).toEqual({ added: true });
    expect(planAddToList([{ externalId: null }], { externalId: 'movie:1' })).toEqual({ added: true });
  });

  it('adds to an empty list', () => {
    expect(planAddToList([], { externalId: 'movie:1' })).toEqual({ added: true });
  });

  it('compares the ids exactly, not by prefix', () => {
    // "movie:1" is a prefix of "movie:10" and they are different films.
    expect(planAddToList([{ externalId: 'movie:10' }], { externalId: 'movie:1' })).toEqual({
      added: true,
    });
  });

  it('treats an empty id as no id rather than as a match', () => {
    // An empty string is falsy but not null, and a client from a future build
    // could send it; treating it as a value would collapse the whole list.
    expect(planAddToList([{ externalId: '' }], { externalId: '' })).toEqual({ added: true });
  });
});

describe('nextPosition', () => {
  it('starts at zero in an empty list', () => {
    expect(nextPosition([])).toBe(0);
  });

  it('goes after the last item, not into the gap a delete left', () => {
    expect(nextPosition([{ position: 0 }, { position: 5 }])).toBe(6);
  });

  it('never returns a negative position from a corrupt list', () => {
    expect(nextPosition([{ position: -3 }])).toBe(1);
  });
});
