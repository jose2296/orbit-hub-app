import type { ListKind } from "@orbit-hub/contracts";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Sheet, SheetOptions } from "@/components/ui/sheet";
import type { SheetOption, SheetOrigin } from "@/components/ui/sheet";
import { useSheetSucio } from "@/components/ui/sheet-sucio";
import { AppText } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { useTranslation } from "@/lib/i18n";
import { FIELD_LIMITS } from "@/lib/lists/field-limit";
import {
  LIST_KIND_HINT,
  LIST_KIND_ICON,
  LIST_KIND_LABEL,
  LIST_KIND_ORDER,
} from "@/lib/lists/kind";
import { useTheme } from "@/theme";

/** What a person can make inside a folder. */
export type CreateKind = ListKind | "folder" | "note" | "collection";

/*
  `title` y `onTitle` vienen de la **pantalla padre**, y eso conviene decirlo.

  Es un borrador que vive mas alla de la hoja, y por lo mismo es el que puede
  sobrevivirla: si la pantalla no lo limpia al cerrar, la siguiente vez que se abre
  esta hoja aparece con las palabras de la anterior. Lo que el contrato de `Sheet`
  resuelve es la *pregunta* —si hay cambios y hay que avisar—, no el almacenamiento:
  mover el borrador aqui dentro es trabajo de cada pantalla que la use, y son varias.
*/
export interface CreateSheetProps {
  open: boolean;
  onClose: () => void;
  /** Name of the space or folder the thing will be created in. */
  subtitle?: string;
  /**
   * Tres pasos: qué vas a crear, de qué tipo, y los detalles.
   *
   * El segundo es nuevo y es el tipo. Estaba dentro de los detalles como un `Segmented`,
   * y salió a su propia página porque cinco nombres en pastillas no se leen y cinco
   * nombres con una frase debajo sí. El orden es el de siempre: primero la pregunta
   * grande y después las pequeñas.
   */
  /** The control it grows out of; without it the sheet rises from the edge. */
  origin?: SheetOrigin | null;
  step: "what" | "kind" | "details";
  onStep: (step: "what" | "kind" | "details") => void;
  /** `null` until something is picked. */
  kind: CreateKind | null;
  onKind: (kind: CreateKind) => void;
  title: string;
  onTitle: (value: string) => void;
  onCreate: () => void;
  /**
   * Opens the templates, which is the other way to start a note.
   *
   * A prop and not a route this sheet knows about, because the sheet is drawn by
   * three screens and only the two inside a space have somewhere to send the
   * person: a note made from a template belongs in a space, and asking for a space
   * the sheet does not have would be promising something it cannot deliver.
   */
  onFromTemplate?: () => void;
}

/**
 * Creating something, in two steps and one place.
 *
 * The corner button asks what, not how: a list, a folder, a note. Only a list
 * has a kind to choose, so that step only exists for a list and a folder goes
 * straight to its name. One panel with two pages, because five kinds plus three
 * names plus a title field on one screen is a form nobody reads.
 *
 * A note is listed like the others and creates the same way: a name and then
 * the document. It is the only one of the three that is not a container, and the
 * panel does not treat it differently beyond not asking for a list kind.
 */
