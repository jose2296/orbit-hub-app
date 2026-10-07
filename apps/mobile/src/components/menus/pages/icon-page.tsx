import type { IconRef } from "@orbit-hub/contracts";

import { IconPickerPanel } from "@/components/ui/icon-picker-sheet";

/**
 * ------------------------------------------------------------------
 * POR QUE NO RECIBE `ctx`
 * ------------------------------------------------------------------
 *
 * Porque no hay nada del tipo de entidad que usar aca: poner icono es poner
 * icono en una lista, en una nota y en una carpeta, y el `IconPickerPanel` es
 * el mismo para las tres. `DeletePage` recibe el `ctx` porque necesita el badge
 * de compartir y un cuerpo de confirmacion distinto por tipo; esta pagina no
 * dice ni una palabra que cambie con el tipo, asi que un `ctx` sin usar seria
 * una firma que miente sobre lo que la pagina necesita.
 *
 * ------------------------------------------------------------------
 * POR QUE EL ICONO ES UN PROP Y NO ESTADO DE LA PAGINA
 * ------------------------------------------------------------------
 *
 * Porque elijo y se guarda: no hay borrador. Tocar una celda llama `onSelect` y
 * el handler escribe, que es lo que hacen hoy las cuatro hojas que esta pagina
 * reemplaza (`list-menu-sheet.tsx:598`, `note-menu-sheet.tsx:343`,
 * `workspace-menu-sheet.tsx:312` y `item-edit-sheet.tsx:1222`, las cuatro con
 * `current` tomado de la entidad y sin ningun estado local). Un borrador
 * obligaria a un boton de guardar que ninguna de las cuatro tenia, y el que
 * guardara no seria el mismo trabajo: seria otro camino de escritura para la
 * misma accion.
 *
 * Y el `current` no se copia en un `useState` de la pagina: la verdad del icono
 * la tiene la entidad, y una segunda copia se desincroniza en el instante en que
 * el guardado falla o en que la entidad cambia afuera. La unica excepcion es el
 * borrador del nombre, y ese existe porque `Sheet` necesita preguntar antes de
 * cerrar —aca no hay nada que perder, porque lo que se toco ya se guardo—.
 */
export interface IconPageProps {
  /**
   * El icono que tiene la entidad ahora, o `null` si no tiene.
   *
   * `null` y no `undefined` a proposito: el selector usa `current` para decidir
   * si existe la fila de "Sin icono" (`icon-picker-sheet.tsx:495`), o sea que
   * un `undefined` preguntando por un icono que existe dejaria la fila sin
   * pintar y **quitar el icono seria imposible desde el menu**.
   */
  icon: IconRef | null;
  /**
   * El handler, **ya envuelto por la hoja**: avisa el fallo sin cerrar, deja el
   * menu abierto y no cierra al ir bien —esta pagina se sigue usando para
   * elegir otro icono—. Por eso la pagina no hace try/catch, igual que las
   * otras dos.
   *
   * Y el `null` viaja: es lo que dice "sin icono", y el que lo recibe es el
   * handler del call site.
   */
  onSelect: (icon: IconRef | null) => void;
}

/**
 * Elegir el icono de una entidad, y la misma pagina para las tres que lo tienen.
 *
 * ------------------------------------------------------------------
 * POR QUE `IconPickerPanel` Y NO `IconPickerSheet`
 * ------------------------------------------------------------------
 *
 * Porque las dos son lo mismo con una `Sheet` alrededor, y esta pagina **ya
 * esta adentro de una**: `EntityMenuSheet` es un `Sheet`, y `Sheet` es un
 * `Modal`. Montar el otro encima son dos fondos sobre una pantalla y un toque
 * que llega a la de arriba cerrando la de abajo —el `Modal` de `folder-menu-sheet`
 * por su misma razon—.
 *
 * Por eso `icon-picker-sheet.tsx:88` exporta `IconPickerPanel` aparte, que es
 * `Pick<IconPickerSheetProps, "current" | "onSelect">`: el panel sin su hoja, para
 * los que ya estan adentro de una. Es la misma puerta que usa el editor de items
 * con su pagina de icono.
 *
 * Y por eso esta pagina **no decide nada del icono**: no sabe que kinds la
 * ofrecen, ni abre ni cierra nada. Que la fila exista o no lo dice el registro
 * (`CON_ICON_REF` en `registry.tsx`: solo lista, nota y carpeta tienen un
 * `IconRef`), y quien corre el guardado es el handler que le pasa la hoja.
 */
export function IconPage({ icon, onSelect }: IconPageProps) {
  return <IconPickerPanel current={icon} onSelect={onSelect} />;
}