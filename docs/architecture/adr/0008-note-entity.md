# ADR 0008 — A note is an entity, a list row has an annotation

**Status:** Accepted

## Context

The schema contained two incompatible claims about what a note is, and they had to be settled
before notes or templates could be shared, because a share points at a node type.

One claim said a note is its own table. It appears in `noteSchema` in the contracts, in
`attachmentSchema.noteId`, in `syncEntitySchema`, in the `recent_notes` dashboard widget kind, in
the data model tree and in its indexing notes, in the product scope, in the legacy migration
plan, and in the legacy Prisma schema, which has a real `notes` table with a `folder_id`.

The other claim said a note is not a table but the `notes` column of a list item. It appears in
three places: the comment on `shareNodeTypeSchema`, the comment on the `shares` table, and the
roadmap. Those three are not three findings. They are the same sentence, written once while the
sharing tables were being built, and repeated where it was relevant to sharing. The roadmap
version is also internally inconsistent: it says there is no fourth node type while listing four.

The claim was about sharing, expressed as a claim about the data model, and Phase 4 falsifies
it. A note is a ProseMirror document, which is a nested structure; the column is
`varchar(2000)`. A template is a document too. Nothing that Phase 4 is specified to build fits
in a column of a list row, and the legacy migration maps the legacy `notes` table to a `notes`
table, so the column reading would break it.

What was actually true is that two different things shared a name. `list_items.notes` is a
short free-text remark on a row ("comprar leche, *traer el propio*"), used by the item detail
screen and the item editor. It is not a note. The name collision is what produced the wrong
inference, and leaving it in place would produce it again.

## Decision

A note is an entity of its own, and a list row has an annotation.

- `notes` is a table, a sync entity, and a share node type. `attachmentSchema.noteId` hangs off
  it as written.
- `list_items.notes` is renamed to `annotation` in the contract, the column and the client. It
  stays `varchar(2000)`, nullable, plain text. The rename is the point: the ambiguity was
  caused by the name, so the name is what changes.
- `shareNodeTypeSchema` gains `note` and `note_template`, so six node types are shareable:
  `workspace`, `folder`, `list`, `list_item`, `note`, `note_template`.
- `SYNC_ENTITIES` and `SYNC_WRITABLE_FIELDS` gain `note`, `attachment` and `note_template`.

The two tests that asserted the old state are replaced, not worked around: one asserted
`POST /notes` answers 501, the other asserted a `note` push is rejected as not yet synced.

## Consequences

**Good**

- One concept, one name. A reader of the schema can no longer derive "notes are a column" from
  the column's name.
- Sharing a note is a grant like any other, which is what the templates feature needs.
- The legacy migration keeps its mapping: the legacy `notes` table is a `notes` table.
- `attachmentSchema` and the `recent_notes` widget stop being schemas waiting for a table that
  the comments said did not exist.

**Bad**

- The rename touches about fourteen call sites in the app plus a migration, and any client
  holding a cached `list_item` payload with `notes` in it needs to pull again. A rename of a
  synced field is not free: old payloads carry the old key, so the field reads as absent and
  the annotation looks empty until the next sync.
- Six share node types means six branches in authorisation and in the share inbox. The
  alternative was to keep notes unshareable, which is worse.
- The roadmap records the old decision in the past tense. It is corrected with a note rather
  than rewritten, per the rule in the ADR README, so the history keeps showing that the
  decision was made and later reversed.
