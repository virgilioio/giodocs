import { describe, expect, it } from "vitest";
import {
  appendControl,
  applySpanOp,
  clampCw,
  defaultCw,
  dragWidth,
  selAfterOp,
  shiftIndex,
  spanControls,
} from "./sheet-structure";
import { normalizeSheet, type SheetBlock } from "./sheet-model";
import { selAt, selectCols, selectRows } from "./sheet-select";

function grid(rows: number, cols: number): SheetBlock {
  return normalizeSheet({
    id: "s",
    type: "sheet",
    cells: Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => ({ v: `${r}${c}` })),
    ),
    cw: Array.from({ length: cols }, (_, c) => defaultCw(c)),
  });
}

const raw = (s: SheetBlock, r: number, c: number) => s.cells[r]?.[c]?.v;

/* ─────────────────────── contextual controls ─────────────────────── */

describe("spanControls", () => {
  it("is null without a full span", () => {
    expect(spanControls(selAt(1, 1), 5, 3)).toBeNull();
    expect(spanControls(null, 5, 3)).toBeNull();
  });

  it("labels one row and a multi-row span", () => {
    expect(spanControls(selectRows(3, 3, 3), 6, 3)!.label).toBe("Row 4");
    expect(spanControls(selectRows(3, 5, 3), 6, 3)!.label).toBe("Rows 4–6");
  });

  it("labels one column and a multi-column span", () => {
    expect(spanControls(selectCols(2, 2, 6), 6, 5)!.label).toBe("Column C");
    expect(spanControls(selectCols(2, 4, 6), 6, 5)!.label).toBe("Columns C–E");
  });

  it("row ops read Above · Below · Move up · Move down · Delete", () => {
    const ops = spanControls(selectRows(1, 1, 3), 6, 3)!.ops.map((o) => o.label);
    expect(ops).toEqual(["Above", "Below", "Move up", "Move down", "Delete"]);
  });

  it("column ops read Left · Right · Move left · Move right · Delete", () => {
    const ops = spanControls(selectCols(1, 1, 6), 6, 3)!.ops.map((o) => o.label);
    expect(ops).toEqual(["Left", "Right", "Move left", "Move right", "Delete"]);
  });

  it("greys Delete at the two-row floor with the right title", () => {
    const del = spanControls(selectRows(0, 0, 3), 2, 3)!.ops.find((o) => o.id === "delete")!;
    expect(del.enabled).toBe(false);
    expect(del.title).toBe("A sheet keeps at least two rows");
    expect(del.toast).toBe("A sheet keeps at least two rows");
    expect(del.danger).toBe(true);
  });

  it("greys Delete at the one-column floor with the right title", () => {
    const del = spanControls(selectCols(0, 0, 4), 4, 1, "col")!.ops.find((o) => o.id === "delete")!;
    expect(del.enabled).toBe(false);
    expect(del.title).toBe("A sheet keeps at least one column");
  });

  it("greys inserts at the bounds", () => {
    const rowIns = spanControls(selectRows(0, 0, 3), 100, 3)!.ops.filter((o) =>
      o.id.startsWith("insert"),
    );
    expect(rowIns.every((o) => !o.enabled)).toBe(true);
    expect(rowIns[0].title).toBe("100 rows is the limit");

    const colIns = spanControls(selectCols(0, 0, 4), 4, 26, "col")!.ops.filter((o) =>
      o.id.startsWith("insert"),
    );
    expect(colIns.every((o) => !o.enabled)).toBe(true);
    expect(colIns[1].title).toBe("26 columns is the limit");
  });

  it("a multi-row insert is refused when it would cross the bound", () => {
    const ops = spanControls(selectRows(0, 2, 3), 98, 3)!.ops;
    expect(ops.find((o) => o.id === "insertBefore")!.enabled).toBe(false);
    expect(spanControls(selectRows(0, 1, 3), 98, 3)!.ops[0].enabled).toBe(true);
  });

  it("greys Move at either end with Already first / Already last", () => {
    const first = spanControls(selectRows(0, 0, 3), 6, 3)!.ops;
    expect(first.find((o) => o.id === "moveBack")).toMatchObject({
      enabled: false,
      title: "Already first",
      toast: "Already first",
    });
    const last = spanControls(selectRows(5, 5, 3), 6, 3)!.ops;
    expect(last.find((o) => o.id === "moveFwd")).toMatchObject({
      enabled: false,
      title: "Already last",
    });
  });

  it("titles an enabled multi-span op with its count", () => {
    const ops = spanControls(selectRows(1, 3, 3), 8, 3)!.ops;
    expect(ops.find((o) => o.id === "insertBefore")!.title).toBe("Insert 3 rows above");
    expect(ops.find((o) => o.id === "delete")!.title).toBe("Delete 3 rows");
  });
});

describe("appendControl", () => {
  it("stays visible and inert at the bounds", () => {
    expect(appendControl("row", 6, 3)).toEqual({ enabled: true, title: "Add row" });
    expect(appendControl("row", 100, 3)).toEqual({
      enabled: false,
      title: "100 rows is the limit",
    });
    expect(appendControl("col", 6, 26)).toEqual({
      enabled: false,
      title: "26 columns is the limit",
    });
  });
});

/* ─────────────────────── applying the ops ─────────────────────── */

