import type { ListKind } from "@orbit-hub/contracts";
import { useMemo } from "react";
import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Sheet, SheetOptions } from "@/components/ui/sheet";
import type { SheetOption } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { useTranslation } from "@/lib/i18n";
import { LIST_KIND_LABEL, LIST_KIND_ORDER } from "@/lib/lists/kind";
import { useTheme } from "@/theme";

/** What a person can make inside a folder. */
export type CreateKind = ListKind | "folder" | "note";

export interface CreateSheetProps {
  open: boolean;
  onClose: () => void;
  /** Name of the space or folder the thing will be created in. */
  subtitle?: string;
  /** First step: what to create. Second step: the details of a list. */
  step: "what" | "details";
  onStep: (step: "what" | "details") => void;
  /** `null` until something is picked. */
  kind: CreateKind | null;
  onKind: (kind: CreateKind) => void;
  title: string;
  onTitle: (value: string) => void;
  onCreate: () => void;
  creating: boolean;
}

/**
 * Creating something, in two steps and one place.
 *
 * The corner button asks what, not how: a list, a folder, a note. Only a list
 * has a kind to choose, so that step only exists for a list and a folder goes
 * straight to its name. One panel with two pages, because five kinds plus three
 * names plus a title field on one screen is a form nobody reads.
 *
 * A note is listed and disabled rather than left out: it is coming, and a
 * missing option looks like an oversight while a greyed out one says "not yet".
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
  creating,
}: CreateSheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  const isFolder = kind === "folder";

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
        disabled: true,
        onPress: () => undefined,
      },
    ],
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
            : t("lists.create")
      }
      subtitle={subtitle}
      scrollable={false}
    >
      {step === "what" ? (
        <SheetOptions options={whatOptions} />
      ) : (
        <View
          style={{ gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg }}
        >
          {!isFolder ? (
            <Segmented
              label={t("lists.kindLabel")}
              value={(kind ?? "tasks") as ListKind}
              onChange={onKind}
              options={LIST_KIND_ORDER.map((option) => ({
                value: option,
                label: t(LIST_KIND_LABEL[option]),
              }))}
            />
          ) : null}

          <TextField
            label={isFolder ? t("folders.nameLabel") : t("lists.titleLabel")}
            value={title}
            onChangeText={onTitle}
            placeholder={
              isFolder
                ? t("folders.namePlaceholder")
                : t("lists.titlePlaceholder")
            }
            autoCapitalize="sentences"
            autoFocus
            returnKeyType="done"
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
            <Button
              label={t("common.back")}
              icon="chevron-back"
              variant="ghost"
              onPress={() => onStep("what")}
            />
          </View>
        </View>
      )}
    </Sheet>
  );
}
