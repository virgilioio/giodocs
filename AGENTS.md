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

## How work ships
- **"Go!" and "Apply!" (Allan, 2026-10-21):** after planning, Claude stops and waits for Allan's "Go!" before implementing. The work is tested and pushed to the working branch, then Claude reports what changed and waits for "Apply!" before pushing to `main` (which Lovable syncs from). Each "Go!" or "Apply!" covers the plan or change it answers, not the next one.

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

## Product model (Notion's structure — decided by Allan, 2026-10-10)

Superseded that day: the earlier thesis (one global pool of pages, views
as workspace-wide saved filters, areas as the organising axis, no tree).
It made a table impossible to own its rows, and two organising systems at
once. The decisions below replace it wherever an older section disagrees.

- ONE content object: Page. Everything is a page, including a database.
- The page tree is the navigation. pages.parent_id, any depth (cycle
  guard only). The sidebar shows the tree in two sections: Private (pages
  only you can open) and Workspace. There are no areas, no My views /
  Team views sections, no /a routes.
- A database is a page with is_database = true. Its direct children are
  its rows. It owns its properties (property_defs.database_id) and its
  views (views.database_id). A row belongs to exactly one database; a row
  is a full page and can hold child pages and inline databases of its own.
- pages.database_id is kept by trigger: the parent's id when the parent
  is a database, else null. A plain page (database_id null) has NO
  properties beyond the built-ins (Verified, Created, Edited); its props
  stay {}. validate_page_props checks a row's values against ITS
  database's properties, by (database_id, key).
- Property keys stay unique per workspace (the constraint is kept): a
  second "Status" in another database gets the key status_2. Labels are
  what people see, keys are internal. One relation index over every page
  and property therefore serves all databases (src/lib/relations.ts).
- Views belong to a database. Opening a database page shows its views as
  tabs (/p/<id>?v=<viewId>); /v/<id> redirects there. A view can be
  shared (scope "team": everyone who can open the database) or personal.
  Anyone who can edit the database page adds shared views; workspace
  owners can also change anyone's. This replaces "only owners publish".
- Views are still saved queries over the database's rows (filter, sort,
  config), never lists of page ids, and view filtering happens in EXACTLY
  one place: src/lib/run-view.ts.
