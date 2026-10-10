import type { PageListItem } from "./types";
import { dateSpan, isTerminalStatus, toDueString, type DateSpan } from "./due-date";

/* The one place a view's filter, sort and grouping run (AGENTS.md: "View
 * filtering happens in EXACTLY one place"). Everything here is pure.
 *
 * Property names: a property key ("status", "due", …), or a built-in:
 *   @created  @edited  @verified    (timestamps)
 *   @created_by  @edited_by         (people)
 * Property keys always start with a letter, so the two never collide.
 *
 * Saved views from before 2026-10-10 keep their meaning: the old filter
 * ops and the old sort names ("edited", "verified", "title") still work. */

export type FilterOp =
  // any type
  | "eq"
  | "neq"
  | "not_empty"
  | "empty"
  // multi-select / tags / related pages
  | "includes"
  | "not_includes"
  // people
  | "is_me"
  // text (and anything shown as text)
  | "contains"
  | "not_contains"
  // numbers
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  // dates: value is "YYYY-MM-DD", "today", or for date_is a range word
  | "before"
  | "after"
  | "on_or_before"
  | "on_or_after"
  | "date_is"
  // checkbox
  | "unchecked"
  // freshness (built in)
  | "stale"
  | "edited_within";

export type Filter = {
  prop?: string;
  op: FilterOp;
  value?: string | number;
};

/** Words a date filter understands, besides an exact day. */
export const DATE_RANGES = [
  "today",
  "yesterday",
  "tomorrow",
  "this_week",
  "last_week",
  "next_week",
  "this_month",
  "last_month",
  "next_month",
  "past_7",
  "next_7",
  "past_30",
  "next_30",
  "overdue",
  "upcoming",
] as const;
export type DateRange = (typeof DATE_RANGES)[number];

/** "edited" | "verified" | "title" | "@created" | "@created_by" | "@edited_by"
 *  | "p:<property key>" */
export type SortSpec = {
  prop: string;
  dir: "asc" | "desc";
};

export type ViewSpec = { filter: Filter[]; sort: SortSpec | SortSpec[] };

/** What sorting and grouping need to know about a property. */
export type PropInfo = {
  type: string;
  /** Select / status options, in their order. */
  options?: Array<{ value: string; label?: string }>;
};

export type RunViewCtx = {
  me: string;
  staleDays: number;
  now?: Date;
  /** Property types and options, for type-aware sorting. */
  props?: ReadonlyMap<string, PropInfo>;
  /** A person's name, for sorting and grouping by person. */
  nameOf?: (userId: string) => string;
};

/* ─────────────────────────── Values ─────────────────────────── */

function propsOf(page: PageListItem): Record<string, unknown> {
  const p = page.props;
  if (p && typeof p === "object" && !Array.isArray(p)) {
    return p as Record<string, unknown>;
  }
  return {};
}

export const BUILT_IN_PROPS = [
  "@created",
  "@edited",
  "@verified",
  "@created_by",
  "@edited_by",
] as const;

/** The value a view sees for a property or a built-in. */
export function propValue(page: PageListItem, key: string): unknown {
  switch (key) {
    case "@created":
      return page.created_at ?? null;
    case "@edited":
      return page.edited_at ?? null;
    case "@verified":
      return page.verified_at ?? null;
    case "@created_by":
      return page.created_by ?? null;
    case "@edited_by":
      return page.edited_by ?? null;
    default:
      return propsOf(page)[key];
  }
}

export function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** The calendar day a property or built-in holds. A date property is a
 *  calendar date, so an older stored timestamp keeps its written date part
 *  (as its cell shows it); built-in timestamps (@created, @edited, …) are
 *  moments, read as the reader's local day. */
export function dayOfValue(v: unknown, key: string): string | null {
  if (key.startsWith("@")) return dayKey(v);
  return toDueString(v);
}

/** The days a property or built-in covers: a date range's start and end,
 *  or one day as both. */
export function spanOfValue(v: unknown, key: string): DateSpan | null {
  if (key.startsWith("@")) {
    const d = dayKey(v);
    return d ? { start: d, end: d } : null;
  }
  return dateSpan(v);
}

