# ADR 0002 — Own auth, Google as an external OIDC provider

**Status:** Accepted

## Context

OrbitHub needs email + password sign-in, Google sign-in, email verification, password reset,
device session management and account linking. Two interpretations were on the table:

1. OrbitHub implements and operates an OIDC issuer for third parties.
2. OrbitHub owns its authentication and consumes Google as an external OIDC provider.

## Decision

Option 2. The API owns users, passwords, verification, sessions, access and refresh tokens,
and device management. Google is used through the Authorization Code flow with PKCE; the app
obtains a code and the API exchanges it with the client secret.

## Consequences

**Good**

- One user model, one session model, one place where authorisation is enforced.
- Google becomes optional: the app works without it, and the provider can be replaced later.
- Account linking, device revocation and audit are all first class.

**Bad**

- Password security is our responsibility: hashing, reset tokens, rate limiting, breach checks
  and enumeration-safe responses.
- Session infrastructure (rotation, replay detection, revocation) is ours to maintain.
- Being an OIDC issuer would have meant discovery, JWKS, key rotation, a client registry and
  consent screens — a product of its own, with a security surface larger than the app itself.
  That work is explicitly out of scope.

**Security note**

Automatic account linking happens only when Google reports a verified email that matches a
verified local account. Anything else requires an explicit user confirmation, because silent
linking by email is an account takeover vector.
