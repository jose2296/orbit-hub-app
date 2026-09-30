/**
 * The two ways a space's colour is painted, from the two colours the person chose.
 *
 * ## What is here and what is not
 *
 * **Two styles, and there were five.** The complementary and the triadic rotated
 * the hue. In use they were not bold, they were bad: a triadic on a mid-blue is
 * three colours that do not look like a space of that blue, and the whole point
 * of a space's colour is that you recognise it. The split was a hard edge down
 * the middle of a card. The two that are left are the same two colours drawn in
 * two directions, which is honestly two and not five.
 *
 * ## The two colours
 *
 * `colorTo` is chosen like `color`: from the same twelve, or as a hex. **And it
 * is a real second field and not a "how much darker" step**, because a lightness
 * slider can only ever make the second end a version of the first, and the pairs
 * worth having are not versions of each other. A teal into a deep indigo is a
 * card that looks like something; a teal into a darker teal is a teal.
 *
 * When the second one has not been chosen, it is derived — the base colour a
 * little darker — so a space is never unpainted, and never lies about having been
 * configured.
 *
 * ## The diagonal, and why it looked horizontal
 *
 * A CSS gradient angle is measured against the **box**, not the screen, and from
 * **"up"** — `0deg` points at the ceiling. Both facts are load-bearing and the
 * first version of this got both wrong. A fixed `45` across a band 398 wide by 127
 * tall measured a vertical travel of **5 units**: a line with a slight slope,
 * which is exactly why it looked broken.
 *
 * The angle a corner-to-corner line actually makes is `atan2(width, height)`,
 * because the degrees run from up and grow towards right. That is about 76° on
 * that band and 45° on a square. The other order gives 12° — a gradient pointing
 * at the ceiling, and a measured vertical travel of **zero**.
 *
 * The box has to be measured rather than guessed, so the renderer passes the one
 * `onLayout` reported.
 */

import { WORKSPACE_WASHES } from "@orbit-hub/contracts";
import type { WorkspaceWash } from "@orbit-hub/contracts";

import { hslToHex, rgbToHsl } from "./hsl";

/**
 * The names come from the contract and are not written out here.
 *
 * The server has to know which ones exist — it refuses the rest — and a second
 * list in the app is a list that will be one name short the day somebody adds a
 * third. A re-export does not bring a name into this file's scope, so this is an
 * alias and not `export type { ... } from`.
 */
export const WASH_VARIANTS = WORKSPACE_WASHES;
type WashVariant = WorkspaceWash;
export type { WashVariant };

/** How the stops are laid out. The same thing as the variant, and kept anyway. */
export type WashShape = "diagonal" | "vertical";

export const DEFAULT_WASH: WashVariant = "diagonal";

/**
 * How much of a space's colour a wash is **allowed to show**.
 *
 * **One number for the whole app, and the reason is the seam.** The wash appears
 * in two places — the bar of the header and the background of the panel — and they
 * touch. Two places that each mute their own amount put a step of saturation right
 * where the eye is already looking for a change of screen, and a step reads as a
 * mistake even when nobody can say what it is.
 *
 * **Why under half at all.** A bar is a place where text and a function are drawn,
 * not a poster: measured, a full-strength wash looked right on a teal space and
 * like a warning on a red one, with the same component painting both. The shape of
 * the wash is what says which space you are in, so that stays; the intensity is
 * not information, so it goes.
 */
export const VELO = 0.45;

/**
 * The three heights of a space's wash on a screen, in one place.
 *
 * **They are one number, and that is the whole point.** The wash is painted by
 * two boxes in two different trees — the header's bar and the band behind the
 * content — and if each box draws its own gradient they will not agree: the
 * diagonal angle is computed from the box's own size, so a 56-tall bar and a
 * 100-tall band get 82° and 76°, and each runs the whole first-colour-to-
 * second-colour range over its own height, so the bar arrives at the final colour
 * at its bottom edge and the band starts again at the first one. Measured: a line
 * across the middle of the gradient, exactly on the join.
 *
 * So both boxes are given the height of the **whole** wash and are clipped to
 * their own piece of it. One gradient, cut in two, and a cut that cannot show
 * because there is nothing to cut.
 *
 * `ALTO_CABECERA` is the bar, which is 56 on every screen; `SOBRO_BANDA` is how
 * far the colour reaches below it; and the sum is what both boxes are measured
 * against.
 */
export const ALTO_CABECERA = 56;

/** How far the wash reaches **below** the bar before it is gone. */
export const SOBRO_BANDA = 100;

export const ALTO_LAVADO = ALTO_CABECERA + SOBRO_BANDA;

export function isWashVariant(value: unknown): value is WashVariant {
  return (
    typeof value === "string" &&
    (WORKSPACE_WASHES as readonly string[]).includes(value)
  );
}

/* ------------------------------------------------------------- the angles -- */