export function CreateSheet({
  open,
  onClose,
  subtitle,
  origin,
  step,
  onStep,
  kind,
  onKind,
  title,
  onTitle,
  onCreate,
  onFromTemplate,
}: CreateSheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  const isFolder = kind === "folder";
  const isNote = kind === "note";
  const isCollection = kind === "collection";
  /**
   * Only a list has a kind. Asking a note for one produced a panel with five
   * buttons about films and books above a note, and the person who clicked "Nota"
   * was handed a form for something else.
   */
  const isList = !isFolder && !isNote && !isCollection;

  const whatOptions: SheetOption[] = useMemo(
    () => [
      {
        key: "list",
        label: t("lists.create"),
        icon: "albums-outline",
        description: t("create.listHint"),
        onPress: () => {
          onKind("tasks");
          onStep("details");
        },
      },
      {
        key: "folder",
        label: t("folders.create"),
        icon: "folder-open-outline",
        description: t("create.folderHint"),
        onPress: () => {
          onKind("folder");
          onStep("details");
        },
      },
      {
        key: "note",
        label: t("create.note"),
        icon: "document-text-outline",
        description: t("create.noteHint"),
        onPress: () => {
          onKind("note");
          onStep("details");
        },
      },
      {
        // Una coleccion de enlaces es un elemento mas del espacio o la carpeta, y
        // se crea desde el mismo sitio que una lista, una carpeta o una nota.
        key: "collection",
        label: t("collections.create"),
        icon: "bookmarks-outline",
        description: t("collections.createHint"),
        onPress: () => {
          onKind("collection");
          onStep("details");
        },
      },
      {
        key: "template",
        label: t("note.templates"),
        icon: "documents-outline",
        description: t("create.fromTemplateHint"),
        // Not a third step of this sheet. The templates screen is where they are
        // listed, and a sheet that opened a sheet to open a list is three taps to
        // a thing that is one.
        onPress: () => onFromTemplate?.(),
      },
    ],
    [onFromTemplate, onKind, onStep, t],
  );

  /**
   * Los cinco tipos, **en una página y no en cinco pastillas**.
   *
   * Era un `Segmented` con el nombre y nada más, y dos de los cinco se llamaban casi
   * igual —"Películas" y "Películas y series"— con el mismo icono. En una pastilla de
   * ancho variable eso son dos controles que hay que leer para separarlos, y no se
   * parecen por accidente: es la misma lista con tres palabras más.
   *
   * Y el detalle que sí quepa aquí y en una pastilla no: **para qué sirve cada uno**. Una
   * pastilla es un sitio para un nombre; una línea entera es un sitio para un nombre y
   * una frase.
   *
   * La página es **la misma forma que la de "qué vas a crear"**, un paso más de esta
   * misma hoja. No es un desplegable nuevo ni un `select`: es el control que esta hoja
   * ya tenía, con lo que cabía en una etiqueta movido a donde sí cabe. El `Segmented` no
   * se borra del sitio de donde está, que esta hoja no es su dueña.
   */
  const kindOptions: SheetOption[] = useMemo(
    () =>
      LIST_KIND_ORDER.map((option) => ({
        key: option,
        label: t(LIST_KIND_LABEL[option]),
        icon: LIST_KIND_ICON[option],
        description: t(LIST_KIND_HINT[option]),
        onPress: () => {
          onKind(option);
          onStep("details");
        },
      })),
    [onKind, onStep, t],
  );

  const { setSucio } = useSheetSucio();

  /*
    Sucio **cuando hay un nombre escrito**, y no "cuando el nombre ha cambiado".

    Esta hoja tiene una sola partida —una hoja nueva no tiene nada de antes—, asi
    que cualquier nombre es un cambio. Y con el nombre vacio no hay nada que
    perder, que es justo el estado en el que se abre.
  */
  useEffect(() => {
    setSucio(title.trim().length > 0);
  }, [title, setSucio]);

  return (
    <Sheet
      visible={open}
      origin={origin}
      step={step}
      onClose={onClose}
      /*
        El Guardar es **el del pie del panel**. El boton de crear que estaba aqui
        abajo se ha ido, y con el una fila de cuarenta puntos de algo que el pie ya
        hace en las veinticuatro hojas.
      */
      // Solo en los detalles: en "qué crear" y en el tipo no hay nada que guardar,
      // y un Guardar gris ahi enseña que el boton es decoracion.
      onSave={step === "details" ? onCreate : undefined}
      saveDisabledReason={title.trim().length === 0 ? t("itemEdit.nameNeeded") : undefined}
      title={
        step === "what"
          ? t("create.title")
          : isFolder
            ? t("folders.create")
            : isNote
              ? t("create.note")
              : isCollection
                ? t("collections.create")
                : t("lists.create")
      }
      subtitle={subtitle}
      scrollable={false}
      /*
       * Back goes to the "what" page, and **not to closing the sheet**.
       *
       * This one had no way back at all past the first question: the name, the
       * template and the description are three steps deep, and each of them
       * offered only the ✕, which threw away the two answers already given
       * instead of letting you change one of them.
       */
      onBack={
        step === "what"
          ? undefined
          : () =>
              onStep(
                // Desde los detalles de una lista, al tipo —que es lo que acabas de
                // mirar—. Desde los detalles de una carpeta o una nota, a la primera
                // pregunta, porque no hay página de tipo a la que ir. Y desde la página
                // del tipo, a la primera. Convolverlo todo a "what" desde "details"
                // costaba un toque de más para cambiar el tipo.
                step === "details" ? (isList ? "kind" : "what") : "what",
              )
      }
    >
      {step === "what" ? (
        <SheetOptions options={whatOptions} />
      ) : step === "kind" ? (
        <SheetOptions options={kindOptions} />
      ) : (
        <View
          style={{ gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg }}
        >
          {isList ? (
            <Pressable
              onPress={() => onStep("kind")}
              accessibilityRole="button"
              accessibilityLabel={t("lists.kindLabel")}
              testID="elegir-tipo"
              style={({ pressed }) => [
                styles.elegirTipo,
                {
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.md,
                  backgroundColor: pressed ? theme.colors.surfaceMuted : "transparent",
                },
              ]}
            >
              <AppText variant="caption" tone="subtle">
                {t("lists.kindLabel")}
              </AppText>
              <View style={[styles.filaTipo, { gap: theme.spacing.sm }]}>
                <Ionicons
                  name={LIST_KIND_ICON[(kind ?? "tasks") as ListKind]}
                  size={18}
                  color={theme.colors.textMuted}
                />
                <AppText variant="body">{t(LIST_KIND_LABEL[(kind ?? "tasks") as ListKind])}</AppText>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={theme.colors.textSubtle}
                />
              </View>
            </Pressable>
          ) : null}

          <TextField
            label={
              isFolder
                ? t("folders.nameLabel")
                : isNote
                  ? t("note.titleLabel")
                  : isCollection
                    ? t("share.save.collectionName")
                    : t("lists.titleLabel")
            }
            value={title}
            onChangeText={onTitle}
            placeholder={
              isFolder
                ? t("folders.namePlaceholder")
                : isNote
                  ? t("note.titlePlaceholder")
                  : isCollection
                    ? t("share.save.collectionNamePlaceholder")
                    : t("lists.titlePlaceholder")
            }
            autoCapitalize="sentences"
            autoFocus
            returnKeyType="done"
            // One sheet creates a folder, a note or a list, and the three have
            // different widths. The one that creates is the only one that can say.
            limit={
              isFolder
                ? FIELD_LIMITS["folder.name"]
                : isNote
                  ? FIELD_LIMITS["note.title"]
                  : isCollection
                    ? 120 // `collection.name` es varchar(120) en el servidor
                    : FIELD_LIMITS["list.title"]
            }
            onSubmitEditing={onCreate}
          />

          {/*
            Y aqui ya no hay boton de crear.

            Estaba este, y ahora esta el del pie: el mismo en las veinticuatro hojas
            y **fuera del area que scrollea**, que es donde importa en una hoja
            larga. Este se iba con el contenido.

            Y el "Volver" que hubo debajo tambien se fue — hacia atras de verdad,
            asi que no era mentira, solo que estaba en el sitio equivocado: cuarenta
            puntos de un movil para lo que la flecha de arriba ya hace desde treinta.
          */}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  /*
    La fila del tipo chosen, **y no un `Segmented`**.

    Antes eran cinco pastillas con el nombre. Ahora es una fila con el icono del tipo
    elegido y su nombre, y al tocarla se abre la página con los cinco y lo que sirve
    cada uno. Una fila es un sitio para una etiqueta y un icono; una pastilla de ancho
    variable con "Películas y series" al lado de "Películas" es un sitio donde dos
    controles se parecen y hay que leerlos para separarlos.
  */
  elegirTipo: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  filaTipo: {
    flexDirection: "row",
    alignItems: "center",
  },
});
