import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { nanoid } from "nanoid";
import { createPortal } from "react-dom";
import type { Block } from "@/lib/types";
import { moveBlock, moveRun, deleteIndices } from "@/lib/reorder";
import { blockToMarkdown } from "@/lib/export";
import { parseMarkdown } from "@/lib/markdown-import";
import { htmlToMarkdown } from "@/lib/html-to-markdown";
import { renderInlineWithOffsets } from "@/lib/inline-markdown";
import { numberedOrdinals } from "@/lib/blocks";
import { blockHandleFooter } from "@/lib/block-handle-footer";
import { useToast } from "@/lib/toast";
import { RowMenu, type MenuSpec, type MenuRow } from "./row-menu";




/* Editable body for a page. All blocks are auto-growing textareas
 * (or cell inputs for table). Persistence is orchestrated by the parent
 * through `onChange`, which fires on every keystroke; the parent debounces
 * and writes pages.blocks whole. Block ids are generated client-side. */

type Blk = Block & {
  id: string;
  type: BlockType;
  text?: string;
  body?: string;
  checked?: boolean;
  open?: boolean;
  icon?: string;
  rows?: string[][];
  language?: string;
};

export type BlockType =
  | "text"
  | "h1"
  | "h2"
  | "bullet"
  | "numbered"
  | "todo"
  | "toggle"
  | "quote"
  | "callout"
  | "divider"
  | "code"
  | "table";

const BLOCK_MENU: Array<{ type: BlockType; name: string; desc: string; icon: string }> = [
  { type: "text", name: "Text", desc: "Plain writing. The default.", icon: "Aa" },
  { type: "h1", name: "Heading 1", desc: "Big section title.", icon: "H1" },
  { type: "h2", name: "Heading 2", desc: "Sub-section title.", icon: "H2" },
  { type: "bullet", name: "Bullet list", desc: "Unordered points.", icon: "•" },
  { type: "numbered", name: "Numbered list", desc: "Steps, in order.", icon: "1." },
  { type: "todo", name: "To-do", desc: "A checkbox that means it.", icon: "☑" },
  { type: "toggle", name: "Toggle", desc: "Details, tucked away.", icon: "▸" },
  { type: "quote", name: "Quote", desc: "Someone said it better.", icon: "\u201D" },
  {
    type: "callout",
    name: "Callout",
    desc: "The thing people skim past — louder.",
    icon: "💡",
  },
  { type: "divider", name: "Divider", desc: "A visual breath.", icon: "—" },
  { type: "code", name: "Code", desc: "Monospace, verbatim.", icon: "<>" },
  { type: "table", name: "Table", desc: "Simple rows and columns.", icon: "▦" },
];

const CALLOUT_ICONS = ["💡", "⚠️", "✅", "❌", "ℹ️", "📌", "🔥", "⭐", "🎯", "🧠", "🚧", "🧪"];

function newBlock(type: BlockType = "text", text = ""): Blk {
  const base: Blk = { id: nanoid(10), type, text };
  if (type === "todo") base.checked = false;
  if (type === "toggle") base.open = false;
  if (type === "callout") base.icon = "💡";
  if (type === "table") base.rows = [["", "", ""], ["", "", ""]];
  return base;
}

function normalize(raw: unknown[]): Blk[] {
  if (!Array.isArray(raw)) return [];
  const out: Blk[] = [];
  for (const b of raw) {
    if (!b || typeof b !== "object" || Array.isArray(b)) continue;
    const rec = b as Record<string, unknown>;
    const type = ((rec.type as string) ?? "text") as BlockType;
    out.push({
      ...(rec as Record<string, unknown>),
      id: (rec.id as string) ?? nanoid(10),
      type,
      text: typeof rec.text === "string" ? rec.text : typeof rec.body === "string" ? (rec.body as string) : "",
      checked: !!rec.checked,
      open: !!rec.open,
      icon: typeof rec.icon === "string" ? (rec.icon as string) : undefined,
      rows: Array.isArray(rec.rows) ? (rec.rows as string[][]) : undefined,
    } as Blk);
  }
  return out;
}

/* ────────────── Auto-grow textarea hook ────────────── */

function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}

/* ────────────── Public: EditableTitle ────────────── */

export function EditableTitle({
  value,
  onChange,
  onEnter,
  autoFocus,
  topMarginClass = "mt-3",
  readOnly = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  autoFocus?: boolean;
  /** Override the default `mt-3` when rendering in an already-spaced row. */
  topMarginClass?: string;
  /** BUG 3: honour the page-appearance "Lock editing" toggle. */
  readOnly?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useAutoGrow(ref, value);
  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus();
      const end = ref.current.value.length;
      ref.current.setSelectionRange(end, end);
    }
  }, [autoFocus]);
  return (
    <textarea
      ref={ref}
      value={value}
      placeholder="Untitled"
      rows={1}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, ""))}
      onKeyDown={(e) => {
        if (readOnly) return;
        if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
          e.preventDefault();
          onEnter();
        }
      }}
      className={
        (topMarginClass ? topMarginClass + " " : "") +
        "gio-title block w-full resize-none border-0 bg-transparent p-0 font-display text-display text-noir outline-none placeholder:text-faint"
      }
      style={{ overflow: "hidden", lineHeight: 1.15 }}
      aria-label="Page title"
    />
  );
}

/* ────────────── Public: EditableBody ────────────── */

