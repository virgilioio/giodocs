/* Pure block-list operations.
 *
 * ONE implementation, called from BOTH the top-level `EditableBody` and the
 * per-column `ColumnStack`. Every op takes a `Blk[]` list plus a target id
 * and returns `{ next, focus? }`. The caller applies `next` through whatever
 * commit / undo path it owns, and honours `focus` through its own focus-
 * request mechanism. No side effects here — never focus DOM, never touch
 * clipboards, never mutate arguments.
 *
 * Factories (newBlock / newColumnsBlock) and the markdown shortcut list
 * live here too, so both call sites cannot drift on defaults.
 */

import { nanoid } from "nanoid";
import { parseMarkdown } from "@/lib/markdown-import";
import { htmlToMarkdown, htmlToBlocks } from "@/lib/html-to-markdown";
import { emptyColumns } from "@/lib/columns";
import { clampIndent } from "@/lib/blocks";
import type { CalloutColor } from "@/lib/callout-color";

/** Block types that participate in list indentation. Headings, quotes,
 *  callouts, code, tables, dividers, columns, captions, and toggles do
 *  NOT — indenting them has no meaning in this flat model. */
const INDENTABLE = new Set<BlockType>(["bullet", "numbered", "todo", "text"]);

export type BlockType =
  | "text"
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "numbered"
  | "todo"
  | "toggle"
  | "quote"
  | "caption"
  | "callout"
  | "divider"
  | "code"
  | "table"
  | "sheet"
  | "columns"
  | "image"
  | "imagerow"
  | "file"
  | "page";

/** Optional heading level for `toggle` blocks. Absent = plain toggle (today's
 *  rendering). Present = the summary renders at the given heading level, and
 *  export serialises the summary at that depth. */
export type ToggleLevel = "text" | "h1" | "h2" | "h3";

export type Blk = {
  id: string;
  type: BlockType;
  text?: string;
  body?: string;
  checked?: boolean;
  open?: boolean;
  icon?: string;
  rows?: string[][];
  /** Only meaningful when type === "table". One entry per column; absent or
   *  short means every remaining column is "left". Kept in sync with the
   *  column count by the pure ops in src/lib/table-ops.ts — a stale align
   *  is the silent-corruption failure mode for the block. */
  align?: ("left" | "center" | "right")[];
  /** Meaningful for `table` and `columns`, with DIFFERENT units:
   *
   *  table — PIXELS, one per column. Absent means auto/equal; present means
   *  the table renders with an explicit <colgroup> and its own width is the
   *  sum of these entries, so it may exceed its container. Clamp [56, 1200].
   *  Kept in sync with the column count by the widths-splicing ops in
   *  src/lib/table-ops.ts — a stale widths array offsets every column past
   *  the mismatch, exactly like a stale align.
   *
   *  columns — FRACTIONAL WEIGHTS, one per column, absent meaning equal.
   *  `fr` tracks absorb the grid gap, so no percentage arithmetic drifts.
   *  A columns block always fills the text column, so a drag redistributes
   *  between the two adjacent columns only, preserving their sum. Min
   *  0.35fr. Lockstep with the column count is enforced by
   *  normalizeColumnWidths in src/lib/column-widths.ts. */
  widths?: number[];
  /** Only meaningful when type === "table". Header-ness is a BLOCK
   *  attribute, never row/column data: no cell has to move when either
   *  is toggled, and every structural op in table-ops stays untouched.
   *  `headerRow` absent === true (row 0 is the header, today's
   *  behaviour); `headerCol` absent === false. */
  headerRow?: boolean;
  headerCol?: boolean;
  language?: string;
  /** Only meaningful when type === "toggle". Absent = today's plain toggle. */
  level?: ToggleLevel;
  /** Only meaningful when type === "callout". Absent === "neutral" (today's
   *  appearance). Stored as a semantic name; the token mapping lives in
   *  src/lib/callout-color.ts so a theme swap survives. */
  color?: CalloutColor;
  /** Only meaningful when type === "columns". Never nested. */
  cols?: Blk[][];
  /** Only meaningful when type === "callout". When absent, the callout
   *  renders from `text` (today's behaviour). When present, `text` is
   *  ignored and the callout renders `children` inside the tinted box —
   *  it is a container of ordinary blocks. Lazy-migrated by the drop
   *  layer the first time a block lands inside an untouched callout.
   *  Invariant, enforced in reorder.ts: no callout in callout, no
   *  columns in callout. */
  children?: Blk[];
  /** Only meaningful when type === "sheet". The RAW grid — a leading '='
   *  means formula and the computed value is never stored. Shape and the
   *  `cw` lockstep are enforced by the pure ops in src/lib/sheet-model.ts. */
  cells?: unknown[][];
  /** Only meaningful when type === "sheet". Column widths in PIXELS, one
   *  per column, always in lockstep with the column count. */
  cw?: number[];
  /** Only meaningful when type === "sheet". Pins the first data row. */
  freeze?: boolean;
  /** Only meaningful when type === "sheet". Block width / height in px,
   *  honoured only at page scope (chunk 7). */
  bw?: number;
  bh?: number;
  /** Flat outline level for list-like blocks (bullet, numbered, todo, text).
   *  Absent or 0 means top level. NOT a tree — blocks stay in a flat array;
   *  this is only a rendering / label / export hint. Clamped 0..6 with the
   *  parent+1 rule. */
  indent?: number;
  /** Only meaningful when type === "page". The REFERENCE to the child page —
   *  '' until one is chosen. Never the child's title, emoji or status:
   *  placement lives on the child (pages.parent_id), so the child can move or
   *  be deleted without this block knowing, and a stored copy would lie. */
  pid?: string;
};

