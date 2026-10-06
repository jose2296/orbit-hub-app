# sheet-morph-everywhere

## Objective
Every `Sheet` in the app opens by growing out of the control that opened it (spring), and every
multi-page sheet changes page with the same language (fade + settle from 96%, no sideways travel),
the body height springing to the new size.

## Problem / why
A morphing tray demo (`/sheet-demo`) was approved. `Sheet` (24 sheets) only slides up from the edge;
pages swap instantly. The pilot (`create-sheet` + FloatingButton) was approved by the user on web.

## Scope
- `Sheet` core: `origin` falls back to the last touch point; new `step` prop wraps children in `SheetStep`.
- Pass `step` in every multi-page sheet: create-sheet, list-menu, note-menu, template-menu,
  workspace-menu, item-edit (+ any other found while checking).
- Verify every sheet in a real browser (Playwright, web), light and dark.

## Constraints
- One repo, three targets: no platform-only libs. Pure Reanimated.
- Sheets that never get an origin behave exactly as before.
- No secrets; test user is a throwaway on the local dev API.
- Route declaration: all tasks inline (subagent model is fixed to `Space Bunny Free` by AGENTS.md and
  cannot be selected, so delegation is not available; AGENTS.md says do the task here).

## Tasks
- [x] T1 `lib/touch-origin` (last touch point, recency) + unit test; record it at the app root and inside `Sheet`
- [x] T2 `Sheet`: origin fallback to last touch; `step` prop (SheetStep inside); create-sheet uses the prop
- [x] T3 Pass `step` to list-menu, note-menu, template-menu, workspace-menu, item-edit
- [~] T4 Browser check of every sheet (open morph, step change, back, close, light/dark); fix findings
- [ ] T5 Cleanup: demo route stays dev-only decision, docs note, typecheck + tests

## Acceptance
- `npm run typecheck` and mobile `vitest` pass.
- Each sheet opened in the browser: no console errors, panel visible and usable after the morph, steps
  navigate forward/back, close works.

## Progress / evidence
(created before first source write of this feature)

### Evidence (2026-10-06)
- T1-T3 commit aaad536; typecheck + 96 vitest files (1261 tests) green; test #7 updated: height is now a spring with overshootClamping.
- Fixed-body (scrollable=false) multi-page sheets now animate height (inner onLayout measure + sm padding).
- T4 browser (Playwright, 430x900, light; dark spot check): OK = create (incl. kind/details/back), workspace menu
  (edit/share), list menu (rename/share/export), note menu (rename/icon/share), item edit (new+existing, icon, tags),
  list filter, add-menu -> where-note, create-from-/notes, save-template, media-actions open.
- Found + fixed (pre-existing): note-menu "menu"/"rename" steps used a literal `visible`, so the menu never closed when the
  parent closed it (save-as-template sheet opened hidden behind it).
- Not verified: /lists FAB create, template page menu, folder menu/create folder, share-node/place-share, reorder, providers,
  media "Añadir a otra lista", wide (desktop) layout, native (Android/iOS).
- Env notes: API 500 on /people and 501 on /catalog/details are dev-environment (PGlite / no provider), not UI.
