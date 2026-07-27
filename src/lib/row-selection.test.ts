import { describe, expect, it } from "vitest";
import { rangeSelect } from "./row-selection";

const rows = ["a", "b", "c", "d", "e"];

describe("rangeSelect", () => {
  it("anchor above clicked selects inclusive downward range", () => {
    expect(rangeSelect(rows, "b", "d", [])).toEqual(["b", "c", "d"]);
  });

  it("anchor below clicked works in reverse direction", () => {
    expect(rangeSelect(rows, "d", "b", [])).toEqual(["b", "c", "d"]);
  });

  it("no anchor set: shift-click adds just the clicked id", () => {
    expect(rangeSelect(rows, null, "c", [])).toEqual(["c"]);
  });

  it("ADDS to an existing unrelated selection, never replaces it", () => {
    expect(rangeSelect(rows, "b", "c", ["e"])).toEqual(["e", "b", "c"]);
  });

  it("ignores ids not present in the rendered row list", () => {
    expect(rangeSelect(rows, "b", "zzz", ["a"])).toEqual(["a"]);
    expect(rangeSelect(rows, "zzz", "c", [])).toEqual(["c"]);
  });

  it("clicked === anchor collapses to a single add", () => {
    expect(rangeSelect(rows, "c", "c", [])).toEqual(["c"]);
  });

  it("does not duplicate ids already in the selection", () => {
    expect(rangeSelect(rows, "a", "c", ["b"])).toEqual(["b", "a", "c"]);
  });
});
