import { describe, expect, it } from "vitest";
import {
  colIndex,
  colName,
  evaluateCell,
  evaluateFormula,
  format,
  isSheetError,
  parseRef,
  shiftFormula,
  todayISO,
  type Grid,
} from "./sheet-engine";

/** Fixture grid — a small revenue projection.
 *      A            B      C       D
 *  1   Deal         Value  Growth
 *  2   Alpha        100    0.1     =B2*(1+C2)
 *  3   Beta         200    0.2
 *  4   Gamma        300    0.05
 *  5   Total        =SUM(B2:B4)
 */
function fixture(): Grid {
  return [
    [{ v: "Deal" }, { v: "Value" }, { v: "Growth" }, null, null],
    [{ v: "Alpha" }, { v: 100 }, { v: 0.1 }, { v: "=B2*(1+C2)" }, null],
    [{ v: "Beta" }, { v: 200 }, { v: 0.2 }, null, null],
    [{ v: "Gamma" }, { v: 300 }, { v: 0.05 }, null, null],
    [{ v: "Total" }, { v: "=SUM(B2:B4)" }, null, null, null],
  ];
}

function evalIn(grid: Grid, src: string) {
  return evaluateFormula(src, grid, 9, 9);
}

describe("A1 references", () => {
  it("maps column names to indexes and back", () => {
    expect(colName(0)).toBe("A");
    expect(colName(25)).toBe("Z");
    expect(colIndex("A")).toBe(0);
    expect(colIndex("z")).toBe(25);
  });

  it("parses every pinning combination", () => {
    expect(parseRef("B2")).toEqual({ r: 1, c: 1, pinR: false, pinC: false });
    expect(parseRef("$B$2")).toEqual({ r: 1, c: 1, pinR: true, pinC: true });
    expect(parseRef("B$2")).toEqual({ r: 1, c: 1, pinR: true, pinC: false });
    expect(parseRef("$B2")).toEqual({ r: 1, c: 1, pinR: false, pinC: true });
    expect(parseRef("hello")).toBeNull();
  });
});

describe("evaluation against the fixture grid", () => {
  const g = fixture();

  it("=SUM(B2:B4) sums the range", () => {
    expect(evalIn(g, "=SUM(B2:B4)")).toBe(600);
    expect(evaluateCell(g, 4, 1)).toBe(600);
  });

  it("=B2*(1+C2) applies growth", () => {
    expect(evaluateCell(g, 1, 3)).toBeCloseTo(110, 10);
  });

  it("=AVG(B2:B5) ignores blanks and non-numbers", () => {
    // B5 holds a formula returning 600, so the average covers four numbers.
    expect(evalIn(g, "=AVG(B2:B5)")).toBe(300);
  });

  it("=AVG ignores blank cells rather than counting them as zero", () => {
    const grid: Grid = [[{ v: 10 }], [null], [{ v: 20 }]];
    expect(evaluateFormula("=AVG(A1:A3)", grid, 5, 5)).toBe(15);
  });

  it("=E5/E2-1 computes a growth ratio", () => {
    const grid: Grid = [
      [null, null, null, null, { v: 50 }],
      [null, null, null, null, { v: 200 }],
      [null, null, null, null, null],
      [null, null, null, null, null],
      [null, null, null, null, { v: 250 }],
    ];
    expect(evaluateFormula("=E5/E2-1", grid, 8, 8)).toBeCloseTo(0.25, 10);
  });

  it("literal (non-formula) entries evaluate to themselves", () => {
    expect(evaluateCell(g, 0, 0)).toBe("Deal");
    expect(evaluateCell(g, 1, 1)).toBe(100);
    expect(evaluateCell(g, 0, 3)).toBe("");
  });
});

describe("cycle detection", () => {
  it("returns #CYCLE for a self-reference", () => {
    const g: Grid = [[{ v: "=A1+1" }]];
    expect(evaluateCell(g, 0, 0)).toBe("#CYCLE");
  });

  it("returns #CYCLE for a 2-step cycle", () => {
    const g: Grid = [[{ v: "=B1" }, { v: "=A1" }]];
    expect(evaluateCell(g, 0, 0)).toBe("#CYCLE");
  });

  it("returns #CYCLE for a 3-step cycle", () => {
    const g: Grid = [[{ v: "=B1" }, { v: "=C1" }, { v: "=A1" }]];
    expect(evaluateCell(g, 0, 0)).toBe("#CYCLE");
  });

  it("does NOT false-positive on a legitimate 30-deep dependency chain", () => {
    const g: Grid = [];
    g.push([{ v: 1 }]);
    for (let r = 1; r < 30; r++) g.push([{ v: `=A${r}+1` }]);
    expect(evaluateCell(g, 29, 0)).toBe(30);
    expect(isSheetError(evaluateCell(g, 29, 0))).toBe(false);
  });
});

describe("errors are values that name themselves", () => {
  const g: Grid = [[null]];
  it("=DIVIDE(1,0) → #DIV/0", () => {
    expect(evaluateFormula("=DIVIDE(1,0)", g)).toBe("#DIV/0");
  });
  it("bare division by zero raises rather than returning Infinity", () => {
    expect(evaluateFormula("=1/0", g)).toBe("#DIV/0");
  });
  it("=SQRT(-4) → #NUM", () => {
    expect(evaluateFormula("=SQRT(-4)", g)).toBe("#NUM");
  });
  it("=NOPE(1) → #NAME", () => {
    expect(evaluateFormula("=NOPE(1)", g)).toBe("#NAME");
  });
  it("an error propagates through a dependent cell", () => {
    const grid: Grid = [[{ v: "=SQRT(-1)" }, { v: "=A1+1" }]];
    expect(evaluateCell(grid, 0, 1)).toBe("#NUM");
  });
});

