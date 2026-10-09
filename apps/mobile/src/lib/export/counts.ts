import type { AccountExport, CollectionExport, ListExport } from '@orbit-hub/contracts';

import type { Translate } from '@/lib/i18n';
import { pluralKey } from '@/lib/i18n/plural';

/**
 * La frase con los numeros de una exportacion, y la cadena vacia cuando no hay.
 *
 * Vive aqui y no en la hoja que lo pinta por la misma razon que
 * `lib/export/errors.ts` no vive en un componente: **la decision de que cifras se
 * ensenan es lo que se confunde**, y confundirse no es un error de compilar, es un
 * `undefined` —o una llave suelta— en medio de la pantalla. Es media pagina de
 * codigo y se prueba de verdad, contra el diccionario de verdad.
 *
 * Puro del todo, y sin `react-native`: solo el contrato, `pluralKey` y la funcion
 * de traducir que le pasa el llamante. Un modulo que llega a `Platform` arrastra
 * el stub del telefono a un test de Node, que es justo lo que este repositorio no
 * tiene.
 *
 * El `t` entra como argumento y no se importa del provider a proposito: la hoja
 * tiene el suyo, con el idioma que esta puesto ahora, y un modulo que Monta el
 * provider para traducir una frase es un modulo que ya no se puede probar.
 *
 * Y el orden de las ramas **es el orden de exclusividad**, no una jerarquia: cada
 * `counts` pide claves que los otros no tienen, asi que un corte equivocado cae en
 * la rama de al lado con un `undefined` en medio. Los tres cortes estan probados en
 * `test/export.test.ts` contra el diccionario de verdad.
 */
export function exportCountsLine(
  counts:
    | AccountExport['counts']
    | CollectionExport['counts']
    | ListExport['counts']
    | null,
  t: Translate,
): string {
  /*
    Sin sobre no hay nada que decir, y se dice **nada**: ni un cero, ni un
    separador, ni una linea vacia.

    Un CSV son filas y no lleva sobre, asi que `counts` es `null` para el. La cadena
    vacia es lo que la hoja recibe sin dibujar una linea de la que no hay nada que
    contar, y un `·` al final de un panel —o un "0" que el fichero no tiene— es
    exactamente el fallo que esto evita.
  */
  if (!counts) return '';

  /*
    De quien son los numeros, y no si los hay.

    Los tres sobres traen `counts`, asi que la pregunta no es "hay cifras" sino
    "de quien son". Y la respuesta la da una clave: `lists` esta en los `counts` de
    la cuenta y no en los de una lista o una coleccion, que llevan una sola.

    La cuenta dice sus tres grupos —listas, elementos y notas— porque su frase dice
    esos tres, aunque el sobre lleve siete cifras: espacios, carpetas, adjuntos y
    plantillas se cuentan igual de bien y no se ensenan, porque una linea con todo
    son cuatro numeros mas que nadie va a leer.
  */
  if ('lists' in counts) {
    return t('export.counts', {
      lists: counts.lists,
      items: counts.items,
      notes: counts.notes,
    });
  }

  /*
    Y una coleccion son **enlaces**, con la palabra del sobre y de la pantalla.

    Es el corte que se agrega con la T9 y va **antes** del de una lista, porque las
    dos son frases contadas de una sola cifra y la confusion entre ellas no se ve
    en el typecheck: `bookmarks` y `items` son dos numeros y ambos compilan. Al
    revés —esta rama despues— una coleccion caeria en `export.done` y diria "7
    elementos" de algo que son enlaces, que es un numero cierto con la palabra
    equivocada, y esa es la clase de fallo que un panel no avisa.

    El copy es `collections.count.*` y no uno nuevo de la familia `export.*`: esa
    clave **ya existe** y es la que dice cuantos enlaces tiene una coleccion en la
    pantalla, y una exportacion que dijera "7 elementos" mientras la lista de al
    lado dice "7 enlaces" seria la misma cuenta con dos palabras.
  */
  if ('bookmarks' in counts) {
    return t(pluralKey('collections.count', counts.bookmarks), {
      count: counts.bookmarks,
    });
  }

  /*
    Y una lista es items y nada mas, que es una frase contada y no una separacion
    de grupos: "7 elementos", y "1 elemento" cuando hay uno.

    Aqui es donde una lista se cairia en la frase de la cuenta si el orden de las
    ramas se invirtiera, y se veria "listas · elementos · notas" con dos de los
    tres grupos sin valor —`formatTranslation` deja el marcador tal cual cuando no
    le llega, con las llaves, asi que el fallo sale en la pantalla y no en el
    compilador.
  */
  return t(pluralKey('export.done', counts.items), { count: counts.items });
}
