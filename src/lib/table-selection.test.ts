import { describe, expect, it } from "vitest";
import {
  cellHasMark,
  cellPlainText,
  cellSel,
  clearRect,
  colSel,
  extendSel,
  moveSel,
  parseTsv,
  pasteGrid,
  rangeSel,
  readCellsJson,
  rectSources,
  rowSel,
  selRect,
  toggleMarkInRect,
  toTsv,
} from "./table-selection";

const grid = () => [
  ["Name", "Role", "Team"],
  ["Ana", "PM", "Ops"],
  ["Ben", "", "Core"],
];

describe("selection rectangles", () => {
  it("a range is normalised whichever way it was dragged", () => {
    expect(selRect(rangeSel({ r: 2, c: 2 }, { r: 1, c: 0 }), 3, 3)).toEqual({ r0: 1, c0: 0, r1: 2, c1: 2 });
  });
  it("rows and columns span the whole table", () => {
    expect(selRect(rowSel(1, 3), 3, 3)).toEqual({ r0: 1, c0: 0, r1: 1, c1: 2 });
    expect(selRect(colSel(2, 3), 3, 3)).toEqual({ r0: 0, c0: 2, r1: 2, c1: 2 });
    // The table grew: still the whole row.
    expect(selRect(rowSel(1, 3), 3, 5).c1).toBe(4);
  });
  it("arrows move one cell and stop at the edges", () => {
    expect(moveSel(cellSel(0, 0), -1, 0, 3, 3)).toEqual(cellSel(0, 0));
    expect(moveSel(cellSel(1, 1), 0, 1, 3, 3)).toEqual(cellSel(1, 2));
  });
  it("Shift+arrows move the far corner; rows grow by rows only", () => {
    expect(extendSel(cellSel(1, 1), 1, 1, 3, 3)).toEqual(rangeSel({ r: 1, c: 1 }, { r: 2, c: 2 }));
    const row = rowSel(1, 3);
    expect(extendSel(row, 0, 1, 3, 3)).toBe(row);
    expect(selRect(extendSel(row, 1, 0, 3, 3), 3, 3)).toEqual({ r0: 1, c0: 0, r1: 2, c1: 2 });
  });
});

describe("actions on a selection", () => {
  it("clears the rectangle only", () => {
    expect(clearRect(grid(), { r0: 1, c0: 0, r1: 2, c1: 1 })).toEqual([
      ["Name", "Role", "Team"],
      ["", "", "Ops"],
      ["", "", "Core"],
    ]);
  });
  it("reads whole-cell marks with the renderer's tokenizer", () => {
    expect(cellHasMark("**x**", "bold")).toBe(true);
    expect(cellHasMark("**x**", "italic")).toBe(false);
    expect(cellHasMark("*x*", "italic")).toBe(true);
    expect(cellHasMark("**x** y", "bold")).toBe(false);
    expect(cellHasMark("<u>**x**</u>", "bold")).toBe(true);
  });
  it("bold goes on every filled cell, then comes off everywhere", () => {
    const q = { r0: 1, c0: 0, r1: 2, c1: 1 };
    const on = toggleMarkInRect(grid(), q, "bold");
    expect(on[1]).toEqual(["**Ana**", "**PM**", "Ops"]);
    expect(on[2]).toEqual(["**Ben**", "", "Core"]);
    const off = toggleMarkInRect(on, q, "bold");
    expect(off).toEqual(grid());
  });
  it("a mixed selection gets the mark everywhere first", () => {
    const g = grid();
    g[1][0] = "**Ana**";
    const on = toggleMarkInRect(g, { r0: 1, c0: 0, r1: 1, c1: 1 }, "bold");
    expect(on[1].slice(0, 2)).toEqual(["**Ana**", "**PM**"]);
  });
  it("italic on a bold cell nests and comes off cleanly", () => {
    const q = { r0: 0, c0: 0, r1: 0, c1: 0 };
    const on = toggleMarkInRect([["**x**"]], q, "italic");
    expect(cellHasMark(on[0][0], "italic")).toBe(true);
    expect(cellHasMark(on[0][0], "bold")).toBe(true);
    expect(toggleMarkInRect(on, q, "italic")).toEqual([["**x**"]]);
  });
  it("underline and strikethrough use their own delimiters", () => {
    const q = { r0: 0, c0: 0, r1: 0, c1: 0 };
    expect(toggleMarkInRect([["x"]], q, "underline")).toEqual([["<u>x</u>"]]);
    expect(toggleMarkInRect([["x"]], q, "strike")).toEqual([["~~x~~"]]);
  });
});

describe("copy and paste", () => {
  it("copies sources and tab-separated plain text", () => {
    const g = grid();
    g[1][0] = "**Ana**";
    const src = rectSources(g, { r0: 1, c0: 0, r1: 2, c1: 1 });
    expect(src).toEqual([["**Ana**", "PM"], ["Ben", ""]]);
    expect(toTsv(src)).toBe("Ana\tPM\nBen\t");
    expect(cellPlainText("a [link](https://x.y) and `code`")).toBe("a link and code");
  });
  it("parses spreadsheet text, ignoring the trailing newline", () => {
    expect(parseTsv("a\tb\r\nc\td\n")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseTsv("one")).toEqual([["one"]]);
  });
  it("reads only a well-formed cells payload", () => {
    expect(readCellsJson('[["a","b"]]')).toEqual([["a", "b"]]);
    expect(readCellsJson('[["a",1]]')).toBeNull();
    expect(readCellsJson("nope")).toBeNull();
  });
  it("pastes at the anchor and grows the table", () => {
    const { rows, rect } = pasteGrid(grid(), { r: 2, c: 2 }, [["x", "y"], ["z", "w"]]);
    expect(rows.length).toBe(4);
    expect(rows[0].length).toBe(4);
    expect(rows[2].slice(2)).toEqual(["x", "y"]);
    expect(rows[3]).toEqual(["", "", "z", "w"]);
    expect(rect).toEqual({ r0: 2, c0: 2, r1: 3, c1: 3 });
  });
  it("one value fills a larger selection", () => {
    const q = { r0: 1, c0: 1, r1: 2, c1: 2 };
    const { rows } = pasteGrid(grid(), { r: 1, c: 1 }, [["-"]], q);
    expect(rows[1]).toEqual(["Ana", "-", "-"]);
    expect(rows[2]).toEqual(["Ben", "-", "-"]);
  });
});
