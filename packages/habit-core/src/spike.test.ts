import { DateTime } from 'luxon';

import { RRule, SPIKE_TZ } from './spike';

const TZID = SPIKE_TZ;

/**
 * With `tzid`, rrule keeps the local wall clock of the zone in the UTC
 * components of the Date it returns, so a dtstart is built with `Date.UTC`.
 *
 * `RRule` comes from `./spike`, not from a named import of `rrule`: that named
 * import throws under Node's ESM loader and only survives on Vite's CJS interop,
 * which is a property of the runner and not of the package. The test has to
 * build its rules the way the engine will.
 */
const datetime = (year: number, month: number, day: number, hour: number, minute: number): Date =>
  new Date(Date.UTC(year, month - 1, day, hour, minute));

const mondaysAtEight = (): Date[] =>
  new RRule({
    freq: RRule.WEEKLY,
    byweekday: [RRule.MO],
    dtstart: datetime(2026, 3, 23, 8, 0),
    count: 3,
    tzid: TZID,
  }).all();

// Monday 08:00 in Europe/Madrid, the March change and the weeks around it.
it('las 08:00 siguen siendo las 08:00 los dos dias despues del cambio', () => {
  const dias = mondaysAtEight().map((d) => d.toISOString().slice(0, 10));
  expect(dias).toEqual(['2026-03-23', '2026-03-30', '2026-04-06']);
});

// What happens to the local time that does not exist, 02:30 on 2026-03-29.
// Nothing resolves it by itself; see the comments on each group of assertions.
it('una hora local inexistente: rrule la devuelve sin resolver, y el resolutor la elige', () => {
  const ocurrencias = new RRule({
    freq: RRule.WEEKLY,
    byweekday: [RRule.SU],
    dtstart: datetime(2026, 3, 22, 2, 30),
    count: 3,
    tzid: TZID,
  }).all();
  const dentro = ocurrencias[1];

  // rrule keeps the series whole and keeps the occurrence on the local day it
  // belongs to. That part of the spec ruling holds, and it holds because rrule
  // never converts anything: it hands back the wall clock it was asked for.
  expect(ocurrencias).toHaveLength(3);
  expect(ocurrencias.map((d) => d.toISOString().slice(0, 10))).toEqual([
    '2026-03-22',
    '2026-03-29',
    '2026-04-05',
  ]);

  // And the wall clock it hands back for the 29th is 02:30, an hour that does not
  // exist in Europe/Madrid. rrule does not know that, does not check it, and
  // does not move it. **The ruling is not satisfied by rrule.**
  expect(dentro?.toISOString()).toBe('2026-03-29T02:30:00.000Z');

  // Resolving it means reading those UTC components as Madrid wall clock and
  // asking Madrid for its offset. That is a step the engine has to take by hand,
  // and this is what it produces: still the 29th, 03:30 CEST.
  const comoPared = DateTime.fromObject(
    {
      year: dentro?.getUTCFullYear(),
      month: dentro?.getUTCMonth() + 1,
      day: dentro?.getUTCDate(),
      hour: dentro?.getUTCHours(),
      minute: dentro?.getUTCMinutes(),
    },
    { zone: TZID },
  );
  expect(comoPared.isValid).toBe(true);
  expect(comoPared.toFormat("yyyy-MM-dd'T'HH:mm:ssZZ")).toBe('2026-03-29T03:30:00+02:00');

  // The spec says "the first valid instant after the gap". The first valid
  // instant after the gap is 03:00; luxon gives 03:30, because it keeps the
  // minutes and shifts by the length of the jump. 03:30 is the sane answer and
  // it is not the sentence in the spec, so the sentence needs the correction.
  expect(comoPared.toFormat('HH:mm')).toBe('03:30');
  expect(
    DateTime.fromObject({ year: 2026, month: 3, day: 29, hour: 3, minute: 0 }, { zone: TZID })
      .toFormat('HH:mm'),
  ).toBe('03:00');

  // The other way to read the same Date is wrong, and not only that day. Handing
  // the `Date` over as an instant treats 02:30 as if it were UTC, so the answer
  // lands a whole offset later: 04:30 on the gap day, and 03:30 on the Sunday
  // before it, which is an ordinary day with nothing wrong with it.
  const comoInstante = DateTime.fromJSDate(dentro ?? new Date(0), { zone: TZID });
  expect(comoInstante.toFormat('HH:mm')).toBe('04:30');
  const domingoNormal = ocurrencias[0];
  expect(DateTime.fromJSDate(domingoNormal ?? new Date(0), { zone: TZID }).toFormat('HH:mm')).toBe(
    '03:30',
  );
  expect(
    DateTime.fromObject(
      {
        year: domingoNormal?.getUTCFullYear(),
        month: domingoNormal?.getUTCMonth() + 1,
        day: domingoNormal?.getUTCDate(),
        hour: domingoNormal?.getUTCHours(),
        minute: domingoNormal?.getUTCMinutes(),
      },
      { zone: TZID },
    ).toFormat('HH:mm'),
  ).toBe('02:30');
});

// The library detail that moves an hour when the zone changes.
it('los componentes locales se leen con getUTC, no con get', () => {
  const despues = mondaysAtEight()[1];

  // Pinned, because `getHours()` answers with the machine's zone and this
  // assertion is about the difference between the two readers. Without the pin
  // the test would pass or fail depending on whoever ran it.
  const previous = process.env.TZ;
  process.env.TZ = 'Europe/Madrid';
  try {
    // March 2026 in Madrid is CEST, so the device is two hours ahead of UTC and
    // the two readers disagree by exactly that.
    expect(despues?.getUTCHours()).toBe(8);
    expect(despues?.getHours()).toBe(10);
    expect(despues?.getHours()).not.toBe(despues?.getUTCHours());
  } finally {
    if (previous === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previous;
    }
  }

  // On a UTC machine the two readers agree, which is what makes the first pair
  // meaningful: the gap is the device's zone, not the occurrence.
  process.env.TZ = 'UTC';
  try {
    expect(despues?.getHours()).toBe(despues?.getUTCHours());
  } finally {
    if (previous === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previous;
    }
  }

  // And what `getHours` would have cost: the same wall clock is 06:00Z once the
  // zone has been asked for its offset.
  const real = DateTime.fromObject(
    {
      year: despues?.getUTCFullYear(),
      month: despues?.getUTCMonth() + 1,
      day: despues?.getUTCDate(),
      hour: despues?.getUTCHours(),
      minute: despues?.getUTCMinutes(),
    },
    { zone: TZID },
  );
  expect(real.toUTC().toISO()).toBe('2026-03-30T06:00:00.000Z');
  expect(real.offset).toBe(120);
});
