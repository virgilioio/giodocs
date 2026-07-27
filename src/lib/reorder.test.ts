import { describe, it, expect } from "vitest";
import {
  moveBlock,
  moveRun,
  deleteIndices,
  moveBlockAcross,
  moveRunAcross,
  type Path,
} from "./reorder";

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

/* ────────── moveBlockAcross ──────────
 *
 * Fixture: a two-block top-level page whose second block is a columns
 * block with two columns. Every block has an id so paths are legible.
 *
 *   [t1] text "top-1"
 *   [cx] columns:
 *          col 0: [a1 "col-0-a", a2 "col-0-b"]
 *          col 1: [b1 "col-1-a"]
 *   [t2] text "top-2"
 */
type Blk = { id: string; type: string; text?: string; cols?: Blk[][] };
const seed = (): Blk => ({ id: "seed", type: "text", text: "" });
function fixture(): Blk[] {
  return [
    { id: "t1", type: "text", text: "top-1" },
    {
      id: "cx",
      type: "columns",
      cols: [
        [
          { id: "a1", type: "text", text: "col-0-a" },
          { id: "a2", type: "text", text: "col-0-b" },
        ],
        [{ id: "b1", type: "text", text: "col-1-a" }],
      ],
    },
    { id: "t2", type: "text", text: "top-2" },
  ];
}
const top = (i: number): Path => ({ col: null, index: i });
const inCol = (blockId: string, colIndex: number, index: number): Path => ({
  col: { blockId, colIndex },
  index,
});

describe("moveBlockAcross — top-level → top-level (existing behaviour)", () => {
  it("delegates to moveBlock's semantics", () => {
    const bs = fixture();
    // Move t1 (index 0) to gap 2 → t2 slides up, columns stays.
    const next = moveBlockAcross(bs, top(0), top(2), seed);
    expect(next.map((b) => b.id)).toEqual(["cx", "t1", "t2"]);
    // Deep equality on the untouched columns block.
    expect(next[0].cols).toEqual(bs[1].cols);
  });
});

describe("moveBlockAcross — top-level → column", () => {
  it("removes from top level and inserts at gap in the target column", () => {
    const bs = fixture();
    // Move t1 into cx.col[0] at gap 1 (between a1 and a2).
    const next = moveBlockAcross(bs, top(0), inCol("cx", 0, 1), seed);
    expect(next.map((b) => b.id)).toEqual(["cx", "t2"]);
    const cx = next.find((b) => b.id === "cx")!;
    expect(cx.cols![0].map((x) => x.id)).toEqual(["a1", "t1", "a2"]);
    expect(cx.cols![1].map((x) => x.id)).toEqual(["b1"]);
  });
});

describe("moveBlockAcross — column → top-level", () => {
  it("removes from the source column and inserts at top-level gap", () => {
    const bs = fixture();
    // Move a1 out to top-level gap 0.
    const next = moveBlockAcross(bs, inCol("cx", 0, 0), top(0), seed);
    expect(next.map((b) => b.id)).toEqual(["a1", "t1", "cx", "t2"]);
    const cx = next.find((b) => b.id === "cx")!;
    expect(cx.cols![0].map((x) => x.id)).toEqual(["a2"]);
    expect(cx.cols![1].map((x) => x.id)).toEqual(["b1"]);
  });
});

describe("moveBlockAcross — column A → column B of the same columns block", () => {
  it("moves the block between siblings", () => {
    const bs = fixture();
    // Move a2 (cx.col[0] idx 1) into cx.col[1] at gap 1 (after b1).
    const next = moveBlockAcross(bs, inCol("cx", 0, 1), inCol("cx", 1, 1), seed);
    const cx = next.find((b) => b.id === "cx")!;
    expect(cx.cols![0].map((x) => x.id)).toEqual(["a1"]);
    expect(cx.cols![1].map((x) => x.id)).toEqual(["b1", "a2"]);
  });
});

describe("moveBlockAcross — reseed empty column", () => {
  it("moving the last block out of a column leaves that column with one empty text block", () => {
    const bs = fixture();
    // Move b1 out of cx.col[1] (its only inhabitant).
    const next = moveBlockAcross(bs, inCol("cx", 1, 0), top(3), seed);
    const cx = next.find((b) => b.id === "cx")!;
    expect(cx.cols![1].length).toBe(1);
    expect(cx.cols![1][0].id).toBe("seed");
    expect(cx.cols![1][0].type).toBe("text");
    // And b1 landed at the end top-level.
    expect(next.map((b) => b.id)).toEqual(["t1", "cx", "t2", "b1"]);
  });
});

describe("moveBlockAcross — no nesting", () => {
  it("attempting to move a columns block into a column is a no-op", () => {
    const bs = fixture();
    const next = moveBlockAcross(bs, top(1), inCol("cx", 0, 0), seed);
    expect(next).toEqual(bs);
  });
});

describe("moveRunAcross — no-op when the run spans different columns", () => {
  it("returns blocks unchanged", () => {
    const bs = fixture();
    // A run whose two paths live in different columns of the same block.
    const froms = [inCol("cx", 0, 0), inCol("cx", 1, 0)];
    const next = moveRunAcross(bs, froms, top(0), seed);
    expect(next).toEqual(bs);
  });
  it("moves a contiguous top-level run into a column", () => {
    const bs = fixture();
    // Not really "run of 1"; do a run of one from top and one bounds check.
    const froms = [top(0)];
    const next = moveRunAcross(bs, froms, inCol("cx", 1, 0), seed);
    const cx = next.find((b) => b.id === "cx")!;
    expect(cx.cols![1].map((x) => x.id)).toEqual(["t1", "b1"]);
    expect(next.map((b) => b.id)).toEqual(["cx", "t2"]);
  });
});

describe("reclampIndents — reorder must not leave orphan levels", () => {
  it("dragging a deep block above a shallower neighbour re-clamps", async () => {
    const { reclampIndents } = await import("./block-ops");
    // Simulate a moved list: deep item ends up before its shallower parent.
    const moved = [
      { id: "b", type: "bullet", text: "b", indent: 2 },  // orphan (no parent)
      { id: "a", type: "bullet", text: "a", indent: 0 },
    ] as never[];
    const out = reclampIndents(moved);
    expect((out[0] as { indent?: number }).indent).toBeUndefined();
    expect((out[1] as { indent?: number }).indent).toBeUndefined();
  });
});
