# Notes editor

## One editor

The legacy app used a DOM-only rich text editor, which is why notes did not work properly on
mobile. OrbitHub uses `react-native-enriched-html` on Android, iOS and the web: the same
component, the same toolbar, the same saved format, no platform split.

An earlier decision was to pair it with a BlockNote editor on the web, so the web would get a
real block editor. That needed a converter between ProseMirror JSON and HTML, and the converter
turned out to depend on jsdom, which does not run on Hermes. [ADR 0007](adr/0007-notes-editor.md)
records the attempt and what was measured; [ADR 0009](adr/0009-one-native-editor.md) records
what replaced it.

What this costs is stated plainly rather than buried: **the web is no longer Notion-like.** It is
a formatting toolbar, not slash commands, block handles or `Cmd+B`. The documents look the same
either way. BlockNote was never available on Android or iOS, so nothing was lost there.

## Document format

A note stores HTML, and only the HTML the editor produces:

```html
<h2>Salsa de tomate</h2><p>Seis tomates por cada una de las otras.</p>
<ul data-type="checkbox"><li checked>Tomates</li><li>Sal</li></ul>
```

The editor's tag set is closed, so the format is closed too, and it is small:

- Inline: `b`, `i`, `u`, `s`, `code`, `a`, `img`.
- Paragraph: `h1`-`h6`, `ul`, `ol`, `ul[data-type="checkbox"]`, `blockquote`, `codeblock`.
- A plain line is a `p`; an empty line is a `br`.
- `mention` is a chip that points at a list, a note, a folder, a space or a bookmark. It is in the
  format with a closed set of attributes and no markup inside it, see
  [ADR 0034](adr/0034-mencion-en-notas.md). Its name is a copy: what is drawn is the target's
  current name from the local cache.

Rules:

- Anything outside that set is rejected on write. The editor strips it on the way in, so a
  document that contains it came from somewhere else, and the server is where that is caught.
- No `style` attribute, no `class`, no `script`. Presentation comes from the theme, not from
  the document, which is what keeps a note readable in a future light or dark palette.
- `plain_text` is denormalised on save for search and for list previews, by stripping tags.
- The document has a `version`; a document that fails validation is never written, the previous
  version is kept, and the failure is reported instead of silently truncating content.

The editor does not sanitise HTML on iOS or Android, so **this validation is the security
boundary on mobile**, not a nicety. It runs before the value is stored.

**Lists are single level.** Nested lists are the first item on the editor's roadmap. A note that
needs one today is a note the editor cannot represent, and the app says so rather than flattening
it and pretending.

## Reading and writing

`EnrichedTextInput` is uncontrolled and built on the platform text stack, so selection,
autocorrect, the keyboard and the selection menu are the system's own. A toolbar drives the
supported marks and blocks through its imperative API, and `onChangeState` reports which are
active so the toolbar can show it. `EnrichedText` renders the same HTML for reading with matching
styles, so a note looks identical while editing and while reading.

There is no conversion anywhere in the feature. The editor's output is the stored format, and the
stored format is the editor's input.

Two differences between the platforms were found by running the app, and both are handled in
`packages/contracts/src/note-document.ts` rather than in the app, so the client and the API do the
same thing:

- **The web build wraps the document.** Its `getHTML()` answers `<html><p>Hola</p></html>` where
  the native build answers `<p>Hola</p>`. The wrapper is stripped on the way in, and what is
  stored is the body, so a note written on the web is the same note byte for byte as one written on
  a phone. Putting `html` on the allow-list instead would have let a document carry a `<head>` and
  a `<script>` for the sake of one platform's implementation.
- **The web build uses different attribute names for a task list** in its own DOM
  (`data-type="checkboxList"`, `data-checked`) but normalises them in `getHTML()`, so the stored
  document uses the native vocabulary on both. This one only holds because the library normalises
  on the way out, and a test asserts the stored form rather than the rendered one.

Two web-specific limits to design around: `measure`, `measureLayout` and `setNativeProps` are
no-ops, which constrains a toolbar that positions itself against the caret, and the native
context menu is ignored, so a custom context menu is web-only work.

## Saving

`lib/notes/autosave.ts` owns the timing and nothing else does. A keystroke calls `schedule()`, a
save happens 800 ms after the writing stops, and leaving the screen flushes rather than dropping
what is pending. The document is read with `getHTML()` rather than `onChangeHtml`, because the
library parses HTML on every keystroke if you let it and says so in its own documentation.

