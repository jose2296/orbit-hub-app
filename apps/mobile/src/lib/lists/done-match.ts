import type { ListItem } from "@orbit-hub/contracts";

/**
 * The row you already did, when you are writing it again.
 *
 * A shopping list is the case this is for. You bought the milk three weeks ago,
 * the row is still in the list, done, at the bottom. You write "milk" again and
 * the app quietly adds a second milk, and now the list says you need milk and
 * you already have milk and neither is true.
 *
 * So before a new row is written, the list is asked whether it already has this
 * thing done. If it does, the panel says so and offers the one thing that is
 * useful: put that one back as pending. Not "there is already one" — a notice
 * nobody acts on — and not silently reusing the old row, because a row you did
 * three weeks ago is not the row you are writing today: it may have a different
 * icon, different labels, a different urgency.
 *
 * The comparison ignores case, accents and spacing, because that is how the same
 * word arrives when it is typed on a phone, and a match that only fires on the
 * exact spelling is a feature that never fires.
 */

/** As it would be written without accents, in lower case, without extra spaces. */
export function normaliseToCompare(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fewer letters than this and it is not a word, it is the start of one. */
const MIN_LETRAS = 3;

/**
 * The done row this title is about, or `null`.
 *
 * The most recently touched one, because the same thing bought twice is on the
 * list twice and the one you did last is the one you mean.
 */
export function completedMatch(
  title: string,
  items: readonly ListItem[],
): ListItem | null {
  const buscado = normaliseToCompare(title);
  if (buscado.length < MIN_LETRAS) return null;

  const candidatos = items
    .filter(
      (item) =>
        item.deletedAt === null &&
        item.completed &&
        normaliseToCompare(item.title) === buscado,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return candidatos[0] ?? null;
}
