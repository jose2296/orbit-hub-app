/**
 * Adding a title that is already in another list.
 *
 * The rules are the ones a person would not think about and would notice when
 * they are wrong: the same film in two lists of films is a duplicate and not a
 * copy, and the copy has to carry the poster with it or it looks like a bare
 * row.
 */

export interface ExistingItem {
  externalId: string | null;
  /** Only so a refusal can say *which* row it is; the rule never looks at it. */
  id?: string | null;
}

/** Whether a title should be written, and why not when it should not. */
export function planAddToList(
  existing: ExistingItem[],
  input: { externalId?: string | null },
): { added: boolean; reason?: 'already-there'; itemId?: string | null } {
  if (!input.externalId) return { added: true };

  // A hand written row has no provider id, so every one of them would be a
  // duplicate of every other and the list could never grow by hand.
  const yaEsta = existing.find((item) => item.externalId === input.externalId);
  if (!yaEsta) return { added: true };
  /*
   * **Which row it is, and not only that there is one.**
   *
   * "You already have it" is a sentence somebody reads. Being able to open that
   * row is what turns the sentence into something they can act on, and it is the
   * same `find` that decided the answer, so it costs nothing to return it. Before,
   * each caller went and did the same search again on its own and one of them
   * forgot.
   */
  return { added: false, reason: 'already-there', itemId: yaEsta.id ?? null };
}

/**
 * The position a new item takes: after everything already in the list.
 *
 * One past the highest position, not the number of items, because a delete
 * leaves a gap and a new item that lands in it would push the ones after it one
 * place along for no reason.
 */
export function nextPosition(existing: { position: number }[]): number {
  if (existing.length === 0) return 0;
  return Math.max(0, ...existing.map((item) => item.position)) + 1;
}
