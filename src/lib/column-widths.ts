/* Columns-block proportional widths — pure helpers.
 *
 * A columns block may carry `widths?: number[]`: FRACTIONAL WEIGHTS, one
 * per column, absent meaning equal. Weights (not percentages) because
 * `fr` tracks account for the grid gap automatically; a percentage model
 * has to subtract the gaps and drifts as the count changes.
 *
 * Deliberately different from TABLE widths (pixels, independent growth):
 * a page columns block always fills the text column, so widening one
 * column must narrow its neighbour.
 *
 * INVARIANT: widths.length === cols.length. A widths array out of step is
 * silent corruption — every column after the mismatch renders at the wrong
 * size. `normalizeColumnWidths` is the single place that enforces it and
 * must be applied on every render and before every commit.
 */

export type ColWidths = number[];

/** No column may collapse to nothing. */
export const COL_MIN_FR = 0.35;

const round = (n: number) => Math.round(n * 1000) / 1000;

export function equalColumnWidths(n: number): ColWidths {
  return Array.from({ length: Math.max(0, n) }, () => 1);
}

/**
 * Bring a stored widths array into lockstep with `n` columns:
 * pads with 1, trims the tail, replaces non-finite/too-small entries with
 * the clamped minimum. Returns undefined when there is nothing stored —
 * absent means "equal", and we never materialise it unasked.
 */
export function normalizeColumnWidths(
  widths: unknown,
  n: number,
): ColWidths | undefined {
  if (!Array.isArray(widths) || n <= 0) return undefined;
  const out: ColWidths = [];
  for (let i = 0; i < n; i++) {
    const raw = widths[i];
    const num = typeof raw === "number" && Number.isFinite(raw) ? raw : 1;
    out.push(round(Math.max(COL_MIN_FR, num)));
  }
  return out;
}

/** The fixed width of the track between two adjacent columns. This used to
 *  be the grid's `gap`; it is now a real track so the resize handles have a
 *  cell of their own (see columnsGridTemplate). */
export const COL_GAP_PX = 40;

/** `grid-template-columns` for the PLAIN case (no handle children) — one
 *  track per column, spacing supplied by the grid's own `gap`. Used by the
 *  HTML exporter, which never renders resize handles. */
export function columnsGridTemplatePlain(
  widths: ColWidths | undefined,
  n: number,
): string {
  if (!widths || widths.length !== n) return `repeat(${n}, minmax(0, 1fr))`;
  return widths.map((w) => `minmax(0, ${w}fr)`).join(" ");
}

/**
 * `grid-template-columns` for the EDITOR: weight tracks and fixed gap
 * tracks INTERLEAVED — `{w1}fr 40px {w2}fr 40px {w3}fr`.
 *
 * Why: the resize handles are grid items. With one track per column there
 * were 2N-1 children for N tracks, so every surplus child flowed into an
 * implicit row — the columns appeared to wrap onto the next line with a
 * blank strip where a handle occupied a column track. Giving each boundary
 * its own 40px track makes child count match track count exactly, and the
 * handle track supplies the spacing the grid `gap` used to (so the grid's
 * gap must be 0).
 *
 * minmax(0, …) on every weight track so a wide image or a long word cannot
 * push a track past its share. The stored `widths` array is unchanged: one
 * weight per COLUMN. Handle tracks are never part of the model.
 */
export function columnsGridTemplate(
  widths: ColWidths | undefined,
  n: number,
): string {
  if (n <= 0) return "";
  const w = widths && widths.length === n ? widths : null;
  const track = (i: number) => `minmax(0, ${w ? w[i] : 1}fr)`;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) parts.push(`${COL_GAP_PX}px`);
    parts.push(track(i));
  }
  return parts.join(" ");
}


/**
 * Drag the boundary between column `i` and `i + 1` by `deltaFr` weights.
 * The PAIR's combined weight is preserved exactly; every other column is
 * untouched. Both sides clamp at COL_MIN_FR, so the drag stops rather
 * than collapsing a column.
 */
export function resizeColumnPair(
  widths: ColWidths,
  i: number,
  deltaFr: number,
): ColWidths {
  const out = widths.slice();
  if (i < 0 || i + 1 >= out.length) return out;
  const a = out[i];
  const b = out[i + 1];
  const sum = a + b;
  let nextA = a + deltaFr;
  if (nextA < COL_MIN_FR) nextA = COL_MIN_FR;
  if (sum - nextA < COL_MIN_FR) nextA = sum - COL_MIN_FR;
  out[i] = round(nextA);
  out[i + 1] = round(sum - nextA);
  return out;
}

/** Double-click a handle: the two adjacent columns split their combined
 *  weight evenly. Neighbours keep their weights. */
export function resetColumnPair(widths: ColWidths, i: number): ColWidths {
  const out = widths.slice();
  if (i < 0 || i + 1 >= out.length) return out;
  const half = round((out[i] + out[i + 1]) / 2);
  out[i] = half;
  out[i + 1] = half;
  return out;
}
