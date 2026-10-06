/**
 * Motor de fechas programadas: de una regla `rrule` a dias locales.
 *
 * Las cinco reglas que `rrule@2.8.1` + `luxon@3.7.2` miden (ADR 0033) y que este
 * modulo aplica sin excepcion:
 *
 * 1. Con `tzid`, `rrule` devuelve la hora de pared local en los componentes UTC
 *    del `Date`, con el offset sin aplicar. La conversion a fecha local lee esos
 *    componentes con `getUTC*()` y construye con `DateTime.fromObject` en la
 *    zona (ver `occurrenceToDateTime`). Nunca `fromJSDate` sobre una
 *    ocurrencia: la trata como UTC y cae un offset entero mas tarde, una hora
 *    en invierno y dos en verano, en todas las ocurrencias.
 * 2. El `dtstart` se construye con `Date.UTC`, nunca con el constructor local:
 *    `new Date(2026, 2, 23, 8)` usa la zona de la maquina, y el spike se
 *    ejecuto en un emulador cuya zona no es la del dispositivo.
 * 3. El import de `rrule` va por el shim de abajo, no con
 *    `import { RRule } from 'rrule'`: la libreria llega en tres builds segun
 *    quien la carga (Node ESM toma el CommonJS y no ve los named exports,
 *    Metro en web toma el ESM sin default, Metro en nativo vuelve al
 *    CommonJS) y ninguna forma de import vale para los tres.
 * 4. `rule.all()` sin `count` ni `until` no falla: cuelga. Por eso la expansion
 *    va acotada a la ventana con `between` y lleva ademas un tope duro de
 *    iteraciones (`MAX_ITERATIONS`) que frena la iteracion con el callback de
 *    `between` y lanza en vez de colgar el hilo.
 * 5. `DateTime.toISO()` devuelve la hora de la zona, no la de UTC; para el
 *    instante, `.toUTC().toISO()`. Este modulo casi nunca necesita el
 *    instante: devuelve dias locales.
 */
import { DateTime, IANAZone } from 'luxon';
import * as rruleNamespace from 'rrule';

import type { HabitSchedule, LocalDate } from './types';

/**
 * Ver la regla 3 del modulo: el namespace tal cual cuando el bundler eligio el
 * ES module, su `default` cuando el cargador eligio el CommonJS. Es la unica
 * forma que vale en Node, Metro web y Metro nativo.
 */
const rrule = (rruleNamespace as { default?: typeof rruleNamespace }).default ?? rruleNamespace;

const { RRule } = rrule;

/**
 * Tope duro de ocurrencias iteradas por llamada a `scheduledDates`. La ventana
 * ya acota la expansion (ver la regla 4 del modulo), asi que un uso legitimo
 * queda muy por debajo: 10 anos de `FREQ=HOURLY` son unas 87 mil iteraciones.
 * Por encima solo hay reglas patologicas (`FREQ=MINUTELY` en una ventana de
 * anos), y ahi lanzar es mejor que colgar el hilo o devolver millones de
 * fechas. No es un limite de fechas devueltas: una `FREQ=DAILY` legitima en
 * una ventana grande nunca lo roza.
 */
export const MAX_ITERATIONS = 100_000;

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const requireZone = (timezone: string): void => {
  if (!IANAZone.isValidZone(timezone)) {
    throw new Error(`zona horaria desconocida: ${JSON.stringify(timezone)}`);
  }
};

const requireLocalDate = (value: string, name: string): void => {
  if (!LOCAL_DATE_PATTERN.test(value) || !DateTime.fromISO(value).isValid) {
    throw new Error(`${name} no es un dia local YYYY-MM-DD: ${JSON.stringify(value)}`);
  }
};

const splitLocalDate = (value: LocalDate): { year: number; month: number; day: number } => {
  const parts = value.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (
    parts.length !== 3 ||
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    throw new Error(`dia local roto: ${JSON.stringify(value)}`);
  }
  return { year, month, day };
};

const formatLocalDate = (value: DateTime): LocalDate => value.toFormat('yyyy-MM-dd');

/**
 * Lee una ocurrencia de `rrule` como hora de pared en la zona y la devuelve
 * como instante con el offset ya aplicado (regla 1 del modulo).
 *
 * El dia del cambio de hora que no existe (02:30 del 2026-03-29 en
 * Europe/Madrid) se queda en ese dia con la resolucion de luxon (03:30 CEST):
 * no se mueve al dia siguiente ni se pierde.
 */
export function occurrenceToDateTime(occurrence: Date, timezone: string): DateTime {
  requireZone(timezone);
  return DateTime.fromObject(
    {
      year: occurrence.getUTCFullYear(),
      month: occurrence.getUTCMonth() + 1,
      day: occurrence.getUTCDate(),
      hour: occurrence.getUTCHours(),
      minute: occurrence.getUTCMinutes(),
      second: occurrence.getUTCSeconds(),
    },
    { zone: timezone },
  );
}

