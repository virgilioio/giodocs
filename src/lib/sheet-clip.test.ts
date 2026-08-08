import { describe, it, expect } from "vitest";
import {
  applyFill,
  clipFrom,
  coercePasted,
  fillTarget,
  hasUnknownFunction,
  parseTSV,
  pasteInto,
  pasteValues,
  toTSV,
  tsvEscape,
} from "./sheet-clip";
import { newSheet, setCell, type SheetBlock } from "./sheet-model";

const emptySheet = () => newSheet(6, 4);
import { evaluateCell, shiftFormula } from "./sheet-engine";
import { keyWhenEditing, keyWhenSelected, selAt, rect } from "./sheet-select";

function sheetWith(cells: Array<[number, number, string | number]>): SheetBlock {
  let s = emptySheet();
  for (const [r, c, v] of cells) s = setCell(s, r, c, { v });
  return s;
}

/* ─────────── The keyboard decision in BOTH states ─────────── */

describe("clipboard keys: claimed when selected, native when editing", () => {
  const sel = selAt(1, 1);

  it("⌘C / ⌘X / ⌘V are the SHEET's while a cell range is selected", () => {
    expect(keyWhenSelected({ key: "c", meta: true }, sel, 6, 4)).toEqual({ kind: "copy" });
    expect(keyWhenSelected({ key: "x", meta: true }, sel, 6, 4)).toEqual({ kind: "cut" });
    expect(keyWhenSelected({ key: "v", meta: true }, sel, 6, 4)).toEqual({ kind: "paste" });
    // Ctrl on Windows/Linux behaves identically.
    expect(keyWhenSelected({ key: "C", ctrl: true }, sel, 6, 4)).toEqual({ kind: "copy" });
  });

  it("⌘Z still passes through to the page's undo when selected", () => {
    expect(keyWhenSelected({ key: "z", meta: true }, sel, 6, 4)).toEqual({ kind: "pass" });
  });

  it("while EDITING, the trio stays native so input copy/paste works", () => {
    expect(keyWhenEditing({ key: "c", meta: true }, 1, 1, 6, 4)).toEqual({ kind: "pass" });
    expect(keyWhenEditing({ key: "x", meta: true }, 1, 1, 6, 4)).toEqual({ kind: "pass" });
    expect(keyWhenEditing({ key: "v", meta: true }, 1, 1, 6, 4)).toEqual({ kind: "pass" });
    expect(keyWhenEditing({ key: "z", meta: true }, 1, 1, 6, 4)).toEqual({ kind: "pass" });
  });
});

/* ─────────── TSV ─────────── */

describe("TSV serialisation", () => {
  it("emits COMPUTED values, tab-separated and newline-delimited", () => {
    let s = sheetWith([
      [0, 0, 2],
      [0, 1, 3],
    ]);
    s = setCell(s, 1, 0, { v: "=A1+B1" });
    const tsv = toTSV(s, { r0: 0, c0: 0, r1: 1, c1: 1 });
    expect(tsv).toBe("2\t3\n5\t");
  });

  it("quotes a value containing a tab, newline or quote", () => {
    expect(tsvEscape("plain")).toBe("plain");
    expect(tsvEscape("a\tb")).toBe('"a\tb"');
    expect(tsvEscape("a\nb")).toBe('"a\nb"');
    expect(tsvEscape('say "hi"')).toBe('"say ""hi"""');
  });
});

