import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { BulkActions } from "@/components/bulk-bar";
import { PlacePicker } from "@/components/page-block";
import { useDragSession } from "@/hooks/use-drag-session";
import {
  useArchivePage,
  useDeletePage,
  useDuplicatePage,
  useMovePage,
  useRestorePage,
  useSetPageProperty,
  useVerifyPage,
} from "@/hooks/use-page-mutations";
import { usePages } from "@/hooks/use-workspace-data";
import { isTypingTarget } from "@/lib/is-typing";
import { BLOCKS_SELECTED, ROWS_SELECTED } from "@/lib/marquee";
import { isPeekOpen } from "@/lib/peek";
import { nextValue } from "@/lib/prop-actions";
import { rangeSelect } from "@/lib/row-selection";
import { useToast } from "@/lib/toast";
import type { PageListItem } from "@/lib/types";
import { useWorkspaceId } from "@/lib/workspace-context";

/* Only one view holds a row selection at a time (a page can show several
 * tables): a view that starts one clears the others, so there is never more
 * than one bulk bar. */
const clearers = new Map<symbol, () => void>();
function claimSelection(me: symbol) {
  for (const [id, clear] of clearers) if (id !== me) clear();
}

type Marquee = { startX: number; startY: number; scroll0: number; base: string[] };
type MarqueeBox = { top: number; bottom: number; left: number; right: number; ids: string[] };

const NOT_A_START =
  'button, a, input, textarea, select, label, [contenteditable="true"], [role="menu"], [role="dialog"], [role="toolbar"], .gio-menu, [data-popover-root]';

/**
 * Selecting a view's rows (Notion's, 2026-10-30), for the database page and
 * views inside pages alike: checkboxes with shift-click ranges, the marquee
 * (drag across rows), and keys on a selection — Esc clears, Shift+↑/↓ grows
 * or shrinks it from the row it started at, Delete/Backspace deletes the
 * rows with one Undo, ⌘/ opens the bulk bar's Actions, and on the database
 * page ⌘A selects every row.
 *
 * Where a marquee starts:
 *  - "page" (the database page): anywhere in the page that isn't a control
 *    or a cell, a row's gutter included.
 *  - "block" (a view inside a page): beside the table's rows — the page's
 *    margin at their height, the space around the table, or a row's gutter.
 *    Above or below the rows the page's own block marquee still runs; the
 *    two never both start, and blocks and rows are never selected at once
 *    (ROWS_SELECTED / BLOCKS_SELECTED, lib/marquee.ts).
 */
