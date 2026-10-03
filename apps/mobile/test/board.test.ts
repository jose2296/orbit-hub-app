import { describe, expect, it } from 'vitest';

import {
  MAX_BOARD_STATES,
  boardStatesSchema,
  stateOf,
} from '@orbit-hub/contracts';
import type {
  BoardState,
  BoardStates,
  ItemIconColor,
  ListItem,
} from '@orbit-hub/contracts';

import {
  BOARD_COLUMN_MIN_WIDTH,
  BOARD_SINGLE_COLUMN_BELOW,
  canDeleteState,
  columnLayout,
  columnOffset,
  countInState,
  defaultStates,
  editState,
  moveState,
  newState,
  removeState,
  renumberWithinState,
  tasksInState,
} from '../src/lib/lists/board';

/**
 * The rules of a board, as pure functions.
 *
 * Everything a board does to a task is decided by how a row's `stateId` is
 * resolved against the list's `states`, and that decision is invisible when it is
 * wrong: an orphan task is not an error, it is a card that is not in any column.
 * So the rules live here, where they can be read, and the screen only draws the
 * answers.
 */

function itemDe(partial: Partial<ListItem> & { id: string }): ListItem {
  return {
    listId: 'l1',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    role: 'editor',
    shared: false,
    deletedAt: null,
    title: 'Tarea',
    position: 0,
    completed: false,
    stateId: null,
    priority: 'none',
    icon: null, iconStyle: 'outline' as const, iconColor: 'neutral' as const,
    tags: [],
    externalId: null,
    metadata: null,
    annotation: null,
    ...partial,
  };
}

function estadoDe(partial: Partial<BoardState> & { id: string }): BoardState {
  return { title: partial.id.toUpperCase(), color: 'neutral', ...partial };
}

function estadosDe(...ids: string[]): BoardStates {
  return ids.map((id) => estadoDe({ id }));
}

/**
 * A column read off the array, without the `?.` that `noUncheckedIndexedAccess`
 * forces on every `states[0]`, so the tests read as the rule they are about and a
 * list that lost a column fails here instead of quietly returning undefined.
 */
function columna(states: BoardStates, index: number): BoardState {
  const state = states[index];
  if (!state) throw new Error(`the test needs a state at index ${index}`);
  return state;
}

const primero = (states: BoardStates): BoardState => columna(states, 0);

/** How many of `items` are drawn somewhere on this board. */
function contadasEnElTablero(items: ListItem[], states: BoardStates): number {
  return states.reduce(
    (total, state) => total + countInState(items, states, state.id),
    0,
  );
}

describe('una tarea sin estado cae en el primero', () => {
  it('null y un id que no existe se pintan en el primero', () => {
    // An id that is not in the list is not a theory: another device deleted the
    // state and the pull brought the row back. If this answers null instead of
    // the first state, those tasks disappear off the board without a word.
    const states = defaultStates();
    const item = itemDe({ id: 'nueva', stateId: null });
    expect(stateOf(states, item.stateId)?.id).toBe(primero(states).id);
    expect(stateOf(states, 'borrado-en-otro-dispositivo')?.id).toBe(primero(states).id);
  });

  it('y sale en su columna, no en ninguna', () => {
    // The expensive half of the same rule. Comparing a row against its own
    // `stateId` looks like the same thing and is not: an orphan matches no
    // column, so the board renders without it and nothing anywhere fails. The
    // only place this shows up is the count that has to add up.
    const states = defaultStates();
    const items = [
      itemDe({ id: 'nula', stateId: null }),
      itemDe({ id: 'huerfana', stateId: 'borrado-en-otro-dispositivo' }),
      itemDe({ id: 'wip', stateId: columna(states, 2).id, position: 4 }),
    ];
    expect(
      tasksInState(items, states, primero(states).id).map((i) => i.id),
    ).toEqual(['nula', 'huerfana']);
    expect(contadasEnElTablero(items, states)).toBe(items.length);
  });
});

