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
 * NOT here (later chunks): autocomplete and click-to-reference (4), the
 * formatting toolbar (5), row/column operations (5), clipboard and fill
 * handle (6), block resize (7).
 */

import { useCallback, useMemo, useRef, useState } from "react";
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
  normalizeSheet,
  setCell,
  type Cell,
  type SheetBlock,
} from "@/lib/sheet-model";
import { fillToken, inkToken } from "@/lib/sheet-palette";
import { SHEET_GRID_ATTR } from "@/lib/is-typing";
import {
  cellBox,
  cellsIn,
  HEAD_H,
  inRect,
  isSingle,
  keyWhenEditing,
  keyWhenSelected,
  rangeBox,
  rangeRef,
  rect,
  refLabel,
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
  /* The focus stamp lives OUTSIDE the value that changes. Without it the
   * ref callback re-runs focus() + select() on every render, re-selecting
   * the text so the next keystroke replaces everything typed so far — the
   * same visible symptom as a remounting input, a different cause. */
  const focusStamp = useRef<string | null>(null);
  const blockId = String((block as { id?: unknown }).id ?? "sheet");

  const write = useCallback(
    (next: SheetBlock) => {
      onChange?.({ cells: next.cells, cw: next.cw });
    },
    [onChange],
  );

  /** Commit a raw draft onto (r, c). Coordinates are ALWAYS passed in from
   *  live state by the caller — never read from a closure. */
  const commitCell = useCallback(
    (r: number, c: number, raw: string) => {
      if (!editable) return;
      const cur = rawOf(sheet.cells, r, c);
      if (cur === raw) return;
      const trimmed = raw;
      const patch: Partial<Cell> | null =
        trimmed === ""
          ? { ...(sheet.cells[r]?.[c] ?? {}), v: undefined }
          : { v: /^-?\d*\.?\d+$/.test(trimmed.trim()) ? Number(trimmed.trim()) : trimmed };
      write(setCell(sheet, r, c, patch as Partial<Cell>));
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
        next = setCell(next, r, c, kept);
      }
      if (next !== sheet) {
        write(next);
        onBlur?.();
      }
    },
    [editable, sheet, write, onBlur],
  );

  const toggleMark = useCallback(
    (s: Sel, mark: "b" | "i") => {
      if (!editable) return;
      const cells = cellsIn(rect(s));
      // Mixed selection turns ON — the behaviour every editor has.
      const allOn = cells.every(({ r, c }) => sheet.cells[r]?.[c]?.[mark] === true);
      let next = sheet;
      for (const { r, c } of cells) {
        const cur = next.cells[r]?.[c] ?? {};
        const kept: Partial<Cell> = { ...cur };
        if (allOn) delete kept[mark];
        else kept[mark] = true;
        next = setCell(next, r, c, kept);
      }
      write(next);
      onBlur?.();
    },
    [editable, sheet, write, onBlur],
  );

  const beginEdit = useCallback(
    (r: number, c: number, seed: string | null, selectAllText: boolean) => {
      if (!editable) return;
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
      const info = { key: e.key, shift: e.shiftKey, meta: e.metaKey, ctrl: e.ctrlKey, altKey: e.altKey } as const;
      const k = { key: info.key, shift: info.shift, meta: info.meta, ctrl: info.ctrl, alt: e.altKey };
      const live = editRef.current;
      const action = live
        ? keyWhenEditing(k, live.r, live.c, rows, cols)
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
          setEdit(null);
          setSel(selAt(action.r, action.c));
          gridRef.current?.focus();
          return;
        }
        case "discard":
          // Escape DISCARDS: the block data is left untouched.
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
        default:
          return;
      }
    },
    [sel, rows, cols, beginEdit, commitCell, clearRange, toggleMark],
  );

  /* ───────────────────────── Pointer ───────────────────────── */

  const pickCell = useCallback(
    (r: number, c: number, shift: boolean) => {
      const live = editRef.current;
      if (live) {
        // Committing here rather than relying on blur is what keeps a
        // click on a NEIGHBOUR from writing an empty draft into it.
        commitCell(live.r, live.c, live.draft);
        setEdit(null);
      }
      setSel((prev) => (shift && prev ? { ...prev, fr: r, fc: c } : selAt(r, c)));
      gridRef.current?.focus();
    },
    [commitCell],
  );

  const rc = sel ? rect(sel) : null;
  const overlay = rc ? rangeBox(sheet.cw, rc) : null;
  const editBox = edit ? cellBox(sheet.cw, edit.r, edit.c) : null;

  /* ─────────────────── Formula bar readout ───────────────────
   * Computed through the chunk-1 engine (one summing path, no second
   * implementation) by asking it for =SUM / =AVG / =COUNT over the
   * selected range. */
  const readout = useMemo(() => {
    if (!sel || isSingle(sel)) return null;
    const ref = rangeRef(sel);
    const n = evaluateFormula(`=COUNT(${ref})`, sheet.cells);
    if (typeof n !== "number" || n < 2) return null;
    const sum = evaluateFormula(`=SUM(${ref})`, sheet.cells);
    const avg = evaluateFormula(`=AVG(${ref})`, sheet.cells);
    return `Sum ${format(sum, "num", 2).replace(/\.00$/, "")} · Avg ${format(avg, "num", 2).replace(/\.00$/, "")} · ${n} numbers`;
  }, [sel, sheet.cells]);

  const barValue = edit ? edit.draft : sel ? rawOf(sheet.cells, sel.fr, sel.fc) : "";

  const width = pageScope && typeof sheet.bw === "number" ? sheet.bw : undefined;
  const template = `${ROW_NUM_W}px ${sheet.cw.map((w) => `${w}px`).join(" ")}`;

  return (
    <div className="py-1" aria-label="Sheet block">
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
              setEdit(null);
              gridRef.current?.focus();
            } else if (e.key === "Escape") {
              e.preventDefault();
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
      </div>

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
          {sheet.cw.map((_, c) => (
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
                        dragging.current = true;
                        pickCell(r, c, e.shiftKey);
                      }}
                      onPointerEnter={() => {
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
                const caret = el.value.length;
                if (resuming || live.sel === false) el.setSelectionRange(caret, caret);
                else el.select();
              }}
              aria-label={`Edit ${refLabel(selAt(edit!.r, edit!.c))}`}
              data-sheet-editor
              className="bg-surface px-1.5 font-mono text-meta text-body outline-none"
              value={edit!.draft}
              onChange={(e) =>
                setEdit((prev) => (prev ? { ...prev, draft: e.target.value, via: "grid" } : prev))
              }
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
      {rows > SHEET_NUDGE_ROWS && (
        <p className="mt-1.5 text-caption text-amberInk">{SHEET_NUDGE_TEXT}</p>
      )}
      <span className="sr-only">{`${rows} rows, ${cols} columns`}</span>
      {rc && inRect(rc, 0, 0) ? null : null}
    </div>
  );
}

export default SheetBlockView;
