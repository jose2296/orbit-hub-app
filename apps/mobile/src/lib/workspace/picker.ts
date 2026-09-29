/**
 * The arithmetic a colour picker drags against.
 *
 * The conversions themselves live in `./hsl`, shared with the wash, so neither of
 * those two files has to import the other. What is here is what only a *pointer*
 * needs: turning where a finger landed into a colour, and back.
 *
 * Clamping on purpose: a drag that runs past the edge of the square should pin
 * the marker to the edge, not wrap round to the far side. And the two axes are
 * not the same thing — the box is wider than it is tall on a phone, so the same
 * number of pixels is not the same share of the range. Dividing by the measured
 * size is what puts the marker where the finger is.
 */

import { clamp01 } from "./hsl";
import type { Hsv } from "./hsl";


export { HUE_STRIP } from "./hsl";

/**
 * Re-exported, because the picker is where somebody goes to use them and they do
 * not care that the arithmetic lives next door. A first version of this file
 * only exported the two pointer functions and every caller ended up with a second
 * import line from `hsl`, and one of them got it wrong.
 */
export { hexToHsv, hsvToHex, hslToHex, rgbToHsl, esHex, COLOR_QUE_NO_ES } from "./hsl";
export type { Hsv } from "./hsl";

/** Where the marker sits, from a point touched inside a box of this hue. */
export function puntoAHsv(
  x: number,
  y: number,
  width: number,
  height: number,
  hue: number,
): Hsv {
  const s = width > 0 ? clamp01(x / width) : 0;
  const v = height > 0 ? clamp01(1 - y / height) : 0;
  return { h: hue, s, v };
}

/** The fraction along the hue strip, as degrees, for a touch at `x` in `width`. */
export function puntoAHue(x: number, width: number): number {
  if (width <= 0) return 0;
  return clamp01(x / width) * 360;
}
