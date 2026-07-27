import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { nanoid } from "nanoid";
import { createPortal } from "react-dom";
import {
  moveBlock,
  moveRun,
  deleteIndices,
  moveBlockAcross,
  moveRunAcross,
  type Path as ReorderPath,
  type ColumnRef,
} from "@/lib/reorder";
import { blockToMarkdown } from "@/lib/export";
import { renderInlineWithOffsets } from "@/lib/inline-markdown";
import { numberedOrdinals } from "@/lib/blocks";
import { rowsInBand } from "@/lib/marquee";
import { blockHandleFooter } from "@/lib/block-handle-footer";
import { useToast } from "@/lib/toast";
import { RowMenu, type MenuSpec, type MenuRow } from "./row-menu";
import { isTypingTarget } from "@/lib/is-typing";
import { nextEditableIndex } from "@/lib/block-nav";
import { stripNestedColumns } from "@/lib/columns";
import {
  createUndoState,
  push as undoPush,
  undo as undoDo,
  redo as undoRedo,
  shouldCoalesce,
  type UndoState,
  type UndoEntry,
} from "@/lib/undo-stack";
import {
  normalizeTable,
  addColumn,
  addRow,
  deleteColumn,
  deleteRow,
  clearRow,
  clearColumn,
} from "@/lib/table-ops";
// The shared block-editor primitives — ONE implementation used by both
// EditableBody (top-level) and ColumnStack (per-column). See:
//   src/lib/block-ops.ts          — pure list ops + factories + shortcuts + paste
//   src/lib/block-key-handler.ts  — pure `resolveKey(scope, ...) → Op`
import {
  type Blk,
  type BlockType,
  type ToggleLevel,
  type FocusReq,
  type OpResult,
  newBlock,
  newColumnsBlock,
  tryMarkdownShortcut,
  splitBlock as opsSplit,
  mergeIntoPrev as opsMerge,
  convertToText as opsConvert,
  removeBlock as opsRemove,
  insertAfter as opsInsertAfter,
  duplicateBlock as opsDuplicate,
  parsePasteToBlocks,
  splicePasteAtCaret,
} from "@/lib/block-ops";
import { resolveKey, type Op as KeyOp } from "@/lib/block-key-handler";

/** Module-local bridge: nested ColumnStack keystrokes set this before
 *  bubbling their new blocks up, so EditableBody.commit knows the
 *  incoming `{ cols }` patch is a typing burst on that inner block id
 *  (and can coalesce it). Consumed synchronously by commit(). */
const columnTypingHint: { key: string | null } = { key: null };

/** Cross-list bridge: nested `ColumnStack`s hand their block-row elements,
 *  their column-track element, and drag-handle presses to the top-level
 *  `EditableBody` so drag/marquee logic sees ALL rows in one registry.
 *  A missing provider means the columns block is being rendered outside
 *  a real EditableBody (older call sites); everything degrades to a no-op. */
type ColumnBridge = {
  registerRow: (colRef: ColumnRef, id: string, el: HTMLElement | null) => void;
  registerTrack: (colRef: ColumnRef, el: HTMLElement | null) => void;
  beginDrag: (
    id: string,
    ev: React.PointerEvent<HTMLElement>,
    sourceCol: ColumnRef,
  ) => void;
  /** Escape gesture: promote focus to a top-level text block after the
   * parent `columns` block. When `removeBlockId` is non-null, remove that
   * inner block from its column first — but never below the column's
   * one-block minimum. */
  escapeColumn: (parentBlockId: string, removeBlockId: string | null) => void;
  /** Stage-2 ⌘A from inside a column: blur the caret and promote the
   *  selection to every top-level block on the page. Column-scoped block
   *  selection is deliberately NOT supported. */
  selectAllTopLevel: () => void;
  /** ArrowUp / ArrowLeft crossed the top of a column, or ArrowDown /
   *  ArrowRight crossed the bottom: exit to the top-level block before /
   *  after the parent `columns` block. If no such sibling exists and dir
   *  is -1, focus the page title. */
  exitVertical: (
    colRef: ColumnRef,
    dir: 1 | -1,
    caret: "start" | "end",
  ) => void;
};
const ColumnBridgeCtx = createContext<ColumnBridge | null>(null);




/* Editable body for a page. All blocks are auto-growing textareas
 * (or cell inputs for table). Persistence is orchestrated by the parent
 * through `onChange`, which fires on every keystroke; the parent debounces
 * and writes pages.blocks whole. Block ids are generated client-side.
 *
 * `Blk`, `BlockType`, `newBlock`, and `newColumnsBlock` are imported from
 * src/lib/block-ops.ts — the single source of truth used by both this
 * top-level editor and each per-column `ColumnStack`. */

type MenuItem = {
  type: BlockType;
  name: string;
  desc: string;
  icon: string;
  /** For "columns" entries only: the column count to create. */
  count?: number;
};

