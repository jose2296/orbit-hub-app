/**
 * Which row steps aside, and which way.
 *
 * The dragged row is lifted and every other row between where it started and
 * where it would land moves one place out of the way, so the gap the user sees
 * is the gap the row will drop into. That is arithmetic on three numbers, and
 * arithmetic on three numbers is exactly the kind of thing that is right in
 * your head and wrong in the code, so it lives here and is tested.
 */

/** Where a row has to move, in rows, while a drag is in progress. */
export function rowShift(args: {
  /** The row being dragged, or null when there is no drag. */
  draggingId: string | null;
  id: string;
  index: number;
  from: number;
  to: number;
  rowHeight: number;
}): number {
  'worklet';
  const { draggingId, id, index, from, to, rowHeight } = args;
  // Nothing is being dragged, or this is the row doing the dragging: it does
  // not move out of its own way.
  if (draggingId === null || draggingId === id) return 0;
  if (from === to) return 0;

  if (from < to) {
    // Going down: the rows it passes move up into the hole it leaves behind.
    return index > from && index <= to ? -rowHeight : 0;
  }

  // Going up: the rows above it move down to close the gap it is leaving.
  return index >= to && index < from ? rowHeight : 0;
}

/**
 * Where a row would land, given how far the finger has gone.
 *
 * Clamped at both ends: dragging the first row up, or the last one down, has
 * nowhere to go, and a row that wrapped around to the other end of the list
 * would look like the list had done something on its own.
 */
export function dropIndex(args: {
  index: number;
  total: number;
  translationY: number;
  rowHeight: number;
}): number {
  'worklet';
  const { index, total, translationY, rowHeight } = args;
  const alto = rowHeight > 0 ? rowHeight : 1;
  const desplazamiento = Math.round(translationY / alto);
  const destino = index + desplazamiento;
  return Math.max(0, Math.min(destino, total - 1));
}
