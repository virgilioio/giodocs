/* inline-tokens — the single source of truth for the inline markdown
 * grammar. Both the renderer (inline-markdown.tsx) and the offset
 * translation layer (ce-offsets.ts) consume tokens from here.
 *
 * ⚠ Do NOT reimplement any of this grammar elsewhere. If a second
 *   parser is added, the caret and the renderer will silently drift —
 *   ⌘B will insert delimiters at the wrong index and text corrupts
 *   as the user types. There is exactly one tokenizer, forever.
 *
 * Grammar mirrored precisely from what inline-markdown.tsx used to
 * do inline. See its header comment for the precedence and rationale
 * (why `_italic_` is deliberately unsupported, why `\X` escapes, why
 * dangerous URL schemes fall through to literal text).
 */

const ESC_PUNCT = /[\\*_`~<>\[\]()]/;

export function safeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^\s*(javascript|data|vbscript)\s*:/i.test(trimmed)) return null;
  return trimmed;
}

/* A token covers a contiguous source range [sourceStart, sourceEnd).
 * `text` tokens carry the RENDERED character(s) they produce — for a
 * plain literal that's 1 char, for an escape "\*" that's 1 char with
 * sourceEnd-sourceStart === 2. Consecutive text tokens are merged by
 * the renderer into a single output run; consumers that care about
 * per-character source offsets (like ce-offsets) keep them separate.
 *
 * `code` carries the RAW inner text (never re-parsed).
 * Structural tokens (bold, italic, strike, highlight, underline, link)
 * carry `openLen` and `closeLen` so consumers know the width of the
 * delimiters bracketing their children. `innerStart` = sourceStart +
 * openLen and `innerEnd` = sourceEnd - closeLen by construction.
 * Links additionally carry the sanitised `url`.
 */
export type InlineTextToken = {
  kind: "text";
  sourceStart: number;
  sourceEnd: number;
  text: string;
};
export type InlineCodeToken = {
  kind: "code";
  sourceStart: number;
  sourceEnd: number;
  text: string;
};
export type InlineContainerKind =
  | "bold"
  | "italic"
  | "strike"
  | "highlight"
  | "underline";
export type InlineContainerToken = {
  kind: InlineContainerKind;
  sourceStart: number;
  sourceEnd: number;
  openLen: number;
  closeLen: number;
  children: InlineToken[];
};
export type InlineLinkToken = {
  kind: "link";
  sourceStart: number;
  sourceEnd: number;
  openLen: number;
  closeLen: number;
  url: string;
  children: InlineToken[];
};
export type InlineToken =
  | InlineTextToken
  | InlineCodeToken
  | InlineContainerToken
  | InlineLinkToken;

export function tokenizeInline(source: string): InlineToken[] {
  const src = source ?? "";
  return tokenizeRange(src, 0, src.length);
}

function tokenizeRange(
  src: string,
  from: number,
  to: number,
): InlineToken[] {
  const out: InlineToken[] = [];
  let i = from;
  while (i < to) {
    const c = src[i];

    // Escape: \X where X ∈ ESC_PUNCT — one rendered char.
    if (c === "\\" && i + 1 < to && ESC_PUNCT.test(src[i + 1])) {
      out.push({
        kind: "text",
        sourceStart: i,
        sourceEnd: i + 2,
        text: src[i + 1],
      });
      i += 2;
      continue;
    }

    // Code span `…` — inner is literal, never re-parsed.
    if (c === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i && end < to) {
        out.push({
          kind: "code",
          sourceStart: i,
          sourceEnd: end + 1,
          text: src.slice(i + 1, end),
        });
        i = end + 1;
        continue;
      }
    }

    // Bold **…**
    if (c === "*" && src[i + 1] === "*") {
      const end = src.indexOf("**", i + 2);
      if (end > i + 1 && end + 2 <= to) {
        out.push({
          kind: "bold",
          sourceStart: i,
          sourceEnd: end + 2,
          openLen: 2,
          closeLen: 2,
          children: tokenizeRange(src, i + 2, end),
        });
        i = end + 2;
        continue;
      }
    }

    // Strike ~~…~~
    if (c === "~" && src[i + 1] === "~") {
      const end = src.indexOf("~~", i + 2);
      if (end > i + 1 && end + 2 <= to) {
        out.push({
          kind: "strike",
          sourceStart: i,
          sourceEnd: end + 2,
          openLen: 2,
          closeLen: 2,
          children: tokenizeRange(src, i + 2, end),
        });
        i = end + 2;
        continue;
      }
    }

    // Highlight ==…==   (after bold and strike, before single *)
    if (c === "=" && src[i + 1] === "=") {
      const end = src.indexOf("==", i + 2);
      if (end > i + 1 && end + 2 <= to) {
        out.push({
          kind: "highlight",
          sourceStart: i,
          sourceEnd: end + 2,
          openLen: 2,
          closeLen: 2,
          children: tokenizeRange(src, i + 2, end),
        });
        i = end + 2;
        continue;
      }
    }

    // Italic *…*   — underscore is deliberately NOT a delimiter.
    // Bails out of the scan if we hit ** (that's a bold token).
    if (c === "*") {
      let j = i + 1;
      while (j < to) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === "*") {
          if (src[j + 1] === "*") {
            j = -1;
            break;
          }
          break;
        }
        j++;
      }
      if (j > i + 1 && j < to && src[j] === "*") {
        out.push({
          kind: "italic",
          sourceStart: i,
          sourceEnd: j + 1,
          openLen: 1,
          closeLen: 1,
          children: tokenizeRange(src, i + 1, j),
        });
        i = j + 1;
        continue;
      }
    }

    // Underline <u>…</u>
    if (c === "<" && src.slice(i, i + 3).toLowerCase() === "<u>") {
      const lower = src.toLowerCase();
      const end = lower.indexOf("</u>", i + 3);
      if (end > i && end + 4 <= to) {
        out.push({
          kind: "underline",
          sourceStart: i,
          sourceEnd: end + 4,
          openLen: 3,
          closeLen: 4,
          children: tokenizeRange(src, i + 3, end),
        });
        i = end + 4;
        continue;
      }
    }

    // Link [label](url)
    if (c === "[") {
      const rb = src.indexOf("]", i + 1);
      if (rb > i && rb < to && src[rb + 1] === "(") {
        const rp = src.indexOf(")", rb + 2);
        if (rp > rb && rp < to) {
          const url = safeUrl(src.slice(rb + 2, rp));
          if (url) {
            out.push({
              kind: "link",
              sourceStart: i,
              sourceEnd: rp + 1,
              openLen: 1,
              closeLen: rp + 1 - rb, // "](url)"
              url,
              children: tokenizeRange(src, i + 1, rb),
            });
            i = rp + 1;
            continue;
          }
        }
      }
    }

    // Literal.
    out.push({ kind: "text", sourceStart: i, sourceEnd: i + 1, text: c });
    i += 1;
  }
  return out;
}

/* ─── htmlToInlineMarkdown ─────────────────────────────────────────────
 * Total inverse of tokensToHtml over the exact tag set we emit:
 *   strong / em / s / code / mark / u / a
 * plus text nodes. Anything the browser injects is normalised rather
 * than trusted:
 *   <br>          → "\n"
 *   <div>…</div>  → "\n" + (walked inner)   (per spec: newline BEFORE)
 *   &nbsp;        → " "
 *   comments / script / style   → ""
 *   any other wrapper           → its text content only (formatting
 *                                 inside an unknown tag is dropped)
 * Never throws. A browser will eventually produce something unexpected
 * and the editor must degrade, not crash.
 *
 * `input` may be an HTMLElement (walked directly) or a string (parsed
 * into a detached <div>). String parsing requires a DOM at runtime —
 * fine in the browser and in happy-dom tests.
 */
export function htmlToInlineMarkdown(input: HTMLElement | string): string {
  let root: Node | null = null;
  if (typeof input === "string") {
    if (typeof document === "undefined") return "";
    const tmp = document.createElement("div");
    tmp.innerHTML = input;
    root = tmp;
  } else {
    root = input;
  }
  if (!root) return "";
  return walkChildren(root);
}

function walkChildren(node: Node): string {
  let out = "";
  const kids = node.childNodes;
  for (let i = 0; i < kids.length; i++) out += walkNode(kids[i]);
  return out;
}

function walkNode(node: Node): string {
  // Text
  if (node.nodeType === 3) {
    return (node.nodeValue ?? "").replace(/\u00a0/g, " ");
  }
  // Comment / anything non-element
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  const tag = el.tagName ? el.tagName.toLowerCase() : "";
  if (tag === "script" || tag === "style") return "";
  if (tag === "br") return "\n";
  if (tag === "div") return "\n" + walkChildren(el);
  if (tag === "strong" || tag === "b") return "**" + walkChildren(el) + "**";
  if (tag === "em" || tag === "i") return "*" + walkChildren(el) + "*";
  if (tag === "s" || tag === "del" || tag === "strike")
    return "~~" + walkChildren(el) + "~~";
  if (tag === "mark") return "==" + walkChildren(el) + "==";
  if (tag === "u") return "<u>" + walkChildren(el) + "</u>";
  if (tag === "code") {
    // Inner is literal — never re-tokenise. textContent flattens any
    // nested markup the browser may have introduced.
    return "`" + (el.textContent ?? "") + "`";
  }
  if (tag === "a") {
    const href = (el.getAttribute("href") ?? "").trim();
    return "[" + walkChildren(el) + "](" + href + ")";
  }
  // Unknown wrapper: contribute its text content only.
  return (el.textContent ?? "").replace(/\u00a0/g, " ");
}
