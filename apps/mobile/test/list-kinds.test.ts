import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { listKindSchema } from '@orbit-hub/contracts';

import { dictionaries } from '@/lib/i18n/dictionaries';
import {
  LIST_KIND_ICON,
  LIST_KIND_LABEL,
  LIST_KIND_ORDER,
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

describe('los tres selectores de tipo leen la misma fuente', () => {
  const SRC = join(import.meta.dirname, '..', 'src');

  /**
   * The three, by file: the form of the lists screen, the sheet that creates inside
   * a folder and the menu of a folder.
   *
   * They are read **out of the source** because that is the only thing that can tell
   * what a picker offers. None of them is rendered here, and a test that imports a
   * component to read its props is testing the component rather than the agreement.
   */
  const PICKERS = [
    'app/(app)/lists.tsx',
    'components/folders/create-sheet.tsx',
    'components/folders/folder-menu-sheet.tsx',
  ];

  it('cada uno saca sus tipos de lib/lists/kind, y no de una copia suya', () => {
    // The count is part of the claim: three files, and a guard that quietly read
    // two of them would be green and wrong.
    expect(PICKERS).toHaveLength(3);

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