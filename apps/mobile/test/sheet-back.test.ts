import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * El botón de volver, en la cabecera del sheet.
 *
 * Siete hojas con pasos, siete implementaciones distintas: cada una con su
 * `useState` de página, su propio botón de volver **abajo del formulario** y su
 * propia etiqueta. Dos lo llamaban "Cancelar" y con eso subían un paso, lo cual es
 * mentira para quien lee el botón. Una —la de exportar— no tenía ninguna: se
 * entraba y solo se salía cerrando la hoja entera.
 *
 * Aquí se comprueba lo mecánico, que es lo que se puede comprobar leyendo el
 * fuente: que la cabecera sabe llevar un control a la izquierda, y que las hojas
 * con pasos lo usan en vez de seguir con el botón de abajo.
 */

const RAIZ = join(import.meta.dirname, '..');
const src = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8');

const SHEET = src('src/components/ui/sheet.tsx');
const DICCIONARIO = src('src/lib/i18n/dictionaries.ts');

/** Las hojas con más de una página. */
const CON_PASOS = [
  'src/components/lists/item-edit-sheet.tsx',
  'src/components/lists/list-menu-sheet.tsx',
  'src/components/workspace/workspace-menu-sheet.tsx',
  'src/components/notes/note-menu-sheet.tsx',
  'src/components/notes/template-menu-sheet.tsx',
  'src/components/folders/create-sheet.tsx',
];

/**
 * Los que **no** van en la lista de arriba, y por qué — porque la lista se escribió
 * primero y esto es lo que se encontró al comprobarla.
 *
 * `share-panel.tsx` no monta un `Sheet`: es el cuerpo de la hoja de espacio, y sus
 * páginas ("people", "invite", "link") viven **dentro** de una hoja que ya tiene su
 * propia flecha. Un botón aquí sube un nivel y la flecha sube otro, y no son el
 * mismo nivel: la flecha vuelve a las opciones del espacio, este vuelve a la lista
 * de gente. Dos niveles distintos, dos controles distintos, y por eso se queda.
 *
 * `workspace-menu-sheet.tsx` y `list-menu-sheet.tsx` montan hojas con paginas y
 * llevan `onBack`; estan en la lista de arriba.
 */

describe('la cabecera del sheet sabe volver', () => {
  it('acepta un onBack, y sin el no pinta nada', () => {
    expect(SHEET).toMatch(/onBack\?:\s*\(\)\s*=>\s*void/);
  });

  it('el control va a la izquierda del titulo', () => {
    // `styles.close` lleva `marginLeft: "auto"`, que echa la ✕ a la derecha. El
    // botón de volver se pinta **antes** del bloque de texto, en la misma fila.
    expect(SHEET).toMatch(/onBack[\s\S]{0,400}chevron-back/);
  });

  it('usa una etiqueta propia, y no la de cerrar', () => {
    // Un "cerrar" que vuelve un paso es el mismo bug que el "Cancelar" que hacia
    // de volver: el boton no dice lo que hace.
    expect(SHEET).toContain('common.back');
    expect(DICCIONARIO).toContain('"common.back"');
  });

  it('no monta el control cuando no hay a donde volver', () => {
    expect(SHEET).toMatch(/\{onBack \?/);
  });
});

describe('las hojas con pasos lo usan', () => {
  it('todas las que tienen mas de una pagina pasan onBack', () => {
    /*
     * JSX, so `onBack={` and not `onBack=`.

     * And **not** `onBack={undefined}`. That version of this test was written as
     * `/onBack=\{\s*[^}]/` and it passed a sheet whose arrow had been taken away
     * completely, because `onBack={undefined}` is still an `onBack={` followed by
     * a character. Caught by breaking it on purpose and running this again, which
     * is the only way to know a guard guards.
     */
    const sinBoton = CON_PASOS.filter((ruta) => {
      const fuente = src(ruta);

      return !/\bonBack=\{/.test(fuente) || /\bonBack=\{undefined\}/.test(fuente);
    });

    expect(sinBoton, 'una hoja con pasos sin volver arriba se sale cerrando').toEqual([]);
  });

  it('la de exportar deja de ser un callejon sin salida', () => {
    // El bug concreto que se vio: al entrar en exportar solo la ✕ cerraba la hoja
    // entera, sin vuelta atras. La condicion no es "esta pagina tiene onBack" sino
    // "el arrow existe en cualquier pagina que no sea la primera", asi que se
    // comprueba que el onBack se calcula y no que cada pagina lo pase.
    const hoja = src('src/components/lists/list-menu-sheet.tsx');

    expect(hoja).toMatch(/onBack=\{\s*\/\*[\s\S]{0,900}?\*\/\s*page === "options" \? undefined : \(\) => setPage\("options"\)/);
  });

  it('volver ya no dice "Cancelar"', () => {
    // "Cancelar" saliendo del formulario y "Cancelar" bajando un paso son dos
    // botones iguales con dos efectos distintos, y el que bajaba un paso estaba
    // etiquetado como el que no lo hacia.
    const conCancelarComoVolver = CON_PASOS.filter((ruta) => {
      const fuente = src(ruta);
      return /common\.cancel[\s\S]{0,200}onBack|onBack[\s\S]{0,200}common\.cancel/.test(fuente);
    });

    expect(conCancelarComoVolver).toEqual([]);
  });
});
