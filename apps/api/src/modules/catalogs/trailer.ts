import { z } from 'zod';

/**
 * The videos TMDB knows about, and the shape they come in.
 *
 * Optional and permissive on purpose: TMDB adds a field to this object without
 * asking, and a schema that insists on the exact list would start refusing to
 * draw a poster the day they did.
 */
export const tmdbVideoSchema = z.object({
  key: z.string(),
  site: z.string().optional(),
  type: z.string().optional(),
  official: z.boolean().optional(),
});

export const tmdbVideosSchema = z
  .object({ results: z.array(tmdbVideoSchema) })
  .nullish();

/**
 * Which of a title's videos is the one to show, and why it is this one.
 *
 * TMDB sends every cut ever uploaded: five trailers, two teasers, a blooper
 * reel and somebody's phone recording of the audience. Taking the first would
 * make the trailer depend on upload order.
 *
 * The order of the preferences, and the reason for each:
 *
 * 1. **On YouTube.** Any other site is a video this app cannot play, and a
 *    button that opens a page somewhere else is a button with a surprise.
 * 2. **Marked official by TMDB.** They moderate this field; "official" is the
 *    closest thing to a publisher's own trailer.
 * 3. **A trailer over a teaser.** A teaser is a promise of a film; the trailer
 *    is the film. When only a teaser exists, the teaser is still shown, because
 *    a title with no button is a title that looks like it has nothing to play.
 *
 * And the official one wins over the unofficial *trailer*, because an unofficial
 * trailer is usually a re-upload with an intro and a watermark somebody else's.
 */
export function elegirTrailer(
  videos: z.infer<typeof tmdbVideoSchema>[] | undefined,
): string | null {
  const deYoutube = (videos ?? []).filter((video) => video.site === 'YouTube' && video.key);
  if (deYoutube.length === 0) return null;
  const oficial = deYoutube.find(
    (video) => video.official === true && video.type === 'Trailer',
  );
  if (oficial) return oficial.key;
  const trailer = deYoutube.find((video) => video.type === 'Trailer');
  if (trailer) return trailer.key;
  const teaser = deYoutube.find((video) => video.type === 'Teaser');
  return teaser?.key ?? deYoutube[0]?.key ?? null;
}
