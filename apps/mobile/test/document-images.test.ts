import { describe, expect, it } from 'vitest';

import { validateNoteDocument } from '@orbit-hub/contracts';

/** The reasons the format would refuse a document, which is the list that matters. */
const reasons = (html: string): string[] =>
  validateNoteDocument(html).map((problem) => problem.reason);

import {
  ATTACHMENT_REF_PREFIX,
  attachmentIdFromCachedPath,
  attachmentIdFromRef,
  cachedImageName,
  dimensionsFor,
  imageReferences,
  restoreLostImages,
  IMAGE_PLACEHOLDER,
  isAttachmentRef,
  toLocalDocument,
  toStoredDocument,
  MAX_DRAWN_IMAGE_WIDTH,
} from '../src/lib/notes/document-images';

/**
 * A picture inside a note.
 *
 * The document cannot store a path, because a path is a path *on one phone* and a
 * note syncs to every phone a person owns. It cannot store a URL either, not a
 * permanent one for obvious reasons and not a signed one for a worse one: the
 * editor opens an image's `src` on its own, with no headers and no token, so a
 * `src` that needs a session answers 401 inside a component that has no way to
 * retry.
 *
 * So what is stored is a reference, and the app resolves it to a local file before
 * the editor ever sees the document. The pair of functions at the bottom is the
 * whole of it, and the risk being tested here is that they are not inverses: an
 * image that resolves one way and stores the other is a picture that disappears
 * the next time the note is saved.
 */
const A = '1f87e32a-710a-414f-962f-78fe9ee81033';
const B = '2a2b2c2d-3e3f-4a4b-8c8d-9e9f0a0b0c0d';

function ref(id: string): string {
  return `${ATTACHMENT_REF_PREFIX}${id}`;
}

describe('una referencia a una imagen', () => {
  it('no es una URL, y por eso no caduca', () => {
    // The whole reason for the scheme: a stored `src` that a bucket or a signed
    // link is not, so the note is still the same note in a year.
    expect(isAttachmentRef(ref(A))).toBe(true);
    expect(isAttachmentRef('https://example.com/a.png')).toBe(false);
    expect(isAttachmentRef('file:///tmp/a.png')).toBe(false);
    expect(isAttachmentRef('')).toBe(false);
  });

  it('lleva dentro el id del adjunto', () => {
    expect(attachmentIdFromRef(ref(A))).toBe(A);
    expect(attachmentIdFromRef('https://example.com/a.png')).toBeNull();
    // An empty id is a reference to nothing, and reading it as a picture would be
    // a request for a file that does not exist.
    expect(attachmentIdFromRef(ATTACHMENT_REF_PREFIX)).toBeNull();
  });
});

describe('el documento y sus imagenes', () => {
  it('las encuentra a todas, y sin repetir', () => {
    const document =
      `<img src="${ref(A)}" width="10" height="20"/><p>Entre medias.</p><img src="${ref(B)}" width="10" height="20"/><img src="${ref(A)}" width="10" height="20"/>`;
    expect(imageReferences(document)).toEqual([A, B]);
  });

  it('no encuentra nada en un documento sin imagenes', () => {
    expect(imageReferences('<p>Solo texto.</p>')).toEqual([]);
  });

  it('ignora un src que no es una referencia', () => {
    // A document can arrive from a template or from a paste with any src at all,
    // and the resolver leaves it exactly as it found it.
    expect(imageReferences('<img src="https://example.com/x.png"/>')).toEqual([]);
  });
});

