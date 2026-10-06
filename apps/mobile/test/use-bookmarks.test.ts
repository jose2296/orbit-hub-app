import { describe, expect, it, vi } from 'vitest';

import type { Bookmark } from '@orbit-hub/contracts';

import {
  applyBookmarkFilters,
  readBookmarkFromRow,
  selectUnclassifiedBookmarks,
  sortBookmarks,
  withBookmarkDefaults,
} from '../src/hooks/use-bookmarks';
import type { CachedEntity } from '../src/lib/offline/local-store';

/**
 * Los datos de bookmarks, sin React.
 *
 * Los hooks (`useBookmarks`, `useBookmark`, `useUnclassifiedCount`) son finos:
 * leen la cache y delegan en estas funciones puras. Asi que lo que se puede
 * romper —el filtro de sin-clasificar, el orden, las tombstones— se prueba
 * aqui sin montar ni un componente.
 */

vi.mock('@/lib/offline', () => ({
  getLocalStoreReady: vi.fn(),
  subscribeToLocalStore: vi.fn(() => () => undefined),
}));

const BASE: Bookmark = {
  id: 'b1',
  version: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  workspaceId: 'w1',
  folderId: 'f1',
  collectionId: 'c1',
  url: 'https://ejemplo.test/salsa',
  title: 'Salsa',
  siteName: 'Ejemplo',
  description: 'Receta de salsa',
  imageUrl: null,
  document: '<p>Seis tomates</p>',
  plainText: 'Seis tomates',
  extractionState: 'ready',
  extractionError: null,
  tags: ['cocina'],
  position: 2,
  role: 'owner',
  shared: false,
  deletedAt: null,
};

function fila(overrides: Partial<CachedEntity> = {}): CachedEntity {
  const { id, ...resto } = BASE;
  void id;
  return {
    entity: 'bookmark',
    entityId: 'b1',
    version: 3,
    updatedAt: '2026-01-02T00:00:00.000Z',
    deletedAt: null,
    payload: JSON.stringify(resto),
    pending: null,
    ...overrides,
  };
}

