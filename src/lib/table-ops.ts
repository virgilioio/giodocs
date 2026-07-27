/**
 * Pure operations on a table block's `rows: string[][]` value.
 *
 * Invariant enforced by every export in this file: the returned matrix is
 * RECTANGULAR (every row has the same length) and has at least one row and
 * one column. A ragged matrix would misalign the rendered table AND break
 * the Markdown export (the pipe-table separator row is sized from the
 * header — mismatched widths mean it stops parsing as a table).
 *
 * All functions:
 *  - return a NEW top-level array and NEW row arrays; the input is never
 *    mutated;
 *  - clamp destructive operations (deleteRow / deleteColumn) to keep the
 *    minimums — callers see the input matrix back and should surface a
 *    hint in the UI rather than let the table disappear.
 *
 * The header is POSITIONAL — row 0 is always the header — so
 * `deleteRow(rows, 0)` promotes what was row 1 into the header slot with
 * no metadata to migrate. That is exactly what we want.
 */
export type TableRows = string[][];

function clone(rows: TableRows): TableRows {
  return rows.map((r) => r.slice());
}

/** Force `rows` to a rectangle with at least 1×1 shape. Pads short rows
 *  with "", truncates long ones. A well-formed table is returned
 *  structurally-equal but as a fresh array. */
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
