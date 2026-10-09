# Data model

The schema is new: OrbitHub does not inherit the legacy tables. PostgreSQL, UUID primary keys,
timestamps on everything.

## Identity

| Table | Purpose |
| --- | --- |
| `users` | Profile: email, display name, locale, email verification flag |
| `auth_identities` | Login methods: `email` or `google`, with the provider subject id |
| `sessions` | One row per device: refresh token hash, device label, last seen, revoked at |
| `email_tokens` | Single-use tokens for verification and password reset (hashed, expiring) |
| `devices` | Push targets and device metadata, independent of sessions |

`auth_identities` is what makes account linking safe: one user can hold an email identity and a
Google identity, and the linking rules in [auth.md](auth.md) decide when that happens.

## Workspace and content

```
workspaces ──< memberships >── users
    │
    ├──< folders (self referencing, parent_id)
    ├──< lists ──< list_items
    ├──< notes ──< attachments
    └──< invitations
```

| Table | Notes |
| --- | --- |
| `workspaces` | Name, description, emoji, soft delete |
| `memberships` | `(workspace_id, user_id)` unique, role `owner`/`editor`/`viewer` |
| `folders` | `parent_id` nullable; cycles are rejected by the API |
| `lists` | `kind` = `tasks` \| `board` \| `movies` \| `series` \| `movies_and_series` \| `books`; one shape for all six. `states` jsonb holds a board's columns, in order, and is `[]` on every other kind |
| `list_items` | Position, completed, priority, tags, `external_id`, `metadata` jsonb, `annotation`, `state_id`: the board column the row is drawn in |
| `notes` | `document` jsonb (portable editor format) plus denormalised `plain_text` for search |
| `attachments` | Storage key, never a public URL; size and mime type validated server side |
| `invitations` | Token, role, expiry, status; single use |
| `journal_entries` | Owned by the account, not a space: one row per user and calendar day (`date`). Id derived from the account and the day, see [ADR 0033](adr/0033-diario.md) |

`list_items.external_id` points at the provider record (TheMovieDB, Google Books) and
`metadata` keeps the raw provider payload, so a list renders offline without calling the
provider again.

`list_items.annotation` is a short plain-text remark on a row, and is not a note. It was called
`notes` until [ADR 0008](adr/0008-note-entity.md), which settled that a note is an entity of its
own: the name collision had led to a comment claiming notes had no table of their own, which
Phase 4 makes false, because a note is a document and does not fit in a `varchar(2000)`.

A board is `kind: 'board'` and its columns are `lists.states`: a jsonb array whose **order is
the order of the columns**, so reordering columns is one write and not one write per column.
`[]` is legal and is the ordinary value: every list that is not a board carries it and never
has to invent a state. A task points at one of those ids with `list_items.state_id`, which is
nullable and carries **no foreign key**: `null` means the first column, which is what lets a
task on a board be created by the same code that creates a task on any other list. A foreign key
cannot stand in for that check: `states` is a column and not a table, so comparing a row against
it is a second query. The server checks the invariant on every write instead and rejects an
unknown id (`isKnownStateId`) rather than storing a value no screen can draw.

`state_id` is unindexed on purpose. Nothing in the database filters by it: a board splits the
items it has already pulled in memory (`tasksInState`, `countInState` in
`apps/mobile/src/lib/lists/board.ts`), so an index would be paid for on every move and read by
no query. `completed` is indexed no more than this: the items query can filter on it, and the
index list below says nothing about that either.

## Sync support

| Table | Purpose |
| --- | --- |
| `sync_operations` | Server-side idempotency ledger keyed by `operation_id` |
| `sync_conflicts` | Unresolved conflicts with both versions and the conflicting fields |
| `sync_cursors` | Per device pull cursors |

## Shared columns

Every syncable table carries:

```text
id            uuid primary key
version       integer not null default 0   -- optimistic concurrency
created_at    timestamptz not null
updated_at    timestamptz not null
deleted_at    timestamptz null             -- tombstone, never a hard delete
```

`version` is incremented on every accepted write and is what `baseVersion` is compared against.
`deleted_at` is what makes deletes propagate to other devices.

## Indexing

- `memberships(user_id)` — every listing starts from the user's workspaces.
- `folders(workspace_id, parent_id)`.
- `lists(workspace_id, updated_at desc)`.
- `list_items(list_id, position)`.
- `notes(workspace_id, updated_at desc)` plus a GIN index on `tags` and a trigram index on
  `plain_text` for global search.
- `sync_operations(operation_id)` unique — the idempotency guarantee.

## Roles and authorisation

`memberships.role` uses the rank order `owner` > `editor` > `viewer`. The API compares ranks
before every read of shared content and before every write. A user who is not a member cannot
tell the difference between a resource that does not exist and one they may not see.

## Account deletion

Deletion cascades through the graph above. Attachments are removed from object storage first;
if that fails, the row is marked for a retry rather than leaving orphaned files behind silently.
