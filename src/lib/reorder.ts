/**
 * Pure reorder helpers for the block editor.
 *
 * `insertAt` is a GAP index in [0, blocks.length]: 0 means "before the
 * first block", `blocks.length` means "after the last block". These
 * helpers never mutate the input array.
 */

export function moveBlock<T>(blocks: readonly T[], fromIndex: number, insertAt: number): T[] {
  if (fromIndex < 0 || fromIndex >= blocks.length) return blocks.slice();
  if (insertAt < 0 || insertAt > blocks.length) return blocks.slice();
  // Dropping on the block's own position (either side of it) is identity.
  if (insertAt === fromIndex || insertAt === fromIndex + 1) return blocks.slice();
  const next = blocks.slice();
  const [item] = next.splice(fromIndex, 1);
  const adj = insertAt > fromIndex ? insertAt - 1 : insertAt;
  next.splice(adj, 0, item);
  return next;
}

export function moveRun<T>(
  blocks: readonly T[],
  runStart: number,
  runEnd: number,
  insertAt: number,
): T[] {
  // runEnd is inclusive.
  if (
    runStart < 0 ||
    runEnd >= blocks.length ||
    runStart > runEnd ||
    insertAt < 0 ||
    insertAt > blocks.length
  ) {
    return blocks.slice();
  }
  // Dropping inside or at either edge of the run is identity.
  if (insertAt >= runStart && insertAt <= runEnd + 1) return blocks.slice();
  const run = blocks.slice(runStart, runEnd + 1);
  const rest = blocks.slice(0, runStart).concat(blocks.slice(runEnd + 1));
  const adj = insertAt > runEnd ? insertAt - run.length : insertAt;
  const next = rest.slice();
  next.splice(adj, 0, ...run);
  return next;
}

/**
 * Delete the blocks at `indices` from `blocks`. If that empties the page,
 * yield a single fresh empty block via `emptyBlockFactory` (chunk-1 rule).
 */
export function deleteIndices<T>(
  blocks: readonly T[],
  indices: Iterable<number>,
  emptyBlockFactory: () => T,
): T[] {
  const toDrop = new Set<number>();
  for (const i of indices) if (i >= 0 && i < blocks.length) toDrop.add(i);
  if (toDrop.size === 0) return blocks.slice();
  const next = blocks.filter((_, i) => !toDrop.has(i));
  if (next.length === 0) return [emptyBlockFactory()];
  return next;
}
