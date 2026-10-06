import { describe, expect, it } from 'vitest';

import type { Folder, List } from '@orbit-hub/contracts';

import { buildPickerTree } from '../src/lib/dashboard/picker-tree';

/**
 * El pin-picker recorre el árbol de carpetas.
 *
 * Recorría el árbol **como si fuera plano**: `foldersOfWorkspace` filtraba por
 * `workspaceId` y nada más, así que una subcarpetilla salía al lado de su propia
 * madre, al principio del espacio, y una carpeta que solo contenía subcarpetillas
 * decía "aquí no hay nada que poner en el panel todavía", que es falso.
 *
 * `useSpacesTree` ya hacía esto bien y lo usan el drawer y tres sitios más. Este
 * era el único que se lo había reimplementado, y por eso los tests son de una
 * función pura y no del componente: la regla del árbol se puede comprobar sin
 * React Native.
 */

const WS = 'ws-1';

function folder(id: string, parentId: string | null, name = id): Folder {
  return {
    id, workspaceId: WS, parentId, name, icon: null, position: 0, version: 1,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null,
  } as Folder;
}

function list(id: string, folderId: string | null, title = id): List {
  return {
    id, workspaceId: WS, folderId, kind: 'tasks', title, description: null, icon: null,
    tags: [], tagColors: {}, states: [], position: 0, orderMode: 'manual', itemCount: 0,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null, version: 1, role: 'owner', shared: false,
  } as List;
}

// Un árbol de dos niveles: Casa > Cocina, y Cocina >nevera
const ARBOL = [
  folder('casa', null, 'Casa'),
  folder('cocina', 'casa', 'Cocina'),
  folder('nevera', 'cocina', 'Nevera'),
  folder('garaje', null, 'Garaje'),
];

describe('buildPickerTree', () => {
  it('las carpetas de la raiz son las que no tienen padre, no todas', () => {
    const arbol = buildPickerTree(ARBOL, []);

    expect(arbol.foldersOf(WS, null).map((f) => f.id)).toEqual(['casa', 'garaje']);
  });

  it('una subcarpeta cuelga de su madre, no al lado', () => {
    const arbol = buildPickerTree(ARBOL, []);

    expect(arbol.foldersOf(WS, 'casa').map((f) => f.id)).toEqual(['cocina']);
    expect(arbol.foldersOf(WS, 'cocina').map((f) => f.id)).toEqual(['nevera']);
    expect(arbol.foldersOf(WS, 'nevera')).toEqual([]);
  });

  it('una carpeta con solo subcarpetillas NO esta vacia', () => {
    // El bug: `Cocina` no tiene listas propias, y el picker decia que no habia
    // nada. Lo que tiene es `Nevera`.
    const arbol = buildPickerTree(ARBOL, []);

    expect(arbol.isFolderEmpty('cocina')).toBe(false);
    expect(arbol.isFolderEmpty('casa')).toBe(false);
  });

  it('una carpeta sin nada de nada si esta vacia', () => {
    const arbol = buildPickerTree([folder('vacia', null)], []);

    expect(arbol.isFolderEmpty('vacia')).toBe(true);
  });

  it('las listas de una carpeta son las suyas y las de su padre son otras', () => {
    const arbol = buildPickerTree(ARBOL, [list('compra', null), list('papas', 'casa')]);

    expect(arbol.listsOf(WS, null).map((l) => l.id)).toEqual(['compra']);
    expect(arbol.listsOf(WS, 'casa').map((l) => l.id)).toEqual(['papas']);
    expect(arbol.listsOf(WS, 'cocina')).toEqual([]);
  });

  it('la raiz del espacio cuenta lo que cuelga de el, no todo el arbol', () => {
    // El numero de una tarjeta dice "3 carpetas dentro". Con el filtro plano
    // contaba Casa, Cocina, Nevera y Garaje, que no son las cuatro cosas de primer
    // nivel que puede abrir alguien desde ahi.
    const arbol = buildPickerTree(ARBOL, []);

    expect(arbol.foldersOf(WS, null)).toHaveLength(2);
    expect(arbol.childCountOf(WS, null)).toBe(2);
  });

  it('sabe subir por el arbol, que es como se sale de una carpeta', () => {
    const arbol = buildPickerTree(ARBOL, []);

    expect(arbol.parentOf('nevera')?.id).toBe('cocina');
    expect(arbol.parentOf('casa')).toBeNull();
  });

  it('no se sale de su espacio', () => {
    const arbol = buildPickerTree(
      [...ARBOL, { ...folder('ajena', null), workspaceId: 'ws-2' } as Folder],
      [{ ...list('otra', null), workspaceId: 'ws-2' } as List],
    );

    expect(arbol.foldersOf(WS, null).map((f) => f.id)).toEqual(['casa', 'garaje']);
    expect(arbol.foldersOf('ws-2', null).map((f) => f.id)).toEqual(['ajena']);
    expect(arbol.listsOf('ws-2', null).map((l) => l.id)).toEqual(['otra']);
  });

  it('ordena por nombre y por titulo, que es como se leen dos carpetas', () => {
    const arbol = buildPickerTree(
      [folder('b', null, 'Zeta'), folder('a', null, 'Alfa')],
      [list('z', null, 'Zeta'), list('a', null, 'Alfa')],
    );

    expect(arbol.foldersOf(WS, null).map((f) => f.name)).toEqual(['Alfa', 'Zeta']);
    expect(arbol.listsOf(WS, null).map((l) => l.title)).toEqual(['Alfa', 'Zeta']);
  });

  it('aguanta un ciclo sin colgarse', () => {
    // `folder-subtree.ts` lo dice en su propio comentario: un ciclo "no se supone
    // que sea imposible, solo que todavia no le ha pasado a nadie". Un picker que
    // se cuelga con un dato raro es un picker que tumba la app.
    const ciclico = [folder('a', 'b'), folder('b', 'a')];
    const arbol = buildPickerTree(ciclico, []);

    expect(() => arbol.foldersOf(WS, 'a')).not.toThrow();
    expect(arbol.foldersOf(WS, 'a').map((f) => f.id)).toEqual(['b']);
  });
});
