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

/** `grid-template-columns` value. minmax(0, …) on every track so a wide
 *  image or a long word cannot push a track past its share. */
export function columnsGridTemplate(
  widths: ColWidths | undefined,
  n: number,
): string {
  if (!widths || widths.length !== n) return `repeat(${n}, minmax(0, 1fr))`;
  return widths.map((w) => `minmax(0, ${w}fr)`).join(" ");
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
