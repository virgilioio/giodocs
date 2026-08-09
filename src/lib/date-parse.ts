/* Typed date entry — pure parsing, nothing else.
 *
 * Every result is built from COMPONENTS (`new Date(y, m-1, d)`), never by
 * handing user text to the Date constructor: a string-parsed date drags in
 * UTC-midnight off-by-ones, which is exactly what due-date.ts avoids.
 * Storage form is the same "YYYY-MM-DD" string due-date.ts owns. */

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function key(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function fromDate(d: Date): string {
  return key(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function shift(today: Date, days: number): string {
  return fromDate(
    new Date(today.getFullYear(), today.getMonth(), today.getDate() + days),
  );
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function valid(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > daysInMonth(y, m)) return null;
  return key(y, m, d);
}

function monthIndex(word: string): number {
  const w = word.toLowerCase();
  return MONTHS.findIndex((m) => w === m || w.startsWith(m));
}

function dayIndex(word: string): number {
  const w = word.toLowerCase().slice(0, 3);
  return DAYS.indexOf(w);
}

/** Parse a typed date. Returns "YYYY-MM-DD" or null — never a guess. */
export function parseDateInput(
  text: string,
  today: Date = new Date(),
): string | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return null;

  if (t === "today" || t === "tod") return shift(today, 0);
  if (t === "tomorrow" || t === "tom" || t === "tmr") return shift(today, 1);
  if (t === "yesterday" || t === "yest") return shift(today, -1);

  // ISO, first — it is unambiguous.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) return valid(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // Relative day offsets: +10 / -3.
  const off = /^([+-])\s?(\d{1,4})$/.exec(t);
  if (off) {
    const n = Number(off[2]);
    return shift(today, off[1] === "-" ? -n : n);
  }

  // next fri / last mon.
  const rel = /^(next|last) ([a-z]{3,9})$/.exec(t);
  if (rel) {
    const idx = dayIndex(rel[2]);
    if (idx < 0) return null;
    const cur = today.getDay();
    if (rel[1] === "next") {
      const delta = ((idx - cur + 7 - 1) % 7) + 1; // strictly ahead
      return shift(today, delta);
    }
    const back = ((cur - idx + 7 - 1) % 7) + 1; // strictly behind
    return shift(today, -back);
  }

  // Mar 14 / 14 Mar / March 14 — current year.
  const md = /^([a-z]{3,9})\.? (\d{1,2})$/.exec(t);
  if (md) {
    const m = monthIndex(md[1]);
    if (m >= 0) return valid(today.getFullYear(), m + 1, Number(md[2]));
    return null;
  }
  const dm = /^(\d{1,2}) ([a-z]{3,9})\.?$/.exec(t);
  if (dm) {
    const m = monthIndex(dm[2]);
    if (m >= 0) return valid(today.getFullYear(), m + 1, Number(dm[1]));
    return null;
  }

  // 3/14 — month/day, current year.
  const slash = /^(\d{1,2})\/(\d{1,2})$/.exec(t);
  if (slash)
    return valid(today.getFullYear(), Number(slash[1]), Number(slash[2]));

  return null;
}
