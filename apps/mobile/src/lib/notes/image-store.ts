import { ATTACHMENT_IMAGE_MAX_BYTES_DEFAULT } from "@orbit-hub/contracts";
import { Platform } from "react-native";

import {
  attachmentIdFromCachedPath,
  attachmentRef,
  cachedImageName,
  extensionForMime,
  imageReferences,
  toLocalDocument,
  toStoredDocument,
} from "./document-images";
import { attachmentLink, isAcceptedMime } from "./attachments";

/**
 * The pictures inside a note, on disk.
 *
 * Every module here is imported lazily. `expo-file-system` is a native module and
 * a web bundle that pulls it in at load time is a web bundle that does not load,
 * so nothing on this path is imported until a picture is actually wanted — and on
 * the web a picture is wanted only when one is inserted, because the browser has
 * the file in memory already and the editor can draw it from there.
 */

const CACHE_DIRECTORY = "note-images";

interface FileSystemModule {
  Paths: { cache: unknown };
  Directory: new (...parts: unknown[]) => {
    create(opts?: { intermediates?: boolean; idempotent?: boolean }): void;
    exists: boolean;
  };
  File: new (...parts: unknown[]) => {
    uri: string;
    exists: boolean;
    size?: number;
    arrayBuffer(): Promise<ArrayBuffer>;
    write(bytes: Uint8Array): void;
    downloadFileAsync(
      url: string,
      destination: unknown,
      options?: { headers?: Record<string, string> },
    ): Promise<unknown>;
  };
}

async function fileSystem(): Promise<FileSystemModule | null> {
  if (Platform.OS === "web") return null;
  try {
    return (await import("expo-file-system")) as unknown as FileSystemModule;
  } catch {
    // A phone with a file system that will not load has no pictures, and a note
    // with no pictures is still a note.
    return null;
  }
}

async function cacheDirectory(fs: FileSystemModule): Promise<unknown> {
  const directory = new fs.Directory(fs.Paths.cache, CACHE_DIRECTORY);
  if (!directory.exists) {
    // `intermediates` because this is inside the cache and the system may clear
    // it: the next open of the note downloads the picture again, which is the
    // whole recovery path and needs no code.
    directory.create({ intermediates: true, idempotent: true });
  }
  return directory;
}

/**
 * Which object URL belongs to which picture, on the web.
 *
 * A phone names its cached copy after the attachment, so the way back from a
 * `src` to an attachment is the file name and needs no memory. A browser has no
 * such thing: the only thing it will draw is an object URL, and the name in it is
 * a uuid the browser made up on the spot.
 *
 * So the mapping is remembered. It is per session and rebuilt every time a note
 * opens, which is the only time it is read: an object URL dies with the document
 * that made it, so a remembered one from yesterday is worthless and the register
 * is emptied rather than consulted.
 */
const objectUrls = new Map<string, string>();

/** A blob the browser will draw, and the id behind it, remembered. */
function rememberObjectUrl(attachmentId: string, bytes: Blob): string {
  for (const [url, id] of objectUrls) {
    if (id === attachmentId) URL.revokeObjectURL(url);
  }
  const url = URL.createObjectURL(bytes);
  objectUrls.set(url, attachmentId);
  return url;
}

