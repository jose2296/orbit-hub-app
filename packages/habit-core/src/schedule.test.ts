/**
 * Tests de `scheduledDates`, `periodBounds`, `todayIn` y la conversion de
 * ocurrencias. Los casos de `scheduledDates` y `periodBounds` los fija el plan
 * de la Task 2; la conversion fija la regla 1 del motor (nunca `fromJSDate`).
 */
import { DateTime } from 'luxon';

import {
  occurrenceToDateTime,
  occurrenceToLocalDate,
  periodBounds,
  scheduledDates,
  todayIn,
} from './schedule';

const MADRID = 'Europe/Madrid';

// La ventana manda, no la regla.
it('solo devuelve lo que cae entre from y to', () => {
  expect(scheduledDates({ kind: 'rrule', rule: 'FREQ=DAILY' }, '2026-03-01', '2026-03-05', MADRID)).toEqual([
    '2026-03-01',
    '2026-03-02',
    '2026-03-03',
    '2026-03-04',
    '2026-03-05',
  ]);
});

// Frecuencia anual SIN UNTIL con ventana acotada: la expansion termina porque
// la acota la ventana con `between`, no porque la regla traiga tope.
it('una FREQ=YEARLY sin UNTIL no se cuelga con la ventana acotada', () => {
  expect(scheduledDates({ kind: 'rrule', rule: 'FREQ=YEARLY' }, '2026-01-01', '2027-01-01', MADRID)).toEqual([
    '2026-01-01',
    '2027-01-01',
  ]);
});

// El dia que no existe en el calendario se salta en silencio, sin lanzar.
it('un dia que no existe en el mes se salta en silencio', () => {
  expect(
    scheduledDates(
      { kind: 'rrule', rule: 'FREQ=MONTHLY;BYMONTHDAY=31' },
      '2026-02-01',
      '2026-03-31',
      MADRID,
    ),
  ).toEqual(['2026-03-31']);
});

/**
 * Bucle de seguridad: la ventana de 10 anos da miles de fechas, no millones.
 * Son 3654 y no 3653: 365 * 10 dias, mas 3 bisiestos (2020, 2024 y 2028), mas
 * 1 porque `to` es inclusivo. El plan decia 3653 por un off-by-one (conto el
 * intervalo sin el dia final); medido en Node, `between` inclusivo devuelve
 * 3654. Se fija el numero exacto para que cualquier cambio de semantica del
 * borde rompa aqui y no en un habito.
 */
it('acota la expansion', () => {
  const dates = scheduledDates({ kind: 'rrule', rule: 'FREQ=DAILY' }, '2020-01-01', '2030-01-01', 'UTC');
  expect(dates).toHaveLength(3654);
  expect(dates[0]).toBe('2020-01-01');
  expect(dates[dates.length - 1]).toBe('2030-01-01');
  expect(new Set(dates).size).toBe(dates.length);
});

