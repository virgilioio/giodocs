import { describe, it, expect } from "vitest";
import {
  runView,
  groupPages,
  groupRows,
  rangeOf,
  sortsOf,
  type Filter,
  type PropInfo,
  type ViewSpec,
} from "./run-view";
import type { PageListItem } from "./types";

const NOW = new Date("2026-07-25T12:00:00Z");
const ME = "user-me";
const OTHER = "user-other";

function daysBefore(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

const pages: PageListItem[] = [
  {
    id: "p1",
    title: "Beta launch",
    icon: "",
    props: { area: "Engineering", owner: ME, tags: ["urgent", "q3"] },
    verified_at: daysBefore(10),
    verified_by: null,
    edited_at: daysBefore(1),
    edited_by: null,
    access_type: "workspace",
  },
  {
    id: "p2",
    title: "alpha spec",
    icon: "",
    props: { area: "Product", owner: OTHER, tags: ["q3"] },
    verified_at: daysBefore(120),
    verified_by: null,
    edited_at: daysBefore(45),
    edited_by: null,
    access_type: "workspace",
  },
  {
    id: "p3",
    title: "Charlie doc",
    icon: "",
    props: { area: "Engineering", owner: ME, tags: [] },
    verified_at: daysBefore(200),
    verified_by: null,
    edited_at: daysBefore(2),
    edited_by: null,
    access_type: "workspace",
  },
  {
    id: "p4",
    title: "delta notes",
    icon: "",
    props: { area: "Design", owner: OTHER },
    verified_at: daysBefore(5),
    verified_by: null,
    edited_at: daysBefore(10),
    edited_by: null,
    access_type: "workspace",
  },
  {
    id: "p5",
    title: "Echo",
    icon: "",
    props: { owner: ME, note: "" },
    verified_at: daysBefore(400),
    verified_by: null,
    edited_at: daysBefore(3),
    edited_by: null,
    access_type: "workspace",
  },
  {
    id: "p6",
    title: "foxtrot",
    icon: "",
    props: { area: "Product", tags: ["urgent"] },
    verified_at: daysBefore(1),
    verified_by: null,
    edited_at: daysBefore(1),
    edited_by: null,
    access_type: "workspace",
  },
  {
    id: "p7",
    title: "Golf",
    icon: "",
    props: { area: "Engineering", owner: OTHER, tags: ["urgent"] },
    verified_at: daysBefore(1),
    verified_by: null,
    edited_at: daysBefore(1),
    edited_by: null,
    access_type: "workspace",
  },
  {
    id: "p8",
    title: "Hotel",
    icon: "",
    props: {},
    verified_at: daysBefore(1),
    verified_by: null,
    edited_at: daysBefore(1),
    edited_by: null,
    access_type: "workspace",
  },
];

const ctx = { me: ME, staleDays: 90, now: NOW };
const sortEditedDesc: ViewSpec["sort"] = { prop: "edited", dir: "desc" };

describe("runView filter ops", () => {
  it("eq matches by prop equality", () => {
    const r = runView(
      pages,
      { filter: [{ prop: "area", op: "eq", value: "Engineering" }], sort: sortEditedDesc },
      ctx,
    );
    expect(r.map((p) => p.id).sort()).toEqual(["p1", "p3", "p7"]);
  });

  it("includes matches when array contains value", () => {
    const r = runView(
      pages,
      { filter: [{ prop: "tags", op: "includes", value: "urgent" }], sort: sortEditedDesc },
      ctx,
    );
    expect(r.map((p) => p.id).sort()).toEqual(["p1", "p6", "p7"]);
  });

  it("is_me matches on the me id", () => {
    const r = runView(
      pages,
      { filter: [{ prop: "owner", op: "is_me" }], sort: sortEditedDesc },
      ctx,
    );
    expect(r.map((p) => p.id).sort()).toEqual(["p1", "p3", "p5"]);
  });

  it("is_me with a different me returns a different set", () => {
    const r = runView(
      pages,
      { filter: [{ prop: "owner", op: "is_me" }], sort: sortEditedDesc },
      { ...ctx, me: OTHER },
    );
    expect(r.map((p) => p.id).sort()).toEqual(["p2", "p4", "p7"]);
  });

  it("not_empty rejects missing, null, empty string, and empty array", () => {
    const r = runView(
      pages,
      { filter: [{ prop: "tags", op: "not_empty" }], sort: sortEditedDesc },
      ctx,
    );
    expect(r.map((p) => p.id).sort()).toEqual(["p1", "p2", "p6", "p7"]);
  });

  it("stale respects a custom staleDays", () => {
    const r90 = runView(pages, { filter: [{ op: "stale" }], sort: sortEditedDesc }, ctx);
    expect(r90.map((p) => p.id).sort()).toEqual(["p2", "p3", "p5"]);
    const r150 = runView(
      pages,
      { filter: [{ op: "stale" }], sort: sortEditedDesc },
      { ...ctx, staleDays: 150 },
    );
    expect(r150.map((p) => p.id).sort()).toEqual(["p3", "p5"]);
  });

  it("edited_within uses numeric day window", () => {
    const r = runView(
      pages,
      { filter: [{ op: "edited_within", value: 7 }], sort: sortEditedDesc },
      ctx,
    );
    expect(r.map((p) => p.id).sort()).toEqual(["p1", "p3", "p5", "p6", "p7", "p8"]);
  });

  it("ANDs multiple filters", () => {
    const r = runView(
      pages,
      {
        filter: [
          { prop: "area", op: "eq", value: "Engineering" },
          { prop: "owner", op: "is_me" },
        ],
        sort: sortEditedDesc,
      },
      ctx,
    );
    expect(r.map((p) => p.id).sort()).toEqual(["p1", "p3"]);
  });

  it("empty filter array returns everything", () => {
    const r = runView(pages, { filter: [], sort: sortEditedDesc }, ctx);
    expect(r).toHaveLength(pages.length);
  });

  it("unknown op throws", () => {
    expect(() =>
      runView(pages, { filter: [{ op: "bogus" as unknown as "eq" }], sort: sortEditedDesc }, ctx),
    ).toThrow();
  });
});

describe("runView sorting", () => {
  it("sorts by title case-insensitively ascending", () => {
    const r = runView(pages, { filter: [], sort: { prop: "title", dir: "asc" } }, ctx);
    expect(r.map((p) => p.title.toLowerCase())).toEqual(
      [...pages.map((p) => p.title.toLowerCase())].sort(),
    );
  });

  it("is stable on ties via id ascending", () => {
    const tied: PageListItem[] = [
      { ...pages[0], id: "z", edited_at: daysBefore(1) },
      { ...pages[0], id: "a", edited_at: daysBefore(1) },
      { ...pages[0], id: "m", edited_at: daysBefore(1) },
    ];
    const r = runView(tied, { filter: [], sort: sortEditedDesc }, ctx);
    expect(r.map((p) => p.id)).toEqual(["a", "m", "z"]);
  });
});

describe("groupPages", () => {
  it("puts the missing-property group last", () => {
    const g = groupPages(pages, "area");
    expect(g[g.length - 1].value).toBeNull();
    expect(g[g.length - 1].pages.map((p) => p.id).sort()).toEqual(["p5", "p8"]);
    expect(g.slice(0, -1).map((x) => x.value)).toEqual(["Design", "Engineering", "Product"]);
  });
});

/* ─────────── 2026-10-10: comparing filters, any-property sorts, grouping ─────────── */

function item(
  id: string,
  props: Record<string, unknown>,
  extra: Partial<PageListItem> = {},
): PageListItem {
  return {
    id,
    title: id,
    icon: "",
    props: props as PageListItem["props"],
    verified_at: daysBefore(1),
    verified_by: null,
    edited_at: daysBefore(1),
    edited_by: null,
    access_type: "workspace",
    ...extra,
  };
}

// Wednesday 2026-10-14, midday local time.
const WED = new Date(2026, 9, 14, 12, 0, 0);
const wctx = { me: ME, staleDays: 90, now: WED };
const ids = (r: PageListItem[]) => r.map((p) => p.id);
const only = (rows: PageListItem[], f: Filter) =>
  ids(runView(rows, { filter: [f], sort: { prop: "title", dir: "asc" } }, wctx));

describe("rangeOf", () => {
  it("weeks start on Monday", () => {
    expect(rangeOf("this_week", WED)).toEqual(["2026-10-12", "2026-10-18"]);
    expect(rangeOf("last_week", WED)).toEqual(["2026-10-05", "2026-10-11"]);
    expect(rangeOf("next_week", WED)).toEqual(["2026-10-19", "2026-10-25"]);
  });
  it("months, overdue and unknown words", () => {
    expect(rangeOf("this_month", WED)).toEqual(["2026-10-01", "2026-10-31"]);
    expect(rangeOf("last_month", WED)).toEqual(["2026-09-01", "2026-09-30"]);
    expect(rangeOf("next_month", WED)).toEqual(["2026-11-01", "2026-11-30"]);
    expect(rangeOf("overdue", WED)?.[1]).toBe("2026-10-13");
    expect(rangeOf("upcoming", WED)?.[0]).toBe("2026-10-14");
    expect(rangeOf("someday", WED)).toBeNull();
  });
  it("a Sunday belongs to the week that started the Monday before", () => {
    expect(rangeOf("this_week", new Date(2026, 9, 18, 9))).toEqual(["2026-10-12", "2026-10-18"]);
  });
});

describe("comparing filters", () => {
  const rows = [
    item("a", { due: "2026-10-13", n: 5, t: "Quarterly plan", done: true }),
    item("b", { due: "2026-10-14", n: "12", t: "plan B" }),
    item("c", { due: "2026-10-20", n: 0, t: "Notes", done: false }),
    item("d", {}),
  ];
  it("dates: overdue, this week, before/after a day", () => {
    expect(only(rows, { prop: "due", op: "date_is", value: "overdue" })).toEqual(["a"]);
    expect(only(rows, { prop: "due", op: "date_is", value: "this_week" })).toEqual(["a", "b"]);
    expect(only(rows, { prop: "due", op: "date_is", value: "today" })).toEqual(["b"]);
    expect(only(rows, { prop: "due", op: "date_is", value: "2026-10-20" })).toEqual(["c"]);
    expect(only(rows, { prop: "due", op: "before", value: "today" })).toEqual(["a"]);
    expect(only(rows, { prop: "due", op: "on_or_after", value: "2026-10-14" })).toEqual(["b", "c"]);
    expect(only(rows, { prop: "due", op: "after", value: "2026-10-14" })).toEqual(["c"]);
  });
  it("numbers above and below (numeric strings count, blanks never match)", () => {
    expect(only(rows, { prop: "n", op: "gt", value: 4 })).toEqual(["a", "b"]);
    expect(only(rows, { prop: "n", op: "lte", value: 5 })).toEqual(["a", "c"]);
    expect(only(rows, { prop: "n", op: "lt", value: "1" })).toEqual(["c"]);
  });
  it("text contains, case-insensitive", () => {
    expect(only(rows, { prop: "t", op: "contains", value: "PLAN" })).toEqual(["a", "b"]);
    expect(only(rows, { prop: "t", op: "not_contains", value: "plan" })).toEqual(["c", "d"]);
  });
  it("not checked includes blanks", () => {
    expect(only(rows, { prop: "done", op: "unchecked" })).toEqual(["b", "c", "d"]);
  });
  it("empty and not_includes", () => {
    expect(only(rows, { prop: "t", op: "empty" })).toEqual(["d"]);
    const tagged = [item("x", { tags: ["q3"] }), item("y", { tags: [] }), item("z", {})];
    expect(only(tagged, { prop: "tags", op: "not_includes", value: "q3" })).toEqual(["y", "z"]);
  });
  it("built-in properties: created time and created by", () => {
    const made = [
      item("old", {}, { created_at: "2026-09-01T10:00:00Z", created_by: OTHER }),
      item("new", {}, { created_at: new Date(2026, 9, 13, 10).toISOString(), created_by: ME }),
    ];
    expect(only(made, { prop: "@created", op: "date_is", value: "this_week" })).toEqual(["new"]);
    expect(only(made, { prop: "@created_by", op: "is_me" })).toEqual(["new"]);
    expect(only(made, { prop: "@created_by", op: "not_empty" })).toEqual(["new", "old"]);
  });
});

describe("sorting by any property", () => {
  const props = new Map<string, PropInfo>([
    [
      "status",
      { type: "status", options: [{ value: "todo" }, { value: "doing" }, { value: "done" }] },
    ],
    ["n", { type: "number" }],
    ["done", { type: "checkbox" }],
    ["due", { type: "date" }],
  ]);
  const c = { ...wctx, props };
  const rows = [
    item("a", { status: "done", n: 10, due: "2026-10-01" }),
    item("b", { status: "todo", n: 9, done: true }),
    item("c", { status: "doing", due: "2026-09-01" }),
    item("d", { n: "100" }),
  ];
  const sorted = (sort: ViewSpec["sort"]) => ids(runView(rows, { filter: [], sort }, c));
  it("selects follow their option order; blanks last both ways", () => {
    expect(sorted({ prop: "p:status", dir: "asc" })).toEqual(["b", "c", "a", "d"]);
    expect(sorted({ prop: "p:status", dir: "desc" })).toEqual(["a", "c", "b", "d"]);
  });
  it("numbers sort as numbers, dates as days", () => {
    expect(sorted({ prop: "p:n", dir: "asc" })).toEqual(["b", "a", "d", "c"]);
    expect(sorted({ prop: "p:due", dir: "desc" })).toEqual(["a", "c", "b", "d"]);
  });
  it("a blank checkbox sorts as unchecked", () => {
    expect(sorted({ prop: "p:done", dir: "desc" })[0]).toBe("b");
  });
  it("a second sort breaks ties", () => {
    const tied = [
      item("x", { done: true, n: 1 }),
      item("y", { done: true, n: 3 }),
      item("z", { n: 2 }),
    ];
    const r = runView(
      tied,
      {
        filter: [],
        sort: [
          { prop: "p:done", dir: "desc" },
          { prop: "p:n", dir: "desc" },
        ],
      },
      c,
    );
    expect(ids(r)).toEqual(["y", "x", "z"]);
  });
  it("people sort by name", () => {
    const names: Record<string, string> = { [ME]: "Zoe", [OTHER]: "Adam" };
    const r = runView(
      [item("m", {}, { created_by: ME }), item("o", {}, { created_by: OTHER }), item("n", {})],
      { filter: [], sort: { prop: "@created_by", dir: "asc" } },
      { ...c, nameOf: (id) => names[id] ?? id },
    );
    expect(ids(r)).toEqual(["o", "m", "n"]);
  });
  it("an empty sort list falls back to last edited", () => {
    expect(sortsOf([])).toEqual([{ prop: "edited", dir: "desc" }]);
    expect(sortsOf(null)).toEqual([{ prop: "edited", dir: "desc" }]);
  });
});

describe("groupRows", () => {
  const props = new Map<string, PropInfo>([
    [
      "status",
      {
        type: "status",
        options: [
          { value: "todo", label: "To do" },
          { value: "done", label: "Done" },
        ],
      },
    ],
    ["ok", { type: "checkbox" }],
  ]);
  const rows = [
    item("1", { status: "done", ok: true }),
    item("2", { status: "todo" }),
    item("3", {}),
    item("4", { status: "todo", ok: true }),
  ];
  it("follows option order, keeps row order, empty last", () => {
    const g = groupRows(rows, "status", { props });
    expect(g.map((x) => [x.value, x.label, ids(x.pages)])).toEqual([
      ["todo", "To do", ["2", "4"]],
      ["done", "Done", ["1"]],
      [null, "", ["3"]],
    ]);
  });
  it("checkboxes group into checked and not checked", () => {
    const g = groupRows(rows, "ok", { props });
    expect(g.map((x) => [x.label, ids(x.pages)])).toEqual([
      ["Checked", ["1", "4"]],
      ["Not checked", ["2", "3"]],
    ]);
  });
  it("people group by name", () => {
    const g = groupRows([item("a", { owner: ME }), item("b", { owner: OTHER })], "owner", {
      props: new Map([["owner", { type: "person" }]]),
      nameOf: (id) => (id === ME ? "Zoe" : "Adam"),
    });
    expect(g.map((x) => x.label)).toEqual(["Adam", "Zoe"]);
  });
});

describe("review fixes (2026-10-10)", () => {
  it("values that aren't listed options follow the options, in text order", () => {
    const props = new Map<string, PropInfo>([
      ["area", { type: "select", options: [{ value: "Ops" }] }],
    ]);
    const r = runView(
      [item("1", { area: "Sales" }), item("2", { area: "Design" }), item("3", { area: "Ops" })],
      { filter: [], sort: { prop: "p:area", dir: "asc" } },
      { ...wctx, props },
    );
    expect(ids(r)).toEqual(["3", "2", "1"]);
  });
  it("a date property stored as a timestamp keeps its written day", () => {
    const rows = [
      item("t", { due: "2026-10-14T00:00:00Z" }),
      item("u", { due: "2026-10-13T23:30:00Z" }),
    ];
    expect(only(rows, { prop: "due", op: "date_is", value: "2026-10-14" })).toEqual(["t"]);
  });
  it("overdue leaves out finished pages", () => {
    const rows = [
      item("open", { due: "2026-10-01" }),
      item("done", { due: "2026-10-01", status: "done" }),
    ];
    expect(only(rows, { prop: "due", op: "date_is", value: "overdue" })).toEqual(["open"]);
  });
});

describe("date ranges in views (2026-10-10)", () => {
  const rows = [
    item("r", { due: "2026-10-09/2026-10-13" }),
    item("s", { due: "2026-10-15/2026-10-20" }),
    item("d", { due: "2026-10-14" }),
  ];
  it("a range matches a period it overlaps and a day it covers", () => {
    expect(only(rows, { prop: "due", op: "date_is", value: "this_week" })).toEqual(["d", "r", "s"]);
    expect(only(rows, { prop: "due", op: "date_is", value: "last_week" })).toEqual(["r"]);
    expect(only(rows, { prop: "due", op: "date_is", value: "2026-10-11" })).toEqual(["r"]);
  });
  it("overdue once its last day has passed", () => {
    expect(only(rows, { prop: "due", op: "date_is", value: "overdue" })).toEqual(["r"]);
    expect(
      only([item("x", { due: "2026-10-10/2026-10-16" })], {
        prop: "due",
        op: "date_is",
        value: "overdue",
      }),
    ).toEqual([]);
  });
  it("before compares the start, after the end", () => {
    expect(only(rows, { prop: "due", op: "before", value: "2026-10-10" })).toEqual(["r"]);
    expect(only(rows, { prop: "due", op: "after", value: "2026-10-12" })).toEqual(["d", "r", "s"]);
  });
  it("sorts by start", () => {
    expect(
      ids(
        runView(
          rows,
          { filter: [], sort: { prop: "p:due", dir: "asc" } },
          { ...wctx, props: new Map([["due", { type: "date" }]]) },
        ),
      ),
    ).toEqual(["r", "d", "s"]);
  });
});

describe("date filters on Edited and Verified (heading menu › Filter)", () => {
  it("date_is past_7 on @edited keeps rows edited in the last week", () => {
    const r = runView(
      pages,
      { filter: [{ prop: "@edited", op: "date_is", value: "past_7" }], sort: sortEditedDesc },
      ctx,
    );
    const expected = pages
      .filter((p) => NOW.getTime() - new Date(p.edited_at).getTime() <= 7 * 86_400_000)
      .map((p) => p.id)
      .sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(r.map((p) => p.id).sort()).toEqual(expected);
  });

  it("date_is past_30 on @verified uses the verified date", () => {
    const r = runView(
      pages,
      { filter: [{ prop: "@verified", op: "date_is", value: "past_30" }], sort: sortEditedDesc },
      ctx,
    );
    const expected = pages
      .filter((p) => NOW.getTime() - new Date(p.verified_at).getTime() <= 30 * 86_400_000)
      .map((p) => p.id)
      .sort();
    expect(r.map((p) => p.id).sort()).toEqual(expected);
  });
});

describe("manual order", () => {
  it("orders rows by position, unplaced rows last newest edit first, like move_page", () => {
    const base = pages.slice(0, 4).map((p, i) => ({ ...p, position: [2, null, 1, null][i] }));
    const r = runView(base, { filter: [], sort: [{ prop: "manual", dir: "asc" }] }, ctx);
    const unplaced = base
      .filter((p) => p.position === null)
      .sort((a, b) => b.edited_at.localeCompare(a.edited_at) || (a.id < b.id ? -1 : 1))
      .map((p) => p.id);
    expect(r.map((p) => p.id)).toEqual([base[2].id, base[0].id, ...unplaced]);
  });
});
