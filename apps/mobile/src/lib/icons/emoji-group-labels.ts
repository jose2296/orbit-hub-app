/**
 * The nine emoji groups, in Spanish.
 *
 * `unicode-emoji-json` names them in English — "Smileys & Emotion", "Travel &
 * Places" — and they are the labels of the category bar, which is read on screen
 * by somebody who is not going to switch the app to English to find the food.
 *
 * A map and not dictionary keys, for the same reason `emoji-aliases.ts` is one:
 * the groups arrive from a package, so the set is not something the dictionary
 * decides. One entry per group in `EMOJI_GROUPS` and not one more, which
 * `test/emoji-groups.test.ts` checks — a group added upstream without a name here
 * shows up as its English name in the middle of a Spanish bar.
 */
export const EMOJI_GROUP_LABELS: Record<string, string> = {
  "Smileys & Emotion": "Emoticonos",
  "People & Body": "Personas y cuerpo",
  "Animals & Nature": "Animales y naturaleza",
  "Food & Drink": "Comida y bebida",
  "Travel & Places": "Viajes y lugares",
  Activities: "Actividades",
  Objects: "Objetos",
  Symbols: "Símbolos",
  Flags: "Banderas",
};

/**
 * The name of a group in the language of the app.
 *
 * An unknown group gets its own name back instead of `undefined`: a bar with a
 * hole in it is worse than a bar with a group in English, and the group is
 * real either way.
 */
export function emojiGroupLabel(group: string): string {
  return EMOJI_GROUP_LABELS[group] ?? group;
}