export type FocusReq = { id: string; caret?: number | "start" | "end" };
export type OpResult = { next: Blk[]; focus?: FocusReq };

/* ────────── Factories ────────── */

/** THE one sheet grid seed: 10 rows × 5 columns, the first column wider
 *  because it is almost always labels. Exported because type CONVERSION
 *  (the slash menu turning a text block into a sheet) must seed the same
 *  grid — without it the block reached the model with no `cells` and
 *  normalizeSheet padded it up to its 2×1 floors. */
export function newSheetGrid(): { cells: null[][]; cw: number[] } {
  return {
    cells: Array.from({ length: 10 }, () => [null, null, null, null, null]),
    cw: [160, 120, 120, 120, 120],
  };
}

export function newBlock(type: BlockType = "text", text = ""): Blk {
  const base: Blk = { id: nanoid(10), type, text };
  if (type === "todo") base.checked = false;
  if (type === "toggle") base.open = false;
  if (type === "callout") base.icon = "💡";
  if (type === "table") base.rows = [["", "", ""], ["", "", ""]];
  if (type === "sheet") Object.assign(base, newSheetGrid() as Record<string, unknown>);

  // Image blocks start empty: no path, centred, full column width. The
  // stored value is always a STORAGE PATH, never a signed URL.
  if (type === "image")
    Object.assign(base, { align: "center", w: 100 } as Record<string, unknown>);
  if (type === "imagerow")
    Object.assign(base, { cols: 2, paths: [null, null] } as Record<string, unknown>);
  return base;
}

export function newColumnsBlock(n: number): Blk {
  const cols = emptyColumns(n, () => newBlock("text")) as Blk[][];
  return { id: nanoid(10), type: "columns", text: "", cols };
}

/* ────────── Markdown shortcuts ────────── */

/** ONE source of truth for typing-shortcut → block-type conversion. Used
 *  by both the top-level and column input handlers so they cannot drift.
 *  `# ` → h1, `## ` → h2, `### `+ → h3 (we have exactly three levels; any
 *  deeper input lands on the deepest we have). `!> ` opens a callout. */
