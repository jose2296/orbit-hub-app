/**
 * Where the finger last came down, so a sheet can grow out of what was pressed
 * without every opener having to measure its own button.
 *
 * It is a point and not an element: the app root and every `Sheet` record the
 * coordinates of each touch, and a sheet that opens right after one starts from a
 * small rectangle around it. A sheet opened by something that is not a touch (a
 * timer, a finished save, a route) finds a stale point and gets `null`, and rises
 * from the edge as it always did.
 */
export interface TouchOrigin {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Longer than this between the touch and the opening and it was not the touch that opened it. */
const MAX_AGE_MS = 2000;
/** Side of the rectangle the sheet grows from: a fingertip, not a button. */
const SIZE = 24;

let last: { x: number; y: number; at: number } | null = null;

export function recordTouch(x: number, y: number, at: number = Date.now()): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  last = { x, y, at };
}

export function originFromLastTouch(now: number = Date.now()): TouchOrigin | null {
  if (!last || now - last.at > MAX_AGE_MS) return null;
  return { x: last.x - SIZE / 2, y: last.y - SIZE / 2, width: SIZE, height: SIZE };
}

export function resetTouchOrigin(): void {
  last = null;
}

/**
 * For `onStartShouldSetResponderCapture`: records the touch and answers `false`,
 * so it only listens and never takes the responder from the control being pressed.
 * That handler (and not `onTouchStart`) because it fires for a mouse as well, and
 * the web is a target.
 */
export function captureTouch(event: { nativeEvent: { pageX: number; pageY: number } }): boolean {
  recordTouch(event.nativeEvent.pageX, event.nativeEvent.pageY);
  return false;
}
