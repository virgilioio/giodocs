import { describe, expect, it } from "vitest";
import { dayKey, monthGrid, shiftMonth, todayKey } from "./calendar-grid";

describe("monthGrid", () => {
  it("is always six weeks, Monday first", () => {
    const g = monthGrid(2026, 9); // October 2026 starts on a Thursday
    expect(g).toHaveLength(42);
    expect(g[0]).toEqual({ key: "2026-09-28", day: 28, inMonth: false });
    expect(g[3]).toEqual({ key: "2026-10-01", day: 1, inMonth: true });
    expect(g.filter((d) => d.inMonth)).toHaveLength(31);
  });
  it("starts on the 1st when the month begins on a Monday", () => {
    expect(monthGrid(2026, 5)[0].key).toBe("2026-06-01");
  });
});

describe("helpers", () => {
  it("normalises overflowing dates and steps months across years", () => {
    expect(dayKey(2026, 11, 32)).toBe("2027-01-01");
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month0: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month0: 11 });
    expect(todayKey(new Date(2026, 9, 9, 23, 30))).toBe("2026-10-09");
  });
});
