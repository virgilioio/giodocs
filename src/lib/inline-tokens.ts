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

import { getInlineEmojiSet } from "./emoji-registry";

const ESC_PUNCT = /[\\*_`~<>\[\]()]/;

/* ─── options ──────────────────────────────────────────────────────────
 * The ONLY set-dependent part of the grammar: ":name:" is an emoji token
 * when `name` is in the known set, and literal text otherwise. Both the
 * renderer and the offset map must be handed the SAME set or the caret
 * and the screen drift. Every entry point defaults to the module-level
 * registry (see emoji-registry.ts) rather than to an empty set, so a
 * consumer cannot accidentally opt out. */
export type InlineOpts = {
  emoji?: readonly { name: string; url?: string; description?: string }[];
};

// The name set is rebuilt only when the emoji list itself changes; the
// tokenizer runs several times per keystroke.
const namesCache = new WeakMap<object, ReadonlySet<string>>();
export function inlineEmojiNames(opts?: InlineOpts): ReadonlySet<string> {
  const list = opts?.emoji ?? getInlineEmojiSet();
  const hit = namesCache.get(list);
  if (hit) return hit;
  const set = new Set(list.map((e) => e.name));
  namesCache.set(list, set);
  return set;
}

/** ':' + name + ':' where name is ^[a-z0-9][a-z0-9-]{0,23}$ */
const SHORTCODE_RE = /^:([a-z0-9][a-z0-9-]{0,23}):/;

/** The attribute an inline emoji span carries. htmlToInlineMarkdown reads
 * it to recover ":name:", and ce-offsets skips the subtree so the hidden
 * shortcode text node contributes ZERO rendered characters. */
export const EMOJI_ATTR = "data-gio-emoji";

/** The attribute an @mention chip carries: "user:<id>" or "page:<id>".
 * htmlToInlineMarkdown rebuilds the source from it (and data-label), and
 * ce-offsets skips the chip, which, like an emoji, is zero rendered
 * characters: the caret steps over it as one atom. */
export const MENTION_ATTR = "data-gio-mention";
export const MENTION_LABEL_ATTR = "data-label";

/** "@[label](user:<uuid>)" or "@[](page:<uuid>)". The label is the name
 * when it was written (search and plain-text fallbacks); page mentions keep
 * it empty so a private page's title never sits in another page's text. */
const MENTION_RE =
  /^@\[([^\]\n]{0,120})\]\((user|page):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/;

/** The source for a mention. Brackets and line breaks leave the label. */
export function mentionSource(kind: "user" | "page", id: string, label: string): string {
  const clean = kind === "page" ? "" : label.replace(/[[\]\n\r]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 120);
  return `@[${clean}](${kind}:${id})`;
}

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
export type InlineEmojiToken = {
  kind: "emoji";
  sourceStart: number;
  sourceEnd: number;
  name: string;
};
export type InlineMentionToken = {
  kind: "mention";
  sourceStart: number;
  sourceEnd: number;
  mention: "user" | "page";
  id: string;
  label: string;
};
export type InlineToken =
  | InlineEmojiToken
  | InlineMentionToken
  | InlineTextToken
  | InlineCodeToken
  | InlineContainerToken
  | InlineLinkToken;

/** An odd number of unescaped "*" in src[from, to). */
function oddStars(src: string, from: number, to: number): boolean {
  let n = 0;
  for (let k = from; k < to; k++) {
    if (src[k] === "\\") k++;
    else if (src[k] === "*") n++;
  }
  return n % 2 === 1;
}

export function tokenizeInline(
  source: string,
  opts?: InlineOpts,
): InlineToken[] {
  const src = source ?? "";
  return tokenizeRange(src, 0, src.length, inlineEmojiNames(opts));
}

function tokenizeRange(
  src: string,
  from: number,
  to: number,
  names: ReadonlySet<string>,
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

    // Custom emoji :name: — AFTER code (a shortcode inside backticks is
    // literal) and never nests. Rendered length is ZERO, exactly like a
    // delimiter run: the caret steps over the whole token.
    if (c === ":" && names.size > 0) {
      const m = SHORTCODE_RE.exec(src.slice(i, Math.min(to, i + 27)));
      if (m && names.has(m[1])) {
        out.push({
          kind: "emoji",
          sourceStart: i,
          sourceEnd: i + m[0].length,
          name: m[1],
        });
        i += m[0].length;
        continue;
      }
    }

    // @mention @[label](user:<id>) / @[](page:<id>) — before links, which
    // would otherwise take the "[label](…)" part. Never nests; zero
    // rendered length, like an emoji.
    if (c === "@" && src[i + 1] === "[") {
      const m = MENTION_RE.exec(src.slice(i, Math.min(to, i + 200)));
      if (m) {
        out.push({
          kind: "mention",
          sourceStart: i,
          sourceEnd: i + m[0].length,
          mention: m[2] as "user" | "page",
          id: m[3],
          label: m[1],
        });
        i += m[0].length;
        continue;
      }
    }

    // Bold **…**
    if (c === "*" && src[i + 1] === "*") {
      let end = src.indexOf("**", i + 2);
      // Bold around italic ("***x***", "**a *b***"): when the content
      // holds an unclosed single "*" and a third "*" follows the close,
      // that "*" closes the italic, so the bold closes one further on.
      if (end > i + 1 && end + 3 <= to && src[end + 2] === "*" && oddStars(src, i + 2, end)) end++;
      if (end > i + 1 && end + 2 <= to) {
        out.push({
          kind: "bold",
          sourceStart: i,
          sourceEnd: end + 2,
          openLen: 2,
          closeLen: 2,
          children: tokenizeRange(src, i + 2, end, names),
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
          children: tokenizeRange(src, i + 2, end, names),
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
          children: tokenizeRange(src, i + 2, end, names),
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
          if (j + 1 < to && src[j + 1] === "*") {
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
          children: tokenizeRange(src, i + 1, j, names),
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
          children: tokenizeRange(src, i + 3, end, names),
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
              children: tokenizeRange(src, i + 1, rb, names),
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
  // An inline emoji span round-trips to its shortcode. Its hidden text
  // node is NOT walked — that is what keeps rendered length at zero.
  const sc = el.getAttribute ? el.getAttribute(EMOJI_ATTR) : null;
  if (sc) return ":" + sc + ":";
  // A mention chip round-trips to its source; its visible name is not walked.
  const mt = el.getAttribute ? el.getAttribute(MENTION_ATTR) : null;
  if (mt) {
    const colon = mt.indexOf(":");
    const kind = mt.slice(0, colon);
    const id = mt.slice(colon + 1);
    if ((kind === "user" || kind === "page") && /^[0-9a-f-]{36}$/.test(id)) {
      let label = "";
      try {
        label = decodeURIComponent(el.getAttribute(MENTION_LABEL_ATTR) ?? "");
      } catch {
        label = "";
      }
      return mentionSource(kind, id, label);
    }
  }
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