Three things about saving were found by using it rather than by testing it, and each is now a
test:

- An edit to a row whose `create` has not gone out yet is folded **into that create** rather than
  queued behind it. The create leaves about a second and a half after it is written, so the two
  are almost never in the same batch, and sending them separately means the second carries
  `baseVersion: 0` against a server sitting at 1.
- The version the server answers with is written back into the cache. Without it the cached row
  keeps the version it had when it was written locally, and every later edit looks stale.
- Two saves of the same document are not a conflict. The merge compares the client's value with the
  server's before deciding anybody moved, because a field where both sides independently arrived
  at the same value is not contested — and a save that changes nothing does not bump the version.

## Attachments

- Images and files are stored in object storage; the note stores an `attachments` reference with
  mime type, size and dimensions.
- Uploads are queued separately from note writes so a failed upload never blocks a text edit.
- Offline: the attachment is written locally first and uploaded when connectivity returns; the
  note shows a pending badge until the upload completes.
- Server side, mime type and size are validated on upload, and access is authorised per note,
  never by public URL.

### How it is built

A file is not an operation, so it does not go through the outbox. It is too large for a row, it
goes straight to storage, and a half-finished upload is not something a replay can finish. The
queue is its own small thing in `lib/notes/pending-uploads.ts`, and the reason it exists at all
is the rule above: a photo that will not upload must never cost somebody their text.

**Two steps, and a row only after the second one.** The client asks for a ticket, sends the bytes
to where the ticket says, and then confirms. No row is written for a ticket, because a file
somebody started and abandoned is not an attachment, it is something a cleanup job has to find.
The bytes are checked at confirm, not just their existence: a connection dropped halfway leaves a
file there, and "the file exists" would accept it and put a broken image in somebody's note with a
row insisting it is fine.

**The key is the server's, and it sits inside the note's own prefix.** That prefix is the only
thing tying an upload to the note it was started for, so a client that hands back somebody else's
key gets a 404. The key never leaves the server: `attachmentSchema.storageKey` comes back blank
and a client is handed a signed link that expires instead.

**Storage is a driver, like the database and the email.** `local` writes to a directory and the
API serves from it, which is what makes an attachment work on a clean clone with nothing
configured; `s3` hands out a presigned URL and the bytes go from the phone to the bucket without
passing through the API in memory. The API refuses to boot in production with `local`, because a
directory inside the container is lost on restart and an attachment that was there yesterday is a
404 today.

**One thing is decided once, in the contract.** `ATTACHMENT_MIME_TYPES`, and the size ceilings
alongside them, live in `packages/contracts` and both sides read them from there. The server may
raise a ceiling by configuration; the client uses the default to answer before it sends anything,
and the server has the final word. `image/svg+xml` is deliberately absent: an SVG is a document
that runs code.

### What the two runtimes genuinely cannot share

The body of the upload is `{ uri }` on a phone and the `File` itself in a browser, and that
difference is decided by the value rather than by asking the platform, so it cannot be wrong.
Passing a `file://` string to a phone's `fetch` uploads the forty characters of the path, the
server accepts the request, and the note shows a broken image with a row saying the file is there.

The same split decides whether a retry is offered. A phone keeps the file as a path in the sandbox
and it survives a restart. A browser keeps it as a `File` owned by a document that no longer
exists, and what the queue has left is `{}` — so the person still sees that they chose a picture,
which is true, and is not offered a retry that cannot work, which is also true.

## Performance

- Autosave is debounced (800 ms after the last keystroke) and flushed on background.
- Only the changed document is sent; the API rejects no-op updates by version.
- One editor means one save path, so there is no need to paginate a document for the sake of a
  second editor that cannot read half of it.

## Templates

A template is a document. It is created the same way a note is, saved once, and reused by
inserting a copy. Creating a template is therefore "save this note as a template", not a second
editor to build and keep in sync. A template is an HTML string validated by the same allow-list,
so a template can never produce a note the editor cannot open. Applying a template copies the
HTML, and the new note is an ordinary note afterwards: editing it does not touch the template.

### Scope

A template has one of three scopes.

