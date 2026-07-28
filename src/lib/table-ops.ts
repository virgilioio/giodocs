/**
 * Pure operations on a table block's `rows: string[][]` value, plus the
 * per-column `align: Align[]` shadow array that mirrors the column count.
 *
 * Invariant enforced by every export in this file:
 *   1. The returned matrix is RECTANGULAR (every row has the same length)
 *      and has at least one row and one column. A ragged matrix would
 *      misalign the rendered table AND break the Markdown export (the
 *      pipe-table separator row is sized from the header — mismatched
 *      widths mean it stops parsing as a table).
 *   2. When `align` is passed to a column-changing op, it comes back with
 *      EXACTLY `width(rows)` entries. Getting this wrong is the silent-
 *      corruption failure mode — a stale index would offset every column's
 *      alignment.
 *
 * All functions return new arrays and never mutate their inputs. Destructive
 * ops (deleteRow / deleteColumn) clamp to the minimums — callers see the
 * input matrix back and should surface a hint in the UI rather than let the
 * table disappear.
 *
 * The header is POSITIONAL — row 0 is always the header — so
 * `deleteRow(rows, 0)` promotes what was row 1 into the header slot with no
 * metadata to migrate.
 */
export type TableRows = string[][];
export type Align = "left" | "center" | "right";
export type AlignList = Align[];
export type WidthList = number[];

/** Pixel bounds for a resizable column. MIN keeps a column addressable
 *  by the mouse; MAX prevents a stray drag from producing an unusable,
 *  page-wide monstrosity. Both are enforced in every widths-splicing op
 *  so a bad value stored in the past (or received over realtime) is
 *  clamped on the way in, not just at drag time. */
export const WIDTH_MIN = 56;
export const WIDTH_MAX = 1200;
/** Fallback used when a widths op has to invent a value (a new column
 *  spliced into an existing widths array). Chosen to match the typical
 *  auto-share of a mid-page table so newly-inserted columns don't jump. */
export const WIDTH_DEFAULT = 160;

function clampWidth(px: number): number {
  const n = Number.isFinite(px) ? Math.round(px) : WIDTH_DEFAULT;
  return Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, n));
}

function clone(rows: TableRows): TableRows {
  return rows.map((r) => r.slice());
}

function isAlign(v: unknown): v is Align {
  return v === "left" || v === "center" || v === "right";
}

/** Force `align` to length `width`, padding with "left" and truncating. */
export function normalizeAlign(align: AlignList | undefined, width: number): AlignList {
  const w = Math.max(1, width | 0);
  const src = Array.isArray(align) ? align : [];
  const out: AlignList = [];
  for (let i = 0; i < w; i++) out.push(isAlign(src[i]) ? src[i] : "left");
  return out;
}

/** Force `rows` to a rectangle with at least 1×1 shape. Pads short rows
 *  with "", truncates long ones. If `align` is passed, it is normalised to
 *  match the resulting column count. Returns rows only (unchanged API);
 *  align-carrying callers pair this with `normalizeAlign`. */
export function normalizeTable(rows: TableRows): TableRows {
  if (!Array.isArray(rows) || rows.length === 0) return [[""]];
  const width = Math.max(
    1,
    ...rows.map((r) => (Array.isArray(r) ? r.length : 0)),
  );
  return rows.map((r) => {
    const row = Array.isArray(r) ? r.slice(0, width) : [];
    while (row.length < width) row.push("");
    return row.map((c) => (typeof c === "string" ? c : String(c ?? "")));
  });
}

function width(rows: TableRows): number {
  return rows[0]?.length ?? 0;
}

/** Insert a fresh empty column at `atIndex` (clamped to [0, width]). */
export function addColumn(rows: TableRows, atIndex: number): TableRows {
  const src = normalizeTable(rows);
  const w = width(src);
  const idx = Math.max(0, Math.min(atIndex, w));
  return src.map((r) => {
    const next = r.slice();
    next.splice(idx, 0, "");
    return next;
  });
}

/** Companion to addColumn: insert a "left" entry at `atIndex`. */
export function addAlign(align: AlignList, atIndex: number): AlignList {
  const src = normalizeAlign(align, align.length);
  const idx = Math.max(0, Math.min(atIndex, src.length));
  const next = src.slice();
  next.splice(idx, 0, "left");
  return next;
}

/** Remove column `index`. Refuses (returns input clone) when it is the
 *  only column, or when `index` is out of range. */
export function deleteColumn(rows: TableRows, index: number): TableRows {
  const src = normalizeTable(rows);
  const w = width(src);
  if (w <= 1) return src;
  if (index < 0 || index >= w) return src;
  return src.map((r) => {
    const next = r.slice();
    next.splice(index, 1);
    return next;
  });
}

/** Companion to deleteColumn: drop `align[index]`. Refuses when the array
 *  has one entry, matching deleteColumn's refuse-at-one behaviour. */
