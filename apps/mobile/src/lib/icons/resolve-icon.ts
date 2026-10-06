import type { IconRef } from "@orbit-hub/contracts";
import { iconColorHex, type ColorSchemeName } from "@/theme/tokens";
import { vectorGlyph } from "@orbit-hub/contracts";

/**
 * What `AppIcon` draws, decided without React.
 *
 * A separate function and not logic inside the component because no test in
 * this repo renders a component: the stub `react-native` answers `Platform`
 * and a handful of modules, and `useTheme` throws outside a provider. So the
 * decisions live here, where they can be asked, and the component only draws
 * what this answers.
 */
export type ResolvedIcon =
  | { kind: "emoji"; text: string; color: string }
  | { kind: "vector"; glyph: string; color: string };

/**
 * The emoji inside the icon, or null when there is none.
 *
 * Only for the dashboard widgets: their settings are persisted with an
 * `emoji` field, and that shape does not change in this task. A vector icon
 * has no emoji behind it, so it comes out as null rather than as a key that
 * would be drawn as the word. Everything else reads the icon whole.
 */
export function iconEmoji(icon: IconRef | null | undefined): string | null {
  return icon?.type === "emoji" ? icon.value : null;
}
/**
 * The drawing for the icon, or null when there is no drawing.
 *
 * Null and never a guess: an icon this build cannot draw is not having an
 * icon, and the row around it still opens. The colour is resolved here and
 * never before — `auto` takes the colour of whatever the icon is on, and a
 * named token takes the hex of the scheme that is on.
 */
export function resolveAppIcon(
  icon: IconRef | null | undefined,
  scheme: ColorSchemeName,
  inheritColor?: string,
): ResolvedIcon | null {
  if (!icon) return null;

  const color =
    icon.color === "auto" ? (inheritColor ?? iconColorHex("auto", scheme)) : iconColorHex(icon.color, scheme);

  if (icon.type === "emoji") {
    return { kind: "emoji", text: icon.value, color };
  }

  const glyph = vectorGlyph(icon.value, icon.style);
  if (!glyph) return null;
  return { kind: "vector", glyph, color };
}
