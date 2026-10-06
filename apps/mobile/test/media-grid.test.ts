import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DRAWER_BREAKPOINT } from '../src/lib/layout/measure';

/**
 * Las películas en un escritorio no son un carrusel.
 *
 * El carrusel es **una pantalla por póster**, con `pagingEnabled` y un salto por
 * pantalla: un dedo, un vídeo corto. En un monitor eso son 1400 puntos de ancho para
 * un póster de 300 y una banda vacía a cada lado, y para llegar a la película número
 * veinte hay veinte arrastres. Es la complaint literal del issue —"si no solo veo
 * 1"—, y es real.
 *
 * En un móvil el carrusel sigue siendo lo correcto: hay un pulgar y una pantalla. El
 * cambio es **solo para el ancho**, y el ancho ya tiene una respuesta en este repo:
 * `useIsWide`, con `DRAWER_BREAKPOINT` detrás. No se inventa un número aquí.
 */
const SRC = join(import.meta.dirname, '..', 'src');
const src = (ruta: string) => readFileSync(join(SRC, ruta), 'utf8');

/** Comments out, so an explanation of the number cannot satisfy the assertion. */
const sinComentarios = (texto: string) => texto.replace(/\/\*[\s\S]*?\*\//g, '');

const PANTALLA = sinComentarios(src('components/media/media-list-screen.tsx'));

describe('en un escritorio, las pelis se ven de golpe', () => {
  it('la pantalla de medios decide con `useIsWide`', () => {
    // Y no con `innerWidth` leído al renderizar: una pantalla que mide su propia
    // forma mientras se dibuja es una pantalla que dibuja la forma que midió hace
    // una hora. El hook lleva el listener — ver `lib/layout/width.ts`.
    expect(PANTALLA).toContain('useIsWide');
  });

  it('y usa el carrusel en estrecho y el grid en ancho', () => {
    // El `?` y el paréntesis: el ternario envuelve el JSX en paréntesis porque son
    // varias líneas. Sin el `\(?` la prueba falla contra el código correcto.
    expect(PANTALLA).toMatch(/ancho\s*\?\s*\(?\s*<MediaPosterGrid/);
    expect(PANTALLA).toContain('<VerticalMediaCarousel');
  });

  it('el grid son tres columnas, y el número está en el sitio de los números', () => {
    const grid = sinComentarios(src('components/media/media-poster-grid.tsx'));

    expect(grid).toContain('export const MEDIA_GRID_COLUMNS = 3');

    // Y que el ancho venga de `measure`, no de un 900 repetido en el componente.
    expect(PANTALLA).not.toMatch(/>=\s*900\b/);
    expect(DRAWER_BREAKPOINT).toBe(900);
  });

  it('el carrusel no se toca: sigue siendo el que hay por debajo del ancho', () => {
    // El issue pide un grid en escritorio, no un grid en todas partes. En un móvil
    // el carrusel es mejor —un pulgar y una pantalla— y cambiarlo sería tirar algo
    // que funciona.
    const carrusel = sinComentarios(src('components/media/vertical-media-carousel.tsx'));

    expect(carrusel).toContain('pagingEnabled');
    expect(carrusel).toContain('VerticalMediaItem');
  });
});

describe('el grid y el carrusel cuentan lo mismo', () => {
  it('los dos aceptan la misma forma de elemento', () => {
    // Si el grid declara su propia forma y la pantalla convierte a dos, hay dos
    // listas de campos que se pueden quedar sin sincronizar — y la que se queda es
    // la que nadie mira. El grid declara la del carrusel y la importa.
    const grid = sinComentarios(src('components/media/media-poster-grid.tsx'));

    expect(grid).toContain('VerticalMediaItem');

    const carrusel = sinComentarios(src('components/media/vertical-media-carousel.tsx'));
    expect(carrusel).toContain('export interface VerticalMediaItem');
  });

  it('y el grid reutiliza la imagen compartida, no una suya', () => {
    // El póster comparte nombre con la portada del detalle, y ese nombre es lo que
    // hace que la transición exista. Un `<Image>` propio en el grid no rompe la
    // transición de las otras pantallas: rompe la de esta, y en silencio.
    const grid = sinComentarios(src('components/media/media-poster-grid.tsx'));

    expect(grid).toContain('sharedCoverStyle');
  });

  it('el menú es hermano del póster y no un botón dentro de otro botón', () => {
    /*
     * Este se lo pegó el grid el primer día y lo avisó la captura de 1440, no un test:
     * el aviso rojo de React —`<button> cannot contain a nested button`— y el menú
     * abriendo la película de debajo.
     *
     * Lo interesante es que el archivo **tenía el comentario** que lo prohíbe, copiado
     * del carrusel, y estaba en el sitio del anidamiento: se copió la explicación y
     * se hizo justo lo contrario en la línea siguiente. Un comentario no atrapa nada, así
     * que se cuenta la estructura.
     */
    const grid = sinComentarios(src('components/media/media-poster-grid.tsx'));

    // Los dos `Pressable` que se abren, en orden, con la posición del que abre cada uno.
    const abren = [...grid.matchAll(/<Pressable/g)].map((m) => m.index!);
    const cierran = [...grid.matchAll(/<\/Pressable>/g)].map((m) => m.index!);

    expect(abren.length).toBe(2);
    expect(cierran.length).toBe(2);

    /*
     * La regla es: **el que cierra primero es el que cierra último en abrir, si son
     * hermanos**. Anidados, el botón de dentro se cierra antes que el de fuera, que es
     * justo el error.
     *
     * `cierran[0] < abren[1]` dice eso. La primera versión de esta prueba pedía
     * `>` —creyendo que el cierre del primero tenía que venir después de la apertura
     * del segundo— y falló **contra el código correcto** mientras el código roto pasaba:
     * un test que solo encoge el error en vez de encontrarlo.
     */
    expect(cierran[0]!).toBeLessThan(abren[1]!);
  });
});