- A database inside a page: a "view" block names a database_id. "/table"
  makes the simple grid (Notion's way); "Table view" makes a new child
  database and places it inline; "Linked view" places a view of an
  existing database. A grid's "Turn into database" makes a database from
  it (first column = title, the others text properties named by the
  header) and replaces the grid with its view; Undo brings the grid back
  and deletes the database.
- Moving a page (sidebar drag, Placed in) goes through move_page only: it
  needs edit access on the page and on where it goes, keeps the cycle
  guard, and sets the order among siblings (pages.position; unordered
  pages sort after, newest edit first). Into a database the page becomes
  a row; out of one it loses its properties; between databases values
  carry over to properties with the same name and type when they're legal
  there. It returns where the page was, and Undo passes that back. A drag
  never changes who can see a page, except a private page dropped at the
  top of Workspace, which is shared with everyone; a shared page isn't
  made private by a drag (that's Share's job).
- Children inherit access from their parent on creation: a row added to a
  shared database is visible to everyone who can open the database. A
  top-level page is private to its creator until shared.
- Deleting a page (soft, deleted_at) deletes its subtree with it, in one
  moment; restoring brings back what went with it. Deleting a database
  deletes its rows. There is deliberately no DELETE policy on pages.
- Freshness is first-class: verified_at is never touched by an edit;
  edited_at is never touched by a verification. The touch_page trigger's
  WHEN clause (title, blocks, props, icon) is what guarantees this.
- Images live in the private page-images Supabase bucket, addressed by
  storage path. Access goes through can_read_page, so image permissions
  can never drift from page permissions. Never store a signed URL,
  base64 or a blob in the blocks column.
- Duplicating a database goes through duplicate_database: the copy gets
  its live properties under new keys, the views the caller can see (keys
  rewritten), and the rows the caller can read. A relation inside the
  database is rebuilt between the copies; one to another database is
  copied one way. Duplicating a row keeps it in its database; a page
  inside a page stays inside it. Exporting a view writes the columns the
  view shows, in words; a page export lists its database's properties.
- Relations point at a database (config.database_id), both sides live in
  their own databases; rollups roll over a relation. Templates are rows
  of a database with template_at set.
- Migration of existing content (2026-10-10): one database "Pages" holds
  every page that was at the top level, with the old workspace-wide
  properties and views; pages placed inside others stay where they are
  as plain pages.

## Scope (exclusions — do not build)
AI features, public sharing on the open web, real-time co-editing
cursors, multi-workspace UI. (Dark mode was listed here, but the app has a
Light / Dark / System theme in Settings › Preferences; Allan, 2026-10-11:
keep it.) (Folder trees were excluded until
2026-10-10; the page tree is now the navigation.)

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
  access. The app sends access_type 'restricted', the column default is
  'restricted' too (since 2026-10-10), and the pages_grant_creator_access
  trigger makes the creator an editor. Create pages with a client-generated
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
- Custom emoji and mention chips are atoms (2026-10-11): contenteditable
  false, ONE rendered character in ce-offsets (ATOM), so the caret before
  and after one are different positions; Backspace/Delete remove it whole,
  and the caret is lifted out of an atom if the browser puts it inside.
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
  A copy (from a template, or Duplicate) carries only the values its
  database's properties can hold (keepStoredProps, 2026-10-11): rows can
  keep leftover values for properties their database doesn't have, and
  copying those would be refused as an unknown property.
- Who can change a page (pages_guard_edit / can_edit_page_row, every
  path): a member on a workspace page shared to edit, a workspace owner,
  or anyone with edit access on the page. A workspace page shared as
  view-only is read-only for everyone else, and the app shows it
  read-only ("View only"). Verifying stays open to readers.

## Decisions (Allan, 2026-10-10: view tables, Phase 1)
- views.config holds how a view shows its pages, separate from what it
  shows (filter, sort): the properties a table shows and their order
  (unset means the default set), widths, Calculate-row choices and the
  table's grouping. It's read defensively (src/lib/view-config.ts) and
  copied with the view (duplicate, fork, Save as my view). On team and
  area views these are draft changes like filters; resizing alone never
  marks a view changed.
- Built-in properties start with "@": @created, @created_by, @edited,
  @edited_by, @verified. Property keys start with a letter, so they never
  collide. Built-ins can be shown, sorted, filtered and grouped, never set.
- A sort is one spec or a list (the first wins, the next breaks ties); a
  single sort is still stored as one spec. Sorting is type-aware: options
  in their order, numbers as numbers, people by name, blanks last.
- A new pick of what a property is replaces its old filter; comparisons
  (above / below, before / after) add up into a range; tags add up.
- A page made from a view starts with what the view's current filters
  name and the group it was added to (src/lib/view-seed.ts), so it lands
  in that view.

## Decisions (Allan, 2026-10-10: Phase 2 — date ranges, relations, rollups, views in pages)
- A date property holds one day "YYYY-MM-DD" or a range "YYYY-MM-DD/YYYY-MM-DD"
  (validate_page_props checks it; the end is never before the start).
  Anything that reads one day reads the start. Filters match a period a
  range overlaps; before compares the start, after the end; a range is
  overdue once its end has passed.
- A relation property stores page ids. Its settings live in
  property_defs.config (view_id: offer only that view's pages; back: its
  two-way partner). The far side of a two-way relation (config.of) stores
  nothing: it's worked out from the near side, so the two never disagree,
  and a link made from the far side changes the other page. Both sides are
  created in one insert and archived together. Unlinking never drops a link
  to a page the reader can't open.
- A rollup (config: relation, target, calc) is worked out from the related
  pages and never stored. Worked-out values reach run-view through
  ctx.readValue (src/lib/relations.ts readValueWith); filtering still
  happens only in run-view.
- A view inside a page is a "view" block holding its own query and
  settings (src/lib/inline-view.ts), never page ids. It saves with the
  page; each reader sees the pages they can open; only page editors change
  it. Exports leave it out.

## Decisions (Allan, 2026-10-10: diagrams)
- A diagram is a code block in Mermaid: `lang: "mermaid"`, or no language
  and a first line that opens a Mermaid diagram (src/lib/diagram.ts, the
  one rule). A code block's language is picked from its corner (Notion's
  way); Mermaid draws it, Plain text (`lang: ""`) keeps any text as code. Mermaid (pinned) loads only when a page has a diagram and
  runs in strict mode. Markdown keeps it as a ```mermaid fence both ways.

## Decisions (Allan, 2026-10-10: simple tables, Notion parity)
- `/table` is the simple grid (a "table" block: rows of inline-markdown
  cells), as in Notion. Merging cells is deliberately not built.
- The table's ⋯ (top-right corner) holds Header row, Header column and
  Fit to page. Fit to page (`fit: true`) spans the page and treats
  `widths` as proportions; a resize then moves the border between two
  columns. A table without `widths` already fits; one with `widths` and no
  `fit` keeps exact widths. Exports follow the same rule.
- Cells are selected as one rectangle (src/lib/table-selection.ts): Esc in
  a cell selects it, drag or Shift+click/arrows grow it, a handle selects
  a whole row or column. On a selection: ⌘B/⌘I/⌘U/⌘E/⌘⇧S (a mark goes on
  every filled cell, or comes off when all have it), Backspace clears,
  ⌘C copies tab-separated text plus the cell sources
  (application/x-gio-cells), ⌘V pastes a grid from the top-left and grows
  the table, typing replaces the first cell. Inside a cell, keys edit text.
- Colours (text and background) live on the block as `colors: {cells:
  {"r,c"}, rows: {r}, cols: {c}}`, by palette NAME (src/lib/table-colors.ts,
  the callout palette plus gray), never hex. Cell beats row beats column,
  per property; colouring a row or column lifts that property off its
  cells. Every structural op goes through applyTableOp (table-ops.ts), so
  align, widths and colours follow their rows and columns. HTML/PDF carry
  colours; Markdown drops them.
- A cell can hold several lines: Shift+Enter breaks the line, Enter still
  moves down a row. "- " or "* " at a line start becomes "• "; "1. " is a
  numbered line; Shift+Enter continues a list and ends it on an empty
  item; Backspace right after a mark removes it (src/lib/cell-lines.ts).
  Marks are plain characters in the source. Markdown writes line breaks
  as <br> and reads them back; HTML/PDF break the line.
- The grid looks like Notion's: borders in line with the text column,
  header cells on `canvas` in normal case, body-size text.

## Decisions (Allan, 2026-10-10: type scale)
- Notion's scale. Page: title 40, H1 30, H2 24, H3 20, body 16 (Small
  text: 32 / 26 / 21 / 18 / 14). Interface: sidebar and menus 14, labels
  and table headers 12, captions 12. Tokens in styles.css (text-h1/h2/h3
  for heading blocks, text-display for the title, text-prose for body).
  Exports use the same sizes.
- Callouts (Notion's): 16px padding, 4px corners, 12px icon gap; since
  2026-10-18 they get the set-piece spacing (see "the black rail"). The block gutter (Notion's): 44px wide, a 24×24 + with a
  16px glyph, 2px, a 14×24 six-dot handle, 4px to the text, centred on the
  first line; quiet at rest, full colour with a soft wash when pointed at.
- `.gio-line` (the shared editable metrics) lives in the base layer so a
  block's size class wins over its inherits.

## Decisions (Allan, 2026-10-10: Home)
- Home (/home) is each person's start page: a greeting and Recently
  visited first; My tasks, pinned views and templates join it. "/" opens
  the start page they chose in Settings › Preferences (Home, the default,
  or the last page visited).
- page_visits holds one row per person per page, the last time they
  opened it. Only record_page_visit writes it (it checks the page can be
  opened); people read only their own rows. Recently visited shows the
  12 newest that are still in the pages list; ⌘K shows them when empty.
- home_prefs is each person's own row: the greeting's name and emoji,
  the start page, hidden sections and pinned views.
- A database becomes a task database through pages.task_config: which of
  its own live properties says done (status, select or checkbox, plus
  the done values), the assignee (person) and the due date (date). The
  guard_task_config trigger enforces it. It's set from the database's ⋯
  menu ("Turn into task database"), which can add a missing Status
  (Not started, In progress, Done), Assignee or Due date property.
- My tasks (Home) lists the open rows assigned to you in every task
  database you can open, grouped Overdue / Today / Next 7 days / Later /
  No date (src/lib/tasks.ts). Ticking one sets its done property (first
  done value, or checked) with Undo; adding one creates a row assigned to
  you in the chosen database.
- Home also shows views pinned from a view's ⋯ menu (Pin to Home, only
  you; home_prefs.pinned_views; each runs through run-view like the
  database does), the workspace's most recently edited pages, templates
  (start a page from one) and quick links. The ⋯ beside the greeting
  shows or hides each section (home_prefs.hidden).

## Decisions (Allan, 2026-10-11: templates in the sidebar, new-page start)
- Templates sit in the sidebar under Home (templates-panel.tsx; the Inbox
  moved to the sidebar's top row on 2026-10-18): every
  template grouped as Pages or "Rows of <database>", searchable, each
  opened to edit or Used to start a page; New template makes a private
  page that is a template. Starters (src/lib/starter-templates.ts: To-do
  list, Meeting notes, Weekly plan, Project brief) ship with the app and
  are offered there and on blank pages.
- A blank page you can edit shows its starting points under the first
  line (new-page-starter.tsx): Empty page, your templates, starters,
  Import a file, and (plain pages only) Or start with a database: Table,
  Board, List, Calendar. Typing anywhere hides it.
- Import reads Markdown, HTML and CSV in the browser (src/lib/file-import.ts,
  2 MB at most) with the paste readers. A CSV becomes a simple table (its
  ⋯ menu turns it into a database). Other formats are refused in words.
- Starting a database flips the blank page to is_database and adds a
  shared view of that layout (use-start-database.ts); a board gets a
  Status (Not started, In progress, Done) to group by, a calendar a Date.

## Decisions (Allan, 2026-10-11: the column menu)
- Clicking a table column's heading opens Notion's property menu
  (property-menu.tsx + view-table headingMenu): the name field on top
  (rename), Type (only while no row has a value; relations and rollups
  are made as new properties), Edit options, Filter (opens +Filter at that
  property), sorts, Insert left / right (the new-property flow, placed in
  the view beside it), Move, Hide in this view, Wrap text, Reset width,
  Duplicate property, Archive property (owners, with a confirm and Undo).
  Property changes are offered only to people who can edit the database.
- Options: rename, colour (palette names gray, green, amber, yellow,
  blue, purple, pink, red, mapped to tokens by option_palette in SQL),
  Move up / down, and Remove for an option no row uses. All through
  set_property_option_color / move_property_option / remove_property_option,
  one option at a time under a row lock, like add/rename.
- duplicate_property copies a property in its database as "<name> (copy)"
  with the values of every row the caller can edit; a two-way relation is
  copied one way, the far side of one can't be copied.
- Wrap text is per view (views.config.wrap); a wrapped cell grows to its
  text. It counts as a view change like shown properties.

## Decisions (Allan, 2026-10-11: Notion's full column menu)
- A table heading's menu, top to bottom: the name field with the type's
  icon (Change type) and ⓘ (Description) beside it; Edit property ›,
  Property access ›, Change type ›; Filter, Sort › (A → Z / Z → A, 1 → 9,
  Old → New), Group, Calculate › (None, Count ›, Percent ›, then the
  type's own), Freeze, Hide, Wrap / Unwrap content, Move left / right,
  Reset width; Insert left / right; Duplicate property, Delete property
  (an archive, owners, restorable). AI Autofill is out of scope.
- Edit property holds what a type sets: options, number format, ID
  prefix, formula, and for a person Limit (config.limit = 1, or no limit),
  Default (config.default: "me" = whoever adds the row, or a member; given
  by the pages_0c_defaults trigger) and Notifications (config.notify,
  on unless false: notify_person_added writes "person_added" to the inbox
  of people added, never yourself, only people who can open the row).
- A person value is a member id or a list of them (src/lib/person-value.ts,
  person_ids in SQL); without a limit a pick adds or takes off.
- Property access (config.access = "owners"): only workspace owners change
  the property's values (validate_page_props; a new row may start with the
  default); only owners set it (guard_property_access). It survives a
  change of type.
- Description: property_defs.description (≤ 280), the heading's tooltip.
- Change type works with values: change_property_type converts every value
  that reads in the new type (options made from the words for a select or
  status, people matched by name or email…), clears the rest, and keeps
  the old values in property_type_changes so undo_property_type_change
  (the same person, within an hour) puts everything back. It refuses when
  rows the person can't edit hold values. Relations, rollups, formulas and
  IDs keep their type.
- Freeze is per view (views.config.freeze = the last frozen property): the
  title and properties up to it stay while the table scrolls sideways
  (.gio-frozen, lefts measured from the headings).

## Decisions (Allan, 2026-10-11: page view of a database's rows)
- pages.page_layout on a DATABASE says how its rows show their properties
  when opened as pages (src/lib/page-layout.ts): an order, and per
  property Always show / Hide when empty / Always hide ("always",
  "filled", "never"). Unset: the first three always, the rest when filled.
  Hidden and empty-hidden properties wait in an "N more properties" fold.
- Changed from the row page: Customize (the strip's header) lists every
  property with its rule; each property's ⋮⋮ opens its rule and Move
  up / down, and drags to reorder. A move writes the whole order and every
  rule, so nothing else shifts.
- guard_database_settings: page_layout and task_config change only for
  people who can edit the database page (the pages UPDATE policy alone
  let view-only members change them), and page_layout's shape is checked.

## Decisions (Allan, 2026-10-11: more property types)
- ID (`unique_id`, config `{prefix}`, up to 10 letters or digits): a row's
  number is pages.row_number, given by the pages_0b_row_number trigger
  (next number in its database) on insert and on moving into a database;
  the browser never sets it. It shows as "REQ-104" (or "104"), sorts and
  filters as a number, and is never written into props.
- Number formats live in a number property's config: `format` (number,
  number with commas, percent, currency), `decimals` (0–6) and `currency`
  (src/lib/number-format.ts). Percent shows the stored number as typed
  plus "%". Cells, the row strip and the Calculate row use the format;
  editing shows the plain number.
- Files & media (`files`): a list of {path, name, size, mime}, at most 50,
  uploaded to the page-images bucket under the row's own folder
  (<workspace>/<row>/files/…), so the files are exactly as private as the
  row; opened with a signed URL (src/lib/file-values.ts, files-value.tsx).
  A file removed from the list stays in storage (Undo-safe, like file
  blocks).
- Status groups: each status option can carry `group` todo / doing / done,
  set one at a time through set_property_option_group. Overdue, My tasks'
  done values and terminal dates read the group (src/lib/status-groups.ts);
  an option without one falls back to its name ("Done", "Not started"…).
- Formula (config `{expression}`, up to 2000 characters): spreadsheet
  maths over the row's own values, run by the sheet engine;
  `prop("Name")` reads a property by its label (Name/Page/Title is the
  page title). Worked out in the browser for each reader, never stored;
  a formula that reads itself stops with an error in words. Changing a
  property's type clears its config (property_defs_0_reset_config).
- validate_page_props refuses stored values for formula and unique_id;
  guard_property_config checks each type's config shape.

## Decisions (Allan, 2026-10-11: favorites and the phone layout)
- Favorites: each person stars pages (home_prefs.favorite_pages, their
  own row, newest last, at most 200), from the page ⋯ menu, with Undo. They
  show in a Favorites section in the sidebar, on Home and on the phone's
  Home tab; a page the reader can't open, or an archived one, doesn't show.
- Screen sizes (src/lib/use-media.ts): below 768px is a phone, below
  1120px is compact. Desktop (1120px and up) is unchanged.
- Phones get their own frame (phone-shell.tsx, Notion's mobile layout):
  - Top pill tabs: the workspace logo (opens an account sheet), Home ·
    Inbox · Templates (/home?tab=…). The Home tab is the navigation:
    Recents, Favorites, Workspace, Private. There is no sidebar.
  - A floating bottom bar: Search (opens ⌘K's palette), New page, and on a
    page ☰, which opens a card of recent pages with Home and Search.
  - A page has no app bar: floating Back, Share (the phone's share sheet,
    else Copy link) and ⋯, which opens the "Actions" sheet (fonts,
    Favorites, Share, Copy link, Copy page contents, Duplicate, Move to,
    Delete; Small text / Full width / Lock editing; Who can see this,
    verify, comments, history, template, export, archive).
  - Every RowMenu and Popover opens as a sheet from the bottom
    (menu-sheet.tsx) with the same contents at phone sizes; a rename field
    on top of a menu isn't focused until tapped, so the keyboard doesn't
    cover the menu.
  - Safe areas (viewport-fit=cover), 16px inputs in sheets.
- Compact (768–1119px) keeps the desktop frame with the sidebar over the
  page, closed until opened, closing when a page opens.
- Not yet on phones: the keyboard toolbar, long-press block menus, tables
  as lists, quick capture, offline reading (the plan's later steps).
- Phone skeletons (phone-skeletons.tsx, 2026-10-11): every phone loading
  state is drawn on the geometry of the screen it stands in for. While the
  session and workspace load, the gates draw the phone frame
  (PhoneBootSkeleton: the top tabs or a page's floating buttons, the
  bottom bar, and the skeleton of the screen the address points at). The
  Home tab, Recents, Inbox, Templates, the ☰ card, a page and a database
  each have their own; desktop skeletons hand over below 768px. Loading
  never reads as empty ("Nothing here yet" waits for the data). A skeleton
  that replaces another shows at once (sk.tsx), so the screen never blinks
  blank between them. Desktop's boot stays a blank canvas.
- Switching the phone's top tabs slides the pills (PhoneTopTabs,
  --dur-tabs 260ms, --ease-in-out): each pill's fill is drawn wider than
  its tab and clipped to it, so its edges slide from where they were
  (clip-path); icons glide (transform), the picked tab's name fades in,
  colours cross over. No layout is animated; reduced motion keeps only
  the colours. The tab's content swaps at once (screens don't animate).
- The top of a phone is one colour (2026-10-11): below 768px html and body
  are `surface`, like the frame, so the browser's status bar and top edge
  (which tint from the page background) don't show a canvas band. A
  theme-color meta follows the body's background in light and dark
  (src/lib/theme-color.ts).
- A phone table's sticky end track stays 40px (just the +), so it never
  covers the properties scrolling under it.

## Decisions (Allan, 2026-10-11: Notion's blocks, databases and new pages)
- Slash menu (slash-menu.tsx, src/lib/slash-entries.ts): sections Suggested
  (the person's recent picks, per device), Basic blocks, Media, Database,
  Advanced; one-line rows with the typing shortcut on the right; "Close
  menu · esc". Every block type has a preview card (block-previews.tsx:
  a small example in Gio's style and one line), shown beside the
  highlighted row in the slash menu and in Turn into (MenuRow.preview).
- The Database section makes a new database inside the page as a Table,
  Board (with a Status), List or Calendar (with a Date) view, or a Linked
  view of an existing one. Inline views can be calendars too.
- A database (inside a page or on its own page) has Notion's toolbar
  (database-toolbar.tsx): Filter, Sort, Search, Open as full page, View
  settings, New ▾ (templates), each an icon with a tooltip. Inside a page
  it shows while pointed at or focused. Filters and sorts show as chips
  only when set; the query sentence is off by default (Settings ›
  Preferences turns it back on). Search is a passing title filter
  ("@title", run-view), never saved.
- The heading row is plain, sentence case, each property with its type's
  icon, and ends with "+ Add property": a name field and a grouped
  two-column type grid (property-type-grid.tsx); picking a type adds it at
  once (relation, rollup and formula continue with their steps), and in a
  view the built-ins (created/edited time and by) can be added as columns.
- View settings (view-settings.tsx), one panel everywhere: view name,
  Layout, Property visibility, Filter, Sort, Group (Show by on a
  calendar), Copy link to view; then Edit properties, Row page layout and
  Task database for people who can edit the database; a database page
  adds More view actions (save, publish, duplicate, pin, export, delete).
  The layout switch left the database header for it.
- New pages and database rows open in a dialog over the current page
  (page-peek.tsx, src/lib/peek.ts; Notion's centre peek): ⤡ opens the page
  itself, "Add to ▾" moves it (move_page), Copy link, ★ Favorites, ⋯. Esc
  or a click outside closes it. A page made for the dialog and closed
  while still blank (no title, no words, no values, nothing inside) is
  deleted. Databases and phones open pages in full. While a dialog is
  open, the page underneath ignores window-wide keys (keysAreMine).
- The sidebar's ✎ (New page) makes a page inside the page you're on, or
  in Private when that isn't possible.
- A blank page's starting points are "Get started with" chips: Empty
  page, Templates ▾ (yours and the starters), Database ▾ (Table, Board,
  List, Calendar) and Import.
- Not built (out of scope or later): AI features, Forms, Gallery,
  Timeline, Feed and Dashboard views, Automations, Conditional color,
  Heading 4, Button and Place properties, Lock database.

## Decisions (Allan, 2026-10-11: the sidebar corner, Trash, workspace icon)
- The sidebar's bottom-left is Notion's: the workspace button (icon, name,
  ▾) opens the workspace menu (name and member count, Settings, Invite
  members, the account, Log out); beside it ▦ opens Trash and My tasks.
  The person's own name and avatar live in Settings › My profile. On
  phones, Trash is a row of the account sheet.
- Trash (trash-panel.tsx, use-trash.ts) lists deleted pages through
  list_trash (SECURITY DEFINER, read-only; pages RLS hides deleted rows):
  pages of the caller's workspace they could edit, one row per deletion
  (what went with a page counts inside it), searchable by title, newest
  first, at most 200. Blank pages thrown away by the new-page dialog
  aren't listed. Restore goes through restore_page, bringing back first
  the deleted pages it lives in, so it returns where it was. A deleted
  page can't be opened, only restored. Nothing empties Trash (that would
  be a delete; not built).
- The workspace icon is picked with the page icon picker (every emoji,
  custom emoji, Remove) or uploaded: Upload image saves the image as a
  custom emoji and uses it (workspace-icon-picker.tsx). Popovers sit above
  dialogs (--z-menu), so a picker opened inside Settings isn't covered.

## Decisions (Allan, 2026-10-18: the black rail, Gio's DNA)
Gio Docs takes the rail of Gio ATS and Gio Sales. Desktop only (1120px
and up); compact screens keep the sidebar over the page, phones their own
frame. Colours live in styles.css (THE BLACK RAIL).
- The sidebar is a floating black card (#0d0d09, radius 16, 12px in from
  the window, the ATS rail's shadow), black in both themes: `.gio-black-rail`
  sets every colour token the sidebar uses, so rows, search, sections and
  the footer need no styles of their own; menus it opens are portalled and
  keep the page's theme. In dark mode its edge is drawn.
- The page beside it is a rounded card too (radius 16, 12px from the
  window: `[data-page-card]` on the shell, `.gio-page-column`), as in Gio
  Sales.
- Open, the card's top row holds the fold button (a lilac #D7C5FB disc,
  top-left), New page ✎ and the Inbox (an icon with its count; it is no
  longer a row); Search sits below, then Home and Templates, then
  Favorites, Workspace and Private. The page you're on reads lilac with a
  short lilac bar.
- Folded (⌘\ or the lilac disc), it is the ATS's 64px rail of 44px tiles
  (CollapsedRail): unfold, Search, New page, Inbox · Home, Favorites (star),
  Workspace (four tiles), Private (lock) · Templates, Settings and the
  workspace at the bottom. Only the width moves (--dur-sidebar,
  --ease-in-out); the tree and the rail crossfade, icons never move.
- Favorites, Workspace and Private open their pages in a black card beside
  the rail (RailFlyout, useRailFlyout) on hover, like a hover card: the
  first after 180ms, a neighbour at once, closed 150ms after the pointer
  leaves the tile and the card (an open ⋯ menu keeps it); a click or tap
  toggles it. It sits level with its tile, as tall as its pages, never
  taller than the rail (then it scrolls); Esc, a click outside or opening
  a page closes it. Menus opened from a rail tile open beside the rail
  (Popover `side="right"`).
- Spacing: tree rows 30px, 2px apart, 20px above section labels. On the
  page (PAGE BODY VERTICAL RHYTHM): 6px between paragraphs, 2px between
  list items, headings 32 / 24 / 16 above and 4 below (8 between two
  headings), and 12px on both sides of callouts, quotes, code, tables,
  columns, images and inline databases. Small text: 5, 28 / 20 / 14, 4, 10.

## Decisions (Allan, 2026-10-18: menus, Notion's)
Every desktop menu takes Notion's row grammar, measured from Notion's own
menus; Lato and Gio's colours stay. The classes live in styles.css (MENUS):
`.gio-menu` (the panel: radius 12, 4px padding, `--shadow-menu`, a hairline
ring instead of a border), `.gio-mrow` (28px rows: 4px 8px, 14px on a 20px
line, 6px corners), `.gio-mrow-lead` (the 20px leading slot, icons 20px at
a 1.6 stroke in `--color-strong`), `.gio-mrow-hint` (shortcuts and values
in the UI font, 12px, faint), `.gio-mrow-chev` (submenu chevron; a "›" hint
draws it), `.gio-msep` (dividers inset 12px from the panel's edge),
`.gio-mhead` (a 12px sentence-case header) and `.gio-mfoot` (a 12px footer).
- Every menu uses them: RowMenu / SpecMenu, the page ⋯ menu, Popover and
  what's inside Popovers (filter/sort/group builders, person/select/tags/
  files/relation pickers, page pickers, Properties, Templates, code
  language, emoji picker), the workspace and Trash menus, the slash and @
  menus, comment ⋯, the role pickers. Build a new menu from
  src/components/menu-parts.tsx (MenuLead, MenuIcon, MenuCheck,
  MenuChevron, MenuSep, MenuHead, MenuFoot, MenuPageRow, MenuSearch, the
  28px search field), never with its own row padding.
- Arrow-key menus mark the highlighted row `data-active` and the panel
  `data-keynav` (the pointer's hover doesn't light a second row).
- Touch screens that get a menu rather than a sheet (tablets) have rows
  of at least 36px; inside a phone Popover sheet rows land on 48px.
- Delete and other danger rows look like any other row until pointed at or
  focused, then the label and icon turn red (`data-danger`). Phones have no
  hover, so they stay red there.
- Phones keep the 48px sheet rows (.gio-menu-sheet).

## Decisions (Allan, 2026-10-18: the splash)
- Gio Docs boots with the splash of Gio ATS and Gio Sales (gio-splash.tsx,
  GIO SPLASH in styles.css): the Gio Docs mark from public/gio-docs-logo.svg,
  83px tall in the middle of the window on cream, the same dot morph, curves
  and timings; then the sheet slides up off the live app. It plays on every
  full load and again on the sign-in and invite hand-offs
  (triggerGioSplash). Dark mode: the dark canvas with a cream mark. Reduced
  motion: the mark at rest and a fade.

## Decisions (Allan, 2026-10-19: the new-version toast)
- "A new version of Gio Docs" is Gio ATS's toast, exactly: its version
  check (use-app-version-check.ts: the page's hashed entry script against
  the one named in a fresh copy of "/", 30s after load, every 5 minutes
  while visible, on return and on reconnect; Later hides it for that
  version only) and its ink Sonner toast rebuilt to the same measurements
  (app-update-toast.tsx, UPDATE TOAST in styles.css; Inter from Google
  Fonts as in Gio ATS). Bottom-left, 24px from the page beside the rail
  (--gio-content-left, set by AppShell); on phones above the floating bars.
  Gio Docs' own toasts stay as they are. A failed lazy chunk after a deploy
  reloads the page (installStaleChunkReload), at most once a minute.

## Decisions (Allan, 2026-10-22: no blank screen, resend from Gio OS)
- Someone signed in who isn't in a workspace sees NoWorkspace (the
  signed-in email, open the invitation link or ask an admin, Check again,
  Sign out); a failed membership lookup shows Try again. Never an empty
  canvas.
- Gio OS resends an invitation with os-provision { resend: true } →
  os_resend_invite: a fresh link (create_workspace_invite) for anyone not in
  the workspace, 'unchanged' for members.

## Decisions (Allan, 2026-10-30: database tables, first batch)
From the Notion comparison; Allan picked A1–A6, B1, B2 and C1.
- Every view sees every row: the workspace page list is read 1000 at a
  time (Supabase's cap per request), not cut at the newest 2,000.
- Boards have a "No <property>" column for rows without a value; grouping
  choices (tableGroupChoices, view-config.ts) are one list for the database
  page, inline views and the heading menu; Edited and Verified filter as
  dates; bulk delete and archive come with Undo.
- Manual order is a sort of its own ({ prop: "manual" }): the database's own
  order (move_page; bySiblingOrder). Existing views keep their sorts.
- A row has Notion's handle: ⋮⋮ in the gutter (and "+" in manual order: a
  row below, ⌥ above). Click ⋮⋮ or right-click the row for the row menu:
  Open · Open as full page · Open in new tab — Edit property › · Re-verify
  — Copy link · Duplicate · Move to › — Delete. Drag ⋮⋮ to reorder; in a
  sorted view the drop offers "Use manual order"; a drop in another group
  sets its select, status or checkbox value. useRowActions
  (src/hooks/use-row-actions.tsx) serves the database page and inline views.
- Selecting rows: drag a marquee from the margin, around the table or a
  row's gutter; Shift+↑/↓ grows or shrinks it, Delete deletes with Undo, ⌘/
  opens Actions, ⌘A selects every row, Esc clears. Ranges follow the order
  shown. Board cards and list rows show their box on hover.
- The bulk bar's Actions: Edit property › (picked values and typed text,
  number, date, link, email, phone, checked as their cells check) · Mark
  verified — Duplicate · Move to › — Archive · Delete. Moves and duplicates
  come with Undo (a move back restores the row's values).

## Working agreement
- Build ONLY what the task message asks. Never scaffold ahead.
- Finish every task by listing exactly which files changed, then stop.
- If something fails, report the exact error and stop — do not work
  around it silently.
- Vocabulary in code and UI: Page, Database, Row, Property, View, Block,
  Verified. "Database" and "table" are fine since 2026-10-10 (a table is
  a database shown as a table). Never: doc, record, field, column, folder,
  space, element, approved, area.

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
