import { describe, it, expect } from "vitest";
import { rowsInScope, sameScope, type ScopedRow } from "./marquee-scope";

const COL0 = { blockId: "cols1", colIndex: 0 };
const COL1 = { blockId: "cols1", colIndex: 1 };
const CALL = { blockId: "call1", callout: true as const };

const ROWS: ScopedRow[] = [
  { id: "top1", scope: null },
  { id: "cols1", scope: null }, // the columns block's own top-level row
  { id: "c0a", scope: COL0 },
  { id: "c0b", scope: COL0 },
  { id: "c1a", scope: COL1 },
  { id: "call1", scope: null }, // the callout's own top-level row
  { id: "k1", scope: CALL },
  { id: "top2", scope: null },
];

describe("sameScope", () => {
  it("page scope equals only page scope", () => {
    expect(sameScope(null, null)).toBe(true);
    expect(sameScope(null, COL0)).toBe(false);
    expect(sameScope(COL0, null)).toBe(false);
  });
  it("distinguishes sibling columns and callouts of the same block id", () => {
    expect(sameScope(COL0, { blockId: "cols1", colIndex: 0 })).toBe(true);
    expect(sameScope(COL0, COL1)).toBe(false);
    expect(sameScope(CALL, { blockId: "call1", callout: true })).toBe(true);
    expect(sameScope(CALL, { blockId: "call1", colIndex: 0 })).toBe(false);
  });
});

describe("rowsInScope", () => {
  it("page scope selects top-level rows and EXCLUDES column children", () => {
    expect(rowsInScope(null, ROWS).map((r) => r.id)).toEqual([
      "top1",
      "cols1",
      "call1",
      "top2",
    ]);
  });

  it("column scope excludes top-level rows, the parent, and sibling columns", () => {
    expect(rowsInScope(COL0, ROWS).map((r) => r.id)).toEqual(["c0a", "c0b"]);
    expect(rowsInScope(COL1, ROWS).map((r) => r.id)).toEqual(["c1a"]);
  });

  it("callout scope excludes everything outside that callout", () => {
    expect(rowsInScope(CALL, ROWS).map((r) => r.id)).toEqual(["k1"]);
  });

  it("preserves input (document) order", () => {
    const shuffled = [ROWS[3], ROWS[2]];
    expect(rowsInScope(COL0, shuffled).map((r) => r.id)).toEqual(["c0b", "c0a"]);
  });
});
