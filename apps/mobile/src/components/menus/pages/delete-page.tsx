import { View } from "react-native";

import { SharedBadge } from "@/components/shares/shared-badge";
import { Button } from "@/components/ui/button";
import { AppText } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { ACCIONES } from "@/lib/menus/registry";
import type { MenuContext, MenuKind } from "@/lib/menus/registry";
import { useTheme } from "@/theme";

/**
 * Que dice la confirmacion, y **por que el cuerpo no esta en el registro**.
 *
 * Cada tipo de entidad explica una consecuencia distinta y las cinco son
 * ciertas: una lista se lleva sus elementos, una coleccion **no** se lleva sus
 * enlaces —pasan a "sin clasificar"—, una nota y un enlace se van de este movil
 * y de los demas al sincronizar, y una carpeta deja sus listas sin carpeta. Con un
 * solo texto habria que elegir uno y mentir en los otros cuatro.
 *
 * El registro guarda el `labelKey` de la fila (`ACCIONES.delete.labelKey`), y eso
 * es una etiqueta: "Eliminar". El cuerpo es otra pregunta, y va aca. Cuando el
 * registro lo recoja, esta tabla se borra y no cambia ni el orden ni el disabled:
 * el `motivo` de la fila sigue siendo el del registro.
 */
const CUERPO_POR_KIND: Record<MenuKind, TranslationKey> = {
  list: "lists.deleteBody",
  note: "note.deleteBody",
  folder: "lists.deleteFolderBody",
  collection: "collections.delete.body",
  bookmark: "bookmarks.deleteBody",
};

export interface DeletePageProps {
  ctx: MenuContext;
  /**
   * El handler de borrar, **ya envuelto por la hoja**: corre, avisa el fallo sin
   * cerrar y cierra solo si va bien. Por eso la pagina no hace try/catch.
   */
  onBorrar: () => void;
  trabajando: boolean;
  /**
   * Cuantos elementos tiene la lista, **solo para `list`**.
   *
   * `lists.deleteBody` cuenta: "Se elimina la lista y sus {count} elementos", y
   * sin el numero la frase queda con un `{count}` crudo en pantalla. Y
   * `MenuEntity` no lo trae porque el registro no le pide el numero a nadie: es
   * un dato de la entidad y no una decision de menu, asi que lo pasa el call
   * site que ya lo tiene a mano.
   */
  conteo?: number;
}

/**
 * Confirmar antes de borrar, y la misma pagina para las cinco entidades.
 *
 * ------------------------------------------------------------------
 * POR QUE MONTA EL PANEL DE ACCESO
 * ------------------------------------------------------------------
 *
 * Porque antes de apretar "Eliminar" es el ultimo momento en que se puede saber
 * que la cosa es de otro, y ese dato **ya esta en el `ctx`** de la fila: no hace
 * falta un request para saber que es compartida. Pedirlo despues de abrir el
 * menu es lo que hace que un fallo de red pueda pintar "nadie mas lo tiene" sobre
 * algo que si lo tienen.
 *
 * Cuando exista la pagina de acceso (`AccessPage`, la tarea siguiente) el badge
 * se vera antes, en su propia pagina, y esta se lo queda: borrar es la ultima
 * pantalla antes de que la decision sea irreversible.
 */
export function DeletePage({ ctx, onBorrar, trabajando, conteo }: DeletePageProps) {
  const theme = useTheme();
  const t = useTranslation();

  /*
    El motivo sale del registro y no de aca. Si el `delete` de `ACCIONES` deja de
    traer `motivo`, esta pagina deja de|grayarlo sin tocar una linea: es la
    Review Focus #1 —"una accion destructiva ofrecida a quien no es dueno"— y la
    unica forma de que no se rompa en silencio es que la regla tenga una sola
    casa.

    Y sale **sin cast** porque `MenuAccion.motivo` esta declarado como
    `TranslationKey | null`: si el registro devolviera una clave que no existe,
    el error lo da el compilador y no una pantalla con `{clave}` en vez de una
    frase.
  */
  const motivo = ACCIONES.delete?.motivo?.(ctx) ?? null;
  const puedeBorrar = motivo === null && !trabajando;

  /*
    Una lista sin conteo no puede decir cuantos elementos se van, y la unica frase
    que es cierta sin el numero es la de "no se puede deshacer", que va dos lineas
    mas abajo. Mejor eso que un `{count}` crudo en pantalla.
  */
  const sinContarLista = ctx.kind === "list" && conteo === undefined;
  const cuerpo = sinContarLista
    ? null
    : t(CUERPO_POR_KIND[ctx.kind], { count: conteo ?? 0 });

  return (
    <View style={{ gap: theme.spacing.md }}>
      <SharedBadge shared={ctx.entity.shared} role={ctx.entity.role} />

      {cuerpo ? (
        <AppText variant="body" tone="muted">
          {cuerpo}
        </AppText>
      ) : null}

      {motivo ? (
        <AppText variant="callout" style={{ color: theme.colors.danger }}>
          {t(motivo)}
        </AppText>
      ) : null}

      <AppText variant="caption" tone="subtle">
        {t("confirm.irreversible")}
      </AppText>

      <Button
        label={trabajando ? t("common.saving") : t("common.delete")}
        variant="danger"
        disabled={!puedeBorrar}
        fullWidth
        onPress={onBorrar}
      />
    </View>
  );
}
