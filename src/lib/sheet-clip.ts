/**
 * The sheet's CLIPBOARD and FILL logic — pure. No React, no DOM, no
 * navigator. src/components/sheet-block.tsx renders and wires what this
 * file decides; the actual clipboard write goes through the ONE helper in
 * src/lib/clipboard.ts.
 *
 * Three rules this file exists to protect:
 *
 *  1. TWO REPRESENTATIONS, ONE COPY. The INTERNAL clip holds RAW cells —
 *     formulas and formatting included — because a copy inside the product
 *     must survive as a calculation. The SYSTEM clipboard gets TSV of
 *     COMPUTED values, because that is the only thing another spreadsheet
 *     can use.
 *
 *  2. A CUT CLEARS THE SOURCE ONLY WHEN THE PASTE LANDS. Clearing on the
 *     cut itself loses data whenever the user changes their mind, so the
 *     clip carries `cut` and `pasteInto` is the thing that empties it.
 *
 *  3. AN UNKNOWN FUNCTION IS NEVER DROPPED. `=NOPE(1)` pasted from another
 *     product is stored as literal text with a leading apostrophe, so it
 *     renders as text rather than as #NAME and can be repaired by hand.
 *     Losing a formula silently during a migration is worse than showing
 *     one that does not calculate.
 *
 * Relative references are shifted by chunk 1's `shiftFormula` — for BOTH
 * paste and fill. There is deliberately no second implementation.
 */

import { FUNCTION_META, evaluateCell, format, shiftFormula } from "./sheet-engine";
import {
  MAX_COLS,
  MAX_ROWS,
  addCol,
  addRow,
  setCell,
  type Cell,
  type SheetBlock,
} from "./sheet-model";
import type { Rect } from "./sheet-select";

/* ───────────────────────── The internal clip ───────────────────────── */

export type SheetClip = {
  /** RAW cells, top-left first. Formatting travels with them. */
  cells: (Cell | null)[][];
  /** Where the clip came from, so a relative formula can be shifted and a
   *  cut can clear exactly what it took. */
  r0: number;
  c0: number;
  /** A cut is a copy that also empties its source — once the paste lands. */
  cut: boolean;
  /** Which block the clip came from; a cut only clears its own sheet. */
  from: string;
};

export function clipFrom(
  sheet: SheetBlock,
  rc: Rect,
  cut: boolean,
  from: string,
): SheetClip {
  const cells: (Cell | null)[][] = [];
  for (let r = rc.r0; r <= rc.r1; r++) {
    const row: (Cell | null)[] = [];
    for (let c = rc.c0; c <= rc.c1; c++) {
      const cur = sheet.cells[r]?.[c] ?? null;
      row.push(cur ? { ...cur } : null);
    }
    cells.push(row);
  }
  return { cells, r0: rc.r0, c0: rc.c0, cut, from };
}

/* ───────────────────────── TSV ───────────────────────── */

/** A value carrying a tab, a newline or a quote is quoted, doubling any
 *  quote inside it — otherwise the rectangle would not survive a paste. */
export function tsvEscape(text: string): string {
  if (!/[\t\n\r"]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/** COMPUTED values, tab-separated, newline-delimited. What Google Sheets,
 *  Excel and Numbers all read. */
export function toTSV(sheet: SheetBlock, rc: Rect): string {
  const lines: string[] = [];
  for (let r = rc.r0; r <= rc.r1; r++) {
    const out: string[] = [];
    for (let c = rc.c0; c <= rc.c1; c++) {
      const cell = sheet.cells[r]?.[c] ?? null;
      const value = evaluateCell(sheet.cells, r, c);
      out.push(tsvEscape(format(value, cell?.f ?? "text", cell?.d)));
    }
    lines.push(out.join("\t"));
  }
  return lines.join("\n");
}

/** Parse a pasted TSV block into a rectangle of raw strings. Quoted cells
 *  may contain tabs and newlines; short rows are padded so the result is
 *  always rectangular. */
export function parseTSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"' && cur === "") {
      quoted = true;
      continue;
    }
    if (ch === "\t") {
      row.push(cur);
      cur = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      rows.push(row);
      row = [];
      continue;
    }
    cur += ch;
  }
  row.push(cur);
  rows.push(row);
  // Trailing newline yields one empty row — drop it, but never the only row.
  while (rows.length > 1 && rows[rows.length - 1].every((v) => v === "")) rows.pop();
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return rows.map((r) => {
    const next = r.slice();
    while (next.length < width) next.push("");
    return next;
  });
}

