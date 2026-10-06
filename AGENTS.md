# AGENTS.md

Working agreement for humans and AI agents working on OrbitHub.

## Ground rules

1. **One repo, three targets.** All UI lives in `apps/mobile` and must run on Android, iOS and
   web. Never add platform-only libraries without a documented reason and a fallback.
2. **Do not touch the legacy repositories.** `../utility-app-native` and `../utility-app-turbo`
   are read-only references. Copy code consciously, never with blind `cp -r`.
3. **No secrets.** Only `.env.example` files are committed. Never read secrets from the legacy
   repos into this one, and never paste credentials into code, docs or chat.
4. **Contracts first.** Anything crossing the network boundary is defined in
   `packages/contracts` (Zod schema + inferred type). The app and the API both import it.
5. **Routes are files.** Add screens under `apps/mobile/src/app`. Components, hooks, lib and
   types never live in the routes directory.
6. **Design tokens only.** No hardcoded colours, spacing or radii in screens. Use
   `useTheme()` from `apps/mobile/src/theme`.
7. **Local-first.** Any write path must work offline: write locally, enqueue an operation, sync
   later. See `docs/architecture/offline-sync.md`.
8. **Server-side authorisation.** Ownership and role checks belong in the API. The client is never
   a security boundary.

## Definition of done for a change

```bash
npm run typecheck   # all workspaces
npm run test        # api tests
npm run check       # typecheck + test + expo config
```

Plus, for UI changes: verify on the **web**, in light and dark theme.

Web is still the first target to check, and for most changes the only one you need:
it is fast, and the browser catches a lot. But **there is an Android emulator on this
machine** — `emulator-5554`, AVD `Medium_Phone_API_35` (Android 15 / API 35) — and
**iOS simulators** (iPhone 15 / 15 Pro, runtimes 17.5 and 18.4, currently shut down).
So "a claim that it works on Android is a claim about a build nobody ran" is no
longer true here, and it should not be used as a reason to skip.

An earlier version of this file said there was no simulator or device, and that was
simply wrong. It was not a small error: three bugs in the list of pending work were
written off as "unverifiable without a device" on the strength of it, and the
first of them turned out to be a one-line omission that a screenshot proves in a
minute.

What it takes, so nobody has to rediscover it:

```bash
npx expo start --port 8081            # the installed build has no bundle of its own
adb -s emulator-5554 reverse tcp:8081 tcp:8081
adb -s emulator-5554 shell monkey -p com.jrzlabs.orbithub -c android.intent.category.LAUNCHER 1
adb -s emulator-5554 exec-out screencap -p > shot.png
```

Two things about that loop worth knowing. The app has to be **launched after** Metro
answers, not before, or it draws "Unable to load script" and stays there. And
`scripts/verify-android-screens.mjs` already exists for checking that a tap
actually landed — it compares the screen hash, because a tap that misses does not
crash either.

The web is still where platform-only bugs hide, and the notes editor is the
standing example: it refused every picture, handed the editor unresolved
references, and drew a `+` that scrolled away, and every one of those was found in
a browser. What the browser cannot tell you is a native selection handle, a system
keyboard, or a gesture — so use it first, and then use the emulator rather than
writing "unverifiable" in a comment.

## Where things live

| Need                              | Location                                        |
| --------------------------------- | ----------------------------------------------- |
| New screen / route                | `apps/mobile/src/app/**`                        |
| Reusable UI                       | `apps/mobile/src/components/**`                 |
| Theme tokens                      | `apps/mobile/src/theme/**`                      |
| API client, auth, storage, sync   | `apps/mobile/src/lib/**`                        |
| Shared hooks                      | `apps/mobile/src/hooks/**`                      |
| API route / middleware / db       | `apps/api/src/**`                               |
| Request/response schema           | `packages/contracts/src/**`                     |
| Architecture decision             | new file in `docs/architecture/adr/`            |

## Subagents

Todos los subagentes usan **`Space Bunny Free`**, siempre. No se cambia por modelo,
por coste ni porque otro parezca más adecuado para una tarea concreta: uno solo,
y el que hay. Si un subagente necesita otro modelo, se hace la tarea aquí.
