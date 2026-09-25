# Notes editor

## Why two editors

The legacy app used a DOM-only rich text editor, which is why notes did not work properly on
mobile. OrbitHub keeps a rich editor on the web and a native-feeling editor on Android and iOS,
both reading and writing the **same document format**.

## Document format

Notes store a ProseMirror/BlockNote compatible JSON document:

```json
{ "type": "doc", "content": [ { "type": "paragraph", "content": [ ... ] } ] }
```

Rules that keep the format portable:

- Only the node types both editors can render are allowed: paragraph, heading, list, quote,
  code block, horizontal rule, image, hard break, text with marks (bold, italic, strike, code,
  link, colour).
- No HTML nodes. No inline styles. Everything is an attribute, so a schema check can reject
  anything the native editor cannot display.
- `plain_text` is denormalised on save for search and for list previews.
- The document has a `version`; a document that fails validation is never written, the previous
  version is kept, and the failure is reported instead of silently truncating content.

## Web editor

Rich, keyboard-first editing with the full node set, selection handles, link editing and paste
handling. It is a normal web component rendered inside the React Native Web app.

## Native editor

Built from native text primitives (`TextInput`, native selection, platform keyboard behaviour)
with a toolbar for the supported marks and blocks. It is deliberately simpler than the web
editor: fewer inline affordances, larger touch targets, no hover states.

## Attachments

- Images and files are stored in object storage; the note stores an `attachments` reference with
  mime type, size and dimensions.
- Uploads are queued separately from note writes so a failed upload never blocks a text edit.
- Offline: the attachment is written locally first and uploaded when connectivity returns; the
  note shows a pending badge until the upload completes.
- Server side, mime type and size are validated on upload, and access is authorised per note,
  never by public URL.

## Performance

- Autosave is debounced (800 ms after the last keystroke) and flushed on background.
- Only the changed document is sent; the API rejects no-op updates by version.
- Long documents are paginated by block range for the native editor, with the full document
  available offline.

## Open questions for Phase 4

- Whether to support tables and code syntax highlighting (both editors must support them).
- Whether image resizing should be stored in the document or as attachment metadata.
- Whether the native editor should support Markdown shortcuts.
