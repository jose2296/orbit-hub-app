import type { EnrichedTextInputInstance } from "react-native-enriched-html";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, Pressable, View } from "react-native";

import { NoteAttachments } from "@/components/notes/note-attachments";
import { NoteMenuSheet } from "@/components/notes/note-menu-sheet";
import { SaveTemplateSheet } from "@/components/notes/save-template-sheet";
import { useHeaderAction } from "@/components/ui/header-action";
import { NoteEditor } from "@/components/notes/note-editor";
import { ATTACHMENT_IMAGE_MAX_BYTES_DEFAULT } from "@orbit-hub/contracts";
import { pickAnyFile, pickImage } from "@/lib/notes/file-picker";
import {
  listAttachments,
  uploadAttachment,
  whyRefused,
  type AttachmentDraft,
} from "@/lib/notes/attachments";
import {
  localiseDocumentImages,
  registerImage,
  storedDocument,
} from "@/lib/notes/image-store";
import {
  dimensionsFor,
  imageReferences,
  restoreLostImages,
} from "@/lib/notes/document-images";
import { AppText } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { useNote } from "@/hooks/use-notes";
import { useTranslation } from "@/lib/i18n";
import { deleteNoteAction, saveNoteAction } from "@/lib/notes/actions";
import {
  AUTOSAVE_DELAY_MS,
  createAutosave,
  storableDocument,
} from "@/lib/notes/autosave";
import { hasReachedServer } from "@/lib/notes/placement";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { useScreenSpace } from "@/hooks/use-screen-space";
import { useTheme } from "@/theme";

type Status = "idle" | "saving" | "saved" | "failed" | "invalid";

/**
 * How long the editor will wait for the pictures before opening without them.
 *
 * Long enough to cover a list of attachments on a slow connection — that request
 * is one small JSON — and short enough that a person tapping a note sees words
 * rather than a blank screen. The API client would allow fifteen seconds, which
 * is the right number for a request whose answer nothing is waiting for and far
 * too long for one that a whole screen is.
 */
const MIME_WAIT_MS = 2_500;

/**
 * Which of a note's attachments is a picture, and which is not.
 *
 * The mime is what says how a reference becomes a local file, so the pass that
 * draws the note cannot start without it. It matters beyond the extension: a
 * reference that resolves to a PDF is a file the editor cannot draw, and a note
 * with a broken image in the middle of a sentence reads as a bug in the app
 * rather than as a file that happens to be beside the text.
 *
 * **It gives up.** A note whose attachments cannot be listed is a note whose
 * pictures are not on this device, and the app's client allows a request fifteen
 * seconds; a screen that waits for all of that is a screen that never opens. So
 * the answer after the wait is an empty map, which is not a lie — it says the
 * same thing a note with no attachments says, and the effect of that is the
 * references staying references and the editor drawing its placeholder for them.
 */
function attachmentMimes(noteId: string): Promise<ReadonlyMap<string, string>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(new Map()), MIME_WAIT_MS);
    void listAttachments(noteId).then(
      (list) => {
        clearTimeout(timer);
        resolve(new Map(list.map((a) => [a.id, a.mimeType])));
      },
      () => {
        clearTimeout(timer);
        resolve(new Map());
      },
    );
  });
}

/**
 * One note, and almost nothing else.
 *
 * The screen is the editor, a title, and one line saying whether the writing is
 * safe. The timing lives in `lib/notes/autosave.ts` and the writing in
 * `lib/notes/actions.ts`, so what is left here is only what cannot be tested
 * without a device: mounting the editor and leaving at the right moment.
 */
