import { normalizaColor } from '@orbit-hub/contracts';

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
 *
 * **The shape of the colour is not decided here.** `ES_HEX` lived in this file —
 * six digits, `#` and uppercase— which made it one of the seven hex rules in this
 * repository and the narrowest of the seven. It asks `normalizaColor` now, which
 * owns the shape, and it stores **what comes back**: six digits, uppercase. The
 * only thing that really changes is what is accepted: an older row holding
 * `#a1b2c3` in lower case comes out as `#A1B2C3` instead of vanishing from the row
 * without a word, because what this file has always written was already that shape.
 */

const KEY = 'orbithub:recent-workspace-colors';

/** Enough to be useful on a row and few enough to stay a row. */
const MAX = 8;

function read(): { desde: string[]; hasta: string[] } {
  const parsed = keyValueStore.getJson<{ desde?: unknown; hasta?: unknown }>(KEY);
  // The `map` goes **before** the filter, and why: the filter is the contract, which
  // is what answers whether something is a colour, but what is stored has to be the
  // **normalised** form it hands back. Filtering first and keeping the raw string
  // would decide the shape here again, which is the thing being removed.
  const clean = (value: unknown): string[] =>
    Array.isArray(value)
      ? value
          .map((v) => normalizaColor(v))
          .filter((v): v is string => v !== null)
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
  // **The stored hex is the one the contract returns, not the one that arrived.**
  // It used to be `color.trim().toUpperCase()` behind an `ES_HEX` — a `replace` and a
  // `toUpperCase` deciding the shape on their own. Now the owner decides it, and
  // what is written is what the owner answered.
  const hex = normalizaColor(color);
  if (hex === null) return;
  const todas = read();
  const propias = todas[lado].filter((c) => c !== hex);
  write({ ...todas, [lado]: [hex, ...propias].slice(0, MAX) });
}

/** Clears both ends. Exposed for the day somebody wants a "forget this" control. */
export function forgetRecentColors(): void {
  keyValueStore.remove(KEY);
}
