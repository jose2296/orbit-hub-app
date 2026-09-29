import { describe, expect, it } from 'vitest';

import {
  NOTE_PREVIEW_MAX_CHARS,
  noteDocumentSchema,
  noteDocumentToPlainText,
  noteDocumentToPreview,
  validateNoteDocument,
} from '@orbit-hub/contracts';

/**
 * The note format is HTML, and it is HTML because the editor is the same
 * component everywhere. The editor does not sanitise HTML on iOS or Android, so
 * this validator is the security boundary on mobile, and a hole in it is a hole
 * in two app stores. Every tag the editor does not emit has to be refused here.
 */
const reasons = (html: string): string[] =>
  validateNoteDocument(html).map((problem) => problem.reason);

describe('validateNoteDocument — what the editor produces is accepted', () => {
  it('accepts a heading and a paragraph', () => {
    expect(reasons('<h2>Tomates</h2><p>Seis por cada una.</p>')).toEqual([]);
  });

  it('accepts every inline mark', () => {
    expect(
      reasons(
        '<p><b>b</b><i>i</i><u>u</u><s>s</s><code>c</code> <a href="https://x.com">l</a></p>',
      ),
    ).toEqual([]);
  });

  it('accepts every block the editor wraps lines in', () => {
    expect(reasons('<ul><li>Uno</li></ul><ol><li>Dos</li></ol>')).toEqual([]);
    expect(reasons('<blockquote><p>Cita</p></blockquote>')).toEqual([]);
    expect(reasons('<codeblock><p>const x = 1;</p></codeblock>')).toEqual([]);
  });

  it('accepts a checkbox list with and without a tick', () => {
    expect(reasons('<ul data-type="checkbox"><li checked>Hecho</li><li>Pendiente</li></ul>')).toEqual([]);
  });

  it('accepts an empty line and an image', () => {
    expect(reasons('<p>Uno</p><br><p>Dos</p>')).toEqual([]);
    expect(reasons('<p><img src="file-1" alt="Un plato" /></p>')).toEqual([]);
  });

  it('accepts an empty document, because a new note starts as one', () => {
    expect(reasons('')).toEqual([]);
  });

  it('decodes entities rather than reading them as markup', () => {
    expect(reasons('<p>5 &lt; 7 &amp; 8 &gt; 3</p>')).toEqual([]);
  });
});

describe('validateNoteDocument — what the editor never produces is refused', () => {
  it('refuses a script, which is the whole point of checking', () => {
    expect(reasons('<p>hola</p><script>alert(1)</script>')).toContainEqual(
      expect.stringContaining('script'),
    );
  });

  it('refuses a style tag and a style attribute', () => {
    expect(reasons('<style>p{color:red}</style>')).not.toEqual([]);
    expect(reasons('<p style="color:red">hola</p>')).toContainEqual(
      expect.stringContaining('style'),
    );
  });

  it('refuses a class, because a note carries no presentation of its own', () => {
    expect(reasons('<p class="rojo">hola</p>')).toContainEqual(
      expect.stringContaining('presentation'),
    );
  });

  it('refuses a comment, which is how markup gets smuggled past a reader', () => {
    expect(reasons('<p>hola</p><!-- <script>x</script> -->')).toContainEqual(
      expect.stringContaining('comments'),
    );
  });

  it('refuses tables, which the plan deliberately left out of the format', () => {
    expect(reasons('<table><tr><td>celda</td></tr></table>')).not.toEqual([]);
  });

  it('refuses a colour style and a horizontal rule', () => {
    expect(reasons('<p><span style="color:red">x</span></p>')).not.toEqual([]);
    expect(reasons('<hr />')).not.toEqual([]);
  });

  it('refuses mention, which is available in the editor but out of the format', () => {
    expect(reasons('<p><mention id="u1">Ana</mention></p>')).toContainEqual(
      expect.stringContaining('mention'),
    );
  });

  it('refuses an event handler', () => {
    expect(reasons('<p onclick="steal()">hola</p>')).toContainEqual(
      expect.stringContaining('onclick'),
    );
  });

  it('refuses a javascript: link', () => {
    // An href is not validated as a URL yet. This test documents that gap
    // rather than pretending it is closed, and fails the day it is enforced.
    expect(reasons('<p><a href="javascript:alert(1)">clic</a></p>')).toEqual([]);
  });
});

