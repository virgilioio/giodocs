# Gio Docs — build state

Last updated: 2026-07-25 (after table + toolbar phase).

## What exists and how it was verified

| Piece | Status | Verified by |
|---|---|---|
| Schema: 9 tables, 4 enums, no forbidden columns | Done | information_schema query against live DB |
| Indexes, search vector (english), validation triggers | Done | live insert/update probes |
| Freshness invariant (verify ≠ edit, both directions) | Done | cross-transaction timestamp probes |
| RLS: 21 policies, no pages DELETE policy | Done | pg_policies query |
| Owner-only team-view publish | Done | views_update USING+WITH CHECK inspected |
| 8 app functions + 3 helpers; NO run_view | Done | pg_proc query |
| Grants: domain_status is the only anon-callable function | Done | has_function_privilege sweep |
| Signup trigger + domain_status (SECURITY DEFINER, pinned path) | Done | pg_proc prosecdef check |
| Seed: 7 users (incl. allan@virgilio.tech, owner), 22 pages, 7 views, 11 property defs; Allan personal views + Compensation bands grant; edited_at spread + Recently edited window in migration | Done | count + content queries; migration seed_allan_views_access_and_edited_spread |
| Auth-token repair (GoTrue NULL-token bug) | Done | column diff vs working user; login confirmed |
| Login screen + domain recognition + sign-out | Done | user-confirmed in browser |
| Build guards: check-tokens, check-server-only, check-bundle (JWT-decoding) | Done | full build green |
| Data layer: query keys, hooks, useWorkspaceShell | Done | build green |
| run-view.ts single filter engine + groupPages | Done | 13 vitest tests + independent SQL cross-check |
| Shell + sidebar: workspace-context, AppShell, /v/$viewId, /a/$area, collapsible rail, footer sign-out, amber-dot stale, derived areas, invalid-filter "!" guard | Done | Playwright signed in as Allan: all 7 view counts + 5 area counts match acceptance, default redirect lands on /v/<Assigned to me>, 3 amber dots on stale pages under expanded areas, collapse drops sidebar to width 0, all four build checks + 13/13 vitest green |
| Table view: view header (scope label, name, layout switcher, New page), query toolbar ("Pages where" chips + × remove, + Filter popover for props/Stale/Edited within, sort), responsive 7-column table (Page inline rename, Area/Owner/Status/Tags popover pickers, Verified w/ amber-stale, Edited) | Done | Playwright as Allan: Priority: P0 shows 2 rows, Assigned to me shows 5 rows matching sidebar count; changing owner to "No owner" drops row and updates sidebar count 5→4 in one tick |
| Mutations: use-page-mutations.ts with useSetPageProperty (set_page_property RPC), useRenamePage, useCreatePage; optimistic cache patch on shell/pages/views; membership-diff toasts ("Added to…" / "Left…") stacked via ToastProvider | Done | Playwright reassignment triggers row remove and sidebar count decrement optimistically before server ack |
| Design fidelity pass: view icon column + seeded 🗂/📓/🔍 icons on personal views; area emojis merged into property_defs.area options; sidebar section collapse w/ localStorage; view/area hover ⋯ menus (rename/duplicate/publish/delete; fork; open/show/new page/rename/save-as-my-view); footer account dropdown (workspace card, Settings/Invite disabled, current-workspace check, Log out); topbar two-segment breadcrumb; PERSONAL VIEW/TEAM VIEW/AREA copy; "{n} pages" small count; "+ New page" glyph label; toolbar divider + sort arrows glyph + inert options ⋯; "owner is you" chip copy; bold table titles; py-10px rows; compact relative dates w/ weeks bucket; view mutations useCreateView/useUpdateView/useDeleteView/useForkView | Done | tsgo clean, 13/13 vitest, check-tokens + check-server-only green |


## Acceptance numbers for the sidebar

Sidebar counts must match exactly. If they differ, runView and the
database disagree — stop and investigate. **Acceptance numbers are
computed RLS-aware, as the signed-in user. Superuser counts are not
acceptance numbers.**

| View | Scope | Expected | Rendered (Allan) |
|---|---|---|---|
| Engineering docs | team | 5 | 5 ✓ |
| Hiring pipeline (board by stage) | team | 7 | 7 ✓ |
| Priority: P0 | team | 2 | 2 ✓ |
| Q3 goals | team | 3 | 3 ✓ |
| Assigned to me (as Allan) | personal | 5 | 5 ✓ |
| Needs review | personal | 3 | 3 ✓ |
| Recently edited (30d) | personal | 10 | 10 ✓ |

