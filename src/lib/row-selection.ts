/**
 * Pure selection primitives for the row ⋯ / multi-select surfaces in the
 * three view layouts. Kept UI-free so the range logic can be tested and
 * reused across table/board/list without dragging in React.
 *
 * `rangeSelect` computes the next selection when the user shift-clicks a
 * checkbox. The rendered order is passed in explicitly (post-runView,
 * post-sort) — the range a person means is the one they can see, never
 * the unsorted pages list.
 *
 * Contract:
 *  - Shift-click ADDS the inclusive [anchor..clicked] range to the current
 *    selection. It never replaces it.
 *  - When there is no anchor, shift-click behaves like a plain toggle-on
 *    for the clicked id.
 *  - Ids that are not present in `rowIds` are ignored (a stale click on a
 *    row that just filtered out).
 *  - anchor === clicked collapses to a single-id add.
 *  - The returned array preserves `current`'s existing order and appends
 *    newly-added ids in `rowIds` order.
 */
export function rangeSelect(
  rowIds: string[],
  anchorId: string | null,
  clickedId: string,
  current: string[],
): string[] {
  const clickedIdx = rowIds.indexOf(clickedId);
  if (clickedIdx < 0) return current;

  const set = new Set(current);

  if (!anchorId || anchorId === clickedId || rowIds.indexOf(anchorId) < 0) {
    if (set.has(clickedId)) return current;
    return [...current, clickedId];
  }

  const anchorIdx = rowIds.indexOf(anchorId);
  const lo = Math.min(anchorIdx, clickedIdx);
  const hi = Math.max(anchorIdx, clickedIdx);

  const out = [...current];
  for (let i = lo; i <= hi; i++) {
    const id = rowIds[i];
    if (!set.has(id)) {
      set.add(id);
      out.push(id);
    }
  }
  return out;
}
