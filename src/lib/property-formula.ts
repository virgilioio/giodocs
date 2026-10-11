/* A Formula property: an expression worked out for each row from its other
 * properties, never stored (validate_page_props refuses a value). It reads
 * properties as prop("Name") and uses the sheet block's calculator
 * (sheet-engine.ts): + − * /, comparisons, &-free text via CONCAT, and its
 * functions (IF, ROUND, SUM, MIN, MAX, ABS, TODAY…). Each referenced
 * property becomes one cell of a one-row sheet, so the two calculators can
 * never disagree on arithmetic. */

import { colName, evaluateFormula, isSheetError, type Grid } from "./sheet-engine";

export type FormulaValue = number | string | boolean | null;
export type FormulaResult = { value: FormulaValue; error: string | null };

const PROP_REF = /prop\(\s*(?:"([^"]*)"|'([^']*)')\s*\)/g;

/** The labels a formula reads, in order of first use. */
export function formulaLabels(expr: string): string[] {
  const out: string[] = [];
  for (const m of expr.matchAll(PROP_REF)) {
    const label = (m[1] ?? m[2] ?? "").trim();
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

const ERROR_WORDS: Record<string, string> = {
  "#CYCLE": "The formula refers to itself.",
  "#NAME": "The formula has a mistake.",
  "#DIV/0": "Divides by zero.",
  "#NUM": "Not a number where one is needed.",
};

/** A value as a sheet cell: text that starts with "=" stays text. */
function cellOf(v: FormulaValue): string | number {
  if (v === null) return "";
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return v.startsWith("=") ? `⁠${v}` : v;
}

/** Works a formula out. `read` gives a property's value by its label, or
 *  undefined when the database has no property of that name. */
export function evaluatePropertyFormula(
  expr: string,
  read: (label: string) => FormulaValue | undefined,
): FormulaResult {
  const text = expr.trim().replace(/^=/, "");
  if (!text) return { value: null, error: null };
  const labels = formulaLabels(text);
  const row: Grid = [[]];
  for (let i = 0; i < labels.length; i++) {
    const v = read(labels[i]);
    if (v === undefined) return { value: null, error: `No property called "${labels[i]}".` };
    row[0][i] = { v: cellOf(v) } as Grid[number][number];
  }
  const src = text.replace(
    PROP_REF,
    (_m, a?: string, b?: string) => `${colName(labels.indexOf((a ?? b ?? "").trim()))}1`,
  );
  // Worked out from a cell well away from the ones it reads.
  const out = evaluateFormula(`=${src}`, row, 9999, 9999);
  if (isSheetError(out)) return { value: null, error: ERROR_WORDS[out] ?? "The formula has a mistake." };
  if (typeof out === "string") {
    const clean = out.replace(/^⁠/, "");
    if (clean === "TRUE") return { value: true, error: null };
    if (clean === "FALSE") return { value: false, error: null };
    return { value: clean, error: null };
  }
  return { value: out, error: null };
}

/** A formula's result as words for a cell. */
export function formulaText(v: FormulaValue): string {
  if (v === null || v === "") return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  return v;
}