/** El dia local de una ocurrencia de `rrule` en la zona del habito. */
export function occurrenceToLocalDate(occurrence: Date, timezone: string): LocalDate {
  return formatLocalDate(occurrenceToDateTime(occurrence, timezone));
}

/**
 * Dias programados entre `from` y `to`, ambos inclusive, siempre ordenados de
 * forma ascendente y sin duplicados.
 *
 * - La ventana manda, no la regla: la expansion se acota a `[from, to]` con
 *   `between`, asi que una `FREQ=YEARLY` sin `UNTIL` termina igual.
 * - El `dtstart` es fijo: el dia `from` a las 00:00 como hora de pared en la
 *   zona (regla 2 del modulo). Un `DTSTART` propio de la regla se ignora; lo
 *   que la regla aporte (`COUNT`, `UNTIL`, `BYDAY`...) se respeta.
 * - La zona la pone el habito (`tzid`): una regla sin zona se lee en la zona
 *   del habito, no en la de la maquina.
 * - Un dia que no existe en el calendario (el 31 de febrero) se salta en
 *   silencio: `rrule` no lo genera y aqui no hay nada que rellenar.
 * - El `kind` `'quota'` no tiene fechas: devuelve `[]` sin lanzar.
 * - Una ventana vacia (`from` posterior a `to`) devuelve `[]` sin lanzar.
 */
export function scheduledDates(
  schedule: HabitSchedule,
  from: LocalDate,
  to: LocalDate,
  timezone: string,
): LocalDate[] {
  if (schedule.kind === 'quota') {
    return [];
  }
  requireLocalDate(from, 'from');
  requireLocalDate(to, 'to');
  requireZone(timezone);
  if (from > to) {
    return [];
  }

  const parsed = RRule.fromString(schedule.rule);
  const start = splitLocalDate(from);
  const end = splitLocalDate(to);
  // Regla 2: hora de pared construida con Date.UTC, no con el constructor local.
  const windowStart = new Date(Date.UTC(start.year, start.month - 1, start.day, 0, 0, 0));
  const windowEnd = new Date(Date.UTC(end.year, end.month - 1, end.day, 23, 59, 59));
  const rule = new RRule({ ...parsed.origOptions, dtstart: windowStart, tzid: timezone });

  // Regla 4: la ventana acota, y el contador frena la iteracion antes de colgar.
  let iterations = 0;
  let capped = false;
  const occurrences = rule.between(windowStart, windowEnd, true, () => {
    iterations += 1;
    if (iterations >= MAX_ITERATIONS) {
      capped = true;
      return false;
    }
    return true;
  });
  if (capped) {
    throw new Error(
      `la regla ${JSON.stringify(schedule.rule)} pide mas de ${MAX_ITERATIONS} ocurrencias ` +
        `entre ${from} y ${to}: ventana o regla patologica`,
    );
  }

  const found = new Set<LocalDate>();
  for (const occurrence of occurrences) {
    const date = occurrenceToLocalDate(occurrence, timezone);
    if (date >= from && date <= to) {
      found.add(date);
    }
  }
  return [...found].sort();
}

/**
 * Limites inclusivos del periodo que contiene a `date`, en dias locales.
 * `weekStart: 0` abre la semana en lunes, `weekStart: 1` en domingo.
 */
export function periodBounds(
  period: 'week' | 'month' | 'year',
  date: LocalDate,
  weekStart: 0 | 1,
  timezone: string,
): { start: LocalDate; end: LocalDate } {
  requireLocalDate(date, 'date');
  requireZone(timezone);
  if (weekStart !== 0 && weekStart !== 1) {
    throw new Error(`weekStart solo admite 0 (lunes) o 1 (domingo): ${JSON.stringify(weekStart)}`);
  }
  const base = DateTime.fromISO(date, { zone: timezone });
  if (period === 'week') {
    const back = weekStart === 0 ? base.weekday - 1 : base.weekday % 7;
    const start = base.minus({ days: back });
    const end = start.plus({ days: 6 });
    return { start: formatLocalDate(start), end: formatLocalDate(end) };
  }
  if (period === 'month') {
    return { start: formatLocalDate(base.startOf('month')), end: formatLocalDate(base.endOf('month')) };
  }
  if (period === 'year') {
    return { start: formatLocalDate(base.startOf('year')), end: formatLocalDate(base.endOf('year')) };
  }
  throw new Error(`periodo desconocido: ${JSON.stringify(period)}`);
}

/** El dia local de hoy en la zona dada, siempre `YYYY-MM-DD`. */
export function todayIn(timezone: string): LocalDate {
  requireZone(timezone);
  return formatLocalDate(DateTime.now().setZone(timezone));
}
