/* Search results' words (2026-11-13): which parts of a title or a matching
 * line to highlight for what was typed, and the excerpt of a long line
 * around the first match. The database decides what matches
 * (search_workspace: each typed word as the start of a word, or another
 * form of it); this only marks where, the same way. Pure. */

const WORD = /[\p{L}\p{N}]+/gu;

/** The words typed, as search_tsquery reads them: letters and digits, a
 *  lone letter only when it's all there is, at most ten. */
export function queryWords(q: string): string[] {
  const all = (q.toLowerCase().match(WORD) ?? []).filter(Boolean);
  const long = all.filter((w) => w.length > 1);
  return (long.length ? long : all).slice(0, 10);
}

const SUFFIXES = ["ings", "ing", "edly", "ed", "ies", "es", "s", "ly", "er", "ers"];

/** The start a word in the text must have to count as this typed word: the
 *  word itself, or its root when it ends like an English form
 *  ("interviews" → "interview", "planning" → "plann"). */
export function rootOf(word: string): string {
  for (const s of SUFFIXES) {
    if (word.length - s.length >= 3 && word.endsWith(s)) return word.slice(0, -s.length);
  }
  return word;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Where the typed words appear in `text`: whole words that start with a
 *  typed word or its root. Sorted, not overlapping. */
export function matchRanges(text: string, q: string): Array<[number, number]> {
  const roots = queryWords(q).map((w) => fold(rootOf(w)));
  if (!roots.length) return [];
  const out: Array<[number, number]> = [];
  for (const m of text.matchAll(WORD)) {
    const w = fold(m[0]);
    if (roots.some((r) => w.startsWith(r))) out.push([m.index!, m.index! + m[0].length]);
  }
  return out;
}

/** A long line cut to about `max` characters around its first match. */
export function excerpt(text: string, q: string, max = 140): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const first = matchRanges(t, q)[0];
  if (!first) return `${t.slice(0, max).trimEnd()}…`;
  let from = Math.max(0, first[0] - Math.floor(max / 3));
  // Start at a word.
  if (from > 0) {
    const space = t.lastIndexOf(" ", from);
    from = space > 0 && first[0] - space < max / 2 ? space + 1 : from;
  }
  const to = Math.min(t.length, from + max);
  return `${from > 0 ? "…" : ""}${t.slice(from, to).trim()}${to < t.length ? "…" : ""}`;
}

/** `text` split into plain and highlighted parts. */
export function highlightParts(text: string, q: string): Array<{ text: string; hit: boolean }> {
  const ranges = matchRanges(text, q);
  if (!ranges.length) return [{ text, hit: false }];
  const out: Array<{ text: string; hit: boolean }> = [];
  let at = 0;
  for (const [a, b] of ranges) {
    if (a > at) out.push({ text: text.slice(at, a), hit: false });
    out.push({ text: text.slice(a, b), hit: true });
    at = b;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}
