import { describe, expect, it } from 'vitest';

import {
  listPlacement,
  needsSpaceChoice,
  type PlaceableSpace,
} from '../src/lib/lists/placement';

/**
 * Donde va una lista nueva.
 *
 * La pantalla de listas mostraba tus listas y ninguna forma de añadir otra,
 * siempre — y su propio texto de vacío decía que se crease una. La causa era un
 * tipo: la ruta declara el espacio como `string` y el menú llega a `/lists` sin
 * ninguno, así que el `if` que escondía el formulario era falso justo en el caso
 * para el que existía.
 */

const ESPACIOS: PlaceableSpace[] = [{ id: 'w1' }, { id: 'w2' }];

describe('listPlacement', () => {
  it('usa el espacio de la ruta cuando la hay', () => {
    expect(listPlacement({ workspaceId: 'w9' }, ESPACIOS)).toEqual({ workspaceId: 'w9' });
  });

  it('usa el espacio elegido a mano cuando no hay ruta', () => {
    expect(listPlacement({}, ESPACIOS, 'w2')).toEqual({ workspaceId: 'w2' });
  });

  it('usa el unico espacio sin preguntar', () => {
    // Preguntar de cuál cuando solo hay uno es un formulario con una respuesta.
    expect(listPlacement({}, [{ id: 'w1' }])).toEqual({ workspaceId: 'w1' });
  });

  it('no tiene destino con varios espacios y sin eleccion', () => {
    // Y no se inventa uno: meter la lista en un proyecto que nadie ha abierto es
    // peor que no crearla.
    expect(listPlacement({}, ESPACIOS)).toBeNull();
  });

  it('no tiene destino sin ningun espacio', () => {
    expect(listPlacement({}, [])).toBeNull();
  });

  it('elige la ruta aunque se haya tocado el destino a mano', () => {
    // La ruta dice donde estamos. Cambiarlo desde la pantalla haria que la lista
    // acabase en un sitio del que no se salio.
    expect(listPlacement({ workspaceId: 'w9' }, ESPACIOS, 'w2')).toEqual({ workspaceId: 'w9' });
  });
});

describe('needsSpaceChoice', () => {
  it('pregunta con varios espacios y sin ruta', () => {
    expect(needsSpaceChoice({}, ESPACIOS)).toBe(true);
  });

  it('no pregunta dentro de un espacio', () => {
    expect(needsSpaceChoice({ workspaceId: 'w1' }, ESPACIOS)).toBe(false);
  });

  it('no pregunta cuando solo hay un espacio', () => {
    expect(needsSpaceChoice({}, [{ id: 'w1' }])).toBe(false);
  });
});
