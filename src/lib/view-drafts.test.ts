import { describe, expect, it } from "vitest";
import { areaBaseView, currentView, type ViewBase, type ViewDraft } from "./view-drafts";

const teamBase: ViewBase = {
  id: "v1",
  name: "Roadmap",
  scope: "team",
  layout: "table",
  filter: [{ op: "eq", prop: "status", value: "shipped" }],
  sort: { prop: "edited", dir: "desc" },
  group_by: null,
};

describe("currentView", () => {
  it("returns base unchanged when no draft exists", () => {
    const cv = currentView(teamBase, {});
    expect(cv._modified).toBe(false);
    expect(cv._base).toBe(teamBase);
    expect(cv.filter).toEqual(teamBase.filter);
    expect(cv.layout).toBe("table");
  });

  it("merges draft over base and flips _modified", () => {
    const drafts: Record<string, ViewDraft> = {
      v1: { layout: "board", group_by: "status" },
    };
    const cv = currentView(teamBase, drafts);
    expect(cv._modified).toBe(true);
    expect(cv.layout).toBe("board");
    expect(cv.group_by).toBe("status");
    // Untouched fields still come from base
    expect(cv.filter).toEqual(teamBase.filter);
    expect(cv.sort).toEqual(teamBase.sort);
    expect(cv.scope).toBe("team");
    expect(cv.id).toBe("v1");
  });

  it("does not carry drafts across base ids", () => {
    const drafts: Record<string, ViewDraft> = {
      other: { layout: "board" },
    };
    const cv = currentView(teamBase, drafts);
    expect(cv._modified).toBe(false);
    expect(cv.layout).toBe("table");
  });
});

describe("areaBaseView", () => {
  it("synthesises a base whose filter is a single area eq", () => {
    const b = areaBaseView("Engineering");
    expect(b.scope).toBe("area");
    expect(b.layout).toBe("table");
    expect(b.filter).toEqual([{ op: "eq", prop: "area", value: "Engineering" }]);
    expect(b.id).toBe("area:Engineering");
    expect(b.name).toBe("Engineering");
    expect(b.sort).toEqual({ prop: "edited", dir: "desc" });
  });

  it("participates in currentView + drafts identically to a team view", () => {
    const b = areaBaseView("Ops");
    const cv = currentView(b, {
      "area:Ops": { sort: { prop: "title", dir: "asc" } },
    });
    expect(cv._modified).toBe(true);
    expect(cv.sort).toEqual({ prop: "title", dir: "asc" });
    // Area filter is still present at index 0
    expect(cv.filter[0]).toEqual({ op: "eq", prop: "area", value: "Ops" });
  });
});
