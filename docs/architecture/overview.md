# Architecture overview

## Shape of the repository

```text
orbit-hub/
├── apps/
│   ├── mobile/            Expo app: src/app (routes), src/components, src/lib, src/theme
│   └── api/               Express API: src/routes, src/middleware, src/db, src/lib
├── packages/
│   ├── contracts/         Zod schemas + inferred types for every network boundary
│   └── config/            Shared, non-secret configuration and feature flags
├── docs/                  This documentation
└── scripts/               Repository tooling
```

`packages/ui` deliberately does not exist yet: with a single UI consumer, a shared package
would add build indirection without removing duplication. It will be extracted when a second
consumer (for example a marketing site or an extension) appears.

## Layers

```text
┌──────────────────────────────────────────────┐
│ Routes (src/app)        file based, no logic  │
├──────────────────────────────────────────────┤
│ Components              design system + views │
├──────────────────────────────────────────────┤
│ Hooks / context         session, sync, theme │
├──────────────────────────────────────────────┤
│ lib/api                 fetch wrapper        │
│ lib/auth                tokens, refresh, Google│
│ lib/offline             outbox, conflicts    │
│ lib/i18n                es/en dictionaries   │
├──────────────────────────────────────────────┤
│ @orbit-hub/contracts    request/response types│
└──────────────────────────────────────────────┘
              │ HTTPS (JSON)
┌──────────────────────────────────────────────┐
│ API: routes → middleware → repositories      │
│ PostgreSQL (external)                        │
└──────────────────────────────────────────────┘
```

Rules that keep this honest:

- Routes only compose components and hooks. No `fetch`, no business rules.
- Components never import from `lib/api` directly except through hooks.
- Everything that crosses the network is declared in `packages/contracts`.
- The API validates every payload with the same schema the client used to build it.

## Request lifecycle

```text
Screen → hook → lib/api (adds bearer token, timeout, retry) → fetch
                                   ↓ 401
                          lib/auth single-flight refresh → retry once
```

- One refresh at a time: concurrent 401s share the same refresh promise.
- Requests read the token from the auth module, never from a captured closure.
- Failures are always `ApiError` with a `kind`, so screens branch on types, not strings.

## Write lifecycle (offline-first)

```text
User action → local database write → outbox insert → UI updates
                                                       ↓ (online)
                                             POST /sync/push (idempotent)
                                                       ↓
                                        applied | duplicate | conflict
```

See [offline-sync.md](offline-sync.md) for the conflict strategy.

## Platform strategy

| Concern | Android / iOS | Web |
| --- | --- | --- |
| UI | React Native | React Native Web |
| Local database | `expo-sqlite` (WAL) | Web Storage (JSON) behind the same interface |
| Tokens | Keychain / Keystore via `expo-secure-store` | Web Storage |
| Navigation | Expo Router (native stack + tabs) | Expo Router (static export) |
| Push | FCM / APNs (Phase 6) | Web Push where supported (Phase 7) |
| Offline | Local DB + outbox | Local Storage + outbox |

The `LocalStore` interface in `src/lib/offline/local-store.ts` is the seam between them.

## Deployment shape

- `apps/mobile` ships through EAS (iOS, Android) and as a static export for the web.
- `apps/api` runs as a Node service (`node dist/server.js`) behind a reverse proxy.
- PostgreSQL is external and managed; the API only needs the connection string.
- Secrets come from the environment. See [../security/secrets.md](../security/secrets.md).
