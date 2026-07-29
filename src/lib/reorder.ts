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

/* ────────────── Cross-list moves (columns, callouts) ────────────── */

/**
 * A container reference. Two shapes — structural, no discriminator field
 * on the column case, so every existing `{ blockId, colIndex }` literal
 * keeps working unchanged.
 *
 *   Column:   { blockId, colIndex }
 *   Callout:  { blockId, callout: true }
 *
 * `col: null` still means "the top-level block list".
 */
export type ColumnRef =
  | { blockId: string; colIndex: number }
  | { blockId: string; callout: true };
export type Path = { col: ColumnRef | null; index: number };

type BlkLite = {
  id: string;
  type?: string;
  text?: string;
  cols?: BlkLite[][];
  children?: BlkLite[];
};

function isCalloutRef(r: ColumnRef): r is { blockId: string; callout: true } {
  return (r as { callout?: unknown }).callout === true;
}

function samePath(a: Path, b: Path): boolean {
  if (a.col === null && b.col === null) return true;
  if (a.col && b.col) {
    if (a.col.blockId !== b.col.blockId) return false;
    const aCallout = isCalloutRef(a.col);
    const bCallout = isCalloutRef(b.col);
    if (aCallout !== bCallout) return false;
    if (aCallout) return true;
    return (
      (a.col as { colIndex: number }).colIndex ===
      (b.col as { colIndex: number }).colIndex
    );
  }
  return false;
}

/** Materialise the container's block list. Column: reads `b.cols[i]`.
 *  Callout: reads `b.children` if present, else — for lazy-migration
 *  support — synthesises a single text block from `b.text` via
 *  `makeMigratedText`. When `makeMigratedText` is omitted (pure reads
 *  that don't want to trigger a migration) an unmigrated callout returns
 *  an empty list, which is the "would need migration first" signal. */
function getList<B extends BlkLite>(
  blocks: readonly B[],
  col: ColumnRef | null,
  makeMigratedText?: (text: string) => B,
): B[] | null {
  if (col === null) return blocks.slice();
  const b = blocks.find((x) => x.id === col.blockId);
  if (!b) return null;
  if (isCalloutRef(col)) {
    if (b.type !== "callout") return null;
    if (Array.isArray(b.children)) return (b.children as B[]).slice();
    if (makeMigratedText) return [makeMigratedText(b.text ?? "")];
    return [];
  }
  if (!Array.isArray(b.cols)) return null;
  const ci = (col as { colIndex: number }).colIndex;
  if (ci < 0 || ci >= b.cols.length) return null;
  return (b.cols[ci] as B[]).slice();
}

/** Write a container's block list. Column: replaces `cols[i]`. Callout:
 *  writes `children` and blanks `text` — the migration is applied
 *  whenever the caller commits any list into a callout, so a callout
 *  that has been touched is always in "container mode". */
function setList<B extends BlkLite>(
  blocks: readonly B[],
  col: ColumnRef | null,
  next: readonly B[],
): B[] {
  if (col === null) return next.slice() as B[];
  return blocks.map((b) => {
    if (b.id !== col.blockId) return b;
    if (isCalloutRef(col)) {
      if (b.type !== "callout") return b;
      return { ...b, children: (next as B[]).slice(), text: "" } as B;
    }
    if (!Array.isArray(b.cols)) return b;
    const ci = (col as { colIndex: number }).colIndex;
    const nextCols = b.cols.map((c, i) =>
      i === ci ? (next as B[]).slice() : (c as B[]).slice(),
    );
    return { ...b, cols: nextCols } as B;
  });
}

/** Whether inserting `item` into `to` is refused by a container invariant.
 *  Columns must never nest (existing rule). Callouts refuse other callouts
 *  and columns blocks (new rule) — see block-ops.ts's `children` note. */
function isRefusedInsertion<B extends BlkLite>(item: B, to: Path): boolean {
  if (to.col === null) return false;
  if (isCalloutRef(to.col)) {
    return item.type === "callout" || item.type === "columns";
  }
  // Column target: existing invariant.
  return item.type === "columns";
}

/**
 * Move a single block from `from` (points AT a block) to `to` (points AT
 * a gap in the target list). Refuses container invariants (see
 * `isRefusedInsertion`). When the source list is a column that becomes
 * empty as a result, the column is reseeded with one fresh block from
 * `makeEmpty()` so the invariant "every column has ≥ 1 block" is
 * preserved. The equivalent is true for callout children (see comment
 * on the `children` field): draining a callout leaves one empty text
 * block. Same-list drops honour the moveBlock identity rule.
 */
export function moveBlockAcross<B extends BlkLite>(
  blocks: readonly B[],
  from: Path,
  to: Path,
  makeEmpty: () => B,
): B[] {
  const makeMigratedText = (text: string): B => {
    // Seed a fresh empty block, then patch its text. Preserves the
    // caller-supplied factory's id generation and shape.
    const seeded = makeEmpty();
    (seeded as { text?: string }).text = text;
    return seeded;
  };
  const source = getList(blocks, from.col, makeMigratedText);
  if (!source) return blocks.slice() as B[];
  if (from.index < 0 || from.index >= source.length) return blocks.slice() as B[];
  const item = source[from.index];

  // Container invariants.
  if (isRefusedInsertion(item, to)) return blocks.slice() as B[];

  const same = samePath(from, to);
  if (same && (to.index === from.index || to.index === from.index + 1)) {
    return blocks.slice() as B[];
  }

  if (same) {
    const nextList = moveBlock(source, from.index, to.index);
    return setList(blocks, from.col, nextList) as B[];
  }

  // Different source and target lists — remove first, then insert. Both
  // sides may need lazy-migration reads (source: unlikely — you can't
  // drag out of a callout that has no `children` — but keep symmetric).
  const nextSource = source.slice();
  nextSource.splice(from.index, 1);
  const sourceNeedsSeed =
    from.col !== null && nextSource.length === 0;
  const seededSource = sourceNeedsSeed ? [makeEmpty()] : nextSource;
  let intermediate = setList(blocks, from.col, seededSource);

  const target = getList(intermediate, to.col, makeMigratedText);
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
  const makeMigratedText = (text: string): B => {
    const seeded = makeEmpty();
    (seeded as { text?: string }).text = text;
    return seeded;
  };
  const source = getList(blocks, first.col, makeMigratedText);
  if (!source) return blocks.slice() as B[];
  if (runStart < 0 || runEnd >= source.length) return blocks.slice() as B[];
  const items = source.slice(runStart, runEnd + 1);

  // Container invariants: any refused item aborts the whole run.
  if (items.some((x) => isRefusedInsertion(x, to))) {
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

  const target = getList(intermediate, to.col, makeMigratedText);
  if (!target) return blocks.slice() as B[];
  const insertAt = Math.max(0, Math.min(target.length, to.index));
  const nextTarget = target.slice(0, insertAt).concat(items, target.slice(insertAt));
  intermediate = setList(intermediate, to.col, nextTarget);
  return intermediate as B[];
}
