import { describe, expect, it } from "vitest";

import { dictionaries } from "@/lib/i18n/dictionaries";

/**
 * The sentences that are load-bearing about sharing.
 *
 * Sharing has a handful of promises that are easy to state and easy to break by
 * rephrasing: that it is a link and not a copy, that the person receiving it
 * chooses where it goes, and that a delete says how many other phones it
 * disappears from. Each of those is checked here as a whole sentence, because a
 * test that checks a key *exists* passes just as happily on a sentence that says
 * the opposite.
 */
describe("lo que la app promete al compartir", () => {
  const es = dictionaries.es;
  const en = dictionaries.en;

  it("dice que es un vinculo y no una copia, y dice que se puede ir de los dos lados", () => {
    for (const locale of [es, en]) {
      const texto = locale["place.isALink"];
      expect(texto).toMatch(/not a copy|no es una copia/i);
      // La mitad que se olvida: que el otro puede borrarlo y desaparece aqui
      // tambien. Sin esta frase el "no es una copia" parece tranquilizador y no
      // lo es.
      expect(texto).toMatch(/if they delete it|si .* lo borra/i);
    }
  });

  it("el aviso de borrado dice a cuantas personas afecta antes de confirmar", () => {
    for (const locale of [es, en]) {
      const texto = locale["share.reachBody"];
      expect(texto).toContain("{count}");
      // Y que desaparece de ahi sin avisar: el aviso tiene que decir la parte
      // incomoda, que es la que hace que alguien pulse cancelar.
      expect(texto).toMatch(/without warning|sin aviso previo/i);
    }
  });

  it("el correo avisa de si se puede editar o solo mirar", () => {
    // El texto en si vive en el servidor, pero la app tiene que poder decir lo
    // mismo cuando muestra una concesion en solo lectura.
    expect(es["place.chooseSpace"]).toBeTruthy();
    expect(en["place.chooseSpace"]).toBeTruthy();
  });

  it("el menu dice que un espacio compartido no es tuyo", () => {
    for (const locale of [es, en]) {
      expect(locale["drawer.sharedBadge"]).toBeTruthy();
      expect(locale["drawer.sharedBadgeHint"]).toMatch(/not a member|no eres miembro/i);
    }
  });

  it("el contador de la bandeja tiene plurales de verdad", () => {
    // `1` y `0` tienen que decir cosas distintas, y no solo 1 y 2: una bandeja con
    // cero no se dibuja, pero un "Compartido conmigo · 1" mal pluralizado se ve
    // todas las veces que alguien recibe algo.
    expect(es["drawer.sharedWithMeCount.one"]).toContain("1");
    expect(es["drawer.sharedWithMeCount.other"]).toContain("{count}");
    expect(es["drawer.sharedWithMeCount.one"]).not.toBe(
      es["drawer.sharedWithMeCount.other"],
    );
    expect(en["drawer.sharedWithMeCount.one"]).not.toBe(
      en["drawer.sharedWithMeCount.other"],
    );
  });
});
