/**
 * The only URL a button may open: http(s), or null.
 *
 * Saving accepts an optional scheme, so a row can carry `javascript:` or plain text;
 * that is never opened, the button is hidden instead. Lives in `lib` (no React) so the
 * menu registry, the reader and the document view share one predicate.
 */
export function safeLinkTarget(href: string | undefined): string | null {
  if (href === undefined) return null;
  const limpio = href.trim();
  if (limpio.length === 0) return null;
  const esquema = limpio.toLowerCase();
  if (esquema.startsWith("http://") || esquema.startsWith("https://")) return limpio;
  return null;
}
