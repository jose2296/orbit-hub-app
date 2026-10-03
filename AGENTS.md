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

The web is still checked by hand, and it is no longer the only target. There **is** an
Android emulator on this machine and there is an automated smoke walkthrough for it:
`npm run e2e:android`. **iOS still has nothing** — no simulator, no harness — so a
claim about iOS is still a claim about a build nobody ran.

So a UI change is opened in a browser, driven to the screen, scrolled, and looked at, in
both themes. That is the cheapest target to check by hand and it is where platform-only
bugs hide, and the notes editor is the standing example: it refused every picture, handed
the editor unresolved references, and drew a `+` that scrolled away, and every one of
those was found in a browser in the time it would have taken to boot an emulator.

What the browser cannot tell you is a native selection handle or a system keyboard. That
is what `npm run e2e:android` is for: it walks the app on a real device, drives it with
Maestro, and fails on a screen that does not come up. It is a smoke walkthrough, not a
test of behaviour — it does not check that a save saved what you typed — and it is
deliberately not part of `npm run check` and not in CI. See `apps/mobile/e2e/README.md`.

**The obligation.** A new screen, sheet or option ships with its flow: one file under
`apps/mobile/e2e/maestro/flows/<area>/`, asserted on `testID` and never on translated
text, plus its name in that area's `flowsOrder` — adding one and declaring the other are
the same change. And UI work runs `npm run e2e:android` before it is called done. A green
run that never reached the new thing is not a check either, and neither is a red line you
can wave away: if `capturas/android/informe.txt` names an area in red, the change either
broke it or it found a real defect, and both are worth reading before the commit.

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
