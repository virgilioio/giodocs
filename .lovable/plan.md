# Columns — part 1 of 2

Scope from the task: data model, rendering, editing, /col2–/col6, serializers, Notion column_list importer.
Deferred to part 2 (documented as such in "What I did NOT do"): dragging blocks into/out of columns, marquee selection crossing columns, arrow-key navigation between columns.

## 1. Data model

`src/lib/types.ts` — no shape change; `Block` already accepts arbitrary keys. Add a `/** @see public.page_search_text — DB search recurses one level into cols; NEVER nest columns inside columns. */` note.

`src/lib/columns.ts` (new, pure) — helpers:
- `MIN_COLS = 2`, `MAX_COLS = 6`
- `isColumnsBlock(b): boolean`
- `validateColumnsCols(cols): boolean` — length 2–6, every entry is an array, no entry contains a columns block (single level).
- `stripNestedColumns(cols)` — for defensive normalization: filter out any nested columns block within any column, replacing it with its flattened contents.
- `emptyColumns(n)` — returns `Blk[][]` with n columns, each seeded `[newBlock("text")]` (caller supplies newBlock via param to avoid cross-file dep).

Wire `normalize()` in the editor to call `stripNestedColumns` on the cols array of any incoming columns block, and to normalize the inner blocks recursively (one level).

## 2. Serializers

`src/lib/export.ts`
- `blockToMarkdown` — case `"columns"`: for each `cols[i]`, run `blockToMarkdown` per inner block with per-column `numberedOrdinals`; join blocks in one column with `\n\n`; join columns with `\n\n`. No marker. Round-trip is lossy (comment).
- `blockHtml` — case `"columns"`: `<div style="display:grid;grid-template-columns:repeat(N,minmax(0,1fr));gap:20px">` with N `<div>` children, each concatenating `blockHtml` of inner blocks with per-column ordinals. All user text escaped via existing `inline`/`esc`.

`src/lib/markdown-import.ts` — no change; add the "markdown cannot express columns" comment at the top.

`src/lib/html-to-markdown.ts`
- Existing `htmlToMarkdown(html)` unchanged for non-column input.
- New optional structured export: `htmlToBlocks(html): Blk[] | null`. Walks the tree; when it sees an element whose class contains `column_list` (Notion), it collects children whose class contains `column` and builds a `columns` block whose inner content is produced by re-running `htmlToMarkdown` on each column's inner HTML → `parseMarkdown` → Blk[]. If N is outside 2–6, clamp to 6 and flatten the rest into the last column (never lose content). Returns `null` when no `column_list` shape is found.
- Paste handler (see §4) prefers `htmlToBlocks` when non-null; otherwise falls back to `htmlToMarkdown` + `parseMarkdown` (current behavior). Malformed → text still arrives as stacked blocks.

## 3. Rendering / editing — the refactor

Refactor `src/components/page-editor-body.tsx` so per-block editing machinery is reusable inside a column.

Extract a `<BlockStack>` component defined in the same file (no new file — this keeps the "one renderer" invariant):
- Props: `blocks: Blk[]`, `setBlocks(next: Blk[]): void`, `locked: boolean`, `insideColumn: boolean`, `focusRegistry` (refs), plus optional hooks the top level uses (drag, marquee, multi-select). When `insideColumn` is true these hooks are disabled and the drag handle is inert with `title="Reordering inside columns arrives next"`.
- Renders the existing `<BlockRow>` per block. Handles Enter/split, Backspace/merge, slash menu, markdown shortcuts, per-block type changes, todo toggle, toggle-block open — all the current logic, moved from `EditableBody` into `BlockStack`.
- Backspace at column-first-block offset 0 → does nothing (early return when `insideColumn`).
- Enter at end of last block → appends within its own array.

`EditableBody` becomes: state owner (blocks, selection, drag), renders one top-level `<BlockStack insideColumn={false}>`. The columns block is rendered by `BlockContent` (via BlockRow) as:
```
<div class="cols" style="display:grid;grid-template-columns:repeat(N,minmax(0,1fr));gap:20px">
  {cols.map((col, i) =>
    <BlockStack key={i} blocks={col} setBlocks={next => onColumnChange(i, next)} insideColumn locked={locked} />
  )}
</div>
```
plus a `@media (max-width: 900px)` rule (added to `styles.css`) that collapses `.cols` to a single column.

`onColumnChange(i, nextBlks)` mutates the enclosing columns block's cols array and commits via the existing debounced writer. No second write path.

## 4. Slash menu

Extend `BLOCK_MENU`? No — the col entries are a separate array `COLUMNS_MENU` (five entries `/col2`…`/col6`, icon glyph `▥`, description "N columns"). The slash menu filter concatenates `BLOCK_MENU + COLUMNS_MENU` at top level only. When `insideColumn`, only `BLOCK_MENU` is used.

Selecting a `/colN` entry replaces the current block with a `columns` block whose cols are N seeded columns of one empty text block; focus moves to `cols[0][0]`.

Turn-into path (block handle menu) also excludes columns entries inside a column.

Paste handler: if the top-level paste yields blocks containing a columns block AND the target block is inside a column, flatten those into stacked blocks before inserting (never nest).

## 5. Tests

Files: `src/lib/columns.test.ts` (new), extend `src/lib/export.test.ts` and `src/lib/html-to-markdown.test.ts`.

- validateColumnsCols: accepts 2..6, rejects 1 and 7, rejects nested columns.
- blockToMarkdown on columns: flatten both columns in order, blank line between.
- toHtml on columns: emits `repeat(N,minmax(0,1fr))` grid, contains both columns' content, user text escaped.
- htmlToBlocks: Notion `<div class="column_list"><div class="column">…</div><div class="column">…</div></div>` → one columns block, correct N, content preserved.
- htmlToBlocks: malformed input → returns null; caller path still yields the text as stacked blocks.

## 6. Required evidence

Included in the report:
a) `rg -n "'columns'|\"columns\"" src/lib/types.ts src/lib/blocks.ts src/lib/columns.ts`
b) `rg -n "col2|col3|col6" src/components/page-editor-body.tsx`
c) `bun run build` — full raw tail
d) `bunx vitest run` — full raw tail with new test names
e) "What I did NOT do" — explicitly lists drag / marquee / arrow-nav across columns as deferred.

## Risk to flag before starting

Extracting `<BlockStack>` from `EditableBody` touches the drag, marquee, and per-block keyboard code. I'll keep the drag/marquee/selection machinery attached at the `EditableBody` level (they read from `rowEls` which BlockStack still populates for the top level), and pass `insideColumn` to opt those signals out inside columns. If, during the refactor, the marquee/drag logic needs to change more than trivially, I'll stop, report what needs to move, and ask before continuing — rather than half-migrate.

Approve and I'll build.
