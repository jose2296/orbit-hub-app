# API conventions

Base path: `/api/v1`. Content type: `application/json` (UTF-8). Maximum body: 1 MB.

## Envelopes

Success:

```json
{ "data": { "...": "..." }, "meta": { "requestId": "uuid" } }
```

Lists:

```json
{ "data": { "items": [], "nextCursor": null }, "meta": { "requestId": "uuid" } }
```

Error:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "The request payload is invalid",
    "fields": { "email": "Invalid email" },
    "requestId": "uuid"
  }
}
```

Every response carries an `X-Request-Id` header. Clients may send their own; the API echoes it
when it is a sane length and generates a UUID otherwise.

The mobile client unwraps the envelope in `apiRequest`, so screens and hooks only ever handle
`data`. A response that is not an envelope is passed through untouched, which keeps the client
usable against endpoints that answer with a bare payload.

Not every `2xx` goes through `sendData`. The ones that do not, as of this writing, are:

- **Bytes, not JSON.** `GET /account/export` and `GET /lists/:id/export` answer with a file, a
  `Content-Disposition: attachment` and `Cache-Control: no-store`, and they go through `sendFile`.
  `GET /attachments/file/:key` is the older one and the reason this list is not two long: it
  streams the stored object with an `inline` disposition rather than writing a body, because it
  serves a signed, short lived URL instead of a request from the app.
- **JSON without the envelope.** `PUT /attachments/upload/{*key}` answers a bare `{ ok: true }`
  written straight to the response. The body of that request *is* the file, so the client on the
  other end is a bucket upload rather than the app, and there is no `meta` to hand back.
- **No body at all.** Nine routes answer `204` with `res.end()` — the deletes and the
  leave/accept calls in `auth.ts`, `workspaces.ts`, `notes.ts` and `attachments.ts`. There is no
  envelope to send on a response that has no content, and `apiRequest` checks the status before it
  looks at the body, so it resolves those to `undefined` instead of failing on the empty text.

This is a snapshot, not a guarantee. A route that stops going through `sendData` has a reason worth
writing down here, and one that starts not going through it has one too: the reason it was allowed
to be an exception is the thing the next reader is missing.

Once `sendFile` has run the headers are on the wire, and `errorHandler` steps aside when
`res.headersSent` is true — so a failure after the body started writing cannot be turned into a
JSON error anymore. The streaming route carries the same hazard for the same reason: its headers
are set before the first chunk goes out.

## Error codes

| Code | Status | Meaning |
| --- | --- | --- |
| `bad_request` | 400 | Malformed request the schema cannot describe |
| `validation_failed` | 422 | Body or query failed validation (`fields` has details) |
| `unauthorized` | 401 | Missing, malformed or expired credentials |
| `forbidden` | 403 | Authenticated but not allowed (role check failed) |
| `not_found` | 404 | Unknown route or invisible resource |
| `conflict` | 409 | State conflict (duplicate email, version mismatch) |
| `rate_limited` | 429 | Too many requests; includes `Retry-After` |
| `not_implemented` | 501 | Endpoint is contracted but not built yet |
| `internal_error` | 500 | Unexpected failure; details are logged, not returned |

The client maps every one of these to a single `ApiError` type. Codes are stable; messages are
not, and are written for humans.

## Authentication

`Authorization: Bearer <access token>` on every protected route. Access tokens are short lived
(15 min by default); refresh tokens are rotated on use. See [auth.md](auth.md).

## Pagination

Cursor based, never offset:

```http
GET /api/v1/workspaces?limit=25&cursor=<opaque>
```

`limit` defaults to 25 and caps at 100. `nextCursor` is `null` on the last page. Cursors are
opaque: encode `(created_at, id)` and never expose the internal format as a contract.

## Idempotency

Write endpoints that create content accept an `Idempotency-Key` header. Sync operations carry
their own `operationId`, which is the idempotency key for `/sync/push`. Replaying the same key
returns the original result instead of creating a duplicate.

## Reads and writes

- **Reads are REST**: `GET /workspaces`, `GET /workspaces/:id/folders`, `GET /dashboard`.
- **Writes go through `/sync/push`**: creating or editing content is always a local write plus a
  queued operation, even when the device is online.

There is deliberately no `POST /workspaces` or `PATCH /workspaces/:id`. A second write path
would have to reimplement versioning, permissions and conflict handling, and the two would
drift. Auth is the exception: sessions are not content, so they use plain REST.

## Versioning and compatibility

- The path prefix is the major version. Breaking changes get `/api/v2`.
- Within a major version, new optional fields may be added; clients must ignore unknown fields.
- Removing or renaming a field, or changing its meaning, requires a new major version.
- Response schemas live in `packages/contracts`; the API parses its own output in tests.

## Authorisation

Authorisation is enforced per resource, never per route alone:

1. Resolve the session → `userId`.
2. Resolve the resource (workspace, folder, list, note).
3. Load the membership and compare the role rank (`owner` > `editor` > `viewer`).
4. Reject with `forbidden` before touching data.

Listing endpoints filter by the memberships the caller actually has, so a missing row and an
unauthorised row are indistinguishable (`not_found` in both cases).

## Rate limiting

Applied per IP for authentication endpoints (login, register, password reset) and per user for
writes. Limits are configurable through `AUTH_RATE_LIMIT_*` and returned as `Retry-After` when
exceeded.

The per-IP limit and the per-account limit are **not the same kind of thing**, and the difference
is what stops them from locking out the wrong person:

- **Per IP** (`AUTH_RATE_LIMIT_MAX`) is a flood guard. Every request is the thing being guarded
  against, so every request counts.
- **Per account** (`AUTH_ACCOUNT_RATE_LIMIT_MAX`) exists to stop somebody guessing one account's
  password, so it only charges a `4xx` other than `429`. A `2xx` is not an attempt, a `5xx` is the
  server's fault and says nothing about a password, and a `429` never reached the route. Counting
  successes as well — which it used to do — stops nobody, since a guesser never gets it right, and
  locks the account's own owner out after five ordinary logins under a `rate_limited` that reads
  like an attack in progress.

The charge happens **before** the route runs, so a flood of concurrent attempts is refused the same
way; what the response status decides is whether the unit is given back. Both paths arm that in one
place (`arm` in `middleware/rate-limit.ts`), because armed twice it is easy for one path to skip the
status check and turn the limit into `max + 1`.

The current limiter keeps its counters in process memory, which is correct for a single
instance. With more than one instance the effective limit becomes `max x instances`, so moving
it to a shared store (Redis or Postgres) is a deployment requirement, not an optimisation.
