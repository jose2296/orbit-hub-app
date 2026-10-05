/**
 * Task 1 spike: does `rrule` + `luxon` compute timezone-aware recurrences on
 * Hermes (React Native's engine) and on the browser, with the same answer Node
 * gives?
 *
 * This file is temporary. Task 2 replaces it with the real engine.
 */
import { DateTime } from 'luxon';
import * as rruleNamespace from 'rrule';

/**
 * `rrule` 2.8.1 arrives in three different shapes depending on who is loading
 * it, and this spike exists because of it:
 *
 * - Node's ESM loader ignores `module` (rrule ships no `exports` map) and reads
 *   `main`, a CommonJS bundle whose named exports its lexer cannot see. There,
 *   `import { RRule } from 'rrule'` throws "does not provide an export named".
 * - Expo's Metro resolves `browser, module, main` on **web**, so the browser
 *   gets `dist/esm/index.js`: a real ES module with named exports and no default.
 * - The same Metro resolves `react-native, browser, main` on **native**, so
 *   Hermes gets `dist/es5/rrule.js`, the CommonJS bundle again.
 *
 * Unwrapping the namespace by hand is the one form that holds in all three: the
 * namespace itself when the bundler picked the ES module, its `default` when the
 * loader picked CommonJS.
 */
const rrule = (rruleNamespace as { default?: typeof rruleNamespace }).default ?? rruleNamespace;

const { RRule } = rrule;

export const SPIKE_TZ = 'Europe/Madrid';

/**
 * With `tzid`, rrule keeps an occurrence as the *local wall clock* of that
 * zone: the Date it hands back carries the zone's wall time in its UTC
 * components and the offset is not applied to it. So a dtstart is built with
 * `Date.UTC`, not with the machine's local constructor.
 */
const wall = (year: number, month: number, day: number, hour: number, minute: number): Date =>
  new Date(Date.UTC(year, month - 1, day, hour, minute));

const mondaysAtEight = (): Date[] =>
  new RRule({
    freq: RRule.WEEKLY,
    byweekday: [RRule.MO],
    dtstart: wall(2026, 3, 23, 8, 0),
    count: 3,
    tzid: SPIKE_TZ,
  }).all();

const sundaysAtHalfPastTwo = (): Date[] =>
  new RRule({
    freq: RRule.WEEKLY,
    byweekday: [RRule.SU],
    dtstart: wall(2026, 3, 22, 2, 30),
    count: 3,
    tzid: SPIKE_TZ,
  }).all();

/**
 * The rules above ask for three occurrences, so reading them by index is safe.
 * `noUncheckedIndexedAccess` still types it as possibly undefined, and the
 * spike is not the place to argue with the compiler: a missing occurrence is a
 * real failure and has to say so.
 */
const first3 = (dates: Date[]): [Date, Date, Date] => {
  const [a, b, c] = dates;
  if (!a || !b || !c) {
    throw new Error(`spike expected three occurrences, got ${dates.length}`);
  }
  return [a, b, c];
};

/**
 * Everything in here must be byte-identical in Node, in the browser and in
 * Hermes. If two environments disagree on any of it, the combination is not
 * usable and Task 1 stops.
 */
export function spikeResult(): Record<string, unknown> {
  const mondays = mondaysAtEight();
  const sundays = sundaysAtHalfPastTwo();
  // Two days after the March change: Europe/Madrid is on CEST (UTC+2) from
  // 2026-03-29, and 08:00 has to stay 08:00.
  const [, afterChange] = first3(mondays);
  // 2026-03-29 is the Sunday inside the gap.
  const [, inTheGap] = first3(sundays);

  // The same wall time, resolved as a real instant by luxon, is 06:00Z.
  const realInstant = DateTime.fromObject(
    { year: 2026, month: 3, day: 30, hour: 8, minute: 0 },
    { zone: SPIKE_TZ },
  );

  // 02:30 on 2026-03-29 never happens in Europe/Madrid: the clock jumps from
  // 02:00 to 03:00. The spec ruled that the occurrence is not dropped and falls
  // on the first valid instant after the gap.
  const gapWall = DateTime.fromObject(
    { year: 2026, month: 3, day: 29, hour: 2, minute: 30 },
    { zone: SPIKE_TZ },
  );

  return {
    probe1_mondaysAtEight: {
      iso: mondays.map((d) => d.toISOString()),
      dates: mondays.map((d) => d.toISOString().slice(0, 10)),
      utcHours: mondays.map((d) => d.getUTCHours()),
    },
    probe2_sundaysInTheGap: {
      iso: sundays.map((d) => d.toISOString()),
      dates: sundays.map((d) => d.toISOString().slice(0, 10)),
      utcHours: sundays.map((d) => d.getUTCHours()),
      gapOccurrenceLocalDay: inTheGap.toISOString().slice(0, 10),
      gapResolvedByLuxon: gapWall.isValid ? gapWall.toISO() : null,
      gapOffsetMinutes: gapWall.isValid ? gapWall.offset : null,
    },
    probe3_localComponentsReadWithGetUtc: {
      iso: afterChange.toISOString(),
      utcHour: afterChange.getUTCHours(),
      utcMonth: afterChange.getUTCMonth() + 1,
      utcDate: afterChange.getUTCDate(),
      realInstantIso: realInstant.toUTC().toISO(),
      realInstantOffsetMinutes: realInstant.offset,
      wallTimeReadAsUtc: DateTime.fromJSDate(afterChange, { zone: 'utc' }).toISO(),
      madridWallTimeIso: realInstant.toFormat("yyyy-MM-dd'T'HH:mm:ssZZ"),
    },
  };
}

/**
 * Fingerprint of where the code is running, plus the reading that is *expected*
 * to differ: `getHours()` answers with the device's own offset, which is why the
 * engine reads the UTC components instead.
 */
export function spikeEnv(): Record<string, unknown> {
  const scope = globalThis as {
    HermesInternal?: unknown;
    document?: unknown;
  };
  const engine =
    scope.HermesInternal != null ? 'hermes' : scope.document != null ? 'browser' : 'node';

  const intl =
    typeof Intl === 'undefined'
      ? null
      : new Intl.DateTimeFormat('en-US', { timeZone: SPIKE_TZ });
  const [, afterChange] = first3(mondaysAtEight());

  return {
    engine,
    hasIntl: typeof Intl !== 'undefined',
    hasFormatToParts:
      typeof Intl !== 'undefined' &&
      typeof Intl.DateTimeFormat.prototype.formatToParts === 'function',
    timeZoneRoundTrip: intl ? intl.resolvedOptions().timeZone : null,
    localGetHours: afterChange.getHours(),
    localGetUTCHours: afterChange.getUTCHours(),
    deviceTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/**
 * FNV-1a over the canonical JSON, so the three environments can be compared by
 * reading eight characters in a terminal instead of eyeballing twelve hundred.
 */
export function spikeFingerprint(): string {
  const json = JSON.stringify(spikeResult());
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export const SPIKE_RESULT_LINE = (): string => `SPIKE_RESULT ${JSON.stringify(spikeResult())}`;
export const SPIKE_FINGERPRINT_LINE = (): string => `SPIKE_FINGERPRINT ${spikeFingerprint()}`;
export const SPIKE_ENV_LINE = (): string => `SPIKE_ENV ${JSON.stringify(spikeEnv())}`;
