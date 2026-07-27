/* Inline markdown renderer.
 *
 * Block.text stays a plain string holding markdown; we render it FORMATTED
 * when the block is not focused, and let the user see RAW markdown when
 * the caret is in the textarea. Nothing is ever lost. This is a PURE
 * function — no dangerouslySetInnerHTML, no HTML strings from user input.
 *
 * Precedence (longest delimiter first):
 *   `code`  →  <code>          (contents never re-parsed)
 *   **bold** →  <strong>
 *   *italic*  →  <em>
 *   ~~strike~~ →  <s>
 *   <u>…</u>   →  <u>          (markdown has no underline; inline HTML is
 *                              the convention and passes through)
 *   [label](url) → <a target=_blank rel=noopener noreferrer>
 *
 * ⚠ DO NOT add _italic_ support. We deliberately support *italic* only.
 * Real documents being migrated (legal contracts) contain long runs of
 * underscores as fill-in blanks — "_____________________, sociedad …" and
 * "Firma: ___________________________". Treating _ as an italic delimiter
 * eats those runs and corrupts the document. Underscores must ALWAYS
 * render as literal characters. This is safe because the other direction
 * is fully controlled: html-to-markdown emits * for <em>/<i>, and
 * blockToMarkdown emits * — nothing we generate ever uses _ for emphasis.
 *
 * Rules:
 *  - Nesting at least two deep (**bold *italic* inside**) works.
 *  - Unmatched / malformed ** ~~ * runs render as LITERAL characters and
 *    never eat following text.
 *  - Escaping: `\*` renders a literal asterisk.
 *  - Links with dangerous URL schemes (javascript:, data:, vbscript:) are
 *    rendered as literal text, never as <a href>.
 */

import type { ReactNode } from "react";
import { Fragment } from "react";

