import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { listKindSchema } from '@orbit-hub/contracts';

import { dictionaries } from '@/lib/i18n/dictionaries';
import {
  LIST_KIND_ICON,
  LIST_KIND_LABEL,
  LIST_KIND_ORDER,
  isManualOrderOnly,
} from '@/lib/lists/kind';

/**
 * The kinds a new list can be, and the three places that ask.
 *
 * **There are three pickers and one list, and nothing held them together.** The
 * form on the lists screen read the keys of `LIST_KIND_ICON`; the sheet that
 * creates a list inside a folder and the menu of a folder read `LIST_KIND_ORDER`.
 * The two maps are both `Record<ListKind, …>` and both were complete, so the split
 * was invisible — until a kind was added to one and not to the other and **appeared
 * in the main form and disappeared from the two sheets**, with the typecheck green.
 * That is the failure mode of `LIST_KIND_ORDER` itself, which is a `ListKind[]`:
 * nothing in the compiler notices an entry missing from it, and the only symptom is
 * a kind that cannot be chosen from two of the three doors.
 *
 * So: one source, and these tests.
 */

describe('la lista de tipos de lista es una sola', () => {
  it('LIST_KIND_ORDER ofrece todos los tipos del contrato, y el tablero entre ellos', () => {
    // The claim the compiler cannot make: `LIST_KIND_ORDER` is a `ListKind[]`, so a
    // kind that is missing from it costs nothing at build time. The two records are
    // `Record`s and a missing entry there *is* a compile error, but the order is
    // the one that can drift.
    expect([...LIST_KIND_ORDER].sort()).toEqual([...listKindSchema.options].sort());

    // And the kind this plan is about, named: "the list is complete" is satisfiable
    // by a complete list with no board in it.
    expect(LIST_KIND_ORDER).toContain('board');
  });

  it('el tablero va detras de las tareas, que es una lista de tareas con estados', () => {
    // The order is a decision and not an accident. A board sits next to the tasks
    // because that is what it is, and a picker that offers it between films and
    // books says it is a sixth kind of shelf rather than of list.
    expect(LIST_KIND_ORDER.indexOf('board')).toBe(
      LIST_KIND_ORDER.indexOf('tasks') + 1,
    );
  });

  it('los dos mapas y el orden ofrecen el mismo conjunto, sin repetir', () => {
    const orden = [...LIST_KIND_ORDER].sort();
    expect([...Object.keys(LIST_KIND_ICON)].sort()).toEqual(orden);
    expect([...Object.keys(LIST_KIND_LABEL)].sort()).toEqual(orden);
    // A repeat would draw two identical tabs and count one kind twice, which no
    // typecheck notices: both entries are legal in a `ListKind[]`.
    expect(new Set(LIST_KIND_ORDER).size).toBe(LIST_KIND_ORDER.length);
  });

  it('cada tipo tiene icono y etiqueta, y la etiqueta esta en las dos lenguas', () => {
    // `LIST_KIND_LABEL` is a `Record<ListKind, TranslationKey>` and `TranslationKey`
    // is `keyof typeof es`, so a key that is not in the dictionary does not compile
    // — but a key in `es` and not in `en` does, and then it prints raw in English.
    // `translations.test.ts` holds the general rule; this is the same claim about
    // these keys, where a missing one is a tab that says `lists.kind.board`.
    for (const kind of LIST_KIND_ORDER) {
      expect(LIST_KIND_ICON[kind]).toBeTruthy();
      const clave = LIST_KIND_LABEL[kind];
      expect(
        dictionaries.es[clave],
        `${kind} sin etiqueta en castellano`,
      ).toBeTruthy();
      expect(dictionaries.en[clave], `${kind} sin etiqueta en ingles`).toBeTruthy();
    }
  });
});

