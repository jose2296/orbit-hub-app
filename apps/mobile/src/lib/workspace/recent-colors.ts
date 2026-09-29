import { keyValueStore } from '@/lib/storage/key-value';

/**
 * The colours somebody has actually used on a space, per end of the wash.
 *
 * The twelve swatches are the fast way in and they are enough for most spaces.
 * They are not enough for the second end of a wash, and the reason is not that
 * there are too few colours — it is that a wash is a **pair**, and the pair that
 * works is the one where somebody already liked both halves. Setting the first end
 * to a teal and then hunting through the square for that teal again, at a slightly
 * different brightness, is the most repeated action in this picker and it is
 * entirely avoidable.
 *
 * So each end remembers its own, and **the row shows both**. That is the whole
 * point: on "Termina en" the colours you have used on "Empieza en" are one press
 * away, which is how you build a gradient *from* a colour instead of trying to
 * arrive at it twice.
 *
 * Kept per end and not as one list, because the two ends are edited in different
 * places and "the last four I used" means something different for each of them.
 *
 * Local, like every other preference here: it is a convenience, it is worthless
 * offline, and syncing it would be a write for something nobody reads twice.
 */

const KEY = 'orbithub:recent-workspace-colors';

/** Enough to be useful on a row and few enough to stay a row. */
const MAX = 8;

const ES_HEX = /^#[0-9A-F]{6}$/;

function read(): { desde: string[]; hasta: string[] } {
  const parsed = keyValueStore.getJson<{ desde?: unknown; hasta?: unknown }>(KEY);
  const clean = (value: unknown): string[] =>
    Array.isArray(value)
      ? value
          .filter((v): v is string => typeof v === 'string' && ES_HEX.test(v))
          .slice(0, MAX)
      : [];
  return { desde: clean(parsed?.desde), hasta: clean(parsed?.hasta) };
}

function write(next: { desde: string[]; hasta: string[] }): void {
  keyValueStore.setJson(KEY, next);
}

/** The colours to offer on one end: its own first, then the other end's. */
export function recentColors(lado: 'desde' | 'hasta'): string[] {
  const todas = read();
  const propias = lado === 'desde' ? todas.desde : todas.hasta;
  const otras = lado === 'desde' ? todas.hasta : todas.desde;
  return [...propias, ...otras.filter((c) => !propias.includes(c))].slice(0, MAX);
}

/**
 * A colour has been used on an end, and goes to the front of that end's list.
 *
 * Called when the colour is **committed**, not while it is being dragged: a drag
 * crosses a hundred colours and every one of them would end up in the list, which
 * is the same reason the picker does not write on a drag.
 */
export function rememberColor(lado: 'desde' | 'hasta', color: string): void {
  const hex = color.trim().toUpperCase();
  if (!ES_HEX.test(hex)) return;
  const todas = read();
  const propias = todas[lado].filter((c) => c !== hex);
  write({ ...todas, [lado]: [hex, ...propias].slice(0, MAX) });
}

/** Clears both ends. Exposed for the day somebody wants a "forget this" control. */
export function forgetRecentColors(): void {
  keyValueStore.remove(KEY);
}
