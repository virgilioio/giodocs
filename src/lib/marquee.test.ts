import { describe, it, expect } from "vitest";
import { rowsInBand, type MarqueeRow } from "./marquee";

// Ten stacked rows of height 24 with no gaps: row N at top=N*24.
const ROWS: MarqueeRow[] = Array.from({ length: 10 }, (_, i) => ({
  id: `r${i}`,
  top: i * 24,
  height: 24,
}));

describe("rowsInBand", () => {
  it("a band covering rows 2–5 selects exactly those", () => {
    // Rows 2..5 occupy y ∈ [48, 144). Pick a band strictly inside those.
    const sel = rowsInBand(ROWS, 50, 140);
    expect(sel).toEqual(["r2", "r3", "r4", "r5"]);
  });

  it("a band drawn upward (y2 < y1) selects the same set", () => {
    const sel = rowsInBand(ROWS, 140, 50);
    expect(sel).toEqual(["r2", "r3", "r4", "r5"]);
  });

  it("a band larger than the content selects everything", () => {
    const sel = rowsInBand(ROWS, -1000, 10_000);
    expect(sel).toEqual(ROWS.map((r) => r.id));
  });

  it("a zero-height band selects the row it sits inside", () => {
    // Row 3 occupies [72, 96). A point at 80 sits inside it.
    const sel = rowsInBand(ROWS, 80, 80);
    expect(sel).toEqual(["r3"]);
  });

  it("rows are returned in document order", () => {
    // Feed the function rows out of order; result must still be doc order
    // as fed in — this function preserves input order and does not resort.
    const shuffled = [ROWS[5], ROWS[0], ROWS[9], ROWS[3]];
    const sel = rowsInBand(shuffled, -1000, 10_000);
    expect(sel).toEqual(["r5", "r0", "r9", "r3"]);
  });

  it("a band beyond the last row selects nothing extra", () => {
    // Last row bottom = 240. A band strictly below selects nothing.
    const sel = rowsInBand(ROWS, 500, 800);
    expect(sel).toEqual([]);
  });

  it("scroll-invariance: shifting rows and band by the same constant is a no-op", () => {
    const K = 1337;
    const shifted = ROWS.map((r) => ({ ...r, top: r.top + K }));
    const before = rowsInBand(ROWS, 50, 140);
    const after = rowsInBand(shifted, 50 + K, 140 + K);
    expect(after).toEqual(before);
    // And extreme shift — the bug reproduced in production only because
    // the two spaces got out of sync during auto-scroll. Prove they stay
    // in sync regardless of magnitude.
    const K2 = 9_999_999;
    const shifted2 = ROWS.map((r) => ({ ...r, top: r.top + K2 }));
    const after2 = rowsInBand(shifted2, 50 + K2, 140 + K2);
    expect(after2).toEqual(before);
  });
});
