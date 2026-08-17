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

/** A scheme, a www. prefix, or something.tld — see the module comment. */
const URLISH = /^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|www\.|[^\s/?#]+\.[a-z]{2,})/i;

export function isBareUrl(pasted: string): boolean {
  const t = pasted.trim();
  if (!t) return false;
  if (/\s/.test(t)) return false; // internal whitespace or a newline
  if (!URLISH.test(t)) return false;
  return safeUrl(t) !== null;
}

export function linkPaste(
  src: string,
  start: number,
  end: number,
  pasted: string,
): { text: string; caret: number } | null {
  if (start === end) return null; // collapsed caret — normal paste
  const a = Math.max(0, Math.min(start, end));
  const b = Math.min(src.length, Math.max(start, end));
  if (a === b) return null;
  const label = src.slice(a, b);
  if (label.includes("](")) return null; // already a link — never nest
  if (!isBareUrl(pasted)) return null;
  const url = safeUrl(pasted);
  if (!url) return null;
  const insert = `[${label}](${url})`;
  return {
    text: src.slice(0, a) + insert + src.slice(b),
    caret: a + insert.length,
  };
}
