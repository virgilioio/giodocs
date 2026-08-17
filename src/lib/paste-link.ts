/* paste-link — pasting a URL over a text selection turns it into a link.
 *
 * Pure: no React, no DOM. The caller reads source-coordinate offsets with
 * readCaret and commits the returned text through whatever commit path the
 * block already uses.
 *
 * URL validity is delegated to safeUrl — there is deliberately no second
 * URL validator in this codebase. On top of safeUrl we require the paste to
 * LOOK like a URL (a scheme, a "www." prefix, or a dotted host), because
 * safeUrl accepts any non-empty non-javascript string and pasting the bare
 * word "Hello" over a selection must not silently produce [sel](Hello).
 *
 * Parens and trailing punctuation: the pasted text is used VERBATIM as the
 * href (after safeUrl trimming). A URL containing ")" therefore produces
 * markdown whose link target ends at that paren, and a trailing "." stays
 * inside the href. Chosen deliberately: rewriting or trimming the user's URL
 * is worse than round-tripping exactly what they pasted.
 */

import { safeUrl } from "./inline-markdown";
import { tokenizeInline, type InlineToken } from "./inline-tokens";

/** A scheme, a www. prefix, or something.tld — see the module comment. */
const URLISH = /^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|www\.|[^\s/?#]+\.[a-z]{2,})/i;

export function isBareUrl(pasted: string): boolean {
  const t = pasted.trim();
  if (!t) return false;
  if (/\s/.test(t)) return false; // internal whitespace or a newline
  if (!URLISH.test(t)) return false;
  return safeUrl(t) !== null;
}

/* ─── snapping ─────────────────────────────────────────────────────────
 * The offset map (ce-offsets) collapses a delimiter run to zero rendered
 * width, so the END of a rendered bold run maps to the token's sourceEnd
 * — i.e. PAST the closing `**`. Slicing a label from those raw bounds
 * swallows the delimiter and produces unbalanced markdown.
 *
 * The user's selection visually covers the run's TEXT; the delimiters are
 * invisible to them. So we snap INWARD: a start inside an opening
 * delimiter moves forward to innerStart, an end inside a closing
 * delimiter moves back to innerEnd. The wrapping delimiters stay balanced
 * around the new link — `**[label](url)**`, a link nested in bold, which
 * the grammar already supports. Applied recursively through children so
 * nested runs (bold inside highlight) snap through every level.
 */
function hasInner(
  t: InlineToken,
): t is Extract<InlineToken, { children: InlineToken[] }> {
  return (
    t.kind === "bold" ||
    t.kind === "italic" ||
    t.kind === "strike" ||
    t.kind === "highlight" ||
    t.kind === "underline" ||
    t.kind === "link"
  );
}

function snapStart(tokens: InlineToken[], pos: number): number {
  for (const t of tokens) {
    if (pos < t.sourceStart || pos >= t.sourceEnd) continue;
    if (t.kind === "code") {
      const innerStart = t.sourceStart + 1;
      return Math.max(pos, innerStart);
    }
    if (!hasInner(t)) continue;
    const innerStart = t.sourceStart + t.openLen;
    return snapStart(t.children, Math.max(pos, innerStart));
  }
  return pos;
}

function snapEnd(tokens: InlineToken[], pos: number): number {
  for (const t of tokens) {
    if (pos <= t.sourceStart || pos > t.sourceEnd) continue;
    if (t.kind === "code") {
      const innerEnd = t.sourceEnd - 1;
      return Math.min(pos, innerEnd);
    }
    if (!hasInner(t)) continue;
    const innerEnd = t.sourceEnd - t.closeLen;
    return snapEnd(t.children, Math.min(pos, innerEnd));
  }
  return pos;
}


/* Walks the token tree looking for a link with this url whose source range
 * covers [from, to). */
function findLink(
  tokens: InlineToken[],
  url: string,
  from: number,
  to: number,
): boolean {
  for (const t of tokens) {
    if (
      t.kind === "link" &&
      t.url === url &&
      t.sourceStart <= from &&
      t.sourceEnd >= to
    ) {
      return true;
    }
    if (hasInner(t) && findLink(t.children, url, from, to)) return true;
  }
  return false;
}

export function linkPaste(
  src: string,
  start: number,
  end: number,
  pasted: string,
): { text: string; caret: number } | null {
  if (start === end) return null; // collapsed caret — normal paste
  let a = Math.max(0, Math.min(start, end));
  let b = Math.min(src.length, Math.max(start, end));
  if (a === b) return null;
  if (!isBareUrl(pasted)) return null;
  const url = safeUrl(pasted);
  if (!url) return null;
  // Already a link anywhere in the RAW selection — never nest. Checked
  // before snapping, since snapping could hide the "](" inside a link.
  if (src.slice(a, b).includes("](")) return null;

  const tokens = tokenizeInline(src);
  // NON-VACUITY: snapping disabled
  void tokens;
  if (a >= b) return null;

  const label = src.slice(a, b);

  const insert = `[${label}](${url})`;
  const text = src.slice(0, a) + insert + src.slice(b);

  /* Post-verify the splice: the candidate text must tokenize to a link
   * carrying this url over the inserted span. If it does not — any
   * remaining unbalanced-delimiter case, e.g. a selection deliberately
   * spanning a formatting boundary — we decline and the caller falls
   * through to the native paste. A declined enhancement is fine;
   * committed garbage is not. */
  if (!findLink(tokenizeInline(text), url, a, a + insert.length)) return null;

  return { text, caret: a + insert.length };
}