- **Personal** — belongs to one member and follows them across their devices. Not shared.
- **Workspace** — belongs to a workspace and is available to every member with access to it.
- **Public** — published by OrbitHub, or published by a member who chose to. Read only, no owner.

Applying a template is a local copy, so a template can be deleted or changed afterwards without
touching the notes it produced. Duplicating someone else's template into the workspace is an
explicit action, never a side effect of using it.

### Built-in templates

Shipped with the app, seeded locally and identified by a stable key so an update is recognised
instead of duplicated. They are not synced and cannot be edited; a member who wants a change
duplicates it.

| Key | Template | Shape |
| --- | --- | --- |
| `recipe` | Recipe | servings, prep and cook time, ingredients as a checklist, numbered steps, notes |
| `instructions` | Step-by-step guide | goal, what you need, steps as a checklist, warnings, what to do if it fails |
| `meeting` | Meeting notes | date, attendees, agenda, decisions, action items with an owner and a due date |
| `journal` | Daily journal | date, one line on the day, what happened, what to remember |
| `book` | Book, film or series | title, author or director, rating, summary, favourite parts, takeaways |
| `project-brief` | Project brief | objective, in and out of scope, milestones, risks, who is involved |
| `decision` | Decision record | context, decision, options considered, consequences, status |
| `shopping` | Shopping list | grouped by aisle, checkboxes, notes |
| `trip` | Trip plan | where and when, day by day, packing checklist, bookings |
| `review` | Weekly review | what went well, what to change, next week's focus |
| `workout` | Workout log | routine, sets and reps, weight, how it felt |
| `lesson` | Class or lesson plan | objective, materials, steps, how to check understanding |

Twelve is a starting set, not a limit. They are data in the app, so new ones ship without a
release.

## Still to come

Nothing below is a loose end in the work that is done; each is a decision that was not taken
because it is not obvious.

- **Publishing a template to the public catalogue** answers `501`. The `public` scope exists and
  the built-in catalogue is served from it, but nothing moves a person's template into it. That
  needs a moderation question, not just a route.
- **Code syntax highlighting.** The editor stores a `codeblock` but styles it as plain text.
- **Nested lists.** One level, today. The document format does not forbid more; the editor does
  not produce it.
- **Image resizing** — whether a resized picture is stored in the document or as attachment
  metadata. The columns exist and nothing writes them yet.
- **`href` is not URL-validated.** It is in the allow-list, so a note can carry a `javascript:`
  link. A test asserts the gap on purpose, so it fails the day somebody fixes it.
- **A block editor on the web.** HTML does not foreclose it: an adapter that reads the stored HTML
  and produces BlockNote blocks is one-directional and needs no change to what is stored. The
  allow-list means it would have a known, closed input to handle.
- **Linking a note to a list item**, the way a recipe can hang off a shopping list. Today the two
  are unrelated: a note has a `folder_id` and a row has an `annotation`.

## Verifying it

`react-native-enriched-html` is a native module, so a phone needs a development build —
`npx expo prebuild` and then `./gradlew :app:assembleDebug`; it does not work in Expo Go. It has
been run on an Android emulator (API 35) and the following is measured, not assumed:

- the editor renders the stored document and the format bar applies to the block under the cursor;
- a markdown shortcut (`- `) becomes a real list item, stored as `<li>`;
- the native selection handles and the system context menu (Cut / Copy / Share / Select all) work,
  and the keyboard scrolls the editor instead of covering it;
- a template applied from the catalogue opens fully populated — headings, checkboxes and a
  numbered list all survive the round trip;
- a photo chosen from the system picker reaches storage byte for byte, and the note's
  `attachment_count` is right;
- writing with the network off says *"Saved on this device"*, leaves the server untouched, and
  the queued edit arrives on the next sync with no conflict.

Both themes were checked on the device as well as in a browser.

Three bugs came out of that run and would not have come out of a browser, which is the argument for
doing it: a `SecureStore` key Android refuses because of a colon, an `Animated.View` on the drawer
that only crashes on a phone, and an upload body that React Native used to accept as `{ uri }` and
Expo's `fetch` does not. All three have a test.

The API contract, the queue, the permission rules and the signed links are covered by tests and do
not depend on which platform is running. iOS has not been run; the parts of the editor that are
platform-specific are the selection handles and the keyboard, and those come from the module rather
than from this code.
