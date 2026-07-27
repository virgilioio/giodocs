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
  | "columns";

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
  language?: string;
  /** Only meaningful when type === "columns". Never nested. */
  cols?: Blk[][];
};

export type FocusReq = { id: string; caret?: number | "start" | "end" };
export type OpResult = { next: Blk[]; focus?: FocusReq };

/* ────────── Factories ────────── */

export function newBlock(type: BlockType = "text", text = ""): Blk {
  const base: Blk = { id: nanoid(10), type, text };
  if (type === "todo") base.checked = false;
  if (type === "toggle") base.open = false;
  if (type === "callout") base.icon = "💡";
  if (type === "table") base.rows = [["", "", ""], ["", "", ""]];
  return base;
}

export function newColumnsBlock(n: number): Blk {
  const cols = emptyColumns(n, () => newBlock("text")) as Blk[][];
  return { id: nanoid(10), type: "columns", text: "", cols };
}

/* ────────── Markdown shortcuts ────────── */

/** ONE source of truth for typing-shortcut → block-type conversion. Used
 *  by both the top-level and column input handlers so they cannot drift.
 *  `###`/`####` map to h2 because we have no h3/h4. `!> ` opens a callout
 *  (matches the export inverse for callouts). */
export const MARKDOWN_SHORTCUTS: ReadonlyArray<{ pat: RegExp; type: BlockType }> = [
  { pat: /^#### $/, type: "h2" },
  { pat: /^### $/, type: "h2" },
  { pat: /^## $/, type: "h2" },
  { pat: /^# $/, type: "h1" },
  { pat: /^- $/, type: "bullet" },
  { pat: /^\* $/, type: "bullet" },
  { pat: /^1\. $/, type: "numbered" },
  { pat: /^\[\] $/, type: "todo" },
  { pat: /^\[ \] $/, type: "todo" },
  { pat: /^> $/, type: "quote" },
  { pat: /^``` $/, type: "code" },
  { pat: /^!> $/, type: "callout" },
];

export function tryMarkdownShortcut(
  list: Blk[],
  id: string,
  val: string,
): OpResult | null {
  const idx = list.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  const cur = list[idx];
  if (cur.type !== "text") return null;
  for (const m of MARKDOWN_SHORTCUTS) {
    if (m.pat.test(val)) {
      const nb: Blk = { ...cur, type: m.type, text: "" };
      if (m.type === "todo") nb.checked = false;
      if (m.type === "callout" && !nb.icon) nb.icon = "💡";
      const next = list.map((b, i) => (i === idx ? nb : b));
      return { next, focus: { id, caret: "start" } };
    }
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
  return { next, focus: { id: focusId, caret: "end" } };
}
