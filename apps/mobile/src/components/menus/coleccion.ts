import type { Collection } from "@orbit-hub/contracts";

import { deleteCollectionAction, updateCollectionAction } from "@/lib/collections/actions";
import type { MenuContext } from "@/lib/menus/registry";

import type { MenuHandlers } from "./entity-menu-sheet";

/**
 * Las dos piezas que una coleccion necesita para entrar al menu del registro, y
 * **en un solo archivo** porque las necesitan dos pantallas.
 *
 * ------------------------------------------------------------------
 * POR QUE NO SE ARMA EN CADA PANTALLA
 * ------------------------------------------------------------------
 *
 * Porque el menu de una coleccion se abre desde el listado del espacio y desde
 * el de la carpeta, y las dos pantallas tendrian que escribir la misma
 * normalizacion —`Collection.name` a `MenuEntity.title`, `role` y `shared` del
 * contrato— y las mismas dos acciones. Dos copias de eso son dos menus de
 * coleccion que empiezan a diferir el dia que cambie algo, que es exactamente
 * lo que este trabajo viene a evitar.
 *
 * Y lo que **no** hay aca es ninguna lista de opciones: esa vive en
 * `accionesPara(ctx)`. Lo de este archivo es la mecanica —guardar y borrar— y la
 * unica normalizacion, que el registro no puede hacer porque no conoce el
 * contrato de ninguna entidad.
 */
export function menuCtxDeColeccion(collection: Collection | null): MenuContext | null {
  if (!collection) return null;

  return {
    kind: "collection",
    entity: {
      id: collection.id,
      // `Collection` dice `name` y `MenuEntity` dice `title`. Es la misma cosa
      // con dos nombres, y el registro ordena y compara sobre `title`.
      title: collection.name,
      role: collection.role,
      shared: collection.shared,
    },
    // Sin `export`: no hay `GET /collections/:id/export` todavia, y por eso la
    // fila no se ofrece en vez de ofrecerse y fallar.
    caps: {},
  };
}

/**
 * Guardar y borrar, con las acciones que ya existen.
 *
 * Borrar **no** se unifica aqui ni en el registro: cada superficie sigue
 * usando la suya, porque cada una hace algo distinto antes de escribir —la de
 * colecciones saca sus enlaces de la coleccion antes de mandar el tombstone— y
 * unificar eso es otro corte.
 */
export function handlersDeColeccion(collection: Collection | null): MenuHandlers {
  if (!collection) return {};

  return {
    rename: (name) =>
      updateCollectionAction({ id: collection.id, baseVersion: collection.version, name }),
    borrar: () => deleteCollectionAction(collection.id),
  };
}
