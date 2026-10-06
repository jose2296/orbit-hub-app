import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LIST_KIND_HINT, LIST_KIND_ICON, LIST_KIND_ORDER } from '../src/lib/lists/kind';

/**
 * El tipo de una lista: cinco pastillas o una página.
 *
 * Eran **cinco `Segmented` con la etiqueta y nada más**, y dos de ellas se llamaban
 * casi igual—"Películas" y "Películas y series"— con el mismo icono. En una pastilla
 * de ancho variable eso son dos controles que hay que leer para distinguirlos, y el
 * que se parece a otro no se parece por accidente: dice exactamente lo mismo con tres
 * palabras más.
 *
 * Lo que hay ahora es **una página de opciones con icono y descripción**, que es la
 * misma forma que la primera página de esta misma hoja —la de "qué vas a crear"—. No
 * es un control nuevo: es el mismo, con una página más. Y cada tipo dice para qué sirve,
 * que en una pastilla no cabe y en una página sí.
 *
 * **La pastilla no se borra del sitio de donde está**: `Segmented` se usa en otros
 * sitios y esta hoja no es la dueña de él.
 */

const SRC = join(import.meta.dirname, '..', 'src');
const src = (ruta: string) => readFileSync(join(SRC, ruta), 'utf8');
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '');

const HOJA = sinComentarios(src('components/folders/create-sheet.tsx'));

describe('los tipos se eligen en una página', () => {
  it('la hoja no usa `Segmented` para el tipo', () => {
    expect(HOJA).not.toContain('Segmented');
    expect(HOJA).not.toContain('import { Segmented }');
  });

  it('y la página se construye con `LIST_KIND_ORDER`, el mismo orden de antes', () => {
    // El orden importa: cine y serie juntos van juntos, y un selector que los separa
    // hace creer que son la misma lista partida en dos.
    expect(HOJA).toContain('LIST_KIND_ORDER');
    // `board` va justo detrás de `tasks`: es la misma clase de cosa, con otra forma.
    expect(LIST_KIND_ORDER).toEqual([
      'tasks',
      'board',
      'movies',
      'series',
      'movies_and_series',
      'books',
    ]);
  });

  it('cada opción lleva icono y descripción, y no solo el nombre', () => {
    // `LIST_KIND_ICON` ya existía para las filas y el carrusel; aquí se usa el mismo,
    // que es lo que hace que un tipo con icono en un sitio y sin icono en otro no
    // aparezca.
    expect(HOJA).toContain('LIST_KIND_ICON');
    expect(HOJA).toContain('LIST_KIND_HINT');
    expect(HOJA).toContain('LIST_KIND_LABEL');
  });
});

describe('todos los tipos tienen icono, nombre y descripción', () => {
  it('y los tres mapas cubren los mismos tipos', () => {
    const orden = [...LIST_KIND_ORDER].sort();
    const icono = Object.keys(LIST_KIND_ICON).sort();
    const pista = Object.keys(LIST_KIND_HINT).sort();

    expect(icono).toEqual(orden);
    expect(pista).toEqual(orden);
  });

  it('y cada descripción está en los dos diccionarios', () => {
    /*
     * Un tipo con descripción en español y no en inglés es un tipo que en inglés
     * enseña el nombre solo y vuelve a ser lo que era. Se comprueba la clave entera en
     * el fichero, que es donde se escribe.
     */
    const diccionario = src('lib/i18n/dictionaries.ts');

    for (const kind of LIST_KIND_ORDER) {
      const clave = `"${LIST_KIND_HINT[kind]}"`;
      const apariciones = diccionario.split(clave).length - 1;

      expect(apariciones, `${clave} debería estar en español y en inglés`).toBe(2);
    }
  });

  it('y ninguna descripción está vacía', () => {
    const diccionario = src('lib/i18n/dictionaries.ts');

    for (const kind of LIST_KIND_ORDER) {
      const linea = diccionario
        .split('\n')
        .find((l) => l.includes(`"${LIST_KIND_HINT[kind]}"`));

      expect(linea, `${kind} sin descripción`).toBeTruthy();

      /*
       * El valor va de `": "` al final de la línea, y **no** partiendo por todos los
       * dos puntos. La primera versión de esto usaba `split(':')[1]` y falló con
       * "expected 8 to be greater than 10" contra `"Un cine: carátulas, año y si la
       * has visto."` —que contiene dos puntos—: leía "Un cine" y lo tomaba por una
       * descripción de ocho letras. El dato estaba bien y la prueba lo acortaba.
       */
      const valor = linea!.slice(linea!.indexOf('": ') + 3).replace(/",?$/, '').trim();

      expect(valor.length, `${kind}: "${valor}"`).toBeGreaterThan(10);
    }
  });
});