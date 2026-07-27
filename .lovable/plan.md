
## Answer to the direct question

The current invite flow **does not work**. `AddMembersModal.onSend` only appends the emails to a local `pendingInvites` array in `app-shell.tsx` and shows a "Invite sent" toast — no DB row is written, no auth invite is issued, no email is sent. The Owner role toggle is also cosmetic today.

## What we'll build

A real invite system modelled on Gio ATS's `send-invitation` function, adapted to Gio Docs' one-workspace, `allowed_domains`-based model.

### 1. Migration — `workspace_invites` + accept RPC

New table `public.workspace_invites`:

- `id uuid pk`
- `workspace_id uuid not null` (fk → workspaces)
- `email text not null` (lowercased)
- `role member_role not null` (`owner` | `member`)
- `token uuid not null unique` (server-generated; never surfaced to non-owners)
- `invited_by uuid` (auth.users)
- `invited_at timestamptz default now()`
- `expires_at timestamptz not null` (invited_at + 7 days)
- `accepted_at timestamptz`
- `accepted_by uuid`
- `email_status text` (`pending` | `sent` | `failed`)
- `email_error text`
- `unique (workspace_id, email) where accepted_at is null`

Grants + RLS:

- `grant select, insert, update on ... to authenticated; grant all to service_role`
- SELECT policy: `is_member(workspace_id)` — members can see pending invites, but the `token` column is stripped by the API in a view (see next point).
- INSERT policy: `is_owner(workspace_id) and invited_by = auth.uid()` — only owners can invite (matches existing `views_update`/`members_write` pattern).
- UPDATE/DELETE: owners only.

Because tokens must not leak to non-owners, add a `workspace_invites_public` view exposing every column except `token`, and switch the sidebar's "pending" list to read from that view. The base table is used only by the edge function (service role) and by owners' management UI (if any).

Two SECURITY DEFINER RPCs:

- `create_workspace_invite(p_workspace uuid, p_email text, p_role member_role) returns workspace_invites` — verifies `is_owner`, upserts an invite, generates a new `token` and `expires_at`. Called by the edge function after it checks the caller.
- `accept_workspace_invite(p_token uuid) returns uuid` — validates token, not expired, not accepted, and `auth.uid()`'s email matches `email` (case-insensitive). Inserts into `workspace_members (workspace_id, user_id, role)` on conflict do nothing, marks the invite accepted. Returns `workspace_id`.

We deliberately do **not** modify `handle_new_user`'s existing domain auto-join behavior. Domain-matched invitees already get `workspace_members` on signup via that trigger, so for them the invite email is a "come sign up" nudge; when they click the link and are signed in with the matching email, `accept_workspace_invite` is a no-op (they're already a member) and simply marks the invite accepted. Out-of-domain invitees rely entirely on the token flow — they land in `workspace_members` only via `accept_workspace_invite`.

### 2. Edge function — `supabase/functions/send-workspace-invite`

Ported from Gio ATS `send-invitation`, simplified to Gio Docs' model. Uses:

- `RESEND_API_KEY`, `EMAIL_FROM` (secrets)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (already present)
- Standing rule 3 (only `client.ts` imports `@supabase/supabase-js`) applies to `src/` — edge functions run in Deno and are exempt; Gio ATS follows the same pattern.

Request body: `{ workspaceId, invites: [{ email, role }], message? }`.

Flow, per invite:

1. Auth the caller with the bearer token → `auth.getUser()`. Reject if not signed in.
2. Verify caller `is_owner(workspaceId)` via the anon-key client (RLS enforces).
3. Use the service-role client to call `create_workspace_invite` RPC → returns row with fresh `token` + `expires_at`.
4. Render email with a small helper `memberInviteEmail.ts` in `supabase/functions/_shared/` (a stripped-down port of Gio ATS's template — cream card, workspace name, inviter name, role, CTA, expiry). Absolute-URL only, HTML-escaped merge vars.
5. `resend.emails.send(...)` with 3 retries and exponential backoff, same as Gio ATS.
6. Update `email_status` = `sent` / `failed` on the invite row.

Accept URL: `https://<published-domain>/accept-invite/{token}`. Domain is derived from an `APP_URL` env var (falls back to `https://docs.gogio.io`).

CORS: reuse the `_shared/cors.ts` pattern (needs to be created; small file).

### 3. Client wiring

- `src/hooks/use-workspace-mutations.ts`: add `useSendInvites(workspaceId)` that calls the edge function via `supabase.functions.invoke("send-workspace-invite", { body })` (uses `client.ts` — rule 3 respected) and returns per-email success/failure. On success, invalidates a new `["workspace_invites", ws]` query.
- `src/components/add-members-modal.tsx`: replace the local-toast `onSend` with the mutation. Show a spinner while sending; report per-email failures inline instead of the current unconditional success toast. Respect the Owner/Member toggle by passing `role` per invite.
- `src/components/app-shell.tsx`: drop the local `pendingInvites` array; the sidebar's pending list (if any) reads from the `workspace_invites_public` view via a new hook.

### 4. Accept route

New public route `src/routes/accept-invite.$token.tsx` (top-level, not under `_authenticated/`):

- If signed out: redirect to `/login` with `?next=/accept-invite/{token}`, preserving the token.
- If signed in: call `accept_workspace_invite` RPC. On success, toast "Joined {workspace.name}" and navigate to `/`. On failure, show a plain error card (expired / already accepted / wrong email).

`login.tsx` already respects a post-login redirect target only implicitly — we'll extend the existing `navigate({ to: "/", replace: true })` to honor a `next` query param when present.

### 5. Secrets

Two new Supabase secrets to set (via `add_secret`):

- `RESEND_API_KEY` — user pastes their Resend API key.
- `EMAIL_FROM` — e.g. `Gio Docs <noreply@app.gogio.io>` (must be on a verified Resend domain).

`APP_URL` will be added as a plain env var on the edge function (not a secret) with a default fallback in code.

## Technical notes

- Edge function file layout matches Gio ATS (`_shared/cors.ts`, `_shared/memberInviteEmail.ts`, per-function `index.ts` + implicit Deno). No `deno.json` per-function beyond what's already there.
- All schema changes go through the migration tool per standing rules.
- The `workspace_invites_public` view avoids leaking tokens without needing column-level security.
- `handle_new_user` is left alone — the existing domain auto-join is a feature and the accept RPC is idempotent when the user is already a member.
- Role granting via invite is allowed (per the user's answer), but `role='owner'` requires the caller to already be an owner, so no privilege escalation surface is added beyond what RLS already permits.
- No changes to standing rules: only `client.ts` uses `@supabase/supabase-js` in `src/`; the edge function's Deno import is out of scope for the guard scripts.

## Files touched

Created:
- `supabase/migrations/<timestamp>_workspace_invites.sql`
- `supabase/functions/send-workspace-invite/index.ts`
- `supabase/functions/_shared/cors.ts` (if not present)
- `supabase/functions/_shared/memberInviteEmail.ts`
- `src/routes/accept-invite.$token.tsx`

Modified:
- `src/components/add-members-modal.tsx` (real send)
- `src/components/app-shell.tsx` (drop local pending state)
- `src/hooks/use-workspace-mutations.ts` (add `useSendInvites`)
- `src/routes/login.tsx` (honor `?next=`)

## What I need from you before implementing

- Confirm you'll add `RESEND_API_KEY` and `EMAIL_FROM` when I prompt (I can't set them for you), and that the sender domain is verified in your Resend account.
- Confirm accept-URL base: `https://docs.gogio.io/accept-invite/{token}` (custom domain) vs `https://giodocs.lovable.app/accept-invite/{token}`.
