import { isEmptyValue, propValue, spanOfValue } from "./run-view";
import { dayWords } from "./filter-label";
import type { PageListItem } from "./types";

/* The Calculate row under a table: one figure per property, over the pages
 * shown (or each group's pages). Pure. */

export type CalcId =
  | "count_all"
  | "count_values"
  | "count_empty"
  | "count_unique"
  | "percent_empty"
  | "percent_not_empty"
  | "sum"
  | "average"
  | "median"
  | "min"
  | "max"
  | "range"
  | "earliest"
  | "latest"
  | "date_range"
  | "checked"
  | "unchecked"
  | "percent_checked"
  | "percent_unchecked";

export const CALC_LABELS: Record<CalcId, string> = {
  count_all: "Count all",
  count_values: "Count values",
  count_empty: "Count empty",
  count_unique: "Count unique values",
  percent_empty: "Percent empty",
  percent_not_empty: "Percent not empty",
  sum: "Sum",
  average: "Average",
  median: "Median",
  min: "Min",
  max: "Max",
  range: "Range",
  earliest: "Earliest date",
  latest: "Latest date",
  date_range: "Date range",
  checked: "Checked",
  unchecked: "Not checked",
  percent_checked: "Percent checked",
  percent_unchecked: "Percent not checked",
};

/** The short word shown before a figure in the row ("Sum 11"). */
export const CALC_SHORT: Record<CalcId, string> = {
  count_all: "Count",
  count_values: "Values",
  count_empty: "Empty",
  count_unique: "Unique",
  percent_empty: "Empty",
  percent_not_empty: "Not empty",
  sum: "Sum",
  average: "Average",
  median: "Median",
  min: "Min",
  max: "Max",
  range: "Range",
  earliest: "Earliest",
  latest: "Latest",
  date_range: "Range",
  checked: "Checked",
  unchecked: "Not checked",
  percent_checked: "Checked",
  percent_unchecked: "Not checked",
};

const COUNTS: CalcId[] = [
  "count_all",
  "count_values",
  "count_empty",
  "count_unique",
  "percent_empty",
  "percent_not_empty",
];

/** The calculations that make sense for a property type, in menu order. */
export function calcsFor(type: string | undefined): CalcId[] {
  switch (type) {
    case "title":
      return ["count_all"];
    case "number":
      return [...COUNTS, "sum", "average", "median", "min", "max", "range"];
    case "date":
      return [...COUNTS, "earliest", "latest", "date_range"];
    case "timestamp":
      return ["earliest", "latest", "date_range"];
    case "checkbox":
      return ["count_all", "checked", "unchecked", "percent_checked", "percent_unchecked"];
    default:
      return COUNTS;
  }
}

export function isCalcId(v: unknown): v is CalcId {
  return typeof v === "string" && v in CALC_LABELS;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

const NUM = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

/** What a calculation comes to, before it's written out: a number (counts,
 *  sums, percents 0–100, a range of days), a day "YYYY-MM-DD" (earliest,
 *  latest), or null when there's nothing to say. */
export type CalcRaw =
  | { kind: "number"; n: number }
  | { kind: "percent"; n: number }
  | { kind: "days"; n: number }
  | { kind: "day"; day: string }
  | null;

type ReadValue = (page: PageListItem, key: string) => unknown;

const pctOf = (part: number, whole: number) => (whole === 0 ? 0 : (part / whole) * 100);

export function calculateRaw(
  calc: CalcId,
  pages: PageListItem[],
  key: string,
  readValue: ReadValue = propValue,
): CalcRaw {
  const total = pages.length;
  if (calc === "count_all") return { kind: "number", n: total };
  const values = pages.map((p) => (key === "title" ? p.title : readValue(p, key)));
  const filled = values.filter((v) => !isEmptyValue(v));
  switch (calc) {
    case "count_values":
      return { kind: "number", n: filled.length };
    case "count_empty":
      return { kind: "number", n: total - filled.length };
    case "percent_empty":
      return { kind: "percent", n: pctOf(total - filled.length, total) };
    case "percent_not_empty":
      return { kind: "percent", n: pctOf(filled.length, total) };
    case "count_unique": {
      const seen = new Set<string>();
      for (const v of filled) {
        if (Array.isArray(v)) v.forEach((x) => seen.add(String(x)));
        else seen.add(String(v));
      }
      return { kind: "number", n: seen.size };
    }
    case "checked":
    case "unchecked":
    case "percent_checked":
    case "percent_unchecked": {
      const on = values.filter((v) => v === true || v === "true").length;
      if (calc === "checked") return { kind: "number", n: on };
      if (calc === "unchecked") return { kind: "number", n: total - on };
      if (calc === "percent_checked") return { kind: "percent", n: pctOf(on, total) };
      return { kind: "percent", n: pctOf(total - on, total) };
    }
    case "sum":
    case "average":
    case "median":
    case "min":
    case "max":
    case "range": {
      const nums = values.map(asNumber).filter((n): n is number => n !== null);
      if (nums.length === 0) return null;
      const sorted = [...nums].sort((a, b) => a - b);
      const sum = nums.reduce((a, b) => a + b, 0);
      const mid = Math.floor(sorted.length / 2);
      const n =
        calc === "sum"
          ? sum
          : calc === "average"
            ? sum / nums.length
            : calc === "min"
              ? sorted[0]
              : calc === "max"
                ? sorted[sorted.length - 1]
                : calc === "range"
                  ? sorted[sorted.length - 1] - sorted[0]
                  : sorted.length % 2
                    ? sorted[mid]
                    : (sorted[mid - 1] + sorted[mid]) / 2;
      return { kind: "number", n };
    }
    case "earliest":
    case "latest":
    case "date_range": {
      // Ranges count from their first day (earliest) to their last (latest).
      const spans = values
        .map((v) => spanOfValue(v, key))
        .filter((x): x is { start: string; end: string } => !!x);
      if (spans.length === 0) return null;
      const first = spans.map((x) => x.start).sort()[0];
      const last = spans.map((x) => x.end).sort()[spans.length - 1];
      if (calc === "earliest") return { kind: "day", day: first };
      if (calc === "latest") return { kind: "day", day: last };
      return { kind: "days", n: daysBetween(first, last) };
    }
    default:
      return null;
  }
}

/** A calculation written out ("1,234", "33%", "Oct 12", "4 days"). */
export function formatCalc(raw: CalcRaw, now: Date = new Date()): string {
  if (!raw) return "";
  switch (raw.kind) {
    case "number":
      return NUM.format(raw.n);
    case "percent":
      return `${NUM.format(Math.round(raw.n * 10) / 10)}%`;
    case "days":
      return raw.n === 1 ? "1 day" : `${NUM.format(raw.n)} days`;
    case "day":
      return dayWords(raw.day, now);
  }
}

/** A sortable, filterable value: numbers stay numbers, days stay days. */
export function calcValue(raw: CalcRaw): number | string | null {
  if (!raw) return null;
  return raw.kind === "day" ? raw.day : raw.n;
}

/** The figure for one calculation, ready to show; "" when there's nothing
 *  to say (no numbers to add, no dates to compare). */
export function calculate(
  calc: CalcId,
  pages: PageListItem[],
  key: string,
  now: Date = new Date(),
  readValue?: ReadValue,
): string {
  return formatCalc(calculateRaw(calc, pages, key, readValue), now);
}
