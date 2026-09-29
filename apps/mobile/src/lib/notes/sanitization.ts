import type { EnrichedTextInputProps } from "react-native-enriched-html";

/**
 * Which URIs the editor's sanitiser lets through.
 *
 * `react-native-enriched-html` runs every document through DOMPurify before
 * tiptap sees it, and DOMPurify checks the value of every `src` and `href`
 * against `ALLOWED_URI_REGEXP`. Its default list has no `blob:`.
 *
 * That is invisible on a phone and fatal on the web. A phone's picture is a file
 * in the cache and its `src` is a `file://` URI, which the native path never
 * puts through DOMPurify. The browser has no such file: the only thing it will
 * draw is an object URL, and `blob:` is exactly what the default list refuses.
 * So on the web every picture arrived at the editor with its `src` removed —
 * the editor drew its own broken-picture placeholder, `getHTML()` wrote
 * `<img src="">`, and the contract rejected the document, which is why the note
 * said it could not be saved.
 *
 * **This replaces the default, it does not extend it.** DOMPurify's
 * `ALLOWED_URI_REGEXP` is a whitelist of the whole value, so a regex that only
 * mentioned `blob:` would refuse `https:` links and turn every hyperlink in a
 * note into plain text. The protocols that were allowed before are written out
 * again, and `blob:` is added.
 *
 * This is the app telling the sanitiser about a platform, not about content: a
 * `blob:` URL can only be a picture this app just downloaded from its own API,
 * and it dies with the document that made it, so it cannot be persisted by
 * accident. `storedDocument()` maps it back to `attachment:<id>` before
 * anything is saved.
 */
export const NOTE_SANITIZATION: NonNullable<
  EnrichedTextInputProps["sanitizationConfig"]
> = {
  linkRegex:
    /^(?:(?:blob|file|https?|mailto|tel|callto|sms|cid|xmpp|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
};