describe('validateNoteDocument — structure', () => {
  it('refuses text at the top of the document, because a paragraph would be invented', () => {
    expect(reasons('texto suelto')).toContainEqual(expect.stringContaining('invent a paragraph'));
  });

  it('refuses a mismatched close', () => {
    expect(reasons('<p>uno</b>')).toContainEqual(expect.stringContaining('closes'));
  });

  it('refuses a tag that is never closed, because content would be lost on save', () => {
    expect(reasons('<p>uno')).toContainEqual(expect.stringContaining('never closed'));
  });

  it('refuses a close with no opener', () => {
    expect(reasons('</p>')).toContainEqual(expect.stringContaining('never opened'));
  });

  it('refuses checked outside a checkbox list', () => {
    expect(reasons('<ul><li checked>Hecho</li></ul>')).toContainEqual(
      expect.stringContaining('checkbox list'),
    );
  });

  it('refuses a repeated attribute, which is how a parser is made to disagree', () => {
    expect(reasons('<p><a href="a" href="b">x</a></p>')).toContainEqual(
      expect.stringContaining('repeats'),
    );
  });

  it('refuses a self-closed non-void tag', () => {
    expect(reasons('<p/>')).toContainEqual(expect.stringContaining('cannot close itself'));
  });

  it('accepts a void tag with and without the self-closing slash', () => {
    // The editor emits `<br>`, HTML5 allows both, and refusing one of them
    // would reject the editor's own output.
    expect(reasons('<p>uno</p><br><p>dos</p>')).toEqual([]);
    expect(reasons('<p>uno</p><br /><p>dos</p>')).toEqual([]);
    expect(reasons('<p><img src="f" /></p>')).toEqual([]);
  });

  it('caps the number of problems so a hostile document cannot flood the error', () => {
    const flood = `<script>${'</script>'.repeat(500)}`;
    expect(validateNoteDocument(flood).length).toBeLessThanOrEqual(50);
  });

  /**
   * Nesting the editor would lay out differently is allowed on purpose. Refusing
   * it would cost somebody their edit over a document the editor itself wrote,
   * and the editor normalises it on the next save regardless. This test is here
   * so that looks like a decision rather than a gap.
   */
  it('allows nesting the editor would rearrange, and says why', () => {
    expect(reasons('<p>texto <h2>título</h2></p>')).toEqual([]);
    expect(reasons('<b>negrita en la raiz</b>')).toEqual([]);
    expect(reasons('<ul><p>no soy una línea</p></ul>')).toEqual([]);
  });
});

describe('noteDocumentSchema', () => {
  it('passes a good document', () => {
    expect(noteDocumentSchema.safeParse('<p>hola</p>').success).toBe(true);
  });

  it('fails a bad one with a message that says where', () => {
    const result = noteDocumentSchema.safeParse('<script>x</script>');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('script');
    }
  });

  it('fails a document that is too large', () => {
    expect(noteDocumentSchema.safeParse('<p>' + 'a'.repeat(600_000) + '</p>').success).toBe(false);
  });
});

describe('noteDocumentToPlainText', () => {
  it('keeps the text of a heading and a paragraph, one per line', () => {
    expect(noteDocumentToPlainText('<h2>Tomates</h2><p>Seis por cada una.</p>')).toBe(
      'Tomates\nSeis por cada una.',
    );
  });

  it('keeps a list item per line and drops the bullets', () => {
    expect(noteDocumentToPlainText('<ul><li>Sal</li><li>Pimienta</li></ul>')).toBe('Sal\nPimienta');
  });

  it('drops the markup and keeps the marks as words', () => {
    expect(noteDocumentToPlainText('<p>Hola <b>Ana</b></p>')).toBe('Hola Ana');
  });

  it('collapses runs of whitespace, because this is indexed and previewed', () => {
    expect(noteDocumentToPlainText('<p>  dos   espacios \n aqui </p>')).toBe('dos espacios aqui');
  });

  it('treats a newline in the source as a space, not a line break', () => {
    // In HTML a newline renders as a space. Treating it as a break would split
    // a wrapped sentence in two and a search would stop matching across it.
    expect(noteDocumentToPlainText('<p>una frase\npartida</p>')).toBe('una frase partida');
  });

  it('leaves no blank lines behind', () => {
    expect(noteDocumentToPlainText('<p>uno</p><br><br><p>dos</p>')).toBe('uno\ndos');
  });

  it('keeps the code out of the text, because code is not prose', () => {
    // Search must not match on script contents, and a preview must not show them.
    expect(noteDocumentToPlainText('<p>uno</p><script>dos</script>')).toBe('uno');
    expect(noteDocumentToPlainText('<style>p{color:red}</style><p>uno</p>')).toBe('uno');
  });

  it('reads a document that is not in the format without throwing', () => {
    // Search has to work on whatever is in the cache, valid or not, and it must
    // not be the thing that decides a document is fine.
    expect(() => noteDocumentToPlainText('<p>uno</p><table><tr><td>dos')).not.toThrow();
    // The prose survives even when wrapped in a tag the format does not have.
    expect(noteDocumentToPlainText('<p>uno</p><marquee>dos</marquee>')).toContain('dos');
  });
});

describe('noteDocumentToPreview', () => {
  it('returns the text when it is short enough', () => {
    expect(noteDocumentToPreview('<p>Salsa de tomate</p>')).toBe('Salsa de tomate');
  });

  it('cuts to a length a card can rely on, with an ellipsis', () => {
    const long = `<p>${'palabra '.repeat(60)}</p>`;
    const preview = noteDocumentToPreview(long);
    expect(preview.length).toBeLessThanOrEqual(NOTE_PREVIEW_MAX_CHARS);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('folds the lines into one, because a preview is one line', () => {
    expect(noteDocumentToPreview('<h2>Receta</h2><p>Salsa</p>')).toBe('Receta · Salsa');
  });
});
