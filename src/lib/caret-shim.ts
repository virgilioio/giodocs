/* caret-shim — the polymorphic caret access layer.
 *
 * Top-level block editors will be a mix of <textarea> (code blocks,
 * table cells) and contenteditable <div> (all prose blocks) once
 * phase 2b lands. Every top-level caret site goes through THIS shim
 * so a call site does not need to know which is which. Adding a
 * missed conversion at the call site is precisely the class of bug
 * the offset layer exists to prevent — the shim removes the option.
 *
 *   readCaret(el, source)
 *     → { start, end } in SOURCE (markdown) coordinates, or null
 *       when there is no selection inside `el`.
 *
 *   writeCaret(el, source, start, end?)
 *     → places the caret / selection at the given SOURCE offsets.
 *
 * Dispatch:
 *   - HTMLTextAreaElement / HTMLInputElement → selectionStart /
 *     setSelectionRange (source == value, no mapping needed).
 *   - contenteditable HTMLElement → readCaretSource /
 *     writeCaretSource from ce-offsets (mapped through the
 *     shared inline tokenizer).
 */

import { readCaretSource, writeCaretSource } from "./ce-offsets";

type TextInputEl = HTMLTextAreaElement | HTMLInputElement;

function isTextInput(el: Element): el is TextInputEl {
  const tag = el.tagName;
  return tag === "TEXTAREA" || tag === "INPUT";
}

export function readCaret(
  el: HTMLElement,
  source: string,
): { start: number; end: number } | null {
  if (isTextInput(el)) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start == null || end == null) return null;
    return { start, end };
  }
  return readCaretSource(el, source);
}

export function writeCaret(
  el: HTMLElement,
  source: string,
  start: number,
  end?: number,
): void {
  if (isTextInput(el)) {
    const s = Math.max(0, Math.min(start | 0, source.length));
    const e = Math.max(s, Math.min((end ?? start) | 0, source.length));
    el.setSelectionRange(s, e);
    return;
  }
  writeCaretSource(el, source, start, end);
}
