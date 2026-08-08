import { describe, expect, it } from "vitest";
import {
  cellBox,
  cellsIn,
  colLabel,
  colLeft,
  fullSpan,
  HEAD_H,
  keyWhenEditing,
  keyWhenSelected,
  rangeBox,
  rangeRef,
  rect,
  refLabel,
  ROW_H,
  ROW_NUM_W,
  rowTop,
  selAt,
  selectAll,
  selectCols,
  selectRows,
  step,
  type Sel,
} from "./sheet-select";

const CW = [160, 120, 120, 100];

describe("geometry is arithmetic, never measured", () => {
  it("column lefts start after the row-number gutter", () => {
    expect(colLeft(CW, 0)).toBe(ROW_NUM_W);
    expect(colLeft(CW, 1)).toBe(34 + 160);
    expect(colLeft(CW, 3)).toBe(34 + 160 + 120 + 120);
  });

  it("row tops start below the header", () => {
    expect(rowTop(0)).toBe(HEAD_H);
    expect(rowTop(4)).toBe(26 + 4 * 29);
  });

  it("the editor box is exactly the cell", () => {
    expect(cellBox(CW, 2, 1)).toEqual({ left: 194, top: 26 + 58, width: 120, height: ROW_H });
  });

  it("the range box spans every column and row in the rectangle", () => {
    const box = rangeBox(CW, { r0: 1, c0: 1, r1: 3, c1: 2 });
    expect(box).toEqual({ left: 194, top: 26 + 29, width: 240, height: 3 * 29 });
  });
});

describe("the range rectangle from any two corners", () => {
  const corners: [Sel, string][] = [
    [{ ar: 1, ac: 1, fr: 3, fc: 3 }, "down-right"],
    [{ ar: 3, ac: 3, fr: 1, fc: 1 }, "up-left"],
    [{ ar: 1, ac: 3, fr: 3, fc: 1 }, "down-left"],
    [{ ar: 3, ac: 1, fr: 1, fc: 3 }, "up-right"],
  ];
  for (const [sel, name] of corners) {
    it(`normalises a ${name} drag to the same rectangle`, () => {
      expect(rect(sel)).toEqual({ r0: 1, c0: 1, r1: 3, c1: 3 });
    });
  }

  it("enumerates cells row-major", () => {
    expect(cellsIn({ r0: 0, c0: 0, r1: 1, c1: 1 })).toEqual([
      { r: 0, c: 0 },
      { r: 0, c: 1 },
      { r: 1, c: 0 },
      { r: 1, c: 1 },
    ]);
  });
});

describe("full-span predicate (chunk 5 keys off this)", () => {
  it("a header click is a full column span", () => {
    const s = selectCols(2, 2, 6);
    expect(fullSpan(s, 6, 4)).toMatchObject({ cols: true, rows: false, all: false });
  });

  it("a row-number click is a full row span", () => {
    expect(fullSpan(selectRows(1, 1, 4), 6, 4)).toMatchObject({ cols: false, rows: true });
  });

  it("the corner selects everything", () => {
    expect(fullSpan(selectAll(6, 4), 6, 4)).toMatchObject({ all: true });
  });

  it("an ordinary range is neither", () => {
    expect(fullSpan({ ar: 1, ac: 1, fr: 2, fc: 2 }, 6, 4)).toMatchObject({
      cols: false,
      rows: false,
      all: false,
    });
  });
});

describe("step", () => {
  it("clamps at every edge", () => {
    expect(step(0, 0, -1, 0, 5, 3)).toEqual({ r: 0, c: 0 });
    expect(step(4, 2, 1, 1, 5, 3)).toEqual({ r: 4, c: 2 });
  });

  it("Tab wraps to the first column of the next row", () => {
    expect(step(1, 2, 0, 1, 5, 3, true)).toEqual({ r: 2, c: 0 });
  });

  it("Shift+Tab wraps back to the last column of the previous row", () => {
    expect(step(2, 0, 0, -1, 5, 3, true)).toEqual({ r: 1, c: 2 });
  });

  it("wrapping past the last cell stays put — a sheet never grows by typing", () => {
    expect(step(4, 2, 0, 1, 5, 3, true)).toEqual({ r: 4, c: 2 });
  });
});

