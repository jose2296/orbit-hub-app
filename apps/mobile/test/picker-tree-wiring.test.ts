import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Que el selector del panel recorra el árbol de verdad.
 *
 * Los tests de `picker-tree` comprueban la regla sobre la función pura. Estos
 * comprueban que el componente **la usa**, que es donde se rompió: la función
 * podía estar perfecta y el picker seguir filtrando `folders` por `workspaceId`
 * y nymph de este, que es exactamente como estaba.
 */

const RAIZ = join(import.meta.dirname, '..');
const src = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8');

const picker = src('src/components/dashboard/pin-picker.tsx');
const sheet = src('src/components/ui/sheet.tsx');

describe('el selector usa el árbol indexado', () => {
  it('no filtra las carpetas por espacio y ya', () => {
    // El bug, literalmente: `folders.filter((f) => f.workspaceId === id)` devuelve
    // tambien las subcarpetetas, que salen al lado de su madre.
    //
    // El patron busca la llamada entera y no `[^)]*`, que se para en el primer
    // paréntesis —el de `(f)`— y nunca llega al `workspaceId`. Así pasaba con el
    // bug puesto: verde sobre un fallo.
    expect(picker).not.toMatch(/folders\.filter\([\s\S]{0,120}?workspaceId/);
    expect(picker).not.toMatch(/lists\.filter\([\s\S]{0,120}?folderId === here\.folderId/);
  });

  it('pregunta al arbol por lo que cuelga de donde esta', () => {
    expect(picker).toContain('tree.foldersOf(');
    expect(picker).toContain('tree.listsOf(');
  });

  it('la carpeta lleva su padre en el camino, o el arbol no puede responder', () => {
    expect(picker).toMatch(/kind: "folder";[\s\S]{0,120}parentId/);
  });

  it('una carpeta sin nada de nada es la unica que puede decir que esta vacia', () => {
    // `isFolderEmpty` cuenta carpetas y listas hijas. Preguntar solo por las listas
    // es lo que hacia que una carpeta con subcarpetillas seVie vacia.
    expect(picker).toContain('dentro.length === 0 && listas.length === 0');
  });
});

describe('el inset no esta dos veces', () => {
  it('los titulos de seccion no añaden el que ya pone la hoja', () => {
    const seccion = picker.match(/const SHEET_SECTION = \{([^}]*)\}/)?.[1] ?? '';

    expect(seccion).not.toContain('paddingHorizontal');
    expect(seccion).toContain('paddingTop');
  });

  it('el camino de migas tampoco', () => {
    const path = picker.match(/  path: \{([\s\S]*?)\n  \},/)?.[1] ?? '';

    expect(path).not.toContain('paddingHorizontal');
  });

  it('y este fichero es el unico que lo hacia, asi que la comprobacion sirve', () => {
    // Si otro fichero hace lo mismo, la lista de exclusiones de este test tendria
    // que crecer y el aviso dejaria de ser cierto.
    expect(sheet).toContain('MARGEN');
  });
});
