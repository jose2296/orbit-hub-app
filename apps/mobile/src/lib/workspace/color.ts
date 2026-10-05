/**
 * Colours a person picks for their own spaces, and what can be read on them.
 *
 * A colour chosen for a space is also the background of its cards, so the text
 * on it has to be decided from the colour and not from the theme: a card with
 * dark text on a dark colour is a card nobody can read, and it is the person who
 * chose the colour who gets it wrong. So the reading colour is computed here and
 * the cards ask for it instead of assuming white or black.
 *
 * The colours are spaced far enough apart to tell apart at card size and light
 * enough that white text stays readable on all of them. A picker with fifty
 * shades is a picker nobody can choose from on a phone — and the custom colour is
 * what takes the pressure off this list, because it is unbounded.
 *
 * The stops themselves come from `./wash`, which is where the five styles live
 * and where the arithmetic that keeps a card readable in all of them lives. This
 * file decides *what a space is*; that one decides how it is painted.
 */

import { normalizaColor } from "@orbit-hub/contracts";

import type { WashVariant, WashShape } from "./wash";
import { DEFAULT_WASH, washOf } from "./wash";
import { hslToHex, rgbToHsl } from "./hsl";

/**
 * The eight colours, each one the middle of its own gradient.
 *
 * `hex` is the colour the person picked and it is what goes on the flat parts:
 * a dot, a border, a thin rule. `from` and `to` are the two ends of the wash the
 * card is painted with, and they are *not* picked separately — they are derived
 * from the same hue, so a space looks like itself whether it is a dot in the menu
 * or a whole card on the panel.
 *
 * Deriving them here rather than in a component is what keeps the two from
 * drifting: a dot that is the exact middle of the card beside it is what makes a
 * space recognisable, and that only holds if one function decides both.
 */
export const WORKSPACE_COLORS = [
  { key: "teal", hex: "#0F766E", from: "#0D9488", to: "#0B5F63" },
  { key: "indigo", hex: "#4338CA", from: "#4F46E5", to: "#3730A3" },
  { key: "rose", hex: "#BE123C", from: "#E11D48", to: "#9F1239" },
  { key: "amber", hex: "#B45309", from: "#D97706", to: "#92400E" },
  { key: "moss", hex: "#3F6212", from: "#4D7C0F", to: "#365314" },
  { key: "sky", hex: "#0369A1", from: "#0284C7", to: "#075985" },
  { key: "violet", hex: "#7E22CE", from: "#9333EA", to: "#6B21A8" },
  { key: "slate", hex: "#334155", from: "#475569", to: "#1E293B" },
  // The four that were missing, not at random: a person choosing a colour for
  // their own space looks for the one they are picturing, and "is the purple
  // one there?" has to have a yes. These four are the gaps between the eight:
  // a pink that is not a red, a red that is not pink, a green that is not moss,
  // and a brown that is not amber.
  { key: "plum", hex: "#7E22A8", from: "#9333C4", to: "#5B167D" },
  { key: "crimson", hex: "#B91C1C", from: "#DC2626", to: "#7F1D1D" },
  { key: "forest", hex: "#166534", from: "#15803D", to: "#0B3D21" },
  { key: "copper", hex: "#9A3412", from: "#C2410C", to: "#5A1D09" },
] as const;

export type WorkspaceColorKey = (typeof WORKSPACE_COLORS)[number]["key"];

export const DEFAULT_WORKSPACE_COLOR: WorkspaceColorKey = "slate";

/**
 * Turns a colour a person typed into the two ends of its own wash.
 *
 * A named colour comes with its gradient already decided, because somebody chose
 * the two ends. A custom colour does not, and there are two wrong ways to fill
 * that in: paint it flat, and the space looks like a different kind of space from
 * every other one; or lighten and darken by a fixed step, and a colour that was
 * already near white loses its gradient entirely.
 *
 * So the steps are **relative and bounded**: the top end goes a little lighter
 * and the bottom a little darker, and neither is allowed past a floor and a
 * ceiling. That keeps a near-white custom colour from washing out and a
 * near-black one from going to nothing, and it keeps the saturation untouched —
 * a gradient between two colours of different saturation is a different colour,
 * not a lighter version of the one that was picked.
 *
 * The hue does not move at all. Rotating it would be showing the person a colour
 * they did not choose, in the one place where the whole point is that they did.
 */
function washOfCustom(hex: string): { hex: string; from: string; to: string } {
  const h = rgbToHsl(hex);

  return {
    hex: hslToHex(h.h, h.s, h.l),
    from: hslToHex(h.h, h.s, Math.min(Math.max(h.l + 0.09, 0.22), 0.7)),
    to: hslToHex(h.h, h.s, Math.max(Math.min(h.l - 0.11, 0.88), 0.12)),
  };
}

