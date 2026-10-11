import { describe, expect, it } from "vitest";
import { evaluatePropertyFormula, formulaLabels, formulaText } from "./property-formula";

const row: Record<string, number | string | boolean | null> = {
  Effort: 3,
  Rate: 150,
  Name: "Brief",
  Done: true,
  Notes: "=SUM(1,2)",
  Empty: null,
};
const read = (label: string) => (label in row ? row[label] : undefined);

describe("property formulas", () => {
  it("reads properties by name", () => {
    expect(formulaLabels('prop("Effort") * prop(\'Rate\') + prop("Effort")')).toEqual(["Effort", "Rate"]);
    expect(evaluatePropertyFormula('prop("Effort") * prop("Rate")', read)).toEqual({ value: 450, error: null });
    expect(evaluatePropertyFormula('=ROUND(prop("Rate") / 7, 2)', read).value).toBe(21.43);
  });
  it("handles text, conditions and empties", () => {
    expect(evaluatePropertyFormula('CONCAT(prop("Name"), " · ", prop("Effort"))', read).value).toBe("Brief · 3");
    expect(evaluatePropertyFormula('IF(prop("Done"), "Shipped", "Open")', read).value).toBe("Shipped");
    expect(evaluatePropertyFormula('prop("Effort") > 2', read).value).toBe(true);
    expect(evaluatePropertyFormula('prop("Empty") + 1', read).value).toBe(1);
    expect(evaluatePropertyFormula('prop("Notes")', read).value).toBe("=SUM(1,2)");
  });
  it("explains mistakes", () => {
    expect(evaluatePropertyFormula('prop("Nope") * 2', read).error).toBe('No property called "Nope".');
    expect(evaluatePropertyFormula('prop("Effort") / 0', read).error).toBe("Divides by zero.");
    expect(evaluatePropertyFormula("FOO(", read).error).toBe("The formula has a mistake.");
    expect(evaluatePropertyFormula("", read)).toEqual({ value: null, error: null });
  });
  it("writes results as words", () => {
    expect(formulaText(true)).toBe("Yes");
    expect(formulaText(1 / 3)).toBe("0.333333");
  });
});
