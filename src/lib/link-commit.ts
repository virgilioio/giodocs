/* link-commit — the ONE DOM commit path for a source rewrite of a focused
 * top-level editor.
 *
 * Why this module exists: `Editable` is deliberately uncontrolled ("we can't
 * wait for React"), so React state is only EVENTUALLY consistent with the
 * DOM. Two consequences, both of which caused shipped bugs:
 *
 *   1. Reading the block source from state and mapping DOM caret positions
 *      through it (readCaret) fails whenever the two have diverged — the read
 *      returns null and the feature silently declines. Always read the source
 *      from the LIVE element: `readEditableSource`.
 *   2. Committing through `updateBlock` alone does not rewrite the DOM while
 *      the element is focused, so the change never appears and is overwritten
 *      on blur. Write the DOM and let `Editable.handleInput` re-canonicalise:
 *      `commitSourceToEditable`.
 *
 * `paste-link.ts` stays pure/DOM-free; the DOM half lives here. Callers:
 * the three paste sites in page-editor-body.tsx and FloatingToolbar.
 */

import { htmlToInlineMarkdown } from "./inline-tokens";
import { inlineToHtml } from "./inline-markdown";
import { writeCaret } from "./caret-shim";

type TextInputEl = HTMLTextAreaElement | HTMLInputElement;

function isTextInput(el: Element): el is TextInputEl {
  return el.tagName === "TEXTAREA" || el.tagName === "INPUT";
}

/** The element's CURRENT source (markdown), read from the DOM — never state. */
export function readEditableSource(el: HTMLElement): string {
  if (isTextInput(el)) return el.value;
  return htmlToInlineMarkdown(el);
}

/** Write `text` as the element's source, render it, and restore the caret.
 *
 * The contenteditable branch writes CANONICAL HTML (`inlineToHtml(text)`)
 * directly, so the anchor/strong renders deterministically without waiting on
 * React's synthetic input round-trip. This is safe against `Editable`'s sync
 * layout effect: that effect round-trips the DOM through
 * `htmlToInlineMarkdown` and, since our HTML came from `inlineToHtml(text)`,
 * the round-trip equals `text` and the effect is a no-op. The input event is
 * still dispatched afterwards so React state commits via `onSourceChange`. */
export function commitSourceToEditable(
  el: HTMLElement,
  text: string,
  start: number,
  end: number = start,
): void {
  if (isTextInput(el)) {
    el.value = text;
  } else {
    el.innerText = text;
    try {
      writeCaret(el, text, start, end);
    } catch {
      /* noop */
    }
  }
  el.dispatchEvent(new InputEvent("input", { bubbles: true }));
  requestAnimationFrame(() => {
    try {
      el.focus({ preventScroll: true });
      writeCaret(el, text, start, end);
    } catch {
      /* noop */
    }
  });
}

