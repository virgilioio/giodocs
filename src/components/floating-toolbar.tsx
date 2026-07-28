/* Floating selection toolbar for text blocks.
 *
 * Phase 2b.β: prose blocks are contenteditable, so the toolbar
 * anchors to Range geometry and reads/writes through the caret shim.
 * ColumnStack textareas are out of scope for this phase — they simply
 * don't surface the toolbar until 2c.
 *
 * Focus-trap discipline: every button and the link field's wrapper
 * call preventDefault on mousedown so the click never blurs the
 * element and collapses the selection.
 *
 * All mutations go through toggleWrap so the shortcut path in
 * block-key-handler and the toolbar cannot drift.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toggleWrap, isWrapped } from "@/lib/toggle-wrap";
import { safeUrl } from "@/lib/inline-markdown";
import { htmlToInlineMarkdown } from "@/lib/inline-tokens";
import { readCaret, writeCaret } from "@/lib/caret-shim";

type Sel = {
  el: HTMLElement;
  start: number;
  end: number;
  /** Snapshot of the block's source at selection time. */
  value: string;
};

function isEditableProse(node: EventTarget | null): node is HTMLElement {
  if (!(node instanceof HTMLElement)) return false;
  if (!node.closest("[data-gio-page-body]")) return false;
  return node.isContentEditable;
}

function currentSource(el: HTMLElement): string {
  return htmlToInlineMarkdown(el);
}

function commitSource(el: HTMLElement, next: string, start: number, end: number) {
  // The Editable component owns the DOM. Fire an input event after we
  // stage state; its onInput handler will canonicalise the HTML and
  // restore the caret via writeCaret in source coords.
  writeCaret(el, next, start, end);
  // Rewrite the DOM to the new source so onInput serialises to it.
  // We temporarily set innerText — Editable's onInput normalises via
  // htmlToInlineMarkdown → inlineToHtml, restoring inline HTML.
  el.innerText = next;
  writeCaret(el, next, start, end);
  el.dispatchEvent(new InputEvent("input", { bubbles: true }));
  requestAnimationFrame(() => {
    try {
      el.focus({ preventScroll: true });
      writeCaret(el, next, start, end);
    } catch {
      /* noop */
    }
  });
}

function applyWrap(sel: Sel, open: string, close: string) {
  const r = toggleWrap(sel.value, sel.start, sel.end, open, close);
  commitSource(sel.el, r.text, r.start, r.end);
}

function applyLink(sel: Sel, rawUrl: string) {
  const url = safeUrl(rawUrl);
  if (!url) return false;
  const label = sel.value.slice(sel.start, sel.end);
  const insert = `[${label}](${url})`;
  const next =
    sel.value.slice(0, sel.start) + insert + sel.value.slice(sel.end);
  const newStart = sel.start + 1;
  const newEnd = newStart + label.length;
  commitSource(sel.el, next, newStart, newEnd);
  return true;
}

const NOOP_MOUSE = (e: React.MouseEvent) => e.preventDefault();

