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
  EMOJI_ATTR,
  inlineEmojiNames,
  safeUrl,
  tokenizeInline,
  type InlineOpts,
  type InlineToken,
} from "./inline-tokens";
import { getInlineEmojiSet } from "./emoji-registry";

/* Rendering options. `emoji` is the SAME set the offset map is handed —
 * both default to the module registry, never to an empty set. `emojiAs`
 * lets the export path swap the background-image span for something a
 * standalone file can carry (see export.ts). */
export type InlineRenderOpts = InlineOpts & {
  /** "span" (default, on-screen) | "alt" (export: shortcode text only). */
  emojiAs?: "span" | "alt";
};

function emojiUrl(name: string, opts?: InlineOpts): string {
  const list = opts?.emoji ?? getInlineEmojiSet();
  return list.find((e) => e.name === name)?.url ?? "";
}

/* The inline emoji box. Explicit width AND height — a text-only span has
 * no intrinsic box, so a background image on it renders invisibly. The
 * shortcode stays in the DOM as a text node (screen readers, copy-paste)
 * inside a zero-size overflow-hidden wrapper; ce-offsets skips that
 * subtree so it contributes zero rendered characters. Never an <img>. */
const EMOJI_BOX: React.CSSProperties = {
  display: "inline-block",
  width: "1.15em",
  height: "1.15em",
  verticalAlign: "-0.2em",
  backgroundSize: "contain",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "center",
};
const EMOJI_SR: React.CSSProperties = {
  display: "inline-block",
  width: 0,
  height: 0,
  overflow: "hidden",
};

// Re-exported for existing callers (floating-toolbar, tests) so the
// import surface of this module is unchanged.
export { safeUrl };

/* ─────────────────────────── ReactNode renderer ─────────────────────────── */

type Ctx = { keyCounter: number; opts?: InlineRenderOpts };

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
    if (t.kind === "emoji") {
      const url = emojiUrl(t.name, ctx.opts);
      out.push(
        <span
          key={ctx.keyCounter++}
          data-o={withOffsets ? t.sourceStart : undefined}
          {...{ [EMOJI_ATTR]: t.name }}
          title={`:${t.name}:`}
          style={{
            ...EMOJI_BOX,
            backgroundImage: url ? `url("${url}")` : undefined,
          }}
        >
          <span style={EMOJI_SR}>{`:${t.name}:`}</span>
        </span>,
      );
      continue;
    }
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

export function renderInline(
  text: string,
  opts?: InlineRenderOpts,
): ReactNode[] {
  return renderChildren(
    tokenizeInline(text ?? "", opts),
    { keyCounter: 0, opts },
    false,
  );
}

/* renderInlineWithOffsets — same output but each rendered node carries a
 * data-o="<source offset>" attribute so a click can be mapped back to a
 * character position in the original markdown string. Used by the editor
 * to place the caret at the clicked character when swapping div→textarea. */
export function renderInlineWithOffsets(
  text: string,
  opts?: InlineRenderOpts,
): ReactNode[] {
  return renderChildren(
    tokenizeInline(text ?? "", opts),
    { keyCounter: 0, opts },
    true,
  );
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
function tokensToHtml(
  tokens: InlineToken[],
  opts?: InlineRenderOpts,
): string {
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
    if (t.kind === "emoji") {
      const sc = `:${t.name}:`;
      if (opts?.emojiAs === "alt") {
        // Export path: no external request may survive the file, and a
        // signed URL 404s within the hour. The shortcode text is the
        // documented loss (see EXPORT_LOSS in export.ts).
        out += escHtml(sc);
        continue;
      }
      const url = emojiUrl(t.name, opts);
      out += `<span ${EMOJI_ATTR}="${escHtml(t.name)}" title="${escHtml(
        sc,
      )}" style="display:inline-block;width:1.15em;height:1.15em;vertical-align:-0.2em;background-size:contain;background-repeat:no-repeat;background-position:center;${
        url ? `background-image:url(&quot;${escHtml(url)}&quot;)` : ""
      }"><span style="display:inline-block;width:0;height:0;overflow:hidden">${escHtml(
        sc,
      )}</span></span>`;
      continue;
    }
    if (t.kind === "code") {
      out += `<code>${escHtml(t.text)}</code>`;
      continue;
    }
    if (t.kind === "bold") {
      out += `<strong>${tokensToHtml(t.children, opts)}</strong>`;
      continue;
    }
    if (t.kind === "strike") {
      out += `<s>${tokensToHtml(t.children, opts)}</s>`;
      continue;
    }
    if (t.kind === "highlight") {
      out += `<mark>${tokensToHtml(t.children, opts)}</mark>`;
      continue;
    }
    if (t.kind === "italic") {
      out += `<em>${tokensToHtml(t.children, opts)}</em>`;
      continue;
    }
    if (t.kind === "underline") {
      out += `<u>${tokensToHtml(t.children, opts)}</u>`;
      continue;
    }
    if (t.kind === "link") {
      out += `<a href="${escHtml(t.url)}" target="_blank" rel="noopener noreferrer">${tokensToHtml(t.children, opts)}</a>`;
      continue;
    }
  }
  flush();
  return out;
}

export function inlineToHtml(text: string, opts?: InlineRenderOpts): string {
  return tokensToHtml(tokenizeInline(text ?? "", opts), opts);
}

/** Re-exported so a consumer can prove it shares the tokenizer's set. */
export { inlineEmojiNames };
