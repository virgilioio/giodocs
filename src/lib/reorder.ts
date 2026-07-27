/**
 * Pure reorder helpers for the block editor.
 *
 * `insertAt` is a GAP index in [0, blocks.length]: 0 means "before the
 * first block", `blocks.length` means "after the last block". These
 * helpers never mutate the input array.
 *
 * Cross-list drag (top-level ↔ columns) is expressed with a hierarchical
 * `Path`: `{ col, index }` where `col === null` means the top-level
 * block list, and otherwise `{ blockId, colIndex }` identifies which
 * `columns` block and which of its columns. `moveBlockAcross` handles
 * single-block moves across any two `Path`s; `moveRunAcross` handles a
 * contiguous run of paths that must all live in the same source list.
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

/* ────────────── Cross-list moves (columns) ────────────── */

export type ColumnRef = { blockId: string; colIndex: number };
export type Path = { col: ColumnRef | null; index: number };

type BlkLite = {
  id: string;
  type?: string;
  cols?: BlkLite[][];
};

function samePath(a: Path, b: Path): boolean {
  if (a.col === null && b.col === null) return true;
  if (a.col && b.col) {
    return a.col.blockId === b.col.blockId && a.col.colIndex === b.col.colIndex;
  }
  return false;
}

function getList<B extends BlkLite>(blocks: readonly B[], col: ColumnRef | null): B[] | null {
  if (col === null) return blocks.slice();
  const b = blocks.find((x) => x.id === col.blockId);
  if (!b || !Array.isArray(b.cols)) return null;
  if (col.colIndex < 0 || col.colIndex >= b.cols.length) return null;
  return (b.cols[col.colIndex] as B[]).slice();
}

function setList<B extends BlkLite>(
  blocks: readonly B[],
  col: ColumnRef | null,
  next: readonly B[],
): B[] {
  if (col === null) return next.slice() as B[];
  return blocks.map((b) => {
    if (b.id !== col.blockId || !Array.isArray(b.cols)) return b;
    const nextCols = b.cols.map((c, ci) =>
      ci === col.colIndex ? (next as B[]).slice() : (c as B[]).slice(),
    );
    return { ...b, cols: nextCols } as B;
  });
}

/**
 * Move a single block from `from` (points AT a block) to `to` (points AT
 * a gap in the target list). Refuses to move a `columns` block into a
 * column (no nesting — see src/lib/columns.ts). When the source list is
 * a column that becomes empty as a result, the column is reseeded with
 * one fresh block from `makeEmpty()` so the invariant "every column has
 * ≥ 1 block" is preserved.
 *
 * Same-list drops honour the moveBlock identity rule: dropping on the
 * block's own gap (before or after it) is a no-op.
 */
export function moveBlockAcross<B extends BlkLite>(
  blocks: readonly B[],
  from: Path,
  to: Path,
  makeEmpty: () => B,
): B[] {
  const source = getList(blocks, from.col);
  if (!source) return blocks.slice() as B[];
  if (from.index < 0 || from.index >= source.length) return blocks.slice() as B[];
  const item = source[from.index];

  // Invariant: a `columns` block may never be dropped inside a column.
  if (item.type === "columns" && to.col !== null) return blocks.slice() as B[];

  const same = samePath(from, to);
  if (same && (to.index === from.index || to.index === from.index + 1)) {
    return blocks.slice() as B[];
  }

  if (same) {
    const nextList = moveBlock(source, from.index, to.index);
    return setList(blocks, from.col, nextList) as B[];
  }

  // Different source and target lists — remove first, then insert.
  const nextSource = source.slice();
  nextSource.splice(from.index, 1);
  const seededSource =
    from.col !== null && nextSource.length === 0 ? [makeEmpty()] : nextSource;
  let intermediate = setList(blocks, from.col, seededSource);

  const target = getList(intermediate, to.col);
  if (!target) return blocks.slice() as B[];
  const insertAt = Math.max(0, Math.min(target.length, to.index));
  const nextTarget = target.slice();
  nextTarget.splice(insertAt, 0, item);
  intermediate = setList(intermediate, to.col, nextTarget);
  return intermediate as B[];
}

/**
 * Move a run of blocks identified by `froms` (an array of Paths that MUST
 * all sit in the same source list and MUST be contiguous). If they span
 * more than one list, the whole move is a no-op — this is the "run
 * spanning two different columns is a no-op" invariant. Also a no-op if
 * any block in the run is a `columns` block and the target is a column.
 */
export function moveRunAcross<B extends BlkLite>(
  blocks: readonly B[],
  froms: readonly Path[],
  to: Path,
  makeEmpty: () => B,
): B[] {
  if (froms.length === 0) return blocks.slice() as B[];
  // All source paths must share the same `.col` OR the whole move is a no-op.
  const first = froms[0];
  for (let i = 1; i < froms.length; i++) {
    if (!samePath(first, froms[i])) return blocks.slice() as B[];
  }
  const indices = froms.map((p) => p.index).sort((a, b) => a - b);
  const runStart = indices[0];
  const runEnd = indices[indices.length - 1];
  if (runEnd - runStart + 1 !== indices.length) {
    // Not contiguous — no-op.
    return blocks.slice() as B[];
  }
  const source = getList(blocks, first.col);
  if (!source) return blocks.slice() as B[];
  if (runStart < 0 || runEnd >= source.length) return blocks.slice() as B[];
  const items = source.slice(runStart, runEnd + 1);

  // Guard: a run containing a `columns` block cannot land in a column.
  if (to.col !== null && items.some((x) => x.type === "columns")) {
    return blocks.slice() as B[];
  }

  const same = samePath(first, to);
  if (same && to.index >= runStart && to.index <= runEnd + 1) {
    return blocks.slice() as B[];
  }

  if (same) {
    const nextList = moveRun(source, runStart, runEnd, to.index);
    return setList(blocks, first.col, nextList) as B[];
  }

  const nextSource = source.slice(0, runStart).concat(source.slice(runEnd + 1));
  const seededSource =
    first.col !== null && nextSource.length === 0 ? [makeEmpty()] : nextSource;
  let intermediate = setList(blocks, first.col, seededSource);

  const target = getList(intermediate, to.col);
  if (!target) return blocks.slice() as B[];
  const insertAt = Math.max(0, Math.min(target.length, to.index));
  const nextTarget = target.slice(0, insertAt).concat(items, target.slice(insertAt));
  intermediate = setList(intermediate, to.col, nextTarget);
  return intermediate as B[];
}
