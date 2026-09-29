import { describe, expect, it } from 'vitest';

import {
  alcanceDe,
  activeFilterCount,
  EMPTY_FILTER,
  enAlcance,
  matchesFilter,
  moveRow,
  sortRows,
  type ContentRow,
} from '../src/lib/content-order';

/**
 * The three things in a folder, ordered as one list.
 *
 * Two of these are arithmetic and one is a promise: that a row nobody has ever
 * placed does not land on top of the rows somebody did place. That last one is
 * the whole reason position zero is a sentinel and not an index, and it is the
 * kind of thing that passes a look and fails on somebody's account with three
 * years of notes in it.
 */
const fila = (over: Partial<ContentRow> & { id: string }): ContentRow => ({
  kind: 'list',
  name: over.id,
  position: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  folderId: null,
  ...over,
});

describe('ordenar una lista mezclada', () => {
  it('pone lo colocado por su posicion y lo no colocado al final', () => {
    const filas = [
      fila({ id: 'a', position: 0, name: 'sin colocar' }),
      fila({ id: 'b', position: 2, name: 'segundo' }),
      fila({ id: 'c', position: 1, name: 'primero' }),
    ];
    const manual = sortRows(filas, 'manual');
    expect(manual.map((f) => f.id)).toEqual(['c', 'b', 'a']);
  });

  it('entre lo no colocado manda la fecha, y va de mas antiguo a mas nuevo', () => {
    const filas = [
      fila({ id: 'vieja', position: 0, createdAt: '2024-01-01T00:00:00.000Z' }),
      fila({ id: 'nueva', position: 0, createdAt: '2026-06-01T00:00:00.000Z' }),
    ];
    // Lo no colocado va al final, y dentro de eso manda la fecha hacia delante,
    // que es lo mismo que hace el resto del orden a mano. Poner lo no colocado
    // del reves —el mas nuevo primero— solo por ser lo no colocado seria una
    // segunda regla dentro de la misma regla, y una regla con dos sentidos es
    // una que hay que recordar.
    expect(sortRows(filas, 'manual').map((f) => f.id)).toEqual(['vieja', 'nueva']);
    expect(sortRows(filas, 'created_asc').map((f) => f.id)).toEqual(['vieja', 'nueva']);
  });

  it('antes de que nadie mueva nada, manda la fecha por las tres clases', () => {
    /*
     * El estado en el que llega una carpeta: cada clase cuenta desde uno y no sabe
     * nada de las otras dos. Agrupar por tipo seria volver a dibujar las tres
     * secciones que esta lista sustituyo, asi que el empate lo resuelve la fecha
     * y la lista sale en el orden en que se hizo cada cosa.
     */
    const filas = [
      fila({ id: 'nota1', kind: 'note', position: 1, name: 'Nota', createdAt: '2026-01-01T00:00:00.000Z' }),
      fila({ id: 'lista1', kind: 'list', position: 1, name: 'Lista', createdAt: '2025-01-01T00:00:00.000Z' }),
      fila({ id: 'lista2', kind: 'list', position: 2, name: 'Otra', createdAt: '2026-06-01T00:00:00.000Z' }),
      fila({ id: 'carpeta1', kind: 'folder', position: 1, name: 'Carpeta', createdAt: '2024-01-01T00:00:00.000Z' }),
    ];
    // Numero primero; a igualdad, la mas antigua antes. Y al llegar a la posicion
    // 2, la lista vuelve a preceder a la nota porque el numero manda.
    expect(sortRows(filas, 'manual').map((f) => f.id)).toEqual([
      'carpeta1',
      'lista1',
      'nota1',
      'lista2',
    ]);
  });

  it('el alfabetico si mezcla las tres clases, porque ahi no hay numeros', () => {
    const filas = [
      fila({ id: 'nota', kind: 'note', name: 'Alfa' }),
      fila({ id: 'lista', kind: 'list', name: 'Beta' }),
      fila({ id: 'carpeta', kind: 'folder', name: 'Gamma' }),
    ];
    expect(sortRows(filas, 'alphabetical').map((f) => f.id)).toEqual([
      'nota',
      'lista',
      'carpeta',
    ]);
  });

  it('los dos empates de posicion caen en el mismo orden en los dos aparato', () => {
    const filas = [
      fila({ id: 'z', position: 3 }),
      fila({ id: 'a', position: 3 }),
    ];
    expect(sortRows(filas, 'manual').map((f) => f.id)).toEqual(['a', 'z']);
  });

  it('alfabetico y su inverso son el mismo orden dado la vuelta', () => {
    const filas = [
      fila({ id: '1', name: 'Alfa' }),
      fila({ id: '2', name: 'beta' }),
      fila({ id: '3', name: 'Gamma 2' }),
      fila({ id: '4', name: 'gamma 10' }),
    ];
    const ida = sortRows(filas, 'alphabetical').map((f) => f.name);
    const vuelta = sortRows(filas, 'alphabetical_desc').map((f) => f.name);
    expect(ida).toEqual(['Alfa', 'beta', 'Gamma 2', 'gamma 10']);
    expect(vuelta).toEqual([...ida].reverse());
  });

  it('ordena numeros dentro de los nombres, no como texto', () => {
    const filas = [
      fila({ id: '1', name: 'Episodio 10' }),
      fila({ id: '2', name: 'Episodio 2' }),
    ];
    expect(sortRows(filas, 'alphabetical').map((f) => f.name)).toEqual([
      'Episodio 2',
      'Episodio 10',
    ]);
  });

  it('creacion ascendente y descendente son la vuelta uno del otro', () => {
    const filas = [
      fila({ id: 'a', createdAt: '2026-03-01T00:00:00.000Z' }),
      fila({ id: 'b', createdAt: '2025-01-01T00:00:00.000Z' }),
    ];
    expect(sortRows(filas, 'created_asc').map((f) => f.id)).toEqual(['b', 'a']);
    expect(sortRows(filas, 'created_desc').map((f) => f.id)).toEqual(['a', 'b']);
  });
});

