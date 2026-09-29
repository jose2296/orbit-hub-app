# ADR 0009 — One native note editor everywhere, HTML as the format

**Status:** Accepted

Supersedes [0007](0007-notes-editor.md).

## Context

[ADR 0007](0007-notes-editor.md) chose two editors over one document format: `react-native-enriched-html`
on Android and iOS, BlockNote on the web, with a shared package converting between ProseMirror JSON
and HTML. It claimed the conversion would run on `ServerBlockNoteEditor` from
`@blocknote/server-util`, because that package is described as needing no DOM.

That claim was wrong, and it was load-bearing. `@blocknote/server-util` depends on **jsdom** and
every one of its four conversion functions is wrapped in a `_withJSDOM` call; the
`ServerBlockNoteEditor` object is literally `{ editor, jsdom }`. It brings its own DOM rather than
avoiding one. jsdom is a Node library built on `fs` and `vm`, so it does not run in Hermes. The
shared converter the decision depended on cannot exist as described.

Two further findings from the same investigation:

- `blocksToFullHTML` emits BlockNote's internal markup (`bn-block-group`, `data-node-type`), which
  is outside the closed tag set `react-native-enriched-html` accepts and would be stripped.
- The interoperable export, `blocksToHTMLLossy`, is documented as losing nesting. That is exactly
  the structure the format is required to preserve, so even on the web the only usable exporter
  would drop it silently.

So the conversion would have been hand-written, and it would have been needed in both directions,
for a second format, to serve a second editor.

## Decision

One editor, on all three platforms, with HTML as the stored format.

`react-native-enriched-html` is the only note editor in the app. `EnrichedTextInput` edits,
`EnrichedText` reads, and the same code runs on Android, iOS and the web. There is no platform
split in the notes feature, no second editor, and no conversion layer.

A note stores HTML, validated against the closed tag set the editor accepts. `plain_text` is
denormalised on save for search, derived by stripping tags, and the app already has a tested
`stripHtml` to do it.

The decision is taken now because the `notes` table does not exist yet. Choosing the format after
it does means migrating real documents.

### Keeping the way back to a block editor

HTML does not foreclose a Notion-style web editor later. Converting a stored document to
BlockNote blocks is a one-directional adapter that reads the HTML and produces blocks; it does not
require rewriting what is stored. The escape hatch stays open, and the allow-list means the
adapter has a known, closed input to handle rather than arbitrary markup.

## Consequences

**Good**

- One editor, one integration, one set of bugs, and one code path per notes screen instead of
  two. Two editors means two accessibility passes and two UIs held to the design tokens.
- No converter package, no `jsdom`, no `yjs`, no BlockNote. `@tiptap/pm` and `@blocknote/react`
  never enter the dependency graph, let alone the native bundle.
- The riskiest part of the notes phase disappears: there is no BlockNote inside Metro, React
  Native Web and a static export, and no `contentEditable` fighting the RNW tree.
- Every platform is native, including the web, which is unusual and worth having.
- A template is an HTML string. There is no second schema to keep in step with the editor.
- Choosing HTML while the table is empty is free. Choosing it later is a data migration.

**Bad**

- The web target is no longer Notion-like. It is Apple Notes level: a formatting toolbar, not
  slash commands, block handles, drag-to-reorder, `Cmd+B` or markdown shortcuts. The *documents*
  look the same; the interaction model is simpler.
- Lists are single level everywhere, not only on native. Nested lists are the first item on the
  editor's roadmap, so this is a wait with a version attached rather than a permanent no.
- `measure`, `measureLayout` and `setNativeProps` are no-ops on web, which constrains a toolbar
  that needs to position itself against the caret. The native context menu is also ignored on
  web, so a custom context menu is web-only work.
- The editor does not sanitise HTML on iOS or Android; the web implementation does. Validation is
  therefore the security boundary on mobile, and it has to run before the value is stored, not
  before it is rendered.
- HTML is the format the legacy migration has to target, instead of a ProseMirror document. The
  legacy notes are BlockNote JSON, so that conversion still happens; it now produces HTML.
- HTML is a weaker archival format than a structured document, because it is easier to lose
  meaning in. It is also more durable, because it does not depend on a pre-1.0 library's shape.