describe('contar incluye las nulas cuando el estado es el primero', () => {
  it('sin esto, borrar el primero las haria saltar solas', () => {
    const states = defaultStates();
    const items = [
      itemDe({ id: 'nula', stateId: null }),
      itemDe({ id: 'ready', stateId: columna(states, 1).id }),
    ];
    // The first one takes the nulls; the second only takes its own.
    expect(countInState(items, states, primero(states).id)).toBe(1);
    expect(countInState(items, states, columna(states, 1).id)).toBe(1);
  });

  it('y tambien las que apuntan a un estado que ya no esta', () => {
    // The count beside a column is what the delete sheet asks before deleting it,
    // and the "Ready 0" of a column that three orphans are drawn in is how they
    // get deleted without a word.
    const states = defaultStates();
    const items = [
      itemDe({ id: 'huerfana-1', stateId: 'borrado' }),
      itemDe({ id: 'huerfana-2', stateId: 'borrado' }),
      itemDe({ id: 'backlog', stateId: primero(states).id }),
    ];
    expect(countInState(items, states, primero(states).id)).toBe(3);
    expect(countInState(items, states, columna(states, 1).id)).toBe(0);
  });
});

describe('una lista sin columnas no tiene nada que dibujar', () => {
  it('todo kind que no sea tablero lleva el array vacio y no inventa una columna', () => {
    // A list that is not a board arrives with `states: []`, and every list of that
    // kind has one. Reading a column out of it would mean inventing a board in
    // every list the app has.
    const states: BoardStates = [];
    const items = [
      itemDe({ id: 'nula', stateId: null }),
      itemDe({ id: 'ajena', stateId: 'lo-que-sea' }),
    ];
    expect(tasksInState(items, states, 'lo-que-sea')).toEqual([]);
    expect(tasksInState(items, states, null)).toEqual([]);
    expect(countInState(items, states, null)).toBe(0);
  });
});

