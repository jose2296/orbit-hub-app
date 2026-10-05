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
 * The versions of the two libraries this spike is a measurement **of**, read from
 * the `package.json` that ships inside them, so they are an observation of the code
 * that is loaded and not a claim about the lockfile.
 *
 * That difference is the whole reason this import is here. `rrule` lives in the
 * root `node_modules`, which is outside the `watchFolders` of `apps/mobile`, so
 * after an `npm i` a reload can serve a bundle that still carries the previous
 * `rrule` while `package-lock.json` already says the new one. Sealing the record
 * with the lockfile stamps a version over a measurement that was taken with a
 * different one, and nothing in the repository could ever tell.
 *
 * Getting this to resolve in all three environments took the two constraints the
 * ADR already records about `rrule`:
 *
 * - **Node ESM** needs the `with { type: 'json' }` attribute, or the import is
 *   refused with `ERR_IMPORT_ATTRIBUTE_MISSING`. Both subpaths are legal: `rrule`
 *   publishes no `exports` map, so Node falls back to the filesystem, and `luxon`
 *   publishes `"./package.json"` explicitly.
 * - **Metro, web and native**, transform the same line to
 *   `require("rrule/package.json")` — the React Native Babel preset strips the
 *   attribute — and inline the JSON at bundle time. So in the browser and in Hermes
 *   this reports the version that is inside *that* bundle, which is exactly the
 *   value a `--record` has to seal.
 *
 * Neither line is a literal. A version written by hand here would be the very defect
 * this is fixing: an assertion that can drift from the code without anything
 * noticing.
 */
import luxonPackage from 'luxon/package.json' with { type: 'json' };
import rrulePackage from 'rrule/package.json' with { type: 'json' };

/**
 * `rrule` 2.8.1 arrives in three different shapes depending on who is loading
 * it, and this spike exists because of it:
 *
 * - Node's ESM loader ignores `module` (rrule ships no `exports` map) and reads
 *   `main`, a CommonJS bundle whose named exports its lexer cannot see. There,
 *   `import { RRule } from 'rrule'` throws
 *   `Named export 'RRule' not found. The requested module 'rrule' is a
 *   CommonJS module`.
 * - Expo's Metro resolves `browser, module, main` on **web**, so the browser
 *   gets `dist/esm/index.js`: a real ES module with named exports and no default.
 * - The same Metro resolves `react-native, browser, main` on **native**, so
 *   Hermes gets `dist/es5/rrule.js`, the CommonJS bundle again.
 *
 * Unwrapping the namespace by hand is the one form that holds in all three: the
 * namespace itself when the bundler picked the ES module, its `default` when the
 * loader picked CommonJS.
 *
 * Exported so the test builds its rules through this same path. A test that
 * imported `{ RRule }` directly would pass on Vite's CJS interop and prove
 * nothing about Node, Hermes or the browser.
 */
const rrule = (rruleNamespace as { default?: typeof rruleNamespace }).default ?? rruleNamespace;

export const { RRule } = rrule;

export const SPIKE_TZ = 'Europe/Madrid';

/**
 * With `tzid`, rrule hands back an occurrence as the **local wall clock** of that
 * zone, stored in the UTC components of a `Date`, with the offset *not* applied.
 * 08:00 in Madrid comes back as `08:00Z`, which is not an instant: it is a wall
 * clock that happens to be spelled in UTC. So a dtstart is built with `Date.UTC`.
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
 * Turning a wall clock into an instant takes an explicit step, and there are two
 * ways to do it. They do not agree, and which one you pick decides what hour the
 * person is reminded at:
 *
 * - `readAsWallClock` takes the UTC components as the local time in the zone and
 *   asks the zone for its offset. This is the correct reading.
 * - `readAsInstant` hands the `Date` over as an instant, which reads the wall
 *   clock as if it were already UTC, so the answer lands a whole offset later.
 *
 * Both are measured for a day that exists and for the day inside the gap.
 */
