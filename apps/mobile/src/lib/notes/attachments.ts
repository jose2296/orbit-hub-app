import type { Attachment, CreateAttachmentTicketRequest } from "@orbit-hub/contracts";
import { ATTACHMENT_MIME_TYPES, isImageMime } from "@orbit-hub/contracts";

import { api } from "@/lib/api";
import { API_ORIGIN } from "@/lib/api/config";

/**
 * Uploads, which are not operations.
 *
 * A note goes through the outbox, so it is written on the phone and reaches the
 * server when the queue drains. A file cannot: it is too big to keep in a row, it
 * has to go straight to storage, and a half-finished upload is not something a
 * replay can finish. So it has its own small queue, and the note is readable the
 * whole time — which is the rule in `notes-editor.md` that a failed upload never
 * costs somebody their text.
 *
 * The file stays on the device until the server says it is there, so the note can
 * show a picture offline and a badge that says the picture is still on the phone.
 */

export type UploadState =
  | { kind: "idle" }
  | { kind: "uploading"; fileName: string; sent: number; total: number }
  | { kind: "done"; attachmentId: string }
  | { kind: "failed"; fileName: string; reason: string };

export interface AttachmentDraft {
  /** Stable id for this attempt, so a retry is the same file and not a new one. */
  localId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** A local uri on the device, or a remote one. */
  uri: string;
  width: number | null;
  height: number | null;
}

/**
 * What the server will take, so the picker can be honest before anything is sent.
 *
 * The list is the server's, not a copy of it: a client that guesses accepts a file
 * the server refuses after the person has already written about it in their note.
 */
export function isAcceptedMime(mimeType: string): boolean {
  return (ATTACHMENT_MIME_TYPES as readonly string[]).includes(mimeType);
}

/** Drawn inside the document, or offered as a file beside it. */
export function isInlineImage(mimeType: string): boolean {
  return isImageMime(mimeType) && isAcceptedMime(mimeType);
}

/**
 * Why a file cannot be attached, in words the person can act on.
 *
 * Returns `null` when the file is fine, so the caller can use it as a predicate
 * without a second lookup.
 */
export function whyRefused(draft: {
  mimeType: string;
  sizeBytes: number;
  maxBytes: number;
}): string | null {
  if (!isAcceptedMime(draft.mimeType)) {
    return `OrbitHub no acepta archivos de tipo ${draft.mimeType || "desconocido"}`;
  }
  // Zero is what a picker reports when it does not know, and a file of no known
  // size cannot be checked against the ceiling — so it is refused rather than sent
  // as a number the server would reject with a message about a limit that is fine.
  if (!Number.isFinite(draft.sizeBytes) || draft.sizeBytes <= 0) {
    return "No se pudo saber el tamaño de ese archivo";
  }
  if (draft.sizeBytes > draft.maxBytes) {
    const mb = Math.round(draft.maxBytes / 1024 / 1024);
    return `Ese archivo pesa más de ${mb} MB`;
  }
  return null;
}

interface TicketResponse {
  uploadUrl: string;
  headers: Record<string, string>;
  storageKey: string;
  expiresAt: string;
}

/**
 * The two steps, in order, and nothing is recorded until both are done.
 *
 * Step one asks where to put the bytes and step two says they are there. The row
 * is created in between, which is why a file somebody started and abandoned is not
 * something the app has to clean up: there is no row to clean.
 */
export async function uploadAttachment(
  noteId: string,
  draft: AttachmentDraft,
  onProgress?: (sent: number, total: number) => void,
): Promise<Attachment> {
  const meta: CreateAttachmentTicketRequest = {
    fileName: draft.fileName,
    mimeType: draft.mimeType,
    sizeBytes: draft.sizeBytes,
    width: draft.width,
    height: draft.height,
  };

  const ticket = await api.post<TicketResponse>(`/notes/${noteId}/attachments`, meta);
  onProgress?.(0, draft.sizeBytes);

  await putBytes(absoluteStorageUrl(ticket.uploadUrl), draft, ticket.headers, onProgress);

  return api.post<Attachment>(`/notes/${noteId}/attachments/confirm`, {
    ...meta,
    storageKey: ticket.storageKey,
  });
}