describe("keyboard decision — cell selected, not editing", () => {
  const s = selAt(2, 1);
  const k = (key: string, extra: Partial<{ shift: boolean; meta: boolean }> = {}) =>
    keyWhenSelected({ key, ...extra }, s, 6, 4);

  it("Enter edits with the existing value SELECTED", () =>
    expect(k("Enter")).toEqual({ kind: "edit", seed: null, sel: true }));

  it("a printable character seeds the edit with the caret after it", () =>
    expect(k("H")).toEqual({ kind: "edit", seed: "H", sel: false }));

  it("Backspace clears the range — it must never reach the page", () =>
    expect(k("Backspace")).toEqual({ kind: "clearRange" }));

  it("Delete clears the range too", () =>
    expect(k("Delete")).toEqual({ kind: "clearRange" }));

  it("arrows move the selection", () =>
    expect(k("ArrowDown")).toEqual({ kind: "move", r: 3, c: 1 }));

  it("Shift+arrows extend the range", () =>
    expect(k("ArrowRight", { shift: true })).toEqual({ kind: "extend", r: 2, c: 2 }));

  it("Escape clears the cell selection before the page's Escape stack", () =>
    expect(k("Escape")).toEqual({ kind: "clearSelection" }));

  it("⌘B / ⌘I are the sheet's, not prose formatting", () => {
    expect(k("b", { meta: true })).toEqual({ kind: "bold" });
    expect(k("i", { meta: true })).toEqual({ kind: "italic" });
  });

  it("⌘Z and ⌘C pass through to the page and the browser", () => {
    expect(k("z", { meta: true })).toEqual({ kind: "pass" });
    expect(k("c", { meta: true })).toEqual({ kind: "pass" });
  });

  it("Tab moves right with wrap", () =>
    expect(k("Tab")).toEqual({ kind: "move", r: 2, c: 2 }));
});

describe("keyboard decision — editing", () => {
  const k = (key: string, extra: Partial<{ shift: boolean }> = {}) =>
    keyWhenEditing({ key, ...extra }, 2, 1, 6, 4);

  it("Enter commits and moves down", () =>
    expect(k("Enter")).toEqual({ kind: "commit", r: 3, c: 1 }));

  it("Enter on the last row commits and stays", () =>
    expect(keyWhenEditing({ key: "Enter" }, 5, 1, 6, 4)).toEqual({ kind: "commit", r: 5, c: 1 }));

  it("Tab commits and moves right", () =>
    expect(k("Tab")).toEqual({ kind: "commit", r: 2, c: 2 }));

  it("Shift+Tab commits and moves left", () =>
    expect(k("Tab", { shift: true })).toEqual({ kind: "commit", r: 2, c: 0 }));

  it("Escape discards", () => expect(k("Escape")).toEqual({ kind: "discard" }));

  it("arrows belong to the input's caret while editing", () =>
    expect(k("ArrowLeft")).toEqual({ kind: "pass" }));
});

describe("reference labels", () => {
  it("names columns past Z", () => {
    expect(colLabel(0)).toBe("A");
    expect(colLabel(25)).toBe("Z");
    expect(colLabel(26)).toBe("AA");
  });

  it("labels a single cell and a range", () => {
    expect(refLabel(selAt(1, 1))).toBe("B2");
    expect(refLabel({ ar: 1, ac: 1, fr: 4, fc: 3 })).toBe("B2:D5");
    expect(refLabel({ ar: 4, ac: 3, fr: 1, fc: 1 })).toBe("B2:D5");
  });

  it("hands the engine an A1 range for the readout", () => {
    expect(rangeRef({ ar: 4, ac: 3, fr: 1, fc: 1 })).toBe("B2:D5");
  });
});
