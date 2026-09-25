# ADR 0001 — One Expo app for Android, iOS and web

**Status:** Accepted

## Context

OrbitHub has to ship on Android, iOS and the web from a single team and a single feature set.
The legacy project had a React Native app plus a separate, already outdated web frontend that
no longer matched the API contract. Two frontends meant duplicated business logic, divergent
UI and two sources of truth.

## Decision

Use Expo (SDK 57) with Expo Router and React Native Web. There is exactly one application;
`apps/mobile` renders on all three targets. The web build is a static export served from a CDN,
installed as a PWA.

Routes are files under `src/app`. Business logic lives in `src/lib`, shared UI in
`src/components`, tokens in `src/theme`.

## Consequences

**Good**

- One feature ships everywhere at once; no "web is behind again".
- One design system, one i18n catalogue, one navigation model.
- Deep links and universal links come from the same route tree on every platform.
- Offline-first works the same way on mobile and web because the same store interface is used.

**Bad**

- A dependency that breaks on one platform blocks the release for all three. Mitigation:
  `expo-doctor` and `expo install --check` in CI, and no unverified platform-specific libraries.
- React Native Web is not a browser-first UI: no CSS modules, no pseudo selectors. Rich text
  editing is the main place this hurts, which is why notes get a dedicated web editor.
- Web push, background sync and storage quotas behave differently per browser. The app must
  degrade gracefully and say so in the UI.

**Rejected**

- Next.js or any separate web frontend: rejected, it recreates the two-frontend problem.
- Bare React Native with manual native projects: rejected, it slows delivery without changing
  the product surface.
