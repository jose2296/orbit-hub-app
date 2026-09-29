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

Web is the only target that is checked by hand. The native ones are not: there is no
simulator or device attached to this machine, and a change that is only measured
through a checklist of assumptions is not a check. So a UI change is opened in a
browser, driven to the screen, scrolled, and looked at — and a claim that it works
on Android or iOS is a claim about a build nobody ran.

That makes the web the place where platform-only bugs hide, and the notes editor is
the standing example: it refused every picture, handed the editor unresolved
references, and drew a `+` that scrolled away, and every one of those was found in
a browser in the time it would have taken to boot an emulator. What the browser
cannot tell you is a native selection handle or a system keyboard, and those stay
unverified until somebody runs a device.

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
