import { describe, expect, it } from 'vitest';

import type { Collection } from '@orbit-hub/contracts';

import { selectCollections } from '../src/hooks/use-spaces-tree';

/**
 * El eje de colecciones del arbol de espacios.
 *
 * `useSpacesTree` sabia de espacios, carpetas y listas, y de colecciones no:
 * el `PlacePicker` necesita `collectionsOf(workspaceId, folderId)` para
 * ofrecerlas, y esta es la funcion pura que el hook usa por dentro. Pura y
 * no el hook, porque un hook no se prueba sin React y esta regla si se puede
 * comprobar sin el.
 */

const WS = 'ws-1';

function collection(
  id: string,
  folderId: string | null,
  over: Partial<Collection> = {},
): Collection {
  return {
    id,
    version: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null,
    workspaceId: WS,
    folderId,
    name: id,
    description: null,
    emoji: null,
    position: 0,
    bookmarkCount: 0,
    role: 'owner',
    shared: false,
    ...over,
  };
}

describe('selectCollections', () => {
  it('devuelve las colecciones de una carpeta, sin las borradas', () => {
    const filas = [
      collection('c1', 'f1'),
      collection('c2', 'f1', { deletedAt: '2026-10-02T00:00:00.000Z' }),
      collection('c3', 'f2'),
    ];

    expect(selectCollections(filas, WS, 'f1').map((c) => c.id)).toEqual(['c1']);
  });

  it('una coleccion sin carpeta sale en la raiz del espacio', () => {
    const filas = [
      collection('raiz', null),
      collection('dentro', 'f1'),
    ];

    expect(selectCollections(filas, WS, null).map((c) => c.id)).toEqual(['raiz']);
  });

  it('ordenadas por position, como carpetas y listas', () => {
    const filas = [
      collection('segunda', null, { position: 2, name: 'Segunda' }),
      collection('primera', null, { position: 0, name: 'Primera' }),
      collection('tercera', null, { position: 1, name: 'Tercera' }),
    ];

    expect(selectCollections(filas, WS, null).map((c) => c.id)).toEqual([
      'primera',
      'tercera',
      'segunda',
    ]);
  });

  it('a igual position, por nombre', () => {
    const filas = [
      collection('zeta', null, { name: 'Zeta' }),
      collection('alfa', null, { name: 'Alfa' }),
    ];

    expect(selectCollections(filas, WS, null).map((c) => c.name)).toEqual([
      'Alfa',
      'Zeta',
    ]);
  });

  it('no se sale de su espacio', () => {
    const filas = [
      collection('mia', null),
      { ...collection('ajena', null), workspaceId: 'ws-2' },
    ];

    expect(selectCollections(filas, WS, null).map((c) => c.id)).toEqual(['mia']);
    expect(selectCollections(filas, 'ws-2', null).map((c) => c.id)).toEqual(['ajena']);
  });
});