/** The whole palette entry, so a space is one lookup wherever it is drawn. */
function entryOf(key: string | null | undefined) {
  const named = WORKSPACE_COLORS.find((color) => color.key === key);
  if (named) return named;

  // A custom colour is a wash nobody picked by hand, derived once here and then
  // treated exactly like a named one everywhere else, so nothing downstream has
  // to learn that custom colours exist.
  const custom = normaliseCustom(key);
  if (custom) return custom;

  return WORKSPACE_COLORS.find(
    (color) => color.key === DEFAULT_WORKSPACE_COLOR,
  )!;
}

/**
 * A `#RRGGBB` the app can draw, or `null`.
 *
 * **The regex that used to be here is gone, and its justification with it.** It was
 * `/^#[0-9a-fA-F]{6}$/`, written out again under a comment that said the shape was
 * the one the contract accepts "on purpose" and that "one shape, written twice, is
 * the price of the app not importing the validator at runtime". **That premise was
 * false**: `apps/mobile` has imported `normalizaColor` from `@orbit-hub/contracts`
 * for a while —`lib/lists/tag-colors.ts` calls it in three places— so there was no
 * price to pay and the copy bought nothing. It was one of the seven hex rules in
 * this repository, and one of the five that only took six digits, so a `#abc`
 * reached this function as a perfectly good colour and came back `slate`.
 *
 * So it asks `normalizaColor` and gets the canonical form with it, which is also
 * what `washOfCustom` wants: `#abc` is now `#AABBCC`, and the three-digit colour a
 * person typed in the picker field is the colour the space is painted with.
 */
function normaliseCustom(value: string | null | undefined): {
  hex: string;
  from: string;
  to: string;
} | null {
  const hex = normalizaColor(value);
  if (hex === null) return null;
  return washOfCustom(hex);
}

/** The colour of a space, or the default one when it has none. */
export function colorOf(key: string | null | undefined): string {
  return entryOf(key).hex;
}

/**
 * The two ends of the wash a space is painted with.
 *
 * Diagonal, top left to bottom right, because a gradient with no direction reads
 * as a slightly different flat colour and a person who chose the colour would
 * not recognise it. The card falls back to its own `hex` underneath, so a frame
 * that is drawn before the gradient is ready is the right colour and not white.
 */
export function gradientOf(key: string | null | undefined): [string, string] {
  const entry = entryOf(key);
  return [entry.from, entry.to];
}

/** Whether a value is one of the colours the app offers. */
export function isWorkspaceColor(value: unknown): value is WorkspaceColorKey {
  return (
    typeof value === "string" &&
    WORKSPACE_COLORS.some((color) => color.key === value)
  );
}

/**
 * Whether a colour is dark enough that light text reads better on it.
 *
 * The usual formula, and the threshold is where white and black are equally
 * readable. It is only ever asked about a colour this app offered, so it is
 * never asked about something nobody chose.
 */
export function isDark(hex: string): boolean {
  const value = hex.replace("#", "");
  if (value.length !== 6) return false;
  const red = parseInt(value.slice(0, 2), 16) / 255;
  const green = parseInt(value.slice(2, 4), 16) / 255;
  const blue = parseInt(value.slice(4, 6), 16) / 255;

  const linear = (channel: number) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  const luminance =
    0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);

  return luminance < 0.4;
}

/**
 * Everything a card of a space needs to be drawn, from its colour key.
 *
 * One call, and not `colorOf` plus `gradientOf` plus a guess at whether the text
 * has to be light: the three are the same decision. A component that worked them
 * out separately is a component where the flat colour and the gradient can end up
 * being two different spaces, and the text on one of them is unreadable.
 */
