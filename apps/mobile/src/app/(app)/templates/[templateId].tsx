import type { EnrichedTextInputInstance } from "react-native-enriched-html";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Pressable, View } from "react-native";

import { NoteEditor } from "@/components/notes/note-editor";
import { TemplateMenuSheet } from "@/components/notes/template-menu-sheet";
import { WhereNoteSheet } from "@/components/notes/where-note-sheet";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useHeaderAction } from "@/components/ui/header-action";
import { Screen } from "@/components/ui/screen";
import { AppText } from "@/components/ui/text";
import {
  canEditTemplate,
  titleForTemplate,
  useNoteTemplate,
} from "@/hooks/use-note-templates";
import { useTranslation } from "@/lib/i18n";
import { createNoteAction } from "@/lib/notes/actions";
import {
  AUTOSAVE_DELAY_MS,
  createAutosave,
  storableDocument,
} from "@/lib/notes/autosave";
import { updateNoteTemplate } from "@/hooks/use-note-templates";
import { imageReferences } from "@/lib/notes/document-images";
import { localiseDocumentImages } from "@/lib/notes/image-store";
import { useSession } from "@/hooks/use-session";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { useScreenSpace } from "@/hooks/use-screen-space";
import { useTheme } from "@/theme";

type Status = "idle" | "saving" | "saved" | "failed" | "readOnly";

/**
 * One template, open.
 *
 * The screen exists because a template you cannot read is a guess. Tapping one in
 * the list used to make a note straight away, which meant the only way anybody
 * ever saw what was inside a template was by making a note out of it and finding
 * out — and there was no way back, because the note is a copy and the template is
 * still exactly as it was, unchanged, forever.
 *
 * So a template opens like a note opens: you can read it, and if it is yours you
 * can change it. What you cannot do is edit the app's own catalogue, and that is
 * said rather than silently refused — the server refuses it too, and a screen
 * that hid the toolbar without a word would look like a bug.
 *
 * The create-a-note button is at the bottom rather than in the header because it
 * is the thing you came here for, and the header on a phone is thirty-six points
 * wide once the menu has taken its share.
 *
 * Saving is a request and not a queued operation, which is the one place this
 * screen differs from a note. A note is written on a train and arrives later; a
 * template is edited deliberately, from a list somebody is looking at, and the
 * version check the server does is the protection a queue would have given. The
 * cost is stated here rather than discovered: a template cannot be edited with no
 * connection, and the line at the bottom says so.
 */
