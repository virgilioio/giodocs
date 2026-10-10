import { describe, expect, it } from "vitest";
import { assignmentsOf } from "./assignments";
import type { PageListItem } from "./types";

const row = (id: string, db: string, props: Record<string, unknown>) =>
  ({ id, database_id: db, props, archived_at: null, is_database: false }) as unknown as PageListItem;

describe("assignments across databases", () => {
  const defs = [
    { key: "owner", type: "person", database_id: "pages" },
    { key: "assignee", type: "person", database_id: "tasks" },
    { key: "reviewer", type: "person", database_id: "tasks" },
    { key: "old", type: "person", database_id: "tasks", archived_at: "2026-01-01" },
  ];
  it("counts a row when any person property holds them, per database", () => {
    const pages = [
      row("a", "pages", { owner: "u1" }),
      row("b", "tasks", { assignee: "u1" }),
      row("c", "tasks", { reviewer: "u1", assignee: "u2" }),
      row("d", "tasks", { assignee: "u1" }),
      row("e", "tasks", { old: "u1" }),
      row("f", "pages", { owner: "u2" }),
    ];
    const a = assignmentsOf(pages, defs, "u1");
    expect(a.pages.map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
    expect(a.byDb).toEqual([
      { databaseId: "tasks", key: "assignee", count: 3 },
      { databaseId: "pages", key: "owner", count: 1 },
    ]);
  });
});
