import { describe, expect, it } from 'vitest';

import { stateOf } from '@orbit-hub/contracts';
import type { BoardStates } from '@orbit-hub/contracts';

import { duplicationPayloads, planDuplication } from '../src/lib/lists/duplicate';

/**
 * Duplicating a list copies its items, and the copy has to match the original in
 * every way that matters while still being its own list. The planning is pure so
 * the rules can be checked without a database or a network.
 */

function source(overrides: Record<string, unknown> = {}) {
  return {
    id: 'list-1',
    workspaceId: 'ws-1',
    folderId: 'folder-1',
    kind: 'movies' as const,
    title: 'Películas 2026',
    description: 'Lo que quiero ver',
    emoji: '🎬',
    tags: ['pendiente'],
    position: 3,
    orderMode: 'manual' as const,
    // A list nobody has chosen a colour for yet: every label falls back to the
    // colour its name hashes to.
    tagColors: {},
    // Not a board, so no columns. A real list carries the empty array rather than
    // nothing, and the plan has to be able to tell that from a board whose
    // columns were lost.
    states: [],
    version: 4,
    itemCount: 2,
    ...overrides,
  };
}

const items = [
  {
    id: 'item-1',
    listId: 'list-1',
    title: 'Matrix',
    position: 0,
    completed: true,
    stateId: null,
    priority: 'high' as const,
    icon: null, iconStyle: 'outline' as const, iconColor: 'neutral' as const,
    tags: [] as string[],
    externalId: 'movie:603',
    metadata: { provider: 'tmdb', year: '1999' },
    annotation: 'reverla',
    deletedAt: null,
  },
  {
    id: 'item-2',
    listId: 'list-1',
    title: 'Arrival',
    position: 1,
    completed: false,
    stateId: null,
    priority: 'none' as const,
    icon: null, iconStyle: 'outline' as const, iconColor: 'neutral' as const,
    tags: [] as string[],
    externalId: 'movie:329865',
    metadata: { provider: 'tmdb' },
    annotation: null,
    deletedAt: null,
  },
  {
    id: 'item-3',
    listId: 'list-1',
    title: 'Borrada',
    position: 2,
    completed: false,
    stateId: null,
    priority: 'none' as const,
    icon: null, iconStyle: 'outline' as const, iconColor: 'neutral' as const,
    tags: [] as string[],
    externalId: null,
    metadata: null,
    annotation: null,
    deletedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'item-4',
    listId: 'otra-lista',
    title: 'De otra lista',
    position: 0,
    completed: false,
    stateId: null,
    priority: 'none' as const,
    icon: null, iconStyle: 'outline' as const, iconColor: 'neutral' as const,
    tags: [] as string[],
    externalId: null,
    metadata: null,
    annotation: null,
    deletedAt: null,
  },
];

/**
 * A board: four columns and one task in each.
 *
 * The four columns are what make the copy's ids matter. A copy that carries them
 * over has tasks pointing at columns of the *original*, and `stateOf` draws an id
 * it does not know in the first column — so the copy comes out looking plausible
 * with every task in Backlog, and nothing anywhere says so.
 */
const COLUMNAS: BoardStates = [
  { id: 'col-backlog', title: 'Backlog', color: 'neutral' },
  { id: 'col-ready', title: 'Ready', color: 'blue' },
  { id: 'col-wip', title: 'WIP', color: 'amber' },
  { id: 'col-done', title: 'Done', color: 'green' },
];

function boardSource(overrides: Record<string, unknown> = {}) {
  return {
    id: 'board-1',
    workspaceId: 'ws-1',
    folderId: null,
    kind: 'board' as const,
    title: 'Tablero',
    description: null,
    emoji: null,
    tags: [],
    position: 0,
    orderMode: 'manual' as const,
    tagColors: {},
    states: COLUMNAS,
    ...overrides,
  };
}

function taskEnColumn(id: string, title: string, stateId: string | null, position: number) {
  return {
    id,
    listId: 'board-1',
    title,
    position,
    completed: false,
    stateId,
    priority: 'none' as const,
    icon: null, iconStyle: 'outline' as const, iconColor: 'neutral' as const,
    tags: [] as string[],
    externalId: null,
    metadata: null,
    annotation: null,
    deletedAt: null,
  };
}

