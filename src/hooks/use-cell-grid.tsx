import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type React from "react";
import { cellWritable, sameKind } from "@/lib/cell-values";
import { isTypingTarget } from "@/lib/is-typing";
import { parseTSV, tsvEscape } from "@/lib/sheet-clip";

export type CellPos = { row: string; col: string };
/** One cell to write: a value as it is, or text to read into the column. */
export type CellWrite = { row: string; col: string; value?: unknown; text?: string };
export type CellVerb = "Pasted" | "Filled" | "Cleared";

type Sel = { a: CellPos; f: CellPos };
type Box = { left: number; top: number; width: number; height: number };

/* What was last copied from a table: the text that went to the clipboard
 * and the values behind it, so a paste inside Gio Docs keeps a person, a
 * status or a date exactly (as the sheet's clip does). A cut empties its
 * cells when the paste lands. */
let clip: {
  tsv: string;
  cells: Array<Array<{ col: string; type?: string; raw: unknown }>>;
  cut: { grid: symbol; cells: CellPos[] } | null;
} | null = null;

/** Rows a paste may add below the last one. */
export const PASTE_ROW_LIMIT = 500;

const TEXT_TYPES = new Set(["text", "number", "url", "email", "phone"]);
const norm = (s: string) => s.replace(/\r\n?/g, "\n").replace(/\n+$/, "");

/**
 * A table's cells, like a spreadsheet's (Notion's, 2026-10-30).
 *
 * C2, moving: Esc while editing a cell (or a click in its empty space)
 * leaves it selected; arrows and Tab move; Enter edits (⌘Enter opens the
 * row); typing a letter in a text, number or title cell starts editing with
 * it; Delete empties; Esc lets go.
 * C3, ranges: ⇧ + arrows, ⇧-click or a drag across cells select a block;
 * ⌘D fills down, ⌘R fills right, and the handle on the block's corner drags
 * its values up or down (copied, never counted on).
 * C4, clipboard: ⌘C copies the block as text a spreadsheet takes, ⌘X cuts
 * (emptied once pasted), ⌘V pastes a block from anywhere, adding rows when
 * it runs past the last one.
 *
 * Keys arrive in one hidden field (the sink) that holds focus while cells
 * are selected, so copy and paste reach it like any field. Writing (reading
 * text into each column, Undo) is the table's: `write`.
 */
