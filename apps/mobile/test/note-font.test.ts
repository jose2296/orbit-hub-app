import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { NOTE_BODY_FONT } from '../src/theme/tokens';

/**
 * La letra de las notas.
 *
 * El editor era **el único sitio de la app que no fijaba la familia**. Usaba
 * `theme.typography.body` para el tamaño y para el color, y para la letra se quedaba
 * con la de la plataforma —que son tres: Roboto en Android, San Francisco en iOS, y la
 * del navegador en la web, que tampoco es una sola—. El propio archivo tenía un
 * comentario diciendo que sin esto "la nota se leía como otra app en vez de como una
 * pantalla de esta". El tamaño ya estaba resuelto; la letra se había quedado sin hacer,
 * y por eso la misma nota se veía distinta en cada una de las tres plataformas.
 *
 * Estos tests miran el **token**, no la pantalla, porque lo que hay que comprobar es
 * que la pila sea de las del sistema y que llegue al editor. Que se vea bien o mal es
 * cosa de los ojos.
 */

const EDITOR = readFileSync(
  join(import.meta.dirname, '..', 'src/components/notes/note-editor.tsx'),
  'utf8',
);

describe('la familia de la nota', () => {
  it('es una pila, y no una fuente que haya que cargar', () => {
    // Una fuente empaquetada son megabytes en el bundle y un salto visible mientras
    // carga —y en el editor de notas eso es lo primero que se ve al abrir—. Una pila
    // del sistema no cuesta nada y está en las tres plataformas.
    expect(NOTE_BODY_FONT).toContain(',');
    expect(NOTE_BODY_FONT.trim().endsWith('serif')).toBe(true);

    // Y no lleva `@font-face` ni un `require` de un fichero de fuente.
    expect(NOTE_BODY_FONT).not.toMatch(/@font-face|\.ttf|\.otf|\.woff/);
  });

  it('cubre las tres plataformas y no solo una', () => {
    /*
     * Una pila con una sola familia es una familia que no existe en uno de los tres
     * sitios, y el navegador baja por la lista sin avisar: se dibuja con la del sistema
     * y el resultado es exactamente el bug que esto arregla. Se comprueba una marca de
     * cada plataforma.
     */
    expect(NOTE_BODY_FONT).toMatch(/New York|Georgia/); // iOS y macOS
    expect(NOTE_BODY_FONT).toMatch(/Noto Serif|Roboto Serif/); // Android
    expect(NOTE_BODY_FONT).toMatch(/Segoe UI|Cambria|Times New Roman/); // escritorio
  });

  it('el editor la usa, y no se queda en la plataforma otra vez', () => {
    expect(EDITOR).toContain('NOTE_BODY_FONT');
    expect(EDITOR).toMatch(/fontFamily:\s*NOTE_BODY_FONT/);
  });

  it('el tamaño y el interlineado siguen viniendo de la escala', () => {
    /*
     * La familia no puede comerse la escala. Esto se Alecance de #26 —que subió `body`
     * a 17/24 para todo el app— y un token de fuente nuevo es el sitio donde eso se
     * deshace sin que nadie lo note.
     */
    expect(EDITOR).toMatch(/fontSize:\s*type\.body\.fontSize/);
    expect(EDITOR).toMatch(/lineHeight:\s*type\.body\.lineHeight/);
  });
});

describe('solo el cuerpo de la nota', () => {
  it('la interfaz no usa la serifa', () => {
    // Un rótulo en serif es un rótulo con adorno, y en esta app casi todo son rótulos.
    // La serifa es para el texto que se lee entero, que es la nota y nada más.
    const texto = readFileSync(
      join(import.meta.dirname, '..', 'src/components/ui/text.tsx'),
      'utf8',
    );

    expect(texto).not.toContain('NOTE_BODY_FONT');
  });
});