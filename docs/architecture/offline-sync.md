# Offline and sync

## Goal

Every write succeeds with no connectivity. The network only decides *when* a change reaches the
server, never *whether* it is accepted by the user.

## Local store

`apps/mobile/src/lib/offline/local-store.ts` exposes one interface with two implementations:

| Platform | Driver | Stores |
| --- | --- | --- |
| iOS / Android | `expo-sqlite` (WAL mode) | `sync_outbox`, `sync_conflicts` |
| Web | Web Storage | same data, JSON encoded |

The tables hold pending operations and unresolved conflicts. Entity caches are added with the
workspaces feature; the same driver will serve them.

## Write path

```text
1. Validate the change against the shared schema.
2. Write to the local database (optimistic, immediate).
3. Insert an operation into the outbox with a client generated operationId.
4. Update the UI. The user is already done.
5. When online, flush the outbox in batches of 50.
```

Every operation carries:

| Field | Purpose |
| --- | --- |
| `operationId` | Idempotency key. Replaying is safe. |
| `clientId` | Stable per device, so the server can attribute changes. |
| `baseVersion` | The version the client last saw; the basis for conflict detection. |
| `clientTimestamp` | Ordering hint and debugging aid. Never trusted for conflict resolution. |

## Pull path

`POST /sync/pull` with an opaque cursor returns changed records since the cursor, including
tombstones (`deletedAt` set) so a delete on another device propagates. Records carry a
monotonic `version`; the client applies anything with a higher version than the local copy.

## Conflict strategy (hybrid)

Decided per field, not per record:

1. **No conflict** when the client's `baseVersion` equals the current server version: apply.
2. **Field level merge** when the fields touched by the client were not touched by the other
   writer: apply the client's values and keep the server's for the rest.
3. **Same field, different value**: the server stores a `SyncConflict` with both versions and
   returns `status: "conflict"`. The client removes the operation from the outbox and shows the
   conflict in the sync centre.
4. **Delete versus edit**: the delete wins, the edit is preserved inside the conflict record so
   the user can restore it deliberately.
5. **Never** last-write-wins on the whole record. Silent overwrites are the failure mode this
   design exists to prevent.

Conflicts are resolved explicitly (`keep_server`, `keep_client`, `merge`), which produces a new
version and a normal audit entry.

## Retry and backoff

- Transient failures (`network`, `timeout`, `rate_limited`) increment `attempts` and retry with
  exponential backoff plus jitter, capped by `SYNC_DEFAULTS.maxAttempts` (8).
- A `rejected` result is a permanent failure for that operation: it is recorded with the reason
  and dropped from the outbox so it cannot block the queue forever.
- The outbox is flushed on app start, on reconnect, on foreground, and every
  `SYNC_DEFAULTS.intervalMs` (30 s) while online.
- Operations are sent oldest first, so the server replays them in the order the user made them.

## Sync state machine

```text
        ┌──────── offline ────────┐
        ▼                         │
idle → syncing → idle      syncing → error → (retry) → syncing
  │        │                                  │
  │        └── conflicts > 0 ──► blocked      └── backoff
  └── pending > 0 ───────────► syncing
```

The same state is exposed to the UI through `useSyncStatus()`, which reads counts from the
local store so the indicator is correct with no connectivity.

## Guarantees

| Guarantee | Mechanism |
| --- | --- |
| No lost writes | Local write happens before any network call |
| No duplicates | `operationId` idempotency |
| No silent overwrites | `baseVersion` check plus explicit conflicts |
| Deletes propagate | Tombstones in the pull stream |
| Offline is a first-class state | `offline` is a normal sync state, not an error |
| Queue cannot wedge | Permanent rejections leave the queue with a recorded reason |

## Known limits

- Background sync while the app is closed is not guaranteed on iOS. The queue is flushed on
  the next foreground; a web service worker with Background Sync is an option for the PWA.
- A very large outbox (thousands of operations) is not optimised yet. Batching plus coalescing
  per entity is the planned improvement.
- Media attachments are not part of the outbox yet: uploads resume from a separate queue
  (Phase 4).
