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
 *
 * The ":" inline trigger lives here — enabled by default, disabled by
 * passing `inlineEmojiTrigger={false}` from call sites where a literal
 * ":" must not open a picker (code blocks and table cells never use
 * <Editable>, so this switch is a defensive knob rather than needed).
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { htmlToInlineMarkdown } from "@/lib/inline-tokens";
import { inlineToHtml } from "@/lib/inline-markdown";
import { liftCaretOutOfAtom, readCaretSource, writeCaretSource } from "@/lib/ce-offsets";
import { searchEmoji, shouldOpenEmojiTrigger, type Emoji } from "@/lib/emoji-data";
import { useInlineEmojiSet, type InlineEmoji } from "@/lib/emoji-registry";
import { EmojiGrid } from "./emoji-picker";
import { MentionMenu } from "./mention-menu";
import { mentionSource } from "@/lib/inline-tokens";
import {
  mentionPages,
  mentionUsers,
  useMentionDirectoryVersion,
} from "@/lib/mention-directory";
import {
  mentionCandidates,
  shouldOpenMentionTrigger,
  type MentionCandidate,
} from "@/lib/mention-trigger";
import { exitOnly } from "@/lib/exit-motion";

/* The ":" trigger lists the workspace's CUSTOM emoji first — they are
 * the vocabulary a team actually types. Picking one inserts ":name:",
 * which the shared tokenizer renders as an inline image. */
function customToEmoji(e: InlineEmoji): Emoji {
  return {
    char: `:${e.name}:`,
    name: e.name,
    keywords: e.description ? e.description.toLowerCase().split(/\s+/) : [],
    category: "symbols",
  };
}

function matchCustom(set: readonly InlineEmoji[], query: string): Emoji[] {
  const q = query.toLowerCase();
  if (!q) return [];
  return set
    .filter(
      (e) =>
        e.name.includes(q) ||
        (e.description ?? "").toLowerCase().includes(q),
    )
    .slice(0, 16)
    .map(customToEmoji);
}

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
  inlineEmojiTrigger?: boolean;
};

type MentionState = {
  at: number; // source offset of the "@"
  query: string;
  caret: number;
  rect: { top: number; left: number; bottom: number };
  highlight: number;
};