export function useRowSelection(o: {
  /** The view's rows, in the order of its sort. */
  rowIds: string[];
  /** The rows themselves, so a delete can be undone. */
  pages: PageListItem[];
  /** The view's root element; marquee hits are its row gutters. */
  rootEl: HTMLElement | null;
  /** Where a marquee may start (see above); false: no marquee. */
  marquee: "page" | "block" | false;
  /** ⌘A selects every row (the database page; inside a page ⌘A is the page's). */
  selectAllKey?: boolean;
  canDelete: boolean;
}) {
  const toast = useToast();
  const deletePage = useDeletePage();
  const restorePage = useRestorePage();
  const [selPages, setSelPages] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const meRef = useRef(Symbol("row-selection"));

  const clearSelection = useCallback(() => {
    setSelPages((prev) => (prev.length ? [] : prev));
    setAnchor(null);
  }, []);
  useEffect(() => {
    const me = meRef.current;
    clearers.set(me, clearSelection);
    return () => {
      clearers.delete(me);
    };
  }, [clearSelection]);
  const hasSelection = selPages.length > 0;
  useEffect(() => {
    if (!hasSelection) return;
    claimSelection(meRef.current);
    // The page's selected blocks let go (page-editor-body.tsx).
    window.dispatchEvent(new CustomEvent(ROWS_SELECTED));
  }, [hasSelection]);
  useEffect(() => {
    window.addEventListener(BLOCKS_SELECTED, clearSelection);
    return () => window.removeEventListener(BLOCKS_SELECTED, clearSelection);
  }, [clearSelection]);

  const selectedSet = useMemo(() => new Set(selPages), [selPages]);
  // The order rows are shown in (a grouped table differs from the sort),
  // reported by the table: shift-click and Shift+↑/↓ ranges follow it.
  const displayOrderRef = useRef<string[]>([]);
  const rowIdsRef = useRef(o.rowIds);
  rowIdsRef.current = o.rowIds;
  const shownOrder = () =>
    displayOrderRef.current.length ? displayOrderRef.current : rowIdsRef.current;

  const live = useRef({ selPages, anchor, pages: o.pages, canDelete: o.canDelete });
  live.current = { selPages, anchor, pages: o.pages, canDelete: o.canDelete };

  const onCheckboxClick = useCallback((id: string, shift: boolean) => {
    const { anchor: a } = live.current;
    if (shift) setSelPages((prev) => rangeSelect(shownOrder(), a, id, prev));
    else setSelPages((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setAnchor(id);
  }, []);

  const selectAllState: "none" | "some" | "all" =
    selPages.length === 0
      ? "none"
      : o.rowIds.length > 0 && o.rowIds.every((id) => selectedSet.has(id))
        ? "all"
        : "some";
  const onHeaderCheckboxClick = () => {
    if (selectAllState === "none") {
      setSelPages(o.rowIds);
      setAnchor(o.rowIds[o.rowIds.length - 1] ?? null);
    } else clearSelection();
  };

  /** Delete these rows at once; one Undo brings them all back. */
  const deleteRowsWithUndo = (ids: string[]) => {
    const snaps = live.current.pages.filter((p) => ids.includes(p.id));
    clearSelection();
    void Promise.all(ids.map((id) => deletePage.mutateAsync(id))).then(() =>
      toast.push({
        message: ids.length === 1 ? "Row deleted." : `${ids.length} rows deleted.`,
        action: {
          label: "Undo",
          onClick: () => snaps.forEach((row) => restorePage.mutate({ pageId: row.id, row })),
        },
        durationMs: 10_000,
      }),
    );
  };
  const deleteRef = useRef(deleteRowsWithUndo);
  deleteRef.current = deleteRowsWithUndo;

  /* Keys on a selection. */
  const [bulkMenuAsk, setBulkMenuAsk] = useState(0);
  const shiftRef = useRef<{ base: string[]; cursor: string } | null>(null);
  const selectAllKey = !!o.selectAllKey;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isPeekOpen()) return; // the page in the dialog owns the keys
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('[role="menu"], [role="dialog"], .gio-menu')) return;
      const { selPages: sel, anchor: a, canDelete } = live.current;
      const mod = e.metaKey || e.ctrlKey;
      const ids = rowIdsRef.current;
      if (selectAllKey && mod && e.key.toLowerCase() === "a" && ids.length) {
        e.preventDefault();
        setSelPages(ids);
        setAnchor(ids[0] ?? null);
        return;
      }
      if (!sel.length) return;
      if (e.key === "Escape") {
        e.preventDefault();
        shiftRef.current = null;
        clearSelection();
        return;
      }
      if (mod && e.key === "/") {
        e.preventDefault();
        setBulkMenuAsk((n) => n + 1);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !mod && canDelete) {
        e.preventDefault();
        deleteRef.current(sel);
        return;
      }
      if (e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        const order = shownOrder();
        const from = a && order.includes(a) ? a : sel[sel.length - 1];
        const sh =
          shiftRef.current && shiftRef.current.base.every((id) => sel.includes(id))
            ? shiftRef.current
            : { base: sel.filter((id) => id !== from), cursor: from };
        const at = order.indexOf(sh.cursor);
        const next = order[at + (e.key === "ArrowDown" ? 1 : -1)];
        if (!next) return;
        const i = order.indexOf(from);
        const j = order.indexOf(next);
        const range = order.slice(Math.min(i, j), Math.max(i, j) + 1);
        shiftRef.current = { base: sh.base, cursor: next };
        setSelPages([...sh.base.filter((id) => !range.includes(id)), ...range]);
        setAnchor(from);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectAllKey, clearSelection]);

  /* The marquee: every row the box crosses is selected (added to the
     selection with ⇧/⌘). Shared useDragSession: 4px threshold, autoscroll,
     Esc. */
  const rootRef = useRef(o.rootEl);
  rootRef.current = o.rootEl;
  const marquee = useDragSession<MarqueeBox, Marquee>({
    hitTest: (pt, m) => {
      const root = rootRef.current;
      if (!root) return null;
      const main = root.closest("main");
      const y0 = m.startY - ((main?.scrollTop ?? 0) - m.scroll0);
      const box = {
        top: Math.min(y0, pt.y),
        bottom: Math.max(y0, pt.y),
        left: Math.min(m.startX, pt.x),
        right: Math.max(m.startX, pt.x),
      };
      const table = root.querySelector('[role="table"]')?.getBoundingClientRect();
      const across = !!table && box.right >= table.left && box.left <= table.right;
      const ids = across
        ? Array.from(root.querySelectorAll<HTMLElement>("[data-row-gutter]"))
            .filter((c) => {
              const r = c.getBoundingClientRect();
              return r.bottom > box.top && r.top < box.bottom;
            })
            .map((c) => c.dataset.rowGutter!)
        : [];
      const next = [...m.base, ...ids.filter((id) => !m.base.includes(id))];
      setSelPages((prev) =>
        prev.length === next.length && prev.every((id, i) => id === next[i]) ? prev : next,
      );
      return { ...box, ids };
    },
    commit: (box, m) => {
      if (!box.ids.length) return;
      // Shift+↑/↓ then moves the box's far edge: anchored at its first row,
      // growing or shrinking from its last.
      setAnchor(box.ids[0]);
      shiftRef.current = {
        base: m.base.filter((id) => !box.ids.includes(id)),
        cursor: box.ids[box.ids.length - 1],
      };
    },
    scrollTargets: () => [rootRef.current?.closest("main") as HTMLElement | null],
  });
  const marqueeBegin = useRef(marquee.begin);
  marqueeBegin.current = marquee.begin;
  const mode = o.marquee;
  useEffect(() => {
    const root = o.rootEl;
    const main = root?.closest("main");
    if (!root || !main || !mode) return;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerType === "touch" || isPeekOpen()) return;
      const t = e.target as HTMLElement;
      if (t.closest(NOT_A_START)) return;
      // Inside a table only a row's gutter starts one; cells keep their clicks.
      const inTable = t.closest('[role="table"]');
      if (inTable && !t.closest("[data-row-gutter]")) return;
      if (mode === "block") {
        if (inTable && !root.contains(inTable)) return;
        // Another block of the page (a column beside the table) is that
        // block's ground, not this table's.
        const body = root.closest(".gio-page-body");
        if (body?.contains(t) && !root.contains(t)) return;
        // Level with the rows: the band from the first row to the last.
        const gutters = root.querySelectorAll<HTMLElement>("[data-row-gutter]");
        if (!gutters.length) return;
        const top = gutters[0].getBoundingClientRect().top;
        const bottom = gutters[gutters.length - 1].getBoundingClientRect().bottom;
        if (e.clientY < top || e.clientY > bottom) return;
        // The page's caret and any text selection give way, so the keys
        // reach the rows.
        (document.activeElement as HTMLElement | null)?.blur?.();
        window.getSelection()?.removeAllRanges();
      }
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      marqueeBegin.current(e as unknown as React.PointerEvent, {
        startX: e.clientX,
        startY: e.clientY,
        scroll0: main.scrollTop,
        base: additive ? live.current.selPages : [],
      });
    };
    // Capture: it runs before the page's own block marquee, which never sees
    // a press taken here (the drag session stops it).
    main.addEventListener("pointerdown", onDown, { capture: mode === "block" });
    return () => main.removeEventListener("pointerdown", onDown, { capture: mode === "block" });
  }, [mode, o.rootEl]);
  const marqueeBox = marquee.active ? marquee.target : null;

  return {
    selPages,
    selectedSet,
    anySelection: hasSelection,
    onCheckboxClick,
    selectAllState,
    onHeaderCheckboxClick,
    clearSelection,
    displayOrderRef,
    bulkMenuAsk,
    deleteRowsWithUndo,
    marqueeBox,
  };
}

