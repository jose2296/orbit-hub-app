# Arnes de la regresion E2E en Android — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single command, `npm run e2e:android`, that starts whatever is missing, seeds a verified account, runs Maestro over a directory of flows, and fails the run when a screen breaks, the app dies, or it silently relaunches.

**Architecture:** Maestro does the navigating and the asserting. A thin Node harness around it owns the four things Maestro cannot see: the device, the stack, the fixtures, and the crash buffer. The harness runs Maestro **once per area directory**, clearing `logcat` and snapshotting the app pid either side of each run, so a failure names the area and a re-run of that area's flows isolates the exact flow. The harness is TypeScript run directly by Node's type stripping; the pure parts — the crash verdict, area resolution, report rendering, token parsing — are unit-tested with the vitest that already exists.

**Tech Stack:** Node 22.18+ (type stripping, no build step), TypeScript, vitest (already configured for this workspace), `adb` + `uiautomator`, Maestro, PGlite, Express.

**Spec:** `docs/superpowers/specs/2026-10-03-regresion-e2e-android-design.md` — the plan argues from the spec, so the spec travels with it; executors read both.

**Scope:** This plan is **phase 1 only** — the harness, plus the three signed-out screens the suite can walk before it needs an account. It does not cover the whole app, and pretending otherwise would be the first version of the mistake this suite exists to catch.

**Phase 2 is deliberately not planned here.** The remaining screens and the 40 overlays get their own plan, written after this one lands. That ordering is not laziness: Task 4 proves the harness against three real flows on a real emulator, and until it has, nobody knows whether `testID` reaches the elements the way `screen.tsx` suggests, whether `clearState` behaves, or whether Maestro needs a `waitForAnimation` between taps. Planning 60 flows against an approach that has touched one screen would be writing a plan twice.

## Global Constraints

- **The crash verdict is four signals, in this order, and all four fail the run:** no pid after; pid **changed** since before (silent relaunch — this repo has been bitten by it twice, `8b75b37` and `513bbbb`); any `FATAL EXCEPTION` in `logcat -b crash`; any `JavascriptException` there. Order matters: a dead process is reported as a dead process, not as a crash line that happened to be in the buffer.
- **`logcat` is cleared and the app is force-stopped before the baseline pid is read.** A crash left in the buffer by whatever ran before the suite, or a pid belonging to a previous run, would otherwise be charged to the first flow.
- **Assertions are on `testID` and on strings the seed itself defines.** Never on translated UI copy: the app is bilingual (`dictionaries.ts` derives `TranslationKey` from the Spanish dictionary) and a text selector breaks the moment a word is reworded.
- **`testID` convention: kebab-case, area-prefixed**, matching what is already in the code — `notes-create`, `item-create`, `people-search`, `content-filter-*`. A screen root gets `screen-<name>`, e.g. `screen-lists`.
- **The API is started with `EMAIL_TRANSPORT=console` and a scratch `PGLITE_DATA_DIR`.** `EMAIL_TRANSPORT` already defaults to `console` (`apps/api/src/config/env.ts:47`); set it anyway so the intent is in the file. The verification link is read back out of the API's own stdout, which is what `scripts/seed-people.mjs` does.
- **API base path is `/api/v1`** (`API_PREFIX` in `packages/config/src/index.ts:20`).
- **`PGLITE_DATA_DIR` and `EMAIL_TRANSPORT` are passed in the child environment only.** `.env` files are git-ignored and must not be written to.
- **The harness tears down only what it started.** If Metro or the API was already listening, it is left running.
- **E2E is not wired into `npm run check` or CI.** It is on demand, local. `check` runs on every push and a booted emulator there costs CI minutes and red PRs on a timer.
- **TypeScript in `e2e/` runs through Node's type stripping**, so: no `enum`, no `namespace`, no parameter properties, and `import type` for every type-only import (`isolatedModules` is on in `tsconfig.base.json`). `apps/mobile/tsconfig.json` already includes `**/*.ts`, so `e2e/` is typechecked with no config change.
- **Tests for the harness live beside it**, at `e2e/lib/*.test.ts`, not in `apps/mobile/test/`. That needs one line added to `apps/mobile/vitest.config.ts` (see Task 1). This is a deliberate departure from the flat `test/` convention: the harness is a self-contained subsystem and its tests travel with it.

## Review Focus

Five inputs a reasonable person would expect to work, that the spec implies but no task's happy path exercises:

1. **Two devices attached** — a real phone plus the emulator. The suite must refuse and name both, not silently pick one and seed fixtures onto the wrong target.
2. **The app was already running, or the crash buffer was not empty.** Without the force-stop and clear, the first area inherits a stale pid and someone else's crash.
3. **A flow leaves the app somewhere else** — on an open sheet, or signed out. The next flow then fails for a reason that has nothing to do with it.
4. **The seed half-succeeds** — the verification mail never reaches the log, so half the fixtures exist. Every later assertion is then meaningless, and worse, some of them pass.
5. **`--area` names something that does not exist, or an area directory holds no flows.** Maestro exits `0` having tested nothing, and the run is green. A green run that tested nothing is the exact failure this repo already paid for once.

---

### Task 1: The crash verdict, and proving the primitives against a real device

The verdict is the piece that makes every other signal mean something. It gets built first and tested first, and Task 1 also fixes the run-script entry point and the vitest wiring that every later task depends on.

**Files:**
- Create: `apps/mobile/e2e/lib/android.ts`
- Create: `apps/mobile/e2e/lib/guard.ts`
- Create: `apps/mobile/e2e/lib/guard.test.ts`
- Create: `apps/mobile/e2e/lib/android.test.ts`
- Create: `apps/mobile/e2e/run-android.ts`
- Modify: `apps/mobile/vitest.config.ts` (add `e2e/**/*.test.ts` to `test.include`)
- Modify: `apps/mobile/package.json` (add `"e2e:android": "node e2e/run-android.ts"`)

**Interfaces:**
- Consumes: nothing. This is the bottom of the dependency graph.
- Produces:
  - `android.ts`: `ADB: string`, `PAQUETE: string`, `devices(): Device[]`, `requireOneDevice(): string`, `adb(args: string[], serial?: string): string`, `appPid(serial: string, pkg?: string): string | null`, `crashLines(serial: string): string[]`, `clearLogcat(serial: string): void`, `forceStop(serial: string, pkg?: string): void`, `screenshot(serial: string, file: string): void`, where `Device = { serial: string; state: string }`.
  - `guard.ts`: `type Verdict = { ok: boolean; problems: string[] }` and `verdict(before: { pid: string | null }, after: { pid: string | null }, crashes: string[]): Verdict`.
  - `run-android.ts`: default-exports nothing; it is the CLI entry. Later tasks grow its body.

- [ ] **Step 1: Confirm Node strips types here, before writing anything that depends on it**

```bash
cd /Users/jose/code/orbit-hub
printf 'export const probe = (): number => 41;\n' > apps/mobile/e2e-probe.ts 2>/dev/null || mkdir -p apps/mobile/e2e && printf 'export const probe = (): number => 41;\n' > apps/mobile/e2e/probe.ts
node -e "import('./apps/mobile/e2e/probe.ts').then(m => console.log('strip ok', m.probe() + 1))"
```

Expected: `strip ok 42`. If it throws `ERR_UNKNOWN_FILE_EXTENSION`, the project's Node floor is not stripping: fall back to running the entry through `tsx` (already in the repo, `apps/api` uses it) by changing the `e2e:android` script to `npx tsx e2e/run-android.ts`, and say so in the PR. Delete the probe afterwards.

