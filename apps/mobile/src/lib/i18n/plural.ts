/**
 * Choosing the form of a counted phrase.
 *
 * "1 miembros" is the kind of thing that looks machine made, and it appears on
 * the screens a person reads most: the number of people in a space, the number
 * of folders in it, the number of tasks left. Spanish and English agree that one
 * is singular, so the rule is the same for both, but it lives here so a language
 * that disagrees can be added without hunting through the screens.
 *
 * The return type is built from the base key, so a base that has no singular or
 * plural form does not compile. That is the point: a missing translation should
 * be a type error rather than a sentence in the wrong number.
 */
export function pluralKey<K extends string>(
  base: K,
  count: number,
): `${K}.one` | `${K}.other` {
  return count === 1 ? `${base}.one` : `${base}.other`;
}
