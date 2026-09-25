# Environment variables

Everything OrbitHub needs to run, what it is for, and which ones you have to provide.

**Nothing here is committed.** The real files (`apps/api/.env`, `apps/mobile/.env`) are git
ignored. Only the `.env.example` templates are in the repository, and they contain no values.

## Quick start

```bash
make env-init          # create both .env files from the templates
make env-check         # what is missing (names only, never values)
make env-jwt           # generate a stable JWT_SECRET
make api               # start the API with watch
make web               # start the app on the web
```

## Rules of thumb

- Anything prefixed `EXPO_PUBLIC_` is **public**: it is inlined into the JavaScript bundle and
  readable by anyone. Never put a secret behind one of those names.
- Provider keys (TMDB, Google Books) live in the **API**, not in the app. The legacy app shipped
  them in the client; OrbitHub does not.
- The API validates its configuration at boot and refuses to start if it is invalid, rather than
  failing on the first request.

---

## API — `apps/api/.env`

### Server

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `development`, `test` or `production` |
| `PORT` | no | `4000` | |
| `HOST` | no | `0.0.0.0` | |
| `CORS_ORIGINS` | no | `http://localhost:8081` | Comma separated allow-list. Never `*` with credentials |
| `LOG_LEVEL` | no | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |

### Database

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | **in production** | — | `postgresql://user:pass@host:5432/orbit_hub` |
| `DATABASE_SSL` | no | `false` | Set to `true` for managed providers |
| `PGLITE_DATA_DIR` | no | `.data/pglite` in development | Embedded Postgres for local work and tests |

One of the two is enough. With neither, development uses an embedded Postgres in
`apps/api/.data/pglite` and production refuses to start. `make -C apps/api db-reset` wipes it and
re-applies the migrations.

### Auth

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `JWT_SECRET` | **in production** | random per boot in development | 32+ characters. `make env-jwt` writes one |
| `ACCESS_TOKEN_TTL_SECONDS` | no | `900` | 15 minutes |
| `REFRESH_TOKEN_TTL_SECONDS` | no | `2592000` | 30 days, rotated on every use |
| `GOOGLE_CLIENT_ID` | no | unset | Without it the Google button is disabled |
| `GOOGLE_CLIENT_SECRET` | no | unset | Server side only, never in the app |

### Email

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `EMAIL_TRANSPORT` | no | `console` | `console` logs, `resend` sends, `noop` is used by the tests |
| `RESEND_API_KEY` | with `resend` | unset | From resend.com/api-keys, looks like `re_...` |
| `EMAIL_FROM` | no | `no-reply@orbithub.app` | Must be a sender on a domain verified in Resend |
| `WEB_ORIGIN` | no | `https://app.orbithub.com` | Base for the verification and reset links |

### `WEB_ORIGIN` en desarrollo

`WEB_ORIGIN` decide dónde apuntan los enlaces de los correos, así que tiene que ser el origen
**desde el que se abre la app**:

| Entorno | Valor |
| --- | --- |
| Desarrollo local | `http://localhost:8081` |
| Producción | `https://jrz-labs.com` (o el subdominio que se despliegue) |

Con el valor de producción en local, el enlace del correo lleva a un dominio que todavía no
sirve la app. En desarrollo, con el transporte `console`, el enlace se lee directamente del log
de la API:

```bash
grep 'token=' /tmp/orbit-api-dev.log | tail -1
# o, con la API en primer plano, en la salida del terminal
```

Después se abre en `http://localhost:8081/verify-email?token=…`. El token es de un solo uso: si
el enlace falla, pide uno nuevo con "Reenviar correo".

En producción, `WEB_ORIGIN` también es la **redirect URI** que hay que registrar en el cliente
OAuth de Google: `https://jrz-labs.com/auth/google`.

