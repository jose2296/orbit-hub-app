import { describe, expect, it } from 'vitest';

import { pluralKey } from '../src/lib/i18n/plural';

/**
 * Which form of a counted phrase to use.
 *
 * "1 miembros" is the kind of thing that looks machine made, and it shows up on
 * the screens a person reads most. The dictionary key carries the form so a
 * missing translation is a type error rather than a sentence in the wrong
 * number.
 */
describe('pluralKey', () => {
  it('is singular for one', () => {
    expect(pluralKey('workspaces.members', 1)).toBe('workspaces.members.one');
  });

  it('is plural for none, which is not a special case in either language', () => {
    // Spanish and English both use the plural for zero: "0 miembros", "0 members".
    expect(pluralKey('workspaces.members', 0)).toBe('workspaces.members.other');
  });

  it('is plural for two and up', () => {
    expect(pluralKey('workspaces.members', 2)).toBe('workspaces.members.other');
    expect(pluralKey('workspaces.members', 99)).toBe('workspaces.members.other');
  });

  it('is plural for a count that is not whole', () => {
    // A count that arrived as a float of one point something is not one item.
    expect(pluralKey('lists.itemCount', 1.5)).toBe('lists.itemCount.other');
  });

  it('is not singular for a negative count, because it is not one', () => {
    // A negative count is a bug upstream, and guessing at the form of a bug is
    // worse than picking the one that does not claim there is a single item.
    expect(pluralKey('lists.itemCount', -1)).toBe('lists.itemCount.other');
  });

  it('keeps the base key, so the form is derived and not typed by hand', () => {
    // A typo in the base would produce a key that is not in the dictionary, and
    // that does not compile at the call site.
    expect(pluralKey('folders.count', 1)).toBe('folders.count.one');
  });
});
