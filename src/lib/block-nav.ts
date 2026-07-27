/**
 * Arrow-key navigation between blocks in the page body.
 *
 * A block is "editable" if it has a caret-bearing editor — i.e. any type
 * other than `divider` (no editor at all) and `table` (cell inputs, not a
 * single caret we can address by block id). Arrow navigation must skip
 * runs of non-editable blocks until it finds the next editable neighbour
 * in that direction, or return null when there is none.
 */

export type BlockLike = { type: string };

const NON_EDITABLE = new Set(["divider", "table"]);

export function nextEditableIndex<T extends BlockLike>(
  blocks: T[],
  from: number,
  dir: 1 | -1,
): number | null {
  let i = from + dir;
  while (i >= 0 && i < blocks.length) {
    const t = blocks[i]?.type;
    if (t && !NON_EDITABLE.has(t)) return i;
    i += dir;
  }
  return null;
}
