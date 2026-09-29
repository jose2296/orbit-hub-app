import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n";
import { keyValueStore } from "@/lib/storage/key-value";
import {
  attachmentLink,
  deleteAttachment,
  isAcceptedMime,
  listAttachments,
  uploadAttachment,
  whyRefused,
  type AttachmentDraft,
} from "@/lib/notes/attachments";
import {
  dequeueUpload,
  isStillReadable,
  markAttempt,
  pendingFor,
  queueUpload,
  type PendingEntry,
} from "@/lib/notes/pending-uploads";
import type { Attachment } from "@orbit-hub/contracts";
import { useTheme } from "@/theme";

/**
 * The files on a note.
 *
 * They sit under the editor rather than inside the text, because a file is not a
 * block: a document that can hold a PDF has to decide what a paragraph means next
 * to it, and the editor has no answer for that. A picture is different and goes
 * into the text, but that is the editor's business and not this list's.
 *
 * The list says which files are still only on the phone. That line is the whole
 * reason the queue is separate from the note's: a person who sees a picture has to
 * be able to tell whether it is on their phone or on everybody's.
 */
export interface NoteAttachmentsProps {
  noteId: string;
  /**
   * Whether the server has this note, and the only thing that decides it.
   *
   * A note is written on the phone first and reaches the server when the queue
   * drains, so for the first seconds of a new note the server has never heard of
   * it. Asking anyway produced a 404 in the console on **every** note ever
   * created, which is a lie told twice: to the person reading the console, and to
   * whoever looks at the server logs afterwards and finds a client hitting a
   * resource that cannot exist. Nothing was broken and the answer was correct —
   * there are no attachments on a note that does not exist — but a 404 is the one
   * answer that is not allowed to be the right one.
   *
   * A local note is `version: 0` and the server counts from 1, so the version is
   * the question already answered by the row. See `hasReachedServer`.
   */
  onServer?: boolean;
  /** The ceilings the server told the client about, so the answer matches its own. */
  maxBytes: number;
  /** Picks a picture. `null` when the person cancelled or refused the permission. */
  onPickImage?: () => Promise<AttachmentDraft | null>;
  /** Picks any accepted file. */
  onPickFile?: () => Promise<AttachmentDraft | null>;
  onCountChanged?: (count: number) => void;
}

