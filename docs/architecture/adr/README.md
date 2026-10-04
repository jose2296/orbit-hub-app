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
| [0033](0033-regresion-e2e-android.md) | Regresion E2E en Android con Maestro, y el guardian de crasheo alrededor | Accepted |
| [0034](0034-back-de-android.md) | La tecla de atras de Android se queda con el comportamiento antiguo | Accepted |
| [0035](0035-dev-server-del-arnes.md) | El arnes le dice a la app de donde es su Metro, y deja de pedir el 8081 | Accepted |

## Format

Context, decision, consequences. When a decision changes, add a new ADR and mark the old one
as superseded. Do not rewrite history.
