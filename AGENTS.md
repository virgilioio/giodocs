<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Gio Docs — standing rules for every agent task

These rules apply to EVERY task in this repository, whether or not the
message repeats them. When a task message conflicts with this file, ask
before proceeding.

## Ownership and portability
- The backend is the project owner's own Supabase project. NEVER enable
  Lovable Cloud or any Lovable-managed database, auth, storage, or
  secrets store.
- Every schema change is a new migration file in supabase/migrations/.
  Never apply SQL any other way. Never edit an already-applied migration.
- Only src/integrations/supabase/client.ts creates a Supabase client.
  The auto-generated files client.server.ts, auth-middleware.ts and
  auth-attacher.ts may exist (they regenerate on integration sync) but
  must never be imported from client-reachable code. Do not delete them;
  do not edit them. scripts/check-server-only.mjs and
  scripts/check-bundle.mjs enforce this at build time.
- No Lovable-specific packages, env vars, or hosting config beyond what
  already exists. The app must build and run from a plain git clone with
  only VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY set.

## Stack
- TanStack Start in SPA mode (spa: { enabled: true } in vite.config.ts).
  Never reintroduce defaultSsr or any SSR rendering path.
- Tailwind v4. Every design token lives in the @theme block in
  src/styles.css. Never create a tailwind.config.ts. Never write a raw
  hex colour, raw px font size, or a Lato weight other than 400/700 in
  src/ — scripts/check-tokens.mjs enforces this.
- TanStack Query for all reads. No fetching inside useEffect. List
  queries never select("*") — blocks is fetched only by usePage(id).

## Product model (the thesis — protect it)
- ONE content object: Page. No page_type, no kind, no is_database, no
  per-content-type tables, ever.
- A "database" is a saved query (a view). A view stores a filter, never
  a list of page ids.
- There is NO folder tree. A page's location is its area property. Areas
  are derived from page properties — never a table, never authored.
- "Placed in": a page can sit inside another page (pages.parent_id), at
  most three levels deep, guarded by guard_page_parent. Deleting a page
  un-places its children; it never deletes them. This is placement, not a
  folder tree: the sidebar and views still organise by properties.
- Freshness is first-class: verified_at is never touched by an edit;
  edited_at is never touched by a verification. The touch_page trigger's
  WHEN clause (title, blocks, props, icon) is what guarantees this.
- View filtering happens in EXACTLY one place: src/lib/run-view.ts.
  Never add a server-side filter compiler or a second engine.
- Deleting a page is soft (deleted_at). There is deliberately no DELETE
  policy on pages. Do not add one.
- Images live in the private page-images Supabase bucket, addressed by
  storage path. Access goes through can_read_page, so image permissions
  can never drift from page permissions. Never store a signed URL,
  base64 or a blob in the blocks column.
- Only workspace owners publish team views — enforced by views_update
  RLS and publish_view(). Members fork to personal copies instead.

## Scope (exclusions — do not build)
Folder trees, AI features, public sharing on the open web, real-time
co-editing cursors, dark mode, multi-workspace UI.

Lifted by Allan on 2026-10-09: @mentions (people and pages), comments,
in-app notifications (an inbox) and templates are now in scope. Email
notifications come later, through a Supabase Edge Function and the email
provider Virgilio already has; don't build them until asked.

## Decisions (Allan, 2026-10-09)
- Properties: any member can create a property and edit its label and
  options; only workspace owners remove one, and removing is an ARCHIVE
  (hidden, values kept, restorable). A property is deleted outright only
  when no page has a value for it. Keys never change; a type changes only
  while no page has a value. Built-in properties can't be archived or
  retyped. Enforced in the database (guard_property_def, RLS).
- Options change one at a time through add_property_option /
  rename_property_option (row-locked). Never write a whole options list
  from the browser. An option value pages use can't be removed; renaming
  keeps the value. Members can't change built-in option lists.
- validate_page_props checks only the properties an update changes, so a
  stale value never locks the rest of a page.
- views.group_by is "the property the layout is organised by": a select or
  status for a board, a date for a calendar. Each layout falls back to one
  that fits; copying a view keeps it.
- New pages are private to their creator (access_type 'restricted' with the
  creator as the only editor). Sharing with more people or with everyone in
  the workspace is a separate, explicit step. Existing pages keep their
  access. The app sends access_type 'restricted' and the
  pages_grant_creator_access trigger makes the creator an editor. The
  column default is still 'workspace' until the new app is published from
  Lovable; then a migration flips it. Create pages with a client-generated
  id and no RETURNING (insert, then select): the creator's access row is
  added after the insert, so an insert...select would fail RLS.

