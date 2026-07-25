# Gio Docs — build state

Last updated: 2026-07-25 (after shell + sidebar phase, seed follow-up).

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

Table view renders the same pages runView returns for the selected view;
inline property edit moves a page between views immediately.

## Phase order (remaining)

table + toolbar → team-view fork rule (SHIP) → board + list →
page editor → command palette → settings → realtime.
