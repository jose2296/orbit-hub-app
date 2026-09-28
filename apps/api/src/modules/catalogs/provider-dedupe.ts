/**
 * The same service, twice.
 *
 * TMDB's `watch/providers` is a list written by hand, country by country, over
 * years, and the same company is in it under more than one name. In Spain, right
 * now, one film comes back with "Movistar Plus+" and "Movistar Plus+ Utd" as two
 * entries, and "Amazon Prime" next to "Amazon Prime Video". They are not two ways
 * of watching it. They are one service listed twice, and the sheet draws two
 * cards with the same logo and two different names, which is exactly what a
 * person reads as "these are different things and I do not know which to pay for".
 *
 * The key is the **logo**, not the name, and that is the whole trick. Names are
 * what disagree; the logo is the picture of the company, and it is the same file
 * when it is the same company. So:
 *
 * - Same logo, same offering → one card. This is the duplicate.
 * - Same logo, *different* offering → two cards, on purpose. Apple TV+ being both
 *   the subscription and the rental shop is two different decisions and putting
 *   them in one card would hide the price.
 * - Different logo → two cards, always. Even with a confusing name.
 * - No logo at all → the name decides, folded so that case, accents and capital
 *   letters are not differences. And when one entry has a logo and another with
 *   the same name does not, they stay apart: "use the logo if there is one, else
 *   the name" is not a fallback, it is two separate sets of keys, and joining them
 *   would be claiming TMDB guarantees that one name is one company. It does not.
 *
 * Which name survives is the shortest one, and not by taste: the variants TMDB
 * carries are the same name with a qualifier stuck on the end ("Utd", "España",
 * "International"), and dropping the longest one is what leaves the name the
 * company actually trades under. "Movistar Plus+ Utd" is a distributor's
 * internal label; "Movistar Plus+" is what you would say out loud.
 *
 * **Bundles are left alone.** "HBO Max Amazon" has its own logo and its own
 * subscription, and merging it into either of its parts would tell somebody to
 * pay for the wrong one. Two cards where there really are two things to pay for
 * is correct; two cards of the same thing is what we are fixing.
 */

/** A provider as TMDB sends it, before it is normalised. */
export interface ProviderCrudo {
  provider_name: string;
  logo_path?: string | null;
}

export interface ProviderNormalizado {
  name: string;
  logoPath: string | null;
  offering: string;
}

/**
 * What to key a duplicate on: the logo when there is one, the name when not.
 *
 * Takes the normalised shape rather than TMDB's, so there is one version of this
 * instead of two that have to be kept in step — and the first version of it read
 * `provider_name` off a shape that no longer had that field, which is a
 * `undefined` in a `.toLowerCase()` and ten tests down.
 */
function clave(entrada: ProviderNormalizado): string {
  if (entrada.logoPath) return `logo:${entrada.logoPath.toLowerCase()}`;
  return `nombre:${normaliza(entrada.name)}`;
}

/**
 * Lower case, no accents, no punctuation, spaces squeezed.
 *
 * Only used when a provider has no logo, where the name is the best thing left
 * to compare. Stripping accents is what makes "Netflix" and "Nétflix" one entry
 * on the day somebody types it into TMDB by hand.
 */
function normaliza(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Collapses the duplicates out of one country's list, keeping the order it came
 * in — the caller has already ordered the offerings by how different they are as
 * a decision, and sorting again here would throw that away.
 */
export function deduplicaProveedores<T extends ProviderNormalizado>(
  entradas: readonly T[],
): T[] {
  const vistos = new Map<string, T>();

  for (const entrada of entradas) {
    // The offering is part of the key on purpose; see the note at the top.
    const id = `${clave(entrada)}|${entrada.offering}`;

    const previa = vistos.get(id);
    if (!previa) {
      vistos.set(id, entrada);
      continue;
    }

    // Same service, two names. Keep the shorter, which is the one without the
    // qualifier stuck on the end.
    //
    // Both of these always share the same `logoPath` and the same `offering`,
    // because that is what the key is made of — so there is nothing to merge in
    // besides the name, and reaching for a logo here would be code for a case
    // that cannot arrive.
    if (entrada.name.length < previa.name.length) {
      vistos.set(id, entrada);
    }
  }

  return [...vistos.values()];
}

/** The same thing, over the raw shape TMDB answers with. */
export function deduplicaCrudos(
  entradas: readonly ProviderCrudo[],
  offering: string,
): ProviderNormalizado[] {
  return deduplicaProveedores(
    // `logo_path` is optional in the schema, so it has to be optional here too —
    // a local copy of the Zod type would drift from the real one and this would
    // break again the next time TMDB adds a field.
    entradas.map((entrada) => ({
      name: entrada.provider_name,
      logoPath: entrada.logo_path ?? null,
      offering,
    })),
  );
}
