# ADR 0006 — Drizzle ORM with a dual driver

**Status:** Accepted (supersedes [0005](0005-database-access.md))

## Context

ADR 0005 deferred the ORM decision until the first real schema and query patterns existed.
Phase 1 needs: users, identities, sessions, single-use email tokens, an audit trail,
transactions, and migrations that deployments can run without a CLI.

## Decision

Use **Drizzle ORM** (`drizzle-orm` + `drizzle-kit`) with two drivers behind one interface:

- `node-postgres` when `DATABASE_URL` is set: the production and staging path.
- **PGlite** (Postgres compiled to WebAssembly) when `PGLITE_DATA_DIR` is set: local
  development with no external service, and integration tests in CI.

Migrations are generated SQL, committed to the repository, and applied by
`npm run db:migrate` (or on boot). Nothing in production depends on `drizzle-kit`.

## Why Drizzle

- Type-safe schema and queries that stay SQL-shaped: no hidden query builder surprises when a
  query has to be explained or tuned.
- No code generation for the client, so nothing generated is committed and the build stays
  `tsc` plus one bundle step.
- First-class PostgreSQL support: `jsonb`, partial and composite indexes, `timestamptz`.
- Migrations are plain SQL files, reviewable in a pull request.
- The PGlite driver is first class, so tests run against real Postgres semantics in-process
  with no container and no network.

## Rejected

- **Prisma.** Its CLI and client majors were mid-transition when the decision was taken, and the
  generated client adds a build artefact to every change. Revisit if type-safe relation
  queries become a bottleneck.
- **Kysely.** Excellent query builder, but schema and migrations are not first class; we would
  hand-write more SQL than with Drizzle.
- **Staying on raw `pg`.** Rejected now that the schema is real: hand-written SQL gives no
  compile-time link between code and tables.

## Consequences

- One application type (`Database`) for both drivers; the PGlite instance is cast to it because
  both expose the same query surface. If a driver ever diverges, the cast is the place to look.
- Integration tests are real database tests, so they catch SQL errors that mocks never would.
- `drizzle-kit` is a dev dependency only.
- The embedded development database lives in `.data/pglite` and is git ignored.
