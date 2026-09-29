/**
 * Donde va una lista nueva, y si hay que preguntar.
 *
 * Una lista pertenece a un espacio igual que una nota, y se preguntan igual: la
 * ruta cuando dice, el único espacio cuando solo hay uno, y una pregunta de
 * verdad cuando hay más de uno.
 *
 * La regla estaba en la pantalla, y ahí es donde estuvo mal. `lists` declaraba su
 * espacio como `string` y lo recibía como `undefined` — el menú llega a `/lists`
 * sin parámetros, porque esa pantalla lista *todas* las listas de todos los
 * espacios — y el formulario de creación estaba detrás de un `if` que era falso
 * justo en ese caso. La pantalla enseñaba tus listas y ninguna forma de añadir
 * otra, y su propio texto decía que se crease una.
 *
 * Aquí se puede preguntar sin montar una pantalla, que es lo único que permite
 * que esto se sepa antes de que alguien lo encuentre en el sitio.
 */

export interface ListPlacementContext {
  /**
   * El espacio de la ruta. `undefined` cuando la pantalla se abrió sin uno, que es
   * como la abre el menú.
   */
  workspaceId?: string;
}

/** Un espacio, con lo mínimo que hace falta para elegirlo. */
export interface PlaceableSpace {
  id: string;
}

export interface ListPlacement {
  workspaceId: string;
}

/**
 * Donde crear la lista, o `null` cuando no hay destino.
 *
 * `null` y no un espacio inventado: la alternativa sería meter la lista en un
 * proyecto que nadie ha abierto nunca, y un `null` se ve en el botón.
 */
export function listPlacement(
  context: ListPlacementContext,
  espacios: readonly PlaceableSpace[],
  elegido?: string | null,
): ListPlacement | null {
  // La ruta manda: se esta dentro de un espacio y el sitio de la lista lo dice.
  if (context.workspaceId) return { workspaceId: context.workspaceId };

  // Lo que se eligió a mano, que se eligió antes de escribir el título.
  if (elegido) return { workspaceId: elegido };

  // Con un solo espacio no hay nada que preguntar. Preguntar de cuál, cuando solo
  // hay uno, es un formulario con una única respuesta posible.
  if (espacios.length === 1) return { workspaceId: espacios[0]!.id };

  return null;
}

/** Si hay que preguntar cuál, que es cuando más de uno y la ruta no dijo. */
export function needsSpaceChoice(
  context: ListPlacementContext,
  espacios: readonly PlaceableSpace[],
): boolean {
  return !context.workspaceId && espacios.length > 1;
}
