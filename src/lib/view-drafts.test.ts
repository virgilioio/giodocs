import { describe, expect, it } from "vitest";
import { currentView, type ViewBase, type ViewDraft } from "./view-drafts";

const teamBase: ViewBase = {
  id: "v1",
  name: "Roadmap",
  scope: "team",
  layout: "table",
  filter: [{ op: "eq", prop: "status", value: "shipped" }],
  sort: { prop: "edited", dir: "desc" },
  group_by: null,
  config: {},
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


describe("currentView and table settings", () => {
  it("a draft that only resizes properties isn't a change to the view", () => {
    const c = currentView(teamBase, { v1: { config: { widths: { due: 200 } } } });
    expect(c._modified).toBe(false);
    expect(c.config.widths).toEqual({ due: 200 });
  });
  it("hiding or moving a property is", () => {
    const c = currentView(teamBase, { v1: { config: { props: ["due"] } } });
    expect(c._modified).toBe(true);
  });
});
