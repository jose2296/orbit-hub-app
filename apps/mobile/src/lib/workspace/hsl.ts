/**
 * The two colour spaces the workspace colours work in, and the conversions
 * between them and hex.
 *
 * **Its own file because of a cycle, not for tidiness.** `color.ts` asks
 * `wash.ts` for the stops, and `wash.ts` needs these conversions. With the
 * conversions living in `color.ts` the two import each other, and Metro printed a
 * `Require cycle` warning on every single load of the app. The fix is the
 * obvious shape — the arithmetic neither of them owns goes in a third file — and
 * it is worth saying out loud that the cycle was *visible in the console* the
 * whole time and I did not look at the console until something else made me.
 *
 * HSL and HSV, both, because they are not the same thing and mixing them up
 * quietly:
 *
 * - **HSL** moves lightness at a fixed saturation, which is what a *card* wants:
 *   a wash made this way keeps the colour looking like itself.
 * - **HSV** moves value, which is what a *picker* wants: dragging up and down
 *   goes from the hue at full strength to black through every version of it, and
 *   the middle of the drag is the same hue rather than a different one.
 *
 * One import from the contract, and it is a regex and not a validator: this file
 * only has to answer yes or no about a string, and `TAG_HEX` —which sits beside
 * `normalizaColor`, the function that decides what a colour is for the whole
 * repository— is that answer. `packages/contracts` cannot import from here, so the
 * arrow points one way and there is no cycle.
 */

import { TAG_HEX } from "@orbit-hub/contracts";

export interface Hsl {
  /** Degrees, 0–360. */
  h: number;
  /** 0–1. */
  s: number;
  /** 0–1. */
  l: number;
}

export interface Hsv {
  /** Degrees, 0–360. */
  h: number;
  /** 0–1. */
  s: number;
  /** 0–1. */
  v: number;
}

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);

/** What a conversion falls back to when it is handed something that is not a colour. */
export const COLOR_QUE_NO_ES = "#334155";

/**
 * Whether this string is something the conversions below can read.
 *
 * **Three or six digits, and the three is the point.** A guard written as
 * `^#?[0-9A-Fa-f]{6}$` rejects `#fff`, which is a perfectly good white that the
 * field in the colour picker accepts, so the guard turned a working path into the
 * fallback and two tests caught it in one run.
 *
 * **The regex is `TAG_HEX` and not a second copy of it.** This file is the second
 * place in the repository that asked "is this a colour?", and the sixth counting
 * backwards from the server: six others had their own answer, they did not agree
 * with each other about `#` or about case, and the same `#fff` was valid in the
 * label picker and invalid in the space picker. `TAG_HEX` is the owner's —it sits
 * next to `normalizaColor`, in `packages/contracts`, and it is what the server
 * applies to whatever it is about to store—so asking it is the whole fix and it
 * cannot drift. The `trim` stays here because the callers of this file pass
 * whatever came out of storage, and the owner trims too.
 */
export function esHex(hex: unknown): hex is string {
  return typeof hex === "string" && TAG_HEX.test(hex.trim());
}

/**
 * `#RRGGBB`, and the default when the input is not one.
 *
 * **This guard is the reason the app does not paint itself silently wrong.** The
 * first version expanded a three-digit hex and then did `parseInt` on whatever was
 * there, so a palette *key* handed to it by mistake — `"sky"` — expanded to
 * `"sksksk"`, parsed to `NaN`, and came out of `hslToHex` as the string
 * `"#NANNANNAN"`. A gradient with that in it is rejected by the CSS parser, so the
 * element silently kept whatever gradient it had painted the first time it was
 * valid and every one of them showed the wrong colours with no error anywhere.
 *
 * One unresolvable colour took the whole screen with it, and the only sign was a
 * `background-image` that did not match the style next to it.
 *
 * **This is also why the guard in `hslToHex` was latent and not live.** Every path
 * into that function comes through here, and everything that is not three or six
 * hexadecimal digits is already `COLOR_QUE_NO_ES` before a single subtraction
 * happens, so `rgbToHsl` cannot hand it a lightness that is not finite. Measured:
 * `"sky"`, `""`, `"#1234567"`, `"rgb(1,2,3)"`, `"#NANNANNAN"`, `"toString"` and
 * `"#12"` all come back finite. The guard was in the wrong place regardless of
 * that, and `hslToHex` is exported from `picker.ts` and again from `color.ts`, so
 * the next caller that passes it a computed lightness is the one that would have
 * hit it.
 */
function aHex(hex: string): string {
  const limpio = hex.trim();
  if (!esHex(limpio)) return COLOR_QUE_NO_ES;
  return limpio.startsWith("#") ? limpio.toUpperCase() : `#${limpio.toUpperCase()}`;
}

/** Expands `#abc` to `#aabbcc`, so a three-digit field is not a different thing. */
function seisDigitos(hex: string): string {
  const value = hex.replace("#", "");
  return value.length === 3
    ? value
        .split("")
        .map((c) => c + c)
        .join("")
    : value;
}

