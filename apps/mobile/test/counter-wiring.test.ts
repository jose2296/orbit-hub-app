import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Que el contador de un campo use el ancho con el que se va a guardar.
 *
 * Cada campo que lo pide tiene que pedir el número del contrato y no un literal.
 * Un `limit={120}` escrito a mano en un componente es un `.slice()` y un `varchar`
 * que se quedan atrás sin que nada se entere — que es exactamente como aparecieron
 * los dos 500 del bug de las longitudes.
 */

const SRC = join(import.meta.dirname, '..', 'src');
const relativo = (path: string) => path.slice(SRC.length + 1);

function sourceFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry)) {
      found.push(path);
    }
  }

  return found;
}

/**
 * El valor de un `limit={…}`, con sus llaves internas.
 *
 * Un `[^}]*` se paraba en el primer `}`, que en un ternario es el de
 * `FIELD_LIMITS["folder.name"]`, y recortaba el valor por la mitad — y el test
 * acusaba al código correcto de tener un límite escrito a mano.
 */
function valorDeLimit(source: string, desde: number): string {
  let nivel = 0;

  for (let i = desde; i < source.length; i += 1) {
    const letra = source[i];

    if (letra === '{') nivel += 1;
    else if (letra === '}') {
      nivel -= 1;
      if (nivel === 0) return source.slice(desde, i + 1);
    }
  }

  return source.slice(desde);
}

describe('ningún contador lleva un número escrito a mano', () => {
  it('todo `limit` sale de FIELD_LIMITS', () => {
    const ofensores: string[] = [];

    for (const path of sourceFiles(SRC)) {
      const source = readFileSync(path, 'utf8');

      for (const match of source.matchAll(/\blimit=\{/g)) {
        const valor = valorDeLimit(source, match.index + 'limit='.length);

        // `FIELD_LIMITS[…]` y `undefined` son las dos formas aceptables.
        if (valor === '{undefined}') continue;
        if (valor.includes('FIELD_LIMITS')) continue;

        ofensores.push(`${relativo(path)}: limit=${valor.replace(/\s+/g, ' ')}`);
      }
    }

    expect(
      ofensores,
      'un límite escrito a mano es un número que se puede quedar viejo calladamente',
    ).toEqual([]);
  });

  it('los campos con un límite en el contrato lo piden', () => {
    // Los sitios donde se escribe un nombre o un título. Si uno se queda sin
    // contador, esta lista lo dice con nombre de fichero.
    const conContador = [
      'components/lists/item-edit-sheet.tsx',
      'components/workspace/workspace-create-sheet.tsx',
      'components/folders/create-sheet.tsx',
      'app/(app)/note/[noteId].tsx',
    ];

    const sinContador = conContador.filter((ruta) => {
      const source = readFileSync(join(SRC, ruta), 'utf8');
      return !source.includes('FIELD_LIMITS');
    });

    expect(sinContador, 'estos escriben un título y no enseñan su límite').toEqual([]);
  });
});

describe('el contador no se ha puesto donde no toca', () => {
  it('el campo de contraseña no lleva contador', () => {
    // La contraseña tiene su propio límite y no es un título: un contador debajo
    // mide lo que alguien teclea al registrarse, que no es nada que nadie quiera
    // ver mientras lo escribe.
    const registro = readFileSync(join(SRC, 'app', '(auth)', 'sign-up.tsx'), 'utf8');
    const camposDePassword = [...registro.matchAll(/secureTextEntry[\s\S]{0,400}?\/>/g)];

    for (const campo of camposDePassword) {
      expect(campo[0], 'un campo de contraseña no enseña un contador de caracteres').not.toContain(
        'limit=',
      );
    }
  });
});
