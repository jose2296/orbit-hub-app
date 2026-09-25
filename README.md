# OrbitHub

Universal application to organise workspaces, task lists, movies/series, books and notes, with
offline-first sync and collaboration. One codebase, three targets: **Android**, **iOS** and **Web**.

## Stack

| Layer      | Choice                                                        |
| ---------- | ------------------------------------------------------------- |
| App        | Expo SDK 57, Expo Router, React Native Web, TypeScript         |
| State/UI   | React context + token based design system (no styling library) |
| Local data | SQLite on native, Web Storage on web, behind one repository     |
| API        | Node.js, Express 5, Zod, Pino, PostgreSQL (`pg`)               |
| Contracts  | `@orbit-hub/contracts` — Zod schemas shared by app and API      |
| Config     | `@orbit-hub/config` — app metadata, feature flags               |

## Repository layout

```text
orbit-hub/
├── apps/
│   ├── api/            # Express API (REST, /api/v1)
│   └── mobile/         # Expo app (src/app = routes, src/components, src/lib)
├── packages/
│   ├── config/         # Shared, non-secret app configuration
│   └── contracts/      # Zod schemas + inferred types for the API boundary
├── docs/               # Architecture, product scope, ADRs, roadmap
├── scripts/            # Repository tooling (brand asset generation)
└── .github/workflows/  # CI
```

## Requirements

- Node.js `>= 22.18` (see `.nvmrc`)
- npm `>= 10`
- For iOS: macOS + Xcode + simulator
- For Android: Android Studio + emulator
- Everything runs on the web with no native tooling

## Getting started

```bash
npm install                # installs workspaces and builds shared packages
cp .env.example .env       # optional: local defaults for app + API

npm run web                # Expo web (React Native Web)
npm run ios                # iOS simulator
npm run android            # Android emulator
npm run api                # API on http://localhost:4000
```

## Quality gates

```bash
npm run typecheck          # tsc for every workspace
npm run test               # vitest: API integration tests + app client tests
npm run config:check       # expo config validation
npm run doctor             # expo-doctor
npm run check              # typecheck + test + config:check
```

The API test suite runs against a real Postgres (PGlite, in process) with the committed
migrations applied. There are no database mocks, so a broken query fails the build.

## Running the API without a database

With no `DATABASE_URL`, development falls back to an embedded Postgres stored in
`apps/api/.data/pglite`. `npm run api` applies the migrations on boot and is ready to use.
Delete that directory to start from an empty database.

```bash
npm run api                                     # start on :4000
npm run db:migrate -w @orbit-hub/api            # apply migrations only
npm run db:generate -w @orbit-hub/api           # generate SQL after changing the schema
```

## Environment variables

Mobile (public, inlined at build time):

| Variable                       | Purpose                                    |
| ------------------------------ | ------------------------------------------ |
| `EXPO_PUBLIC_API_URL`          | Base URL of the API, e.g. `http://localhost:4000/api/v1` |
| `EXPO_PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth web client id (added later)   |

API (secret, `apps/api/.env`): `DATABASE_URL`, `CORS_ORIGINS`, `JWT_SECRET`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `EMAIL_FROM`, token TTLs, `LOG_LEVEL`.

Secrets are never committed; see [`.env.example`](.env.example) and
[`docs/security/secrets.md`](docs/security/secrets.md).

## Documentation

Start at [`docs/README.md`](docs/README.md):

- [Product scope](docs/product/scope.md)
- [Architecture overview](docs/architecture/overview.md)
- [API conventions](docs/architecture/api-conventions.md)
- [Auth design](docs/architecture/auth.md)
- [Offline & sync](docs/architecture/offline-sync.md)
- [Data model](docs/architecture/data-model.md)
- [Design system](docs/architecture/design-system.md)
- [Notes editor](docs/architecture/notes-editor.md)
- [Roadmap](docs/roadmap.md)
- [Pending from the owner](docs/pending-from-owner.md) — credentials and decisions still needed
- [Legacy migration (future work)](docs/migration/legacy-migration.md)
- [Security & secrets](docs/security/secrets.md)

## Status

Phase 0 done: monorepo, design system, app shell (onboarding, auth screens, tabs, sync centre),
local outbox, API skeleton with health checks, CI and documentation.

Phase 1 done: real auth end to end. Registration with email verification, password login,
Google code exchange with safe account linking, refresh rotation with replay detection, device
management and revocation, password reset, account deletion, audit log, rate limiting, and a
Postgres schema with committed migrations. 45 tests, no database mocks.

Next is Phase 2 (workspaces, folders, dashboard) per the [roadmap](docs/roadmap.md).