export default function NoteScreen() {
  const { noteId } = useLocalSearchParams<{ noteId: string }>();
  const router = useRouter();
  const theme = useTheme();

  /*
    El color del espacio en la cabecera, y la nota es de un espacio aunque no lo
    parezca: es una de las cinco pantallas que tienen algo que editar o borrar, y
    la cabecera tiene que decir de que espacio es igual que dice el titulo de la
    lista. Va despues de `note` porque el id del espacio sale de ella.
  */
  const { workspaces } = useWorkspaces();
  useScreenSpace(
    workspaces.find((item) => item.id === note?.workspaceId) ?? null,
    theme.colors.text,
    theme.colors.background,
  );

  const t = useTranslation();

  const id = noteId ?? null;
  const { note, isLoading } = useNote(id);
  const { isOnline } = useNetworkStatus();

  const editorRef = useRef<EnrichedTextInputInstance | null>(null);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  /**
   * What the editor is actually given, which is not what is stored.
   *
   * A picture is stored as a reference and drawn from a file on this device, and
   * the swap happens here because the editor is uncontrolled: whatever it is
   * handed when it mounts is what it keeps, so there is one moment to do it and
   * one moment to undo it. Both live in `image-store.ts`.
   */
  const [draft, setDraft] = useState<string | null>(null);
  /** The document the editor was given, and the only one it will be given. */
  const [editorDocument, setEditorDocument] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  /**
   * The pictures put into the editor in this session, in the order they went in.
   *
   * On Android the editor draws a picture and then loses it on the way back out:
   * `getHTML` returns the object replacement character where the picture was and no
   * `<img>` at all. This list is what puts them back, and it is exact because a
   * stored document never contains one of those characters and the editor was
   * handed that document. See `restoreLostImages`.
   */
  const inserted = useRef<{ id: string; width: number; height: number }[]>([]);
  /**
   * The note's own menu, and the template sheet behind one of its rows.
   *
   * The same sheet the list opens, and not a second one: two menus that are
   * supposed to offer the same things drift, and the first thing that drifts is
   * the one somebody does not find. The list is where you act on a note you are
   * not reading, and the header is where you act on the one you are — and both
   * are the same note and the same four things.
   */
  const [menuOpen, setMenuOpen] = useState(false);
  const [templateFor, setTemplateFor] = useState<{ name: string; document: string } | null>(
    null,
  );
  const titleRef = useRef(title);
  titleRef.current = title;

  const autosave = useMemo(
    () =>
      createAutosave({
        // `getHTML` and not `onChangeHtml`: the library parses HTML on every
        // keystroke if you let it, and says so in its own documentation. This
        // runs once, when the writing has stopped.
        read: async () => {
          if (!editorRef.current) return "";
          // Back to references before anything sees the document. What the editor
          // holds is a set of paths on this phone; what is stored is a note that
          // means the same thing on every phone.
          return restoreLostImages(
            storedDocument(await editorRef.current.getHTML()),
            inserted.current,
          );
        },
        save: async (document) => {
          // Through the ref, not the value: this object is built once per note
          // and the title changes on every keystroke, so closing over the value
          // would save the title the note had when it was opened.
          await saveNoteAction(id as string, {
            document,
            title: titleRef.current.trim(),
          });
        },
        delayMs: AUTOSAVE_DELAY_MS,
        onSaved: (result) => {
          setStatus(
            result.saved ? "saved" : result.reason === "invalid" ? "invalid" : "failed",
          );
        },
      }),
    [id],
  );

  useEffect(() => {
    if (note && note.title.length > 0) setTitle(note.title);
    // On the note's identity only: after this the field belongs to the person.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id]);

  /**
   * Draws the note the editor will show: the stored document with its pictures on
   * this device.
   *
   * One pass, and it is the one that knows the mimes.
   *
   * The mime is what says how a reference becomes a local file, so a pass that
   * runs before the list of attachments has arrived resolves nothing and hands
   * back the references unchanged. That was harmless while the editor mounted
   * after `mimeSettled`, because a second pass a moment later produced the
   * pictures — except the two flags are set by two different requests, and the
   * render that sees `mimeSettled` already true can still be holding the *first*
   * pass's draft: `draft` was set, it was just the un-localised one. The editor
   * mounted with `attachment:` strings, could not resolve them, and on the web
   * the sanitiser then emptied the `src` altogether, so `getHTML` wrote
   * `<img src="">` and the note refused to save. Separating the mimes from the
   * pass is what allowed that; the two belong in one function.
   *
   * So the pass asks for the mimes itself, and the editor waits for the pass and
   * for nothing else. Waiting is bounded, because a note that is a blank screen
   * for as long as a slow request takes is a note that looks broken — the app's
   * own client gives a request fifteen seconds, which is far too long to stare
   * at. Past the bound the pass goes on without the mimes: the references stay
   * where they were, the editor draws its own placeholder for them, and the note
   * is readable and editable while the picture is not.
   */
  useEffect(() => {
    if (!note || !id) return;
    let cancelled = false;

    void (async () => {
      const mimes = await attachmentMimes(id);
      const localised = await localiseDocumentImages(
        note.document,
        (attachmentId) => mimes.get(attachmentId) ?? null,
      );
      if (cancelled) return;
      // Never handed to an editor that is already drawing something else: the
      // editor is uncontrolled, and the screen below refuses to mount one until
      // this value exists.
      setDraft(localised);
    })();

    return () => {
      cancelled = true;
    };
  }, [id, note?.document, note?.id]);

  // Leaving the screen must not leave a save behind. The back button, the
  // browser bar, a swipe and a call all arrive here.
  useEffect(() => {
    const flush = (): void => {
      void autosave.flush();
    };
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") flush();
    });
    return () => {
      subscription.remove();
      void autosave.flush();
    };
  }, [autosave]);

  const onDelete = useCallback(() => {
    Alert.alert(t("note.deleteConfirm"), t("note.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("note.delete"),
        style: "destructive",
        onPress: () => {
          autosave.cancel();
          void deleteNoteAction(id as string).then(() => router.back());
        },
      },
    ]);
  }, [autosave, id, router, t]);

  /**
   * Puts a picture where the cursor is.
   *
   * The order is the whole of it and it is not interchangeable: the file is sent
   * first, so an id exists to name the cached copy after, and only then is the
   * copy taken and the picture handed to the editor. Inserting first and sending
   * after would leave a picture in the text of a note whose file never arrived,
   * and the reference would point at nothing for ever.
   */
  /**
   * The three dots in the header.
   *
   * Read at draw time rather than published once, so the button follows the note
   * as it is being renamed: the menu says the new name the moment it changes,
   * because a menu that still says the old one is a menu about a different note.
   */
  const headerAction = useCallback(
    () => (
      <Pressable
        testID="note-menu"
        accessibilityRole="button"
        accessibilityLabel={t("note.menu")}
        hitSlop={8}
        onPress={() => setMenuOpen(true)}
        style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
      >
        <Ionicons name="ellipsis-horizontal" size={20} color={theme.colors.text} />
      </Pressable>
    ),
    [t, theme.colors.text],
  );
  useHeaderAction(headerAction, [headerAction]);

  const onInsertImage = useCallback(async () => {
    const input = editorRef.current;
    if (!input || !id || imageError !== null) return;

    const picked = await pickImage();
    if (!picked) return;

    const reason = whyRefused({
      mimeType: picked.mimeType,
      sizeBytes: picked.sizeBytes,
      maxBytes: ATTACHMENT_IMAGE_MAX_BYTES_DEFAULT,
    });
    if (reason) {
      setImageError(t("note.image.failed", { reason }));
      return;
    }

    try {
      const attachment = await uploadAttachment(id, picked as AttachmentDraft);
      // Both platforms answer with something their editor can draw, and each
      // remembers how to get back to the attachment — see `registerImage`.
      const local = await registerImage(
        attachment.id,
        picked.uri,
        picked.mimeType,
      );
      if (local === null) {
        // A picture this device cannot hold a copy of is not inserted. Saying so
        // beats a picture that appears and then cannot be drawn again.
        setImageError(t("note.image.failed", { reason: t("common.error") }));
        return;
      }
      const { width, height } = dimensionsFor(attachment);
      input.setImage(local, width, height);
      // Recorded before the save, because the save is the thing that needs it and
      // the save happens on a timer.
      inserted.current.push({ id: attachment.id, width, height });
      setStatus("saving");
      autosave.schedule();
    } catch (error) {
      setImageError(
        t("note.image.failed", {
          reason: error instanceof Error ? error.message : t("common.error"),
        }),
      );
    }
  }, [autosave, id, imageError, t]);

  // El error se borra al volver a tocar el boton: si no, se queda escrito encima
  // de la nota para siempre y solo unRecargar lo quita.
  const tryImage = useCallback(() => {
    setImageError(null);
    void onInsertImage();
  }, [onInsertImage]);

  if (isLoading) return <View style={{ flex: 1 }} />;

  if (!note) {
    return (
      <View style={{ flex: 1, padding: theme.spacing.lg }}>
        <AppText tone="muted">{t("note.untitled")}</AppText>
      </View>
    );
  }

  /*
   * What the editor is given, and how many times.
   *
   * **Once.** The editor is uncontrolled, so every document it is handed after the
   * first is a document it may or may not take — and the one it took, this time,
   * was the stored one with `attachment:<id>` as a `src`, so the picture on screen
   * turned into a placeholder the moment an autosave changed the note underneath.
   *
   * That is the same failure as the one before it from the other side: the editor
   * must never see a document whose pictures are still references. So the value
   * below only ever goes from null to a string, and after that the editor is left
   * alone while the person types.
   *
   * The editor also waits for the one pass above, which is bounded, and only when
   * the note has a picture to resolve. A note with no pictures waits for nothing:
   * a document with nothing to resolve is already the document it should have.
   */
  const hasPictures = imageReferences(note.document).length > 0;
  const documentForEditor = hasPictures ? draft : note.document;

  if (documentForEditor !== null && editorDocument === null) {
    setEditorDocument(documentForEditor);
  }

  if (editorDocument === null) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <TextField
        value={title}
        onChangeText={(value) => {
          setTitle(value);
          setStatus("saving");
          autosave.schedule();
        }}
        placeholder={t("note.titlePlaceholder")}
        autoCapitalize="sentences"
        onSubmitEditing={() => void autosave.flush()}
      />
      <NoteEditor
        editorRef={editorRef}
        defaultValue={editorDocument}
        placeholder={t("note.bodyPlaceholder")}
        onInsertImage={tryImage}
        onChanged={() => {
          setStatus("saving");
          autosave.schedule();
        }}
      />
      <NoteMenuSheet
        note={menuOpen ? note : null}
        onClose={() => setMenuOpen(false)}
        onSaveAsTemplate={() => {
          setMenuOpen(false);
          /*
            Read the editor now and not when the sheet opens.
            `getHTML` is a promise that asks the native layer to serialise, so a
            sheet that went and got it for itself would either flash empty or
            carry an `await` into a component that cannot have one. Reading it on
            the tap also means the template is what is on screen at that moment,
            which is what somebody saving a note as a template means.
          */
          void (async () => {
            const html = editorRef.current ? await editorRef.current.getHTML() : "";
            setTemplateFor({
              name: titleRef.current || note?.title || "",
              // The same conversion the note is saved with, references included:
              // a template is a document, and a document that cannot be reopened
              // is not one anybody wants to start from twice.
              document: storableDocument(storedDocument(html)) ?? html,
            });
          })();
        }}
      />

      {/*
        The template is built from what is in the editor and not from what is
        stored: somebody who has been typing for two minutes and then saves the
        note as a template means the note they were writing, and the stored copy
        is one autosave behind whatever they just typed.
      */}
      <SaveTemplateSheet
        visible={templateFor !== null}
        workspaceId={note?.workspaceId ?? ""}
        initialName={templateFor?.name ?? ""}
        document={templateFor?.document ?? ""}
        onClose={() => setTemplateFor(null)}
      />

      <NoteAttachments
        noteId={id as string}
        onServer={hasReachedServer(note)}
        maxBytes={ATTACHMENT_IMAGE_MAX_BYTES_DEFAULT}
        onPickImage={pickImage}
        onPickFile={pickAnyFile}
      />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.xs,
          gap: theme.spacing.md,
        }}
      >
        <AppText
          variant="caption"
          tone={status === "failed" || status === "invalid" ? "danger" : "muted"}
        >
          {statusLabel(status, isOnline, t)}
        </AppText>
        <AppText
          variant="caption"
          tone="muted"
          onPress={onDelete}
          accessibilityRole="button"
          accessibilityLabel={t("note.delete")}
        >
          {t("note.delete")}
        </AppText>
      </View>
    </View>
  );
}

/**
 * What the line at the bottom says.
 *
 * "Saved" and "Saved on this device" are different words on purpose. A note that
 * is only on the phone has not been saved to anything yet, and a person who finds
 * out after handing the phone in was never told.
 */
function statusLabel(
  status: Status,
  isOnline: boolean,
  t: ReturnType<typeof useTranslation>,
): string {
  switch (status) {
    case "saving":
      return t("note.saving");
    case "saved":
      return isOnline ? t("note.saved") : t("note.savedOffline");
    case "invalid":
      return t("note.notEditable");
    case "failed":
      return t("note.saveFailed");
    default:
      return "";
  }
}
