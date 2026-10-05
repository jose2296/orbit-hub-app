import { DateTime } from 'luxon';
import { RRule } from 'rrule';

import { spikeFingerprint, spikeResult } from './spike';

const TZID = 'Europe/Madrid';

/**
 * With `tzid`, rrule keeps the local wall clock of the zone in the UTC
 * components of the Date it returns, so a dtstart is built with `Date.UTC`.
 */
const datetime = (year: number, month: number, day: number, hour: number, minute: number): Date =>
  new Date(Date.UTC(year, month - 1, day, hour, minute));

// Monday 08:00 in Europe/Madrid across the March change.
// 2026-03-29 is the last Sunday of March: the clock jumps from 02:00 to 03:00.
it('las 08:00 siguen siendo las 08:00 los dos dias despues del cambio', () => {
  // `count` is not optional decoration: rrule's `all()` iterates forever when
  // neither `count` nor `until` bounds the rule, so a rule without them does not
  // fail a test, it hangs the run.
  const rule = new RRule({
    freq: RRule.WEEKLY,
    byweekday: [RRule.MO],
    dtstart: datetime(2026, 3, 23, 8, 0),
    count: 3,
    tzid: TZID,
  });
  const dias = rule.all().map((d) => d.toISOString().slice(0, 10));
  expect(dias).toEqual(['2026-03-23', '2026-03-30', '2026-04-06']);
});

// A local time that does not exist: 02:30 on the Sunday of March.
// Ruled in the spec: the occurrence is not dropped, it lands on the first valid
// instant after the gap.
it('una hora local inexistente cae en el primer instante valido', () => {
  const rule = new RRule({
    freq: RRule.WEEKLY,
    byweekday: [RRule.SU],
    dtstart: datetime(2026, 3, 22, 2, 30),
    count: 3,
    tzid: TZID,
  });
  const ocurrencias = rule.all();

  // The series is not cut by the gap.
  expect(ocurrencias).toHaveLength(3);
  expect(ocurrencias.map((d) => d.toISOString().slice(0, 10))).toEqual([
    '2026-03-22',
    '2026-03-29',
    '2026-04-05',
  ]);

  // The gap does not push the occurrence onto the 30th.
  expect(ocurrencias[1]?.toISOString().slice(0, 10)).toBe('2026-03-29');
  expect(ocurrencias[1]?.getUTCHours()).toBe(2);

  // Read as a real instant, 02:30 on the 29th does not exist, and luxon moves
  // it forward past the jump instead of dropping it.
  const hueco = DateTime.fromObject(
    { year: 2026, month: 3, day: 29, hour: 2, minute: 30 },
    { zone: TZID },
  );
  expect(hueco.isValid).toBe(true);
  expect(hueco.toISO()).toBe('2026-03-29T03:30:00.000+02:00');
});

// The library detail that makes an hour fire twice a year.
it('los componentes locales se leen con getUTC, no con get', () => {
  const rule = new RRule({
    freq: RRule.WEEKLY,
    byweekday: [RRule.MO],
    dtstart: datetime(2026, 3, 23, 8, 0),
    count: 3,
    tzid: TZID,
  });
  const despues = rule.all()[1];

  // rrule returns the instant with the zone's wall time already in it, so the
  // local components live in the UTC accessors. Reading with getHours() would
  // give the device's own offset and fire an hour off twice a year.
  expect(despues?.getUTCHours()).toBe(8);
  expect(despues?.getUTCMonth()).toBe(2);
  expect(despues?.getUTCDate()).toBe(30);
  expect(despues?.toISOString()).toBe('2026-03-30T08:00:00.000Z');

  // The same wall time as a real instant: Europe/Madrid is on CEST by then, so
  // 08:00 local is 06:00Z. That conversion is luxon's job, not rrule's.
  const real = DateTime.fromObject(
    { year: 2026, month: 3, day: 30, hour: 8, minute: 0 },
    { zone: TZID },
  );
  expect(real.toUTC().toISO()).toBe('2026-03-30T06:00:00.000Z');
  expect(real.offset).toBe(120);
});

// The contract Step 5 checks by hand. Node produced this line; the browser and
// Hermes have to produce the same one, byte for byte, and the spike module
// imports `rrule` through the interop shim rather than a plain named import, so
// this also runs that shim under vitest.
it('el resultado canonico es el mismo en los tres entornos', () => {
  expect(JSON.stringify(spikeResult())).toBe(
    '{"probe1_mondaysAtEight":{"iso":["2026-03-23T08:00:00.000Z","2026-03-30T08:00:00.000Z","2026-04-06T08:00:00.000Z"],"dates":["2026-03-23","2026-03-30","2026-04-06"],"utcHours":[8,8,8]},' +
      '"probe2_sundaysInTheGap":{"iso":["2026-03-22T02:30:00.000Z","2026-03-29T02:30:00.000Z","2026-04-05T02:30:00.000Z"],"dates":["2026-03-22","2026-03-29","2026-04-05"],"utcHours":[2,2,2],"gapOccurrenceLocalDay":"2026-03-29","gapResolvedByLuxon":"2026-03-29T03:30:00.000+02:00","gapOffsetMinutes":120},' +
      '"probe3_localComponentsReadWithGetUtc":{"iso":"2026-03-30T08:00:00.000Z","utcHour":8,"utcMonth":3,"utcDate":30,"realInstantIso":"2026-03-30T06:00:00.000Z","realInstantOffsetMinutes":120,"wallTimeReadAsUtc":"2026-03-30T08:00:00.000Z","madridWallTimeIso":"2026-03-30T08:00:00+02:00"}}',
  );

  // The eight characters the browser and Hermes are compared on.
  expect(spikeFingerprint()).toBe('78cfdbfb');
});
