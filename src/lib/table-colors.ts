/* Colours in a simple table: text and background, on a cell, a row or a
 * column. Stored by NAME from the callout palette (never a hex) and
 * resolved to tokens at render time, so a theme change can't strand them.
 *
 *   colors: { cells: { "r,c": {fg, bg} }, rows: { "r": {…} }, cols: { "c": {…} } }
 *
 * A cell's own colour wins over its row's, a row's over its column's, for
 * text and background separately. Structural ops carry colours with their
 * rows and columns (remapRows / remapCols, used by applyTableOp). */

import { CALLOUT_COLORS, calloutBg, type CalloutColor } from "./callout-color";

export type TableColorName = Exclude<CalloutColor, "neutral"> | "gray";
export const TABLE_COLOR_NAMES: readonly TableColorName[] = [
  "gray",
  "amber",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
];
export type CellColor = { fg?: TableColorName; bg?: TableColorName };
export type TableColors = {
  cells?: Record<string, CellColor>;
  rows?: Record<string, CellColor>;
  cols?: Record<string, CellColor>;
};

const LABEL: Record<TableColorName, string> = {
  gray: "Gray",
  amber: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
  red: "Red",
};
export const colorLabel = (n: TableColorName) => LABEL[n];

const FG: Record<TableColorName, string> = {
  gray: "var(--color-muted)",
  amber: "var(--color-amber)",
  yellow: "var(--color-yellowInk)",
  green: "var(--color-accent)",
  blue: "var(--color-blueInk)",
  purple: "var(--color-purple)",
  pink: "var(--color-pinkInk)",
  red: "var(--color-danger)",
};

export const fgToken = (n: TableColorName) => FG[n];
export const bgToken = (n: TableColorName) =>
  n === "gray" ? "var(--color-sunken)" : calloutBg(n as CalloutColor);

export function isTableColorName(v: unknown): v is TableColorName {
  return v === "gray" || (v !== "neutral" && (CALLOUT_COLORS as readonly string[]).includes(v as string));
}

function readColor(v: unknown): CellColor | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { fg?: unknown; bg?: unknown };
  const out: CellColor = {};
  if (isTableColorName(o.fg)) out.fg = o.fg;
  if (isTableColorName(o.bg)) out.bg = o.bg;
  return out.fg || out.bg ? out : null;
}

function readMap(v: unknown, ok: (key: string) => boolean): Record<string, CellColor> | undefined {
  if (!v || typeof v !== "object") return undefined;
  const out: Record<string, CellColor> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const c = readColor(raw);
    if (c && ok(k)) out[k] = c;
  }
  return Object.keys(out).length ? out : undefined;
}

const isIndex = (s: string, n: number) => /^\d+$/.test(s) && Number(s) < n;

/** Read stored colours defensively: unknown names and out-of-range keys
 *  are dropped. Nothing left → undefined (the block stores no colours). */
export function normalizeColors(v: unknown, nRows: number, nCols: number): TableColors | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as { cells?: unknown; rows?: unknown; cols?: unknown };
  const cells = readMap(o.cells, (k) => {
    const [r, c] = k.split(",");
    return k.split(",").length === 2 && isIndex(r, nRows) && isIndex(c, nCols);
  });
  const rows = readMap(o.rows, (k) => isIndex(k, nRows));
  const cols = readMap(o.cols, (k) => isIndex(k, nCols));
  if (!cells && !rows && !cols) return undefined;
  return { ...(cells ? { cells } : {}), ...(rows ? { rows } : {}), ...(cols ? { cols } : {}) };
}

/** The colour a cell shows: cell over row over column, per property. */
export function colorAt(colors: TableColors | undefined, r: number, c: number): CellColor {
  if (!colors) return {};
  const col = colors.cols?.[String(c)] ?? {};
  const row = colors.rows?.[String(r)] ?? {};
  const cell = colors.cells?.[`${r},${c}`] ?? {};
  return { fg: cell.fg ?? row.fg ?? col.fg, bg: cell.bg ?? row.bg ?? col.bg };
}

function tidy(colors: TableColors): TableColors | undefined {
  const out: TableColors = {};
  for (const key of ["cells", "rows", "cols"] as const) {
    const m = colors[key];
    if (!m) continue;
    const kept: Record<string, CellColor> = {};
    for (const [k, v] of Object.entries(m)) {
      const c: CellColor = {};
      if (v.fg) c.fg = v.fg;
      if (v.bg) c.bg = v.bg;
      if (c.fg || c.bg) kept[k] = c;
    }
    if (Object.keys(kept).length) out[key] = kept;
  }
  return Object.keys(out).length ? out : undefined;
}

export type ColorTarget =
  | { kind: "cells"; r0: number; c0: number; r1: number; c1: number }
  | { kind: "row"; r: number }
  | { kind: "col"; c: number };
