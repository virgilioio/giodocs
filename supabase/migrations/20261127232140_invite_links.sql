-- Invitation links that keep working (2026-11-27).
--
-- Sending an invitation again (People & Access' Resend, or an owner's own
-- re-invite) now keeps the same link and gives it 7 more days, so an email the
-- person already has keeps working; before, every resend changed the link.
-- People & Access can ask for an invitation's state, its link to hand over and
-- 7 more days (os_invite_action). A link that has expired can ask for a new
-- one, emailed to the invited address only (invite_renew_request): the new
-- link replaces the expired one, so an old forwarded email can't bring access
-- back. An invitation People & Access withdrew is marked withdrawn
-- (revoked_at, set by the database) and can't be renewed from its link.

alter table public.workspace_invites add column revoked_at timestamptz;

comment on column public.workspace_invites.revoked_at is
  'When the invitation was withdrawn (its expiry pulled to now, as People & Access does). Cleared when it is sent again.';

-- Withdrawing is pulling the expiry back to now or earlier: mark it.
create or replace function public.workspace_invites_mark_revoked()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.accepted_at is null and new.expires_at <= now() and old.expires_at > now() and new.revoked_at is null then
    new.revoked_at := now();
  end if;
  return new;
end $$;

create trigger workspace_invites_b_revoked
before update of expires_at on public.workspace_invites
for each row execute function public.workspace_invites_mark_revoked();

-- Invitations People & Access already withdrew.
update public.workspace_invites i
   set revoked_at = coalesce(
     (select max(l.received_at) from public.os_provision_log l where l.invite_id = i.id and l.outcome = 'invite_revoked'),
     i.expires_at)
 where i.accepted_at is null and i.revoked_at is null
   and exists (select 1 from public.os_provision_log l where l.invite_id = i.id and l.outcome = 'invite_revoked');

-- Sending again keeps the link: same token, 7 more days, no longer withdrawn.
create or replace function public.create_workspace_invite(p_workspace uuid, p_email text, p_role member_role, p_invited_by uuid)
 returns workspace_invites
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r public.workspace_invites;
  clean_email text := lower(trim(p_email));
  caller uuid := auth.uid();
begin
  -- Identity resolution, in priority order:
  --  1. A real session (a signed-in user calling the RPC directly) always wins,
  --     so p_invited_by can never be used to impersonate an owner from the client.
  --  2. No session at all: this can only be a service-role call, because EXECUTE
  --     was revoked from anon and public. The edge function `send-workspace-invite`
  --     runs there, so we accept the supplied p_invited_by and still require it
  --     to be a genuine owner below.
  if caller is null then
    caller := p_invited_by;
  end if;

  if caller is null then
    raise exception 'Sign in to invite people.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.workspace_members
     where workspace_id = p_workspace and user_id = caller and role = 'owner'
  ) then
    raise exception 'Only workspace owners can invite.' using errcode = '42501';
  end if;

  if clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That does not look like an email address.' using errcode = '22023';
  end if;

  insert into public.workspace_invites
    (workspace_id, email, role, invited_by, token, invited_at, expires_at, email_status)
  values (p_workspace, clean_email, p_role, caller,
          gen_random_uuid(), now(), now() + interval '7 days', 'pending')
  on conflict (workspace_id, email) where accepted_at is null
  do update set role = excluded.role, invited_by = excluded.invited_by,
                token = workspace_invites.token, invited_at = now(),
                expires_at = now() + interval '7 days', revoked_at = null,
                email_status = 'pending', email_error = null
  returning * into r;
  return r;
end $function$;

