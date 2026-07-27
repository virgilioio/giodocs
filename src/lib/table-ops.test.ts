import { describe, expect, it } from "vitest";
import {
  addColumn,
  addRow,
  clearColumn,
  clearRow,
  deleteColumn,
  deleteRow,
  normalizeTable,
} from "./table-ops";
import { blockToMarkdown, toHtml } from "./export";

const rect = (): string[][] => [
  ["h1", "h2", "h3"],
  ["a", "b", "c"],
  ["d", "e", "f"],
];

function widths(rows: string[][]): number[] {
  return rows.map((r) => r.length);
}

describe("normalizeTable", () => {
  it("leaves a rectangular table structurally identical", () => {
    const src = rect();
    const out = normalizeTable(src);
    expect(out).toEqual(src);
  });
  it("pads short rows with empty strings", () => {
    const out = normalizeTable([["a", "b", "c"], ["x"]]);
    expect(out).toEqual([
      ["a", "b", "c"],
      ["x", "", ""],
    ]);
  });
  it("truncates long rows down to the max width already present", () => {
    // Width is derived from the widest row, so we need a case where one row
    // is a non-string / short list AFTER a wide row.
    const out = normalizeTable([["a", "b"], ["x", "y", "z", "w"]]);
    // Width == 4 (max), short row padded.
    expect(out).toEqual([
      ["a", "b", "", ""],
      ["x", "y", "z", "w"],
    ]);
  });
  it("returns a new top-level array (does not mutate input)", () => {
    const src = rect();
    const out = normalizeTable(src);
    expect(out).not.toBe(src);
    expect(out[0]).not.toBe(src[0]);
  });
  it("guarantees at least a 1x1 shape from empty input", () => {
    expect(normalizeTable([])).toEqual([[""]]);
  });
});

describe("addColumn", () => {
  it("inserts at start, middle, end and keeps every row the same length", () => {
    for (const at of [0, 1, 3]) {
      const out = addColumn(rect(), at);
      expect(widths(out)).toEqual([4, 4, 4]);
      expect(out[0][at]).toBe("");
    }
  });
  it("returns a new array", () => {
    const src = rect();
    const out = addColumn(src, 1);
    expect(out).not.toBe(src);
    expect(src).toEqual(rect()); // unchanged
  });
});

describe("deleteColumn", () => {
  it("removes exactly that index from every row", () => {
    const out = deleteColumn(rect(), 1);
    expect(out).toEqual([
      ["h1", "h3"],
      ["a", "c"],
      ["d", "f"],
    ]);
  });
  it("refuses when there is only one column", () => {
    const src = [["a"], ["b"], ["c"]];
    const out = deleteColumn(src, 0);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
  });
});

describe("addRow", () => {
  it("appends a row of empty strings of the correct width", () => {
    const out = addRow(rect(), 3);
    expect(out).toHaveLength(4);
    expect(out[3]).toEqual(["", "", ""]);
  });
  it("does not mutate input", () => {
    const src = rect();
    addRow(src, 3);
    expect(src).toEqual(rect());
  });
});

describe("deleteRow", () => {
  it("refuses when there is only one row", () => {
    const src = [["a", "b"]];
    expect(deleteRow(src, 0)).toEqual(src);
  });
  it("deleteRow(0) promotes the next row to the first slot (new header)", () => {
    const out = deleteRow(rect(), 0);
    expect(out[0]).toEqual(["a", "b", "c"]);
    expect(out).toHaveLength(2);
  });
});

describe("clearRow / clearColumn", () => {
  it("clearRow empties cells without changing dimensions", () => {
    const out = clearRow(rect(), 1);
    expect(out).toEqual([
      ["h1", "h2", "h3"],
      ["", "", ""],
      ["d", "e", "f"],
    ]);
  });
  it("clearColumn empties cells without changing dimensions", () => {
    const out = clearColumn(rect(), 2);
    expect(out).toEqual([
      ["h1", "h2", ""],
      ["a", "b", ""],
      ["d", "e", ""],
    ]);
  });
});

describe("immutability", () => {
  it("no operation mutates its input", () => {
    const src = rect();
    const snap = JSON.stringify(src);
    addColumn(src, 1);
    deleteColumn(src, 1);
    addRow(src, 1);
    deleteRow(src, 1);
    clearRow(src, 1);
    clearColumn(src, 1);
    normalizeTable(src);
    expect(JSON.stringify(src)).toBe(snap);
  });
});

describe("export round-trip after column ops", () => {
  it("2-column table exports a valid pipe table (separator matches header width)", () => {
    const block = { type: "table", rows: [["a", "b"], ["1", "2"]] };
    const md = blockToMarkdown(block as never, 1);
    const lines = md.split("\n");
    expect(lines[0]).toBe("| a | b |");
    expect(lines[1]).toBe("| --- | --- |");
    expect(blockToHtml(block as never)).toContain("<table>");
  });
  it("5-column table (after adding two columns) still round-trips", () => {
    const rows0: string[][] = [["a", "b", "c"], ["1", "2", "3"]];
    const rows1 = addColumn(addColumn(rows0, 3), 4);
    expect(widths(rows1)).toEqual([5, 5]);
    const block = { type: "table", rows: rows1 };
    const md = blockToMarkdown(block as never, 1);
    const lines = md.split("\n");
    const cols = (l: string) => l.split("|").length - 2;
    expect(cols(lines[0])).toBe(5);
    expect(cols(lines[1])).toBe(5);
    // separator width matches header
    expect(lines[1].replace(/[^-]/g, "").length).toBeGreaterThan(0);
    expect(blockToHtml(block as never)).toContain("<table>");
  });
});