describe('el nombre del fichero en cache', () => {
  it('lleva el id dentro, que es lo que hace el viaje de vuelta posible', () => {
    expect(cachedImageName(A, '.png')).toBe(`${A}.png`);
    // A missing dot is a detail, not a different answer.
    expect(cachedImageName(A, 'jpg')).toBe(`${A}.jpg`);
  });

  it('y del nombre sale el id otra vez', () => {
    expect(attachmentIdFromCachedPath(`/data/cache/note-images/${A}.png`)).toBe(A);
    // The editor may hand the path back with or without the scheme.
    expect(attachmentIdFromCachedPath(`file:///data/cache/note-images/${A}.png`)).toBe(A);
  });

  it('no inventa un id a partir de un fichero que no es nuestro', () => {
    // Somebody else's file in the cache is not an attachment, and a save that
    // turned one into a reference would be writing a row for a picture that does
    // not exist.
    expect(attachmentIdFromCachedPath('/data/cache/otra-cosa/photo.png')).toBeNull();
    expect(attachmentIdFromCachedPath('/tmp/1000000022.png')).toBeNull();
    expect(attachmentIdFromCachedPath('')).toBeNull();
  });
});

describe('ida y vuelta', () => {
  it('resolver y guardar devuelven el documento que estaba', () => {
    const stored = `<p>Antes.</p><img src="${ref(A)}" width="800" height="600"/><p>Despues.</p>`;
    const localised = toLocalDocument(stored, (id) => `/cache/note-images/${id}.png`);

    // The editor is given a file it can open, and the file is named after the
    // attachment, which is the only thing that makes the return trip mechanical.
    expect(localised).toContain(`/cache/note-images/${A}.png`);
    expect(localised).not.toContain(ATTACHMENT_REF_PREFIX);

    expect(toStoredDocument(localised)).toBe(stored);
  });

  it('sobrevive a que el editor reescriba los atributos en otro orden', () => {
    // The editor's own serialiser writes this document on the way out, and it
    // does not promise the same attribute order it was given. The saved string is
    // therefore not always byte-identical to the one that was loaded, and chasing
    // that would mean reimplementing its serialiser.
    //
    // What must not change is what the document *says*: the same picture, still
    // reachable, still the same size. Asserted on the parsed result rather than
    // on the string, because the string is the editor's to write and the meaning
    // is the app's to keep.
    const local = `/cache/note-images/${A}.png`;
    const stored = `<img src="${ref(A)}" width="800" height="600"/>`;
    const localised = toLocalDocument(stored, () => local);
    const reordered = localised.replace(
      `src="${local}" width="800" height="600"`,
      `height="600" width="800" src="${local}"`,
    );

    const back = toStoredDocument(reordered);
    expect(imageReferences(back)).toEqual([A]);
    expect(back).toContain(`src="${ref(A)}"`);
    expect(back).toContain('width="800"');
    expect(back).toContain('height="600"');
    expect(back).not.toContain('/cache/');
  });

  it('deja intacta una imagen que no se pudo resolver', () => {
    // A note whose picture is not on this device keeps its reference rather than
    // gaining a `src` that points at nothing. The editor draws its placeholder,
    // which is an honest picture of the state.
    const stored = `<img src="${ref(A)}" width="1" height="1"/>`;
    const localised = toLocalDocument(stored, () => null);
    expect(localised).toBe(stored);
    expect(toStoredDocument(localised)).toBe(stored);
  });

  it('deja intacto un src que no es nuestro', () => {
    const document = '<img src="https://example.com/x.png" width="1" height="1"/>';
    expect(toLocalDocument(document, () => '/cache/x.png')).toBe(document);
    expect(toStoredDocument(document)).toBe(document);
  });

  it('no toca el texto de una persona que se parece a una referencia', () => {
    // A paragraph that happens to read like a reference is a paragraph. Only the
    // `src` of an image is a reference, and only inside an `<img>`.
    const document = `<p>${ATTACHMENT_REF_PREFIX}${A}</p>`;
    expect(toLocalDocument(document, () => '/cache/x.png')).toBe(document);
    expect(toStoredDocument(document)).toBe(document);
  });
});

