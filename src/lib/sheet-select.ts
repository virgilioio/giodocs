/**
 * Sheet SELECTION, GEOMETRY and the KEYBOARD DECISION — pure. No React,
 * no DOM. src/components/sheet-block.tsx renders what this file decides.
 *
 * ⚠ Why the geometry lives here and is arithmetic rather than measured:
 * EVERY sheet overlay — the single hoisted editor (chunk 3), the selection
 * rectangle, and later the suggestion panel, the argument chip, the
 * reference halo — is a GRID-LEVEL child positioned from these numbers.
 * The row height (29) and header height (26) are constants precisely so
 * this maths is exact. Nothing may measure a cell to find out where it is.
 *
 * A selection is an ANCHOR cell and a FOCUS cell; the range is the
 * rectangle between them. Chunks 5 and 6 (row/column ops, fill handle,
 * clipboard) consume this shape, so it is deliberately minimal.
 */

import { MAX_COLS, MAX_ROWS } from "./sheet-model";

export const ROW_NUM_W = 34;
export const HEAD_H = 26;
export const ROW_H = 29;

/* ─────────────────────────── Geometry ─────────────────────────── */

export type Box = { left: number; top: number; width: number; height: number };

/** Left edge of column `c` in grid coordinates. */
export function colLeft(cw: readonly number[], c: number): number {
  let x = ROW_NUM_W;
  for (let i = 0; i < c && i < cw.length; i++) x += cw[i];
  return x;
}

/** Top edge of row `r` in grid coordinates. */
export function rowTop(r: number): number {
  return HEAD_H + r * ROW_H;
}

/** The box for a single cell — the hoisted editor's position. */
export function cellBox(cw: readonly number[], r: number, c: number): Box {
  return { left: colLeft(cw, c), top: rowTop(r), width: cw[c] ?? 0, height: ROW_H };
}

/** The box covering a whole normalized range — the selection overlay. */
export function rangeBox(cw: readonly number[], rect: Rect): Box {
  const left = colLeft(cw, rect.c0);
  let width = 0;
  for (let c = rect.c0; c <= rect.c1 && c < cw.length; c++) width += cw[c];
  return {
    left,
    top: rowTop(rect.r0),
    width,
    height: (rect.r1 - rect.r0 + 1) * ROW_H,
  };
}

/* ─────────────────────────── Selection ─────────────────────────── */

/** Anchor + focus. The rectangle is derived, never stored. */
export type Sel = { ar: number; ac: number; fr: number; fc: number };
export type Rect = { r0: number; c0: number; r1: number; c1: number };

export function selAt(r: number, c: number): Sel {
  return { ar: r, ac: c, fr: r, fc: c };
}

/** The rectangle between anchor and focus, in either direction. */
export function rect(sel: Sel): Rect {
  return {
    r0: Math.min(sel.ar, sel.fr),
    r1: Math.max(sel.ar, sel.fr),
    c0: Math.min(sel.ac, sel.fc),
    c1: Math.max(sel.ac, sel.fc),
  };
}

export function isSingle(sel: Sel): boolean {
  return sel.ar === sel.fr && sel.ac === sel.fc;
}

export function inRect(rc: Rect, r: number, c: number): boolean {
  return r >= rc.r0 && r <= rc.r1 && c >= rc.c0 && c <= rc.c1;
}

/** Every (r, c) inside the range, row-major. */
export function cellsIn(rc: Rect): { r: number; c: number }[] {
  const out: { r: number; c: number }[] = [];
  for (let r = rc.r0; r <= rc.r1; r++) for (let c = rc.c0; c <= rc.c1; c++) out.push({ r, c });
  return out;
}

/** Whole-column selection: every row of one or more columns. */
export function selectCols(c0: number, c1: number, rows: number): Sel {
  return { ar: 0, ac: c0, fr: Math.max(0, rows - 1), fc: c1 };
}

/** Whole-row selection: every column of one or more rows. */
export function selectRows(r0: number, r1: number, cols: number): Sel {
  return { ar: r0, ac: 0, fr: r1, fc: Math.max(0, cols - 1) };
}

export function selectAll(rows: number, cols: number): Sel {
  return { ar: 0, ac: 0, fr: Math.max(0, rows - 1), fc: Math.max(0, cols - 1) };
}

