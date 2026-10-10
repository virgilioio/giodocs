import { describe, expect, it } from "vitest";
import {
  buildRelationIndex,
  isComputedDef,
  readValueWith,
  relatedIds,
  rollupKind,
  rollupText,
  relationWrite,
  relationCandidates,
} from "./relations";
import { runView } from "./run-view";
import type { PageListItem } from "./types";

function pg(
  id: string,
  props: Record<string, unknown>,
  extra: Partial<PageListItem> = {},
): PageListItem {
  return {
    id,
    title: id.toUpperCase(),
    icon: "",
    props: props as PageListItem["props"],
    verified_at: "2026-10-01T10:00:00Z",
    verified_by: null,
    edited_at: "2026-10-01T10:00:00Z",
    edited_by: null,
    access_type: "workspace",
    ...extra,
  };
}

const DEFS = [
  { key: "project", type: "relation", config: { back: "tasks" } },
  { key: "tasks", type: "relation", config: { of: "project" } },
  { key: "effort", type: "number" },
  { key: "done", type: "checkbox" },
  { key: "due", type: "date" },
  { key: "total", type: "rollup", config: { relation: "tasks", target: "effort", calc: "sum" } },
  {
    key: "pct",
    type: "rollup",
    config: { relation: "tasks", target: "done", calc: "percent_checked" },
  },
  { key: "last", type: "rollup", config: { relation: "tasks", target: "due", calc: "latest" } },
  { key: "names", type: "rollup", config: { relation: "tasks", target: "title", calc: "show" } },
  { key: "bad", type: "rollup", config: { relation: "tasks" } },
];

const pages = [
  pg("p1", {}),
  pg("p2", {}),
  pg("t1", { project: ["p1"], effort: 3, done: true, due: "2026-10-20" }),
  pg("t2", { project: ["p1", "p1", "gone"], effort: 5, due: "2026-10-12/2026-10-22" }),
  pg("t3", { project: ["p2"], effort: 1 }),
  pg("t4", { project: ["p1"], effort: 100 }, { archived_at: "2026-10-01T00:00:00Z" }),
];
const idx = buildRelationIndex(pages, DEFS);
const byId = (id: string) => pages.find((p) => p.id === id)!;

describe("relations", () => {
  it("the near side lists pages the reader can open, once each", () => {
    expect(relatedIds(byId("t2"), "project", idx)).toEqual(["p1"]);
  });
  it("the far side is worked out from the near side", () => {
    expect(relatedIds(byId("p1"), "tasks", idx)).toEqual(["t1", "t2"]);
    expect(relatedIds(byId("p2"), "tasks", idx)).toEqual(["t3"]);
    expect(relatedIds(byId("t1"), "tasks", idx)).toEqual([]);
  });
  it("knows which properties are worked out", () => {
    expect(DEFS.filter(isComputedDef).map((d) => d.key)).toEqual([
      "tasks",
      "total",
      "pct",
      "last",
      "names",
      "bad",
    ]);
  });
});

describe("rollups", () => {
  const words = (v: unknown) => (v === null || v === undefined ? [] : [String(v)]);
  const now = new Date(2026, 9, 14);
  it("calculate over the related pages", () => {
    const p1 = byId("p1");
    expect(rollupText(p1, DEFS[5], idx, words, now)).toBe("8");
    expect(rollupText(p1, DEFS[6], idx, words, now)).toBe("50%");
    expect(rollupText(p1, DEFS[7], idx, words, now)).toBe("Oct 22");
    expect(rollupText(p1, DEFS[8], idx, words, now)).toBe("T1, T2");
    expect(rollupText(p1, DEFS[9], idx, words, now)).toBe("");
    expect(rollupKind(DEFS[5])).toBe("number");
    expect(rollupKind(DEFS[7])).toBe("date");
    expect(rollupKind(DEFS[8])).toBe("text");
  });
  it("views filter and sort on worked-out values", () => {
    const readValue = readValueWith(idx);
    const ctx = {
      me: "me",
      staleDays: 30,
      now,
      readValue,
      props: new Map([["total", { type: "rollup" }]]),
    };
    const projects = [byId("p1"), byId("p2")];
    expect(
      runView(
        projects,
        { filter: [{ op: "gt", prop: "total", value: 2 }], sort: { prop: "title", dir: "asc" } },
        ctx,
      ).map((p) => p.id),
    ).toEqual(["p1"]);
    expect(
      runView(projects, { filter: [], sort: { prop: "p:total", dir: "asc" } }, ctx).map(
        (p) => p.id,
      ),
    ).toEqual(["p2", "p1"]);
    expect(
      runView(
        projects,
        {
          filter: [{ op: "includes", prop: "tasks", value: "t3" }],
          sort: { prop: "title", dir: "asc" },
        },
        ctx,
      ).map((p) => p.id),
    ).toEqual(["p2"]);
    expect(
      runView(
        pages.slice(0, 2),
        { filter: [{ op: "not_empty", prop: "tasks" }], sort: { prop: "title", dir: "asc" } },
        ctx,
      ).map((p) => p.id),
    ).toEqual(["p1", "p2"]);
  });
});

describe("editing relations", () => {
  it("the near side changes this page; the far side changes the other page", () => {
    expect(relationWrite(DEFS[0], byId("t3"), "p1", true, idx)).toEqual({
      pageId: "t3",
      key: "project",
      value: ["p2", "p1"],
    });
    expect(relationWrite(DEFS[1], byId("p1"), "t1", false, idx)).toEqual({
      pageId: "t1",
      key: "project",
      value: [],
    });
    expect(relationWrite(DEFS[1], byId("p2"), "t1", true, idx)).toEqual({
      pageId: "t1",
      key: "project",
      value: ["p1", "p2"],
    });
  });
  it("an unlink keeps links the reader can't see", () => {
    expect(relationWrite(DEFS[0], byId("t2"), "p1", false, idx)?.value).toEqual(["gone"]);
  });
  it("candidates: a view's pages, or every page but this one", () => {
    const ctx = { me: "me", staleDays: 30 };
    const views = [{ id: "v1", filter: [{ op: "empty", prop: "project" }] }];
    const scoped = { key: "x", type: "relation", config: { view_id: "v1" } };
    expect(
      relationCandidates(scoped, byId("t1"), idx, views, ctx)
        .map((p) => p.id)
        .sort(),
    ).toEqual(["p1", "p2"]);
    expect(relationCandidates(DEFS[0], byId("t1"), idx, views, ctx).map((p) => p.id)).toEqual([
      "p1",
      "p2",
      "t2",
      "t3",
    ]);
  });
});