describe("shiftFormula", () => {
  it("shifts an unpinned range down one row", () => {
    expect(shiftFormula("=SUM(B2:B4)", 1, 0)).toBe("=SUM(B3:B5)");
  });

  it("leaves a fully pinned reference alone and shifts the rest", () => {
    expect(shiftFormula("=$B$2*C2", 1, 1)).toBe("=$B$2*D3");
  });

  it("B$2 shifts only its column half", () => {
    expect(shiftFormula("=B$2", 3, 1)).toBe("=C$2");
  });

  it("$B2 shifts only its row half", () => {
    expect(shiftFormula("=$B2", 3, 1)).toBe("=$B5");
  });

  it("does not rewrite references inside string literals", () => {
    expect(shiftFormula('=CONCAT("B2",B2)', 1, 0)).toBe('=CONCAT("B2",B3)');
  });

  it("leaves non-formula entries untouched", () => {
    expect(shiftFormula("B2", 1, 1)).toBe("B2");
  });
});

describe("the twenty functions", () => {
  const g: Grid = [[{ v: 4 }], [{ v: 8 }], [{ v: 100 }], [null], [{ v: "x" }]];
  const ev = (s: string) => evaluateFormula(s, g, 9, 9);

  it("SUM", () => expect(ev("=SUM(A1:A5)")).toBe(112));
  it("AVG", () => expect(ev("=AVG(A1:A3)")).toBeCloseTo(37.3333333, 5));
  it("MIN", () => expect(ev("=MIN(A1:A3)")).toBe(4));
  it("MAX", () => expect(ev("=MAX(A1:A3)")).toBe(100));
  it("COUNT counts only cells holding a number", () =>
    expect(ev("=COUNT(A1:A5)")).toBe(3));
  it("MEDIAN", () => expect(ev("=MEDIAN(A1:A3)")).toBe(8));
  it("MEDIAN averages the middle pair on an even count", () =>
    expect(evaluateFormula("=MEDIAN(A1:A2)", g, 9, 9)).toBe(6));
  it("PRODUCT", () => expect(ev("=PRODUCT(A1:A2)")).toBe(32));
  it("ADD", () => expect(ev("=ADD(2,3)")).toBe(5));
  it("MINUS", () => expect(ev("=MINUS(9,4)")).toBe(5));
  it("MULTIPLY", () => expect(ev("=MULTIPLY(6,7)")).toBe(42));
  it("DIVIDE", () => expect(ev("=DIVIDE(9,3)")).toBe(3));
  it("POWER", () => expect(ev("=POWER(2,10)")).toBe(1024));
  it("SQRT", () => expect(ev("=SQRT(9)")).toBe(3));
  it("ROUND", () => expect(ev("=ROUND(1.2345,2)")).toBe(1.23));
  it("ROUNDUP", () => expect(ev("=ROUNDUP(1.2341,2)")).toBe(1.24));
  it("ROUNDDOWN", () => expect(ev("=ROUNDDOWN(1.2399,2)")).toBe(1.23));
  it("ABS", () => expect(ev("=ABS(0-7)")).toBe(7));
  it("IF picks the then branch", () => expect(ev("=IF(1,10,20)")).toBe(10));
  it("IF picks the else branch on a false test", () =>
    expect(ev("=IF(A1>50,10,20)")).toBe(20));
  it("CONCAT joins", () => expect(ev('=CONCAT("Q",1,"-",A1)')).toBe("Q1-4"));
  it("TODAY returns a date", () => {
    expect(ev("=TODAY()")).toBe(todayISO());
    expect(String(ev("=TODAY()"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("operator precedence and parentheses", () => {
  const g: Grid = [[null]];
  it("=1+2*3 → 7", () => expect(evaluateFormula("=1+2*3", g)).toBe(7));
  it("=(1+2)*3 → 9", () => expect(evaluateFormula("=(1+2)*3", g)).toBe(9));
  it("unary minus binds to the primary", () =>
    expect(evaluateFormula("=-3+10", g)).toBe(7));
  it("=10-2-3 is left associative", () =>
    expect(evaluateFormula("=10-2-3", g)).toBe(5));
  it("=8/4/2 is left associative", () => expect(evaluateFormula("=8/4/2", g)).toBe(1));
});

describe("format", () => {
  it("renders a sub-1% percent at two decimals, not 0.0%", () => {
    expect(format(0.0004, "pct")).toBe("0.04%");
  });

  it("renders an ordinary percent at one decimal", () => {
    expect(format(0.125, "pct")).toBe("12.5%");
  });

  it("renders currency at two decimals with thousands separators", () => {
    expect(format(1234567.5, "cur")).toBe("$1,234,567.50");
  });

  it("renders numbers with thousands separators", () => {
    expect(format(1234567, "num")).toBe("1,234,567");
    expect(format(1234.5678, "num", 2)).toBe("1,234.57");
  });

  it("d=0 rounds for display without touching the stored raw value", () => {
    const cell = { v: 12.7 };
    expect(format(cell.v, "num", 0)).toBe("13");
    expect(cell.v).toBe(12.7);
  });

  it("renders a date as a readable absolute", () => {
    expect(format("2026-08-15", "date")).toBe("15 Aug 2026");
  });

  it("passes error values through unchanged", () => {
    expect(format("#DIV/0", "num")).toBe("#DIV/0");
  });

  it("renders empty for a blank value", () => {
    expect(format("", "num")).toBe("");
    expect(format(undefined, "cur")).toBe("");
  });

  it("negative numbers keep their sign and separators", () => {
    expect(format(-9876.5, "cur")).toBe("-$9,876.50");
  });
});
