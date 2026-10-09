import { describe, expect, it } from 'vitest';

import {
  addDays,
  compareDays,
  dayOf,
  daysBetween,
  formatDayTitle,
  monthGrid,
  monthOfDay,
} from '@/lib/journal/days';

describe('journal days', () => {
  it('reads a Date as the calendar day the phone shows', () => {
    expect(dayOf(new Date(2026, 9, 8, 23, 59))).toBe('2026-10-08');
    expect(dayOf(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });

  it('moves across month and year ends without help', () => {
    expect(addDays('2026-03-31', 1)).toBe('2026-04-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('keeps the day when a count is zero', () => {
    expect(addDays('2026-10-08', 0)).toBe('2026-10-08');
  });

  it('orders days and counts the distance between them', () => {
    expect(compareDays('2026-10-08', '2026-10-09')).toBe(-1);
    expect(compareDays('2026-10-08', '2026-10-08')).toBe(0);
    expect(daysBetween('2026-10-08', '2026-10-15')).toBe(7);
    expect(daysBetween('2026-10-08', '2026-10-01')).toBe(-7);
  });

  it('reads the month of a day', () => {
    expect(monthOfDay('2026-10-08')).toEqual({ year: 2026, monthIndex: 9 });
  });

  it('refuses something that is not a day', () => {
    expect(() => addDays('8/10/2026', 1)).toThrow();
  });

  it('writes a title for the person in their language, and never an empty one', () => {
    expect(formatDayTitle('2026-10-08', 'en')).toMatch(/October/);
    expect(formatDayTitle('2026-10-08', 'es')).toMatch(/octubre/);
  });
});

describe('monthGrid', () => {
  it('is always six weeks of seven, Monday first', () => {
    const grid = monthGrid(2026, 9);
    expect(grid).toHaveLength(6);
    for (const week of grid) expect(week).toHaveLength(7);
  });

  it('starts October 2026 on a Thursday, so three blanks come first', () => {
    const first = monthGrid(2026, 9)[0]!;
    expect(first.slice(0, 3)).toEqual([null, null, null]);
    expect(first[3]).toBe('2026-10-01');
  });

  it('holds every day of the month once and nothing from the next one', () => {
    const days = monthGrid(2026, 1).flat().filter((day): day is string => day !== null);
    expect(days).toHaveLength(28);
    expect(days.at(-1)).toBe('2026-02-28');
  });

  it('counts a leap February', () => {
    const days = monthGrid(2028, 1).flat().filter((day) => day !== null);
    expect(days).toHaveLength(29);
  });
});
