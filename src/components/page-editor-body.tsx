import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { edgeVelocity } from "@/lib/drag-scroll";
import { useNavigate } from "@tanstack/react-router";
import { primaryMod } from "@/lib/platform";
import { nanoid } from "nanoid";
import { toClipboard } from "@/lib/clipboard";
import {
  CELLS_MIME,
  cellSel,
  clearRect,
  colSel,
  extendSel,
  inRect,
  moveSel,
  parseTsv,
  pasteGrid,
  rangeSel,
  readCellsJson,
  rectSize,
  rectSources,
  rowSel,
  selRect,
  toggleMarkInRect,
  toTsv,
  type CellMark,
  type CellPos,
  type TableSel,
} from "@/lib/table-selection";
import { createPortal } from "react-dom";
import {
  moveBlock,
  moveRun,
  deleteIndices,
  moveBlockAcross,
  moveRunAcross,
  getContainerList,
  setContainerList,
  type Path as ReorderPath,
  type ColumnRef,
} from "@/lib/reorder";
import { writeBlocksClipboard } from "@/lib/blocks-clipboard";
import { renderInlineWithOffsets } from "@/lib/inline-markdown";
import { Ico } from "./emoji-icon";
import { numberedOrdinals } from "@/lib/blocks";
import { rowsInBand } from "@/lib/marquee";
import { rowsInScope, sameScope, type ScopeRef } from "@/lib/marquee-scope";
import { blockHandleFooter } from "@/lib/block-handle-footer";
import { useToast } from "@/lib/toast";
import { useWorkspaceId } from "@/lib/workspace-context";
import { RowMenu, type MenuSpec, type MenuRow } from "./row-menu";
import { isTypingTarget, shouldCopyBlocks } from "@/lib/is-typing";
import { nextEditableIndex } from "@/lib/block-nav";
import { stripNestedColumns, isColumnsBlockEmpty } from "@/lib/columns";
import {
  columnsGridTemplate,
  equalColumnWidths,
  normalizeColumnWidths,
  resetColumnPair,
  resizeColumnPair,
} from "@/lib/column-widths";

/** Columns grid gap. Wide enough that a column's block gutter (which sits
 *  at -34px inside a column) lives in the gap instead of painting over the
 *  neighbour, with ~6px clearance each side. Mirrored in src/styles.css
 *  (the stacking breakpoint) and in the HTML exporter. */
const COLS_GAP = 40;

/** Targets that must NEVER open a marquee session. ONE definition, used by
 *  both session openers (the React handler on the body and the `<main>`
 *  listener) — two copies drifted once and a fix landed in only one of them.
 *  `[data-sheet]` covers the WHOLE sheet root, not just its cells: the sheet
 *  hoists its single editor input to grid level, so the press target inside a
 *  sheet is always a div, and the suggestion panel, formula bar and toolbar
 *  live in the root too. Opening a session there made the marquee's pointerup
 *  click branch blur the hoisted editor and commit a half-written formula. */
/*  `[data-table-handle]` covers the table's row/column handle rails, which
 *  live in an absolutely-positioned overlay and are plain divs/buttons — not
 *  cells — so an input-shaped guard is blind to them. Pressing one used to
 *  open a page marquee session whose pointerup click branch blurred the
 *  editor and cleared the DOM selection mid-gesture. */
export const MARQUEE_SKIP_SEL =
  '[contenteditable="true"], textarea, input, select, [data-table-cell], [data-table-handle], [data-sheet], [data-view-block], [data-view-block-start]';
import {
  push as undoPush,
  undo as undoDo,
  redo as undoRedo,
  shouldCoalesce,
  type UndoEntry,
} from "@/lib/undo-stack";
import {
  getUndoState,
  setUndoState,
  getTypingMarker,
  setTypingMarker,
} from "@/lib/undo-store";
import {
  type Align,
  type AlignList,
  normalizeTable,
  normalizeAlign,
  addColumn,
  addAlign,
  addRow,
  deleteColumn,
  deleteAlign,
  deleteRow,
  duplicateColumn,
  duplicateAlign,
  duplicateRow,
  moveColumn,
  moveAlign,
  moveRow,
  setAlign,
  clearRow,
  clearColumn,
  type WidthList,
  addWidth,
  deleteWidth,
  duplicateWidth,
  moveWidth,
  normalizeWidths,
  WIDTH_MIN,
  WIDTH_MAX,
  WIDTH_DEFAULT,
  fitPercents,
  resizeFitted,
  applyTableOp,
  type TableOp,
} from "@/lib/table-ops";
import {
  TABLE_COLOR_NAMES,
  bgToken,
  colorAt,
  colorLabel,
  fgToken,
  normalizeColors,
  setColor,
  type ColorTarget,
  type TableColorName,
} from "@/lib/table-colors";
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
  newSheetGrid,
  tryMarkdownShortcut,
  splitBlock as opsSplit,
  mergeIntoPrev as opsMerge,
  convertToText as opsConvert,
  removeBlock as opsRemove,
  insertAfter as opsInsertAfter,
  duplicateBlock as opsDuplicate,
  parsePasteToBlocks,
  splicePasteAtCaret,
  inlinePaste,
  mergeNextInto as opsMergeNext,
  cloneWithFreshIds,
  isTextBearing,
  indentBlock as opsIndent,
  reclampIndents,
} from "@/lib/block-ops";
import { resolveKey, type Op as KeyOp } from "@/lib/block-key-handler";
import { slashTrigger, stripSlash } from "@/lib/slash";
import { applyCalloutDefaults, rememberCallout } from "@/lib/callout-prefs";
import { toggleWrap } from "@/lib/toggle-wrap";
import { linkPaste, snapSelection } from "@/lib/paste-link";
import { commitSourceToEditable, readEditableSource } from "@/lib/link-commit";
import { ImageBlock, ImageRowBlock, PageImageCtx } from "@/components/image-block";
import { FileBlock } from "@/components/file-block";
import { PageBlock } from "@/components/page-block";
import { ViewBlock } from "@/components/view-block";
import { SheetBlockView } from "@/components/sheet-block";
import { droppedImagePaths, rejectReason } from "@/lib/image-ops";
import { uploadImage } from "@/lib/images";
import { FloatingToolbar } from "./floating-toolbar";
import type { BlockSel, MarkName } from "./floating-toolbar";
import {
  MARK_BOLD,
  MARK_CODE,
  MARK_HIGHLIGHT,
  MARK_ITALIC,
  MARK_STRIKE,
  MARK_UNDERLINE,
  applyMarkToBlocks,
  blockMarkDecision,
  type MarkPair,
} from "@/lib/block-format";
import { Editable } from "./editable";
import { EmojiPicker } from "./emoji-picker";
import { Popover } from "./popover";
import { readCaret, writeCaret } from "@/lib/caret-shim";
import { useDragSession } from "@/hooks/use-drag-session";

import { ordinalLabel } from "@/lib/blocks";
import {
  CALLOUT_COLORS,
  type CalloutColor,
  calloutBg,
  calloutRing,
  calloutLabel,
} from "@/lib/callout-color";
import type { IconKey } from "@/lib/menu-icons";
import { exitRef } from "@/lib/exit-motion";
import { MermaidBlock, MERMAID_STARTER } from "@/components/mermaid-block";
import { CodeLangPicker } from "@/components/code-lang-picker";
import { isDiagramBlock } from "@/lib/diagram";


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
   * parent container (a `columns` block OR a `callout` container). When
   * `removeBlockId` is non-null, remove that inner block from its list
   * first — but never below the container's one-block minimum. */
  escapeColumn: (colRef: ColumnRef, removeBlockId: string | null) => void;
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
  /** The page-level block selection, so a container's rows can render
   *  their selected state when a marquee scoped to that container picked
   *  them. Ids are globally unique; the scope lives outside. */
  selectedIds: Set<string>;
  /** Shift-click on a handle inside a container extends WITHIN it. */
  shiftClick: (id: string, colRef: ColumnRef) => void;
  /** Backspace in the sole empty block of a column: dissolve the whole
   *  columns block when EVERY column is empty. Returns false (no-op) when
   *  any column still has content. */
  dissolveColumns: (colRef: ColumnRef) => boolean;
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
  /** Mono glyph — the slash menu's only visual. Kept there; never shown
   *  in Turn into, where a real icon already names the row. */
  icon: string;
  /** THE single source of the 15px icon for this block type. The slash
   *  menu, the Turn-into submenu and the parent "Turn into" row all read
   *  it from here, so the three can never drift apart. */
  ic: IconKey;
  /** Extra search terms for the slash menu, beyond name and type. */
  kw?: string;
  /** For "columns" entries only: the column count to create. */
  count?: number;
  /** For a code entry: the language it starts in ("mermaid" = Diagram). */
  lang?: string;
};

/** A code block written in Mermaid is drawn as a diagram (src/lib/diagram.ts). */
function isDiagram(b: Blk | undefined): boolean {
  return isDiagramBlock(b);
}

/** Diagrams made from the slash menu in this session open with their
 *  source showing. */
const FRESH_DIAGRAMS = new Set<string>();

const BLOCK_MENU: MenuItem[] = [
  { type: "text", name: "Text", desc: "Plain writing. The default.", icon: "Aa", ic: "bText" },
  { type: "h1", name: "Heading 1", desc: "Big section title.", icon: "H1", ic: "bH1" },
  { type: "h2", name: "Heading 2", desc: "Sub-section title.", icon: "H2", ic: "bH2" },
  { type: "h3", name: "Heading 3", desc: "Smaller section title.", icon: "H3", ic: "bH3" },
  { type: "bullet", name: "Bullet list", desc: "Unordered points.", icon: "•", ic: "bBullet" },
  { type: "numbered", name: "Numbered list", desc: "Steps, in order.", icon: "1.", ic: "bNumbered" },
  { type: "todo", name: "To-do", desc: "A checkbox that means it.", icon: "☑", ic: "bTodo" },
  { type: "toggle", name: "Toggle", desc: "Details, tucked away.", icon: "▸", ic: "bToggle" },
  { type: "quote", name: "Quote", desc: "Someone said it better.", icon: "\u201D", ic: "bQuote" },
  { type: "caption", name: "Caption", desc: "A quiet note.", icon: "c", ic: "bCaption" },
  {
    type: "callout",
    name: "Callout",
    desc: "The thing people skim past — louder.",
    icon: "💡",
    ic: "bCallout",
  },
  { type: "divider", name: "Divider", desc: "A visual breath.", icon: "—", ic: "bDivider" },
  {
    type: "code",
    name: "Code",
    desc: "Monospace, verbatim. Pick Mermaid for a diagram.",
    icon: "<>",
    ic: "bCode",
    kw: "code snippet mermaid diagram flowchart",
  },
  { type: "table", name: "Table", desc: "Simple rows and columns.", icon: "▦", ic: "bTable" },
  {
    type: "sheet",
    name: "Sheet",
    desc: "A calculating spreadsheet. Formulas, formats and totals.",
    // Σ says "calculating" rather than "grid" — the one-glance difference
    // between this and Table.
    icon: "\u03A3",
    ic: "bSheet",
    kw: "sheet sheets spreadsheet formula calc sum total number grid",
  },
  { type: "image", name: "Image", desc: "A screenshot, diagram or photo.", icon: "🖼", ic: "bImage" },
  {
    type: "imagerow",
    name: "Image row",
    desc: "Two or three images side by side.",
    icon: "▥",
    ic: "bImageRow",
  },
  {
    type: "file",
    name: "File",
    desc: "Attach a document. It stays with the page, and with every export.",
    // A typographic mark, like every other glyph in this column — an emoji
    // here would be the only one that breaks the set, and emoji are user
    // content in this product, never UI chrome.
    icon: "\u2398",
    ic: "bFile",
    kw: "file attachment pdf doc docx upload attach download",
  },
  {
    type: "page",
    name: "Page",
    desc: "A page that lives inside this one.",
    icon: "\u2398",
    ic: "bPage",
    kw: "page subpage child inside nest place placement",
  },
  {
    type: "view",
    name: "View",
    desc: "A live table, board or list of pages, with its own filters.",
    icon: "\u25A4",
    ic: "bView",
    kw: "view table board list linked query pages inline",
  },
];

/** The three toggle-heading levels, which are `toggle` blocks carrying a
 *  `level`. They stay first-class Turn-into options. */
const TOGGLE_HEADINGS = [
  { n: 1 as const, ic: "bToggleH1" as IconKey },
  { n: 2 as const, ic: "bToggleH2" as IconKey },
  { n: 3 as const, ic: "bToggleH3" as IconKey },
];

/** Icon for whatever a block currently IS — including toggle-heading
 *  levels, which are not their own BlockType. */
function blockIconKey(b: Blk | undefined): IconKey {
  if (!b) return "bText";
  if (b.type === "toggle") {
    const lvl = (b as { level?: unknown }).level;
    if (lvl === "h1") return "bToggleH1";
    if (lvl === "h2") return "bToggleH2";
    if (lvl === "h3") return "bToggleH3";
    return "bToggle";
  }
  return BLOCK_MENU.find((m) => m.type === b.type && !m.lang)?.ic ?? "bText";
}

/** Name for whatever a block currently IS, toggle levels included. */
function blockTypeName(b: Blk | undefined): string {
  if (b?.type === "toggle") {
    const lvl = (b as { level?: unknown }).level;
    if (lvl === "h1" || lvl === "h2" || lvl === "h3")
      return `Toggle heading ${lvl.slice(1)}`;
  }
  if (isDiagram(b)) return "Diagram";
  return BLOCK_MENU.find((m) => m.type === b?.type && !m.lang)?.name ?? b?.type ?? "Block";
}

const COLUMNS_MENU: MenuItem[] = [
  { type: "columns", name: "2 columns", desc: "Side by side.", icon: "▥", ic: "layout", count: 2 },
  { type: "columns", name: "3 columns", desc: "Three across.", icon: "▥", ic: "layout", count: 3 },
  { type: "columns", name: "4 columns", desc: "Four across.", icon: "▥", ic: "layout", count: 4 },
  { type: "columns", name: "5 columns", desc: "Five across.", icon: "▥", ic: "layout", count: 5 },
  { type: "columns", name: "6 columns", desc: "Six across.", icon: "▥", ic: "layout", count: 6 },
];






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
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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


