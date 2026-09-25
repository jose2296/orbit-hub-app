# Architecture decision records

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-expo-router-universal-app.md) | One Expo app for Android, iOS and web | Accepted |
| [0002](0002-custom-auth-google-oidc.md) | Own auth, Google as external OIDC provider | Accepted |
| [0003](0003-local-first-sync.md) | Local-first writes with an outbox | Accepted |
| [0004](0004-external-postgresql.md) | External managed PostgreSQL | Accepted |
| [0005](0005-database-access.md) | Defer the ORM decision | Superseded by [0006](0006-drizzle-orm.md) |
| [0006](0006-drizzle-orm.md) | Drizzle ORM with a dual driver | Accepted |

## Format

Context, decision, consequences. When a decision changes, add a new ADR and mark the old one
as superseded. Do not rewrite history.
