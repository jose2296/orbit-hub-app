import { z } from 'zod';

import { ITEM_ICON_COLORS } from './item-icons.js';
import type { ItemIconColor } from './item-icons.js';

/**
 * A label's colour is a hex and not one of a list.
 *
 * **The icons keep their twelve and the labels stop having any.** An icon is a
 * small shape on a busy list, and there is a colour nobody can read on it; a label
 * is a whole row's worth of surface and the person using the app is the one who
 * picks it. So `ItemIconColor` stays exactly as it was for the icons, and the value
 * of this map is a `string` that holds a hex.
 *
 * `derivedTagColor` still draws out of those twelve, and that is not an
 * inconsistency: **deducing is not choosing**. Nobody asked for a colour here, so
 * the app picks one that is guaranteed to be readable and stays the same on every
 * device — which a free hex chosen by a person never is, by definition.
 *
 * The schema only knows the *shape* of the value. Whether it is a colour at all is
 * `normalizaColor`'s job, and who ends up storing it is `sanitiseTagColors`'s.
 */
export const tagColorSchema = z.record(
  z.string().trim().min(1).max(40),
  z.string(),
);
export type TagColors = z.infer<typeof tagColorSchema>;

/** A hex of three or six digits, with or without the `#`. */
export const TAG_HEX = /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

/**
 * The one place in this repository that decides what a colour string is.
 *
 * **Six digits, uppercase, with the `#`, or `null`.** `#aabbcc` and `#AABBCC` are
 * the same colour and the map has to agree with itself: a map where both are keys
 * is a map where a label has two colours and only one of them is on screen.
 * `#fff` is expanded to `#FFFFFF` because a three-digit field is not a different
 * colour, and because the app's own validator —`esHex`, in
 * `apps/mobile/src/lib/workspace/hsl.ts`— accepts both widths **on purpose**: its
 * comment says that narrowing it turned a working path into the fallback and that
 * two tests caught it in one run.
 *
 * **It lives here and not in the app** because `packages/contracts` cannot import
 * from `apps/mobile`, and the server is the one that normalises, so the validator
 * the server uses has to be here. That leaves two validators in the repo and the
 * only thing keeping them from drifting apart is the rule they both have to
 * follow: **`esHex` and this accept exactly the same strings.** It is also why the
 * leading and trailing spaces are trimmed before the test — `esHex` trims, so
 * `" #fff "` is a colour there and has to be one here too, or the field that
 * accepts it and the map that stores it would be two rules.
 *
 * `unknown` in, because it is called with whatever came off the wire. Nothing
 * throws, and `null` is the answer for everything that is not a colour.
 */
export function normalizaColor(texto: unknown): string | null {
  if (typeof texto !== 'string') {
    return null;
  }
  const limpio = texto.trim();
  if (!TAG_HEX.test(limpio)) {
    return null;
  }
  const sinHash = limpio.replace('#', '').toUpperCase();
  const seis =
    sinHash.length === 3
      ? sinHash
          .split('')
          .map((digito) => digito + digito)
          .join('')
      : sinHash;
  return `#${seis}`;
}

/**
 * The twelve palette names and the hex each one is drawn in.
 *
 * **Copied by hand from `ICON_COLORS` in `apps/mobile/src/lib/lists/item-icons.ts`,
 * and that is the only way it could be done**: the contract is the package every
 * other one imports, so it cannot import from an app. A build before this one
 * stored these twelve names as the label colour, and converting a name to its hex
 * is the whole reason this table is here — the alternative is discarding every
 * colour that somebody chose.
 *
 * **The copy is a debt, and the test is what pays it.**
 * `apps/mobile/test/tag-colors.test.ts` runs all twelve through
 * `sanitiseTagColors` and against `iconColor`, so moving a colour in the app
 * without moving it here is a red test and not a silent recolour. The hexes are
 * the ones `iconColor` returned, which is the point: a label that was `"green"`
 * is painted exactly the green it was painted before.
 *
 * **Never read this one by indexing alone** — the lookup in `sanitiseTagColors`
 * asks `ITEM_ICON_COLORS` first, and there is a comment there saying why.
 */
const PALETA_A_HEX: Record<string, string> = {
  neutral: '#8A93A8',
  accent: '#6366F1',
  green: '#16A34A',
  olive: '#4D7C0F',
  amber: '#D97706',
  orange: '#EA580C',
  red: '#DC2626',
  rose: '#E11D48',
  purple: '#9333EA',
  blue: '#2563EB',
  teal: '#0D9488',
  brown: '#92400E',
};