/* ─────────────────── Unknown functions and coercion ─────────────────── */

const KNOWN = new Set(FUNCTION_META.map((f) => f.name));

/** Every function name a formula calls, uppercased. */
export function calledFunctions(src: string): string[] {
  if (!src.startsWith("=")) return [];
  const out: string[] = [];
  // Skip string literals so text like "SUM(" is never read as a call.
  const parts = src.split(/("(?:[^"]*)")/g);
  parts.forEach((part, i) => {
    if (i % 2 === 1) return;
    for (const m of part.matchAll(/([A-Za-z][A-Za-z0-9_.]*)\s*\(/g)) out.push(m[1].toUpperCase());
  });
  return out;
}

export function hasUnknownFunction(src: string): boolean {
  return calledFunctions(src).some((n) => !KNOWN.has(n));
}

/**
 * The value a pasted string BECOMES. Numeric text becomes a number (the
 * same coercion typing does); a formula naming a function we do not have is
 * KEPT as visible text with a leading apostrophe.
 */
export function coercePasted(raw: string): string | number | undefined {
  if (raw === "") return undefined;
  const t = raw.trim();
  if (/^-?\d*\.?\d+$/.test(t)) return Number(t);
  if (raw.startsWith("=") && hasUnknownFunction(raw)) return `'${raw}`;
  return raw;
}

/* ───────────────────────── Paste ───────────────────────── */

export type Truncation = { rows: number; cols: number } | null;

export type PasteResult = {
  sheet: SheetBlock;
  /** What actually landed — the selection after a paste. */
  rect: Rect;
  truncated: Truncation;
};

function grow(sheet: SheetBlock, needRows: number, needCols: number): SheetBlock {
  let next = sheet;
  while (next.cells.length < needRows && next.cells.length < MAX_ROWS)
    next = addRow(next, next.cells.length);
  while (next.cw.length < needCols && next.cw.length < MAX_COLS)
    next = addCol(next, next.cw.length);
  return next;
}

/**
 * Paste the internal clip at (r, c). Relative formulas shift by the offset
 * via `shiftFormula`; formatting travels with the cells. A CUT clears its
 * source here — and only here.
 */
export function pasteInto(
  sheet: SheetBlock,
  clip: SheetClip,
  r: number,
  c: number,
  blockId: string,
): PasteResult {
  const h = clip.cells.length;
  const w = clip.cells[0]?.length ?? 0;
  let next = grow(sheet, r + h, c + w);
  const rows = next.cells.length;
  const cols = next.cw.length;
  const fitR = Math.min(h, rows - r);
  const fitC = Math.min(w, cols - c);
  const dr = r - clip.r0;
  const dc = c - clip.c0;

  // A cut empties its source FIRST, so a self-overlapping cut/paste keeps
  // what it just wrote rather than clearing it again.
  if (clip.cut && clip.from === blockId) {
    for (let i = 0; i < h; i++)
      for (let j = 0; j < w; j++) next = setCell(next, clip.r0 + i, clip.c0 + j, null);
  }

  for (let i = 0; i < fitR; i++) {
    for (let j = 0; j < fitC; j++) {
      const src = clip.cells[i][j];
      if (!src) {
        next = setCell(next, r + i, c + j, null);
        continue;
      }
      const cell: Cell = { ...src };
      if (typeof cell.v === "string" && cell.v.startsWith("="))
        cell.v = shiftFormula(cell.v, dr, dc);
      next = setCell(next, r + i, c + j, null);
      next = setCell(next, r + i, c + j, cell);
    }
  }

  return {
    sheet: next,
    rect: { r0: r, c0: c, r1: r + Math.max(0, fitR - 1), c1: c + Math.max(0, fitC - 1) },
    truncated: h > fitR || w > fitC ? { rows: h - fitR, cols: w - fitC } : null,
  };
}

/** Paste raw TSV values at (r, c). Values only — no formatting to carry. */
export function pasteValues(
  sheet: SheetBlock,
  grid: readonly (readonly string[])[],
  r: number,
  c: number,
): PasteResult {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  let next = grow(sheet, r + h, c + w);
  const fitR = Math.min(h, next.cells.length - r);
  const fitC = Math.min(w, next.cw.length - c);
  for (let i = 0; i < fitR; i++) {
    for (let j = 0; j < fitC; j++) {
      const v = coercePasted(grid[i][j]);
      const kept = { ...(next.cells[r + i]?.[c + j] ?? {}) };
      delete kept.v;
      next = setCell(next, r + i, c + j, null);
      const want: Cell = { ...kept, ...(v === undefined ? {} : { v }) };
      if (Object.keys(want).length) next = setCell(next, r + i, c + j, want);
    }
  }
  return {
    sheet: next,
    rect: { r0: r, c0: c, r1: r + Math.max(0, fitR - 1), c1: c + Math.max(0, fitC - 1) },
    truncated: h > fitR || w > fitC ? { rows: h - fitR, cols: w - fitC } : null,
  };
}

export function truncationText(t: Truncation): string | null {
  if (!t) return null;
  const parts: string[] = [];
  if (t.rows > 0) parts.push(`${t.rows} row${t.rows === 1 ? "" : "s"}`);
  if (t.cols > 0) parts.push(`${t.cols} column${t.cols === 1 ? "" : "s"}`);
  if (!parts.length) return null;
  return `Sheet limit reached — ${parts.join(" and ")} were not pasted.`;
}

/* ───────────────────────── The fill handle ───────────────────────── */

export type FillAxis = "down" | "right";

/**
 * The target of a fill drag. The DOMINANT AXIS wins — down or right,
 * whichever delta is larger — and never both at once, the way every
 * spreadsheet behaves. Dragging back inside the source is inert.
 */
export function fillTarget(
  src: Rect,
  r: number,
  c: number,
): { rect: Rect; axis: FillAxis } | null {
  const dDown = r - src.r1;
  const dRight = c - src.c1;
  if (dDown <= 0 && dRight <= 0) return null;
  const axis: FillAxis = dDown >= dRight ? "down" : "right";
  if (axis === "down") {
    if (dDown <= 0) return null;
    return { rect: { r0: src.r1 + 1, c0: src.c0, r1: r, c1: src.c1 }, axis };
  }
  if (dRight <= 0) return null;
  return { rect: { r0: src.r0, c0: src.c1 + 1, r1: src.r1, c1: c }, axis };
}

/**
 * Copy the source pattern into the target, CYCLICALLY, shifting relative
 * formulas by the real row/column delta so `=B2*C2` filled down becomes
 * `=B3*C3`. Formatting travels with the value.
 */
export function applyFill(
  sheet: SheetBlock,
  src: Rect,
  target: Rect,
  axis: FillAxis,
): SheetBlock {
  let next = sheet;
  const h = src.r1 - src.r0 + 1;
  const w = src.c1 - src.c0 + 1;
  for (let r = target.r0; r <= target.r1; r++) {
    for (let c = target.c0; c <= target.c1; c++) {
      if (r >= next.cells.length || c >= next.cw.length) continue;
      const sr = axis === "down" ? src.r0 + ((r - src.r0) % h + h) % h : r;
      const sc = axis === "right" ? src.c0 + ((c - src.c0) % w + w) % w : c;
      const source = sheet.cells[sr]?.[sc] ?? null;
      next = setCell(next, r, c, null);
      if (!source) continue;
      const cell: Cell = { ...source };
      if (typeof cell.v === "string" && cell.v.startsWith("="))
        cell.v = shiftFormula(cell.v, r - sr, c - sc);
      next = setCell(next, r, c, cell);
    }
  }
  return next;
}
