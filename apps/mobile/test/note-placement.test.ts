import { describe, expect, it } from 'vitest';

import {
  hasReachedServer,
  needsPlacement,
  notePlacement,
  type NotePlacementContext,
} from '../src/lib/notes/placement';

/**
 * Where a new note goes.
 *
 * A note without a space is a note that exists and is not on the server. The app
 * writes it locally, opens the editor, lets it be typed into, and the push comes
 * back refused — and the refusal is the only sign, so the person finds out by
 * opening the app on another device and not finding what they wrote.
 *
 * The gap this covers is a type. The route the menu uses declares no parameters,
 * so `useLocalSearchParams` typed `workspaceId` as `string` — a value that is
 * `undefined` at runtime, for the way most people reach the screen. Nothing
 * downstream could check it, because nothing checks a `string`.
 */

const SIN_ESPACIO: NotePlacementContext = {};

describe('needsPlacement', () => {
  it('says yes when the screen was reached without a space', () => {
    expect(needsPlacement(SIN_ESPACIO)).toBe(true);
  });

  it('says no when the address bar named one', () => {
    expect(needsPlacement({ workspaceId: 'w1' })).toBe(false);
  });

  /**
   * An empty parameter is not a space. Treating `""` as "this space" would create
   * a note filed in nothing, which is the same failure wearing a disguise.
   */
  it('treats an empty parameter as no space at all', () => {
    expect(needsPlacement({ workspaceId: '' })).toBe(true);
  });
});

describe('notePlacement', () => {
  it('has nowhere to put a note when nothing said and nobody picked', () => {
    expect(notePlacement(SIN_ESPACIO)).toBeNull();
    expect(notePlacement(SIN_ESPACIO, null)).toBeNull();
  });

  it('uses the space and the folder from the route', () => {
    expect(notePlacement({ workspaceId: 'w1', folderId: 'f1' })).toEqual({
      workspaceId: 'w1',
      folderId: 'f1',
    });
  });

  it('puts a note at the root of its space when no folder was said', () => {
    // `undefined` from the route and `null` from a pick both mean "not filed",
    // and `applyNoteFilters` reads the two the same way.
    expect(notePlacement({ workspaceId: 'w1' })).toEqual({
      workspaceId: 'w1',
      folderId: null,
    });
  });

  it('lets a picked place win over the route', () => {
    // Asked for later and on purpose, so it is the answer.
    expect(
      notePlacement(
        { workspaceId: 'w1', folderId: 'f1' },
        { workspaceId: 'w2', folderId: 'f2' },
      ),
    ).toEqual({ workspaceId: 'w2', folderId: 'f2' });
  });

  it('keeps a picked "no folder" as no folder, and not the route one', () => {
    // The person was asked and chose the root. Falling back to the route's folder
    // would file it somewhere they just said no to.
    expect(
      notePlacement({ workspaceId: 'w1', folderId: 'f1' }, { workspaceId: 'w1', folderId: null }),
    ).toEqual({ workspaceId: 'w1', folderId: null });
  });

  it('drops a folder that arrived without a space', () => {
    // A folder with no space cannot be filed anywhere: the space is what a note
    // is authorised against on the server.
    expect(notePlacement({ folderId: 'f1' })).toBeNull();
  });
});

describe('hasReachedServer', () => {
  it('says no for a note only this device knows about', () => {
    // A note is written locally and enqueued, so for the first seconds of its
    // life the server has never heard of it. The files on the note were being
    // asked for anyway, and the answer was a 404 on every note ever created.
    expect(hasReachedServer({ version: 0 })).toBe(false);
  });

  it('says yes once the server has counted it', () => {
    expect(hasReachedServer({ version: 1 })).toBe(true);
    expect(hasReachedServer({ version: 7 })).toBe(true);
  });

  /**
   * Optimism here is the whole bug back again. A note we cannot see the version of
   * is a note we have no evidence about, and guessing "yes" restores the 404.
   */
  it('says no when there is no note to ask about', () => {
    expect(hasReachedServer(null)).toBe(false);
    expect(hasReachedServer(undefined)).toBe(false);
  });
});