/** The marquee's box while it's drawn. */
export function MarqueeRect({ box }: { box: MarqueeBox | null }) {
  if (!box) return null;
  return (
    <div
      aria-hidden
      className="marquee-rect fixed"
      style={{
        left: box.left,
        top: box.top,
        width: box.right - box.left,
        height: box.bottom - box.top,
      }}
    />
  );
}

/**
 * What the bulk bar does to a view's rows: one set of actions for the
 * database page and views inside pages.
 */
export function useBulkActions(o: {
  pages: PageListItem[];
  staleDays: number;
  meId: string;
  /** Can change the database's rows (duplicate, move). */
  canEdit: boolean;
}): BulkActions {
  const toast = useToast();
  const setProp = useSetPageProperty();
  const verifyPage = useVerifyPage();
  const deletePage = useDeletePage();
  const restorePage = useRestorePage();
  const archivePage = useArchivePage();
  const duplicatePage = useDuplicatePage();
  const movePage = useMovePage();
  // Move to… lists every page in the workspace.
  const allPages = usePages(useWorkspaceId()).data ?? [];
  const propsOf = (p: PageListItem | undefined): Record<string, unknown> =>
    p?.props && typeof p.props === "object" && !Array.isArray(p.props)
      ? (p.props as Record<string, unknown>)
      : {};

  return {
    staleDays: o.staleDays,
    meId: o.meId,
    verify: async (ids) => {
      await Promise.all(ids.map((id) => verifyPage.mutateAsync(id)));
    },
    setValue: async (ids, def, picked) => {
      await Promise.all(
        ids.map((id) => {
          const p = o.pages.find((x) => x.id === id);
          const value = nextValue(def, propsOf(p)[def.key], picked);
          return setProp.mutateAsync({ pageId: id, key: def.key, value });
        }),
      );
    },
    archive: async (ids) => {
      await Promise.all(ids.map((id) => archivePage.mutateAsync({ pageId: id, archived: true })));
    },
    unarchive: async (ids) => {
      await Promise.all(ids.map((id) => archivePage.mutateAsync({ pageId: id, archived: false })));
    },
    deletePages: async (ids) => {
      await Promise.all(ids.map((id) => deletePage.mutateAsync(id)));
    },
    restorePages: async (rows) => {
      await Promise.all(rows.map((row) => restorePage.mutateAsync({ pageId: row.id, row })));
    },
    duplicate: o.canEdit
      ? async (ids) => {
          const copies = await Promise.all(
            ids.map((id) => duplicatePage.mutateAsync({ pageId: id, silent: true })),
          );
          const made = copies.filter((c): c is PageListItem => !!c);
          toast.push({
            message: made.length === 1 ? "Duplicated 1 row." : `Duplicated ${made.length} rows.`,
            action: {
              label: "Undo",
              onClick: () => made.forEach((c) => deletePage.mutate(c.id)),
            },
            durationMs: 10_000,
          });
        }
      : undefined,
    renderMoveTo: o.canEdit
      ? (thisPageId, onPick) => (
          <PlacePicker
            pages={allPages}
            thisPageId={thisPageId}
            onPick={(to) => onPick(to.id, to.title?.trim() || "Untitled")}
            onCreate={() => {}}
          />
        )
      : undefined,
    moveTo: async (ids, parentId, title) => {
      // move_page hands back where each row was and its values, so Undo
      // returns them to the database with their properties.
      const before = await Promise.all(
        ids.map((id) =>
          movePage.mutateAsync({ pageId: id, target: { parentId, beforeId: null }, quiet: true }),
        ),
      );
      toast.push({
        message: `Moved ${ids.length === 1 ? "1 row" : `${ids.length} rows`} to "${title}".`,
        action: {
          label: "Undo",
          onClick: () =>
            ids.forEach((id, i) =>
              movePage.mutate({
                pageId: id,
                target: { parentId: before[i].parent_id, beforeId: before[i].before },
                props: before[i].props,
                undo: true,
              }),
            ),
        },
        durationMs: 10_000,
      });
    },
    toast: (message, undo) =>
      toast.push(
        undo ? { message, action: { label: "Undo", onClick: undo }, durationMs: 10_000 } : message,
      ),
  };
}