describe("el tamaño con el que se dibuja una imagen", () => {
  /**
   * The number in the document is the number the editor draws with, and on
   * Android the library multiplies it by the screen density. So the size has to
   * be fitted to the page before it is stored, or a phone photo is drawn twice
   * as wide as the text and half of it is off the page.
   */
  it("la estrecha a lo que cabe en el texto y guarda la proporcion", () => {
    const { width, height } = dimensionsFor({
      id: "a",
      noteId: "n",
      filename: "foto.png",
      mimeType: "image/png",
      sizeBytes: 100,
      createdAt: "2026-01-01T00:00:00.000Z",
      width: 4800,
      height: 3200,
    } as never);

    expect(width).toBe(MAX_DRAWN_IMAGE_WIDTH);
    // 3200/4800 de 320, que es dos tercios: 213.
    expect(height).toBe(213);
  });

  it("deja como esta una imagen que ya cabe", () => {
    expect(
      dimensionsFor({ width: 200, height: 100 } as never),
    ).toEqual({ width: 200, height: 100 });
  });

  it("usa un tamaño cuando la imagen no trae el suyo", () => {
    // Sin medir, dibujada a ojo: es una imagen que la app ya acepto, y el
    // editor la ajusta al ancho del texto de todas formas.
    const { width, height } = dimensionsFor({} as never);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it("nunca deja una altura de cero", () => {
    // Una imagen de 4000 de ancho por 1 de alto se estrecha a 320 y su alto
    // seria 0.08: un entero de cero es un `src` que el validador rechaza y una
    // nota que no se puede guardar por una foto panoramica.
    const { height } = dimensionsFor({ width: 4000, height: 1 } as never);
    expect(height).toBe(1);
  });
});

describe("las imagenes que el editor pierde al salir", () => {
  /**
   * Android's `setImage` draws the picture and then loses it: `getHTML` hands
   * back the object replacement character where the picture was, with no `<img>`
   * and no `src`. This is the repair, and the three facts that make it exact are
   * in the function's own comment: a stored document never holds one of those
   * characters, the editor is handed that document, and so every one in the output
   * is a picture this session put in, in order.
   */
  it("pone de vuelta cada foto en su sitio", () => {
    const doc =
      `<p>antes ${IMAGE_PLACEHOLDER} en medio ${IMAGE_PLACEHOLDER} despues</p>`;
    const html = restoreLostImages(doc, [
      { id: "a", width: 320, height: 213 },
      { id: "b", width: 100, height: 50 },
    ]);

    expect(html).toBe(
      '<p>antes <img src="attachment:a" width="320" height="213"/> en medio ' +
        '<img src="attachment:b" width="100" height="50"/> despues</p>',
    );
    // And what it produces has to be a document the contract accepts, or the
    // repair is a repair that cannot be saved.
    expect(reasons(html)).toEqual([]);
  });

  it("no toca nada si el editor ya los devuelve bien", () => {
    // El momento en que la biblioteca se arregle, este arreglo no hace nada: no
    // hay nada que reemplazar. Un arreglo que dejara marca al dejar de hacer falta
    // seria peor que no tenerlo.
    const doc = '<p>antes <img src="attachment:a" width="320" height="213"/> despues</p>';
    expect(restoreLostImages(doc, [{ id: "a", width: 320, height: 213 }])).toBe(doc);
  });

  it("deja el caracter como estaba si hay mas de los que CSP", () => {
    // Nadie va a inventar una referencia para un caracter que no es de nadie. Un
    // documento con mas de los que CSP se guardara tal cual, que es como se
    // puede ver que algo va mal en vez de como se ve que no va mal.
    const doc = `<p>${IMAGE_PLACEHOLDER}</p>`;
    expect(restoreLostImages(doc, [])).toBe(doc);
  });

  it("el documento que produce es del formato", () => {
    const html = restoreLostImages(`<p>x ${IMAGE_PLACEHOLDER}</p>`, [
      { id: "a", width: 320, height: 213 },
    ]);
    expect(reasons(html)).toEqual([]);
    expect(html).toContain('<img src="attachment:a"');
  });
});