describe("TSV parsing", () => {
  it("produces the right rectangle", () => {
    expect(parseTSV("1\t2\n3\t4")).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("pads short rows so the block is rectangular", () => {
    expect(parseTSV("1\t2\t3\n4")).toEqual([
      ["1", "2", "3"],
      ["4", "", ""],
    ]);
  });

  it("round-trips a quoted cell holding a tab and a newline", () => {
    const parsed = parseTSV(`${tsvEscape("a\tb")}\tx\ny\t${tsvEscape("c\nd")}`);
    expect(parsed).toEqual([
      ["a\tb", "x"],
      ["y", "c\nd"],
    ]);
  });
});

/* ─────────── Paste ─────────── */

describe("paste", () => {
  it("shifts relative references and leaves $-pinned parts alone", () => {
    let s = sheetWith([]);
    s = setCell(s, 0, 0, { v: "=B1+$C$1", b: true });
    const clip = clipFrom(s, { r0: 0, c0: 0, r1: 0, c1: 0 }, false, "blk");
    const out = pasteInto(s, clip, 2, 1, "blk");
    // Asserted THROUGH shiftFormula — never a reimplementation.
    expect(out.sheet.cells[2][1]?.v).toBe(shiftFormula("=B1+$C$1", 2, 1));
    expect(out.sheet.cells[2][1]?.v).toBe("=C3+$C$1");
    // Formatting travels with the cell.
    expect(out.sheet.cells[2][1]?.b).toBe(true);
  });

  it("keeps a pasted =NOPE(1) as literal text with a leading apostrophe", () => {
    expect(hasUnknownFunction("=NOPE(1)")).toBe(true);
    expect(hasUnknownFunction("=SUM(A1:A2)")).toBe(false);
    expect(coercePasted("=NOPE(1)")).toBe("'=NOPE(1)");
    const s = pasteValues(emptySheet(), [["=NOPE(1)"]], 0, 0).sheet;
    expect(s.cells[0][0]?.v).toBe("'=NOPE(1)");
    // Renders as text, not #NAME.
    expect(evaluateCell(s.cells, 0, 0)).toBe("=NOPE(1)");
  });

  it("cut then escape leaves the source intact; cut then paste clears it", () => {
    const s = sheetWith([[0, 0, 7]]);
    const clip = clipFrom(s, { r0: 0, c0: 0, r1: 0, c1: 0 }, true, "blk");
    // Escaping means the paste never happens — the sheet is simply unchanged.
    expect(s.cells[0][0]?.v).toBe(7);
    const out = pasteInto(s, clip, 3, 0, "blk");
    expect(out.sheet.cells[3][0]?.v).toBe(7);
    expect(out.sheet.cells[0][0]).toBeUndefined();
  });

  it("a COPY (not cut) leaves the source in place", () => {
    const s = sheetWith([[0, 0, 7]]);
    const clip = clipFrom(s, { r0: 0, c0: 0, r1: 0, c1: 0 }, false, "blk");
    const out = pasteInto(s, clip, 3, 0, "blk");
    expect(out.sheet.cells[0][0]?.v).toBe(7);
    expect(out.sheet.cells[3][0]?.v).toBe(7);
  });

  it("grows the sheet for a block that does not fit, and truncates at the bounds", () => {
    const base = emptySheet();
    const tall = Array.from({ length: 12 }, (_, i) => [String(i)]);
    const out = pasteValues(base, tall, 0, 0);
    expect(out.sheet.cells.length).toBeGreaterThanOrEqual(12);
    expect(out.truncated).toBeNull();

    const wide = [Array.from({ length: 30 }, (_, i) => String(i))];
    const clipped = pasteValues(base, wide, 0, 0);
    expect(clipped.sheet.cw.length).toBe(26);
    expect(clipped.truncated).toEqual({ rows: 0, cols: 4 });
  });
});

/* ─────────── Fill ─────────── */

describe("fill handle", () => {
  it("extends along the DOMINANT axis only", () => {
    const src = { r0: 0, c0: 0, r1: 0, c1: 0 };
    expect(fillTarget(src, 4, 1)?.axis).toBe("down");
    expect(fillTarget(src, 1, 4)?.axis).toBe("right");
    expect(fillTarget(src, 0, 0)).toBeNull();
    expect(fillTarget(src, 3, 0)?.rect).toEqual({ r0: 1, c0: 0, r1: 3, c1: 0 });
  });

  it("fill down from =B2*C2 yields =B3*C3 and =B4*C4", () => {
    let s = emptySheet();
    s = setCell(s, 0, 0, { v: "=B2*C2" });
    const src = { r0: 0, c0: 0, r1: 0, c1: 0 };
    const out = applyFill(s, src, { r0: 1, c0: 0, r1: 2, c1: 0 }, "down");
    expect(out.cells[1][0]?.v).toBe("=B3*C3");
    expect(out.cells[2][0]?.v).toBe("=B4*C4");
  });

  it("repeats a two-cell pattern cyclically", () => {
    let s = emptySheet();
    s = setCell(s, 0, 0, { v: 1 });
    s = setCell(s, 1, 0, { v: 2 });
    const out = applyFill(s, { r0: 0, c0: 0, r1: 1, c1: 0 }, { r0: 2, c0: 0, r1: 5, c1: 0 }, "down");
    expect([2, 3, 4, 5].map((r) => out.cells[r][0]?.v)).toEqual([1, 2, 1, 2]);
  });

  it("formatting travels with a fill", () => {
    let s = emptySheet();
    s = setCell(s, 0, 0, { v: 5, b: true, f: "cur" });
    const out = applyFill(s, { r0: 0, c0: 0, r1: 0, c1: 0 }, { r0: 1, c0: 0, r1: 1, c1: 0 }, "down");
    expect(out.cells[1][0]?.b).toBe(true);
    expect(out.cells[1][0]?.f).toBe("cur");
  });

  it("the source rectangle comes from the same selection model", () => {
    expect(rect({ ar: 2, ac: 3, fr: 0, fc: 1 })).toEqual({ r0: 0, c0: 1, r1: 2, c1: 3 });
  });
});