/**
 * "Is a full span selected" — chunk 5's row/column operations key off
 * exactly this, so it is a pure predicate here rather than a rendering
 * accident there.
 */
export function fullSpan(
  sel: Sel,
  rows: number,
  cols: number,
): { cols: boolean; rows: boolean; all: boolean; span: Rect } {
  const rc = rect(sel);
  const fullCols = rc.r0 === 0 && rc.r1 === rows - 1;
  const fullRows = rc.c0 === 0 && rc.c1 === cols - 1;
  return { cols: fullCols, rows: fullRows, all: fullCols && fullRows, span: rc };
}

export function clampR(r: number, rows: number): number {
  return Math.max(0, Math.min(rows - 1, r));
}

export function clampC(c: number, cols: number): number {
  return Math.max(0, Math.min(cols - 1, c));
}

/**
 * Step one cell. `wrap` is Tab's behaviour: past the last column it moves
 * to the first column of the NEXT row. Enter at the last row STAYS PUT —
 * growth is deliberate (chunk 5's controls), never a side effect of typing.
 */
export function step(
  r: number,
  c: number,
  dr: number,
  dc: number,
  rows: number,
  cols: number,
  wrap = false,
): { r: number; c: number } {
  if (wrap && dc !== 0) {
    let nr = r;
    let nc = c + dc;
    if (nc >= cols) {
      nc = 0;
      nr = r + 1;
    } else if (nc < 0) {
      nc = cols - 1;
      nr = r - 1;
    }
    if (nr < 0 || nr >= rows) return { r, c };
    return { r: nr, c: nc };
  }
  return { r: clampR(r + dr, rows), c: clampC(c + dc, cols) };
}

/* ────────────────────── The keyboard decision ──────────────────────
 *
 * Pure so it can be tested without a DOM, and so the component has no
 * branching left to get wrong. The component's ONLY job is to run the
 * returned action and stopPropagation — see §E: the page around this
 * sheet already binds arrows, Backspace, Enter, Tab, ⌘B and ⌘I.
 */

export type KeyInfo = {
  key: string;
  shift?: boolean;
  meta?: boolean;
  ctrl?: boolean;
  alt?: boolean;
};

export type SheetAction =
  /** Not the sheet's key — let it propagate to the page. */
  | { kind: "pass" }
  /** The sheet handled it but nothing changes (e.g. arrow at an edge). */
  | { kind: "noop" }
  | { kind: "move"; r: number; c: number }
  | { kind: "extend"; r: number; c: number }
  /** Open the editor. `seed === null` means "edit the existing value";
   *  `sel` false means the caret sits after the seeded character. */
  | { kind: "edit"; seed: string | null; sel: boolean }
  | { kind: "commit"; r: number; c: number }
  | { kind: "discard" }
  | { kind: "clearRange" }
  | { kind: "bold" }
  | { kind: "italic" }
  | { kind: "clearSelection" }
  /* ── Suggestion-panel keys. WHEN THE PANEL IS OPEN IT TAKES ↑↓, Tab,
   * Enter and Escape FIRST — the precedence lives here, in the pure
   * decision, so it is testable without a DOM. Escape closes the panel;
   * a SECOND Escape (panel now closed) discards the edit. ── */
  | { kind: "panelPrev" }
  | { kind: "panelNext" }
  | { kind: "panelInsert" }
  | { kind: "panelClose" }
  /* ── Chunk 7's clipboard keys. The sheet CLAIMS ⌘C / ⌘X / ⌘V while a cell
   * range is SELECTED — the page binds ⌘C and ⌘X for block selection, and
   * with focus on the grid container it would otherwise copy the whole
   * sheet block as Markdown instead of the cells. While EDITING they stay
   * native, so copy and paste inside the input behave normally. ⌘Z passes
   * through in BOTH states: a sheet edit is a block commit and the page
   * owns the history. ── */
  | { kind: "copy" }
  | { kind: "cut" }
  | { kind: "paste" };


function isPrintable(k: KeyInfo): boolean {
  return k.key.length === 1 && !k.meta && !k.ctrl && !k.alt;
}

