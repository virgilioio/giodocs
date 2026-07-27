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
 *   ==highlight==  →  <mark>
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
 *
 * IMPLEMENTATION: this file is now a thin RENDERER that consumes the
 * canonical token stream from inline-tokens.ts. There is exactly ONE
 * tokenizer for the inline grammar in the entire codebase; the caret
 * layer (ce-offsets.ts) consumes the same tokens so the two cannot drift.
 */

import type { ReactNode } from "react";
import { Fragment } from "react";
import {
  safeUrl,
  tokenizeInline,
  type InlineToken,
} from "./inline-tokens";

// Re-exported for existing callers (floating-toolbar, tests) so the
// import surface of this module is unchanged.
export { safeUrl };

/* ─────────────────────────── ReactNode renderer ─────────────────────────── */

type Ctx = { keyCounter: number };

function renderChildren(
  tokens: InlineToken[],
  ctx: Ctx,
  withOffsets: boolean,
): ReactNode[] {
  const out: ReactNode[] = [];
  // Buffer consecutive text tokens into a single Fragment/span so we
  // produce exactly the same node shape the old inline parser emitted:
  // one flushed literal run per interruption by a structural token.
  let buf = "";
  let bufStart = 0;

  const flush = () => {
    if (!buf) return;
    if (withOffsets) {
      out.push(
        <span key={ctx.keyCounter++} data-o={bufStart}>
          {buf}
        </span>,
      );
    } else {
      out.push(<Fragment key={ctx.keyCounter++}>{buf}</Fragment>);
    }
    buf = "";
  };

  for (const t of tokens) {
    if (t.kind === "text") {
      if (!buf) bufStart = t.sourceStart;
      buf += t.text;
      continue;
    }
    flush();
    if (t.kind === "code") {
      out.push(
        <code
          key={ctx.keyCounter++}
          data-o={withOffsets ? t.sourceStart : undefined}
          className="rounded-[4px] bg-sunken px-[4px] py-[1px] font-mono"
          style={{ fontSize: 13.5 }}
        >
          {t.text}
        </code>,
      );
      continue;
    }
    if (t.kind === "bold") {
      out.push(
        <strong
          key={ctx.keyCounter++}
          data-o={withOffsets ? t.sourceStart : undefined}
          className="font-bold"
        >
          {renderChildren(t.children, ctx, withOffsets)}
        </strong>,
      );
      continue;
    }
    if (t.kind === "strike") {
      out.push(
        <s
          key={ctx.keyCounter++}
          data-o={withOffsets ? t.sourceStart : undefined}
          className="text-muted"
        >
          {renderChildren(t.children, ctx, withOffsets)}
        </s>,
      );
      continue;
    }
    if (t.kind === "highlight") {
      out.push(
        <mark
          key={ctx.keyCounter++}
          data-o={withOffsets ? t.sourceStart : undefined}
          style={{
            background: "var(--color-highlight)",
            color: "var(--color-noir)",
            padding: "0 2px",
            borderRadius: 2,
          }}
        >
          {renderChildren(t.children, ctx, withOffsets)}
        </mark>,
      );
      continue;
    }
    if (t.kind === "italic") {
      out.push(
        <em
          key={ctx.keyCounter++}
          data-o={withOffsets ? t.sourceStart : undefined}
        >
          {renderChildren(t.children, ctx, withOffsets)}
        </em>,
      );
      continue;
    }
    if (t.kind === "underline") {
      out.push(
        <u
          key={ctx.keyCounter++}
          data-o={withOffsets ? t.sourceStart : undefined}
        >
          {renderChildren(t.children, ctx, withOffsets)}
        </u>,
      );
      continue;
    }
    if (t.kind === "link") {
      out.push(
        <a
          key={ctx.keyCounter++}
          data-o={withOffsets ? t.sourceStart : undefined}
          href={t.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          {renderChildren(t.children, ctx, withOffsets)}
        </a>,
      );
      continue;
    }
  }
  flush();
  return out;
}

export function renderInline(text: string): ReactNode[] {
  return renderChildren(tokenizeInline(text ?? ""), { keyCounter: 0 }, false);
}

/* renderInlineWithOffsets — same output but each rendered node carries a
 * data-o="<source offset>" attribute so a click can be mapped back to a
 * character position in the original markdown string. Used by the editor
 * to place the caret at the clicked character when swapping div→textarea. */
export function renderInlineWithOffsets(text: string): ReactNode[] {
  return renderChildren(tokenizeInline(text ?? ""), { keyCounter: 0 }, true);
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
 * bypassed. Consumes the same tokenizer as renderInline. */
function tokensToHtml(tokens: InlineToken[]): string {
  let out = "";
  let buf = "";
  const flush = () => {
    if (buf) {
      out += escHtml(buf);
      buf = "";
    }
  };
  for (const t of tokens) {
    if (t.kind === "text") {
      buf += t.text;
      continue;
    }
    flush();
    if (t.kind === "code") {
      out += `<code>${escHtml(t.text)}</code>`;
      continue;
    }
    if (t.kind === "bold") {
      out += `<strong>${tokensToHtml(t.children)}</strong>`;
      continue;
    }
    if (t.kind === "strike") {
      out += `<s>${tokensToHtml(t.children)}</s>`;
      continue;
    }
    if (t.kind === "highlight") {
      out += `<mark>${tokensToHtml(t.children)}</mark>`;
      continue;
    }
    if (t.kind === "italic") {
      out += `<em>${tokensToHtml(t.children)}</em>`;
      continue;
    }
    if (t.kind === "underline") {
      out += `<u>${tokensToHtml(t.children)}</u>`;
      continue;
    }
    if (t.kind === "link") {
      out += `<a href="${escHtml(t.url)}" target="_blank" rel="noopener noreferrer">${tokensToHtml(
        t.children,
      )}</a>`;
      continue;
    }
  }
  flush();
  return out;
}

export function inlineToHtml(text: string): string {
  return tokensToHtml(tokenizeInline(text ?? ""));
}