describe('readBookmarkFromRow', () => {
  it('devuelve el servidor cuando no hay nada pendiente', () => {
    expect(readBookmarkFromRow(fila())).toEqual(BASE);
  });

  it('lo pendiente gana sobre el servidor sin perder lo demas', () => {
    const row = fila({ pending: JSON.stringify({ title: 'Local', collectionId: null }) });
    const leido = readBookmarkFromRow(row);

    expect(leido.title).toBe('Local');
    expect(leido.collectionId).toBeNull();
    expect(leido.url).toBe('https://ejemplo.test/salsa');
  });

  it('las columnas del envoltorio mandan sobre el payload', () => {
    const row = fila({ version: 9, updatedAt: '2026-03-01T00:00:00.000Z' });
    const leido = readBookmarkFromRow(row);

    expect(leido.id).toBe('b1');
    expect(leido.version).toBe(9);
    expect(leido.updatedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('una fila del listado REST (sin document ni plainText) se lee vacia', () => {
    // El listado recorta los dos campos porque pesan hasta 512 KB. No es un
    // dato roto: es la forma del listado, y el lector pide el texto aparte.
    const { document, plainText, ...recortado } = BASE;
    void document;
    void plainText;
    const leido = readBookmarkFromRow(fila({ payload: JSON.stringify(recortado) }));

    expect(leido.document).toBe('');
    expect(leido.plainText).toBe('');
    expect(leido.title).toBe('Salsa');
  });

  it('expone la tombstone para que la lista la pueda esconder', () => {
    const row = fila({ deletedAt: '2026-02-01T00:00:00.000Z' });

    expect(readBookmarkFromRow(row).deletedAt).toBe('2026-02-01T00:00:00.000Z');
  });
});

describe('withBookmarkDefaults', () => {
  it('un estado de extraccion que no existe se lee como pendiente', () => {
    expect(withBookmarkDefaults({ ...BASE, extractionState: 'nuevo' }).extractionState).toBe(
      'pending',
    );
  });

  it('etiquetas que no son lista se leen como lista vacia', () => {
    expect(withBookmarkDefaults({ ...BASE, tags: 'cocina' }).tags).toEqual([]);
  });
});

describe('applyBookmarkFilters', () => {
  const otro: Bookmark = {
    ...BASE,
    id: 'b2',
    workspaceId: 'w2',
    folderId: null,
    collectionId: null,
    title: 'Pan',
  };
  const todos = [BASE, otro];

  it('por espacio', () => {
    expect(applyBookmarkFilters(todos, { workspaceId: 'w1' }).map((b) => b.id)).toEqual(['b1']);
  });

  it('por carpeta, y sabe pedir los que no estan en ninguna', () => {
    // `null` es la raiz del espacio y `undefined` es no filtrar. Confundirlos
    // esconde todos los sueltos, y nada lo canta.
    expect(applyBookmarkFilters(todos, { folderId: 'f1' }).map((b) => b.id)).toEqual(['b1']);
    expect(applyBookmarkFilters(todos, { folderId: null }).map((b) => b.id)).toEqual(['b2']);
    expect(applyBookmarkFilters(todos, {}).map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('por coleccion y por sin-clasificar', () => {
    expect(applyBookmarkFilters(todos, { collectionId: 'c1' }).map((b) => b.id)).toEqual(['b1']);
    expect(applyBookmarkFilters(todos, { collectionId: 'unclassified' }).map((b) => b.id)).toEqual([
      'b2',
    ]);
    expect(applyBookmarkFilters(todos, {}).map((b) => b.id)).toEqual(['b1', 'b2']);
  });
});

describe('sortBookmarks', () => {
  it('ordena por updatedAt descendente, no por createdAt', () => {
    // El caso que canta copiar el molde sin pensar: `viejo` se creo despues
    // pero se guardo antes, y en "leer despues" va debajo.
    const viejo: Bookmark = {
      ...BASE,
      id: 'viejo',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const nuevo: Bookmark = {
      ...BASE,
      id: 'nuevo',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    };

    expect(sortBookmarks([viejo, nuevo]).map((b) => b.id)).toEqual(['nuevo', 'viejo']);
  });

  it('no reordena al llamante', () => {
    const a: Bookmark = { ...BASE, id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' };
    const b: Bookmark = { ...BASE, id: 'b', updatedAt: '2026-02-01T00:00:00.000Z' };
    const entrada = [a, b];
    sortBookmarks(entrada);

    expect(entrada.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('selectUnclassifiedBookmarks', () => {
  it('cuenta solo vivos sin coleccion del espacio', () => {
    const todos: Bookmark[] = [
      { ...BASE, id: 'libre', collectionId: null },
      { ...BASE, id: 'suelto', collectionId: null },
      { ...BASE, id: 'colocado', collectionId: 'c1' },
      { ...BASE, id: 'borrado', collectionId: null, deletedAt: '2026-02-01T00:00:00.000Z' },
      { ...BASE, id: 'otro-espacio', workspaceId: 'w2', collectionId: null, folderId: null },
    ];

    const vivos = selectUnclassifiedBookmarks(todos, 'w1').map((b) => b.id);

    // El colocado esta en una coleccion, el borrado es una tombstone y el de
    // otro espacio no es de este: el badge que los cuente miente.
    expect(vivos).toEqual(['libre', 'suelto']);
  });

  it('borrar una coleccion sube el conteo', () => {
    // Review Focus #4 en su forma de datos: al borrar la coleccion sus 50
    // bookmarks quedan huerfanos (`collectionId` a null) y el badge pasa a 50.
    const huerfanos: Bookmark[] = Array.from({ length: 50 }, (_, i) => ({
      ...BASE,
      id: `huerfano-${i}`,
      folderId: null,
      collectionId: null,
    }));

    expect(selectUnclassifiedBookmarks(huerfanos, 'w1')).toHaveLength(50);
  });
});
