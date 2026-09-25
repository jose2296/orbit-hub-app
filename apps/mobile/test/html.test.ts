import { describe, expect, it } from 'vitest';

import { stripHtml } from '../src/lib/text/html';

/**
 * Google Books returns descriptions as HTML fragments. Rendering them as text
 * printed the tags, which is what a book detail page looked like before this was
 * extracted and tested.
 */
describe('stripHtml', () => {
  it('removes paragraph tags and keeps the text', () => {
    expect(stripHtml('<p>Primera parte</p><p>Segunda parte</p>')).toBe(
      'Primera parte\n\nSegunda parte',
    );
  });

  it('turns a line break into a newline', () => {
    expect(stripHtml('uno<br/>dos')).toBe('uno\ndos');
  });

  it('decodes the entities a description actually uses', () => {
    expect(stripHtml('Tom &amp; Jerry &lt;3 &quot;quote&quot;')).toBe(
      'Tom & Jerry <3 "quote"',
    );
  });

  it('drops bold and italic markers', () => {
    expect(stripHtml('<b>García Márquez</b> dijo <i>«así»</i>')).toBe(
      'García Márquez dijo «así»',
    );
  });

  it('collapses the runs of blank lines markup leaves behind', () => {
    expect(stripHtml('<p>uno</p><p></p><p>dos</p>')).toBe('uno\n\ndos');
  });

  it('leaves plain text untouched', () => {
    expect(stripHtml('Una sinopsis normal.')).toBe('Una sinopsis normal.');
  });

  it('handles an empty string', () => {
    expect(stripHtml('')).toBe('');
  });
});
