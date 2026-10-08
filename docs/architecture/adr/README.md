# Architecture decision records

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-expo-router-universal-app.md) | One Expo app for Android, iOS and web | Accepted |
| [0002](0002-custom-auth-google-oidc.md) | Own auth, Google as external OIDC provider | Accepted |
| [0003](0003-local-first-sync.md) | Local-first writes with an outbox | Accepted |
| [0004](0004-external-postgresql.md) | External managed PostgreSQL | Accepted |
| [0005](0005-database-access.md) | Defer the ORM decision | Superseded by [0006](0006-drizzle-orm.md) |
| [0006](0006-drizzle-orm.md) | Drizzle ORM with a dual driver | Accepted |
| [0007](0007-notes-editor.md) | Two note editors over one document format | Superseded by [0009](0009-one-native-editor.md) |
| [0008](0008-note-entity.md) | A note is an entity, a list row has an annotation | Accepted |
| [0009](0009-one-native-editor.md) | One native note editor everywhere, HTML as the format | Accepted |
| [0031](0031-compartir.md) | Compartir: un vinculo, y el sitio lo elige quien lo recibe | Accepted |
| [0032](0032-personas.md) | Personas: un directorio de con quien ya has tratado | Accepted |
| [0033](0033-diario.md) | Diario: una nota por día, de la cuenta y no de un espacio | Proposed |
| [0034](0034-mencion-en-notas.md) | Mención: un elemento de la app dentro de una nota, como chip | Proposed |

## Format

Context, decision, consequences. When a decision changes, add a new ADR and mark the old one
as superseded. Do not rewrite history.