export function FloatingToolbar() {
  const [sel, setSel] = useState<Sel | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; flipped: boolean } | null>(
    null,
  );
  const [linkMode, setLinkMode] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [linkError, setLinkError] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);

  const hide = useCallback(() => {
    setSel(null);
    setPos(null);
    setLinkMode(false);
    setLinkValue("");
    setLinkError(false);
  }, []);

  /* ── Selection tracking ─────────────────────────────────────────── */

  useEffect(() => {
    function poll() {
      const active = document.activeElement;
      if (!isEditableProse(active)) {
        const t = active as Element | null;
        if (t && barRef.current && barRef.current.contains(t)) return;
        setSel(null);
        return;
      }
      const el = active as HTMLElement;
      const value = currentSource(el);
      const car = readCaret(el, value);
      if (!car || car.start === car.end) {
        setSel(null);
        return;
      }
      setSel({ el, start: car.start, end: car.end, value });
    }
    document.addEventListener("selectionchange", poll);
    document.addEventListener("focusin", poll);
    document.addEventListener("focusout", poll);
    return () => {
      document.removeEventListener("selectionchange", poll);
      document.removeEventListener("focusin", poll);
      document.removeEventListener("focusout", poll);
    };
  }, []);

  useEffect(() => {
    if (!sel) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") hide();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [sel, hide]);

  useEffect(() => {
    if (!sel) return;
    const onScroll = () => hide();
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () =>
      window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
  }, [sel, hide]);

  /* ── Position via live Range geometry ──────────────────────────── */

  useLayoutEffect(() => {
    if (!sel) {
      setPos(null);
      return;
    }
    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const rect = range ? range.getBoundingClientRect() : null;
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      setPos(null);
      return;
    }
    const bar = barRef.current;
    const barW = bar?.offsetWidth ?? 260;
    const barH = 34;
    const gap = 8;
    const centerX = rect.left + rect.width / 2;
    let left = centerX - barW / 2;
    const vw = window.innerWidth;
    if (left < 8) left = 8;
    if (left + barW > vw - 8) left = vw - 8 - barW;
    let top = rect.top - gap - barH;
    let flipped = false;
    if (top < 8) {
      top = rect.bottom + gap;
      flipped = true;
    }
    setPos({ top, left, flipped });
  }, [sel, linkMode]);

  if (!sel || !pos) return null;

  const activeBold = isWrapped(sel.value, sel.start, sel.end, "**", "**");
  const activeItalic =
    isWrapped(sel.value, sel.start, sel.end, "*", "*") && !activeBold;
  const activeUnderline = isWrapped(sel.value, sel.start, sel.end, "<u>", "</u>");
  const activeStrike = isWrapped(sel.value, sel.start, sel.end, "~~", "~~");
  const activeCode = isWrapped(sel.value, sel.start, sel.end, "`", "`");
  const activeHighlight = isWrapped(sel.value, sel.start, sel.end, "==", "==");

  const btnBase: React.CSSProperties = {
    height: 26,
    width: 26,
    display: "grid",
    placeItems: "center",
    borderRadius: 6,
    color: "var(--color-btnFg)",
    fontSize: 15,
    fontFamily: "Lato, sans-serif",
    lineHeight: 1,
    background: "transparent",
    border: 0,
    cursor: "pointer",
  };
  const activeStyle: React.CSSProperties = {
    background: "rgba(255,255,255,.18)",
    color: "var(--color-accentRing)",
  };

  function Btn({
    label,
    title,
    active,
    onPick,
    render,
  }: {
    label: string;
    title: string;
    active: boolean;
    onPick: () => void;
    render?: React.ReactNode;
  }) {
    return (
      <button
        type="button"
        aria-label={title}
        title={title}
        className="bar-btn"
        style={{ ...btnBase, ...(active ? activeStyle : null) }}
        onMouseDown={NOOP_MOUSE}
        onClick={(e) => {
          e.preventDefault();
          onPick();
        }}
      >
        {render ?? label}
      </button>
    );
  }

  const shell: React.CSSProperties = {
    position: "fixed",
    top: pos.top,
    left: pos.left,
    height: 34,
    padding: "0 4px",
    borderRadius: 9,
    background: "var(--color-btn)",
    boxShadow: "0 8px 24px rgba(13,13,9,.22)",
    color: "var(--color-btnFg)",
    zIndex: 70,
    display: "flex",
    alignItems: "center",
    gap: 2,
    animation: "var(--animate-popIn)",
  };

  const divider = (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 1,
        height: 16,
        margin: "0 4px",
        background: "rgba(255,255,255,.18)",
      }}
    />
  );

  return createPortal(
    <div
      ref={barRef}
      role="toolbar"
      aria-label="Formatting"
      data-flipped={pos.flipped ? "true" : "false"}
      style={shell}
      onMouseDown={NOOP_MOUSE}
    >
      {linkMode ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "0 2px",
          }}
          onMouseDown={NOOP_MOUSE}
        >
          <input
            autoFocus
            type="text"
            placeholder="Paste a link…"
            value={linkValue}
            onChange={(e) => {
              setLinkValue(e.target.value);
              setLinkError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (!applyLink(sel, linkValue)) {
                  setLinkError(true);
                  return;
                }
                hide();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setLinkMode(false);
                setLinkValue("");
              }
            }}
            style={{
              height: 26,
              width: 220,
              padding: "0 8px",
              background: linkError
                ? "rgba(255,80,80,.18)"
                : "rgba(255,255,255,.10)",
              color: "var(--color-btnFg)",
              border: 0,
              outline: "none",
              borderRadius: 6,
              fontSize: 13,
              fontFamily: "Lato, sans-serif",
            }}
          />
          <button
            type="button"
            className="bar-btn"
            style={{ ...btnBase, width: 44, fontSize: 13, fontWeight: 600 }}
            onMouseDown={NOOP_MOUSE}
            onClick={(e) => {
              e.preventDefault();
              if (!applyLink(sel, linkValue)) {
                setLinkError(true);
                return;
              }
              hide();
            }}
          >
            Apply
          </button>
        </div>
      ) : (
        <>
          <Btn
            label="B"
            title="Bold  ⌘B"
            active={activeBold}
            onPick={() => applyWrap(sel, "**", "**")}
            render={<span style={{ fontWeight: 700 }}>B</span>}
          />
          <Btn
            label="I"
            title="Italic  ⌘I"
            active={activeItalic}
            onPick={() => applyWrap(sel, "*", "*")}
            render={<span style={{ fontStyle: "italic", fontFamily: "serif" }}>I</span>}
          />
          <Btn
            label="U"
            title="Underline  ⌘U"
            active={activeUnderline}
            onPick={() => applyWrap(sel, "<u>", "</u>")}
            render={<span style={{ textDecoration: "underline" }}>U</span>}
          />
          <Btn
            label="S"
            title="Strikethrough  ⌘⇧X"
            active={activeStrike}
            onPick={() => applyWrap(sel, "~~", "~~")}
            render={<span style={{ textDecoration: "line-through" }}>S</span>}
          />
          <Btn
            label="<>"
            title="Code  ⌘E"
            active={activeCode}
            onPick={() => applyWrap(sel, "`", "`")}
            render={
              <span
                style={{
                  fontFamily: '"Spline Sans Mono", ui-monospace, monospace',
                  fontSize: 13,
                }}
              >
                {"<>"}
              </span>
            }
          />
          <Btn
            label="H"
            title="Highlight  ⌘⇧H"
            active={activeHighlight}
            onPick={() => applyWrap(sel, "==", "==")}
            render={
              <span
                style={{
                  background: activeHighlight ? undefined : "var(--color-highlight)",
                  color: activeHighlight ? undefined : "var(--color-noir)",
                  padding: "1px 4px",
                  borderRadius: 3,
                  fontWeight: 600,
                  fontSize: 12,
                }}
              >
                H
              </span>
            }
          />
          {divider}
          <Btn
            label="↗"
            title="Link"
            active={false}
            onPick={() => setLinkMode(true)}
            render={
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
                <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
              </svg>
            }
          />
        </>
      )}
    </div>,
    document.body,
  );
}
