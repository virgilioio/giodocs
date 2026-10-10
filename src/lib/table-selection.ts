/* Cell selection in a simple table (the "table" block): one rectangle,
 * Notion's way. A selected row or column is the full-width or full-height
 * rectangle; `kind` remembers which, so handles light up and later
 * extensions keep the full span.
 *
 * Everything here is pure: TableBlock owns the state and the keys, these
 * functions decide what a selection covers and what an action does to the
 * rows. Structural ops (insert, delete, move) live in table-ops.ts. */

import { tokenizeInline, type InlineToken } from "./inline-tokens";
import { mentionView } from "./inline-markdown";
import type { TableRows } from "./table-ops";

export type CellPos = { r: number; c: number };
export type TableSel = {
  kind: "cells" | "row" | "col";
  anchor: CellPos;
  focus: CellPos;
};
export type CellRect = { r0: number; c0: number; r1: number; c1: number };

export const cellSel = (r: number, c: number): TableSel => ({
  kind: "cells",
  anchor: { r, c },
  focus: { r, c },
});
export const rowSel = (r: number, nCols: number): TableSel => ({
  kind: "row",
  anchor: { r, c: 0 },
  focus: { r, c: Math.max(0, nCols - 1) },
});
export const colSel = (c: number, nRows: number): TableSel => ({
  kind: "col",
  anchor: { r: 0, c },
  focus: { r: Math.max(0, nRows - 1), c },
});
export const rangeSel = (anchor: CellPos, focus: CellPos): TableSel => ({
  kind: "cells",
  anchor: { ...anchor },
  focus: { ...focus },
});

/** The rectangle a selection covers, clamped to the table. Rows and
 *  columns always span the whole table, even after it grows. */
export function selRect(sel: TableSel, nRows: number, nCols: number): CellRect {
  const lastR = Math.max(0, nRows - 1);
  const lastC = Math.max(0, nCols - 1);
  const cl = (n: number, max: number) => Math.max(0, Math.min(max, n));
  let r0 = cl(Math.min(sel.anchor.r, sel.focus.r), lastR);
  let r1 = cl(Math.max(sel.anchor.r, sel.focus.r), lastR);
  let c0 = cl(Math.min(sel.anchor.c, sel.focus.c), lastC);
  let c1 = cl(Math.max(sel.anchor.c, sel.focus.c), lastC);
  if (sel.kind === "row") {
    c0 = 0;
    c1 = lastC;
  }
  if (sel.kind === "col") {
    r0 = 0;
    r1 = lastR;
  }
  return { r0, c0, r1, c1 };
}

export const inRect = (q: CellRect, r: number, c: number) =>
  r >= q.r0 && r <= q.r1 && c >= q.c0 && c <= q.c1;

export const rectSize = (q: CellRect) => (q.r1 - q.r0 + 1) * (q.c1 - q.c0 + 1);

/** One selected cell, moved by an arrow key (clamped at the edges). */
export function moveSel(sel: TableSel, dr: number, dc: number, nRows: number, nCols: number): TableSel {
  const r = Math.max(0, Math.min(nRows - 1, sel.focus.r + dr));
  const c = Math.max(0, Math.min(nCols - 1, sel.focus.c + dc));
  return cellSel(r, c);
}

/** Shift+arrow: the far corner moves, the anchor stays. A row selection
 *  grows by rows and stays full width; a column selection by columns. */
export function extendSel(sel: TableSel, dr: number, dc: number, nRows: number, nCols: number): TableSel {
  if (sel.kind === "row" && dc !== 0) return sel;
  if (sel.kind === "col" && dr !== 0) return sel;
  const r = Math.max(0, Math.min(nRows - 1, sel.focus.r + dr));
  const c = Math.max(0, Math.min(nCols - 1, sel.focus.c + dc));
  return { ...sel, focus: { r, c } };
}

/** Backspace / Delete: every selected cell emptied. */
export function clearRect(rows: TableRows, q: CellRect): TableRows {
  return rows.map((row, r) => row.map((cell, c) => (inRect(q, r, c) ? "" : cell)));
}

/* ── Formatting across cells ─────────────────────────────────────────── */

export type CellMark = "bold" | "italic" | "underline" | "strike" | "highlight" | "code";

export const MARK_DELIMS: Record<CellMark, [string, string]> = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  underline: ["<u>", "</u>"],
  strike: ["~~", "~~"],
  highlight: ["==", "=="],
  code: ["`", "`"],
};

type Layer = { kind: CellMark; start: number; end: number; open: number; close: number };

/** The marks that wrap a cell's WHOLE content, outermost first, read with
 *  the same tokenizer that renders it (so "**x**" is bold, not italic). */
function wholeLayers(src: string): { layers: Layer[]; inner: [number, number] } {
  const layers: Layer[] = [];
  let tokens: InlineToken[] = tokenizeInline(src);
  let inner: [number, number] = [0, src.length];
  for (;;) {
    if (tokens.length !== 1) break;
    const t = tokens[0];
    if (t.sourceStart !== inner[0] || t.sourceEnd !== inner[1]) break;
    if (t.kind === "code") {
      layers.push({ kind: "code", start: t.sourceStart, end: t.sourceEnd, open: 1, close: 1 });
      inner = [t.sourceStart + 1, t.sourceEnd - 1];
      break;
    }
    if (
      t.kind === "bold" ||
      t.kind === "italic" ||
      t.kind === "underline" ||
      t.kind === "strike" ||
      t.kind === "highlight"
    ) {
      layers.push({ kind: t.kind, start: t.sourceStart, end: t.sourceEnd, open: t.openLen, close: t.closeLen });
      inner = [t.sourceStart + t.openLen, t.sourceEnd - t.closeLen];
      tokens = t.children;
      continue;
    }
    break;
  }
  return { layers, inner };
}

