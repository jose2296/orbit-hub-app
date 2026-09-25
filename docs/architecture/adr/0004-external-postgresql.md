# ADR 0004 — External managed PostgreSQL

**Status:** Accepted

## Context

The product is relational (workspaces, memberships, hierarchical folders, ordered items,
membership roles) and needs transactions, foreign keys and cursor friendly indexing. The legacy
setup mixed MySQL, Supabase and ad hoc SQL, which made the data model hard to reason about.

## Decision

Use an externally managed PostgreSQL instance. The application connects with a standard
connection string; the API owns the schema and the migrations.

## Consequences

**Good**

- One well understood database with real constraints, transactions and JSONB for provider
  payloads and editor documents.
- The provider can be swapped (managed service, container, cloud) without touching the app.
- Backups, replicas and point-in-time recovery are provider features, not our code.

**Bad**

- JSONB columns (`document`, `metadata`, `payload`) trade referential integrity for flexibility.
  The application layer must validate them, which the contracts already do.
- Cursor pagination needs a stable, indexed ordering column (`updated_at`, `id`).
- Soft deletes mean every unique constraint must account for `deleted_at` to allow a name to be
  reused after deletion.