- [ ] **Step 2: Wire vitest to see `e2e/`**

In `apps/mobile/vitest.config.ts`, change `include: ['test/**/*.test.ts']` to `include: ['test/**/*.test.ts', 'e2e/**/*.test.ts']`.

- [ ] **Step 3: Add the npm script**

Add to `apps/mobile/package.json` scripts, next to `"android"`:

```json
"e2e:android": "node e2e/run-android.ts"
```

Add the matching root-level passthrough to the root `package.json`, next to `"android"`, so the documented `npm run e2e:android` works from the repo root:

```json
"e2e:android": "npm run e2e:android --workspace @orbit-hub/mobile"
```

- [ ] **Step 4: Write the failing test for the verdict**

`apps/mobile/e2e/lib/guard.test.ts`. These four cases are the whole contract — the ordering is what stops a dead process being reported as a crash line, and the pid-change case is the one this repo has shipped twice:

```ts
import { describe, expect, it } from 'vitest';
import { verdict } from './guard';

const vivo = { pid: '4242' };
const muerto = { pid: null };

describe('verdict', () => {
  it('pasa cuando el proceso sigue igual y no hay crashes', () => {
    expect(verdict(vivo, vivo, [])).toEqual({ ok: true, problems: [] });
  });

  it('falla cuando no queda proceso', () => {
    expect(verdict(vivo, muerto, []).ok).toBe(false);
    expect(verdict(vivo, muerto, []).problems[0]).toContain('se cerro');
  });

  it('falla cuando el pid cambia, que es un relanzamiento en silencio', () => {
    const v = verdict(vivo, { pid: '5151' }, []);
    expect(v.ok).toBe(false);
    expect(v.problems[0]).toContain('4242');
    expect(v.problems[0]).toContain('5151');
  });

  it('falla ante un crash del buffer, y lo cita', () => {
    const v = verdict(vivo, vivo, ['FATAL EXCEPTION: main']);
    expect(v.ok).toBe(false);
    expect(v.problems[0]).toContain('FATAL EXCEPTION');
  });

  it('un proceso muerto se reporta como muerto, no como crash', () => {
    // El buffer puede tener lneas de antes. El sintoma que manda es la ausencia
    // de proceso, y reportar las dos cosas mete ruido en el informe.
    const v = verdict(vivo, muerto, ['FATAL EXCEPTION: main']);
    expect(v.problems).toHaveLength(1);
    expect(v.problems[0]).toContain('se cerro');
  });

  it('acepta un pid inicial desconocido sin inventar un relanzamiento', () => {
    // La app no estaba corriendo antes del area: no hubo cambio de pid porque no
    // habia pid. Esto no es un fallo.
    expect(verdict(muerto, vivo, []).ok).toBe(true);
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `npm run test --workspace @orbit-hub/mobile -- guard.test.ts`
Expected: FAIL — `Cannot find module './guard'`.

- [ ] **Step 6: Implement `verdict`**

`apps/mobile/e2e/lib/guard.ts`:

```ts
export type Verdict = { ok: boolean; problems: string[] };

/**
 * The four signals, checked in this order and stopping at the first.
 *
 * Order is the whole point. A dead process also tends to have its crash line
 * sitting in the buffer, and reporting both puts two problems in the report for
 * one fault. The absence of a process is the symptom; the log is the cause.
 *
 * The pid change is the signal that costs the most when it is missing. Without
 * it, six steps went green in `verify-android-screens.mjs` while the app never
 * left the same screen: taps that land on nothing do not crash anything.
 */
export function verdict(
  before: { pid: string | null },
  after: { pid: string | null },
  crashes: string[],
): Verdict {
  if (after.pid === null) {
    return { ok: false, problems: ['la app se cerro — no hay proceso'] };
  }
  if (before.pid !== null && before.pid !== after.pid) {
    return {
      ok: false,
      problems: [`el proceso cambio (${before.pid} -> ${after.pid}): relanzo en silencio`],
    };
  }
  if (crashes.length > 0) {
    return { ok: false, problems: [crashes[0]!.slice(0, 160)] };
  }
  return { ok: true, problems: [] };
}
```

- [ ] **Step 7: Run the guard tests and watch them pass**

Run: `npm run test --workspace @orbit-hub/mobile -- guard.test.ts`
Expected: 6 passed.

- [ ] **Step 8: Write the failing test for device selection**

`apps/mobile/e2e/lib/android.test.ts`. `devices()` is split from `requireOneDevice()` precisely so the refusal can be tested without a second device plugged in — the two-device case is Review Focus 1 and it must not need real hardware to prove:

```ts
import { describe, expect, it } from 'vitest';
import { pickDevice } from './android';

describe('pickDevice', () => {
  it('elige el unico dispositivo conectado', () => {
    expect(pickDevice([{ serial: 'emulator-5554', state: 'device' }])).toBe('emulator-5554');
  });

  it('se niega a adivinar cuando hay mas de uno, y dice cuales', () => {
    const dos = [
      { serial: 'emulator-5554', state: 'device' },
      { serial: 'R58M12345XY', state: 'device' },
    ];
    expect(() => pickDevice(dos)).toThrow(/emulator-5554/);
    expect(() => pickDevice(dos)).toThrow(/R58M12345XY/);
  });

  it('dice que no hay ninguno cuando no hay ninguno', () => {
    expect(() => pickDevice([])).toThrow(/no hay/);
  });

  it('ignora los dispositivos que no estan en estado device', () => {
    expect(pickDevice([{ serial: 'emulator-5554', state: 'offline' }])).toBe('emulator-5554');
  });
});
```

- [ ] **Step 9: Run it and watch it fail**

Run: `npm run test --workspace @orbit-hub/mobile -- android.test.ts`
Expected: FAIL — `pickDevice` is not exported.

- [ ] **Step 10: Implement `android.ts`**

`apps/mobile/e2e/lib/android.ts`. The three `adb` wrappers are lifted in behaviour from `scripts/verify-android-screens.mjs` (lines 36–81), which is the working reference — reuse its parsing rather than inventing new parsing:

```ts
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';

export const ADB =
  process.env.ANDROID_ADB ?? `${homedir()}/Library/Android/sdk/platform-tools/adb`;
export const PAQUETE = process.env.PAQUETE ?? 'com.jrzlabs.orbithub';

export type Device = { serial: string; state: string };

