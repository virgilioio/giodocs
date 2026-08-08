/**
 * The `sheet` block — rendering, SELECTION and the EDITOR (chunk 3).
 *
 * ⚠⚠ THERE IS EXACTLY ONE EDITOR ELEMENT AND IT IS NOT INSIDE A CELL.
 * A single <input> is a child of the GRID container, absolutely positioned
 * over the active cell. The obvious alternative — an <input> rendered
 * inside whichever cell is being edited — fails twice, in ways that look
 * unrelated:
 *   1. Typing loses focus after ONE character, because anything else
 *      changing in that cell unmounts and remounts the input.
 *   2. Clicking between cells ERASES VALUES, because a blur handler closed
 *      over a stale (r, c) commits an empty draft onto the cell you just
 *      clicked.
 * Both vanish here: the element is stable across every render and its
 * handlers read the editing coordinates FROM STATE, never from a closure.
 * Every future overlay (chunk 4's suggestion panel and argument chip,
 * chunk 6's fill handle) is likewise a grid-level child positioned
 * arithmetically from src/lib/sheet-select.ts — 26 / 29 / 34 are constants
 * so that maths is exact.
 *
 * Every visible value is EVALUATED on read through the chunk-1 engine.
 * Nothing is cached — a cached result is how a sheet ends up showing a
 * number that no longer follows from its inputs.
 *
 * NOT here (later chunks): autocomplete and click-to-reference (5), the
 * formatting toolbar (6), clipboard and fill handle (7), block resize (8).
 *
 * Chunk 4 added STRUCTURE — growing, shrinking, reordering and column
 * widths. Every grid mutation goes through src/lib/sheet-model.ts and
 * every structural DECISION (which control exists, whether it is enabled,
 * how an index shifts) through src/lib/sheet-structure.ts. There is
 * deliberately no second set of mutations in this file: a `cw` array out
 * of step with the columns is silent corruption.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  colName,
  evaluateCell,
  evaluateFormula,
  format,
  isSheetError,
  type CellValue,
  type SheetError,
} from "@/lib/sheet-engine";
import {
  addCol,
  addRow,
  normalizeSheet,
  setCell,
  setColWidth,
  type Cell,
  type SheetBlock,
} from "@/lib/sheet-model";
import {
  appendControl,
  applySpanOp,
  defaultCw,
  dragWidth,
  selAfterOp,
  shiftIndex,
  spanControls,
  type OpId,
  type SpanKind,
} from "@/lib/sheet-structure";
import {
  activeCall,
  canPick,
  footerText,
  insertFunction,
  insertRef,
  moveHighlight,
  panelPlacement,
  PANEL_MAX_H,
  PANEL_W,
  refFor,
  suggestFor,
  type PickSpan,
} from "@/lib/sheet-formula";
import { fillToken, inkToken } from "@/lib/sheet-palette";
import {
  ALIGNS,
  clearedCell,
  commonAlign,
  commonFormat,
  commonKey,
  FILL_SWATCHES,
  hasFormatting,
  INK_SWATCHES,
  markDecision,
  NUMBER_FORMATS,
  stepDecimals,
  type MarkKey,
  type Swatch,
} from "@/lib/sheet-toolbar";
import { IC } from "@/lib/menu-icons";
import { SHEET_GRID_ATTR } from "@/lib/is-typing";
import { useToast } from "@/lib/toast";

import {
  cellBox,
  cellsIn,
  HEAD_H,
  isSingle,
  keyWhenEditing,
  keyWhenSelected,
  rangeBox,
  rangeRef,
  rect,
  refLabel,
  rowTop,
  ROW_H,
  ROW_NUM_W,
  selAt,
  selectAll,
  selectCols,
  selectRows,
  type Sel,
} from "@/lib/sheet-select";


export const SHEET_ROW_NUM_W = ROW_NUM_W;
export const SHEET_HEAD_H = HEAD_H;
export const SHEET_ROW_H = ROW_H;

/** Past this many rows a sheet has usually stopped being a calculation. */
export const SHEET_NUDGE_ROWS = 50;

export const SHEET_NUDGE_TEXT =
  "Past 50 rows a sheet is usually a page collection wearing a grid. If each row is a thing someone owns, make them pages.";

const LINE = "1px solid var(--color-lineSoft)";

function cellAlign(cell: Cell | null, value: CellValue | SheetError): "left" | "center" | "right" {
  if (cell?.a) return cell.a;
  // Default: numbers right, everything else left — the convention every
  // financial document already uses.
  if (typeof value === "number") return "right";
  return "left";
}

/** The open editor. `sel` false means the caret sits after a seeded
 *  character (type-initiated); true means the whole value is selected so
 *  typing replaces it (Enter- or double-click-initiated). `force` bumps
 *  ONLY when code deliberately moves the caret — chunk 4's autocomplete
 *  insertion and click-to-reference. Ordinary typing must never bump it,
 *  or the focus guard stops guarding. */
type Edit = {
  r: number;
  c: number;
  draft: string;
  sel: boolean;
  force: number;
  /** "bar" edits are driven from the formula bar, which keeps its own
   *  focus — so the focus guard must not yank focus into the overlay. */
  via: "grid" | "bar";
};

/** A centred 12px plus — an svg, so no raw px font size is involved. */
function PlusGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden focusable="false">
      <path
        d="M6 2.5v7M2.5 6h7"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/** A toolbar glyph: ONE path from the shared icon library, drawn in the
 *  24-grid at the same stroke as every other menu icon. */
