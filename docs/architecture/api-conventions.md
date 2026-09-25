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
writes. Limits are configurable and returned as `Retry-After` when exceeded. This is part of
Phase 1 and must be in place before the API is exposed publicly.
