import { describe, expect, it } from "vitest";
import {
  addCol,
  addRow,
  CW_DEFAULT,
  deleteCol,
  deleteRow,
  MAX_COLS,
  MAX_ROWS,
  moveCol,
  moveRow,
  newSheet,
  normalizeSheet,
  setCell,
  setColWidth,
  type SheetBlock,
} from "./sheet-model";

function sheet(cells: SheetBlock["cells"], cw?: number[]): SheetBlock {
  return normalizeSheet({ id: "s1", type: "sheet", cells, cw });
}

describe("newSheet", () => {
  it("creates a rectangular grid with widths in lockstep", () => {
    const s = newSheet(4, 3);
    expect(s.cells.length).toBe(4);
    expect(s.cells.every((r) => r.length === 3)).toBe(true);
    expect(s.cw).toEqual([CW_DEFAULT, CW_DEFAULT, CW_DEFAULT]);
  });

  it("clamps to the 100×26 bounds", () => {
    const s = newSheet(500, 99);
    expect(s.cells.length).toBe(MAX_ROWS);
    expect(s.cells[0].length).toBe(MAX_COLS);
    expect(s.cw.length).toBe(MAX_COLS);
  });

  it("holds the 2-row / 1-column floors", () => {
    const s = newSheet(0, 0);
    expect(s.cells.length).toBe(2);
    expect(s.cells[0].length).toBe(1);
  });
});

describe("normalizeSheet", () => {
  it("pads ragged rows and keeps cw in lockstep", () => {
    const s = sheet([[{ v: 1 }, { v: 2 }, { v: 3 }], [{ v: 4 }], []], [120]);
    expect(s.cells.map((r) => r.length)).toEqual([3, 3, 3]);
    expect(s.cw).toEqual([120, CW_DEFAULT, CW_DEFAULT]);
  });

  it("clamps out-of-range widths", () => {
    const s = sheet([[{ v: 1 }, { v: 2 }]], [1, 99999]);
    expect(s.cw[0]).toBe(56);
    expect(s.cw[1]).toBe(1200);
  });

  it("drops a computed-value leak and keeps only known cell keys", () => {
    const s = normalizeSheet({
      cells: [[{ v: "=1+1", computed: 2, bg: "mint" } as never]],
    });
    expect(s.cells[0][0]).toEqual({ v: "=1+1", bg: "mint" });
  });

  it("survives a missing or malformed input", () => {
    const s = normalizeSheet(null);
    expect(s.cells.length).toBe(2);
    expect(s.cw.length).toBe(1);
  });
});

describe("row ops", () => {
  it("addRow inserts an empty row of the right width", () => {
    const s = addRow(sheet([[{ v: 1 }, { v: 2 }], [null, null]]), 1);
    expect(s.cells.length).toBe(3);
    expect(s.cells[1]).toEqual([null, null]);
  });

  it("addRow refuses past the 100-row bound", () => {
    const s = addRow(newSheet(MAX_ROWS, 2), 0);
    expect(s.cells.length).toBe(MAX_ROWS);
  });

  it("deleteRow removes the row", () => {
    const s = deleteRow(sheet([[{ v: 1 }], [{ v: 2 }], [{ v: 3 }]]), 1);
    expect(s.cells.map((r) => r[0]?.v)).toEqual([1, 3]);
  });

  it("deleteRow refuses at the 2-row floor", () => {
    const s = deleteRow(sheet([[{ v: 1 }], [{ v: 2 }]]), 0);
    expect(s.cells.length).toBe(2);
  });

  it("moveRow reorders", () => {
    const s = moveRow(sheet([[{ v: 1 }], [{ v: 2 }], [{ v: 3 }]]), 0, 2);
    expect(s.cells.map((r) => r[0]?.v)).toEqual([2, 3, 1]);
  });
});

describe("column ops splice cw in step", () => {
  const base = sheet(
    [
      [{ v: "a" }, { v: "b" }, { v: "c" }],
      [null, null, null],
    ],
    [100, 200, 300],
  );

  it("addCol inserts a width alongside the column", () => {
    const s = addCol(base, 1, 150);
    expect(s.cells[0].map((c) => c?.v)).toEqual(["a", undefined, "b", "c"]);
    expect(s.cw).toEqual([100, 150, 200, 300]);
    expect(s.cw.length).toBe(s.cells[0].length);
  });

  it("addCol refuses past the 26-column bound", () => {
    const s = addCol(newSheet(2, MAX_COLS), 0);
    expect(s.cells[0].length).toBe(MAX_COLS);
    expect(s.cw.length).toBe(MAX_COLS);
  });

  it("deleteCol drops the matching width", () => {
    const s = deleteCol(base, 1);
    expect(s.cells[0].map((c) => c?.v)).toEqual(["a", "c"]);
    expect(s.cw).toEqual([100, 300]);
  });

  it("deleteCol refuses at the 1-column floor", () => {
    const s = deleteCol(sheet([[{ v: 1 }], [null]]), 0);
    expect(s.cells[0].length).toBe(1);
    expect(s.cw.length).toBe(1);
  });

  it("moveCol carries the width along", () => {
    const s = moveCol(base, 0, 2);
    expect(s.cells[0].map((c) => c?.v)).toEqual(["b", "c", "a"]);
    expect(s.cw).toEqual([200, 300, 100]);
  });

  it("setColWidth clamps and ignores an out-of-range index", () => {
    expect(setColWidth(base, 1, 10).cw).toEqual([100, 56, 300]);
    expect(setColWidth(base, 9, 400).cw).toEqual([100, 200, 300]);
  });
});

describe("setCell", () => {
  it("merges a patch and stores the raw entry, never a computed value", () => {
    const s = setCell(sheet([[null], [null]]), 0, 0, { v: "=1+1", f: "num" });
    expect(s.cells[0][0]).toEqual({ v: "=1+1", f: "num" });
  });

  it("clears a cell with null", () => {
    const s = setCell(sheet([[{ v: 5 }], [null]]), 0, 0, null);
    expect(s.cells[0][0]).toBeNull();
  });

  it("clamps decimals to 0–4", () => {
    const s = setCell(sheet([[null], [null]]), 0, 0, { d: 9 });
    expect(s.cells[0][0]?.d).toBe(4);
  });

  it("ignores an out-of-range coordinate", () => {
    const s = setCell(sheet([[{ v: 1 }], [null]]), 5, 5, { v: 2 });
    expect(s.cells[0][0]?.v).toBe(1);
  });
});
