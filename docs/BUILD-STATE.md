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
5. src/routes/index.tsx has a temporary ["membership", userId] query to
   find the workspace id. Replace when the shell gains a proper
   workspace context.

## Phase order (remaining)

shell + sidebar → table + toolbar → team-view fork rule (SHIP) →
board + list → page editor → command palette → settings → realtime.
