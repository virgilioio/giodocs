import type { Filter, SortSpec } from "./run-view";
import { readConfig, type ViewConfig } from "./view-config";

/* A view placed inside a page (the "view" block). It names a database and
 * is a saved query over its rows like any view (AGENTS.md: a view stores a
 * filter, never a list of page ids), kept in the page's blocks so every
 * reader of the page sees it, and shows the rows each reader can open.
 * Page editors change it in place; the change saves with the page. Pure. */

export type InlineLayout = "table" | "board" | "list" | "calendar";

export type InlineView = {
  /** The database whose rows it shows. Null only in blocks saved before
   *  databases existed; such a block shows nothing until one is picked. */
  database_id: string | null;
  name: string;
  layout: InlineLayout;
  filter: Filter[];
  sort: SortSpec | SortSpec[];
  config: ViewConfig;
  /** What a board groups by (a select or status), or the date a calendar
   *  places rows on. */
  group_by: string | null;
};

const LAYOUTS: InlineLayout[] = ["table", "board", "list", "calendar"];

export function defaultInlineView(databaseId: string | null = null): InlineView {
  return {
    database_id: databaseId,
    name: "",
    layout: "table",
    filter: [],
    sort: { prop: "edited", dir: "desc" },
    config: {},
    group_by: null,
  };
}

function isFilter(f: unknown): f is Filter {
  return !!f && typeof f === "object" && typeof (f as { op?: unknown }).op === "string";
}

function isSort(s: unknown): s is SortSpec {
  return (
    !!s &&
    typeof s === "object" &&
    typeof (s as { prop?: unknown }).prop === "string" &&
    ((s as { dir?: unknown }).dir === "asc" || (s as { dir?: unknown }).dir === "desc")
  );
}

/** A stored block's view, read defensively; null when it hasn't been set
 *  up yet (the block offers where to start from). */
export function readInlineView(raw: unknown): InlineView | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const base = defaultInlineView();
  const sort = Array.isArray(r.sort) ? r.sort.filter(isSort) : isSort(r.sort) ? r.sort : base.sort;
  return {
    database_id: typeof r.database_id === "string" && r.database_id ? r.database_id : null,
    name: typeof r.name === "string" ? r.name.slice(0, 200) : "",
    layout: LAYOUTS.includes(r.layout as InlineLayout) ? (r.layout as InlineLayout) : "table",
    filter: Array.isArray(r.filter) ? r.filter.filter(isFilter) : [],
    sort: Array.isArray(sort) && sort.length === 0 ? base.sort : sort,
    config: readConfig(r.config),
    group_by: typeof r.group_by === "string" && r.group_by ? r.group_by : null,
  };
}

/** Start from a saved view: a copy of its query and how it shows pages.
 *  A calendar view starts as a table here (pages show as a table, board or
 *  list inside a page). */
export function inlineFromView(v: {
  database_id?: string | null;
  name: string;
  layout?: string | null;
  filter?: unknown;
  sort?: unknown;
  config?: unknown;
  group_by?: string | null;
}): InlineView {
  const read = readInlineView({
    database_id: v.database_id ?? null,
    name: v.name,
    layout: v.layout,
    filter: v.filter,
    sort: v.sort,
    config: v.config,
    group_by: v.group_by,
  })!;
  return read;
}
