# ADR 0005 — Defer the ORM decision

**Status:** Accepted (provisional)

## Context

The API needs query building, transactions and migrations. The legacy project used Prisma
alongside raw SQL and both Supabase and MySQL abstractions, which is part of why its data layer
was hard to maintain.

At the start of the rebuild the current Prisma major versions were in transition (the CLI and
the client were on different majors), so committing to one immediately would have meant either
adopting a moving target or pinning to a version that stops receiving fixes.

## Decision

Start with a thin `pg` access layer (`apps/api/src/db/pool.ts`): a pool, a query helper, a
transaction helper and a health ping. Everything above it works with plain rows, so the driver
can be replaced behind that single module.

The ORM decision is scheduled for Phase 1, once the schema and the query patterns for
workspaces, sync and collaboration are known. Options to evaluate: Prisma, Drizzle, Kysely, or
staying on `pg` with a query builder.

## Consequences

**Good**

- No codegen step, no generated client committed, no version churn during the foundation.
- The API boots and is testable without a database.
- Swapping the driver later touches one module.

**Bad**

- Hand written SQL means no compile time guarantee that a query matches the schema. Mitigation:
  integration tests against a real PostgreSQL instance in CI, added in Phase 1.
- Migrations are not defined yet. Until they are, the schema lives in
  [../data-model.md](../data-model.md) and is applied by hand. This is the main reason this ADR
  is provisional: the first real migration must arrive with the ORM decision.
