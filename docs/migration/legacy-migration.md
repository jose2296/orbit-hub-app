# Legacy data migration (future work)

**Status:** Not started, by decision. OrbitHub launches with an empty database and no legacy
data. This document exists so the eventual migration is designed, not improvised.

## Scope of the legacy systems

Two read-only references, never modified:

| Repository | What it holds |
| --- | --- |
| `../utility-app-native` | The React Native app: screens, hooks, planner, notes editor, local state |
| `../utility-app-turbo` | The API: routes, repositories, Prisma/PostgreSQL schema, jobs, realtime |

They disagree with each other in places (route names, response shapes, planner endpoints), so
the API is the authority for data and the app is the authority for intent.

## What would be migrated

| Legacy | OrbitHub target | Notes |
| --- | --- | --- |
| Users | `users` + `auth_identities` | Password hashes cannot be carried over: OrbitHub uses Argon2id. Users must reset their password or sign in with Google and link the account. |
| Workspaces | `workspaces` + `memberships` | Roles map 1:1 to owner/editor/viewer |
| Folders | `folders` | The legacy hierarchy must be validated for cycles first |
| Lists and items | `lists` + `list_items` | One shape for the three kinds; provider ids map to `external_id` |
| Notes | `notes` | The legacy DOM-only document must be converted to the portable format |
| Planner | Phase 2 model | The legacy planner shape is not a good fit and will be re-derived |
| Collaborations | `memberships` + `invitations` | Pending invites become fresh invitations |

Explicitly **not** migrated: AI experiment data, sessions and refresh tokens, cached provider
payloads beyond what is still current, and any secret or key material from the legacy
repositories.

## Why not now

- The new schema is not final; migrating twice wastes effort and risks silent corruption.
- Legacy password hashes and identity links cannot be trusted to transfer safely.
- Sessions cannot cross systems: everyone re-authenticates.

## Plan when it happens

1. **Inventory.** Read-only export script that produces a JSON snapshot plus a report of
   anomalies (orphan rows, cycles, duplicate emails, records the API and the app disagree on).
2. **Transform.** A pure, versioned transform from the legacy shape to the OrbitHub shape, with
   unit tests over the snapshot.
3. **Dry run.** Import into a staging database, validate counts and invariants, produce a diff
   report a human reads.
4. **Cutover.** Import into production during a maintenance window, keep the legacy systems
   read-only for a defined period.
5. **Rollback.** The import is idempotent and reversible: new rows are tagged with the migration
   batch id so a rollback deletes exactly what the batch created.

## Rules

- The legacy repositories stay untouched and uncommitted to. The migration reads them.
- No secret, key or credential from the legacy repositories enters this repository, the database
  or the client bundle. See [../security/secrets.md](../security/secrets.md).
- The migration is written only when the target schema is stable, and it ships behind a flag.
