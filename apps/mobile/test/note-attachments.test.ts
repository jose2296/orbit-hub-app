import { describe, expect, it } from 'vitest';

import {
  isAcceptedMime,
  isInlineImage,
  whyRefused,
} from '../src/lib/notes/attachments';

/**
 * What a note will accept.
 *
 * The list lives in the contract and the client reads it from there. A copy would
 * drift, and the failure is a person who has already written a paragraph about a
 * photo that the server then refuses.
 */
describe('isAcceptedMime', () => {
  it('takes the pictures a phone actually produces', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/heic', 'image/webp']) {
      expect(isAcceptedMime(mime)).toBe(true);
    }
  });

  it('refuses a document that runs code', () => {
    // An SVG is a program. It is not on the list and never will be while a note can
    // be shown to somebody else.
    expect(isAcceptedMime('image/svg+xml')).toBe(false);
    expect(isAcceptedMime('text/html')).toBe(false);
    expect(isAcceptedMime('application/javascript')).toBe(false);
  });

  it('refuses a kind nobody has asked for yet', () => {
    expect(isAcceptedMime('video/mp4')).toBe(false);
    expect(isAcceptedMime('application/zip')).toBe(false);
    expect(isAcceptedMime('')).toBe(false);
  });
});

describe('isInlineImage', () => {
  it('draws a picture inside the document and leaves a file beside it', () => {
    // The two are different: one becomes part of the text, the other is a document
    // somebody opens, and the note's allow-list only has a place for the first.
    expect(isInlineImage('image/png')).toBe(true);
    expect(isInlineImage('application/pdf')).toBe(false);
    // And an accepted check first, so nothing the server refuses is ever drawn.
    expect(isInlineImage('image/svg+xml')).toBe(false);
  });
});

describe('whyRefused', () => {
  const maxBytes = 10 * 1024 * 1024;

  it('says nothing about a file that is fine', () => {
    expect(whyRefused({ mimeType: 'image/png', sizeBytes: 1000, maxBytes })).toBeNull();
  });

  it('names the type, because "not accepted" alone leaves nothing to do', () => {
    const reason = whyRefused({ mimeType: 'video/mp4', sizeBytes: 1000, maxBytes });
    expect(reason).toContain('video/mp4');
  });

  it('says how big the limit is', () => {
    const reason = whyRefused({ mimeType: 'image/png', sizeBytes: 50 * 1024 * 1024, maxBytes });
    expect(reason).toContain('10 MB');
  });

  it('handles a file whose type the picker could not read', () => {
    const reason = whyRefused({ mimeType: '', sizeBytes: 10, maxBytes });
    expect(reason).toContain('desconocido');
  });

  it('refuses a file whose size nobody knows', () => {
    // A picker that cannot say how big a file is reports zero, and the schema
    // wants a positive number, so sending it would be refused by the server with a
    // message about a limit that is perfectly fine. The honest answer is to say the
    // size is unknown here rather than to let a 0 through.
    expect(whyRefused({ mimeType: 'image/png', sizeBytes: 0, maxBytes })).toContain('tamaño');
    expect(
      whyRefused({ mimeType: 'image/png', sizeBytes: Number.NaN, maxBytes }),
    ).toContain('tamaño');
  });
});
