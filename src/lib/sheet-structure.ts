/**
 * Sheet STRUCTURAL DECISIONS — pure. No React, no DOM.
 *
 * Chunk 4 grows, shrinks and reorders the grid. The MUTATIONS themselves
 * live in sheet-model.ts (addRow / deleteRow / addCol / deleteCol /
 * moveRow / moveCol — each splicing `cw` in lockstep and enforcing the
 * floors and bounds). This file decides:
 *
 *   1. WHICH contextual controls exist for the current selection, whether
 *      each is enabled, and the exact title a DISABLED one carries. A
 *      control that vanishes at a boundary reads as a bug, so every op is
 *      always present and explains itself instead.
 *   2. HOW an index moves when the structure changes — `shiftIndex`. This
 *      is what stops the open editor's coordinates going stale when a row
 *      is inserted above the cell being edited: the component shifts the
 *      edit rather than losing the draft.
 *   3. The column-width drag arithmetic and the per-column default.
 *
 * Multi-span is first class here, not retrofitted: every op takes the
 * whole [i0..i1] span and acts on it as a block.
 */

import {
  addCol,
  addRow,
  deleteCol,
  deleteRow,
  MAX_COLS,
  MAX_ROWS,
  MIN_COLS,
  MIN_ROWS,
  moveCol,
  moveRow,
  type SheetBlock,
} from "./sheet-model";
import { colLabel, fullSpan, rect, selectCols, selectRows, type Sel } from "./sheet-select";

/* ───────────────────────── Column widths ─────────────────────────
 * A sheet column is PIXELS AND INDEPENDENT, like a table column and
 * unlike a page column: widening one must never narrow its neighbour,
 * because a sheet is allowed to be wider than the text column and
 * scrolls. The drag clamp is felt DURING the drag, never on release. */

export const SHEET_CW_MIN = 56;
export const SHEET_CW_MAX = 420;

/** Column 0 usually holds labels, the rest hold figures. */
export function defaultCw(c: number): number {
  return c === 0 ? 160 : 120;
}

export function clampCw(px: number): number {
  if (!Number.isFinite(px)) return SHEET_CW_MIN;
  return Math.max(SHEET_CW_MIN, Math.min(SHEET_CW_MAX, Math.round(px)));
}

/** The width a drag has reached — clamped, so the limit is felt live. */
export function dragWidth(base: number, dx: number): number {
  return clampCw(base + dx);
}

/* ───────────────────────── Contextual ops ───────────────────────── */

export type SpanKind = "row" | "col";
export type OpId = "insertBefore" | "insertAfter" | "moveBack" | "moveFwd" | "delete";

export type OpSpec = {
  id: OpId;
  label: string;
  enabled: boolean;
  /** Always present — an enabled control explains what it will do, a
   *  disabled one explains why it will not. */
  title: string;
  danger?: boolean;
  /** Set only when disabled: clicking TOASTS this rather than doing
   *  nothing silently. */
  toast?: string;
};

export type SpanControls = {
  kind: SpanKind;
  /** "Row 4" · "Rows 4–6" · "Column C" · "Columns C–E" */
  label: string;
  i0: number;
  i1: number;
  count: number;
  ops: OpSpec[];
};

const LIMIT = {
  row: `${MAX_ROWS} rows is the limit`,
  col: `${MAX_COLS} columns is the limit`,
} as const;

const FLOOR = {
  row: "A sheet keeps at least two rows",
  col: "A sheet keeps at least one column",
} as const;

function noun(kind: SpanKind, count: number): string {
  if (kind === "row") return count === 1 ? "row" : `${count} rows`;
  return count === 1 ? "column" : `${count} columns`;
}

/**
 * The contextual group for the current selection, or null when no FULL
 * span is selected — the group is meaningless without one, which is why
 * chunk 3's `fullSpan` predicate is the single source of that decision.
 *
 * When the selection is full in BOTH directions — the corner, or a
 * one-column sheet where selecting the column also selects every row —
 * `prefer` decides. The component passes how the selection was MADE, so a
 * click on a column letter reads as a column even in a 1×n sheet; without
 * a hint rows win.
 */
