import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { ShareNodeForm } from "@/components/shares/share-node-sheet";
import { SharedBadge } from "@/components/shares/shared-badge";
import { Sheet, SheetOptions, type SheetOption, useLastValue } from "@/components/ui/sheet";
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
  onSaveAsTemplate?: (note: Note) => void;
  onDeleted?: (note: Note) => void;
  onChanged?: () => void;
}

type Step = "menu" | "rename" | "template" | "share";

export function NoteMenuSheet({
  note: pedido,
  onClose,
  onSaveAsTemplate,
  onDeleted,
  onChanged,
}: NoteMenuSheetProps) {
  /*
    `note` is **the last one, and not the one the caller is holding** — and that
    difference is the whole fix.

    A sheet of options was written as `if (!note) return null`: the caller says the
    menu is closed by handing over nothing, and the component does the obvious thing
    with nothing — which takes the sheet, and the exit it is in the middle of, out
    of the tree on the very frame the dismissal is asked for. Measured on the web,
    the panel was gone **forty-five milliseconds** after the cross, and the quarter
    of a second it was supposed to travel down was never on screen.

    So the value that is drawn is the last one there was — declared here, at the
    top, so that everything below keeps the name it always had and now has a value
    that cannot be null — and the caller's own argument, which goes to `null` at
    once, is what `visible` is asked from. The panel keeps its identity while it
    leaves, and the dismissal is a movement instead of a cut.
  */
  /*
    `note` is **the last one, and not the one the caller is holding** — and that
    difference is the whole fix.

    A sheet of options was written as `if (!note) return null`: the caller says the
    menu is closed by handing over nothing, and the component does the obvious thing
    with nothing — which takes the sheet, and the exit it is in the middle of, out
    of the tree on the very frame the dismissal is asked for. Measured on the web,
    the panel was gone **forty-five milliseconds** after the cross, and the quarter
    of a second it was supposed to travel down was never on screen.

    So the value that is drawn is the last one there was, and the caller's own
    argument — which goes to `null` at once, because that is how a caller says "close"
    — is what `visible` is asked from. The panel keeps its identity while it leaves,
    and the dismissal is a movement instead of a cut.

    **The prop keeps its name and only the local is new.** Renaming what the caller
    passes would be six call sites later, for a change nobody outside this file can
    see.
  */
  const note = useLastValue(pedido);

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

  /*
    "Compartir" is only offered when you are allowed to decide who else sees it.

    A viewer can open a note somebody gave them and write in it; what they cannot do
    is hand it to a third person, which is the rule in `access.ts` and not a choice
    of this screen. Offering it and letting the server refuse is the version where
    somebody discovers the rule by being told no.
  */
  const puedeCompartir = note.role === "owner" || note.role === "editor";

  const opciones: SheetOption[] = [
    {
      key: "rename",
      label: t("note.rename"),
      icon: "create-outline",
      onPress: () => setStep("rename"),
    },
    /*
     * Sharing a note is the reason this menu was missing the option for so long: a
     * note is a page of writing, and sending a page of writing to somebody is the
     * single most ordinary thing anybody does with one. It was here in the contract
     * and in the database the whole time, with no way in from the app.
     *
     * It is a page of this sheet and not a second sheet: a sheet on top of a sheet
     * is two backdrops over one screen, and a tap that reaches the wrong one closes
     * what is underneath.
     */
    ...(puedeCompartir
      ? [
          {
            key: "share",
            label: t("share.pickSomeone"),
            icon: "people-outline" as const,
            description: t("share.isALink"),
            onPress: () => setStep("share"),
          },
        ]
      : []),
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

  if (step === "share") {
    return (
      <Sheet
        visible={pedido !== null}
        onClose={close}
        title={note.title || t("note.untitled")}
        subtitle={t("share.subtitle", { name: note.title })}
        scrollable
      >
        <View style={{ gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg }}>
          <ShareNodeForm
            target={{ nodeType: "note", nodeId: note.id, title: note.title }}
            onDone={close}
          />
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet visible onClose={close} title={note.title || t("note.untitled")}>
      <View style={{ gap: theme.spacing.sm }}>
        <SharedBadge shared={note.shared} role={note.role} />
        <SheetOptions options={opciones} />
      </View>
    </Sheet>
  );
}