describe('los selectores de tipo leen la misma fuente', () => {
  const SRC = join(import.meta.dirname, '..', 'src');

  /**
   * The two, by file: the form of the lists screen and the sheet that creates inside
   * a folder.
   *
   * They are read **out of the source** because that is the only thing that can tell
   * what a picker offers. None of them is rendered here, and a test that imports a
   * component to read its props is testing the component rather than the agreement.
   *
   * **El tercero se fue en la T7**: el menu de una carpeta ofrecia "Crear una lista
   * aqui", y al bloque de tipos lo abria con `LIST_KIND_ORDER` dentro de una hoja
   * hermana. Ese menu ahora es la hoja unica del registro, y la fila va a la pagina
   * `create`, que todavia no esta escrita —`MenuPageId` la declara y ningun
   * componente de `components/menus/pages/` la monta—, asi que `puedeOfrecerse` la
   * filtra entera.
   *
   * O sea que **la fila existe en el registro y todavia no se pinta**, y el
   * selector de tipos vuelve con la pagina. Esta escrito con nombre en
   * `test/note-folder-menu-parity.test.ts`, porque un selector que se perdio y uno
   * que todavia no se escribio se ven igual: los dos son un menu sin la fila.
   * Cuando la pagina `create` llegue, este archivo tiene que tener **tres** otra
   * vez, y el `toHaveLength` de abajo es el que lo dice.
   */
  const PICKERS = ['app/(app)/lists.tsx', 'components/folders/create-sheet.tsx'];

  it('cada uno saca sus tipos de lib/lists/kind, y no de una copia suya', () => {
    // The count is part of the claim: two files today, and a guard that quietly read
    // one of them would be green and wrong. Subirlo a tres es trabajo de la pagina
    // `create`.
    expect(PICKERS).toHaveLength(2);

    for (const fichero of PICKERS) {
      const texto = readFileSync(join(SRC, fichero), 'utf8');
      expect(texto, `${fichero} no lee la lista de tipos`).toContain(
        'from "@/lib/lists/kind"',
      );
      // And the kinds written out: a picker that spells its six kinds inline passes
      // the import above and then offers whatever that list says, which is the split
      // this file exists to close.
      expect(texto, `${fichero} escribe su propia lista de tipos`).not.toMatch(
        /\[\s*['"]tasks['"]\s*,/,
      );
    }
  });

  it('el formulario no construye sus tipos de las claves de un mapa', () => {
    // The exact shape that started this: the form built a `Record` out of the order
    // and then read **the record's keys** for its options, which is the same data
    // twice with the two copies free to disagree. It reads the order now.
    const texto = readFileSync(join(SRC, 'app/(app)/lists.tsx'), 'utf8');
    expect(texto).not.toContain('Object.keys(LIST_KIND_ICON)');
    expect(texto).not.toContain('Object.keys(KIND_META)');
  });
});

/**
 * Los tipos en los que el orden manual es el unico que significa algo, **y la
 * diferencia con `kind === 'board'` es el motivo de que el predicado exista.**
 *
 * La version ingenua —comparar con `'board'`— responde bien para el tablero y mal
 * para las tareas, y por eso el predicado trae los dos: un tablero reparte sus
 * filas en columnas y una lista de tareas las trae en el orden que la persona puso
 * a mano. En cualquier otro tipo —peliculas, series, libros— el manual es uno mas
 * entre siete y no significa nada por si solo.
 *
 * **La lista de tipos sale del contrato y no de esta prueba**, porque un
 * `expect([...])` escrito a mano pasa igual con un tipo nuevo que nadie ha
 * pensado: `listKindSchema.options` obliga a que el tipo nuevo tenga una respuesta.
 */
describe('el orden manual y el unico que significa algo', () => {
  it('es el tablero y las tareas, y ningun otro tipo del contrato', () => {
    const deVerdad = listKindSchema.options.filter((kind) =>
      isManualOrderOnly(kind),
    );
    expect([...deVerdad].sort()).toEqual(['board', 'tasks']);
  });

  it('el tablero no basta: es mas que `kind === "board"`', () => {
    // La asercion que el predicado ingenuo no puede pasar. Con
    // `return kind === 'board'` esta linea sale `false` y la prueba se muere.
    expect(isManualOrderOnly('tasks')).toBe(true);
    expect(isManualOrderOnly('board')).toBe(true);
  });

  it('una lista que todavia no ha llegado no es de orden manual', () => {
    // `null` y `undefined` son las tres pantallas antes de que la lista llegue del
    // cache, y un predicado que devolviera `true` con `null` apagaria los seis
    // modos de una pantalla que no sabe todavia que tipo de lista esta mirando.
    expect(isManualOrderOnly(null)).toBe(false);
    expect(isManualOrderOnly(undefined)).toBe(false);
  });
});

/**
 * Quien **ofrece** los seis modos que el tablero no ofrece, leido del codigo.
 *
 * Esta suite no pinta nada —no hay `renderHook`, ni `react-test-renderer`, ni
 * jsdom—, asi que la unica forma de afirmar que `ListControls` recibe `orders`
 * vacio en un tablero es leer de donde se lo pasan. Y la segunda mitad es la
 * regresion: `isManualOrderOnly` tambien dice `tasks`, y una version de este
 * trabajo que lo aplicara a la pantalla de listas le habria quitado a una lista
 * de tareas los seis modos que siempre tuvo.
 */
describe('quien ofrece los seis modos que un tablero no ofrece', () => {
  const SRC = join(import.meta.dirname, '..', 'src');

  it('el tablero lee el predicado de lib/lists/kind', () => {
    const texto = readFileSync(join(SRC, 'app/(app)/board/[listId].tsx'), 'utf8');
    expect(texto, 'el tablero no lee la lista de tipos').toContain(
      'from "@/lib/lists/kind"',
    );
    expect(texto, 'el tablero no usa el predicado del orden manual').toContain(
      'isManualOrderOnly(',
    );
  });

  it('`orders` del tablero esta en la predicado, y no en una lista escrita a mano', () => {
    const texto = readFileSync(join(SRC, 'app/(app)/board/[listId].tsx'), 'utf8');
    // La forma de la puerta: el prop `orders` no puede recibir otra cosa que el
    // predicado y la lista de ordenes. Un tablero que escribiese `orders={[]}` pasaria
    // la comprobacion de arriba —usa el predicado en otra parte— y dejaria el
    // predicado sin Guardar nada, que es un predicado que no protege de nada.
    expect(
      texto,
      'orders={ no esta en la predicado del tablero',
    ).toMatch(/orders=\{\s*isManualOrderOnly\([\s\S]{0,200}?\?\s*\[\]\s*:/);
  });

  it('una lista de tareas sigue ofreciendo lo que siempre ofrecio', () => {
    const texto = readFileSync(
      join(SRC, 'app/(app)/list/[listId].tsx'),
      'utf8',
    );
    expect(
      texto,
      'la pantalla de listas esta aplicando el predicado y le quita los seis modos',
    ).not.toContain('isManualOrderOnly');
    // Y los sigue ofreciendo: las siete filas de `ORDER_MODES` llegan a `orders`.
    expect(texto, 'la pantalla de listas dejo de ofrecer ordenes').toContain(
      'orders={opcionesDeOrden()}',
    );
  });
});
