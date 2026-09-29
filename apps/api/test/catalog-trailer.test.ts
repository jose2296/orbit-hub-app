import { describe, expect, it } from 'vitest';

import { elegirTrailer } from '../src/modules/catalogs/trailer.js';

/**
 * Which video becomes "the trailer".
 *
 * TMDB does not send one video; it sends every cut that anybody ever uploaded,
 * in no order that means anything. So the answer here is a decision, and a
 * decision that is wrong is a film whose trailer is somebody's phone recording
 * of the audience — which looks like the app is broken rather than like it
 * picked badly.
 */
const v = (over: Partial<{ key: string; site: string; type: string; official: boolean }>) => ({
  key: 'abc123',
  site: 'YouTube',
  type: 'Trailer',
  official: false,
  ...over,
});

describe('elegir el trailer', () => {
  it('sin videos no hay trailer, y eso es una respuesta', () => {
    expect(elegirTrailer(undefined)).toBeNull();
    expect(elegirTrailer([])).toBeNull();
  });

  it('descarta lo que no es de YouTube, porque la app no lo puede reproducir', () => {
    const videos = [
      v({ key: 'vimeo1', site: 'Vimeo' }),
      v({ key: 'yt1' }),
    ];
    expect(elegirTrailer(videos)).toBe('yt1');
  });

  it('un trailer de otro sitio y un teaser de YouTube: gana el teaser', () => {
    const videos = [
      v({ key: 'vimeo1', site: 'Vimeo', official: true }),
      v({ key: 'teaser', type: 'Teaser' }),
    ];
    expect(elegirTrailer(videos)).toBe('teaser');
  });

  it('el oficial gana al trailer que no lo es', () => {
    const videos = [
      v({ key: 'reupload', official: false }),
      v({ key: 'oficial', official: true }),
    ];
    expect(elegirTrailer(videos)).toBe('oficial');
  });

  it('el trailer oficial gana al teaser oficial', () => {
    const videos = [
      v({ key: 'teaserOficial', type: 'Teaser', official: true }),
      v({ key: 'trailerOficial', type: 'Trailer', official: true }),
    ];
    expect(elegirTrailer(videos)).toBe('trailerOficial');
  });

  it('con un trailer no oficial y un teaser oficial, el trailer no oficial', () => {
    /* La preferencia es por tipo primero dentro de la marca de "oficial": un
       teaser es un adelanto y un trailer es la pelicula. */
    const videos = [
      v({ key: 'teaserOficial', type: 'Teaser', official: true }),
      v({ key: 'trailerCasual', type: 'Trailer', official: false }),
    ];
    expect(elegirTrailer(videos)).toBe('trailerCasual');
  });

  it('sin trailer ni teaser, el primero de YouTube, antes que nada que se quede sin boton', () => {
    const videos = [
      v({ key: 'clip', type: 'Clip' }),
      v({ key: 'entrevista', type: 'Featurette' }),
    ];
    expect(elegirTrailer(videos)).toBe('clip');
  });

  it('un video de YouTube sin clave no es un video', () => {
    expect(elegirTrailer([v({ key: '' })])).toBeNull();
  });
});
