import { describe, it, expect } from "vitest";
import { moveBlock, moveRun, deleteIndices } from "./reorder";

const A = ["a", "b", "c", "d", "e"] as const;

describe("moveBlock", () => {
  it("moves a block down one slot", () => {
    // move index 1 ("b") to gap 3 → ["a","c","b","d","e"]
    expect(moveBlock(A, 1, 3)).toEqual(["a", "c", "b", "d", "e"]);
  });
  it("moves a block up one slot", () => {
    // move index 3 ("d") to gap 1 → ["a","d","b","c","e"]
    expect(moveBlock(A, 3, 1)).toEqual(["a", "d", "b", "c", "e"]);
  });
  it("moves a block to the very top", () => {
    expect(moveBlock(A, 4, 0)).toEqual(["e", "a", "b", "c", "d"]);
  });
  it("moves a block to the very bottom", () => {
    expect(moveBlock(A, 0, 5)).toEqual(["b", "c", "d", "e", "a"]);
  });
  it("no-ops when dropped on its own position", () => {
    expect(moveBlock(A, 2, 2)).toEqual([...A]);
    expect(moveBlock(A, 2, 3)).toEqual([...A]);
  });
});

describe("moveRun", () => {
  it("moves a contiguous run and preserves internal order", () => {
    // run [1..2] = ["b","c"] to gap 5 (very bottom) → ["a","d","e","b","c"]
    expect(moveRun(A, 1, 2, 5)).toEqual(["a", "d", "e", "b", "c"]);
  });
  it("moves a run to the very top", () => {
    // run [2..3] = ["c","d"] to gap 0 → ["c","d","a","b","e"]
    expect(moveRun(A, 2, 3, 0)).toEqual(["c", "d", "a", "b", "e"]);
  });
  it("no-ops when target is inside the run", () => {
    expect(moveRun(A, 1, 3, 2)).toEqual([...A]);
    expect(moveRun(A, 1, 3, 1)).toEqual([...A]);
    expect(moveRun(A, 1, 3, 4)).toEqual([...A]);
  });
});

describe("deleteIndices", () => {
  it("removes selected indices", () => {
    expect(deleteIndices(A, [1, 3], () => "x")).toEqual(["a", "c", "e"]);
  });
  it("yields one empty block when deletion empties the page", () => {
    expect(deleteIndices(A, [0, 1, 2, 3, 4], () => "EMPTY")).toEqual(["EMPTY"]);
  });
});
