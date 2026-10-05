import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { DateTime } from 'luxon';

import {
  installedVersions as readInstalledVersions,
  sameVersions,
  stampText,
  unheldEntries,
  unheldReport,
} from '../scripts/record-holds.mjs';
import { RRule, SPIKE_TZ, spikeEnv, spikeFingerprint, spikeResult } from './spike';

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

/**
 * The three-environment record committed in
 * `docs/architecture/adr/0033-recurrencia-con-rrule-y-luxon.md`.
 *
 * What this can and cannot do, so the title is not a lie: it runs in Node, so it
 * can only ever *check Node*. What it does check is that the code and the record
 * have not drifted apart — which is the failure that actually happens, because
 * the code changes on every commit and the browser and Hermes measurements do
 * not. The other two environments are declared by the record and are verified by
 * `npm run spike:verify --workspace @orbit-hub/habit-core -- hermes`, which is
 * the only thing in the repository able to observe them.
 */
const ADR = new URL(
  '../../../docs/architecture/adr/0033-recurrencia-con-rrule-y-luxon.md',
  import.meta.url,
);
const LOCK = new URL('../../../package-lock.json', import.meta.url);

type Recorded = {
  environments: Record<
    string,
    {
      engine: string;
      fingerprint: string | null;
      verifiedWith?: { rrule?: string; luxon?: string } | null;
      recheck?: string | null;
    }
  >;
  result: Record<string, unknown>;
  gap: Record<string, unknown>;
  rrule?: string;
  luxon?: string;
};

/**
 * The record is the single fenced ```json block of the ADR. Every way this can
 * go wrong gets its own message: a record that does not load is not a record, and
 * a test that compares against `undefined` looks like a passing test.
 */
const recordedEvidence = (): Recorded => {
  const path = fileURLToPath(ADR);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(
      `cannot read the three-environment record at ${path} (${(error as Error).message}). ` +
        'Without it the library choice in ADR 0033 is a claim with nothing behind it.',
    );
  }

  const blocks = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)];
  if (blocks.length !== 1) {
    throw new Error(
      `${path} has ${blocks.length} fenced json blocks, expected exactly 1. ` +
        'The record has to be unambiguous to be checkable.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(blocks[0]?.[1] ?? '');
  } catch (error) {
    throw new Error(
      `${path}: the json block does not parse (${(error as Error).message}). ` +
        'Fix the record; nothing can be compared against a record that will not load.',
    );
  }
  return parsed as Recorded;
};

/**
 * Las versiones instaladas, con el mismo error con el que las lee el verificador:
 * la regla vive en `scripts/record-holds.mjs` y aqui no hay una segunda copia.
 */
const installedVersions = (): { rrule: string; luxon: string } => {
  try {
    return readInstalledVersions(LOCK);
  } catch (error) {
    throw new Error((error as Error).message);
  }
};

it('el registro de los tres entornos sigue cuadrando con lo que calcula Node', () => {
  const record = recordedEvidence();

  // A fingerprint of null is a hole in the record, and a hole is not a passing
  // check: it is the state this ADR was committed in once already.
  const missing = Object.entries(record.environments ?? {})
    .filter(([, e]) => e.fingerprint === null || e.fingerprint === undefined)
    .map(([name]) => name);
  expect(
    missing,
    `these environments have no fingerprint in ADR 0033: ${missing.join(', ')}. ` +
      'Measure them and write the number down.',
  ).toEqual([]);

  expect(Object.keys(record.environments ?? {}).sort()).toEqual([
    'browser',
    'hermes',
    'node',
  ]);
  expect(record.environments.node?.engine).toBe(spikeEnv().engine);

  // This run, against the Node observation in the record.
  expect(spikeFingerprint()).toBe(record.environments.node?.fingerprint);

  // The claim the ADR makes — that all three agree — asserted over the committed
  // data instead of over somebody's memory of three consoles.
  const recorded = Object.values(record.environments ?? {}).map((e) => e.fingerprint);
  expect([...new Set(recorded)], `the record holds these fingerprints: ${recorded.join(', ')}`).toHaveLength(1);

  // The record also carries the full canonical result and the gap measurements,
  // so a change in the maths that nobody re-recorded fails here.
  expect(JSON.stringify(spikeResult())).toBe(JSON.stringify(record.result));
  expect(JSON.stringify(spikeResult().probe2_sundaysInTheGap)).toBe(JSON.stringify(record.gap));
});

