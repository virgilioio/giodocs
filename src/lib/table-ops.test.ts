import { describe, expect, it } from "vitest";
import {
  addColumn,
  addAlign,
  addRow,
  clearColumn,
  clearRow,
  deleteColumn,
  deleteAlign,
  deleteRow,
  duplicateColumn,
  duplicateAlign,
  duplicateRow,
  moveColumn,
  moveAlign,
  moveRow,
  normalizeAlign,
  normalizeTable,
  setAlign,
  type AlignList,
} from "./table-ops";
import { blockToMarkdown, toHtml } from "./export";
import { parseMarkdown } from "./markdown-import";

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
  const htmlOf = (rows: string[][]) =>
    toHtml({
      title: "T",
      area: null,
      status: null,
      ownerName: null,
      tags: [],
      verifiedAt: null,
      blocks: [{ id: "t", type: "table", rows } as never],
    });
  it("2-column table exports a valid pipe table (separator matches header width)", () => {
    const block = { type: "table", rows: [["a", "b"], ["1", "2"]] };
    const md = blockToMarkdown(block as never, 1);
    const lines = md.split("\n");
    expect(lines[0]).toBe("| a | b |");
    expect(lines[1]).toBe("| --- | --- |");
    expect(htmlOf(block.rows)).toContain("<table>");
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
    expect(htmlOf(rows1)).toContain("<table>");
  });
});

describe("duplicateColumn / duplicateRow", () => {
  it("duplicateColumn copies values and lands immediately after source", () => {
    const out = duplicateColumn(rect(), 1);
    expect(out).toEqual([
      ["h1", "h2", "h2", "h3"],
      ["a", "b", "b", "c"],
      ["d", "e", "e", "f"],
    ]);
  });
  it("duplicateColumn refuses on out-of-range index (returns clone)", () => {
    const src = rect();
    expect(duplicateColumn(src, 99)).toEqual(src);
  });
  it("duplicateRow copies values and lands immediately after source", () => {
    const out = duplicateRow(rect(), 1);
    expect(out).toEqual([
      ["h1", "h2", "h3"],
      ["a", "b", "c"],
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
  });
});

describe("moveColumn / moveRow", () => {
  it("moveColumn to first position", () => {
    expect(moveColumn(rect(), 2, 0)).toEqual([
      ["h3", "h1", "h2"],
      ["c", "a", "b"],
      ["f", "d", "e"],
    ]);
  });
  it("moveColumn to last position", () => {
    expect(moveColumn(rect(), 0, 2)).toEqual([
      ["h2", "h3", "h1"],
      ["b", "c", "a"],
      ["e", "f", "d"],
    ]);
  });
  it("moveColumn to own index is a no-op (but returns fresh matrix)", () => {
    const src = rect();
    const out = moveColumn(src, 1, 1);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
  });
  it("moveRow to first position promotes to header", () => {
    const out = moveRow(rect(), 2, 0);
    expect(out[0]).toEqual(["d", "e", "f"]);
  });
});

describe("delete refuses at minimums", () => {
  it("deleteRow refuses when only one row", () => {
    const src = [["a", "b"]];
    expect(deleteRow(src, 0)).toEqual(src);
  });
  it("deleteColumn refuses when only one column", () => {
    const src = [["a"], ["b"]];
    expect(deleteColumn(src, 0)).toEqual(src);
  });
});

describe("normalizeAlign", () => {
  it("pads with left up to width", () => {
    expect(normalizeAlign(["right"], 3)).toEqual(["right", "left", "left"]);
  });
  it("truncates to width", () => {
    expect(normalizeAlign(["right", "center", "left", "right"], 2)).toEqual([
      "right",
      "center",
    ]);
  });
  it("coerces invalid entries to left", () => {
    // deliberately loose input to prove the guard
    expect(
      normalizeAlign(["weird" as unknown as "left", "right"], 2),
    ).toEqual(["left", "right"]);
  });
});

describe("align tracks column ops", () => {
  it("addAlign inserts a default left in step with addColumn", () => {
    const rows = addColumn(rect(), 1);
    const align = addAlign(["right", "center", "left"], 1);
    expect(rows[0].length).toBe(4);
    expect(align).toEqual(["right", "left", "center", "left"]);
  });
  it("deleteAlign drops the right index in step with deleteColumn", () => {
    const rows = deleteColumn(rect(), 1);
    const align = deleteAlign(["right", "center", "left"], 1);
    expect(rows[0].length).toBe(2);
    expect(align).toEqual(["right", "left"]);
  });
  it("duplicateAlign duplicates in place", () => {
    expect(duplicateAlign(["left", "right", "center"], 1)).toEqual([
      "left",
      "right",
      "right",
      "center",
    ]);
  });
  it("moveAlign reorders in step with moveColumn", () => {
    expect(moveAlign(["left", "right", "center"], 2, 0)).toEqual([
      "center",
      "left",
      "right",
    ]);
  });
  it("setAlign changes exactly one entry", () => {
    expect(setAlign(["left", "left", "left"], 1, "center")).toEqual([
      "left",
      "center",
      "left",
    ]);
  });
  it("deleteAlign refuses at one entry (returns clone)", () => {
    const src: AlignList = ["right"];
    expect(deleteAlign(src, 0)).toEqual(src);
  });
});

describe("markdown alignment round-trip", () => {
  it("emits :---: / ---: / :--- separators per column", () => {
    const block = {
      type: "table",
      rows: [
        ["a", "b", "c"],
        ["1", "2", "3"],
      ],
      align: ["left", "center", "right"] as AlignList,
    };
    const md = blockToMarkdown(block as never, 1);
    const sep = md.split("\n")[1];
    expect(sep).toBe("| :--- | :---: | ---: |");
  });
  it("parseMarkdown reads separator alignment back into align", () => {
    const md = "| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |";
    const [b] = parseMarkdown(md);
    expect(b.type).toBe("table");
    expect((b as { align?: AlignList }).align).toEqual([
      "left",
      "center",
      "right",
    ]);
  });
  it("plain --- separator produces no align field (round-trips as default)", () => {
    const md = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    const [b] = parseMarkdown(md);
    expect((b as { align?: AlignList }).align).toBeUndefined();
  });
  it("HTML export writes text-align per th/td", () => {
    const html = toHtml({
      title: "T",
      area: null,
      status: null,
      ownerName: null,
      tags: [],
      verifiedAt: null,
      blocks: [
        {
          id: "t",
          type: "table",
          rows: [
            ["a", "b"],
            ["1", "2"],
          ],
          align: ["left", "right"],
        } as never,
      ],
    });
    expect(html).toContain('<th style="text-align:left">a</th>');
    expect(html).toContain('<th style="text-align:right">b</th>');
    expect(html).toContain('<td style="text-align:right">2</td>');
  });
});
