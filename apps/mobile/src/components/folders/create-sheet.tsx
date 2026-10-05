import type { ListKind } from "@orbit-hub/contracts";
import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Sheet, SheetOptions } from "@/components/ui/sheet";
import type { SheetOption } from "@/components/ui/sheet";
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
export type CreateKind = ListKind | "folder" | "note";

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
  step: "what" | "kind" | "details";
  onStep: (step: "what" | "kind" | "details") => void;
  /** `null` until something is picked. */
  kind: CreateKind | null;
  onKind: (kind: CreateKind) => void;
  title: string;
  onTitle: (value: string) => void;
  onCreate: () => void;
  creating: boolean;
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
  step,
  onStep,
  kind,
  onKind,
  title,
  onTitle,
  onCreate,
  onFromTemplate,
  creating,
}: CreateSheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  const isFolder = kind === "folder";
  const isNote = kind === "note";
  /**
   * Only a list has a kind. Asking a note for one produced a panel with five
   * buttons about films and books above a note, and the person who clicked "Nota"
   * was handed a form for something else.
   */
  const isList = !isFolder && !isNote;

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

  return (
    <Sheet
      visible={open}
      onClose={onClose}
      title={
        step === "what"
          ? t("create.title")
          : isFolder
            ? t("folders.create")
            : isNote
              ? t("create.note")
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
                  : t("lists.titleLabel")
            }
            value={title}
            onChangeText={onTitle}
            placeholder={
              isFolder
                ? t("folders.namePlaceholder")
                : isNote
                  ? t("note.titlePlaceholder")
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
                  : FIELD_LIMITS["list.title"]
            }
            onSubmitEditing={onCreate}
          />

          <View style={{ gap: theme.spacing.sm }}>
            <Button
              label={creating ? t("common.saving") : t("common.create")}
              icon="checkmark"
              loading={creating}
              disabled={title.trim().length === 0}
              onPress={onCreate}
            />
            {/*
              This one **was** labelled "Volver" and did go back, so unlike the
              others it was not lying — it was just in the wrong place: a full-width
              ghost row under the create button, forty points of a phone spent on
              something the header arrow now does from thirty. It goes, and the arrow
              is the way back.
            */}
          </View>
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