/**
 * Lo que hacia el registro antes de que existiera `verifiedWith` y `recheck`:
 * `--refresh` escribia la huella de Node y dejaba los otros dos "as recorded".
 * Subir `rrule`, correr `--refresh` y tener la suite en verde era posible, y el
 * registro pasaba a decir que los tres coincidian cuando lo unico comprobado era
 * uno. Estos dos tests son la diferencia: el primero mira el registro de verdad, el
 * segundo comprueba que la regla que decide dice lo que dice.
 */
it('el registro dice con que librerias se midio cada entorno, y no deja ninguno sin remedir', () => {
  const record = recordedEvidence();
  const versions = installedVersions();

  // La libreria que se nombra arriba es la que hay instalada. Una subida sin
  // remedir rompe aqui, antes incluso de comparar huellas.
  expect(
    { rrule: record.rrule, luxon: record.luxon },
    `ADR 0033 says rrule@${record.rrule}, luxon@${record.luxon} and this checkout has ` +
      `rrule@${versions.rrule}, luxon@${versions.luxon}. Re-measure all three environments ` +
      'and record them: `npm run spike:verify --workspace @orbit-hub/habit-core -- --refresh`, ' +
      'then `hermes --record` and `browser --record`.',
  ).toEqual(versions);

  // Y cada entrada dice con que versiones se midio ella, no solo el registro entero.
  const stale = Object.entries(record.environments ?? {})
    .filter(([, entry]) => !sameVersions(entry.verifiedWith, versions))
    .map(([name, entry]) => `${name}: ${stampText(entry.verifiedWith)}`);
  expect(
    stale,
    `these environments were not measured with rrule@${versions.rrule}, luxon@${versions.luxon}: ` +
      `${stale.join(' | ')}.`,
  ).toEqual([]);

  // Una entrada marcada pendiente es una entrada que alguien tiene que remedir, y
  // por lo tanto el registro no aguanta. La marca es derivada: no se acumula, asi
  // que tampoco se puede poner a mano para dejarse de ver.
  const pending = unheldEntries(record.environments, versions, record.environments.node?.fingerprint);
  expect(pending.map(({ name }) => name), unheldReport(pending)).toEqual([]);
});

/**
 * La regla de arriba, con registros inventados, para que este test no dependa de
 * que el estado bueno del repositorio se parezca al de un fallo: si la regla no
 * detectase nada, este test seguiria en verde con el registro bueno.
 */
it('una entrada medida con otra libreria, o cuya huella no es la de Node, no aguanta', () => {
  const versions = { rrule: '2.8.1', luxon: '3.7.2' };
  const entry = (extra: Record<string, unknown>) => ({
    fingerprint: '2f6ae9c6',
    verifiedWith: versions,
    recheck: null,
    ...extra,
  });
  const environments = {
    node: entry({}),
    browser: entry({}),
    hermes: entry({}),
  };
  const names = (pending: { name: string }[]) => pending.map(({ name }) => name);

  // Lo bueno: los tres medidos con lo mismo y de acuerdo.
  expect(names(unheldEntries(environments, versions, '2f6ae9c6'))).toEqual([]);

  // Una subida de rrule que solo se ha propagado a Node, que es exactamente lo que
  // hacia `--refresh`.
  expect(
    names(
      unheldEntries(
        {
          ...environments,
          node: entry({ verifiedWith: { rrule: '2.8.2', luxon: '3.7.2' } }),
        },
        { rrule: '2.8.2', luxon: '3.7.2' },
        '2f6ae9c6',
      ),
    ),
  ).toEqual(['browser', 'hermes']);

  // Y la forma que no es una subida de libreria: la huella de Node se movio y los
  // otros dos siguen con la anterior, que es lo que hace `--refresh` cuando cambia
  // el resultado sin que cambie la version.
  expect(
    names(
      unheldEntries(
        { ...environments, node: entry({ fingerprint: '11111111' }) },
        versions,
        '11111111',
      ),
    ),
  ).toEqual(['browser', 'hermes']);

  // El motivo nombra la version, que es lo que hay que ir a medir.
  expect(
    unheldEntries(
      { ...environments, browser: entry({ verifiedWith: { rrule: '2.7.0', luxon: '3.7.2' } }) },
      versions,
      '2f6ae9c6',
    )[0]?.reasons.join(' '),
  ).toContain('rrule@2.7.0');
});
