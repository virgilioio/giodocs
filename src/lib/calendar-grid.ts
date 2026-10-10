/* Month grid for the calendar view. Pure: no React.
 *
 * Six fixed weeks (42 days), Monday first like the date picker, so paging
 * months never changes the grid's height. Days are "YYYY-MM-DD" keys in
 * local time — the same form date properties are stored in. */

export type GridDay = { key: string; day: number; inMonth: boolean };

export function dayKey(y: number, m0: number, d: number): string {
  const dt = new Date(y, m0, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function todayKey(now: Date = new Date()): string {
  return dayKey(now.getFullYear(), now.getMonth(), now.getDate());
}

/** The 42 days shown for a month (month0 is 0-11). */
export function monthGrid(year: number, month0: number): GridDay[] {
  const first = new Date(year, month0, 1);
  const lead = (first.getDay() + 6) % 7; // Monday = 0
  const out: GridDay[] = [];
  for (let i = 0; i < 42; i++) {
    const dt = new Date(year, month0, 1 - lead + i);
    out.push({
      key: dayKey(dt.getFullYear(), dt.getMonth(), dt.getDate()),
      day: dt.getDate(),
      inMonth: dt.getMonth() === month0,
    });
  }
  return out;
}

/** Step a month forward (+1) or back (-1). */
export function shiftMonth(year: number, month0: number, by: number): { year: number; month0: number } {
  const dt = new Date(year, month0 + by, 1);
  return { year: dt.getFullYear(), month0: dt.getMonth() };
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
