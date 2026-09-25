# Roadmap

Phases are ordered by dependency, not by importance. Each phase ends with something usable.

Legend: ✅ done · 🟡 in progress · ⬜ not started

## Phase 0 — Foundation ✅

- Monorepo: `apps/mobile`, `apps/api`, `packages/contracts`, `packages/config`
- Expo SDK 57 + Expo Router + React Native Web, static export, PWA manifest
- Design system: tokens, theme provider (light/dark + accent), component kit
- App shell: onboarding, sign in, sign up, forgot password, tabs, settings, sync centre
- i18n: es/en with persisted preference
- Auth client skeleton: token storage, single-flight refresh, Google PKCE flow (disabled until
  the OAuth client exists)
- Offline: local store (SQLite / Web Storage), outbox, conflict table, sync state hook
- API: Express 5, validated environment, error envelope, request id, security headers, health
  endpoint, tests
- CI: typecheck, tests, Expo config check, expo-doctor

## Phase 1 — Auth and data 🟡

- [ ] PostgreSQL schema and first migration (see [ADR 0005](architecture/adr/0005-database-access.md))
- [ ] ORM / query layer decision
- [ ] `POST /auth/register`, `/login`, `/refresh`, `/logout`
- [ ] Email verification, password reset, resend verification
- [ ] Google code exchange and safe account linking
- [ ] Session rotation with replay detection, device list and revocation
- [ ] Rate limiting on `/auth/*`, audit log
- [ ] Email delivery provider
- [ ] Integration tests against a real database

**Exit criteria:** a user can register, verify, sign in on two devices, see both devices in
settings, revoke one, and sign out everywhere.

## Phase 2 — Organisation

- [ ] Workspaces CRUD, membership, first workspace on signup
- [ ] Nested folders, move and reorder
- [ ] Dashboard layout persistence
- [ ] Local cache tables for workspaces, folders and memberships
- [ ] `POST /sync/push` and `/sync/pull` for these entities

**Exit criteria:** create, rename, move and delete a workspace and a folder from two devices,
online and offline, with no duplicates and no silent overwrites.

## Phase 3 — Lists and search

- [ ] Lists (tasks, movies, books) and items
- [ ] Positions, completion, priorities, tags, favourites
- [ ] Global search across entities
- [ ] Templates, duplicate, quick actions
- [ ] Provider integrations behind the API (TheMovieDB, Google Books) with no client keys

**Exit criteria:** a list created offline on a plane appears once, in order, on another device
after landing.

## Phase 4 — Notes and attachments

- [ ] Portable document schema and validator
- [ ] Web rich editor
- [ ] Native editor
- [ ] Autosave with version guard
- [ ] Attachments: local write, queued upload, authorised download
- [ ] Search over `plain_text`

## Phase 5 — Collaboration and realtime

- [ ] Invitations by email and link, accept, decline, revoke
- [ ] Roles enforced on every resource read and write
- [ ] Realtime channel per workspace, scoped by role
- [ ] Ownership transfer, leave workspace
- [ ] Comments and activity history (phase 2 of the product scope)

## Phase 6 — Offline hardening

- [ ] Entity cache with eviction policy
- [ ] Sync on foreground, reconnect and interval
- [ ] Backoff, retry budget, permanent rejection handling
- [ ] Sync centre: conflicts, resolution, per-field merge
- [ ] Storage quota handling and "clear cache"

## Phase 7 — Planner, notifications, links, PWA

- [ ] Planner redesign: templates, copy week, undo, mobile and web layouts
- [ ] Push notifications, preferences per type, quiet hours, daily digest
- [ ] Deep links and universal links (AASA, Asset Links), one canonical route scheme
- [ ] PWA: install prompt, offline shell, web push where supported

## Phase 8 — Later scope

- [ ] Calendar: recurrence, reminders, time zones, ICS import/export
- [ ] Export and import of user data
- [ ] Accessibility and full keyboard support on web
- [ ] Voice input
- [ ] Migration tooling for the legacy data (see [migration/legacy-migration.md](migration/legacy-migration.md))

## Cross-cutting

- [ ] Rate limiting and abuse protection on all write endpoints
- [ ] Structured logs with request ids, error tracking, uptime checks
- [ ] EAS build profiles, store metadata, signing
- [ ] CI: integration tests, EAS preview builds
- [ ] Privacy policy and terms pages, cookie/consent handling for the web target
