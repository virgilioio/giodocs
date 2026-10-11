import { describe, expect, it } from "vitest";
import { formatNumber, readNumberFormat } from "./number-format";

describe("formatNumber", () => {
  it("shows each format", () => {
    expect(formatNumber(1234.5)).toBe("1234.5");
    expect(formatNumber(1234.5, { decimals: 2 })).toBe("1234.50");
    expect(formatNumber(1234567.891, { format: "comma" })).toBe("1,234,567.891");
    expect(formatNumber(12.5, { format: "percent" })).toBe("12.5%");
    expect(formatNumber(1500, { format: "currency" })).toBe("$1,500.00");
    expect(formatNumber(1500, { format: "currency", currency: "MXN", decimals: 0 })).toMatch(/^MXN\s?1,500$/);
  });
  it("reads config defensively", () => {
    expect(readNumberFormat({ format: "roman", decimals: 9, currency: "XXX" })).toEqual({});
    expect(readNumberFormat({ format: "currency", decimals: 2, currency: "EUR" })).toEqual({
      format: "currency",
      decimals: 2,
      currency: "EUR",
    });
  });
});