export function NoteAttachments({
  noteId,
  onServer = true,
  maxBytes,
  onPickImage,
  onPickFile,
  onCountChanged,
}: NoteAttachmentsProps) {
  const theme = useTheme();
  const t = useTranslation();

  const [items, setItems] = useState<Attachment[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingEntry[]>([]);

  const reload = useCallback(async () => {
    // Read the local queue first, so the badge is right before any request: a note
    // with a photo on the phone and no connection still has to say the photo is
    // only on the phone.
    setPending(pendingFor(noteId, keyValueStore));

    // The server has never heard of this note yet. The answer would be an empty
    // list, which is the truth, and it would be reached by asking a question that
    // cannot have an answer — so the empty list is put there without asking. See
    // `onServer` for why this was a 404 on every new note.
    if (!onServer) {
      setItems([]);
      return;
    }

    try {
      const list = await listAttachments(noteId);
      setItems(list);
      onCountChanged?.(list.length);
    } catch {
      // A note is readable with no connection, so the list quietly stays as it is.
      // Saying "could not load" over a note somebody is writing is noise.
      setItems([]);
    }
  }, [noteId, onCountChanged, onServer]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Send one file, and keep it queued until the server says it is there.
   *
   * The queue is written *before* the upload is attempted, not after it fails, so
   * closing the app halfway through leaves the file on the list rather than losing
   * track of it. The note is saved either way: only the file is at stake, which is
   * the reason this queue is not the outbox.
   */
  const send = useCallback(
    async (draft: AttachmentDraft) => {
      queueUpload(noteId, draft, keyValueStore);
      await reload();
      setUploading(draft.localId);
      try {
        await uploadAttachment(noteId, draft);
        dequeueUpload(noteId, draft.localId, keyValueStore);
        await reload();
      } catch (error) {
        // Left queued on purpose. The file is on the phone, the note is readable,
        // and the next attempt is a tap rather than a hunt for the photo.
        markAttempt(
          noteId,
          draft.localId,
          error instanceof Error ? error.message : t("note.saveFailed"),
          keyValueStore,
        );
        await reload();
      } finally {
        setUploading(null);
      }
    },
    [noteId, reload, t],
  );

  const attach = useCallback(async (pick: () => Promise<AttachmentDraft | null>) => {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    try {
      const draft = await pick();
      if (!draft) return;

      // Refused here as well as on the server, so the person is told before they
      // have chosen a picture and written about it.
      const reason = whyRefused({
        mimeType: draft.mimeType,
        sizeBytes: draft.sizeBytes,
        maxBytes,
      });
      if (reason) {
        setFailed(t("note.attachment.refused", { reason }));
        return;
      }
      if (!isAcceptedMime(draft.mimeType)) {
        setFailed(t("note.attachment.refused", { reason: draft.mimeType }));
        return;
      }

      await send(draft);
    } finally {
      setBusy(false);
    }
  }, [busy, maxBytes, send, t]);

  const remove = useCallback(
    async (attachment: Attachment) => {
      try {
        await deleteAttachment(attachment.id);
        await reload();
      } catch {
        setFailed(t("note.saveFailed"));
      }
    },
    [reload, t],
  );

  const open = useCallback(async (attachment: Attachment) => {
    try {
      const link = await attachmentLink(attachment.id);
      // A link that works for a while, never a permanent URL: the app opens it and
      // the file is reachable only by the people who may see the note.
      const { Linking } = await import("react-native");
      await Linking.openURL(link.url);
    } catch {
      setFailed(t("note.saveFailed"));
    }
  }, [t]);

  // With nothing attached, nothing pending and nothing to attach, the section is
  // just a label. A note screen is for writing, and an empty "Attachments" heading
  // above an empty note is a heading nobody asked for.
  if (!onPickImage && !onPickFile && items.length === 0 && pending.length === 0) {
    return null;
  }

  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.sm,
        gap: theme.spacing.xs,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
        <Ionicons name="attach-outline" size={15} color={theme.colors.textMuted} />
        <AppText variant="label" tone="muted">
          {t("note.attachments")}
        </AppText>
        <View style={{ marginLeft: "auto", flexDirection: "row", gap: theme.spacing.md }}>
          {onPickFile ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("note.attach")}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              hitSlop={8}
              onPress={() => void attach(onPickFile)}
            >
              <Ionicons name="document-outline" size={17} color={theme.colors.accent} />
            </Pressable>
          ) : null}
          {onPickImage ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("note.attachImage")}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              hitSlop={8}
              onPress={() => void attach(onPickImage)}
            >
              <Ionicons name="image-outline" size={17} color={theme.colors.accent} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {pending.map((entry) => {
        const { draft } = entry;
        const sending = uploading === draft.localId;
        // A file that has been tried and failed is not "pending", and saying so
        // would leave a person waiting for something that is never going to arrive
        // on its own. The reason is the queue's own field, which exists precisely
        // so the line under the name says what went wrong.
        const label = sending
          ? t("note.attachment.uploading", { name: draft.fileName })
          : entry.lastError
            ? t("note.attachment.failedName", { name: draft.fileName, reason: entry.lastError })
            : t("note.attachment.pendingName", { name: draft.fileName });

        return (
          <View
            key={draft.localId}
            style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}
          >
            <Ionicons
              name={
                sending
                  ? "cloud-upload-outline"
                  : entry.lastError
                    ? "alert-circle-outline"
                    : "phone-portrait-outline"
              }
              size={14}
              color={entry.lastError && !sending ? theme.colors.danger : theme.colors.warning}
            />
            <AppText
              variant="caption"
              tone={entry.lastError && !sending ? "danger" : "warning"}
              numberOfLines={2}
              style={{ flex: 1 }}
            >
              {label}
            </AppText>
            {/* The button only where the bytes still exist. On the web a `File`
                died with the page that owned it, and offering "try again" would be
                offering something that cannot work. */}
            {!sending && isStillReadable(draft) ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("note.attachment.retry")}
                onPress={() => void send(draft)}
              >
                <Ionicons name="refresh" size={15} color={theme.colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
        );
      })}
      {failed ? (
        <AppText variant="caption" tone="danger">
          {failed}
        </AppText>
      ) : null}

      {items.map((attachment) => (
        <View
          key={attachment.id}
          style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}
        >
          <Ionicons name="document-outline" size={14} color={theme.colors.textSubtle} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("note.attachment.download", { name: attachment.fileName })}
            onPress={() => void open(attachment)}
            style={{ flex: 1 }}
          >
            <AppText variant="callout" numberOfLines={1}>
              {attachment.fileName}
            </AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("note.attachment.delete", { name: attachment.fileName })}
            onPress={() => void remove(attachment)}
          >
            <Ionicons name="close" size={15} color={theme.colors.textSubtle} />
          </Pressable>
        </View>
      ))}

      {items.length === 0 && pending.length === 0 && uploading === null ? (
        <AppText variant="caption" tone="subtle">
          {t("note.attachments.empty")}
        </AppText>
      ) : null}
    </View>
  );
}