const readAsWallClock = (occurrence: Date): DateTime =>
  DateTime.fromObject(
    {
      year: occurrence.getUTCFullYear(),
      month: occurrence.getUTCMonth() + 1,
      day: occurrence.getUTCDate(),
      hour: occurrence.getUTCHours(),
      minute: occurrence.getUTCMinutes(),
      second: occurrence.getUTCSeconds(),
    },
    { zone: SPIKE_TZ },
  );

const readAsInstant = (occurrence: Date): DateTime =>
  DateTime.fromJSDate(occurrence, { zone: SPIKE_TZ });

/**
 * luxon types `toISO()` as `string | null`, and a `null` inside a measurement is
 * worse than a crash: it would be frozen into the committed record as data and
 * read later as a result.
 */
const iso = (value: DateTime): string => {
  const text = value.toISO();
  if (text === null) {
    throw new Error(`spike got an invalid DateTime in ${SPIKE_TZ}: ${value.toString()}`);
  }
  return text;
};

type Reading = {
  /** What rrule returned: a wall clock, offset not applied. */
  rruleOccurrence: string;
  readAsInstant: string;
  readAsInstantLocal: string;
  readAsWallClock: string;
  readAsWallClockLocal: string;
  readAsWallClockOffsetMinutes: number;
};

const reading = (occurrence: Date): Reading => {
  const asInstant = readAsInstant(occurrence);
  const asWallClock = readAsWallClock(occurrence);
  return {
    rruleOccurrence: occurrence.toISOString(),
    readAsInstant: iso(asInstant),
    readAsInstantLocal: asInstant.toFormat("yyyy-MM-dd'T'HH:mm"),
    readAsWallClock: iso(asWallClock),
    readAsWallClockLocal: asWallClock.toFormat("yyyy-MM-dd'T'HH:mm"),
    readAsWallClockOffsetMinutes: asWallClock.offset,
  };
};

/**
 * Everything in here must be byte-identical in Node, in the browser and in
 * Hermes. If two environments disagree on any of it, the combination is not
 * usable and Task 1 stops. The record of the three observations is committed in
 * `docs/architecture/adr/0033-recurrencia-con-rrule-y-luxon.md`, and the test
 * checks this run against it.
 */
export function spikeResult(): Record<string, unknown> {
  const mondays = mondaysAtEight();
  const sundays = sundaysAtHalfPastTwo();
  // Two days after the March change: Europe/Madrid is on CEST (UTC+2) from
  // 2026-03-29, and 08:00 has to stay 08:00.
  const [, afterChange] = first3(mondays);
  const [beforeGap, insideGap, afterGap] = first3(sundays);

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
      // 2026-03-22, a Sunday that happens.
      controlDay: reading(beforeGap),
      // 2026-03-29, 02:30 does not exist: the clock jumps 02:00 -> 03:00.
      gapDay: reading(insideGap),
      // 2026-04-05, on CEST, to show the reading is not right by accident once.
      weekAfterGap: reading(afterGap),
    },
    probe3_mondayAfterTheChange: {
      ...reading(afterChange),
      utcYear: afterChange.getUTCFullYear(),
      utcMonth: afterChange.getUTCMonth() + 1,
      utcDate: afterChange.getUTCDate(),
      utcHour: afterChange.getUTCHours(),
    },
  };
}

/**
 * Where the code is running, and the reading that depends on the device clock.
 * `getHours()` cannot go in `spikeResult`: it answers with whatever zone the
 * machine is set to, so two machines would compute two fingerprints. The test
 * pins `TZ` and asserts the difference there instead.
 */
export function spikeLibraryVersions(): { rrule: string; luxon: string } {
  return { rrule: rrulePackage.version, luxon: luxonPackage.version };
}

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
    /**
     * The versions of the libraries this run actually holds, read from inside them.
     * This is what lets `--record` seal the measurement instead of the lockfile.
     */
    libraryVersions: spikeLibraryVersions(),
    hasIntl: typeof Intl !== 'undefined',
    hasFormatToParts:
      typeof Intl !== 'undefined' &&
      typeof Intl.DateTimeFormat.prototype.formatToParts === 'function',
    timeZoneRoundTrip: intl ? intl.resolvedOptions().timeZone : null,
    deviceTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    getHours: afterChange.getHours(),
    getUTCHours: afterChange.getUTCHours(),
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
