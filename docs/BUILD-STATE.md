# Gio Docs — build state

Last updated: 2026-07-25 (after data-layer phase). Update this file at
the end of every phase.

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
| Seed: 7 users (incl. allan@virgilio.tech, owner), 22 pages, 7 views, 11 property defs | Done | count + content queries |
| Auth-token repair (GoTrue NULL-token bug) | Done | column diff vs working user; login confirmed |
| Login screen + domain recognition + sign-out | Done | user-confirmed in browser |
| Build guards: check-tokens, check-server-only, check-bundle (JWT-decoding) | Done | full build green |
| Data layer: query keys, hooks, useWorkspaceShell | Done | build green |
| run-view.ts single filter engine + groupPages | Done | 13 vitest tests + independent SQL cross-check |

## Acceptance numbers for the sidebar (next phase)

Sidebar counts must match exactly. If they differ, runView and the
database disagree — stop and investigate.

| View | Scope | Count |
|---|---|---|
| Engineering docs | team | 5 |
| Hiring pipeline (board by stage) | team | 7 |
| Priority: P0 | team | 2 |
| Q3 goals | team | 3 |
| Assigned to me (as Allan) | personal | 5 |
| Needs review | personal | 3 |
| Recently edited (30d) | personal | 10 |

Areas (derived): Design 3 · Engineering 5 · Hiring 7 · Ops 3 · Product 4.

## Known debts (deliberate, tracked)

1. edited_at spread + "Recently edited" 30-day window were applied by
   direct SQL, not a migration. Cosmetic seed polish; fold into the next
   migration that touches seed data, or accept divergence on fresh clones.
2. @lovable.dev/vite-tanstack-config wraps the entire vite plugin chain.
   Publicly installable (verified), so portable today. Eject before
   production launch; the hand-written equivalent config should be
   captured in docs/vite-config-eject.md when convenient.
3. Dev password GioSeed!2026 appears in migration files synced to
   GitHub. Rotate all seeded users (especially allan@) before any real
   data enters the workspace.
4. Nitro emits Cloudflare wrangler config by default. Harmless while
   output remains a static client bundle; revisit at deploy time.
5. Sidebar counts diverge from the acceptance table when signed in as
   Allan. Two independent issues, both in seed/RLS, NOT in runView or
   the shell:
   a. My views section is empty. The three "personal" views are owned
      by user aaaaaaaa-… (not Allan), so with scope='personal' Allan
      sees none. Decide whether personal views should be per-owner
      (re-seed for Allan) or shared-with-per-viewer-is_me.
   b. Hiring area and "Hiring pipeline" team view both count 6 (expected
      7). Both independent paths agree, so one Hiring page is unreadable
      to Allan — likely a page_access row or access_type='private'.
      Audit the Hiring pages against Allan's can_read_page result.

## Status of shell + sidebar phase

Shell + sidebar built and wired: workspace-context.tsx resolves the
workspace id once, AppShell renders sidebar + topbar + placeholder main,
counts computed from runView on the pages cache (never per-view queries),
areas derived from page.props.area, stale amber dot from workspace
stale_days, footer sign-out replaces the old index button. All four
build checks green, 13/13 vitest tests pass. NOT marked Done in the
table above until the two count discrepancies (debt 5) are resolved.
Next-phase acceptance (once counts match): table view renders the same
pages runView returns for the selected view; inline property edit moves
a page between views immediately.

## Phase order (remaining)

shell + sidebar → table + toolbar → team-view fork rule (SHIP) →
board + list → page editor → command palette → settings → realtime.