## Decisions (Allan, 2026-10-10: history, mentions, inbox, comments, templates)
- Page history restores through restore_page_from_version only: it checks
  edit access, saves the current content as a version first (its id is
  the Undo) and restores title, icon and blocks. Properties are never
  restored. restore_page_version is no longer callable.
- Mentions are inline source: "@[Name](user:<uuid>)" and "@[](page:<uuid>)".
  The one grammar rule is in inline-tokens.ts (before links); chips are
  atoms like custom emoji. What a chip shows comes from the mention
  directory (src/lib/mention-directory.ts, filled by app-shell). A page
  mention never stores a title, and a page the reader can't open reads
  "Private page". page_backlinks (as the caller) feeds "Linked from".
- The inbox is the notifications table. Only database code writes it
  (pages_notify_mentions, add_comment); people read and mark read their
  own rows. Only people who can open the page are notified, never the
  writer, and a notification failure never blocks a save. Email comes
  later from these rows.
- Comments: anyone who can open a page reads and adds comments; authors
  edit and remove (soft, with Undo) their own; anyone who can open the
  page resolves. All writes go through the comment functions.
- A template is a page in a state (pages.template_at), like an archived
  page: not a page kind. Templates leave views and page lists, stay in
  search, and are offered on a blank page and from the template banner.
  Starting from one copies blocks (new ids), icon, title and properties
  (the page's own properties win), and copies its images and files into
  the new page's storage folder so the new page's readers see them.
- Who can change a page (pages_guard_edit / can_edit_page_row, every
  path): a member on a workspace page shared to edit, a workspace owner,
  or anyone with edit access on the page. A workspace page shared as
  view-only is read-only for everyone else, and the app shows it
  read-only ("View only"). Verifying stays open to readers.

## Working agreement
- Build ONLY what the task message asks. Never scaffold ahead.
- Finish every task by listing exactly which files changed, then stop.
- If something fails, report the exact error and stop — do not work
  around it silently.
- Vocabulary in code and UI: Page, Property, View, Area, Block,
  Verified, Team view. Never: doc, record, field, column, database,
  folder, space, element, approved.

## Motion and feel (2026-10-10)
Gio Docs follows the Gio motion standard shared with Gio Sales and Gio ATS
(timing, easing, origins, robustness) and keeps its own look. Use these
pieces; don't add per-component animation values.
- Tokens: `--ease-out`, `--ease-in-out`, `--ease-drawer`, `--ease-spring`,
  `--dur-*` and `--animate-*` in src/styles.css. Menus enter at 180ms from
  scale .96 and grow from their trigger (set `transform-origin`); dialogs
  220ms from their centre. Exits are faster than entrances. The command
  palette is never animated. Never `transition: all`, never `ease-in`,
  never animate `left`/`width` for movement (use transform). Reduced motion
  keeps opacity and colour, drops movement.
- Centred dialogs use the `translate` property, not `transform`, so the
  scale-in composes with the centring.
- Exits: overlays opt in with a ref from src/lib/exit-motion.ts —
  `exitOnly("pop" | "dialog" | "fade")`, or `exitRef(kind, otherRef)` when
  the element already has a ref. A scrim that contains its card marks the
  card `data-motion-card`. Only on positioned overlays (fixed/absolute),
  never on in-flow content.
- Toasts: `useToast().push` (src/lib/toast.tsx) — bottom centre, pause on
  hover and hidden tab, polite live region.
- Tooltips: write `title` (and `aria-label` on icon-only controls);
  src/lib/tooltips.ts shows a styled tooltip after 400ms on controls and on
  text only while it is cut off. Don't build per-component tooltips.
- No layout shift: bars and banners float (sticky/absolute) instead of
  pushing content; bold-when-active labels use `.gio-stable-bold` with
  `data-label`; images hold their shape while loading.
- Buttons with `bg-btn`, bordered `border-line bg-surface` buttons, or
  `.gio-press` get press feedback automatically.
- Focus: `:focus-visible` outline from styles.css; a text field that
  removes the outline must show focus another way (`focus:border-accent`).
- Editor drag: block drags start after 4px; a click on the grip still opens
  the block menu. Board drops into the same column write nothing.