/** A cell is SELECTED but not being edited. Focus is on the grid. */
export function keyWhenSelected(
  k: KeyInfo,
  sel: Sel,
  rows: number,
  cols: number,
): SheetAction {
  const mod = k.meta || k.ctrl;
  if (mod) {
    const low = k.key.toLowerCase();
    if (low === "b") return { kind: "bold" };
    if (low === "i") return { kind: "italic" };
    // The clipboard trio is the SHEET's while a range is selected.
    if (low === "c") return { kind: "copy" };
    if (low === "x") return { kind: "cut" };
    if (low === "v") return { kind: "paste" };
    // ⌘Z and friends belong to the page / the browser.
    return { kind: "pass" };
  }


  const D: Record<string, [number, number]> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  };
  if (k.key in D) {
    const [dr, dc] = D[k.key];
    const from = k.shift ? { r: sel.fr, c: sel.fc } : { r: sel.fr, c: sel.fc };
    const n = step(from.r, from.c, dr, dc, rows, cols);
    return k.shift ? { kind: "extend", r: n.r, c: n.c } : { kind: "move", r: n.r, c: n.c };
  }

  if (k.key === "Tab") {
    const n = step(sel.fr, sel.fc, 0, k.shift ? -1 : 1, rows, cols, true);
    return { kind: "move", r: n.r, c: n.c };
  }
  if (k.key === "Enter" || k.key === "F2") return { kind: "edit", seed: null, sel: true };
  if (k.key === "Backspace" || k.key === "Delete") return { kind: "clearRange" };
  if (k.key === "Escape") return { kind: "clearSelection" };
  if (k.key === "Home") return { kind: "move", r: sel.fr, c: 0 };
  if (k.key === "End") return { kind: "move", r: sel.fr, c: cols - 1 };
  if (isPrintable(k)) return { kind: "edit", seed: k.key, sel: false };
  return { kind: "pass" };
}

/** The editor is OPEN on (r, c). Focus is inside the hoisted input. */
export function keyWhenEditing(
  k: KeyInfo,
  r: number,
  c: number,
  rows: number,
  cols: number,
  /** The autocomplete panel is showing. It claims ↑↓, Tab, Enter, Escape. */
  panelOpen = false,
): SheetAction {
  if (panelOpen && !k.meta && !k.ctrl && !k.alt) {
    if (k.key === "ArrowUp") return { kind: "panelPrev" };
    if (k.key === "ArrowDown") return { kind: "panelNext" };
    if (k.key === "Tab" || k.key === "Enter") return { kind: "panelInsert" };
    if (k.key === "Escape") return { kind: "panelClose" };
  }
  if (k.key === "Escape") return { kind: "discard" };
  if (k.key === "Enter") {
    // Enter at the last row commits and stays — it never grows the sheet.
    const n = step(r, c, k.shift ? -1 : 1, 0, rows, cols);
    return { kind: "commit", r: n.r, c: n.c };
  }
  if (k.key === "Tab") {
    const n = step(r, c, 0, k.shift ? -1 : 1, rows, cols, true);
    return { kind: "commit", r: n.r, c: n.c };
  }
  if (k.meta || k.ctrl) {
    const low = k.key.toLowerCase();
    if (low === "b") return { kind: "bold" };
    if (low === "i") return { kind: "italic" };
  }
  // Everything else — arrows included — belongs to the input's own caret.
  return { kind: "pass" };
}

/* ───────────────── Reference label for the formula bar ───────────── */

export function colLabel(c: number): string {
  let s = "";
  let n = c;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

/** "B2" for a single cell, "B2:D5" for a range. */
export function refLabel(sel: Sel): string {
  const rc = rect(sel);
  const a = `${colLabel(rc.c0)}${rc.r0 + 1}`;
  if (rc.r0 === rc.r1 && rc.c0 === rc.c1) return a;
  return `${a}:${colLabel(rc.c1)}${rc.r1 + 1}`;
}

/** An A1 range string for the engine — how the readout avoids a second
 *  summing path: it asks the engine for =SUM(...) over this range. */
export function rangeRef(sel: Sel): string {
  const rc = rect(sel);
  return `${colLabel(rc.c0)}${rc.r0 + 1}:${colLabel(rc.c1)}${rc.r1 + 1}`;
}

/** Guard rails shared with the model so overlays can never be asked to
 *  position something outside the grid the model permits. */
export const SEL_MAX = { rows: MAX_ROWS, cols: MAX_COLS };