/** A local file for a picture, or `null` when the bytes could not be fetched. */
async function download(
  attachmentId: string,
  mimeType: string,
): Promise<string | null> {
  if (!isAcceptedMime(mimeType) || !mimeType.startsWith("image/")) return null;

  if (Platform.OS === "web") {
    try {
      const link = await attachmentLink(attachmentId);
      const response = await fetch(link.url);
      if (!response.ok) return null;
      return rememberObjectUrl(
        attachmentId,
        await response.blob(),
      );
    } catch {
      return null;
    }
  }

  const fs = await fileSystem();
  if (!fs) return null;

  try {
    const link = await attachmentLink(attachmentId);
    const directory = await cacheDirectory(fs);
    const file = new fs.File(
      directory,
      cachedImageName(attachmentId, extensionForMime(mimeType)),
    );
    if (file.exists) return file.uri;

    // The link is signed and short-lived, and the file it points at is checked
    // per note, so the download goes through it rather than to a permanent
    // address. A picture that fails here is a picture that is not in the note
    // yet; the note is still saved and still readable.
    await file.downloadFileAsync(link.url, file);
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

/**
 * Copies a freshly chosen picture into the cache, under the name that will let it
 * be turned back into a reference.
 *
 * The file the picker handed over lives in a directory Android is free to empty
 * whenever it likes, and it has no name worth keeping — a photo from the camera
 * arrives called `1000000022.png`. Copying it to a name the app chose is what
 * makes the reference survive the rest of the day.
 */
export async function adoptImage(
  attachmentId: string,
  sourceUri: string,
  mimeType: string,
): Promise<string | null> {
  const fs = await fileSystem();
  if (!fs) return sourceUri;

  try {
    const directory = await cacheDirectory(fs);
    const file = new fs.File(
      directory,
      cachedImageName(attachmentId, extensionForMime(mimeType)),
    );
    const bytes = new Uint8Array(await new fs.File(sourceUri).arrayBuffer());
    if (bytes.byteLength === 0) return null;
    if (bytes.byteLength > ATTACHMENT_IMAGE_MAX_BYTES_DEFAULT) return null;
    file.write(bytes);
    return file.uri;
  } catch {
    return null;
  }
}

/**
 * The document with every picture it points at present on the device.
 *
 * Called once when a note opens, and only then: the editor is uncontrolled, so
 * the document it is given at mount is the one it keeps, and asking it to change
 * its content later would fight the person who is typing.
 */
export async function localiseDocumentImages(
  document: string,
  mimeFor: (attachmentId: string) => string | null,
): Promise<string> {
  const ids = imageReferences(document);
  if (ids.length === 0) return document;

  for (const url of objectUrls.keys()) URL.revokeObjectURL(url);
  objectUrls.clear();

  const local = new Map<string, string | null>();
  // One at a time. Ten pictures in a note is ten downloads, and a phone opening
  // ten connections to do it is how a note that opens in a second on wifi opens
  // in ten on a train.
  for (const id of ids) {
    const mime = mimeFor(id);
    local.set(id, mime === null ? null : await download(id, mime));
  }

  return toLocalDocument(
    document,
    (id) =>
      local.get(id) ??
      null,
  );
}

/** The document as it is stored: local paths out, references in. */
export function storedDocument(document: string): string {
  // The file-name pass first, which is the phone's way back. Then the browser's,
  // whose object URLs have no name and are found in the register instead.
  const byName = toStoredDocument(document);
  if (objectUrls.size === 0) return byName;
  return byName.replace(
    /(<img\b[^>]*\bsrc\s*=\s*")([^"]*)(")/gi,
    (whole, open: string, src: string, close: string) => {
      const id = objectUrls.get(src);
      return id === undefined ? whole : `${open}${attachmentRef(id)}${close}`;
    },
  );
}

/**
 * A picture the person just chose, in whatever this platform can draw.
 *
 * The register is the browser's half of the same question: an object URL with the
 * attachment remembered behind it, or `null` when there is no browser here.
 */
export async function registerImage(
  attachmentId: string,
  source: string | File,
  mimeType: string,
): Promise<string | null> {
  if (typeof source !== "string") {
    if (Platform.OS !== "web") return null;
    return rememberObjectUrl(attachmentId, source);
  }
  return adoptImage(attachmentId, source, mimeType);
}

/**
 * Whether a note's pictures are on this device.
 *
 * Reads the local cache rather than a list: a note whose pictures were downloaded
 * last week and cleared by the system is a note whose pictures are gone, and a
 * remembered list would say they are there.
 */
export async function hasLocalImage(attachmentId: string, mimeType: string): Promise<boolean> {
  const fs = await fileSystem();
  if (!fs) return false;
  try {
    const directory = await cacheDirectory(fs);
    return new fs.File(
      directory,
      cachedImageName(attachmentId, extensionForMime(mimeType)),
    ).exists;
  } catch {
    return false;
  }
}

/** The id behind a local path the editor handed back, for the caller to check. */
export { attachmentIdFromCachedPath };
