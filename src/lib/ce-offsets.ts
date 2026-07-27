/* ce-offsets — the contenteditable ↔ markdown offset translation layer.
 *
 * Phase 1 of the WYSIWYG migration. Nothing renders yet; this file is
 * pure logic that will sit BENEATH the existing offset-based operations
 * (Enter-split, Backspace-merge, arrow probe, toggleWrap, slash trigger,
 * markdown shortcuts) when the block editor moves from <textarea> to
 * contenteditable. Every existing caller keeps its (text, start, end)
 * shape — start/end become RENDERED offsets and this layer converts.
 *
 * The tokenizer is intentionally aligned with the grammar of
 * inline-markdown.tsx (renderInline / inlineToHtml). See the ROUND-TRIP
 * and RENDERED-TEXT tests in ce-offsets.test.ts, which assert that
 * `renderedText` equals the visible text produced by inlineToHtml with
 * tags stripped — if that renderer's grammar changes, this file's
 * tests fail loudly instead of drifting silently.
 */

import { safeUrl } from "./inline-markdown";

const ESC_PUNCT = /[\\*_`~<>\[\]()]/;

export type OffsetMap = {
  toSource: (rendered: number) => number;
  toRendered: (source: number) => number;
  renderedText: string;
};

/* ------------------------------ scanner ------------------------------ *
 * Walks `source` and produces two monotonic arrays:
 *   s2r[s]  — for s in 0..sourceLen, the rendered offset that a caret
 *             at source position s corresponds to. Positions strictly
 *             inside a delimiter or URL clamp to the nearest reachable
 *             boundary rather than throwing.
 *   r2s[r]  — for r in 0..renderedLen, the source offset that produced
 *             the r-th rendered character (or the source position AT
 *             renderedLen after everything is consumed).
 * Both arrays are strictly non-decreasing, which makes clamping cheap.
 */
function scan(source: string): {
  renderedText: string;
  s2r: number[];
  r2s: number[];
} {
  const s2r = new Array<number>(source.length + 1);
  const r2s: number[] = [];
  const rendered: string[] = [];
  let renderedLen = 0;

  // Walk a slice [from, to) of `source`. The caller sets s2r[from] before
  // entering; walk() sets s2r[from+1..to] and pushes into `rendered`.
  function walk(from: number, to: number): void {
    let i = from;
    while (i < to) {
      const c = source[i];

      // Escape: \X  where X ∈ ESC_PUNCT. Two source chars → one rendered
      // char (X). The rendered offset associated with both source i and
      // source i+1 is the rendered position BEFORE X is emitted.
      if (c === "\\" && i + 1 < to && ESC_PUNCT.test(source[i + 1])) {
        // s2r[i] is already set by the caller (or a prior iteration).
        s2r[i + 1] = renderedLen; // middle position clamps to X's rendered pos
        rendered.push(source[i + 1]);
        r2s.push(i + 1); // the rendered char came from the escaped char
        renderedLen += 1;
        s2r[i + 2] = renderedLen;
        i += 2;
        continue;
      }

      // Code span `…`  — inner text is literal, delimiters are unreachable.
      if (c === "`") {
        const end = source.indexOf("`", i + 1);
        if (end > i && end < to) {
          // Opening ` is unreachable: s2r[i] already = renderedLen (before
          // inner). Mark s2r[i+1] as inner-start = same renderedLen.
          s2r[i + 1] = renderedLen;
          // Emit inner chars as literal 1:1.
          for (let k = i + 1; k < end; k++) {
            rendered.push(source[k]);
            r2s.push(k);
            renderedLen += 1;
            s2r[k + 1] = renderedLen;
          }
          // Closing ` — unreachable, clamp to renderedLen (end of inner).
          s2r[end + 1] = renderedLen;
          i = end + 1;
          continue;
        }
      }

      // Bold: **…**
      if (c === "*" && source[i + 1] === "*") {
        const end = source.indexOf("**", i + 2);
        if (end > i + 1 && end + 1 < to + 0 /* end+2 <= source.length */) {
          if (end + 2 <= to) {
            s2r[i + 1] = renderedLen; // inside opening **
            s2r[i + 2] = renderedLen; // start of inner
            walk(i + 2, end);
            // renderedLen has advanced; s2r[end] was set by walk's final step.
            s2r[end + 1] = renderedLen; // between the two closing *
            s2r[end + 2] = renderedLen;
            i = end + 2;
            continue;
          }
        }
      }

      // Strike: ~~…~~
      if (c === "~" && source[i + 1] === "~") {
        const end = source.indexOf("~~", i + 2);
        if (end > i + 1 && end + 2 <= to) {
          s2r[i + 1] = renderedLen;
          s2r[i + 2] = renderedLen;
          walk(i + 2, end);
          s2r[end + 1] = renderedLen;
          s2r[end + 2] = renderedLen;
          i = end + 2;
          continue;
        }
      }

      // Highlight: ==…==
      if (c === "=" && source[i + 1] === "=") {
        const end = source.indexOf("==", i + 2);
        if (end > i + 1 && end + 2 <= to) {
          s2r[i + 1] = renderedLen;
          s2r[i + 2] = renderedLen;
          walk(i + 2, end);
          s2r[end + 1] = renderedLen;
          s2r[end + 2] = renderedLen;
          i = end + 2;
          continue;
        }
      }

      // Italic: *…*   — bails out if it hits ** (that's a bold token).
      if (c === "*") {
        let j = i + 1;
        while (j < to) {
          if (source[j] === "\\") {
            j += 2;
            continue;
          }
          if (source[j] === "*") {
            if (source[j + 1] === "*") {
              j = -1;
              break;
            }
            break;
          }
          j++;
        }
        if (j > i + 1 && j < to && source[j] === "*") {
          s2r[i + 1] = renderedLen;
          walk(i + 1, j);
          s2r[j + 1] = renderedLen;
          i = j + 1;
          continue;
        }
      }

      // Underline: <u>…</u>
      if (c === "<" && source.slice(i, i + 3).toLowerCase() === "<u>") {
        const lower = source.toLowerCase();
        const end = lower.indexOf("</u>", i + 3);
        if (end > i && end + 4 <= to) {
          s2r[i + 1] = renderedLen;
          s2r[i + 2] = renderedLen;
          s2r[i + 3] = renderedLen;
          walk(i + 3, end);
          s2r[end + 1] = renderedLen;
          s2r[end + 2] = renderedLen;
          s2r[end + 3] = renderedLen;
          s2r[end + 4] = renderedLen;
          i = end + 4;
          continue;
        }
      }

      // Link: [label](url)
      if (c === "[") {
        const rb = source.indexOf("]", i + 1);
        if (rb > i && rb < to && source[rb + 1] === "(") {
          const rp = source.indexOf(")", rb + 2);
          if (rp > rb && rp < to) {
            const url = safeUrl(source.slice(rb + 2, rp));
            if (url) {
              // '[' delim
              s2r[i + 1] = renderedLen;
              // label chars are reachable
              walk(i + 1, rb);
              const labelEnd = renderedLen; // rendered position at end of label
              // ']' '(' url ')'  — all unreachable, clamp to labelEnd.
              for (let k = rb; k <= rp; k++) s2r[k + 1] = labelEnd;
              i = rp + 1;
              continue;
            }
          }
        }
      }

      // Literal char.
      rendered.push(c);
      r2s.push(i);
      renderedLen += 1;
      s2r[i + 1] = renderedLen;
      i += 1;
    }
  }

  s2r[0] = 0;
  walk(0, source.length);
  // r2s at renderedLen — end sentinel; source.length is the natural target.
  r2s.push(source.length);

  return { renderedText: rendered.join(""), s2r, r2s };
}

