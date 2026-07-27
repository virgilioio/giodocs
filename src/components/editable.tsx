/* Editable — uncontrolled contenteditable block for the WYSIWYG editor.
 *
 * Wired in phase 2b.β as the ONLY element for top-level prose block
 * types (text, h1, h2, h3, bullet, numbered, todo, quote, callout,
 * caption, toggle-summary). Code blocks and table cells stay on
 * <textarea> / <input> — the caret shim handles both.
 *
 * The input cycle (REWRITE AND RESTORE):
 *   1. source = htmlToInlineMarkdown(el)
 *   2. caretSrc = readCaretSource(el, source)  // in SOURCE coords
 *   3. newHtml = inlineToHtml(source)
 *   4. if newHtml !== el.innerHTML:
 *        el.innerHTML = newHtml
 *        writeCaretSource(el, source, caretSrc.start, caretSrc.end)
 *   5. update lastWrittenSource (same tick as step 4, so the external-
 *      change effect does not fight us) and commit source outward.
 *
 * A per-keystroke re-render of a single block is cheap; correctness
 * (the moment "**bold**" closes it becomes bold, caret intact) is
 * the whole point of this migration.
 *
 * Placeholder: an empty block shows `placeholder` via a data attr
 * that CSS keys on (`.gio-line[data-empty="true"][data-placeholder]`).
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { htmlToInlineMarkdown } from "@/lib/inline-tokens";
import { inlineToHtml } from "@/lib/inline-markdown";
import { readCaretSource, writeCaretSource } from "@/lib/ce-offsets";

export type EditableProps = {
  source: string;
  onSourceChange: (next: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  onPaste?: (e: ClipboardEvent<HTMLDivElement>) => void;
  onFocus?: (e: FocusEvent<HTMLDivElement>) => void;
  onBlur?: (e: FocusEvent<HTMLDivElement>) => void;
  className?: string;
  locked?: boolean;
  spellCheck?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  dataAttrs?: Record<string, string>;
};

export const Editable = forwardRef<HTMLDivElement, EditableProps>(
  function Editable(props, forwardedRef) {
    const {
      source,
      onSourceChange,
      onKeyDown,
      onPaste,
      onFocus,
      onBlur,
      className,
      locked,
      spellCheck = true,
      placeholder,
      ariaLabel,
      dataAttrs,
    } = props;

    const elRef = useRef<HTMLDivElement | null>(null);
    const lastWrittenSourceRef = useRef<string | null>(null);

    useImperativeHandle(forwardedRef, () => elRef.current as HTMLDivElement, []);

    // Mount + external source-change sync. On mount, seed innerHTML
    // from source. On subsequent renders where `source` differs from
    // what we last wrote AND from what the DOM currently serialises
    // to, resync innerHTML. We do NOT try to preserve the caret across
    // an external change — the caller is authoritative about position.
    useLayoutEffect(() => {
      const el = elRef.current;
      if (!el) return;
      if (lastWrittenSourceRef.current === null) {
        el.innerHTML = inlineToHtml(source);
        lastWrittenSourceRef.current = source;
        return;
      }
      if (lastWrittenSourceRef.current === source) return;
      // If the DOM already reflects `source` (common: we just wrote
      // it inside handleInput and the state round-tripped back),
      // skip to avoid a redundant caret-blowing rewrite.
      const currentDomSource = htmlToInlineMarkdown(el);
      if (currentDomSource === source) {
        lastWrittenSourceRef.current = source;
        return;
      }
      el.innerHTML = inlineToHtml(source);
      lastWrittenSourceRef.current = source;
    }, [source]);

    // Keep the writable state honest across `locked` toggles.
    useEffect(() => {
      const el = elRef.current;
      if (!el) return;
      el.contentEditable = locked ? "false" : "true";
    }, [locked]);

    const handleInput = () => {
      const el = elRef.current;
      if (!el) return;
      const nextSource = htmlToInlineMarkdown(el);
      const caret = readCaretSource(el, nextSource);
      const newHtml = inlineToHtml(nextSource);
      if (newHtml !== el.innerHTML) {
        el.innerHTML = newHtml;
        if (caret) {
          writeCaretSource(el, nextSource, caret.start, caret.end);
        }
      }
      lastWrittenSourceRef.current = nextSource;
      onSourceChange(nextSource);
    };

    const isEmpty = source.length === 0;

    return (
      <div
        ref={elRef}
        contentEditable={locked ? false : true}
        suppressContentEditableWarning
        spellCheck={spellCheck}
        aria-label={ariaLabel}
        className={className}
        style={{ whiteSpace: "pre-wrap", outline: "none" }}
        data-empty={isEmpty ? "true" : undefined}
        data-placeholder={placeholder}
        onInput={handleInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onFocus={onFocus}
        onBlur={onBlur}
        {...(dataAttrs ?? {})}
      />
    );
  },
);