export function spacePaint(
  key: string | null | undefined,
  variant: WashVariant = DEFAULT_WASH,
  /**
   * The colour the wash ends in, or `null` when it has not been chosen.
   *
   * Third and not second, on purpose: the variant is almost never passed by a
   * caller that has a `Workspace` to hand, and a signature where the second
   * argument is the rare one is a signature where people get the order wrong.
   */
  keyHasta?: string | null,
): {
  /** The flat colour, for a dot, a rule, a border, a fallback under a wash. */
  color: string;
  /** The two ends of the wash, for the callers that only draw two colours. */
  gradient: [string, string];
  /**
   * How the wash is drawn, and every stop of it.
   *
   * Here and not something the renderer works out: a renderer that recomputed
   * the stops would have to re-derive the luminance matching, and the version
   * that forgets is the version that puts pale yellow under white text.
   */
  shape: WashShape;
  stops: [string, string] | [string, string, string];
  /** Text and icons on top of the wash. */
  foreground: string;
  /** A step back from the text, for counts and hints. */
  muted: string;
  /** The ring around the card. */
  border: string;
  /** The wash at low opacity, for a tile or a header band on the page. */
  wash: string;
  /** Whether the wash is dark, which is what text colour depends on. */
  dark: boolean;
} {
  const entry = entryOf(key);

  /**
   * A named colour on the diagonal keeps the two ends somebody chose by hand.
   *
   * Every other case is derived. The reason for the exception is that those two
   * ends were picked — `#0D9488` to `#0B5F63` reads better than anything the
   * maths produces from `#0F766E` — and throwing them away to make the code
   * simpler would make the app worse in the one style most people will be on.
   */
  const nombrado = WORKSPACE_COLORS.some((color) => color.key === key);

  /**
   * A named colour, on the diagonal, with no second colour chosen: it keeps the
   * two ends somebody picked by hand.
   *
   * `#0D9488` into `#0B5F63` reads better than anything the maths produces out of
   * `#0F766E`, and throwing that away to make the code simpler would make the app
   * worse in the state most spaces are in. The moment a second colour **is**
   * chosen, that choice wins and the hand-picked pair is not involved.
   */
  const sinSegundoElegido = keyHasta === null || keyHasta === undefined;
  const wash =
    variant === "diagonal" && nombrado && sinSegundoElegido
      ? {
          variant: "diagonal" as const,
          shape: "diagonal" as const,
          stops: [entry.from, entry.to] as [string, string],
          dark: isDark(entry.from) || isDark(entry.to),
        }
      : washOf(entry.hex, keyHasta === null || keyHasta === undefined ? null : colorOf(keyHasta), variant);

  const { dark } = wash;

  return {
    color: entry.hex,
    gradient: [wash.stops[0], wash.stops[1]],
    shape: wash.shape,
    stops: wash.stops,
    foreground: dark ? "#FFFFFF" : "#0B1120",
    muted: dark ? "rgba(255,255,255,0.76)" : "rgba(11,17,32,0.68)",
    border: dark ? "rgba(255,255,255,0.24)" : "rgba(11,17,32,0.16)",
    wash: alphaOf(entry.hex, dark ? 0.22 : 0.16),
    dark,
  };
}

/**
 * The old flat-card helper, kept for the places that paint a solid block.
 *
 * It reads its argument as a raw hex rather than a space key, because that is
 * what the picker and the invitation preview hand it. Anything that knows which
 * *space* it is painting should use `spacePaint` instead and get the gradient.
 */
export function cardColors(hex: string): {
  background: string;
  foreground: string;
  border: string;
  muted: string;
} {
  const dark = isDark(hex);
  return {
    background: hex,
    foreground: dark ? "#FFFFFF" : "#0B1120",
    border: dark ? "rgba(255,255,255,0.22)" : "rgba(11,17,32,0.16)",
    // A second step back from the text, for the counts and the hints, and not a
    // grey that disappears on a coloured card.
    muted: dark ? "rgba(255,255,255,0.72)" : "rgba(11,17,32,0.68)",
  };
}

/**
 * One flat, translucent step of a space's colour.
 *
 * For the rows *inside* a space, where the wash is too much. A gradient behind
 * every folder and every list was the space's colour at full strength, repeated
 * down the screen: the first time it said "this is Cine", and the eighth time it
 * said nothing at all, because a screen of eight identical gradients is a pattern
 * rather than a label. And a gradient behind small text is harder to read than a
 * flat one, whichever of the two ends is darker.
 *
 * A tint rather than the theme's own surface, so the space is still the thing
 * that identifies the rows — flat, constant, and the same on every row. That is
 * the difference the wash was making and the only part of it worth keeping at
 * this size: the colour is a label, not a decoration.
 *
 * The end colour is ignored on purpose. A row is a row, and the gradient is
 * where the pair of colours is something to look at.
 */
export function spaceTint(
  key: string | null | undefined,
  alpha = 0.14,
): string {
  return alphaOf(colorOf(key), alpha);
}

/** `#RRGGBB` plus an alpha, as an eight digit hex colour. */
function alphaOf(hex: string, alpha: number): string {
  const channel = Math.round(Math.min(Math.max(alpha, 0), 1) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${channel}`;
}

// Las conversiones viven en `./hsl` para que este fichero y `wash.ts` no se
// importen entre si. Se reexportan aqui porque casi todo el mundo que pintaba
// un espacio venia por aqui.
export { rgbToHsl, hslToHex } from "./hsl";