/**
 * The colour a label gets when nobody has chosen one for it.
 *
 * A hash of the name, and that is the whole design: the colour is **obligatory**
 * and choosing it is **optional**, so the default case has to exist without
 * anybody deciding anything. The fallback is not a colour of its own — nothing in
 * this app is reserved for "nobody chose" — it is one of the twelve, drawn like
 * any other.
 *
 * **`neutral` is one of the twelve, so a name can derive grey.** The modulo lands
 * on it for roughly one name in twelve, and such a label then looks exactly like
 * one whose grey somebody chose on purpose. Accepted, not fixed: one more colour,
 * or a palette of its own that the icons do not share, costs more than the
 * coincidence is worth. The promise is that a name keeps its colour, not that its
 * colour says who chose it.
 *
 * FNV-1a, 32 bits, over the UTF-16 units of the name, modulo the palette length.
 * `Math.imul` keeps the multiply exact in 32 bits in every engine and
 * `charCodeAt` reads the same everywhere, so two phones and a server land on the
 * same colour for the same word. That is what makes it safe **not to store it**:
 * there is nothing to sync for the default case, and the labels that already
 * exist get a colour the moment this ships, with no backfill. The value is pinned
 * by a test in the app, because a hash that drifts is a silent change nobody can
 * see coming.
 *
 * **Case and accents are not folded.** `Pañales` and `panales` are two different
 * labels everywhere else in this app —the membership check is exact— so folding
 * them here would give two labels one colour, and choosing a colour for one would
 * silently recolour the other.
 *
 * **It keeps returning a name and not a hex, and that is deliberate.** Changing
 * the stored format to a free hex is not a reason to move the derived one: the
 * derived colour is one the app chose, and it is drawn out of the palette the app
 * has. Turning it into a hex here would move every derived label in every list of
 * everybody who already has one, which is the one thing nobody asked for.
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
 * A map of colours, with every colour turned into the one form the app speaks.
 *
 * On both sides of the wire, which is why it is here and not in either app: the
 * server runs it over a payload it has not validated, and the client runs it over
 * a cache row written by a build that may predate the field.
 *
 * **What comes out is always a hex, and there are two things that can get in.**
 * A hex written today, and a name of the twelve written by a build before the
 * label colour was free. The second is the reason this function exists rather than
 * a filter: dropping it would take the colour away from every label that has one,
 * **in silence and with no error anywhere**, because that is exactly what dropping
 * means. A format that is no longer accepted is an inconvenience; a colour somebody
 * picked is not.
 *
 * An entry that is dropped is **not** a failure. It means "no colour chosen",
 * which is a state the map already has — an absent key — so the label falls back
 * to `derivedTagColor`. Rejecting the whole write would lose every other label's
 * colour because of one bad key, and would punish whoever did not type that key.
 * Which is also why this can never be the thing that answers 422: what it returns
 * is always a map `tagColorSchema` accepts, and there is a test that says so with
 * the values that would otherwise be the ones that throw.
 */
export function sanitiseTagColors(value: unknown): TagColors {
  // Not an object, or an array, is no map: `{}`. Otherwise copy entry by entry,
  // skipping a key that is not 1-40 characters once trimmed, and a value that is
  // neither a hex nor one of the twelve names.
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const colores: TagColors = {};
  for (const [key, color] of Object.entries(value)) {
    const etiqueta = key.trim();
    if (etiqueta.length < 1 || etiqueta.length > 40) {
      continue;
    }
    const hex = normalizaColor(color);
    if (hex) {
      colores[etiqueta] = hex;
      continue;
    }
    // The name is trimmed like the key is: the value is free text from the wire
    // and `" green "` is the colour somebody chose, not a different one.
    //
    // **The membership test is `includes` and not the index**, because
    // `PALETA_A_HEX` is an object literal and `PALETA_A_HEX["constructor"]` is the
    // `Object` **function**: a colour written by somebody as the word "constructor"
    // would be stored as a function, and the map this returns has to be one
    // `tagColorSchema` accepts or the promise above is a lie. `ITEM_ICON_COLORS` is
    // the list that makes the lookup safe, and it is also the list that keeps this
    // table honest about which names exist at all.
    const nombre = typeof color === 'string' ? color.trim() : '';
    if (!(ITEM_ICON_COLORS as readonly string[]).includes(nombre)) {
      continue;
    }
    // The `!` is the same door `derivedTagColor` takes: the name is one of the
    // twelve and `PALETA_A_HEX` has an entry for each of the twelve.
    colores[etiqueta] = PALETA_A_HEX[nombre]!;
  }
  return colores;
}
