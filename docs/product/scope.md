# Product scope

OrbitHub is a universal app to organise workspaces, task lists, movies/series, books and notes,
with offline-first sync and collaboration. One codebase, three targets: Android, iOS and Web.

## In the MVP

| Area | Scope |
| --- | --- |
| Auth | Email + password, Google OAuth, email verification, password reset, device session management, account deletion, data export |
| Organisation | Workspaces, nested folders, customisable dashboard |
| Content | Task lists, movie/series lists, book lists, notes with attachments |
| Discovery | Global search, filters, sorting, tags, favourites, priorities |
| Collaboration | Invitations, roles (owner/editor/viewer), realtime updates |
| Platform | Push notifications, deep links, universal links, installable PWA |
| Offline | Local database, queued writes, background sync, hybrid conflict resolution |
| Experience | Spanish and English, light/dark themes, configurable accent colour |
| Reuse | Templates, duplicate content, quick actions |

## Later phases

- Full calendar (recurrence, reminders, time zones, ICS import/export).
- Comments and activity history.
- Rich data export/import (JSON, CSV).
- Accessibility hardening and full keyboard support on web.
- Voice input and transcription.
- Migration of data from the legacy applications.

## Explicitly out of scope

- **AI features.** The legacy prototype is removed and nothing replaces it.
- **A separate web application.** Web is the same Expo app rendered with React Native Web.
- **Legacy data compatibility.** New database, new users, new IDs. No dual-write, no backfill.
- **Being an OAuth/OIDC identity provider.** OrbitHub consumes Google as an external provider.

## Non-negotiable principles

1. **Local-first.** A write must succeed with no connectivity. The network is an optimisation.
2. **One codebase per UI.** Anything that only works on one platform needs a written reason.
3. **Server-side authorisation.** The client is never a security boundary.
4. **No silent data loss.** Deletes are soft, conflicts are surfaced, writes are idempotent.
5. **Design tokens, not hardcoded values.** One visual source of truth across platforms.
