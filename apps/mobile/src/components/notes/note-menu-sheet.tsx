import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { Sheet, SheetOptions, type SheetOption } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import type { Note } from "@orbit-hub/contracts";

import { useTranslation } from "@/lib/i18n";
import { saveNoteAction } from "@/lib/notes/actions";
import { useTheme } from "@/theme";

/**
 * What you can do to a note that is not writing in it.
 *
 * One menu for the two places a note is acted on without being opened — the row
 * in a list and the header of the note itself — because two menus that are
 * supposed to offer the same things drift, and the first thing that drifts is the
 * one somebody does not have.
 *
 * "Fijar" is a star and not a panel card. A note is a page of writing and a
 * dashboard card is a thing with a count on it; a note pinned to the panel would
 * be a card that can only be opened, which is what tapping the card already does.
 * The star is the note's own version of it and the list already draws it.
 */
export interface NoteMenuSheetProps {
  note: Note | null;
  onClose: () => void;
  /** Opens the template sheet, which is a different question and a second sheet. */
  onSaveAsTemplate?: (note: Note) => void;
  onDeleted?: (note: Note) => void;
  onChanged?: () => void;
}

type Step = "menu" | "rename" | "template";

export function NoteMenuSheet({
  note,
  onClose,
  onSaveAsTemplate,
  onDeleted,
  onChanged,
}: NoteMenuSheetProps) {
  const theme = useTheme();
  const t = useTranslation();

  const [step, setStep] = useState<Step>("menu");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  // Reset on every open, so the name in the box is this note's name and not the
  // one somebody typed into another note ten minutes ago.
  useEffect(() => {
    if (note) {
      setStep("menu");
      setName(note.title);
      setBusy(false);
    }
  }, [note?.id, note?.title]);

  const close = useCallback(() => {
    setStep("menu");
    onClose();
  }, [onClose]);

  const rename = useCallback(async () => {
    if (!note || busy) return;
    const trimmed = name.trim();
    if (trimmed === note.title) {
      setStep("menu");
      return;
    }
    setBusy(true);
    try {
      await saveNoteAction(note.id, { title: trimmed });
      onChanged?.();
      setStep("menu");
    } finally {
      setBusy(false);
    }
  }, [busy, name, note, onChanged]);

  const remove = useCallback(async () => {
    if (!note || busy) return;
    setBusy(true);
    try {
      const { deleteNoteAction } = await import("@/lib/notes/actions");
      await deleteNoteAction(note.id);
      onDeleted?.(note);
      onClose();
    } finally {
      setBusy(false);
    }
  }, [busy, note, onClose, onDeleted]);

  if (!note) return null;

  if (step === "rename") {
    return (
      <Sheet visible onClose={close} title={t("note.rename")} scrollable>
        <View style={{ gap: theme.spacing.md }}>
          <TextField
            value={name}
            onChangeText={setName}
            placeholder={t("note.titlePlaceholder")}
            autoCapitalize="sentences"
            autoFocus
          />
          <SheetOptions
            options={[
              {
                key: "save",
                label: t("common.save"),
                icon: "checkmark",
                tone: "accent",
                disabled: name.trim().length === 0 || busy,
                onPress: () => void rename(),
              },
              { key: "cancel", label: t("common.cancel"), onPress: close },
            ]}
          />
        </View>
      </Sheet>
    );
  }

  const opciones: SheetOption[] = [
    {
      key: "rename",
      label: t("note.rename"),
      icon: "create-outline",
      onPress: () => setStep("rename"),
    },
    ...(onSaveAsTemplate
      ? [
          {
            key: "template",
            label: t("note.templates.saveCurrent"),
            icon: "bookmark-outline" as const,
            onPress: () => onSaveAsTemplate(note),
          },
        ]
      : []),
    {
      key: "delete",
      label: t("note.delete"),
      icon: "trash-outline",
      tone: "danger",
      disabled: busy,
      onPress: () => void remove(),
    },
  ];

  return (
    <Sheet visible onClose={close} title={note.title || t("note.untitled")}>
      <SheetOptions options={opciones} />
    </Sheet>
  );
}
