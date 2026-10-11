/* ce-offsets — the contenteditable ↔ markdown offset translation layer.
 *
 * Phase 1 of the WYSIWYG migration. Nothing renders yet; this file is
 * pure logic that will sit BENEATH the existing offset-based operations
 * (Enter-split, Backspace-merge, arrow probe, toggleWrap, slash trigger,
 * markdown shortcuts) when the block editor moves from <textarea> to
 * contenteditable. Every existing caller keeps its (text, start, end)
 * shape — start/end become RENDERED offsets and this layer converts.
 *
 * The grammar comes from exactly one place: tokenizeInline in
 * inline-tokens.ts. inline-markdown.tsx (the renderer) consumes the
 * same tokens, so this layer and what the user sees on screen cannot
 * drift by construction.
 */

import {
  EMOJI_ATTR,
  MENTION_ATTR,
  tokenizeInline,
  type InlineOpts,
  type InlineToken,
} from "./inline-tokens";

/* Custom emoji and @mention chips are ATOMS: each is one rendered
 * character (ATOM in renderedText), whatever text it holds inside (a
 * hidden shortcode, a person's name). One character, not zero, so the
 * caret before an atom and the caret after it are different positions:
 * Backspace after an emoji removes it, and typing after one lands after
 * it (2026-10-11; with zero width the two sides were the same offset and
 * the caret could fall into the atom, where it vanished). Every DOM
 * traversal in this file counts an atom as one and never looks inside. */
export const ATOM = "\uFFFC";

function isEmojiEl(n: Node | null): n is Element {
  return (
    !!n &&
    n.nodeType === 1 &&
    typeof (n as Element).hasAttribute === "function" &&
    ((n as Element).hasAttribute(EMOJI_ATTR) || (n as Element).hasAttribute(MENTION_ATTR))
  );
}

function emojiAncestor(node: Node, root: Node): Element | null {
  let p: Node | null = node;
  let found: Element | null = null;
  while (p && p !== root) {
    if (isEmojiEl(p)) found = p;
    p = p.parentNode;
  }
  return found;
}

/** Rendered (caret-visible) text length of a node. */
function visibleLen(node: Node): number {
  if (node.nodeType === 3) return (node.nodeValue ?? "").length;
  if (node.nodeType !== 1) return 0;
  if (isEmojiEl(node)) return 1;
  let n = 0;
  for (const c of Array.from(node.childNodes)) n += visibleLen(c);
  return n;
}

/** Rendered length of everything in `root` that precedes `stop`. */
function visibleLenBefore(root: Node, stop: Node): number {
  let acc = 0;
  let done = false;
  const rec = (n: Node) => {
    if (done) return;
    if (n === stop) {
      done = true;
      return;
    }
    if (n.nodeType === 3) {
      acc += (n.nodeValue ?? "").length;
      return;
    }
    if (n.nodeType !== 1) return;
    if (isEmojiEl(n)) {
      if (n.contains(stop)) {
        done = true;
        return;
      }
      acc += 1;
      return;
    }
    for (const c of Array.from(n.childNodes)) {
      rec(c);
      if (done) return;
    }
  };
  for (const c of Array.from(root.childNodes)) {
    rec(c);
    if (done) break;
  }
  return acc;
}

export type OffsetMap = {
  toSource: (rendered: number) => number;
  toRendered: (source: number) => number;
  renderedText: string;
};

/* Walks the token tree and produces two monotonic arrays:
 *   s2r[s]  — for s in 0..sourceLen, the rendered offset that a caret
 *             at source position s corresponds to. Positions strictly
 *             inside a delimiter or URL clamp to the nearest reachable
 *             boundary rather than throwing.
 *   r2s[r]  — for r in 0..renderedLen, the source offset that produced
 *             the r-th rendered character (or source.length at the end
 *             sentinel).
 * Both arrays are strictly non-decreasing, which makes clamping cheap.
 */
