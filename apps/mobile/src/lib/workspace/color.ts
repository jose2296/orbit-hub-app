/**
 * Colours a person picks for their own spaces, and what can be read on them.
 *
 * A colour chosen for a space is also the background of its cards, so the text
 * on it has to be decided from the colour and not from the theme: a card with
 * dark text on a dark colour is a card nobody can read, and it is the person who
 * chose the colour who gets it wrong. So the reading colour is computed here and
 * the cards ask for it instead of assuming white or black.
 *
 * The eight colours are spaced far enough apart to tell apart at card size and
 * light enough that white text stays readable on all of them. A picker with
 * fifty shades is a picker nobody can choose from on a phone.
 */

export const WORKSPACE_COLORS = [
  { key: "teal", hex: "#0F766E" },
  { key: "indigo", hex: "#4338CA" },
  { key: "rose", hex: "#BE123C" },
  { key: "amber", hex: "#B45309" },
  { key: "moss", hex: "#3F6212" },
  { key: "sky", hex: "#0369A1" },
  { key: "violet", hex: "#7E22CE" },
  { key: "slate", hex: "#334155" },
] as const;

export type WorkspaceColorKey = (typeof WORKSPACE_COLORS)[number]["key"];

export const DEFAULT_WORKSPACE_COLOR: WorkspaceColorKey = "slate";

/** The colour of a space, or the default one when it has none. */
export function colorOf(key: string | null | undefined): string {
  return (
    WORKSPACE_COLORS.find((color) => color.key === key)?.hex ??
    colorOf(DEFAULT_WORKSPACE_COLOR)
  );
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
 * The two colours a card of this space is painted with.
 *
 * The text is white or black depending on the colour, and the soft tone is the
 * same colour at a fifth over the page, so a card and its own background do not
 * have to be mixed in a component.
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
