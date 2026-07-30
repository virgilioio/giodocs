import { describe, it, expect } from "vitest";
import {
  moveBlock,
  moveRun,
  deleteIndices,
  moveBlockAcross,
  moveRunAcross,
  getContainerList,
  setContainerList,
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
    expect((out[0] as { indent?: number }).indent).toBe(1);
    expect((out[1] as { indent?: number }).indent).toBe(0);
  });
});

/* ────────── moveBlockAcross — callouts as containers ──────────
 *
 * Fixture parallels the columns one: a top-level list with a callout
 * that starts either "unmigrated" (has `text`, no `children`) or already
 * container-shaped (has `children`, `text` blanked).
 */
type CBlk = { id: string; type: string; text?: string; cols?: CBlk[][]; children?: CBlk[] };
const cSeed = (): CBlk => ({ id: "seed", type: "text", text: "" });
const inCallout = (blockId: string, index: number): Path => ({
  col: { blockId, callout: true },
  index,
});

describe("moveBlockAcross — top-level → callout (lazy migration)", () => {
  it("first drop into an untouched callout migrates text → child + drops after it", () => {
    const bs: CBlk[] = [
      { id: "t1", type: "text", text: "top-1" },
      { id: "ca", type: "callout", text: "hello" },
      { id: "t2", type: "text", text: "top-2" },
    ];
    // Callout is currently `{text:"hello"}`. Reading with lazy migration
    // synthesises a single text child, so gap 1 is "after that text".
    const next = moveBlockAcross(bs, top(0), inCallout("ca", 1), cSeed);
    expect(next.map((b) => b.id)).toEqual(["ca", "t2"]);
    const ca = next.find((b) => b.id === "ca")!;
    expect(ca.text).toBe("");
    expect(ca.children!.map((c) => c.text)).toEqual(["hello", "top-1"]);
    expect(ca.children!.map((c) => c.type)).toEqual(["text", "text"]);
  });

  it("callout that already has children is NOT re-migrated", () => {
    const bs: CBlk[] = [
      { id: "t1", type: "text", text: "top-1" },
      {
        id: "ca",
        type: "callout",
        text: "",
        children: [
          { id: "x", type: "text", text: "x" },
          { id: "y", type: "text", text: "y" },
        ],
      },
    ];
    // Drop t1 into the middle. Should become [x, t1, y] — NO duplicated x.
    const next = moveBlockAcross(bs, top(0), inCallout("ca", 1), cSeed);
    expect(next.map((b) => b.id)).toEqual(["ca"]);
    const ca = next.find((b) => b.id === "ca")!;
    expect(ca.children!.map((c) => c.id)).toEqual(["x", "t1", "y"]);
  });
});

describe("moveBlockAcross — callout ↔ elsewhere", () => {
  it("callout → top level: moving the last child out reseeds one empty text block", () => {
    const bs: CBlk[] = [
      { id: "t1", type: "text", text: "top-1" },
      {
        id: "ca",
        type: "callout",
        text: "",
        children: [{ id: "x", type: "text", text: "x" }],
      },
    ];
    const next = moveBlockAcross(bs, inCallout("ca", 0), top(0), cSeed);
    // x lifted to top level, callout children reseeded with one empty text.
    expect(next.map((b) => b.id)).toEqual(["x", "t1", "ca"]);
    const ca = next.find((b) => b.id === "ca")!;
    expect(ca.children!.length).toBe(1);
    expect(ca.children![0].id).toBe("seed");
    expect(ca.children![0].type).toBe("text");
  });

  it("callout → column of a columns block", () => {
    const bs: CBlk[] = [
      {
        id: "ca",
        type: "callout",
        text: "",
        children: [
          { id: "x", type: "text", text: "x" },
          { id: "y", type: "text", text: "y" },
        ],
      },
      {
        id: "cx",
        type: "columns",
        cols: [[{ id: "b1", type: "text", text: "b1" }], [{ id: "b2", type: "text", text: "b2" }]],
      },
    ];
    const next = moveBlockAcross(bs, inCallout("ca", 0), inCol("cx", 0, 1), cSeed);
    const ca = next.find((b) => b.id === "ca")!;
    const cx = next.find((b) => b.id === "cx")!;
    expect(ca.children!.map((c) => c.id)).toEqual(["y"]);
    expect(cx.cols![0].map((c) => c.id)).toEqual(["b1", "x"]);
  });

  it("column → callout (drop out of a column into a callout container)", () => {
    const bs: CBlk[] = [
      {
        id: "cx",
        type: "columns",
        cols: [
          [
            { id: "b1", type: "text", text: "b1" },
            { id: "b2", type: "text", text: "b2" },
          ],
        ],
      },
      {
        id: "ca",
        type: "callout",
        text: "",
        children: [{ id: "x", type: "text", text: "x" }],
      },
    ];
    const next = moveBlockAcross(bs, inCol("cx", 0, 0), inCallout("ca", 1), cSeed);
    const cx = next.find((b) => b.id === "cx")!;
    const ca = next.find((b) => b.id === "ca")!;
    expect(cx.cols![0].map((c) => c.id)).toEqual(["b2"]);
    expect(ca.children!.map((c) => c.id)).toEqual(["x", "b1"]);
  });

  it("callout → same callout (reorder within children)", () => {
    const bs: CBlk[] = [
      {
        id: "ca",
        type: "callout",
        text: "",
        children: [
          { id: "x", type: "text", text: "x" },
          { id: "y", type: "text", text: "y" },
          { id: "z", type: "text", text: "z" },
        ],
      },
    ];
    // Move x (idx 0) to gap 3 (end) → [y, z, x].
    const next = moveBlockAcross(bs, inCallout("ca", 0), inCallout("ca", 3), cSeed);
    const ca = next.find((b) => b.id === "ca")!;
    expect(ca.children!.map((c) => c.id)).toEqual(["y", "z", "x"]);
  });
});

