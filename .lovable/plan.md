## Read-only audit of Gio Docs

Deliverable: a single written report following your Sections 1–10 exactly, with evidence (table/column names, file paths, line numbers, hex values, pixel values) and the verdict vocabulary you specified (MISSING / DIFFERS / UNVERIFIED / PRESENT / EXISTS / PARTIAL / PASS / FAIL). No code will be written, no migrations run, no fixes suggested inline.

### How I will gather evidence

1. **Database (Sections 1–4)** — via `supabase--read_query` against `information_schema` and `pg_catalog`:
   - tables, columns, PKs, FKs, check constraints, enums, indexes (incl. partial), triggers, functions (language / volatility / security / `search_path`)
   - every RLS policy verbatim (`pg_policies.qual` and `with_check`)
   - grants to `anon` / `authenticated` (`information_schema.role_routine_grants`, `role_table_grants`)
   - explicit name-search for the rejected shapes (`page_type`, `kind`, `is_database`, `parent_id`, `docs`, `tasks`, `areas`, `folders`, `page_tags`, list-of-ids columns on `views`)

2. **Client code (Sections 2, 4, 5, 6, 7, 8)** — via file reads and `rg`:
   - every file under `src/`, plus `scripts/`, `vite.config.ts`, `package.json`, `.env.example`, `src/styles.css`
   - grep for `service_role`, `SUPABASE_SERVICE`, `auth.admin`, `select('*')`, `useEffect`, `console.log`, `TODO`, `FIXME`, `#` hex literals, Tailwind default palette classes (`gray-`, `slate-`, `blue-6`, etc.), Lato weight utilities, raw px font sizes
   - map every RPC call site, every `.from(...).select(...)` projection and `.limit(...)`
   - enumerate query keys, mutation optimism, realtime subscriptions

3. **Screen-by-screen (Section 6) & success criteria (Section 9)** — Playwright headless as `allan@virgilio.tech` against `http://localhost:8080`:
   - screenshots of login, shell, sidebar (expanded/collapsed), each view route, each area route, hover ⋯ menus, account dropdown, query toolbar, table rows
   - attempt each of the five success flows and record PASS/FAIL with what was observed
   - network panel: request counts on initial load, view switch, page open
   - features that don't exist yet in the codebase (board view, list view, page editor, blocks, ⌘K, settings panes, freshness row, permissions chip) will be reported MISSING with the evidence that no route/component implements them

4. **Design fidelity (Section 7)** — extracted, not estimated:
   - dump every unique hex from `src/styles.css` and `src/**/*.{ts,tsx,css}`, cross-check against your allow-list, count usages
   - list every font-family / weight loaded (root route `<link>`, styles.css) and every Lato weight utility used
   - read the `@theme` block and list actual values for each of the 11 type roles, sidebar/topbar/row/table metrics, radii, transitions
   - icons: identify library or inline SVGs, note stroke vs fill
   - contrast: compute ratios for `#8B8F9E`, `#A8ACB8`, `#C9CBD4` runs against their actual backgrounds using the token map

5. **Gap list (Section 10)** — assembled last from the findings, ordered by blocking impact, with S1/S2/S3/S4 severity, and the three closing counts.

### Ground rules I will hold to

- No file edits, no migrations, no `supabase--insert`, no fixes proposed inline.
- Anything I cannot verify from code or a DB query is written **UNVERIFIED** with what would be needed.
- No "should be", "appears", "mostly" — only PRESENT / DIFFERS / MISSING / PASS / FAIL / UNVERIFIED.
- Completeness estimates are justified by the evidence in that section.

### What I need from you

Approve this plan and I'll execute the audit and return the full report in one message. If you'd rather I split the report (e.g. Sections 1–5 first, then 6–10) because of length, say so and I'll deliver it in two passes.