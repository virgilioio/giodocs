/**
 * filter-label — the SINGLE source of filter chip text.
 *
 * Every filter chip in the product must go through `filterLabel`. Curly
 * quotes, lowercase property names, no operator jargon.
 *
 * The replacement rule for adding a filter (`applyFilterReplacement`) also
 * lives here so both the picker and any programmatic caller share one path.
 */
import type { Filter } from "./run-view";
import { BUILT_IN_LABELS } from "./view-config";

/** Just enough profile shape to render "owner is {full_name}". */
export type ProfileForFilterLabel = {
  id: string;
  full_name: string | null;
};

/** Enough of a property definition to name it and its options. */
export type DefForFilterLabel = {
  key: string;
  label: string;
  type: string;
  options?: unknown;
};

export type FilterLabelCtx = {
  people: ProfileForFilterLabel[];
  staleDays: number;
  /** When given, properties read by their name and options by their
   *  label ("hiring manager is Ana", "priority is “High”"). */
  defs?: DefForFilterLabel[];
};

function optionLabel(def: DefForFilterLabel | undefined, v: unknown): string {
  const opts = Array.isArray(def?.options)
    ? (def!.options as Array<{ value?: unknown; label?: unknown }>)
    : [];
  const hit = opts.find((o) => o && o.value === v);
  return typeof hit?.label === "string" && hit.label ? hit.label : String(v);
}

/** How a date filter reads its range ("due is this week"). */
export const RANGE_WORDS: Record<string, string> = {
  today: "is today",
  yesterday: "is yesterday",
  tomorrow: "is tomorrow",
  this_week: "is this week",
  last_week: "was last week",
  next_week: "is next week",
  this_month: "is this month",
  last_month: "was last month",
  next_month: "is next month",
  past_7: "in the past 7 days",
  next_7: "in the next 7 days",
  past_30: "in the past 30 days",
  next_30: "in the next 30 days",
  overdue: "is overdue",
  upcoming: "is today or later",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "today", or a day as "Oct 20" ("Oct 20, 2027" outside this year). */
export function dayWords(v: unknown, now: Date = new Date()): string {
  if (v === "today") return "today";
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  if (!m) return String(v ?? "");
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const base = `${MONTHS[mo - 1]} ${d}`;
  return y === now.getFullYear() ? base : `${base}, ${y}`;
}

export function filterLabel(f: Filter, ctx: FilterLabelCtx): string {
  const def = ctx.defs?.find((d) => d.key === f.prop);
  const builtIn = f.prop ? BUILT_IN_LABELS[f.prop] : undefined;
  const name = def ? def.label.toLowerCase() : builtIn ? builtIn.toLowerCase() : (f.prop ?? "");
  const person = (id: unknown) => ctx.people.find((p) => p.id === id)?.full_name ?? "someone";
  switch (f.op) {
    case "eq":
      if (f.prop === "owner") return `owner is ${person(f.value)}`;
      if (def?.type === "person") return `${name} is ${person(f.value)}`;
      if (def?.type === "checkbox")
        return String(f.value) === "true" ? `${name} is checked` : `${name} is not checked`;
      return `${def ? name : f.prop} is \u201C${def ? optionLabel(def, f.value) : f.value}\u201D`;
    case "includes":
      if (f.prop === "tags" || !def) return `tagged \u201C${f.value}\u201D`;
      return `${name} includes \u201C${f.value}\u201D`;
    case "is_me":
      if (builtIn) return `${name} is you`;
      return f.prop === "owner" || !def ? "owner is you" : `${name} is you`;
    case "not_empty":
      return `has a ${def || builtIn ? name : f.prop}`;
    case "empty":
      return `no ${name}`;
    case "neq":
      if (def?.type === "person") return `${name} isn\u2019t ${person(f.value)}`;
      return `${name} isn\u2019t \u201C${def ? optionLabel(def, f.value) : f.value}\u201D`;
    case "not_includes":
      return `${name} doesn\u2019t include \u201C${f.value}\u201D`;
    case "contains":
      return `${name} contains \u201C${f.value ?? ""}\u201D`;
    case "not_contains":
      return `${name} doesn\u2019t contain \u201C${f.value ?? ""}\u201D`;
    case "gt":
      return `${name} above ${f.value}`;
    case "gte":
      return `${name} at least ${f.value}`;
    case "lt":
      return `${name} below ${f.value}`;
    case "lte":
      return `${name} at most ${f.value}`;
    case "before":
      return `${name} before ${dayWords(f.value)}`;
    case "after":
      return `${name} after ${dayWords(f.value)}`;
    case "on_or_before":
      return `${name} on or before ${dayWords(f.value)}`;
    case "on_or_after":
      return `${name} on or after ${dayWords(f.value)}`;
    case "date_is":
      return `${name} ${RANGE_WORDS[String(f.value)] ?? `is ${dayWords(f.value)}`}`;
    case "unchecked":
      return `${name} is not checked`;
    case "stale":
      return `not verified in ${ctx.staleDays}+ days`;
    case "edited_within":
      return `edited in the last ${f.value} days`;
    default:
      return "";
  }
}

/**
 * Adding a filter removes any existing filter with the same prop+op —
 * EXCEPT op "includes", which accumulates. Exact rule per B1 spec §3.
 */
export function applyFilterReplacement(prev: Filter[], picked: Filter): Filter[] {
  return prev
    .filter((f) => !(f.prop === picked.prop && f.op === picked.op) || f.op === "includes")
    .concat([picked]);
}
