import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { IconPickerPanel } from "@/components/ui/icon-picker-sheet";
import { ShareNodeForm } from "@/components/shares/share-node-sheet";
import { ShareFormContexto, type ShareFormPublicado } from "@/components/shares/share-form-publicado";
import { SharedBadge } from "@/components/shares/shared-badge";
import {
  Sheet,
  SheetOptions,
  type SheetOption,
  useLastValue,
} from "@/components/ui/sheet";
import { useSheetSucio } from "@/components/ui/sheet-sucio";
import { TextField } from "@/components/ui/text-field";
import type { IconRef, Note } from "@orbit-hub/contracts";

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

type Step = "menu" | "rename" | "icon" | "template" | "share";

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
  const { setSucio } = useSheetSucio();

  /*
    El canal por el que la pagina de compartir publica su Guardar, y el estado que
    lo guarda aqui. Mismo reparto que `ShareNodeSheet`: el formulario publica por
    el canal y esta hoja lo pinta en el pie.
  */
  const [sharePublicado, setSharePublicado] =
    useState<ShareFormPublicado | null>(null);
  const shareCanal = useMemo(
    () => ({ publicar: setSharePublicado }),
    [],
  );

  /*
    Sucio **solo en la pagina de renombrar**, y solo con el nombre distinto.

    En el menu no hay nada escrito, y el nombre arranca con el de la nota: cambiarlo
    y volver a ponerlo es no haber cambiado nada, y preguntar por eso enseña a
    ignorar el aviso.
  */
  useEffect(() => {
    setSucio(step === "rename" && name.trim() !== (note?.title ?? "").trim());
  }, [step, name, note?.title, setSucio]);

  // Reset on every open, so the name in the box is this note's name and not the
  // one somebody typed into another note ten minutes ago.
  useEffect(() => {
    if (note) {
      setStep("menu");
      setName(note.title);
      setBusy(false);
    }
  }, [note?.id, note?.title]);

  /**
   * Out of the whole sheet, and out of whatever page it is on.
   *
   * It did both at once — `setStep("menu")` **and** `onClose()` — so every "Cancelar"
   * on a sub-page threw away the panel as well as going back. The two are separate
   * jobs and they are separate now: `close` is the ✕ and closes, `volver` is the
   * arrow and only goes back a step.
   */
  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  /** Up one page, and the sheet stays open. */
  const volver = useCallback(() => {
    setStep("menu");
  }, []);

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

  const pickIcon = useCallback(
    async (icon: IconRef | null) => {
      if (!note || busy) return;
      setBusy(true);
      try {
        await saveNoteAction(note.id, { icon });
        onChanged?.();
      } finally {
        setBusy(false);
      }
    },
    [busy, note, onChanged],
  );

  if (!note) return null;

  if (step === "rename") {
    return (
      <ShareFormContexto.Provider value={shareCanal}>
      <Sheet
        step="rename"
        visible={pedido !== null}
        onClose={close}
        onBack={volver}
        title={t("note.rename")}
        scrollable
        /*
          El Guardar es **el del pie del panel**, y el "Volver" de abajo se queda.

          "Volver" no estaba de sobra: sale por aqui lo unico que esta escrito, y
          salir por el fondo o por la ✕ no lo pregunta porque no cambia de pagina —se
          va de la hoja entera—. Con el nombre dentro, esas tres salidas necesitan la
          misma pregunta, y es la que `Sheet` hace sola.
        */
        onSave={() => void rename()}
        saveDisabledReason={name.trim().length === 0 ? t("itemEdit.nameNeeded") : undefined}
      >
        <View style={{ gap: theme.spacing.md }}>
          <TextField
            value={name}
            onChangeText={setName}
            placeholder={t("note.titlePlaceholder")}
            autoCapitalize="sentences"
            autoFocus
          />
          {/*
            Y aqui **ya no hay botones**.

            El de guardar esta en el pie, que es el mismo en todas las hojas y no se
            va con el contenido.

            Y el "Volver" se fue con el: la flecha de arriba hace lo mismo desde hace
            tiempo, y tener las dos es tener dos formas de hacer una cosa. Era, ademas,
            la salida que **no preguntaba**.
          */}
        </View>
      </Sheet>
      </ShareFormContexto.Provider>
    );
  }

  /*
    "Compartir" is only offered when you are allowed to decide who else sees it.

    A viewer can open a note somebody gave them and write in it; what they cannot do
    is hand it to a third person, which is the rule in `access.ts` and not a choice
    of this screen. Offering it and letting the server refuse is the version where
    somebody discovers the rule by being told no.
  */
  /*
   * Only the owner. Not the editor.
   *
   * An editor of a space can write in it, and every note in it belongs to the space's
   * owner, so "editor can share" meant "anybody the owner invited can decide who
   * else reads the owner's notes" — and the owner then cannot take it back, because
   * the share belongs to the editor who made it. The server refuses this now; hiding
   * the option is what stops it being offered and refused.
   */
  const puedeCompartir = note.role === "owner";

  const opciones: SheetOption[] = [
    {
      key: "rename",
      label: t("note.rename"),
      icon: "create-outline",
      onPress: () => setStep("rename"),
    },
    {
      key: "icon",
      label: t("icons.title"),
      icon: "image-outline",
      onPress: () => setStep("icon"),
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
      /*
       * On somebody else's note this does not say "Eliminar".
       *
       * It used to, and it was not only the wrong word. The action behind it pushed a
       * delete, a delete is global, and it removed the note from the **person who
       * wrote it** — from every space and every device they have. Verified before this
       * was fixed: an `editor` — a role the share menu offers, and the one the badge
       * calls "Puedes editarlo" — deleted a note they had been lent and the owner's
       * copy came back with `deletedAt` set and `status: "applied"`.
       *
       * So the row now says what is true and does nothing, instead of offering to
       * erase somebody's work. Editing the note is still on offer above, because
       * editing is what the role actually means.
       */
      label: note.shared ? t("common.deleteNotYours") : t("note.delete"),
      icon: "trash-outline",
      tone: "danger",
      disabled: busy || note.shared,
      ...(note.shared ? { description: t("common.deleteNotYoursHint") } : {}),
      onPress: () => void remove(),
    },
  ];

  if (step === "icon") {
    return (
      <ShareFormContexto.Provider value={shareCanal}>
      <Sheet
        step="icon"
        visible={pedido !== null}
        onClose={close}
        onBack={volver}
        title={t("icons.title")}
        subtitle={note.title || t("note.untitled")}
        scrollable
      >
        <View
          style={{ gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg }}
        >
          <IconPickerPanel
            current={note.icon}
            onSelect={(icon) => void pickIcon(icon)}
          />
        </View>
      </Sheet>
      </ShareFormContexto.Provider>
    );
  }

  if (step === "share") {
    return (
      <ShareFormContexto.Provider value={shareCanal}>
      <Sheet
        step="share"
        visible={pedido !== null}
        onClose={close}
        title={note.title || t("note.untitled")}
        subtitle={t("share.subtitle", { name: note.title })}
        scrollable
        /*
          El Guardar es el del pie, y sale de lo que el formulario publica: el
          estado del formulario vive dos niveles mas abajo y la hoja no puede
          leerlo, asi que el formulario lo publica por el canal y la hoja lo pinta.
          Mismo reparto que en `ShareNodeSheet`, misma razon.
        */
        onSave={sharePublicado ? sharePublicado.enviar : undefined}
        saveDisabledReason={sharePublicado?.motivo}
      >
        <View
          style={{ gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg }}
        >
          <ShareNodeForm
            target={{ nodeType: "note", nodeId: note.id, title: note.title }}
            onDone={close}
          />
        </View>
      </Sheet>
      </ShareFormContexto.Provider>
    );
  }

  return (
    <ShareFormContexto.Provider value={shareCanal}>
    <Sheet step="menu" visible={pedido !== null} onClose={close} title={note.title || t("note.untitled")}>
      <View style={{ gap: theme.spacing.sm }}>
        <SharedBadge shared={note.shared} role={note.role} />
        <SheetOptions options={opciones} />
      </View>
    </Sheet>
    </ShareFormContexto.Provider>
  );
}