describe("applySpanOp goes through the model", () => {
  it("inserts a multi-row span as a block, above and below", () => {
    const s = applySpanOp(grid(4, 2), "row", 1, 2, "insertBefore");
    expect(s.cells.length).toBe(6);
    expect(raw(s, 1, 0)).toBeUndefined();
    expect(raw(s, 2, 0)).toBeUndefined();
    expect(raw(s, 3, 0)).toBe("10");

    const b = applySpanOp(grid(4, 2), "row", 1, 2, "insertAfter");
    expect(b.cells.length).toBe(6);
    expect(raw(b, 2, 0)).toBe("20");
    expect(raw(b, 3, 0)).toBeUndefined();
    expect(raw(b, 5, 0)).toBe("30");
  });

  it("deletes a multi-row span", () => {
    const s = applySpanOp(grid(5, 2), "row", 1, 2, "delete");
    expect(s.cells.length).toBe(3);
    expect(raw(s, 1, 0)).toBe("30");
  });

  it("moves a multi-row span preserving internal order", () => {
    const up = applySpanOp(grid(5, 2), "row", 2, 3, "moveBack");
    expect(up.cells.map((r) => r[0]?.v)).toEqual(["00", "20", "30", "10", "40"]);
    const down = applySpanOp(grid(5, 2), "row", 1, 2, "moveFwd");
    expect(down.cells.map((r) => r[0]?.v)).toEqual(["00", "30", "10", "20", "40"]);
  });

  it("column ops keep cw in lockstep", () => {
    const ins = applySpanOp(grid(2, 3), "col", 0, 1, "insertBefore");
    expect(ins.cw.length).toBe(5);
    expect(ins.cells[0].length).toBe(5);

    const del = applySpanOp(grid(2, 3), "col", 0, 1, "delete");
    expect(del.cw.length).toBe(1);
    expect(del.cells[0].length).toBe(1);

    const moved = applySpanOp(grid(2, 3), "col", 1, 2, "moveBack");
    expect(moved.cells[0].map((c) => c?.v)).toEqual(["01", "02", "00"]);
    expect(moved.cw).toEqual([120, 120, 160]);
  });

  it("refuses at the model bound rather than corrupting the grid", () => {
    const s = applySpanOp(grid(100, 2), "row", 0, 0, "insertBefore");
    expect(s.cells.length).toBe(100);
  });
});

/* ─────────────────────── index shifting ─────────────────────── */

describe("shiftIndex — the open editor's coordinates", () => {
  it("an insert above shifts the index down by the span size", () => {
    expect(shiftIndex(4, "insertBefore", 2, 2)).toBe(5);
    expect(shiftIndex(4, "insertBefore", 2, 4)).toBe(7);
    expect(shiftIndex(1, "insertBefore", 2, 2)).toBe(1);
  });

  it("an insert below leaves anything at or above the span alone", () => {
    expect(shiftIndex(2, "insertAfter", 2, 2)).toBe(2);
    expect(shiftIndex(3, "insertAfter", 2, 2)).toBe(4);
  });

  it("a delete of the index itself returns null", () => {
    expect(shiftIndex(3, "delete", 2, 4)).toBeNull();
    expect(shiftIndex(5, "delete", 2, 4)).toBe(2);
    expect(shiftIndex(1, "delete", 2, 4)).toBe(1);
  });

  it("moves swap the span with its neighbour", () => {
    expect(shiftIndex(2, "moveBack", 2, 3)).toBe(1);
    expect(shiftIndex(1, "moveBack", 2, 3)).toBe(3);
    expect(shiftIndex(0, "moveBack", 0, 1)).toBe(0);
    expect(shiftIndex(3, "moveFwd", 2, 3)).toBe(4);
    expect(shiftIndex(4, "moveFwd", 2, 3)).toBe(2);
    expect(shiftIndex(9, "moveFwd", 2, 3)).toBe(9);
  });
});

describe("selAfterOp leaves a valid selection", () => {
  it("deleting the selected row lands on the new row of the same number", () => {
    const s = selAfterOp("row", 3, 3, "delete", 5, 3);
    expect(s).toEqual(selectRows(3, 3, 3));
  });

  it("deleting the last row lands on the new last row", () => {
    const s = selAfterOp("row", 5, 5, "delete", 5, 3);
    expect(s).toEqual(selectRows(4, 4, 3));
  });

  it("an insert above keeps the same content selected", () => {
    expect(selAfterOp("row", 1, 2, "insertBefore", 6, 3)).toEqual(selectRows(3, 4, 3));
  });

  it("a move follows the span", () => {
    expect(selAfterOp("col", 1, 2, "moveFwd", 4, 5)).toEqual(selectCols(2, 3, 4));
    expect(selAfterOp("col", 1, 2, "moveBack", 4, 5)).toEqual(selectCols(0, 1, 4));
  });
});

/* ─────────────────────── column widths ─────────────────────── */

describe("column width arithmetic", () => {
  it("clamps at 56 and 420 during the drag", () => {
    expect(dragWidth(120, -400)).toBe(56);
    expect(dragWidth(120, 4000)).toBe(420);
    expect(dragWidth(120, 40)).toBe(160);
    expect(clampCw(Number.NaN)).toBe(56);
  });

  it("the per-column default is 160 for the first, 120 for the rest", () => {
    expect(defaultCw(0)).toBe(160);
    expect(defaultCw(1)).toBe(120);
    expect(defaultCw(7)).toBe(120);
  });
});