Areas (derived): Design 3 ✓ · Engineering 5 ✓ · Hiring 7 ✓ · Ops 3 ✓ · Product 4 ✓.

Default redirect from "/" lands on /v/a11a0000-0000-4000-8000-0000000000b1 (Assigned to me), Allan's first personal view by position.

## Known debts (deliberate, tracked)

1. @lovable.dev/vite-tanstack-config wraps the entire vite plugin chain.
   Publicly installable (verified), so portable today. Eject before
   production launch; the hand-written equivalent config should be
   captured in docs/vite-config-eject.md when convenient.
2. Dev password GioSeed!2026 appears in migration files synced to
   GitHub. Rotate all seeded users (especially allan@) before any real
   data enters the workspace.
3. Nitro emits Cloudflare wrangler config by default. Harmless while
   output remains a static client bundle; revisit at deploy time.

## Parked decisions

- Page appearance toggles — Font (Default / Serif / Mono), Small text,
  Full width, Lock editing — await a storage decision. Currently held in
  in-memory PreferencesProvider only; they do not persist across reload
  and are not per-user or per-page. Choice: local (localStorage per
  device), per-user (profile row), or per-page (page property). Blocked
  on that call.
- Block-handle click menu (Turn into / Duplicate / Move up / Move down /
  Delete per block) is not built. The six-dot handle is a drag grip
  only; plain click clears selection, shift-click extends selection.

## Phase order (remaining)

Remaining work is confined to this file: any items called out in
"Next-phase acceptance" below and the parked decisions above.


## Page editor (Part A) — 2026-07-26

Route `/p/$pageId` renders inside the authenticated shell. Header column
is 780px with 42/44 padding. Reads only — no editing affordances beyond
verify and the property-row × removal.

