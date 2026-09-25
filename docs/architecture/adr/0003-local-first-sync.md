# ADR 0003 — Local-first writes with an outbox

**Status:** Accepted

## Context

Offline support is a high priority requirement, and in the legacy app "offline" mostly meant
"the request failed and the user lost the change". The requirement is to review data offline
and to have changes made offline applied later, without duplicates or silent overwrites.

## Decision

Every write is applied to a local database first and enqueued as an operation. Operations are
pushed to the server in batches with an idempotency key (`operationId`) and the version the
client last saw (`baseVersion`). Conflicts are detected per field, auto-merged when unambiguous
and surfaced to the user when not.

See [../offline-sync.md](../offline-sync.md).

## Consequences

**Good**

- The UI never waits for the network; interactions stay instant on slow connections.
- Retries are safe: replaying an operation cannot duplicate data.
- Deletes propagate through tombstones instead of vanishing on other devices.
- The same interface (`LocalStore`) serves SQLite on native and Web Storage on web.

**Bad**

- Two implementations of local persistence must behave identically; they are covered by the
  same contract, not by shared code.
- Storage is finite. The app must show pending counts and prune cached entities, which is a
  product concern, not just an engineering one.
- Conflict resolution UI is unavoidable. It is designed as a first-class screen (the sync
  centre) instead of a hidden dialog.
- Background sync while the app is closed is not guaranteed on iOS; the queue flushes on the
  next foreground.
