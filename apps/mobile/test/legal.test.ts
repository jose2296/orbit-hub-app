import { describe, expect, it } from 'vitest';

import { LEGAL_PRIVACY, LEGAL_TERMS } from '@/content/legal';
import { splitNotice } from '@/lib/legal/notice';

/**
 * The sentence under the sign-up box carries two markers, and a marker that is
 * not turned into a link is not a crash.
 *
 * `formatTranslation` deliberately leaves a token it has no value for exactly as
 * it found it, because that is the right thing to do for the other place tokens
 * are used. Down here it means "términos y la política de privacidad" can reach
 * somebody's screen with a literal `{terms}` in the middle of it, no error, no
 * log line, and every "does this key exist" check passing. So the cut is checked
 * here instead, where a failure is a name and not a screenshot.
 */
describe('splitNotice', () => {
  const ES = 'Al continuar aceptas los {terms} y la {privacy}.';
  const EN = 'By continuing you accept the {terms} and the {privacy}.';

  it('turns the sentence into text and links, in order', () => {
    expect(splitNotice(ES)).toEqual([
      { kind: 'text', value: 'Al continuar aceptas los ' },
      { kind: 'link', value: '{terms}', href: '/terms' },
      { kind: 'text', value: ' y la ' },
      { kind: 'link', value: '{privacy}', href: '/privacy' },
      { kind: 'text', value: '.' },
    ]);
  });

  it('sends each marker to its own route', () => {
    const hrefs = splitNotice(ES)
      .filter((parte) => parte.kind === 'link')
      .map((parte) => (parte as { href: string }).href);

    expect(hrefs).toEqual(['/terms', '/privacy']);
  });

  /**
   * The markers move with the translation.
   *
   * English and Spanish happen to put the two in the same order, so a `split`
   * that assumed the order would pass both and break the first language whose
   * grammar put the privacy policy first. It is the whole reason this is a
   * marker and not an index.
   */
  it('no depende del orden, sino de los marcadores', () => {
    expect(splitNotice('Al continuar aceptas la {privacy} y los {terms}.')).toEqual([
      { kind: 'text', value: 'Al continuar aceptas la ' },
      { kind: 'link', value: '{privacy}', href: '/privacy' },
      { kind: 'text', value: ' y los ' },
      { kind: 'link', value: '{terms}', href: '/terms' },
      { kind: 'text', value: '.' },
    ]);
  });

  it('un marcador al principio no deja un texto vacio delante', () => {
    expect(splitNotice('{terms} y la {privacy}.')[0]).toEqual({
      kind: 'link',
      value: '{terms}',
      href: '/terms',
    });
  });

  it('un marcador al final no deja un texto vacio detras', () => {
    // Dos partes y no tres: la tercera seria un `''` que se pinta como una
    // linea de mas en un texto que ya se acaba en el enlace.
    expect(splitNotice('Lee los {terms}')).toEqual([
      { kind: 'text', value: 'Lee los ' },
      { kind: 'link', value: '{terms}', href: '/terms' },
    ]);
  });

  it('una frase sin marcadores se devuelve entera', () => {
    expect(splitNotice('Sin enlaces aquí.')).toEqual([
      { kind: 'text', value: 'Sin enlaces aquí.' },
    ]);
  });

  it('no deja ningun marcador sin convertir en enlace', () => {
    for (const frase of [ES, EN]) {
      const sinConvertir = splitNotice(frase).filter(
        (parte) => parte.kind === 'text' && /\{(terms|privacy)\}/.test(parte.value),
      );

      expect(sinConvertir).toEqual([]);
    }
  });

  it('un texto que contenga {} que no es marcador se queda como texto', () => {
    expect(splitNotice('Un {nombre} cualquiera y los {terms}.')).toEqual([
      { kind: 'text', value: 'Un {nombre} cualquiera y los ' },
      { kind: 'link', value: '{terms}', href: '/terms' },
      { kind: 'text', value: '.' },
    ]);
  });
});

/**
 * What the page actually shows.
 *
 * A document whose paragraphs carry a `PENDIENTE` is a draft, and the point of
 * this test is not that it never will: it is that nobody ships one by accident.
 * The list of pending decisions lives in the header comment of `content/legal`,
 * and while any of them is unfilled the URL is not the one a store gets.
 */
describe('los documentos legales', () => {
  const documentos = { privacy: LEGAL_PRIVACY, terms: LEGAL_TERMS };

  for (const [nombre, documento] of Object.entries(documentos)) {
    describe(nombre, () => {
      it('tiene fecha de revision y seccion de cambios', () => {
        expect(documento.updatedLabel.trim()).not.toBe('');
        expect(documento.updatedAt.trim()).not.toBe('');

        const cambios = documento.sections.find((seccion) =>
          /cambio/i.test(seccion.heading),
        );
        expect(cambios, `${nombre} dice como avisa de sus propios cambios`).toBeDefined();
      });

      it('cada seccion tiene al menos un parrafo con contenido', () => {
        const vacias = documento.sections
          .filter((seccion) => seccion.paragraphs.length === 0)
          .map((seccion) => seccion.heading);

        expect(vacias).toEqual([]);
      });

      it('ningun parrafo se queda en blanco', () => {
        const vacios = documento.sections.flatMap((seccion) =>
          seccion.paragraphs
            .filter((parrafo) => parrafo.trim() === '')
            .map(() => seccion.heading),
        );

        expect(vacios).toEqual([]);
      });

      it('no hay dos secciones con el mismo titulo', () => {
        const titulos = documento.sections.map((seccion) => seccion.heading);

        expect(titulos).toHaveLength(new Set(titulos).size);
      });
    });
  }

  it('los dos documentos tienen la misma fecha de revision', () => {
    expect(LEGAL_PRIVACY.updatedAt).toBe(LEGAL_TERMS.updatedAt);
  });

  /**
   * The draft marker, checked the other way round.
   *
   * Every paragraph still holding a `PENDIENTE` is listed here, and the list is
   * asserted rather than assumed: `npm run check` names the four decisions that
   * are still open, in the failure message, so the draft has a visible count
   * that goes down as somebody answers them.
   *
   * It is deliberately **not** the opposite — a test that fails while the draft
   * is a draft would be red on `main` from here on, and a permanently red test is
   * a test everybody learns to skip. This one stays green while it counts.
   */
  it('los PENDIENTE que quedan son los que el repo todavia no puede responder', () => {
    const pendientes = Object.entries(documentos).flatMap(([nombre, documento]) =>
      documento.sections
        .filter((seccion) => seccion.paragraphs.some((parrafo) => /PENDIENTE/i.test(parrafo)))
        .map((seccion) => `${nombre} › ${seccion.heading}`),
    );

    // Baja este numero a medida que se resuelvan, y el boton de la tienda solo
    // se puede dar cuando este test afirme que no queda ninguno.
    //
    // Los cuatro estan cerrados: JRZ Labs es el responsable, privacy@jrzlabs.com
    // el contacto, los proveedores (Railway, Resend, S3/R2, TMDB, Google Books)
    // estan nombrados con sus terminos, y la ley aplicable es la espanola con los
    // tribunales de Madrid.
    expect(pendientes).toHaveLength(0);
  });
});