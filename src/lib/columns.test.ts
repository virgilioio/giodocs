import { describe, expect, it } from "vitest";
import {
  MAX_COLS,
  MIN_COLS,
  emptyColumns,
  isColumnsBlock,
  stripNestedColumns,
  validateColumnsCols,
} from "./columns";

const T = (text = ""): { id: string; type: string; text: string } => ({
  id: Math.random().toString(36).slice(2, 8),
  type: "text",
  text,
});

describe("validateColumnsCols", () => {
  it("accepts 2..6 columns of block arrays", () => {
    for (let n = MIN_COLS; n <= MAX_COLS; n++) {
      const cols = Array.from({ length: n }, () => [T("hi")]);
      expect(validateColumnsCols(cols)).toBe(true);
    }
  });
  it("rejects fewer than 2 columns", () => {
    expect(validateColumnsCols([[T()]])).toBe(false);
    expect(validateColumnsCols([])).toBe(false);
  });
  it("rejects more than 6 columns", () => {
    expect(validateColumnsCols(Array.from({ length: 7 }, () => [T()]))).toBe(false);
  });
  it("rejects a nested columns block inside a column", () => {
    const nested = { id: "n", type: "columns", cols: [[T()], [T()]] };
    expect(validateColumnsCols([[nested], [T()]])).toBe(false);
  });
  it("rejects non-array shapes", () => {
    expect(validateColumnsCols(null)).toBe(false);
    expect(validateColumnsCols("nope" as unknown)).toBe(false);
    expect(validateColumnsCols([T(), T()])).toBe(false); // cols must be Blk[][], not Blk[]
  });
});

describe("stripNestedColumns", () => {
  it("passes through valid input untouched (same content)", () => {
    const cols = [[T("a")], [T("b")]];
    const out = stripNestedColumns(cols);
    expect(out.length).toBe(2);
    expect((out[0][0] as { text?: string }).text).toBe("a");
  });
  it("flattens a nested columns block into its containing column", () => {
    const inner = [T("x"), T("y")];
    const nested = { id: "n", type: "columns", cols: [inner, [T("z")]] };
    const cols = [[T("before"), nested, T("after")], [T("q")]];
    const out = stripNestedColumns(cols);
    // Nested columns' inner blocks are pulled up into column 0.
    expect(out[0].map((b) => (b as { text?: string }).text)).toEqual([
      "before",
      "x",
      "y",
      "z",
      "after",
    ]);
    expect(out[1].map((b) => (b as { text?: string }).text)).toEqual(["q"]);
  });
});

describe("isColumnsBlock", () => {
  it("recognises a columns block by type + cols", () => {
    expect(isColumnsBlock({ type: "columns", cols: [[]] })).toBe(true);
    expect(isColumnsBlock({ type: "text", text: "" })).toBe(false);
    expect(isColumnsBlock(null)).toBe(false);
  });
});

describe("emptyColumns", () => {
  it("clamps count into [2,6]", () => {
    expect(emptyColumns(1, () => 0).length).toBe(MIN_COLS);
    expect(emptyColumns(9, () => 0).length).toBe(MAX_COLS);
    expect(emptyColumns(3, () => 0).length).toBe(3);
  });
});
