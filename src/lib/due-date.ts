/* Date-property logic. A due date is a CALENDAR date — "2026-08-15" —
 * never a timestamptz. Every comparison here normalises both sides to
 * LOCAL MIDNIGHT so a due date of today never reads as overdue at 4pm.
 *
 * Pure functions only: the strip cell and the table cell both render
 * from these, so the two sites can never disagree about what "overdue"
 * means. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A status whose page is finished — an overdue date on it is noise. */
const TERMINAL_STATUS = new Set([
  "done",
  "complete",
  "completed",
  "shipped",
  "closed",
  "cancelled",
  "canceled",
  "archived",
  "hired",
]);

export function isTerminalStatus(status: unknown): boolean {
  return typeof status === "string" && TERMINAL_STATUS.has(status.toLowerCase());
}

/** Accepts "YYYY-MM-DD" and tolerates a legacy ISO timestamp by keeping
 * only its date part. Anything else is not a date. */
export function dueParts(value: unknown): [number, number, number] | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return [y, mo, d];
}

/** Canonical storage form — what we write to props. */
export function toDueString(value: unknown): string | null {
  const p = dueParts(value);
  if (!p) return null;
  const [y, m, d] = p;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/* ── Date ranges ──
 * A date property holds one day, "2026-10-12", or a range written as ISO
 * 8601 start/end, "2026-10-12/2026-10-15" (validate_page_props checks the
 * end is on or after the start). Everything that reads a date as one day
 * (dueParts, toDueString) reads a range's START, so sorting and placing by
 * start needs no change. */

export type DateSpan = { start: string; end: string };

/** The first and last day a value covers; a single day is both. */
export function dateSpan(value: unknown): DateSpan | null {
  if (typeof value !== "string") return null;
  const [a, b] = value.trim().split("/");
  const start = toDueString(a);
  if (!start) return null;
  const end = b !== undefined ? toDueString(b) : null;
  if (!end || end === start) return { start, end: start };
  return end < start ? { start: end, end: start } : { start, end };
}

export function isDateRange(value: unknown): boolean {
  const s = dateSpan(value);
  return !!s && s.end !== s.start;
}

/** What to store: one day, or "start/end" (ends put in order). */
export function toDateValue(start: string, end?: string | null): string {
  const a = toDueString(start) ?? start;
  const b = end ? (toDueString(end) ?? end) : null;
  if (!b || b === a) return a;
  return a < b ? `${a}/${b}` : `${b}/${a}`;
}

export function addDaysKey(key: string, n: number): string {
  const p = dueParts(key)!;
  const d = new Date(p[0], p[1] - 1, p[2] + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Whole days from one day key to another (local calendar days). */
export function daysBetweenKeys(a: string, b: string): number {
  const pa = dueParts(a);
  const pb = dueParts(b);
  if (!pa || !pb) return 0;
  return Math.round(
    (Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86_400_000,
  );
}

/** Move a value so it starts on `start`, keeping a range's length. */
export function moveDateValue(value: unknown, start: string): string {
  const s = dateSpan(value);
  if (!s || s.end === s.start) return start;
  return toDateValue(start, addDaysKey(start, daysBetweenKeys(s.start, s.end)));
}

/** Every day a value covers, in order, at most `max` of them. */
export function daysOfSpan(span: DateSpan, max = 62): string[] {
  const out: string[] = [];
  let k = span.start;
  while (k <= span.end && out.length < max) {
    out.push(k);
    k = addDaysKey(k, 1);
  }
  return out;
}

/** Local midnight of a stored due date. */
export function dueMidnight(value: unknown): number | null {
  const p = dueParts(value);
  if (!p) return null;
  return new Date(p[0], p[1] - 1, p[2], 0, 0, 0, 0).getTime();
}

/** Local midnight of "now" — the other side of every comparison. */
export function todayMidnight(now: Date = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
}

export type DueState = "empty" | "overdue" | "today" | "future";

export function dueState(
  value: unknown,
  now: Date = new Date(),
  opts: { terminal?: boolean } = {},
): DueState {
  const span = dateSpan(value);
  if (!span) return "empty";
  const start = dueMidnight(span.start)!;
  const end = dueMidnight(span.end)!;
  const today = todayMidnight(now);
  if (start > today) return "future";
  // A range that has started and not ended is "today" (in progress).
  if (end >= today) return "today";
  return opts.terminal ? "future" : "overdue";
}

/** "Mar 14", or "Mar 14, 2027" when the year differs from now. The year
 * guard stays: a bare month-day in another year is ambiguous. */
export function formatDue(value: unknown, now: Date = new Date()): string {
  const span = dateSpan(value);
  if (span && span.end !== span.start) {
    const a = dueParts(span.start)!;
    const b = dueParts(span.end)!;
    const sameYear = a[0] === b[0];
    const yearShown = !sameYear || a[0] !== now.getFullYear();
    const left = `${MONTHS[a[1] - 1]} ${a[2]}${!sameYear ? `, ${a[0]}` : ""}`;
    const right = sameYear && a[1] === b[1] ? `${b[2]}` : `${MONTHS[b[1] - 1]} ${b[2]}`;
    return `${left} \u2192 ${right}${yearShown ? `, ${b[0]}` : ""}`;
  }
  const p = dueParts(value);
  if (!p) return "";
  const [y, m, d] = p;
  const base = `${MONTHS[m - 1]} ${d}`;
  return y === now.getFullYear() ? base : `${base}, ${y}`;
}

/** Whole calendar days from today to the stored date: 0 today, 1 tomorrow,
 * -1 yesterday. Both sides are local midnight, so 4pm never shifts it. */
export function dueDeltaDays(value: unknown, now: Date = new Date()): number | null {
  const due = dueMidnight(value);
  if (due === null) return null;
  return Math.round((due - todayMidnight(now)) / 86400000);
}

/** Unsigned magnitude wording: days under 14, weeks 14–59, months 60+,
 * years past a year. ONE table, used by both relative labels. */
function magnitude(days: number): string {
  const n = Math.abs(days);
  if (n < 14) return n === 1 ? "1 day" : `${n} days`;
  if (n < 60) {
    const w = Math.round(n / 7);
    return w === 1 ? "1 week" : `${w} weeks`;
  }
  if (n < 365) {
    const mo = Math.round(n / 30);
    return mo === 1 ? "1 month" : `${mo} months`;
  }
  const yr = Math.floor(n / 365);
  return yr === 1 ? "1 year" : `${yr} years`;
}

/** "today" / "tomorrow" / "yesterday" / "in 6 days" / "3 weeks ago". */
export function dueRelative(value: unknown, now: Date = new Date()): string {
  const d = dueDeltaDays(value, now);
  if (d === null) return "";
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  return d > 0 ? `in ${magnitude(d)}` : `${magnitude(d)} ago`;
}

/** Whole-day relative age, for the overdue suffix. */
export function dueAgeLabel(value: unknown, now: Date = new Date()): string {
  const d = dueDeltaDays(value, now);
  if (d === null) return "";
  if (d >= 0) return "today";
  return dueRelative(value, now);
}

/** The full value string a date cell renders: "12 Aug · 3 days ago"
 * when overdue, "Today" today, plain otherwise. */
export function dueLabel(
  value: unknown,
  now: Date = new Date(),
  opts: { terminal?: boolean } = {},
): { state: DueState; text: string } {
  const state = dueState(value, now, opts);
  if (state === "empty") return { state, text: "" };
  const range = isDateRange(value);
  if (state === "today") return { state, text: range ? formatDue(value, now) : "Today" };
  if (state === "overdue")
    return {
      state,
      text: `${formatDue(value, now)} · ${dueAgeLabel(range ? dateSpan(value)!.end : value, now)}`,
    };
  return { state, text: formatDue(value, now) };
}

/* ── null-is-absent ──
 * set_page_property stores an explicit null rather than dropping the key,
 * so props can carry `{ due: null }`. Every render site decides "is this
 * property set?" through this one predicate, so a cleared value reads as
 * Empty and a cleared non-system property disappears from the strip. */
export function isPropSet(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