const boardItems = [
  taskEnColumn('t1', 'Sin empezar', 'col-backlog', 0),
  taskEnColumn('t2', 'Lista para hacer', 'col-ready', 1),
  taskEnColumn('t3', 'A medias', 'col-wip', 2),
  taskEnColumn('t4', 'Terminada', 'col-done', 3),
];

/** Ids that count up, so a test can say which column of the copy a task is in. */
function generadorDeIds(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

/** The column a task is drawn in, which is what a person actually sees. */
const columnaDe = (states: BoardStates, stateId: string | null | undefined) =>
  stateOf(states, stateId)?.title;

describe('planDuplication', () => {
  it('copies only the items of the source list that are not deleted', () => {
    const plan = planDuplication(source(), items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      newStateId: () => 'estado-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    expect(plan.items.map((item) => item.title)).toEqual(['Matrix', 'Arrival']);
  });

  it('renumbers the copies from zero, in the original order', () => {
    const plan = planDuplication(source(), items, {
      newListId: 'list-2',
      newItemId: (() => {
        let n = 0;
        return () => `new-${(n += 1)}`;
      })(),
      newStateId: () => 'estado-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    expect(plan.items.map((item) => item.position)).toEqual([0, 1]);
    expect(plan.items.map((item) => item.id)).toEqual(['new-1', 'new-2']);
  });

  it('keeps the completed state, the priority and the annotation', () => {
    const plan = planDuplication(source(), items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      newStateId: () => 'estado-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    const first = plan.items[0];
    expect(first?.completed).toBe(true);
    expect(first?.priority).toBe('high');
    expect(first?.annotation).toBe('reverla');
  });

  it('keeps the provider record so a catalog item stays recognisable', () => {
    const plan = planDuplication(source(), items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      newStateId: () => 'estado-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    expect(plan.items[0]?.externalId).toBe('movie:603');
    expect(plan.items[0]?.metadata).toEqual({ provider: 'tmdb', year: '1999' });
  });


  it('stays in the same workspace, folder and position', () => {
    const plan = planDuplication(source(), items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      newStateId: () => 'estado-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    expect(plan.list.workspaceId).toBe('ws-1');
    expect(plan.list.folderId).toBe('folder-1');
    expect(plan.list.position).toBe(3);
    expect(plan.list.kind).toBe('movies');
    expect(plan.list.emoji).toBe('🎬');
  });

  it('copies the tags by value, not by reference', () => {
    const plan = planDuplication(source(), items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      newStateId: () => 'estado-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    plan.list.tags.push('otro');
    expect(plan.list.tags).toEqual(['pendiente', 'otro']);
  });

  it('takes the label colours with it', () => {
    // A copy of a list whose labels come out in one colour and that duplicates
    // into another is a list that changed the moment it was duplicated, and
    // nobody asked for it.
    const plan = planDuplication(source({ tagColors: { pendiente: 'green' } }), items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      newStateId: () => 'estado-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    expect(plan.list.tagColors).toEqual({ pendiente: 'green' });
  });

  it('copies the label colours by value, not by reference', () => {
    // Same reason as the tags above it: a later write to the copy must not reach
    // back into the original's map. The original is held in a variable on
    // purpose — asking `source()` for a second one would prove nothing about the
    // first.
    const original = source({ tagColors: { pendiente: 'green' } });
    const plan = planDuplication(original, items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      newStateId: () => 'estado-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    plan.list.tagColors.pendiente = 'red';
    expect(plan.list.tagColors).toEqual({ pendiente: 'red' });
    expect(original.tagColors).toEqual({ pendiente: 'green' });
  });

  it('uses the given title and falls back to the original one', () => {
    const withTitle = planDuplication(source(), items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      newStateId: () => 'estado-1',
      now: '2026-06-01T00:00:00.000Z',
      title: 'Películas 2027',
    });
    const without = planDuplication(source(), items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      newStateId: () => 'estado-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    expect(withTitle.list.title).toBe('Películas 2027');
    expect(without.list.title).toBe('Películas 2026');
    // A title of only spaces is not a title.
    expect(
      planDuplication(source(), items, {
        newListId: 'list-2',
        newItemId: () => 'new-1',
        newStateId: () => 'estado-1',
        now: '2026-06-01T00:00:00.000Z',
        title: '   ',
      }).list.title,
    ).toBe('Películas 2026');
  });

  it('records the item count on the copy', () => {
    const plan = planDuplication(source(), items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      newStateId: () => 'estado-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    expect(plan.list.itemCount).toBe(2);
  });

  it('copies an empty list without complaining', () => {
    const plan = planDuplication(source(), [], {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      newStateId: () => 'estado-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    expect(plan.items).toEqual([]);
    expect(plan.list.itemCount).toBe(0);
  });

  it('starts every copy at version zero, as a new record', () => {
    const plan = planDuplication(source(), items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      newStateId: () => 'estado-1',
      now: '2026-06-01T00:00:00.000Z',
    });

    expect(plan.list.version).toBe(0);
    expect(plan.items.every((item) => item.version === 0)).toBe(true);
  });

  it('duplicates a board with its own columns and leaves every task in the one it was in', () => {
    const plan = planDuplication(boardSource(), boardItems, {
      newListId: 'board-2',
      newItemId: () => 'nueva-tarea',
      newStateId: generadorDeIds('col'),
      now: '2026-06-01T00:00:00.000Z',
    });

    // Four columns, and none of them is one of the original's. Sharing the ids is
    // the failure this test exists for: the copy would then be the *same* four
    // columns wearing a second name, and a rename in either list would move the
    // other list's tasks.
    expect(plan.list.kind).toBe('board');
    expect(plan.list.states.map((estado) => estado.title)).toEqual([
      'Backlog',
      'Ready',
      'WIP',
      'Done',
    ]);
    expect(plan.list.states.map((estado) => estado.id)).toEqual(['col-1', 'col-2', 'col-3', 'col-4']);
    expect(plan.list.states.some((estado) => COLUMNAS.some((o) => o.id === estado.id))).toBe(false);

    // The assertion that matters, and the one a copy with borrowed ids fails: not
    // "the ids look different" but "the task is still in the column it was in".
    // Read through `stateOf`, because that is the function that hides the bug by
    // drawing an unknown id in the first column.
    expect(plan.items.map((item) => columnaDe(plan.list.states, item.stateId))).toEqual([
      'Backlog',
      'Ready',
      'WIP',
      'Done',
    ]);
    // And the same read on the original, so the two lists are known to be alike.
    expect(boardItems.map((item) => columnaDe(COLUMNAS, item.stateId))).toEqual([
      'Backlog',
      'Ready',
      'WIP',
      'Done',
    ]);
  });

  it('copies the columns by value, not by reference', () => {
    // Same reason as the tags and the label colours above: a later write to the
    // copy's columns must not reach back into the original's. The original is
    // held in a variable on purpose, for the reason the label colours are.
    const original = boardSource();
    const plan = planDuplication(original, boardItems, {
      newListId: 'board-2',
      newItemId: () => 'nueva-tarea',
      newStateId: generadorDeIds('col'),
      now: '2026-06-01T00:00:00.000Z',
    });

    plan.list.states[1]!.title = 'Preparada';
    plan.list.states.push({ id: 'col-5', title: 'Archive', color: 'teal' });

    expect(plan.list.states[1]!.title).toBe('Preparada');
    expect(plan.list.states).toHaveLength(5);
    expect(original.states.map((estado) => estado.title)).toEqual([
      'Backlog',
      'Ready',
      'WIP',
      'Done',
    ]);
  });

  it('leaves a task without a column without one, and does not carry an id that points at nothing', () => {
    // A task with no column of its own is drawn in the first one, and that has to
    // stay true in the copy: the copy has a first column of its own, and handing
    // the task an id would be choosing a column nobody chose.
    const sinColumna = [taskEnColumn('t1', 'Sin columna', null, 0)];
    // The second shape: a task already pointing at a column the list does not
    // have. It can only be a row that was broken before the duplication, and it
    // stays broken in the copy rather than travelling a reference to the
    // original's board.
    const colgando = [taskEnColumn('t2', 'Colgante', 'col-que-no-existe', 0)];

    const planSinColumna = planDuplication(boardSource(), sinColumna, {
      newListId: 'board-2',
      newItemId: () => 'nueva-tarea',
      newStateId: generadorDeIds('col'),
      now: '2026-06-01T00:00:00.000Z',
    });
    const planColgando = planDuplication(boardSource(), colgando, {
      newListId: 'board-2',
      newItemId: () => 'nueva-tarea',
      newStateId: generadorDeIds('col'),
      now: '2026-06-01T00:00:00.000Z',
    });

    expect(planSinColumna.items[0]?.stateId).toBeNull();
    expect(planColgando.items[0]?.stateId).toBeNull();
    // Null in both cases, and both therefore drawn in the copy's first column.
    expect(columnaDe(planSinColumna.list.states, planSinColumna.items[0]?.stateId)).toBe('Backlog');
    expect(columnaDe(planColgando.list.states, planColgando.items[0]?.stateId)).toBe('Backlog');
  });

  it('does not invent columns for a list that is not a board', () => {
    // The other half of the empty array: a list with no columns duplicates into a
    // list with no columns, rather than into one whose columns were invented.
    const plan = planDuplication(source(), items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      newStateId: generadorDeIds('col'),
      now: '2026-06-01T00:00:00.000Z',
    });

    expect(plan.list.states).toEqual([]);
  });
});

describe('what a duplication sends to the server', () => {
  /*
    The cache write and the outbox write are two different things, and the bug
    this block exists for lived in the gap between them: the plan put the
    columns in the copy, the cache holds them, and the payload did not. So the
    board looked right on the device and came back empty after the next pull,
    with an `applied` in the log and nothing in any test failing.

    Which is why these read `duplicationPayloads` and not `planDuplication`. The
    plan was already right; the payload is where it was lost.
  */

  const planDeUnTablero = () =>
    planDuplication(boardSource(), boardItems, {
      newListId: 'board-2',
      newItemId: () => 'nueva-tarea',
      newStateId: generadorDeIds('col'),
      now: '2026-06-01T00:00:00.000Z',
    });

  it('carries the columns of the board and the column of each task', () => {
    const plan = planDeUnTablero();
    const payloads = duplicationPayloads(plan);

    // The four columns the plan minted, in the payload and not only in the row.
    expect(payloads.list.states).toEqual(plan.list.states);
    expect(payloads.list.states.map((estado) => estado.title)).toEqual([
      'Backlog',
      'Ready',
      'WIP',
      'Done',
    ]);

    // And the column of every task, so the server stores the board with its
    // tasks distributed instead of with all of them in the first one.
    expect(payloads.items.map(({ payload }) => payload.stateId)).toEqual(
      plan.items.map((item) => item.stateId),
    );
    expect(
      payloads.items.map(({ payload }) => columnaDe(payloads.list.states, payload.stateId)),
    ).toEqual(['Backlog', 'Ready', 'WIP', 'Done']);

    // The tasks are written into the copy, not into the list they came from.
    expect(payloads.items.every(({ payload }) => payload.listId === 'board-2')).toBe(true);
  });

  it('sends the same columns and columns-of-task as the row it just cached', () => {
    // The two writes have to agree. When they disagreed the only symptom was a
    // board that was right until the pull, so this is the assertion that names
    // the actual defect rather than one of its two halves.
    const plan = planDeUnTablero();
    const payloads = duplicationPayloads(plan);

    expect(JSON.parse(JSON.stringify(payloads.list.states))).toEqual(plan.list.states);
    expect(payloads.items.map(({ payload }) => payload.stateId)).toEqual([
      'col-1',
      'col-2',
      'col-3',
      'col-4',
    ]);
  });

  it('carries no columns for a list that is not a board', () => {
    const plan = planDuplication(source(), items, {
      newListId: 'list-2',
      newItemId: () => 'new-1',
      newStateId: generadorDeIds('col'),
      now: '2026-06-01T00:00:00.000Z',
    });
    const payloads = duplicationPayloads(plan);

    // Present and empty, rather than absent: the field says whether this is a
    // board, and a payload without it is a list the server has to guess about.
    expect(payloads.list.states).toEqual([]);
    expect('states' in payloads.list).toBe(true);
  });

  it('sends a null column rather than dropping the field', () => {
    const plan = planDuplication(
      boardSource(),
      [taskEnColumn('t1', 'Sin columna', null, 0)],
      {
        newListId: 'board-2',
        newItemId: () => 'nueva-tarea',
        newStateId: generadorDeIds('col'),
        now: '2026-06-01T00:00:00.000Z',
      },
    );
    const payloads = duplicationPayloads(plan);

    expect(payloads.items[0]?.payload.stateId).toBeNull();
    expect('stateId' in (payloads.items[0]?.payload ?? {})).toBe(true);
  });
});
