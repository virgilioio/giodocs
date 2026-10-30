import { describe, expect, it } from "vitest";
import {
  advancedOf,
  appendTo,
  canNestAt,
  duplicateAt,
  getAt,
  newGroup,
  removeAt,
  setAt,
  setMode,
  turnIntoGroup,
  withAdvanced,
} from "./filter-tree";
import type { Filter } from "./run-view";

const a: Filter = { prop: "status", op: "eq", value: "todo" };
const b: Filter = { prop: "status", op: "eq", value: "done" };
const c: Filter = { prop: "owner", op: "is_me" };

describe("filter-tree", () => {
  it("sets, adds and removes the view's one advanced filter", () => {
    const g = newGroup("or", [a]);
    expect(advancedOf([c])).toBeNull();
    const with1 = withAdvanced([c], g);
    expect(with1).toEqual([c, g]);
    const g2 = newGroup("and", [b]);
    expect(withAdvanced(with1, g2)).toEqual([c, g2]);
    expect(withAdvanced(with1, null)).toEqual([c]);
  });

  it("edits rules by path, nested ones too", () => {
    let g = newGroup("or", [a, b]);
    g = turnIntoGroup(g, [1]);
    expect(getAt(g, [1])).toEqual(newGroup("and", [b]));
    g = appendTo(g, [1], c);
    expect(getAt(g, [1, 1])).toEqual(c);
    g = setAt(g, [1, 0], a);
    expect(getAt(g, [1, 0])).toEqual(a);
    g = setMode(g, [1], "or");
    expect(getAt(g, [1])?.mode).toBe("or");
    g = duplicateAt(g, [0]);
    expect(g.filters?.length).toBe(3);
    expect(getAt(g, [1])).toEqual(a);
    g = removeAt(g, [2, 1]);
    expect(getAt(g, [2])).toEqual({ op: "group", mode: "or", filters: [a] });
  });

  it("nests three levels deep at most", () => {
    expect(canNestAt([0])).toBe(true);
    expect(canNestAt([0, 0])).toBe(false);
    const g = turnIntoGroup(newGroup("and", [newGroup("or", [a])]), [0, 0]);
    expect(getAt(g, [0, 0])).toEqual(a);
  });
});
