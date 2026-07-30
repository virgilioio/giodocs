import { describe, expect, it } from "vitest";
import {
  COL_MIN_FR,
  columnsGridTemplate,
  columnsGridTemplatePlain,
  equalColumnWidths,
  normalizeColumnWidths,
  resetColumnPair,
  resizeColumnPair,
} from "./column-widths";

describe("resizeColumnPair", () => {
  it("preserves the pair's combined weight", () => {
    const out = resizeColumnPair([1, 1, 1], 0, 0.3);
    expect(out[0] + out[1]).toBeCloseTo(2, 5);
    expect(out[0]).toBeCloseTo(1.3, 5);
    expect(out[2]).toBe(1);
  });
  it("clamps at the 0.35 minimum on the left", () => {
    const out = resizeColumnPair([1, 1], 0, -5);
    expect(out[0]).toBe(COL_MIN_FR);
    expect(out[0] + out[1]).toBeCloseTo(2, 5);
  });
  it("clamps at the 0.35 minimum on the right", () => {
    const out = resizeColumnPair([1, 1], 0, 5);
    expect(out[1]).toBe(COL_MIN_FR);
    expect(out[0] + out[1]).toBeCloseTo(2, 5);
  });
  it("is a no-op on the last boundary or out of range", () => {
    expect(resizeColumnPair([1, 1], 1, 0.5)).toEqual([1, 1]);
    expect(resizeColumnPair([1, 1], -1, 0.5)).toEqual([1, 1]);
  });
});

describe("resetColumnPair", () => {
  it("gives the pair an equal share of their combined weight", () => {
    expect(resetColumnPair([1.6, 0.4, 2], 0)).toEqual([1, 1, 2]);
  });
});

describe("normalizeColumnWidths (lockstep with the column count)", () => {
  it("returns undefined when nothing is stored (absent === equal)", () => {
    expect(normalizeColumnWidths(undefined, 3)).toBeUndefined();
    expect(normalizeColumnWidths(null, 3)).toBeUndefined();
  });
  it("pads a short array when a column is added", () => {
    expect(normalizeColumnWidths([2, 1], 4)).toEqual([2, 1, 1, 1]);
  });
  it("trims a long array when a column is removed", () => {
    expect(normalizeColumnWidths([2, 1, 3], 2)).toEqual([2, 1]);
  });
  it("clamps junk and sub-minimum entries", () => {
    expect(normalizeColumnWidths([0, NaN, "x"], 3)).toEqual([
      COL_MIN_FR,
      1,
      1,
    ]);
  });
});

describe("columnsGridTemplatePlain", () => {
  it("falls back to equal tracks when widths are absent or out of step", () => {
    expect(columnsGridTemplatePlain(undefined, 3)).toBe(
      "repeat(3, minmax(0, 1fr))",
    );
    expect(columnsGridTemplatePlain([1, 1], 3)).toBe(
      "repeat(3, minmax(0, 1fr))",
    );
  });
  it("emits minmax(0, Nfr) per track", () => {
    expect(columnsGridTemplatePlain([1.4, 0.6], 2)).toBe(
      "minmax(0, 1.4fr) minmax(0, 0.6fr)",
    );
  });
});

describe("columnsGridTemplate — interleaved handle tracks", () => {
  it("2 columns: one 40px track between them", () => {
    expect(columnsGridTemplate(undefined, 2)).toBe(
      "minmax(0, 1fr) 40px minmax(0, 1fr)",
    );
    expect(columnsGridTemplate([1.4, 0.6], 2)).toBe(
      "minmax(0, 1.4fr) 40px minmax(0, 0.6fr)",
    );
  });
  it("3 columns: two 40px tracks", () => {
    expect(columnsGridTemplate(undefined, 3)).toBe(
      "minmax(0, 1fr) 40px minmax(0, 1fr) 40px minmax(0, 1fr)",
    );
  });
  it("child count matches track count for 2..6 columns", () => {
    for (let n = 2; n <= 6; n++) {
      const tracks = columnsGridTemplate(undefined, n).split(" 40px ");
      expect(tracks.length).toBe(n);
      // n column children + (n-1) handle children === 2n-1 tracks
      expect(columnsGridTemplate(undefined, n).split(" ").length / 2).toBeGreaterThan(0);
    }
  });
  it("widths out of step fall back to equal weights, tracks still interleaved", () => {
    expect(columnsGridTemplate([1, 1], 3)).toBe(
      "minmax(0, 1fr) 40px minmax(0, 1fr) 40px minmax(0, 1fr)",
    );
  });
});

describe("equalColumnWidths", () => {
  it("is all ones", () => {
    expect(equalColumnWidths(3)).toEqual([1, 1, 1]);
  });
});