type TriggerState = {
  colon: number; // source offset of the ":" that opened this popup
  query: string;
  caret: number; // source offset of the caret (colon + 1 + query.length)
  rect: { top: number; left: number; bottom: number };
  highlight: number;
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
      inlineEmojiTrigger = true,
    } = props;

    const emojiSet = useInlineEmojiSet();
    const emojiSetRef = useRef(emojiSet);
    emojiSetRef.current = emojiSet;
    const elRef = useRef<HTMLDivElement | null>(null);
    const lastWrittenSourceRef = useRef<string | null>(null);
    const [trigger, setTrigger] = useState<TriggerState | null>(null);
    const [mention, setMention] = useState<MentionState | null>(null);
    const directoryVersion = useMentionDirectoryVersion();

    useImperativeHandle(forwardedRef, () => elRef.current as HTMLDivElement, []);

    // Mount + external source-change sync. Unchanged from α.
    useLayoutEffect(() => {
      const el = elRef.current;
      if (!el) return;
      if (lastWrittenSourceRef.current === null) {
        el.innerHTML = inlineToHtml(source);
        lastWrittenSourceRef.current = source;
        return;
      }
      if (lastWrittenSourceRef.current === source) return;
      const currentDomSource = htmlToInlineMarkdown(el);
      if (currentDomSource === source) {
        lastWrittenSourceRef.current = source;
        return;
      }
      el.innerHTML = inlineToHtml(source);
      lastWrittenSourceRef.current = source;
    }, [source]);

    useEffect(() => {
      const el = elRef.current;
      if (!el) return;
      el.contentEditable = locked ? "false" : "true";
    }, [locked]);

    // The custom-emoji set (and the names and titles @mentions show)
    // arrive asynchronously. A block rendered before they land painted
    // ":brand:" as literal text; repaint once they change, but never while
    // the caret is inside.
    useEffect(() => {
      const el = elRef.current;
      if (!el) return;
      if (el.ownerDocument?.activeElement === el) return;
      const next = inlineToHtml(source);
      if (next !== el.innerHTML) {
        el.innerHTML = next;
        lastWrittenSourceRef.current = source;
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [emojiSet, directoryVersion]);

    const caretRect = (): { top: number; left: number; bottom: number } | null => {
      const win = elRef.current?.ownerDocument?.defaultView;
      if (!win) return null;
      const sel = win.getSelection?.();
      if (!sel || sel.rangeCount === 0) return null;
      const r = sel.getRangeAt(0).getBoundingClientRect();
      // A collapsed caret in an empty inline may report 0x0; fall back to the block's rect.
      if (r.width === 0 && r.height === 0) {
        const b = elRef.current?.getBoundingClientRect();
        if (!b) return null;
        return { top: b.top, left: b.left, bottom: b.bottom };
      }
      return { top: r.top, left: r.left, bottom: r.bottom };
    };

    const evaluateTrigger = (nextSource: string) => {
      if (!inlineEmojiTrigger) return;
      const el = elRef.current;
      if (!el) return;
      const caret = readCaretSource(el, nextSource);
      if (!caret) {
        setTrigger(null);
        setMention(null);
        return;
      }
      const before = nextSource.slice(0, caret.start);
      const res = shouldOpenEmojiTrigger(before);
      if (!res.open) {
        setTrigger(null);
        evaluateMention(before, caret.start);
        return;
      }
      setMention(null);
      const found = [
        ...matchCustom(emojiSetRef.current, res.query),
        ...searchEmoji(res.query, 24),
      ];
      if (found.length === 0) {
        setTrigger(null);
        return;
      }
      const rect = caretRect();
      if (!rect) {
        setTrigger(null);
        return;
      }
      setTrigger((prev) => ({
        colon: caret.start - res.query.length - 1,
        query: res.query,
        caret: caret.start,
        rect,
        highlight: prev && prev.query === res.query ? prev.highlight : 0,
      }));
    };

    const evaluateMention = (before: string, caretAt: number) => {
      const m = shouldOpenMentionTrigger(before);
      if (!m.open) {
        setMention(null);
        return;
      }
      const rect = caretRect();
      if (!rect) {
        setMention(null);
        return;
      }
      setMention((prev) => ({
        at: m.at,
        query: m.query,
        caret: caretAt,
        // Keep the menu where it opened while you type.
        rect: prev && prev.at === m.at ? prev.rect : rect,
        highlight: prev && prev.query === m.query ? prev.highlight : 0,
      }));
    };

    // An accent (´ then a) or an IME is "composing": rewriting the DOM in the
    // middle of it cancels the composition, so wait for compositionend.
    const composingRef = useRef(false);

    const handleInput = () => {
      const el = elRef.current;
      if (!el) return;
      if (composingRef.current) return;
      // Emptying a block makes the browser leave a lone <br> behind, which
      // reads as a line break. That block is empty: treating it as text
      // stopped Backspace from removing it and left stray line breaks.
      const raw = htmlToInlineMarkdown(el);
      const nextSource = raw === "\n" ? "" : raw;
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
      evaluateTrigger(nextSource);
    };

    // The caret never rests inside an emoji or a mention chip (it would be
    // invisible and typing would go nowhere): step it to the near side.
    useEffect(() => {
      const doc = elRef.current?.ownerDocument;
      if (!doc) return;
      let prev: number | null = null;
      const onSel = () => {
        const el = elRef.current;
        if (!el || doc.activeElement !== el) {
          prev = null;
          return;
        }
        prev = liftCaretOutOfAtom(el, prev);
      };
      doc.addEventListener("selectionchange", onSel);
      return () => doc.removeEventListener("selectionchange", onSel);
    }, []);

    // Close the popup when the caret moves out of the ":query" region
    // (arrow keys, click). selectionchange fires on the document.
    useEffect(() => {
      if (!trigger) return;
      const doc = elRef.current?.ownerDocument;
      if (!doc) return;
      const onSel = () => {
        const el = elRef.current;
        if (!el) return;
        const c = readCaretSource(el, source);
        if (!c) return;
        // Still typing the same query? Let evaluateTrigger handle it.
        // If caret exited [colon+1, source.length] window, close.
        if (c.start <= trigger.colon || c.start > trigger.colon + 1 + 24) {
          setTrigger(null);
          return;
        }
        const before = source.slice(0, c.start);
        const res = shouldOpenEmojiTrigger(before);
        if (!res.open) setTrigger(null);
      };
      doc.addEventListener("selectionchange", onSel);
      return () => doc.removeEventListener("selectionchange", onSel);
    }, [trigger, source]);

    useEffect(() => {
      if (!mention) return;
      const doc = elRef.current?.ownerDocument;
      if (!doc) return;
      const onSel = () => {
        const el = elRef.current;
        if (!el) return;
        const c = readCaretSource(el, source);
        if (!c || c.start <= mention.at || c.start > mention.at + 1 + 30) {
          setMention(null);
          return;
        }
        if (!shouldOpenMentionTrigger(source.slice(0, c.start)).open) setMention(null);
      };
      doc.addEventListener("selectionchange", onSel);
      return () => doc.removeEventListener("selectionchange", onSel);
    }, [mention, source]);

    const mentionItems = useMemo<MentionCandidate[]>(
      () => (mention ? mentionCandidates(mention.query, mentionUsers(), mentionPages()) : []),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [mention?.query, mention !== null, directoryVersion],
    );

    const insertMention = (c: MentionCandidate) => {
      if (!mention) return;
      const el = elRef.current;
      if (!el) return;
      const before = source.slice(0, mention.at);
      const after = source.slice(mention.caret);
      const chip = c.kind === "user" ? mentionSource("user", c.id, c.name) : mentionSource("page", c.id, "");
      // Always a space after, so the caret has somewhere to sit and you can
      // keep typing.
      const glue = /^\s/.test(after) ? "" : " ";
      const next = before + chip + glue + after;
      el.innerHTML = inlineToHtml(next);
      lastWrittenSourceRef.current = next;
      writeCaretSource(el, next, before.length + chip.length + 1);
      setMention(null);
      onSourceChange(next);
    };

    // Custom first, then unicode — ONE flat array so keyboard highlight
    // indexes stay simple, plus the split for the section labels.
    const split = useMemo(() => {
      if (!trigger) return { custom: [] as Emoji[], uni: [] as Emoji[] };
      return {
        custom: matchCustom(emojiSet, trigger.query),
        uni: searchEmoji(trigger.query, 24),
      };
    }, [trigger, emojiSet]);
    const results = useMemo<Emoji[]>(
      () => [...split.custom, ...split.uni],
      [split],
    );

    const insertEmoji = (emoji: string) => {
      if (!trigger) return;
      const el = elRef.current;
      if (!el) return;
      const before = source.slice(0, trigger.colon);
      const after = source.slice(trigger.caret);
      const next = before + emoji + after;
      // Re-render our own DOM (uncontrolled: we can't wait for React).
      el.innerHTML = inlineToHtml(next);
      lastWrittenSourceRef.current = next;
      writeCaretSource(el, next, before.length + emoji.length);
      setTrigger(null);
      onSourceChange(next);
    };

    const onKeyDownInternal = (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      if (mention) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setMention(null);
          return;
        }
        if (mentionItems.length > 0) {
          if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            e.stopPropagation();
            const pick = mentionItems[mention.highlight] ?? mentionItems[0];
            if (pick) insertMention(pick);
            return;
          }
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            const d = e.key === "ArrowDown" ? 1 : -1;
            const n = mentionItems.length;
            setMention({ ...mention, highlight: (mention.highlight + d + n) % n });
            return;
          }
        }
      }
      if (trigger && results.length > 0) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setTrigger(null);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          e.stopPropagation();
          const pick = results[trigger.highlight] ?? results[0];
          if (pick) insertEmoji(pick.char);
          return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowRight") {
          e.preventDefault();
          e.stopPropagation();
          setTrigger({
            ...trigger,
            highlight: Math.min(results.length - 1, trigger.highlight + 1),
          });
          return;
        }
        if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
          e.preventDefault();
          e.stopPropagation();
          setTrigger({
            ...trigger,
            highlight: Math.max(0, trigger.highlight - 1),
          });
          return;
        }
      }
      onKeyDown?.(e);
    };

    const isEmpty = source.length === 0;

    return (
      <>
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
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
            handleInput();
          }}
          onKeyDown={onKeyDownInternal}
          onPaste={onPaste}
          onFocus={onFocus}
          aria-activedescendant={
            mention && mentionItems.length > 0 ? `mention-opt-${mention.highlight}` : undefined
          }
          onBlur={(e) => {
            // Defer closing so a click on the popup can insert first.
            setTimeout(() => {
              setTrigger(null);
              setMention(null);
            }, 120);
            onBlur?.(e);
          }}
          {...(dataAttrs ?? {})}
        />
        {trigger && results.length > 0 && typeof document !== "undefined"
          ? createPortal(
              <TriggerPopup
                rect={trigger.rect}
                customCount={split.custom.length}
                items={results}
                highlight={trigger.highlight}
                onPick={(em) => insertEmoji(em.char)}
                onHover={(i) =>
                  setTrigger((t) => (t ? { ...t, highlight: i } : t))
                }
              />,
              document.body,
            )
          : null}
        {mention && (mentionItems.length > 0 || mention.query.length > 0) && typeof document !== "undefined"
          ? createPortal(
              <MentionMenu
                rect={mention.rect}
                items={mentionItems}
                highlight={mention.highlight}
                query={mention.query}
                onPick={insertMention}
                onHover={(i) => setMention((m) => (m ? { ...m, highlight: i } : m))}
              />,
              document.body,
            )
          : null}
      </>
    );
  },
);

