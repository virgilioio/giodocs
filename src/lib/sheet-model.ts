/**
 * The `sheet` block's data model. PURE — no React, no DOM, no rendering.
 *
 * Invariants every helper here upholds:
 *   1. `cells` is RECTANGULAR. A ragged grid misaligns every reference the
 *      engine resolves, so normalizeSheet pads rather than trusting input.
 *   2. `cw` (column widths, px) is ALWAYS in lockstep with the column count.
 *      A cw array out of step is silent corruption — the same failure mode
 *      as table widths — so every column-changing op splices cw in step.
 *   3. A cell stores the RAW value as typed (`v`). A leading '=' means
 *      formula. The computed value is NEVER stored: a cached result is how
 *      a sheet ends up showing a number that no longer follows from its
 *      inputs.
 *   4. bg/fg hold palette KEYS, never hexes — a hex would not theme and
 *      could outlive a palette change.
 *
 * Bounds are enforced HERE, not only in the UI: 100 rows, 26 columns.
 */

export type CellFormat = "text" | "num" | "cur" | "pct" | "date";
export type CellAlign = "left" | "center" | "right";

export type Cell = {
  /** RAW value exactly as typed. A leading '=' means formula. */
  v?: string | number;
  f?: CellFormat;
  /** Decimal places, 0–4. */
  d?: number;
  b?: boolean;
  i?: boolean;
  a?: CellAlign;
  /** Palette KEYS, never hexes. */
  bg?: string;
  fg?: string;
  /** Rule above — for totals rows. */
  rt?: boolean;
};

export type SheetBlock = {
  id: string;
  type: "sheet";
  cells: (Cell | null)[][];
  cw: number[];
  freeze?: boolean;
  bw?: number;
  bh?: number;
};

export const MAX_ROWS = 100;
export const MAX_COLS = 26;
export const MIN_ROWS = 2;
export const MIN_COLS = 1;

export const CW_MIN = 56;
export const CW_MAX = 1200;
export const CW_DEFAULT = 112;

function clampWidth(px: unknown): number {
  const n = typeof px === "number" && Number.isFinite(px) ? Math.round(px) : CW_DEFAULT;
  return Math.max(CW_MIN, Math.min(CW_MAX, n));
}

function clampRows(n: number): number {
  return Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.trunc(n) || MIN_ROWS));
}

function clampCols(n: number): number {
  return Math.max(MIN_COLS, Math.min(MAX_COLS, Math.trunc(n) || MIN_COLS));
}

/** A fresh grid of empty cells, clamped to the model bounds. */
export function newSheet(rows: number, cols: number): SheetBlock {
  const r = clampRows(rows);
  const c = clampCols(cols);
  return {
    id: "",
    type: "sheet",
    cells: Array.from({ length: r }, () => new Array<Cell | null>(c).fill(null)),
    cw: new Array(c).fill(CW_DEFAULT),
  };
}

function sanitizeCell(cell: unknown): Cell | null {
  if (!cell || typeof cell !== "object") return null;
  const c = cell as Record<string, unknown>;
  const out: Cell = {};
  if (typeof c.v === "string" || typeof c.v === "number") out.v = c.v;
  if (c.f === "text" || c.f === "num" || c.f === "cur" || c.f === "pct" || c.f === "date")
    out.f = c.f;
  if (typeof c.d === "number" && Number.isFinite(c.d))
    out.d = Math.max(0, Math.min(4, Math.trunc(c.d)));
  if (c.b === true) out.b = true;
  if (c.i === true) out.i = true;
  if (c.a === "left" || c.a === "center" || c.a === "right") out.a = c.a;
  if (typeof c.bg === "string" && c.bg) out.bg = c.bg;
  if (typeof c.fg === "string" && c.fg) out.fg = c.fg;
  if (c.rt === true) out.rt = true;
  return Object.keys(out).length ? out : null;
}

/** Force a rectangular, in-bounds grid with `cw` in lockstep. */
export function normalizeSheet(input: Partial<SheetBlock> | null | undefined): SheetBlock {
  const rawCells = Array.isArray(input?.cells) ? input!.cells : [];
  const rows = clampRows(rawCells.length || MIN_ROWS);
  const widest = rawCells.reduce<number>(
    (m, r) => Math.max(m, Array.isArray(r) ? r.length : 0),
    0,
  );
  const cols = clampCols(widest || MIN_COLS);

  const cells: (Cell | null)[][] = [];
  for (let r = 0; r < rows; r++) {
    const src = Array.isArray(rawCells[r]) ? (rawCells[r] as unknown[]) : [];
    const row: (Cell | null)[] = [];
    for (let c = 0; c < cols; c++) row.push(sanitizeCell(src[c]));
    cells.push(row);
  }

  const rawCw = Array.isArray(input?.cw) ? input!.cw : [];
  const cw: number[] = [];
  for (let c = 0; c < cols; c++) cw.push(clampWidth(rawCw[c]));

  const out: SheetBlock = {
    id: typeof input?.id === "string" ? input.id : "",
    type: "sheet",
    cells,
    cw,
  };
  if (input?.freeze === true) out.freeze = true;
  if (typeof input?.bw === "number" && Number.isFinite(input.bw)) out.bw = input.bw;
  if (typeof input?.bh === "number" && Number.isFinite(input.bh)) out.bh = input.bh;
  return out;
}

