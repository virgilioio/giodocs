import { describe, expect, it } from "vitest";
import { defaultInlineView, inlineFromView, readInlineView } from "./inline-view";

describe("readInlineView", () => {
  it("is null until the block is set up", () => {
    expect(readInlineView(undefined)).toBeNull();
    expect(readInlineView([1])).toBeNull();
  });
  it("reads a stored view, dropping anything malformed", () => {
    expect(
      readInlineView({
        database_id: "db1",
        name: "Open tasks",
        layout: "board",
        filter: [{ op: "eq", prop: "status", value: "todo" }, 3, { prop: "x" }],
        sort: [{ prop: "p:due", dir: "asc" }, { prop: 1 }],
        config: { props: ["due"], widths: { due: "x" } },
        group_by: "status",
      }),
    ).toEqual({
      database_id: "db1",
      name: "Open tasks",
      layout: "board",
      filter: [{ op: "eq", prop: "status", value: "todo" }],
      sort: [{ prop: "p:due", dir: "asc" }],
      config: { props: ["due"], widths: {} },
      group_by: "status",
    });
  });
  it("falls back to a table sorted by newest edits, with no database yet", () => {
    expect(readInlineView({ layout: "gallery", sort: [] })).toEqual({
      ...defaultInlineView(),
      database_id: null,
      layout: "table",
    });
  });
});

describe("inlineFromView", () => {
  it("copies a saved view's query and settings", () => {
    const v = inlineFromView({
      database_id: "db1",
      name: "Roadmap",
      layout: "list",
      filter: [{ op: "is_me", prop: "owner" }],
      sort: { prop: "title", dir: "asc" },
      config: { calcs: { title: "count_all" } },
      group_by: null,
    });
    expect(v).toEqual({
      database_id: "db1",
      name: "Roadmap",
      layout: "list",
      filter: [{ op: "is_me", prop: "owner" }],
      sort: { prop: "title", dir: "asc" },
      config: { calcs: { title: "count_all" } },
      group_by: null,
    });
  });
});