describe('mover una fila', () => {
  it('devuelve solo las filas cuyo numero cambio, no todas', () => {
    const filas = [
      fila({ id: 'a', position: 1 }),
      fila({ id: 'b', position: 2 }),
      fila({ id: 'c', position: 3 }),
      fila({ id: 'd', position: 4 }),
    ];
    // Sacar 'a' del principio y ponerlo en el segundo hueco.
    const { ordered, changed } = moveRow(filas, 'a', 1);
    expect(ordered.map((f) => f.id)).toEqual(['b', 'a', 'c', 'd']);
    // Solo se han movido 'a' y 'b'; 'c' y 'd' siguen donde estaban.
    expect(changed.map((f) => f.id).sort()).toEqual(['a', 'b']);
  });

  it('el numero que se escribe nunca es cero', () => {
    const filas = [fila({ id: 'a', position: 0 }), fila({ id: 'b', position: 0 })];
    const { changed } = moveRow(filas, 'b', -1);
    expect(changed.every((f) => f.position > 0)).toBe(true);
  });

  it('moverse fuera de rango no cambia nada', () => {
    const filas = [fila({ id: 'a', position: 1 }), fila({ id: 'b', position: 2 })];
    for (const delta of [-1, 5, 0]) {
      const { ordered, changed } = moveRow(filas, 'a', delta);
      expect(changed).toEqual([]);
      expect(ordered.map((f) => f.id)).toEqual(['a', 'b']);
    }
  });

  it('una fila que no esta no rompe nada', () => {
    const filas = [fila({ id: 'a', position: 1 })];
    const { changed } = moveRow(filas, 'fantasma', 1);
    expect(changed).toEqual([]);
  });
});