const ESC_PUNCT = /[\\*_`~<>\[\]()]/;

function safeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  // Scheme test — case-insensitive, ignore surrounding whitespace.
  if (/^\s*(javascript|data|vbscript)\s*:/i.test(trimmed)) return null;
  return trimmed;
}

/* ─────────────────────────── ReactNode renderer ─────────────────────────── */

type Ctx = { keyCounter: number };

function parseNodes(
  text: string,
  base: number,
  ctx: Ctx,
  withOffsets: boolean,
): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = "";
  let bufStart = 0;
  let i = 0;
  const flush = () => {
    if (!buf) return;
    if (withOffsets) {
      out.push(
        <span key={ctx.keyCounter++} data-o={base + bufStart}>
          {buf}
        </span>,
      );
    } else {
      out.push(<Fragment key={ctx.keyCounter++}>{buf}</Fragment>);
    }
    buf = "";
  };
  const addLit = (ch: string) => {
    if (!buf) bufStart = i;
    buf += ch;
  };

  while (i < text.length) {
    const c = text[i];

    // Escape: backslash + punctuation → literal punct.
    if (c === "\\" && i + 1 < text.length && ESC_PUNCT.test(text[i + 1])) {
      // The rendered char is the punct; keep source offset at the backslash.
      if (!buf) bufStart = i;
      buf += text[i + 1];
      i += 2;
      continue;
    }

    // Code span: `code`
    if (c === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i) {
        flush();
        const inner = text.slice(i + 1, end);
        out.push(
          <code
            key={ctx.keyCounter++}
            data-o={withOffsets ? base + i : undefined}
            className="rounded-[4px] bg-sunken px-[4px] py-[1px] font-mono"
            style={{ fontSize: 13.5 }}
          >
            {inner}
          </code>,
        );
        i = end + 1;
        continue;
      }
    }

    // Bold: **...**
    if (c === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end > i + 1) {
        flush();
        out.push(
          <strong
            key={ctx.keyCounter++}
            data-o={withOffsets ? base + i : undefined}
            className="font-bold"
          >
            {parseNodes(text.slice(i + 2, end), base + i + 2, ctx, withOffsets)}
          </strong>,
        );
        i = end + 2;
        continue;
      }
    }

    // Strike: ~~...~~
    if (c === "~" && text[i + 1] === "~") {
      const end = text.indexOf("~~", i + 2);
      if (end > i + 1) {
        flush();
        out.push(
          <s
            key={ctx.keyCounter++}
            data-o={withOffsets ? base + i : undefined}
            className="text-muted"
          >
            {parseNodes(text.slice(i + 2, end), base + i + 2, ctx, withOffsets)}
          </s>,
        );
        i = end + 2;
        continue;
      }
    }

    // Italic: *…*   — underscore is deliberately NOT supported here.
    // See the header comment for why (legal-contract fill-in blanks).
    if (c === "*") {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text[j] === "*") {
          // Do not consume another opening ** by accident — bail out italic
          // scan if we hit a bold delimiter.
          if (text[j + 1] === "*") {
            j = -1;
            break;
          }
          break;
        }
        j++;
      }
      if (j > i + 1 && j < text.length && text[j] === "*") {
        flush();
        out.push(
          <em
            key={ctx.keyCounter++}
            data-o={withOffsets ? base + i : undefined}
          >
            {parseNodes(text.slice(i + 1, j), base + i + 1, ctx, withOffsets)}
          </em>,
        );
        i = j + 1;
        continue;
      }
    }

    // Underline: <u>…</u>  (case-insensitive tag names)
    if (c === "<" && text.slice(i, i + 3).toLowerCase() === "<u>") {
      const lower = text.toLowerCase();
      const end = lower.indexOf("</u>", i + 3);
      if (end > i) {
        flush();
        out.push(
          <u
            key={ctx.keyCounter++}
            data-o={withOffsets ? base + i : undefined}
          >
            {parseNodes(text.slice(i + 3, end), base + i + 3, ctx, withOffsets)}
          </u>,
        );
        i = end + 4;
        continue;
      }
    }

    // Link: [label](url)
    if (c === "[") {
      const rb = text.indexOf("]", i + 1);
      if (rb > i && text[rb + 1] === "(") {
        const rp = text.indexOf(")", rb + 2);
        if (rp > rb) {
          const label = text.slice(i + 1, rb);
          const rawUrl = text.slice(rb + 2, rp);
          const url = safeUrl(rawUrl);
          if (url) {
            flush();
            out.push(
              <a
                key={ctx.keyCounter++}
                data-o={withOffsets ? base + i : undefined}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                {parseNodes(label, base + i + 1, ctx, withOffsets)}
              </a>,
            );
            i = rp + 1;
            continue;
          }
        }
      }
    }

    // Literal
    addLit(c);
    i++;
  }
  flush();
  return out;
}

export function renderInline(text: string): ReactNode[] {
  return parseNodes(text ?? "", 0, { keyCounter: 0 }, false);
}

/* renderInlineWithOffsets — same output but each rendered node carries a
 * data-o="<source offset>" attribute so a click can be mapped back to a
 * character position in the original markdown string. Used by the editor
 * to place the caret at the clicked character when swapping div→textarea. */
export function renderInlineWithOffsets(text: string): ReactNode[] {
  return parseNodes(text ?? "", 0, { keyCounter: 0 }, true);
}

/* ─────────────────────────── HTML string emitter ─────────────────────────── */

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* Convert inline markdown to a safe HTML string. User text is HTML-escaped
 * FIRST and only then wrapped in structural tags — escaping is never
 * bypassed. Kept next to renderInline so both stay in lockstep. */
export function inlineToHtml(text: string): string {
  const src = text ?? "";
  let out = "";
  let buf = "";
  let i = 0;
  const flush = () => {
    if (buf) {
      out += escHtml(buf);
      buf = "";
    }
  };

  while (i < src.length) {
    const c = src[i];

    if (c === "\\" && i + 1 < src.length && ESC_PUNCT.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }

    if (c === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i) {
        flush();
        out += `<code>${escHtml(src.slice(i + 1, end))}</code>`;
        i = end + 1;
        continue;
      }
    }

    if (c === "*" && src[i + 1] === "*") {
      const end = src.indexOf("**", i + 2);
      if (end > i + 1) {
        flush();
        out += `<strong>${inlineToHtml(src.slice(i + 2, end))}</strong>`;
        i = end + 2;
        continue;
      }
    }

    if (c === "~" && src[i + 1] === "~") {
      const end = src.indexOf("~~", i + 2);
      if (end > i + 1) {
        flush();
        out += `<s>${inlineToHtml(src.slice(i + 2, end))}</s>`;
        i = end + 2;
        continue;
      }
    }

    if (c === "*" || c === "_") {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === c) break;
        if (c === "*" && src[j] === "*" && src[j + 1] === "*") {
          j = -1;
          break;
        }
        j++;
      }
      if (j > i + 1 && j < src.length) {
        flush();
        out += `<em>${inlineToHtml(src.slice(i + 1, j))}</em>`;
        i = j + 1;
        continue;
      }
    }

    if (c === "<" && src.slice(i, i + 3).toLowerCase() === "<u>") {
      const end = src.toLowerCase().indexOf("</u>", i + 3);
      if (end > i) {
        flush();
        out += `<u>${inlineToHtml(src.slice(i + 3, end))}</u>`;
        i = end + 4;
        continue;
      }
    }

    if (c === "[") {
      const rb = src.indexOf("]", i + 1);
      if (rb > i && src[rb + 1] === "(") {
        const rp = src.indexOf(")", rb + 2);
        if (rp > rb) {
          const rawUrl = src.slice(rb + 2, rp);
          const label = src.slice(i + 1, rb);
          const url = safeUrl(rawUrl);
          if (url) {
            flush();
            out += `<a href="${escHtml(url)}" target="_blank" rel="noopener noreferrer">${inlineToHtml(label)}</a>`;
            i = rp + 1;
            continue;
          }
        }
      }
    }

    buf += c;
    i++;
  }
  flush();
  return out;
}
