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
- ONE content object: Page. No page_type, no parent_id, no kind, no
  is_database, no per-content-type tables, ever.
- A "database" is a saved query (a view). A view stores a filter, never
  a list of page ids.
- There is NO folder tree and NO nested pages. A page's location is its
  area property. Areas are derived from page properties — never a table,
  never authored.
- Freshness is first-class: verified_at is never touched by an edit;
  edited_at is never touched by a verification. The touch_page trigger's
  WHEN clause (title, blocks, props, icon) is what guarantees this.
- View filtering happens in EXACTLY one place: src/lib/run-view.ts.
  Never add a server-side filter compiler or a second engine.
- Deleting a page is soft (deleted_at). There is deliberately no DELETE
  policy on pages. Do not add one.
- Only workspace owners publish team views — enforced by views_update
  RLS and publish_view(). Members fork to personal copies instead.

## Scope (v1 exclusions — do not build)
Folder trees, nested pages, comments, mentions, notifications,
templates, AI features, public sharing, file uploads, real-time
co-editing cursors, dark mode, multi-workspace UI.

## Working agreement
- Build ONLY what the task message asks. Never scaffold ahead.
- Finish every task by listing exactly which files changed, then stop.
- If something fails, report the exact error and stop — do not work
  around it silently.
- Vocabulary in code and UI: Page, Property, View, Area, Block,
  Verified, Team view. Never: doc, record, field, column, database,
  folder, space, element, approved.