function scan(source: string, opts?: InlineOpts): {
  renderedText: string;
  s2r: number[];
  r2s: number[];
} {
  const s2r = new Array<number>(source.length + 1);
  const r2s: number[] = [];
  const rendered: string[] = [];
  let renderedLen = 0;

  const fillClamp = (from: number, to: number, mapped: number) => {
    for (let s = from; s <= to; s++) s2r[s] = mapped;
  };

  function walk(tokens: InlineToken[]): void {
    for (const t of tokens) {
      // The source position AT the start of this token maps to the
      // current rendered position (nothing before it has emitted yet).
      s2r[t.sourceStart] = renderedLen;

      if (t.kind === "text") {
        if (t.sourceEnd - t.sourceStart === 2) {
          // Escape "\X" — 2 source chars → 1 rendered char.
          // Middle position (between \ and X) clamps to the rendered
          // slot the escaped char will occupy.
          s2r[t.sourceStart + 1] = renderedLen;
          rendered.push(t.text);
          r2s.push(t.sourceStart + 1);
          renderedLen += 1;
          s2r[t.sourceEnd] = renderedLen;
        } else {
          // Plain literal — 1 source ↔ 1 rendered.
          rendered.push(t.text);
          r2s.push(t.sourceStart);
          renderedLen += 1;
          s2r[t.sourceEnd] = renderedLen;
        }
        continue;
      }

      if (t.kind === "code") {
        const innerStart = t.sourceStart + 1;
        s2r[innerStart] = renderedLen; // just after the opening `
        for (let k = 0; k < t.text.length; k++) {
          rendered.push(t.text[k]);
          r2s.push(innerStart + k);
          renderedLen += 1;
          s2r[innerStart + k + 1] = renderedLen;
        }
        s2r[t.sourceEnd] = renderedLen; // after the closing `
        continue;
      }

      if (t.kind === "emoji" || t.kind === "mention") {
        // One rendered character (ATOM): before it is renderedLen, after
        // it renderedLen + 1. Source positions inside the token clamp to
        // its near edge, so the caret steps over it whole.
        fillClamp(t.sourceStart, t.sourceEnd - 1, renderedLen);
        rendered.push(ATOM);
        r2s.push(t.sourceStart);
        renderedLen += 1;
        s2r[t.sourceEnd] = renderedLen;
        continue;
      }

      // Container-shaped tokens (bold, italic, strike, highlight,
      // underline, link). All share the same offset shape: opening
      // delimiter of `openLen` source chars (unreachable, clamp to
      // renderedLen BEFORE children), then children, then closing
      // delimiter of `closeLen` source chars (unreachable, clamp to
      // renderedLen AFTER children). For a link the "closing delim"
      // is `](url)` — every position inside it, including inside the
      // URL, clamps to the end of the label's rendered range.
      const innerStart = t.sourceStart + t.openLen;
      const innerEnd = t.sourceEnd - t.closeLen;
      fillClamp(t.sourceStart + 1, innerStart, renderedLen);
      walk(t.children);
      fillClamp(innerEnd, t.sourceEnd, renderedLen);
    }
  }

  s2r[0] = 0;
  walk(tokenizeInline(source, opts));
  // Sentinel: rendered position == renderedLen ↔ source position == source.length.
  r2s.push(source.length);
  // Fill any positions that the walker didn't touch (e.g. an empty source).
  for (let s = 0; s <= source.length; s++) {
    if (s2r[s] === undefined) s2r[s] = renderedLen;
  }

  return { renderedText: rendered.join(""), s2r, r2s };
}

export function buildOffsetMap(source: string, opts?: InlineOpts): OffsetMap {
  const src = source ?? "";
  const { renderedText, s2r, r2s } = scan(src, opts);
  const srcLen = src.length;
  const rndLen = renderedText.length;

  return {
    renderedText,
    toSource(rendered: number): number {
      if (!isFinite(rendered)) return 0;
      if (rendered >= rndLen) return srcLen;
      if (rendered <= 0) return rndLen === 0 ? 0 : r2s[0];
      return r2s[rendered];
    },
    toRendered(source: number): number {
      if (!isFinite(source) || source <= 0) return 0;
      if (source >= srcLen) return rndLen;
      return s2r[source];
    },
  };
}

/* ------------------------- DOM caret helpers ------------------------- *
 * getCaretOffset / setCaretOffset work on a contenteditable element by
 * counting Text-node characters via a TreeWalker. They survive nested
 * inline elements (e.g. <strong><em>x</em></strong>) and setCaretOffset
 * clamps offsets past the end rather than throwing.
 *
 * DOM tests live in ce-offsets.dom.test.ts (happy-dom environment).
 */
export function getCaretOffset(
  el: HTMLElement,
): { start: number; end: number } | null {
  const win = el.ownerDocument?.defaultView;
  if (!win) return null;
  const sel = win.getSelection?.();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (
    !el.contains(range.startContainer) ||
    !el.contains(range.endContainer)
  ) {
    return null;
  }

  const countTo = (node: Node, offset: number): number => {
    let count = 0;
    const doc = el.ownerDocument;
    if (!doc) return 0;

    // A caret inside an atom counts as just before it.
    const inAtom = emojiAncestor(node, el);
    if (inAtom) return visibleLenBefore(el, inAtom);
    if (node.nodeType === 3 /* Text */) {
      return visibleLenBefore(el, node) + offset;
    }

    // Element node: everything before it, plus its first `offset` children.
    count = node === el ? 0 : visibleLenBefore(el, node);
    let idx = 0;
    for (const child of Array.from(node.childNodes)) {
      if (idx >= offset) break;
      count += visibleLen(child);
      idx += 1;
    }
    // If offset points past the last child of an element, keep walking
    // outward: the caret sits at the end of that element's text.
    return count;
  };

  const start = countTo(range.startContainer, range.startOffset);
  const end = countTo(range.endContainer, range.endOffset);
  return { start, end };
}

