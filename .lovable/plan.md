
# Unify the two block-editor implementations

## Deliverable

One shared hook `src/lib/use-block-editor.tsx` that owns every interaction on a linear list of blocks. Both `EditableBody` (page scope) and `ColumnStack` (column scope) become thin renderers over it. The three second copies of `splitBlock`, `mergeIntoPrev`, `convertToText`, `removeBlock`, `insertAfter`, `tryMarkdown`, `applyType`, the slash-menu state, the focus-request effect, and the ordinal map are deleted from `ColumnStack`. No new features — only closing your audit's divergences.

## Files touched

- `src/lib/use-block-editor.tsx` — NEW. The hook.
- `src/lib/block-editor-decisions.ts` — NEW. Pure decision helpers (`resolveArrowNav`, `resolveBackspace`, `resolvePasteAt`, `applyMarkdownShortcut`) so the parity test can run one input through both scopes.
- `src/lib/block-editor-decisions.test.ts` — NEW. Table-driven parity test: same input, page and column scope, identical output except the four intended differences.
- `src/components/page-editor-body.tsx` — MAJOR. `EditableBody` and `ColumnStack` both call `useBlockEditor`. Everything drag/marquee/selection/undo-orchestration/keyboard-global stays where it is (top level only, unchanged). Second implementations deleted, not commented out.
- `src/lib/enter-behaviour.ts` — untouched (already pure; consumed by the hook at both scopes).
- `src/lib/block-nav.ts` — untouched (consumed by the hook at both scopes).
- Existing tests: unchanged, all must stay green.

Nothing outside the page body changes. No route, no query, no schema, no CSS.

## Hook shape

```ts
type Scope =
  | { kind: 'page' }
  | { kind: 'column'; parentBlockId: string; colIndex: number };

useBlockEditor({
  blocks, setBlocks,      // list ops write here; parent decides how to commit/undo
  locked,
  scope,
  bridge,                 // ColumnBridge | null; only consulted at column scope
  onCommitStructural,     // page: pushes an undo snapshot; column: parent handles via propagated { cols } patch
  onFocusExit,            // page: focus title; column: focus block-before-columns (or title if first)
}) => {
  refs,                   // Record<blockId, HTMLTextAreaElement | HTMLInputElement | null>
  focusedId, setFocusedId,
  slash, menuIdx, filteredMenu, openSlash, closeSlash, moveSlash, pickSlash,
  onKeyDown(block, e),    // full behaviour surface
  onInput(block, val),
  onPaste(block, e),
  onChange(block, patch),
  splitBlock, mergeIntoPrev, convertToText, removeBlock, insertAfter,
  ordinalMap,
  duplicateFocused,       // ⌘D
}
```

## The four INTENDED differences, parameterised

1. **Slash menu contents** — `scope.kind === 'page'` shows `BLOCK_MENU + COLUMNS_MENU`; column shows `BLOCK_MENU` only. `applyType('columns')` is refused unconditionally.
2. **Backspace at index 0** — page: `mergeIntoPrev` if non-empty; column: no-op (never crosses a column).
3. **Enter on empty last block** — page: `splitBlock` behaviour; column: `enterAction` → `escape-column` (unchanged from today).
4. **ArrowUp from first block / boundary crossings** — page: `onFocusExit` focuses title. Column: `onFocusExit` focuses the top-level block immediately before the parent columns block (or the title, if the columns block is first). Both use `nextEditableIndex` internally.

Every other row in the divergence table converges by construction — same code, one call site.

## Divergences closed by this refactor

- **⌘V multi-line/markdown paste inside a column** (highest priority; unblocks the Notion migration). `onPaste` runs `htmlToBlocks` / `parseMarkdown` and splices the resulting blocks into the column at the caret, exactly as at page scope. If the parsed run contains a `columns` block, it is skipped (never nest).
- **ArrowUp / ArrowDown wrap-aware nav** in columns, including boundary crossing to top level via `bridge.exitColumn(direction)`.
- **ArrowLeft at offset 0 / ArrowRight at end** — same crossing rules.
- **Escape** — blurs at both scopes.
- **⌘D duplicate focused block** — works inside columns, scoped to that column's list.
- **Markdown shortcuts** — full set at both scopes: `# `, `## `, `### ` → h2, `#### ` → h2, `- `, `1. `, `[] `, `[ ] `, `> `, ` ``` `, callout shortcut.
- **Block-handle click menu** — opens inside columns too, operating on that column's list.
- **Undo snapshots for column structural ops** — the hook calls `onCommitStructural` at column scope, which routes through the same `commit` → `pushUndo` path used at page scope. Typing coalesces on the existing 600ms/different-block rule via the `columnTypingHint` bridge, unchanged.

## What deliberately stays unchanged

- Drag/marquee registry, `ColumnBridge`, `columnTypingHint`, top-level `selectedIds` set, bulk bar, ⌘A stage-2 promoting to whole document from a column, global keyboard shortcuts, geometry, styles, focus-request effect semantics, `newBlock` defaults, `normalize`, `stripNestedColumns`, undo store, real-time patching. Column-scoped block selection remains unsupported.

## Parity test

`block-editor-decisions.test.ts` builds one fixture list and runs a table of `(key, scope, blockIndex, caret, text) → expected op`. Every row must produce identical output at both scopes, except four rows explicitly tagged `intended-diff` for the four cases above. This is what stops the two implementations drifting again.

## Staging inside the single response

1. Write the two new lib files and their test. Run `bunx vitest run` on them alone — must pass before touching the component.
2. Rewrite `EditableBody`'s onKeyDown/onInput/onPaste to call the hook; keep top-level-only responsibilities (drag, marquee, selection, undo commit, global shortcuts, title focus) inline. Run full build + full vitest.
3. Rewrite `ColumnStack` as a thin renderer. Delete the second copies. Run full build + full vitest.
4. Verify the eight-row divergence table now reads SAME/INTENDED end-to-end.

## Risk and honest caveats

- This is a large edit to a load-bearing file. I will preserve behaviour by keeping the hook's `onKeyDown` structurally identical to today's page-scope handler, then parameterising only the four intended differences — not by rewriting from spec.
- If any row cannot be unified cleanly (e.g. undo coalescence at column scope depends on parent-owned commit boundaries in a way the hook cannot express without leaking), I will leave it DIFFERENT with a written reason rather than fake it, per your instruction.
- Column-scoped multi-block selection stays out of scope.
- The file will shrink materially (rough estimate 3273 → ~2500 lines) but I will not target a line count; I will target zero duplication.

## Approval question

Confirm: proceed as written, or adjust the hook boundary / staging first. I want your sign-off on the shape before I touch `page-editor-body.tsx`, because unwinding a bad extraction is more expensive than agreeing on it now.
