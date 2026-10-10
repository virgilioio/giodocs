import { dayOfValue, isEmptyValue, propValue } from "./run-view";
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

function percent(part: number, whole: number): string {
  if (whole === 0) return "0%";
  return `${NUM.format(Math.round((part / whole) * 1000) / 10)}%`;
}

function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

/** The figure for one calculation, ready to show; "" when there's nothing
 *  to say (no numbers to add, no dates to compare). */
export function calculate(
  calc: CalcId,
  pages: PageListItem[],
  key: string,
  now: Date = new Date(),
): string {
  const total = pages.length;
  if (calc === "count_all") return NUM.format(total);
  const values = pages.map((p) => (key === "title" ? p.title : propValue(p, key)));
  const filled = values.filter((v) => !isEmptyValue(v));
  switch (calc) {
    case "count_values":
      return NUM.format(filled.length);
    case "count_empty":
      return NUM.format(total - filled.length);
    case "percent_empty":
      return percent(total - filled.length, total);
    case "percent_not_empty":
      return percent(filled.length, total);
    case "count_unique": {
      const seen = new Set<string>();
      for (const v of filled) {
        if (Array.isArray(v)) v.forEach((x) => seen.add(String(x)));
        else seen.add(String(v));
      }
      return NUM.format(seen.size);
    }
    case "checked":
    case "unchecked":
    case "percent_checked":
    case "percent_unchecked": {
      const on = values.filter((v) => v === true || v === "true").length;
      if (calc === "checked") return NUM.format(on);
      if (calc === "unchecked") return NUM.format(total - on);
      if (calc === "percent_checked") return percent(on, total);
      return percent(total - on, total);
    }
    case "sum":
    case "average":
    case "median":
    case "min":
    case "max":
    case "range": {
      const nums = values.map(asNumber).filter((n): n is number => n !== null);
      if (nums.length === 0) return "";
      const sorted = [...nums].sort((a, b) => a - b);
      const sum = nums.reduce((a, b) => a + b, 0);
      if (calc === "sum") return NUM.format(sum);
      if (calc === "average") return NUM.format(sum / nums.length);
      if (calc === "min") return NUM.format(sorted[0]);
      if (calc === "max") return NUM.format(sorted[sorted.length - 1]);
      if (calc === "range") return NUM.format(sorted[sorted.length - 1] - sorted[0]);
      const mid = Math.floor(sorted.length / 2);
      return NUM.format(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
    }
    case "earliest":
    case "latest":
    case "date_range": {
      const days = values
        .map((v) => dayOfValue(v, key))
        .filter((d): d is string => !!d)
        .sort();
      if (days.length === 0) return "";
      if (calc === "earliest") return dayWords(days[0], now);
      if (calc === "latest") return dayWords(days[days.length - 1], now);
      const n = daysBetween(days[0], days[days.length - 1]);
      return n === 1 ? "1 day" : `${NUM.format(n)} days`;
    }
    default:
      return "";
  }
}