export function buildOffsetMap(source: string): OffsetMap {
  const src = source ?? "";
  const { renderedText, s2r, r2s } = scan(src);
  const srcLen = src.length;
  const rndLen = renderedText.length;

  return {
    renderedText,
    toSource(rendered: number): number {
      if (!isFinite(rendered) || rendered <= 0) return 0;
      if (rendered >= rndLen) return srcLen;
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
 * These are tested behind a DOM-only guard in the accompanying spec.
 * If the vitest environment has no jsdom/happy-dom, the caret tests are
 * skipped — see the note in ce-offsets.test.ts.
 */
export function getCaretOffset(
  el: HTMLElement,
): { start: number; end: number } | null {
  const win = el.ownerDocument?.defaultView;
  if (!win) return null;
  const sel = win.getSelection?.();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  // Only measure if the selection is inside `el`.
  if (
    !el.contains(range.startContainer) ||
    !el.contains(range.endContainer)
  ) {
    return null;
  }

  const countTo = (node: Node, offset: number): number => {
    // If `node` is an element, the DOM offset is a child index — the
    // characters to the left are those in text descendants of the first
    // `offset` children.
    let count = 0;
    const doc = el.ownerDocument;
    if (!doc) return 0;

    if (node.nodeType === 3 /* Text */) {
      // count all text before `node`, then add `offset` characters.
      const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let cur = walker.nextNode();
      while (cur && cur !== node) {
        count += (cur.nodeValue ?? "").length;
        cur = walker.nextNode();
      }
      return count + offset;
    }

    // Element node: sum text length of the first `offset` children.
    let idx = 0;
    for (const child of Array.from(node.childNodes)) {
      if (idx >= offset) break;
      if (child.nodeType === 3) {
        count += (child.nodeValue ?? "").length;
      } else if (child.nodeType === 1) {
        count += (child as HTMLElement).textContent?.length ?? 0;
      }
      idx += 1;
    }
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
  const total = el.textContent?.length ?? 0;
  const s = Math.max(0, Math.min(start | 0, total));
  const e = Math.max(s, Math.min((end ?? start) | 0, total));

  const locate = (target: number): { node: Node; offset: number } => {
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let counted = 0;
    let cur = walker.nextNode();
    let last: Text | null = null;
    while (cur) {
      const len = (cur.nodeValue ?? "").length;
      if (counted + len >= target) {
        return { node: cur, offset: target - counted };
      }
      counted += len;
      last = cur as Text;
      cur = walker.nextNode();
    }
    // No text nodes at all — anchor to the element itself.
    if (!last) return { node: el, offset: 0 };
    return { node: last, offset: (last.nodeValue ?? "").length };
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