-- The invite page reads a withdrawn invitation as withdrawn, not expired.
create or replace function public.invite_preview(p_token uuid)
 returns table(workspace_name text, workspace_icon text, invited_email text, inviter_name text, role text, state text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select w.name, w.icon, i.email,
         coalesce(p.full_name, 'A workspace owner'),
         i.role::text,
         case when i.id is null then 'not_found'
              when i.accepted_at is not null then 'accepted'
              when i.revoked_at is not null then 'revoked'
              when i.expires_at < now() then 'expired'
              else 'valid' end
    from public.workspace_invites i
    join public.workspaces w on w.id = i.workspace_id
    left join public.profiles p on p.id = i.invited_by
   where i.token = p_token;
$function$;

-- People & Access asks about one person's invitation (2026-11-27):
--   status  where it stands (joined, pending, expired, withdrawn, none)
--   link    its link to hand over directly (7 more days when it had expired)
--   renew   7 more days
-- The actor must be an owner here, as for grants.
create or replace function public.os_invite_action(p_email text, p_actor_email text, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws       uuid;
  v_email    text := lower(trim(p_email));
  v_actor_em text := lower(trim(p_actor_email));
  v_actor    uuid;
  v_user     uuid;
  v_invite   public.workspace_invites%rowtype;
begin
  if p_action is null or p_action not in ('status', 'link', 'renew') then
    raise exception 'Unknown invitation action.' using errcode = 'GOS10';
  end if;
  select id into v_ws from public.workspaces order by created_at limit 1;

  select p.id into v_actor
  from public.profiles p
  join public.workspace_members m on m.user_id = p.id and m.workspace_id = v_ws and m.role = 'owner'
  where lower(p.email) = v_actor_em;
  if v_actor is null then
    return jsonb_build_object('outcome', 'refused', 'detail', 'The person asking isn''t an owner in Gio Docs.');
  end if;

  select id into v_user from public.profiles where lower(email) = v_email;
  if v_user is not null and exists (select 1 from public.workspace_members where workspace_id = v_ws and user_id = v_user) then
    return jsonb_build_object('outcome', 'ok', 'state', 'joined');
  end if;

  select * into v_invite from public.workspace_invites
  where workspace_id = v_ws and email = v_email and accepted_at is null;
  if v_invite.id is null then
    return jsonb_build_object('outcome', 'ok', 'state', 'none');
  end if;
  if v_invite.revoked_at is not null then
    return jsonb_build_object('outcome', 'ok', 'state', 'withdrawn', 'invite_id', v_invite.id);
  end if;

  if p_action = 'renew' or (p_action = 'link' and v_invite.expires_at < now()) then
    perform set_config('gio.os_provision', 'on', true);
    update public.workspace_invites set expires_at = now() + interval '7 days'
     where id = v_invite.id
     returning * into v_invite;
    perform set_config('gio.os_provision', 'off', true);
  end if;

  return jsonb_build_object('outcome', 'ok',
    'state', case when v_invite.expires_at < now() then 'expired' else 'pending' end,
    'invite_id', v_invite.id, 'role', v_invite.role, 'invited_at', v_invite.invited_at,
    'sent_at', v_invite.invited_at, 'expires_at', v_invite.expires_at, 'email_status', v_invite.email_status,
    'token', case when p_action = 'link' then v_invite.token end);
end $$;
revoke all on function public.os_invite_action(text, text, text) from public, anon, authenticated;

-- The person asks for a new link from an expired one (the invite page's
-- "Email me a new link"): only an expired invitation still open and not
-- withdrawn. The link changes (the expired one stops opening it) and gets
-- 7 days; the edge function emails it to the invited address only.
create or replace function public.invite_renew_request(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.workspace_invites%rowtype;
begin
  select * into v_invite from public.workspace_invites where token = p_token;
  if v_invite.id is null then return jsonb_build_object('state', 'not_found'); end if;
  if v_invite.accepted_at is not null then return jsonb_build_object('state', 'accepted'); end if;
  if v_invite.revoked_at is not null then return jsonb_build_object('state', 'revoked'); end if;
  if v_invite.expires_at >= now() then return jsonb_build_object('state', 'valid'); end if;

  perform set_config('gio.os_provision', 'on', true);
  update public.workspace_invites
     set token = gen_random_uuid(), invited_at = now(), expires_at = now() + interval '7 days',
         email_status = 'pending', email_error = null
   where id = v_invite.id
   returning * into v_invite;
  perform set_config('gio.os_provision', 'off', true);

  return jsonb_build_object('state', 'renewed', 'invite_id', v_invite.id, 'token', v_invite.token);
end $$;
revoke all on function public.invite_renew_request(uuid) from public, anon, authenticated;