/**
 * The CSS angle that runs a gradient corner to corner in a box of this size.
 *
 * **`atan2(width, height)`, and the order is the whole thing.** A CSS gradient
 * angle is measured **from "up"**, and it grows towards "right": `0deg` is to the
 * top, `90deg` to the right, `180deg` to the bottom. So for a corner-to-corner run
 * the angle is the *horizontal* extent over the *vertical* one. Passing them the
 * other way round gives `atan2(height, width)`, which on a band three times wider
 * than it is tall is 12° — and a gradient at 12° points at the ceiling. Measured:
 * a "diagonal" band with a vertical travel of **0 pixels**, which is a horizontal
 * line with a name on it.
 *
 * A note on what this can and cannot do: on a box four times wider than it is
 * tall, a true corner-to-corner line *is* nearly horizontal. That is the geometry,
 * not a bug, and the fix is not to fake a steeper one — a fake angle would be
 * pointing at a corner that is not there. This returns the real diagonal of the
 * box, which is visible on anything that is not a very long strip, and on a strip
 * the two directions are genuinely close to each other.
 */
export function anguloDiagonal(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 45;
  return (Math.atan2(width, height) * 180) / Math.PI;
}

/* --------------------------------------------------------- the arithmetic -- */

/** The WCAG relative luminance of a colour, 0 (black) to 1 (white). */
export function luminanceDe(hex: string): number {
  const value = hex.replace("#", "");
  const channel = (start: number) => {
    const c = parseInt(value.slice(start, start + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/**
 * The lightness at which this hue and saturation read at a given brightness.
 *
 * Bisection, and not the closed form, on purpose: the closed form is a piece of
 * maths nobody can check by eye and it divides by zero when the saturation is 0,
 * which is exactly what a grey space is. This is eighteen steps of "is it
 * brighter or darker than the target", which is monotone and so cannot
 * oscillate.
 *
 * A target no lightness can reach is clamped to the closest end rather than
 * returning a NaN that paints a space black.
 */
export function lightnessPara(h: number, s: number, objetivo: number): number {
  const brillo = Math.min(Math.max(Number.isFinite(objetivo) ? objetivo : 0, 0), 1);

  let bajo = 0;
  let alto = 1;
  for (let i = 0; i < 18; i += 1) {
    const medio = (bajo + alto) / 2;
    if (luminanceDe(hslToHex(h, s, medio)) < brillo) bajo = medio;
    else alto = medio;
  }

  return (bajo + alto) / 2;
}

/* ------------------------------------------------------------ the washes -- */

/**
 * A target luminance for the derived second end, with a floor on how dark it may
 * get.
 *
 * Solving for `luminance - 0.08` on a colour that is already almost black lands
 * on zero, and the wash comes out black into black: a gradient with no gradient in
 * it, which is the same failure as a flat colour with a different cause. A fifth
 * of the way to zero is the floor — enough that a near-black space still has two
 * ends you can tell apart, and low enough that it is still the same colour.
 *
 * **A function and not a `const` arrow**, because a module-level `const` is
 * assigned in source order: using one above its own declaration is a
 * `ReferenceError` the moment the module is imported, not a type error you find
 * later. It cost fourteen tests once, all of them red for the same single line.
 */
function conSuelo(brillo: number): number {
  return Math.max(brillo - 0.08, brillo * 0.8, 0.02);
}

export interface Wash {
  variant: WashVariant;
  shape: WashShape;
  /** Always two, in the order they are painted. */
  stops: [string, string];
  /** Whether the text on this wash has to be light. */
  dark: boolean;
}

/**
 * The wash for two colours and a direction.
 *
 * One function for both styles, because two functions that each do their own
 * thing is two chances for the two directions to end up not matching, and a space
 * that is diagonal on one card and vertical on the next is not a space.
 *
 * `hexHasta` null means the person has not chosen a second colour, and the wash
 * is the base into a slightly darker version of itself — the same pair the
 * palette has always drawn.
 */
export function washOf(
  hexDesde: string,
  hexHasta: string | null | undefined,
  variant: WashVariant,
): Wash {
  const desde = rgbToHsl(hexDesde);

  /**
   * The second end, in HSL.
   *
   * A chosen colour is used as it is — the person said so, and re-lighting
   * somebody's second colour would be telling them they chose a different one.
   * A derived one is solved to sit a step below the first, which is the pair the
   * app has always drawn, so a space nobody configured still looks like a space.
   */
  const hasta = hexHasta
    ? rgbToHsl(hexHasta)
    : (() => {
        const base = hslToHex(desde.h, desde.s, desde.l);
        return rgbToHsl(
          hslToHex(desde.h, desde.s, lightnessPara(desde.h, desde.s, conSuelo(luminanceDe(base)))),
        );
      })();

  const stops: [string, string] = [
    hslToHex(desde.h, desde.s, desde.l),
    hslToHex(hasta.h, hasta.s, hasta.l),
  ];

  // The text colour is decided by the **lighter** of the two ends, because that is
  // the worst case for white text. Deciding from the darker one is the version
  // that passes every test and then puts white on a pale yellow in somebody's
  // space: the two ends can disagree, and the one that is light is the one you
  // can see most of.
  const masClaro = luminanceDe(stops[0]) >= luminanceDe(stops[1]) ? stops[0] : stops[1];

  return {
    variant,
    shape: variant === "vertical" ? "vertical" : "diagonal",
    stops,
    dark: luminanceDe(masClaro) < 0.4,
  };
}
