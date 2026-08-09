import { describe, it, expect } from "vitest";
import { parseDateInput } from "./date-parse";

/* Sat 8 Aug 2026, late in the local day — the hour must never move a result. */
const TODAY = new Date(2026, 7, 8, 16, 30, 0);

describe("parseDateInput", () => {
  it("words for the near days, long and short", () => {
    expect(parseDateInput("today", TODAY)).toBe("2026-08-08");
    expect(parseDateInput("tod", TODAY)).toBe("2026-08-08");
    expect(parseDateInput("Tomorrow", TODAY)).toBe("2026-08-09");
    expect(parseDateInput("tom", TODAY)).toBe("2026-08-09");
    expect(parseDateInput("yesterday", TODAY)).toBe("2026-08-07");
  });

  it("signed day offsets", () => {
    expect(parseDateInput("+10", TODAY)).toBe("2026-08-18");
    expect(parseDateInput("-3", TODAY)).toBe("2026-08-05");
    expect(parseDateInput("+30", TODAY)).toBe("2026-09-07");
  });

  it("next / last weekday, strictly ahead or behind", () => {
    // 8 Aug 2026 is a Saturday.
    expect(parseDateInput("next fri", TODAY)).toBe("2026-08-14");
    expect(parseDateInput("next sat", TODAY)).toBe("2026-08-15");
    expect(parseDateInput("last mon", TODAY)).toBe("2026-08-03");
    expect(parseDateInput("last sat", TODAY)).toBe("2026-08-01");
  });

  it("month-day in either order, plus numeric and ISO", () => {
    expect(parseDateInput("Mar 14", TODAY)).toBe("2026-03-14");
    expect(parseDateInput("14 Mar", TODAY)).toBe("2026-03-14");
    expect(parseDateInput("March 14", TODAY)).toBe("2026-03-14");
    expect(parseDateInput("3/14", TODAY)).toBe("2026-03-14");
    expect(parseDateInput("2026-03-14", TODAY)).toBe("2026-03-14");
    expect(parseDateInput("2027-03-14", TODAY)).toBe("2027-03-14");
  });

  it("rejects impossible calendar dates", () => {
    expect(parseDateInput("Feb 30", TODAY)).toBeNull();
    expect(parseDateInput("2026-13-01", TODAY)).toBeNull();
    expect(parseDateInput("13/14", TODAY)).toBeNull();
  });

  it("returns null for junk rather than guessing", () => {
    expect(parseDateInput("", TODAY)).toBeNull();
    expect(parseDateInput("   ", TODAY)).toBeNull();
    expect(parseDateInput("soon", TODAY)).toBeNull();
    expect(parseDateInput("next quarter", TODAY)).toBeNull();
    expect(parseDateInput("14", TODAY)).toBeNull();
    expect(parseDateInput("Mar", TODAY)).toBeNull();
    expect(parseDateInput("figma.com", TODAY)).toBeNull();
  });
});