function shape(sheet: SheetBlock): { rows: number; cols: number } {
  return { rows: sheet.cells.length, cols: sheet.cells[0]?.length ?? 0 };
}

/** Insert an empty row at `at` (clamped). Refuses at MAX_ROWS. */
export function addRow(sheet: SheetBlock, at: number): SheetBlock {
  const s = normalizeSheet(sheet);
  const { rows, cols } = shape(s);
  if (rows >= MAX_ROWS) return s;
  const idx = Math.max(0, Math.min(at, rows));
  const cells = s.cells.map((r) => r.slice());
  cells.splice(idx, 0, new Array<Cell | null>(cols).fill(null));
  return { ...s, cells };
}

/** Remove row `at`. Refuses at the MIN_ROWS floor or out of range. */
export function deleteRow(sheet: SheetBlock, at: number): SheetBlock {
  const s = normalizeSheet(sheet);
  const { rows } = shape(s);
  if (rows <= MIN_ROWS) return s;
  if (at < 0 || at >= rows) return s;
  const cells = s.cells.map((r) => r.slice());
  cells.splice(at, 1);
  return { ...s, cells };
}

/** Insert an empty column at `at`, splicing `cw` in step. Refuses at MAX_COLS. */
export function addCol(sheet: SheetBlock, at: number, px: number = CW_DEFAULT): SheetBlock {
  const s = normalizeSheet(sheet);
  const { cols } = shape(s);
  if (cols >= MAX_COLS) return s;
  const idx = Math.max(0, Math.min(at, cols));
  const cells = s.cells.map((r) => {
    const next = r.slice();
    next.splice(idx, 0, null);
    return next;
  });
  const cw = s.cw.slice();
  cw.splice(idx, 0, clampWidth(px));
  return { ...s, cells, cw };
}

/** Remove column `at`, dropping its width. Refuses at the MIN_COLS floor. */
export function deleteCol(sheet: SheetBlock, at: number): SheetBlock {
  const s = normalizeSheet(sheet);
  const { cols } = shape(s);
  if (cols <= MIN_COLS) return s;
  if (at < 0 || at >= cols) return s;
  const cells = s.cells.map((r) => {
    const next = r.slice();
    next.splice(at, 1);
    return next;
  });
  const cw = s.cw.slice();
  cw.splice(at, 1);
  return { ...s, cells, cw };
}

/** Move row `from` to `to` (both clamped). */
export function moveRow(sheet: SheetBlock, from: number, to: number): SheetBlock {
  const s = normalizeSheet(sheet);
  const { rows } = shape(s);
  if (from < 0 || from >= rows) return s;
  const dst = Math.max(0, Math.min(to, rows - 1));
  if (dst === from) return s;
  const cells = s.cells.map((r) => r.slice());
  const [row] = cells.splice(from, 1);
  cells.splice(dst, 0, row);
  return { ...s, cells };
}

/** Move column `from` to `to`, carrying its width along. */
export function moveCol(sheet: SheetBlock, from: number, to: number): SheetBlock {
  const s = normalizeSheet(sheet);
  const { cols } = shape(s);
  if (from < 0 || from >= cols) return s;
  const dst = Math.max(0, Math.min(to, cols - 1));
  if (dst === from) return s;
  const cells = s.cells.map((r) => {
    const next = r.slice();
    const [cell] = next.splice(from, 1);
    next.splice(dst, 0, cell);
    return next;
  });
  const cw = s.cw.slice();
  const [w] = cw.splice(from, 1);
  cw.splice(dst, 0, w);
  return { ...s, cells, cw };
}

/** Set column width `index` to `px`, clamped. Out-of-range is a no-op. */
export function setColWidth(sheet: SheetBlock, index: number, px: number): SheetBlock {
  const s = normalizeSheet(sheet);
  if (index < 0 || index >= s.cw.length) return s;
  const cw = s.cw.slice();
  cw[index] = clampWidth(px);
  return { ...s, cw };
}

/** Merge a partial cell patch at (r, c). `null` clears the cell. */
export function setCell(
  sheet: SheetBlock,
  r: number,
  c: number,
  patch: Partial<Cell> | null,
): SheetBlock {
  const s = normalizeSheet(sheet);
  const { rows, cols } = shape(s);
  if (r < 0 || r >= rows || c < 0 || c >= cols) return s;
  const cells = s.cells.map((row) => row.slice());
  cells[r][c] = patch === null ? null : sanitizeCell({ ...(cells[r][c] ?? {}), ...patch });
  return { ...s, cells };
}
