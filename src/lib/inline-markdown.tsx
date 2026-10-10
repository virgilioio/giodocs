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
  MENTION_ATTR,
  MENTION_LABEL_ATTR,
  inlineEmojiNames,
  safeUrl,
  tokenizeInline,
  type InlineOpts,
  type InlineToken,
} from "./inline-tokens";
import { getInlineEmojiSet } from "./emoji-registry";
import { mentionDirectoryReady, mentionPage, mentionUserName } from "./mention-directory";

/* Rendering options. `emoji` is the SAME set the offset map is handed —
 * both default to the module registry, never to an empty set. `emojiAs`
 * lets the export path swap the background-image span for something a
 * standalone file can carry (see export.ts).
 *
 * ⚠ NAMING NOTE. The on-screen mode (an inline style carrying the signed
 * URL) is "url" and remains the DEFAULT — <Editable> calls inlineToHtml
 * with no opts and must keep producing exactly that markup, byte for byte,
 * or htmlToInlineMarkdown stops round-tripping. "span" is the EXPORT mode:
 * a class-only span whose background image comes from one CSS rule per
 * DISTINCT emoji emitted by toHtml, so a page using ":brand:" twenty times
 * embeds the image once. "alt" (shortcode text) stays the fallback for a
 * name that did not resolve. */
export type InlineRenderOpts = InlineOpts & {
  /**
   * "url"  (default, on-screen: inline background-image with a signed URL)
   * "span" (export: `<span class="emoji e-{name}">`, image via CSS rule)
   * "alt"  (shortcode text only)
   */
  emojiAs?: "url" | "span" | "alt";
  /** Export mode only: the names that actually resolved to a data URI.
   * A name absent from this set degrades to "alt". Only NAMES cross this
   * boundary — never data URIs, and never into the tokenizer. */
  emojiClassNames?: ReadonlySet<string>;
};

/* Names already match the database's own check constraint. Asserting is
 * therefore correct and escaping would be theatre: a name that fails is
 * SKIPPED (falls back to alt text) rather than sanitised into a class. */
export const EMOJI_NAME_OK = /^[a-z0-9][a-z0-9-]{0,23}$/;

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

/* What a mention shows, from the mention directory: a person's current
 * name, or a page's current title. A person who left keeps the name the
 * mention was written with; a page this person can't open (or that was
 * deleted) reads "Private page" and never shows a title. `label` is what
 * the chip writes back into the source (data-label), so editing a block
 * refreshes a person's stored name. */
export function mentionView(t: { mention: "user" | "page"; id: string; label: string }): {
  text: string;
  label: string;
  missing: boolean;
} {
  if (t.mention === "user") {
    const name = mentionUserName(t.id);
    const shown = name ?? (t.label || "Someone");
    return { text: `@${shown}`, label: name ?? t.label, missing: !name };
  }
  const page = mentionPage(t.id);
  if (!page && !mentionDirectoryReady()) return { text: "Page", label: "", missing: false };
  return page
    ? { text: page.title || "Untitled", label: "", missing: false }
    : { text: "Private page", label: "", missing: true };
}

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
    if (t.kind === "mention") {
      const v = mentionView(t);
      out.push(
        <span
          key={ctx.keyCounter++}
          data-o={withOffsets ? t.sourceStart : undefined}
          {...{
            [MENTION_ATTR]: `${t.mention}:${t.id}`,
            [MENTION_LABEL_ATTR]: encodeURIComponent(v.label),
          }}
          data-missing={v.missing ? "true" : undefined}
          className="gio-mention"
        >
          {v.text}
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

/** Text-node escaping, matching how the browser serialises innerHTML (it
 *  never escapes quotes in text). Using escHtml here made the editor's
 *  "did the HTML change?" check fail on every keystroke in any block with
 *  an apostrophe, so the whole block was rewritten as you typed — which
 *  flickers spellcheck and breaks autocorrect and accents. */
function escText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\u00a0/g, "&nbsp;");
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
      out += escText(buf);
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
        // The shortcode text. Still the fallback, not the export default:
        // an unresolved emoji degrades to this rather than breaking.
        out += escText(sc);
        continue;
      }
      if (opts?.emojiAs === "span") {
        // Export path: class only. The image is embedded ONCE as a base64
        // data URI in a `.e-{name}` rule emitted by toHtml, so the file is
        // self-contained AND repeated uses cost nothing. The `.emoji` rule
        // supplies the explicit box — a text-only span has no intrinsic
        // box, so a background image would render invisibly (the same trap
        // documented for <Ico> in custom-emoji.ts).
        if (opts.emojiClassNames?.has(t.name) && EMOJI_NAME_OK.test(t.name)) {
          out += `<span class="emoji e-${t.name}" role="img" aria-label="${escHtml(sc)}"></span>`;
        } else {
          out += escText(sc);
        }
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
    if (t.kind === "mention") {
      // Attribute values are a kind:uuid and an encodeURIComponent string,
      // so they need no escaping and match the browser's own serialisation
      // byte for byte (the editor compares innerHTML on every keystroke).
      const v = mentionView(t);
      out += `<span ${MENTION_ATTR}="${t.mention}:${t.id}" ${MENTION_LABEL_ATTR}="${encodeURIComponent(
        v.label,
      )}"${v.missing ? ' data-missing="true"' : ""} contenteditable="false" class="gio-mention">${escText(v.text)}</span>`;
      continue;
    }
    if (t.kind === "code") {
      out += `<code>${escText(t.text)}</code>`;
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
      /* Same class string the React renderer puts on its anchors, so the
       * two emitters cannot disagree about what a link looks like. In
       * exported HTML there is no Tailwind, so this attribute is inert and
       * exported anchors keep browser-default styling — unchanged. */
      out += `<a href="${escHtml(t.url)}" target="_blank" rel="noopener noreferrer" class="text-accent hover:underline">${tokensToHtml(t.children, opts)}</a>`;
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
