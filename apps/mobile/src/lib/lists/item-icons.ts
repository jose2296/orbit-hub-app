import { ITEM_ICON_COLORS, ITEM_ICON_GROUP, ITEM_ICONS, isItemIcon } from "@orbit-hub/contracts";

import type { TranslationKey } from "@/lib/i18n";

import { ITEM_GLYPHS, outlineOf } from "./item-glyphs";
import type { ItemIcon, ItemIconCategory } from "@orbit-hub/contracts";

/**
 * The name of an icon, in words.
 *
 * The key *is* the word a person would use — "pan", "pilas", "zapatillas" — and
 * that is the same word they type in the search. So the label is the key with a
 * capital letter and the underscores turned into spaces, and only the words that
 * are wrong on their own need a dictionary entry.
 *
 * A hundred and thirty entries of "Pan" in a file that has to be translated
 * twice is a hundred and thirty chances to mistype one, and a mistyped label is
 * an icon nobody finds because nobody can spell what they see.
 */
const OVERRIDES: Partial<Record<ItemIcon, string>> = {
  comida_bebe: "Comida de bebé",
  leche_materna: "Leche materna",
  ropa_interior: "Ropa interior",
  pasta_dientes: "Pasta de dientes",
  bombilla_led: "Bombilla LED",
  bateria_coche: "Batería de coche",
  comida_perro: "Comida de perro",
};

/** What an icon is called, in the language of the app. */
export function iconLabel(icon: ItemIcon): string {
  const override = OVERRIDES[icon];
  if (override) return override;
  const words = icon.split("_");
  const first = words[0] ?? icon;
  return first.charAt(0).toUpperCase() + first.slice(1) + (words.length > 1 ? ` ${words.slice(1).join(" ")}` : "");
}

/** Everything the app knows about one icon, for a row and for the picker. */
export function iconInfo(icon: ItemIcon) {
  return { icon, label: iconLabel(icon), group: ITEM_ICON_GROUP[icon] };
}

/** The icons of one group, in the order the picker shows them. */
export function iconsOf(category: ItemIconCategory): ItemIcon[] {
  return ITEM_ICONS.filter((icon) => ITEM_ICON_GROUP[icon] === category);
}

/**
 * Finding an icon by typing.
 *
 * Three things make it find the thing instead of the letter: the accents are
 * ignored, because nobody types the accent on a phone keyboard, and the words are
 * matched on their beginning, which is what somebody does when they have
 * forgotten the word and are describing it. `pasti` finds `pastilla`.
 *
 * Scored rather than filtered, because "pan" is a prefix of "pantalón" and
 * "pa" of both, and the one that *is* "pan" has to come first or the list is a
 * wall of nearly-right answers.
 */
export function searchIcons(
  query: string,
  options: { category?: ItemIconCategory | null } = {},
): ItemIcon[] {
  const needle = fold(query.trim());
  if (needle.length === 0) {
    return options.category ? iconsOf(options.category) : [...ITEM_ICONS];
  }

  const scored: { icon: ItemIcon; score: number }[] = [];

  for (const icon of ITEM_ICONS) {
    if (options.category && ITEM_ICON_GROUP[icon] !== options.category) continue;

    const key = fold(icon.replace(/_/g, " "));
    const label = fold(iconLabel(icon));
    const group = fold(ITEM_ICON_GROUP[icon]);

    let score = 0;
    if (key === needle || label === needle) score = 100;
    else if (key.startsWith(needle)) score = 80 - key.length;
    else if (label.startsWith(needle)) score = 70 - label.length;
    else if (key.includes(` ${needle}`)) score = 60;
    else if (key.includes(needle)) score = 40 - key.length;
    else if (group.startsWith(needle)) score = 20;

    if (score > 0) scored.push({ icon, score });
  }

  // The icon itself first, then the name, then the group: a list sorted by how
  // close the match is, and not by the alphabet, so the answer you meant is the
  // one under your thumb.
  return scored.sort((one, two) => two.score - one.score || one.icon.localeCompare(two.icon)).map((row) => row.icon);
}

/**
 * Text as it would be written without accents and in lower case.
 *
 * "Pañales" and "panales" are the same word to somebody typing fast on a phone,
 * and a search that only finds one of them looks broken.
 */
function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** The colours an icon can be drawn in, in the order they are offered. */
export const ICON_COLOR_KEYS = ITEM_ICON_COLORS;
export type IconColorKey = (typeof ITEM_ICON_COLORS)[number];

/**
 * The drawing of an icon: which glyph, and in which of the app's colours.
 *
 * The colour is a key and not a value, for the reason the space colour is a key:
 * the app draws the ones it offers, so there is no colour nobody can read on a
 * small shape and no picker of fifty shades on a phone.
 */
const ICON_COLORS: Record<IconColorKey, string> = {
  neutral: "#8A93A8",
  accent: "#6366F1",
  green: "#16A34A",
  olive: "#4D7C0F",
  amber: "#D97706",
  orange: "#EA580C",
  red: "#DC2626",
  rose: "#E11D48",
  purple: "#9333EA",
  blue: "#2563EB",
  teal: "#0D9488",
  brown: "#92400E",
};

/** The colour an icon is drawn in, a free hex, or the app's own if unknown. */
export function iconColor(key: string | null | undefined): string {
  // A hex a person chose is painted as it is: hash-led, six hex digits. Anything
  // else goes through the palette, and what is neither is neutral rather than
  // nothing — the column is free text, so a row from a future build can name a
  // colour this one does not have, and it comes out in the neutral one instead
  // of not coming out.
  if (typeof key === "string" && /^#[0-9A-Fa-f]{6}$/.test(key)) return key;
  const found = ICON_COLORS[String(key) as IconColorKey];
  return found ?? ICON_COLORS.neutral;
}

/** The glyph of an icon, filled or outline. */
export function glyphOf(
  icon: ItemIcon,
  style: "outline" | "fill" = "outline",
): string {
  const base = ITEM_GLYPHS[icon];
  return style === "fill" ? base : outlineOf(base);
}

/**
 * The name of each group and of each colour, in the language of the app.
 *
 * Typed against the keys the dictionaries declare, on purpose: a group that gets
 * added to the contract and not here is a compile error and not a tab with no
 * name on it, which reads as a bug in the picker and not as a missing label.
 */
export const ICON_GROUP_LABEL: Record<ItemIconCategory, TranslationKey> = {
  comida: "icons.group.comida",
  limpieza: "icons.group.limpieza",
  casa: "icons.group.casa",
  ropa: "icons.group.ropa",
  salud: "icons.group.salud",
  bebes: "icons.group.bebes",
  fuera: "icons.group.fuera",
  mascotas: "icons.group.mascotas",
  estudio: "icons.group.estudio",
  deporte: "icons.group.deporte",
};

export const ICON_COLOR_LABEL: Record<IconColorKey, TranslationKey> = {
  neutral: "icons.colors.neutral",
  accent: "icons.colors.accent",
  green: "icons.colors.green",
  olive: "icons.colors.olive",
  amber: "icons.colors.amber",
  orange: "icons.colors.orange",
  red: "icons.colors.red",
  rose: "icons.colors.rose",
  purple: "icons.colors.purple",
  blue: "icons.colors.blue",
  teal: "icons.colors.teal",
  brown: "icons.colors.brown",
};

export { isItemIcon };
