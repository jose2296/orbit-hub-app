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
| `list_items` | Position, completed, priority, tags, `external_id`, `metadata` jsonb, `annotation` |
| `notes` | `document` jsonb (portable editor format) plus denormalised `plain_text` for search |
| `attachments` | Storage key, never a public URL; size and mime type validated server side |
| `invitations` | Token, role, expiry, status; single use |

`list_items.external_id` points at the provider record (TheMovieDB, Google Books) and
`metadata` keeps the raw provider payload, so a list renders offline without calling the
provider again.

`list_items.annotation` is a short plain-text remark on a row, and is not a note. It was called
`notes` until [ADR 0008](adr/0008-note-entity.md), which settled that a note is an entity of its
own: the name collision had led to a comment claiming notes had no table of their own, which
Phase 4 makes false, because a note is a document and does not fit in a `varchar(2000)`.

## Habitos

Dos tablas, personales: cuelgan de `users`, no de `workspaces`. Un habito no es
de un equipo y nunca se comparte, asi que meterlo en un espacio obligaria a
decidir que pasa con el cuando alguien sale del espacio y a mantener permisos
para algo que nadie comparte. Ver [ADR 0034](adr/0034-horario-en-union-y-disciplina-dura.md).

| Tabla | Notas |
| --- | --- |
| `habits` | `user_id` con cascade a `users`; `schedule` jsonb (la union `rrule\|quota`); `timezone` IANA congelada al crear; `week_start` 0 lunes (ISO, defecto) o 1 domingo, en el habito y no en el usuario; `start_date` y `end_date` como `date`; `target_value` entero nullable (null = binario); `position`; `archived_at` en vez de borrado con historia |
| `habit_entries` | `habit_id` con cascade; `date` como `date`, nunca instante; `status` `done\|skipped` (el fallo lo calcula el motor, no se registra a mano); `amount` y `note` para la meta y la nota corta |

`date` es `date` y no `timestamptz` porque "el lunes" es un dia local de
calendario: con un instante, viajar de zona cambiaria lo que fue ese dia. La
fecha plana viaja con la persona, y no se puede corregir despues sin migrar.

`UNIQUE (habit_id, date)` ES la regla "un dia cuenta una sola vez", a nivel de
datos y no de interfaz: remarcar es un upsert que reescribe, nunca un segundo
insert. Y revive: remarcar un dia borrado lo trae de vuelta con `deleted_at` a
null.

La zona se congela al crear y `PATCH` no la acepta: el historico es un hecho y
no se reinterpreta si la persona muda de pais. Por la misma razon `start_date`
tampoco viaja en un update.

`archived_at` y no borrado: la racha de un habito que ya no se usa se sigue
pudiendo leer. Borrar el habito con su historia seria perder datos que la
persona todavia quiere ver.

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
