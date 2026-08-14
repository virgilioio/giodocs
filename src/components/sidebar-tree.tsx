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
 * depth is legible without counting.
 *
 * Depth 3 is the DB ceiling; the rail renders depths 0–2 and a depth-3 page
 * surfaces through its parent instead.
 *
 * `flattenTree` already omits a page whose parent is set but unreadable, along
 * with its subtree. There is deliberately NO placeholder and NO "1 more you
 * can't see" counter — a count leaks that something exists, and two users
 * seeing different trees is correct.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { flattenTree, type TreePage } from "@/lib/page-tree";
import { Ico } from "./emoji-icon";

export const TREE_EXPANDED_KEY = "gio.treeExpanded";

const RAMP = [
  { height: 27, fontSize: 13.5, color: "var(--color-secondary)" },
  { height: 26, fontSize: 13, color: "var(--color-muted)" },
  { height: 25, fontSize: 13, color: "var(--color-muted)" },
] as const;

export const TREE_ASIDE =
  "No folders. A page lives wherever its properties say it does.";

export function useTreeExpanded(): [Set<string>, (id: string) => void] {
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
  return [expanded, toggle];
}

export function SidebarTreeView<P extends TreePage>({
  pages,
  expanded,
  activeId,
  onToggle,
  onOpen,
}: {
  pages: readonly P[];
  expanded: Set<string>;
  activeId?: string;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const rows = flattenTree(pages, expanded).filter((r) => r.depth <= 2);
  return (
    <ul data-page-tree>
      {rows.map((r) => {
        const ramp = RAMP[Math.min(r.depth, RAMP.length - 1)]!;
        const active = activeId === r.page.id;
        return (
          <li key={r.page.id} className="flex items-stretch">
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
                  aria-label={
                    r.expanded
                      ? `Collapse ${r.page.title || "Untitled"}`
                      : `Expand ${r.page.title || "Untitled"}`
                  }
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
              <button
                type="button"
                onClick={() => onOpen(r.page.id)}
                className="flex min-w-0 flex-1 items-center rounded-md hover:bg-railHover"
                style={{
                  gap: 6,
                  height: ramp.height,
                  border: 0,
                  background: active ? "var(--color-railHover)" : "transparent",
                  padding: "0 6px",
                  fontSize: ramp.fontSize,
                  color: ramp.color,
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <Ico icon={r.page.icon} size={14} />
                <span className="min-w-0 flex-1 truncate">
                  {String(r.page.title ?? "").trim() || "Untitled"}
                </span>
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function SidebarTree<P extends TreePage>({
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