export default function TemplateScreen() {
  const { templateId, workspaceId, folderId } = useLocalSearchParams<{
    templateId: string;
    workspaceId?: string;
    folderId?: string;
  }>();
  const router = useRouter();
  const theme = useTheme();

  /* La misma regla que en la nota: es de un espacio y su cabecera lo dice. */
  const { workspaces } = useWorkspaces();
  const espacio = workspaces.find((item) => item.id === workspaceId) ?? null;
  useScreenSpace(espacio);
  const t = useTranslation();

  const { template, isLoading, failed } = useNoteTemplate(templateId);
  const { user } = useSession();

  /**
   * The template on screen, kept apart from the one that arrived.
   *
   * A save answers with the row the server now holds, including its new version,
   * and the next save has to be based on that one. A screen that kept re-reading
   * the original would send a version that has moved on and be told so by its own
   * account, over and over, for ever.
   */
  const [current, setCurrent] = useState(template);
  /**
   * The document the editor gets, and whether it has to be waited for.
   *
   * A template can carry a picture — it is the same format as a note, and it is
   * made out of one — and the picture inside it is a reference to an attachment
   * of the note it was copied from. Which does not travel: the template belongs
   * to whoever it was shared with and that attachment does not.
   *
   * So the reference is resolved against *this* device, and one that resolves to
   * nothing stays a reference: a picture that has not been copied over is a
   * picture that is not there yet, and the editor's own placeholder is a truer
   * picture than a `src` pointing at a file that is not.
   */
  const [drawable, setDrawable] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Asking where the note goes, and only when nothing already said.
   *
   * A template is not in a space — it follows the person — so opening one from
   * the notes list, or from anywhere outside a space, arrives here with nowhere
   * to put the note. Rather than dropping it into the first space, which is how
   * notes end up in spaces somebody forgot they had, it asks. One tap for
   * somebody with a single space, because then there is nothing to choose.
   */
  const [asking, setAsking] = useState(false);

  const currentRef = useRef(current);
  currentRef.current = current;

  /**
   * The document as the editor gives it back, read once after the screen opens.
   *
   * Opening a screen is not a change, and the editor says it is one: it reports a
   * change when it mounts, because it has just been handed a document. Without
   * this, every visit wrote the template back — a new version, a new
   * `updated_at`, and everybody else with it open told it had changed underneath
   * them.
   *
   * Comparing against the stored document instead does not work, and that is
   * worth knowing: the editor re-serialises the HTML it was given, so a document
   * nobody touched comes back with different markup and different attributes, and
   * every save would be "a change". The only reliable baseline is the editor's
   * own output for the document it was given.
   */
  const baseline = useRef<string | null>(null);

  // Declared before the autosave that reads it: the closure only runs later, but a
  // reader of this file should not have to prove that.
  const editorRef = useRef<EnrichedTextInputInstance | null>(null);

  useEffect(() => {
    if (template) setCurrent(template);
  }, [template]);

  // The editor waits, for the same reason the note's does: it is uncontrolled, so
  // the first document it is handed is the only one it draws.
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    void (async () => {
      const localised = await localiseDocumentImages(current.document, () => null);
      if (!cancelled) setDrawable(localised);
    })();
    return () => {
      cancelled = true;
    };
  }, [current?.document, current?.id]);

  const editable = canEditTemplate(current, user?.id);

  const autosave = useMemo(
    () =>
      createAutosave({
        delayMs: AUTOSAVE_DELAY_MS,
        read: async () =>
          editorRef.current ? editorRef.current.getHTML() : "",
        save: async (document) => {
          const row = currentRef.current;
          if (!row) return;
          /*
           * Untouched since the screen opened: nothing to write.
           *
           * And the status goes back to saying nothing at all, because the line
           * at the bottom reports what happened rather than what was attempted.
           * Reporting "saved" for a save that was skipped is how a screen ends up
           * telling a person their template is safe when nothing has been written
           * since they opened it.
           */
          if (document === baseline.current || document === row.document) {
            setStatus("idle");
            return;
          }
          // Back to the version the server last confirmed. Sending the version
          // this screen started with is how a person who opened a template on two
          // devices loses one of the two edits.
          const changed = await updateNoteTemplate(
            row.id,
            { document },
            row.version,
          );
          setCurrent(changed);
        },
        /*
         * Failures only. A success is reported by `save` itself, because `save`
         * knows whether it wrote anything and this callback does not: an autosave
         * that skipped an unchanged document is a success by its own rules and
         * nothing to announce.
         */
        onSaved: (result) => {
          if (
            !result.saved &&
            (result.reason === "invalid" || result.reason === "failed")
          ) {
            setStatus("failed");
          }
        },
      }),
    [],
  );

  /**
   * Leaving with the writing still in the editor.
   *
   * The same reason a note does it. The editor is uncontrolled: what is in it is
   * not in any state, and navigating away without asking destroys whatever was
   * typed in the last eight hundred milliseconds.
   */
  useEffect(() => {
    // Once the editor has mounted, whatever it hands back is what it thinks the
    // document is, and that is the line a later save has to beat.
    const timer = setTimeout(() => {
      void (async () => {
        const html = await editorRef.current?.getHTML();
        if (typeof html === "string") {
          baseline.current = storableDocument(html) ?? html;
        }
      })();
    }, 400);
    return () => clearTimeout(timer);
  }, [current?.id]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active" && editable) void autosave.flush();
    });
    return () => {
      subscription.remove();
      if (editable) void autosave.flush();
    };
  }, [autosave, editable]);

  const makeNote = useCallback(
    async (where: { workspaceId: string; folderId: string | null }) => {
      const row = currentRef.current;
      if (!row || creating) return;
      setCreating(true);
      setError(null);
      try {
        const noteId = await createNoteAction({
          workspaceId: where.workspaceId,
          folderId: where.folderId,
          title: titleForTemplate(row),
          // What is on screen and not what is stored: somebody who has just fixed
          // a heading and pressed the button means the version they can see.
          document: editorRef.current
            ? await editorRef.current.getHTML()
            : row.document,
        });
        // Straight to the note, not back to the list: the note is what they asked
        // for and the editor is already open.
        router.replace({ pathname: "/note/[noteId]", params: { noteId } });
      } catch {
        setError(t("note.templates.failedBody"));
        setCreating(false);
      }
    },
    [creating, router, t],
  );

  const onUse = useCallback(() => {
    if (creating) return;
    if (workspaceId) {
      void makeNote({ workspaceId, folderId: folderId ?? null });
      return;
    }
    setAsking(true);
  }, [creating, folderId, makeNote, workspaceId]);

  const headerAction = useCallback(
    () =>
      editable ? (
        <Pressable
          testID="template-menu"
          accessibilityRole="button"
          accessibilityLabel={t("note.menu")}
          hitSlop={8}
          onPress={() => setMenuOpen(true)}
          style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons
            name="ellipsis-horizontal"
            size={20}
            color={theme.colors.text}
          />
        </Pressable>
      ) : null,
    [editable, t, theme.colors.text],
  );
  useHeaderAction(headerAction, [headerAction]);

  if (isLoading) return <View style={{ flex: 1 }} />;

  if (failed || !current) {
    return (
      <Screen
        width="reading"
      /*
        La banda del color del espacio: la mitad de abajo de un lavado que empieza
        en la cabecera y la continua 100 puntos por debajo de su borde. La pinta la
        pantalla y no la cabecera, y por eso el alto de la barra no cambia.
      */
      wash={{ color: espacio?.color, colorTo: espacio?.colorTo, wash: espacio?.wash }}
>
        <EmptyState
          icon="cloud-offline-outline"
          title={t("note.templates.failedTitle")}
          description={t("note.templates.failedBody")}
        />
      </Screen>
    );
  }

  if (drawable === null && imageReferences(current.document).length > 0) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/*
        The name, where a note puts its title.

        It is a caption and not a field: a note's title belongs to the note and is
        written on all the time, while a template is named rarely and from the
        menu, next to the description that goes with the name. A field here would
        be a second place to do the same thing, and two places drift.
      */}
      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.sm,
          paddingBottom: theme.spacing.xs,
          gap: 2,
        }}
      >
        <AppText variant="title" numberOfLines={1}>
          {current.name}
        </AppText>
        {current.description ? (
          <AppText variant="caption" tone="muted" numberOfLines={2}>
            {current.description}
          </AppText>
        ) : null}
      </View>

      <NoteEditor
        editorRef={editorRef}
        defaultValue={drawable ?? current.document}
        placeholder={t("note.bodyPlaceholder")}
        readOnly={!editable}
        onChanged={() => {
          setStatus("saving");
          autosave.schedule();
        }}
      />

      <TemplateMenuSheet
        template={menuOpen ? current : null}
        onClose={() => setMenuOpen(false)}
        onChanged={(changed) => {
          setCurrent(changed);
          setStatus("saved");
        }}
        onDeleted={() => router.back()}
        onFailed={setError}
      />

      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.sm,
          gap: theme.spacing.xs,
        }}
      >
        {!editable ? (
          <AppText variant="caption" tone="muted">
            {current.builtInKey
              ? `${t("note.template.builtIn")} · ${t("note.template.builtInBody")}`
              : t("note.template.someoneElsesBody")}
          </AppText>
        ) : (
          <AppText
            variant="caption"
            tone={status === "failed" ? "danger" : "muted"}
          >
            {status === "saving"
              ? t("note.template.saving")
              : status === "saved"
                ? t("note.template.saved")
                : status === "failed"
                  ? t("note.template.saveFailed")
                  : ""}
          </AppText>
        )}
        {error ? (
          <AppText variant="caption" tone="danger">
            {error}
          </AppText>
        ) : null}
        <Button
          label={t("note.template.use")}
          icon="add"
          onPress={onUse}
          loading={creating}
        />
      </View>

      <WhereNoteSheet
        visible={asking}
        onClose={() => setAsking(false)}
        onPick={(where) => {
          setAsking(false);
          void makeNote(where);
        }}
      />
    </View>
  );
}
