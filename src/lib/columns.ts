/**
 * Columns block — pure helpers.
 *
 * A `columns` block is:
 *   { id: string; type: 'columns'; cols: Blk[][] }
 *
 * INVARIANT — columns MUST NEVER nest. `public.page_search_text` recurses
 * exactly one level into `cols` for search indexing; a columns block
 * placed inside a column would silently drop from ⌘K. Guards for this
 * live here (validate / stripNestedColumns) and at every entry point:
 * slash menu, turn-into, paste, importer.
 */

import type { Block } from "./types";

export const MIN_COLS = 2;
export const MAX_COLS = 6;

export function isColumnsBlock(b: unknown): b is Block & { cols: Block[][] } {
  return (
    !!b &&
    typeof b === "object" &&
    (b as { type?: string }).type === "columns" &&
    Array.isArray((b as { cols?: unknown }).cols)
  );
}

/** Every entry is an array of blocks; length within [2,6]; no nested columns. */
export function validateColumnsCols(cols: unknown): boolean {
  if (!Array.isArray(cols)) return false;
  if (cols.length < MIN_COLS || cols.length > MAX_COLS) return false;
  for (const col of cols) {
    if (!Array.isArray(col)) return false;
    for (const b of col) {
      if (isColumnsBlock(b)) return false;
    }
  }
  return true;
}

/** Defensive: if any nested columns block sneaks in, flatten it into the
 * surrounding column so no content is lost. Also drops non-block entries. */
export function stripNestedColumns(cols: unknown): Block[][] {
  if (!Array.isArray(cols)) return [];
  const out: Block[][] = [];
  for (const col of cols) {
    if (!Array.isArray(col)) continue;
    const flat: Block[] = [];
    for (const b of col) {
      if (!b || typeof b !== "object") continue;
      if (isColumnsBlock(b)) {
        // Flatten one level: pull every inner block up into this column.
        for (const inner of b.cols) {
          if (Array.isArray(inner)) {
            for (const x of inner) {
              if (x && typeof x === "object" && !isColumnsBlock(x)) flat.push(x as Block);
            }
          }
        }
      } else {
        flat.push(b as Block);
      }
    }
    out.push(flat);
  }
  return out;
}

/** Build N empty columns each seeded with one text block via the caller's
 * factory (avoids importing the editor's `newBlock`, which owns id gen). */
export function emptyColumns<T>(n: number, makeText: () => T): T[][] {
  const clamped = Math.max(MIN_COLS, Math.min(MAX_COLS, n));
  return Array.from({ length: clamped }, () => [makeText()]);
}

/** True when EVERY column of a columns block is "empty": at most one block,
 *  and that block is a text block with no text (and no image/table payload).
 *  This is the condition under which Backspace dissolves the whole block —
 *  the escape hatch for a `/col3` you did not mean. */
export function isColumnsBlockEmpty(cols: unknown): boolean {
  if (!Array.isArray(cols) || cols.length === 0) return false;
  for (const col of cols) {
    if (!Array.isArray(col)) return false;
    if (col.length > 1) return false;
    if (col.length === 0) continue;
    const b = col[0] as { type?: string; text?: string };
    if (!b || b.type !== "text") return false;
    if ((b.text ?? "") !== "") return false;
  }
  return true;
}
