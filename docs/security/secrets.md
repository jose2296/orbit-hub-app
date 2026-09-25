# Security and secrets

## Rules

1. Only `.env.example` files are committed. A real `.env` is never committed, never pasted into
   a log, and never included in a bug report.
2. Anything prefixed `EXPO_PUBLIC_` is **public**: it is inlined into the JavaScript bundle.
   No secret may ever carry that prefix.
3. The API reads secrets from the environment and validates them at boot; a missing or invalid
   variable stops the process instead of failing on the first request.
4. The logger redacts `Authorization`, `Cookie`, `password`, `*.password`, `*.accessToken`,
   `*.refreshToken` and `googleClientSecret`.
5. Secrets from the legacy repositories are only carried over through
   `make env-import-legacy`, which copies a short, explicit list of reusable keys, writes them
   into git ignored `.env` files and never prints a value. Everything it refuses, and why, is
   listed in [../environment.md](../environment.md).

## Environment variables

### Mobile (public)

| Variable | Purpose |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | API base URL, including `/api/v1` |
| `EXPO_PUBLIC_GOOGLE_CLIENT_ID` | Google web client id (public by design) |
| `EXPO_PUBLIC_GOOGLE_REDIRECT_URI` | OAuth redirect URI |

### API (secret)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `DATABASE_SSL` | Whether to require TLS to the database |
| `CORS_ORIGINS` | Allowed web origins |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Server side OAuth exchange |
| `ACCESS_TOKEN_TTL_SECONDS` / `REFRESH_TOKEN_TTL_SECONDS` | Token lifetimes |
| `EMAIL_FROM` | Sender for verification and reset emails |
| `LOG_LEVEL` | Log verbosity |

## Before anything is deployed

- [ ] Generate new secrets for this project. Do not reuse legacy values.
- [ ] Rotate the legacy OAuth client, Firebase configuration and Android signing material in the
      systems that own them; treat anything that lived in the old repositories as exposed.
- [ ] Store production secrets in the hosting platform's secret manager, not in a `.env` file
      committed anywhere.
- [ ] Restrict `DATABASE_URL` to a least-privilege role (no DDL in production runtime).
- [ ] Enable TLS for the API and for the database connection.
- [ ] Confirm CORS lists only real origins; never `*` with credentials.
- [ ] Verify the store bundle contains no `EXPO_PUBLIC_` value that should be secret.

## Application level protections

| Area | Control |
| --- | --- |
| Passwords | Argon2id, per-user salt, minimum 10 characters, breach check on change |
| Tokens | Short lived access tokens, rotated single-use refresh tokens with replay detection |
| Account enumeration | Identical responses for unknown and known emails |
| Account linking | Only for verified emails, otherwise an explicit confirmation |
| Authorisation | Role check per resource on the server; the client is not a boundary |
| Input | Every payload validated with the shared Zod schema; body size limited to 1 MB |
| SQL | Parameterised queries only; no string interpolation |
| HTTP | Helmet headers, explicit CORS allow-list, `X-Request-Id` correlation |
| Rate limiting | Per IP on auth, per user on writes |
| Provider keys | Live in the API only. The app never holds a catalog key, unlike the legacy build |
| Logging | Structured, redacted, correlated by request id |
| Deletion | Re-authentication plus explicit confirmation, cascading removal |

## Legacy keys

The legacy `.env` files were **not** committed to their repositories, which is the good news: the
values are not in git history. They did sit on disk next to the source for a long time, so:

- Rotate anything that was imported before going live, even if it looks harmless.
- `JWT_SECRET` is never reused: a new signing key makes old and new tokens mutually invalid,
  which is the point.
- `DATABASE_URL` from the legacy stack is never reused: OrbitHub starts on an empty database and
  any data migration is a separate, reversible job.

## Reporting a vulnerability

Do not open a public issue. Report privately to the project owner with reproduction steps, the
affected platform and the request id from the logs.
