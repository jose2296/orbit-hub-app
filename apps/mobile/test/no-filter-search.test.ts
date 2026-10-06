import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * El buscador dentro del modal de filtros.
 *
 * Lo que se pidió fue quitarlo, porque la búsqueda que sí sirve —la que además
 * deja marcar el resultado como hecho— ya existe y es la global. Lo que había en
 * el modal era un **duplicado**: la misma caja de texto, applied en la lista
 * mientras estás dentro de ella, sin casilla para marcar nada.
 *
 * Y no era un duplicado inocuo. `use-list-items` cuenta un filtro de texto como
 * filtro activo, así que abrir la hoja, escribir medio trozo de artículo y cerrar
 * dejaba la lista filtrada sin que el botón dijera por qué: un número que sube y
 * un lista más corta, y ninguna pista de que volver atrás es lo que lo arregla.
 *
 * Estos tests leen el fuente porque esto es una decisión sobre qué hay en un
 * componente, y no una función.
 */

const SRC = join(import.meta.dirname, '..', 'src');

function sourceFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry)) {
      found.push(path);
    }
  }

  return found;
}

describe('el modal de filtros no_busca', () => {
  it('ningún cuerpo de filtro tiene ya un campo de texto', () => {
    // Los tres: tareas, películas y carpetas/listas/notas.
    const conBuscador = sourceFiles(SRC).filter((path) => {
      if (!/(item-picker|media-filters-body|content-filters-body)\.tsx$/.test(path)) return false;

      const source = readFileSync(path, 'utf8');
      return /filters\.search(Label|Placeholder)/.test(source);
    });

    expect(conBuscador.map((p) => p.replace(`${SRC}/`, 'src'))).toEqual([]);
  });

  it('la lista ya no lleva un filtro de texto en su estado', () => {
    const pantalla = readFileSync(join(SRC, 'app', '(app)', 'list', '[listId].tsx'), 'utf8');

    expect(pantalla).not.toContain('filterText');
    expect(pantalla).not.toContain('setFilterText');
  });

  it('la búsqueda que sí queda es la global, y puede marcar el resultado', () => {
    // Lo que se substitutes. Si esto deja de tener casilla, quitar el buscador del
    // modal deja a alguien sin forma de buscar *y* marcar, que era el motivo.
    const busqueda = readFileSync(join(SRC, 'app', '(app)', 'search.tsx'), 'utf8');

    expect(busqueda).toContain('Checkbox');
    expect(busqueda).toContain('toggleCompleted');
  });

  it('y marcar desde un resultado no necesita traerse la fila entera', () => {
    // El comentario de `toggleCompleted` lo explica: solo los dos campos que lee.
    // Si somebody empieza a pedir la fila, el buscador global deja de ser una
    // respuesta ligera y la quitata del modal ya no tiene sustituto.
    const hooks = readFileSync(join(SRC, 'hooks', 'use-lists.ts'), 'utf8');
    const firma = hooks.match(/async \(item: \{([^}]*)\}\)/)?.[1] ?? '';

    expect(firma).toContain('id');
    expect(firma).toContain('completed');
  });
});

describe('los filtros que quedan siguen ahí', () => {
  it('lo de "solo lo queda" y "solo lo hecho" no se toca', () => {
    // Es justo para esto para lo que se abre la hoja: reducir la lista a lo que
    // queda. Quitar el buscador no quita esto.
    const picker = readFileSync(join(SRC, 'components', 'lists', 'item-picker.tsx'), 'utf8');

    expect(picker).toContain('filters.show.');
    expect(picker).toContain('onCompleted');
  });

  it('las etiquetas tampoco', () => {
    const picker = readFileSync(join(SRC, 'components', 'lists', 'item-picker.tsx'), 'utf8');

    expect(picker).toContain('onToggleTag');
  });
});

describe('"quitar los filtros" solo cuando hay algo que quitar', () => {
  it('el botón depende de un número, no de que exista la función', () => {
    // Se offertaba siempre, con las tres casillas ya en "Todo" y ninguna etiqueta
    // puesta. Pulsarlo no cambiaba nada que se viera: una pregunta sin respuesta.
    // Lo vio la captura del modal, con el contador en cero al lado del botón.
    const picker = readFileSync(join(SRC, 'components', 'lists', 'item-picker.tsx'), 'utf8');

    expect(picker).toMatch(/\{activeCount > 0 \? \(\s*<Button/);
  });

  it('y el número es el mismo que cuenta el botón de la cabecera', () => {
    const pantalla = readFileSync(join(SRC, 'app', '(app)', 'list', '[listId].tsx'), 'utf8');

    expect(pantalla).toMatch(/activeCount=\{activeFilterCount\}/);
    expect(pantalla).toMatch(/filterCount=\{activeFilterCount\}/);
  });

  it('el cuerpo no se inventa el número: lo recibe', () => {
    // Si `FiltersBody` calculase el suyo, la cuenta de la cabecera y la del botón
    // de reset podrían discrepar y volvería el caso que se acaba de cerrar.
    const picker = readFileSync(join(SRC, 'components', 'lists', 'item-picker.tsx'), 'utf8');

    expect(picker).toMatch(/activeCount: number;/);
    expect(picker).not.toMatch(/activeCount\s*=\s*[^n]/);
  });
});