/** A local calendar day "YYYY-MM-DD" for a date value or a timestamp. */
export function dayKey(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function keyOfDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

/** [first, last] day keys (inclusive) of a range word, around `now`.
 *  Weeks start on Monday, like the calendar view. */
export function rangeOf(word: string, now: Date): [string, string] | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const firstOfMonth = (y: number, m: number) => new Date(y, m, 1);
  const lastOfMonth = (y: number, m: number) => new Date(y, m + 1, 0);
  const span = (a: Date, b: Date): [string, string] => [keyOfDate(a), keyOfDate(b)];
  switch (word) {
    case "today":
      return span(today, today);
    case "yesterday":
      return span(addDays(today, -1), addDays(today, -1));
    case "tomorrow":
      return span(addDays(today, 1), addDays(today, 1));
    case "this_week":
      return span(monday, addDays(monday, 6));
    case "last_week":
      return span(addDays(monday, -7), addDays(monday, -1));
    case "next_week":
      return span(addDays(monday, 7), addDays(monday, 13));
    case "this_month":
      return span(
        firstOfMonth(today.getFullYear(), today.getMonth()),
        lastOfMonth(today.getFullYear(), today.getMonth()),
      );
    case "last_month":
      return span(
        firstOfMonth(today.getFullYear(), today.getMonth() - 1),
        lastOfMonth(today.getFullYear(), today.getMonth() - 1),
      );
    case "next_month":
      return span(
        firstOfMonth(today.getFullYear(), today.getMonth() + 1),
        lastOfMonth(today.getFullYear(), today.getMonth() + 1),
      );
    case "past_7":
      return span(addDays(today, -7), today);
    case "next_7":
      return span(today, addDays(today, 7));
    case "past_30":
      return span(addDays(today, -30), today);
    case "next_30":
      return span(today, addDays(today, 30));
    case "overdue":
      return ["0000-01-01", keyOfDate(addDays(today, -1))];
    case "upcoming":
      return [keyOfDate(today), "9999-12-31"];
    default:
      return null;
  }
}

/** The day a date filter compares against: "today", or an exact day. */
function targetDay(value: unknown, now: Date): string | null {
  if (value === "today") return keyOfDate(now);
  return dayKey(value);
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(String).join(" ");
  return String(v);
}

/* ─────────────────────────── Filters ─────────────────────────── */

function requireProp(f: Filter): string {
  if (!f.prop) {
    throw new Error(`Filter op "${f.op}" requires a prop`);
  }
  return f.prop;
}

function daysAgo(now: Date, days: number): number {
  return now.getTime() - days * 24 * 60 * 60 * 1000;
}

export function matches(page: PageListItem, f: Filter, ctx: RunViewCtx): boolean {
  const now = ctx.now ?? new Date();
  switch (f.op) {
    case "eq": {
      const v = propValue(page, requireProp(f));
      return v != null && String(v) === String(f.value);
    }
    case "neq": {
      const v = propValue(page, requireProp(f));
      return v == null || String(v) !== String(f.value);
    }
    case "includes": {
      const v = propValue(page, requireProp(f));
      return Array.isArray(v) && v.map(String).includes(String(f.value));
    }
    case "not_includes": {
      const v = propValue(page, requireProp(f));
      return !(Array.isArray(v) && v.map(String).includes(String(f.value)));
    }
    case "is_me": {
      const v = propValue(page, requireProp(f));
      if (Array.isArray(v)) return v.map(String).includes(ctx.me);
      return v != null && String(v) === ctx.me;
    }
    case "not_empty": {
      const key = requireProp(f);
      if (!key.startsWith("@") && !(key in propsOf(page))) return false;
      return !isEmptyValue(propValue(page, key));
    }
    case "empty":
      return isEmptyValue(propValue(page, requireProp(f)));
    case "contains":
    case "not_contains": {
      const needle = String(f.value ?? "")
        .trim()
        .toLowerCase();
      const hay = asText(propValue(page, requireProp(f))).toLowerCase();
      const has = needle === "" ? true : hay.includes(needle);
      return f.op === "contains" ? has : !has;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const v = asNumber(propValue(page, requireProp(f)));
      const t = asNumber(f.value);
      if (v === null || t === null) return false;
      if (f.op === "gt") return v > t;
      if (f.op === "gte") return v >= t;
      if (f.op === "lt") return v < t;
      return v <= t;
    }
    case "before":
    case "after":
    case "on_or_before":
    case "on_or_after": {
      // A range is before a day if it starts before it, after a day if it
      // ends after it.
      const key = requireProp(f);
      const span = spanOfValue(propValue(page, key), key);
      const t = targetDay(f.value, now);
      if (!span || !t) return false;
      if (f.op === "before") return span.start < t;
      if (f.op === "after") return span.end > t;
      if (f.op === "on_or_before") return span.start <= t;
      return span.end >= t;
    }
    case "date_is": {
      const key = requireProp(f);
      const span = spanOfValue(propValue(page, key), key);
      if (!span) return false;
      if (f.value === "overdue") {
        // Overdue once its last day has passed; an overdue date on a
        // finished page is noise, as in its cell.
        if (isTerminalStatus(propsOf(page).status)) return false;
        const r = rangeOf("overdue", now)!;
        return span.end <= r[1];
      }
      // A range matches a period it overlaps ("this week" includes a range
      // that runs through Tuesday), and a day it covers.
      const r = rangeOf(String(f.value ?? ""), now);
      if (r) return span.start <= r[1] && span.end >= r[0];
      const t = dayKey(f.value);
      return t !== null && span.start <= t && t <= span.end;
    }
    case "unchecked": {
      const v = propValue(page, requireProp(f));
      return v !== true && v !== "true";
    }
    case "stale": {
      const threshold = daysAgo(now, ctx.staleDays);
      return new Date(page.verified_at).getTime() < threshold;
    }
    case "edited_within": {
      if (typeof f.value !== "number") {
        throw new Error(`edited_within requires numeric value`);
      }
      const threshold = daysAgo(now, f.value);
      return new Date(page.edited_at).getTime() > threshold;
    }
    default: {
      const op: string = (f as Filter).op;
      throw new Error(`Unknown filter op: ${op}`);
    }
  }
}