/**
 * Puts the bytes where the ticket said, on whichever runtime this is.
 *
 * The three shapes are not interchangeable and the failure is quiet in two of
 * them, which is the reason this is one function with three branches instead of a
 * ternary.
 *
 * **A phone does not accept `{ uri }` any more.** React Native's own
 * `XMLHttpRequest` did — the body was handed to the native networking module,
 * which knew how to read a sandbox path. Expo now ships a `fetch` built on its
 * own runtime, and it is a spec-compliant `BodyInit`: string, `ArrayBuffer`,
 * a view, `Blob`, `URLSearchParams`, `ReadableStream`, `FormData`. A `{ uri }`
 * object is none of those, so it reaches the end of the conversion and throws
 * `Unsupported BodyInit type` — measured, on a real emulator, with the note
 * showing "could not upload". The old shape would have been a silent corruption if
 * it had been accepted: the file is a path, and uploading a path uploads the
 * characters of it.
 *
 * So a phone uploads through `expo-file-system`, which streams from the file and
 * reports progress. That is also the only branch that can tell a person how far
 * along a ten-megabyte photo is.
 *
 * A browser hands the `File` to `fetch` and lets it stream. Nothing is read into
 * memory first, which is the whole point of not buffering it.
 */
async function putBytes(
  url: string,
  draft: AttachmentDraft,
  headers: Record<string, string>,
  onProgress?: (sent: number, total: number) => void,
): Promise<void> {
  if (typeof draft.uri !== "string") {
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": draft.mimeType, ...headers },
      body: draft.uri as unknown as BodyInit,
    });
    if (!response.ok) throw new Error(`La subida falló (${response.status})`);
    onProgress?.(draft.sizeBytes, draft.sizeBytes);
    return;
  }

  // Loaded here and not at the top of the module: `expo-file-system` is native, and
  // a web bundle that imports it is a bundle that fails to load.
  const { File, UploadTask, UploadType } = await import("expo-file-system");

  const task = new UploadTask(new File(draft.uri), url, {
    httpMethod: "PUT",
    uploadType: UploadType.BINARY_CONTENT,
    headers: { "Content-Type": draft.mimeType, ...headers },
    mimeType: draft.mimeType,
    onProgress: (event) => {
      onProgress?.(event.bytesSent, event.totalBytes);
    },
  });

  const result = await task.uploadAsync();
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`La subida falló (${result.status})`);
  }
  task.release();
  onProgress?.(draft.sizeBytes, draft.sizeBytes);
}

/**
 * Where the bytes actually go.
 *
 * A bucket gives an absolute address to somewhere else entirely. The local driver
 * gives a path served by this same API, and a relative URL handed straight to
 * `fetch` would be resolved against the page — so a picture picked in the browser
 * would be posted to the dev server, which answers 404, and the person is told the
 * upload failed for reasons that have nothing to do with their file.
 */
function absoluteStorageUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return `${API_ORIGIN}${path.startsWith('/') ? '' : '/'}${path}`;
}

/**
 * A link that works for a while, for reading a file already on the server.
 *
 * **Absolute, and that is the whole point.** The storage driver hands out a path
 * — the local one does, because it is this same API serving the bytes — and a
 * relative URL given to `fetch` is resolved against *the page*, not against the
 * API. In a browser that means a picture in a note is asked for at
 * `localhost:8082/api/v1/attachments/file/…` while the API is on 4000, and the
 * answer is a 404 from the dev server: a note whose pictures are all missing on
 * the web, with nothing in the app to say why. The upload path had this fixed and
 * written down; the read path was the one that missed it.
 */
export async function attachmentLink(
  attachmentId: string,
): Promise<{ url: string; fileName: string; mimeType: string }> {
  const link = await api.post<{ url: string; fileName: string; mimeType: string }>(
    `/notes/attachments/${attachmentId}/link`,
    {},
  );
  return { ...link, url: absoluteStorageUrl(link.url) };
}

export async function listAttachments(noteId: string): Promise<Attachment[]> {
  const response = await api.get<{ items: Attachment[] }>(`/notes/${noteId}/attachments`);
  return response.items;
}

export async function deleteAttachment(attachmentId: string): Promise<void> {
  await api.delete(`/notes/attachments/${attachmentId}`);
}
