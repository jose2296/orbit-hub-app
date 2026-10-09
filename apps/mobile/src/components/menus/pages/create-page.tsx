import { useMemo } from "react";

import type { ListKind } from "@orbit-hub/contracts";

import { SheetOptions } from "@/components/ui/sheet";
import type { SheetOption } from "@/components/ui/sheet";
import { useTranslation } from "@/lib/i18n";
import { LIST_KIND_LABEL, LIST_KIND_ORDER } from "@/lib/lists/kind";

export interface CreatePageProps {
  /**
   * Que se hace con el tipo que la persona eligio, y **es de la pantalla**.
   *
   * La hoja vieja llamaba `onCreateInside(kind)` y nada mas: el `Sheet` de los tipos
   * se cerraba solo porque la pantalla que abrio el menu abria su propia hoja de
   * creacion, y esa hoja es la que tiene el nombre que se escribe. Delegar es toda la
   * pagina —el `kind` vuelve al call site y el call site decide— y por eso no hay
   * ningun `onClose` aqui: quien decide si el menu se va es la pantalla que lo abrio,
   * igual que con el Guardar de la pagina de compartir.
   */
  onSelect: (kind: ListKind) => void;
}

/**
 * Poner una lista **adentro**, y los seis tipos.
 *
 * ------------------------------------------------------------------
 * POR QUE NO ES `CreateSheet`
 * ------------------------------------------------------------------
 *
 * Porque `CreateSheet` es otra cosa: es la superficie de tres pasos del boton "+" —
 * "que vas a crear", "de que tipo", "el nombre"— y su `CreateKind` son los seis tipos
 * de lista **mas** carpeta, nota y coleccion. Montarla aca seria poner un formulario
 * de tres pasos dentro de una fila del menu, y ademas duplicaria el paso de elegir el
 * tipo en dos sitios: el de esta pagina y el del `Sheet` que abriria.
 *
 * La hoja vieja de carpeta **no** montaba `CreateSheet`. Abria una hoja hermana con
 * un `SheetOptions` de `LIST_KIND_ORDER` y llamaba `onCreateInside(kind)`, y esta
 * pagina es exactamente eso, con la diferencia que ahora es un `step` del `Sheet` de
 * la hoja unica y no un `Modal` encima de otro `Modal`.
 *
 * ------------------------------------------------------------------
 * LAS FILAS SE DERIVAN, Y NO HAY UNA COPIA DE LOS TIPOS
 * ------------------------------------------------------------------
 *
 * `LIST_KIND_ORDER` es un `ListKind[]` y es **el unico** lugar del repo donde se
 * decide el orden de los tipos: lo leen el formulario de la pantalla de listas, el
 * paso de tipo de `CreateSheet` y esta pagina. Escribirlos aca seria la cuarta copia
 * del mismo dato, y la que se desincroniza sin que nada falle —que es exactamente lo
 * que `test/list-kinds.test.ts` cuenta con su `toHaveLength`, y ese numero vuelve a
 * ser tres con este archivo.
 *
 * ------------------------------------------------------------------
 * SIN ICONOS Y SIN DESCRIPCIONES, COMO LAS TENIA LA HOJA VIEJA
 * ------------------------------------------------------------------
 *
 * Porque las filas del selector de la hoja vieja eran `key`, `label` y `onPress`, y
 * cualquier cosa mas aqui seria inventar una diferencia que nadie pidio. La pantalla
 * que se esta alrededor ya dice de que se trata —el nombre de la carpeta y el
 * subtitulo que la hoja pone con `lists.createHere`—, asi que la fila no necesita
 * repetirlo.
 *
 * ------------------------------------------------------------------
 * Y LO QUE ESTA PAGINA NO SABE
 * ------------------------------------------------------------------
 *
 * No sabe que se llama "Crear una lista aqui" —eso lo decide el registro, que es la
 * unica fuente del copy— ni si la carpeta es del dueno, ni como se crea una lista.
 * Solo sabe el orden de los tipos y como se llega a cada uno. Un `role` escrito aca
 * seria la misma regla en dos casas, y la que se desincroniza es la que nadie prueba.
 */
export function CreatePage({ onSelect }: CreatePageProps) {
  const t = useTranslation();

  const opciones: SheetOption[] = useMemo(
    () =>
      LIST_KIND_ORDER.map((kind) => ({
        key: kind,
        label: t(LIST_KIND_LABEL[kind]),
        onPress: () => onSelect(kind),
      })),
    [onSelect, t],
  );

  return <SheetOptions options={opciones} />;
}
