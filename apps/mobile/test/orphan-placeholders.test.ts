import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Un placeholder no puede quedar sin conectar.
 *
 * Las tres claves de este fichero que nadie usaba estaban **traducidas a los dos
 * idiomas** y muertas: `items.titlePlaceholder` ("Comprar pan, Ver Dune, Leer…"),
 * `filters.searchPlaceholder` ("Pan, tomate, Mercadona…") y
 * `share.emailPlaceholder` ("nombre@correo.com"). Las tres tenían mejor texto que
 * el que estaba en pantalla, lo que quiere decir que alguien las mejoró y se
 * olvidó de ponerlas.
 *
 * Y la consecuencia se vio en el sitio que más se abre: **el campo de título de
 * una tarea no tenía ejemplo**, porque la clave que se lo daba estaba a un
 * `import` de distancia y no conectada.
 *
 * Es la clase de fallo que no da ningún error: una traducción existe, el typecheck
 * pasa, la app arranca y el campo aparece vacío.
 */
const RAIZ = join(import.meta.dirname, '..');
const SRC = join(RAIZ, 'src');

function todoElSrc(dir: string): string {
  return readdirSync(dir)
    .flatMap((nombre) => {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) return [todoElSrc(ruta)];
      if (!ruta.endsWith('.tsx') && !ruta.endsWith('.ts')) return [''];
      return [readFileSync(ruta, 'utf8')];
    })
    .join('\n');
}

describe('ningún placeholder se queda sin conectar', () => {
  const diccionario = readFileSync(join(SRC, 'lib/i18n/dictionaries.ts'), 'utf8');
  const codigo = todoElSrc(SRC);

  // `[1]` sin `!` porque `noUncheckedIndexedAccess` puede moverlo a
  // `string | undefined`, y un array de eso no es un array de claves.
  const placeholders = [...diccionario.matchAll(/^\s*"([\w.]*Placeholder)":/gm)]
    .map((m) => m[1])
    .filter((k): k is string => typeof k === 'string');

  it('el diccionario tiene placeholders que mirar', () => {
    // Un test que pasa porque no encuentra nada también pasa cuando su regex está
    // rota. Que la lista no esté vacía es la primera mitad de la comprobación.
    expect(placeholders.length).toBeGreaterThan(8);
  });

  it('ninguna clave de placeholder está escrita y sin usar', () => {
    const huerfanas = placeholders.filter(
      (clave) =>
      !new RegExp(`t\\(\\s*['"]${clave.replace(/\./g, '\\.')}['"]`).test(codigo),
    );

    expect(
      huerfanas,
      'una clave de placeholder escrita y traducida que nadie usa es un campo vacío en pantalla',
    ).toEqual([]);
  });

  it('el título de una tarea dice cómo se escribe uno', () => {
    // El caso concreto que se reportó, y no por el diccionario sino por el
    // componente: es el campo que más se abre de la app.
    const hoja = readFileSync(join(SRC, 'components/lists/item-edit-sheet.tsx'), 'utf8');
    const campoNombre = hoja.match(/<TextField\b[\s\S]*?testID="item-name"[\s\S]*?\/>/)?.[0] ?? '';

    expect(campoNombre, 'el campo de título tiene que llevar su ejemplo').toContain(
      'placeholder={t("items.titlePlaceholder")}',
    );
  });

  it('el campo para invitar es de correo y lo dice', () => {
    // Decía "Nombre o correo" en un campo donde solo se escribe un correo, y la
    // clave del correo llevaba tiempo escrita sin usarse.
    const panel = readFileSync(join(SRC, 'components/workspace/share-panel.tsx'), 'utf8');
    expect(panel).toContain('placeholder={t("share.emailPlaceholder")}');
  });
});