import type { PageListItem } from "./types";

/** Where a page lives, for a second line: its database, or the page it
 *  sits inside. Top-level pages need no note. */
export function placeOf(
  p: Pick<PageListItem, "parent_id" | "database_id"> | undefined,
  pages: readonly Pick<PageListItem, "id" | "title">[],
): string {
  if (!p?.parent_id) return "";
  const parent = pages.find((x) => x.id === p.parent_id);
  if (!parent) return "";
  const name = parent.title?.trim() || "Untitled";
  return p.database_id ? name : `in ${name}`;
}