export function rgbToHsl(hex: string): Hsl {
  const value = seisDigitos(aHex(hex));
  const red = parseInt(value.slice(0, 2), 16) / 255;
  const green = parseInt(value.slice(2, 4), 16) / 255;
  const blue = parseInt(value.slice(4, 6), 16) / 255;

  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const l = (max + min) / 2;

  // A grey has no hue to speak of and the formula divides by zero. 0 is as good as
  // any: the result is grey whatever hue it starts from.
  if (delta === 0) return { h: 0, s: 0, l };

  const s = delta / (1 - Math.abs(2 * l - 1));

  let h: number;
  if (max === red) h = ((green - blue) / delta) % 6;
  else if (max === green) h = (blue - red) / delta + 2;
  else h = (red - green) / delta + 4;

  h *= 60;
  if (h < 0) h += 360;

  return { h, s, l };
}

export function hslToHex(h: number, s: number, l: number): string {
  // **A number that is not finite becomes `0`, and each of the three has a reason
  // of its own.** `l` is the black that `hslToHex(h, s, 0)` already returns, which
  // is a tested extreme. `h` is the hue `rgbToHsl` hands a grey, whose own comment
  // says 0 is as good as any. `s` is the grey of that lightness, and it is the
  // shape `mixHex` already uses on its `t`: `Number.isFinite(t) ? clamp01(t) : 0`.
  //
  // **And a number that IS finite but is out of range gets clipped, which is the
  // other half of the same door and the reason the two are one line.** The
  // `isFinite` guard above is invisible from the outside: `NaN` and `Infinity` only
  // ever arrive from a division by zero or from an overflow, and nothing in this
  // app does either. What *does* arrive is a lightness that walked off the end, and
  // that needs no bug at all — `l = 2` is a perfectly finite number. With only the
  // old guard, `s = 5` came out as `#2FD-1FE-1FE` — the first channel rounds past
  // `FF` and needs three hexadecimal digits, and the other two go negative, where
  // `toString(16)` writes the minus sign into the hex — and `l = 2` came out as
  // `#FF2FD2FD`, because a `m` that far past 1 lands the last two channels on `3`,
  // which is 765 of 255, and the only real digit left is the `FF` at the front.
  //
  // **The same failure the guard on the sum was written for, reached by the other
  // road.** Neither string is a colour any CSS parser reads, so a gradient with one
  // of them in it is rejected whole and the element keeps the colours it painted
  // the first time they were valid — no error, anywhere, ever.
  //
  // **"Nobody calls it out of range" is a claim about today's callers, not a
  // promise the function makes.** `hslToHex` is exported from `picker.ts` and again
  // from `color.ts`, so the next caller that computes a lightness is the one that
  // would have paid. `mixHex` reached the same conclusion about its `t` and pays
  // the same price: one call.
  const h0 = Number.isFinite(h) ? h : 0;
  const s0 = Number.isFinite(s) ? clamp01(s) : 0;
  const l0 = Number.isFinite(l) ? clamp01(l) : 0;

  const c = (1 - Math.abs(2 * l0 - 1)) * s0;
  const hp = (((h0 % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));

  const [r, g, b] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];

  const m = l0 - c / 2;
  // **The guard is on the sum, and not on the channel, which is the whole fix.**
  // `m` is *added* to the channel, so a lightness that is not finite poisons the
  // total even when the channel is perfectly finite: the guard used to sit around
  // the one operand that could not do the damage.
  //
  // What it is for is `Math.round` handing `NaN` to `toString(16)`. That answers
  // with the three-character string `"NaN"`, which `padStart(2, "0")` cannot
  // shorten, so three of them make `#NANNANNAN` — ten characters, nine of them
  // digits where a `#RRGGBB` has six, and not one of them a hexadecimal digit, so
  // no CSS parser reads it and the element keeps whatever it painted before.
  //
  // **Both, and not one.** The three `Number.isFinite` above say what a parameter
  // that is not a number means; this one is the belt underneath them, and it also
  // catches parameters that are finite but overflow on the way — `l` around
  // `1e308` makes `2 * l` an `Infinity` before anything is even rounded.
  //
  // **Latent, not live, and wrong anyway.** `aHex` above refuses anything that is
  // not a hex, so `rgbToHsl` never produces a lightness that is not finite and
  // nothing in the app reaches the bad arithmetic. It was the wrong operand
  // regardless, and this function is exported, so the guard belongs where the sum
  // is built.
  const channel = (value: number) => {
    const total = value + m;
    return Math.round((Number.isFinite(total) ? total : 0) * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  };

  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function hexToHsv(hex: string): Hsv {
  const value = seisDigitos(aHex(hex));
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  // A grey has no hue, and picking one out of the air is fine: the result is grey
  // whatever hue it starts from, and it only decides where the strip's marker
  // sits on a colour that is not a colour yet.
  if (delta === 0) return { h: 0, s: 0, v: max };

  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;

  h *= 60;
  if (h < 0) h += 360;

  return { h, s: delta / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = v - c;

  const [r, g, b] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];

  const channel = (value: number) =>
    Math.round(((Number.isFinite(value) ? value : 0) + m) * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();

  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** The six hues a strip is made of, plus the first one again to close the loop. */
export const HUE_STRIP = [
  "#FF0000",
  "#FFFF00",
  "#00FF00",
  "#00FFFF",
  "#0000FF",
  "#FF00FF",
  "#FF0000",
] as const;

export { clamp01 };