describe('hasta donde mira el filtro', () => {
  const notaEn = (id: string, folderId: string | null) =>
    fila({ id, kind: 'note', folderId });
  const ESPACIO = 'w1';

  it('sin nada puesto, mira el nivel en el que se esta', () => {
    expect(alcanceDe(EMPTY_FILTER)).toEqual({ tipo: 'nivel' });
    const nivel = alcanceDe(EMPTY_FILTER);
    expect(enAlcance(notaEn('a', ESPACIO), nivel, ESPACIO)).toBe(true);
    expect(enAlcance(notaEn('b', 'otra'), nivel, ESPACIO)).toBe(false);
  });

  it('una carpeta elegida se asoma a su contenido, en vez de vaciar la lista', () => {
    /* El fallo que hizo falta para escribir esto: el contenido de una carpeta hija no
       esta en la lista del nivel, asi que filtrar por ella dejaba la pantalla
       vacia con la pastilla encendida. Con el alcance, la lista ES esa carpeta. */
    const alcance = alcanceDe({ ...EMPTY_FILTER, folderId: 'personas' });
    expect(alcance).toEqual({ tipo: 'carpeta', folderId: 'personas' });
    const nivel = null;
    expect(enAlcance(notaEn('a', 'personas'), alcance, nivel)).toBe(true);
    expect(enAlcance(notaEn('b', null), alcance, nivel)).toBe(false);
  });

  it('un tipo elegido busca en todo el espacio, no solo en la raiz', () => {
    const alcance = alcanceDe({ ...EMPTY_FILTER, kind: 'note' });
    expect(alcance).toEqual({ tipo: 'espacio' });
    // Lo que hay en el nivel mas profundo tambien sale.
    expect(enAlcance(notaEn('a', 'personas'), alcance, null)).toBe(true);
    expect(enAlcance(notaEn('b', 'personas/invitados'), alcance, null)).toBe(true);
  });

  it('la carpeta manda sobre el tipo, porque es mas estrecha', () => {
    const alcance = alcanceDe({ ...EMPTY_FILTER, kind: 'note', folderId: 'personas' });
    expect(alcance).toEqual({ tipo: 'carpeta', folderId: 'personas' });
  });
});

describe('el filtro', () => {
  const nota = fila({ id: 'n', kind: 'note', name: 'Salsa', notePreview: 'ajo, pimienta y mercado central' });
  const lista = fila({ id: 'l', kind: 'list', name: 'Recetas', listKind: 'tasks', folderId: 'f1' });
  const carpeta = fila({ id: 'c', kind: 'folder', name: 'Personas', folderId: 'f1' });

  it('sin filtros pasan todas', () => {
    for (const f of [nota, lista, carpeta]) {
      expect(matchesFilter(f, EMPTY_FILTER)).toBe(true);
    }
  });

  it('el tipo y la carpeta se suman, no se pisan', () => {
    const filtro = { ...EMPTY_FILTER, kind: 'note' as const, folderId: 'f1' };
    expect(matchesFilter(lista, filtro)).toBe(false);
    expect(matchesFilter(nota, filtro)).toBe(false); // la nota no esta en f1
  });

  it('el tipo de lista solo cuenta cuando el filtro es de listas', () => {
    const soloListas = { ...EMPTY_FILTER, kind: 'list' as const, listKind: 'movies' };
    expect(matchesFilter(lista, soloListas)).toBe(false);
    // Una nota no se descarta por no ser de tipo 'movies': el filtro no habla de ella.
    expect(matchesFilter(nota, { ...EMPTY_FILTER, listKind: 'movies' })).toBe(true);
  });

  it('el buscador mira el nombre y tambien el texto de la nota', () => {
    expect(matchesFilter(nota, { ...EMPTY_FILTER, query: 'salsa' })).toBe(true);
    expect(matchesFilter(nota, { ...EMPTY_FILTER, query: 'mercado' })).toBe(true);
    expect(matchesFilter(nota, { ...EMPTY_FILTER, query: 'ajo' })).toBe(true);
    expect(matchesFilter(nota, { ...EMPTY_FILTER, query: 'azucar' })).toBe(false);
  });

  it('el buscador no distingue mayusculas', () => {
    expect(matchesFilter(nota, { ...EMPTY_FILTER, query: 'SALSA' })).toBe(true);
  });

  it('cuenta cuantos filtros hay puestos', () => {
    expect(activeFilterCount(EMPTY_FILTER)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTER, kind: 'note' })).toBe(1);
    expect(
      activeFilterCount({ kind: 'list', listKind: 'tasks', folderId: 'f1', query: 'x' }),
    ).toBe(4);
  });
});
