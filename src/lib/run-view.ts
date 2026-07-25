import type { PageListItem } from "./types";

export type FilterOp =
  | "eq"
  | "includes"
  | "is_me"
  | "not_empty"
  | "stale"
  | "edited_within";

export type Filter = {
  prop?: string;
  op: FilterOp;
  value?: string | number;
};

export type SortSpec = {
  prop: "edited" | "verified" | "title";
  dir: "asc" | "desc";
};

export type ViewSpec = { filter: Filter[]; sort: SortSpec };

export type RunViewCtx = { me: string; staleDays: number; now?: Date };

function propsOf(page: PageListItem): Record<string, unknown> {
  const p = page.props;
  if (p && typeof p === "object" && !Array.isArray(p)) {
    return p as Record<string, unknown>;
  }
  return {};
}

function requireProp(f: Filter): string {
  if (!f.prop) {
    throw new Error(`Filter op "${f.op}" requires a prop`);
  }
  return f.prop;
}

function daysAgo(now: Date, days: number): number {
  return now.getTime() - days * 24 * 60 * 60 * 1000;
}

function matches(page: PageListItem, f: Filter, ctx: RunViewCtx): boolean {
  const now = ctx.now ?? new Date();
  switch (f.op) {
    case "eq": {
      const key = requireProp(f);
      const v = propsOf(page)[key];
      return v != null && String(v) === String(f.value);
    }
    case "includes": {
      const key = requireProp(f);
      const v = propsOf(page)[key];
      return Array.isArray(v) && v.map(String).includes(String(f.value));
    }
    case "is_me": {
      const key = requireProp(f);
      const v = propsOf(page)[key];
      return v != null && String(v) === ctx.me;
    }
    case "not_empty": {
      const key = requireProp(f);
      const p = propsOf(page);
      if (!(key in p)) return false;
      const v = p[key];
      if (v === null || v === "") return false;
      if (Array.isArray(v) && v.length === 0) return false;
      return true;
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

function sortKey(page: PageListItem, prop: SortSpec["prop"]): string | number {
  switch (prop) {
    case "edited":
      return new Date(page.edited_at).getTime();
    case "verified":
      return new Date(page.verified_at).getTime();
    case "title":
      return (page.title ?? "").toLowerCase();
  }
}

export function runView(
  pages: PageListItem[],
  view: ViewSpec,
  ctx: RunViewCtx,
): PageListItem[] {
  const filtered = pages.filter((page) =>
    view.filter.every((f) => matches(page, f, ctx)),
  );

  const dir = view.sort.dir === "asc" ? 1 : -1;
  const prop = view.sort.prop;

  return [...filtered].sort((a, b) => {
    const av = sortKey(a, prop);
    const bv = sortKey(b, prop);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

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
