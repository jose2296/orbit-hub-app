/**
 * Where a new note goes, and whether anybody has to be asked.
 *
 * A note always lives in a space, and the screen that lists them does not always
 * know which: the menu reaches `/notes` with no parameters at all, because "every
 * note you have written" is not a list that belongs to one of them. So the space
 * arrives in one of two ways, and the difference is not a detail of the screen —
 * it is whether a note can be created or not.
 *
 * It was decided in the screen, and the decision was made on a value the route
 * had typed as `string` and handed over as `undefined`. `useLocalSearchParams`
 * types a parameter as the route declares it, and the menu's route declares
 * none, so `workspaceId: string` was a claim about a value that was not there.
 * Nothing checked it, because nothing can check a `string`. The note was written
 * to the cache with no space, the editor opened, and the push came back
 * refused with "workspaceId" — a note that exists, that opens, that can be typed
 * into, and that is not on the server.
 *
 * So the rule is here, where it can be asked about without a screen.
 */

export interface NotePlacement {
  workspaceId: string;
  folderId: string | null;
}

/** What the address bar said, or did not. */
export interface NotePlacementContext {
  /**
   * The space from the route. `undefined` means the screen was reached without
   * one, which is what the menu does — and a distinction from `""` on purpose, so
   * that a route that carried an empty parameter is asked about rather than
   * silently treated as "this space, no folder".
   */
  workspaceId?: string;
  folderId?: string;
}

/** A place somebody picked, from `WhereNoteSheet`. */
export type PickedPlace = NotePlacement;

/**
 * Whether the person has to be asked where the note goes.
 *
 * `true` when nothing said, and that is the whole test: one space is still
 * ambiguous, because "the first of five" is not a decision anybody made.
 */
export function needsPlacement(context: NotePlacementContext): boolean {
  return !context.workspaceId;
}

/**
 * The place a note is created in, or `null` when there is nothing to create it in.
 *
 * The picked place wins over the address bar, because it was asked for later and
 * on purpose. The route is the fallback for the case where nobody was asked.
 *
 * `null` rather than a default: there is no space to default to, and inventing
 * one would file somebody's note in a project they have never opened.
 */
export function notePlacement(
  context: NotePlacementContext,
  picked?: PickedPlace | null,
): NotePlacement | null {
  if (picked) {
    return { workspaceId: picked.workspaceId, folderId: picked.folderId };
  }

  if (!context.workspaceId) return null;

  // A folder from the route is meaningless without its space, and an empty
  // parameter is not a folder: it is the absence of one, which is `null`.
  return {
    workspaceId: context.workspaceId,
    folderId: context.folderId ? context.folderId : null,
  };
}
