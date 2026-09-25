/**
 * Moving an item within a list.
 *
 * Positions are stored as a contiguous run from zero. Anything else makes "the
 * item after this one" ambiguous once two devices reorder the same list, so the
 * result is always renumbered even when nothing actually moved.
 */

export interface Positioned {
  id: string;
  position: number;
  [key: string]: unknown;
}

/**
 * Returns a new list with `id` moved by `delta` places, renumbered from zero.
 *
 * The input is never mutated, and a move that would leave the list is ignored
 * rather than clamped: silently turning "move up" into "stay" hides a bug in
 * whichever control asked for it.
 */
export function reorderItems<T extends Positioned>(items: T[], id: string, delta: number): T[] {
  const ordered = [...items].sort((a, b) => a.position - b.position);
  const from = ordered.findIndex((item) => item.id === id);
  if (from === -1 || delta === 0) return ordered;

  const to = from + delta;
  if (to < 0 || to >= ordered.length) return ordered;

  const moved = ordered.splice(from, 1)[0];
  if (!moved) return ordered;
  ordered.splice(to, 0, moved);

  return ordered.map((item, index) => ({ ...item, position: index }));
}
