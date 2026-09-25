/**
 * The arithmetic of a drag and drop.
 *
 * The gesture runs on the UI thread and only knows a translation in pixels, so
 * the index a row would land on has to be derived from that. Getting it wrong
 * means a row is dropped somewhere other than where it visually lands, which is
 * the one failure a drag cannot recover from.
 */

/**
 * Index a row at `fromIndex` would occupy after travelling `translationY`.
 *
 * Clamped to the list, so a long drag cannot target a row that does not exist,
 * and safe when the row height is not measured yet: a zero height must not
 * produce NaN and poison the order.
 */
export function dropTargetIndex(
  fromIndex: number,
  translationY: number,
  rowHeight: number,
  total: number,
): number {
  if (rowHeight <= 0 || total <= 1) return fromIndex;
  const shift = Math.round(translationY / rowHeight);
  return Math.max(0, Math.min(fromIndex + shift, total - 1));
}

/**
 * Applies a drop: the row moves to `toIndex` and the rest keep their order.
 *
 * `toIndex` is the final position in the list, so lifting the row out and
 * inserting it there is enough. A move downwards needs no adjustment: removing
 * the row first already closed the gap behind it.
 */
export function nextOrderFromDrop<T>(order: T[], id: T, toIndex: number): T[] {
  const from = order.indexOf(id);
  if (from === -1) return order;
  if (toIndex < 0 || toIndex >= order.length) return order;
  if (from === toIndex) return order;

  const next = [...order];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return order;
  next.splice(toIndex, 0, moved);
  return next;
}
