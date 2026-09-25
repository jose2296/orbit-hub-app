/**
 * Helpers for text that comes from a provider rather than from a person.
 *
 * Google Books returns descriptions as HTML fragments. Rendering that as text
 * prints the tags, which is exactly what a book detail page looked like before
 * this existed.
 */

/** Drops tags, turns block boundaries into newlines and decodes entities. */
export function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
