import { describe, expect, it } from "vitest";

import { dictionaries } from "@/lib/i18n/dictionaries";

/**
 * What the badge says, checked as whole sentences.
 *
 * The badge is the first place the app says "this is not yours" and "this you may
 * not change", and those are two different claims. The dangerous failure is not a
 * missing translation: it is a wording that collapses them, so "solo puedes
 * mirarlo" ends up on a list the person owns and "tuyo" on one somebody lent them.
 * Key-existence tests pass happily on that, so the sentences themselves are pinned.
 */
describe("lo que dice la insignia de compartido", () => {
  const es = dictionaries.es;
  const en = dictionaries.en;

  it("distingue 'es tuyo' de 'te lo compartieron', en los dos idiomas", () => {
    for (const locale of [es, en]) {
      // Two different sentences, not one with a word swapped: the whole point is
      // that a person can tell from one glance whether they own the thing.
      expect(locale["shared.yours"]).not.toBe(locale["shared.fromThem"]);
      expect(locale["shared.yours"]).toMatch(/yours|tuyo/i);
      expect(locale["shared.fromThem"]).toMatch(/shared with you|compartido contigo/i);
    }
  });

  it("distingue 'puedes editarlo' de 'solo puedes mirarlo'", () => {
    for (const locale of [es, en]) {
      expect(locale["shared.canEdit"]).not.toBe(locale["shared.canOnlyRead"]);
      expect(locale["shared.canEdit"]).toMatch(/edit|editar/i);
      // And the read-only one has to say *only*, or it reads as "you can look at
      // it" — which sounds like an option rather than a limit.
      expect(locale["shared.canOnlyRead"]).toMatch(
        /only (you can )?look|solo puedes mirar/i,
      );
    }
  });

  it("no usa la palabra 'compartido' para algo que es tuyo", () => {
    // The whole feature rests on these being different states, so the label for
    // your own thing may not borrow the word for somebody else's.
    expect(es["shared.yours"]).not.toMatch(/compartid/i);
    expect(en["shared.yours"]).not.toMatch(/shared/i);
  });

  it("el de solo lectura no promete un candado que la app no pone", () => {
    // There is no lock anywhere in the share flow: nothing stops you opening a
    // list you were lent, and that is deliberate. A word like "bloqueado" in the
    // badge would be the app claiming a protection it does not have.
    for (const phrase of [es["shared.canOnlyRead"], en["shared.canOnlyRead"]]) {
      expect(phrase).not.toMatch(/lock|bloquead|candado/i);
    }
  });
});
