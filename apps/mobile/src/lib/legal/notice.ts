import type { Href } from 'expo-router';

/**
 * The sentence under the sign-up box, cut into the parts that are text and the
 * parts that are links.
 *
 * The links are inside the sentence and not beside it because a sentence with
 * "los términos y la política de privacidad" in plain text is a promise that
 * there is something to read somewhere. Beside it means off to the side of
 * something the eye has already left.
 *
 * It is cut by a marker and not by composing three strings out of four, because
 * the markers move with the translation. `legal.notice` is translated, and in
 * English the two links are not where they are in Spanish: a language that puts
 * the privacy policy first would have to be a translation, not a rearrangement.
 * Splitting on `{terms}` and `{privacy}` is what lets that happen without the
 * component knowing.
 *
 * The failure this shape is guarding against is a raw `{terms}` printed in the
 * middle of a person's screen. `formatTranslation` leaves a token it has no
 * value for exactly as it found it — that is its job elsewhere — so a sentence
 * that is handed to `t()` with no values is not a crash and not a missing key,
 * and every "does this key exist" check passes. It was found once, by looking.
 */

/** Where the two markers end up, and what they open. */
const LINK_MARKERS: Record<string, Href> = {
  '{terms}': '/terms',
  '{privacy}': '/privacy',
};

export type NoticePart =
  | { kind: 'text'; value: string }
  | { kind: 'link'; value: string; href: Href };

const MARKERS = /\{(?:terms|privacy)\}/g;

/**
 * Turn `legal.notice` into the sequence it is drawn as.
 *
 * A marker with no text next to it still produces a link, with the marker as its
 * own label, because a link that shows nothing is worse than one that shows the
 * wrong thing: it is there, it takes the tap, and it looks like the sentence is
 * missing a word rather than that the dictionary is.
 */
export function splitNotice(sentence: string): NoticePart[] {
  const partes: NoticePart[] = [];
  let ultimo = 0;
  let coincidencia: RegExpExecArray | null;

  MARKERS.lastIndex = 0;
  while ((coincidencia = MARKERS.exec(sentence)) !== null) {
    const marcador = coincidencia[0];
    const href = LINK_MARKERS[marcador];
    if (href === undefined) continue;

    if (coincidencia.index > ultimo) {
      partes.push({ kind: 'text', value: sentence.slice(ultimo, coincidencia.index) });
    }
    partes.push({ kind: 'link', value: marcador, href });
    ultimo = coincidencia.index + marcador.length;
  }

  if (ultimo < sentence.length) {
    partes.push({ kind: 'text', value: sentence.slice(ultimo) });
  }

  return partes;
}