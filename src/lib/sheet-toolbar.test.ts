import { describe, expect, it } from "vitest";
import { format } from "./sheet-engine";
import type { Cell } from "./sheet-model";
import {
  ALIGNS,
  clearedCell,
  commonAlign,
  commonDecimals,
  commonFormat,
  commonKey,
  commonSize,
  defaultDecimals,
  FILL_SWATCHES,
  hasFormatting,
  INK_SWATCHES,
  markDecision,
  NUMBER_FORMATS,
  SIZES,
  sizeClass,
  stepDecimals,
  STYLE_KEYS,
} from "./sheet-toolbar";

describe("markDecision — the mixed-range rule", () => {
  it("sets on all when ANY cell lacks the mark", () => {
    const cells: (Cell | null)[] = [{ b: true }, { v: 1 }, { b: true }];
    expect(markDecision(cells, "b")).toEqual({ active: false, set: true });
  });

  it("clears on all only when EVERY cell has it", () => {
    const cells: (Cell | null)[] = [{ b: true }, { b: true }];
    expect(markDecision(cells, "b")).toEqual({ active: true, set: false });
  });

  it("treats a null cell as missing the mark", () => {
    expect(markDecision([{ i: true }, null], "i")).toEqual({ active: false, set: true });
  });

  it("reflected active state matches the action's inverse", () => {
    for (const cells of [
      [{ rt: true }],
      [{ rt: true }, {}],
      [null, null],
    ] as (Cell | null)[][]) {
      const d = markDecision(cells, "rt");
      expect(d.set).toBe(!d.active);
    }
  });

  it("an empty range is inert but not 'active'", () => {
    expect(markDecision([], "b").active).toBe(false);
  });
});

describe("clear formatting", () => {
  it("empties every style key and leaves v intact", () => {
    const cell: Cell = {
      v: 1234,
      f: "cur",
      d: 3,
      b: true,
      i: true,
      a: "center",
      bg: "blue",
      fg: "red",
      rt: true,
    };
    const out = clearedCell(cell);
    expect(out).toEqual({ v: 1234 });
    for (const k of STYLE_KEYS) expect(out?.[k]).toBeUndefined();
  });

  it("keeps a formula string as typed", () => {
    expect(clearedCell({ v: "=SUM(A1:A3)", b: true })).toEqual({ v: "=SUM(A1:A3)" });
  });

  it("drops a cell that was style-only", () => {
    expect(clearedCell({ b: true, bg: "green" })).toBeNull();
    expect(clearedCell(null)).toBeNull();
  });

  it("hasFormatting sees any style key across the range", () => {
    expect(hasFormatting([{ v: 1 }, null])).toBe(false);
    expect(hasFormatting([{ v: 1 }, { rt: true }])).toBe(true);
  });

  it("clears a size too, and counts a size-only cell as formatted", () => {
    expect(clearedCell({ v: "hi", fs: "l" })).toEqual({ v: "hi" });
    expect(hasFormatting([{ v: 1, fs: "s" }])).toBe(true);
  });
});

describe("decimal defaults, asserted through format()", () => {
  it("a sub-1% value switched to percent renders at 2 decimals", () => {
    expect(format(0.0004, "pct")).toBe("0.04%");
  });

  it("an ordinary percent renders at 1 decimal", () => {
    expect(format(0.125, "pct")).toBe("12.5%");
  });

  it("currency renders 2 decimals with no explicit d", () => {
    expect(format(1234.5, "cur")).toBe("$1,234.50");
  });

  it("the stepper starts from the format's default, not from zero", () => {
    expect(defaultDecimals("cur")).toBe(2);
    expect(defaultDecimals("pct")).toBe(1);
    expect(defaultDecimals("num")).toBe(0);
    expect(stepDecimals([{ f: "cur" }], 1)).toBe(3);
    expect(stepDecimals([{ f: "cur" }], -1)).toBe(1);
  });

  it("clamps to 0–4", () => {
    expect(stepDecimals([{ d: 4 }], 1)).toBe(4);
    expect(stepDecimals([{ d: 0 }], -1)).toBe(0);
  });
});

describe("range readbacks", () => {
  it("commonFormat treats absent f as text and reports mixed as undefined", () => {
    expect(commonFormat([{ v: 1 }, null])).toBe("text");
    expect(commonFormat([{ f: "cur" }, { f: "cur" }])).toBe("cur");
    expect(commonFormat([{ f: "cur" }, { f: "pct" }])).toBeUndefined();
  });

  it("commonAlign reports undefined for the default and for mixed", () => {
    expect(commonAlign([{ v: 1 }])).toBeUndefined();
    expect(commonAlign([{ a: "right" }, { a: "right" }])).toBe("right");
    expect(commonAlign([{ a: "right" }, { a: "left" }])).toBeUndefined();
  });

  it("commonDecimals and commonKey agree only on a uniform range", () => {
    expect(commonDecimals([{ d: 2 }, { d: 2 }])).toBe(2);
    expect(commonDecimals([{ d: 2 }, { d: 1 }])).toBeUndefined();
    expect(commonKey([{ bg: "green" }, { bg: "green" }], "bg")).toBe("green");
    expect(commonKey([{ fg: "red" }, {}], "fg")).toBeUndefined();
  });
});

describe("control tables", () => {
  it("offers exactly the five number formats in reading order", () => {
    expect(NUMBER_FORMATS.map((f) => f.id)).toEqual(["text", "num", "cur", "pct", "date"]);
  });

  it("offers three aligns", () => {
    expect(ALIGNS.map((a) => a.id)).toEqual(["left", "center", "right"]);
  });

  it("palette swatches carry KEYS and tokens, never hexes", () => {
    for (const s of [...FILL_SWATCHES, ...INK_SWATCHES]) {
      if (s.token) expect(s.token.startsWith("var(--color-")).toBe(true);
    }
  });

  it("both palettes include a None that clears the key", () => {
    expect(FILL_SWATCHES[0]).toEqual({ key: null, label: "None", token: undefined });
    expect(INK_SWATCHES[0]).toEqual({ key: null, label: "None", token: undefined });
  });
});


describe("commonSize — the shared font size across a range", () => {
  it("reports the shared step, treating an absent fs as m", () => {
    expect(commonSize([{ fs: "s" }, { v: 1, fs: "s" }])).toBe("s");
    expect(commonSize([{ v: 1 }, null])).toBe("m");
    expect(commonSize([{ fs: "l" }, { fs: "l" }])).toBe("l");
  });

  it("reports undefined for a mixed range and for an empty one", () => {
    expect(commonSize([{ fs: "s" }, { fs: "l" }])).toBeUndefined();
    expect(commonSize([{ fs: "l" }, null])).toBeUndefined();
    expect(commonSize([])).toBeUndefined();
  });

  it("SIZES is the three steps, and every class is a type token", () => {
    expect(SIZES.map((z) => z.id)).toEqual(["s", "m", "l"]);
    expect(sizeClass("s")).toBe("text-caption");
    expect(sizeClass(undefined)).toBe("text-meta");
    expect(sizeClass("l")).toBe("text-ui");
  });
});
