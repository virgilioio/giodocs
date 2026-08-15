/* Block-level inline formatting.
 *
 * The range-level primitives in toggle-wrap.ts format a SELECTION inside one
 * focused block. This module formats WHOLE blocks, which is what a marquee
 * block-selection needs: after a marquee there is no focused editable and no
 * DOM Range, so there is nothing for toggleWrap to anchor to.
 *
 * Pure: no React, no DOM. Operates on the `text` field only.
 */

export type MarkPair = readonly [open: string, close: string];

export const MARK_BOLD: MarkPair = ["**", "**"];
export const MARK_ITALIC: MarkPair = ["*", "*"];
export const MARK_UNDERLINE: MarkPair = ["<u>", "</u>"];
export const MARK_CODE: MarkPair = ["`", "`"];
export const MARK_HIGHLIGHT: MarkPair = ["==", "=="];
export const MARK_STRIKE: MarkPair = ["~~", "~~"];

/* Block types whose `text` is prose and therefore formattable.
 * `code` is deliberately EXCLUDED: its text is literal, and markdown marks
 * inside it are content, not formatting. */
const FORMATTABLE = new Set([
  "text",
  "h1",
  "h2",
  "h3",
  "bullet",
  "numbered",
  "todo",
  "quote",
  "caption",
  "callout",
  "toggle",
]);

export function canFormatBlockType(type: string): boolean {
  return FORMATTABLE.has(type);
}

/* Bold must be considered before italic, otherwise `**x**` reads as two
 * italic runs. Callers that iterate pairs get the same ordering guarantee by
 * always comparing the LONGER delimiter first, which is what these helpers do
 * implicitly: they only ever inspect the pair they were given, and `**`
 * matching is length-exact. isWholeWrapped for italic therefore has to reject
 * a bold run explicitly. */
function isBoldish(t: string): boolean {
  return t.startsWith("**") && t.endsWith("**") && t.length >= 4;
}

export function isWholeWrapped(text: string, pair: MarkPair): boolean {
  const [open, close] = pair;
  const t = text.trim();
  if (t.length < open.length + close.length) return false;
  if (!t.startsWith(open) || !t.endsWith(close)) return false;
  // `*x*` inside `**x**`: an italic check must not claim a bold run.
  if (open === "*" && close === "*" && isBoldish(t)) return false;
  return true;
}

function stripAll(text: string, pair: MarkPair): string {
  const [open, close] = pair;
  let out = text;
  if (open === "*" && close === "*") {
    // Protect bold while stripping italic.
    const SENTINEL = "\u0000B\u0000";
    out = out.split("**").join(SENTINEL);
    out = out.split("*").join("");
    out = out.split(SENTINEL).join("**");
    return out;
  }
  out = out.split(open).join("");
  if (close !== open) out = out.split(close).join("");
  return out;
}

/* ⚠ DELIBERATE, DOCUMENTED LOSS.
 * wrapWhole FIRST removes every existing occurrence of the SAME pair inside
 * the text, THEN wraps the whole string. Naively wrapping `hello **world**`
 * would yield `**hello **world****`, which is ambiguous to the tokenizer and
 * renders wrong. Bolding everything makes an inner bold redundant — but
 * un-bolding afterwards will NOT restore the partial. That is accepted; do
 * not "fix" it later. */
export function wrapWhole(text: string, pair: MarkPair): string {
  const [open, close] = pair;
  const stripped = stripAll(text, pair);
  if (stripped.trim() === "") return stripped;
  const lead = stripped.slice(0, stripped.length - stripped.trimStart().length);
  const trail = stripped.slice(stripped.trimEnd().length);
  const core = stripped.trim();
  return `${lead}${open}${core}${close}${trail}`;
}

export function unwrapWhole(text: string, pair: MarkPair): string {
  const [open, close] = pair;
  if (!isWholeWrapped(text, pair)) return text;
  const lead = text.slice(0, text.length - text.trimStart().length);
  const trail = text.slice(text.trimEnd().length);
  const core = text.trim();
  return `${lead}${core.slice(open.length, core.length - close.length)}${trail}`;
}

/* ⚠ MIXED-STATE RULE, same shape as the sheet toolbar's markDecision:
 * across a multi-block selection, if EVERY eligible block is already wholly
 * wrapped → unwrap them all; otherwise → wrap them all. Never toggle
 * per-block, which would scramble a mixed selection.
 *
 * Does NOT recurse into children[] or cols[]: a selected callout formats its
 * own text, not its children. */
export function blockMarkDecision<
  T extends { id: string; type: string; text?: string },
>(blocks: readonly T[], ids: ReadonlySet<string>, pair: MarkPair): "wrap" | "unwrap" | null {
  const eligible = blocks.filter(
    (b) => ids.has(b.id) && canFormatBlockType(b.type),
  );
  if (eligible.length === 0) return null;
  const all = eligible.every((b) => isWholeWrapped(b.text ?? "", pair));
  return all ? "unwrap" : "wrap";
}

export function applyMarkToBlocks<
  T extends { id: string; type: string; text?: string },
>(blocks: readonly T[], ids: ReadonlySet<string>, pair: MarkPair): T[] {
  const decision = blockMarkDecision(blocks, ids, pair);
  if (decision === null) return blocks as T[];
  return blocks.map((b) => {
    if (!ids.has(b.id) || !canFormatBlockType(b.type)) return b;
    const text = b.text ?? "";
    const next =
      decision === "unwrap" ? unwrapWhole(text, pair) : wrapWhole(text, pair);
    if (next === text) return b;
    return { ...b, text: next };
  });
}