describe("moveBlockAcross — callout container invariants (refusals)", () => {
  it("refuses to drop a callout into another callout (no callout in callout)", () => {
    const bs: CBlk[] = [
      { id: "src", type: "callout", text: "", children: [{ id: "x", type: "text", text: "x" }] },
      { id: "ca", type: "callout", text: "", children: [{ id: "y", type: "text", text: "y" }] },
    ];
    const next = moveBlockAcross(bs, top(0), inCallout("ca", 1), cSeed);
    expect(next).toEqual(bs);
  });

  it("refuses to drop a columns block into a callout (no columns in callout)", () => {
    const bs: CBlk[] = [
      { id: "cx", type: "columns", cols: [[{ id: "b1", type: "text" }], [{ id: "b2", type: "text" }]] },
      { id: "ca", type: "callout", text: "", children: [{ id: "x", type: "text", text: "x" }] },
    ];
    const next = moveBlockAcross(bs, top(0), inCallout("ca", 1), cSeed);
    expect(next).toEqual(bs);
  });

  it("a callout INSIDE a column still works (legal direction, easy to break)", () => {
    // Dropping a callout at top level into a column is legal — the "no
    // nesting" rule is columns-in-columns, not callouts-in-columns.
    const bs: CBlk[] = [
      { id: "ca", type: "callout", text: "hi" },
      { id: "cx", type: "columns", cols: [[{ id: "b1", type: "text", text: "b1" }]] },
    ];
    const next = moveBlockAcross(bs, top(0), inCol("cx", 0, 1), cSeed);
    const cx = next.find((b) => b.id === "cx")!;
    expect(next.map((b) => b.id)).toEqual(["cx"]);
    expect(cx.cols![0].map((c) => c.id)).toEqual(["b1", "ca"]);
    // Callout kept its text — no accidental migration on the OUT direction.
    const ca = cx.cols![0].find((c) => c.id === "ca")!;
    expect(ca.text).toBe("hi");
    expect(ca.children).toBeUndefined();
  });
});

describe("moveRunAcross — multi-block runs into a callout", () => {
  it("moves a contiguous run of three top-level blocks into a callout, preserving order", () => {
    const bs: CBlk[] = [
      { id: "a", type: "text", text: "a" },
      { id: "b", type: "text", text: "b" },
      { id: "c", type: "text", text: "c" },
      { id: "ca", type: "callout", text: "", children: [{ id: "x", type: "text", text: "x" }] },
    ];
    const next = moveRunAcross(bs, [top(0), top(1), top(2)], inCallout("ca", 1), cSeed);
    const ca = next.find((b) => b.id === "ca")!;
    expect(next.map((b) => b.id)).toEqual(["ca"]);
    expect(ca.children!.map((c) => c.id)).toEqual(["x", "a", "b", "c"]);
  });

  it("refuses to drop a run containing a callout into another callout", () => {
    const bs: CBlk[] = [
      { id: "src", type: "callout", text: "", children: [{ id: "x", type: "text", text: "x" }] },
      { id: "t", type: "text", text: "t" },
      { id: "ca", type: "callout", text: "", children: [{ id: "y", type: "text", text: "y" }] },
    ];
    const next = moveRunAcross(bs, [top(0), top(1)], inCallout("ca", 1), cSeed);
    expect(next).toEqual(bs);
  });
});

/* Handle ops (Delete / Move / Duplicate / Turn into) resolve a block's own
 * container first. These assert the scoped read-modify-write the editor
 * performs, including the top-level (null scope) case. */
describe("container list round-trip for handle ops", () => {
  const inner = [
    { id: "c0", type: "text", text: "one" },
    { id: "c1", type: "text", text: "two" },
  ];
  const doc = [
    { id: "t0", type: "text", text: "top" },
    { id: "cols", type: "columns", cols: [inner, []] },
  ];

  it("deletes inside a column without touching top level", () => {
    const list = getContainerList(doc, { blockId: "cols", colIndex: 0 })!;
    const next = deleteIndices(list, [0], () => ({ id: "x", type: "text", text: "" }));
    const out = setContainerList(doc, { blockId: "cols", colIndex: 0 }, next);
    expect(getContainerList(out, { blockId: "cols", colIndex: 0 })!.map((b) => b.id)).toEqual(["c1"]);
    expect(out.map((b) => b.id)).toEqual(["t0", "cols"]);
  });

  it("null scope reads and writes the top-level list", () => {
    const list = getContainerList(doc, null)!;
    expect(list.map((b) => b.id)).toEqual(["t0", "cols"]);
    const next = deleteIndices(list, [0], () => ({ id: "x", type: "text", text: "" }));
    expect(next.map((b) => b.id)).toEqual(["cols"]);
    expect(setContainerList(doc, null, next).map((b) => b.id)).toEqual(["cols"]);
  });
});
