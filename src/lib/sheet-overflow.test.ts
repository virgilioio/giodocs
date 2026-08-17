import { describe, expect, it } from "vitest";
import { overflowRun } from "./sheet-overflow";
import type { Cell } from "./sheet-model";

const v = (x: string | number): Cell => ({ v: x });

/** One row, widths deliberately DIFFERENT so a default width cannot pass. */
const cw = [100, 80, 60, 40, 120];

const row = (...cells: (Cell | null)[]): (Cell | null)[][] => [cells];

describe("overflowRun", () => {
  it("runs right over two empties and stops at an occupied cell", () => {
    const cells = row(v("a very long label"), null, null, v("x"), null);
    expect(overflowRun(cells, cw, 0, 0, "left")).toEqual({ left: 0, width: 100 + 80 + 60 });
  });

  it("runs left when right-aligned", () => {
    const cells = row(v("stop"), null, null, v("long right label"), null);
    expect(overflowRun(cells, cw, 0, 3, "right")).toEqual({ left: -(80 + 60), width: 80 + 60 + 40 });
  });

  it("clamps each side independently when centred", () => {
    // 80px free to the left (c0 blocks), 160px free to the right → the
    // run is symmetric in PIXELS, so each side gets 80.
    const cells = row(v("x"), null, v("centred"), null, null);
    expect(overflowRun(cells, cw, 0, 2, "center")).toEqual({ left: -80, width: 80 + 60 + 80 });
  });

  it("treats a formatting-only neighbour as empty", () => {
    const cells = row(v("long"), { bg: "amber", rt: true }, v("x"), null, null);
    expect(overflowRun(cells, cw, 0, 0, "left")).toEqual({ left: 0, width: 100 + 80 });
  });

  it("returns null at the last column for a left-aligned cell", () => {
    const cells = row(null, null, null, null, v("tail"));
    expect(overflowRun(cells, cw, 0, 4, "left")).toBeNull();
  });

  it("returns null when the single neighbour is occupied", () => {
    const cells = row(v("long"), v("blocker"), null, null, null);
    expect(overflowRun(cells, cw, 0, 0, "left")).toBeNull();
  });

  it("returns null for a single-column sheet", () => {
    expect(overflowRun([[v("long")]], [100], 0, 0, "left")).toBeNull();
    expect(overflowRun([[v("long")]], [100], 0, 0, "center")).toBeNull();
  });

  it("sums the actual cw values, not a default", () => {
    const cells = row(v("long"), null, null, null, null);
    expect(overflowRun(cells, cw, 0, 0, "left")).toEqual({
      left: 0,
      width: 100 + 80 + 60 + 40 + 120,
    });
  });

  it("is null out of range or on a missing row", () => {
    expect(overflowRun(row(v("a")), cw, 5, 0, "left")).toBeNull();
    expect(overflowRun(row(v("a")), cw, 0, 9, "left")).toBeNull();
  });
});
