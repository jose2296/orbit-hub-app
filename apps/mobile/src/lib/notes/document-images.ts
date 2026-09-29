import type { Attachment } from "@orbit-hub/contracts";

/**
 * Where an image inside a note comes from, and how the editor is told about it.
 *
 * The difficulty is that the editor draws a picture itself, from a `src`, with no
 * way to ask anybody for a fresh one. On Android it opens that `src` with
 * `java.net.URL` — no headers, no cookies, no token — and on the web it is an
 * `<img>`. So a `src` that needs a session to read cannot be drawn: the editor
 * would ask for the bytes and the API would answer 401, and there is nothing in
 * the component to retry with a header.
 *
 * What *does* work on both is a path to a file that is already on the device.
 *
 * So the document never stores one. It stores `attachment:<id>` — a reference
 * that is stable, syncs to another phone, and means nothing on its own. When the
 * note opens, each reference is resolved to a file in the app's own cache, one
 * download per picture, and the editor is handed the document with the local
 * paths in it. When the note is saved, the local paths go back to references.
 *
 * The two are not lossy in either direction, and the mapping is by file name, so
 * nothing has to be remembered between opening and saving. The cost is that an
 * image is a second copy of the file on the device, which is the price of an
 * editor that draws images itself and of a note that works with no connection.
 */

/** What goes in the document. Not a URL, and not resolvable outside this app. */
export const ATTACHMENT_REF_PREFIX = "attachment:";

/** True for a `src` this module is responsible for. */
export function isAttachmentRef(src: string): boolean {
  return src.startsWith(ATTACHMENT_REF_PREFIX);
}

export function attachmentRef(id: string): string {
  return `${ATTACHMENT_REF_PREFIX}${id}`;
}

/** The id behind a reference, or `null` for anything that is not one. */
export function attachmentIdFromRef(src: string): string | null {
  if (!isAttachmentRef(src)) return null;
  const id = src.slice(ATTACHMENT_REF_PREFIX.length);
  return id.length > 0 ? id : null;
}

/**
 * Every reference a document contains, in the order they appear and without
 * repeats.
 *
 * A regex and not a parser on purpose. The document is already validated by the
 * time this runs, it is a flat list of `<img src="…">` and nothing else carries a
 * `src`, and a second HTML parser in the client would be a second thing that has
 * to agree with the first about what a document is.
 */
export function imageReferences(document: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  // `src` is the only attribute on `img` that can hold a reference, and the
  // validator has already refused anything else on the tag.
  for (const match of document.matchAll(/<img\b[^>]*\bsrc\s*=\s*"([^"]*)"/gi)) {
    const id = attachmentIdFromRef(match[1] ?? "");
    if (id !== null && !seen.has(id)) {
      seen.add(id);
      found.push(id);
    }
  }
  return found;
}

/**
 * The cached file for a picture, named after the attachment.
 *
 * The name is the whole trick. It is what makes turning a local path back into a
 * reference a lookup on a string rather than a map held somewhere in memory, so
 * a note that is saved in a different app session than the one it was opened in
 * still resolves. A UUID has no `/` and no `.` in it, so it cannot forge a path.
 */
export function cachedImageName(attachmentId: string, extension: string): string {
  return `${attachmentId}${extension.startsWith(".") ? extension : `.${extension}`}`;
}

/** The same name out of a `file://` path, or `null` for a path that is not ours. */
export function attachmentIdFromCachedPath(uri: string): string | null {
  // The editor may hand back an absolute path or a `file://` one depending on
  // the platform and on how the document was serialised.
  const path = uri.replace(/^file:\/\//, "");
  const name = path.slice(path.lastIndexOf("/") + 1);
  // A UUID and an extension. Anything else is somebody else's file, and the save
  // leaves it alone rather than inventing a reference for it.
  const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[a-z0-9]+$/i.exec(
    name,
  );
  return match?.[1] ?? null;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/heic": ".heic",
};

export function extensionForMime(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType] ?? ".img";
}

/**
 * The document with every reference swapped for a local path the editor can draw.
 *
 * A reference with no file is left as it is. The editor shows its own placeholder
 * for a `src` it cannot read, which is the honest picture of a note whose image
 * has not been downloaded — better than a replacement that points at nothing.
 */
