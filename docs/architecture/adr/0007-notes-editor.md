# ADR 0007 — Two note editors over one document format

**Status:** Superseded by [0009](0009-one-native-editor.md)

The shared converter this decision depended on turned out to need jsdom, which does not run in
Hermes, and both of BlockNote's HTML exporters were unusable here. See
[0009](0009-one-native-editor.md) for what replaced it. What survives below is the investigation:
which libraries exist, what each one can and cannot do, and why the web editor was wanted.

## Context

Notes have to feel native on Android and iOS, and rich on the web, from one codebase. The legacy
app shipped a single DOM-only editor, which is why notes did not work properly on mobile.

The two goals pull in opposite directions. A Notion/Obsidian-style block editor needs a document
model, drag handles and slash commands. A native-feeling editor needs the platform's own text
input. As of September 2026 no library is both. The candidates were:

| Library | Native | Web | Block editor | Verdict |
| --- | --- | --- | --- | --- |
| `react-native-enriched-html` (Software Mansion) | yes | yes | no | native input + display, HTML |
| `react-native-enriched-markdown` (Software Mansion) | yes | renderer only | no | `TextInput` is native-only and still inline-only |
| `@expensify/react-native-live-markdown` | yes | yes | no | chat-style markup highlighting, markdown string |
| `@10play/tentap-editor` | no (WebView) | yes | yes | ProseMirror JSON, unmaintained since Nov 2025 |
| BlockNote | no (DOM only) | yes | yes | best block editor, ProseMirror JSON, template API |

`react-native-enriched-html` is the strongest native option: an uncontrolled `EnrichedTextInput`
built on the platform text stack, a matching `EnrichedText` display component, one API for iOS,
Android and web, and an explicit compatibility entry for React Native 0.86 (Expo SDK 57) on the
New Architecture. BlockNote is the strongest block editor and produces the ProseMirror JSON the
`noteDocumentSchema` already describes.

## Decision

Two editors, one document format.

- **Android and iOS:** `react-native-enriched-html`. Native text primitives, native selection,
  native keyboard behaviour, a toolbar for the supported marks and blocks.
- **Web:** BlockNote, mounted in a container element owned by the web-only editor component.
  Keyboard-first, full block set, slash menu, selection handles.
- **Format of record:** ProseMirror/BlockNote JSON, as `noteDocumentSchema` already specifies.
  It is the only lossless representation of a document, so it is what gets stored and synced.
- **Conversion:** a new shared package holds the block schema and converts between the two
  representations with `ServerBlockNoteEditor` from `@blocknote/server-util`, which runs without a
  DOM. The same code therefore runs on web and in Hermes. Opening a note on native projects JSON
  to HTML; saving converts the HTML back to JSON and validates it before writing.

HTML is a projection for the native editor, never the stored format. A note edited on native
round-trips through HTML, so the round trip is covered by contract tests.

## Consequences

**Good**

- Android and iOS get a real text input: system keyboard, autocorrect, drag and drop, the
  platform selection menu and no WebView latency.
- The web target gets a full block editor without giving up the single codebase.
- The legacy app already stored BlockNote JSON, so migrating existing notes is a format match
  rather than a conversion project.
- The conversion layer is one small package with one schema, testable without a device.

**Bad**

- `react-native-enriched-html` supports single-level lists only; nested lists are the first item
  on its roadmap. A nested list written on web cannot be represented faithfully on native.
  Mitigation: the JSON is never rewritten by the native editor, nesting is flattened only in the
  HTML projection, and a note containing nesting that cannot be represented says so instead of
  quietly dropping the structure.
- `react-native-enriched-html` accepts a fixed tag set and does **not** sanitise HTML on iOS or
  Android. Documents are validated against the schema before storage, and HTML from an untrusted
  source is sanitised before it reaches the input.
- Two editor UIs means two sets of bugs, two sets of accessibility checks and two visual designs
  to keep consistent with the design tokens.
- Neither library ships in Expo Go. Both need a development build, and
  `react-native-enriched-html` needs `expo prebuild`.
- BlockNote is pre-1.0, so its API can still move under us.

**Rejected**

- `@10play/tentap-editor` on all three targets: rejected, a WebView is exactly the native-feeling
  problem this ADR exists to avoid, and the package is unmaintained.
- `react-native-enriched-html` on all three targets: rejected, it would still need a second
  editor to reach a Notion-like web experience, and it would force the stored format to be HTML.
- `react-native-enriched-markdown` for input: rejected, its input component has no web support
  and does not yet do headings, lists, quotes or code blocks.
- `@expensify/react-native-live-markdown`: rejected, it styles markup as you type for chat
  composers and has no block structure.
- A block editor hand-built on `TextInput`: rejected, keeping the selection and the document in
  sync is the expensive part, not the rendering.

See [../notes-editor.md](../notes-editor.md) for the document format, the schema and templates.
