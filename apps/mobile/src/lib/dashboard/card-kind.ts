import type { Ionicons } from "@expo/vector-icons";
import type { ListKind } from "@orbit-hub/contracts";

/**
 * What a card on the panel *is*, drawn as an icon.
 *
 * A panel of cards is all rectangles of the same two gradients, and the only
 * things that tell one from another are the words in them. A card that says
 * "Cine" and a folder that says "Cine" are the same rectangle with the same
 * name, and the difference between "a film I want to see" and "the folder with
 * the films in it" is invisible until it is opened. So each card carries a mark
 * of its kind, and the mark is an icon from the system set rather than an emoji:
 * an emoji looks different on every device and means something different to
 * everyone, which is the opposite of what a mark is for.
 *
 * The set is small and closed on purpose. It is the kinds of list there are and
 * the folder, and nothing else — a card whose subject is not on the list gets the
 * generic list rather than an invented glyph, so a new kind in the contract shows
 * up as "a list" and never as a wrong answer.
 */

/** The marks. A folder, and one per kind of list. */
export type CardMark = keyof typeof CARD_MARK_GLYPH;

/**
 * The mark for each kind of list.
 *
 * `movies_and_series` and `movies` share the film. They are close enough that
 * telling them apart on a 40 point card is a distinction without a difference, and
 * a person who has pinned both can read the name; the one thing worth spending a
 * glyph on is that a folder is not a list, and that a series is not a film.
 */
const CARD_MARK_GLYPH = {
  folder: "folder-outline",
  tasks: "checkbox-outline",
  movies: "film-outline",
  movies_and_series: "film-outline",
  series: "tv-outline",
  books: "book-outline",
  /** A card about a list whose kind is not one of these. */
  list: "list-outline",
  /** A card about a note, which is a page of writing and not a list of things. */
  note: "document-text-outline",
} as const satisfies Record<string, keyof typeof Ionicons.glyphMap>;

/**
 * The mark for a card.
 *
 * `kind` is the kind of list, and `folder` says whether the card is a folder —
 * which wins, because a folder is the more useful of the two answers when a card
 * somehow claims to be both.
 */
export function cardMark(
  subject: { kind?: ListKind | null; folder?: boolean; note?: boolean } | null | undefined,
): CardMark {
  if (!subject) return "list";
  if (subject.folder) return "folder";
  // A note before a list's kind: a card about a note has no kind of list, and
  // falling through would draw it as a tasks list, which it is not.
  if (subject.note) return "note";
  const kind = subject.kind;
  if (!kind) return "list";
  return kind in CARD_MARK_GLYPH ? (kind as CardMark) : "list";
}

/** The glyph for a mark, for the components that draw it. */
export function cardMarkGlyph(mark: CardMark): keyof typeof Ionicons.glyphMap {
  return CARD_MARK_GLYPH[mark];
}