/** A colour change: a name sets it, null removes it, absent leaves it. */
export type ColorPatch = { fg?: TableColorName | null; bg?: TableColorName | null };

function patched(cur: CellColor | undefined, p: ColorPatch): CellColor {
  const next: CellColor = { ...(cur ?? {}) };
  if (p.fg !== undefined) {
    if (p.fg) next.fg = p.fg;
    else delete next.fg;
  }
  if (p.bg !== undefined) {
    if (p.bg) next.bg = p.bg;
    else delete next.bg;
  }
  return next;
}

/** Colour a rectangle of cells, a row or a column. Colouring a row or
 *  column lifts the same property off its cells, so the new colour shows
 *  everywhere in it. */
export function setColor(colors: TableColors | undefined, t: ColorTarget, p: ColorPatch): TableColors | undefined {
  const cells = { ...(colors?.cells ?? {}) };
  const rows = { ...(colors?.rows ?? {}) };
  const cols = { ...(colors?.cols ?? {}) };
  const lift = (k: string) => {
    const lifted: ColorPatch = {};
    if (p.fg !== undefined) lifted.fg = null;
    if (p.bg !== undefined) lifted.bg = null;
    cells[k] = patched(cells[k], lifted);
  };
  if (t.kind === "cells") {
    for (let r = t.r0; r <= t.r1; r++)
      for (let c = t.c0; c <= t.c1; c++) cells[`${r},${c}`] = patched(cells[`${r},${c}`], p);
  } else if (t.kind === "row") {
    rows[String(t.r)] = patched(rows[String(t.r)], p);
    for (const k of Object.keys(cells)) if (k.split(",")[0] === String(t.r)) lift(k);
  } else {
    cols[String(t.c)] = patched(cols[String(t.c)], p);
    for (const k of Object.keys(cells)) if (k.split(",")[1] === String(t.c)) lift(k);
  }
  return tidy({ cells, rows, cols });
}

/* ── Following structural ops ─────────────────────────────────────────── */

/** `map(old)` gives a row's new index, or null when it was deleted.
 *  `copy` duplicates: [from, to] copies row `from`'s colours (after the
 *  remap) onto row `to`. */
export function remapRows(
  colors: TableColors | undefined,
  map: (r: number) => number | null,
  copy?: [number, number],
): TableColors | undefined {
  if (!colors) return undefined;
  const cells: Record<string, CellColor> = {};
  for (const [k, v] of Object.entries(colors.cells ?? {})) {
    const [r, c] = k.split(",").map(Number);
    const nr = map(r);
    if (nr != null) cells[`${nr},${c}`] = v;
  }
  const rows: Record<string, CellColor> = {};
  for (const [k, v] of Object.entries(colors.rows ?? {})) {
    const nr = map(Number(k));
    if (nr != null) rows[String(nr)] = v;
  }
  if (copy) {
    const [from, to] = copy;
    if (rows[String(from)]) rows[String(to)] = { ...rows[String(from)] };
    for (const [k, v] of Object.entries(cells)) {
      const [r, c] = k.split(",").map(Number);
      if (r === from) cells[`${to},${c}`] = { ...v };
    }
  }
  return tidy({ cells, rows, cols: colors.cols });
}

export function remapCols(
  colors: TableColors | undefined,
  map: (c: number) => number | null,
  copy?: [number, number],
): TableColors | undefined {
  if (!colors) return undefined;
  const cells: Record<string, CellColor> = {};
  for (const [k, v] of Object.entries(colors.cells ?? {})) {
    const [r, c] = k.split(",").map(Number);
    const nc = map(c);
    if (nc != null) cells[`${r},${nc}`] = v;
  }
  const cols: Record<string, CellColor> = {};
  for (const [k, v] of Object.entries(colors.cols ?? {})) {
    const nc = map(Number(k));
    if (nc != null) cols[String(nc)] = v;
  }
  if (copy) {
    const [from, to] = copy;
    if (cols[String(from)]) cols[String(to)] = { ...cols[String(from)] };
    for (const [k, v] of Object.entries(cells)) {
      const [r, c] = k.split(",").map(Number);
      if (c === from) cells[`${r},${to}`] = { ...v };
    }
  }
  return tidy({ cells, rows: colors.rows, cols });
}

/** Index maps for the four structural moves. */
export const insertMap = (at: number) => (i: number) => (i >= at ? i + 1 : i);
export const deleteMap = (at: number) => (i: number) => (i === at ? null : i > at ? i - 1 : i);
export const moveMap = (from: number, to: number) => (i: number) => {
  if (i === from) return to;
  if (from < to && i > from && i <= to) return i - 1;
  if (from > to && i >= to && i < from) return i + 1;
  return i;
};
