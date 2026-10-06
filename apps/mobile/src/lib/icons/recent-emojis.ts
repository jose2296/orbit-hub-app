export const RECENT_EMOJIS_KEY = "icon-picker-recent-emojis";
export const RECENTS_LIMIT = 16;

/**
 * The emojis somebody picked lately, most recent first.
 *
 * Corrupted or missing storage is no emojis, not an error: recents are a
 * shortcut and a shortcut that throws is worse than no shortcut.
 */
export function parseRecentEmojis(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === "string").slice(0, RECENTS_LIMIT);
}

/**
 * Puts the emoji first, dropping the oldest past sixteen.
 *
 * Pure, so it is tested without any storage: the sheet reads the stored value
 * with `keyValueStore` and writes back what this answers. That module imports
 * `expo-sqlite` at its top, which is why this file does not import it.
 */
export function withRecentEmoji(current: readonly string[], emoji: string): string[] {
  return [emoji, ...current.filter((entry) => entry !== emoji)].slice(0, RECENTS_LIMIT);
}