const BLOCK_MENU: MenuItem[] = [
  { type: "text", name: "Text", desc: "Plain writing. The default.", icon: "Aa" },
  { type: "h1", name: "Heading 1", desc: "Big section title.", icon: "H1" },
  { type: "h2", name: "Heading 2", desc: "Sub-section title.", icon: "H2" },
  { type: "h3", name: "Heading 3", desc: "Smaller section title.", icon: "H3" },
  { type: "bullet", name: "Bullet list", desc: "Unordered points.", icon: "•" },
  { type: "numbered", name: "Numbered list", desc: "Steps, in order.", icon: "1." },
  { type: "todo", name: "To-do", desc: "A checkbox that means it.", icon: "☑" },
  { type: "toggle", name: "Toggle", desc: "Details, tucked away.", icon: "▸" },
  { type: "quote", name: "Quote", desc: "Someone said it better.", icon: "\u201D" },
  { type: "caption", name: "Caption", desc: "A quiet note.", icon: "c" },
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

const COLUMNS_MENU: MenuItem[] = [
  { type: "columns", name: "2 columns", desc: "Side by side.", icon: "▥", count: 2 },
  { type: "columns", name: "3 columns", desc: "Three across.", icon: "▥", count: 3 },
  { type: "columns", name: "4 columns", desc: "Four across.", icon: "▥", count: 4 },
  { type: "columns", name: "5 columns", desc: "Five across.", icon: "▥", count: 5 },
  { type: "columns", name: "6 columns", desc: "Six across.", icon: "▥", count: 6 },
];

const CALLOUT_ICONS = ["💡", "⚠️", "✅", "❌", "ℹ️", "📌", "🔥", "⭐", "🎯", "🧠", "🚧", "🧪"];


function normalize(raw: unknown[]): Blk[] {
  if (!Array.isArray(raw)) return [];
  const out: Blk[] = [];
  for (const b of raw) {
    if (!b || typeof b !== "object" || Array.isArray(b)) continue;
    const rec = b as Record<string, unknown>;
    const type = ((rec.type as string) ?? "text") as BlockType;
    // Recurse one level into columns: normalise inner blocks per column,
    // and defensively strip any accidental nested columns block (search
    // only indexes one level; nesting would silently drop from ⌘K).
    let cols: Blk[][] | undefined;
    if (type === "columns" && Array.isArray(rec.cols)) {
      const stripped = stripNestedColumns(rec.cols) as unknown[][];
      cols = stripped.map((col) => normalize(col as unknown[]));
      // Ensure every column has at least one editable block so caret has a target.
      for (let i = 0; i < cols.length; i++) {
        if (cols[i].length === 0) cols[i] = [newBlock("text")];
      }
    }
    out.push({
      ...(rec as Record<string, unknown>),
      id: (rec.id as string) ?? nanoid(10),
      type,
      text: typeof rec.text === "string" ? rec.text : typeof rec.body === "string" ? (rec.body as string) : "",
      checked: !!rec.checked,
      open: !!rec.open,
      icon: typeof rec.icon === "string" ? (rec.icon as string) : undefined,
      rows: Array.isArray(rec.rows) ? (rec.rows as string[][]) : undefined,
      cols,
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
  // Which block currently owns focus. Drives the "formatted vs raw" swap:
  // the focused block shows a textarea with raw markdown; every other
  // block renders renderInline(text) inside a matching-geometry div.
  const [focusedId, setFocusedId] = useState<string | null>(null);

  useEffect(() => {
    if (!focusRequest) return;
    const el = refs.current[focusRequest.id];
    if (!el) return;
    el.focus({ preventScroll: true });
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
    // Only scroll if the target is outside the visible area.
    const rect = (el as HTMLElement).getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      (el as HTMLElement).scrollIntoView({ block: "nearest" });
    }
    setFocusRequest(null);
  }, [focusRequest, blocks]);

  /* ────────── Undo/redo ──────────
   *
   * A per-page snapshot stack held in refs (never state — we don't want
   * component re-renders on every push). See src/lib/undo-stack.ts for the
   * pure model + tests. The rule: PUSH BEFORE a change, not after. Typing
   * is coalesced (one push per burst) via shouldCoalesce(). Structural ops
   * always push. Restoring bypasses commit() so it can't push itself. */
  const blocksRef = useRef<Blk[]>(blocks);
  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);
  const focusedIdRef = useRef<string | null>(null);
  useEffect(() => {
    focusedIdRef.current = focusedId;
  }, [focusedId]);
  // (undo state below)
  const undoStateRef = useRef<UndoState<Blk>>(createUndoState<Blk>());
  const lastTypingAtRef = useRef<number | null>(null);
  const lastTypingKeyRef = useRef<string | null>(null);
  const isRestoringRef = useRef(false);
  // Reset the stack when the page id changes (also handled in the resync
  // effect above — kept here as a belt so a fresh EditableBody starts fresh).
  useEffect(() => {
    undoStateRef.current = createUndoState<Blk>();
    lastTypingAtRef.current = null;
    lastTypingKeyRef.current = null;
  }, [pageId]);

  function getCurrentCaret(): UndoEntry<Blk>["caret"] {
    const id = focusedIdRef.current;
    if (!id) return null;
    const el = refs.current[id];
    if (!el || !("selectionStart" in el)) return null;
    const off = (el as HTMLTextAreaElement).selectionStart;
    if (typeof off !== "number") return null;
    return { blockId: id, offset: off };
  }

  const commit = useCallback(
    (next: Blk[], opts?: { typingKey?: string }) => {
      // Consume the module-level column-typing bridge if the caller didn't
      // pass its own hint. This is how a keystroke inside a ColumnStack
      // reaches the outer coalesce logic without threading extra props.
      const key = opts?.typingKey ?? columnTypingHint.key ?? null;
      columnTypingHint.key = null;

      if (!isRestoringRef.current) {
        const prevEntry: UndoEntry<Blk> = {
          blocks: blocksRef.current,
          caret: getCurrentCaret(),
        };
        if (key) {
          const now = Date.now();
          const coalesce = shouldCoalesce(
            lastTypingAtRef.current,
            now,
            lastTypingKeyRef.current,
            key,
          );
          if (!coalesce) {
            undoStateRef.current = undoPush(undoStateRef.current, prevEntry);
          } else {
            // Any new action clears future, even on coalesce.
            undoStateRef.current = {
              past: undoStateRef.current.past,
              future: [],
            };
          }
          lastTypingAtRef.current = now;
          lastTypingKeyRef.current = key;
        } else {
          // Structural: push and end any in-flight typing burst.
          undoStateRef.current = undoPush(undoStateRef.current, prevEntry);
          lastTypingAtRef.current = null;
          lastTypingKeyRef.current = null;
        }
      }
      setBlocks(next);
      onChange(next);
    },
    [onChange],
  );

  const restoreEntry = useCallback(
    (entry: UndoEntry<Blk>) => {
      isRestoringRef.current = true;
      lastTypingAtRef.current = null;
      lastTypingKeyRef.current = null;
      setBlocks(entry.blocks);
      onChange(entry.blocks);
      // Restore focus. If the caret block still exists, focus it with the
      // stored offset; otherwise focus the nearest surviving block so we
      // never leave focus nowhere.
      const c = entry.caret;
      const survivors = entry.blocks;
      let targetId: string | null = null;
      let targetOff: number | "start" | "end" = "start";
      if (c && survivors.some((b) => b.id === c.blockId)) {
        targetId = c.blockId;
        targetOff = c.offset;
      } else if (survivors.length > 0) {
        targetId = survivors[0].id;
        targetOff = "start";
      }
      if (targetId) setFocusRequest({ id: targetId, caret: targetOff });
      // Release the guard on the next tick so re-render's effects don't push.
      queueMicrotask(() => {
        isRestoringRef.current = false;
      });
    },
    [onChange],
  );

  const performUndo = useCallback(() => {
    const cur: UndoEntry<Blk> = {
      blocks: blocksRef.current,
      caret: getCurrentCaret(),
    };
    const r = undoDo(undoStateRef.current, cur);
    if (!r) return;
    undoStateRef.current = r.state;
    restoreEntry(r.entry);
  }, [restoreEntry]);

  const performRedo = useCallback(() => {
    const cur: UndoEntry<Blk> = {
      blocks: blocksRef.current,
      caret: getCurrentCaret(),
    };
    const r = undoRedo(undoStateRef.current, cur);
    if (!r) return;
    undoStateRef.current = r.state;
    restoreEntry(r.entry);
  }, [restoreEntry]);

  // Window-level ⌘Z / ⌘⇧Z / ⌘Y — deliberate EXCEPTION to isTypingTarget,
  // alongside ⌘K and ⌘,. preventDefault always, so the browser's own
  // (broken, per-input) undo stack never also fires.
  useEffect(() => {
    if (locked) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) performRedo();
        else performUndo();
        return;
      }
      if (k === "y" && !e.shiftKey) {
        e.preventDefault();
        performRedo();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, performUndo, performRedo]);

  // Note on realtime: parent cache patching for THIS page while a local
  // undo stack is non-empty is not merged — clear `future` and leave
  // `past` alone. Correct multi-user undo needs OT/CRDT (out of scope).
  // The current wiring never rewrites `blocks` from a remote patch mid-
  // session; if that changes, wire the clear here.


  /* ────────── Selection & drag state ────────── */

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const anchorId = useRef<string | null>(null);
  const rowEls = useRef<Map<string, HTMLElement>>(new Map());
  const containerRef = useRef<HTMLDivElement | null>(null);

  /* Drag state — cross-list (top-level ↔ columns).
   *
   * `sourceCol` is where the dragged run lives; null = top-level, otherwise
   * `{blockId,colIndex}` names the source column. `targetCol` is where the
   * pointer currently is; the indicator is rendered inside that list's
   * bounding box (in container-space). `indicator` carries the full 2px
   * rect so a drop into a column shows a bar spanning JUST that column,
   * not the whole page width. */
  const [dragging, setDragging] = useState<{
    ids: string[]; // in original order (source-list order)
    sourceCol: ColumnRef | null;
    targetCol: ColumnRef | null;
    gap: number | null; // 0..targetList.length or null while indicator hidden
    indicator: { x: number; y: number; width: number } | null; // container-space
  } | null>(null);
  const draggingRef = useRef(dragging);
  useEffect(() => {
    draggingRef.current = dragging;
  }, [dragging]);

  // Column-track registry (for hierarchical drag hit-testing): each column
  // of a columns block registers its outermost stack element under the key
  // `${blockId}:${colIndex}`, and each block row inside a column records
  // its owning colRef in `rowColRefById` so drag/marquee logic can find
  // which list a given row belongs to.
  const colTracks = useRef<Map<string, HTMLElement>>(new Map());
  const rowColRefById = useRef<Map<string, ColumnRef | null>>(new Map());
  const trackKey = (r: ColumnRef) => `${r.blockId}:${r.colIndex}`;

  const registerRowEl = useCallback(
    (id: string, el: HTMLElement | null, colRef: ColumnRef | null = null) => {
      if (el) {
        rowEls.current.set(id, el);
        rowColRefById.current.set(id, colRef);
      } else {
        rowEls.current.delete(id);
        rowColRefById.current.delete(id);
      }
    },
    [],
  );

  const registerColTrack = useCallback((r: ColumnRef, el: HTMLElement | null) => {
    const k = trackKey(r);
    if (el) colTracks.current.set(k, el);
    else colTracks.current.delete(k);
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



  /* ────────── Drag: pointer session on a handle ──────────
   *
   * `sourceCol` identifies where the dragged run lives — null for the
   * top-level block list, or a `{blockId, colIndex}` for a column. A drag
   * started from inside a column carries its colRef so the source list
   * is unambiguous at endDrag time, even when the pointer wanders across
   * multiple columns during the drag. */

  const beginDrag = useCallback(
    (
      id: string,
      ev: React.PointerEvent<HTMLElement>,
      sourceCol: ColumnRef | null = null,
    ) => {
      const sourceIsTopLevel = sourceCol === null;
      let dragIds: string[] = [id];
      if (sourceIsTopLevel) {
        // Top-level multi-select: only drag the run when the handle
        // belongs to a currently-selected top-level block.
        const ids = blocks.map((b) => b.id);
        if (ids.indexOf(id) < 0) return;
        const isMulti = selectedIds.size > 1 && selectedIds.has(id);
        if (isMulti) dragIds = ids.filter((x) => selectedIds.has(x));
      }
      if (dragIds.length === 1) {
        setSelectedIds(new Set());
        anchorId.current = null;
      }
      try {
        ev.currentTarget.setPointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
      document.body.style.userSelect = "none";
      setDragging({
        ids: dragIds,
        sourceCol,
        targetCol: sourceCol,
        gap: null,
        indicator: null,
      });
    },
    [blocks, selectedIds],
  );

  const computeGap = useCallback(
    (
      clientX: number,
      clientY: number,
    ): {
      targetCol: ColumnRef | null;
      gap: number;
      indicator: { x: number; y: number; width: number };
    } | null => {
      const container = containerRef.current;
      if (!container) return null;
      const cRect = container.getBoundingClientRect();

      // A dragged columns block itself may never land inside a column;
      // force top-level hit-testing in that case (see reorder.ts guard).
      const d = draggingRef.current;
      const draggingColumnsBlock =
        !!d &&
        d.ids.some((x) => blocks.find((b) => b.id === x)?.type === "columns");

      // Step 1: is the pointer inside any columns block's bounding box?
      // If so, hit-test against its column tracks (unless we're dragging
      // a columns block itself, in which case only top-level applies).
      if (!draggingColumnsBlock) {
        for (const b of blocks) {
          if (b.type !== "columns" || !Array.isArray(b.cols)) continue;
          const colsEl = rowEls.current.get(b.id);
          if (!colsEl) continue;
          const cb = colsEl.getBoundingClientRect();
          if (
            clientY < cb.top ||
            clientY > cb.bottom ||
            clientX < cb.left ||
            clientX > cb.right
          )
            continue;
          // Find which column track the pointer is over (by x).
          let chosen: { colIndex: number; el: HTMLElement } | null = null;
          for (let i = 0; i < b.cols.length; i++) {
            const el = colTracks.current.get(trackKey({ blockId: b.id, colIndex: i }));
            if (!el) continue;
            const r = el.getBoundingClientRect();
            if (clientX >= r.left && clientX <= r.right) {
              chosen = { colIndex: i, el };
              break;
            }
          }
          if (!chosen) continue;
          const colRef: ColumnRef = { blockId: b.id, colIndex: chosen.colIndex };
          const colBlocks = b.cols[chosen.colIndex] as Blk[];
          const rects: Array<{ id: string; top: number; bottom: number; mid: number }> = [];
          for (const cb2 of colBlocks) {
            const el = rowEls.current.get(cb2.id);
            if (!el) continue;
            const r = el.getBoundingClientRect();
            rects.push({ id: cb2.id, top: r.top, bottom: r.bottom, mid: (r.top + r.bottom) / 2 });
          }
          const trackRect = chosen.el.getBoundingClientRect();
          const width = trackRect.width;
          const xInContainer = trackRect.left - cRect.left;
          if (rects.length === 0) {
            // Empty-looking column (shouldn't happen post-normalise).
            return {
              targetCol: colRef,
              gap: 0,
              indicator: { x: xInContainer, y: trackRect.top - cRect.top, width },
            };
          }
          if (clientY < rects[0].mid) {
            return {
              targetCol: colRef,
              gap: 0,
              indicator: { x: xInContainer, y: rects[0].top - cRect.top - 2, width },
            };
          }
          for (let i = 0; i < rects.length; i++) {
            const rr = rects[i];
            if (clientY < rr.mid) {
              const y = ((rects[i - 1]?.bottom ?? rr.top) + rr.top) / 2;
              return {
                targetCol: colRef,
                gap: i,
                indicator: { x: xInContainer, y: y - cRect.top - 1, width },
              };
            }
          }
          const last = rects[rects.length - 1];
          return {
            targetCol: colRef,
            gap: rects.length,
            indicator: { x: xInContainer, y: last.bottom - cRect.top + 2, width },
          };
        }
      }

      // Step 2: top-level hit-test.
      const ids = blocks.map((b) => b.id);
      const rects: Array<{ id: string; top: number; bottom: number; mid: number }> = [];
      for (const id of ids) {
        const el = rowEls.current.get(id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        rects.push({ id, top: r.top, bottom: r.bottom, mid: (r.top + r.bottom) / 2 });
      }
      if (rects.length === 0) return null;
      const width = cRect.width;
      const x = 0;
      if (clientY < rects[0].mid) {
        return {
          targetCol: null,
          gap: 0,
          indicator: { x, y: rects[0].top - cRect.top - 2, width },
        };
      }
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (clientY < r.mid) {
          const y = ((rects[i - 1]?.bottom ?? r.top) + r.top) / 2;
          return {
            targetCol: null,
            gap: i,
            indicator: { x, y: y - cRect.top - 1, width },
          };
        }
      }
      const last = rects[rects.length - 1];
      return {
        targetCol: null,
        gap: rects.length,
        indicator: { x, y: last.bottom - cRect.top + 2, width },
      };
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

  const dragLastClient = useRef<{ x: number; y: number } | null>(null);

  const onPointerMove = useCallback(
    (ev: PointerEvent) => {
      if (!draggingRef.current) return;
      dragLastClient.current = { x: ev.clientX, y: ev.clientY };
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
      const hit = computeGap(ev.clientX, ev.clientY);
      if (!hit) return;
      setDragging((prev) =>
        prev
          ? { ...prev, targetCol: hit.targetCol, gap: hit.gap, indicator: hit.indicator }
          : prev,
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
      const froms: ReorderPath[] = d.ids.map((id) => {
        // Discover this id's source list from the registry so cross-list
        // drags remain correct even if `sourceCol` is stale.
        const colRef = rowColRefById.current.get(id) ?? d.sourceCol;
        // Compute index inside its list.
        let index = -1;
        if (colRef === null) {
          index = blocks.findIndex((b) => b.id === id);
        } else {
          const b = blocks.find((x) => x.id === colRef.blockId);
          if (b?.cols && Array.isArray(b.cols)) {
            index = (b.cols[colRef.colIndex] as Blk[]).findIndex((x) => x.id === id);
          }
        }
        return { col: colRef, index };
      });
      // Bail if any path failed to resolve.
      if (froms.some((p) => p.index < 0)) return;
      const to: ReorderPath = { col: d.targetCol, index: d.gap };
      const makeEmpty = () => newBlock("text");
      const next =
        d.ids.length === 1
          ? moveBlockAcross(blocks, froms[0], to, makeEmpty)
          : moveRunAcross(blocks, froms, to, makeEmpty);
      if (next === blocks) return;
      if (next.length === blocks.length && next.every((x, i) => x === blocks[i])) return;
      commit(next);
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
      // Escape is a deliberate exception to the typing guard.
      if (e.key === "Escape") {
        e.preventDefault();
        clearSelection();
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (e.key === "Delete" || e.key === "Backspace") {
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
      // Native copy/cut must win while the caret is in a text field.
      if (isTypingTarget(e.target)) return;
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

  /* ────────── ⌘A — select all blocks (block-selection scope) ──────────
   * The in-textarea two-stage behaviour lives in the textarea onKeyDown.
   * This handler only fires when a block-selection is already active AND
   * focus is outside a text field, so ⌘A extends that selection to the
   * whole document. */
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "a") return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      setSelectedIds(new Set(blocks.map((b) => b.id)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds, blocks]);

  /* ────────── Paste Markdown → real blocks ──────────
   * Inverse of the copy path above. If the pasted text has no newline and
   * no markdown markers, we DO NOTHING and let the browser paste it as
   * ordinary text (undo history stays intact). Otherwise we splice parsed
   * blocks at the caret — or replace the current block-selection run. */
  const handlePaste = useCallback(
    (blockId: string, e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (locked) return;
      const htmlSrc = e.clipboardData?.getData("text/html") ?? "";
      const plainSrc = e.clipboardData?.getData("text/plain") ?? "";
      const parsedOut = parsePasteToBlocks(htmlSrc, plainSrc);
      if (!parsedOut) return; // Let the browser handle a plain single-line paste.
      e.preventDefault();
      const parsed = parsedOut.blocks;

      const idx = blocks.findIndex((b) => b.id === blockId);
      if (idx === -1) return;

      let next: Blk[];
      const focusId = parsed[parsed.length - 1].id;

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
        // Splice at caret within the target block, via the shared op.
        const ta = e.currentTarget as HTMLTextAreaElement;
        const caret = ta.selectionStart ?? (blocks[idx].text ?? "").length;
        const r = splicePasteAtCaret(blocks, blockId, caret, parsed);
        if (!r) return;
        next = r.next;
      }


      commit(next);
      setFocusRequest({ id: focusId, caret: "end" });
      if (parsed.length > 1) toast.push(`Pasted ${parsed.length} blocks`);
    },
    [blocks, commit, locked, selectedIds, clearSelection, toast],
  );




  /* ────────── Marquee selection ──────────
   *
   * All coordinates below are in CONTAINER content space — the coordinate
   * system of `containerRef` (which is `position: relative`, so rows'
   * `offsetTop` values are naturally in this space). This is the fix for
   * the bug where selection eroded during auto-scroll: viewport-space
   * comparisons dropped rows as the container scrolled underneath them.
   * Content space is scroll-invariant — a row's top does not change when
   * the container scrolls, and neither does the anchor we captured at
   * pointerdown, so scrolling extends the selection instead of eroding it.
   */

  const [marquee, setMarquee] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const marqueeRef = useRef<{
    active: boolean;
    originX: number; // container-space
    originY: number; // container-space
    originTarget: HTMLElement | null;
    moved: boolean;
  } | null>(null);
  const marqueeScrollDirRef = useRef<0 | 1 | -1>(0);
  const marqueeScrollRafRef = useRef<number | null>(null);
  // Last viewport pointer, used to recompute container-space coords when
  // auto-scroll fires without a real pointermove.
  const marqueeLastClient = useRef<{ x: number; y: number } | null>(null);

  const containerPoint = useCallback(
    (clientX: number, clientY: number) => {
      const c = containerRef.current;
      if (!c) return { x: 0, y: 0 };
      const r = c.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    },
    [],
  );

  const selectByMarqueeY = useCallback((y1: number, y2: number) => {
    // Build the row list in DOCUMENT ORDER (as rendered), using `offsetTop`
    // which is container-space and scroll-invariant.
    const rows: { id: string; top: number; height: number }[] = [];
    rowEls.current.forEach((el, id) => {
      rows.push({ id, top: el.offsetTop, height: el.offsetHeight });
    });
    rows.sort((a, b) => a.top - b.top);
    const ids = new Set<string>(rowsInBand(rows, y1, y2));
    setSelectedIds(ids);
  }, []);

  const applyMarqueeFromLastPointer = useCallback(() => {
    const m = marqueeRef.current;
    const lp = marqueeLastClient.current;
    if (!m || !m.active || !lp) return;
    const p = containerPoint(lp.x, lp.y);
    setMarquee({ x1: m.originX, y1: m.originY, x2: p.x, y2: p.y });
    selectByMarqueeY(m.originY, p.y);
  }, [containerPoint, selectByMarqueeY]);

  const tickMarqueeScroll = useCallback(() => {
    const dir = marqueeScrollDirRef.current;
    const sc = scrollContainerRef.current;
    if (!sc || dir === 0) {
      marqueeScrollRafRef.current = null;
      return;
    }
    sc.scrollTop += dir * 8;
    // After the scroll, the pointer is over new content — recompute the
    // rectangle and selection using the last known viewport pointer, so
    // scrolling EXTENDS the band rather than freezing it.
    applyMarqueeFromLastPointer();
    marqueeScrollRafRef.current = requestAnimationFrame(tickMarqueeScroll);
  }, [applyMarqueeFromLastPointer]);

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
      const p = containerPoint(e.clientX, e.clientY);
      marqueeRef.current = {
        active: true,
        originX: p.x,
        originY: p.y,
        originTarget: t,
        moved: false,
      };
      marqueeLastClient.current = { x: e.clientX, y: e.clientY };
    },
    [containerPoint],
  );

  // The narrow `.gio-page-body` column is centred inside `<main>`, so a
  // press in the lateral margin (outside the text column but still in
  // the scroll container) never bubbles to `handleContainerPointerDown`.
  // Attach the same session opener to `<main>` and gate it to the body's
  // vertical span — that turns those margins into marquee-startable
  // gutters without swallowing presses on the title / property strip above.
  useEffect(() => {
    const c = containerRef.current;
    const main = c?.closest("main") as HTMLElement | null;
    if (!c || !main) return;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (marqueeRef.current?.active) return;
      if (draggingRef.current) return;
      // If the press already lands inside `.gio-page-body`, the React
      // handler on containerRef takes it — don't double-start.
      const t = e.target as HTMLElement;
      if (c.contains(t)) return;
      // Filter interactive targets that live outside the body too.
      if (
        t.closest(
          "textarea, input, button, [data-slash-menu], [data-block-handle], [data-popover-root]",
        )
      )
        return;
      // Only start when the pointer is within the vertical band of the body.
      const rect = c.getBoundingClientRect();
      if (e.clientY < rect.top || e.clientY > rect.bottom) return;
      const p = containerPoint(e.clientX, e.clientY);
      marqueeRef.current = {
        active: true,
        originX: p.x,
        originY: p.y,
        originTarget: t,
        moved: false,
      };
      marqueeLastClient.current = { x: e.clientX, y: e.clientY };
    };
    main.addEventListener("pointerdown", onDown);
    return () => main.removeEventListener("pointerdown", onDown);
  }, [containerPoint]);


  useEffect(() => {
    const onMove = (ev: PointerEvent) => {
      const m = marqueeRef.current;
      if (!m || !m.active) return;
      marqueeLastClient.current = { x: ev.clientX, y: ev.clientY };
      const p = containerPoint(ev.clientX, ev.clientY);
      const dx = p.x - m.originX;
      const dy = p.y - m.originY;
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
      setMarquee({ x1: m.originX, y1: m.originY, x2: p.x, y2: p.y });
      selectByMarqueeY(m.originY, p.y);
    };
    const onUp = () => {
      const m = marqueeRef.current;
      if (!m || !m.active) return;
      marqueeRef.current = null;
      marqueeLastClient.current = null;
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
  }, [containerPoint, selectByMarqueeY, tickMarqueeScroll]);


  /* ────────── Slash menu state ────────── */

  const [slash, setSlash] = useState<{
    blockId: string;
    query: string;
    x: number;
    y: number;
  } | null>(null);

  const filteredMenu = useMemo(() => {
    // Top-level slash menu: BLOCK_MENU + COLUMNS_MENU. ColumnStack (inside a
    // column) manages its own menu with BLOCK_MENU only — columns must
    // never nest (see src/lib/columns.ts).
    const all: MenuItem[] = [...BLOCK_MENU, ...COLUMNS_MENU];
    const q = (slash?.query ?? "").toLowerCase().trim();
    if (!q) return all;
    return all.filter(
      (m) => m.name.toLowerCase().includes(q) || m.type.includes(q) || (m.count != null && `col${m.count}`.includes(q)),
    );
  }, [slash]);
  const [menuIdx, setMenuIdx] = useState(0);
  useEffect(() => setMenuIdx(0), [slash?.query]);

  const closeSlash = useCallback(() => setSlash(null), []);

  const applyType = useCallback(
    (blockId: string, type: BlockType, count?: number) => {
      const idx = blocks.findIndex((b) => b.id === blockId);
      if (idx === -1) return;
      const prev = blocks[idx];
      const t = (prev.text ?? "");
      const slashPos = t.lastIndexOf("/");
      const stripped = slashPos >= 0 ? t.slice(0, slashPos) : t;

      // Columns: replace the current block wholesale with a fresh columns
      // block seeded with N empty text-column columns; focus cols[0][0].
      if (type === "columns") {
        const n = count ?? 2;
        const cb = newColumnsBlock(n);
        const next = [...blocks];
        next[idx] = cb;
        commit(next);
        setSlash(null);
        const firstId = cb.cols![0][0].id;
        setFocusRequest({ id: firstId, caret: "start" });
        return;
      }

      const nb: Blk = { ...prev, type, text: stripped };
      if (type === "todo" && nb.checked == null) nb.checked = false;
      if (type === "toggle" && nb.open == null) nb.open = false;
      if (type === "callout" && !nb.icon) nb.icon = "💡";
      if (type === "table" && !nb.rows) nb.rows = [["", "", ""], ["", "", ""]];
      if (type === "divider") nb.text = "";
      const next = [...blocks];
      next[idx] = nb;
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
    (blockId: string, type: BlockType, extra?: Partial<Blk>) => {
      const run = getRunIndicesForBlock(blockId);
      if (!run.length) return;
      const next = [...blocks];
      for (const i of run) {
        const prev = next[i];
        const nb: Blk = { ...prev, type, ...(extra ?? {}) };
        if (type === "todo" && nb.checked == null) nb.checked = false;
        if (type === "toggle" && nb.open == null) nb.open = false;
        if (type === "callout" && !nb.icon) nb.icon = "💡";
        if (type === "table" && !nb.rows) nb.rows = [["", "", ""], ["", "", ""]];
        if (type === "divider") nb.text = "";
        // Clear a stale toggle level unless we're explicitly setting one.
        if (type !== "toggle" || !("level" in (extra ?? {}))) {
          if (type !== "toggle") delete nb.level;
          else if (!extra?.level) delete nb.level;
        }
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

  // ⌘D duplicates the current block-selection run. Yields to text fields
  // — inside a textarea the browser's native ⌘D (or nothing) wins.
  useEffect(() => {
    if (locked) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "d") return;
      if (isTypingTarget(e.target)) return;
      if (selectedIds.size === 0) return;
      const anchorId = blocks.find((b) => selectedIds.has(b.id))?.id ?? null;
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

      const turnIntoSub: MenuRow[] = [
        ...BLOCK_MENU.map((m) => ({
          kind: "row" as const,
          label: m.name,
          icon: "layout" as const,
          onPick: () => {
            runTurnInto(blockId, m.type);
            mctx.close();
          },
        })),
        // Toggle heading levels — sit next to the plain "Toggle" entry as
        // additional Turn-into options. Preserves text/body/open by
        // relying on runTurnInto's default patch behaviour.
        ...([1, 2, 3] as const).map((n) => ({
          kind: "row" as const,
          label: `Toggle heading ${n}`,
          icon: "layout" as const,
          onPick: () => {
            runTurnInto(blockId, "toggle", { level: `h${n}` as ToggleLevel });
            mctx.close();
          },
        })),
      ];

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



  /* ────────── Per-block ops ──────────
   * Thin wrappers around the pure ops in src/lib/block-ops.ts. Every path
   * that mutates the block list — top-level here, or a column via the
   * ColumnStack renderer — flows through the SAME pure ops so the two
   * implementations cannot drift on split / merge / convert / remove
   * / insertAfter / markdown-shortcut / paste semantics. */

  const applyOp = useCallback(
    (r: OpResult | null) => {
      if (!r) return;
      commit(r.next);
      if (r.focus) setFocusRequest(r.focus);
    },
    [commit],
  );

  function updateBlock(id: string, patch: Partial<Blk>) {
    const next = blocks.map((b) => (b.id === id ? { ...b, ...patch } : b));
    // Text-only patch = a keystroke on this block → coalesce as typing.
    const keys = Object.keys(patch);
    const isTyping = keys.length === 1 && keys[0] === "text";
    commit(next, isTyping ? { typingKey: id } : undefined);
  }

  const insertAfter = useCallback(
    (id: string, type: BlockType = "text") => applyOp(opsInsertAfter(blocks, id, type)),
    [blocks, applyOp],
  );

  const removeBlock = useCallback(
    (id: string) => applyOp(opsRemove(blocks, id)),
    [blocks, applyOp],
  );

  const splitBlock = useCallback(
    (id: string, caret: number) => applyOp(opsSplit(blocks, id, caret)),
    [blocks, applyOp],
  );

  const convertToText = useCallback(
    (id: string) => applyOp(opsConvert(blocks, id)),
    [blocks, applyOp],
  );

  const mergeIntoPrev = useCallback(
    (id: string) => applyOp(opsMerge(blocks, id)),
    [blocks, applyOp],
  );

  /* ────────── Markdown shortcuts on input (single source of truth) ────────── */
  function tryMarkdown(id: string, val: string): boolean {
    const r = tryMarkdownShortcut(blocks, id, val);
    if (!r) return false;
    applyOp(r);
    return true;
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
  // Hide indicator when a same-list drop would land inside the run.
  const indicatorVisible =
    dragging &&
    dragging.gap != null &&
    dragging.indicator != null &&
    (() => {
      const sameList =
        (dragging.sourceCol === null && dragging.targetCol === null) ||
        (dragging.sourceCol &&
          dragging.targetCol &&
          dragging.sourceCol.blockId === dragging.targetCol.blockId &&
          dragging.sourceCol.colIndex === dragging.targetCol.colIndex);
      if (!sameList) return true;
      if (runIdxs) {
        return dragging.gap < runIdxs.start || dragging.gap > runIdxs.end + 1;
      }
      // Single-block same-list: hide on the block's own two adjacent gaps.
      const id = dragging.ids[0];
      const sourceCol = dragging.sourceCol;
      let from = -1;
      if (sourceCol === null) {
        from = blocks.findIndex((b) => b.id === id);
      } else {
        const b = blocks.find((x) => x.id === sourceCol.blockId);
        if (b?.cols) from = (b.cols[sourceCol.colIndex] as Blk[]).findIndex((x) => x.id === id);
      }
      return from < 0 ? true : dragging.gap !== from && dragging.gap !== from + 1;
    })();

  const ordinalMap = useMemo(() => numberedOrdinals(blocks), [blocks]);

  /* Escape gesture from inside a column: promote focus to a top-level
   * text block immediately after the parent `columns` block, optionally
   * removing the now-empty inner block. Reuses an existing empty text
   * neighbour if one is already there — never leaves a stray empty. */
  const escapeColumn = useCallback(
    (parentBlockId: string, removeBlockId: string | null) => {
      const pi = blocks.findIndex((b) => b.id === parentBlockId);
      if (pi === -1) return;
      const parent = blocks[pi];
      if (parent.type !== "columns" || !Array.isArray(parent.cols)) return;

      let nextBlocks: Blk[] = blocks;
      if (removeBlockId) {
        const nextCols = (parent.cols as Blk[][]).map((col) => {
          if (col.length <= 1) return col;
          const stripped = col.filter((cb) => cb.id !== removeBlockId);
          return stripped.length ? stripped : col;
        });
        nextBlocks = blocks.map((b, i) =>
          i === pi ? { ...parent, cols: nextCols } : b,
        );
      }

      const after = nextBlocks[pi + 1];
      const isEmptyText =
        after && after.type === "text" && (after.text ?? "") === "";
      if (isEmptyText) {
        if (nextBlocks !== blocks) commit(nextBlocks);
        setFocusRequest({ id: after.id, caret: "start" });
        return;
      }
      const spawn = newBlock("text");
      const inserted = [...nextBlocks];
      inserted.splice(pi + 1, 0, spawn);
      commit(inserted);
      setFocusRequest({ id: spawn.id, caret: "start" });
    },
    [blocks, commit],
  );

  const selectAllTopLevel = useCallback(() => {
    setSelectedIds(new Set(blocks.map((x) => x.id)));
  }, [blocks]);

  /* Column → top-level exit for ArrowUp/ArrowDown/ArrowLeft/ArrowRight at
   * the column's top or bottom edge. Focuses the nearest top-level block
   * before / after the parent `columns` block, or the page title if we
   * would go above index 0. */
  const exitVerticalFromColumn = useCallback(
    (colRef: ColumnRef, dir: 1 | -1, caret: "start" | "end") => {
      const pi = blocks.findIndex((b) => b.id === colRef.blockId);
      if (pi === -1) return;
      const target = nextEditableIndex(blocks, pi, dir);
      if (target !== null) {
        setFocusRequest({ id: blocks[target].id, caret });
        return;
      }
      if (dir === -1) {
        const t = document.querySelector<HTMLTextAreaElement>(".gio-title");
        if (t) {
          t.focus({ preventScroll: true });
          const end = t.value.length;
          try {
            t.setSelectionRange(end, end);
          } catch {
            /* noop */
          }
        }
      }
    },
    [blocks],
  );

  const columnBridge = useMemo<ColumnBridge>(
    () => ({
      registerRow: (colRef, id, el) => registerRowEl(id, el, colRef),
      registerTrack: (colRef, el) => registerColTrack(colRef, el),
      beginDrag: (id, ev, colRef) => beginDrag(id, ev, colRef),
      escapeColumn,
      selectAllTopLevel,
      exitVertical: exitVerticalFromColumn,
    }),
    [registerRowEl, registerColTrack, beginDrag, escapeColumn, selectAllTopLevel, exitVerticalFromColumn],
  );


  return (
    <ColumnBridgeCtx.Provider value={columnBridge}>
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
          focused={focusedId === b.id}
          onRequestFocus={(caret) => {
            setFocusedId(b.id);
            setFocusRequest({ id: b.id, caret });
          }}
          onEditorFocus={() => setFocusedId(b.id)}
          onEditorBlur={() =>
            setFocusedId((cur) => (cur === b.id ? null : cur))
          }
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
                if (picked) applyType(b.id, picked.type, picked.count);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setSlash(null);
                return;
              }
            }

            // Delegate to the shared resolver — the same decision layer
            // used by ColumnStack. Everything below dispatches an `Op`
            // back into local state / undo. The four legitimate scope-
            // dependent branches (backspace-at-0, enter-empty-last,
            // arrow-up-first, slash) are handled inside the resolver.
            const idxInList = blocks.findIndex((x) => x.id === b.id);
            const op: KeyOp = resolveKey("page", blocks, idxInList, {
              key: e.key,
              meta: e.metaKey || e.ctrlKey,
              shift: e.shiftKey,
              selStart: ss,
              selEnd: se,
              valueLength: v.length,
              value: v,
            });

            const focusTitle = () => {
              const t = document.querySelector<HTMLTextAreaElement>(".gio-title");
              if (!t) return;
              t.focus({ preventScroll: true });
              const end = t.value.length;
              try {
                t.setSelectionRange(end, end);
              } catch {
                /* noop */
              }
            };
            const jumpTo = (dir: 1 | -1, caret: "start" | "end") => {
              const idx = blocks.findIndex((x) => x.id === b.id);
              const target = nextEditableIndex(blocks, idx, dir);
              if (target !== null) {
                setFocusRequest({ id: blocks[target].id, caret });
                return true;
              }
              return false;
            };

            switch (op.kind) {
              case "none":
                return;
              case "blur":
                e.preventDefault();
                el.blur();
                return;
              case "select-all-blocks":
                e.preventDefault();
                el.blur();
                setSelectedIds(new Set(blocks.map((x) => x.id)));
                return;
              case "duplicate":
                e.preventDefault();
                applyOp(opsDuplicate(blocks, b.id));
                return;
              case "split":
                e.preventDefault();
                splitBlock(b.id, op.caret);
                return;
              case "convert-to-text":
                e.preventDefault();
                convertToText(b.id);
                return;
              case "remove-empty":
                e.preventDefault();
                removeBlock(b.id);
                return;
              case "merge-prev":
                e.preventDefault();
                mergeIntoPrev(b.id);
                return;
              case "exit-to-title":
                e.preventDefault();
                if (!jumpTo(-1, "end")) focusTitle();
                return;
              case "arrow-jump":
                if (jumpTo(op.dir, op.caret)) e.preventDefault();
                return;
              case "arrow-vertical-probe": {
                // Do NOT preventDefault — let the browser wrap. Then rAF-probe:
                // if the caret settled at the extreme boundary in the requested
                // direction, promote to the neighbour.
                const bid = b.id;
                const dir = op.dir;
                requestAnimationFrame(() => {
                  const cur = refs.current[bid] as HTMLTextAreaElement | undefined;
                  if (!cur || document.activeElement !== cur) return;
                  if (dir === -1) {
                    if (cur.selectionStart === 0 && cur.selectionEnd === 0) {
                      const idx = blocks.findIndex((x) => x.id === bid);
                      const target = nextEditableIndex(blocks, idx, -1);
                      if (target !== null) {
                        setFocusRequest({ id: blocks[target].id, caret: "end" });
                      } else {
                        focusTitle();
                      }
                    }
                  } else {
                    const l = cur.value.length;
                    if (cur.selectionStart === l && cur.selectionEnd === l) {
                      const idx = blocks.findIndex((x) => x.id === bid);
                      const target = nextEditableIndex(blocks, idx, 1);
                      if (target !== null) {
                        setFocusRequest({ id: blocks[target].id, caret: "start" });
                      }
                    }
                  }
                });
                return;
              }
              // These are column-only Ops; if we ever see one at page scope
              // the resolver is broken. Fail loudly rather than swallow.
              case "escape-column":
                return;
            }
          }}
          onAddBelow={() => { if (!locked) insertAfter(b.id); }}
          onSetIcon={(icon) => updateBlock(b.id, { icon })}
          onPaste={(e) => handlePaste(b.id, e)}
        />
      ))}

      {/* Drop indicator — column-relative width when dropping into a column. */}
      {indicatorVisible ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: dragging!.indicator!.x,
            top: dragging!.indicator!.y,
            width: dragging!.indicator!.width,
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

      {/* Marquee rectangle — rendered INSIDE the container in content
       * space (not portaled to <body> in viewport space) so the visible
       * rect and the selection band stay in the same coordinate system
       * as the container scrolls. */}
      {marquee ? (
        <div
          aria-hidden
          className="marquee-rect"
          style={{
            position: "absolute",
            left: Math.min(marquee.x1, marquee.x2),
            top: Math.min(marquee.y1, marquee.y2),
            width: Math.abs(marquee.x2 - marquee.x1),
            height: Math.abs(marquee.y2 - marquee.y1),
          }}
        />
      ) : null}


      {slash ? (
        <SlashMenu
          x={slash.x}
          y={slash.y}
          items={filteredMenu}
          activeIdx={menuIdx}
          onHover={setMenuIdx}
          onPick={(t, count) => applyType(slash.blockId, t, count)}
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
    </ColumnBridgeCtx.Provider>
  );
}

/* ────────────── One row: gutter + block ────────────── */

function BlockRow({
  block,
  ordinal,
  locked,
  selected,
  dimmed,
  focused,
  onRequestFocus,
  onEditorFocus,
  onEditorBlur,
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
  focused: boolean;
  onRequestFocus: (caret: number | "end") => void;
  onEditorFocus: () => void;
  onEditorBlur: () => void;
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
        focused={focused}
        onRequestFocus={onRequestFocus}
        onEditorFocus={onEditorFocus}
        onEditorBlur={onEditorBlur}
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
  focused,
  onRequestFocus,
  onEditorFocus,
  onEditorBlur,
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
  focused: boolean;
  onRequestFocus: (caret: number | "end") => void;
  onEditorFocus: () => void;
  onEditorBlur: () => void;
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
    onFocus: () => onEditorFocus(),
    onBlur: () => {
      onEditorBlur();
      onBlur?.();
    },
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

  // Rendered ↔ editable swap. Formatted view for every text-carrying block
  // when it does not own focus (and always for locked pages). Empty blocks
  // stay as textareas so the placeholder and click-to-type are preserved.
  const rawText = block.text ?? "";
  const canFormat = t !== "code" && t !== "table" && t !== "divider";
  const showFormatted = canFormat && (locked || (!focused && rawText.length > 0));

  function caretFromEvent(e: React.MouseEvent<HTMLDivElement>): number | "end" {
    const x = e.clientX;
    const y = e.clientY;
    let range: Range | null = null;
    const d = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
    };
    if (typeof d.caretRangeFromPoint === "function") {
      range = d.caretRangeFromPoint(x, y);
    } else if (typeof d.caretPositionFromPoint === "function") {
      const p = d.caretPositionFromPoint(x, y);
      if (p) {
        range = document.createRange();
        range.setStart(p.offsetNode, p.offset);
      }
    }
    if (!range) return "end";
    let el: HTMLElement | null =
      range.startContainer instanceof Element
        ? (range.startContainer as HTMLElement)
        : range.startContainer.parentElement;
    while (el && !el.hasAttribute("data-o")) el = el.parentElement;
    if (!el) return "end";
    const base = parseInt(el.getAttribute("data-o") || "0", 10);
    return Math.min(rawText.length, base + range.startOffset);
  }

  // Returns the div-or-textarea for a given wrapping className. The div and
  // the textarea share the exact same className so font/size/line-height/
  // padding match — the caret does not jump when swapping.
  function renderSwap(className: string, extra?: string) {
    const cls = className + (extra ? " " + extra : "");
    if (!showFormatted) {
      return <GrowText {...textareaProps} className={cls} />;
    }
    return (
      <div
        className={cls + " cursor-text whitespace-pre-wrap break-words"}
        onMouseDown={
          locked
            ? undefined
            : (e) => {
                e.preventDefault();
                onRequestFocus(caretFromEvent(e));
              }
        }
      >
        {rawText ? renderInlineWithOffsets(rawText) : "\u200B"}
      </div>
    );
  }

  if (t === "columns" && Array.isArray(block.cols)) {
    return (
      <ColumnsBlock
        block={block}
        locked={locked}
        onChange={onChange}
      />
    );
  }

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
        {renderSwap(
          "w-full resize-none border-0 bg-transparent p-0 text-quote italic text-body outline-none placeholder:text-faint",
        )}
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
        {renderSwap(
          "w-full resize-none border-0 bg-transparent p-0 text-prose text-body outline-none placeholder:text-faint",
        )}
      </div>
    );
  }

  if (t === "toggle") {
    // Optional heading level: 'h1' | 'h2' | 'h3' promotes the SUMMARY to
    // heading typography. Absent = today's plain-toggle rendering (Lato).
    const level = (block as { level?: string }).level;
    const summaryCls =
      level === "h1"
        ? "w-full resize-none border-0 bg-transparent p-0 font-display text-title text-noir outline-none placeholder:text-faint"
        : level === "h2"
          ? "w-full resize-none border-0 bg-transparent p-0 font-display text-heading text-noir outline-none placeholder:text-faint"
          : level === "h3"
            ? "w-full resize-none border-0 bg-transparent p-0 font-display text-subhead text-noir outline-none placeholder:text-faint"
            : textareaProps.className;
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
          {renderSwap(summaryCls)}
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
        {renderSwap(
          "w-full resize-none border-0 bg-transparent p-0 outline-none placeholder:text-faint",
          done ? "text-muted line-through" : "",
        )}
      </div>
    );
  }

  if (t === "bullet") {
    return (
      <div className="flex items-start gap-2 text-prose text-body">
        <span aria-hidden className="mt-2 leading-none text-muted">
          •
        </span>
        {renderSwap(textareaProps.className)}
      </div>
    );
  }

  if (t === "numbered") {
    return (
      <div className="flex items-start gap-2 text-prose text-body">
        <span aria-hidden className="mt-1 min-w-4 text-meta text-muted tnum">
          {ordinal ?? 1}.
        </span>
        {renderSwap(textareaProps.className)}
      </div>
    );
  }

  if (t === "h1") {
    return renderSwap(
      "w-full resize-none border-0 bg-transparent p-0 font-display text-title text-noir outline-none placeholder:text-faint",
    );
  }

  if (t === "h2") {
    return renderSwap(
      "w-full resize-none border-0 bg-transparent p-0 font-display text-heading text-noir outline-none placeholder:text-faint",
    );
  }

  // text (default)
  return renderSwap(
    "w-full resize-none border-0 bg-transparent p-0 text-prose text-body outline-none placeholder:text-faint",
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

/* ────────────── Columns block ──────────────
 *
 * Renders a CSS-grid container with N inner ColumnStacks. Each ColumnStack
 * is a self-contained mini-editor that reuses BlockRow for its rendering
 * and supports typing / Enter split / Backspace merge / slash menu / type
 * conversion within its column.
 *
 * DEFERRED (part 2 of 2): drag reordering blocks into or out of columns,
 * marquee selection crossing column boundaries, and arrow-key navigation
 * across columns. The drag handle inside a column is inert this pass.
 *
 * INVARIANT: columns must never nest. The slash menu here uses BLOCK_MENU
 * only (COLUMNS_MENU is excluded).
 */

function ColumnsBlock({
  block,
  locked,
  onChange,
}: {
  block: Blk;
  locked: boolean;
  onChange: (patch: Partial<Blk>) => void;
}) {
  const cols: Blk[][] = Array.isArray(block.cols) ? (block.cols as Blk[][]) : [];
  const n = cols.length;

  const setColumn = useCallback(
    (i: number, next: Blk[]) => {
      const nextCols = cols.map((c, ci) => (ci === i ? next : c));
      onChange({ cols: nextCols });
    },
    [cols, onChange],
  );

  return (
    <div
      className="gio-cols"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
        gap: 20,
      }}
    >
      {cols.map((col, i) => (
        <ColumnStack
          key={i}
          parentBlockId={block.id}
          colIndex={i}
          blocks={col}
          setBlocks={(next) => setColumn(i, next)}
          locked={locked}
        />
      ))}
    </div>
  );
}

/** Self-contained mini-editor for a single column. Duplicates the
 * essential split / merge / insert / type-conversion / slash-menu logic
 * from EditableBody rather than fully sharing state — part 2 of the
 * columns task will unify these under a single BlockStack component. */
function ColumnStack({
  parentBlockId,
  colIndex,
  blocks,
  setBlocks,
  locked,
}: {
  parentBlockId: string;
  colIndex: number;
  blocks: Blk[];
  setBlocks: (next: Blk[]) => void;
  locked: boolean;
}) {
  const bridge = useContext(ColumnBridgeCtx);
  const colRef = useMemo<ColumnRef>(
    () => ({ blockId: parentBlockId, colIndex }),
    [parentBlockId, colIndex],
  );
  const trackRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bridge?.registerTrack(colRef, trackRef.current);
    return () => bridge?.registerTrack(colRef, null);
  }, [bridge, colRef]);

  const refs = useRef<Record<string, HTMLTextAreaElement | HTMLInputElement | null>>({});
  const [focusRequest, setFocusRequest] = useState<{
    id: string;
    caret?: number | "end" | "start";
  } | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [slash, setSlash] = useState<{
    blockId: string;
    query: string;
    x: number;
    y: number;
  } | null>(null);
  const [menuIdx, setMenuIdx] = useState(0);
  useEffect(() => setMenuIdx(0), [slash?.query]);

  const filteredMenu = useMemo(() => {
    const q = (slash?.query ?? "").toLowerCase().trim();
    if (!q) return BLOCK_MENU;
    return BLOCK_MENU.filter(
      (m) => m.name.toLowerCase().includes(q) || m.type.includes(q),
    );
  }, [slash]);

  useEffect(() => {
    if (!focusRequest) return;
    const el = refs.current[focusRequest.id];
    if (!el) return;
    el.focus({ preventScroll: true });
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
        /* noop */
      }
    }
    setFocusRequest(null);
  }, [focusRequest, blocks]);

  /* Thin apply over the pure block-ops layer. Structural ops NEVER touch
   * columnTypingHint — the outer commit sees a `{ cols: … }` patch and
   * pushes a fresh undo snapshot. Only text-only keystrokes set the hint,
   * so typing bursts coalesce with the same rules as the top level. */
  const applyOp = useCallback(
    (r: OpResult | null) => {
      if (!r) return;
      setBlocks(r.next);
      if (r.focus) setFocusRequest(r.focus);
    },
    [setBlocks],
  );

  function updateBlock(id: string, patch: Partial<Blk>) {
    const keys = Object.keys(patch);
    const isTyping = keys.length === 1 && keys[0] === "text";
    if (isTyping) columnTypingHint.key = id;
    setBlocks(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  function applyTypeLocal(blockId: string, type: BlockType) {
    // Columns never nest — refuse the "columns" type even though the
    // in-column slash menu doesn't offer it.
    if (type === "columns") return;
    const idx = blocks.findIndex((b) => b.id === blockId);
    if (idx === -1) return;
    const prev = blocks[idx];
    const t = prev.text ?? "";
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
    setBlocks(next);
    setSlash(null);
    setFocusRequest({ id: blockId, caret: stripped.length });
  }

  /* Structured paste inside a column — the priority for this task.
   * Uses the same parse + splice engine as the top level. Any parsed
   * `columns` blocks are filtered out to preserve the never-nest rule. */
  const handlePaste = useCallback(
    (blockId: string, e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (locked) return;
      const htmlSrc = e.clipboardData?.getData("text/html") ?? "";
      const plainSrc = e.clipboardData?.getData("text/plain") ?? "";
      const parsedOut = parsePasteToBlocks(htmlSrc, plainSrc);
      if (!parsedOut) return;
      const parsed = parsedOut.blocks.filter((p) => p.type !== "columns");
      if (parsed.length === 0) return;
      e.preventDefault();
      const ta = e.currentTarget;
      const caret =
        ta.selectionStart ?? (blocks.find((b) => b.id === blockId)?.text ?? "").length;
      applyOp(splicePasteAtCaret(blocks, blockId, caret, parsed));
    },
    [blocks, locked, applyOp],
  );

  /* Handle-click menu scoped to THIS column's list. Turn-into, duplicate,
   * move up/down, and delete operate only on the column; the outer undo
   * still pushes a snapshot per structural op via `{ cols: … }`. */
  const [handleMenu, setHandleMenu] = useState<{
    blockId: string;
    anchor: HTMLElement;
    spec: MenuSpec;
  } | null>(null);
  const closeHandleMenu = useCallback(() => setHandleMenu(null), []);
  const setHandleMenuSpec = useCallback((spec: MenuSpec) => {
    setHandleMenu((cur) => (cur ? { ...cur, spec } : cur));
  }, []);
  const buildColMenuSpec = useCallback(
    (
      bid: string,
      mctx: { setSpec: (s: MenuSpec) => void; close: () => void },
    ): MenuSpec => {
      const idx = blocks.findIndex((x) => x.id === bid);
      const target = blocks[idx];
      const targetName =
        BLOCK_MENU.find((m) => m.type === target?.type)?.name ?? target?.type ?? "Block";
      const atTop = idx <= 0;
      const atEnd = idx >= blocks.length - 1;
      const turnIntoSub: MenuRow[] = BLOCK_MENU.map((m) => ({
        kind: "row" as const,
        label: m.name,
        icon: "layout",
        onPick: () => {
          applyTypeLocal(bid, m.type);
          mctx.close();
        },
      }));
      const move = (dir: -1 | 1) => {
        if (idx < 0) return;
        const j = idx + dir;
        if (j < 0 || j >= blocks.length) return;
        const next = [...blocks];
        [next[idx], next[j]] = [next[j], next[idx]];
        setBlocks(next);
      };
      const rows: MenuRow[] = [
        {
          kind: "row",
          label: "Turn into",
          icon: "layout",
          hint: { text: "›" },
          onPick: () => mctx.setSpec({ title: "Turn into", rows: turnIntoSub }),
        },
        { kind: "sep" },
        {
          kind: "row",
          label: "Duplicate",
          icon: "dup",
          hint: { text: "⌘D", mono: true },
          onPick: () => {
            applyOp(opsDuplicate(blocks, bid));
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
            move(-1);
            mctx.close();
          },
        },
        {
          kind: "row",
          label: "Move down",
          icon: "chevDown",
          hint: atEnd ? { text: "at end" } : undefined,
          onPick: () => {
            move(1);
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
            applyOp(opsRemove(blocks, bid, { ensureOne: true }));
            mctx.close();
          },
        },
      ];
      return { title: targetName, rows };
    },
    [blocks, setBlocks, applyOp],
  );

  const ordinalMap = useMemo(() => numberedOrdinals(blocks), [blocks]);

  return (
    <div ref={trackRef} className="space-y-1">
      {blocks.map((b) => (
        <BlockRow
          key={b.id}
          block={b}
          ordinal={b.type === "numbered" ? (ordinalMap.get(b.id) ?? 1) : undefined}
          locked={locked}
          selected={false}
          dimmed={false}
          focused={focusedId === b.id}
          onRequestFocus={(caret) => {
            setFocusedId(b.id);
            setFocusRequest({ id: b.id, caret });
          }}
          onEditorFocus={() => setFocusedId(b.id)}
          onEditorBlur={() =>
            setFocusedId((cur) => (cur === b.id ? null : cur))
          }
          registerRowEl={(id, el) => bridge?.registerRow(colRef, id, el)}
          onHandlePointerDown={(ev) => {
            if (bridge) bridge.beginDrag(b.id, ev, colRef);
          }}
          onHandleClick={(anchor) => {
            const initial = buildColMenuSpec(b.id, {
              setSpec: setHandleMenuSpec,
              close: closeHandleMenu,
            });
            setHandleMenu({ blockId: b.id, anchor, spec: initial });
          }}
          onHandleShiftClick={() => {}}
          registerRef={(el) => {
            if (el) refs.current[b.id] = el;
            else delete refs.current[b.id];
          }}
          onChange={(patch) => updateBlock(b.id, patch)}
          onInput={(val) => {
            const mr = tryMarkdownShortcut(blocks, b.id, val);
            if (mr) {
              applyOp(mr);
              return;
            }
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
                if (picked) applyTypeLocal(b.id, picked.type);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setSlash(null);
                return;
              }
            }

            const idxInList = blocks.findIndex((x) => x.id === b.id);
            const op: KeyOp = resolveKey("column", blocks, idxInList, {
              key: e.key,
              meta: e.metaKey || e.ctrlKey,
              shift: e.shiftKey,
              selStart: ss,
              selEnd: se,
              valueLength: v.length,
              value: v,
            });

            const jumpTo = (dir: 1 | -1, caret: "start" | "end") => {
              const target = nextEditableIndex(blocks, idxInList, dir);
              if (target !== null) {
                setFocusRequest({ id: blocks[target].id, caret });
                return true;
              }
              return false;
            };

            switch (op.kind) {
              case "none":
                return;
              case "blur":
                e.preventDefault();
                el.blur();
                return;
              case "select-all-blocks":
                // Column-scoped block selection is deliberately unsupported —
                // stage 2 promotes to selecting every top-level block.
                e.preventDefault();
                el.blur();
                bridge?.selectAllTopLevel();
                return;
              case "duplicate":
                e.preventDefault();
                applyOp(opsDuplicate(blocks, b.id));
                return;
              case "split":
                e.preventDefault();
                applyOp(opsSplit(blocks, b.id, op.caret));
                return;
              case "convert-to-text":
                e.preventDefault();
                applyOp(opsConvert(blocks, b.id));
                return;
              case "remove-empty":
                e.preventDefault();
                applyOp(opsRemove(blocks, b.id, { ensureOne: true }));
                return;
              case "merge-prev":
                e.preventDefault();
                applyOp(opsMerge(blocks, b.id));
                return;
              case "escape-column":
                e.preventDefault();
                if (bridge)
                  bridge.escapeColumn(
                    parentBlockId,
                    op.removeEmpty ? b.id : null,
                  );
                return;
              case "arrow-jump":
                if (jumpTo(op.dir, op.caret)) {
                  e.preventDefault();
                  return;
                }
                // Boundary of column: exit vertically to a top-level sibling.
                if (bridge) {
                  e.preventDefault();
                  bridge.exitVertical(colRef, op.dir, op.caret);
                }
                return;
              case "arrow-vertical-probe": {
                const bid = b.id;
                const dir = op.dir;
                requestAnimationFrame(() => {
                  const cur = refs.current[bid] as HTMLTextAreaElement | undefined;
                  if (!cur || document.activeElement !== cur) return;
                  const atBoundary =
                    dir === -1
                      ? cur.selectionStart === 0 && cur.selectionEnd === 0
                      : cur.selectionStart === cur.value.length &&
                        cur.selectionEnd === cur.value.length;
                  if (!atBoundary) return;
                  const j = blocks.findIndex((x) => x.id === bid);
                  const target = nextEditableIndex(blocks, j, dir);
                  const caret: "start" | "end" = dir === -1 ? "end" : "start";
                  if (target !== null) {
                    setFocusRequest({ id: blocks[target].id, caret });
                  } else if (bridge) {
                    bridge.exitVertical(colRef, dir, caret);
                  }
                });
                return;
              }
              case "exit-to-title":
                // Not emitted for column scope; safeguard.
                return;
            }
          }}
          onAddBelow={() => {
            if (!locked) applyOp(opsInsertAfter(blocks, b.id));
          }}
          onSetIcon={(icon) => updateBlock(b.id, { icon })}
          onPaste={(e) => handlePaste(b.id, e)}
        />
      ))}
      {slash ? (
        <SlashMenu
          x={slash.x}
          y={slash.y}
          items={filteredMenu}
          activeIdx={menuIdx}
          onHover={setMenuIdx}
          onPick={(t) => applyTypeLocal(slash.blockId, t)}
          onClose={() => setSlash(null)}
        />
      ) : null}
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

/* ────────────── Table block ────────────── */

/**
 * TableBlock — rectangular string[][] with the first row as a positional
 * header. On hover the block shows:
 *   • a 4px column HANDLE above each column
 *   • a 4px row    HANDLE left  of each row
 *   • a full-height +column strip at the right edge
 *   • a full-width  +row    strip at the bottom edge
 *
 * Clicking a handle SELECTS that row or column (every cell tints
 * `bg-blueTint`, the handle itself goes `bg-blue`). Selection is local to
 * this block — never touches page-level `selectedIds`. Clicking the same
 * handle a second time opens the standard `RowMenu` with insert / clear /
 * delete actions. Delete/Backspace with focus outside a cell CLEARS the
 * selection's contents; Escape deselects.
 *
 * Every structural change (add/remove/clear) commits ONE `onChange` call,
 * which reaches the outer undo stack via the existing commit path — so a
 * single ⌘Z reverses a single table operation.
 */
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
  // Repair-on-load: any ragged import gets rectangularised here. When the
  // stored shape differs from the normalised one we surface it as a patch
  // so the persisted matrix converges to rectangular immediately.
  const rows = useMemo(
    () => normalizeTable(block.rows ?? [["", "", ""], ["", "", ""]]),
    [block.rows],
  );
  useEffect(() => {
    if (block.rows && JSON.stringify(block.rows) !== JSON.stringify(rows)) {
      onChange({ rows });
    }
    // Only fire on mount / when the persisted shape needs repair.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  type Sel = { kind: "row" | "col"; index: number } | null;
  const [sel, setSel] = useState<Sel>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuSpec, setMenuSpec] = useState<MenuSpec | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const nCols = rows[0]?.length ?? 0;
  const nRows = rows.length;

  const commit = useCallback(
    (next: string[][]) => {
      onChange({ rows: next });
    },
    [onChange],
  );

  const closeMenu = useCallback(() => {
    setMenuAnchor(null);
    setMenuSpec(null);
  }, []);

  // Escape deselects; Delete/Backspace with focus outside a cell clears.
  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSel(null);
        closeMenu();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const t = e.target as HTMLElement | null;
        if (t && rootRef.current?.contains(t) && t.tagName === "INPUT") return;
        e.preventDefault();
        if (sel.kind === "row") commit(clearRow(rows, sel.index));
        else commit(clearColumn(rows, sel.index));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, rows, commit, closeMenu]);

  function setCell(r: number, c: number, v: string) {
    const next = rows.map((row) => row.slice());
    next[r][c] = v;
    commit(next);
  }

  function openColumnMenu(anchor: HTMLElement, index: number) {
    const isOnlyCol = nCols <= 1;
    const cellCount = nRows;
    const spec: MenuSpec = {
      title: `Column ${index + 1}`,
      footer: `${cellCount} cell${cellCount === 1 ? "" : "s"}`,
      rows: [
        {
          kind: "row",
          label: "Insert left",
          onPick: () => {
            commit(addColumn(rows, index));
            setSel({ kind: "col", index });
          },
        },
        {
          kind: "row",
          label: "Insert right",
          onPick: () => {
            commit(addColumn(rows, index + 1));
            setSel({ kind: "col", index: index + 1 });
          },
        },
        {
          kind: "row",
          label: "Clear contents",
          onPick: () => commit(clearColumn(rows, index)),
        },
        { kind: "sep" },
        {
          kind: "row",
          label: "Delete column",
          danger: true,
          hint: isOnlyCol ? { text: "last column" } : undefined,
          onPick: () => {
            if (isOnlyCol) return;
            commit(deleteColumn(rows, index));
            setSel(null);
          },
        },
      ],
    };
    setMenuSpec(spec);
    setMenuAnchor(anchor);
  }

  function openRowMenu(anchor: HTMLElement, index: number) {
    const isOnlyRow = nRows <= 1;
    const isHeader = index === 0;
    const cellCount = nCols;
    const spec: MenuSpec = {
      title: isHeader ? "Header row" : `Row ${index + 1}`,
      footer: `${cellCount} cell${cellCount === 1 ? "" : "s"}`,
      rows: [
        {
          kind: "row",
          label: "Insert above",
          onPick: () => {
            commit(addRow(rows, index));
            setSel({ kind: "row", index });
          },
        },
        {
          kind: "row",
          label: "Insert below",
          onPick: () => {
            commit(addRow(rows, index + 1));
            setSel({ kind: "row", index: index + 1 });
          },
        },
        {
          kind: "row",
          label: "Clear contents",
          onPick: () => commit(clearRow(rows, index)),
        },
        { kind: "sep" },
        {
          kind: "row",
          label: "Delete row",
          danger: true,
          hint: isOnlyRow ? { text: "last row" } : undefined,
          onPick: () => {
            if (isOnlyRow) return;
            commit(deleteRow(rows, index));
            setSel(null);
          },
        },
      ],
    };
    setMenuSpec(spec);
    setMenuAnchor(anchor);
  }

  function onColumnHandleClick(e: React.MouseEvent<HTMLButtonElement>, index: number) {
    e.stopPropagation();
    if (locked) return;
    if (sel && sel.kind === "col" && sel.index === index) {
      openColumnMenu(e.currentTarget, index);
    } else {
      setSel({ kind: "col", index });
      closeMenu();
    }
  }

  function onRowHandleClick(e: React.MouseEvent<HTMLButtonElement>, index: number) {
    e.stopPropagation();
    if (locked) return;
    if (sel && sel.kind === "row" && sel.index === index) {
      openRowMenu(e.currentTarget, index);
    } else {
      setSel({ kind: "row", index });
      closeMenu();
    }
  }

  // Click into any cell deselects the row/column selection.
  const clearSelIfBodyClick = () => {
    if (sel) setSel(null);
  };

  return (
    <div
      ref={rootRef}
      className="group/table relative"
      style={{ paddingTop: 8, paddingLeft: 8, paddingRight: 20, paddingBottom: 20 }}
      onMouseDown={clearSelIfBodyClick}
    >
      <table className="w-full border-collapse text-meta" style={{ tableLayout: "fixed" }}>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => {
                const Tag: "th" | "td" = ri === 0 ? "th" : "td";
                const selected =
                  (sel?.kind === "row" && sel.index === ri) ||
                  (sel?.kind === "col" && sel.index === ci);
                return (
                  <Tag
                    key={ci}
                    className={
                      "border border-line p-0 " +
                      (ri === 0 ? "text-label uppercase text-secondary" : "text-body")
                    }
                    style={selected ? { background: "var(--color-blueTint)" } : undefined}
                  >
                    <input
                      type="text"
                      value={cell ?? ""}
                      disabled={locked}
                      data-table-cell={`${ri},${ci}`}
                      onFocus={() => setSel(null)}
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

      {!locked && (
        <>
          {/* Column handles — above each column, 4px tall, span col width. */}
          <div
            aria-hidden={sel?.kind !== "col"}
            className="pointer-events-none absolute inset-x-2 opacity-0 transition-opacity group-hover/table:opacity-100"
            style={{ top: 0, height: 8, right: 20 }}
          >
            <div className="pointer-events-auto flex h-full items-center gap-0">
              {Array.from({ length: nCols }, (_, ci) => {
                const active = sel?.kind === "col" && sel.index === ci;
                return (
                  <button
                    key={ci}
                    type="button"
                    aria-label={active ? `Column ${ci + 1} actions` : "Select column"}
                    title="Select column"
                    onClick={(e) => onColumnHandleClick(e, ci)}
                    className="grid place-items-center"
                    style={{ flex: 1, height: 8, background: "transparent" }}
                  >
                    <span
                      style={{
                        display: "block",
                        width: "calc(100% - 4px)",
                        height: 4,
                        borderRadius: 2,
                        background: active
                          ? "var(--color-blue)"
                          : "var(--color-lineStrong)",
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Row handles — left of each row, 4px wide, span row height. */}
          <div
            aria-hidden={sel?.kind !== "row"}
            className="pointer-events-none absolute inset-y-2 opacity-0 transition-opacity group-hover/table:opacity-100"
            style={{ left: 0, width: 8, bottom: 20 }}
          >
            <div className="pointer-events-auto flex h-full flex-col gap-0">
              {rows.map((_, ri) => {
                const active = sel?.kind === "row" && sel.index === ri;
                return (
                  <button
                    key={ri}
                    type="button"
                    aria-label={active ? `Row ${ri + 1} actions` : "Select row"}
                    title="Select row"
                    onClick={(e) => onRowHandleClick(e, ri)}
                    className="grid place-items-center"
                    style={{ flex: 1, width: 8, background: "transparent" }}
                  >
                    <span
                      style={{
                        display: "block",
                        height: "calc(100% - 4px)",
                        width: 4,
                        borderRadius: 2,
                        background: active
                          ? "var(--color-blue)"
                          : "var(--color-lineStrong)",
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* +column strip at right edge, full height, 20px wide. */}
          <button
            type="button"
            aria-label="Add column"
            title="Add column"
            onClick={() => {
              commit(addColumn(rows, nCols));
              // Focus the new cell in the first row.
              requestAnimationFrame(() => {
                const el = rootRef.current?.querySelector<HTMLInputElement>(
                  `input[data-table-cell="0,${nCols}"]`,
                );
                el?.focus();
              });
            }}
            className="absolute hidden place-items-center rounded-md text-faint hover:bg-sunken hover:text-muted group-hover/table:grid"
            style={{ right: 0, top: 8, bottom: 20, width: 20 }}
          >
            +
          </button>

          {/* +row strip at bottom edge, full width, 20px tall. */}
          <button
            type="button"
            aria-label="Add row"
            title="Add row"
            onClick={() => {
              commit(addRow(rows, nRows));
              requestAnimationFrame(() => {
                const el = rootRef.current?.querySelector<HTMLInputElement>(
                  `input[data-table-cell="${nRows},0"]`,
                );
                el?.focus();
              });
            }}
            className="absolute hidden place-items-center rounded-md text-faint hover:bg-sunken hover:text-muted group-hover/table:grid"
            style={{ left: 8, right: 20, bottom: 0, height: 20 }}
          >
            +
          </button>
        </>
      )}

      <RowMenu spec={menuSpec} anchor={menuAnchor} onClose={closeMenu} />
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
  items: MenuItem[];
  activeIdx: number;
  onHover: (i: number) => void;
  onPick: (t: BlockType, count?: number) => void;

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
              key={m.type + (m.count != null ? `-${m.count}` : "")}
              type="button"
              onMouseEnter={() => onHover(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(m.type, m.count);
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
