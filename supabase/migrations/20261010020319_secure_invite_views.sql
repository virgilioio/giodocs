-- Close a hole in the invite views.
--
-- workspace_invites_state was created without security_invoker, so it ran
-- with its owner's rights and ignored row level security: any signed-in
-- account, member or not, could read every invite (emails and tokens) and,
-- because a simple view is updatable and `authenticated` held write grants,
-- change an invite's email or role and then accept it. Verified read-only on
-- 2026-10-10 as a non-member: 12 invites visible, UPDATE granted.
--
-- After this, both invite views run as the caller (RLS applies: members read
-- their workspace's invites, only owners change them through the table), and
-- neither view can be written through. The app reads workspace_invites_public
-- only.

alter view public.workspace_invites_state set (security_invoker = true);

revoke insert, update, delete, truncate, references, trigger
  on public.workspace_invites_state from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.workspace_invites_public from anon, authenticated;
