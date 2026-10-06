# Product scope

OrbitHub is a universal app to organise workspaces, task lists, movies/series, books and notes,
with offline-first sync and collaboration. One codebase, three targets: Android, iOS and Web.

## In the MVP

| Area | Scope |
| --- | --- |
| Auth | Email + password, Google OAuth, email verification, password reset, device session management, account deletion, data export |
| Organisation | Workspaces, nested folders, customisable dashboard |
| Content | Task lists, boards with configurable states, movie/series lists, book lists, notes with attachments |
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

### Out of scope for boards

A board is a task list whose columns are states the person using it configures. What follows was
ruled out when the board's scope was set, and each item was considered and rejected rather than
left behind.

- **WIP limits.** A board counts what each column holds and shows the number. It does not
  refuse a move that would take a column over a limit, because "wip" is the name of a state
  and not a rule the app enforces.
- **Dragging a card from one column to another.** The horizontal swipe is taken, and it only
  pages. Moving a task is the state sheet: two taps instead of one.
- **Table and calendar views of a board.** A table is the list screen with another header,
  and a calendar is Phase 8.
- **Automations on entering a state.** Nothing in a board runs by itself.
- **Column block rules.** A state is a name, a colour and an order. It has no behaviour.
- **State change history.** Nothing records that a task changed column; a task has a current
  state and no log of how it got there.
- **States shared between boards.** Every board's columns are its own.
- **More than one template.** One starting set (Backlog, Ready, WIP, Done) minted when the
  board is created; the columns are edited by hand from there.
- **Archiving states.** A column is renamed or deleted.

## Non-negotiable principles

1. **Local-first.** A write must succeed with no connectivity. The network is an optimisation.
2. **One codebase per UI.** Anything that only works on one platform needs a written reason.
3. **Server-side authorisation.** The client is never a security boundary.
4. **No silent data loss.** Deletes are soft, conflicts are surfaced, writes are idempotent.
5. **Design tokens, not hardcoded values.** One visual source of truth across platforms.