export function deleteAlign(align: AlignList, index: number): AlignList {
  const src = normalizeAlign(align, align.length);
  if (src.length <= 1) return src;
  if (index < 0 || index >= src.length) return src;
  const next = src.slice();
  next.splice(index, 1);
  return next;
}

/** Duplicate column `index`. New column with the same cell values lands
 *  immediately AFTER the source. Refuses (returns input clone) when
 *  `index` is out of range. */
export function duplicateColumn(rows: TableRows, index: number): TableRows {
  const src = normalizeTable(rows);
  const w = width(src);
  if (index < 0 || index >= w) return src;
  return src.map((r) => {
    const next = r.slice();
    next.splice(index + 1, 0, r[index] ?? "");
    return next;
  });
}

/** Companion to duplicateColumn: duplicate `align[index]` in place. */
export function duplicateAlign(align: AlignList, index: number): AlignList {
  const src = normalizeAlign(align, align.length);
  if (index < 0 || index >= src.length) return src;
  const next = src.slice();
  next.splice(index + 1, 0, src[index]);
  return next;
}

/** Move column `from` to `to`. Both are clamped; equal indices are a
 *  no-op that still returns a fresh matrix. */
export function moveColumn(
  rows: TableRows,
  from: number,
  to: number,
): TableRows {
  const src = normalizeTable(rows);
  const w = width(src);
  if (from < 0 || from >= w) return src;
  const dst = Math.max(0, Math.min(to, w - 1));
  if (dst === from) return src;
  return src.map((r) => {
    const next = r.slice();
    const [cell] = next.splice(from, 1);
    next.splice(dst, 0, cell);
    return next;
  });
}

/** Companion to moveColumn: reorder the align array in step. */
export function moveAlign(
  align: AlignList,
  from: number,
  to: number,
): AlignList {
  const src = normalizeAlign(align, align.length);
  if (from < 0 || from >= src.length) return src;
  const dst = Math.max(0, Math.min(to, src.length - 1));
  if (dst === from) return src;
  const next = src.slice();
  const [v] = next.splice(from, 1);
  next.splice(dst, 0, v);
  return next;
}

/** Set `align[index]` to `value`. Out-of-range index returns a clone. */
export function setAlign(
  align: AlignList,
  index: number,
  value: Align,
): AlignList {
  const src = normalizeAlign(align, align.length);
  if (index < 0 || index >= src.length) return src;
  const next = src.slice();
  next[index] = value;
  return next;
}

/** Insert a fresh empty row at `atIndex` (clamped to [0, rows.length]). */
export function addRow(rows: TableRows, atIndex: number): TableRows {
  const src = normalizeTable(rows);
  const w = width(src);
  const idx = Math.max(0, Math.min(atIndex, src.length));
  const fresh: string[] = new Array(w).fill("");
  const next = clone(src);
  next.splice(idx, 0, fresh);
  return next;
}

/** Remove row `index`. Refuses (returns input clone) when it is the only
 *  row, or when `index` is out of range. Deleting row 0 promotes the next
 *  row to header — no metadata to migrate; header is positional. */
export function deleteRow(rows: TableRows, index: number): TableRows {
  const src = normalizeTable(rows);
  if (src.length <= 1) return src;
  if (index < 0 || index >= src.length) return src;
  const next = clone(src);
  next.splice(index, 1);
  return next;
}

/** Duplicate row `index`. New row copies every cell value and lands
 *  immediately AFTER the source. Refuses when `index` is out of range. */
export function duplicateRow(rows: TableRows, index: number): TableRows {
  const src = normalizeTable(rows);
  if (index < 0 || index >= src.length) return src;
  const copy = src[index].slice();
  const next = clone(src);
  next.splice(index + 1, 0, copy);
  return next;
}

/** Move row `from` to `to`. Row 0 remains the header positionally — this
 *  op happily promotes another row to header or demotes the header away,
 *  which is exactly what the menu's "Move up/down" is expected to do. */
export function moveRow(rows: TableRows, from: number, to: number): TableRows {
  const src = normalizeTable(rows);
  if (from < 0 || from >= src.length) return src;
  const dst = Math.max(0, Math.min(to, src.length - 1));
  if (dst === from) return src;
  const next = clone(src);
  const [row] = next.splice(from, 1);
  next.splice(dst, 0, row);
  return next;
}

/** Empty every cell in row `index`. Dimensions unchanged. */
export function clearRow(rows: TableRows, index: number): TableRows {
  const src = normalizeTable(rows);
  if (index < 0 || index >= src.length) return src;
  const w = width(src);
  return src.map((r, i) => (i === index ? new Array(w).fill("") : r.slice()));
}

/** Empty every cell in column `index`. Dimensions unchanged. */
export function clearColumn(rows: TableRows, index: number): TableRows {
  const src = normalizeTable(rows);
  const w = width(src);
  if (index < 0 || index >= w) return src;
  return src.map((r) => {
    const next = r.slice();
    next[index] = "";
    return next;
  });
}
