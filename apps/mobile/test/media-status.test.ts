import { describe, expect, it } from "vitest";

import { statusKeyOf } from "../src/lib/media/status";
import { dictionaries } from "../src/lib/i18n/dictionaries";

/**
 * The status of a title, said in the language of the screen.
 *
 * The provider sends these in English and they sit next to a badge in the
 * person's language, so "1999 · Película · Released · 138 min" is what a Spanish
 * screen said. Half a sentence in each language is how an app looks machine
 * made, and the words are known: the provider's vocabulary is nine long and it
 * does not change every month.
 */
const TMDB_STATUSES = [
  "Rumored",
  "Planned",
  "In Production",
  "Post Production",
  "Released",
  "Canceled",
  "Returning Series",
  "Ended",
  "Pilot",
];

describe("statusKeyOf", () => {
  it("knows every status the provider sends", () => {
    for (const status of TMDB_STATUSES) {
      expect(statusKeyOf(status), status).toBeTruthy();
    }
  });

  it("does not care how the word is capitalised or spaced", () => {
    // A provider that changes a capital is not a new status, and a screen that
    // goes back to English because of one capital is a screen that cannot be
    // trusted with words.
    expect(statusKeyOf("released")).toBe(statusKeyOf("RELEASED"));
    expect(statusKeyOf("  Released  ")).toBe(statusKeyOf("Released"));
  });

  it("has a word in both languages for every status it knows", () => {
    for (const status of TMDB_STATUSES) {
      const key = statusKeyOf(status)!;
      expect(dictionaries.es[key], status).toBeTruthy();
      expect(dictionaries.en[key], status).toBeTruthy();
    }
  });

  it("says the same thing in the two languages, not the same word", () => {
    // "Released" in English and "Estrenada" in Spanish. A translation that left
    // the English word in the Spanish dictionary is a translation that was not
    // made, and it is invisible in a test that only checks the key exists.
    expect(dictionaries.es[statusKeyOf("Released")!]).toBe("Estrenada");
    expect(dictionaries.en[statusKeyOf("Released")!]).toBe("Released");
  });

  it("does not answer for a status it has never heard of", () => {
    // The screen falls back to the word the provider sent. Returning a key
    // anyway would put a status nobody recognises in the interface.
    expect(statusKeyOf("Airing on Fridays")).toBeNull();
    expect(statusKeyOf("")).toBeNull();
    expect(statusKeyOf(null)).toBeNull();
    expect(statusKeyOf(undefined)).toBeNull();
  });
});
