import { describe, it, expect } from "vitest";
import { runView, groupPages, type ViewSpec } from "./run-view";
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
    const r = runView(pages, { filter: [{ prop: "area", op: "eq", value: "Engineering" }], sort: sortEditedDesc }, ctx);
    expect(r.map((p) => p.id).sort()).toEqual(["p1", "p3", "p7"]);
  });

  it("includes matches when array contains value", () => {
    const r = runView(pages, { filter: [{ prop: "tags", op: "includes", value: "urgent" }], sort: sortEditedDesc }, ctx);
    expect(r.map((p) => p.id).sort()).toEqual(["p1", "p6", "p7"]);
  });

  it("is_me matches on the me id", () => {
    const r = runView(pages, { filter: [{ prop: "owner", op: "is_me" }], sort: sortEditedDesc }, ctx);
    expect(r.map((p) => p.id).sort()).toEqual(["p1", "p3", "p5"]);
  });

  it("is_me with a different me returns a different set", () => {
    const r = runView(pages, { filter: [{ prop: "owner", op: "is_me" }], sort: sortEditedDesc }, { ...ctx, me: OTHER });
    expect(r.map((p) => p.id).sort()).toEqual(["p2", "p4", "p7"]);
  });

  it("not_empty rejects missing, null, empty string, and empty array", () => {
    const r = runView(pages, { filter: [{ prop: "tags", op: "not_empty" }], sort: sortEditedDesc }, ctx);
    expect(r.map((p) => p.id).sort()).toEqual(["p1", "p2", "p6", "p7"]);
  });

  it("stale respects a custom staleDays", () => {
    const r90 = runView(pages, { filter: [{ op: "stale" }], sort: sortEditedDesc }, ctx);
    expect(r90.map((p) => p.id).sort()).toEqual(["p2", "p3", "p5"]);
    const r150 = runView(pages, { filter: [{ op: "stale" }], sort: sortEditedDesc }, { ...ctx, staleDays: 150 });
    expect(r150.map((p) => p.id).sort()).toEqual(["p3", "p5"]);
  });

  it("edited_within uses numeric day window", () => {
    const r = runView(pages, { filter: [{ op: "edited_within", value: 7 }], sort: sortEditedDesc }, ctx);
    expect(r.map((p) => p.id).sort()).toEqual(["p1", "p3", "p5", "p6", "p7", "p8"]);
  });

  it("ANDs multiple filters", () => {
    const r = runView(
      pages,
      { filter: [{ prop: "area", op: "eq", value: "Engineering" }, { prop: "owner", op: "is_me" }], sort: sortEditedDesc },
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
