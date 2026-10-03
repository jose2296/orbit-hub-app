import { describe, expect, it } from 'vitest';

import { withListDefaults } from '../src/lib/lists/item-record';

/** A list as the cache holds it: only the fields that build wrote. */
function listRow(extra: Record<string, unknown> = {}) {
  return {
    id: 'lista-1',
    version: 3,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    workspaceId: 'espacio-1',
    folderId: null,
    kind: 'tasks',
    title: 'Compra',
    description: null,
    emoji: null,
    tags: [],
    position: 0,
    itemCount: 0,
    orderMode: 'manual',
    role: 'owner',
    shared: false,
    deletedAt: null,
    ...extra,
  };
}

describe('una lista leida de la cache', () => {
  it('viene con el mapa de colores aunque la cache no lo tenga', () => {
    // La cache sobrevive a la build que la escribio. Una lista guardada antes de
    // que existiera este campo llega sin la clave, y `readRecord` hace un cast
    // sin mirar: sin esto `list.tagColors` es `undefined` y toda lectura de un
    // color tiene que sobrevivir a eso.
    expect(withListDefaults(listRow()).tagColors).toEqual({});
  });

  it('descarta del mapa lo que no es un color, y conserva lo demas', () => {
    // Una fila de una build futura puede escribir una clave que este build no
    // sabe pintar. Se cae la clave, no el mapa.
    expect(
      withListDefaults(
        listRow({ tagColors: { Mercadona: 'green', Alcampo: 'ultralight' } }),
      ).tagColors,
    ).toEqual({ Mercadona: 'green' });
  });

  it('no pierde ningun otro campo de la lista', () => {
    const lista = withListDefaults(
      listRow({ tagColors: { Mercadona: 'red' } }),
    );
    expect(lista.id).toBe('lista-1');
    expect(lista.title).toBe('Compra');
    expect(lista.orderMode).toBe('manual');
    expect(lista.tagColors).toEqual({ Mercadona: 'red' });
  });
});