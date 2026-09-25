# Auth design

**Estado:** implementado en `apps/api/src/modules/auth/` y verificado con tests de integración
(ver `apps/api/test/auth.test.ts`).

## Decision

OrbitHub owns its authentication. Google is an external identity provider consumed through
OAuth 2.0 / OIDC. OrbitHub is **not** an OIDC issuer for third parties.

See [adr/0002-custom-auth-google-oidc.md](adr/0002-custom-auth-google-oidc.md).

## Flows

```text
Email + password          Google
      │                      │
      ▼                      ▼
POST /auth/login        app opens the consent screen (PKCE)
POST /auth/register           │  code
      │                      ▼
      │                 POST /auth/google  ──► API exchanges the code
      │                      │                with the client secret
      ▼                      ▼
        { access_token, refresh_token, user, device }
```

- Access token: JWT, 15 minutes, signed by the API, contains `sub`, `sid`, `role` claims.
- Refresh token: opaque, 30 days, stored **hashed** server side, rotated on every use.
- Rotation is single use: presenting a refresh token twice revokes the whole family
  (replay detection).
- Every authenticated request resolves a `device`, which is what the user sees in
  *Settings → Devices* and what *Sign out everywhere* revokes.

## Registration and verification

1. `POST /auth/register` creates the user with `emailVerified = false` and returns
   `status: "email_verification_required"`. No session is issued.
2. The API sends a verification email with a single-use token (hashed at rest, 24 h expiry).
3. `POST /auth/verify-email` activates the account and issues the first session.
4. Login with an unverified email returns the same "verification required" state, never a
   session and never a hint about whether the address exists.

Login, register and password reset respond identically for unknown and known emails, so the
API cannot be used to enumerate accounts.

## Passwords

- Hashing: Argon2id (memory-hard), unique salt per user, parameters stored with the hash.
- Minimum 10 characters, maximum 200. No composition rules: length beats punctuation.
- Passwords are never logged; the logger redacts `password`, `*.password`, tokens and
  `Authorization` headers.
- Breached-password checks run on register and password change.
- Changing a password revokes every refresh token except the current one.

## One Google client per platform

Google treats OAuth clients by device type, and getting this wrong produces a dead button with
a message that points at the app rather than the config:

| Platform | Client type | Secret | Redirect |
| --- | --- | --- | --- |
| Web | Web application | yes, held by the API | `https://<domain>/auth/google` |
| Android | Android | **none** | `orbithub://auth/google` |
| iOS | iOS | **none** | `orbithub://auth/google` |

Two rules follow, and both are enforced in `apps/api/src/modules/auth/google.ts`:

- **A web client id on an installed app is rejected by Google** with `invalid_request` and "does
  not comply with Google's OAuth 2.0 policy for keeping apps secure". Native builds need their
  own clients, created with the package name / bundle id `com.orbithub.app`.
- **A public client cannot keep a secret**, so its code can only be redeemed with the PKCE
  verifier. The app generates it, and sends it to the API, which performs the exchange. A native
  code arriving without a verifier is refused locally rather than sent to Google to fail.

The platform arrives in the request and only chooses between three clients the project owns. The
app never names a client id for the API to use, so a hostile client cannot redirect the exchange
somewhere else.

### The web callback is a real route

On web the consent screen opens in a popup and Google returns to the redirect URI. That page has
to exist as an app route (`src/app/auth/google.tsx`) and call
`WebBrowser.maybeCompleteAuthSession()`, otherwise the popup lands on the not found screen and the
sign-in promise never resolves: the button looks broken and nothing reports an error. The root
layout calls it too, as Expo requires, wrapped in a try because a reload during consent leaves
the opening window gone.

## Google account linking

Automatic linking is allowed **only** when all of these hold:

1. Google returns `email_verified = true`.
2. The normalised email matches an existing OrbitHub account exactly.
3. That account has no other Google identity linked yet.

Otherwise the API returns a `link_required` response and the app shows an explicit
"link your accounts" confirmation screen. Linking by email alone is an account takeover vector,
so it is never done silently.

Unlinking Google requires a password (or re-authentication with Google) and is blocked when it
would leave the account with no way to sign in.

## Session storage

| Platform | Access token | Refresh token |
| --- | --- | --- |
| iOS / Android | In memory | Keychain / Keystore (`expo-secure-store`, WHEN_UNLOCKED_THIS_DEVICE_ONLY) |
| Web | In memory | Web Storage |

The access token is never persisted. The refresh token is the only long lived credential, which
is why it is the only one written to storage. On web this is the strongest option a browser
offers; the trade-off is documented in the threat model and mitigated by short access token
lifetimes and server-side revocation.

## Token refresh

The client keeps one refresh promise in flight:

- Any 401 triggers `refresh()`; concurrent 401s await the same promise.
- On success the original request is retried **once**.
- On `unauthorized`/`forbidden` the session is cleared and the user returns to onboarding.
- On a network error the session is kept: a flaky connection must not sign the user out.

This is implemented in `apps/mobile/src/lib/auth/auth-client.ts` and wired into the network
layer through `configureApiClient`, so no screen ever handles tokens directly.

## Device management

`GET /auth/devices` lists the caller's sessions with label, platform, last seen and current
flag. `DELETE /auth/devices/:id` revokes one, `POST /auth/logout` with `allDevices: true`
revokes all. Revocation takes effect on the next access token expiry or immediately if the
session id is checked against a revocation list.

## Account deletion and export

- Export produces a machine readable archive of everything the account owns. It is a
  background job; the API returns a job id and the app polls it.
- Deletion requires re-authentication (password, or Google re-consent when the account has no
  password) and the literal confirmation `DELETE`.
- Deletion cascades: workspaces, memberships, content, attachments and sessions. A retention
  window applies to backups only, never to the live database.

## Security checklist before launch

Implemented and covered by tests:

- [x] Argon2id hashing with tuned parameters and a per-user salt
- [x] Email verification enforced before the first session
- [x] Rate limiting on `/auth/*` (per IP and per email)
- [x] Refresh token rotation with replay detection
- [x] Enumeration-safe responses on login, reset and resend
- [x] Audit log for sign-in, sign-out, token revocation, linking and deletion
- [x] Re-authentication for password change and account deletion

Still open before going live:

- [ ] A real email provider (the console transport only logs)
- [ ] Production `JWT_SECRET` and a managed `DATABASE_URL`
- [ ] Rate limiter backed by a shared store when running more than one instance
- [ ] Monitoring and alerts on the audit log

## Implementation map

| Concern | File |
| --- | --- |
| HTTP surface | `apps/api/src/routes/auth.ts` |
| Domain logic | `apps/api/src/modules/auth/auth-service.ts` |
| Data access | `apps/api/src/modules/auth/auth-repository.ts` |
| Row to contract mapping | `apps/api/src/modules/auth/auth-mappers.ts` |
| Passwords | `apps/api/src/lib/password.ts` |
| Access and refresh tokens | `apps/api/src/lib/tokens.ts`, `src/lib/crypto.ts` |
| Google exchange | `apps/api/src/modules/auth/google.ts` |
| Session guard | `apps/api/src/middleware/require-auth.ts` |
| Throttling | `apps/api/src/middleware/rate-limit.ts` |
| Audit trail | `apps/api/src/modules/audit/audit.ts` |
| Email | `apps/api/src/modules/email/email.ts` |
| Client side | `apps/mobile/src/lib/auth/` |
| Tests | `apps/api/test/auth.test.ts`, `apps/mobile/test/api-client.test.ts` |