export const MARKDOWN_SHORTCUTS: ReadonlyArray<{ pat: RegExp; type: BlockType }> = [
  { pat: /^#{3,} /, type: "h3" },
  { pat: /^## /, type: "h2" },
  { pat: /^# /, type: "h1" },
  { pat: /^- /, type: "bullet" },
  { pat: /^\* /, type: "bullet" },
  { pat: /^\+ /, type: "bullet" },
  { pat: /^\d+\. /, type: "numbered" },
  { pat: /^\[\] /, type: "todo" },
  { pat: /^\[ \] /, type: "todo" },
  { pat: /^> /, type: "quote" },
  { pat: /^``` /, type: "code" },
  { pat: /^--- /, type: "divider" },
  { pat: /^!> /, type: "callout" },
];

/**
 * Prefix-match a typing shortcut and keep the remainder as block text.
 *
 * Fires only when `caret` sits immediately after the matched prefix — the
 * signal that the user JUST typed the trigger. This is what distinguishes
 * "typed `1. `" (convert) from "pasted `1. Something`" or editing earlier
 * in an existing line (leave alone). The caret argument is required for
 * that reason; it comes from `readCaret` at the block-layer call site.
 *
 * Divider is block-replacing and destructive of trailing text, so it only
 * fires when the remainder is empty. Code fence keeps the remainder as
 * the code block's initial content.
 */
export function tryMarkdownShortcut(
  list: Blk[],
  id: string,
  val: string,
  caret: number,
): OpResult | null {
  const idx = list.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  const cur = list[idx];
  if (cur.type !== "text") return null;
  for (const m of MARKDOWN_SHORTCUTS) {
    const mm = m.pat.exec(val);
    if (!mm) continue;
    const prefixLen = mm[0].length;
    // Caret guard: only fire when the caret is right after the prefix.
    // "typed the trigger" ≠ "arrived by paste" ≠ "editing later in line".
    if (caret !== prefixLen) return null;
    const remainder = val.slice(prefixLen);
    if (m.type === "divider") {
      // Divider is non-editable and would destroy the trailing text; only
      // convert when nothing follows. Spawn a fresh text block after so
      // the caret has somewhere to land.
      if (remainder !== "") return null;
      const nb: Blk = { ...cur, type: "divider", text: "" };
      const spawn = newBlock("text");
      const next = list.slice();
      next[idx] = nb;
      next.splice(idx + 1, 0, spawn);
      return { next, focus: { id: spawn.id, caret: "start" } };
    }
    // Code keeps the remainder as its content; every other type does too —
    // the user typed a prefix then continued into the payload.
    const nb: Blk = { ...cur, type: m.type, text: remainder };
    if (m.type === "todo") nb.checked = false;
    if (m.type === "callout" && !nb.icon) nb.icon = "💡";
    const next = list.map((b, i) => (i === idx ? nb : b));
    return { next, focus: { id, caret: "start" } };
  }
  return null;
}

/* ────────── Structural ops ────────── */

export function splitBlock(
  list: Blk[],
  id: string,
  caret: number,
): OpResult | null {
  const idx = list.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  const cur = list[idx];
  const t = cur.text ?? "";
  const left = t.slice(0, caret);
  const right = t.slice(caret);
  const inheritTypes: BlockType[] = ["bullet", "numbered", "todo"];
  const newType: BlockType = inheritTypes.includes(cur.type) ? cur.type : "text";
  const spawn = newBlock(newType, right);
  const next = [...list];
  next[idx] = { ...cur, text: left };
  next.splice(idx + 1, 0, spawn);
  return { next, focus: { id: spawn.id, caret: "start" } };
}

export function mergeIntoPrev(list: Blk[], id: string): OpResult | null {
  const idx = list.findIndex((b) => b.id === id);
  if (idx <= 0) return null;
  const prev = list[idx - 1];
  const cur = list[idx];
  const prevText = prev.text ?? "";
  const merged = prevText + (cur.text ?? "");
  const next = [...list];
  next[idx - 1] = { ...prev, text: merged };
  next.splice(idx, 1);
  return { next, focus: { id: prev.id, caret: prevText.length } };
}

export function convertToText(list: Blk[], id: string): OpResult | null {
  const idx = list.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  const cur = list[idx];
  const next = [...list];
  next[idx] = { ...cur, type: "text", checked: undefined, open: undefined };
  return { next, focus: { id, caret: "start" } };
}

/** Remove `id` from `list`. If `ensureOne` is true (column scope) and this
 *  would drain the list, reset to a single fresh empty text block instead
 *  (columns must always keep at least one block). At page scope the same
 *  reset-to-one behaviour applies — the spec matches. */
export function removeBlock(
  list: Blk[],
  id: string,
  _opts: { ensureOne?: boolean } = {},
): OpResult | null {
  const idx = list.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  if (list.length === 1) {
    const only = newBlock("text");
    return { next: [only], focus: { id: only.id, caret: "start" } };
  }
  const next = list.filter((b) => b.id !== id);
  const before = list[Math.max(0, idx - 1)];
  return { next, focus: before ? { id: before.id, caret: "end" } : undefined };
}

export function insertAfter(
  list: Blk[],
  id: string,
  type: BlockType = "text",
): OpResult | null {
  const idx = list.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  const spawn = newBlock(type);
  const next = [...list];
  next.splice(idx + 1, 0, spawn);
  return { next, focus: { id: spawn.id, caret: "start" } };
}

export function duplicateBlock(list: Blk[], id: string): OpResult | null {
  const idx = list.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  const copy: Blk = { ...list[idx], id: nanoid(10) };
  const next = [...list];
  next.splice(idx + 1, 0, copy);
  return { next, focus: { id: copy.id, caret: "end" } };
}

/* ────────── Paste ────────── */

/** Turn a clipboard payload into a run of blocks, or null if the caller
 *  should let the browser paste it natively as ordinary text.
 *
 *  Structured Notion HTML with `column_list` goes through htmlToBlocks
 *  (which builds real columns). Otherwise: convert HTML → markdown and
 *  hand it to parseMarkdown. Plain single-line text with no markdown
 *  markers returns null so undo history stays intact. */
export function parsePasteToBlocks(
  htmlSrc: string,
  plainSrc: string,
): { blocks: Blk[]; consumeEvent: boolean } | null {
  if (htmlSrc) {
    const structured = htmlToBlocks(htmlSrc) as Blk[] | null;
    if (structured && structured.length > 0) {
      return { blocks: structured, consumeEvent: true };
    }
  }
  const raw = htmlSrc ? htmlToMarkdown(htmlSrc) : plainSrc;
  if (!raw) return null;
  const hasNewline = /\r|\n/.test(raw);
  const hasMdMarker = /(^|\n)\s*(#{1,6} |[-*+] |\d+\. |> |```|---|\*\*\*|\|)/.test(raw);
  if (!htmlSrc && !hasNewline && !hasMdMarker) return null;
  const parsed = parseMarkdown(raw) as unknown as Blk[];
  if (parsed.length === 0) return null;
  return { blocks: parsed, consumeEvent: true };
}

/** Splice `parsed` into `list` at the caret inside block `id`. If the
 *  target block is non-empty, its text splits: prefix stays on the block,
 *  suffix becomes a new trailing text block. Focus moves to the LAST
 *  pasted block, caret at end. */
export function splicePasteAtCaret(
  list: Blk[],
  id: string,
  caret: number,
  parsed: Blk[],
): OpResult | null {
  if (parsed.length === 0) return null;
  const idx = list.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  const cur = list[idx];
  const full = cur.text ?? "";
  const before = full.slice(0, caret);
  const after = full.slice(caret);
  const head = list.slice(0, idx);
  const tail = list.slice(idx + 1);
  let next: Blk[];
  if (full === "") {
    next = [...head, ...parsed, ...tail];
  } else {
    const currentPatched: Blk = { ...cur, text: before };
    const trailing: Blk[] = after
      ? [{ id: nanoid(10), type: "text", text: after } as Blk]
      : [];
    next = [...head, currentPatched, ...parsed, ...trailing, ...tail];
  }
  const focusId = parsed[parsed.length - 1].id;
  return { next: reclampIndents(next), focus: { id: focusId, caret: "end" } };
}

/* ────────── Indent ops ────────── */

/**
 * Walk `list` and enforce the parent+1 rule on every block's indent.
 * A block of a non-indentable type is treated as indent 0 for the
 * purpose of the NEXT block's clamp. Returns a fresh array only when a
 * change was required; otherwise returns a shallow copy of the input.
 */
export function reclampIndents(list: readonly Blk[]): Blk[] {
  const out: Blk[] = list.slice();
  let prev = 0;
  for (let i = 0; i < out.length; i++) {
    const b = out[i];
    const canIndent = INDENTABLE.has(b.type);
    const current = typeof b.indent === "number" && b.indent > 0 ? b.indent : 0;
    const target = canIndent ? clampIndent(prev, current) : 0;
    if (target !== current || (!canIndent && b.indent !== undefined)) {
      const patched: Blk = { ...b };
      if (target === 0) delete patched.indent;
      else patched.indent = target;
      out[i] = patched;
    }
    prev = target;
  }
  return out;
}

/**
 * Change block `id`'s indent by `delta` (+1 or -1). Clamped by the
 * previous block's indent (parent+1 rule) and by [0, 6]. Following
 * blocks are re-clamped so no orphan level survives.
 */
export function indentBlock(
  list: Blk[],
  id: string,
  delta: 1 | -1,
): OpResult | null {
  const idx = list.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  const b = list[idx];
  if (!INDENTABLE.has(b.type)) return null;
  const prevIndent = idx > 0 ? (list[idx - 1].indent ?? 0) : 0;
  const cur = b.indent ?? 0;
  const target = clampIndent(prevIndent, cur + delta);
  if (target === cur) return null;
  const next = list.slice();
  const patched: Blk = { ...b };
  if (target === 0) delete patched.indent;
  else patched.indent = target;
  next[idx] = patched;
  return { next: reclampIndents(next) };
}

