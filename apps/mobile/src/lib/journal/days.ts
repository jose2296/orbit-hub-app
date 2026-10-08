/**
 * Calendar days for the journal, with no time of day and no time zone in them.
 *
 * A day is `YYYY-MM-DD` as the person's phone has it. Every calculation here is
 * done on the calendar fields of a UTC date, so "the day after the 31st of March"
 * is the first of April on every phone and never depends on a daylight saving
 * change in between. The shared contract checks the same form (`journalDaySchema`).
 */

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** The calendar day a `Date` falls on, in the phone's own zone. */
export function dayOf(date: Date): string {
  return formatKey(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Today, as the phone counts it. */
export function todayKey(now: Date = new Date()): string {
  return dayOf(now);
}

function formatKey(year: number, monthIndex: number, date: number): string {
  const month = String(monthIndex + 1).padStart(2, "0");
  const day = String(date).padStart(2, "0");
  return `${String(year).padStart(4, "0")}-${month}-${day}`;
}

function utcOf(day: string): number {
  const match = DAY_PATTERN.exec(day);
  if (!match) throw new Error(`not a journal day: ${day}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** The day `count` days after `day` (before it when negative). */
export function addDays(day: string, count: number): string {
  const shifted = new Date(utcOf(day) + count * MS_PER_DAY);
  return formatKey(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

/** Negative when `a` is earlier than `b`, zero when they are the same day. */
export function compareDays(a: string, b: string): number {
  return Math.sign(utcOf(a) - utcOf(b));
}

/** The number of days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcOf(to) - utcOf(from)) / MS_PER_DAY);
}

/** The year and the month (0-11) a day falls in. */
export function monthOfDay(day: string): { year: number; monthIndex: number } {
  const match = DAY_PATTERN.exec(day);
  if (!match) throw new Error(`not a journal day: ${day}`);
  return { year: Number(match[1]), monthIndex: Number(match[2]) - 1 };
}

/**
 * The weeks of a month for a calendar, Monday first.
 *
 * Six rows of seven, always, so the calendar does not change height when the
 * month changes. A cell outside the month is `null`, and the calendar draws it
 * empty rather than with a number that belongs to another month.
 */
export function monthGrid(year: number, monthIndex: number): Array<Array<string | null>> {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  // getUTCDay: Sunday is 0. Monday-first means Monday is column 0.
  const leading = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

  const cells: Array<string | null> = [];
  for (let index = 0; index < leading; index += 1) cells.push(null);
  for (let date = 1; date <= daysInMonth; date += 1) {
    cells.push(formatKey(year, monthIndex, date));
  }
  while (cells.length < 42) cells.push(null);

  const weeks: Array<Array<string | null>> = [];
  for (let row = 0; row < 6; row += 1) weeks.push(cells.slice(row * 7, row * 7 + 7));
  return weeks;
}

/**
 * A day written for a person: "miércoles, 8 de octubre de 2026".
 *
 * `Intl` with the locale of the app, and the ISO form if the runtime cannot
 * format it, because a title that is empty on some phone is a page nobody can
 * find their way back from.
 */
export function formatDayTitle(day: string, locale: string): string {
  const { year, monthIndex } = monthOfDay(day);
  const date = new Date(Date.UTC(year, monthIndex, Number(day.slice(8, 10))));
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
  } catch {
    return day;
  }
}

/** The month and year of a calendar, for its header: "octubre 2026". */
export function formatMonthTitle(year: number, monthIndex: number, locale: string): string {
  const date = new Date(Date.UTC(year, monthIndex, 1));
  try {
    return new Intl.DateTimeFormat(locale, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
  } catch {
    return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  }
}