export function useCellGrid(o: {
  gridRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  /** Rows in the order shown. */
  rowOrder: () => string[];
  /** Columns in the order shown, the title first. */
  cols: string[];
  /** Changes when rows move (a sort after a write), so the outline follows
   *  its cells. */
  layoutKey?: string;
  typeOf: (col: string) => string | undefined;
  rawOf: (row: string, col: string) => unknown;
  textOf: (row: string, col: string) => string;
  write: (writes: CellWrite[], verb: CellVerb, createdRows?: string[]) => void;
  /** Add rows at the end for a paste that runs past the last one. */
  createRows?: (n: number) => Promise<string[]>;
  /** Cells were selected: rows let go. */
  onActivate: () => void;
  openRow: (row: string) => void;
  /** A note for the person (rows a paste couldn't add). */
  notify: (message: string) => void;
}) {
  const [sel, setSelState] = useState<Sel | null>(null);
  const selRef = useRef<Sel | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [fillTo, setFillTo] = useState<number | null>(null);
  const sinkRef = useRef<HTMLTextAreaElement | null>(null);
  const lastCellRef = useRef<CellPos | null>(null);
  const gridId = useRef(Symbol("grid")).current;
  const live = useRef(o);
  live.current = o;

  const setSel = useCallback((s: Sel | null) => {
    selRef.current = s;
    setSelState(s);
  }, []);
  const clear = useCallback(() => setSel(null), [setSel]);

  const cellEl = (p: CellPos) =>
    live.current.gridRef.current?.querySelector<HTMLElement>(
      `[data-page-id="${CSS.escape(p.row)}"][data-prop="${CSS.escape(p.col)}"]`,
    ) ?? null;
  const at = (p: CellPos) => ({
    r: live.current.rowOrder().indexOf(p.row),
    c: live.current.cols.indexOf(p.col),
  });
  const rangeOf = (s: Sel) => {
    const A = at(s.a);
    const F = at(s.f);
    const rows = live.current.rowOrder();
    const cols = live.current.cols;
    const r0 = Math.min(A.r, F.r);
    const r1 = Math.max(A.r, F.r);
    const c0 = Math.min(A.c, F.c);
    const c1 = Math.max(A.c, F.c);
    return {
      r0,
      r1,
      c0,
      c1,
      rows: rows.slice(r0, r1 + 1),
      cols: cols.slice(c0, c1 + 1),
      allRows: rows,
    };
  };

  const focusSink = () => sinkRef.current?.focus({ preventScroll: true });
  const select = useCallback(
    (a: CellPos, f: CellPos = a, scroll = true) => {
      if (at(a).r < 0 || at(a).c < 0 || at(f).r < 0 || at(f).c < 0) return;
      setSel({ a, f });
      live.current.onActivate();
      focusSink();
      if (scroll) cellEl(f)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    },
    [setSel],
  );

  /* The outline: measured from the corner cells, drawn over the grid. */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const g = o.gridRef.current;
    if (!g || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setTick((n) => n + 1));
    ro.observe(g);
    return () => ro.disconnect();
  }, [o.gridRef]);
  useLayoutEffect(() => {
    const g = o.gridRef.current;
    if (!sel || !g) {
      setBox(null);
      return;
    }
    const r = rangeOf(sel);
    if (r.r0 < 0 || r.c0 < 0) {
      setSel(null);
      return;
    }
    const lastRow = fillTo !== null ? Math.max(r.r1, fillTo) : r.r1;
    const firstRow = fillTo !== null ? Math.min(r.r0, fillTo) : r.r0;
    const corners = [
      cellEl({ row: r.allRows[firstRow], col: r.cols[0] }),
      cellEl({ row: r.allRows[lastRow], col: r.cols[r.cols.length - 1] }),
    ];
    if (!corners[0] || !corners[1]) {
      setBox(null);
      return;
    }
    const gr = g.getBoundingClientRect();
    const a = corners[0].getBoundingClientRect();
    const b = corners[1].getBoundingClientRect();
    setBox({
      left: Math.min(a.left, b.left) - gr.left,
      top: Math.min(a.top, b.top) - gr.top,
      width: Math.max(a.right, b.right) - Math.min(a.left, b.left),
      height: Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top),
    });
    // cellEl/rangeOf read refs; the rows and columns come in through tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, fillTo, tick, o.cols, o.layoutKey]);

  /* Writing. */
  const writableIn = (cols: string[]) =>
    cols.filter((c) => cellWritable(c, live.current.typeOf(c)));

  const clearCells = (s: Sel) => {
    const r = rangeOf(s);
    const writes: CellWrite[] = [];
    for (const row of r.rows)
      for (const col of writableIn(r.cols))
        writes.push({
          row,
          col,
          value: col === "title" ? "" : live.current.typeOf(col) === "checkbox" ? false : null,
        });
    if (writes.length) live.current.write(writes, "Cleared");
  };

  const fillDown = (s: Sel) => {
    const r = rangeOf(s);
    const src = r.r0 === r.r1 ? r.allRows[r.r0 - 1] : r.rows[0];
    if (!src) return;
    const targets = r.r0 === r.r1 ? r.rows : r.rows.slice(1);
    const writes: CellWrite[] = [];
    for (const col of writableIn(r.cols))
      for (const row of targets) writes.push({ row, col, value: live.current.rawOf(src, col) });
    if (writes.length) live.current.write(writes, "Filled");
  };

  const fillRight = (s: Sel) => {
    const r = rangeOf(s);
    const cols = live.current.cols;
    const srcCol = r.c0 === r.c1 ? cols[r.c0 - 1] : r.cols[0];
    if (!srcCol) return;
    const targets = writableIn(r.c0 === r.c1 ? r.cols : r.cols.slice(1));
    const t = live.current.typeOf;
    const writes: CellWrite[] = [];
    for (const row of r.rows)
      for (const col of targets)
        writes.push(
          sameKind({ key: srcCol, type: t(srcCol) }, { key: col, type: t(col) })
            ? { row, col, value: live.current.rawOf(row, srcCol) }
            : { row, col, text: live.current.textOf(row, srcCol) },
        );
    if (writes.length) live.current.write(writes, "Filled");
  };

  /** The handle dragged to row index `to`: the block's rows repeat into
   *  the new ones, below or above. */
  const fillTo_ = (s: Sel, to: number) => {
    const r = rangeOf(s);
    const h = r.rows.length;
    const writes: CellWrite[] = [];
    const cols = writableIn(r.cols);
    if (to > r.r1) {
      for (let i = r.r1 + 1; i <= to; i++) {
        const src = r.rows[(i - r.r1 - 1) % h];
        for (const col of cols)
          writes.push({ row: r.allRows[i], col, value: live.current.rawOf(src, col) });
      }
    } else if (to < r.r0) {
      for (let i = r.r0 - 1; i >= to; i--) {
        const src = r.rows[h - 1 - ((r.r0 - 1 - i) % h)];
        for (const col of cols)
          writes.push({ row: r.allRows[i], col, value: live.current.rawOf(src, col) });
      }
    } else return;
    if (writes.length) live.current.write(writes, "Filled");
    const a = { row: r.allRows[Math.min(r.r0, to)], col: r.cols[0] };
    const f = { row: r.allRows[Math.max(r.r1, to)], col: r.cols[r.cols.length - 1] };
    select(a, f, false);
  };

  /* Editing a cell: what a click on it does. */
  const edit = (p: CellPos, seed?: string) => {
    const el = cellEl(p);
    if (!el) return;
    lastCellRef.current = p;
    setSel(null);
    const trigger =
      p.col === "title"
        ? el.querySelector<HTMLElement>('button[aria-label="Rename"]')
        : el.querySelector<HTMLElement>('button, [role="button"], [role="checkbox"], input');
    trigger?.click();
    if (seed === undefined) return;
    // The field the click opened takes the letter that was typed.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const f = document.activeElement;
        if (!(f instanceof HTMLInputElement || f instanceof HTMLTextAreaElement)) return;
        if (!el.contains(f)) return;
        const proto =
          f instanceof HTMLInputElement
            ? HTMLInputElement.prototype
            : HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(f, seed);
        f.dispatchEvent(new Event("input", { bubbles: true }));
      }),
    );
  };

  const move = (p: CellPos, dr: number, dc: number, wrap = false): CellPos => {
    const rows = live.current.rowOrder();
    const cols = live.current.cols;
    let { r, c } = at(p);
    c += dc;
    if (wrap && c >= cols.length) {
      c = 0;
      r += 1;
    } else if (wrap && c < 0) {
      c = cols.length - 1;
      r -= 1;
    }
    r = Math.max(0, Math.min(rows.length - 1, r + dr));
    c = Math.max(0, Math.min(cols.length - 1, c));
    return { row: rows[r], col: cols[c] };
  };

  const onSinkKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const s = selRef.current;
    if (!s) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    const done = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    const rows = live.current.rowOrder();
    const cols = live.current.cols;
    if (k.startsWith("Arrow")) {
      done();
      const dr = k === "ArrowDown" ? 1 : k === "ArrowUp" ? -1 : 0;
      const dc = k === "ArrowRight" ? 1 : k === "ArrowLeft" ? -1 : 0;
      const far = mod ? Math.max(rows.length, cols.length) : 1;
      const next = move(s.f, dr * far, dc * far);
      if (e.shiftKey) select(s.a, next);
      else select(next);
      return;
    }
    if (k === "Tab") {
      done();
      select(move(s.f, 0, e.shiftKey ? -1 : 1, true));
      return;
    }
    if (k === "Enter") {
      done();
      if (mod) live.current.openRow(s.f.row);
      else edit(s.f);
      return;
    }
    if (k === "Escape") {
      done();
      clear();
      sinkRef.current?.blur();
      return;
    }
    if (k === "Delete" || k === "Backspace") {
      done();
      clearCells(s);
      return;
    }
    if (k === " " && live.current.typeOf(s.f.col) === "checkbox") {
      done();
      const r = rangeOf(s);
      const on = !(live.current.rawOf(s.f.row, s.f.col) === true);
      live.current.write(
        r.rows.flatMap((row) =>
          r.cols
            .filter((c) => live.current.typeOf(c) === "checkbox")
            .map((col) => ({ row, col, value: on })),
        ),
        "Filled",
      );
      return;
    }
    if (mod && k.toLowerCase() === "d") {
      done();
      fillDown(s);
      return;
    }
    if (mod && k.toLowerCase() === "r") {
      done();
      fillRight(s);
      return;
    }
    if (mod && k.toLowerCase() === "a") {
      done();
      if (rows.length && cols.length)
        select(
          { row: rows[0], col: cols[0] },
          { row: rows[rows.length - 1], col: cols[cols.length - 1] },
          false,
        );
      return;
    }
    if (mod) return; // ⌘C / ⌘X / ⌘V reach the field as copy, cut and paste
    if (k.length === 1 && !e.altKey) {
      const t = live.current.typeOf(s.f.col);
      done();
      if (s.f.col === "title" || (t && TEXT_TYPES.has(t))) edit(s.f, k);
      else edit(s.f);
    }
  };

  /* Clipboard. */
  const copy = (e: React.ClipboardEvent, cut: boolean) => {
    const s = selRef.current;
    if (!s) return;
    e.preventDefault();
    e.stopPropagation();
    const r = rangeOf(s);
    const texts = r.rows.map((row) => r.cols.map((col) => live.current.textOf(row, col)));
    const tsv = texts.map((line) => line.map(tsvEscape).join("\t")).join("\n");
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `<table>${texts.map((line) => `<tr>${line.map((t) => `<td>${esc(t)}</td>`).join("")}</tr>`).join("")}</table>`;
    e.clipboardData.setData("text/plain", tsv);
    e.clipboardData.setData("text/html", html);
    clip = {
      tsv: norm(tsv),
      cells: r.rows.map((row) =>
        r.cols.map((col) => ({
          col,
          type: live.current.typeOf(col),
          raw: live.current.rawOf(row, col),
        })),
      ),
      cut: cut
        ? {
            grid: gridId,
            cells: r.rows.flatMap((row) => writableIn(r.cols).map((col) => ({ row, col }))),
          }
        : null,
    };
  };

  const paste = async (e: React.ClipboardEvent) => {
    const s = selRef.current;
    if (!s) return;
    const text = e.clipboardData.getData("text/plain");
    e.preventDefault();
    e.stopPropagation();
    if (!text) return;
    const ours = clip && clip.tsv === norm(text) ? clip : null;
    let grid = parseTSV(norm(text));
    while (grid.length > 1 && grid[grid.length - 1].every((v) => v === "")) grid.pop();
    if (!grid.length) return;
    const r = rangeOf(s);
    const cols = live.current.cols;
    const t = live.current.typeOf;
    const writes: CellWrite[] = [];
    const cellFor = (i: number, j: number) => ({
      text: grid[i]?.[j] ?? "",
      src: ours?.cells[i]?.[j],
    });
    const push = (row: string, col: string, c: ReturnType<typeof cellFor>) => {
      if (!cellWritable(col, t(col))) return;
      writes.push(
        c.src && sameKind({ key: c.src.col, type: c.src.type }, { key: col, type: t(col) })
          ? { row, col, value: c.src.raw }
          : { row, col, text: c.text },
      );
    };
    let created: string[] = [];
    let dropped = 0;
    if (grid.length === 1 && grid[0].length === 1 && (r.rows.length > 1 || r.cols.length > 1)) {
      // One value over a block fills it.
      for (const row of r.rows) for (const col of r.cols) push(row, col, cellFor(0, 0));
    } else {
      const space = r.allRows.length - r.r0;
      let need = Math.max(0, grid.length - space);
      if (need > PASTE_ROW_LIMIT) {
        dropped = need - PASTE_ROW_LIMIT;
        need = PASTE_ROW_LIMIT;
        grid = grid.slice(0, space + need);
      }
      if (need > 0) {
        if (!live.current.createRows) {
          dropped += need;
          grid = grid.slice(0, space);
        } else created = await live.current.createRows(need);
      }
      const targetRows = [...r.allRows.slice(r.r0, r.r0 + grid.length), ...created];
      grid.forEach((line, i) =>
        line.forEach((_, j) => {
          const col = cols[r.c0 + j];
          const row = targetRows[i];
          if (col && row) push(row, col, cellFor(i, j));
        }),
      );
      const lastRow = targetRows[Math.min(grid.length, targetRows.length) - 1];
      const lastCol = cols[Math.min(cols.length - 1, r.c0 + grid[0].length - 1)];
      if (lastRow && lastCol && !created.length)
        select({ row: r.rows[0], col: r.cols[0] }, { row: lastRow, col: lastCol }, false);
    }
    // A cut empties what it took, except where the paste just landed.
    if (ours?.cut && ours.cut.grid === gridId) {
      const landed = new Set(writes.map((w) => `${w.row}\u0000${w.col}`));
      for (const c of ours.cut.cells)
        if (!landed.has(`${c.row}\u0000${c.col}`))
          writes.push({
            ...c,
            value: c.col === "title" ? "" : t(c.col) === "checkbox" ? false : null,
          });
      clip = null;
    }
    if (writes.length) live.current.write(writes, "Pasted", created);
    if (dropped)
      live.current.notify(
        `${dropped} rows weren't added: a paste adds ${PASTE_ROW_LIMIT} rows at most.`,
      );
  };

  /* Pointer: ⇧-click extends, a press in a cell's empty space selects it,
     and a drag across cells selects the block. */
  useEffect(() => {
    const g = o.gridRef.current;
    if (!g || !o.enabled) return;
    const swallowClick = () => {
      const stop = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
        window.removeEventListener("click", stop, true);
      };
      window.addEventListener("click", stop, true);
      window.setTimeout(() => window.removeEventListener("click", stop, true), 400);
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerType === "touch") return;
      const t = e.target as HTMLElement;
      const cell = t.closest<HTMLElement>("[data-page-id][data-prop]");
      if (!cell || !g.contains(cell)) return;
      if (t.closest('input, textarea, [contenteditable="true"]')) return;
      const p = { row: cell.dataset.pageId!, col: cell.dataset.prop! };
      lastCellRef.current = p;
      const cur = selRef.current;
      if (e.shiftKey && cur) {
        e.preventDefault();
        select(cur.a, p, false);
        swallowClick();
        return;
      }
      if (t === cell) {
        e.preventDefault();
        select(p, p, false);
        return;
      }
      if (cur) setSel(null);
      const x0 = e.clientX;
      const y0 = e.clientY;
      let ranging = false;
      const onMove = (ev: PointerEvent) => {
        if (!ranging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        const under = document
          .elementFromPoint(ev.clientX, ev.clientY)
          ?.closest<HTMLElement>("[data-page-id][data-prop]");
        if (!under || !g.contains(under)) return;
        const q = { row: under.dataset.pageId!, col: under.dataset.prop! };
        if (!ranging && q.row === p.row && q.col === p.col) return;
        if (!ranging) {
          ranging = true;
          window.getSelection()?.removeAllRanges();
          document.body.style.userSelect = "none";
        }
        select(p, q, false);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        if (ranging) {
          document.body.style.userSelect = "";
          swallowClick();
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    };
    g.addEventListener("pointerdown", onDown);
    return () => g.removeEventListener("pointerdown", onDown);
  }, [o.gridRef, o.enabled, select, setSel]);

  /* After editing (Enter, Esc or Tab in a cell's field or its picker), the
     cell — or the next one, for Tab — is selected again, as in Notion. */
  useEffect(() => {
    if (!o.enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== "Escape" && e.key !== "Tab") return;
      const last = lastCellRef.current;
      const g = live.current.gridRef.current;
      if (!last || !g) return;
      const t = e.target as HTMLElement;
      // With cells selected the sink's own keys apply; while a cell's picker
      // is open (opened from the keys), focus stays on the sink.
      if (t === sinkRef.current && selRef.current) return;
      const inCell = (g.contains(t) && !!t.closest("[data-prop]")) || t === sinkRef.current;
      const inPicker = !!t.closest?.(".gio-menu, [data-popover-root], [data-popover-body]");
      if (!inCell && !inPicker) return;
      if (e.key === "Tab" && inCell && isTypingTarget(t)) {
        e.preventDefault();
        (t as HTMLElement).blur();
      }
      const next = e.key === "Tab" ? move(last, 0, e.shiftKey ? -1 : 1, true) : last;
      // A closing picker leaves the page a moment later (its exit fade).
      const attempt = (left: number) => {
        const ae = document.activeElement;
        if (ae && ae !== document.body && !g.contains(ae)) return;
        if (ae && ae !== sinkRef.current && isTypingTarget(ae)) return;
        if (document.querySelector(".gio-menu")) {
          if (left > 0) window.setTimeout(() => attempt(left - 1), 120);
          return;
        }
        select(next);
      };
      window.setTimeout(() => attempt(2), 0);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // move reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.enabled, select]);

  /* The handle on the block's corner. */
  const onFillDown = (e: React.PointerEvent) => {
    const s = selRef.current;
    if (!s) return;
    e.preventDefault();
    e.stopPropagation();
    const rows = live.current.rowOrder();
    let to: number | null = null;
    const onMove = (ev: PointerEvent) => {
      const under = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest<HTMLElement>("[data-page-id]")?.dataset.pageId;
      const i = under ? rows.indexOf(under) : -1;
      if (i < 0) return;
      to = i;
      setFillTo(i);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setFillTo(null);
      document.body.style.userSelect = "";
      if (to !== null) fillTo_(s, to);
      focusSink();
    };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const multi = !!sel && (sel.a.row !== sel.f.row || sel.a.col !== sel.f.col);
  const overlay =
    o.enabled && box ? (
      <div
        aria-hidden
        data-cell-selection
        className="gio-cell-sel"
        data-multi={multi || fillTo !== null || undefined}
        style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      >
        <div className="gio-cell-fill" onPointerDown={onFillDown} />
      </div>
    ) : null;
  const sink = o.enabled ? (
    <textarea
      ref={sinkRef}
      aria-label="Table cells: arrows move, Enter edits, ⌘C copies, ⌘V pastes"
      data-cell-sink
      className="gio-cell-sink"
      style={{ left: box?.left ?? 0, top: box?.top ?? 0 }}
      value=" "
      onChange={() => {}}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={onSinkKeyDown}
      onCopy={(e) => copy(e, false)}
      onCut={(e) => copy(e, true)}
      onPaste={(e) => void paste(e)}
      onBlur={() =>
        window.setTimeout(() => {
          if (document.activeElement !== sinkRef.current) setSel(null);
        }, 0)
      }
    />
  ) : null;

  return { overlay, sink, clear, active: !!sel };
}
