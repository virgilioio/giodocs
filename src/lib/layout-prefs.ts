/**
 * ONE layout accessor. The segmented switcher in the view toolbar, the
 * toolbar ⋯, and the view-row ⋯ each write layout to the same place; each
 * reads it back through this function. If a check mark in a menu and a
 * highlighted segment in the toolbar can ever disagree, that's the bug this
 * accessor exists to prevent.
 *
 * For personal-owned views layout persists directly on the row. For
 * team/area views it lives in the caller's per-session view draft (see
 * `src/lib/view-drafts.ts`); callers that already fold drafts into the
 * "current" view just pass that current object in — `layoutOf(current)`.
 */
export type LayoutKind = "table" | "board" | "list";

type LayoutBearer = { layout?: string | null } | null | undefined;

export function layoutOf(v: LayoutBearer): LayoutKind {
  const raw = v?.layout;
  if (raw === "board" || raw === "list" || raw === "table") return raw;
  return "table";
}

/** Human label for the layout, used in menu hints ("Change layout · Board"). */
export function layoutLabel(l: LayoutKind): string {
  return l === "board" ? "Board" : l === "list" ? "List" : "Table";
}
