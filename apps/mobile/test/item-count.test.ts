import { describe, expect, it } from 'vitest';

import type { List } from '@orbit-hub/contracts';

import { applyItemCounts } from '../src/lib/lists/item-count';

/**
 * El número de items de una lista.
 *
 * `itemCount` venía del servidor, y el servidor solo lo recalcula cuando cambia
 * **la lista**. Añadir, completar o borrar un item bumpea el item, no la lista,
 * así que la fila nunca volvía a proyectarse: el número se quedaba con lo que
 * fuera la última vez que cambió el nombre, el orden o el color. Para una lista
 * creada y rellenada en un móvil era **0 para siempre**.
 *
 * Y lo leía una confirmación de borrado irreversible —"se elimina la lista y sus
 * 0 elementos"— que dice 0 y borra 27. Un número que no se invalida no es un
 * dato que se pueda enseñar antes de algo que no se puede deshacer.
 *
 * Ahora se cuenta desde la caché, que es donde vive el item. La función es pura
 * para poder comprobar la regla sin una base de datos.
 */

function list(overrides: Partial<List> = {}): List {
  return {
    id: 'list-1',
    workspaceId: 'ws-1',
    folderId: null,
    kind: 'tasks',
    title: 'Compra',
    description: null,
    emoji: null,
    tags: [],
    tagColors: {},
    position: 0,
    orderMode: 'manual',
    itemCount: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null,
    version: 1,
    role: 'owner',
    shared: false,
    ...overrides,
  } as List;
}

describe('applyItemCounts', () => {
  it('cuenta lo que hay, no lo que vino del servidor', () => {
    const listas = [list({ id: 'a', itemCount: 0 }), list({ id: 'b', itemCount: 12 })];
    const cuenta = new Map([
      ['a', 3],
      ['b', 7],
    ]);

    const resultado = applyItemCounts(listas, cuenta);

    expect(resultado[0]?.itemCount).toBe(3);
    expect(resultado[1]?.itemCount).toBe(7);
  });

  it('una lista sin items vale cero, aunque el servidor dijera otra cosa', () => {
    // El caso que no falla: una lista vacía con `itemCount: 99` de un pull viejo.
    const resultado = applyItemCounts([list({ itemCount: 99 })], new Map());

    expect(resultado[0]?.itemCount).toBe(0);
  });

  it('no inventa items para una lista que el conteo no menciona', () => {
    const resultado = applyItemCounts([list({ id: 'a' })], new Map([['b', 5]]));

    expect(resultado[0]?.itemCount).toBe(0);
  });

  it('no toca el resto de la lista', () => {
    const original = list({ id: 'a', title: 'Compra', itemCount: 99 });
    const resultado = applyItemCounts([original], new Map([['a', 2]]))[0];

    expect(resultado?.title).toBe('Compra');
    expect(resultado?.id).toBe('a');
    expect(resultado?.orderMode).toBe('manual');
    expect(resultado?.updatedAt).toBe(original.updatedAt);
  });

  it('devuelve el mismo array cuando ningún número cambia', () => {
    // Sin cambios, sin array nuevo: `useLists` compara antes de re-renderizar, y
    // un array nuevo en cada carga hace que la pantalla entera se repinte.
    //
    // Solo se puede pedir para listas cuyo número **ya** coincide. Un mapa vacío
    // significa cero items, así que con `itemCount: 2` sí hay un cambio que
    // aplicar — y ese es el caso normal, no el exceptional.
    const listas = [list({ id: 'a', itemCount: 0 }), list({ id: 'b', itemCount: 2 })];

    expect(applyItemCounts(listas, new Map([['a', 0], ['b', 2]]))).toBe(listas);
  });

  it('solo rehace el array si algún número cambia de verdad', () => {
    const listas = [list({ id: 'a', itemCount: 3 }), list({ id: 'b', itemCount: 1 })];

    expect(applyItemCounts(listas, new Map([['a', 3]]))).not.toBe(listas);
  });
});
