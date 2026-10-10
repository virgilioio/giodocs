/**
 * The sidebar page tree — ONE FLAT LIST.
 *
 * `flattenTree` carries its own depth, so the view layer has no recursion:
 * one keyboard model, one hover model, one row component. Nesting DOM (or
 * writing a recursive component) would fork all three.
 *
 * GUIDE RAILS, NOT INDENTATION. Indentation alone dies at depth 2 in a 240px
 * rail, so each ancestor level gets its own cell drawing a 1px vertical rule;
 * adjacent rows join into a continuous rail. The type steps down per level so
 * depth is legible without counting; past the third level the ramp holds.
 *
 * The tree is the navigation (Notion's structure, 2026-10-10): any depth, a
 * database's rows are its children, and each row offers "+" (a page inside,
 * or a row when the page is a database) and a ⋯ menu on hover.
 *
 * `flattenTree` already omits a page whose parent is set but unreadable, along
 * with its subtree. There is deliberately NO placeholder and NO "1 more you
 * can't see" counter — a count leaks that something exists, and two users
 * seeing different trees is correct.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  dropZoneAt,
  flattenTree,
  moveTargetFor,
  type DropZone,
  type MoveTarget,
  type TreePage,
} from "@/lib/page-tree";
import { DRAG_TYPE, draggedPage, setDraggedPage } from "@/lib/page-drag";
import { Ico } from "./emoji-icon";
import { SpecMenuTrigger, type MenuSpec } from "./row-menu";

export const TREE_EXPANDED_KEY = "gio.treeExpanded";

const RAMP = [
  { height: 27, fontSize: 13.5, color: "var(--color-secondary)" },
  { height: 26, fontSize: 13, color: "var(--color-muted)" },
  { height: 25, fontSize: 13, color: "var(--color-muted)" },
] as const;

export type TreeNode = TreePage & { is_database?: boolean };


const EXPAND_AFTER_MS = 600;

export function useTreeExpanded(): [Set<string>, (id: string) => void, (id: string) => void] {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem(TREE_EXPANDED_KEY);
      return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set<string>();
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(TREE_EXPANDED_KEY, JSON.stringify([...expanded]));
  }, [expanded]);
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const open = (id: string) =>
    setExpanded((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  return [expanded, toggle, open];
}

function DatabaseGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden style={{ flex: "none" }}>
      <path
        d="M4 5h16v14H4zM4 10h16M4 15h16M10 5v14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SidebarTreeView<P extends TreeNode>({
  pages,
  expanded,
  activeId,
  onToggle,
  onOpen,
  onAddInside,
  menuFor,
  empty,
  onMove,
  onExpand,
}: {
  pages: readonly P[];
  expanded: Set<string>;
  activeId?: string;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  /** Hover "+": a page inside this one (a row, when it's a database). */
  onAddInside?: (page: P) => void;
  /** Hover ⋯ menu. */
  menuFor?: (page: P) => (mctx: { setSpec: (s: MenuSpec) => void; close: () => void }) => MenuSpec;
  /** Shown when there's nothing to list. */
  empty?: ReactNode;
  /** Drag a row: reorder among siblings, or drop onto a row to place it
   *  inside. Absent: rows don't drag. */
  onMove?: (pageId: string, target: MoveTarget) => void;
  /** Open a collapsed row the drag rests on. */
  onExpand?: (id: string) => void;
}) {
  const rows = flattenTree(pages, expanded);
  const [over, setOver] = useState<{ id: string; zone: DropZone } | null>(null);
  const hoverTimer = useRef<{ id: string; t: number } | null>(null);
  const clearHover = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current.t);
    hoverTimer.current = null;
  };
  useEffect(() => clearHover, []);
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <ul data-page-tree onDragLeave={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
        setOver(null);
        clearHover();
      }
    }}>
      {rows.map((r) => {
        const ramp = RAMP[Math.min(r.depth, RAMP.length - 1)]!;
        const active = activeId === r.page.id;
        const title = String(r.page.title ?? "").trim() || "Untitled";
        const zone = over?.id === r.page.id ? over.zone : null;
        const targetFor = (z: DropZone) =>
          draggedPage() ? moveTargetFor(draggedPage()!, r.page, z, pages, expanded) : null;
        return (
          <li
            key={r.page.id}
            className="group relative flex items-stretch"
            data-tree-row={r.page.id}
            data-drop={zone ?? undefined}
            draggable={!!onMove}
            onDragStart={(e) => {
              if (!onMove) return;
              setDraggedPage(r.page.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData(DRAG_TYPE, r.page.id);
              e.dataTransfer.setData("text/plain", title);
            }}
            onDragEnd={() => {
              setDraggedPage(null);
              setOver(null);
              clearHover();
            }}
            onDragOver={(e) => {
              if (!onMove || !draggedPage()) return;
              const box = e.currentTarget.getBoundingClientRect();
              const z = dropZoneAt(e.clientY - box.top, box.height);
              if (!targetFor(z)) {
                if (over?.id === r.page.id) setOver(null);
                return;
              }
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "move";
              if (over?.id !== r.page.id || over.zone !== z) setOver({ id: r.page.id, zone: z });
              // Resting on a closed page opens it, so you can go deeper.
              if (z === "inside" && r.hasKids && !r.expanded && onExpand) {
                if (hoverTimer.current?.id !== r.page.id) {
                  clearHover();
                  const id = r.page.id;
                  hoverTimer.current = { id, t: window.setTimeout(() => onExpand(id), EXPAND_AFTER_MS) };
                }
              } else clearHover();
            }}
            onDrop={(e) => {
              if (!onMove || !draggedPage()) return;
              const box = e.currentTarget.getBoundingClientRect();
              const t = targetFor(dropZoneAt(e.clientY - box.top, box.height));
              e.preventDefault();
              e.stopPropagation();
              const id = draggedPage()!;
              setDraggedPage(null);
              setOver(null);
              clearHover();
              if (t) onMove(id, t);
            }}
          >
            {zone === "before" || zone === "after" ? (
              <span
                aria-hidden
                data-drop-line
                className="pointer-events-none absolute right-1 rounded-full bg-accent"
                style={{
                  height: 2,
                  left: r.depth * 17 + 14,
                  [zone === "before" ? "top" : "bottom"]: -1,
                }}
              />
            ) : null}
            {/* One guide cell per ancestor level. */}
            {Array.from({ length: r.depth }, (_, i) => (
              <span
                key={i}
                aria-hidden
                data-guide
                style={{
                  width: 11,
                  flex: "none",
                  borderLeft: "1px solid var(--color-line)",
                  marginLeft: 6,
                }}
              />
            ))}
            <span className="flex min-w-0 flex-1 items-center">
              {r.hasKids ? (
                <button
                  type="button"
                  data-disclosure
                  aria-expanded={r.expanded}
                  aria-label={r.expanded ? `Collapse ${title}` : `Expand ${title}`}
                  onClick={() => onToggle(r.page.id)}
                  className="text-rule hover:text-secondary"
                  style={{
                    width: 14,
                    flex: "none",
                    border: 0,
                    background: "transparent",
                    padding: 0,
                    fontSize: 9,
                    lineHeight: 1,
                    cursor: "pointer",
                  }}
                >
                  {r.expanded ? "▾" : "▸"}
                </button>
              ) : (
                <span aria-hidden style={{ width: 14, flex: "none" }} />
              )}
              <span
                className="flex min-w-0 flex-1 items-center rounded-md hover:bg-railHover"
                style={{
                  height: ramp.height,
                  background:
                    zone === "inside"
                      ? "var(--color-selected)"
                      : active
                        ? "var(--color-railHover)"
                        : "transparent",
                  boxShadow: zone === "inside" ? "inset 0 0 0 1px var(--color-accent)" : undefined,
                  paddingRight: 2,
                }}
              >
                <button
                  type="button"
                  onClick={() => onOpen(r.page.id)}
                  aria-current={active ? "page" : undefined}
                  className="flex min-w-0 flex-1 items-center"
                  style={{
                    gap: 6,
                    height: ramp.height,
                    border: 0,
                    background: "transparent",
                    padding: "0 6px",
                    fontSize: ramp.fontSize,
                    color: active ? "var(--color-noir)" : ramp.color,
                    fontWeight: active ? 600 : 400,
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  {r.page.is_database && !r.page.icon ? (
                    <DatabaseGlyph />
                  ) : (
                    <Ico icon={r.page.icon} size={14} />
                  )}
                  <span className="min-w-0 flex-1 truncate">{title}</span>
                </button>
                {(menuFor || onAddInside) && (
                  <span
                    className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100"
                    style={{ gap: 1 }}
                    data-tree-actions
                  >
                    {menuFor && (
                      <SpecMenuTrigger
                        size="sm"
                        ariaLabel={`Actions for ${title}`}
                        build={menuFor(r.page)}
                      />
                    )}
                    {onAddInside && (
                      <button
                        type="button"
                        aria-label={
                          r.page.is_database ? `New row in ${title}` : `New page inside ${title}`
                        }
                        title={r.page.is_database ? "New row" : "New page inside"}
                        onClick={() => onAddInside(r.page)}
                        className="grid place-items-center rounded-sm text-whisper hover:bg-railHover hover:text-strong"
                        style={{ width: 17, height: 17 }}
                      >
                        <svg viewBox="0 0 24 24" width={12} height={12} aria-hidden>
                          <path
                            d="M12 5v14M5 12h14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                    )}
                  </span>
                )}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function SidebarTree<P extends TreeNode>({
  pages,
  activeId,
}: {
  pages: readonly P[];
  activeId?: string;
}) {
  const navigate = useNavigate();
  const [expanded, toggle] = useTreeExpanded();
  return (
    <SidebarTreeView
      pages={pages}
      expanded={expanded}
      activeId={activeId}
      onToggle={toggle}
      onOpen={(id) => {
        void navigate({ to: "/p/$pageId", params: { pageId: id } });
      }}
    />
  );
}