export function spanControls(
  sel: Sel | null,
  rows: number,
  cols: number,
  prefer?: SpanKind,
): SpanControls | null {
  if (!sel) return null;
  const f = fullSpan(sel, rows, cols);
  if (!f.rows && !f.cols) return null;
  const kind: SpanKind =
    f.rows && f.cols ? (prefer ?? "row") : f.rows ? "row" : "col";
  const rc = rect(sel);
  const i0 = kind === "row" ? rc.r0 : rc.c0;
  const i1 = kind === "row" ? rc.r1 : rc.c1;
  const count = i1 - i0 + 1;
  const total = kind === "row" ? rows : cols;
  const max = kind === "row" ? MAX_ROWS : MAX_COLS;
  const min = kind === "row" ? MIN_ROWS : MIN_COLS;

  const name = (i: number) => (kind === "row" ? `${i + 1}` : colLabel(i));
  const label =
    count === 1
      ? `${kind === "row" ? "Row" : "Column"} ${name(i0)}`
      : `${kind === "row" ? "Rows" : "Columns"} ${name(i0)}–${name(i1)}`;

  const roomToGrow = total + count <= max;
  const roomToShrink = total - count >= min;
  const canBack = i0 > 0;
  const canFwd = i1 < total - 1;
  const N = noun(kind, count);

  const ops: OpSpec[] = [
    {
      id: "insertBefore",
      label: kind === "row" ? "Above" : "Left",
      enabled: roomToGrow,
      title: roomToGrow
        ? `Insert ${N} ${kind === "row" ? "above" : "left"}`
        : LIMIT[kind],
      ...(roomToGrow ? null : { toast: LIMIT[kind] }),
    },
    {
      id: "insertAfter",
      label: kind === "row" ? "Below" : "Right",
      enabled: roomToGrow,
      title: roomToGrow
        ? `Insert ${N} ${kind === "row" ? "below" : "right"}`
        : LIMIT[kind],
      ...(roomToGrow ? null : { toast: LIMIT[kind] }),
    },
    {
      id: "moveBack",
      label: kind === "row" ? "Move up" : "Move left",
      enabled: canBack,
      title: canBack ? `Move ${kind === "row" ? "up" : "left"}` : "Already first",
      ...(canBack ? null : { toast: "Already first" }),
    },
    {
      id: "moveFwd",
      label: kind === "row" ? "Move down" : "Move right",
      enabled: canFwd,
      title: canFwd ? `Move ${kind === "row" ? "down" : "right"}` : "Already last",
      ...(canFwd ? null : { toast: "Already last" }),
    },
    {
      id: "delete",
      label: "Delete",
      enabled: roomToShrink,
      danger: true,
      title: roomToShrink ? `Delete ${N}` : FLOOR[kind],
      ...(roomToShrink ? null : { toast: FLOOR[kind] }),
    },
  ];

  return { kind, label, i0, i1, count, ops };
}

/** The blind-append controls at the bottom and right edges. */
export function appendControl(
  kind: SpanKind,
  rows: number,
  cols: number,
): { enabled: boolean; title: string } {
  if (kind === "row") {
    const ok = rows < MAX_ROWS;
    return { enabled: ok, title: ok ? "Add row" : LIMIT.row };
  }
  const ok = cols < MAX_COLS;
  return { enabled: ok, title: ok ? "Add column" : LIMIT.col };
}

/* ───────────────────────── Applying an op ───────────────────────── */

/** Run a span op through the MODEL — never a second set of mutations. */
export function applySpanOp(
  sheet: SheetBlock,
  kind: SpanKind,
  i0: number,
  i1: number,
  op: OpId,
): SheetBlock {
  const count = i1 - i0 + 1;
  let next = sheet;
  const add = kind === "row" ? addRow : (s: SheetBlock, at: number) => addCol(s, at);
  const del = kind === "row" ? deleteRow : deleteCol;
  const move = kind === "row" ? moveRow : moveCol;

  switch (op) {
    case "insertBefore":
      for (let n = 0; n < count; n++) next = add(next, i0);
      return next;
    case "insertAfter":
      for (let n = 0; n < count; n++) next = add(next, i1 + 1);
      return next;
    case "delete":
      for (let n = 0; n < count; n++) next = del(next, i0);
      return next;
    // A span moves as a BLOCK by moving its NEIGHBOUR across it — one
    // model call, and the span's internal order is untouched by
    // construction.
    case "moveBack":
      return i0 > 0 ? move(next, i0 - 1, i1) : next;
    case "moveFwd":
      return move(next, i1 + 1, i0);
    default:
      return next;
  }
}

/**
 * Where an index ends up after a structural op — or null when the op
 * deleted it.
 *
 * ⚠ This is the function that keeps the open editor honest. Inserting a
 * row above the cell being edited shifts that cell down; without this
 * the editor's stored coordinates would point at a different cell and
 * the focus stamp would go stale, re-selecting the user's draft.
 */
export function shiftIndex(idx: number, op: OpId, i0: number, i1: number): number | null {
  const count = i1 - i0 + 1;
  switch (op) {
    case "insertBefore":
      return idx >= i0 ? idx + count : idx;
    case "insertAfter":
      return idx > i1 ? idx + count : idx;
    case "delete":
      if (idx >= i0 && idx <= i1) return null;
      return idx > i1 ? idx - count : idx;
    case "moveBack":
      if (i0 === 0) return idx;
      if (idx >= i0 && idx <= i1) return idx - 1;
      if (idx === i0 - 1) return i1;
      return idx;
    case "moveFwd":
      if (idx >= i0 && idx <= i1) return idx + 1;
      if (idx === i1 + 1) return i0;
      return idx;
    default:
      return idx;
  }
}

/**
 * The selection AFTER an op. Selection survives sensibly: after deleting
 * row 4 the selection lands on the new row 4 (the last row when row 4
 * was last), never on nothing.
 */
export function selAfterOp(
  kind: SpanKind,
  i0: number,
  i1: number,
  op: OpId,
  rowsAfter: number,
  colsAfter: number,
): Sel {
  const total = kind === "row" ? rowsAfter : colsAfter;
  const across = kind === "row" ? colsAfter : rowsAfter;
  const count = i1 - i0 + 1;

  let a = i0;
  let b = i1;
  if (op === "insertBefore") {
    a = i0 + count;
    b = i1 + count;
  } else if (op === "moveBack") {
    a = Math.max(0, i0 - 1);
    b = Math.max(0, i1 - 1);
  } else if (op === "moveFwd") {
    a = Math.min(total - 1, i0 + 1);
    b = Math.min(total - 1, i1 + 1);
  } else if (op === "delete") {
    a = Math.min(i0, total - 1);
    b = a;
  }
  a = Math.max(0, Math.min(total - 1, a));
  b = Math.max(0, Math.min(total - 1, b));
  return kind === "row" ? selectRows(a, b, across) : selectCols(a, b, across);
}