The API refuses to boot when `EMAIL_TRANSPORT=resend` and the key is missing, and refuses to
boot in production with `EMAIL_TRANSPORT=console`, so nobody ships an app that silently logs
password resets.

Check delivery at any time:

```bash
make -C apps/api email-test EMAIL=you@example.com
```

### Rate limiting

| Variable | Default | Notes |
| --- | --- | --- |
| `AUTH_RATE_LIMIT_WINDOW_MS` | `900000` | 15 minutes |
| `AUTH_RATE_LIMIT_MAX` | `30` | Requests per window and IP on `/auth/*` |
| `AUTH_ACCOUNT_RATE_LIMIT_MAX` | `5` | Per email, to slow credential stuffing |

### Realtime (Phase 5)

| Variable | Notes |
| --- | --- |
| `PUSHER_APP_ID` | Imported from the legacy project |
| `PUSHER_APP_KEY` | Imported from the legacy project |
| `PUSHER_SECRET` | Imported from the legacy project, server side only |

### Catalog providers (Phase 3)

| Variable | Notes |
| --- | --- |
| `TMDB_API_KEY` | Imported from the legacy app and moved to the API |
| `GOOGLE_BOOKS_API_KEY` | Imported from the legacy app and moved to the API |
| `GOOGLE_BOOKS_SEARCH_ENGINE_ID` | Optional, speeds up book search |

---

## App — `apps/mobile/.env`

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | no | `http://localhost:4000/api/v1` | On the Android emulator use `http://10.0.2.2:4000/api/v1` |
| `EXPO_PUBLIC_GOOGLE_CLIENT_ID` | no | unset | Same client id as the API. Button disabled while empty |
| `EXPO_PUBLIC_GOOGLE_REDIRECT_URI` | no | `orbithub://auth/google` | |

---

## What was and was not taken from the legacy projects

`make env-import-legacy` copies only what is genuinely reusable, and prints names, never values.

**Imported**

| From | To | Why |
| --- | --- | --- |
| `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET` | `PUSHER_*` in the API | Same account, realtime arrives in Phase 5 |
| `EXPO_PUBLIC_THEMOVIEDB_API_KEY` | `TMDB_API_KEY` in the API | Moved out of the client: the key never ships in the app |
| `EXPO_PUBLIC_GOOGLE_BOOKS_API_KEY` | `GOOGLE_BOOKS_API_KEY` in the API | Same reason |
| `EXPO_PUBLIC_GOOGLE_SEARCH_ENGINE_ID` | `GOOGLE_BOOKS_SEARCH_ENGINE_ID` in the API | Same reason |

**Refused on purpose**

| Key | Why |
| --- | --- |
| `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_*` | OrbitHub starts on an empty PostgreSQL. Pointing at the legacy database would attach the new app to old data |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | A new signing key invalidates every old token on purpose, so the two systems never share a trust boundary |
| `SALT_ROUNDS` | OrbitHub hashes with Argon2id, not bcrypt |
| `CRON_SECRET` | Belongs to the legacy job runner |
| `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` | AI was removed from OrbitHub by decision |
| `FIREBASE_*` | Push needs its own Firebase project, in Phase 6 |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | OrbitHub has its own auth |

## Still to be created

| Variable | Who creates it | When |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | You, in the Google Cloud console | Before Google sign-in ships |
| `DATABASE_URL` | You, on a managed PostgreSQL | Before the first deployment |
| A real email transport | You, Resend / Postmark / SES | Before anyone else registers |

Steps for each one are in [pending-from-owner.md](pending-from-owner.md).

## Before production

- [ ] Rotate every key that came from a legacy project, even though the legacy `.env` files were
      not committed: they sat on disk next to the code for months.
- [ ] Set `JWT_SECRET` from the secret manager, not from a file in the repository.
- [ ] `DATABASE_URL` with a least-privilege role and TLS enabled.
- [ ] `NODE_ENV=production`, which makes the API refuse to start without a real database and a
      real signing key.
