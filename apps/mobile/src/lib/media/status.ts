import type { TranslationKey } from "@/lib/i18n";

/**
 * What a title's status is, in the language of the screen.
 *
 * TMDB sends these in English and the detail screen puts them next to a badge
 * that says "Película" in the person's language, so a Spanish screen ends up
 * reading "1999 · Película · Released · 138 min". Half a sentence in each
 * language is how an app starts to look machine made.
 *
 * The keys are the provider's own words, uppercased, and the fallback is the
 * word the provider sent: a status this build has never heard of is shown as it
 * arrived, which is a slightly odd label and not a blank space.
 */
const STATUS_KEYS: Record<string, TranslationKey> = {
  RUMORED: "status.rumored",
  PLANNED: "status.planned",
  "IN PRODUCTION": "status.inProduction",
  "POST PRODUCTION": "status.postProduction",
  RELEASED: "status.released",
  CANCELED: "status.canceled",
  "RETURNING SERIES": "status.returningSeries",
  ENDED: "status.ended",
  PILOT: "status.pilot",
  "IN PRODUCTION ": "status.inProduction",
};

/** The key for a status, or `null` when this build does not know the word. */
export function statusKeyOf(
  status: string | null | undefined,
): TranslationKey | null {
  if (!status) return null;
  return STATUS_KEYS[status.trim().toUpperCase()] ?? null;
}
