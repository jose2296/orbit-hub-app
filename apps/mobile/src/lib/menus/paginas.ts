import type { MenuAccion, MenuPageId } from "@/lib/menus/registry";

/**
 * Las paginas que esta version de la hoja sabe montar, y **lo que la hoja puede
 * ofrecer por lo tanto**.
 *
 * ------------------------------------------------------------------
 * POR QUE ESTE ARCHIVO NO ESTA EN `registry.tsx`
 * ------------------------------------------------------------------
 *
 * Porque son dos preguntas distintas y el registro responde una sola. El registro
 * dice **que acciones existen y cuales se pueden usar** —y eso no depende de que
 * este commits haya escrito la pagina—; esta lista dice **cuales de ellas puede
 * pintar esta version de la hoja**, que es una pregunta del estado del trabajo, no
 * del modelo: `access` esta en `ORDEN_POR_KIND` desde la T1 y no se puede ofrecer
 * hasta que exista `AccessPage` en la T8.
 *
 * Juntas en `registry.tsx` una habria contaminado: el registro es el archivo que
 * las cinco entidades y las nueve tareas leen, y `PAGINAS_MONTADAS` es una lista
 * que cambia con cada pagina que se entrega. Separadas, el "que existe" no se mueve
 * cuando llega la T8.
 *
 * ------------------------------------------------------------------
 * POR QUE ESTA AFUERA DE LA HOJA Y NO DENTRO
 * ------------------------------------------------------------------
 *
 * Porque aca no se puede importar. `entity-menu-sheet.tsx` es un componente de
 * React, pero arrastra sus paginas, y una de ellas —`IconPage`— llega a
 * `IconPickerPanel` y de ahi a `@expo/vector-icons`, que en Node no se puede ni
 * parsear. Asi que el filtro vivia dentro de la hoja y **no se podia probar**:
 * ningun test podia importarla, y lo que quedaba era reescribirla character por
 * character en el test —una copia que se desincroniza en silencio, que es
 * exactamente lo que el registro vino a matar—. Aqui no hay React ni `expo`, asi
 * que `test/entity-menu-sheet.test.ts` y `test/bookmark-menu.test.ts` la importan de
 * verdad.
 *
 * ------------------------------------------------------------------
 * POR QUE LA LISTA SIGUE SIENDO ESCRITA Y NO ARMADA EN EL JSX
 * ------------------------------------------------------------------
 *
 * Por la misma razon que antes de mudarla: se puede leer sin renderizar, que es la
 * unica forma de comprobar en este repo que no se ofrece una fila que lleva a un
 * hueco. Que la lista sea de aqui o de alla no cambia eso —lo que la hace
 * comprobable es que sea texto—, y el guard que la cruza con el directorio de
 * paginas de verdad esta en `test/entity-menu-sheet.test.ts:219`, derivado del disco.
 *
 * Y lo que **no** puede hacer esta lista es derivarse del directorio en runtime:
 * `readdirSync` es de Node y la app corre en un runtime que no lo tiene. La
 * derivacion va del lado del test, que si puede leer el disco.
 */
/*
  `share` se sumo con la pagina que la monta (`menus/pages/share-page.tsx`, la T11).

  Y no es una fila mas: `ACCIONES.share` declara `destino: { tipo: "pagina",
  page: "share" }` **desde la T1**, y `ORDEN_POR_KIND` la lista para `list`, `note`
  y `folder`. Sin esta entrada el filtro saca la fila entera, y **compartir deja de
  existir en el menu** —que es exactamente lo que paso con la hoja de lista cuando
  paso al registro en la T6, y nadie lo noto porque "una fila que no esta" y "una
  fila que todavia no se escribio" se ven igual desde el menu.

  Por eso el orden de la lista es el orden en que llegaron las paginas y no el
  del registro: el registro dice que acciones existen, esta dice cuales puede
  pintar **esta** version de la hoja.
*/
export const PAGINAS_MONTADAS: MenuPageId[] = ["rename", "icon", "delete", "share", "create"];

/**
 * Si la accion se ofrece, y **el filtro no es de disponibilidad**.
 *
 * El registro ya decidio que la accion existe y si se puede: eso no se vuelve a
 * preguntar aca. Lo que se pregunta es otra cosa, mas chica: si esta version de la
 * hoja tiene el componente de esa pagina. Una fila que lleva a una pagina que
 * todavia no se escribio es "una opcion que se dibuja y no hace nada al tocarla",
 * que es exactamente lo que `registry.tsx` dice que es peor que una opcion que no
 * esta —y por eso el filtro no es silencioso: `test/entity-menu-sheet.test.ts` tiene
 * escritos, de a uno, los ids de pagina que quedan sin montar, asi que filtrar por
 * capacidad de la hoja y perder una fila por otra causa no se confunden.
 *
 * ------------------------------------------------------------------
 * POR QUE NO LLEVA UN `ctx`
 * ------------------------------------------------------------------
 *
 * Porque no lo necesita: el unico dato que consulta es el destino, y el destino no
 * depende de la entidad. La firma de `ACCIONES.delete.disponible` lleva `ctx` porque
 * esa si lee `shared` y `role`; esta no lee nada de la entidad, asi que agregar el
 * parametro seria un argumento que el compilador marca como no usado
 * (`noUnusedParameters`) y que el proximo que llegaria a tocarlo le daria la
 * impresion de que el filtro depende de algo cuando no depende de nada.
 */
export function puedeOfrecerse(accion: MenuAccion): boolean {
  return accion.destino.tipo !== "pagina" || PAGINAS_MONTADAS.includes(accion.destino.page);
}