/* Stable per-block callbacks. Each render records the LATEST handlers for a
 * block; the functions handed to <BlockRow> are created once per block id and
 * forward to those latest handlers. BlockRow is memoised, so typing in one
 * block re-renders that block only — not every block on the page — while
 * every callback still sees current state. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;
function useStableRowHandlers() {
  const latest = useRef(new Map<string, Record<string, AnyFn | undefined>>());
  const cache = useRef(new Map<string, Record<string, AnyFn>>());
  // The ids handed out during THIS render (reset each time the owner
  // renders). After the commit, blocks that weren't rendered (deleted) are
  // forgotten, so their closures and the blocks array they hold can be
  // collected. Never cleared in the effect: StrictMode runs effects twice.
  const seen = useRef(new Set<string>());
  seen.current = new Set();
  useEffect(() => {
    const live = seen.current;
    if (live.size === 0) return;
    for (const id of latest.current.keys()) {
      if (!live.has(id)) {
        latest.current.delete(id);
        cache.current.delete(id);
      }
    }
  });
  return useCallback(<T extends Record<string, AnyFn | undefined>>(id: string, handlers: T): T => {
    seen.current.add(id);
    latest.current.set(id, handlers);
    let c = cache.current.get(id);
    if (!c) {
      c = {};
      cache.current.set(id, c);
    }
    const out: Record<string, AnyFn | undefined> = {};
    for (const k of Object.keys(handlers)) {
      // A handler that is absent this render stays absent, so a row that
      // checks `if (onX)` still sees the difference.
      if (!handlers[k]) {
        out[k] = undefined;
        continue;
      }
      if (!c[k]) c[k] = (...args: unknown[]) => latest.current.get(id)?.[k]?.(...args);
      out[k] = c[k];
    }
    return out as T;
  }, []);
}

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
  const workspaceId = useWorkspaceId();
  const rowHandlers = useStableRowHandlers();
  const navigate = useNavigate();
  const lastPage = useRef(pageId);
  useEffect(() => {
    if (lastPage.current !== pageId) {
      lastPage.current = pageId;
      const n = normalize(initialBlocks);
      setBlocks(n.length ? n : [newBlock("text")]);
    }
  }, [pageId, initialBlocks]);

  const refs = useRef<Record<string, HTMLElement | null>>({});
  const [focusRequest, setFocusRequest] = useState<{
    id: string;
    caret?: number | "end" | "start";
    /** Scroll offset captured BEFORE a state commit (undo/redo restore).
     *  The focus effect writes it back so the restore is scroll-neutral. */
    preserveScrollTop?: number | null;
  } | null>(null);
  // Which block currently owns focus. Drives the "formatted vs raw" swap:
  // the focused block shows a textarea with raw markdown; every other
  // block renders renderInline(text) inside a matching-geometry div.
  const [focusedId, setFocusedId] = useState<string | null>(null);

  /* Focus + caret placement.
   *
   * BUG: ⌘Z used to snap the page to the top. Restoring a snapshot
   * rewrites every Editable's innerHTML, so the focused node is destroyed
   * and recreated; focusing the new one (and writing a caret into it)
   * scrolls it into view from a fresh layout. Fix: run in a LAYOUT effect,
   * every focus uses `preventScroll`, and the restore path hands us the
   * scrollTop it captured BEFORE the state commit so we can write it back
   * in the same frame. Only then, if the target is genuinely outside the
   * scroll viewport, do we nudge with `block:'nearest'` — never 'center',
   * never smooth. */
  useLayoutEffect(() => {
    if (!focusRequest) return;
    const sc = (containerRef.current?.closest("main") ?? null) as HTMLElement | null;
    const keep = focusRequest.preserveScrollTop;
    const restoreScroll = () => {
      if (sc && keep != null && sc.scrollTop !== keep) sc.scrollTop = keep;
    };
    restoreScroll();
    const el = refs.current[focusRequest.id];
    if (!el) {
      restoreScroll();
      setFocusRequest(null);
      return;
    }
    el.focus({ preventScroll: true });
    const src = blocks.find((b) => b.id === focusRequest.id)?.text ?? "";
    const c =
      focusRequest.caret === "end"
        ? src.length
        : focusRequest.caret === "start" || focusRequest.caret == null
          ? 0
          : Math.min(focusRequest.caret, src.length);
    try {
      writeCaret(el, src, c, c);
    } catch {
      /* elements that don't support caret placement */
    }
    restoreScroll();
    const rect = el.getBoundingClientRect();
    const vTop = sc ? sc.getBoundingClientRect().top : 0;
    const vBottom = sc ? sc.getBoundingClientRect().bottom : window.innerHeight;
    if (rect.bottom < vTop || rect.top > vBottom) {
      el.scrollIntoView({ block: "nearest", behavior: "auto" });
    }
    setFocusRequest(null);
  }, [focusRequest, blocks]);

  /* ────────── Undo/redo ──────────
   *
   * The snapshot stack lives in a MODULE-LEVEL store keyed by page id
   * (src/lib/undo-store.ts), not in a ref — refs die with the component
   * and this editor is remounted more often than it looks (see the store's
   * header). See src/lib/undo-stack.ts for the pure model + tests. The
   * rule: PUSH BEFORE a change, not after. Typing is coalesced (one push
   * per burst) via shouldCoalesce(). Structural ops always push. Restoring
   * bypasses commit() so it can't push itself. */
  const blocksRef = useRef<Blk[]>(blocks);
  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);
  const focusedIdRef = useRef<string | null>(null);
  useEffect(() => {
    focusedIdRef.current = focusedId;
  }, [focusedId]);
  const isRestoringRef = useRef(false);

  function getCurrentCaret(): UndoEntry<Blk>["caret"] {
    const id = focusedIdRef.current;
    if (!id) return null;
    const el = refs.current[id];
    if (!el) return null;
    const src = blocksRef.current.find((b) => b.id === id)?.text ?? "";
    const car = readCaret(el, src);
    if (!car) return null;
    return { blockId: id, offset: car.start };
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
        const marker = getTypingMarker(pageId);
        if (key) {
          const now = Date.now();
          const coalesce = shouldCoalesce(marker.at, now, marker.key, key);
          if (!coalesce) {
            setUndoState(pageId, undoPush(getUndoState<Blk>(pageId), prevEntry));
          } else {
            // Any new action clears future, even on coalesce.
            setUndoState(pageId, {
              past: getUndoState<Blk>(pageId).past,
              future: [],
            });
          }
          setTypingMarker(pageId, now, key);
        } else {
          // Structural: push and end any in-flight typing burst.
          setUndoState(pageId, undoPush(getUndoState<Blk>(pageId), prevEntry));
          setTypingMarker(pageId, null, null);
        }
      }
      // Keep the live mirror in step SYNCHRONOUSLY — the effect below runs a
      // render later, and two commits in the same tick must not read a
      // pre-commit list.
      blocksRef.current = next;
      setBlocks(next);
      onChange(next);
    },
    [onChange, pageId],
  );

  const restoreEntry = useCallback(
    (entry: UndoEntry<Blk>) => {
      isRestoringRef.current = true;
      setTypingMarker(pageId, null, null);
      // Capture the scroll position BEFORE the state commit, and hand it to
      // the focus effect so the whole restore is scroll-neutral.
      const sc = (containerRef.current?.closest("main") ??
        null) as HTMLElement | null;
      const keep = sc ? sc.scrollTop : null;
      const before = new Set(blocksRef.current.map((b) => b.id));
      blocksRef.current = entry.blocks;
      setBlocks(entry.blocks);
      onChange(entry.blocks);
      // Restore focus where the caret was. When no block had the caret
      // (undoing a deleted selection, a drag, a checkbox click, a menu
      // action), stay where you are: blocks that came back are selected so
      // you can see them, and nothing jumps to the top of the page.
      const c = entry.caret;
      const survivors = entry.blocks;
      if (c && survivors.some((b) => b.id === c.blockId)) {
        setFocusRequest({
          id: c.blockId,
          caret: c.offset,
          preserveScrollTop: keep,
        });
      } else {
        const back = survivors.filter((b) => !before.has(b.id)).map((b) => b.id);
        if (back.length) {
          setSelScope(null);
          setSelectedIds(new Set(back));
        }
        if (sc && keep !== null) {
          requestAnimationFrame(() => {
            sc.scrollTop = keep;
          });
        }
      }
      // Release the guard on the next tick so re-render's effects don't push.
      queueMicrotask(() => {
        isRestoringRef.current = false;
      });
    },
    [onChange, pageId],
  );

  const performUndo = useCallback(() => {
    const cur: UndoEntry<Blk> = {
      blocks: blocksRef.current,
      caret: getCurrentCaret(),
    };
    const r = undoDo(getUndoState<Blk>(pageId), cur);
    if (!r) return;
    setUndoState(pageId, r.state);
    restoreEntry(r.entry);
  }, [restoreEntry, pageId]);

  const performRedo = useCallback(() => {
    const cur: UndoEntry<Blk> = {
      blocks: blocksRef.current,
      caret: getCurrentCaret(),
    };
    const r = undoRedo(getUndoState<Blk>(pageId), cur);
    if (!r) return;
    setUndoState(pageId, r.state);
    restoreEntry(r.entry);
  }, [restoreEntry, pageId]);

  // Window-level ⌘Z / ⌘⇧Z / ⌘Y — deliberate EXCEPTION to isTypingTarget,
  // alongside ⌘K and ⌘,. preventDefault always, so the browser's own
  // (broken, per-input) undo stack never also fires.
  useEffect(() => {
    if (locked) return;
    const onKey = (e: KeyboardEvent) => {
      if (!primaryMod(e)) return;
      // The title, property fields and dialogs keep their own native undo;
      // ⌘Z there must not undo the page body.
      const t = e.target as HTMLElement | null;
      if (t && isTypingTarget(t) && !t.closest?.("[data-gio-page-body]")) return;
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
  /* THE CONTAINER SCOPE OF THE CURRENT SELECTION.
   *
   * `null` = the top-level (page) list; otherwise the column or callout
   * whose children the selection lives in. Block ids are globally unique
   * so `selectedIds` can stay flat, but every consumer (Delete, ⌘C/⌘X,
   * ⌘A, shift-click, dragging a selected run) needs to know WHICH list to
   * act on — and a selection may never span two containers. */
  const [selScope, setSelScope] = useState<ScopeRef>(null);
  const selScopeRef = useRef<ScopeRef>(null);
  useEffect(() => {
    selScopeRef.current = selScope;
  }, [selScope]);
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
  // A column ref has `colIndex`; a callout ref (Pass A: not yet used by
  // any call site in this file) has `callout: true` instead.
  const colCi = (r: ColumnRef): number | null =>
    "colIndex" in r ? r.colIndex : null;
  const trackKey = (r: ColumnRef) =>
    "colIndex" in r ? `${r.blockId}:${r.colIndex}` : `${r.blockId}:callout`;

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

  // Clear selection when clicking into any textarea/input. Escape and
  // every other clear path drop the SCOPE with it.
  const clearSelection = useCallback(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
    setSelScope(null);
    anchorId.current = null;
  }, []);

  /** The list a scope names: `null` → the top-level blocks, otherwise the
   *  container's children. Returns null when the container has vanished. */
  const scopedList = useCallback(
    (scope: ScopeRef, source?: Blk[]): Blk[] | null =>
      getContainerList(source ?? blocksRef.current, scope),
    [],
  );

  /* When a block selection is created (marquee / shift-click on a handle /
   * click on a no-editor row) we blur any focused contenteditable and drop
   * the browser's own DOM selection. Otherwise the native selection lingers
   * invisibly next to ours and competes with ⌘C — this is the second half
   * of the "selection beats focus" rule in shouldCopyBlocks. */
  const blurAndClearDomSelection = useCallback(() => {
    if (typeof document === "undefined") return;
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.isContentEditable || active.tagName === "TEXTAREA" || active.tagName === "INPUT")) {
      try {
        active.blur();
      } catch {
        /* ignore */
      }
    }
    try {
      window.getSelection?.()?.removeAllRanges();
    } catch {
      /* ignore */
    }
  }, []);

  /* Shift-click on a handle extends the selection WITHIN ONE CONTAINER.
   * The scope is the clicked row's own container (columns/callout children
   * register theirs in rowColRefById), so a shift-click can never bridge a
   * container boundary — if the anchor lives elsewhere, the clicked row
   * becomes the new anchor instead of producing a scrambled cross-container
   * selection. */
  const handleShiftClick = useCallback(
    (id: string, colRef: ColumnRef | null = null) => {
      const scope: ScopeRef = colRef ?? rowColRefById.current.get(id) ?? null;
      const list = scopedList(scope);
      if (!list) return;
      const ids = list.map((b) => b.id);
      const targetIdx = ids.indexOf(id);
      if (targetIdx < 0) return;
      const anchor = anchorId.current;
      const anchorInScope =
        !!anchor &&
        ids.indexOf(anchor) >= 0 &&
        sameScope(selScopeRef.current, scope);
      if (!anchorInScope) {
        anchorId.current = id;
        setSelScope(scope);
        setSelectedIds(new Set([id]));
        blurAndClearDomSelection();
        return;
      }
      const aIdx = ids.indexOf(anchor!);
      const [lo, hi] = aIdx <= targetIdx ? [aIdx, targetIdx] : [targetIdx, aIdx];
      setSelScope(scope);
      setSelectedIds(new Set(ids.slice(lo, hi + 1)));
      blurAndClearDomSelection();
    },
    [scopedList, blurAndClearDomSelection],
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

  /* Right-click-on-a-selected-block menu — a small standalone RowMenu that
   * lives at container level, not per-block, because the surface it anchors
   * to is the block the user right-clicked, not a handle. */
  const [selMenu, setSelMenu] = useState<{
    anchor: HTMLElement;
    spec: MenuSpec;
  } | null>(null);
  const closeSelMenu = useCallback(() => setSelMenu(null), []);



  /* ────────── Drag: pointer session on a handle ──────────
   *
   * `sourceCol` identifies where the dragged run lives — null for the
   * top-level block list, or a `{blockId, colIndex}` for a column. A drag
   * started from inside a column carries its colRef so the source list
   * is unambiguous at endDrag time, even when the pointer wanders across
   * multiple columns during the drag. */

  // A press on the handle is only a drag once the pointer has moved 4px:
  // a plain click still opens the block menu, and a real drag never also
  // opens it on release.
  const pendingDragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    ids: string[];
    sourceCol: ColumnRef | null;
    handle: HTMLElement;
  } | null>(null);
  const ghostRef = useRef<{ el: HTMLElement; offX: number; offY: number } | null>(null);

  const beginDrag = useCallback(
    (
      id: string,
      ev: React.PointerEvent<HTMLElement>,
      sourceCol: ColumnRef | null = null,
    ) => {
      // Multi-drag applies when the handle belongs to a currently-selected
      // block AND the selection's scope is the drag's source list — a
      // selection inside a column drags as a run within that column.
      let dragIds: string[] = [id];
      const list = scopedList(sourceCol);
      if (!list) return;
      const ids = list.map((b) => b.id);
      if (ids.indexOf(id) < 0) return;
      const isMulti =
        selectedIds.size > 1 &&
        selectedIds.has(id) &&
        sameScope(selScopeRef.current, sourceCol);
      if (isMulti) dragIds = ids.filter((x) => selectedIds.has(x));
      pendingDragRef.current = {
        pointerId: ev.pointerId,
        x: ev.clientX,
        y: ev.clientY,
        ids: dragIds,
        sourceCol,
        handle: ev.currentTarget,
      };
    },
    [scopedList, selectedIds],
  );

  /** Turn a pending press into a real drag: pointer capture, no text
   *  selection, and a ghost of the block(s) that follows the pointer. */
  const activateDrag = useCallback((ev: PointerEvent) => {
    const pd = pendingDragRef.current;
    pendingDragRef.current = null;
    if (!pd) return;
    if (pd.ids.length === 1) {
      setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
      setSelScope(null);
      anchorId.current = null;
    }
    try {
      pd.handle.setPointerCapture(pd.pointerId);
    } catch {
      /* ignore */
    }
    window.getSelection()?.removeAllRanges();
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    const row = rowEls.current.get(pd.ids[0]);
    if (row) {
      const r = row.getBoundingClientRect();
      const g = row.cloneNode(true) as HTMLElement;
      g.removeAttribute("data-block-id");
      g.querySelectorAll("[data-block-id]").forEach((n) => n.removeAttribute("data-block-id"));
      g.querySelectorAll("[contenteditable]").forEach((n) => n.removeAttribute("contenteditable"));
      g.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
      Object.assign(g.style, {
        position: "fixed",
        left: "0px",
        top: "0px",
        width: `${r.width}px`,
        maxHeight: "180px",
        overflow: "hidden",
        margin: "0",
        pointerEvents: "none",
        zIndex: "9999",
        opacity: "0.9",
        background: "var(--color-surface)",
        borderRadius: "8px",
        boxShadow: "var(--shadow-popover)",
        willChange: "transform",
        transition: "none",
      } as Partial<CSSStyleDeclaration>);
      if (pd.ids.length > 1) {
        const badge = document.createElement("div");
        badge.textContent = String(pd.ids.length);
        badge.className = "gio-drag-count";
        g.appendChild(badge);
      }
      document.body.appendChild(g);
      ghostRef.current = { el: g, offX: r.left - pd.x, offY: r.top - pd.y };
      g.style.transform = `translate3d(${ev.clientX + ghostRef.current.offX}px, ${ev.clientY + ghostRef.current.offY}px, 0) scale(1.02)`;
    }
    const next = {
      ids: pd.ids,
      sourceCol: pd.sourceCol,
      targetCol: pd.sourceCol,
      gap: null,
      indicator: null,
    };
    draggingRef.current = next;
    setDragging(next);
  }, []);

  // While a press is pending, decide click vs drag.
  useEffect(() => {
    const onMove = (ev: PointerEvent) => {
      const pd = pendingDragRef.current;
      if (!pd || ev.pointerId !== pd.pointerId) return;
      if (Math.hypot(ev.clientX - pd.x, ev.clientY - pd.y) < 4) return;
      activateDrag(ev);
    };
    const onUp = (ev: PointerEvent) => {
      const pd = pendingDragRef.current;
      if (pd && ev.pointerId === pd.pointerId) pendingDragRef.current = null;
      // A flick can start and release a drag within one frame, before the
      // drag's own listeners are attached. End it here so it can't stay
      // live with no button held. (endDrag is a no-op the second time.)
      if (draggingRef.current) endDragRef.current(ev.type === "pointerup");
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    return () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
  }, [activateDrag]);

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

      // Shared containment-wins hit test for both container kinds
      // (column tracks and callout children). Containment is the signal:
      // when the pointer is inside the container, the container ALWAYS
      // wins the hit-test, regardless of whether any child rows are
      // measurable. An "empty" container is either (a) genuinely zero
      // measurable rows or (b) exactly one placeholder empty text block
      // (columns are normalised to keep ≥1 block; a legacy callout that
      // has just been migrated may render one blank child). In both
      // cases we drop at gap 0 with the 2px indicator centred inside
      // the container's INNER content area — never hugging its border
      // (which reads as chrome) and never spilling to page width.
      const hitContainer = (
        colRef: ColumnRef,
        outerRect: DOMRect,
        trackEl: HTMLElement | null,
        kids: Blk[] | null,
      ): {
        targetCol: ColumnRef;
        gap: number;
        indicator: { x: number; y: number; width: number };
      } => {
        const innerRect = trackEl
          ? trackEl.getBoundingClientRect()
          : ({
              left: outerRect.left + 44,
              top: outerRect.top + 12,
              right: outerRect.right - 12,
              bottom: outerRect.bottom - 12,
              width: outerRect.width - 56,
            } as DOMRect);
        const width = innerRect.width;
        const xInContainer = innerRect.left - cRect.left;

        const rects: Array<{ id: string; top: number; bottom: number; mid: number }> = [];
        if (kids) {
          for (const c of kids) {
            const el = rowEls.current.get(c.id);
            if (!el) continue;
            const r = el.getBoundingClientRect();
            rects.push({ id: c.id, top: r.top, bottom: r.bottom, mid: (r.top + r.bottom) / 2 });
          }
        }
        const onlyEmptyPlaceholder =
          !!kids &&
          kids.length === 1 &&
          kids[0].type === "text" &&
          !((kids[0] as { text?: string }).text ?? "").trim();

        if (rects.length === 0 || onlyEmptyPlaceholder) {
          const yCentre = (innerRect.top + innerRect.bottom) / 2;
          return {
            targetCol: colRef,
            gap: 0,
            indicator: { x: xInContainer, y: yCentre - cRect.top - 1, width },
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
      };

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
          return hitContainer(
            { blockId: b.id, colIndex: chosen.colIndex },
            cb,
            chosen.el,
            b.cols[chosen.colIndex] as Blk[],
          );
        }
      }

      // Step 1b: callout containers. Containment wins here too — a
      // legacy (unmigrated) callout with no children track registered
      // still catches the drop and shows a centred indicator inside its
      // inner box; the actual migration happens on release via Pass A.
      if (!draggingColumnsBlock) {
        for (const b of blocks) {
          if (b.type !== "callout") continue;
          const outer = rowEls.current.get(b.id);
          if (!outer) continue;
          const cb = outer.getBoundingClientRect();
          if (
            clientY < cb.top ||
            clientY > cb.bottom ||
            clientX < cb.left ||
            clientX > cb.right
          )
            continue;
          const colRef: ColumnRef = { blockId: b.id, callout: true };
          const trackEl = colTracks.current.get(trackKey(colRef)) ?? null;
          const kids = Array.isArray(b.children) ? (b.children as Blk[]) : null;
          return hitContainer(colRef, cb, trackEl, kids);
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

  /* ────────── Which container is this point in? ──────────
   *
   * The same CONTAINMENT hit-test computeGap uses (columns tracks first,
   * then callout boxes), minus the indicator arithmetic. It answers the
   * marquee's only question at pointerdown: "which list did this gesture
   * start in?" — null meaning the page background. Recorded once per
   * gesture; never recomputed mid-drag, or dragging past a container's
   * edge would silently change the selection's scope. */
  const containerAtPoint = useCallback(
    (clientX: number, clientY: number): ScopeRef => {
      const inside = (r: DOMRect) =>
        clientY >= r.top &&
        clientY <= r.bottom &&
        clientX >= r.left &&
        clientX <= r.right;
      for (const b of blocksRef.current) {
        if (b.type === "columns" && Array.isArray(b.cols)) {
          const colsEl = rowEls.current.get(b.id);
          if (!colsEl || !inside(colsEl.getBoundingClientRect())) continue;
          for (let i = 0; i < b.cols.length; i++) {
            const el = colTracks.current.get(
              trackKey({ blockId: b.id, colIndex: i }),
            );
            if (!el) continue;
            const r = el.getBoundingClientRect();
            if (clientX >= r.left && clientX <= r.right)
              return { blockId: b.id, colIndex: i };
          }
          continue;
        }
        if (b.type === "callout") {
          const outer = rowEls.current.get(b.id);
          if (!outer || !inside(outer.getBoundingClientRect())) continue;
          // Only a MIGRATED callout (one with children) has child rows the
          // marquee could scope to; a legacy text-only callout stays a unit.
          if (!Array.isArray(b.children)) continue;
          return { blockId: b.id, callout: true };
        }
      }
      return null;
    },
    [],
  );


  // Auto-scroll while dragging near the top or bottom: proportional to how
  // close the pointer is to the edge, and the drop line follows the
  // content as it scrolls instead of freezing.
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const dragLastClient = useRef<{ x: number; y: number } | null>(null);
  const hitRafRef = useRef<number | null>(null);

  const applyHit = useCallback(() => {
    hitRafRef.current = null;
    const lp = dragLastClient.current;
    if (!draggingRef.current || !lp) return;
    const hit = computeGap(lp.x, lp.y);
    if (!hit) return;
    const prev = draggingRef.current;
    const same =
      prev.gap === hit.gap &&
      sameScope(prev.targetCol, hit.targetCol) &&
      prev.indicator?.x === hit.indicator.x &&
      prev.indicator?.y === hit.indicator.y &&
      prev.indicator?.width === hit.indicator.width;
    if (same) return; // nothing moved: don't re-render the page
    const next = { ...prev, targetCol: hit.targetCol, gap: hit.gap, indicator: hit.indicator };
    draggingRef.current = next;
    setDragging(next);
  }, [computeGap]);

  const tickScroll = useCallback(() => {
    scrollRafRef.current = null;
    const el = scrollContainerRef.current;
    const lp = dragLastClient.current;
    if (!el || !lp || !draggingRef.current) return;
    const v = edgeVelocity(lp, el.getBoundingClientRect());
    if (v.dy) {
      const before = el.scrollTop;
      el.scrollTop = before + v.dy;
      if (el.scrollTop !== before) applyHit();
      scrollRafRef.current = requestAnimationFrame(tickScroll);
    }
  }, [applyHit]);

  const onPointerMove = useCallback(
    (ev: PointerEvent) => {
      if (!draggingRef.current) return;
      dragLastClient.current = { x: ev.clientX, y: ev.clientY };
      const g = ghostRef.current;
      if (g) {
        g.el.style.transform = `translate3d(${ev.clientX + g.offX}px, ${ev.clientY + g.offY}px, 0) scale(1.02)`;
      }
      if (!scrollContainerRef.current) {
        const c = containerRef.current;
        scrollContainerRef.current = c?.closest("main") ?? null;
      }
      if (scrollRafRef.current == null) scrollRafRef.current = requestAnimationFrame(tickScroll);
      // Hit-testing measures every row: once per frame, not per event.
      if (hitRafRef.current == null) hitRafRef.current = requestAnimationFrame(applyHit);
    },
    [applyHit, tickScroll],
  );

  /** Measure every row's top, to animate rows from where they were to where
   *  a drop puts them (FLIP). */
  const snapshotRowTops = useCallback(() => {
    const tops = new Map<string, number>();
    rowEls.current.forEach((el, id) => tops.set(id, el.getBoundingClientRect().top));
    return tops;
  }, []);
  const playSettle = useCallback((before: Map<string, number>, moved: Set<string>) => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    requestAnimationFrame(() => {
      rowEls.current.forEach((el, id) => {
        const old = before.get(id);
        if (old == null) return;
        const dy = old - el.getBoundingClientRect().top;
        if (Math.abs(dy) < 1) return;
        el.animate(
          moved.has(id)
            ? [{ transform: `translateY(${dy}px)`, opacity: 0.6 }, { transform: "none", opacity: 1 }]
            : [{ transform: `translateY(${dy}px)` }, { transform: "none" }],
          { duration: moved.has(id) ? 240 : 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
        );
      });
    });
  }, []);

  const endDrag = useCallback(
    (commitDrop: boolean) => {
      const d = draggingRef.current;
      draggingRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      if (scrollRafRef.current != null) cancelAnimationFrame(scrollRafRef.current);
      if (hitRafRef.current != null) cancelAnimationFrame(hitRafRef.current);
      scrollRafRef.current = null;
      hitRafRef.current = null;
      ghostRef.current?.el.remove();
      ghostRef.current = null;
      setDragging(null);
      if (!d) return;
      // A real drag ended: the release must not also "click" the handle
      // (which would open the block menu).
      const swallow = (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
      };
      document.addEventListener("click", swallow, true);
      const unswallow = () => {
        window.removeEventListener("pointerup", afterRelease, true);
        window.removeEventListener("pointerdown", unswallow, true);
        document.removeEventListener("click", swallow, true);
      };
      const afterRelease = () => window.setTimeout(unswallow, 0);
      if (commitDrop) {
        // Ended by the release itself: its click follows immediately.
        window.setTimeout(unswallow, 0);
      } else {
        // Cancelled (Esc, blur) with the button maybe still held: swallow
        // the click that comes with the eventual release, and never a later
        // press.
        window.addEventListener("pointerup", afterRelease, true);
        window.addEventListener("pointerdown", unswallow, true);
      }
      if (!commitDrop || d.gap == null) return;
      const froms: ReorderPath[] = d.ids.map((id) => {
        // Discover this id's source list from the registry so cross-list
        // drags remain correct even if `sourceCol` is stale. Columns AND
        // callouts: the old column-only lookup left a callout child's
        // index at -1, so dragging out of a callout silently did nothing.
        const colRef = rowColRefById.current.get(id) ?? d.sourceCol;
        const list = colRef === null ? blocks : getContainerList(blocks, colRef);
        const index = list ? list.findIndex((x) => x.id === id) : -1;
        return { col: colRef, index };
      });
      // Bail if any path failed to resolve.
      if (froms.some((p) => p.index < 0)) return;
      const to: ReorderPath = { col: d.targetCol, index: d.gap };
      const makeEmpty = () => newBlock("text");
      const next0 =
        d.ids.length === 1
          ? moveBlockAcross(blocks, froms[0], to, makeEmpty)
          : moveRunAcross(blocks, froms, to, makeEmpty);
      if (next0 === blocks) return;
      if (next0.length === blocks.length && next0.every((x, i) => x === blocks[i])) return;
      // Re-clamp: a block dragged above a shallower neighbour must not
      // remain at an orphan level. reclampIndents walks the flat list
      // once and applies the parent+1 rule.
      const next = reclampIndents(next0);
      const before = snapshotRowTops();
      commit(next);
      playSettle(before, new Set(d.ids));
    },
    [blocks, commit, snapshotRowTops, playSettle],
  );

  // One set of listeners per drag (not re-added on every pointer move).
  const isDragging = dragging !== null;
  const endDragRef = useRef(endDrag);
  endDragRef.current = endDrag;
  const onPointerMoveRef = useRef(onPointerMove);
  onPointerMoveRef.current = onPointerMove;
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: PointerEvent) => onPointerMoveRef.current(e);
    const onUp = () => endDragRef.current(true);
    const onCancel = () => endDragRef.current(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        endDragRef.current(false);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onCancel);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onCancel);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [isDragging]);
  // Never leave a ghost or a locked cursor behind if the page unmounts
  // mid-drag.
  useEffect(
    () => () => {
      ghostRef.current?.el.remove();
      if (draggingRef.current) {
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      }
    },
    [],
  );

  /* ────────── Scoped selection operations ──────────
   * Every consumer of a block selection goes through these two helpers, so
   * a selection inside a column or callout is deleted / copied / cut from
   * ITS OWN list and never from the top-level one. */

  const selectedInScope = useCallback(
    (source?: Blk[]): { list: Blk[]; picked: Blk[]; scope: ScopeRef } | null => {
      const scope = selScopeRef.current;
      const list = scopedList(scope, source);
      if (!list) return null;
      const picked = list.filter((b) => selectedIds.has(b.id));
      if (picked.length === 0) return null;
      return { list, picked, scope };
    },
    [scopedList, selectedIds],
  );

  const deleteSelection = useCallback(() => {
    const s = selectedInScope(blocks);
    if (!s) return;
    const toDrop = s.list
      .map((b, i) => (selectedIds.has(b.id) ? i : -1))
      .filter((i) => i >= 0);
    const nextList = deleteIndices(s.list, toDrop, () => newBlock("text"));
    const next =
      s.scope === null
        ? nextList
        : setContainerList(blocks, s.scope, nextList);
    clearSelection();
    commit(next as Blk[]);
  }, [selectedInScope, selectedIds, blocks, clearSelection, commit]);

  /* ────────── Document keydown: Escape / Delete for selection ────────── */

  useEffect(() => {
    if (selectedIds.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape is a deliberate exception to the typing guard. It clears
      // BOTH the selection and its scope.
      if (e.key === "Escape") {
        e.preventDefault();
        clearSelection();
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds, clearSelection, deleteSelection]);

  /* ────────── Copy / Cut a block selection ──────────
   *
   * Writes TWO representations onto the clipboard (Markdown + HTML) so
   * pasting into Notion, Word, or Google Docs arrives formatted rather
   * than as literal `**` and `#`. Guard uses `shouldCopyBlocks`, not the
   * bare `isTypingTarget` — after phase 2b the focused element inside a
   * selected block is a contenteditable, so a plain typing-target guard
   * would silently swallow every ⌘C. See is-typing.ts for the contract. */

  const toast = useToast();

  const runCopySelection = useCallback(
    (opts: { cut: boolean }) => {
      const s = selectedInScope(blocks);
      if (!s) return;
      const selected = s.picked;
      const p = writeBlocksClipboard(selected as unknown as Parameters<
        typeof writeBlocksClipboard
      >[0]);
      const after = () => {
        toast.push(
          `${opts.cut ? "Cut" : "Copied"} ${selected.length} ${selected.length === 1 ? "block" : "blocks"}`,
        );
        if (opts.cut && !locked) deleteSelection();
      };
      if (p && typeof p.then === "function") p.then(after).catch(() => after());
      else after();
    },
    [selectedInScope, blocks, deleteSelection, locked, toast],
  );

  useEffect(() => {
    if (selectedIds.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (!primaryMod(e)) return;
      const key = e.key.toLowerCase();
      if (key !== "c" && key !== "x") return;
      // Selection beats focus: with a block selection active, always
      // operate on the selection regardless of what has focus.
      if (!shouldCopyBlocks(selectedIds.size, e.target)) return;
      e.preventDefault();
      runCopySelection({ cut: key === "x" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds, runCopySelection]);

  /* ────────── ⌘A — select all blocks (block-selection scope) ──────────
   * The in-textarea two-stage behaviour lives in the textarea onKeyDown.
   * This handler only fires when a block-selection is already active AND
   * focus is outside a text field, so ⌘A extends that selection to the
   * whole of ITS SCOPE — the container's children when the selection lives
   * in one, the page otherwise. */
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (!primaryMod(e)) return;
      if (e.key.toLowerCase() !== "a") return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      const list = scopedList(selScopeRef.current, blocks);
      if (!list) return;
      setSelectedIds(new Set(list.map((b) => b.id)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds, blocks, scopedList]);

  /* ────────── Paste Markdown → real blocks ──────────
   * Inverse of the copy path above. If the pasted text has no newline and
   * no markdown markers, we DO NOTHING and let the browser paste it as
   * ordinary text (undo history stays intact). Otherwise we splice parsed
   * blocks at the caret — or replace the current block-selection run. */
  /** Insert one image block per pasted/dropped file and upload each. The
   *  block lands immediately with no path; the upload patches it in. */
  const insertImageFiles = useCallback(
    (blockId: string, files: File[]) => {
      const idx = blocksRef.current.findIndex((b) => b.id === blockId);
      if (idx === -1) return;
      const made = files.map(() => newBlock("image"));
      const next = [...blocksRef.current];
      next.splice(idx + 1, 0, ...made);
      commit(next);
      files.forEach((file, i) => {
        const id = made[i].id;
        uploadImage(file, workspaceId, pageId)
          .then((path) => {
            const cur = blocksRef.current.map((b) =>
              b.id === id ? { ...b, path } : b,
            );
            commit(cur);
          })
          .catch(() => toast.push("That image could not be uploaded."));
      });
    },
    [commit, pageId, workspaceId, toast],
  );

  const handlePaste = useCallback(
    (blockId: string, e: React.ClipboardEvent<HTMLElement>) => {
      if (locked) return;

      // A pasted screenshot is the single most common way an image gets
      // into a migrated page, so files are checked BEFORE any text
      // interpretation — Word and Chrome both ship HTML alongside them.
      const files = Array.from(e.clipboardData?.files ?? []).filter(
        (f) => !rejectReason(f),
      );
      if (files.length > 0) {
        e.preventDefault();
        insertImageFiles(blockId, files);
        return;
      }

      const htmlSrc = e.clipboardData?.getData("text/html") ?? "";
      const plainSrc = e.clipboardData?.getData("text/plain") ?? "";

      // A code block is plain text: let the browser paste the plain text.
      if (blocksRef.current.find((x) => x.id === blockId)?.type === "code") return;

      // Pasting a bare URL over a text SELECTION hyperlinks the selection
      // instead of replacing it. Checked after the file branch (a pasted
      // screenshot still wins) and before block parsing, which returns null
      // for a single-line paste and would let the browser overwrite the words.
      {
        const el = e.currentTarget;
        // Source comes from the LIVE DOM: Editable is uncontrolled, so state
        // is only eventually consistent and readCaret would map through a
        // stale string and return null.
        const src = el ? readEditableSource(el) : "";
        const car = el ? readCaret(el, src) : null;
        const lp = car ? linkPaste(src, car.start, car.end, plainSrc) : null;
        if (lp) {
          e.preventDefault();
          commitSourceToEditable(el, lp.text, lp.caret);
          return;
        }
      }

      const parsedOut = parsePasteToBlocks(htmlSrc, plainSrc);

      if (!parsedOut) return; // Let the browser handle a plain single-line paste.
      const parsed = parsedOut.blocks;

      // One line copied from a browser, Slack or Docs (it arrives as HTML)
      // goes inside this block at the caret — not three blocks.
      if (selectedIds.size === 0) {
        const el = e.currentTarget;
        const src = el ? readEditableSource(el) : "";
        const car = el ? readCaret(el, src) : null;
        const ip = car ? inlinePaste(src, car.start, car.end, parsed) : null;
        if (ip) {
          e.preventDefault();
          commitSourceToEditable(el, ip.text, ip.caret);
          return;
        }
      }
      e.preventDefault();

      const idx = blocks.findIndex((b) => b.id === blockId);
      if (idx === -1) return;

      let next: Blk[];
      const focusId = parsed[parsed.length - 1].id;

      // If a TOP-LEVEL block-selection is active, replace the selected run.
      // A selection scoped to a container is handled by that container's
      // own paste path, so we never splice its ids into the page list.
      if (selectedIds.size > 0 && selScopeRef.current === null) {
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
        const ta = e.currentTarget;
        const src = readEditableSource(ta);
        const car = readCaret(ta, src);
        const r = splicePasteAtCaret(blocks, blockId, car?.start ?? src.length, parsed, car?.end ?? src.length);
        if (!r) return;
        next = r.next;
      }


      commit(next);
      setFocusRequest({ id: focusId, caret: "end" });
      if (parsed.length > 1) toast.push(`Pasted ${parsed.length} blocks`);
    },
    [blocks, commit, locked, selectedIds, clearSelection, toast, insertImageFiles],
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
    /** The container the gesture STARTED in. Fixed for the whole drag. */
    scope: ScopeRef;
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

  const selectByMarqueeY = useCallback(
    (scope: ScopeRef, y1: number, y2: number) => {
      /* Row rects are measured in the SAME container space as the band's
       * anchor (client rect minus the container's client rect), which is
       * scroll-invariant: both move together, so their difference doesn't
       * change as the container auto-scrolls. Rects rather than offsetTop
       * because a row inside a column has a positioned ancestor of its own.
       *
       * Then rowsInScope enforces the scope rule: a page-scoped band never
       * sees container children, and a container-scoped band never sees the
       * parent, a sibling column, or a top-level block. */
      const c = containerRef.current;
      if (!c) return;
      const cTop = c.getBoundingClientRect().top;
      const rows: {
        id: string;
        top: number;
        height: number;
        scope: ScopeRef;
      }[] = [];
      rowEls.current.forEach((el, id) => {
        const r = el.getBoundingClientRect();
        rows.push({
          id,
          top: r.top - cTop,
          height: r.height,
          scope: rowColRefById.current.get(id) ?? null,
        });
      });
      rows.sort((a, b) => a.top - b.top);
      const candidates = rowsInScope(scope, rows);
      const ids = new Set<string>(rowsInBand(candidates, y1, y2));
      // Same rows as last move: keep the old set so nothing re-renders.
      setSelectedIds((prev) =>
        prev.size === ids.size && [...ids].every((id) => prev.has(id)) ? prev : ids,
      );
      setSelScope(ids.size === 0 ? null : scope);
    },
    [],
  );

  const applyMarqueeFromLastPointer = useCallback(() => {
    const m = marqueeRef.current;
    const lp = marqueeLastClient.current;
    if (!m || !m.active || !lp) return;
    const p = containerPoint(lp.x, lp.y);
    setMarquee({ x1: m.originX, y1: m.originY, x2: p.x, y2: p.y });
    selectByMarqueeY(m.scope, m.originY, p.y);
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
      // Editable content: the browser owns this gesture. Blocks became
      // contenteditable in the WYSIWYG migration and this list still only
      // named textarea, so every drag across a word opened a marquee instead
      // of selecting text.
      //
      // The click branch in onUp used to clear a block selection for this
      // case; it no longer runs (no marquee session is opened), so clear here.
      if (t.closest(MARQUEE_SKIP_SEL)) {
        setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
        setSelScope(null);
        anchorId.current = null;
        // A text selection can't cross blocks (each is its own editable),
        // so a drag that leaves its block becomes a block selection, from
        // the block it started in to the one under the pointer — as in
        // Notion. Inside the starting block it stays a text selection.
        const originId = t.closest<HTMLElement>("[data-block-id]")?.getAttribute("data-block-id");
        if (originId && !e.shiftKey) {
          const scope: ScopeRef = rowColRefById.current.get(originId) ?? null;
          let raf = 0;
          let last: { x: number; y: number } | null = null;
          let switched = false;
          const apply = () => {
            raf = 0;
            if (!last) return;
            const under = document
              .elementFromPoint(last.x, last.y)
              ?.closest<HTMLElement>("[data-block-id]")
              ?.getAttribute("data-block-id");
            const list = scopedList(scope);
            if (!under || !list) return;
            const ids = list.map((b) => b.id);
            const a = ids.indexOf(originId);
            const b = ids.indexOf(under);
            if (a < 0 || b < 0) return;
            if (!switched && a === b) return;
            if (!switched) {
              switched = true;
              window.getSelection()?.removeAllRanges();
              (document.activeElement as HTMLElement | null)?.blur?.();
              anchorId.current = originId;
            }
            setSelScope(scope);
            setSelectedIds(new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1)));
          };
          const onMove = (ev: PointerEvent) => {
            if (!(ev.buttons & 1)) return;
            last = { x: ev.clientX, y: ev.clientY };
            if (!raf) raf = requestAnimationFrame(apply);
          };
          const onUp = () => {
            if (raf) cancelAnimationFrame(raf);
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
          window.addEventListener("pointercancel", onUp);
        }
        return;
      }
      // Interactive chrome: bail WITHOUT clearing — shift-clicking block
      // handles is how a selection gets built, so clearing here would make
      // range selection impossible.
      if (t.closest("button, [data-slash-menu], [data-block-handle]")) {
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
        // The marquee operates within the container where it STARTED.
        scope: containerAtPoint(e.clientX, e.clientY),
        moved: false,
      };
      marqueeLastClient.current = { x: e.clientX, y: e.clientY };
    },
    [containerPoint, containerAtPoint, scopedList],
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
      // Filter interactive targets that live outside the body too. Same
      // shared list, plus the chrome that only exists out here.
      if (
        t.closest(
          `${MARQUEE_SKIP_SEL}, button, [data-slash-menu], [data-block-handle], [data-popover-root]`,
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
        // A press in the lateral margin is by definition outside every
        // container, so this is page scope — but ask, don't assume.
        scope: containerAtPoint(e.clientX, e.clientY),
        moved: false,
      };
      marqueeLastClient.current = { x: e.clientX, y: e.clientY };
    };
    main.addEventListener("pointerdown", onDown);
    return () => main.removeEventListener("pointerdown", onDown);
  }, [containerPoint, containerAtPoint]);


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
        setSelScope(null);
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
      selectByMarqueeY(m.scope, m.originY, p.y);
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
        // Marquee drop ends with a real selection — banish the caret.
        blurAndClearDomSelection();
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
          // The row's own container is the selection's scope.
          setSelScope(rowColRefById.current.get(id) ?? null);
          setSelectedIds(new Set([id]));
          blurAndClearDomSelection();
          return;
        }
      }
      // Otherwise: clear any existing selection.
      setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
      setSelScope(null);
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
  }, [containerPoint, selectByMarqueeY, tickMarqueeScroll, blurAndClearDomSelection]);


  /* ────────── Slash menu state ────────── */

  const [slash, setSlash] = useState<{
    blockId: string;
    query: string;
    /** Where the "/" is in the block's source. */
    at: number;
    x: number;
    y: number;
    /** The block's top edge, for opening above it near the bottom. */
    yTop: number;
  } | null>(null);

  const filteredMenu = useMemo(() => {
    // Top-level slash menu: BLOCK_MENU + COLUMNS_MENU. ColumnStack (inside a
    // column) manages its own menu with BLOCK_MENU only — columns must
    // never nest (see src/lib/columns.ts).
    const all: MenuItem[] = [...BLOCK_MENU, ...COLUMNS_MENU];
    const q = (slash?.query ?? "").toLowerCase().trim();
    if (!q) return all;
    return all.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.type.includes(q) ||
        (m.kw != null && m.kw.includes(q)) ||
        (m.count != null && `col${m.count}`.includes(q)),
    );
  }, [slash]);
  const [menuIdx, setMenuIdx] = useState(0);
  useEffect(() => setMenuIdx(0), [slash?.query]);

  const closeSlash = useCallback(() => setSlash(null), []);

  const applyType = useCallback(
    (blockId: string, type: BlockType, count?: number, lang?: string) => {
      const idx = blocks.findIndex((b) => b.id === blockId);
      if (idx === -1) return;
      const prev = blocks[idx];
      const t = (prev.text ?? "");
      const at = slash && slash.blockId === blockId ? slash.at : t.lastIndexOf("/");
      const stripped = at >= 0 ? stripSlash(t, at, slash?.query ?? "") : t;
      const caretAfter = at >= 0 ? at : stripped.length;

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
      if (type === "code") {
        if (lang) nb.lang = lang;
        else nb.lang = "";
        if (lang === "mermaid") {
          FRESH_DIAGRAMS.add(blockId);
          if (!nb.text) nb.text = MERMAID_STARTER;
        }
      }
      if (type === "todo" && nb.checked == null) nb.checked = false;
      if (type === "toggle" && nb.open == null) nb.open = false;
      if (type === "callout") applyCalloutDefaults(nb);
      if (type === "table" && !nb.rows) nb.rows = [["", "", ""], ["", "", ""]];
      // Converting a text block into a sheet must seed the SAME grid the
      // factory makes; without it the sheet reached the model empty and
      // normalizeSheet padded it up to its 2×1 floors.
      if (type === "sheet" && !nb.cells) Object.assign(nb, newSheetGrid());
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
      setFocusRequest({ id: blockId, caret: caretAfter });
    },
    [blocks, commit, slash],
  );


  /* ────────── Block-handle menu: run ops (Move up/down, Duplicate, Delete, Copy link) ────────── */

  /* A handle op resolves the block's OWN container first. A block inside a
   * column or a callout has no top-level index, so the old top-level-only
   * lookup returned an empty run and every handle op (Delete, Move,
   * Duplicate, Turn into) silently no-opped inside a container. */
  type RunTarget = { scope: ScopeRef; list: Blk[]; run: number[] };

  const runTargetFor = useCallback(
    (blockId: string): RunTarget | null => {
      const scope: ScopeRef = rowColRefById.current.get(blockId) ?? null;
      const list = scopedList(scope, blocks);
      if (!list) return null;
      const ids = list.map((b) => b.id);
      const idx = ids.indexOf(blockId);
      if (idx < 0) return null;
      // A multi-block selection turns a handle op into a run op only when
      // the selection lives in THIS container.
      if (
        sameScope(selScopeRef.current, scope) &&
        selectedIds.has(blockId) &&
        selectedIds.size > 1
      ) {
        return {
          scope,
          list,
          run: ids
            .map((id, i) => (selectedIds.has(id) ? i : -1))
            .filter((i) => i >= 0)
            .sort((a, b) => a - b),
        };
      }
      return { scope, list, run: [idx] };
    },
    [blocks, scopedList, selectedIds],
  );

  const commitScoped = useCallback(
    (scope: ScopeRef, nextList: Blk[]) => {
      const next =
        scope === null ? nextList : (setContainerList(blocks, scope, nextList) as Blk[]);
      commit(next);
    },
    [blocks, commit],
  );

  const runMoveUp = useCallback(
    (blockId: string) => {
      const t = runTargetFor(blockId);
      if (!t || !t.run.length || t.run[0] === 0) return;
      const runStart = t.run[0];
      const runEnd = t.run[t.run.length - 1];
      const raw =
        t.run.length === 1
          ? moveBlock(t.list, runStart, runStart - 1)
          : moveRun(t.list, runStart, runEnd, runStart - 1);
      commitScoped(t.scope, reclampIndents(raw));
    },
    [runTargetFor, commitScoped],
  );

  const runMoveDown = useCallback(
    (blockId: string) => {
      const t = runTargetFor(blockId);
      if (!t || !t.run.length) return;
      const runStart = t.run[0];
      const runEnd = t.run[t.run.length - 1];
      if (runEnd >= t.list.length - 1) return;
      const raw =
        t.run.length === 1
          ? moveBlock(t.list, runStart, runStart + 1)
          : moveRun(t.list, runStart, runEnd, runEnd + 2);
      commitScoped(t.scope, reclampIndents(raw));
    },
    [runTargetFor, commitScoped],
  );

  /* ────────── Keyboard on a block selection ──────────
   * ↑/↓ move the selection, ⇧↑/⇧↓ extend it, ⌘⇧↑/⌘⇧↓ move the blocks,
   * Tab/⇧Tab indent them, Enter edits the last one. ⌘V replaces them with
   * what's on the clipboard. Focus moving into any field outside the page
   * body drops the selection, so ⌘X in the title cuts the title's text,
   * not the selected blocks. */
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      // Only when nothing else has focus (or focus is in the page body): a
      // focused menu item, dialog button or emoji grid keeps its own
      // Enter, Tab and arrows.
      const tgt = e.target as HTMLElement | null;
      if (tgt && tgt !== document.body && !tgt.closest?.("[data-gio-page-body]")) return;
      const s = selectedInScope(blocksRef.current);
      if (!s) return;
      const ids = s.list.map((b) => b.id);
      const idxs = ids.map((id, i) => (selectedIds.has(id) ? i : -1)).filter((i) => i >= 0);
      if (idxs.length === 0) return;
      const first = idxs[0];
      const last = idxs[idxs.length - 1];
      const vertical = e.key === "ArrowUp" || e.key === "ArrowDown";
      const dir = e.key === "ArrowUp" ? -1 : 1;
      if (vertical && primaryMod(e) && e.shiftKey && !locked) {
        e.preventDefault();
        if (dir < 0) runMoveUp(ids[first]);
        else runMoveDown(ids[first]);
        return;
      }
      if (vertical && !primaryMod(e) && !e.altKey) {
        e.preventDefault();
        let next: string[];
        if (e.shiftKey) {
          const aIdx = anchorId.current ? ids.indexOf(anchorId.current) : -1;
          const anchor = aIdx >= 0 ? aIdx : dir > 0 ? first : last;
          const edge = anchor === first ? last : first;
          const moved = Math.max(0, Math.min(ids.length - 1, edge + dir));
          const lo = Math.min(anchor, moved);
          const hi = Math.max(anchor, moved);
          next = ids.slice(lo, hi + 1);
          anchorId.current = ids[anchor];
        } else {
          const target = dir < 0 ? Math.max(0, first - 1) : Math.min(ids.length - 1, last + 1);
          next = [ids[target]];
          anchorId.current = ids[target];
        }
        setSelectedIds(new Set(next));
        const edgeId = dir < 0 ? next[0] : next[next.length - 1];
        rowEls.current.get(edgeId)?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key === "Enter" && !primaryMod(e) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const id = ids[last];
        clearSelection();
        setFocusRequest({ id, caret: "end" });
        return;
      }
      if (e.key === "Tab" && !locked) {
        e.preventDefault();
        let list = s.list;
        const order = e.shiftKey ? idxs : [...idxs];
        for (const i of order) {
          const r = opsIndent(list, ids[i], e.shiftKey ? -1 : 1);
          if (r) list = r.next;
        }
        commitScoped(s.scope, list);
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || t.closest?.("[data-gio-page-body]")) return;
      if (isTypingTarget(t)) clearSelection();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (locked || isTypingTarget(e.target)) return;
      const s = selectedInScope(blocksRef.current);
      if (!s) return;
      const html = e.clipboardData?.getData("text/html") ?? "";
      const plain = e.clipboardData?.getData("text/plain") ?? "";
      const parsed =
        parsePasteToBlocks(html, plain)?.blocks.filter((p) => s.scope === null || p.type !== "columns") ??
        (plain ? [newBlock("text", plain)] : []);
      if (parsed.length === 0) return;
      e.preventDefault();
      const out: Blk[] = [];
      let inserted = false;
      for (const b of s.list) {
        if (selectedIds.has(b.id)) {
          if (!inserted) out.push(...parsed);
          inserted = true;
        } else out.push(b);
      }
      clearSelection();
      commitScoped(s.scope, reclampIndents(out));
      setFocusRequest({ id: parsed[parsed.length - 1].id, caret: "end" });
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("paste", onPaste);
    };
  }, [selectedIds, selectedInScope, clearSelection, runMoveUp, runMoveDown, commitScoped, locked]);

  const runDuplicate = useCallback(
    (blockId: string) => {
      const t = runTargetFor(blockId);
      if (!t || !t.run.length) return;
      const runEnd = t.run[t.run.length - 1];
      const copies: Blk[] = t.run.map((i) => cloneWithFreshIds(t.list[i]));
      const nextList = [...t.list];
      nextList.splice(runEnd + 1, 0, ...copies);
      commitScoped(t.scope, nextList);
    },
    [runTargetFor, commitScoped],
  );

  const runDelete = useCallback(
    (blockId: string) => {
      const t = runTargetFor(blockId);
      if (!t || !t.run.length) return;
      const nextList = deleteIndices(t.list, t.run, () => newBlock("text"));
      clearSelection();
      commitScoped(t.scope, nextList);
    },
    [runTargetFor, commitScoped, clearSelection],
  );

  const runTurnInto = useCallback(
    (blockId: string, type: BlockType, extra?: Partial<Blk>) => {
      const t = runTargetFor(blockId);
      if (!t || !t.run.length) return;
      const nextList = [...t.list];
      for (const i of t.run) {
        const prev = nextList[i];
        const nb: Blk = { ...prev, type, ...(extra ?? {}) };
        if (type === "todo" && nb.checked == null) nb.checked = false;
        if (type === "toggle" && nb.open == null) nb.open = false;
        if (type === "callout") applyCalloutDefaults(nb);
        if (type === "table" && !nb.rows) nb.rows = [["", "", ""], ["", "", ""]];
      // Converting a text block into a sheet must seed the SAME grid the
      // factory makes; without it the sheet reached the model empty and
      // normalizeSheet padded it up to its 2×1 floors.
      if (type === "sheet" && !nb.cells) Object.assign(nb, newSheetGrid());
        if (type === "divider") nb.text = "";
        // Clear a stale toggle level unless we're explicitly setting one.
        if (type !== "toggle" || !("level" in (extra ?? {}))) {
          if (type !== "toggle") delete nb.level;
          else if (!extra?.level) delete nb.level;
        }
        nextList[i] = nb;
      }
      commitScoped(t.scope, nextList);
    },
    [runTargetFor, commitScoped],
  );

  const copyBlockLink = useCallback(
    (blockId: string) => {
      const t = runTargetFor(blockId);
      const firstId = t && t.run.length ? t.list[t.run[0]].id : blockId;
      const url = `${window.location.origin}/p/${pageId}#block-${firstId}`;
      toClipboard(url);
      toast.push("Link copied");
    },
    [runTargetFor, pageId, toast],
  );

  /* A link to a block (#block-<id>, or the older #<id>) scrolls to it and
   * highlights it briefly — on load and when the hash changes. */
  useEffect(() => {
    const go = () => {
      const raw = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (!raw) return;
      const id = raw.startsWith("block-") ? raw.slice(6) : raw;
      let tries = 0;
      const tick = () => {
        const el = document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`);
        if (!el) {
          if (++tries < 20) window.setTimeout(tick, 100);
          return;
        }
        el.scrollIntoView({ block: "center" });
        setSelectedIds(new Set([id]));
        window.setTimeout(() => setSelectedIds((cur) => (cur.size === 1 && cur.has(id) ? new Set() : cur)), 1600);
      };
      tick();
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [pageId]);

  /* Duplicate and delete acting on the whole active block-selection —
   * used by both the ⌘D shortcut and the right-click "n blocks selected"
   * menu, so both paths stay in sync. Duplicating N selected blocks
   * splices N copies contiguously right after the last selected index;
   * delete drops every selected index in one commit. */
  const runDuplicateSelected = useCallback(() => {
    const s = selectedInScope(blocks);
    if (!s) return;
    const idxs: number[] = [];
    s.list.forEach((b, i) => {
      if (selectedIds.has(b.id)) idxs.push(i);
    });
    if (!idxs.length) return;
    const copies: Blk[] = idxs.map((i) => cloneWithFreshIds(s.list[i]));
    const nextList = [...s.list];
    nextList.splice(idxs[idxs.length - 1] + 1, 0, ...copies);
    const next =
      s.scope === null ? nextList : setContainerList(blocks, s.scope, nextList);
    commit(next as Blk[]);
  }, [selectedInScope, blocks, commit, selectedIds]);

  const runDeleteSelected = useCallback(() => {
    deleteSelection();
  }, [deleteSelection]);

  // ⌘D duplicates the current block-selection run. Yields to text fields
  // — inside a textarea the browser's native ⌘D (or nothing) wins.
  useEffect(() => {
    if (locked) return;
    const onKey = (e: KeyboardEvent) => {
      if (!primaryMod(e)) return;
      if (e.key.toLowerCase() !== "d") return;
      if (isTypingTarget(e.target)) return;
      if (selectedIds.size === 0) return;
      e.preventDefault();
      runDuplicateSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, selectedIds, runDuplicateSelected]);

  /* ────────── Block-level inline formatting ──────────
   * A marquee selection blurs the editable and clears the DOM Range, so the
   * in-block ⌘B path never fires. These format WHOLE selected blocks through
   * commit(), and the selection deliberately SURVIVES so ⌘B then ⌘I works. */
  const applyBlockMark = useCallback(
    (pair: MarkPair) => {
      const s = selectedInScope(blocks);
      if (!s) return;
      const nextList = applyMarkToBlocks(s.list, selectedIds, pair);
      if (nextList === s.list) return; // identity → no undo entry
      const next =
        s.scope === null
          ? nextList
          : setContainerList(blocks, s.scope, nextList);
      commit(next as Blk[]);
    },
    [selectedInScope, blocks, selectedIds, commit],
  );

  useEffect(() => {
    if (locked) return;
    if (selectedIds.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (!primaryMod(e)) return;
      if (isTypingTarget(e.target)) return;
      const k = e.key.toLowerCase();
      let pair: MarkPair | null = null;
      if (e.shiftKey && k === "h") pair = MARK_HIGHLIGHT;
      else if (e.shiftKey && k === "x") pair = MARK_STRIKE;
      else if (e.shiftKey) pair = null;
      else if (k === "b") pair = MARK_BOLD;
      else if (k === "i") pair = MARK_ITALIC;
      else if (k === "u") pair = MARK_UNDERLINE;
      else if (k === "e") pair = MARK_CODE;
      if (!pair) return;
      e.preventDefault();
      applyBlockMark(pair);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, selectedIds, applyBlockMark]);

  const blockSelForToolbar: BlockSel | null = useMemo(() => {
    if (locked || selectedIds.size === 0) return null;
    const s = selectedInScope(blocks);
    if (!s) return null;
    const decide = (pair: MarkPair) =>
      blockMarkDecision(s.list, selectedIds, pair) === "unwrap";
    const active: Record<MarkName, boolean> = {
      bold: decide(MARK_BOLD),
      italic: decide(MARK_ITALIC),
      underline: decide(MARK_UNDERLINE),
      strike: decide(MARK_STRIKE),
      code: decide(MARK_CODE),
      highlight: decide(MARK_HIGHLIGHT),
    };
    return {
      count: selectedIds.size,
      active,
      onToggle: applyBlockMark,
      anchor: () => {
        let top = Infinity;
        let left = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        let found = false;
        selectedIds.forEach((id) => {
          const el = document.querySelector(
            `[data-block-id="${id}"]`,
          ) as HTMLElement | null;
          if (!el) return;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return;
          found = true;
          top = Math.min(top, r.top);
          left = Math.min(left, r.left);
          right = Math.max(right, r.right);
          bottom = Math.max(bottom, r.bottom);
        });
        if (!found) return null;
        return new DOMRect(left, top, right - left, bottom - top);
      },
    };
  }, [locked, selectedIds, selectedInScope, blocks, applyBlockMark]);

  const buildBlockHandleSpec = useCallback(
    (
      blockId: string,
      mctx: { setSpec: (s: MenuSpec) => void; close: () => void },
    ): MenuSpec => {
      const t = runTargetFor(blockId);
      const list: Blk[] = t?.list ?? blocks;
      const run: number[] = t?.run ?? [];
      const runStart = run[0] ?? 0;
      const runEnd = run[run.length - 1] ?? 0;
      const isMulti = run.length > 1;
      const target = list[runStart];
      const targetName = blockTypeName(target);
      const title = isMulti ? `${run.length} blocks` : targetName;
      const atTop = runStart === 0;
      const atEnd = runEnd >= list.length - 1;
      const curLevel = (target as { level?: unknown } | undefined)?.level;

      const turnIntoSub: MenuRow[] = [
        // A view is made from the slash menu, never turned into.
        ...BLOCK_MENU.filter((m) => m.type !== "view").map((m) => ({
          kind: "row" as const,
          label: m.name,
          // Icon comes from the block DEFINITION — one place, three menus.
          icon: m.ic,
          checked:
            !isMulti &&
            target?.type === m.type &&
            (m.type !== "code" || isDiagram(target) === (m.lang === "mermaid")) &&
            !(m.type === "toggle" && typeof curLevel === "string"),
          onPick: () => {
            runTurnInto(blockId, m.type, m.type === "code" ? { lang: m.lang ?? "" } : undefined);
            mctx.close();
          },
        })),
        // Toggle heading levels — sit next to the plain "Toggle" entry as
        // additional Turn-into options. Preserves text/body/open by
        // relying on runTurnInto's default patch behaviour.
        ...TOGGLE_HEADINGS.map(({ n, ic }) => ({
          kind: "row" as const,
          label: `Toggle heading ${n}`,
          icon: ic,
          checked: !isMulti && target?.type === "toggle" && curLevel === `h${n}`,
          onPick: () => {
            runTurnInto(blockId, "toggle", { level: `h${n}` as ToggleLevel });
            mctx.close();
          },
        })),
      ];

      const turnIntoSpec: MenuSpec = {
        title: isMulti ? `Turn ${run.length} blocks into` : "Turn into",
        rows: turnIntoSub,
        footer: "Every block type this page can hold.",
        onBack: () => mctx.setSpec(buildBlockHandleSpec(blockId, mctx)),
      };

      // Colour is a per-callout attribute. Show ONLY when every block in
      // the run is a callout — a colour row that silently skips non-
      // callouts is worse than no row.
      const allCallout = run.length > 0 && run.every((i) => list[i]?.type === "callout");
      const currentColor: CalloutColor =
        (target && (target as { color?: unknown }).color &&
          (CALLOUT_COLORS as readonly string[]).includes(
            (target as { color?: string }).color as string,
          )
          ? ((target as { color?: string }).color as CalloutColor)
          : "neutral");
      const colorSub: MenuRow[] = CALLOUT_COLORS.map((c) => ({
        kind: "row" as const,
        label: calloutLabel(c),
        // A miniature of the real block: tint fill AND its 1px ring.
        hasSwatch: true,
        swBg: calloutBg(c),
        swRing: calloutRing(c),
        checked: c === currentColor,
        onPick: () => {
          const next = [...list];
          for (const i of run) {
            if (next[i]?.type !== "callout") continue;
            const nb: Blk = { ...next[i] };
            // Stored as a KEY ('blue'), never a hex — a literal would not
            // theme and could outlive a palette change.
            if (c === "neutral") delete nb.color;
            else nb.color = c;
            next[i] = nb;
          }
          rememberCallout({ color: c });
          commitScoped(t?.scope ?? null, next);
          // Return to the block menu rather than closing: people try two
          // or three against the surrounding text.
          mctx.setSpec(buildBlockHandleSpec(blockId, mctx));
        },
      }));

      const rows: MenuRow[] = [
        ...(allCallout
          ? ([
              {
                kind: "row" as const,
                label: "Colour",
                icon: "droplet",
                hintSwatch: true,
                hintBg: calloutBg(currentColor),
                hintRing: calloutRing(currentColor),
                hint: { text: calloutLabel(currentColor) },
                onPick: () =>
                  mctx.setSpec({
                    title: "Colour",
                    rows: colorSub,
                    footer:
                      "Backgrounds only — the text stays the same weight and colour in all eight, so no callout can look like a warning it is not.",
                    onBack: () => mctx.setSpec(buildBlockHandleSpec(blockId, mctx)),
                  }),
              },
              { kind: "sep" as const },
            ] as MenuRow[])
          : []),

        {
          kind: "row",
          label: "Turn into",
          // The icon of the block you are ON: the menu says what you are
          // starting from before you open it.
          icon: blockIconKey(target),
          hint: { text: "›" },
          onPick: () => mctx.setSpec(turnIntoSpec),
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
      commitScoped,
      editedRel,
      editorFirstName,
      runTargetFor,
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
    // Merge against the LIVE block list, not this render's snapshot. An
    // async writer (an upload finishing) holds the callback from the render
    // that started it; merging into that stale array would silently undo
    // every change made in between.
    const next = blocksRef.current.map((b) => (b.id === id ? { ...b, ...patch } : b));
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
  function tryMarkdown(id: string, val: string, caret: number): boolean {
    const r = tryMarkdownShortcut(blocks, id, val, caret);
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
      const sci = dragging.sourceCol ? colCi(dragging.sourceCol) : null;
      const tci = dragging.targetCol ? colCi(dragging.targetCol) : null;
      const sameList =
        (dragging.sourceCol === null && dragging.targetCol === null) ||
        (dragging.sourceCol &&
          dragging.targetCol &&
          dragging.sourceCol.blockId === dragging.targetCol.blockId &&
          sci !== null &&
          tci !== null &&
          sci === tci);
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
        const ci = colCi(sourceCol);
        if (b?.cols && ci !== null) from = (b.cols[ci] as Blk[]).findIndex((x) => x.id === id);
      }
      return from < 0 ? true : dragging.gap !== from && dragging.gap !== from + 1;
    })();

  const ordinalMap = useMemo(() => numberedOrdinals(blocks), [blocks]);

  /* Escape gesture from inside a container (column OR callout): promote
   * focus to a top-level text block immediately after the parent block,
   * optionally removing the now-empty inner block. Reuses an existing
   * empty text neighbour if one is already there — never leaves a stray
   * empty. */
  const escapeColumn = useCallback(
    (colRef: ColumnRef, removeBlockId: string | null) => {
      const pi = blocks.findIndex((b) => b.id === colRef.blockId);
      if (pi === -1) return;
      const parent = blocks[pi];
      const isCallout = !("colIndex" in colRef);
      if (isCallout) {
        if (parent.type !== "callout") return;
      } else {
        if (parent.type !== "columns" || !Array.isArray(parent.cols)) return;
      }

      let nextBlocks: Blk[] = blocks;
      if (removeBlockId) {
        if (isCallout) {
          const kids = Array.isArray(parent.children)
            ? (parent.children as Blk[])
            : null;
          if (kids && kids.length > 1) {
            const stripped = kids.filter((cb) => cb.id !== removeBlockId);
            nextBlocks = blocks.map((b, i) =>
              i === pi ? { ...parent, children: stripped } : b,
            );
          }
        } else {
          const nextCols = (parent.cols as Blk[][]).map((col) => {
            if (col.length <= 1) return col;
            const stripped = col.filter((cb) => cb.id !== removeBlockId);
            return stripped.length ? stripped : col;
          });
          nextBlocks = blocks.map((b, i) =>
            i === pi ? { ...parent, cols: nextCols } : b,
          );
        }
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

  /* Backspace in an empty block that is the ONLY block of its column, when
   * EVERY column is likewise empty: the columns block dissolves into a
   * single empty text block with the caret in it. Without this a `/col3`
   * you did not mean is permanent unless dragged apart block by block.
   * One structural commit → one undo snapshot, so ⌘Z restores the columns
   * block with its contents. Any content anywhere refuses the gesture. */
  const dissolveColumnsIfEmpty = useCallback(
    (colRef: ColumnRef) => {
      if (locked) return false;
      const pi = blocks.findIndex((b) => b.id === colRef.blockId);
      if (pi === -1) return false;
      const parent = blocks[pi];
      if (parent.type !== "columns" || !Array.isArray(parent.cols)) return false;
      if (!isColumnsBlockEmpty(parent.cols)) return false;
      const spawn = newBlock("text");
      const next = [...blocks];
      next.splice(pi, 1, spawn);
      commit(next);
      setFocusRequest({ id: spawn.id, caret: "start" });
      return true;
    },
    [blocks, commit, locked],
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
      selectedIds,
      shiftClick: (id, colRef) => handleShiftClick(id, colRef),
      dissolveColumns: dissolveColumnsIfEmpty,
    }),
    [registerRowEl, registerColTrack, beginDrag, escapeColumn, selectAllTopLevel, exitVerticalFromColumn, selectedIds, handleShiftClick, dissolveColumnsIfEmpty],
  );


  // Images are addressed by {workspace}/{page}/{uuid}; both halves come
  // from here so no child has to rediscover them.
  const imageCtx = useMemo(
    () => ({ workspaceId, pageId }),
    [workspaceId, pageId],
  );

  return (
    <ColumnBridgeCtx.Provider value={columnBridge}>
    <PageImageCtx.Provider value={imageCtx}>
    <div
      ref={containerRef}
      data-gio-page-body
      data-page-id={pageId}
      className="gio-page-body relative"
      onDragOver={(e) => {
        // Only claim the drag when it actually carries files; block drags
        // are pointer-based and must not be intercepted here.
        if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) {
          e.preventDefault();
        }
      }}
      onDrop={(e) => {
        const files = Array.from(e.dataTransfer?.files ?? []).filter(
          (f) => !rejectReason(f),
        );
        if (files.length === 0 || locked) return;
        e.preventDefault();
        const row = (e.target as HTMLElement | null)?.closest?.(
          "[data-block-id]",
        ) as HTMLElement | null;
        const id =
          row?.getAttribute("data-block-id") ??
          blocksRef.current[blocksRef.current.length - 1]?.id;
        if (id) insertImageFiles(id, files);
      }}
      onPointerDown={handleContainerPointerDown}
      onClick={(e) => {
        /* Links inside a contenteditable are inert to the browser — a click
         * places the caret. One delegated handler makes a PLAIN left click
         * open the link in a new tab, like Notion. The trade: to put the
         * caret inside a link's label you arrow in from either side.
         * Modifier clicks fall through to native behaviour, a click that
         * ends a text-selection drag is ignored, and anchors outside the
         * prose body (sidebar, breadcrumb, related links) are untouched —
         * they manage their own navigation. No sanitising here: the href
         * was already vetted by safeUrl at tokenize time. */
        if (marqueeRef.current) return;
        if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
        if (e.button !== 0) return;
        const t = e.target as HTMLElement | null;
        // A page mention opens its page here, like a link to a Gio page. A
        // person mention, and a page this person can't open, do nothing.
        const chip = t?.closest?.('[data-gio-mention^="page:"]') as HTMLElement | null;
        if (chip && chip.closest("[data-gio-page-body]")) {
          if (window.getSelection()?.isCollapsed === false) return;
          if (chip.getAttribute("data-missing") === "true") return;
          e.preventDefault();
          const id = (chip.getAttribute("data-gio-mention") ?? "").slice(5);
          void navigate({ to: "/p/$pageId", params: { pageId: id } });
          return;
        }
        const a = t?.closest?.("a[href]") as HTMLAnchorElement | null;
        if (!a) return;
        const host = a.closest("[data-gio-page-body]");
        if (!host) return;
        if (!a.closest("[contenteditable]")) return;
        if (window.getSelection()?.isCollapsed === false) return;
        e.preventDefault();
        const href = a.getAttribute("href") ?? "";
        // A link to another Gio page opens here, in this tab; anything else
        // opens in a new tab.
        try {
          const u = new URL(href, window.location.href);
          // A block on this same page: change the hash, which scrolls to it.
          if (u.origin === window.location.origin && u.pathname === window.location.pathname && u.hash) {
            window.location.hash = u.hash;
            return;
          }
          if (u.origin === window.location.origin) {
            void navigate({ href: u.pathname + u.search + u.hash });
            return;
          }
        } catch {
          /* not a URL: fall through */
        }
        window.open(href, "_blank", "noopener,noreferrer");
      }}
      onFocusCapture={(e) => {
        // Caret entering ANY text surface drops the block selection. After
        // the WYSIWYG swap a block is a contenteditable, not a textarea —
        // without this the selection survived a click into a block and
        // Backspace/Delete then hit the typing guard and appeared dead.
        const t = e.target as HTMLElement;
        if (
          t.tagName === "TEXTAREA" ||
          t.tagName === "INPUT" ||
          t.isContentEditable
        )
          clearSelection();
      }}
      onContextMenu={(e) => {
        // Right-click INSIDE a selected block opens the multi-block menu.
        // Anywhere else the native context menu wins (no interference).
        if (selectedIds.size === 0) return;
        const t = e.target as HTMLElement | null;
        const row = t?.closest?.("[data-block-id]") as HTMLElement | null;
        if (!row) return;
        const id = row.getAttribute("data-block-id");
        if (!id || !selectedIds.has(id)) return;
        e.preventDefault();
        const n = selectedIds.size;
        const rows: MenuRow[] = [
          {
            kind: "row",
            label: "Copy",
            hint: { text: "⌘C", mono: true },
            onPick: () => {
              closeSelMenu();
              runCopySelection({ cut: false });
            },
          },
          {
            kind: "row",
            label: "Cut",
            hint: { text: "⌘X", mono: true },
            onPick: () => {
              closeSelMenu();
              runCopySelection({ cut: true });
            },
          },
          {
            kind: "row",
            label: "Duplicate",
            icon: "dup",
            hint: { text: "⌘D", mono: true },
            onPick: () => {
              closeSelMenu();
              runDuplicateSelected();
            },
          },
          { kind: "sep" },
          {
            kind: "row",
            label: "Delete",
            icon: "trash",
            danger: true,
            hint: { text: "Del", mono: true },
            onPick: () => {
              closeSelMenu();
              runDeleteSelected();
            },
          },
        ];
        setSelMenu({
          anchor: row,
          spec: { title: `${n} ${n === 1 ? "block" : "blocks"} selected`, rows },
        });
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
          {...rowHandlers(
            b.id,
            {
              onEditorFocus: () => setFocusedId(b.id),
              onEditorBlur: () =>
            setFocusedId((cur) => (cur === b.id ? null : cur))
          ,
              onHandlePointerDown: (ev) => beginDrag(b.id, ev),
              onHandleClick: (anchor) => {
            const initial = buildBlockHandleSpec(b.id, {
              setSpec: setHandleMenuSpec,
              close: closeHandleMenu,
            });
            setHandleMenu({ blockId: b.id, anchor, spec: initial });
          },
              onHandleShiftClick: () => handleShiftClick(b.id),
              onBlur: onBlur,
              registerRef: (el) => {
            if (el) refs.current[b.id] = el;
            else delete refs.current[b.id];
          },
              onChange: (patch) => updateBlock(b.id, patch),
              onInput: (val) => {
            // Shortcut FIRST — on match, apply the structural op and skip
            // the text update, so a single keystroke produces exactly one
            // commit (one undo entry) and the caret lands per applyOp.
            const el0 = refs.current[b.id];
            const caret0 = el0 ? (readCaret(el0, val)?.start ?? val.length) : val.length;
            if (tryMarkdown(b.id, val, caret0)) return;
            // Otherwise: commit the text update.
            updateBlock(b.id, { text: val });

            const el = refs.current[b.id];
            const caret = el ? (readCaret(el, val)?.start ?? val.length) : val.length;
            const trig = slashTrigger(val, caret, b.type);
            if (trig) {
              const rect = el?.getBoundingClientRect();
              setSlash({
                blockId: b.id,
                query: trig.query,
                at: trig.at,
                x: rect ? rect.left : 200,
                y: rect ? rect.bottom + 4 : 200,
                yTop: rect ? rect.top - 4 : 200,
              });
            } else if (slash?.blockId === b.id) {
              setSlash(null);
            }
          },
              onKeyDown: (e) => {
            if (locked) return;
            // An accent or IME composition owns the keyboard until it ends.
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            const el = e.currentTarget as HTMLElement;
            const v = b.text ?? "";
            const caret = readCaret(el, v) ?? { start: 0, end: 0 };
            const ss = caret.start;
            const se = caret.end;

            // With nothing matching, the menu steps aside: Enter, arrows and
            // Escape act on the text as usual.
            if (slash?.blockId === b.id && filteredMenu.length === 0) {
              setSlash(null);
              if (e.key === "Escape") {
                e.preventDefault();
                return;
              }
            } else if (slash?.blockId === b.id) {
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
                if (picked) applyType(b.id, picked.type, picked.count, picked.lang);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setSlash(null);
                return;
              }
            }

            // ⌘⌥L copies a link to this block (e.code: ⌥L types "¬" on a Mac).
            if (primaryMod(e) && e.altKey && e.code === "KeyL") {
              e.preventDefault();
              copyBlockLink(b.id);
              return;
            }

            // Delegate to the shared resolver — the same decision layer
            // used by ColumnStack. Everything below dispatches an `Op`
            // back into local state / undo. The four legitimate scope-
            // dependent branches (backspace-at-0, enter-empty-last,
            // arrow-up-first, slash) are handled inside the resolver.
            const idxInList = blocks.findIndex((x) => x.id === b.id);
            const op: KeyOp = resolveKey("page", blocks, idxInList, {
              key: e.key,
              meta: primaryMod(e),
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
                // Escape leaves the text and selects the block, so the
                // arrows, ⌘⇧↑/↓, Delete and ⌘C act on it next.
                e.preventDefault();
                // The selection's own window Escape handler mounts during this
                // very event and would clear it again.
                e.stopPropagation();
                el.blur();
                setSelScope(null);
                anchorId.current = b.id;
                setSelectedIds(new Set([b.id]));
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
              case "remove-empty": {
                e.preventDefault();
                const i = blocks.findIndex((x) => x.id === b.id);
                const prev = i > 0 ? blocks[i - 1] : undefined;
                if (i === 0 && blocks.length > 1) {
                  // The first block: it goes, and the caret moves up to
                  // the title, as in Notion.
                  applyOp({ next: blocks.slice(1) });
                  focusTitle();
                  return;
                }
                if (prev && !isTextBearing(prev)) {
                  // After an image, divider, table…: the empty line goes and
                  // that block is selected, so a second Backspace removes it.
                  applyOp({ next: blocks.filter((x) => x.id !== b.id) });
                  el.blur();
                  setSelScope(null);
                  anchorId.current = prev.id;
                  setSelectedIds(new Set([prev.id]));
                  return;
                }
                removeBlock(b.id);
                return;
              }
              case "remove-empty-forward": {
                e.preventDefault();
                const i = blocks.findIndex((x) => x.id === b.id);
                const nextBlock = blocks[i + 1];
                if (!nextBlock) return;
                const rest = blocks.filter((x) => x.id !== b.id);
                if (isTextBearing(nextBlock)) {
                  applyOp({ next: rest, focus: { id: nextBlock.id, caret: "start" } });
                } else {
                  applyOp({ next: rest });
                  el.blur();
                  setSelScope(null);
                  anchorId.current = nextBlock.id;
                  setSelectedIds(new Set([nextBlock.id]));
                }
                return;
              }
              case "merge-prev":
                e.preventDefault();
                mergeIntoPrev(b.id);
                return;
              case "remove-prev": {
                e.preventDefault();
                const i = blocks.findIndex((x) => x.id === b.id);
                if (i > 0) {
                  applyOp({
                    next: blocks.filter((_, j) => j !== i - 1),
                    focus: { id: b.id, caret: "start" },
                  });
                }
                return;
              }
              case "select-prev": {
                e.preventDefault();
                e.stopPropagation();
                const i = blocks.findIndex((x) => x.id === b.id);
                if (i > 0) {
                  el.blur();
                  setSelectedIds(new Set([blocks[i - 1].id]));
                }
                return;
              }
              case "merge-next": {
                const r = opsMergeNext(blocks, b.id);
                if (r) {
                  e.preventDefault();
                  applyOp(r);
                }
                return;
              }
              case "extend-to-blocks": {
                e.preventDefault();
                e.stopPropagation();
                const i = blocks.findIndex((x) => x.id === b.id);
                const j = i + op.dir;
                if (i < 0 || j < 0 || j >= blocks.length) return;
                window.getSelection()?.removeAllRanges();
                el.blur();
                setSelScope(null);
                anchorId.current = b.id;
                setSelectedIds(new Set([b.id, blocks[j].id]));
                return;
              }
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
                  const cur = refs.current[bid];
                  if (!cur || document.activeElement !== cur) return;
                  const curBlk = blocks.find((x) => x.id === bid);
                  const src = curBlk?.text ?? "";
                  const car = readCaret(cur, src);
                  if (!car) return;
                  if (dir === -1) {
                    if (car.start === 0 && car.end === 0) {
                      const idx = blocks.findIndex((x) => x.id === bid);
                      const target = nextEditableIndex(blocks, idx, -1);
                      if (target !== null) {
                        setFocusRequest({ id: blocks[target].id, caret: "end" });
                      } else {
                        focusTitle();
                      }
                    }
                  } else {
                    const l = src.length;
                    if (car.start === l && car.end === l) {
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
              case "indent":
                e.preventDefault();
                applyOp(opsIndent(blocks, b.id, 1));
                return;
              case "outdent":
                e.preventDefault();
                applyOp(opsIndent(blocks, b.id, -1));
                return;
              case "wrap": {
                e.preventDefault();
                const [ws, we] = snapSelection(v, ss, se);
                const r = toggleWrap(v, ws, we, op.open, op.close);
                updateBlock(b.id, { text: r.text });
                requestAnimationFrame(() => {
                  const cur = refs.current[b.id];
                  if (!cur) return;
                  try {
                    cur.focus({ preventScroll: true });
                    writeCaret(cur, r.text, r.start, r.end);
                  } catch {
                    /* noop */
                  }
                });
                return;
              }
            }
          },
              onAddBelow: () => { if (!locked) insertAfter(b.id); },
              onSetIcon: (icon) => updateBlock(b.id, { icon }),
              onPaste: (e) => handlePaste(b.id, e),
              onDelete: () => {
            if (locked) return;
            // The image file is NOT deleted here. ⌘Z brings the block back,
            // a duplicated block or a duplicated page can point at the same
            // file, and deleting it broke every one of those copies.
            applyOp(opsRemove(blocks, b.id, { ensureOne: true }));
          },
            },
          )}
        />
      ))}

      {/* Drop indicator — column-relative width when dropping into a column. */}
      {indicatorVisible ? (
        <div
          aria-hidden
          className="gio-drop-line"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `translate3d(${dragging!.indicator!.x}px, ${dragging!.indicator!.y}px, 0)`,
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
          yTop={slash.yTop}
          items={filteredMenu}
          activeIdx={menuIdx}
          onHover={setMenuIdx}
          onPick={(t, count, lang) => applyType(slash.blockId, t, count, lang)}
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
                onClick={deleteSelection}
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
      {selMenu ? (
        <RowMenu
          spec={selMenu.spec}
          anchor={selMenu.anchor}
          onClose={closeSelMenu}
        />
      ) : null}
      <FloatingToolbar blockSel={blockSelForToolbar} />
    </div>
    </PageImageCtx.Provider>
    </ColumnBridgeCtx.Provider>
  );
}

/* ────────────── One row: gutter + block ────────────── */

const BlockRow = memo(BlockRowImpl);
function BlockRowImpl({
  block,
  ordinal,
  locked,
  pageScope = true,
  selected,
  dimmed,
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
  onDelete,
}: {
  block: Blk;
  ordinal?: number;
  locked: boolean;
  /** False when this row lives inside a column or a callout. */
  pageScope?: boolean;
  selected: boolean;
  dimmed: boolean;
  onEditorFocus: () => void;
  onEditorBlur: () => void;
  registerRowEl: (id: string, el: HTMLElement | null) => void;
  onHandlePointerDown: (ev: React.PointerEvent<HTMLElement>) => void;
  onHandleClick: (anchor: HTMLElement) => void;
  onHandleShiftClick: () => void;
  onBlur?: () => void;
  registerRef: (el: HTMLElement | null) => void;
  onChange: (patch: Partial<Blk>) => void;
  onInput: (val: string) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  onAddBelow: () => void;
  onSetIcon: (icon: string) => void;
  onPaste: (e: React.ClipboardEvent<HTMLElement>) => void;
  onDelete: () => void;
}) {
  const noEditor =
    block.type === "divider" ||
    block.type === "image" ||
    block.type === "imagerow" ||
    block.type === "sheet" ||
    block.type === "file" ||
    block.type === "page" ||
    block.type === "view";
  // Gutter (+ / drag handle) must centre vertically on the block's FIRST
  // line box, not the row centre. We publish the block's own line-height
  // as a pixel value on the row via `--gio-block-lh`; the gutter consumes
  // it with `height: var(--gio-block-lh)`. Values are `fontSize *
  // line-height-multiplier`, matching the tokens in @theme so the two
  // stay in lockstep. (`1lh` on the gutter itself would inherit the row's
  // typography and blow up the +/⋮⋮ glyphs.)
  const blockLineHeight = ((): string => {
    switch (block.type) {
      case "h1": return "43.7px";        // text-title 38 × 1.15
      case "h2": return "26.875px";      // text-heading 21.5 × 1.25
      case "h3": return "22.1px";        // text-subhead 17 × 1.30
      case "caption": return "17.5px";   // text-caption 12.5 × 1.40
      case "quote": return "30px";       // text-quote 20 × 1.50
      default: return "27.2px";          // text-prose 17 × 1.60
    }
  })();
  return (
    <div
      ref={(el) => registerRowEl(block.id, el)}
      data-block-id={block.id}
      data-block-type={block.type}
      data-block-no-editor={noEditor ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      // `gio-row` (not Tailwind's `group`) owns the gutter reveal. A bare
      // `group` matches ANY ancestor, so a columns/callout row wrapping
      // inner rows revealed every inner gutter at once — the reveal now
      // comes from `.gio-row:hover > .gio-block-gutter` in styles.css,
      // which is scoped to the hovered row itself in every container.
      className="gio-row relative"
      data-gutter={pageScope ? "page" : undefined}
      style={{
        opacity: dimmed ? 0.45 : undefined,
        background: selected ? "var(--color-blueTint)" : undefined,
        boxShadow: selected ? "0 0 0 4px var(--color-blueTint)" : undefined,
        borderRadius: selected ? 4 : undefined,
        cursor: noEditor ? "pointer" : undefined,
        transition: "background 120ms ease, box-shadow 120ms ease",
        ["--gio-block-lh" as string]: blockLineHeight,
      }}
    >

      {(
        <div
          className="gio-block-gutter pointer-events-none absolute top-0 select-none opacity-0 transition-opacity duration-100"
          style={{
            // Position and size come from .gio-block-gutter in styles.css:
            // `left` is calc(-1 * var(--gio-gutter-x)), the width reaches
            // the row's edge, and page-level rows stretch it full height.
            opacity: selected ? 1 : undefined,
            pointerEvents: selected ? "auto" : undefined,
          }}
        >
          <div className="flex items-center gap-0.5" style={{ height: "var(--gio-block-lh)" }}>
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
        </div>
      )}


      <BlockContent
        block={block}
        ordinal={ordinal}
        locked={locked}
        pageScope={pageScope}
        onEditorFocus={onEditorFocus}
        onEditorBlur={onEditorBlur}
        onBlur={onBlur}
        registerRef={registerRef}
        onChange={onChange}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onSetIcon={onSetIcon}
        onPaste={onPaste}
        onDelete={onDelete}
      />
    </div>
  );
}


function BlockContent({
  block,
  ordinal,
  locked,
  pageScope = true,
  onEditorFocus,
  onEditorBlur,
  onBlur,
  registerRef,
  onChange,
  onInput,
  onKeyDown,
  onSetIcon,
  onPaste,
  onDelete,
}: {
  block: Blk;
  ordinal?: number;
  locked: boolean;
  /** False inside a column or a callout — see SheetBlockView. */
  pageScope?: boolean;
  onEditorFocus: () => void;
  onEditorBlur: () => void;
  onBlur?: () => void;
  registerRef: (el: HTMLElement | null) => void;
  onChange: (patch: Partial<Blk>) => void;
  onInput: (val: string) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  onSetIcon: (icon: string) => void;
  onPaste: (e: React.ClipboardEvent<HTMLElement>) => void;
  onDelete: () => void;
}) {
  const t = block.type;
  const rawText = block.text ?? "";

  // Shared prose renderer. β: <Editable> IS the rendered view and
  // IS the editable element — no swap, no showFormatted branch. The
  // shared `gio-line` class survives so styles.css's parity rule
  // still keys correctly and any future non-prose block that opts
  // back in inherits the same metrics.
  const editableCls = (className: string, extra?: string) =>
    "gio-line " + className + (extra ? " " + extra : "");

  const renderProse = (className: string, opts?: { placeholder?: string; extraClass?: string; ariaLabel?: string }) => (
    <Editable
      ref={(el) => registerRef(el)}
      source={rawText}
      onSourceChange={(val) => {
        // Single-commit path. The block layer's onInput decides between
        // a markdown-shortcut structural op and a text-only update, so a
        // keystroke never fires two commits (which would push two undo
        // entries for one action). See tryMarkdownShortcut wiring.
        onInput(val);
      }}
      onKeyDown={onKeyDown as (e: ReactKeyboardEvent<HTMLDivElement>) => void}
      onPaste={onPaste as (e: React.ClipboardEvent<HTMLDivElement>) => void}
      onFocus={() => onEditorFocus()}
      onBlur={() => {
        onEditorBlur();
        onBlur?.();
      }}
      locked={locked}
      className={editableCls(className, opts?.extraClass)}
      placeholder={opts?.placeholder}
      ariaLabel={opts?.ariaLabel}
    />
  );

  const textareaProps = {
    ref: (el: HTMLTextAreaElement | null) => registerRef(el),
    value: rawText,
    // onInput commits the text (one commit, one undo step per keystroke
    // burst); calling onChange too committed every keystroke twice.
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onInput(e.target.value);
    },
    onFocus: () => onEditorFocus(),
    onBlur: () => {
      onEditorBlur();
      onBlur?.();
    },
    onKeyDown: onKeyDown as (e: ReactKeyboardEvent<HTMLTextAreaElement>) => void,
    onPaste: onPaste as (e: React.ClipboardEvent<HTMLTextAreaElement>) => void,
    readOnly: locked,
    rows: 1,
    className:
      "w-full resize-none border-0 bg-transparent p-0 outline-none placeholder:text-faint",
    style: { overflow: "hidden" as const },
  };

  if (t === "columns" && Array.isArray(block.cols)) {
    return (
      <ColumnsBlock
        block={block}
        locked={locked}
        onChange={onChange}
      />
    );
  }

  if (t === "image") {
    return (
      <ImageBlock
        block={block}
        locked={locked}
        onChange={onChange}
        onDelete={onDelete}
      />
    );
  }

  if (t === "file") {
    return (
      <FileBlock
        block={block}
        locked={locked}
        onChange={onChange}
        onDelete={onDelete}
      />
    );
  }

  if (t === "page") {
    return (
      <PageBlock
        block={block}
        locked={locked}
        onChange={onChange}
        onDelete={onDelete}
      />
    );
  }

  // A view inside the page: its own component, mounted here.
  if (t === "view") {
    return <ViewBlock block={block} locked={locked} onChange={onChange} onDelete={onDelete} />;
  }

  if (t === "imagerow") {
    return (
      <ImageRowBlock
        block={block}
        locked={locked}
        onChange={onChange}
        onDelete={onDelete}
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

  // Sheets live entirely in src/components/sheet-block.tsx. This is a mount
  // point and nothing more — no sheet logic belongs in this file.
  if (t === "sheet") {
    return (
      <SheetBlockView
        block={block as unknown as Record<string, unknown>}
        pageScope={pageScope}
        locked={locked}
        onChange={(patch) => onChange(patch as Partial<Blk>)}
        onBlur={onBlur}
      />
    );
  }

  // The code block's language, picked from its corner (Notion's way).
  // Mermaid draws it as a diagram; picking it on an empty block starts one.
  const codeLangPicker =
    t === "code" ? (
      <CodeLangPicker
        value={isDiagram(block) ? "mermaid" : typeof block.lang === "string" ? block.lang : ""}
        disabled={locked}
        onPick={(lang) => {
          const patch: Partial<Blk> = { lang };
          if (lang === "mermaid") {
            FRESH_DIAGRAMS.add(block.id);
            if (!(block.text ?? "").trim()) patch.text = MERMAID_STARTER;
          }
          onChange(patch);
        }}
      />
    ) : null;

  if (t === "code" && isDiagram(block)) {
    // A diagram: a code block in Mermaid, drawn as a picture. The source
    // stays the same literal textarea as any code block.
    return (
      <MermaidBlock
        source={block.text ?? ""}
        locked={locked}
        startOpen={FRESH_DIAGRAMS.has(block.id)}
        picker={codeLangPicker}
        editor={
          <GrowText
            {...textareaProps}
            className="w-full resize-none border-0 bg-transparent p-0 font-mono text-meta text-body outline-none"
          />
        }
      />
    );
  }

  if (t === "code") {
    // Code blocks stay on <textarea>: their content is literal, no
    // inline grammar applies, and the shim keeps caret access
    // uniform with contenteditable neighbours.
    return (
      <div className="rounded-md bg-sunken px-3 pb-3 pt-1">
        <div className="-ml-1.5 mb-1 flex items-center">{codeLangPicker}</div>
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
        {renderProse(
          "w-full text-quote italic text-body placeholder:text-faint",
          { placeholder: "Write, or type / for blocks" },
        )}
      </blockquote>
    );
  }

  if (t === "callout") {
    const kids = Array.isArray((block as { children?: unknown }).children)
      ? ((block as { children?: Blk[] }).children as Blk[])
      : null;
    return (
      <div
        className="group flex items-start gap-2 p-3"
        style={{
          borderRadius: 9,
          // Colour comes from a token resolved by name — never a stored hex.
          // Tint + 1px ring: at ~95% lightness several tints are nearly
          // white on the page, and without an edge a callout stops reading
          // as a block at all. Text colour NEVER changes.
          background: calloutBg((block as { color?: unknown }).color),
          border: `1px solid ${calloutRing((block as { color?: unknown }).color)}`,
        }}
      >

        <CalloutIconPicker icon={block.icon ?? "💡"} onPick={onSetIcon} disabled={locked} />
        {kids ? (
          <div className="min-w-0 flex-1">
            <ColumnStack
              colRef={{ blockId: block.id, callout: true }}
              blocks={kids}
              setBlocks={(next) => onChange({ children: next } as Partial<Blk>)}
              locked={locked}
            />
          </div>
        ) : (
          renderProse(
            "w-full text-prose text-body",
            { placeholder: "Write, or type / for blocks" },
          )
        )}
      </div>
    );
  }

  if (t === "toggle") {
    const level = (block as { level?: string }).level;
    const summaryCls =
      level === "h1"
        ? "w-full font-display text-title text-noir"
        : level === "h2"
          ? "w-full font-display text-heading text-noir"
          : level === "h3"
            ? "w-full font-display text-subhead text-noir"
            : "w-full text-prose text-body";
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
          {renderProse(summaryCls, { placeholder: "Toggle" })}
        </div>
        {block.open ? (
          <div className="ml-5 mt-1 text-meta text-muted">
            Toggles can’t hold blocks yet, so there’s nothing inside.
          </div>
        ) : null}
      </div>
    );
  }

  // Flat outline: indent shifts only the block CONTENT for the
  // indentable types (bullet, numbered, todo, text). Gutter stays at
  // the row's left edge.
  const indent = typeof block.indent === "number" && block.indent > 0
    ? Math.min(6, Math.floor(block.indent))
    : 0;
  const BULLET_GLYPHS = ["•", "◦", "▪"] as const;
  const contentWrap = (node: React.ReactNode) =>
    indent > 0
      ? <div style={{ paddingLeft: indent * 24 }}>{node}</div>
      : node;

  if (t === "todo") {
    const done = !!block.checked;
    return contentWrap(
      <div className="flex items-start gap-2 text-prose text-body">
        <span
          className="flex shrink-0 items-center"
          style={{ height: "1lh" }}
        >
          <input
            type="checkbox"
            checked={done}
            onChange={() => onChange({ checked: !done })}
            className="accent-accent"
            aria-label={done ? "Done" : "Todo"}
          />
        </span>
        {renderProse(
          "w-full",
          {
            extraClass: done ? "text-muted line-through" : "",
            placeholder: "To-do",
          },
        )}
      </div>
    );
  }

  if (t === "bullet") {
    const glyph = BULLET_GLYPHS[indent % 3];
    return contentWrap(
      <div className="flex items-start gap-2 text-prose text-body">
        <span
          aria-hidden
          className="flex items-center"
          style={{ height: "1lh" }}
        >
          {/* `leading-none` and colour live on the INNER glyph so the
              outer wrapper keeps the parent's line-height — 1lh on the
              wrapper must resolve to text-prose (27.2px), not to the
              glyph's own 1× line-height. */}
          <span className="leading-none text-muted">{glyph}</span>
        </span>
        {renderProse("w-full", { placeholder: "List" })}
      </div>
    );
  }

  if (t === "numbered") {
    const label = ordinalLabel(ordinal ?? 1, indent);
    return contentWrap(
      <div className="flex items-start gap-2 text-prose text-body">
        <span
          aria-hidden
          className="flex min-w-4 items-center"
          style={{ height: "1lh" }}
        >
          {/* text-meta on an INNER span so `1lh` on the wrapper reflects
              the block's line-height (text-prose 27.2px), not the label's
              own smaller 1.4× line-height. */}
          <span className="text-meta text-muted tnum">{label}</span>
        </span>
        {renderProse("w-full", { placeholder: "List" })}
      </div>
    );
  }




  if (t === "h1") {
    return renderProse(
      "w-full font-display text-title text-noir",
      { placeholder: "Heading 1", ariaLabel: "Heading 1" },
    );
  }

  if (t === "h2") {
    return renderProse(
      "w-full font-display text-heading text-noir",
      { placeholder: "Heading 2", ariaLabel: "Heading 2" },
    );
  }

  if (t === "h3") {
    return renderProse(
      "w-full font-display text-subhead text-noir",
      { placeholder: "Heading 3", ariaLabel: "Heading 3" },
    );
  }

  if (t === "caption") {
    return renderProse(
      "w-full text-caption text-muted",
      { placeholder: "Caption" },
    );
  }

  // text (default)
  return contentWrap(
    renderProse(
      "w-full text-prose text-body",
      { placeholder: "Write, or type / for blocks" },
    ),
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
  // Vertically centre the 24×24 icon within ONE line-box of the callout's
  // first line — same treatment as list markers and the gutter.
  const wrapStyle: React.CSSProperties = {
    height: "1lh",
    display: "flex",
    alignItems: "center",
  };
  // A locked page's callout icon is not interactive — render as plain glyph.
  if (disabled) {
    return (
      <div className="shrink-0" style={wrapStyle} aria-label="Callout icon">
        <Ico icon={icon} size={18} pad={3} />
      </div>
    );
  }
  return (
    <div className="shrink-0" style={wrapStyle}>

      <Popover
        width={320}
        trigger={({ open, onClick, ref }) => (
          <button
            ref={ref}
            type="button"
            onClick={onClick}
            aria-label="Change icon"
            aria-expanded={open}
            title="Change icon"
            className="grid place-items-center cursor-pointer transition-colors group-hover:bg-sunken/60 hover:bg-sunken/60"
            style={{ width: 24, height: 24, borderRadius: 4 }}
          >
            {/* THE only sanctioned icon renderer. 18px glyph + 3px pad =
                the 24px box this button always had, so a custom emoji
                paints at exactly the size the unicode glyph did. */}
            <Ico icon={icon} size={18} pad={3} />
          </button>
        )}
      >
        {(close) => (
          <EmojiPicker
            removable
            onPick={(e) => {
              // Remove restores the default 💡 rather than clearing —
              // a callout without an icon has a ragged left edge and
              // the layout assumes one is present.
              onPick(e ?? "💡");
              rememberCallout({ icon: e ?? "💡" });
              close();
            }}
          />
        )}
      </Popover>
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

  // Stored weights, always brought into lockstep with the column count —
  // a widths array out of step renders every later column at the wrong
  // size and nothing says why.
  const widths = useMemo(
    () => normalizeColumnWidths((block as { widths?: unknown }).widths, n),
    [block, n],
  );
  const gridRef = useRef<HTMLDivElement | null>(null);
  // While a drag is in flight we render `dragWidths` (never persisted);
  // the commit lands once, on pointerup, so undo sees ONE entry per drag.
  const [dragWidths, setDragWidths] = useState<number[] | null>(null);
  const dragRef = useRef<{
    index: number;
    startX: number;
    base: number[];
    pxPerFr: number;
    pointerId: number;
    handle: HTMLElement;
  } | null>(null);
  const effective = dragWidths ?? widths;

  const beginResize = (e: React.PointerEvent<HTMLDivElement>, i: number) => {
    if (locked) return;
    // Seed from the current equal split so nothing jumps as the drag begins.
    const base = (effective ?? equalColumnWidths(n)).slice();
    const gridW = gridRef.current?.getBoundingClientRect().width ?? 0;
    const totalFr = base.reduce((a, w) => a + w, 0) || n;
    const tracksW = Math.max(1, gridW - COLS_GAP * Math.max(0, n - 1));
    const handleEl = e.currentTarget;
    try {
      handleEl.setPointerCapture(e.pointerId);
    } catch {
      /* ignore — non-mouse pointers work without capture */
    }
    dragRef.current = {
      index: i,
      startX: e.clientX,
      base,
      pxPerFr: tracksW / totalFr,
      pointerId: e.pointerId,
      handle: handleEl,
    };
    document.body.style.userSelect = "none";
    setDragWidths(base);
    e.preventDefault();
    e.stopPropagation();
  };
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const deltaFr = (e.clientX - d.startX) / (d.pxPerFr || 1);
    setDragWidths(resizeColumnPair(d.base, d.index, deltaFr));
  };
  const endResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    try {
      d.handle.releasePointerCapture?.(d.pointerId);
    } catch {
      /* ignore */
    }
    const final = dragWidths ?? d.base;
    dragRef.current = null;
    setDragWidths(null);
    document.body.style.userSelect = "";
    onChange({ widths: final } as Partial<Blk>);
    e.stopPropagation();
  };
  const onHandleDoubleClick = (
    e: React.MouseEvent<HTMLDivElement>,
    i: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (locked) return;
    if (e.altKey) {
      // Alt/Option: clear widths entirely — back to the equal split.
      onChange({ widths: undefined } as Partial<Blk>);
      return;
    }
    onChange({
      widths: resetColumnPair(effective ?? equalColumnWidths(n), i),
    } as Partial<Blk>);
  };

  return (
    <div
      ref={gridRef}
      className="gio-cols relative"
      style={{
        display: "grid",
        // Weight tracks and 40px handle tracks INTERLEAVED, so the number of
        // grid children (N columns + N-1 handles) equals the number of
        // tracks. The handle tracks ARE the spacing, hence gap 0.
        gridTemplateColumns: columnsGridTemplate(effective, n),
        gap: 0,
      }}
    >
      {cols.map((col, i) => (
        <div key={i} style={{ gridColumn: 2 * i + 1, gridRow: 1, minWidth: 0 }}>
          <ColumnStack
            colRef={{ blockId: block.id, colIndex: i }}
            blocks={col}
            setBlocks={(next) => setColumn(i, next)}
            locked={locked}
          />
        </div>
      ))}
      {/* One handle per BOUNDARY between columns (N-1) — there is nothing
          outside the outer edges to trade width with. Each handle owns its
          own 40px track, so the whole gap is the hit area and the 1px rule
          is centred inside it. Hidden below the stacking breakpoint. */}
      {!locked &&
        cols.slice(0, Math.max(0, n - 1)).map((_, i) => (
          <div
            key={`h${i}`}
            className="gio-col-resize"
            data-dragging={dragRef.current?.index === i ? "true" : undefined}
            style={{ gridColumn: 2 * i + 2, gridRow: 1 }}
            onPointerDown={(e) => beginResize(e, i)}
            onPointerMove={onResizeMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onDoubleClick={(e) => onHandleDoubleClick(e, i)}
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
  colRef,
  blocks,
  setBlocks,
  locked,
}: {
  /** The container this stack renders. Column: `{blockId, colIndex}`.
   *  Callout: `{blockId, callout: true}`. See ColumnRef in block-ops. */
  colRef: ColumnRef;
  blocks: Blk[];
  setBlocks: (next: Blk[]) => void;
  locked: boolean;
}) {
  const bridge = useContext(ColumnBridgeCtx);
  const parentBlockId = colRef.blockId;
  const isCallout = !("colIndex" in colRef);
  const trackRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bridge?.registerTrack(colRef, trackRef.current);
    return () => bridge?.registerTrack(colRef, null);
  }, [bridge, colRef]);

  const rowHandlers = useStableRowHandlers();
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const [focusRequest, setFocusRequest] = useState<{
    id: string;
    caret?: number | "end" | "start";
  } | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [slash, setSlash] = useState<{
    blockId: string;
    query: string;
    /** Where the "/" is in the block's source. */
    at: number;
    x: number;
    y: number;
    /** The block's top edge, for opening above it near the bottom. */
    yTop: number;
  } | null>(null);
  const [menuIdx, setMenuIdx] = useState(0);
  useEffect(() => setMenuIdx(0), [slash?.query]);

  const filteredMenu = useMemo(() => {
    // Inside a callout, Pass A forbids nested callouts at the model —
    // suppress the entry so the menu never offers what the ops layer
    // will refuse. Columns are already absent (BLOCK_MENU excludes them).
    // A view needs the page's width, so it isn't offered inside a column.
    const base = BLOCK_MENU.filter(
      (m) => m.type !== "view" && !(isCallout && m.type === "callout"),
    );
    const q = (slash?.query ?? "").toLowerCase().trim();
    if (!q) return base;
    return base.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.type.includes(q) ||
        (m.kw != null && m.kw.includes(q)),
    );
  }, [slash, isCallout]);

  useEffect(() => {
    if (!focusRequest) return;
    const el = refs.current[focusRequest.id];
    if (!el) return;
    el.focus({ preventScroll: true });
    const src = blocks.find((b) => b.id === focusRequest.id)?.text ?? "";
    const c =
      focusRequest.caret === "end"
        ? src.length
        : focusRequest.caret === "start" || focusRequest.caret == null
          ? 0
          : Math.min(focusRequest.caret, src.length);
    try {
      writeCaret(el, src, c, c);
    } catch {
      /* noop */
    }
    setFocusRequest(null);
  }, [focusRequest, blocks]);

  /* Thin apply over the pure block-ops layer. Structural ops NEVER touch
   * columnTypingHint — the outer commit sees a `{ cols: … }` patch and
   * pushes a fresh undo snapshot. Only text-only keystrokes set the hint,
   * so typing bursts coalesce with the same rules as the top level. */
  const imgCtx = useContext(PageImageCtx);

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

  /** A code entry's language, for applyTypeLocal (Diagram vs Code). */
  function codeExtra(blockId: string, type: BlockType, lang?: string): Partial<Blk> | undefined {
    if (type !== "code") return undefined;
    if (lang !== "mermaid") return { lang: "" };
    FRESH_DIAGRAMS.add(blockId);
    const cur = (blocks.find((x) => x.id === blockId)?.text ?? "").replace(/\/\S*$/, "").trim();
    return cur ? { lang } : { lang, text: MERMAID_STARTER };
  }

  function applyTypeLocal(blockId: string, type: BlockType, extra?: Partial<Blk>) {
    // Columns never nest — refuse the "columns" type even though the
    // in-column slash menu doesn't offer it.
    if (type === "columns") return;
    const idx = blocks.findIndex((b) => b.id === blockId);
    if (idx === -1) return;
    const prev = blocks[idx];
    const t = prev.text ?? "";
    const at = slash && slash.blockId === blockId ? slash.at : t.lastIndexOf("/");
    const stripped = at >= 0 ? stripSlash(t, at, slash?.query ?? "") : t;
    const nb: Blk = { ...prev, type, ...(extra ?? {}), text: extra?.text ?? stripped };
    if (type === "todo" && nb.checked == null) nb.checked = false;
    if (type === "toggle" && nb.open == null) nb.open = false;
    if (type === "callout") applyCalloutDefaults(nb);
    if (type === "table" && !nb.rows) nb.rows = [["", "", ""], ["", "", ""]];
      // Converting a text block into a sheet must seed the SAME grid the
      // factory makes; without it the sheet reached the model empty and
      // normalizeSheet padded it up to its 2×1 floors.
      if (type === "sheet" && !nb.cells) Object.assign(nb, newSheetGrid());
    if (type === "divider") nb.text = "";
    if (type !== "toggle") delete nb.level;
    else if (!extra?.level && !("level" in (extra ?? {}))) delete nb.level;
    const next = [...blocks];
    next[idx] = nb;
    setBlocks(next);
    setSlash(null);
    setFocusRequest({ id: blockId, caret: at >= 0 ? at : stripped.length });
  }

  /* Structured paste inside a column — the priority for this task.
   * Uses the same parse + splice engine as the top level. Any parsed
   * `columns` blocks are filtered out to preserve the never-nest rule. */
  const handlePaste = useCallback(
    (blockId: string, e: React.ClipboardEvent<HTMLElement>) => {
      if (locked) return;
      const htmlSrc = e.clipboardData?.getData("text/html") ?? "";
      const plainSrc = e.clipboardData?.getData("text/plain") ?? "";
      // A code block is plain text: let the browser paste the plain text.
      if (blocks.find((x) => x.id === blockId)?.type === "code") return;

      // Same rule as the top level: a bare URL over a selection links it.
      {
        const el = e.currentTarget;
        const src = el ? readEditableSource(el) : "";
        const car = el ? readCaret(el, src) : null;
        const lp = car ? linkPaste(src, car.start, car.end, plainSrc) : null;
        if (lp) {
          e.preventDefault();
          commitSourceToEditable(el, lp.text, lp.caret);
          return;
        }
      }

      const parsedOut = parsePasteToBlocks(htmlSrc, plainSrc);

      if (!parsedOut) return;
      const parsed = parsedOut.blocks.filter((p) => p.type !== "columns");
      if (parsed.length === 0) return;
      const ta = e.currentTarget;
      const src = readEditableSource(ta);
      const car = readCaret(ta, src);
      const ip = car ? inlinePaste(src, car.start, car.end, parsed) : null;
      e.preventDefault();
      if (ip) {
        commitSourceToEditable(ta, ip.text, ip.caret);
        return;
      }
      applyOp(splicePasteAtCaret(blocks, blockId, car?.start ?? src.length, parsed, car?.end ?? src.length));
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
      const targetName = blockTypeName(target);
      const atTop = idx <= 0;
      const atEnd = idx >= blocks.length - 1;
      const curLevel = (target as { level?: unknown } | undefined)?.level;
      const turnIntoSub: MenuRow[] = [
        // A view is made from the slash menu, never turned into.
        ...BLOCK_MENU.filter((m) => m.type !== "view").map((m) => ({
          kind: "row" as const,
          label: m.name,
          icon: m.ic,
          checked:
            target?.type === m.type &&
            (m.type !== "code" || isDiagram(target) === (m.lang === "mermaid")) &&
            !(m.type === "toggle" && typeof curLevel === "string"),
          onPick: () => {
            applyTypeLocal(bid, m.type, m.type === "code" ? { lang: m.lang ?? "" } : undefined);
            mctx.close();
          },
        })),
        ...TOGGLE_HEADINGS.map(({ n, ic }) => ({
          kind: "row" as const,
          label: `Toggle heading ${n}`,
          icon: ic,
          checked: target?.type === "toggle" && curLevel === `h${n}`,
          onPick: () => {
            applyTypeLocal(bid, "toggle", { level: `h${n}` as ToggleLevel });
            mctx.close();
          },
        })),
      ];
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
          icon: blockIconKey(target),
          hint: { text: "›" },
          onPick: () =>
            mctx.setSpec({
              title: "Turn into",
              rows: turnIntoSub,
              footer: "Every block type this page can hold.",
              onBack: () => mctx.setSpec(buildColMenuSpec(bid, mctx)),
            }),
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
    <div ref={trackRef}>
      {blocks.map((b) => (
        <BlockRow
          key={b.id}
          block={b}
          pageScope={false}
          ordinal={b.type === "numbered" ? (ordinalMap.get(b.id) ?? 1) : undefined}
          locked={locked}
          selected={bridge?.selectedIds.has(b.id) ?? false}
          dimmed={false}
          registerRowEl={(id, el) => bridge?.registerRow(colRef, id, el)}
          {...rowHandlers(
            b.id,
            {
              onEditorFocus: () => setFocusedId(b.id),
              onEditorBlur: () =>
            setFocusedId((cur) => (cur === b.id ? null : cur))
          ,
              onHandlePointerDown: (ev) => {
            if (bridge) bridge.beginDrag(b.id, ev, colRef);
          },
              onHandleClick: (anchor) => {
            const initial = buildColMenuSpec(b.id, {
              setSpec: setHandleMenuSpec,
              close: closeHandleMenu,
            });
            setHandleMenu({ blockId: b.id, anchor, spec: initial });
          },
              onHandleShiftClick: () => bridge?.shiftClick(b.id, colRef),
              registerRef: (el) => {
            if (el) refs.current[b.id] = el;
            else delete refs.current[b.id];
          },
              onChange: (patch) => updateBlock(b.id, patch),
              onInput: (val) => {
            // Same single-commit shape as top-level: shortcut first, then
            // the text update. Column scope goes through the same pure
            // op so the two paths cannot drift.
            const el0 = refs.current[b.id];
            const caret0 = el0 ? (readCaret(el0, val)?.start ?? val.length) : val.length;
            const mr = tryMarkdownShortcut(blocks, b.id, val, caret0);
            if (mr) {
              applyOp(mr);
              return;
            }

            updateBlock(b.id, { text: val });
            const el = refs.current[b.id];
            const caret = el ? (readCaret(el, val)?.start ?? val.length) : val.length;
            const trig = slashTrigger(val, caret, b.type);
            if (trig) {
              const rect = el?.getBoundingClientRect();
              setSlash({
                blockId: b.id,
                query: trig.query,
                at: trig.at,
                x: rect ? rect.left : 200,
                y: rect ? rect.bottom + 4 : 200,
                yTop: rect ? rect.top - 4 : 200,
              });
            } else if (slash?.blockId === b.id) {
              setSlash(null);
            }
          },
              onKeyDown: (e) => {
            if (locked) return;
            // An accent or IME composition owns the keyboard until it ends.
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            const el = e.currentTarget as HTMLElement;
            const v = b.text ?? "";
            const car = readCaret(el, v) ?? { start: 0, end: 0 };
            const ss = car.start;
            const se = car.end;

            // With nothing matching, the menu steps aside: Enter, arrows and
            // Escape act on the text as usual.
            if (slash?.blockId === b.id && filteredMenu.length === 0) {
              setSlash(null);
              if (e.key === "Escape") {
                e.preventDefault();
                return;
              }
            } else if (slash?.blockId === b.id) {
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
                if (picked) applyTypeLocal(b.id, picked.type, codeExtra(b.id, picked.type, picked.lang));
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
              meta: primaryMod(e),
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
              case "remove-empty": {
                e.preventDefault();
                const i = blocks.findIndex((x) => x.id === b.id);
                const prev = i > 0 ? blocks[i - 1] : undefined;
                if (prev && !isTextBearing(prev)) {
                  // Nothing to put the caret in above: start of the next
                  // block in the column if there is one.
                  const rest = blocks.filter((x) => x.id !== b.id);
                  const after = rest[i];
                  applyOp({ next: rest, focus: after && isTextBearing(after) ? { id: after.id, caret: "start" } : undefined });
                  return;
                }
                applyOp(opsRemove(blocks, b.id, { ensureOne: true }));
                return;
              }
              case "remove-empty-forward": {
                e.preventDefault();
                const i = blocks.findIndex((x) => x.id === b.id);
                const nextBlock = blocks[i + 1];
                if (!nextBlock) return;
                applyOp({
                  next: blocks.filter((x) => x.id !== b.id),
                  focus: isTextBearing(nextBlock) ? { id: nextBlock.id, caret: "start" } : undefined,
                });
                return;
              }
              case "merge-prev":
                e.preventDefault();
                applyOp(opsMerge(blocks, b.id));
                return;
              case "remove-prev": {
                e.preventDefault();
                const i = blocks.findIndex((x) => x.id === b.id);
                if (i > 0) {
                  applyOp({
                    next: blocks.filter((_, j) => j !== i - 1),
                    focus: { id: b.id, caret: "start" },
                  });
                }
                return;
              }
              case "select-prev":
                // Block selection is top-level only; inside a column the
                // Backspace simply does nothing rather than hide the text.
                e.preventDefault();
                return;
              case "merge-next": {
                const r = opsMergeNext(blocks, b.id);
                if (r) {
                  e.preventDefault();
                  applyOp(r);
                }
                return;
              }
              case "extend-to-blocks":
                // Block selection inside a column is reached by dragging;
                // the keyboard leaves the text selection as it is.
                return;
              case "dissolve-columns":
                // Sole empty block of its column. The parent refuses unless
                // EVERY column is empty, so the old guard survives for
                // every other case.
                e.preventDefault();
                bridge?.dissolveColumns(colRef);
                return;
              case "escape-column":
                e.preventDefault();
                if (bridge)
                  bridge.escapeColumn(
                    colRef,
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
                  const cur = refs.current[bid];
                  if (!cur || document.activeElement !== cur) return;
                  const curBlk = blocks.find((x) => x.id === bid);
                  const src = curBlk?.text ?? "";
                  const c2 = readCaret(cur, src);
                  if (!c2) return;
                  const atBoundary =
                    dir === -1
                      ? c2.start === 0 && c2.end === 0
                      : c2.start === src.length && c2.end === src.length;
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
              case "indent":
                e.preventDefault();
                applyOp(opsIndent(blocks, b.id, 1));
                return;
              case "outdent":
                e.preventDefault();
                applyOp(opsIndent(blocks, b.id, -1));
                return;
              case "wrap": {
                e.preventDefault();
                const [ws, we] = snapSelection(v, ss, se);
                const r = toggleWrap(v, ws, we, op.open, op.close);
                updateBlock(b.id, { text: r.text });
                requestAnimationFrame(() => {
                  const cur = refs.current[b.id];
                  if (!cur) return;
                  try {
                    cur.focus({ preventScroll: true });
                    writeCaret(cur, r.text, r.start, r.end);
                  } catch {
                    /* noop */
                  }
                });
                return;
              }
            }
          },
              onAddBelow: () => {
            if (!locked) applyOp(opsInsertAfter(blocks, b.id));
          },
              onSetIcon: (icon) => updateBlock(b.id, { icon }),
              onPaste: (e) => handlePaste(b.id, e),
              onDelete: () => {
            if (locked) return;
            // Image files are kept: see the top-level delete.
            applyOp(opsRemove(blocks, b.id, { ensureOne: true }));
          },
            },
          )}
        />
      ))}
      {slash ? (
        <SlashMenu
          x={slash.x}
          y={slash.y}
          yTop={slash.yTop}
          items={filteredMenu}
          activeIdx={menuIdx}
          onHover={setMenuIdx}
          onPick={(t, _count, lang) => applyTypeLocal(slash.blockId, t, codeExtra(slash.blockId, t, lang))}
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
export function TableBlock({
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
  // Repair-on-load: any ragged import gets rectangularised here, and the
  // align shadow array is normalised to the resulting column count. When the
  // stored shape differs from the normalised one we surface it as a patch
  // so the persisted matrix converges to rectangular immediately.
  const rows = useMemo(
    () => normalizeTable(block.rows ?? [["", "", ""], ["", "", ""]]),
    [block.rows],
  );
  const nCols = rows[0]?.length ?? 0;
  const nRows = rows.length;
  const align = useMemo<AlignList>(
    () => normalizeAlign(block.align as AlignList | undefined, nCols),
    [block.align, nCols],
  );
  // Widths is a strict opt-in: absent means "auto/equal" (today's
  // behaviour). Only normalise WHEN present, so a table without an
  // explicit widths array keeps its w-full / equal-share render path
  // completely unchanged and export omits the <colgroup>.
  const widths = useMemo<WidthList | undefined>(
    () =>
      Array.isArray(block.widths)
        ? normalizeWidths(block.widths as WidthList, nCols)
        : undefined,
    [block.widths, nCols],
  );
  // Fit to page: the table spans the page and widths are proportions. A
  // table without widths already fits (equal shares); one with widths and
  // no `fit` keeps its exact pixel widths.
  const fit = block.fit === true || !widths;
  const colors = useMemo(
    () => normalizeColors(block.colors, nRows, nCols),
    [block.colors, nRows, nCols],
  );
  useEffect(() => {
    const rowsChanged =
      block.rows && JSON.stringify(block.rows) !== JSON.stringify(rows);
    const alignChanged =
      Array.isArray(block.align) &&
      JSON.stringify(block.align) !== JSON.stringify(align);
    const widthsChanged =
      Array.isArray(block.widths) &&
      JSON.stringify(block.widths) !== JSON.stringify(widths);
    if (rowsChanged || alignChanged || widthsChanged) {
      const patch: Partial<Blk> = {};
      if (rowsChanged) patch.rows = rows;
      if (alignChanged) patch.align = align;
      if (widthsChanged) patch.widths = widths;
      onChange(patch);
    }
    // Only fire on mount / when the persisted shape needs repair.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Selection: one rectangle of cells (src/lib/table-selection.ts). A row
  // or column picked by its handle is the full-width / full-height one.
  const [sel, setSel] = useState<TableSel | null>(null);
  const rect = sel ? selRect(sel, nRows, nCols) : null;
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuSpec, setMenuSpec] = useState<MenuSpec | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  // First-contact hint: shown beneath a hovered table while nothing is
  // selected. Suppressed permanently after the first menu open on any table
  // in this browser. Read from localStorage on mount so the flag survives
  // reloads; ignored under SSR.
  const [hintSeen, setHintSeen] = useState<boolean>(false);
  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        setHintSeen(localStorage.getItem("gio.tableHintSeen") === "1");
      }
    } catch {
      /* private-mode / disabled storage — hint just stays visible until a
         menu is opened, which is still fine. */
    }
  }, []);
  const suppressHint = useCallback(() => {
    setHintSeen(true);
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("gio.tableHintSeen", "1");
      }
    } catch {
      /* noop */
    }
  }, []);

  // Live drag override — while a resize is in flight we render
  // `dragWidths` locally and DO NOT call onChange, so pointermove never
  // pushes an undo snapshot. On pointerup we call onChange exactly once
  // with the final widths, which produces ONE undo entry per drag (the
  // snapshot captured at that call reflects the pre-drag block, so the
  // effect is "snapshot on pointerdown" as specified). `dragRef` holds
  // the drag's origin so we can recompute width from the pointer delta
  // rather than accumulate float error over many moves.
  const [dragWidths, setDragWidths] = useState<WidthList | null>(null);
  const dragRef = useRef<{
    index: number;
    startX: number;
    startWidth: number;
    base: WidthList;
    pointerId: number;
    handle: HTMLElement;
    fit: boolean;
  } | null>(null);

  // Horizontal-overflow fades — visible only when there is scroll to do
  // in that direction. Recomputed on scroll, on wrapper resize, and after
  // any widths change (dragging shrinks the table's scrollWidth in real
  // time). A fade stuck on with nothing to reveal is worse than no fade.
  const [showFadeL, setShowFadeL] = useState(false);
  const [showFadeR, setShowFadeR] = useState(false);
  const [scrollX, setScrollX] = useState(0);
  const updateFades = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      setShowFadeL(false);
      setShowFadeR(false);
      return;
    }
    setShowFadeL(el.scrollLeft > 0);
    setScrollX(el.scrollLeft);
    setShowFadeR(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateFades();
    const onScroll = () => updateFades();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(updateFades);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [updateFades]);
  useEffect(() => {
    updateFades();
  }, [widths, dragWidths, nCols, nRows, updateFades]);

  // Handle geometry — MEASURED from the rendered table, not assumed. Rows
  // wrap to different heights and columns can carry explicit widths, so an
  // equal-share strip drifts out of register with the grid: the handle you
  // click is then not the row or column you get, which reads as "delete
  // doesn't work". These offsets are relative to the table's own box, and
  // the strips are inset by the same 23px padding, so they line up exactly.
  type GridMetrics = {
    cols: { left: number; width: number }[];
    rows: { top: number; height: number }[];
  };
  const [metrics, setMetrics] = useState<GridMetrics | null>(null);
  const measureGrid = useCallback(() => {
    const tbl = tableRef.current;
    if (!tbl) return;
    const base = tbl.getBoundingClientRect();
    const trs = Array.from(tbl.querySelectorAll("tr"));
    const first = trs[0];
    const next: GridMetrics = {
      cols: first
        ? Array.from(first.children).map((c) => {
            const r = (c as HTMLElement).getBoundingClientRect();
            return { left: r.left - base.left, width: r.width };
          })
        : [],
      rows: trs.map((tr) => {
        const r = tr.getBoundingClientRect();
        return { top: r.top - base.top, height: r.height };
      }),
    };
    setMetrics((prev) =>
      JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
    );
  }, []);
  useEffect(() => {
    const tbl = tableRef.current;
    if (!tbl) return;
    measureGrid();
    const ro = new ResizeObserver(measureGrid);
    ro.observe(tbl);
    for (const tr of Array.from(tbl.querySelectorAll("tr"))) ro.observe(tr);
    return () => ro.disconnect();
  }, [measureGrid, nRows, nCols]);
  useEffect(() => {
    measureGrid();
  }, [measureGrid, rows, widths, dragWidths]);


  // Any structural op commits rows and (when they changed) align and
  // widths, in ONE onChange call — the outer undo stack sees a single
  // entry per user action. `nextWidths === null` explicitly clears the
  // widths array (double-click a handle with Alt); passing undefined
  // means "don't touch". Splitting these two is the only way to
  // distinguish "no change" from "restore auto layout" through a single
  // patch merge.
  const commit = useCallback(
    (
      next: string[][],
      nextAlign?: AlignList,
      nextWidths?: WidthList | undefined | null,
    ) => {
      const patch: Partial<Blk> = { rows: next };
      if (nextAlign) patch.align = nextAlign;
      if (nextWidths === null) patch.widths = undefined;
      else if (nextWidths) patch.widths = nextWidths;
      onChange(patch);
    },
    [onChange],
  );

  const [optionsOpen, setOptionsOpen] = useState(false);
  /** Every structural op (insert, delete, duplicate, move) goes through
   *  applyTableOp, so align, widths and colours follow their rows and
   *  columns. One onChange: one Undo step. */
  const structural = (o: TableOp) => {
    const s = applyTableOp({ rows, align, widths, colors }, o);
    if (s.rows === rows) return;
    // Row ops leave the column arrays alone, so they stay out of the patch.
    const patch: Partial<Blk> = { rows: s.rows };
    if (s.align !== align) patch.align = s.align;
    if (s.widths !== widths && s.widths) patch.widths = s.widths;
    if (s.colors !== colors) patch.colors = s.colors;
    onChange(patch);
  };

  const closeMenu = useCallback(() => {
    setMenuAnchor(null);
    setMenuSpec(null);
    setOptionsOpen(false);
  }, []);

  // Copy the current selection as text. Rows join with tabs so a paste into
  // a spreadsheet lands as cells; columns join with newlines (one value per
  // line). The mono hint on the menu row says "⌘C" — this handler is what
  // makes that hint honest.
  const copySelection = () => {
    if (!rect) return;
    toClipboard(toTsv(rectSources(rows, rect)));
  };

  // Escape is layered: an open menu closes first, then a second Escape
  // deselects. This effect stays attached whenever either is present so the
  // second Escape lands even after `menuSpec` transitions to null.
  useEffect(() => {
    if (!menuSpec && !sel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menuSpec) {
        closeMenu();
        return;
      }
      if (sel) setSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuSpec, sel, closeMenu]);

  function setCell(r: number, c: number, v: string) {
    const next = rows.map((row) => row.slice());
    next[r][c] = v;
    commit(next);
  }

  // Header flags live on the BLOCK, not in the matrix: no row or column
  // needs migrating when they change, and every structural op keeps
  // working untouched. `headerRow` defaults ON (today's behaviour),
  // `headerCol` defaults OFF.
  const headerRow = (block as { headerRow?: unknown }).headerRow !== false;
  const headerCol = (block as { headerCol?: unknown }).headerCol === true;

  /** Focus a cell after the commit that created or moved it has landed. */
  const focusCell = useCallback(
    (r: number, c: number, caret: "start" | "end" = "end") => {
      requestAnimationFrame(() => {
        const el = rootRef.current?.querySelector<HTMLElement>(
          `[data-table-cell="${r},${c}"]`,
        );
        if (!el) return;
        try {
          el.focus({ preventScroll: true });
          const src = el.textContent ?? "";
          writeCaret(el, src, caret === "start" ? 0 : src.length);
        } catch {
          /* noop */
        }
      });
    },
    [],
  );

  // Pasting a bare URL over a selection inside a cell links the selection,
  // through the same pure rule the prose blocks use. Anything else falls
  // through to the browser's own paste.
  function onCellPaste(
    e: React.ClipboardEvent<HTMLElement>,
    r: number,
    c: number,
  ) {
    if (locked) return;
    const plain = e.clipboardData?.getData("text/plain") ?? "";
    const el = e.currentTarget as HTMLElement;
    // Cells copied from a Gio table, or tab-separated text from a
    // spreadsheet, land as a block of cells starting here.
    const cells = readCellsJson(e.clipboardData?.getData(CELLS_MIME) ?? "");
    const grid =
      cells && (cells.length > 1 || cells[0].length > 1)
        ? cells
        : !cells && plain.includes("\t")
          ? parseTsv(plain)
          : null;
    if (grid) {
      e.preventDefault();
      e.stopPropagation();
      applyPaste({ r, c }, grid);
      return;
    }
    if (cells) {
      // One copied cell keeps its formatting.
      e.preventDefault();
      const src0 = readEditableSource(el);
      const at = readCaret(el, src0) ?? { start: src0.length, end: src0.length };
      const v = cells[0][0];
      commitSourceToEditable(el, src0.slice(0, at.start) + v + src0.slice(at.end), at.start + v.length);
      return;
    }
    // Cells render through Editable (contenteditable), but the helper also
    // handles a text input, so the right source is read either way.
    const src = readEditableSource(el);
    const car = readCaret(el, src);
    const lp = car ? linkPaste(src, car.start, car.end, plain) : null;
    if (!lp) return;
    e.preventDefault();
    commitSourceToEditable(el, lp.text, lp.caret);
  }

  /** Select cells and put focus on the table itself, so the keys below
   *  act on the selection instead of on a cell's text. */
  const selectAndFocus = (next: TableSel) => {
    setSel(next);
    try {
      window.getSelection()?.removeAllRanges();
    } catch {
      /* noop */
    }
    rootRef.current?.focus({ preventScroll: true });
  };

  /** The cell being edited, if focus is in one of this table's cells. */
  const editingCell = (): CellPos | null => {
    const el = (document.activeElement as HTMLElement | null)?.closest?.("[data-table-cell]");
    if (!el || !rootRef.current?.contains(el)) return null;
    const [r, c] = (el.getAttribute("data-table-cell") ?? "").split(",").map(Number);
    return Number.isFinite(r) && Number.isFinite(c) ? { r, c } : null;
  };

  const cellAtPoint = (x: number, y: number): CellPos | null => {
    const el = document.elementFromPoint(x, y)?.closest?.("[data-table-cell]");
    if (!el || !rootRef.current?.contains(el)) return null;
    const [r, c] = (el.getAttribute("data-table-cell") ?? "").split(",").map(Number);
    return Number.isFinite(r) && Number.isFinite(c) ? { r, c } : null;
  };

  /** Write a pasted grid with its top-left at `at`, growing the table as
   *  needed; one Undo step. The pasted block ends up selected. */
  function applyPaste(at: CellPos, grid: string[][], fill?: ReturnType<typeof selRect>) {
    const res = pasteGrid(rows, at, grid, fill);
    const nc = res.rows[0]?.length ?? nCols;
    const grew = nc !== nCols;
    commit(
      res.rows,
      grew ? normalizeAlign(align, nc) : undefined,
      grew && widths ? normalizeWidths(widths, nc) : undefined,
    );
    selectAndFocus(rangeSel({ r: res.rect.r0, c: res.rect.c0 }, { r: res.rect.r1, c: res.rect.c1 }));
  }

  // Drag across cells selects the rectangle between them; out and back
  // selects the start cell. Shift+click grows from the anchor (the
  // selection's, or the cell being edited).
  const [dragSelecting, setDragSelecting] = useState(false);
  const dragSelRef = useRef<{ start: CellPos; left: boolean } | null>(null);
  function onCellPointerDown(e: React.PointerEvent<HTMLElement>, r: number, c: number) {
    if (locked) return;
    // A right-click inside the selection keeps it (for Color on many cells).
    if (e.button === 2 && rect && inRect(rect, r, c)) {
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    if (e.shiftKey) {
      const anchor = sel ? sel.anchor : editingCell();
      if (anchor) {
        e.preventDefault();
        selectAndFocus(rangeSel(anchor, { r, c }));
        return;
      }
    }
    dragSelRef.current = { start: { r, c }, left: false };
    const move = (ev: PointerEvent) => {
      const d = dragSelRef.current;
      if (!d) return;
      const at = cellAtPoint(ev.clientX, ev.clientY);
      if (!at) return;
      if (!d.left && at.r === d.start.r && at.c === d.start.c) return;
      if (!d.left) {
        d.left = true;
        setDragSelecting(true);
      }
      try {
        window.getSelection()?.removeAllRanges();
      } catch {
        /* noop */
      }
      setSel(rangeSel(d.start, at));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const d = dragSelRef.current;
      dragSelRef.current = null;
      if (d?.left) {
        setDragSelecting(false);
        try {
          window.getSelection()?.removeAllRanges();
        } catch {
          /* noop */
        }
        rootRef.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  // A press anywhere outside the table (menus aside) ends the selection.
  useEffect(() => {
    if (!sel) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || rootRef.current?.contains(t) || t.closest?.('[role="menu"]')) return;
      setSel(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [sel]);

  /** Keys on a selection. Only when focus is on the table itself or a
   *  handle: inside a cell, keys edit text as before; in a menu (a portal),
   *  they belong to the menu. */
  function onRootKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (locked || !sel || !rect) return;
    const t = e.target as HTMLElement;
    const root = rootRef.current;
    if (!root || !root.contains(t)) return;
    if (t !== root && !t.closest("[data-table-handle]")) return;
    const meta = primaryMod(e);
    const k = e.key;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (k === "Escape") {
      if (menuSpec) return;
      stop();
      setSel(null);
      return;
    }
    const arrows: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (arrows[k] && !meta && !e.altKey) {
      stop();
      const [dr, dc] = arrows[k];
      setSel(e.shiftKey ? extendSel(sel, dr, dc, nRows, nCols) : moveSel(sel, dr, dc, nRows, nCols));
      if (t !== root) root.focus({ preventScroll: true });
      return;
    }
    if (k === "Tab" && !meta) {
      stop();
      setSel(moveSel(sel, 0, e.shiftKey ? -1 : 1, nRows, nCols));
      return;
    }
    if (k === "Enter" && !meta) {
      stop();
      const f = sel.kind === "cells" ? sel.focus : { r: rect.r0, c: rect.c0 };
      setSel(null);
      focusCell(f.r, f.c, "end");
      return;
    }
    if (k === "Backspace" || k === "Delete") {
      stop();
      commit(clearRect(rows, rect));
      return;
    }
    if (meta && !e.altKey) {
      const lower = k.toLowerCase();
      if (lower === "a" && !e.shiftKey) {
        stop();
        setSel(rangeSel({ r: 0, c: 0 }, { r: nRows - 1, c: nCols - 1 }));
        return;
      }
      const mark: CellMark | null = !e.shiftKey
        ? lower === "b"
          ? "bold"
          : lower === "i"
            ? "italic"
            : lower === "u"
              ? "underline"
              : lower === "e"
                ? "code"
                : null
        : lower === "s" || lower === "x"
          ? "strike"
          : lower === "h"
            ? "highlight"
            : null;
      if (mark) {
        stop();
        commit(toggleMarkInRect(rows, rect, mark));
      }
      return;
    }
    // Typing on a selection starts editing its first cell, replacing it.
    if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      stop();
      const f = sel.kind === "cells" ? sel.anchor : { r: rect.r0, c: rect.c0 };
      setSel(null);
      setCell(f.r, f.c, k);
      focusCell(f.r, f.c, "end");
    }
  }

  function onRootCopy(e: React.ClipboardEvent<HTMLDivElement>, cut: boolean) {
    if (!rect) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest?.("[data-table-cell]") && !sel) return;
    if (document.activeElement?.closest?.("[data-table-cell]")) return;
    const grid = rectSources(rows, rect);
    e.preventDefault();
    e.stopPropagation();
    e.clipboardData.setData("text/plain", toTsv(grid));
    e.clipboardData.setData(CELLS_MIME, JSON.stringify(grid));
    if (cut && !locked) commit(clearRect(rows, rect));
  }

  function onRootPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    if (locked || !rect) return;
    if (document.activeElement?.closest?.("[data-table-cell]")) return;
    const cells = readCellsJson(e.clipboardData.getData(CELLS_MIME));
    const plain = e.clipboardData.getData("text/plain");
    const grid = cells ?? (plain ? parseTsv(plain) : null);
    if (!grid) return;
    e.preventDefault();
    e.stopPropagation();
    applyPaste({ r: rect.r0, c: rect.c0 }, grid, rect);
  }

  // Cell keys: Tab / Shift-Tab walk the grid (and grow it from the last

  // cell), Enter moves down (cells stay one line), Escape blurs, and the
  // inline-format shortcuts apply through the SAME toggleWrap the prose
  // blocks and the floating toolbar use.
  function onCellKeyDown(
    e: React.KeyboardEvent<HTMLDivElement>,
    r: number,
    c: number,
  ) {
    if (locked) return;
    const meta = primaryMod(e);
    if (e.key === "Escape") {
      // Esc leaves the text and selects the cell (Notion's way); Esc
      // again clears the selection.
      e.preventDefault();
      e.stopPropagation();
      selectAndFocus(cellSel(r, c));
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        if (c > 0) focusCell(r, c - 1);
        else if (r > 0) focusCell(r - 1, nCols - 1);
        return;
      }
      if (c < nCols - 1) {
        focusCell(r, c + 1);
        return;
      }
      if (r < nRows - 1) {
        focusCell(r + 1, 0);
        return;
      }
      structural({ op: "addRow", at: nRows });
      focusCell(nRows, 0);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        if (r > 0) focusCell(r - 1, c);
        return;
      }
      if (r < nRows - 1) {
        focusCell(r + 1, c);
        return;
      }
      structural({ op: "addRow", at: nRows });
      focusCell(nRows, c);
      return;
    }
    if (meta) {
      const k = e.key.toLowerCase();
      const pair: [string, string] | null = !e.shiftKey
        ? k === "b"
          ? ["**", "**"]
          : k === "i"
            ? ["*", "*"]
            : k === "u"
              ? ["<u>", "</u>"]
              : k === "e"
                ? ["`", "`"]
                : null
        : k === "h"
          ? ["==", "=="]
          : k === "x"
            ? ["~~", "~~"]
            : null;
      if (!pair) return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget as HTMLElement;
      const src = rows[r]?.[c] ?? "";
      const cur = readCaret(el, src);
      if (!cur) return;
      const res = toggleWrap(src, cur.start, cur.end, pair[0], pair[1]);
      setCell(r, c, res.text);
      requestAnimationFrame(() => {
        try {
          el.focus({ preventScroll: true });
          writeCaret(el, res.text, res.start, res.end);
        } catch {
          /* noop */
        }
      });
    }
  }

  // Column menu. Structural operations only — sort/filter/formula/convert-
  // to-database are VIEW concepts and never appear here.
  function buildColumnSpec(index: number): MenuSpec {
    const isOnlyCol = nCols <= 1;
    const isFirst = index === 0;
    const isLast = index === nCols - 1;
    const currentAlign = align[index] ?? "left";
    const alignLabel =
      currentAlign === "center" ? "Center" : currentAlign === "right" ? "Right" : "Left";
    const colCells = nRows;
    const openSubmenu = (parent: MenuSpec) => {
      const submenu: MenuSpec = {
        title: "Align",
        onBack: () => setMenuSpec(parent),
        rows: (["left", "center", "right"] as Align[]).map((a) => ({
          kind: "row",
          label: a === "left" ? "Left" : a === "center" ? "Center" : "Right",
          checked: currentAlign === a,
          onPick: () => {
            commit(rows, setAlign(align, index, a));
            closeMenu();
          },
        })),
        footer: `Column ${index + 1}`,
      };
      setMenuSpec(submenu);
    };
    const spec: MenuSpec = {
      title: `Column ${index + 1}`,
      footer: `${nRows} row${nRows === 1 ? "" : "s"} · column ${index + 1} of ${nCols}`,
      rows: [
        {
          kind: "row",
          label: "Insert left",
          icon: "plus",
          onPick: () => {
            structural({ op: "addCol", at: index });
            setSel(colSel(index, nRows));
            closeMenu();
          },
        },
        {
          kind: "row",
          label: "Insert right",
          icon: "plus",
          onPick: () => {
            structural({ op: "addCol", at: index + 1 });
            setSel(colSel(index + 1, nRows));
            closeMenu();
          },
        },
        {
          kind: "row",
          label: "Duplicate column",
          icon: "dup",
          hint: { text: "with values" },
          onPick: () => {
            structural({ op: "duplicateCol", index: index });
            setSel(colSel(index + 1, nRows));
            closeMenu();
          },
        },
        { kind: "sep" },
        {
          kind: "row",
          label: "Move left",
          icon: "arrow",
          hint: isFirst ? { text: "at start" } : undefined,
          onPick: () => {
            if (isFirst) return;
            structural({ op: "moveCol", from: index, to: index - 1 });
            setSel(colSel(index - 1, nRows));
            closeMenu();
          },
        },
        {
          kind: "row",
          label: "Move right",
          icon: "arrow",
          hint: isLast ? { text: "at end" } : undefined,
          onPick: () => {
            if (isLast) return;
            structural({ op: "moveCol", from: index, to: index + 1 });
            setSel(colSel(index + 1, nRows));
            closeMenu();
          },
        },
        { kind: "sep" },
        {
          kind: "row",
          label: "Align",
          icon: "layout",
          hint: { text: alignLabel },
          onPick: () => openSubmenu(spec),
        },
        ...(index === 0
          ? ([
              {
                kind: "row" as const,
                label: "Use as header column",
                icon: "board",
                checked: headerCol,
                onPick: () => {
                  onChange({ headerCol: !headerCol });
                  closeMenu();
                },
              },
              { kind: "sep" as const },
            ] as MenuRow[])
          : []),
        {
          kind: "row",
          label: "Color",
          icon: "droplet",
          hint: { text: "›" },
          onPick: () => setMenuSpec(buildColorSpec({ kind: "col", c: index }, buildColumnSpec(index))),
        },
        {
          kind: "row",
          label: "Clear contents",
          icon: "clear",
          hint: { text: `${colCells} cell${colCells === 1 ? "" : "s"}` },
          onPick: () => {
            commit(clearColumn(rows, index));
            closeMenu();
          },
        },
        {
          kind: "row",
          label: "Copy as text",
          icon: "dup",
          hint: { text: "⌘C", mono: true },
          onPick: () => {
            copySelection();
            closeMenu();
          },
        },
        { kind: "sep" },
        {
          kind: "row",
          label: "Delete column",
          icon: "trash",
          danger: true,
          hint: isOnlyCol ? { text: "last column" } : undefined,
          onPick: () => {
            if (isOnlyCol) return;
            structural({ op: "deleteCol", index: index });
            setSel(null);
            closeMenu();
          },
        },
      ],
    };
    return spec;
  }

  function openColumnMenu(anchor: HTMLElement, index: number) {
    setMenuSpec(buildColumnSpec(index));
    setMenuAnchor(anchor);
    suppressHint();
  }

  function buildRowSpec(index: number): MenuSpec {
    const isOnlyRow = nRows <= 1;
    const isFirst = index === 0;
    const isLast = index === nRows - 1;
    const rowCells = nCols;
    const isHeader = index === 0 && headerRow;
    const footer =
      `${nCols} column${nCols === 1 ? "" : "s"} · row ${index + 1} of ${nRows}` +
      (isHeader ? " · header" : "");
    return {
      title: isHeader ? "Header row" : `Row ${index + 1}`,
      footer,
      rows: [
        {
          kind: "row",
          label: "Insert above",
          icon: "plus",
          onPick: () => {
            structural({ op: "addRow", at: index });
            setSel(rowSel(index, nCols));
            closeMenu();
          },
        },
        {
          kind: "row",
          label: "Insert below",
          icon: "plus",
          onPick: () => {
            structural({ op: "addRow", at: index + 1 });
            setSel(rowSel(index + 1, nCols));
            closeMenu();
          },
        },
        {
          kind: "row",
          label: "Duplicate row",
          icon: "dup",
          hint: { text: "with values" },
          onPick: () => {
            structural({ op: "duplicateRow", index: index });
            setSel(rowSel(index + 1, nCols));
            closeMenu();
          },
        },
        { kind: "sep" },
        // HEADER IS PINNED. When `headerRow` is on, row 0 cannot leave the
        // header slot and no other row can enter it — so the two menu
        // entries that would perform exactly that are HIDDEN, matching the
        // drag gesture's rule. The pure op in table-ops stays unrestricted;
        // the constraint is presentational and lives here once.
        ...((headerRow && index === 1
          ? []
          : [
              {
                kind: "row" as const,
                label: "Move up",
                icon: "chevUp" as const,
                hint: isFirst ? { text: "at top" } : undefined,
                onPick: () => {
                  if (isFirst) return;
                  structural({ op: "moveRow", from: index, to: index - 1 });
                  setSel(rowSel(index - 1, nCols));
                  closeMenu();
                },
              },
            ]) as MenuRow[]),
        ...((headerRow && index === 0
          ? []
          : [
              {
                kind: "row" as const,
                label: "Move down",
                icon: "chevDown" as const,
                hint: isLast ? { text: "at end" } : undefined,
                onPick: () => {
                  if (isLast) return;
                  structural({ op: "moveRow", from: index, to: index + 1 });
                  setSel(rowSel(index + 1, nCols));
                  closeMenu();
                },
              },
            ]) as MenuRow[]),
        { kind: "sep" },
        ...(index === 0
          ? ([
              {
                kind: "row" as const,
                label: "Use as header row",
                icon: "list",
                checked: headerRow,
                onPick: () => {
                  onChange({ headerRow: !headerRow });
                  closeMenu();
                },
              },
              { kind: "sep" as const },
            ] as MenuRow[])
          : []),
        {
          kind: "row",
          label: "Color",
          icon: "droplet",
          hint: { text: "›" },
          onPick: () => setMenuSpec(buildColorSpec({ kind: "row", r: index }, buildRowSpec(index))),
        },
        {
          kind: "row",
          label: "Clear contents",
          icon: "clear",
          hint: { text: `${rowCells} cell${rowCells === 1 ? "" : "s"}` },
          onPick: () => {
            commit(clearRow(rows, index));
            closeMenu();
          },
        },
        {
          kind: "row",
          label: "Copy as text",
          icon: "dup",
          hint: { text: "⌘C", mono: true },
          onPick: () => {
            copySelection();
            closeMenu();
          },
        },
        { kind: "sep" },
        {
          kind: "row",
          label: "Delete row",
          icon: "trash",
          danger: true,
          hint: isOnlyRow ? { text: "last row" } : undefined,
          onPick: () => {
            if (isOnlyRow) return;
            // Deleting row 0 promotes the next row to header positionally;
            // header is not stored, only render-order. Confirm this out loud
            // so the operator isn't surprised by row 1's new styling.
            if (isHeader) {
              setMenuSpec({
                title: "Delete header row",
                rows: [],
                confirm: {
                  title: "Delete header row?",
                  body: "The next row becomes the header.",
                  cta: "Delete row",
                  danger: true,
                  onConfirm: () => {
                    structural({ op: "deleteRow", index: index });
                    setSel(null);
                  },
                },
              });
              return;
            }
            structural({ op: "deleteRow", index: index });
            setSel(null);
            closeMenu();
          },
        },
      ],
    };
  }

  function openRowMenu(anchor: HTMLElement, index: number) {
    setMenuSpec(buildRowSpec(index));
    setMenuAnchor(anchor);
    suppressHint();
  }

  // Colour: text and background, from the callout palette, stored by
  // name. Applies to a row, a column or the selected cells.
  function buildColorSpec(target: ColorTarget, back?: MenuSpec): MenuSpec {
    const own =
      target.kind === "row"
        ? colors?.rows?.[String(target.r)]
        : target.kind === "col"
          ? colors?.cols?.[String(target.c)]
          : colors?.cells?.[`${target.r0},${target.c0}`];
    const pick = (patch: { fg?: TableColorName | null; bg?: TableColorName | null }) => {
      onChange({ colors: setColor(colors, target, patch) });
      closeMenu();
    };
    const textRows: MenuRow[] = [
      { kind: "row", label: "Default text", icon: "letterA", checked: !own?.fg, onPick: () => pick({ fg: null }) },
      ...TABLE_COLOR_NAMES.map(
        (n): MenuRow => ({
          kind: "row",
          label: `${colorLabel(n)} text`,
          dot: fgToken(n),
          checked: own?.fg === n,
          onPick: () => pick({ fg: n }),
        }),
      ),
    ];
    const bgRows: MenuRow[] = [
      {
        kind: "row",
        label: "Default background",
        hasSwatch: true,
        swBg: "var(--color-surface)",
        swRing: "var(--color-line)",
        checked: !own?.bg,
        onPick: () => pick({ bg: null }),
      },
      ...TABLE_COLOR_NAMES.map(
        (n): MenuRow => ({
          kind: "row",
          label: `${colorLabel(n)} background`,
          hasSwatch: true,
          swBg: bgToken(n),
          swRing: "var(--color-line)",
          checked: own?.bg === n,
          onPick: () => pick({ bg: n }),
        }),
      ),
    ];
    const what =
      target.kind === "row"
        ? `Row ${target.r + 1}`
        : target.kind === "col"
          ? `Column ${target.c + 1}`
          : (() => {
              const n = (target.r1 - target.r0 + 1) * (target.c1 - target.c0 + 1);
              return n === 1 ? "1 cell" : `${n} cells`;
            })();
    return {
      title: "Color",
      footer: what,
      onBack: back ? () => setMenuSpec(back) : undefined,
      rows: [...textRows, { kind: "sep" }, ...bgRows],
    };
  }

  /** What a colour applies to for the current selection: its row or
   *  column when a handle picked it, otherwise the cells. */
  const selColorTarget = (): ColorTarget | null => {
    if (!sel || !rect) return null;
    if (sel.kind === "row" && rect.r0 === rect.r1) return { kind: "row", r: rect.r0 };
    if (sel.kind === "col" && rect.c0 === rect.c1) return { kind: "col", c: rect.c0 };
    return { kind: "cells", ...rect };
  };

  // The table's own ⋯ (top-right corner): the switches that belong to the
  // whole table. The menu stays open and redraws after each switch, so
  // two of them can be flipped in one visit.
  type TableOpts = { headerRow: boolean; headerCol: boolean; fit: boolean };
  function buildOptionsSpec(o: TableOpts): MenuSpec {
    const flip = (patch: Partial<Blk>, next: TableOpts) => {
      onChange(patch);
      setMenuSpec(buildOptionsSpec(next));
    };
    return {
      title: "Table",
      footer: `${nCols} column${nCols === 1 ? "" : "s"} · ${nRows} row${nRows === 1 ? "" : "s"}`,
      rows: [
        {
          kind: "row",
          label: "Header row",
          icon: "freezeRow",
          checked: o.headerRow,
          onPick: () => flip({ headerRow: !o.headerRow }, { ...o, headerRow: !o.headerRow }),
        },
        {
          kind: "row",
          label: "Header column",
          icon: "board",
          checked: o.headerCol,
          onPick: () => flip({ headerCol: !o.headerCol }, { ...o, headerCol: !o.headerCol }),
        },
        { kind: "sep" },
        {
          kind: "row",
          label: "Fit to page",
          icon: "layout",
          checked: o.fit,
          onPick: () => {
            if (o.fit) {
              // Off: exact widths. A table that never had widths gets the
              // default width per column, so the change is visible.
              flip(
                { fit: undefined, widths: widths ?? Array.from({ length: nCols }, () => WIDTH_DEFAULT) },
                { ...o, fit: false },
              );
            } else {
              flip({ fit: true }, { ...o, fit: true });
            }
          },
        },
      ],
    };
  }

  function openOptionsMenu(anchor: HTMLElement) {
    setSel(null);
    setMenuSpec(buildOptionsSpec({ headerRow, headerCol, fit }));
    setMenuAnchor(anchor);
    setOptionsOpen(true);
    suppressHint();
  }

  // Right-click chooser: two rows that swap the panel in place to the row
  // or column menu, sharing the anchor. Used by the cell context-menu path
  // where we do not yet know which axis the user wants.
  function buildChooserSpec(rowIndex: number, colIndex: number): MenuSpec {
    return {
      title: `Row ${rowIndex + 1} · Column ${colIndex + 1}`,
      rows: [
        {
          kind: "row",
          label: "Row actions",
          icon: "list",
          hint: { text: "›" },
          onPick: () => setMenuSpec(buildRowSpec(rowIndex)),
        },
        {
          kind: "row",
          label: "Column actions",
          icon: "board",
          hint: { text: "›" },
          onPick: () => setMenuSpec(buildColumnSpec(colIndex)),
        },
        {
          kind: "row",
          label: "Color",
          icon: "droplet",
          hint: { text: "›" },
          onPick: () => {
            // The selection when the cell is in it, otherwise this cell.
            const inSel = rect && inRect(rect, rowIndex, colIndex) ? selColorTarget() : null;
            setMenuSpec(
              buildColorSpec(
                inSel ?? { kind: "cells", r0: rowIndex, c0: colIndex, r1: rowIndex, c1: colIndex },
                buildChooserSpec(rowIndex, colIndex),
              ),
            );
          },
        },
      ],
    };
  }

  // One click on a handle now selects AND opens the menu in the same
  // gesture. Two clicks to reach a menu is a hunt; one is a control.
  // A click that ENDS a reorder drag never reaches here: `useDragSession`
  // swallows exactly one click after a real drag.
  function onColumnHandleClick(e: React.MouseEvent<HTMLButtonElement>, index: number) {
    e.stopPropagation();
    if (locked) return;
    // Keys now belong to the table (Esc, Backspace, ⌘C on the row or
    // column), not to whatever text block had focus before.
    e.currentTarget.focus({ preventScroll: true });
    setSel(colSel(index, nRows));
    openColumnMenu(e.currentTarget, index);
  }

  function onRowHandleClick(e: React.MouseEvent<HTMLButtonElement>, index: number) {
    e.stopPropagation();
    if (locked) return;
    // Keys now belong to the table (Esc, Backspace, ⌘C on the row or
    // column), not to whatever text block had focus before.
    e.currentTarget.focus({ preventScroll: true });
    setSel(rowSel(index, nCols));
    openRowMenu(e.currentTarget, index);

  }

  // Right-click inside a cell — read the cell's row/col off the input's
  // data attribute, preventDefault only within this table so the browser's
  // own menu still works everywhere else, and open the chooser anchored to
  // the cell.
  function onTableContextMenu(e: React.MouseEvent<HTMLDivElement>) {
    if (locked) return;
    const el = (e.target as HTMLElement | null)?.closest?.(
      "[data-table-cell]",
    ) as HTMLElement | null;
    if (!el) return;
    const attr = el.getAttribute("data-table-cell");
    if (!attr) return;
    const [rStr, cStr] = attr.split(",");
    const r = Number(rStr);
    const c = Number(cStr);
    if (!Number.isFinite(r) || !Number.isFinite(c)) return;
    e.preventDefault();
    e.stopPropagation();
    setMenuSpec(buildChooserSpec(r, c));
    setMenuAnchor(el);
    suppressHint();
  }

  // Click into any cell deselects the row/column selection.
  const clearSelIfBodyClick = () => {
    if (sel) setSel(null);
  };

  // Effective widths for render: while a drag is in flight we show
  // dragWidths (never persisted); otherwise the stored widths (or
  // undefined for auto layout).
  const effectiveWidths = dragWidths ?? widths;
  const contentWidth = effectiveWidths && !fit
    ? effectiveWidths.reduce((a, n) => a + n, 0)
    : null;
  const colWidths = effectiveWidths
    ? fit
      ? fitPercents(effectiveWidths).map((p) => `${p}%`)
      : effectiveWidths
    : null;

  const beginResize = (e: React.PointerEvent<HTMLDivElement>, colIndex: number) => {
    // Seed a widths array on first drag from the currently-rendered
    // column widths, so nothing jumps when we flip from auto layout to
    // fixed. Measurement happens ONCE per drag — subsequent moves
    // reference the sealed `base` copy so the other columns don't
    // rebalance as this one grows.
    const measure = (i: number): number => {
      const el = tableRef.current?.querySelector<HTMLElement>(`tr > [data-col="${i}"]`);
      const w = el ? Math.round(el.getBoundingClientRect().width) : 160;
      return Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, w));
    };
    // Fit to page measures what's on screen (stored widths are only
    // proportions there), so the border moves exactly with the pointer.
    const base: WidthList = effectiveWidths && !fit
      ? effectiveWidths.slice()
      : Array.from({ length: nCols }, (_, i) => measure(i));
    const startWidth = base[colIndex] ?? 160;
    const handleEl = e.currentTarget;
    try {
      handleEl.setPointerCapture(e.pointerId);
    } catch {
      /* ignore — non-mouse pointers still work without capture */
    }
    dragRef.current = {
      index: colIndex,
      startX: e.clientX,
      startWidth,
      base,
      pointerId: e.pointerId,
      handle: handleEl,
      fit,
    };
    setDragWidths(base);
    e.preventDefault();
    e.stopPropagation();
  };
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (d.fit) {
      setDragWidths(resizeFitted(d.base, d.index, dx));
      return;
    }
    const nextW = Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, d.startWidth + dx));
    const next = d.base.slice();
    next[d.index] = nextW;
    setDragWidths(next);
  };
  const onResizeUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    try {
      d.handle.releasePointerCapture?.(d.pointerId);
    } catch {
      /* ignore */
    }
    const final = dragRef.current
      ? (dragWidths ?? d.base)
      : null;
    const wasFit = d.fit;
    dragRef.current = null;
    setDragWidths(null);
    // A resize in Fit to page keeps fitting: the widths become proportions.
    if (final) onChange(wasFit ? { widths: final, fit: true } : { widths: final });
    e.stopPropagation();
  };
  const resetColumn = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.altKey) {
      // Alt: clear widths entirely — restore auto/equal layout.
      onChange({ widths: undefined, fit: undefined });
      return;
    }
    // Plain double-click: equal-share across all columns, using the
    // rendered table's current width as the total. Falls back to the
    // average of any current widths when the table isn't measurable.
    const measured = tableRef.current?.getBoundingClientRect().width ?? 0;
    const total = measured > 0
      ? measured
      : (widths ? widths.reduce((a, n) => a + n, 0) : nCols * 160);
    const share = Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, Math.round(total / nCols)));
    const equal: WidthList = Array.from({ length: nCols }, () => share);
    onChange({ widths: equal });
  };

  /* ────────────── Reorder by dragging a handle ──────────────
   *
   * The MECHANICS of the gesture — pointer capture, the 4px threshold, the
   * ghost, edge autoscroll, Escape/cancel, click suppression and cleanup —
   * belong to `useDragSession` (src/hooks/use-drag-session.ts). This file
   * only supplies the three things that are genuinely table-specific: where
   * the pointer points (`hitTest`), what a drop means (`commit`) and what
   * the in-flight thing looks like (`makeGhost`).
   *
   * Every drop commits through the SAME pure ops the menu's
   * Move up/down/left/right use, threading align and widths in lockstep for
   * a column move: forgetting either silently offsets every column.
   *
   * Target index comes from the ALREADY-MEASURED `metrics`, never from an
   * equal share of the column count — columns carry different widths, and a
   * wrong index reorders a column the user did not point at. When metrics
   * are unavailable (unmeasured layout), we fall back to a nominal step so
   * the gesture degrades to something predictable rather than dead.
   */
  const FALLBACK_ROW_H = 24;
  const FALLBACK_COL_W = 100;

  // Row 0 is untouchable while `headerRow` is on: it cannot be dragged and
  // nothing may be dropped above it.
  const minRowIndex = headerRow ? 1 : 0;


  const indexAtY = (clientY: number) => {
    const base = tableRef.current?.getBoundingClientRect();
    const y = clientY - (base?.top ?? 0);
    const rs = metrics?.rows ?? [];
    const total = rs.reduce((a, r) => a + r.height, 0);
    if (rs.length === nRows && total > 0) {
      for (let i = 0; i < rs.length; i++) {
        if (y < rs[i].top + rs[i].height) return i;
      }
      return nRows - 1;
    }
    return Math.max(0, Math.min(nRows - 1, Math.round(y / FALLBACK_ROW_H)));
  };

  const indexAtX = (clientX: number) => {
    const base = tableRef.current?.getBoundingClientRect();
    const x = clientX - (base?.left ?? 0);
    const cs = metrics?.cols ?? [];
    const total = cs.reduce((a, c) => a + c.width, 0);
    if (cs.length === nCols && total > 0) {
      for (let i = 0; i < cs.length; i++) {
        if (x < cs[i].left + cs[i].width) return i;
      }
      return nCols - 1;
    }
    return Math.max(0, Math.min(nCols - 1, Math.round(x / FALLBACK_COL_W)));
  };

  type DragPayload = { axis: "row" | "col"; from: number };
  type DropTarget = { axis: "row" | "col"; from: number; to: number };

  /** Ghost: a CLONE, never the live node — moving the real row/column would
   *  reflow the table under the pointer mid-drag. */
  const makeGhost = (p: DragPayload): HTMLElement | null => {
    const tbl = tableRef.current;
    if (!tbl) return null;
    const trs = Array.from(tbl.querySelectorAll("tr"));
    if (p.axis === "row") {
      const tr = trs[p.from];
      if (!tr) return null;
      const r = tr.getBoundingClientRect();
      const host = document.createElement("table");
      host.className = tbl.className;
      host.style.width = `${r.width}px`;
      host.style.background = "var(--color-canvas)";
      host.style.tableLayout = "fixed";
      const body = document.createElement("tbody");
      body.appendChild(tr.cloneNode(true));
      host.appendChild(body);
      return host;
    }
    const host = document.createElement("div");
    host.style.background = "var(--color-canvas)";
    const w = metrics?.cols[p.from]?.width;
    if (w) host.style.width = `${w}px`;
    for (const tr of trs) {
      const cell = tr.children[p.from] as HTMLElement | undefined;
      if (!cell) continue;
      const line = document.createElement("div");
      line.className = "border border-line px-2 py-1 text-meta";
      line.textContent = cell.textContent ?? "";
      host.appendChild(line);
    }
    return host;
  };

  const drag = useDragSession<DropTarget, DragPayload>({
    hitTest: (pt, p) => ({
      axis: p.axis,
      from: p.from,
      to:
        p.axis === "row"
          ? Math.max(minRowIndex, indexAtY(pt.y))
          : indexAtX(pt.x),
    }),
    commit: (drop) => {
      if (drop.to === drop.from) return;
      if (drop.axis === "row") {
        structural({ op: "moveRow", from: drop.from, to: drop.to });
        setSel(rowSel(drop.to, nCols));
      } else {
        structural({ op: "moveCol", from: drop.from, to: drop.to });
        setSel(colSel(drop.to, nRows));
      }
    },
    makeGhost,
    // A row drag scrolls the PAGE vertically; a column drag scrolls the
    // TABLE horizontally. Both containers are offered every time and
    // edgeVelocity decides which one has work to do.
    scrollTargets: () => [
      scrollRef.current,
      rootRef.current?.closest("main") as HTMLElement | null,
    ],
  });

  const reorder = drag.active ? drag.target : null;

  const beginHandleDrag = (
    e: React.PointerEvent<HTMLElement>,
    axis: "row" | "col",
    index: number,
  ) => {
    if (locked) return;
    // Pinned header: no gesture at all, so the click still reaches the menu.
    if (axis === "row" && headerRow && index === 0) return;
    drag.begin(e, { axis, from: index });
  };



  return (
    <div
      ref={rootRef}
      className="group/table relative outline-none"
      tabIndex={-1}
      data-table-root
      onContextMenu={onTableContextMenu}
      onKeyDown={onRootKeyDown}
      onCopy={(e) => onRootCopy(e, false)}
      onCut={(e) => onRootCopy(e, true)}
      onPaste={onRootPaste}
      // The 23px handle margin sits outside the text column, so the grid's
      // borders line up with the paragraphs around it (Notion's look).
      style={{ margin: "0 -23px", ...(dragSelecting ? { userSelect: "none" } : null) }}
    >
      <div
        ref={scrollRef}
        style={{ overflowX: "auto", overflowY: "hidden" }}
        onMouseDown={clearSelIfBodyClick}
      >
        <div
          style={{
            position: "relative",
            padding: 23,
            display: "inline-block",
            minWidth: "100%",
            boxSizing: "border-box",
            verticalAlign: "top",
          }}
        >
          <table
            ref={tableRef}
            className={"border-collapse text-ui " + (fit ? "w-full" : "")}
            style={{
              tableLayout: "fixed",
              ...(contentWidth != null ? { width: contentWidth } : {}),
            }}
          >
            {colWidths && (
              <colgroup>
                {colWidths.map((w, ci) => (
                  <col key={ci} style={{ width: w }} />
                ))}
              </colgroup>
            )}
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} data-row={ri}>
                  {row.map((cell, ci) => {
                    // Header-ness is a BLOCK attribute, never row data:
                    // `headerRow` (default on) and `headerCol` (default
                    // off) decide which cells render as <th>.
                    const isHead =
                      (headerRow && ri === 0) || (headerCol && ci === 0);
                    const paint = colorAt(colors, ri, ci);
                    const Tag: "th" | "td" = isHead ? "th" : "td";
                    const selected = !!rect && inRect(rect, ri, ci);
                    // In-flight tint: the SOURCE row/column stays
                    // identifiable while the insertion line is far from it.
                    // Same tint as selection — a drag is a selection that
                    // is on the move, not a new colour to learn.
                    const inFlight = reorder
                      ? reorder.axis === "row"
                        ? reorder.from === ri
                        : reorder.from === ci
                      : false;
                    return (
                      <Tag
                        key={ci}
                        data-col={ci}
                        onPointerDown={(e) => onCellPointerDown(e, ri, ci)}
                        className={
                          "relative border border-line p-0 align-top font-normal text-body " +
                          (isHead ? "bg-canvas" : "")
                        }
                        style={{
                          // Header cells sit on a warm tint (Notion's look);
                          // a colour set on the cell, row or column wins,
                          // and a selection or an in-flight drag tints over.
                          textAlign: align[ci] ?? "left",
                          ...(paint.fg ? { color: fgToken(paint.fg) } : null),
                          ...(paint.bg ? { background: bgToken(paint.bg) } : null),
                          ...(inFlight || (selected && (rectSize(rect!) > 1 || sel?.kind !== "cells"))
                            ? { background: "color-mix(in srgb, var(--color-blueTint) 70%, transparent)" }
                            : null),
                        }}
                      >
                        {/* Cells are contenteditable so inline markdown
                            renders in place, exactly like prose blocks.
                            Enter never inserts a newline here — it moves
                            down a row, so a cell stays one line. */}
                        <Editable
                          source={cell ?? ""}
                          locked={locked}
                          onSourceChange={(v) => setCell(ri, ci, v)}
                          onPaste={(e) => onCellPaste(e, ri, ci)}
                          onKeyDown={(e) => onCellKeyDown(e, ri, ci)}
                          onFocus={() => setSel(null)}
                          onBlur={onBlur}
                          ariaLabel={`Row ${ri + 1} column ${ci + 1}`}
                          dataAttrs={{ "data-table-cell": `${ri},${ci}` }}
                          className="w-full px-2.5 py-1.5 outline-none"
                        />
                        {ri === 0 && !locked && !(fit && ci === nCols - 1) && (
                          // Resize grip on the right border of each
                          // header cell. 8px wide, centred on the
                          // border via translateX(4px). Pointer capture
                          // keeps the drag alive even when the pointer
                          // strays outside the handle mid-drag.
                          <div
                            role="separator"
                            aria-label={`Resize column ${ci + 1}`}
                            aria-orientation="vertical"
                            onPointerDown={(e) => beginResize(e, ci)}
                            onPointerMove={onResizeMove}
                            onPointerUp={onResizeUp}
                            onPointerCancel={onResizeUp}
                            onDoubleClick={resetColumn}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              position: "absolute",
                              top: 0,
                              right: 0,
                              height: "100%",
                              width: 8,
                              transform: "translateX(4px)",
                              cursor: "col-resize",
                              zIndex: 2,
                              touchAction: "none",
                            }}
                          />
                        )}
                      </Tag>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Selected cells: one blue outline around the rectangle. */}
          {rect &&
            metrics &&
            metrics.cols[rect.c1] &&
            metrics.rows[rect.r1] &&
            !reorder && (
              <div
                aria-hidden
                data-table-selection
                style={{
                  position: "absolute",
                  left: 23 + metrics.cols[rect.c0].left - 1,
                  top: 23 + metrics.rows[rect.r0].top - 1,
                  width:
                    metrics.cols[rect.c1].left + metrics.cols[rect.c1].width - metrics.cols[rect.c0].left + 2,
                  height:
                    metrics.rows[rect.r1].top + metrics.rows[rect.r1].height - metrics.rows[rect.r0].top + 2,
                  border: "2px solid var(--color-blue)",
                  borderRadius: 2,
                  pointerEvents: "none",
                  zIndex: 2,
                }}
              />
            )}

          {/* Drop indicator — a 2px accent insertion line at the boundary
              where the dragged row/column will land, spanning the table.
              Geometry comes from the measured metrics, and the line sits on
              the FAR edge of the target when dragging forwards so it reads
              as "lands after this one". */}
          {reorder &&
            metrics &&
            (() => {
              const pad = 23;
              const forward = reorder.to > reorder.from;
              if (reorder.axis === "col") {
                const m = metrics.cols[reorder.to];
                if (!m) return null;
                const h = metrics.rows.reduce((a, r) => a + r.height, 0);
                const x = pad + (forward ? m.left + m.width : m.left);
                return (
                  <div
                    aria-hidden
                    data-drop-indicator="col"
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      width: 2,
                      height: h,
                      // Transform, not left/top, so the slide is composited
                      // and the line eases between boundaries instead of
                      // teleporting.
                      transform: `translate3d(${x - 1}px, ${pad}px, 0)`,
                      transition: "transform 120ms ease-out",
                      background: "var(--color-accent)",
                      pointerEvents: "none",
                      zIndex: 4,
                    }}
                  />
                );
              }
              const m = metrics.rows[reorder.to];
              if (!m) return null;
              const w = metrics.cols.reduce((a, c) => a + c.width, 0);
              const y = pad + (forward ? m.top + m.height : m.top);
              return (
                <div
                  aria-hidden
                  data-drop-indicator="row"
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: w,
                    height: 2,
                    transform: `translate3d(${pad}px, ${y - 1}px, 0)`,
                    transition: "transform 120ms ease-out",
                    background: "var(--color-accent)",
                    pointerEvents: "none",
                    zIndex: 4,
                  }}
                />
              );

            })()}


          {!locked && (
            <>
              {/* Column handles — 16px hit strip whose visible pill sits
                  7px above the header row (padding 23 − 16 hit = 7). */}
              <div
                aria-hidden={false}
                className="pointer-events-none absolute opacity-0 transition-opacity group-hover/table:opacity-100"
                style={{ top: 0, left: 23, right: 23, height: 16 }}
              >
                <div
                  className="pointer-events-auto"
                  style={{ position: "relative", width: "100%", height: "100%" }}
                >
                  {Array.from({ length: nCols }, (_, ci) => {
                    const active = sel?.kind === "col" && !!rect && ci >= rect.c0 && ci <= rect.c1;
                    // MEASURED geometry, never an equal share: columns can
                    // have different widths, and a handle that doesn't sit
                    // over its own column means the menu you open — and the
                    // column you delete — is not the one you pointed at.
                    const m = metrics?.cols[ci];
                    const box = m
                      ? { left: m.left, width: m.width }
                      : { left: `${(ci * 100) / nCols}%`, width: `${100 / nCols}%` };
                    return (
                      <div
                        key={ci}
                        style={{
                          position: "absolute",
                          top: 0,
                          height: "100%",
                          display: "flex",
                          ...box,
                        }}
                      >
                        <ColumnHandle
                          ci={ci}
                          active={active}
                          onClick={onColumnHandleClick}
                          onPointerDown={(e) => beginHandleDrag(e, "col", ci)}

                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Row handles — mirror on the left edge. */}
              <div
                aria-hidden={false}
                className="pointer-events-none absolute opacity-0 transition-opacity group-hover/table:opacity-100"
                style={{ left: 0, top: 23, bottom: 23, width: 16 }}
              >
                <div
                  className="pointer-events-auto"
                  style={{ position: "relative", width: "100%", height: "100%" }}
                >
                  {rows.map((_, ri) => {
                    const active = sel?.kind === "row" && !!rect && ri >= rect.r0 && ri <= rect.r1;
                    const m = metrics?.rows[ri];
                    const box = m
                      ? { top: m.top, height: m.height }
                      : { top: `${(ri * 100) / nRows}%`, height: `${100 / nRows}%` };
                    return (
                      <div
                        key={ri}
                        style={{
                          position: "absolute",
                          left: 0,
                          width: "100%",
                          display: "flex",
                          ...box,
                        }}
                      >
                        <RowHandle
                          ri={ri}
                          active={active}
                          onClick={onRowHandleClick}
                          onPointerDown={(e) => beginHandleDrag(e, "row", ri)}

                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Table options — the corner just past the table's top-right,
                  above the +column pill. Shown on hover, while a cell has
                  focus and while its menu is open. */}
              <button
                type="button"
                aria-label="Table options"
                title="Table options"
                aria-haspopup="menu"
                aria-expanded={optionsOpen}
                data-table-options
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (optionsOpen) closeMenu();
                  else openOptionsMenu(e.currentTarget);
                }}
                className={
                  "absolute flex items-center justify-center rounded-md text-faint transition-opacity hover:bg-line hover:text-secondary focus-visible:opacity-100 group-hover/table:opacity-100 group-focus-within/table:opacity-100 " +
                  (optionsOpen ? "bg-line opacity-100" : "opacity-0")
                }
                style={{
                  top: 0,
                  width: 21,
                  height: 21,
                  ...(metrics && metrics.cols.length
                    ? { left: 23 + metrics.cols.reduce((a, c) => a + c.width, 0) + 1 }
                    : { right: 1 }),
                  zIndex: 3,
                }}
              >
                <svg aria-hidden width={14} height={14} viewBox="0 0 24 24">
                  <circle cx="5" cy="12" r="1.8" fill="currentColor" />
                  <circle cx="12" cy="12" r="1.8" fill="currentColor" />
                  <circle cx="19" cy="12" r="1.8" fill="currentColor" />
                </svg>
              </button>

              {/* +column pill on the right edge of the content wrapper. */}
              <AddPill
                axis="col"
                onClick={() => {
                  structural({ op: "addCol", at: nCols });
                  focusCell(0, nCols);
                }}
              />

              {/* +row pill on the bottom edge of the content wrapper. */}
              <AddPill
                axis="row"
                onClick={() => {
                  structural({ op: "addRow", at: nRows });
                  focusCell(nRows, 0);
                }}
              />
            </>
          )}
        </div>
      </div>

      {/* Bar over a selection of more than one cell. On the root, not in
          the scroller, so it isn't clipped above the first row. */}
      {!locked && sel?.kind === "cells" && rect && rectSize(rect) > 1 && !dragSelecting && metrics?.rows[rect.r0] && metrics.cols[rect.c0] && (
        <div
          role="toolbar"
          aria-label="Selected cells"
          data-table-selbar
          onMouseDown={(e) => e.preventDefault()}
          className="absolute flex items-center rounded-lg"
          style={{
            left: Math.max(0, 23 + metrics.cols[rect.c0].left - scrollX),
            top: 23 + metrics.rows[rect.r0].top - 40,
            height: 32,
            padding: "0 4px",
            gap: 2,
            background: "var(--color-btn)",
            color: "var(--color-btnFg)",
            boxShadow: "0 8px 24px rgba(13,13,9,.22)",
            zIndex: 6,
            animation: "var(--animate-popIn)",
            transformOrigin: "bottom left",
          }}
        >
          <span className="px-2 text-caption opacity-70">
            {rectSize(rect)} cells
          </span>
          <button
            type="button"
            className="bar-btn rounded-md px-2 text-caption"
            style={{ height: 24 }}
            aria-haspopup="menu"
            onClick={(e) => {
              const target = selColorTarget();
              if (!target) return;
              setMenuSpec(buildColorSpec(target));
              setMenuAnchor(e.currentTarget);
            }}
          >
            Color
          </button>
          <button
            type="button"
            className="bar-btn rounded-md px-2 text-caption"
            style={{ height: 24 }}
            onClick={() => {
              toClipboard(toTsv(rectSources(rows, rect)));
              rootRef.current?.focus({ preventScroll: true });
            }}
          >
            Copy
          </button>
          <button
            type="button"
            className="bar-btn rounded-md px-2 text-caption"
            style={{ height: 24 }}
            onClick={() => {
              commit(clearRect(rows, rect));
              rootRef.current?.focus({ preventScroll: true });
            }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Horizontal-overflow fades. Pinned to the OUTER root so they sit
          on top of the scrolling content, not inside it — otherwise they
          would scroll off with the table. Only rendered when there is
          content to reveal in that direction. */}
      {showFadeL && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0"
          style={{
            width: 40,
            zIndex: 3,
            background:
              "linear-gradient(to right, var(--color-surface), transparent)",
          }}
        />
      )}
      {showFadeR && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0"
          style={{
            width: 40,
            zIndex: 3,
            background:
              "linear-gradient(to left, var(--color-surface), transparent)",
          }}
        />
      )}

      {/* First-contact hint — shown once, beneath the hovered table
          while nothing is selected. Suppressed permanently after the
          first menu open (localStorage: gio.tableHintSeen). */}
      {!locked && !hintSeen && !sel && !menuSpec && (
        <div
          aria-hidden
          className="pointer-events-none absolute opacity-0 transition-opacity group-hover/table:opacity-100"
          style={{
            left: 23,
            right: 23,
            bottom: -6,
            fontSize: 12.5,
            lineHeight: "16px",
            color: "var(--color-faint)",
          }}
        >
          Click a row or column handle for options
        </div>
      )}

      <RowMenu spec={menuSpec} anchor={menuAnchor} onClose={closeMenu} />
    </div>
  );
}

/* ────────────── Table handle components ──────────────
   Split out so we can attach local hover state (for the grip glyph)
   without re-rendering every handle whenever a sibling row/column is
   hovered. Both handles share a 16px hit target; the visible pill is
   6px thick at rest/hover and 8px while selected. All three sit 7px
   from the table (paddingLeft/Top/Right/Bottom 23 − 16 hit = 7). */

const HANDLE_TRANSITION =
  "background 90ms ease, height 90ms ease, width 90ms ease";

function ColumnHandle({
  ci,
  active,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  ci: number;
  active: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>, index: number) => void;
  onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove?: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp?: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel?: (e: React.PointerEvent<HTMLElement>) => void;
}) {
  const [hover, setHover] = useState(false);
  const bg = active
    ? "var(--color-blue)"
    : hover
      ? "var(--color-rule)"
      : "var(--color-line)";
  const thickness = active ? 8 : 6;
  return (
    <button
      type="button"
      data-table-handle=""
      aria-label={`Column ${ci + 1} actions`}
      title="Column actions"
      onClick={(e) => onClick(e, ci)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative"
      style={{
        flex: 1,
        height: 16,
        background: "transparent",
        cursor: "pointer",
        touchAction: "none",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 3,
          right: 3,
          bottom: 0,
          height: thickness,
          borderRadius: 999,
          background: bg,
          transition: HANDLE_TRANSITION,
        }}
      />
      {hover && !active && (
        <svg
          aria-hidden
          width={12}
          height={thickness}
          style={{
            position: "absolute",
            left: "50%",
            bottom: 0,
            transform: "translateX(-50%)",
            pointerEvents: "none",
          }}
        >
          <circle cx={3.5} cy={thickness / 2} r={1.35} fill="var(--color-surface)" />
          <circle cx={8.5} cy={thickness / 2} r={1.35} fill="var(--color-surface)" />
        </svg>
      )}
    </button>
  );
}

function RowHandle({
  ri,
  active,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  ri: number;
  active: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>, index: number) => void;
  onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove?: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp?: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel?: (e: React.PointerEvent<HTMLElement>) => void;
}) {
  const [hover, setHover] = useState(false);
  const bg = active
    ? "var(--color-blue)"
    : hover
      ? "var(--color-rule)"
      : "var(--color-line)";
  const thickness = active ? 8 : 6;
  return (
    <button
      type="button"
      data-table-handle=""
      aria-label={`Row ${ri + 1} actions`}
      title="Row actions"
      onClick={(e) => onClick(e, ri)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative"
      style={{
        flex: 1,
        width: 16,
        background: "transparent",
        cursor: "pointer",
        touchAction: "none",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 3,
          bottom: 3,
          right: 0,
          width: thickness,
          borderRadius: 999,
          background: bg,
          transition: HANDLE_TRANSITION,
        }}
      />
      {hover && !active && (
        <svg
          aria-hidden
          width={thickness}
          height={12}
          style={{
            position: "absolute",
            top: "50%",
            right: 0,
            transform: "translateY(-50%)",
            pointerEvents: "none",
          }}
        >
          <circle cx={thickness / 2} cy={3.5} r={1.35} fill="var(--color-surface)" />
          <circle cx={thickness / 2} cy={8.5} r={1.35} fill="var(--color-surface)" />
        </svg>
      )}
    </button>
  );
}

/* AddPill — sibling of the handle pills on the right (col) and bottom
   (row) edges. Same 16px hit target, same 6px pill, same colour treatment;
   only difference is the + glyph rendered on top in faint→muted. */
function AddPill({
  axis,
  onClick,
}: {
  axis: "row" | "col";
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const bg = hover ? "var(--color-rule)" : "var(--color-line)";
  const glyph = hover ? "var(--color-muted)" : "var(--color-faint)";
  const isCol = axis === "col";
  return (
    <button
      type="button"
      aria-label={isCol ? "Add column" : "Add row"}
      title={isCol ? "Add column" : "Add row"}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="absolute hidden group-hover/table:block"
      style={{
        cursor: "pointer",
        background: "transparent",
        ...(isCol
          ? { right: 0, top: 23, bottom: 23, width: 16 }
          : { bottom: 0, left: 23, right: 23, height: 16 }),
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          borderRadius: 999,
          background: bg,
          transition: HANDLE_TRANSITION,
          ...(isCol
            ? { top: 3, bottom: 3, left: 0, width: 14 }
            : { left: 3, right: 3, top: 0, height: 14 }),
        }}
      />
      <svg
        aria-hidden
        width={10}
        height={10}
        viewBox="0 0 10 10"
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
          color: glyph,
          transition: "color 90ms ease",
        }}
      >
        <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      </svg>
    </button>
  );
}


/* ────────────── Slash menu ────────────── */

function SlashMenu({
  x,
  y,
  yTop,
  items,
  activeIdx,
  onHover,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  yTop: number;
  items: MenuItem[];
  activeIdx: number;
  onHover: (i: number) => void;
  onPick: (t: BlockType, count?: number, lang?: string) => void;

  onClose: () => void;
}) {
  // Clamp to viewport so the panel never clips out of view.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = Math.max(12, Math.min(vw - 324 - 12, x));
  // Open below the block; near the bottom of the window, open above it so
  // the menu never covers the line being typed. Decided once on open and
  // kept while filtering, anchored by its bottom edge so it hugs the block.
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [above, setAbove] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    const h = panelRef.current?.offsetHeight ?? 420;
    setAbove(y + h + 12 > vh && yTop - h >= 12);
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const top = Math.max(12, Math.min(vh - 420 - 12, y));
  const placement: React.CSSProperties = above
    ? { left, bottom: vh - yTop, transformOrigin: "bottom left" }
    : { left, top, transformOrigin: "top left", visibility: above === null ? "hidden" : undefined };

  // Keep the highlighted row in view when moving with the arrow keys.
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    row?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

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
      ref={exitRef("pop", panelRef)}
      data-slash-menu
      className="fixed z-50 animate-popIn rounded-xl border border-line bg-surface shadow-popover"
      style={{ ...placement, width: 324, maxHeight: 420 }}
    >
      <div className="px-3 pb-1 pt-2 text-label uppercase text-faint">Blocks</div>
      <div ref={listRef} className="max-h-[340px] overflow-y-auto py-1">
        {items.length === 0 ? (
          <div className="px-3 py-2 text-meta text-muted">No matches.</div>
        ) : (
          items.map((m, i) => (
            <button
              key={m.type + (m.count != null ? `-${m.count}` : "") + (m.lang ? `-${m.lang}` : "")}
              type="button"
              data-active={i === activeIdx ? "true" : undefined}
              onMouseEnter={() => onHover(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(m.type, m.count, m.lang);
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
