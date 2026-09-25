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
| `lists` | `kind` = `tasks` \| `movies` \| `books`; one shape for all three |
| `list_items` | Position, completed, priority, tags, `external_id`, `metadata` jsonb |
| `notes` | `document` jsonb (portable editor format) plus denormalised `plain_text` for search |
| `attachments` | Storage key, never a public URL; size and mime type validated server side |
| `invitations` | Token, role, expiry, status; single use |

`list_items.external_id` points at the provider record (TheMovieDB, Google Books) and
`metadata` keeps the raw provider payload, so a list renders offline without calling the
provider again.

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