function TriggerPopup({
  rect,
  items,
  customCount,
  highlight,
  onPick,
  onHover,
}: {
  rect: { top: number; left: number; bottom: number };
  items: Emoji[];
  customCount: number;
  highlight: number;
  onPick: (e: Emoji) => void;
  onHover: (i: number) => void;
}) {
  const width = 260;
  const gap = 4;
  const estH = Math.min(240, Math.ceil(items.length / 8) * 32 + 16);
  const margin = 8;
  let top = rect.bottom + gap;
  if (top + estH + margin > window.innerHeight) {
    top = Math.max(margin, rect.top - gap - estH);
  }
  let left = rect.left;
  if (left + width + margin > window.innerWidth) {
    left = Math.max(margin, window.innerWidth - width - margin);
  }
  if (left < margin) left = margin;

  return (
    <div
      ref={exitOnly("pop")}
      // Prevent the editable's blur from firing when clicking the panel.
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        top,
        left,
        width,
        zIndex: 95,
        maxHeight: 240,
        overflowY: "auto",
      }}
      className="rounded-lg border border-line bg-surface p-1.5 shadow-popover animate-popIn"
    >
      {customCount > 0 ? (
        <>
          <div className="px-1 pb-1 pt-0.5 text-label uppercase text-faint">
            Custom
          </div>
          <EmojiGrid
            items={items.slice(0, customCount)}
            highlight={highlight}
            onPick={onPick}
            onHover={onHover}
          />
          {items.length > customCount ? (
            <div className="px-1 pb-1 pt-1.5 text-label uppercase text-faint">
              Emoji
            </div>
          ) : null}
        </>
      ) : null}
      {items.length > customCount ? (
        <EmojiGrid
          items={items.slice(customCount)}
          highlight={highlight - customCount}
          onPick={onPick}
          onHover={(i) => onHover(i + customCount)}
        />
      ) : null}
    </div>
  );
}