export function cellHasMark(src: string, mark: CellMark): boolean {
  return wholeLayers(src).layers.some((l) => l.kind === mark);
}

function addMark(src: string, mark: CellMark): string {
  const { layers, inner } = wholeLayers(src);
  // Code takes no marks inside it: wrap outside instead.
  const [a, b] = layers.some((l) => l.kind === "code") ? [0, src.length] : inner;
  const [open, close] = MARK_DELIMS[mark];
  return src.slice(0, a) + open + src.slice(a, b) + close + src.slice(b);
}

function removeMark(src: string, mark: CellMark): string {
  const l = wholeLayers(src).layers.find((x) => x.kind === mark);
  if (!l) return src;
  return (
    src.slice(0, l.start) +
    src.slice(l.start + l.open, l.end - l.close) +
    src.slice(l.end)
  );
}

/** ⌘B, ⌘I, ⌘U, ⌘⇧S… on a selection: if every filled cell already has the
 *  mark it comes off everywhere, otherwise every filled cell gets it.
 *  Empty cells stay empty. */
export function toggleMarkInRect(rows: TableRows, q: CellRect, mark: CellMark): TableRows {
  const filled: string[] = [];
  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (inRect(q, r, c) && cell.trim()) filled.push(cell);
    }),
  );
  if (filled.length === 0) return rows;
  const remove = filled.every((s) => cellHasMark(s, mark));
  return rows.map((row, r) =>
    row.map((cell, c) => {
      if (!inRect(q, r, c) || !cell.trim()) return cell;
      if (remove) return removeMark(cell, mark);
      return cellHasMark(cell, mark) ? cell : addMark(cell, mark);
    }),
  );
}

/* ── Copy and paste ──────────────────────────────────────────────────── */

/** What a cell reads as outside Gio: no markdown, mentions as names. */
export function cellPlainText(src: string): string {
  const walk = (ts: InlineToken[]): string =>
    ts
      .map((t) => {
        switch (t.kind) {
          case "text":
          case "code":
            return t.text;
          case "emoji":
            return `:${t.name}:`;
          case "mention":
            return mentionView(t).text;
          default:
            return walk(t.children);
        }
      })
      .join("");
  return walk(tokenizeInline(src));
}

/** The selected block of sources (markdown kept), row by row. */
export function rectSources(rows: TableRows, q: CellRect): string[][] {
  const out: string[][] = [];
  for (let r = q.r0; r <= q.r1; r++) out.push(rows[r].slice(q.c0, q.c1 + 1));
  return out;
}

/** Tab-separated text, the format Sheets and Excel paste as cells. */
export function toTsv(grid: string[][]): string {
  const clean = (s: string) => cellPlainText(s).replace(/[\t\r\n]+/g, " ");
  return grid.map((row) => row.map(clean).join("\t")).join("\n");
}

/** Plain text → a grid: lines are rows, tabs are cells. A trailing newline
 *  (what spreadsheets put at the end) adds no row. */
export function parseTsv(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((l) => l.split("\t"));
}

/** The MIME type Gio puts next to the plain text, so cells pasted back into
 *  a Gio table keep their formatting. */
export const CELLS_MIME = "application/x-gio-cells";

export function readCellsJson(raw: string): string[][] | null {
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v) || v.length === 0) return null;
    if (!v.every((row) => Array.isArray(row) && row.every((c) => typeof c === "string"))) return null;
    return v as string[][];
  } catch {
    return null;
  }
}

/** Paste a grid with its top-left at `at`, growing the table with empty
 *  rows and columns as needed. One value pasted over a larger selection
 *  fills every selected cell, as spreadsheets do. Returns the new rows and
 *  the rectangle that was written. */
export function pasteGrid(
  rows: TableRows,
  at: CellPos,
  grid: string[][],
  fill?: CellRect,
): { rows: TableRows; rect: CellRect } {
  const width = Math.max(1, ...grid.map((g) => g.length));
  if (fill && grid.length === 1 && width === 1) {
    const v = grid[0][0] ?? "";
    return {
      rows: rows.map((row, r) => row.map((cell, c) => (inRect(fill, r, c) ? v : cell))),
      rect: fill,
    };
  }
  const nCols = Math.max(rows[0]?.length ?? 0, at.c + width);
  const nRows = Math.max(rows.length, at.r + grid.length);
  const next: TableRows = [];
  for (let r = 0; r < nRows; r++) {
    const src = rows[r] ?? [];
    const row: string[] = [];
    for (let c = 0; c < nCols; c++) row.push(src[c] ?? "");
    next.push(row);
  }
  grid.forEach((g, i) =>
    g.forEach((v, j) => {
      next[at.r + i][at.c + j] = v;
    }),
  );
  return {
    rows: next,
    rect: { r0: at.r, c0: at.c, r1: at.r + grid.length - 1, c1: at.c + width - 1 },
  };
}
