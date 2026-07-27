/* Editable — uncontrolled contenteditable block for the WYSIWYG editor.
 *
 * Ships DARK in phase 2b.α: this component is not rendered anywhere
 * yet. Phase 2b.β will replace EditableBody's <textarea> with it.
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
import {
  htmlToInlineMarkdown,
  // re-exported below via inline-tokens as tokenizeInline lives there
} from "@/lib/inline-tokens";
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
      dataAttrs,
    } = props;

    const elRef = useRef<HTMLDivElement | null>(null);
    const lastWrittenSourceRef = useRef<string | null>(null);

    useImperativeHandle(forwardedRef, () => elRef.current as HTMLDivElement, []);

    // Mount: seed innerHTML once from the initial source. useLayoutEffect
    // ensures the DOM matches before any caret logic runs.
    useLayoutEffect(() => {
      const el = elRef.current;
      if (!el) return;
      if (lastWrittenSourceRef.current === null) {
        el.innerHTML = inlineToHtml(source);
        lastWrittenSourceRef.current = source;
      }
    }, [source]);

    // External source changes (undo/redo, remote patch, sibling edits).
    // If the incoming source differs from what we last wrote AND
    // differs from what the DOM currently serialises to, resync
    // innerHTML. We do NOT try to preserve the caret across an
    // external change — the caller is authoritative about position.
    useLayoutEffect(() => {
      const el = elRef.current;
      if (!el) return;
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

    return (
      <div
        ref={elRef}
        contentEditable={locked ? false : true}
        suppressContentEditableWarning
        spellCheck={spellCheck}
        className={className}
        style={{ whiteSpace: "pre-wrap", outline: "none" }}
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