// Varios dias por semana salen ordenados de forma ascendente.
it('ordena de forma ascendente', () => {
  expect(
    scheduledDates(
      { kind: 'rrule', rule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' },
      '2026-03-23',
      '2026-03-30',
      MADRID,
    ),
  ).toEqual(['2026-03-23', '2026-03-25', '2026-03-27', '2026-03-30']);
});

// Regla 4, segunda mitad: una regla patologica lanza en vez de colgar el hilo.
// FREQ=MINUTELY en 10 anos serian millones de ocurrencias; el tope duro frena
// la iteracion con el callback de `between` y el error dice cual es la regla,
// cuantas iteraciones aguanta y que ventana se pidio.
it('una regla patologica lanza en vez de colgar', () => {
  expect(() =>
    scheduledDates({ kind: 'rrule', rule: 'FREQ=MINUTELY' }, '2020-01-01', '2030-01-01', 'UTC'),
  ).toThrow(/FREQ=MINUTELY.*100000.*2020-01-01.*2030-01-01.*patologica/s);
});

// La otra cara del tope: FREQ=HOURLY en 30 dias son 720 ocurrencias, muy por
// debajo del tope, asi que no lanza y da los 30 dias. La ventana es corta a
// proposito: con 10 anos serian unas 87 mil ocurrencias (~4 s solo este test,
// al borde del testTimeout de vitest) para demostrar lo mismo.
it('una frecuencia alta legitima no roza el tope', () => {
  const dates = scheduledDates({ kind: 'rrule', rule: 'FREQ=HOURLY' }, '2026-03-01', '2026-03-30', 'UTC');
  expect(dates).toHaveLength(30);
  expect(dates[0]).toBe('2026-03-01');
  expect(dates[dates.length - 1]).toBe('2026-03-30');
});

// COUNT limita desde el dtstart fijo (el dia `from`), no desde cuando se invento la regla.
it('respeta COUNT', () => {
  expect(
    scheduledDates({ kind: 'rrule', rule: 'FREQ=DAILY;COUNT=3' }, '2026-03-01', '2026-03-31', MADRID),
  ).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
});

// UNTIL corta la serie aunque la ventana siga. En UTC para que la aritmetica
// del corte sea exacta sin offsets de por medio.
it('respeta UNTIL', () => {
  expect(
    scheduledDates(
      { kind: 'rrule', rule: 'FREQ=DAILY;UNTIL=20260305T000000Z' },
      '2026-03-01',
      '2026-03-31',
      'UTC',
    ),
  ).toEqual(['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05']);
});

// Un DTSTART propio de la regla se ignora: manda el dtstart fijo del motor.
// Si mandara el de la regla, COUNT=3 contaria desde 2020 y la ventana de 2026
// saldria vacia; sale con los 3 primeros dias de la ventana.
it('ignora el DTSTART propio de la regla', () => {
  expect(
    scheduledDates(
      { kind: 'rrule', rule: 'DTSTART:20200101T000000Z\nRRULE:FREQ=DAILY;COUNT=3' },
      '2026-03-01',
      '2026-03-31',
      MADRID,
    ),
  ).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
});

// Una cuota no tiene fechas: [] sin lanzar.
it('una quota devuelve vacio sin lanzar', () => {
  expect(scheduledDates({ kind: 'quota', count: 3, period: 'week' }, '2026-03-01', '2026-03-31', MADRID)).toEqual(
    [],
  );
});

it('una ventana vacia devuelve vacio sin lanzar', () => {
  expect(scheduledDates({ kind: 'rrule', rule: 'FREQ=DAILY' }, '2026-03-05', '2026-03-01', MADRID)).toEqual([]);
});

it('una zona desconocida lanza', () => {
  expect(() => scheduledDates({ kind: 'rrule', rule: 'FREQ=DAILY' }, '2026-03-01', '2026-03-05', 'No/Zone')).toThrow();
});

it('un from que no es fecha lanza', () => {
  expect(() => scheduledDates({ kind: 'rrule', rule: 'FREQ=DAILY' }, '2026-13-01', '2026-03-05', MADRID)).toThrow();
});

/**
 * Regla 1 del motor: con `tzid`, la ocurrencia es la hora de pared en los
 * componentes UTC. Leerla con `fromJSDate` la trata como UTC y cae un offset
 * entero mas tarde (10:00 en vez de 08:00 en CEST). La conversion propia lee
 * los componentes con `getUTC*()` y pregunta a la zona.
 */
it('la conversion lee la hora de pared, no el instante', () => {
  // Lunes 30 de marzo de 2026, 08:00 en Madrid (CEST, UTC+2 desde el dia 29).
  const lunes = new Date(Date.UTC(2026, 2, 30, 8, 0, 0));
  const leido = occurrenceToDateTime(lunes, MADRID);
  expect(leido.toFormat("yyyy-MM-dd'T'HH:mm")).toBe('2026-03-30T08:00');
  expect(leido.offset).toBe(120);
  expect(leido.toUTC().toISO()).toBe('2026-03-30T06:00:00.000Z');
  expect(occurrenceToLocalDate(lunes, MADRID)).toBe('2026-03-30');

  // La lectura equivocada, para que conste por que esta prohibida.
  expect(DateTime.fromJSDate(lunes, { zone: MADRID }).toFormat('HH:mm')).toBe('10:00');
});

it('el dia del cambio que no existe se queda en su dia', () => {
  // 02:30 del 29 de marzo no existe en Madrid (salto 02:00 -> 03:00).
  const hueco = new Date(Date.UTC(2026, 2, 29, 2, 30, 0));
  expect(occurrenceToLocalDate(hueco, MADRID)).toBe('2026-03-29');
  expect(occurrenceToDateTime(hueco, MADRID).toFormat("yyyy-MM-dd'T'HH:mm")).toBe('2026-03-29T03:30');
});

// 2026-03-25 es miercoles (el spike fija el lunes 23).
it('la semana con weekStart 0 va de lunes a domingo', () => {
  expect(periodBounds('week', '2026-03-25', 0, MADRID)).toEqual({ start: '2026-03-23', end: '2026-03-29' });
});

it('la semana con weekStart 1 va de domingo a sabado', () => {
  expect(periodBounds('week', '2026-03-25', 1, MADRID)).toEqual({ start: '2026-03-22', end: '2026-03-28' });
});

it('el mes va de su primer a su ultimo dia', () => {
  expect(periodBounds('month', '2026-03-15', 0, MADRID)).toEqual({ start: '2026-03-01', end: '2026-03-31' });
});

it('el ano va de su primer a su ultimo dia', () => {
  expect(periodBounds('month', '2026-12-31', 0, MADRID)).toEqual({ start: '2026-12-01', end: '2026-12-31' });
  expect(periodBounds('year', '2026-06-15', 0, MADRID)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
});

it('todayIn es la fecha de hoy en esa zona', () => {
  for (const zone of [MADRID, 'UTC', 'America/Argentina/Buenos_Aires']) {
    const actual = todayIn(zone);
    expect(actual).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(actual).toBe(DateTime.now().setZone(zone).toISODate());
  }
  expect(() => todayIn('No/Zone')).toThrow();
});
