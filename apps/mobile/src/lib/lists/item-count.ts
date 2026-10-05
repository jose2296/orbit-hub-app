import type { List } from '@orbit-hub/contracts';

/**
 * El número de items de una lista, contado desde la caché.
 *
 * `itemCount` venía del servidor como una foto, y la foto no se refrescaba: la
 * proyección se recalcula cuando cambia **la lista**, y añadir o completar un
 * item cambia el item. Así que una lista creada y rellenada en el móvil valía 0
 * para siempre, y ese 0 estaba en la confirmación de un borrado que no se puede
 * deshacer.
 *
 * Aquí solo se cuenta lo que hay en la caché local, que es donde vive el item y
 * donde se ve primero. Es lo que hace que la app local-first pueda mostrar un
 * número sin pedir nada a nadie, y es la única fuente que no puede quedarse vieja
 * mientras el dispositivo no haya sincronizado.
 *
 * Devuelve las mismas referencias y el mismo array cuando nada cambia: `useLists`
 * compara antes de re-renderizar, y un array nuevo en cada carga repinta la
 * pantalla entera cada vez que llega un item de cualquier otra lista.
 */
export function applyItemCounts(
  lists: List[],
  counts: ReadonlyMap<string, number>,
): List[] {
  let cambióAlgo = false;
  const corregidas = lists.map((list) => {
    const reales = counts.get(list.id) ?? 0;

    if (list.itemCount === reales) return list;

    cambióAlgo = true;
    return { ...list, itemCount: reales };
  });

  return cambióAlgo ? corregidas : lists;
}