describe('los estados por defecto', () => {
  it('son los cuatro del spec, en su orden y con sus colores', () => {
    // The colours are the icon palette and the order is the order of the
    // columns, so this array is read left to right by the board header and both
    // facts are the same fact.
    expect(defaultStates().map((s) => [s.title, s.color])).toEqual([
      ['Backlog', 'neutral'],
      ['Ready', 'blue'],
      ['WIP', 'amber'],
      ['Done', 'green'],
    ]);
  });

  it('con un id distinto en cada columna', () => {
    // Two columns sharing an id is a board where a rename in one moves the tasks
    // of the other.
    const ids = defaultStates().map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('y distintos otra vez en la siguiente llamada', () => {
    // Two boards made in a row must not share columns: the states are minted at
    // the moment the board is created, never once and reused.
    const uno = defaultStates();
    const otro = defaultStates();
    const compartidos = uno
      .map((s) => s.id)
      .filter((id) => otro.some((state) => state.id === id));
    expect(compartidos).toEqual([]);
  });
});

describe('anadir un estado', () => {
  it('nace neutro, con id propio, y se anade al final', () => {
    // Neutral because the person chooses the colour next; the end because a column
    // inserted in the middle moves every card under it, and nothing in this array
    // says which of them belonged above.
    const states = defaultStates();
    const nuevo = newState(states, '  Revisión  ');
    expect(nuevo).not.toBeNull();
    expect(nuevo?.color).toBe('neutral');
    expect(nuevo?.title).toBe('Revisión');
    expect(states.some((state) => state.id === nuevo?.id)).toBe(false);
    expect([...states, nuevo].at(-1)?.title).toBe('Revisión');
  });

  it('devuelve null al llegar al tope, y no un estado que el contrato rechaza', () => {
    // 24 is what the column behind the field holds. A 25th state is a column
    // that appears on the phone and comes back gone on the next pull, so the
    // limit is answered here and not discovered there.
    const tope = estadosDe(
      ...Array.from({ length: MAX_BOARD_STATES }, (_, i) => `s${i}`),
    );
    expect(newState(tope, 'Uno mas')).toBeNull();
    expect(newState(tope.slice(0, MAX_BOARD_STATES - 1), 'Uno menos')).not.toBeNull();
  });

  it('devuelve null tambien sin nombre, porque sin nombre no se guarda', () => {
    // The states travel as one field, so one unnamed column fails the whole write
    // and every later save of that board with it. Returning nothing leaves the
    // board as it was, which is the same thing the cap does.
    expect(newState(defaultStates(), '   ')).toBeNull();
  });
});

describe('el orden dentro de una columna', () => {
  it('desempata por createdAt cuando dos tareas comparten posicion', () => {
    // Two rows with the same position is not a theory: a task that arrives from
    // another device takes a position somebody else already had, and the contract
    // does not break that tie. Without this second criterion the order of those
    // two rows is whatever the sort leaves alone — which is the order the rows
    // came in, and that order is the order the pull happened to deliver.
    const states = estadosDe('a');
    const items = [
      itemDe({
        id: 'nueva',
        stateId: 'a',
        position: 3,
        createdAt: '2026-05-01T00:00:00.000Z',
      }),
      itemDe({
        id: 'vieja',
        stateId: 'a',
        position: 3,
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ];
    expect(tasksInState(items, states, 'a').map((i) => i.id)).toEqual([
      'vieja',
      'nueva',
    ]);
  });

  it('y el renumerado usa ese mismo orden', () => {
    // The map a drop writes comes out of the same comparison, so the tie-break
    // has to reach the positions too: a column whose two tied rows are written
    // 1 and 0 in one pull and 0 and 1 in the next is a column that reorders
    // itself while nobody touches it.
    const states = estadosDe('a');
    const items = [
      itemDe({
        id: 'nueva',
        stateId: 'a',
        position: 3,
        createdAt: '2026-05-01T00:00:00.000Z',
      }),
      itemDe({
        id: 'vieja',
        stateId: 'a',
        position: 3,
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ];
    expect([...renumberWithinState(items, states, 'a')]).toEqual([
      ['vieja', 0],
      ['nueva', 1],
    ]);
  });
});

describe('renumerar dentro de un estado', () => {
  it('devuelve el mapa de cambios de esa columna, de 0 a n-1', () => {
    // What the caller wants is the `position` to write in each row, so this is a
    // map and not the rows: a board with a column of two hundred tasks writes
    // two hundred updates from this and nothing else.
    const states = estadosDe('a', 'b');
    const items = [
      itemDe({ id: 'a3', stateId: 'a', position: 7 }),
      itemDe({ id: 'a1', stateId: 'a', position: 2 }),
      itemDe({ id: 'b1', stateId: 'b', position: 1 }),
    ];
    expect([...renumberWithinState(items, states, 'a')]).toEqual([
      ['a1', 0],
      ['a3', 1],
    ]);
  });

  it('no toca las tareas de las otras columnas', () => {
    // The rule the whole function exists for: renumbering one column must not
    // renumber the others, or a drag in "Ready" reorders "Done" as well.
    const states = estadosDe('a', 'b');
    const items = [
      itemDe({ id: 'a1', stateId: 'a', position: 5 }),
      itemDe({ id: 'b1', stateId: 'b', position: 9 }),
      itemDe({ id: 'b2', stateId: 'b', position: 4 }),
    ];
    expect(renumberWithinState(items, states, 'b').has('a1')).toBe(false);
    expect([...renumberWithinState(items, states, 'b')]).toEqual([
      ['b2', 0],
      ['b1', 1],
    ]);
  });

  it('las nulas y las huerfanas se renumeran con la primera columna', () => {
    // Every task created on a board without a column of its own carries a null
    // `stateId` and is drawn in the first one, so the first column is mostly rows
    // whose `stateId` is not the id of the column they are drawn in. Renumbering
    // by the raw id would leave them out of the map and the drag would do
    // nothing to them.
    const states = estadosDe('a', 'b');
    const items = [
      itemDe({ id: 'a1', stateId: 'a', position: 3 }),
      itemDe({ id: 'nula', stateId: null, position: 1 }),
      itemDe({ id: 'huerfana', stateId: 'borrado', position: 2 }),
    ];
    expect([...renumberWithinState(items, states, 'a')]).toEqual([
      ['nula', 0],
      ['huerfana', 1],
      ['a1', 2],
    ]);
  });

  it('no renumera el array que le dan', () => {
    const states = estadosDe('a');
    const items = [
      itemDe({ id: 'a1', stateId: 'a', position: 8 }),
      itemDe({ id: 'a2', stateId: 'a', position: 2 }),
    ];
    renumberWithinState(items, states, 'a');
    expect(items.map((i) => [i.id, i.position])).toEqual([
      ['a1', 8],
      ['a2', 2],
    ]);
  });
});

describe('mover una columna', () => {
  it('la mueve de sitio y deja las demas en su orden', () => {
    const states = estadosDe('a', 'b', 'c');
    expect(moveState(states, 0, 2).map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect(moveState(states, 2, 0).map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('un destino fuera de rango devuelve el mismo array', () => {
    // The same array and not a copy of it: the caller compares before writing a
    // list row, and a copy would have it write the same array on every drag that
    // went nowhere.
    const states = estadosDe('a', 'b');
    expect(moveState(states, 0, 7)).toBe(states);
    expect(moveState(states, 0, -1)).toBe(states);
    expect(moveState(states, 5, 0)).toBe(states);
    expect(moveState(states, 1, 1)).toBe(states);
  });
});

describe('editar un estado', () => {
  it('cambia el titulo y conserva el id', () => {
    // The invariant the whole feature stands on: renaming a column is the most
    // frequent edit there is, and a task points at an id, not at a name. Mint a
    // new id here and every task in that column is an orphan, drawn in the first
    // one, with nothing saying why.
    const states = estadosDe('a', 'b');
    const edited = editState(states, 'b', { title: 'En curso' });
    expect(edited.map((s) => s.title)).toEqual(['A', 'En curso']);
    expect(edited.map((s) => s.id)).toEqual(states.map((s) => s.id));
  });

  it('cambia el color y conserva el id, y no toca el resto', () => {
    const states = estadosDe('a', 'b');
    const edited = editState(states, 'a', { color: 'red' });
    expect(edited[0]?.color).toBe('red');
    expect(edited[1]).toBe(states[1]);
    expect(edited.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('un titulo de solo espacios deja el array como estaba', () => {
    // A column nobody can name is a column nobody can move a task to, and the
    // contract refuses it — which fails the write of the whole array, because the
    // states travel together.
    const states = estadosDe('a', 'b');
    expect(editState(states, 'b', { title: '   ' })).toBe(states);
  });

  it('un titulo mas largo de lo que el contrato acepta se recorta', () => {
    // Clipped rather than refused: a name that does not fit is a shorter name,
    // which the person sees, where a refused save is a rename that looks like it
    // did not happen.
    const states = estadosDe('a');
    const edited = editState(states, 'a', { title: 'x'.repeat(60) });
    expect(edited[0]?.title).toHaveLength(40);
  });

  it('un color que el contrato no acepta no se escribe', () => {
    // The picker offers twelve, so this only arrives from a future build or a
    // payload edited by hand — and one bad colour fails the save of every column.
    const states = estadosDe('a');
    const edited = editState(states, 'a', {
      color: 'chartreuse' as ItemIconColor,
    });
    expect(edited[0]?.color).toBe('neutral');
  });

  it('un id que no esta devuelve el mismo array', () => {
    const states = estadosDe('a');
    expect(editState(states, 'b', { title: 'Nada' })).toBe(states);
  });

  it('editar sin cambiar nada devuelve el mismo array', () => {
    // The editor writes the list row when it is handed a different array, and
    // opening a column and saving it unchanged is not an edit: it is a write of a
    // whole field that a person did not ask for, and it loses somebody else's
    // concurrent change of the same board.
    const states = estadosDe('a');
    expect(editState(states, 'a', {})).toBe(states);
    expect(editState(states, 'a', { title: 'A' })).toBe(states);
  });
});

describe('borrar un estado', () => {
  it('lo quita del array y deja las demas en su orden', () => {
    const states = defaultStates();
    const left = removeState(states, primero(states).id);
    expect(left).toHaveLength(3);
    expect(left.map((s) => s.id)).toEqual(states.slice(1).map((s) => s.id));
  });

  it('borrar un estado no cambia el estado de las tareas', () => {
    // Moving the tasks is the caller's job: a function handed nothing but an array
    // of states cannot write rows of another table, and faking it would be a lie.
    // The order that matters is in the delete sheet: the tasks move first, with
    // the destination written by hand, and the column goes after them.
    const states = defaultStates();
    const wip = columna(states, 2).id;
    const tasks = [
      itemDe({ id: 'nula', stateId: null }),
      itemDe({ id: 'wip', stateId: wip }),
    ];
    removeState(states, primero(states).id);
    expect(tasks.map((t) => t.stateId)).toEqual([null, wip]);
  });

  it('un id que no esta devuelve el mismo array', () => {
    const states = estadosDe('a', 'b');
    expect(removeState(states, 'c')).toBe(states);
  });
});

describe('se puede borrar un estado', () => {
  it('con un solo estado no, porque el tablero se quedaria sin columnas', () => {
    // Not because of the index: because of the length. A board with no states has
    // no columns to draw a task in, and every task in it is drawn nowhere.
    expect(canDeleteState(estadosDe('a'), 0)).toBe(false);
  });

  it('con dos o mas, solo si el indice existe de verdad', () => {
    const states = estadosDe('a', 'b', 'c');
    expect(canDeleteState(states, 0)).toBe(true);
    expect(canDeleteState(states, 2)).toBe(true);
    expect(canDeleteState(states, -1)).toBe(false);
    expect(canDeleteState(states, 3)).toBe(false);
  });
});

/**
 * The two arithmetics of the track, **with the numbers a browser measured** and
 * not with invented examples.
 *
 * Every width below is the content box of a real window, read off the running
 * screen: 368 is a 400-point window, 800 is a 1120-point one with the drawer open,
 * and 1120 is a 1440-point one with the drawer open. The gap is `spacing.md`.
 */
const HUECO = 12;

describe('como se reparte el ancho entre las columnas', () => {
  it('un ancho de movil es un estado a pantalla completa', () => {
    // 368 points of track and four columns would be four cards 80 wide each, which
    // is not a board and is not a list either.
    const wide = columnLayout(368, HUECO);
    expect(wide.singleColumn).toBe(true);
    expect(wide.columns).toBe(1);
    expect(wide.columnWidth).toBe(368);
  });

  it('el umbral son 720 puntos, y esta Decidido por los dos lados', () => {
    // One point either side, because a threshold that is only checked from one
    // side is a threshold nobody has checked.
    expect(columnLayout(719, HUECO).singleColumn).toBe(true);
    expect(columnLayout(720, HUECO).singleColumn).toBe(false);
  });

  it('reparte lo que sobra y no deja el tablero desplazado con todo a la vista', () => {
    // **The arithmetic that broke.** Four columns of 280 and three gaps of 12 ask
    // for 1156 of 1120, so the board scrolled 36 points with every column already
    // on screen. With the gap inside the division the four columns and the three
    // gaps are exactly the track.
    const wide = columnLayout(1120, HUECO);
    expect(wide.columns).toBe(4);
    expect(wide.columnWidth).toBe(271);
    const occupied =
      wide.columnWidth * wide.columns + HUECO * (wide.columns - 1);
    expect(occupied).toBeLessThanOrEqual(1120);
    expect(occupied).toBeCloseTo(1120, 5);
  });

  it('a 920 no caben cuatro columnas, porque los huecos tambien ocupan', () => {
    // The half of that arithmetic that **920** is where it bites, and not 1120:
    // 4 × 230 + 3 × 12 = 956 of 920, so counting the columns as `width / 230`
    // says four fit, the floor of 230 kicks in and the board scrolls 36 points
    // with every column on screen. At 1120 both counts agree on four, which is
    // exactly why a check at one width can sit where the bug is invisible.
    const wide = columnLayout(920, HUECO);
    expect(wide.columns).toBe(3);
    expect(wide.columnWidth).toBeCloseTo(896 / 3, 5);
  });

  it('ningun ancho deja el tablero desplazado mientras quepan todas las columnas', () => {
    // The invariant over the whole range rather than in one place, for the reason
    // the case above gives: it only fails at some widths. The thousandth is float
    // noise from the division, not a column.
    for (let width = BOARD_SINGLE_COLUMN_BELOW; width <= 1600; width += 7) {
      const { columnWidth, columns } = columnLayout(width, HUECO);
      const occupied = columnWidth * columns + HUECO * (columns - 1);
      expect(occupied).toBeLessThanOrEqual(width + 0.001);
    }
  });

  it('medido en 800 son tres columnas de 258 y pico, y tambien quedan enteras', () => {
    const wide = columnLayout(800, HUECO);
    expect(wide.singleColumn).toBe(false);
    expect(wide.columns).toBe(3);
    expect(wide.columnWidth).toBeCloseTo(776 / 3, 5);
    const occupied =
      wide.columnWidth * wide.columns + HUECO * (wide.columns - 1);
    expect(occupied).toBeLessThanOrEqual(800);
  });

  it('ninguna columna sale mas estrecha que el minimo', () => {
    // The floor is what happens if the arithmetic is ever wrong in the other
    // direction, and it is checked over the whole range rather than in one place:
    // a width that asked for more columns than fit would hand out cards that
    // cannot be read.
    for (let width = BOARD_SINGLE_COLUMN_BELOW; width <= 1600; width += 7) {
      const wide = columnLayout(width, HUECO);
      expect(wide.columnWidth).toBeGreaterThanOrEqual(BOARD_COLUMN_MIN_WIDTH);
    }
  });

  it('sin medir no hay ancho, y la caja que mide se dibuja igualmente', () => {
    // Zero, and not the minimum: a screen that hides its measuring box until it
    // has a width never measures one, which is a blank board with no error. The
    // reason it is zero is in `columnLayout`.
    expect(columnLayout(0, HUECO).columnWidth).toBe(0);
  });
});

describe('donde esta el borde izquierdo de una columna', () => {
  it('cuenta el hueco que hay delante de ella', () => {
    // **The arithmetic that was left half done.** `index * columnWidth` lands
    // three gaps short on the fourth column: 813 where the column starts at 849.
    expect(columnOffset(3, 271, HUECO)).toBe(849);
    expect(columnOffset(3, 271, HUECO) - 3 * 271).toBe(3 * HUECO);
  });

  it('la primera columna es el origen y la siguiente empieza donde acaba la anterior', () => {
    // The same claim from the other side, and it is the one that says the gap is
    // counted once: column i ends at `offset(i) + columnWidth` and column i+1
    // starts at `offset(i+1)`, so between them there is exactly one gap.
    expect(columnOffset(0, 271, HUECO)).toBe(0);
    for (const index of [0, 1, 2, 3]) {
      expect(columnOffset(index + 1, 271, HUECO)).toBe(
        columnOffset(index, 271, HUECO) + 271 + HUECO,
      );
    }
  });

  it('con una sola columna a pantalla completa el desplazamiento es el de la ventana', () => {
    // 368 of track and four states: the third one is two pages in, which is what
    // the tabs measured in the browser (1140 of scroll for four columns of 368 and
    // three gaps of 12).
    const { columnWidth } = columnLayout(368, HUECO);
    expect(columnOffset(3, columnWidth, HUECO)).toBe(3 * 380);
  });
});

describe('lo que sale de aqui lo acepta el contrato', () => {
  it('los estados por defecto, los nuevos, los editados y los que quedan', () => {
    // The states are one field of the list: one value the schema refuses fails
    // every save of that board from then on, so the arrays this file returns are
    // measured against the schema that will read them on the next pull.
    //
    // **The id used here is one that really exists.** The states of a board born
    // today carry uuids, so editing "a" would hand the same array straight back
    // and the schema would be handed the four defaults untouched: three
    // assertions that read as coverage of the schema while checking nothing. The
    // id is `primero(states).id` for that reason.
    const states = defaultStates();
    const primeroId = primero(states).id;
    const nuevo = newState(states, 'Revisión');
    expect(nuevo).not.toBeNull();
    expect(() => boardStatesSchema.parse(states)).not.toThrow();
    expect(() => boardStatesSchema.parse([...states, nuevo])).not.toThrow();
    expect(() =>
      boardStatesSchema.parse(
        editState(states, primeroId, { title: 'x'.repeat(60) }),
      ),
    ).not.toThrow();
    expect(() =>
      boardStatesSchema.parse(
        editState(states, primeroId, { color: 'chartreuse' as ItemIconColor }),
      ),
    ).not.toThrow();
    // The count as well, because "does not throw" alone cannot tell a removal from
    // a function that removed nothing: both hand the schema three valid states
    // when it works and four when it does not.
    const quedan = removeState(states, primeroId);
    expect(() => boardStatesSchema.parse(quedan)).not.toThrow();
    expect(quedan).toHaveLength(3);
  });
});
