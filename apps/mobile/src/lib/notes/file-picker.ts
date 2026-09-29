import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import type { AttachmentDraft } from './attachments';
import { ATTACHMENT_MIME_TYPES } from '@orbit-hub/contracts';

/**
 * Choosing a file.
 *
 * Two implementations behind one function, because the platforms do not agree on
 * anything: the web has a file input and a `File`, and a phone has pickers that
 * hand back a local uri and a name the system made up. What both have to produce is
 * the same description of a file, so nothing downstream has to know which it was.
 *
 * The web one is not imported from the top: it uses `document`, which does not
 * exist in Hermes, and a module that references it at import time would take a
 * phone build down. Here it is only ever reached on web.
 */

let sequence = 0;

function nextLocalId(): string {
  sequence += 1;
  return `up-${Date.now().toString(36)}-${sequence}`;
}

/** What the pickers are allowed to offer, so neither asks for what is refused. */
const ACCEPT = ATTACHMENT_MIME_TYPES.join(',');

/**
 * The web path: a file input.
 *
 * Built by hand rather than rendered, because it lives inside a note screen that
 * is otherwise a list of pressables, and a hidden input that appears once per
 * screen is a node the layout does not know about. It is removed in every path
 * out, including the cancel one, so a person who opens the picker twenty times does
 * not leave twenty inputs behind.
 */
async function pickWebFile(): Promise<AttachmentDraft | null> {
  if (typeof document === 'undefined') return null;

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT;
    input.style.display = 'none';

    let settled = false;
    const finish = (value: AttachmentDraft | null): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      finish({
        localId: nextLocalId(),
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        // The `File` itself is the body of the upload. A data uri would be a third
        // copy of every picture a person attaches, held in memory for the life of
        // the screen.
        uri: file as unknown as string,
        // A browser will not say how large a picture is until it decodes it, and
        // decoding a file the server has not accepted yet would be reading bytes
        // for nothing. A null is the honest answer and the note shows the picture
        // at whatever size it renders.
        width: null,
        height: null,
      });
    });

    // Not every browser fires this, but the ones that do are the ones where a
    // cancelled dialog would otherwise leave the promise open for ever.
    input.addEventListener('cancel', () => finish(null));

    document.body.appendChild(input);
    input.click();
  });
}

/**
 * A picture, on a phone.
 *
 * A photo is picked with the camera roll rather than the document picker, because
 * on iOS those are different screens and the camera roll is the one a person means
 * by "add a photo". It reports the width and height for free, so the note can lay
 * the picture out without decoding it.
 */
async function pickNativeImage(): Promise<AttachmentDraft | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    // Not an error to shout about: a person who says no is answering, and a note
    // with no picture is still a note. The caller shows nothing.
    return null;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    // The server checks the size anyway; this only spares a person a round trip
    // to be told a photo is too large.
    quality: 1,
    allowsMultipleSelection: false,
  });
  if (result.canceled) return null;

  const asset = result.assets[0];
  if (!asset) return null;

  // A HEIC from an iPhone is on the accepted list, but the picker may hand it back
  // with the more general type. Normalising here is what keeps the client from
  // refusing a picture the server would have taken.
  const mimeType =
    asset.mimeType && ATTACHMENT_MIME_TYPES.includes(asset.mimeType as never)
      ? asset.mimeType
      : guessImageMime(asset.fileName ?? '');

  // The name the system made up is kept. It is what the person will see in their
  // own list of files, and renaming it here would be second-guessing the device —
  // the number it gives a camera photo is its own indexing, and it changes when
  // the photo is taken from a different app.
  const fileName =
    asset.fileName && asset.fileName.length > 0
      ? asset.fileName
      : `imagen-${Date.now()}.${extensionFor(mimeType)}`;

  return {
    localId: nextLocalId(),
    fileName,
    mimeType,
    // The picker does not always know, and 0 is not a size. A null is better than
    // a number the server would reject.
    sizeBytes: asset.fileSize ?? 0,
    uri: asset.uri,
    width: asset.width ?? null,
    height: asset.height ?? null,
  };
}

/** Anything that is not a picture: a PDF, a text file. */
async function pickNativeFile(): Promise<AttachmentDraft | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ATTACHMENT_MIME_TYPES as unknown as string[],
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;

  const asset = result.assets[0];
  if (!asset) return null;

  const mimeType =
    asset.mimeType && ATTACHMENT_MIME_TYPES.includes(asset.mimeType as never)
      ? asset.mimeType
      : 'application/octet-stream';

  return {
    localId: nextLocalId(),
    fileName: asset.name,
    mimeType,
    // `size` can be missing on Android for a document provider, and a file whose
    // size is unknown cannot be checked against the ceiling, so it is refused
    // later rather than guessed at here.
    sizeBytes: asset.size ?? 0,
    uri: asset.uri,
    width: null,
    height: null,
  };
}

/** A name is the only hint there is when the system will not say the type. */
function guessImageMime(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.heic')) return 'image/heic';
  return 'image/jpeg';
}

function extensionFor(mimeType: string): string {
  return mimeType.split('/')[1] ?? 'bin';
}

/**
 * A picture, whichever platform this is.
 *
 * The two ask different questions of the person: on the web there is one file
 * input and it offers both pictures and documents, and there is no way to ask it
 * for only images, so the accept list is the whole answer. On a phone the two
 * pickers are different screens, so the caller asks for the one it wants.
 */
export async function pickImage(): Promise<AttachmentDraft | null> {
  if (Platform.OS === 'web') {
    return pickWebFile();
  }
  return pickNativeImage();
}

/** Any accepted file. Pictures included — the web input cannot tell them apart. */
export async function pickAnyFile(): Promise<AttachmentDraft | null> {
  if (Platform.OS === 'web') {
    return pickWebFile();
  }
  return pickNativeFile();
}
