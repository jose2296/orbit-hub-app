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