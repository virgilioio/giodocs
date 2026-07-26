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

## Next-phase acceptance

Team view fork: opening a team view as a non-owner exposes a "Fork to My
views" action that calls fork_view() and navigates to the new personal
view; owners still see Publish/Edit affordances on their own team views.

## Phase order (remaining)

team-view fork rule (SHIP) → board + list layouts → page editor →
command palette → settings → realtime.

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
- Body renders all 12 block types read-only: text, h1, h2, bullet,
  numbered, todo (disabled checkbox), toggle (`<details>`), quote
  (Lato italic, left border), callout (icon + sunken card), divider
  (`<hr>`), code (mono, sunken, horizontal scroll), table (rows[][],
  first row is header). Unknown types render text and `console.warn`
  once. Empty body → centered "This page has no body yet." + subtle
  "Blocks arrive in the next phase."
- Table PageTitleCell: title click navigates via `useSetPageOrigin` +
  `useNavigate`, hover reveals ✎ pencil on the right that switches to
  the inline rename input; double-click also triggers rename.

Playwright end-to-end verification against Allan is not runnable in this
sandbox — `LOVABLE_BROWSER_AUTH_STATUS=external_unmanaged` means no
session can be minted for the user's own Supabase project. The four
build gates (typecheck, vitest 13/13, token+server-only guards,
production build+bundle guard) all pass; live verification is deferred
to preview.

## Page editor (Part B) — 2026-07-26

Body is editable. Each block is its own auto-growing textarea (or `<input>`
per cell for tables). No contenteditable anywhere. Block ids are minted
with nanoid on creation and preserved through splits/merges.

- Title is an auto-growing textarea styled as before. Enter moves focus
  to the first body block, creating one if the page was empty.
- Every "New page" entry point (view header, area ⋯ menu, sidebar area
  +) now routes through `useCreatePageAndOpen`: create → navigate to
  `/p/{id}` → focus title (via `sessionStorage["gio.focus-title"]`).
- Key handling in body blocks: Enter splits at the caret (list types
  inherit; empty list item converts to text); Backspace at position 0
  converts non-text to text, merges empty text into previous, never
  drops content; ArrowUp/Down at first/last line move focus across
  blocks; Escape blurs.
- Markdown shortcuts on empty text block: `# `, `## `, `- `, `1. `,
  `[] `/`[ ] `, `> `, ` ``` ` transform the block and consume the prefix.
- Interactive chrome: todo checkbox toggles + strike-through when done;
  toggle chevron persists `open`; callout icon opens a 12-emoji picker;
  table cells are single-line inputs with hover-only + row / + column
  affordances.
- Slash menu: typing "/" opens a portalled 324px popover anchored under
  the caret, filterable by name, ArrowUp/Down + Enter to apply, Escape
  closes. Bottom "Search all blocks…" row is deliberately inert.
- Gutter (`left:-42px`, hover-only): `+` inserts an empty text block
  below and focuses it; the six-dot handle is present but inert with
  title "Reordering arrives next phase".
- Empty body renders a "Click to start writing." affordance that
  appends and focuses a text block.
- Persistence: `useUpdateBlocks` writes `pages.blocks` whole via a
  500ms trailing debounce. Exactly one request in flight per page —
  new edits during a send queue only the latest snapshot, then fire
  a single follow-up on settle. The `touch_page` DB trigger bumps
  `edited_at` server-side; `verified_at` is untouched by any edit
  because its WHEN clause excludes verified_*. Topbar shows
  "Saving…" after 1.2s of continuous pending state and flashes
  "Saved" for 1.5s on settle.

Build gates: tsgo clean, vitest 13/13, check-tokens + check-server-only +
production build + check-bundle all green. Live verification is deferred
to preview because `LOVABLE_BROWSER_AUTH_STATUS=external_unmanaged`
prevents session minting for the user's own Supabase project.

## Next-phase acceptance

Blocks reorder by dragging the handle; the page ⋯ menu works.