function Glyph({ d }: { d: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        d={d}
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/** The toolbar's control surface. mousedown preventDefault on EVERY one of
 *  them: a toolbar click must never blur an open editor, because a blur
 *  commits a half-typed draft. Same discipline as the suggestion panel. */
const TB_BTN =
  "grid h-[26px] min-w-[26px] place-items-center rounded-md px-1 text-caption hover:bg-sunken";


function rawOf(cells: (Cell | null)[][], r: number, c: number): string {
  const v = cells[r]?.[c]?.v;
  return v === undefined || v === null ? "" : String(v);
}

export function SheetBlockView({
  block,
  pageScope = true,
  locked = false,
  onChange,
  onBlur,
}: {
  block: { [k: string]: unknown };
  /** Whether this block sits at PAGE scope. Inside a column or a callout
   *  it does not, and the block-resize width (`bw`, chunk 7) is ignored —
   *  a sheet cannot bleed into page gutters it does not have. */
  pageScope?: boolean;
  locked?: boolean;
  /** ONE call per COMMITTED cell (or per range operation) — the same
   *  coalescing discipline as prose typing, so a single ⌘Z reverses a
   *  single sheet edit. Escape never calls this at all. */
  onChange?: (patch: Record<string, unknown>) => void;
  onBlur?: () => void;
}) {
  const sheet: SheetBlock = useMemo(
    () => normalizeSheet(block as Partial<SheetBlock>),
    [block],
  );
  const rows = sheet.cells.length;
  const cols = sheet.cw.length;
  const freeze = sheet.freeze === true;
  const editable = !locked && typeof onChange === "function";

  const [sel, setSel] = useState<Sel | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const editRef = useRef<Edit | null>(null);
  editRef.current = edit;
  const dragging = useRef(false);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const barRef = useRef<HTMLInputElement | null>(null);
  const toast = useToast();
  /* How the current selection was MADE. In a one-column sheet selecting
   * the column also selects every row, so the contextual group would
   * otherwise read as rows and offer the wrong floor message. */
  const [spanPref, setSpanPref] = useState<SpanKind | undefined>(undefined);
  /* A width drag in flight. Held in state so the clamp is FELT during the
   * drag; only pointerup writes, so a drag is ONE undo entry. */
  const [drag, setDrag] = useState<{ c: number; px: number } | null>(null);
  /* The focus stamp lives OUTSIDE the value that changes. Without it the
   * ref callback re-runs focus() + select() on every render, re-selecting
   * the text so the next keystroke replaces everything typed so far — the
   * same visible symptom as a remounting input, a different cause. */
  const focusStamp = useRef<string | null>(null);
  /* ── Chunk 5 state. The caret is tracked so the panel can read the WORD
   * UNDER IT rather than the tail of the draft. `pendingCaret` is how a
   * deliberate insertion places the caret: a `force` bump invalidates the
   * stamp, the ref callback re-runs, and it honours this instead of the
   * end of the value. ── */
  const [caret, setCaret] = useState(0);
  const [panelIdx, setPanelIdx] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [pick, setPick] = useState<PickSpan | null>(null);
  const [pickRect, setPickRect] = useState<{
    r0: number;
    c0: number;
    r1: number;
    c1: number;
  } | null>(null);
  const pickDrag = useRef<{ r: number; c: number } | null>(null);
  const pendingCaret = useRef<number | null>(null);
  /* Live mirrors: a pointermove during a reference drag must not read a
   * caret or a span from the previous render. */
  const caretRef = useRef(0);
  const pickRef = useRef<PickSpan | null>(null);
  const blockId = String((block as { id?: unknown }).id ?? "sheet");
  /* ── Chunk 6. Which palette strip is open, if any. It is a STRIP, not
   * twelve inline swatches: the bar is looked at constantly and the
   * palette opened rarely. ── */
  const [pal, setPal] = useState<"fg" | "bg" | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);



  const write = useCallback(
    (next: SheetBlock) => {
      onChange?.({ cells: next.cells, cw: next.cw });
    },
    [onChange],
  );

  /** Widths as the user currently SEES them — the live drag overrides the
   *  stored value so every overlay stays arithmetically aligned mid-drag. */
  const cw = useMemo(
    () => (drag ? sheet.cw.map((w, i) => (i === drag.c ? drag.px : w)) : sheet.cw),
    [drag, sheet.cw],
  );


  /* ─────────────── Autocomplete derivation (chunk 5) ───────────────
   * Read from the WORD UNDER THE CARET, so editing a formula in the
   * middle still offers the right names. The list itself comes from the
   * engine's FUNCTION_META — there is no second list in this file. */
  const sug = useMemo(
    () => (edit && !dismissed ? suggestFor(edit.draft, caret) : null),
    [edit, dismissed, caret],
  );
  const chip = useMemo(
    () => (edit && !sug ? activeCall(edit.draft, caret) : null),
    [edit, sug, caret],
  );
  const hi = sug ? Math.min(panelIdx, sug.items.length - 1) : 0;

  /** A DELIBERATE caret move — the only thing that bumps `force`. Ordinary
   *  typing must never bump it or the focus guard stops guarding. */
  const applyDraft = useCallback((draft: string, nextCaret: number) => {
    pendingCaret.current = nextCaret;
    caretRef.current = nextCaret;
    setCaret(nextCaret);
    setEdit((prev) =>
      prev ? { ...prev, draft, sel: false, force: prev.force + 1, via: "grid" } : prev,
    );
  }, []);

  const insertSuggestion = useCallback(() => {
    const live = editRef.current;
    if (!live || !sug) return;
    const next = insertFunction(live.draft, caret, sug.items[hi]);
    applyDraft(next.draft, next.caret);
    setPanelIdx(0);
    pickRef.current = null;
    setPick(null);
    setPickRect(null);
  }, [sug, hi, caret, applyDraft]);

  /* ── CLICK-TO-REFERENCE. preventDefault() on mousedown is the whole
        trick: it is what stops the editor from blurring, and a blur would
        commit the draft and close everything. A second pick REPLACES the
        first, which is why the inserted span is tracked. ── */
  const insertReference = useCallback(
    (r0: number, c0: number, r1: number, c1: number) => {
      const live = editRef.current;
      if (!live) return;
      const next = insertRef(live.draft, caretRef.current, refFor(r0, c0, r1, c1), pickRef.current);
      applyDraft(next.draft, next.caret);
      pickRef.current = next.span;
      setPick(next.span);
      setPickRect({
        r0: Math.min(r0, r1),
        c0: Math.min(c0, c1),
        r1: Math.max(r0, r1),
        c1: Math.max(c0, c1),
      });
    },
    [applyDraft],
  );

  /** Commit a raw draft onto (r, c). Coordinates are ALWAYS passed in from
   *  live state by the caller — never read from a closure. */
  const commitCell = useCallback(
    (r: number, c: number, raw: string) => {
      if (!editable) return;
      const cur = rawOf(sheet.cells, r, c);
      if (cur === raw) return;
      const trimmed = raw;
      if (trimmed === "") {
        const kept = { ...(sheet.cells[r]?.[c] ?? {}) };
        delete kept.v;
        let next = setCell(sheet, r, c, null);
        if (Object.keys(kept).length) next = setCell(next, r, c, kept);
        write(next);
        onBlur?.();
        return;
      }
      const patch: Partial<Cell> = {
        v: /^-?\d*\.?\d+$/.test(trimmed.trim()) ? Number(trimmed.trim()) : trimmed,
      };
      write(setCell(sheet, r, c, patch));
      onBlur?.();
    },
    [editable, sheet, write, onBlur],
  );

  const clearRange = useCallback(
    (s: Sel) => {
      if (!editable) return;
      let next = sheet;
      for (const { r, c } of cellsIn(rect(s))) {
        const cur = next.cells[r]?.[c];
        if (!cur || cur.v === undefined) continue;
        const kept = { ...cur };
        delete kept.v;
        // setCell MERGES, so clearing a value takes two steps: drop the
        // cell, then re-apply its formatting. Formats survive a clear.
        next = setCell(next, r, c, null);
        if (Object.keys(kept).length) next = setCell(next, r, c, kept);
      }
      if (next !== sheet) {
        write(next);
        onBlur?.();
      }
    },
    [editable, sheet, write, onBlur],
  );

  /* ─────────────── Range-wide formatting (chunk 6) ───────────────
   * EVERY toolbar control acts on the WHOLE selection and lands as ONE
   * write, so however many cells it touches it is ONE undo entry. The
   * mapper returns the cell it WANTS; the cell is cleared first because
   * setCell merges, and a merge can never remove a key. */
  const applyRange = useCallback(
    (s: Sel, map: (cur: Cell) => Cell | null) => {
      if (!editable) return;
      let next = sheet;
      for (const { r, c } of cellsIn(rect(s))) {
        const want = map({ ...(next.cells[r]?.[c] ?? {}) });
        next = setCell(next, r, c, null);
        if (want && Object.keys(want).length) next = setCell(next, r, c, want);
      }
      write(next);
      onBlur?.();
    },
    [editable, sheet, write, onBlur],
  );

  /** The cells under the current selection, for every toolbar READBACK.
   *  The indicator and the action read the same list, so they agree. */
  const selCells = useMemo(
    () => (sel ? cellsIn(rect(sel)).map(({ r, c }) => sheet.cells[r]?.[c] ?? null) : []),
    [sel, sheet.cells],
  );

  /** b / i / rt across a possibly-mixed range. The DECISION is pure —
   *  src/lib/sheet-toolbar.ts — so the toolbar button and ⌘B cannot drift
   *  into two different behaviours. */
  const toggleMark = useCallback(
    (s: Sel, mark: MarkKey) => {
      const cells = cellsIn(rect(s)).map(({ r, c }) => sheet.cells[r]?.[c] ?? null);
      const { set } = markDecision(cells, mark);
      applyRange(s, (cur) => {
        if (set) cur[mark] = true;
        else delete cur[mark];
        return cur;
      });
    },
    [sheet.cells, applyRange],
  );


  const beginEdit = useCallback(
    (r: number, c: number, seed: string | null, selectAllText: boolean) => {
      if (!editable) return;
      setDismissed(false);
      setPanelIdx(0);
      setPick(null);
      setPickRect(null);
      const initial = seed === null ? rawOf(sheet.cells, r, c) : seed;
      setCaret(initial.length);
      setEdit({
        r,
        c,
        draft: seed === null ? rawOf(sheet.cells, r, c) : seed,
        sel: selectAllText,
        force: 0,
        via: "grid",
      });
    },
    [editable, sheet.cells],
  );

  /* ─────────────────── Structure (chunk 4) ───────────────────
   * Every mutation is a MODEL call. This code decides nothing about the
   * grid's shape — sheet-structure.ts does, and sheet-model.ts enforces
   * the floors, the bounds and cw lockstep. */

  /** A contextual span op. ONE write, so ONE undo entry. */
  const runSpanOp = useCallback(
    (kind: SpanKind, i0: number, i1: number, op: OpId) => {
      if (!editable) return;
      const total = kind === "row" ? rows : cols;
      if (op === "moveBack" && i0 <= 0) return;
      if (op === "moveFwd" && i1 >= total - 1) return;
      const next = applySpanOp(sheet, kind, i0, i1, op);
      const totalAfter = kind === "row" ? next.cells.length : next.cw.length;
      // The model REFUSED — a floor or a bound. The greyed control and its
      // toast are the user-facing half of the same rule.
      if (op !== "moveBack" && op !== "moveFwd" && totalAfter === total) return;
      write(next);
      onBlur?.();

      const rowsAfter = next.cells.length;
      const colsAfter = next.cw.length;
      setSel(selAfterOp(kind, i0, i1, op, rowsAfter, colsAfter));
      setSpanPref(kind);

      /* ⚠ THE EDIT-COORDINATE SHIFT. Inserting a row above the cell being
       * edited moves that cell down. The edit's coordinates are shifted
       * explicitly AND the focus stamp is rewritten to match, so the focus
       * guard sees no change: the caret stays where it was and the draft
       * is not re-selected or lost. If the edited cell was deleted the
       * editor closes rather than pointing at a stranger's value. */
      const live = editRef.current;
      if (!live) return;
      const idx = kind === "row" ? live.r : live.c;
      const moved = shiftIndex(idx, op, i0, i1);
      if (moved === null) {
        editRef.current = null;
        setEdit(null);
        return;
      }
      if (moved === idx) return;
      const shifted: Edit = kind === "row" ? { ...live, r: moved } : { ...live, c: moved };
      focusStamp.current = `${blockId}:${shifted.r}:${shifted.c}#${shifted.force}`;
      editRef.current = shifted;
      setEdit(shifted);
    },
    [editable, sheet, rows, cols, write, onBlur, blockId],
  );

  /** Blind append at the far edge — always available, inert at the bound. */
  const append = useCallback(
    (kind: SpanKind) => {
      if (!editable) return;
      const info = appendControl(kind, rows, cols);
      if (!info.enabled) {
        toast.push(info.title);
        return;
      }
      write(kind === "row" ? addRow(sheet, rows) : addCol(sheet, cols, defaultCw(cols)));
      onBlur?.();
    },
    [editable, rows, cols, sheet, write, onBlur, toast],
  );

  /* ── Column width dragging: PIXELS AND INDEPENDENT, like a table column.
     Widening one column never narrows its neighbour — a sheet is allowed
     to be wider than the text column and scrolls. Listeners go on the
     WINDOW because the pointer leaves a shrinking column. ── */
  const startWidthDrag = useCallback(
    (c: number, e: React.PointerEvent) => {
      if (!editable) return;
      e.preventDefault();
      e.stopPropagation();
      const base = sheet.cw[c] ?? defaultCw(c);
      const startX = e.clientX;
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture?.(e.pointerId);
      const prevSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      setDrag({ c, px: base });

      const onMove = (ev: PointerEvent) => {
        setDrag({ c, px: dragWidth(base, ev.clientX - startX) });
      };
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        document.body.style.userSelect = prevSelect;
        const px = dragWidth(base, ev.clientX - startX);
        setDrag(null);
        // ONE write at the END of the drag — one undo entry, not one per
        // pointermove.
        if (px !== base) {
          write(setColWidth(sheet, c, px));
          onBlur?.();
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [editable, sheet, write, onBlur],
  );

  const resetWidth = useCallback(
    (c: number) => {
      if (!editable) return;
      const px = defaultCw(c);
      if (sheet.cw[c] === px) return;
      write(setColWidth(sheet, c, px));
      onBlur?.();
    },
    [editable, sheet, write, onBlur],
  );

  /* ── DISMISS ON A CLICK OUTSIDE THE BLOCK. Two dense rows of chrome
   * sitting permanently above a document compete with the prose around
   * it, so the toolbar exists only while a cell is selected.
   *
   * ⚠ CAPTURE PHASE. Chunk 5's click-to-reference and the suggestion panel
   * both call preventDefault on mousedown; a bubble-phase listener would
   * either miss those events or fight them. Capture runs BEFORE any of
   * that, and the [data-sheet] test means everything inside this block —
   * cells included — is skipped untouched.
   *
   * An open editor is committed EXPLICITLY here rather than relying on
   * blur: clearing the edit unmounts the input, and a draft lost that way
   * is silent data loss. */
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t && typeof t.closest === "function" && t.closest("[data-sheet]")) return;
      const live = editRef.current;
      if (live) {
        commitCell(live.r, live.c, live.draft);
        editRef.current = null;
        setEdit(null);
      }
      setSel(null);
      setPal(null);
      setPick(null);
      setPickRect(null);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [commitCell]);

  /* ── Toolbar actions. Each is ONE write over the whole selection. ── */

  const setFormat = useCallback(
    (f: CellFormat) => {
      if (!sel) return;
      applyRange(sel, (cur) => {
        cur.f = f;
        return cur;
      });
    },
    [sel, applyRange],
  );

  /** Steps `d`. It NEVER writes a display default — format() owns those, so
   *  a currency cell with no `d` still renders two decimals. */
  const bumpDecimals = useCallback(
    (dir: 1 | -1) => {
      if (!sel) return;
      const d = stepDecimals(selCells, dir);
      applyRange(sel, (cur) => {
        cur.d = d;
        return cur;
      });
    },
    [sel, selCells, applyRange],
  );

  const setAlign = useCallback(
    (a: CellAlign) => {
      if (!sel) return;
      const same = commonAlign(selCells) === a;
      applyRange(sel, (cur) => {
        if (same) delete cur.a;
        else cur.a = a;
        return cur;
      });
    },
    [sel, selCells, applyRange],
  );

  const setColourKey = useCallback(
    (which: "bg" | "fg", key: string | null) => {
      if (!sel) return;
      applyRange(sel, (cur) => {
        if (key === null) delete cur[which];
        else cur[which] = key;
        return cur;
      });
      setPal(null);
    },
    [sel, applyRange],
  );

  /** Resets f d b i a bg fg rt across the range in ONE action, leaving
   *  every `v` untouched. */
  const clearFormatting = useCallback(() => {
    if (!sel) return;
    applyRange(sel, (cur) => clearedCell(cur));
  }, [sel, applyRange]);

  const toggleFreeze = useCallback(() => {
    if (!editable) return;
    onChange?.({ freeze: !freeze });
    onBlur?.();
  }, [editable, onChange, freeze, onBlur]);


  /* ───────────────────────── Keyboard ─────────────────────────
   * §E: the page around this sheet already binds arrows, Backspace,
   * Delete, Enter, Tab, ⌘B and ⌘I. Every key the sheet handles is
   * stopPropagation'd here, so the page-level window handlers never see
   * it — Backspace with a range selected clears CELLS, it does not delete
   * the sheet block. `data-sheet-grid` + isTypingTarget() is the second
   * line of defence for any handler bound in the capture phase. */
  const onGridKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!sel) return;
      const k = {
        key: e.key,
        shift: e.shiftKey,
        meta: e.metaKey,
        ctrl: e.ctrlKey,
        alt: e.altKey,
      };
      const live = editRef.current;
      const action = live
        ? keyWhenEditing(k, live.r, live.c, rows, cols, !!sug)
        : keyWhenSelected(k, sel, rows, cols);
      if (action.kind === "pass") return;
      e.preventDefault();
      e.stopPropagation();

      switch (action.kind) {
        case "move":
          setSel(selAt(action.r, action.c));
          return;
        case "extend":
          setSel({ ...sel, fr: action.r, fc: action.c });
          return;
        case "edit":
          beginEdit(sel.fr, sel.fc, action.seed, action.sel);
          return;
        case "commit": {
          if (live) commitCell(live.r, live.c, live.draft);
          editRef.current = null;
          setEdit(null);
          setSel(selAt(action.r, action.c));
          gridRef.current?.focus();
          return;
        }
        case "discard":
          // Escape DISCARDS: the block data is left untouched. The live ref
          // is cleared BEFORE moving focus, because focusing the grid blurs
          // the input — and the blur handler would otherwise commit the very
          // draft we are throwing away.
          editRef.current = null;
          setEdit(null);
          gridRef.current?.focus();
          return;
        case "clearRange":
          clearRange(sel);
          return;
        case "bold":
          toggleMark(sel, "b");
          return;
        case "italic":
          toggleMark(sel, "i");
          return;
        case "clearSelection":
          setSel(null);
          return;
        /* ── The panel's keys. It has already won the precedence contest
              inside keyWhenEditing, so there is no branch to get wrong
              here. Escape closes the panel and STAYS in the cell; the
              next Escape reaches "discard". ── */
        case "panelPrev":
          setPanelIdx((i) => moveHighlight(i, -1, sug ? sug.items.length : 0));
          return;
        case "panelNext":
          setPanelIdx((i) => moveHighlight(i, 1, sug ? sug.items.length : 0));
          return;
        case "panelInsert":
          insertSuggestion();
          return;
        case "panelClose":
          setDismissed(true);
          return;
        default:
          return;
      }
    },
    [sel, rows, cols, beginEdit, commitCell, clearRange, toggleMark, sug, insertSuggestion],
  );

  /* ───────────────────────── Pointer ───────────────────────── */

  const pickCell = useCallback(
    (r: number, c: number, shift: boolean) => {
      const live = editRef.current;
      if (live) {
        // Committing here rather than relying on blur is what keeps a
        // click on a NEIGHBOUR from writing an empty draft into it.
        commitCell(live.r, live.c, live.draft);
        editRef.current = null;
        setEdit(null);
      }
      setSel((prev) => (shift && prev ? { ...prev, fr: r, fc: c } : selAt(r, c)));
      setSpanPref(undefined);
      gridRef.current?.focus();
    },
    [commitCell],
  );

  caretRef.current = caret;
  pickRef.current = pick;

  const rc = sel ? rect(sel) : null;
  const overlay = rc ? rangeBox(cw, rc) : null;
  const editBox = edit ? cellBox(cw, edit.r, edit.c) : null;

  /* ─────────────────── Formula bar readout ───────────────────
   * Computed through the chunk-1 engine (one summing path, no second
   * implementation) by asking it for =SUM / =AVG / =COUNT over the
   * selected range. */
  const readout = useMemo(() => {
    if (!sel || isSingle(sel)) return null;
    const ref = rangeRef(sel);
    // Evaluated from a coordinate OUTSIDE the grid: evaluating at (0,0)
    // would make a range containing A1 look like a self-reference.
    const n = evaluateFormula(`=COUNT(${ref})`, sheet.cells, rows, cols);
    if (typeof n !== "number" || n < 2) return null;
    const sum = evaluateFormula(`=SUM(${ref})`, sheet.cells, rows, cols);
    const avg = evaluateFormula(`=AVG(${ref})`, sheet.cells, rows, cols);
    return `Sum ${format(sum, "num", 2).replace(/\.00$/, "")} · Avg ${format(avg, "num", 2).replace(/\.00$/, "")} · ${n} numbers`;
  }, [sel, sheet.cells, rows, cols]);

  const barValue = edit ? edit.draft : sel ? rawOf(sheet.cells, sel.fr, sel.fc) : "";

  const width = pageScope && typeof sheet.bw === "number" ? sheet.bw : undefined;
  const template = `${ROW_NUM_W}px ${cw.map((w) => `${w}px`).join(" ")}`;

  /* The contextual group exists only for a FULL span — chunk 3's pure
   * predicate decides, not this component. */
  const ctl = editable ? spanControls(sel, rows, cols, spanPref) : null;
  const rowAppend = appendControl("row", rows, cols);
  const colAppend = appendControl("col", rows, cols);

  /* §5: a new button must not let Backspace escape to the page and delete
   * the sheet block. The root also carries data-sheet-grid, so the shared
   * typing predicate covers anything focused inside this block. */
  const guardKeys = (e: React.KeyboardEvent) => {
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <div className="group py-1" aria-label="Sheet block" {...{ [SHEET_GRID_ATTR]: "" }}>
      {/* ── Formula bar ── */}
      <div className="mb-1 flex items-center gap-2">
        <span className="min-w-14 font-mono text-caption text-muted" data-sheet-ref>
          {sel ? refLabel(sel) : "—"}
        </span>
        <span className="font-mono text-caption italic text-faint" aria-hidden>
          fx
        </span>
        <input
          ref={barRef}
          aria-label="Formula bar"
          data-sheet-bar
          className="h-7 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 font-mono text-meta text-body outline-none focus:border-accent"
          value={barValue}
          disabled={!sel || !editable}
          onChange={(e) => {
            if (!sel) return;
            setEdit({ r: sel.fr, c: sel.fc, draft: e.target.value, sel: false, force: 0, via: "bar" });
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            const live = editRef.current;
            if (e.key === "Enter" && live) {
              e.preventDefault();
              commitCell(live.r, live.c, live.draft);
              editRef.current = null;
              setEdit(null);
              gridRef.current?.focus();
            } else if (e.key === "Escape") {
              e.preventDefault();
              editRef.current = null;
              setEdit(null);
              gridRef.current?.focus();
            }
          }}
          onBlur={(e) => {
            const live = editRef.current;
            if (!live || live.via !== "bar") return;
            commitCell(live.r, live.c, e.target.value);
            setEdit(null);
          }}
        />
        {readout && (
          <span className="shrink-0 font-mono text-caption text-muted" data-sheet-readout>
            {readout}
          </span>
        )}
        {/* ── Contextual row / column operations. They live BESIDE the
              formula bar, right-aligned, so a full-span selection does not
              make the sheet grow a second bar. Nothing here vanishes at a
              boundary: it greys, explains itself in the title, and toasts
              the reason when clicked. ── */}
        {ctl && (
          <div className="flex shrink-0 items-center gap-0.5" data-sheet-span>
            <span className="mr-1 whitespace-nowrap text-caption text-muted" data-sheet-span-label>
              {ctl.label}
            </span>
            {ctl.ops.map((op) => (
              <button
                key={op.id}
                type="button"
                title={op.title}
                data-sheet-op={op.id}
                aria-disabled={!op.enabled}
                onKeyDown={guardKeys}
                onClick={() => {
                  if (!op.enabled) {
                    toast.push(op.toast ?? op.title);
                    return;
                  }
                  runSpanOp(ctl.kind, ctl.i0, ctl.i1, op.id);
                }}
                className={
                  "h-[26px] rounded-md px-2 text-caption hover:bg-sunken " +
                  (op.danger ? "text-danger" : "text-secondary") +
                  (op.enabled ? "" : " opacity-50")
                }
              >
                {op.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-stretch gap-1">
        <div className="flex min-w-0 flex-col gap-1">
          <div
            className="overflow-auto rounded-lg border border-line bg-surface"
            style={{ width, maxWidth: "100%", maxHeight: 520 }}
          >
            <div

          role="table"
          ref={gridRef}
          tabIndex={0}
          {...{ [SHEET_GRID_ATTR]: "" }}
          className="relative grid text-meta text-body outline-none"
          style={{ gridTemplateColumns: template, width: "max-content" }}
          onKeyDown={onGridKeyDown}
          onPointerUp={() => {
            dragging.current = false;
            pickDrag.current = null;
          }}
        >
          {/* ── Corner: selects everything ── */}
          <div
            className="bg-rail"
            aria-label="Select all cells"
            onPointerDown={() => setSel(selectAll(rows, cols))}
            style={{
              position: "sticky",
              top: 0,
              left: 0,
              zIndex: 3,
              height: HEAD_H,
              borderRight: LINE,
              borderBottom: LINE,
              cursor: "pointer",
            }}
          />
          {/* ── Column letters: select the whole column ── */}
          {cw.map((_, c) => (
            <div
              key={`h${c}`}
              role="columnheader"
              className={
                "grid place-items-center text-caption " +
                (rc && rc.c0 <= c && c <= rc.c1 ? "bg-accentTint text-accentInk" : "bg-rail text-muted")
              }
              onPointerDown={(e) => {
                if (e.shiftKey && sel) setSel({ ...sel, fr: rows - 1, fc: c });
                else setSel(selectCols(c, c, rows));
                setSpanPref("col");
                gridRef.current?.focus();
              }}
              style={{
                position: "sticky",
                top: 0,
                zIndex: 2,
                height: HEAD_H,
                borderRight: LINE,
                borderBottom: LINE,
                cursor: "pointer",
              }}
            >
              {colName(c)}
              {/* ── Width divider: a 6px hit zone on the RIGHT EDGE. The
                    clamp is applied DURING the drag so the limit is felt
                    rather than snapping back, and ONE write lands on
                    pointerup — one undo entry per drag. ── */}
              {editable && (
                <div
                  data-sheet-divider={c}
                  aria-hidden
                  onPointerDown={(e) => startWidthDrag(c, e)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    resetWidth(c);
                  }}
                  className="group/div absolute top-0 flex h-full justify-end"
                  style={{ right: -3, width: 6, cursor: "col-resize", zIndex: 4 }}
                >
                  <div
                    className={
                      "h-full w-px " +
                      (drag?.c === c ? "bg-blue" : "bg-transparent group-hover/div:bg-rule")
                    }
                  />
                </div>
              )}
            </div>
          ))}

          {/* ── Rows ── */}
          {sheet.cells.map((row, r) => {
            // With `freeze`, the first DATA row pins directly beneath the
            // column letters — otherwise a viewport is useless.
            const pinRow = freeze && r === 0;
            return (
              <div key={`r${r}`} role="row" className="col-span-full grid" style={{ gridTemplateColumns: template, ...(pinRow ? { position: "sticky", top: HEAD_H, zIndex: 2 } : null) }}>
                <div
                  role="rowheader"
                  className={
                    "grid place-items-center text-caption " +
                    (rc && rc.r0 <= r && r <= rc.r1 ? "bg-accentTint text-accentInk" : "bg-rail text-muted")
                  }
                  onPointerDown={(e) => {
                    if (e.shiftKey && sel) setSel({ ...sel, fr: r, fc: cols - 1 });
                    else setSel(selectRows(r, r, cols));
                    setSpanPref("row");
                    gridRef.current?.focus();
                  }}
                  style={{
                    position: "sticky",
                    left: 0,
                    zIndex: 1,
                    height: ROW_H,
                    borderRight: LINE,
                    borderBottom: LINE,
                    cursor: "pointer",
                  }}
                >
                  {r + 1}
                </div>
                {row.map((cell, c) => {
                  const value = evaluateCell(sheet.cells, r, c);
                  const shown = format(value, cell?.f ?? "text", cell?.d);
                  const err = isSheetError(value);
                  const bg = fillToken(cell?.bg);
                  const fg = err ? "var(--color-danger)" : inkToken(cell?.fg);
                  // The cell under the editor renders EMPTY text, so the
                  // hoisted overlay never doubles up on the value.
                  const hidden = edit && edit.r === r && edit.c === c;
                  return (
                    <div
                      key={`c${c}`}
                      role="cell"
                      data-sheet-cell={`${r},${c}`}
                      className="overflow-hidden whitespace-nowrap px-1.5"
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        const live = editRef.current;
                        if (live && canPick(live.draft, caretRef.current, pickRef.current)) {
                          // ⚠ THE WHOLE TRICK: without this the editor
                          // blurs, the draft commits, and the formula is
                          // gone before the reference lands.
                          e.preventDefault();
                          pickDrag.current = { r, c };
                          insertReference(r, c, r, c);
                          return;
                        }
                        // Anywhere else a click still means "leave this
                        // cell": commit and move.
                        dragging.current = true;
                        pickCell(r, c, e.shiftKey);
                      }}
                      onPointerMove={(e) => {
                        const anchor = pickDrag.current;
                        if (anchor) {
                          e.preventDefault();
                          insertReference(anchor.r, anchor.c, r, c);
                          return;
                        }
                        if (!dragging.current) return;
                        setSel((prev) => (prev ? { ...prev, fr: r, fc: c } : selAt(r, c)));
                      }}
                      onDoubleClick={() => beginEdit(r, c, null, true)}
                      style={{
                        height: ROW_H,
                        lineHeight: `${ROW_H}px`,
                        borderRight: LINE,
                        borderBottom: LINE,
                        // A rule above a figure is how a total row has been
                        // read in every printed financial document — a real
                        // border, never a background trick.
                        borderTop: cell?.rt ? "2px solid var(--color-body)" : undefined,
                        background: bg,
                        color: fg,
                        fontWeight: cell?.b ? 700 : undefined,
                        fontStyle: cell?.i ? "italic" : undefined,
                        textAlign: cellAlign(cell, value),
                        textOverflow: "ellipsis",
                        cursor: "cell",
                      }}
                      title={shown || undefined}
                    >
                      {hidden ? "" : shown}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* ── ONE selection overlay for the whole rectangle. Per-cell
                borders would fight the gridlines and the rule-above. ── */}
          {overlay && (
            <div
              aria-hidden
              data-sheet-selection
              style={{
                position: "absolute",
                left: overlay.left,
                top: overlay.top,
                width: overlay.width,
                height: overlay.height,
                border: "2px solid var(--color-accent)",
                borderRadius: 2,
                background: rc && (rc.r0 !== rc.r1 || rc.c0 !== rc.c1)
                  ? "color-mix(in srgb, var(--color-accent) 10%, transparent)"
                  : "transparent",
                pointerEvents: "none",
                zIndex: 6,
              }}
            />
          )}

          {/* ── THE REFERENCE HALO. Without it the pick is blind. A
                grid-level overlay positioned with rangeBox — never a
                border on a cell. ── */}
          {pickRect && edit && (
            <div
              aria-hidden
              data-sheet-halo
              style={{
                position: "absolute",
                ...(() => {
                  const b = rangeBox(cw, pickRect);
                  return { left: b.left, top: b.top, width: b.width, height: b.height };
                })(),
                border: "1px dashed var(--color-blue)",
                borderRadius: 2,
                pointerEvents: "none",
                zIndex: 7,
              }}
            />
          )}

          {/* ── THE ARGUMENT CHIP. Once the caret is inside a call the
                question is "what goes here", not "which function". ── */}
          {chip && edit && (
            <div
              data-sheet-chip
              className="pointer-events-none rounded-md bg-btn px-[7px] py-[3px] font-mono text-caption text-btnFg"
              style={{
                position: "absolute",
                left: cellBox(cw, edit.r, edit.c).left,
                top: rowTop(edit.r) + ROW_H + 3,
                zIndex: 9,
                whiteSpace: "nowrap",
              }}
            >
              {chip.sig}
            </div>
          )}

          {/* ── THE SUGGESTION PANEL. A grid-level child: rendered inside
                the active cell it would remount the editor, and typing
                would lose focus after one character. It RENDERS FROM THE
                ENGINE'S TABLE (FUNCTION_META) — there is no second list.
                Each row carries flex-none because a capped flex column
                squashes its children instead of scrolling. ── */}
          {sug && edit && (
            <div
              data-sheet-panel
              className="flex flex-col rounded-[10px] border border-line bg-surface shadow-popover"
              style={{
                position: "absolute",
                left: cellBox(cw, edit.r, edit.c).left,
                ...(panelPlacement(edit.r, rows) === "above"
                  ? { top: rowTop(edit.r) - PANEL_MAX_H - 4 }
                  : { top: rowTop(edit.r) + ROW_H + 2 }),
                width: PANEL_W,
                maxHeight: PANEL_MAX_H,
                zIndex: 10,
                overflow: "hidden",
              }}
              onPointerDown={(e) => e.preventDefault()}
            >
              <div data-sheet-panel-list className="min-h-0 flex-1 overflow-y-auto py-1">
                {sug.items.map((f, i) => (
                  <div
                    key={f.name}
                    data-sheet-suggestion={f.name}
                    aria-selected={i === hi}
                    className={
                      "flex flex-none items-baseline gap-1.5 overflow-hidden whitespace-nowrap px-2.5 py-1 " +
                      (i === hi ? "bg-sunken" : "")
                    }
                    style={{ flexGrow: 0, flexShrink: 0, flexBasis: "auto" }}
                    onMouseDown={(e) => {
                      // A click that blurs the editor commits the draft and
                      // closes everything — so it must not steal focus.
                      e.preventDefault();
                      setPanelIdx(i);
                    }}
                    onClick={() => {
                      setPanelIdx(i);
                      insertSuggestion();
                    }}
                  >
                    <span className="font-mono text-meta text-body">{f.name}</span>
                    <span className="font-mono text-meta text-whisper">{f.args}</span>
                    <span className="overflow-hidden text-ellipsis text-caption text-faint">
                      {f.desc}
                    </span>
                  </div>
                ))}
              </div>
              <div
                data-sheet-panel-footer
                className="flex-none border-t border-lineSoft px-2.5 py-1 text-caption text-faint"
              >
                {footerText(sug.items.length, sug.total)}
              </div>
            </div>
          )}

          {/* ── THE ONE EDITOR ELEMENT. A grid-level child, absolutely
                positioned over the active cell. Its handlers read the
                coordinates from STATE. ── */}
          {editBox && (
            <input
              ref={(el) => {
                inputRef.current = el;
                const live = editRef.current;
                if (!el || !live) return;
                const stamp = `${blockId}:${live.r}:${live.c}#${live.force}`;
                if (focusStamp.current === stamp) return;
                const resuming = focusStamp.current?.startsWith(
                  `${blockId}:${live.r}:${live.c}#`,
                );
                focusStamp.current = stamp;
                if (live.via === "bar") return;
                el.focus();
                // A deliberate insertion (autocomplete, a picked reference)
                // says exactly where the caret belongs.
                const want = pendingCaret.current;
                pendingCaret.current = null;
                if (want !== null) {
                  el.setSelectionRange(want, want);
                  return;
                }
                const caret = el.value.length;
                if (resuming || live.sel === false) el.setSelectionRange(caret, caret);
                else el.select();
              }}
              aria-label={`Edit ${refLabel(selAt(edit!.r, edit!.c))}`}
              data-sheet-editor
              className="bg-surface px-1.5 font-mono text-meta text-body outline-none"
              value={edit!.draft}
              onChange={(e) => {
                // Typing ENDS a reference pick, so the next click inserts
                // fresh rather than replacing what was just typed over.
                const pos = e.target.selectionStart ?? e.target.value.length;
                caretRef.current = pos;
                setCaret(pos);
                pickRef.current = null;
                setPick(null);
                setPickRect(null);
                setDismissed(false);
                setPanelIdx(0);
                setEdit((prev) =>
                  prev ? { ...prev, draft: e.target.value, via: "grid" } : prev,
                );
              }}
              onSelect={(e) => {
                const el = e.currentTarget;
                const pos = el.selectionStart ?? el.value.length;
                caretRef.current = pos;
                setCaret(pos);
              }}
              onKeyDown={onGridKeyDown}
              onBlur={(e) => {
                // COORDINATES FROM STATE, NEVER FROM A CLOSURE.
                const live = editRef.current;
                if (!live) return;
                commitCell(live.r, live.c, e.target.value);
                setEdit(null);
              }}
              style={{
                position: "absolute",
                left: editBox.left,
                top: editBox.top,
                width: editBox.width,
                height: editBox.height,
                border: "2px solid var(--color-accent)",
                borderRadius: 2,
                zIndex: 8,
              }}
            />
          )}
            </div>
          </div>

          {/* ── Blind append, BOTTOM edge: adds a row at the end. Outside
                the grid so it never fights a cell. ── */}
          {editable && (
            <button
              type="button"
              title={rowAppend.title}
              data-sheet-add="row"
              aria-disabled={!rowAppend.enabled}
              onKeyDown={guardKeys}
              onClick={() => append("row")}
              className={
                "h-[22px] grid place-items-center rounded opacity-0 transition-opacity group-hover:opacity-100 " +
                (rowAppend.enabled
                  ? "text-faint hover:bg-sunken hover:text-muted"
                  : "text-whisper hover:bg-sunken")
              }
              style={{ width: width ?? "100%", maxWidth: "100%" }}
            >
              <PlusGlyph />
            </button>
          )}
        </div>

        {/* ── Blind append, RIGHT edge: adds a column at the end. ── */}
        {editable && (
          <button
            type="button"
            title={colAppend.title}
            data-sheet-add="col"
            aria-disabled={!colAppend.enabled}
            onKeyDown={guardKeys}
            onClick={() => append("col")}
            className={
              "w-[22px] shrink-0 grid place-items-center rounded opacity-0 transition-opacity group-hover:opacity-100 " +
              (colAppend.enabled
                ? "text-faint hover:bg-sunken hover:text-muted"
                : "text-whisper hover:bg-sunken")
            }
          >
            <PlusGlyph />
          </button>
        )}
      </div>
      {rows > SHEET_NUDGE_ROWS && (
        <p className="mt-1.5 text-caption text-amberInk">{SHEET_NUDGE_TEXT}</p>
      )}
      <span className="sr-only">{`${rows} rows, ${cols} columns`}</span>

    </div>
  );
}

export default SheetBlockView;