export function EditableBody({
  pageId,
  initialBlocks,
  onChange,
  onBlur,
  locked,
  editedRel,
  editorFirstName,
}: {
  pageId: string;
  initialBlocks: unknown[];
  onChange: (blocks: Blk[]) => void;
  onBlur?: () => void;
  locked?: boolean;
  editedRel?: string | null;
  editorFirstName?: string | null;
}) {
  const [blocks, setBlocks] = useState<Blk[]>(() => {
    const n = normalize(initialBlocks);
    return n.length ? n : [newBlock("text")];
  });
  // If the incoming server data changes for a different page, resync.
  const lastPage = useRef(pageId);
  useEffect(() => {
    if (lastPage.current !== pageId) {
      lastPage.current = pageId;
      const n = normalize(initialBlocks);
      setBlocks(n.length ? n : [newBlock("text")]);
    }
  }, [pageId, initialBlocks]);

  const refs = useRef<Record<string, HTMLTextAreaElement | HTMLInputElement | null>>({});
  const [focusRequest, setFocusRequest] = useState<{
    id: string;
    caret?: number | "end" | "start";
  } | null>(null);

  useEffect(() => {
    if (!focusRequest) return;
    const el = refs.current[focusRequest.id];
    if (!el) return;
    el.focus();
    if ("setSelectionRange" in el) {
      const v = (el as HTMLTextAreaElement).value;
      const c =
        focusRequest.caret === "end"
          ? v.length
          : focusRequest.caret === "start" || focusRequest.caret == null
            ? 0
            : Math.min(focusRequest.caret, v.length);
      try {
        (el as HTMLTextAreaElement).setSelectionRange(c, c);
      } catch {
        /* input types that don't support selection */
      }
    }
    setFocusRequest(null);
  }, [focusRequest, blocks]);

  const commit = useCallback(
    (next: Blk[]) => {
      setBlocks(next);
      onChange(next);
    },
    [onChange],
  );

  /* ────────── Selection & drag state ────────── */

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const anchorId = useRef<string | null>(null);
  const rowEls = useRef<Map<string, HTMLElement>>(new Map());
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [dragging, setDragging] = useState<{
    ids: string[]; // in original order
    gap: number | null; // 0..blocks.length or null while indicator hidden
    indicatorY: number | null; // relative to container top
  } | null>(null);
  const draggingRef = useRef(dragging);
  useEffect(() => {
    draggingRef.current = dragging;
  }, [dragging]);

  const registerRowEl = useCallback((id: string, el: HTMLElement | null) => {
    if (el) rowEls.current.set(id, el);
    else rowEls.current.delete(id);
  }, []);

  // Clear selection when clicking into any textarea/input.
  const clearSelection = useCallback(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
    anchorId.current = null;
  }, []);

  const handleShiftClick = useCallback(
    (id: string) => {
      const ids = blocks.map((b) => b.id);
      const targetIdx = ids.indexOf(id);
      if (targetIdx < 0) return;
      const anchor = anchorId.current;
      if (!anchor || ids.indexOf(anchor) < 0) {
        anchorId.current = id;
        setSelectedIds(new Set([id]));
        return;
      }
      const aIdx = ids.indexOf(anchor);
      const [lo, hi] = aIdx <= targetIdx ? [aIdx, targetIdx] : [targetIdx, aIdx];
      setSelectedIds(new Set(ids.slice(lo, hi + 1)));
    },
    [blocks],
  );

  const [handleMenu, setHandleMenu] = useState<{
    blockId: string;
    anchor: HTMLElement;
    spec: MenuSpec;
  } | null>(null);
  const closeHandleMenu = useCallback(() => setHandleMenu(null), []);
  const setHandleMenuSpec = useCallback((spec: MenuSpec) => {
    setHandleMenu((cur) => (cur ? { ...cur, spec } : cur));
  }, []);



  /* ────────── Drag: pointer session on a handle ────────── */

  const beginDrag = useCallback(
    (id: string, ev: React.PointerEvent<HTMLElement>) => {
      // If the handle belongs to a multi-selected run, drag the whole run.
      const ids = blocks.map((b) => b.id);
      const targetIdx = ids.indexOf(id);
      if (targetIdx < 0) return;
      const isMulti = selectedIds.size > 1 && selectedIds.has(id);
      const dragIds = isMulti
        ? ids.filter((x) => selectedIds.has(x))
        : [id];
      if (!isMulti) {
        // Non-selected drag clears any prior selection.
        setSelectedIds(new Set());
        anchorId.current = null;
      }
      try {
        ev.currentTarget.setPointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
      document.body.style.userSelect = "none";
      setDragging({ ids: dragIds, gap: null, indicatorY: null });
    },
    [blocks, selectedIds],
  );

  const computeGap = useCallback(
    (clientY: number): { gap: number; indicatorY: number } | null => {
      const container = containerRef.current;
      if (!container) return null;
      const cRect = container.getBoundingClientRect();
      const ids = blocks.map((b) => b.id);
      // For each block, look up its row element rect.
      const rects: Array<{ id: string; top: number; bottom: number; mid: number }> = [];
      for (const id of ids) {
        const el = rowEls.current.get(id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        rects.push({ id, top: r.top, bottom: r.bottom, mid: (r.top + r.bottom) / 2 });
      }
      if (rects.length === 0) return null;
      // Above the first row?
      if (clientY < rects[0].mid) {
        return { gap: 0, indicatorY: rects[0].top - cRect.top - 2 };
      }
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        const nextTop = i + 1 < rects.length ? rects[i + 1].top : r.bottom;
        if (clientY < r.mid) {
          // Between prev and this row → gap = i
          const y = ((rects[i - 1]?.bottom ?? r.top) + r.top) / 2;
          return { gap: i, indicatorY: y - cRect.top - 1 };
        }
        // pointer is past this row's mid
        const isLast = i + 1 >= rects.length;
        if (isLast) {
          return { gap: rects.length, indicatorY: r.bottom - cRect.top + 2 };
        }
        // Fall through to check next row's mid
        void nextTop;
      }
      return { gap: rects.length, indicatorY: rects[rects.length - 1].bottom - cRect.top + 2 };
    },
    [blocks],
  );

  // Auto-scroll while dragging near edges.
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const scrollDirRef = useRef<0 | 1 | -1>(0);
  const tickScroll = useCallback(() => {
    const dir = scrollDirRef.current;
    const el = scrollContainerRef.current;
    if (!el || dir === 0) {
      scrollRafRef.current = null;
      return;
    }
    el.scrollTop += dir * 8;
    scrollRafRef.current = requestAnimationFrame(tickScroll);
  }, []);

  const onPointerMove = useCallback(
    (ev: PointerEvent) => {
      if (!draggingRef.current) return;
      // Find scroll container lazily.
      if (!scrollContainerRef.current) {
        const c = containerRef.current;
        scrollContainerRef.current = c?.closest("main") ?? null;
      }
      const sc = scrollContainerRef.current;
      if (sc) {
        const r = sc.getBoundingClientRect();
        const near = 48;
        if (ev.clientY < r.top + near) scrollDirRef.current = -1;
        else if (ev.clientY > r.bottom - near) scrollDirRef.current = 1;
        else scrollDirRef.current = 0;
        if (scrollDirRef.current !== 0 && scrollRafRef.current == null) {
          scrollRafRef.current = requestAnimationFrame(tickScroll);
        }
      }
      const gap = computeGap(ev.clientY);
      if (!gap) return;
      setDragging((prev) =>
        prev ? { ...prev, gap: gap.gap, indicatorY: gap.indicatorY } : prev,
      );
    },
    [computeGap, tickScroll],
  );

  const endDrag = useCallback(
    (commitDrop: boolean) => {
      const d = draggingRef.current;
      document.body.style.userSelect = "";
      scrollDirRef.current = 0;
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
      setDragging(null);
      if (!commitDrop || !d || d.gap == null) return;
      const ids = blocks.map((b) => b.id);
      if (d.ids.length === 1) {
        const from = ids.indexOf(d.ids[0]);
        if (from < 0) return;
        const next = moveBlock(blocks, from, d.gap);
        if (next === blocks || (next.length === blocks.length && next.every((x, i) => x === blocks[i]))) return;
        commit(next);
      } else {
        const runIdxs = d.ids.map((x) => ids.indexOf(x)).filter((i) => i >= 0).sort((a, b) => a - b);
        if (runIdxs.length === 0) return;
        const runStart = runIdxs[0];
        const runEnd = runIdxs[runIdxs.length - 1];
        // Only handle contiguous runs; if selection got broken, bail.
        if (runEnd - runStart + 1 !== runIdxs.length) return;
        const next = moveRun(blocks, runStart, runEnd, d.gap);
        if (next.length === blocks.length && next.every((x, i) => x === blocks[i])) return;
        commit(next);
      }
    },
    [blocks, commit],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => onPointerMove(e);
    const onUp = () => endDrag(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        endDrag(false);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", () => endDrag(false));
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [dragging, onPointerMove, endDrag]);

  /* ────────── Document keydown: Escape / Delete for selection ────────── */

  useEffect(() => {
    if (selectedIds.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        !!target &&
        (target.tagName === "TEXTAREA" ||
          target.tagName === "INPUT" ||
          target.isContentEditable);
      if (e.key === "Escape") {
        e.preventDefault();
        clearSelection();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !inField) {
        e.preventDefault();
        const ids = blocks.map((b) => b.id);
        const toDrop = ids
          .map((id, i) => (selectedIds.has(id) ? i : -1))
          .filter((i) => i >= 0);
        const next = deleteIndices(blocks, toDrop, () => newBlock("text"));
        clearSelection();
        commit(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds, blocks, commit, clearSelection]);

  /* ────────── Copy / Cut a block selection as Markdown ────────── */

  const toast = useToast();

  useEffect(() => {
    if (selectedIds.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key !== "c" && key !== "x") return;
      const target = e.target as HTMLElement | null;
      const inField =
        !!target &&
        (target.tagName === "TEXTAREA" ||
          target.tagName === "INPUT" ||
          target.isContentEditable);
      if (inField) return; // native copy stays intact inside text
      e.preventDefault();
      const selected = blocks.filter((b) => selectedIds.has(b.id));
      const md = selected.map(blockToMarkdown).join("\n\n");
      const write = navigator.clipboard?.writeText?.(md);
      const after = () => {
        toast.push(
          `Copied ${selected.length} ${selected.length === 1 ? "block" : "blocks"} as Markdown`,
        );
        if (key === "x" && !locked) {
          const ids = blocks.map((b) => b.id);
          const toDrop = ids
            .map((id, i) => (selectedIds.has(id) ? i : -1))
            .filter((i) => i >= 0);
          const next = deleteIndices(blocks, toDrop, () => newBlock("text"));
          clearSelection();
          commit(next);
        }
      };
      if (write && typeof (write as Promise<void>).then === "function") {
        (write as Promise<void>).then(after).catch(() => after());
      } else {
        after();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds, blocks, commit, clearSelection, locked, toast]);

  /* ────────── Paste Markdown → real blocks ──────────
   * Inverse of the copy path above. If the pasted text has no newline and
   * no markdown markers, we DO NOTHING and let the browser paste it as
   * ordinary text (undo history stays intact). Otherwise we splice parsed
   * blocks at the caret — or replace the current block-selection run. */
  const handlePaste = useCallback(
    (blockId: string, e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (locked) return;
      const raw = e.clipboardData?.getData("text/plain") ?? "";
      if (!raw) return;
      const hasNewline = /\r|\n/.test(raw);
      const hasMdMarker = /(^|\n)\s*(#{1,6} |[-*+] |\d+\. |> |```|---|\*\*\*|\|)/.test(
        raw,
      );
      if (!hasNewline && !hasMdMarker) return; // plain word — let browser handle
      e.preventDefault();

      const parsed = parseMarkdown(raw) as unknown as Blk[];
      if (parsed.length === 0) return;

      const idx = blocks.findIndex((b) => b.id === blockId);
      if (idx === -1) return;

      let next: Blk[];
      let focusId = parsed[parsed.length - 1].id;

      // If a block-selection is active, replace the selected run.
      if (selectedIds.size > 0) {
        const keep: Blk[] = [];
        let inserted = false;
        for (const b of blocks) {
          if (selectedIds.has(b.id)) {
            if (!inserted) {
              keep.push(...parsed);
              inserted = true;
            }
          } else {
            keep.push(b);
          }
        }
        if (!inserted) keep.push(...parsed);
        next = keep.length ? keep : [newBlock("text")];
        clearSelection();
      } else {
        // Splice at caret within the target block.
        const ta = e.currentTarget as HTMLTextAreaElement;
        const caret = ta.selectionStart ?? (blocks[idx].text ?? "").length;
        const cur = blocks[idx];
        const full = cur.text ?? "";
        const before = full.slice(0, caret);
        const after = full.slice(caret);
        const head = [...blocks.slice(0, idx)];
        const tail = [...blocks.slice(idx + 1)];
        const inserts: Blk[] = [...parsed];

        // If current block is empty AND untouched, replace it — do not
        // leave a blank above the pasted content.
        if (full === "") {
          next = [...head, ...inserts, ...tail];
        } else {
          const currentPatched: Blk = { ...cur, text: before };
          const trailing: Blk[] = after
            ? [{ id: nanoid(10), type: "text", text: after } as Blk]
            : [];
          next = [...head, currentPatched, ...inserts, ...trailing, ...tail];
        }
      }

      commit(next);
      setFocusRequest({ id: focusId, caret: "end" });
      if (parsed.length > 1) toast.push(`Pasted ${parsed.length} blocks`);
    },
    [blocks, commit, locked, selectedIds, clearSelection, toast],
  );


  /* ────────── Marquee selection ────────── */

  const [marquee, setMarquee] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const marqueeRef = useRef<{
    active: boolean;
    originX: number;
    originY: number;
    originTarget: HTMLElement | null;
    moved: boolean;
  } | null>(null);
  const marqueeScrollDirRef = useRef<0 | 1 | -1>(0);
  const marqueeScrollRafRef = useRef<number | null>(null);

  const tickMarqueeScroll = useCallback(() => {
    const dir = marqueeScrollDirRef.current;
    const sc = scrollContainerRef.current;
    if (!sc || dir === 0) {
      marqueeScrollRafRef.current = null;
      return;
    }
    sc.scrollTop += dir * 8;
    marqueeScrollRafRef.current = requestAnimationFrame(tickMarqueeScroll);
  }, []);

  const selectByMarqueeY = useCallback((y1: number, y2: number) => {
    const top = Math.min(y1, y2);
    const bot = Math.max(y1, y2);
    const ids = new Set<string>();
    rowEls.current.forEach((el, id) => {
      const r = el.getBoundingClientRect();
      if (r.bottom >= top && r.top <= bot) ids.add(id);
    });
    setSelectedIds(ids);
  }, []);

  const onBelowClickRef = useRef<() => void>(() => {});

  const handleContainerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement;
      if (
        t.closest(
          "textarea, input, button, [data-slash-menu], [data-block-handle]",
        )
      ) {
        return;
      }
      // If a drag is in progress, do not start a marquee session.
      if (draggingRef.current) return;
      marqueeRef.current = {
        active: true,
        originX: e.clientX,
        originY: e.clientY,
        originTarget: t,
        moved: false,
      };
    },
    [],
  );

  useEffect(() => {
    const onMove = (ev: PointerEvent) => {
      const m = marqueeRef.current;
      if (!m || !m.active) return;
      const dx = ev.clientX - m.originX;
      const dy = ev.clientY - m.originY;
      if (!m.moved && Math.hypot(dx, dy) < 4) return;
      if (!m.moved) {
        m.moved = true;
        setSelectedIds(new Set());
        anchorId.current = null;
        document.body.style.userSelect = "none";
      }
      if (!scrollContainerRef.current) {
        scrollContainerRef.current = containerRef.current?.closest("main") ?? null;
      }
      const sc = scrollContainerRef.current;
      if (sc) {
        const r = sc.getBoundingClientRect();
        const near = 48;
        if (ev.clientY < r.top + near) marqueeScrollDirRef.current = -1;
        else if (ev.clientY > r.bottom - near) marqueeScrollDirRef.current = 1;
        else marqueeScrollDirRef.current = 0;
        if (
          marqueeScrollDirRef.current !== 0 &&
          marqueeScrollRafRef.current == null
        ) {
          marqueeScrollRafRef.current = requestAnimationFrame(tickMarqueeScroll);
        }
      }
      setMarquee({ x1: m.originX, y1: m.originY, x2: ev.clientX, y2: ev.clientY });
      selectByMarqueeY(m.originY, ev.clientY);
    };
    const onUp = () => {
      const m = marqueeRef.current;
      if (!m || !m.active) return;
      marqueeRef.current = null;
      marqueeScrollDirRef.current = 0;
      if (marqueeScrollRafRef.current != null) {
        cancelAnimationFrame(marqueeScrollRafRef.current);
        marqueeScrollRafRef.current = null;
      }
      document.body.style.userSelect = "";
      if (m.moved) {
        setMarquee(null);
        return;
      }
      // Click branch (no drag past threshold).
      setMarquee(null);
      const t = m.originTarget;
      if (!t) return;
      // Trailing zone → append/focus a text block.
      if (t.closest("[data-trailing-zone]")) {
        onBelowClickRef.current();
        return;
      }
      // No-editor block row (e.g. divider) → select just that block.
      const noEditor = t.closest("[data-block-no-editor='true']") as HTMLElement | null;
      if (noEditor) {
        const id = noEditor.getAttribute("data-block-id");
        if (id) {
          anchorId.current = id;
          setSelectedIds(new Set([id]));
          return;
        }
      }
      // Otherwise: clear any existing selection.
      setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
      anchorId.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [selectByMarqueeY, tickMarqueeScroll]);

  /* ────────── Slash menu state ────────── */

  const [slash, setSlash] = useState<{
    blockId: string;
    query: string;
    x: number;
    y: number;
  } | null>(null);

  const filteredMenu = useMemo(() => {
    const q = (slash?.query ?? "").toLowerCase().trim();
    if (!q) return BLOCK_MENU;
    return BLOCK_MENU.filter(
      (m) => m.name.toLowerCase().includes(q) || m.type.includes(q),
    );
  }, [slash]);
  const [menuIdx, setMenuIdx] = useState(0);
  useEffect(() => setMenuIdx(0), [slash?.query]);

  const closeSlash = useCallback(() => setSlash(null), []);

  const applyType = useCallback(
    (blockId: string, type: BlockType) => {
      const idx = blocks.findIndex((b) => b.id === blockId);
      if (idx === -1) return;
      const prev = blocks[idx];
      // Strip the "/query" from the text.
      const t = (prev.text ?? "");
      const slashPos = t.lastIndexOf("/");
      const stripped = slashPos >= 0 ? t.slice(0, slashPos) : t;
      const nb: Blk = { ...prev, type, text: stripped };
      if (type === "todo" && nb.checked == null) nb.checked = false;
      if (type === "toggle" && nb.open == null) nb.open = false;
      if (type === "callout" && !nb.icon) nb.icon = "💡";
      if (type === "table" && !nb.rows) nb.rows = [["", "", ""], ["", "", ""]];
      if (type === "divider") nb.text = "";
      const next = [...blocks];
      next[idx] = nb;
      // Divider is caret-less; move focus to a new text block after it.
      if (type === "divider") {
        const spawn = newBlock("text");
        next.splice(idx + 1, 0, spawn);
        commit(next);
        setSlash(null);
        setFocusRequest({ id: spawn.id, caret: "end" });
        return;
      }
      commit(next);
      setSlash(null);
      setFocusRequest({ id: blockId, caret: stripped.length });
    },
    [blocks, commit],
  );

  /* ────────── Block-handle menu: run ops (Move up/down, Duplicate, Delete, Copy link) ────────── */

  const getRunIndicesForBlock = useCallback(
    (blockId: string): number[] => {
      const ids = blocks.map((b) => b.id);
      const idx = ids.indexOf(blockId);
      if (idx < 0) return [];
      if (selectedIds.has(blockId) && selectedIds.size > 1) {
        return ids
          .map((id, i) => (selectedIds.has(id) ? i : -1))
          .filter((i) => i >= 0)
          .sort((a, b) => a - b);
      }
      return [idx];
    },
    [blocks, selectedIds],
  );

  const runMoveUp = useCallback(
    (blockId: string) => {
      const run = getRunIndicesForBlock(blockId);
      if (!run.length || run[0] === 0) return;
      const runStart = run[0];
      const runEnd = run[run.length - 1];
      const next =
        run.length === 1
          ? moveBlock(blocks, runStart, runStart - 1)
          : moveRun(blocks, runStart, runEnd, runStart - 1);
      commit(next);
    },
    [blocks, commit, getRunIndicesForBlock],
  );

  const runMoveDown = useCallback(
    (blockId: string) => {
      const run = getRunIndicesForBlock(blockId);
      if (!run.length) return;
      const runStart = run[0];
      const runEnd = run[run.length - 1];
      if (runEnd >= blocks.length - 1) return;
      const next =
        run.length === 1
          ? moveBlock(blocks, runStart, runStart + 1)
          : moveRun(blocks, runStart, runEnd, runEnd + 2);
      commit(next);
    },
    [blocks, commit, getRunIndicesForBlock],
  );

  const runDuplicate = useCallback(
    (blockId: string) => {
      const run = getRunIndicesForBlock(blockId);
      if (!run.length) return;
      const runEnd = run[run.length - 1];
      const copies: Blk[] = run.map((i) => ({ ...blocks[i], id: nanoid(10) }));
      const next = [...blocks];
      next.splice(runEnd + 1, 0, ...copies);
      commit(next);
    },
    [blocks, commit, getRunIndicesForBlock],
  );

  const runDelete = useCallback(
    (blockId: string) => {
      const run = getRunIndicesForBlock(blockId);
      if (!run.length) return;
      const next = deleteIndices(blocks, run, () => newBlock("text"));
      clearSelection();
      commit(next);
    },
    [blocks, commit, clearSelection, getRunIndicesForBlock],
  );

  const runTurnInto = useCallback(
    (blockId: string, type: BlockType) => {
      const run = getRunIndicesForBlock(blockId);
      if (!run.length) return;
      const next = [...blocks];
      for (const i of run) {
        const prev = next[i];
        const nb: Blk = { ...prev, type };
        if (type === "todo" && nb.checked == null) nb.checked = false;
        if (type === "toggle" && nb.open == null) nb.open = false;
        if (type === "callout" && !nb.icon) nb.icon = "💡";
        if (type === "table" && !nb.rows) nb.rows = [["", "", ""], ["", "", ""]];
        if (type === "divider") nb.text = "";
        next[i] = nb;
      }
      commit(next);
    },
    [blocks, commit, getRunIndicesForBlock],
  );

  const copyBlockLink = useCallback(
    (blockId: string) => {
      const run = getRunIndicesForBlock(blockId);
      const firstId = run.length ? blocks[run[0]].id : blockId;
      const url = `${window.location.origin}/p/${pageId}#${firstId}`;
      const write = navigator.clipboard?.writeText?.(url);
      const after = () => toast.push("Link copied");
      if (write && typeof (write as Promise<void>).then === "function") {
        (write as Promise<void>).then(after).catch(() => after());
      } else after();
    },
    [blocks, pageId, toast, getRunIndicesForBlock],
  );

  // ⌘D duplicates the current block or the selection run.
  useEffect(() => {
    if (locked) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "d") return;
      const target = e.target as HTMLElement | null;
      const inField =
        !!target &&
        (target.tagName === "TEXTAREA" ||
          target.tagName === "INPUT" ||
          target.isContentEditable);
      let anchorId: string | null = null;
      if (selectedIds.size > 0) {
        anchorId = blocks.find((b) => selectedIds.has(b.id))?.id ?? null;
      } else if (inField) {
        const row = (target as HTMLElement).closest(
          "[data-block-id]",
        ) as HTMLElement | null;
        anchorId = row?.dataset.blockId ?? null;
      }
      if (!anchorId) return;
      e.preventDefault();
      runDuplicate(anchorId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, blocks, selectedIds, runDuplicate]);

  const buildBlockHandleSpec = useCallback(
    (
      blockId: string,
      mctx: { setSpec: (s: MenuSpec) => void; close: () => void },
    ): MenuSpec => {
      const run = getRunIndicesForBlock(blockId);
      const runStart = run[0] ?? 0;
      const runEnd = run[run.length - 1] ?? 0;
      const isMulti = run.length > 1;
      const target = blocks[runStart];
      const targetName =
        BLOCK_MENU.find((m) => m.type === target?.type)?.name ??
        target?.type ??
        "Block";
      const title = isMulti ? `${run.length} blocks` : targetName;
      const atTop = runStart === 0;
      const atEnd = runEnd >= blocks.length - 1;

      const turnIntoSub: MenuRow[] = BLOCK_MENU.map((m) => ({
        kind: "row",
        label: m.name,
        icon: "layout",
        onPick: () => {
          runTurnInto(blockId, m.type);
          mctx.close();
        },
      }));

      const rows: MenuRow[] = [
        {
          kind: "row",
          label: "Turn into",
          icon: "layout",
          hint: { text: "›" },
          onPick: () =>
            mctx.setSpec({ title: "Turn into", rows: turnIntoSub }),
        },
        { kind: "sep" },
        {
          kind: "row",
          label: "Duplicate",
          icon: "dup",
          hint: { text: "⌘D", mono: true },
          onPick: () => {
            runDuplicate(blockId);
            mctx.close();
          },
        },
        {
          kind: "row",
          label: "Copy link to block",
          icon: "link",
          hint: { text: "⌘⌥L", mono: true },
          onPick: () => {
            copyBlockLink(blockId);
            mctx.close();
          },
        },
        { kind: "sep" },
        {
          kind: "row",
          label: "Move up",
          icon: "chevUp",
          hint: atTop ? { text: "at top" } : undefined,
          onPick: () => {
            runMoveUp(blockId);
            mctx.close();
          },
        },
        {
          kind: "row",
          label: "Move down",
          icon: "chevDown",
          hint: atEnd ? { text: "at end" } : undefined,
          onPick: () => {
            runMoveDown(blockId);
            mctx.close();
          },
        },
        { kind: "sep" },
        {
          kind: "row",
          label: "Delete",
          icon: "trash",
          danger: true,
          onPick: () => {
            runDelete(blockId);
            mctx.close();
          },
        },
      ];

      const footer = blockHandleFooter({
        editedRel: editedRel ?? null,
        firstName: editorFirstName ?? null,
      });

      return {
        title,
        rows,
        ...(footer ? { footer } : {}),
      };
    },
    [
      blocks,
      copyBlockLink,
      editedRel,
      editorFirstName,
      getRunIndicesForBlock,
      runDelete,
      runDuplicate,
      runMoveDown,
      runMoveUp,
      runTurnInto,
    ],
  );



  /* ────────── Per-block ops ────────── */

  function updateBlock(id: string, patch: Partial<Blk>) {
    const next = blocks.map((b) => (b.id === id ? { ...b, ...patch } : b));
    commit(next);
  }

  function insertAfter(id: string, type: BlockType = "text") {
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx === -1) return;
    const spawn = newBlock(type);
    const next = [...blocks];
    next.splice(idx + 1, 0, spawn);
    commit(next);
    setFocusRequest({ id: spawn.id, caret: "start" });
  }

  function removeBlock(id: string, focusPrev = true) {
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx === -1) return;
    const next = blocks.filter((b) => b.id !== id);
    if (!next.length) {
      const only = newBlock("text");
      commit([only]);
      setFocusRequest({ id: only.id, caret: "start" });
      return;
    }
    commit(next);
    if (focusPrev) {
      const before = blocks[Math.max(0, idx - 1)];
      if (before) setFocusRequest({ id: before.id, caret: "end" });
    }
  }

  function splitBlock(id: string, caret: number) {
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx === -1) return;
    const cur = blocks[idx];
    const t = cur.text ?? "";
    const left = t.slice(0, caret);
    const right = t.slice(caret);
    const inheritTypes: BlockType[] = ["bullet", "numbered", "todo"];
    const newType: BlockType = inheritTypes.includes(cur.type) ? cur.type : "text";
    const spawn = newBlock(newType, right);
    if (newType === "todo") spawn.checked = false;
    const next = [...blocks];
    next[idx] = { ...cur, text: left };
    next.splice(idx + 1, 0, spawn);
    commit(next);
    setFocusRequest({ id: spawn.id, caret: "start" });
  }

  function convertToText(id: string) {
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx === -1) return;
    const cur = blocks[idx];
    const next = [...blocks];
    next[idx] = { ...cur, type: "text", checked: undefined, open: undefined };
    commit(next);
    setFocusRequest({ id, caret: "start" });
  }

  function mergeIntoPrev(id: string) {
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx <= 0) return; // nothing to merge into
    const prev = blocks[idx - 1];
    const cur = blocks[idx];
    const prevText = prev.text ?? "";
    const merged = prevText + (cur.text ?? "");
    const next = [...blocks];
    next[idx - 1] = { ...prev, text: merged };
    next.splice(idx, 1);
    commit(next);
    setFocusRequest({ id: prev.id, caret: prevText.length });
  }

  function focusRelative(id: string, delta: -1 | 1, caret: "end" | "start" | number = 0) {
    const idx = blocks.findIndex((b) => b.id === id);
    const target = blocks[idx + delta];
    if (!target) return;
    setFocusRequest({ id: target.id, caret });
  }


  /* ────────── Markdown shortcuts on input ────────── */
  function tryMarkdown(id: string, val: string): boolean {
    const map: Array<{ pat: RegExp; type: BlockType }> = [
      { pat: /^# $/, type: "h1" },
      { pat: /^## $/, type: "h2" },
      { pat: /^- $/, type: "bullet" },
      { pat: /^1\. $/, type: "numbered" },
      { pat: /^\[\] $/, type: "todo" },
      { pat: /^\[ \] $/, type: "todo" },
      { pat: /^> $/, type: "quote" },
      { pat: /^``` $/, type: "code" },
    ];
    const cur = blocks.find((b) => b.id === id);
    if (!cur || cur.type !== "text") return false;
    for (const m of map) {
      if (m.pat.test(val)) {
        const nb: Blk = { ...cur, type: m.type, text: "" };
        if (m.type === "todo") nb.checked = false;
        const next = blocks.map((b) => (b.id === id ? nb : b));
        commit(next);
        setFocusRequest({ id, caret: "start" });
        return true;
      }
    }
    return false;
  }

  /* ────────── Click below last block: focus it, or append a new one ────────── */
  function onBelowClick() {
    if (locked) return;
    const last = blocks[blocks.length - 1];
    if (!last) {
      const only = newBlock("text");
      commit([only]);
      setFocusRequest({ id: only.id, caret: "end" });
      return;
    }
    if ((last.text ?? "") === "" && last.type === "text") {
      setFocusRequest({ id: last.id, caret: "end" });
      return;
    }
    const spawn = newBlock("text");
    commit([...blocks, spawn]);
    setFocusRequest({ id: spawn.id, caret: "start" });
  }
  // Expose to the marquee handler so a no-drag click on the trailing zone appends.
  useEffect(() => {
    onBelowClickRef.current = onBelowClick;
  });


  const draggingIdSet = useMemo(
    () => new Set(dragging?.ids ?? []),
    [dragging],
  );
  const runIdxs = useMemo(() => {
    if (!dragging || dragging.ids.length < 2) return null;
    const ids = blocks.map((b) => b.id);
    const idxs = dragging.ids
      .map((x) => ids.indexOf(x))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    return idxs.length ? { start: idxs[0], end: idxs[idxs.length - 1] } : null;
  }, [dragging, blocks]);
  // Hide indicator when a run drop would land inside the run.
  const indicatorVisible =
    dragging &&
    dragging.gap != null &&
    dragging.indicatorY != null &&
    (runIdxs
      ? dragging.gap < runIdxs.start || dragging.gap > runIdxs.end + 1
      : (() => {
          const from = blocks.findIndex((b) => b.id === dragging.ids[0]);
          return from < 0 ? true : dragging.gap !== from && dragging.gap !== from + 1;
        })());

  const ordinalMap = useMemo(() => numberedOrdinals(blocks), [blocks]);

  return (
    <div
      ref={containerRef}
      className="gio-page-body relative space-y-1"
      onPointerDown={handleContainerPointerDown}
      onFocusCapture={(e) => {
        const t = e.target as HTMLElement;
        if (t.tagName === "TEXTAREA" || t.tagName === "INPUT") clearSelection();
      }}
    >

      {blocks.map((b) => (
        <BlockRow
          key={b.id}
          block={b}
          ordinal={b.type === "numbered" ? (ordinalMap.get(b.id) ?? 1) : undefined}
          locked={!!locked}
          selected={selectedIds.has(b.id)}
          dimmed={draggingIdSet.has(b.id)}
          registerRowEl={registerRowEl}
          onHandlePointerDown={(ev) => beginDrag(b.id, ev)}
          onHandleClick={(anchor) => {
            const initial = buildBlockHandleSpec(b.id, {
              setSpec: setHandleMenuSpec,
              close: closeHandleMenu,
            });
            setHandleMenu({ blockId: b.id, anchor, spec: initial });
          }}
          onHandleShiftClick={() => handleShiftClick(b.id)}
          onBlur={onBlur}
          registerRef={(el) => {
            if (el) refs.current[b.id] = el;
            else delete refs.current[b.id];
          }}
          onChange={(patch) => updateBlock(b.id, patch)}
          onInput={(val) => {
            if (tryMarkdown(b.id, val)) return;
            const el = refs.current[b.id] as HTMLTextAreaElement | undefined;
            const caret = el?.selectionStart ?? val.length;
            const before = val.slice(0, caret);
            const slashPos = before.lastIndexOf("/");
            const openable =
              slashPos >= 0 && !/\s/.test(before.slice(slashPos + 1));
            if (openable) {
              const rect = el?.getBoundingClientRect();
              setSlash({
                blockId: b.id,
                query: before.slice(slashPos + 1),
                x: rect ? rect.left : 200,
                y: rect ? rect.bottom + 4 : 200,
              });
            } else if (slash?.blockId === b.id) {
              setSlash(null);
            }
          }}
          onKeyDown={(e) => {
            if (locked) return;
            const el = e.currentTarget as HTMLTextAreaElement;
            const v = el.value;
            const ss = el.selectionStart ?? 0;
            const se = el.selectionEnd ?? 0;

            if (slash?.blockId === b.id) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setMenuIdx((i) => Math.min(filteredMenu.length - 1, i + 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setMenuIdx((i) => Math.max(0, i - 1));
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                const picked = filteredMenu[menuIdx];
                if (picked) applyType(b.id, picked.type);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setSlash(null);
                return;
              }
            }

            if (e.key === "Escape") {
              e.preventDefault();
              el.blur();
              return;
            }

            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              const isEmptyListLike =
                (b.type === "bullet" || b.type === "numbered" || b.type === "todo") &&
                (b.text ?? "") === "";
              if (isEmptyListLike) {
                convertToText(b.id);
                return;
              }
              splitBlock(b.id, ss);
              return;
            }

            if (e.key === "Backspace" && ss === 0 && se === 0) {
              if (b.type !== "text") {
                e.preventDefault();
                convertToText(b.id);
                return;
              }
              if ((b.text ?? "") === "") {
                e.preventDefault();
                removeBlock(b.id, true);
                return;
              }
              e.preventDefault();
              mergeIntoPrev(b.id);
              return;
            }

            if (e.key === "ArrowUp") {
              const before = v.slice(0, ss);
              if (!before.includes("\n")) {
                e.preventDefault();
                focusRelative(b.id, -1, "end");
              }
              return;
            }
            if (e.key === "ArrowDown") {
              const after = v.slice(se);
              if (!after.includes("\n")) {
                e.preventDefault();
                focusRelative(b.id, 1, "start");
              }
              return;
            }
          }}
          onAddBelow={() => { if (!locked) insertAfter(b.id); }}
          onSetIcon={(icon) => updateBlock(b.id, { icon })}
          onPaste={(e) => handlePaste(b.id, e)}
        />
      ))}

      {/* Drop indicator */}
      {indicatorVisible ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: dragging!.indicatorY!,
            height: 2,
            background: "var(--color-accentDot)",
            borderRadius: 1,
            pointerEvents: "none",
            zIndex: 40,
          }}
        />
      ) : null}

      {/* Trailing click zone — the container-level pointer session decides
       * whether this was a click (append/focus a block) or a marquee. */}
      <div aria-hidden data-trailing-zone style={{ minHeight: 240 }} />

      {/* Marquee rectangle */}
      {marquee
        ? createPortal(
            <div
              aria-hidden
              className="marquee-rect"
              style={{
                left: Math.min(marquee.x1, marquee.x2),
                top: Math.min(marquee.y1, marquee.y2),
                width: Math.abs(marquee.x2 - marquee.x1),
                height: Math.abs(marquee.y2 - marquee.y1),
              }}
            />,
            document.body,
          )
        : null}


      {slash ? (
        <SlashMenu
          x={slash.x}
          y={slash.y}
          items={filteredMenu}
          activeIdx={menuIdx}
          onHover={setMenuIdx}
          onPick={(t) => applyType(slash.blockId, t)}
          onClose={closeSlash}
        />
      ) : null}

      {selectedIds.size > 0 && !locked
        ? createPortal(
            <div
              role="status"
              aria-live="polite"
              className="animate-toastUp"
              style={{
                position: "fixed",
                bottom: 24,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 80,
                background: "var(--color-noir)",
                color: "var(--color-track)",
                borderRadius: 14,
                padding: "10px 12px 10px 16px",
                boxShadow: "var(--shadow-toast)",
                display: "flex",
                alignItems: "center",
                gap: 12,
                fontSize: 13.5,
              }}
            >
              <span>
                <strong>{selectedIds.size}</strong>{" "}
                {selectedIds.size === 1 ? "block" : "blocks"} selected · drag any
                handle to move them together
              </span>
              <button
                type="button"
                onClick={() => {
                  const ids = blocks.map((b) => b.id);
                  const toDrop = ids
                    .map((id, i) => (selectedIds.has(id) ? i : -1))
                    .filter((i) => i >= 0);
                  const next = deleteIndices(blocks, toDrop, () => newBlock("text"));
                  clearSelection();
                  commit(next);
                }}
                className="bar-btn rounded-md px-2 py-1"
                style={{ color: "var(--color-track)", fontWeight: 600 }}
              >
                Delete
              </button>
              <button
                type="button"
                aria-label="Dismiss selection"
                onClick={clearSelection}
                className="bar-btn grid h-6 w-6 place-items-center rounded-md"
                style={{ color: "var(--color-track)" }}
              >
                ×
              </button>
            </div>,
            document.body,
          )
        : null}
      {handleMenu ? (
        <RowMenu
          spec={handleMenu.spec}
          anchor={handleMenu.anchor}
          onClose={closeHandleMenu}
        />
      ) : null}
    </div>
  );
}

/* ────────────── One row: gutter + block ────────────── */

function BlockRow({
  block,
  ordinal,
  locked,
  selected,
  dimmed,
  registerRowEl,
  onHandlePointerDown,
  onHandleClick,
  onHandleShiftClick,
  onBlur,
  registerRef,
  onChange,
  onInput,
  onKeyDown,
  onAddBelow,
  onSetIcon,
  onPaste,
}: {
  block: Blk;
  ordinal?: number;
  locked: boolean;
  selected: boolean;
  dimmed: boolean;
  registerRowEl: (id: string, el: HTMLElement | null) => void;
  onHandlePointerDown: (ev: React.PointerEvent<HTMLElement>) => void;
  onHandleClick: (anchor: HTMLElement) => void;
  onHandleShiftClick: () => void;
  onBlur?: () => void;
  registerRef: (el: HTMLTextAreaElement | HTMLInputElement | null) => void;
  onChange: (patch: Partial<Blk>) => void;
  onInput: (val: string) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  onAddBelow: () => void;
  onSetIcon: (icon: string) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
}) {
  const noEditor = block.type === "divider";
  return (
    <div
      ref={(el) => registerRowEl(block.id, el)}
      data-block-id={block.id}
      data-block-no-editor={noEditor ? "true" : undefined}
      className="group relative -ml-[42px] pl-[42px]"
      style={{
        opacity: dimmed ? 0.45 : undefined,
        background: selected ? "var(--color-blueTint)" : undefined,
        boxShadow: selected ? "0 0 0 4px var(--color-blueTint)" : undefined,
        borderRadius: selected ? 4 : undefined,
        cursor: noEditor ? "pointer" : undefined,
        transition: "background 120ms ease, box-shadow 120ms ease",
      }}
    >

      {(
        <div
          className="gio-block-gutter pointer-events-none absolute top-0 flex select-none items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover:pointer-events-auto group-hover:opacity-100"
          style={{
            left: 0,
            height: 32,
            width: 39,
            opacity: selected ? 1 : undefined,
            pointerEvents: selected ? "auto" : undefined,
          }}
        >
          <button
            type="button"
            aria-label="Insert block below"
            title="Add block below"
            onClick={onAddBelow}
            className="grid h-6 w-6 place-items-center rounded-md text-faint hover:bg-sunken hover:text-muted"
          >
            +
          </button>
          <button
            type="button"
            aria-label="Drag to reorder"
            title="Drag to reorder · shift-click to select range"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              // Shift-click selects a contiguous range and does NOT start a drag.
              if (e.shiftKey) return;
              onHandlePointerDown(e);
            }}
            onClick={(e) => {
              if (e.shiftKey) {
                e.preventDefault();
                onHandleShiftClick();
                return;
              }
              // Plain click: open the block-handle menu anchored to this button.
              onHandleClick(e.currentTarget as HTMLElement);
            }}
            className={
              "grid h-6 w-6 place-items-center rounded-md hover:bg-sunken " +
              (selected ? "text-blueInk" : "text-faint hover:text-muted")
            }
            style={{
              cursor: "grab",
              touchAction: "none",
            }}
          >
            ⋮⋮
          </button>
        </div>
      )}

      <BlockContent
        block={block}
        ordinal={ordinal}
        locked={locked}
        onBlur={onBlur}
        registerRef={registerRef}
        onChange={onChange}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onSetIcon={onSetIcon}
        onPaste={onPaste}
      />
    </div>
  );
}


function BlockContent({
  block,
  ordinal,
  locked,
  onBlur,
  registerRef,
  onChange,
  onInput,
  onKeyDown,
  onSetIcon,
  onPaste,
}: {
  block: Blk;
  ordinal?: number;
  locked: boolean;
  onBlur?: () => void;
  registerRef: (el: HTMLTextAreaElement | HTMLInputElement | null) => void;
  onChange: (patch: Partial<Blk>) => void;
  onInput: (val: string) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  onSetIcon: (icon: string) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
}) {
  const textareaProps = {
    ref: (el: HTMLTextAreaElement | null) => registerRef(el),
    value: block.text ?? "",
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange({ text: e.target.value });
      onInput(e.target.value);
    },
    onBlur: onBlur,
    onKeyDown,
    onPaste,
    // BUG 3: readOnly (not disabled) keeps focus/selection intact but blocks
    // typing when the page is locked. Also prevents native re-focus loss.
    readOnly: locked,
    rows: 1,
    className:
      "w-full resize-none border-0 bg-transparent p-0 outline-none placeholder:text-faint",
    style: { overflow: "hidden" as const },
  };

  const t = block.type;

  if (t === "divider") {
    return (
      <div className="py-2" aria-label="Divider block">
        <hr className="border-line" />
      </div>
    );
  }


  if (t === "table") {
    return (
      <TableBlock block={block} locked={locked} onChange={onChange} onBlur={onBlur} />
    );
  }

  if (t === "code") {
    return (
      <div className="rounded-md bg-sunken p-3">
        <GrowText
          {...textareaProps}
          className="w-full resize-none border-0 bg-transparent p-0 font-mono text-meta text-body outline-none"
        />
      </div>
    );
  }

  if (t === "quote") {
    return (
      <blockquote
        className="border-l-2 border-lineStrong pl-4"
        style={{ fontFamily: "Lato, sans-serif" }}
      >
        <GrowText
          {...textareaProps}
          className="w-full resize-none border-0 bg-transparent p-0 text-quote italic text-body outline-none placeholder:text-faint"
        />
      </blockquote>
    );
  }

  if (t === "callout") {
    return (
      <div
        className="flex items-start gap-2 rounded-lg bg-sunken p-3"
        style={{ borderRadius: 10 }}
      >
        <CalloutIconPicker icon={block.icon ?? "💡"} onPick={onSetIcon} disabled={locked} />
        <GrowText
          {...textareaProps}
          className="w-full resize-none border-0 bg-transparent p-0 text-prose text-body outline-none placeholder:text-faint"
        />
      </div>
    );
  }

  if (t === "toggle") {
    return (
      <div className="text-prose text-body">
        <div className="flex items-start gap-1">
          <button
            type="button"
            onClick={() => onChange({ open: !block.open })}
            aria-label={block.open ? "Collapse" : "Expand"}
            className="mt-1 grid h-5 w-4 place-items-center text-muted hover:text-strong"
          >
            <span
              className="inline-block transition-transform"
              style={{ transform: block.open ? "rotate(90deg)" : "none" }}
            >
              ›
            </span>
          </button>
          <GrowText {...textareaProps} />
        </div>
        {block.open ? (
          <div className="ml-5 mt-1 text-meta text-muted">
            Nested blocks arrive next phase.
          </div>
        ) : null}
      </div>
    );
  }

  if (t === "todo") {
    const done = !!block.checked;
    return (
      <div className="flex items-start gap-2 text-prose text-body">
        <input
          type="checkbox"
          checked={done}
          onChange={() => onChange({ checked: !done })}
          className="mt-2 accent-accent"
          aria-label={done ? "Done" : "Todo"}
        />
        <GrowText
          {...textareaProps}
          className={`w-full resize-none border-0 bg-transparent p-0 outline-none placeholder:text-faint ${
            done ? "text-muted line-through" : ""
          }`}
        />
      </div>
    );
  }

  if (t === "bullet") {
    return (
      <div className="flex items-start gap-2 text-prose text-body">
        <span aria-hidden className="mt-2 leading-none text-muted">
          •
        </span>
        <GrowText {...textareaProps} />
      </div>
    );
  }

  if (t === "numbered") {
    return (
      <div className="flex items-start gap-2 text-prose text-body">
        <span aria-hidden className="mt-1 min-w-4 text-meta text-muted tnum">
          {ordinal ?? 1}.
        </span>
        <GrowText {...textareaProps} />
      </div>
    );
  }

  if (t === "h1") {
    return (
      <GrowText
        {...textareaProps}
        className="w-full resize-none border-0 bg-transparent p-0 font-display text-title text-noir outline-none placeholder:text-faint"
      />
    );
  }

  if (t === "h2") {
    return (
      <GrowText
        {...textareaProps}
        className="w-full resize-none border-0 bg-transparent p-0 font-display text-heading text-noir outline-none placeholder:text-faint"
      />
    );
  }

  // text (default)
  return (
    <GrowText
      {...textareaProps}
      className="w-full resize-none border-0 bg-transparent p-0 text-prose text-body outline-none placeholder:text-faint"
    />
  );
}

const GrowText = function GrowText(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    ref?: (el: HTMLTextAreaElement | null) => void;
  },
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  useAutoGrow(innerRef, (props.value as string) ?? "");
  return (
    <textarea
      {...props}
      ref={(el) => {
        innerRef.current = el;
        props.ref?.(el);
      }}
      rows={1}
      placeholder={props.placeholder ?? "Write, or type / for blocks"}
    />
  );
};

function CalloutIconPicker({
  icon,
  onPick,
  disabled,
}: {
  icon: string;
  onPick: (i: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        className="text-row hover:bg-rail rounded-sm px-1"
        aria-label="Callout icon"
      >
        {icon}
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-40 mt-1 grid w-52 grid-cols-6 gap-1 rounded-lg border border-line bg-surface p-2 shadow-popover">
          {CALLOUT_ICONS.map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                onPick(i);
                setOpen(false);
              }}
              className="grid h-7 place-items-center rounded-sm hover:bg-sunken"
            >
              {i}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ────────────── Table block ────────────── */

function TableBlock({
  block,
  locked,
  onChange,
  onBlur,
}: {
  block: Blk;
  locked: boolean;
  onChange: (patch: Partial<Blk>) => void;
  onBlur?: () => void;
}) {
  const rows = block.rows ?? [["", "", ""], ["", "", ""]];
  const nCols = Math.max(...rows.map((r) => r.length));

  function setCell(r: number, c: number, v: string) {
    const next = rows.map((row) => row.slice());
    while (next[r].length < nCols) next[r].push("");
    next[r][c] = v;
    onChange({ rows: next });
  }
  function addRow() {
    onChange({ rows: [...rows, new Array(nCols).fill("")] });
  }
  function addCol() {
    onChange({ rows: rows.map((r) => [...r, ""]) });
  }

  return (
    <div className="group/table relative overflow-x-auto">
      <table className="w-full border-collapse text-meta">
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => {
                const Tag: "th" | "td" = ri === 0 ? "th" : "td";
                return (
                  <Tag
                    key={ci}
                    className={
                      "border border-line p-0 " +
                      (ri === 0
                        ? "text-label uppercase text-secondary"
                        : "text-body")
                    }
                  >
                    <input
                      type="text"
                      value={cell ?? ""}
                      disabled={locked}
                      onChange={(e) => setCell(ri, ci, e.target.value)}
                      onBlur={onBlur}
                      className="w-full border-0 bg-transparent px-2 py-1 outline-none"
                    />
                  </Tag>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {!locked ? (
        <>
          <button
            type="button"
            onClick={addCol}
            aria-label="Add column"
            className="absolute -right-6 top-0 hidden h-6 w-5 place-items-center rounded-md text-faint hover:bg-sunken hover:text-muted group-hover/table:grid"
          >
            +
          </button>
          <button
            type="button"
            onClick={addRow}
            aria-label="Add row"
            className="mx-auto mt-1 hidden h-5 place-items-center rounded-md px-3 text-meta text-faint hover:bg-sunken hover:text-muted group-hover/table:grid"
          >
            + row
          </button>
        </>
      ) : null}
    </div>
  );
}

/* ────────────── Slash menu ────────────── */

function SlashMenu({
  x,
  y,
  items,
  activeIdx,
  onHover,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  items: Array<{ type: BlockType; name: string; desc: string; icon: string }>;
  activeIdx: number;
  onHover: (i: number) => void;
  onPick: (t: BlockType) => void;
  onClose: () => void;
}) {
  // Clamp to viewport so the panel never clips out of view.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = Math.max(12, Math.min(vw - 324 - 12, x));
  const top = Math.max(12, Math.min(vh - 420 - 12, y));

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("[data-slash-menu]")) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  return createPortal(
    <div
      data-slash-menu
      className="fixed z-50 animate-popIn rounded-xl border border-line bg-surface shadow-popover"
      style={{ left, top, width: 324, maxHeight: 420 }}
    >
      <div className="px-3 pb-1 pt-2 text-label uppercase text-faint">Blocks</div>
      <div className="max-h-[340px] overflow-y-auto py-1">
        {items.length === 0 ? (
          <div className="px-3 py-2 text-meta text-muted">No matches.</div>
        ) : (
          items.map((m, i) => (
            <button
              key={m.type}
              type="button"
              onMouseEnter={() => onHover(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(m.type);
              }}
              className={
                "flex w-full items-center gap-3 px-2 py-1.5 text-left " +
                (i === activeIdx ? "bg-sunken" : "")
              }
            >
              <span
                aria-hidden
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-sunken font-mono text-caption text-body"
              >
                {m.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-row font-bold text-noir">{m.name}</span>
                <span className="block truncate text-meta text-muted">{m.desc}</span>
              </span>
            </button>
          ))
        )}
      </div>
      <div className="border-t border-line px-3 py-2 text-meta text-faint">
        <span aria-hidden className="mr-1">
          ⌕
        </span>
        Search all blocks…
      </div>
    </div>,
    document.body,
  );
}