/* ─────────────────────────── Sorting ─────────────────────────── */

/** A saved sort is one spec (older views) or a list (first wins). */
export function sortsOf(sort: SortSpec | SortSpec[] | null | undefined): SortSpec[] {
  const list = Array.isArray(sort) ? sort : sort ? [sort] : [];
  const ok = list.filter((s) => s && typeof s.prop === "string");
  if (ok.length) return ok;
  return [{ prop: "edited", dir: "desc" }];
}

/** The property a sort orders by, or a built-in name. */
export function sortProp(prop: string): string {
  if (prop === "edited") return "@edited";
  if (prop === "verified") return "@verified";
  if (prop === "title") return "@title";
  if (prop.startsWith("p:")) return prop.slice(2);
  return prop;
}

type Key = { empty: boolean; v: number | string; t?: string };

function sortKey(page: PageListItem, key: string, ctx: RunViewCtx): Key {
  if (key === "@title") return { empty: false, v: (page.title ?? "").toLowerCase() };
  const raw = propValue(page, key);
  if (key === "@created" || key === "@edited" || key === "@verified") {
    const t = typeof raw === "string" ? new Date(raw).getTime() : NaN;
    return Number.isNaN(t) ? { empty: true, v: 0 } : { empty: false, v: t };
  }
  if (key === "@created_by" || key === "@edited_by") {
    if (isEmptyValue(raw)) return { empty: true, v: "" };
    return { empty: false, v: (ctx.nameOf?.(String(raw)) ?? String(raw)).toLowerCase() };
  }
  const info = ctx.props?.get(key);
  if (isEmptyValue(raw)) {
    // A checkbox left blank is unchecked, not missing.
    if (info?.type === "checkbox") return { empty: false, v: 0 };
    return { empty: true, v: "" };
  }
  switch (info?.type) {
    case "number": {
      const n = asNumber(raw);
      return n === null ? { empty: true, v: 0 } : { empty: false, v: n };
    }
    case "checkbox":
      return { empty: false, v: raw === true || raw === "true" ? 1 : 0 };
    case "date": {
      const d = dayOfValue(raw, key);
      return d ? { empty: false, v: d } : { empty: true, v: "" };
    }
    case "select":
    case "status": {
      // In the order the options are set up (To do → Done), like Notion.
      // Values that aren't listed options (an area typed on a page) follow
      // the listed ones, in text order.
      const i = info.options?.findIndex((o) => o.value === raw) ?? -1;
      return i >= 0
        ? { empty: false, v: i }
        : { empty: false, v: 1e6, t: asText(raw).toLowerCase() };
    }
    case "person":
      return { empty: false, v: (ctx.nameOf?.(String(raw)) ?? String(raw)).toLowerCase() };
    default:
      return { empty: false, v: asText(raw).toLowerCase() };
  }
}

function compareKeys(a: Key, b: Key, dir: 1 | -1): number {
  // Pages without a value always go last, whichever way you sort.
  if (a.empty !== b.empty) return a.empty ? 1 : -1;
  if (a.empty) return 0;
  if (typeof a.v === "number" && typeof b.v === "number") {
    if (a.v !== b.v) return (a.v - b.v) * dir;
    if (a.t === undefined && b.t === undefined) return 0;
    return (a.t ?? "").localeCompare(b.t ?? "", undefined, { numeric: true }) * dir;
  }
  const sa = String(a.v);
  const sb = String(b.v);
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: "base" }) * dir;
}

