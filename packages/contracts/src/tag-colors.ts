import { z } from 'zod';

import { ITEM_ICON_COLORS } from './item-icons.js';
import type { ItemIconColor } from './item-icons.js';

/**
 * The colours a label can have are the colours an icon can have, and not a new
 * set: the app draws these twelve already, so a label is never a colour nobody
 * can read and the palette is not two lists that have drifted apart.
 */
export const tagColorSchema = z.record(
  z.string().trim().min(1).max(40),
  z.enum(ITEM_ICON_COLORS),
);
export type TagColors = z.infer<typeof tagColorSchema>;

/**
 * The colour a label gets when nobody has chosen one for it.
 *
 * A hash of the name, and that is the whole design: the colour is **obligatory**
 * and choosing it is **optional**, so the default case has to exist without
 * anybody deciding anything — and it has to be a colour and not a grey, or "nobody
 * chose" and "this name happens to be grey" would look the same.
 *
 * FNV-1a, 32 bits, over the UTF-16 units of the name, modulo the palette length.
 * `Math.imul` keeps the multiply exact in 32 bits in every engine and
 * `charCodeAt` reads the same everywhere, so two phones and a server land on the
 * same colour for the same word. That is what makes it safe **not to store it**:
 * there is nothing to sync for the default case, and the labels that already
 * exist get a colour the moment this ships, with no backfill.
 *
 * **Case and accents are not folded.** `Pañales` and `panales` are two different
 * labels everywhere else in this app —the membership check is exact— so folding
 * them here would give two labels one colour, and choosing a colour for one would
 * silently recolour the other.
 */
export function derivedTagColor(tag: string): ItemIconColor {
  let hash = 0x811c9dc5;
  for (let index = 0; index < tag.length; index += 1) {
    hash ^= tag.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // The `!` is `noUncheckedIndexedAccess` asking about a modulo that cannot be out
  // of range: `hash` is an integer below 2^32, so the remainder is one of the
  // twelve. `note-document.ts` takes the same door.
  return ITEM_ICON_COLORS[hash % ITEM_ICON_COLORS.length]!;
}

/**
 * A map of colours made only of colours this build knows.
 *
 * On both sides of the wire, which is why it is here and not in either app: the
 * server runs it over a payload it has not validated, and the client runs it over
 * a cache row written by a build that may predate the field.
 *
 * An entry that is dropped is **not** a failure. It means "no colour chosen",
 * which is a state the map already has — an absent key — so the label falls back
 * to `derivedTagColor`. Rejecting the whole write would lose every other label's
 * colour because of one bad key, and would punish whoever did not type that key.
 */
export function sanitiseTagColors(value: unknown): TagColors;
export function sanitiseTagColors(value: unknown): TagColors {
  // Not an object, or an array, is no map: `{}`. Otherwise copy entry by entry,
  // skipping a key that is not 1-40 characters once trimmed, and a value that is
  // not one of the twelve. `ITEM_ICON_COLORS.includes` needs the cast: the value
  // out of `Object.entries` is `unknown`.
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const colores: TagColors = {};
  for (const [key, color] of Object.entries(value)) {
    const etiqueta = key.trim();
    if (etiqueta.length < 1 || etiqueta.length > 40) {
      continue;
    }
    if (!ITEM_ICON_COLORS.includes(color as ItemIconColor)) {
      continue;
    }
    colores[etiqueta] = color as ItemIconColor;
  }
  return colores;
}