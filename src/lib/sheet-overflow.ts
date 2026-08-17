/**
 * Excel-style text overflow for the `sheet` block. PURE — no React, no DOM.
 *
 * A text value runs over EMPTY neighbours and clips at the first occupied
 * one. This is NOT a cell setting: there is deliberately no new field on
 * Cell, because overflow is the default reading behaviour of a grid, and a
 * per-cell toggle would be a preference nobody would ever set.
 *
 * The geometry is arithmetic over the SAME `cw` array every overlay uses —
 * never measured from the DOM, so a run can never disagree with a gridline.
 */

import type { Cell } from "./sheet-model";

/** A neighbour is empty when it holds NO value. Formatting-only cells
 *  (bg/fg/rt with no `v`) count as empty: their background still paints,
 *  the run simply passes over it. */
function isEmpty(cell: Cell | null | undefined): boolean {
  return !cell || cell.v === undefined;
}

/**
 * The run available to the text of cell (r, c), in px, relative to the
 * cell's OWN left edge — so `left` is 0 or negative.
 *
 * Returns null when there is no room beyond the cell's own width (both
 * relevant neighbours occupied, or the cell sits at the edge in the
 * direction its alignment runs).
 */
export function overflowRun(
  cells: (Cell | null)[][],
  cw: number[],
  r: number,
  c: number,
  align: "left" | "center" | "right",
): { left: number; width: number } | null {
  const row = cells[r];
  if (!row) return null;
  const cols = row.length;
  if (c < 0 || c >= cols) return null;
  const own = cw[c] ?? 0;

  let before = 0;
  let after = 0;

  if (align === "left" || align === "center") {
    for (let i = c + 1; i < cols; i++) {
      if (!isEmpty(row[i])) break;
      after += cw[i] ?? 0;
    }
  }
  if (align === "right" || align === "center") {
    for (let i = c - 1; i >= 0; i--) {
      if (!isEmpty(row[i])) break;
      before += cw[i] ?? 0;
    }
  }

  // Centre splits symmetrically, but each side is clamped independently by
  // its own first occupied cell: a run with one blocked side simply grows
  // less, it does not shift off-centre.
  if (align === "center") {
    const half = Math.min(before, after);
    before = half;
    after = half;
  }

  if (before === 0 && after === 0) return null;
  // `before === 0` explicitly, so the value is 0 and never -0.
  return { left: before === 0 ? 0 : -before, width: before + own + after };
}
