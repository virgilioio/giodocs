/* Date-property logic. A due date is a CALENDAR date — "2026-08-15" —
 * never a timestamptz. Every comparison here normalises both sides to
 * LOCAL MIDNIGHT so a due date of today never reads as overdue at 4pm.
 *
 * Pure functions only: the strip cell and the table cell both render
 * from these, so the two sites can never disagree about what "overdue"
 * means. */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

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

/** Local midnight of a stored due date. */
export function dueMidnight(value: unknown): number | null {
  const p = dueParts(value);
  if (!p) return null;
  return new Date(p[0], p[1] - 1, p[2], 0, 0, 0, 0).getTime();
}

/** Local midnight of "now" — the other side of every comparison. */
export function todayMidnight(now: Date = new Date()): number {
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0,
  ).getTime();
}

export type DueState = "empty" | "overdue" | "today" | "future";

export function dueState(
  value: unknown,
  now: Date = new Date(),
  opts: { terminal?: boolean } = {},
): DueState {
  const due = dueMidnight(value);
  if (due === null) return "empty";
  const today = todayMidnight(now);
  if (due > today) return "future";
  if (due === today) return "today";
  return opts.terminal ? "future" : "overdue";
}

/** "15 Aug", or "15 Aug 2027" when the year differs from now. */
export function formatDue(value: unknown, now: Date = new Date()): string {
  const p = dueParts(value);
  if (!p) return "";
  const [y, m, d] = p;
  const base = `${d} ${MONTHS[m - 1]}`;
  return y === now.getFullYear() ? base : `${base} ${y}`;
}

/** Whole-day relative age, for the overdue suffix. */
export function dueAgeLabel(value: unknown, now: Date = new Date()): string {
  const due = dueMidnight(value);
  if (due === null) return "";
  const days = Math.round((todayMidnight(now) - due) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "1 week ago";
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) {
    const mo = Math.floor(days / 30);
    return mo === 1 ? "1 month ago" : `${mo} months ago`;
  }
  const yr = Math.floor(days / 365);
  return yr === 1 ? "1 year ago" : `${yr} years ago`;
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
  if (state === "today") return { state, text: "Today" };
  if (state === "overdue")
    return {
      state,
      text: `${formatDue(value, now)} · ${dueAgeLabel(value, now)}`,
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