export function setCaretOffset(
  el: HTMLElement,
  start: number,
  end?: number,
): void {
  const doc = el.ownerDocument;
  const win = doc?.defaultView;
  if (!doc || !win) return;
  const total = visibleLen(el);
  const s = Math.max(0, Math.min(start | 0, total));
  const e = Math.max(s, Math.min((end ?? start) | 0, total));

  // Text nodes and atoms in document order. A caret next to an atom sits
  // in the neighbouring text when there is some, else in the atom's
  // parent just before or after it (never inside it).
  const pieces: Node[] = [];
  const collect = (n: Node) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === 3) pieces.push(c);
      else if (isEmojiEl(c)) pieces.push(c);
      else if (c.nodeType === 1) collect(c);
    }
  };
  collect(el);
  const beside = (atom: Node, after: boolean): { node: Node; offset: number } => {
    const parent = atom.parentNode ?? el;
    const i = Array.from(parent.childNodes).indexOf(atom as ChildNode);
    return { node: parent, offset: i + (after ? 1 : 0) };
  };
  const locate = (target: number): { node: Node; offset: number } => {
    let counted = 0;
    for (let i = 0; i < pieces.length; i++) {
      const cur = pieces[i];
      if (cur.nodeType === 3) {
        const len = (cur.nodeValue ?? "").length;
        if (counted + len >= target) return { node: cur, offset: target - counted };
        counted += len;
        continue;
      }
      if (counted === target) return beside(cur, false);
      counted += 1;
      if (counted === target && pieces[i + 1]?.nodeType !== 3) return beside(cur, true);
    }
    const last = pieces[pieces.length - 1];
    if (!last) return { node: el, offset: 0 };
    if (last.nodeType === 3) return { node: last, offset: (last.nodeValue ?? "").length };
    return beside(last, true);
  };

  const range = doc.createRange();
  const a = locate(s);
  const b = s === e ? a : locate(e);
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  const sel = win.getSelection?.();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

/* ─── The ONLY sanctioned rendered ↔ source conversion helpers ────────
 *
 * Phase-2 rule: every call site that reads or writes a caret on a
 * contenteditable block goes through THESE. No component and no
 * key-handler is allowed to combine getCaretOffset with
 * buildOffsetMap by hand — a missed conversion is the corruption
 * bug the offset map exists to prevent, and one uncovered site is
 * enough to produce it. If a new place needs the mapping, add a
 * helper here rather than inlining it.
 *
 *   readCaretSource(el, source)
 *     → { start, end } in SOURCE (markdown) coordinates, or null when
 *       there's no selection inside `el`.
 *
 *   writeCaretSource(el, source, start, end?)
 *     → places the caret / selection at the given SOURCE offsets.
 *       Clamps rather than throws when offsets exceed the source or
 *       the rendered content is shorter (delimiters, escapes).
 */
export function readCaretSource(
  el: HTMLElement,
  source: string,
  opts?: InlineOpts,
): { start: number; end: number } | null {
  const rendered = getCaretOffset(el);
  if (!rendered) return null;
  const map = buildOffsetMap(source, opts);
  // The very start of the block is source 0 even when the first word is
  // formatted ("**Owner:** …" maps rendered 0 to just inside the "**").
  // Every "caret at start" decision — Backspace merge, ← / ↑ out of the
  // block, Enter above, ⌘A twice — depends on seeing 0 here.
  return {
    start: rendered.start <= 0 ? 0 : map.toSource(rendered.start),
    end: rendered.end <= 0 ? 0 : map.toSource(rendered.end),
  };
}

export function writeCaretSource(
  el: HTMLElement,
  source: string,
  start: number,
  end?: number,
  opts?: InlineOpts,
): void {
  const map = buildOffsetMap(source, opts);
  const rStart = map.toRendered(start);
  const rEnd = end === undefined ? undefined : map.toRendered(end);
  setCaretOffset(el, rStart, rEnd);
}

/** Keeps the caret out of atoms. The browser can put a collapsed caret
 *  inside an emoji's hidden shortcode or a chip's text (Home, arrows, a
 *  click), where it is invisible and typing goes nowhere. This moves it
 *  beside the atom: after it when the caret was moving forward (it came
 *  from before the atom), else before it. Returns the rendered offset the
 *  caret ends at, for the next call's `prev`. */
export function liftCaretOutOfAtom(el: HTMLElement, prev: number | null): number | null {
  const win = el.ownerDocument?.defaultView;
  const sel = win?.getSelection?.();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.startContainer)) return null;
  const atom = emojiAncestor(r.startContainer, el);
  if (!atom || !r.collapsed) return getCaretOffset(el)?.start ?? null;
  const before = visibleLenBefore(el, atom);
  const target = prev !== null && prev <= before ? before + 1 : before;
  setCaretOffset(el, target);
  return target;
}
