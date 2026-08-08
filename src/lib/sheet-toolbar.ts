/**
 * The sheet FORMATTING TOOLBAR's decisions — pure. No React, no DOM.
 *
 * ⚠ Why this file exists at all: every toolbar control acts on a RANGE, and
 * a range is usually mixed. A button that flips each cell independently
 * leaves the range MORE mixed than it started, so the rule is decided here
 * once and consumed by both the indicator and the action — the indicator
 * can therefore never disagree with what the click will do.
 *
 * The other rule this file protects: it does NOT re-derive the decimal
 * DISPLAY defaults. Chunk 1's format() owns them (currency 2, percent 1,
 * sub-1% percent 2) and a second copy here would drift. `defaultDecimals`
 * is only the STARTING POINT for the [.0]/[.00] stepper, never a value
 * written on the way to rendering.
 */

import type { Cell, CellAlign, CellFormat } from "./sheet-model";
import { SHEET_FILLS, SHEET_INKS, fillToken, inkToken } from "./sheet-palette";

/* ───────────────────── Toggleable marks ───────────────────── */

/** The three boolean-ish cell attributes the toolbar toggles. */
export type MarkKey = "b" | "i" | "rt";

/**
 * THE MIXED-RANGE TOGGLE DECISION.
 *
 * If ANY cell in the range lacks the attribute the action SETS it on all;
 * only when EVERY cell has it does the action clear it. `active` is the
 * button's indicator and is the same predicate, so indicator and action
 * always agree. An empty range is inert.
 */
export function markDecision(
  cells: readonly (Cell | null)[],
  key: MarkKey,
): { active: boolean; set: boolean } {
  const active = cells.length > 0 && cells.every((c) => c?.[key] === true);
  return { active, set: !active };
}

/* ───────────────────── Clear formatting ───────────────────── */

/** Every key CLEAR FORMATTING removes. `v` is deliberately absent. */
export const STYLE_KEYS = ["f", "d", "b", "i", "a", "bg", "fg", "rt"] as const;

/** A cell stripped of every style key, keeping its raw value untouched. */
export function clearedCell(cell: Cell | null): Cell | null {
  if (!cell || cell.v === undefined) return null;
  return { v: cell.v };
}

/** True when nothing in the range carries any style key — the button is
 *  then a no-op and can say so. */
export function hasFormatting(cells: readonly (Cell | null)[]): boolean {
  return cells.some((c) => !!c && STYLE_KEYS.some((k) => c[k] !== undefined));
}

/* ───────────────────── Number format ───────────────────── */

export const NUMBER_FORMATS: { id: CellFormat; label: string; title: string }[] = [
  { id: "text", label: "Plain", title: "Plain — show the value as typed" },
  { id: "num", label: "1.0", title: "Number — thousands separators" },
  { id: "cur", label: "$", title: "Currency" },
  { id: "pct", label: "%", title: "Percent" },
  { id: "date", label: "Date", title: "Date" },
];

/** The format shared by every cell in the range, or undefined when mixed.
 *  An absent `f` counts as "text" — that is what renders. */
export function commonFormat(cells: readonly (Cell | null)[]): CellFormat | undefined {
  if (!cells.length) return undefined;
  const first = cells[0]?.f ?? "text";
  return cells.every((c) => (c?.f ?? "text") === first) ? first : undefined;
}

/* ───────────────────── Decimals ───────────────────── */

export const DEC_MIN = 0;
export const DEC_MAX = 4;

/** Where the STEPPER starts when a cell has no explicit `d`. This is not
 *  the display rule — format() owns that. */
export function defaultDecimals(f: CellFormat | undefined): number {
  if (f === "cur") return 2;
  if (f === "pct") return 1;
  return 0;
}

/** Step `d` for the whole range by one, clamped to 0–4. */
export function stepDecimals(cells: readonly (Cell | null)[], dir: 1 | -1): number {
  const first = cells[0] ?? null;
  const base = first?.d ?? defaultDecimals(first?.f);
  return Math.max(DEC_MIN, Math.min(DEC_MAX, base + dir));
}

/** The `d` shared by every cell, or undefined when mixed / unset. */
export function commonDecimals(cells: readonly (Cell | null)[]): number | undefined {
  if (!cells.length) return undefined;
  const first = cells[0]?.d;
  return cells.every((c) => c?.d === first) ? first : undefined;
}

/* ───────────────────── Align ───────────────────── */

export const ALIGNS: { id: CellAlign; title: string }[] = [
  { id: "left", title: "Align left" },
  { id: "center", title: "Align centre" },
  { id: "right", title: "Align right" },
];

/** The align shared by every cell, or undefined when mixed or default.
 *  Absent means the default (numbers right, text left) — so it reports
 *  undefined rather than pretending a cell is explicitly aligned. */
export function commonAlign(cells: readonly (Cell | null)[]): CellAlign | undefined {
  if (!cells.length) return undefined;
  const first = cells[0]?.a;
  if (!first) return undefined;
  return cells.every((c) => c?.a === first) ? first : undefined;
}

/* ───────────────────── The palette strip ───────────────────── */

export type Swatch = {
  /** The KEY written onto the cell. null CLEARS it. */
  key: string | null;
  label: string;
  /** The resolved CSS token for the chip — never a hex. */
  token: string | undefined;
};

function title(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const INK_LABELS: Record<string, string> = { body: "Default", muted: "Muted" };

/** Fill swatches. "none" is the palette's own key for no fill. */
export const FILL_SWATCHES: Swatch[] = SHEET_FILLS.map((k) =>
  k === "none"
    ? { key: null, label: "None", token: undefined }
    : { key: k, label: title(k), token: fillToken(k) },
);

/** Ink swatches, with a leading None that clears the key. */
export const INK_SWATCHES: Swatch[] = [
  { key: null, label: "None", token: undefined },
  ...SHEET_INKS.map((k) => ({ key: k, label: INK_LABELS[k] ?? title(k), token: inkToken(k) })),
];

/** The key shared by every cell for bg / fg, or undefined when mixed. */
export function commonKey(
  cells: readonly (Cell | null)[],
  which: "bg" | "fg",
): string | undefined {
  if (!cells.length) return undefined;
  const first = cells[0]?.[which];
  return cells.every((c) => c?.[which] === first) ? first : undefined;
}