export function toLocalDocument(
  document: string,
  resolve: (attachmentId: string) => string | null,
): string {
  return document.replace(
    /(<img\b[^>]*\bsrc\s*=\s*")([^"]*)(")/gi,
    (whole, open: string, src: string, close: string) => {
      const id = attachmentIdFromRef(src);
      if (id === null) return whole;
      const local = resolve(id);
      return local === null ? whole : `${open}${local}${close}`;
    },
  );
}

/**
 * The pictures the editor lost on the way out, put back.
 *
 * **A workaround for a bug in the editor on Android**, and the reasoning is worth
 * the paragraph because it is not obvious.
 *
 * `setImage` draws the picture and leaves an object replacement character
 * (U+FFFC) in the text, but the span it hangs on that character is not the span the
 * serialiser looks for, so `getHTML` hands back the bare character: a `&#65532;`
 * where the picture was, no `<img>`, no `src`, nothing. The picture is in the note
 * you are looking at and gone from the note you come back to, and the attachment
 * sits in the storage with a copy nobody can reach.
 *
 * Three things make the repair safe and exact:
 *
 * - A stored document never legitimately contains U+FFFC. It is not text anybody
 *   can type, and the format does not allow it, so every one of them in the
 *   output of `getHTML` is a picture that lost its way out.
 * - The editor is handed the **stored** document when the screen opens, and that
 *   document has no replacement characters in it. So every one in the output is a
 *   picture inserted in this session, in the order it was inserted.
 * - Which is what `inserted` is: the pictures this screen has put in, in order.
 *
 * So the first U+FFFC in the output is the first picture, and so on. If the editor
 * ever stops losing them the replacement does nothing, because there is nothing to
 * replace; that is what makes this a workaround that expires rather than a lie.
 */
export const IMAGE_PLACEHOLDER = "\uFFFC";

export function restoreLostImages(
  document: string,
  inserted: readonly { id: string; width: number; height: number }[],
): string {
  if (!document.includes(IMAGE_PLACEHOLDER)) return document;
  let which = 0;
  return document.replace(
    new RegExp(IMAGE_PLACEHOLDER, "g"),
    (whole) => {
      const picture = inserted[which];
      which += 1;
      if (!picture) return whole;
      return `<img src="${attachmentRef(picture.id)}" width="${picture.width}" height="${picture.height}"/>`;
    },
  );
}

/** The document with every local path swapped back for a reference. */
export function toStoredDocument(document: string): string {
  return document.replace(
    /(<img\b[^>]*\bsrc\s*=\s*")([^"]*)(")/gi,
    (whole, open: string, src: string, close: string) => {
      if (isAttachmentRef(src)) return whole;
      const id = attachmentIdFromCachedPath(src);
      return id === null ? whole : `${open}${attachmentRef(id)}${close}`;
    },
  );
}

/**
 * The pictures a note already points at, so the cache can be filled before the
 * editor is given the document.
 *
 * Returns the ids, not the paths: the paths need a directory that only the
 * device has, and deciding that here would mean importing the file system into a
 * module that has nothing else to do with bytes.
 */
export function unresolvedReferences(
  document: string,
  has: (attachmentId: string) => boolean,
): string[] {
  return imageReferences(document).filter((id) => !has(id));
}

/**
 * The widest a picture is drawn at, in the units the editor is given.
 *
 * The number in the document is what the editor is handed and what it writes
 * back, and on Android the library multiplies it by the screen density before
 * drawing — so a 480-pixel phone photo is asked for as 480 points, which is a
 * thousand pixels wide on a 420-dpi screen and runs off the edge of the paper.
 *
 * So the size is fitted to the page before it is stored, and the shape is kept:
 * a photograph that arrives as 4800×3200 comes out as the width of the text and
 * a third of it tall, which is what somebody inserting a picture into a note
 * meant. The number that reaches the document is the number that was drawn, so
 * opening the note again draws the same thing.
 */
export const MAX_DRAWN_IMAGE_WIDTH = 320;

/** The `width` and `height` the editor needs, from the attachment if it has them. */
export function dimensionsFor(attachment: Attachment): {
  width: number;
  height: number;
} {
  // A picture with no measured size is drawn at a guess rather than refused: it
  // is a picture the app already accepted, and the editor scales it to the width
  // of the text either way.
  const width = attachment.width ?? 320;
  const height = attachment.height ?? 240;
  if (width <= MAX_DRAWN_IMAGE_WIDTH) return { width, height };
  return {
    width: MAX_DRAWN_IMAGE_WIDTH,
    height: Math.max(1, Math.round((height * MAX_DRAWN_IMAGE_WIDTH) / width)),
  };
}