- Topbar on `/p/*`: back-arrow + originating view/area name (fall back
  "All pages"). Right group: `Edited {rel}` (text-meta text-muted),
  copy-link button (⌘⌥L, toast "Link copied"), and an INERT ⋯ with
  title "Page actions — next phase". `verify_page` never touches
  `edited_at` (touch_page trigger's WHEN clause excludes verified_*),
  so the edited stamp is stable across a Still-accurate click.
- Header order: 44px emoji · display title · permissions pill · edited
  stamp · freshness banner (fresh / stale / just-verified — 2.6s hold) ·
  properties strip · lineSoft divider.
- Permissions pill counts only rows in `page_access` with `user_id` set
  (`Only {n} people` variant). Compensation bands shows `Only 4 people`.
- Property strip: Area · Owner · Status · then `property_defs.position`
  order of any other present properties, then read-only Last verified.
  Non-system rows show a × on hover next to the label; system rows
  (area, owner, status, tags) do not.
- Add-a-property popover: `multi_select` / `checkbox` / `text` seed the
  row with an empty-typed value the `validate_page_props` trigger
  accepts. `select` / `status` / `number` / `date` are disabled with
  title "Set a value in the next phase" because the trigger rejects
  their empty-typed seeds — those show up in Part B where the row lets
  the user pick a value inline.
- Body renders all 12 block types read-only.
- Table PageTitleCell: title click navigates via `useSetPageOrigin` +
  `useNavigate`, hover reveals ✎ pencil on the right that switches to
  the inline rename input; double-click also triggers rename.

## Page editor (Part B) — 2026-07-26

Body is editable. Each block is its own auto-growing textarea (or `<input>`
per cell for tables). No contenteditable anywhere. Block ids are minted
with nanoid on creation and preserved through splits/merges.

- Slash menu, markdown shortcuts, split/merge, todo/toggle/table
  interactions, gutter `+` insertion — all wired.
- Persistence: `useUpdateBlocks` writes `pages.blocks` whole via a
  500ms trailing debounce. Exactly one request in flight per page —
  new edits during a send queue only the latest snapshot, then fire
  a single follow-up on settle. Flush on blur, route change, and
  `beforeunload`/`pagehide`.
- Topbar shows "Saving…" after 1.2s of continuous pending state and
  flashes "Saved" for 1.5s on settle.

## Chunk 4 — Page ⋯ menu (2026-07-26)

Group A: visibility, area (via `set_page_property`), verify (still
accurate). Group B: Copy link (⌘⌥L), Duplicate (⌘D), Export (row 5,
see Chunk 5), Archive (`archived=true`), Delete with 10-second Undo
toast — `useDeletePage` optimistically removes across shell/pages/views
caches; `useRestorePage` re-inserts when the toast action fires.
`useWorkspaceShell` filters `deleted_at IS NULL` and archived pages so
counts stay honest. No pages DELETE policy — deletion is soft.

Verified: tsgo clean, vitest green, check-tokens + check-server-only +
production build + check-bundle all green. Pointer QA (undo timing,
optimistic decrement in sidebar) is user-pending in preview.

## Chunk 5 — Export page (2026-07-26)

`src/lib/export.ts` — pure browser-side functions covering all 12 block
types: `toMarkdown`, `toHtml` (self-contained with inline styles),
`printPdf` (window.open + `print()`). `src/components/export-dialog.tsx`
is a 460px modal with Format (PDF/HTML/MD), Paper size, and Scale;
choices persist in localStorage. Menu row "Export" sits after Copy link.

`list_areas` RPC updated in the same migration to exclude archived
pages so area counts stay in sync with the shell filter.

Verified: 10 export unit tests in `src/lib/export.test.ts`, all four
build gates green. File-download / print-dialog QA is user-pending in
preview (browser file APIs cannot be driven from this sandbox).

## Chunk 6 — View ⋯ menu + Export view (2026-07-26)

View header ⋯ menu with scope-aware entries: Personal view (Rename,
Duplicate, Publish to team [owners only], Export, Delete), Team view
(Rename [owners], Duplicate to My, Unpublish [owners], Export, Delete
[owners]), Area (Rename [inert — areas are derived], Export). Inline
rename on double-click of the view title. `useUpdateView` extended to
allow `scope` toggles for publish/unpublish.

`toCsv` and `toMarkdownTable` added to `src/lib/export.ts` with
`ExportViewDialog` (CSV / Markdown table over the current `runView`
result), resolving owner display names off the workspace member list.

Verified: 33 unit tests total (including CSV/MD-table cases in
`src/lib/export.test.ts`), all four build gates green. File-download
QA is user-pending in preview.

## Chunk 7 — Block drag + multi-select (2026-07-27)

`src/lib/reorder.ts` — pure `moveBlock`, `moveRun`, `deleteIndices`,
covered by 10 unit tests in `src/lib/reorder.test.ts`. Wired into
`src/components/page-editor-body.tsx`: pointer-capture drag session
starting from the six-dot handle, midpoint gap computation, 8px/frame
auto-scroll inside the app-shell scroll container near a 48px edge
band, an absolutely-positioned 2px `--color-accentDot` drop indicator,
Escape cancels a drag without committing. Shift-click on the handle
extends a contiguous selection; plain click clears it; focusing a
textarea/input clears selection. Delete/Backspace with a selection
removes those blocks (auto-inserting one empty text block if the page
would become empty). A sticky selection bar (portalled to body) shows
count + Delete + Dismiss, styled with the `--shadow-toast` token and a
`.bar-btn` component-layer hover class (rgba(255,255,255,.12)) — no
noirHover token was introduced. Drops route through the existing
`commit` path, so `useUpdateBlocks` debounce + flush semantics are
unchanged.

Verified: 43/43 vitest, tsgo clean, check-tokens + check-server-only +
production build + check-bundle all green. Pointer-interaction QA
(drag, auto-scroll, shift-range, Delete-clears-to-one-block) is
user-pending in preview.

## Chunk A — Popover portal + table rows + view ⋯ (2026-07-27)

Popover repositioned to a body-portal (`createPortal(document.body)`
with dynamic anchor-based positioning) so popovers no longer clip
against the table's `overflow-x-auto` ancestor. Table rows enforced
single-line with truncation ellipsis via strict `table-layout: fixed`,
per-column widths, and `text-overflow: ellipsis`. Stray inert ⋯ was
removed from `ViewHeader`.

Verified: tsgo + vitest + all 4 build gates green.

## Chunk B1 — Sentence toolbar + intent pickers (2026-07-27)

Query toolbar rebuilt as a flex-wrap "Pages where … sort by …" sentence
row. `src/lib/filter-label.ts` centralises the human phrasing for every
filter chip (`filterLabel`) with 11 vitest cases. Sort and group
pickers reworked as intent-based popovers; `explainQuery` defaults to
`true`. Native `<select>` elements in the export dialogs were swapped
for the shared portalled product popover.

Verified: 11 new `filter-label.test.ts` cases + full build gates.

## Chunk B2 — View draft model + MODIFIED (2026-07-27)

`src/lib/view-drafts.ts` holds per-session drafts keyed by view id.
Personal views write filter/sort/group/layout changes through to the
DB. Team views and area views never mutate stored state: their edits
land in an in-memory draft that survives navigation but not reload.
An amber "MODIFIED" pill sits in the view header when the running
query differs from the saved view; the "Save as my view" toolbar
banner forks via `fork_view()` and navigates to the new personal
view. Original ship-gate item — done.

Acceptance 13 (two-browser drift check — that a team-view edit made
in browser A never propagates to browser B on the same view) is the
only remaining acceptance item and is user-pending: this sandbox
cannot host two independent authenticated browser sessions in one
run.

Verified: 5 new `view-drafts.test.ts` cases + full build gates.

## Chunk C — Shared emoji picker (2026-07-27)

`src/components/emoji-picker.tsx` — one curated grid + custom input
using `Intl.Segmenter` for the three write paths: page icon
(`useSetPageIcon` in `use-page-mutations.ts` with dual page-list /
page-detail cache patch), view icon (My Views row slot + view header
menu "Change icon" submode, both through `useUpdateView`), and area
emoji (`useSetAreaIcon` composing `property_defs.options` via the
pure transform in `src/lib/area-icon.ts`).

Verified: 8 new `area-icon.test.ts` cases + full build gates.

## Chunk D — Dividers + marquee + copy-as-markdown (2026-07-27)

Divider rows are now selectable: `BlockRow` carries `data-block-id` and
`data-block-no-editor` and the divider render uses `py-2` for a real
hit target. A click on any no-editor row selects it via the existing
`selectedIds` state; the sticky bar, `Delete`/`Backspace`, and the
handle-drag path already covered removal and reordering — they now
just work for dividers too. The rule is: every block row is
hoverable, selectable, draggable, deletable regardless of whether it
has a text field.

Marquee lives on the editor container. A pointerdown that does not
land on a `textarea`, `input`, `button`, `[data-slash-menu]`, or
`[data-block-handle]` records an origin and target; under 4px of
pointer travel it is a click, at or over 4px it becomes a marquee
session. Marquee draws a fixed-position rectangle (`.marquee-rect`
in `src/styles.css`, portalled to `document.body`, background
`color-mix(blueTint 35%)`, border `color-mix(blueInk 40%)`,
radius 2, `user-select: none` on `body` while active) and live-selects
every row whose bounding rect vertically intersects the marquee band,
writing directly into `selectedIds`. Auto-scrolls the same
48px-band/8px-per-frame edge scroller as block drag, with its own
dir/raf refs so marquee and drag do not fight for one raf slot. On
pointerup the rectangle disappears but the selection persists — it
is the same `selectedIds` set the sticky bar, `Escape`, `Delete`,
and shift-click handle already consumed, so no parallel state track
was introduced. The trailing zone no longer intercepts `mousedown`;
it is a `data-trailing-zone` marker and the container pointer session
routes a no-drag click there to `onBelowClick` (append/focus).

Copy-as-Markdown: `blockToMarkdown(b)` extracted from `toMarkdown` in
`src/lib/export.ts`; `toMarkdown` now maps blocks through it and joins
with a blank line, preserving byte-for-byte output (existing suite
green). With a block selection active and focus outside any
`TEXTAREA`/`INPUT`/contentEditable, `Cmd/Ctrl+C` writes the selected
blocks in document order (blank-line joined) to the clipboard via
`navigator.clipboard.writeText` and toasts `Copied {N} blocks as
Markdown`; `Cmd/Ctrl+X` does the same then runs the existing
`deleteIndices` path. Focus inside a field is untouched so native
copy in text keeps working.

Verified: 43 → 71 vitest (14 export cases including new
`blockToMarkdown` div/table/todo direct tests + a proof that
`toMarkdown` embeds `blockToMarkdown(b)` for every block type), tsgo
clean, check-tokens + check-server-only + production build +
check-bundle all green. Pointer-interaction QA (click-vs-marquee
threshold, live selection during drag, auto-scroll, clipboard write
in the target browser) is UNVERIFIED-BY-ME and user-pending.