export function adb(args: string[], serial?: string): string {
  return execFileSync(ADB, [...(serial ? ['-s', serial] : []), ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** `adb devices` filtered to the ones actually usable. */
export function devices(): Device[] {
  const salida = adb(['devices']);
  return salida
    .split('\n')
    .slice(1)
    .map((linea) => linea.trim().split(/\s+/))
    .filter((partes): partes is [string, string] => partes.length >= 2 && partes[1] === 'device')
    .map(([serial, state]) => ({ serial, state }));
}

export function pickDevice(conectados: Device[]): string {
  if (conectados.length === 0) throw new Error('no hay ningun dispositivo android conectado');
  if (conectados.length > 1) {
    throw new Error(
      `hay mas de un dispositivo android conectado: ${conectados.map((d) => d.serial).join(', ')}. ` +
        'Deja uno solo, o reinicia el emulador.',
    );
  }
  return conectados[0]!.serial;
}

export function requireOneDevice(): string {
  return pickDevice(devices());
}

/**
 * `pidof` returns nothing both when the app is dead and when it never ran, so
 * `null` here means "no hay proceso" and the caller treats it as a fault.
 */
export function appPid(serial: string, pkg: string = PAQUETE): string | null {
  try {
    return (adb(['shell', 'pidof', pkg], serial) || '').trim().split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}

export function crashLines(serial: string): string[] {
  try {
    return adb(['logcat', '-d', '-b', 'crash', '-v', 'brief'], serial)
      .split('\n')
      .filter((linea) => /FATAL EXCEPTION|JavascriptException/.test(linea));
  } catch {
    return [];
  }
}

export function clearLogcat(serial: string): void {
  adb(['logcat', '-c'], serial);
}

/** Review Focus 2: the baseline pid has to belong to this run, not the last one. */
export function forceStop(serial: string, pkg: string = PAQUETE): void {
  try {
    adb(['shell', 'am', 'force-stop', pkg], serial);
  } catch {
    /* si no estaba corriendo, no hay nada que parar */
  }
}

export function screenshot(serial: string, file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  execFileSync('sh', ['-c', `"${ADB}" -s ${serial} exec-out screencap -p > "${file}"`]);
}
```

- [ ] **Step 11: Run the android tests and watch them pass**

Run: `npm run test --workspace @orbit-hub/mobile -- android.test.ts`
Expected: 4 passed.

- [ ] **Step 12: Prove the primitives against the real emulator**

This is the step that catches a wrong `adb` path or a missing app install, and neither is visible in a unit test:

```bash
cd /Users/jose/code/orbit-hub
node --input-type=module -e "
import { requireOneDevice, adb, appPid, crashLines, PAQUETE } from './apps/mobile/e2e/lib/android.ts';
const serial = requireOneDevice();
console.log('device:', serial);
console.log('api level:', adb(['shell', 'getprop', 'ro.build.version.sdk'], serial).trim());
console.log('installed:', adb(['shell', 'pm', 'list', 'packages', PAQUETE], serial).includes(PAQUETE));
console.log('pid ahora:', appPid(serial));
console.log('crashes en el buffer:', crashLines(serial).length);
"
```

Expected: one serial printed, an API level, `installed: true` (the emulator on this machine already has `com.jrzlabs.orbithub`), and a pid that may be `null` because the app is not running. If `installed: false`, stop here and report it — the harness has nothing to drive, and installing the app is outside this plan.

- [ ] **Step 13: Write a minimal entry point that proves the wiring**

`apps/mobile/e2e/run-android.ts`, its whole body for now:

```ts
import { requireOneDevice } from './lib/android';

const serial = requireOneDevice();
console.log(`arnes E2E: dispositivo ${serial}`);
```

- [ ] **Step 14: Run the script both ways**

Run: `npm run e2e:android` from the repo root, then `npm run e2e:android --workspace @orbit-hub/mobile`.
Expected: `arnes E2E: dispositivo emulator-5554` from both. The root passthrough is the one the spec documents, so it is the one that has to work.

- [ ] **Step 15: Run the full workspace test suite**

Run: `npm run test --workspace @orbit-hub/mobile`
Expected: every pre-existing test still passes, plus the 10 new ones. A change to `vitest.config.ts` that narrowed the glob would show up here and nowhere else.

- [ ] **Step 16: Commit**

```bash
git add apps/mobile/e2e apps/mobile/vitest.config.ts apps/mobile/package.json package.json
git commit -m "El arnes E2E sabe que hay un fallo, y no se equivida de dispositivo

El veredicto se prueba antes que nada porque es lo que hace que las otras
tres senales signifiquen algo: sin comprobar el pid, un recorrido entero
puede dar verde sin que la app se haya movido.

Se comprueba en este orden y para en el primero. Un proceso muerto tambien
suele tener su linea de crash en el buffer, y reportar las dos cosas mete
dos problemas en el informe para un solo fallo.

pickDevice se separa de requireOneDevice para poder probar el caso de dos
dispositivos sin un telefono de verdad conectado: elige ninguno por su
cuenta, dice cuales ve, y no siembra los datos en el objetivo equivocado."
```

---

### Task 2: Starting the stack, and only tearing down what we started

**Files:**
- Create: `apps/mobile/e2e/lib/stack.ts`
- Create: `apps/mobile/e2e/lib/stack.test.ts`
- Modify: `apps/mobile/e2e/run-android.ts`

**Interfaces:**
- Consumes: `adb`, `requireOneDevice` from `./lib/android` (Task 1) — not needed here, but the entry point already imports `requireOneDevice`.
- Produces:
  - `stack.ts`: `type Service = { label: string; url: string; started: boolean; stop(): Promise<void> }`, `isListening(url: string, timeoutMs?: number): Promise<boolean>`, `waitForHttp(url: string, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<boolean>`, `ensureService(opts: EnsureOptions): Promise<Service>`, where `EnsureOptions = { label: string; url: string; cmd: string; args: string[]; env?: Record<string, string>; logFile: string; timeoutMs?: number }`.

- [ ] **Step 1: Write the failing test for `waitForHttp`**

`apps/mobile/e2e/lib/stack.test.ts`. Both cases run against a real throwaway server on an ephemeral port — no mocking, because the whole question is whether a URL answers, and a mock would answer that question wrongly:

```ts
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { isListening, waitForHttp } from './stack';

const abiertos: { close(): void }[] = [];
function servir(): string {
  const server = createServer((_peticion, respuesta) => respuesta.end('ok'));
  server.listen(0, '127.0.0.1');
  abiertos.push(server);
  const puerto = (server.address() as { port: number }).port;
  return `http://127.0.0.1:${puerto}/`;
}
afterEach(() => {
  for (const s of abiertos.splice(0)) s.close();
});

describe('isListening', () => {
  it('es verdad cuando algo contesta', async () => {
    await expect(isListening(servir())).resolves.toBe(true);
  });

  it('es falso cuando el puerto esta cerrado, y no lanza', async () => {
    await expect(isListening('http://127.0.0.1:1/')).resolves.toBe(false);
  });
});

describe('waitForHttp', () => {
  it('da por buena una url que ya responde', async () => {
    await expect(waitForHttp(servir(), { timeoutMs: 2000 })).resolves.toBe(true);
  });

  it('devuelve falso, en vez de lanzar, cuando se agota el tiempo', async () => {
    // El arranque de Metro falla asi. Que devuelva falso deja que ensureService
    // tire el error con el log delante, que es lo que hace falta para diagnosticar.
    await expect(waitForHttp('http://127.0.0.1:1/', { timeoutMs: 600, intervalMs: 100 })).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test --workspace @orbit-hub/mobile -- stack.test.ts`
Expected: FAIL — `Cannot find module './stack'`.

- [ ] **Step 3: Implement `stack.ts`**

```ts
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export type Service = {
  label: string;
  url: string;
  /** `false` cuando ya estaba corriendo: no lo paramos al terminar. */
  started: boolean;
  stop(): Promise<void>;
};

export type EnsureOptions = {
  label: string;
  url: string;
  cmd: string;
  args: string[];
  env?: Record<string, string>;
  logFile: string;
  timeoutMs?: number;
};

export async function isListening(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch {
    return false;
  }
}

export async function waitForHttp(
  url: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const limite = Date.now() + (opts.timeoutMs ?? 90_000);
  const cada = opts.intervalMs ?? 500;
  for (;;) {
    if (await isListening(url)) return true;
    if (Date.now() > limite) return false;
    await new Promise((r) => setTimeout(r, cada));
  }
}

export async function ensureService(opts: EnsureOptions): Promise<Service> {
  if (await isListening(opts.url)) {
    return { label: opts.label, url: opts.url, started: false, stop: async () => {} };
  }

  mkdirSync(dirname(opts.logFile), { recursive: true });
  const log = openSync(opts.logFile, 'a');
  const hijo = spawn(opts.cmd, opts.args, {
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, ...opts.env },
  });
  hijo.unref();

  const listo = await waitForHttp(opts.url, { timeoutMs: opts.timeoutMs });
  if (!listo) {
    try {
      process.kill(-(hijo.pid as number), 'SIGTERM');
    } catch {
      /* ya estaba muerto */
    }
    throw new Error(
      `${opts.label} no contesto en ${opts.url}. Su salida esta en ${opts.logFile}`,
    );
  }

  return {
    label: opts.label,
    url: opts.url,
    started: true,
    stop: async () => {
      try {
        // El grupo entero, no solo el hijo: `npm run` deja nietos que se quedan
        // con el puerto cogido y hacen que la siguiente carrera falle por un
        // puerto ocupado en lugar de por un fallo real.
        process.kill(-(hijo.pid as number), 'SIGTERM');
      } catch {
        /* ya estaba muerto */
      }
    },
  };
}
```

- [ ] **Step 4: Run the stack tests and watch them pass**

Run: `npm run test --workspace @orbit-hub/mobile -- stack.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Wire the two services into the entry point**

`apps/mobile/e2e/run-android.ts`:

```ts
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireOneDevice } from './lib/android';
import { ensureService, type Service } from './lib/stack';

const RAIZ = fileURLToPath(new URL('../..', import.meta.url));
const requireOneDevice_ = requireOneDevice;
```

Replace that last line with the real body — the imports above are the ones it needs:

```ts
const RAIZ = fileURLToPath(new URL('../..', import.meta.url));
const CAPTURAS = join(RAIZ, 'capturas', 'android');
mkdirSync(CAPTURAS, { recursive: true });

const serial = requireOneDevice();
console.log(`arnes E2E: dispositivo ${serial}`);

const PUERTO_API = process.env.E2E_API_PORT ?? '4011';
const API = `http://127.0.0.1:${PUERTO_API}/api/v1`;
const SALIDA_API = join(CAPTURAS, 'api.log');

// Un directorio propio por carrera: la base de datos empieza vacia siempre, y lo
// que quedo de la carrera anterior no puede cambiar el resultado de esta.
const PGDATA = join(RAIZ, 'capturas', 'android', 'pglite');

const servicios: Service[] = [];
try {
  servicios.push(
    await ensureService({
      label: 'la API',
      url: `http://127.0.0.1:${PUERTO_API}/health`,
      cmd: 'npm',
      args: ['run', 'start', '--workspace', '@orbit-hub/api'],
      env: {
        PORT: PUERTO_API,
        PGLITE_DATA_DIR: PGDATA,
        EMAIL_TRANSPORT: 'console',
      },
      logFile: SALIDA_API,
    }),
  );
  servicios.push(
    await ensureService({
      label: 'Metro',
      url: 'http://127.0.0.1:8081/status',
      cmd: 'npm',
      args: ['run', 'start', '--workspace', '@orbit-hub/mobile', '--', '--port', '8081'],
      logFile: join(CAPTURAS, 'metro.log'),
    }),
  );
  for (const s of servicios) {
    console.log(`  ${s.started ? 'arrancado' : 'ya estaba en pie'}: ${s.label} (${s.url})`);
  }
  console.log(`  API para el seed: ${API}`);
} finally {
  for (const s of servicios) await s.stop();
}
```

Delete the `RAIZ`/`requireOneDevice_` placeholder lines from the first block — they are shown only to name the imports.

- [ ] **Step 6: Run it and watch both services come up**

Run: `npm run e2e:android`
Expected: `arrancado: la API` and either `arrancado: Metro` or `ya estaba en pie: Metro`. On this machine neither is running yet, so both should say `arrancado`. The run then exits cleanly, which is what proves `stop()` kills the process group — re-run it and confirm the ports are free.

- [ ] **Step 7: Prove the "already up" branch**

With the API still listening from a manual `npm run api`, run `npm run e2e:android` again.
Expected: `ya estaba en pie: la API`, and `npm run e2e:android` on its own afterwards still finds it up — the harness must not have killed something it did not start.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/e2e
git commit -m "El arnes levanta lo que falta, y para solo lo que levanto

Metro y la API se comprueban antes de arrancar nada, y el proceso se para
por grupo, no por pid: 'npm run' deja nietos que se quedan con el puerto
cogido y hacen que la siguiente carrera falle por un puerto ocupado en
lugar de por un fallo real.

La base de datos de la carrera vive en un directorio propio y se vacia, para
que lo que quedo de la anterior no pueda cambiar el resultado de esta."
```

---

### Task 3: Seeding a verified account with something to look at

An unseeded app shows empty screens, and an empty screen renders. This is the task that makes the suite worth running — and the one where a partial success is most dangerous, because half-built fixtures make some assertions pass and others fail for no reason.

**Files:**
- Create: `apps/mobile/e2e/seed/e2e-account.ts`
- Create: `apps/mobile/e2e/seed/e2e-account.test.ts`
- Modify: `apps/mobile/e2e/run-android.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1 and 2 (the seed talks HTTP, not `adb`). `run-android.ts` calls it with the `API` base URL and the `EMAIL_TRANSPORT=console` log path.
- Produces: `seed.ts` exports `type Seeded = { email: string; password: string; spaceName: string; listTitle: string; noteTitle: string; otherEmail: string; workspaceId: string; folderId: string; listId: string; noteId: string }` and `seed(options: { api: string; apiLog: string }): Promise<Seeded>`. Also `writeSeedEnv(archivo: string, sembrado: Seeded): void` and `verificationTokenFor(lineas: string[], email: string): string | null`.

- [ ] **Step 1: Write the failing test for token parsing**

`apps/mobile/e2e/seed/e2e-account.test.ts`. The parsing is extracted from `scripts/seed-people.mjs` (`verificationTokenFor`, around line 64) precisely so it can be tested against a log it does not have to produce. The last-match rule is the point: re-running must not verify with a token from the previous run.

```ts
import { describe, expect, it } from 'vitest';
import { verificationTokenFor } from './e2e-account';

const linea = (email: string, token: string) =>
  `[email] verification link https://orbit.example/verify-email?token=${token} for ${email}`;

describe('verificationTokenFor', () => {
  it('saca el token de la linea del correo', () => {
    expect(verificationTokenFor([linea('ana@example.com', 'tok-abc')], 'ana@example.com')).toBe('tok-abc');
  });

  it('devuelve null si todavia no ha llegado el correo', () => {
    expect(verificationTokenFor([], 'ana@example.com')).toBeNull();
  });

  it('con dos correos toma el ultimo, que es el de esta carrera', () => {
    const lineas = [linea('ana@example.com', 'viejo'), linea('ana@example.com', 'nuevo')];
    expect(verificationTokenFor(lineas, 'ana@example.com')).toBe('nuevo');
  });

  it('ignora los correos de otra cuenta', () => {
    const lineas = [linea('beto@example.com', 'de-beto'), linea('ana@example.com', 'de-ana')];
    expect(verificationTokenFor(lineas, 'ana@example.com')).toBe('de-ana');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test --workspace @orbit-hub/mobile -- e2e-account.test.ts`
Expected: FAIL — `Cannot find module './e2e-account'`.

- [ ] **Step 3: Implement the seed**

`apps/mobile/e2e/seed/e2e-account.ts`. The API shapes are copied from `scripts/seed-people.mjs`, which already knows them: `POST /auth/register` takes `{ email, password, displayName, acceptedTermsAt, device: { label, platform } }`; `POST /sync/push` takes `{ deviceId, lastPulledAt: operations: [{ operationId, clientId, baseVersion, payload, clientTimestamp, kind, entity, entityId }] }`; entities are `workspace`, `folder`, `note`, `list`, `list_item` — **there is no `task` entity** (`packages/contracts/src/sync.ts:9`).

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export type Seeded = {
  email: string;
  password: string;
  otherEmail: string;
  spaceName: string;
  listTitle: string;
  noteTitle: string;
  workspaceId: string;
  folderId: string;
  listId: string;
  noteId: string;
};

export const PASSWORD = 'Con-un-muy-largo-secreto-1';

/** ASCII-only and with no accents: flows assert on these strings, so they must
 *  survive being written into YAML without an encoding surprise. */
export const NOMBRES = {
  spaceName: 'E2E Space',
  folderName: 'E2E Folder',
  listTitle: 'E2E List',
  noteTitle: 'E2E Note',
  otherUser: 'E2E Friend',
} as const;

export function verificationTokenFor(lineas: string[], email: string): string | null {
  const linea = lineas.filter((l) => l.includes(email) && l.includes('verify-email')).pop();
  return linea ? (/token=([A-Za-z0-9_-]+)/.exec(linea)?.[1] ?? null) : null;
}

async function call(
  api: string,
  ruta: string,
  init: { method?: string; body?: unknown; token?: string } = {},
): Promise<any> {
  const res = await fetch(`${api}${ruta}`, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const texto = await res.text();
  const json = texto ? JSON.parse(texto) : null;
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${ruta} -> ${res.status} ${texto}`);
  return json?.data ?? json;
}

/** Review Focus 4: a seed that half-succeeds is worse than one that fails. */
async function waitForToken(apiLog: string, email: string, timeoutMs = 15_000): Promise<string> {
  const limite = Date.now() + timeoutMs;
  for (;;) {
    let lineas: string[] = [];
    try {
      lineas = readFileSync(apiLog, 'utf8').split('\n');
    } catch {
      /* el log todavia no existe */
    }
    const token = verificationTokenFor(lineas, email);
    if (token) return token;
    if (Date.now() > limite) {
      throw new Error(
        `no llego el correo de verificacion de ${email} a ${apiLog}. ` +
          'La API tiene que arrancar con EMAIL_TRANSPORT=console.',
      );
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function registrar(api: string, nombre: string, apiLog: string) {
  const email = `e2e-${nombre.toLowerCase().replace(/\s+/g, '-')}-${randomUUID().slice(0, 8)}@example.com`;
  await call(api, '/auth/register', {
    method: 'POST',
    body: {
      email,
      password: PASSWORD,
      displayName: nombre,
      acceptedTermsAt: new Date().toISOString(),
      device: { label: 'E2E', platform: 'web' },
    },
  });
  await call(api, '/auth/verify-email', {
    method: 'POST',
    body: { token: await waitForToken(apiLog, email) },
  });
  const sesion = await call(api, '/auth/login', {
    method: 'POST',
    body: { email, password: PASSWORD, device: { label: 'E2E', platform: 'web' } },
  });
  if (sesion.status !== 'authenticated') {
    throw new Error(`el login de ${email} respondio ${JSON.stringify(sesion)}`);
  }
  return { email, token: sesion.session.accessToken as string, userId: (await call(api, '/auth/me', { token: sesion.session.accessToken })).id as string };
}

/**
 * One operation per push, and each one checked.
 *
 * Batched, a rejected operation comes back with `status: "rejected"` and an
 * HTTP 200 — `seed-people.mjs` records four rounds of this. A seed that walks
 * past a rejected create fails three steps later on a share of something that
 * does not exist, which is a much worse place to find out.
 */
async function push(
  api: string,
  token: string,
  deviceId: string,
  operacion: { kind: string; entity: string; entityId: string; payload: Record<string, unknown> },
): Promise<void> {
  const r = await call(api, '/sync/push', {
    method: 'POST',
    token,
    body: {
      deviceId,
      lastPulledAt: null,
      operations: [
        {
          operationId: randomUUID(),
          clientId: 'e2e-seed',
          baseVersion: 0,
          payload: {},
          clientTimestamp: new Date().toISOString(),
          ...operacion,
        },
      ],
    },
  });
  const resultado = r.results?.[0];
  if (resultado?.status !== 'applied') {
    throw new Error(`no se pudo crear ${operacion.entity} ${operacion.entityId}: ${JSON.stringify(resultado)}`);
  }
}

export async function seed(options: { api: string; apiLog: string }): Promise<Seeded> {
  const { api, apiLog } = options;
  const ana = await registrar(api, 'ana', apiLog);
  const amigo = await registrar(api, NOMBRES.otherUser, apiLog);

  const workspaceId = randomUUID();
  const folderId = randomUUID();
  const listId = randomUUID();
  const noteId = randomUUID();

  await push(api, ana.token, ana.userId, {
    kind: 'create',
    entity: 'workspace',
    entityId: workspaceId,
    payload: { name: NOMBRES.spaceName, color: 'teal' },
  });
  await push(api, ana.token, ana.userId, {
    kind: 'create',
    entity: 'folder',
    entityId: folderId,
    payload: { workspaceId, name: NOMBRES.folderName, position: 0 },
  });
  await push(api, ana.token, ana.userId, {
    kind: 'create',
    entity: 'note',
    entityId: noteId,
    payload: {
      workspaceId,
      folderId: null,
      title: NOMBRES.noteTitle,
      document: '<p>E2E body.</p>',
      tags: [],
    },
  });
  await push(api, ana.token, ana.userId, {
    kind: 'create',
    entity: 'list',
    entityId: listId,
    payload: { workspaceId, folderId, title: NOMBRES.listTitle, kind: 'tasks', position: 0 },
  });
  for (const [indice, titulo] of ['E2E Item One', 'E2E Item Two'].entries()) {
    await push(api, ana.token, ana.userId, {
      kind: 'create',
      entity: 'list_item',
      entityId: randomUUID(),
      payload: { listId, title: titulo, position: indice },
    });
  }

  // Sin esto, `people`, `shared` e `invitations` se recorren vacios y no
  // demuestran nada: es el unico motivo por el que hace falta una segunda cuenta.
  await call(api, '/shares', {
    method: 'POST',
    token: ana.token,
    body: { nodeType: 'note', nodeId: noteId, granteeUserId: amigo.userId, role: 'editor' },
  });

  return {
    email: ana.email,
    password: PASSWORD,
    otherEmail: amigo.email,
    spaceName: NOMBRES.spaceName,
    listTitle: NOMBRES.listTitle,
    noteTitle: NOMBRES.noteTitle,
    workspaceId,
    folderId,
    listId,
    noteId,
  };
}

export function writeSeedEnv(archivo: string, sembrado: Seeded): void {
  const cuerpo = Object.entries(sembrado)
    .map(([clave, valor]) => `${clave}: "${valor}"`)
    .join('\n');
  writeFileSync(archivo, `${cuerpo}\n`, 'utf8');
}
```

- [ ] **Step 4: Run the seed tests and watch them pass**

Run: `npm run test --workspace @orbit-hub/mobile -- e2e-account.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Wire the seed into the entry point and run it for real**

In `apps/mobile/e2e/run-android.ts`, inside the `try` block after the services come up, replace the `console.log(\`  API para el seed: ${API}\`)` line with:

```ts
  const sembrado = await seed({ api: API, apiLog: SALIDA_API });
  const envFile = join(CAPTURAS, 'seed.env');
  writeSeedEnv(envFile, sembrado);
  console.log(`  sembrado: ${sembrado.email} (${sembrado.spaceName})`);
  console.log(`  credenciales para los flujos: ${envFile}`);
```

Add the imports `import { seed, writeSeedEnv } from './seed/e2e-account';` at the top.

Run: `npm run e2e:android`
Expected: `sembrado: e2e-ana-XXXXXXXX@example.com (E2E Space)`, the `XXXXXXXX` being the first
eight characters of a fresh `randomUUID()`. Then check the fixtures really landed:

```bash
cd /Users/jose/code/orbit-hub
grep -c . capturas/android/seed.env && cat capturas/android/seed.env
```

Expected: nine lines, with a `workspaceId`, a `listId` and a `noteId` that are UUIDs. If the seed threw `no llego el correo de verificacion`, read `capturas/android/api.log` — the fix is `EMAIL_TRANSPORT`, not a retry.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/e2e
git commit -m "Los fixtures del recorrido, y el correo de verificacion leido del log

Una app sin datos muestra pantallas vacias, y una pantalla vacia renderiza.
Un recorrido que solo mira vacias no encuentra la mitad de los fallos,
porque el codigo que dibuja datos es justo el que se rompe.

La cuenta y la del amigo: sin un segundo usuario, people, shared e
invitations se recorren vacios y no demuestran nada.

Una operacion por push, y cada una comprobada. En lote, una operacion
rechazada vuelve con HTTP 200 y status rejected, y una siembra que solo
mira el codigo de respuesta se pasa de largo y falla tres pasos mas tarde
compartiendo algo que no existe.

Los nombres son ASCII y sin acentos porque los flujos afirman sobre ellos."
```

---

### Task 4: Maestro, one area of flows, and the runner that ties it together

This is the task where the crash guard meets a real flow. The negative test is the point: a suite that cannot go red is not a suite.

**Files:**
- Create: `apps/mobile/e2e/lib/areas.ts`
- Create: `apps/mobile/e2e/lib/areas.test.ts`
- Create: `apps/mobile/e2e/lib/maestro.ts`
- Create: `apps/mobile/e2e/maestro/config.yaml`
- Create: `apps/mobile/e2e/maestro/subflows/signed-in.yaml`
- Create: `apps/mobile/e2e/maestro/flows/01-onboarding/welcome.yaml`
- Create: `apps/mobile/e2e/maestro/flows/01-onboarding/privacy.yaml`
- Create: `apps/mobile/e2e/maestro/flows/01-onboarding/terms.yaml`
- Modify: `apps/mobile/src/app/(onboarding)/welcome.tsx` (add `testID`)
- Modify: `apps/mobile/src/app/privacy.tsx` (add `testID`)
- Modify: `apps/mobile/src/app/terms.tsx` (add `testID`)
- Modify: `apps/mobile/e2e/run-android.ts`

**Interfaces:**
- Consumes: `requireOneDevice`, `appPid`, `clearLogcat`, `crashLines`, `forceStop`, `screenshot` from `./lib/android` (Task 1); `verdict`, `Verdict` from `./lib/guard` (Task 1); `ensureService` from `./lib/stack` (Task 2); `seed`, `writeSeedEnv`, `Seeded` from `./seed/e2e-account` (Task 3).
- Produces:
  - `areas.ts`: `type Area = { name: string; dir: string; flows: string[] }`, `resolveAreas(root: string, only?: string): Area[]`, `parseAreaFlag(argv: string[]): { only?: string; flow?: string }`.
  - `maestro.ts`: `maestroBin(): string`, `runMaestro(flowsPath: string, opts: { cwd: string; env: Record<string, string>; includeTags?: string[] }): { code: number; output: string }`.
  - `run-android.ts`: CLI, and it writes `capturas/android/informe.txt`.

- [ ] **Step 1: Write the failing test for area resolution**

`apps/mobile/e2e/lib/areas.test.ts`. Review Focus 5 lives here: an empty area, or a mistyped `--area`, must not produce a green run. Both cases are exercised against a real temporary directory:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAreaFlag, resolveAreas } from './areas';

function raiz(contenido: Record<string, string[]>): string {
  const base = mkdtempSync(join(tmpdir(), 'areas-'));
  for (const [area, flujos] of Object.entries(contenido)) {
    mkdirSync(join(base, area), { recursive: true });
    for (const flujo of flujos) writeFileSync(join(base, area, flujo), 'appId: x\n');
  }
  return base;
}

describe('resolveAreas', () => {
  it('devuelve las areas en orden, con sus flujos', () => {
    const areas = resolveAreas(raiz({ '02-auth': ['sign-in.yaml'], '01-onboarding': ['welcome.yaml'] }));
    expect(areas.map((a) => a.name)).toEqual(['01-onboarding', '02-auth']);
    expect(areas[0]!.flows).toEqual(['welcome.yaml']);
  });

  it('con --area devuelve solo esa, y falla si no existe', () => {
    const base = raiz({ '01-onboarding': ['welcome.yaml'] });
    expect(resolveAreas(base, '01-onboarding').map((a) => a.name)).toEqual(['01-onboarding']);
    // Un nombre mal escrito tiene que fallar aqui, no discover la carrera en verde
    // sin haber probado nada.
    expect(() => resolveAreas(base, 'onboarding')).toThrow(/01-onboarding/);
  });

  it('una area sin flujos se_avisa, pero no se cuela como trabajo hecho', () => {
    const areas = resolveAreas(raiz({ '01-onboarding': [], '02-auth': ['sign-in.yaml'] }));
    expect(areas.find((a) => a.name === '01-onboarding')!.flows).toEqual([]);
  });
});

describe('parseAreaFlag', () => {
  it('lee --area', () => {
    expect(parseAreaFlag(['--area', '04-lists'])).toEqual({ only: '04-lists' });
  });

  it('devuelve undefined cuando no hay bandera', () => {
    expect(parseAreaFlag([])).toEqual({});
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test --workspace @orbit-hub/mobile -- areas.test.ts`
Expected: FAIL — `Cannot find module './areas'`.

- [ ] **Step 3: Implement `areas.ts`**

```ts
import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

export type Area = { name: string; dir: string; flows: string[] };

export function resolveAreas(root: string, only?: string): Area[] {
  const nombres = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  if (only !== undefined) {
    if (!nombres.includes(only)) {
      throw new Error(`no existe el area "${only}". Hay: ${nombres.join(', ') || '(ninguna)'}`);
    }
    return [area(root, only)];
  }
  return nombres.map((nombre) => area(root, nombre));
}

function area(root: string, nombre: string): Area {
  const dir = join(root, nombre);
  return {
    name: nombre,
    dir,
    flows: readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort(),
  };
}

export function parseAreaFlag(argv: string[]): { only?: string; flow?: string } {
  const salida: { only?: string; flow?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--area') salida.only = argv[i + 1];
    if (argv[i] === '--flow') salida.flow = argv[i + 1];
  }
  return salida;
}
```

- [ ] **Step 4: Run the area tests and watch them pass**

Run: `npm run test --workspace @orbit-hub/mobile -- areas.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Install Maestro and record where it lives**

```bash
curl -Ls "https://get.maestro.mobile.dev" | bash
~/.maestro/bin/maestro --version
```

Expected: a version string. Java 17 is already on this machine, which is what Maestro needs. If the install fails, stop and report it — the plan does not have a second driver.

- [ ] **Step 6: Add the three screen markers the flows need**

`privacy.tsx` and `terms.tsx` do not render `<Screen>`, so they take an explicit `testID` on their root `View`/`Text` wrapper — `screen-privacy` and `screen-terms`. `welcome.tsx` uses `<Screen>`; add `testID="screen-welcome"` to it.

One line each, kebab-case, area-prefixed, matching `screen-<name>` from the spec.

- [ ] **Step 7: Write `config.yaml`**

`apps/mobile/e2e/maestro/config.yaml`:

```yaml
appId: com.jrzlabs.orbithub
name: OrbitHub regression
tags:
  - smoke
  - gesture
executionOrder:
  ordered: true
  failOnEveryAssert: true
```

`failOnEveryAssert: true` is the setting that makes a flow stop at its first false assertion instead of pressing on and reporting a cascade.

- [ ] **Step 8: Write the three flows**

`apps/mobile/e2e/maestro/flows/01-onboarding/welcome.yaml` — the signed-out start, then the marker:

```yaml
appId: com.jrzlabs.orbithub
tags: [smoke]
---
- launchApp:
    clearState: true
- assertVisible: screen-welcome
- takeScreenshot: capturas/android/01-welcome
```

`privacy.yaml` and `terms.yaml` reach the legal screens from the welcome links; both are linked from `welcome.tsx`, so if those links have no stable marker yet, add `testID="welcome-privacy"` and `testID="welcome-terms"` to them in the same commit — a flow that has to guess a coordinate is a flow that will break silently.

```yaml
appId: com.jrzlabs.orbithub
tags: [smoke]
---
- launchApp
- assertVisible: screen-welcome
- tapOn: welcome-privacy
- assertVisible: screen-privacy
- back
- assertVisible: screen-welcome
- takeScreenshot: capturas/android/02-privacy
```

`terms.yaml` is the same shape against `welcome-terms` / `screen-terms`. Every flow ends by asserting it is back on `screen-welcome` — that is the "Salir" clause from the spec, and it is what keeps a flow from poisoning the next one (Review Focus 3).

- [ ] **Step 9: Implement `maestro.ts`**

```ts
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

export function maestroBin(): string {
  return process.env.MAESTRO_BIN ?? `${homedir()}/.maestro/bin/maestro`;
}

export function runMaestro(
  flowsPath: string,
  opts: { cwd: string; env: Record<string, string>; includeTags?: string[] },
): { code: number; output: string } {
  const bin = maestroBin();
  if (!existsSync(bin)) {
    throw new Error(
      `no encuentro Maestro en ${bin}. Instalalo con: curl -Ls "https://get.maestro.mobile.dev" | bash`,
    );
  }
  const args = ['test', '--format', 'NOOP', ...flowsPath];
  for (const tag of opts.includeTags ?? []) args.push('--include-tags', tag);
  try {
    const output = execFileSync(bin, args, {
      cwd: opts.cwd,
      encoding: 'utf8',
      env: { ...process.env, ...opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: `${err.stdout ?? ''}\n${err.stderr ?? ''}` };
  }
}
```

- [ ] **Step 10: Write the runner loop**

`apps/mobile/e2e/run-android.ts` — after the seed block, replace nothing; add this after it, still inside the `try`:

```ts
  const areas = resolveAreas(join(RAIZ, 'apps/mobile/e2e/maestro/flows'), flags.only);
  const vacias = areas.filter((a) => a.flows.length === 0);
  for (const a of vacias) console.log(`  aviso: el area ${a.name} no tiene flujos`);

  const resultados: { area: string; flows: number; maestroOk: boolean; guard: Verdict }[] = [];

  for (const area of areas) {
    // El estado y el buffer se limpian por area: sin esto, el primer area hereda
    // el pid de la anterior y el crash que dejo el ultima corrida, y se los
    // carga a el.
    forceStop(serial);
    clearLogcat(serial);
    const antes = { pid: appPid(serial) };

    const flows = flags.flow ? [join(area.dir, flags.flow)] : area.dir;
    const { code, output } = runMaestro(flows, {
      cwd: RAIZ,
      env: { ...sembrado } as Record<string, string>,
    });

    const guard = verdict(antes, { pid: appPid(serial) }, crashLines(serial));
    screenshot(serial, join(CAPTURAS, `${area.name}.png`));

    resultados.push({ area: area.name, flows: area.flows.length, maestroOk: code === 0, guard });
    const mal = !guard.ok ? guard.problems.join(' | ') : code === 0 ? 'ok' : 'Maestro fallo';
    console.log(`  ${guard.ok && code === 0 ? ' ok ' : 'FALLA'} ${area.name.padEnd(16)} ${mal}`);
    if (code !== 0) console.log(output.split('\n').slice(-15).join('\n'));
  }
```

Note `antes` is read **after** `forceStop`, so it is `null`; that is deliberate and matches the sixth guard test — there was no pid before, so there was no silent relaunch, only a crash if the app is gone after.

- [ ] **Step 11: Run the suite and watch it pass**

Run: `npm run e2e:android`
Expected: `ok 01-onboarding  ok`, and `capturas/android/informe.txt` will be written in Task 5. If Maestro reports the app is not installed, go back to Step 12 of Task 1.

- [ ] **Step 12: Prove the suite can go red — the step that matters most**

Delete `assertVisible: screen-terms` from `terms.yaml`, run `npm run e2e:android`, and confirm the run exits non-zero and names `01-onboarding`.
Expected: `FALLA 01-onboarding  Maestro fallo` and `echo $?` is `1`. Then restore the line.

If a suite cannot be observed failing on purpose, it is not yet known to work.

- [ ] **Step 13: Prove `--area` refuses a typo**

Run: `npm run e2e:android -- --area onboarding`
Expected: a thrown error listing `01-onboarding`, exit non-zero, and **no** green line for any area.

- [ ] **Step 14: Commit**

```bash
git add apps/mobile/e2e apps/mobile/src/app
git commit -m "Maestro recorre el primer area, con el guardian alrededor

Maestro no lee logcat ni ve un relanzamiento en silencio, asi que el
guardian lo rodea: limpia el buffer, para la app, anota el pid, corre el
area, y vuelve a mirar. El pid se lee despues de parar la app a proposito,
porque si no el primer area hereda el de la anterior.

resolveAreas falla cuando --area no existe. Maestro sale con codigo 0
cuando no ha probado nada, y un area mal escrita que se pasara sin
quejarse es una carrera en verde que no ha mirado la app.

El flujo termina afirmando que ha vuelto a donde empezo, para que uno que
se queda con una hoja abierta no haga fallar al siguiente.

Probado yendo a rojo a proposito: una suite que no se ha visto fallar no
se sabe que funciona."
```

---

### Task 5: The report, and writing down the rules

A run whose only artefact is a screenshot has not said where it failed. And a suite nobody knows how to extend does not get extended.

**Files:**
- Create: `apps/mobile/e2e/lib/report.ts`
- Create: `apps/mobile/e2e/lib/report.test.ts`
- Create: `apps/mobile/e2e/README.md`
- Create: `docs/architecture/e2e-regression.md`
- Create: `docs/architecture/adr/0033-regresion-e2e-android.md`
- Modify: `docs/architecture/adr/README.md` (add the row)
- Modify: `AGENTS.md` (add the obligation)
- Modify: `apps/mobile/e2e/run-android.ts`

**Interfaces:**
- Consumes: `Verdict` from `./lib/guard` (Task 1); `areas`, `maestro`, `seed` (Tasks 2, 3 and 4).
- Produces: `report.ts`: `type AreaResult = { area: string; flows: number; maestroOk: boolean; guard: Verdict }`, `renderReport(resultados: AreaResult[]): string`, `writeReport(archivo: string, resultados: AreaResult[]): void`. `renderReport` is exported separately from `writeReport` so the formatting is testable without touching the disk.

- [ ] **Step 1: Write the failing test for the report**

`apps/mobile/e2e/lib/report.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderReport } from './report';

const bien = { area: '01-onboarding', flows: 3, maestroOk: true, guard: { ok: true, problems: [] } };
const mal = {
  area: '04-lists',
  flows: 12,
  maestroOk: false,
  guard: { ok: false, problems: ['el proceso cambio (1 -> 2): relanzo en silencio'] },
};

describe('renderReport', () => {
  it('una linea por area, con su numero de flujos', () => {
    const tabla = renderReport([bien, mal]);
    expect(tabla).toContain('01-onboarding');
    expect(tabla).toContain('04-lists');
    expect(tabla).toMatch(/3\s+flujos/);
  });

  it('el area que falla dice por que, no solo que fallo', () => {
    expect(renderReport([mal])).toContain('relanzo en silencio');
  });

  it('el recuento final cuenta las areas con fallo, no los flujos', () => {
    // Una carrera con 40 flujos y un area rota es un fallo, no "39/40".
    expect(renderReport([bien, mal])).toContain('1/2 areas sin fallo');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test --workspace @orbit-hub/mobile -- report.test.ts`
Expected: FAIL — `Cannot find module './report'`.

- [ ] **Step 3: Implement `report.ts`**

The shape follows `capturas/android/pantallas.txt`, which `verify-android-screens.mjs` already writes and which is the format this repo reads:

```ts
import { writeFileSync } from 'node:fs';
import type { Verdict } from './guard';

export type AreaResult = { area: string; flows: number; maestroOk: boolean; guard: Verdict };

const ancho = (texto: string, n: number) => texto.padEnd(n).slice(0, n);

export function renderReport(resultados: AreaResult[]): string {
  const lineas = resultados.map((r) => {
    const veredicto = r.guard.ok ? (r.maestroOk ? 'PASA' : 'FALLA') : 'FALLA';
    const motivo = r.guard.ok
      ? r.maestroOk
        ? 'ok'
        : 'Maestro fallo'
      : r.guard.problems.join(' | ');
    return `${veredicto}  ${ancho(r.area, 18)}${String(r.flows).padStart(4)} flujos  ${motivo}`;
  });
  const sanas = resultados.filter((r) => r.guard.ok && r.maestroOk).length;
  lineas.push('');
  lineas.push(`${sanas}/${resultados.length} areas sin fallo`);
  return lineas.join('\n');
}

export function writeReport(archivo: string, resultados: AreaResult[]): void {
  writeFileSync(archivo, `${renderReport(resultados)}\n`, 'utf8');
}
```

- [ ] **Step 4: Run the report tests and watch them pass**

Run: `npm run test --workspace @orbit-hub/mobile -- report.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Write the report at the end of the run**

In `apps/mobile/e2e/run-android.ts`, after the area loop:

```ts
  writeReport(join(CAPTURAS, 'informe.txt'), resultados);
  console.log(`\n${renderReport(resultados)}\n`);
  process.exitCode = resultados.some((r) => !r.guard.ok || !r.maestroOk) ? 1 : 0;
```

Add `import { renderReport, writeReport } from './lib/report';` to the imports.

- [ ] **Step 6: Run it and confirm the artefact**

Run: `npm run e2e:android`
Expected: the table on stdout and `capturas/android/informe.txt` containing the same table. Confirm the file is git-ignored — `capturas/` already is.

- [ ] **Step 7: Write `apps/mobile/e2e/README.md`**

The three things a newcomer needs and cannot guess: how to run it, how to add a flow, and the `testID` convention. Include the concrete example of adding a flow for a new sheet, naming the area directory it belongs in. Keep it under 60 lines — this is a README, not the spec.

- [ ] **Step 8: Write `docs/architecture/e2e-regression.md`**

How the harness is put together and why the crash guard is a separate concern from Maestro, cross-linking the spec. One page.

- [ ] **Step 9: Write ADR 0033 and index it**

`docs/architecture/adr/0033-regresion-e2e-android.md`, following the Context / Decision / Consequences shape the ADR README specifies, covering: Maestro over Detox for a local smoke walkthrough; assertions on `testID` over text because the app is bilingual; a crash guard around Maestro because it cannot see a silent relaunch; on demand and out of CI. Add the row to `docs/architecture/adr/README.md`.

- [ ] **Step 10: Add the obligation to `AGENTS.md`**

The spec's second half. Add to the "Definition of done" section, right after the existing web check, a rule in the same voice as the existing ones: a new screen, sheet or option ships with a flow, and UI work runs `npm run e2e:android` before it is called done. Also update the existing web paragraph to note that Android now has automated coverage and iOS does not — `AGENTS.md` currently says no device is attached, which is no longer true.

- [ ] **Step 11: Run the full definition of done**

```bash
npm run typecheck
npm run test
```

Expected: both clean. `typecheck` matters more than usual here, because the new `e2e/**/*.ts` is inside `apps/mobile/tsconfig.json`'s `**/*.ts` and a stray type error in the harness would break the repo-wide check.

- [ ] **Step 12: Run the suite once more, end to end**

Run: `npm run e2e:android`
Expected: green, with `capturas/android/informe.txt` reporting every area it ran.

- [ ] **Step 13: Commit**

```bash
git add apps/mobile/e2e docs AGENTS.md
git commit -m "El informe dice donde fallo, y la obligacion queda escrita

Una carrera cuyo unico artefacto es una foto no ha dicho donde fallo. El
recuento va por areas y no por flujos: cuarenta flujos con un area rota es
un fallo, no un 39/40.

En AGENTS.md cabe al lado de la regla de la web, y de paso se corrige que
ya no es cierto que no hay ningun dispositivo conectado: hay emulador, y
Android ya tiene cobertura automatizada. iOS sigue sin ella."
```

---

## What this plan does not deliver

Phase 1 ends here, and it is worth being exact about it. **Three** of the twenty-nine screens are covered, not twenty-nine. The other twenty-six and the forty overlays are phase 2, planned after this lands. The seventeen `verify-*.mjs` scripts are **not** deleted; that is the last phase, and deleting them before the suite covers what they cover would leave a hole exactly where one is least wanted. Nothing here touches `npm run check` or CI, by design.

Two things this plan commits to that only show up later: `screen-<name>` markers on the 26 screens that render `<Screen>`, and the gesture flows that carry their own tag and report without blocking. Phase 2 builds on both.