export function runView(pages: PageListItem[], view: ViewSpec, ctx: RunViewCtx): PageListItem[] {
  const filtered = pages.filter((page) => {
    // Archived pages leave every view. They stay in ⌘K search (which reads
    // the server RPC directly, not this in-memory list).
    if (page.archived_at) return false;
    return view.filter.every((f) => matches(page, f, ctx));
  });

  const sorts = sortsOf(view.sort).map((s) => ({
    key: sortProp(s.prop),
    dir: (s.dir === "asc" ? 1 : -1) as 1 | -1,
  }));
  const keyed = filtered.map((p) => ({ p, keys: sorts.map((s) => sortKey(p, s.key, ctx)) }));
  keyed.sort((a, b) => {
    for (let i = 0; i < sorts.length; i++) {
      const c = compareKeys(a.keys[i], b.keys[i], sorts[i].dir);
      if (c !== 0) return c;
    }
    if (a.p.id < b.p.id) return -1;
    if (a.p.id > b.p.id) return 1;
    return 0;
  });
  return keyed.map((k) => k.p);
}

/* ─────────────────────────── Grouping ─────────────────────────── */

/** Boards: one group per value, empty last (unchanged behaviour). */
export function groupPages(
  pages: PageListItem[],
  propKey: string,
): Array<{ value: string | null; pages: PageListItem[] }> {
  const groups = new Map<string | null, PageListItem[]>();
  for (const page of pages) {
    const raw = propsOf(page)[propKey];
    const key =
      raw === undefined || raw === null || raw === ""
        ? null
        : Array.isArray(raw)
          ? raw.map(String).join(",")
          : String(raw);
    const arr = groups.get(key);
    if (arr) arr.push(page);
    else groups.set(key, [page]);
  }
  const named: Array<{ value: string | null; pages: PageListItem[] }> = [];
  let missing: { value: string | null; pages: PageListItem[] } | null = null;
  for (const [value, pgs] of groups) {
    if (value === null) missing = { value, pages: pgs };
    else named.push({ value, pages: pgs });
  }
  named.sort((a, b) => (a.value! < b.value! ? -1 : a.value! > b.value! ? 1 : 0));
  return missing ? [...named, missing] : named;
}

export type RowGroup = { value: string | null; label: string; pages: PageListItem[] };

/** Tables: group already-sorted rows by a property (select, status, person,
 *  checkbox, area, or a built-in person), keeping the row order inside each
 *  group. Selects follow their option order; people their names; pages
 *  without a value come last. */
export function groupRows(
  rows: PageListItem[],
  key: string,
  ctx: Pick<RunViewCtx, "props" | "nameOf">,
): RowGroup[] {
  const info = ctx.props?.get(key);
  const isCheckbox = info?.type === "checkbox";
  const buckets = new Map<string | null, PageListItem[]>();
  for (const p of rows) {
    const raw = propValue(p, key);
    const v = isCheckbox
      ? raw === true || raw === "true"
        ? "true"
        : "false"
      : isEmptyValue(raw)
        ? null
        : Array.isArray(raw)
          ? String(raw[0])
          : String(raw);
    const arr = buckets.get(v);
    if (arr) arr.push(p);
    else buckets.set(v, [p]);
  }
  const labelOf = (v: string): string => {
    if (isCheckbox) return v === "true" ? "Checked" : "Not checked";
    const opt = info?.options?.find((o) => o.value === v);
    if (opt) return opt.label ?? v;
    if (info?.type === "person" || key === "@created_by" || key === "@edited_by")
      return ctx.nameOf?.(v) ?? v;
    return v;
  };
  const rank = (v: string): number | string => {
    if (isCheckbox) return v === "true" ? 0 : 1;
    const i = info?.options?.findIndex((o) => o.value === v) ?? -1;
    if (i >= 0) return i;
    return labelOf(v).toLowerCase();
  };
  const named = [...buckets.entries()].filter(([v]) => v !== null) as Array<
    [string, PageListItem[]]
  >;
  named.sort(([a], [b]) => {
    const ra = rank(a);
    const rb = rank(b);
    if (typeof ra === "number" && typeof rb === "number") return ra - rb;
    if (typeof ra === "number") return -1;
    if (typeof rb === "number") return 1;
    return ra.localeCompare(rb);
  });
  const out: RowGroup[] = named.map(([v, pages]) => ({ value: v, label: labelOf(v), pages }));
  const none = buckets.get(null);
  if (none) out.push({ value: null, label: "", pages: none });
  return out;
}
