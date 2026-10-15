-- Gio OS provisioning: Gio Docs receives access grants from People & Access
-- (design "Gio OS: People & Access", Part D; Allan 2026-10-14).
--
-- People & Access (in Gio ATS) decides who can open Gio Docs and as Member or
-- Owner. It sends each change to a new edge function, `os-provision`, signed
-- with its own secret, which calls os_apply_grant() below. Gio Docs' rules
-- still apply: the hub acts for the admin who clicked (p_actor_email), who
-- must be an owner here; nobody changes their own access; the workspace keeps
-- at least one owner. Each request applies once (os_provision_log).
--
-- workspaces.members_managed_by_os (ships OFF) moves member management to
-- People & Access. While it is on:
--   - joining by email domain stops (handle_new_user, domain_status), so a
--     working @virgilio.tech address alone no longer gets anyone in;
--   - owners can't add, re-role or remove members or create, change or
--     cancel invitations from inside Gio Docs; only os_apply_grant() can.
--     Accepting an invitation keeps working.
--
-- Removing someone's access removes their membership row, as Gio Docs does
-- today; their pages stay. This file therefore has to be applied from a
-- desktop chat (see the Gio Sales CLAUDE.md rule on delete statements).

-- ── 1. The switch ────────────────────────────────────────────────────────
alter table public.workspaces
  add column members_managed_by_os boolean not null default false;

comment on column public.workspaces.members_managed_by_os is
  'When true, members and invitations are managed in Gio OS (People & Access) and only os_apply_grant() changes them; domain auto-join is off.';

-- ── 2. The log of received requests ──────────────────────────────────────
create table public.os_provision_log (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  request_id   uuid not null unique,
  email        text not null,
  role         public.member_role,              -- null = remove access
  actor_email  text not null,
  outcome      text not null check (outcome in (
                 'invited', 'invite_updated', 'invite_revoked', 'role_changed',
                 'removed', 'unchanged', 'refused')),
  detail       text,
  invite_id    uuid,
  received_at  timestamptz not null default now()
);

comment on table public.os_provision_log is
  'Every access request People & Access sent to Gio Docs, with what it did. Written only by os_apply_grant().';

alter table public.os_provision_log enable row level security;

create policy os_provision_log_read on public.os_provision_log
  for select to authenticated
  using (public.is_owner(workspace_id));

-- ── 3. Applying a grant ──────────────────────────────────────────────────
-- p_role: 'member' | 'owner', or null to remove access. Returns the outcome
-- and, when it invites, the invitation token the edge function emails.
create or replace function public.os_apply_grant(
  p_request_id  uuid,
  p_email       text,
  p_role        text,
  p_actor_email text
) returns jsonb
language plpgsql security definer set search_path = 'public' as $$
declare
  v_ws        uuid;
  v_email     text := lower(trim(p_email));
  v_actor_em  text := lower(trim(p_actor_email));
  v_role      public.member_role;
  v_actor     uuid;
  v_user      uuid;
  v_member    public.workspace_members%rowtype;
  v_invite    public.workspace_invites%rowtype;
  v_outcome   text;
  v_detail    text;
  v_invite_id uuid;
  v_token     uuid;
  v_prev      public.os_provision_log%rowtype;
begin
  if p_request_id is null then raise exception 'request_id is required.' using errcode = 'GOS10'; end if;

  select * into v_prev from public.os_provision_log where request_id = p_request_id;
  if found then
    return jsonb_build_object('outcome', v_prev.outcome, 'detail', v_prev.detail,
      'invite_id', v_prev.invite_id, 'repeat', true);
  end if;

  select id into v_ws from public.workspaces order by created_at limit 1;
  if v_ws is null then raise exception 'No workspace.' using errcode = 'GOS10'; end if;
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'A valid email is required.' using errcode = 'GOS10';
  end if;
  if p_role is not null then
    if p_role not in ('member', 'owner') then
      raise exception 'Unknown Gio Docs role: %', p_role using errcode = 'GOS10';
    end if;
    v_role := p_role::public.member_role;
  end if;

  perform set_config('gio.os_provision', 'on', true);

  -- The admin who clicked, as a Gio Docs owner.
  select p.id into v_actor
  from public.profiles p
  join public.workspace_members m on m.user_id = p.id and m.workspace_id = v_ws and m.role = 'owner'
  where lower(p.email) = v_actor_em;

  if v_actor is null then
    v_outcome := 'refused';
    v_detail := 'The person who made this change isn''t an owner in Gio Docs.';
  elsif v_actor_em = v_email then
    v_outcome := 'refused';
    v_detail := 'Nobody changes their own Gio Docs access. Ask another owner.';
  else
    select id into v_user from public.profiles where lower(email) = v_email;
    if v_user is not null then
      select * into v_member from public.workspace_members where workspace_id = v_ws and user_id = v_user;
    end if;
    select * into v_invite from public.workspace_invites
    where workspace_id = v_ws and email = v_email and accepted_at is null;

    if v_member.user_id is not null then
      if v_member.role = 'owner' and (v_role is null or v_role <> 'owner')
         and not exists (select 1 from public.workspace_members o
                         where o.workspace_id = v_ws and o.role = 'owner' and o.user_id <> v_user) then
        v_outcome := 'refused';
        v_detail := 'Gio Docs needs at least one owner.';
      elsif v_role is null then
        delete from public.workspace_members where workspace_id = v_ws and user_id = v_user;
        v_outcome := 'removed';
      elsif v_member.role = v_role then
        v_outcome := 'unchanged';
      else
        update public.workspace_members set role = v_role where workspace_id = v_ws and user_id = v_user;
        v_outcome := 'role_changed';
      end if;

    elsif v_role is null then
      if v_invite.id is not null and v_invite.expires_at > now() then
        update public.workspace_invites set expires_at = now() where id = v_invite.id;
        v_outcome := 'invite_revoked';
        v_invite_id := v_invite.id;
      else
        v_outcome := 'unchanged';
      end if;

    elsif v_invite.id is not null and v_invite.expires_at > now() and v_invite.role = v_role then
      v_outcome := 'unchanged';
      v_invite_id := v_invite.id;

    else
      -- New, expired or re-roled invitation: create_workspace_invite refreshes
      -- the token and expiry; the edge function emails the link.
      select i.id, i.token into v_invite_id, v_token
      from public.create_workspace_invite(v_ws, v_email, v_role, v_actor) i;
      v_outcome := 'invited';
      if v_invite.id is not null then
        v_detail := case when v_invite.expires_at <= now()
                         then 'The earlier invitation had expired, so a new one was sent.'
                         else 'The invitation was re-sent with the new role.' end;
      end if;
    end if;
  end if;

  perform set_config('gio.os_provision', 'off', true);

  insert into public.os_provision_log
    (workspace_id, request_id, email, role, actor_email, outcome, detail, invite_id)
  values
    (v_ws, p_request_id, v_email, v_role, v_actor_em, v_outcome, v_detail, v_invite_id);

  return jsonb_build_object('outcome', v_outcome, 'detail', v_detail, 'invite_id', v_invite_id,
    'token', v_token, 'repeat', false);
end $$;

revoke execute on function public.os_apply_grant(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.os_apply_grant(uuid, text, text, text) to service_role;

-- ── 4. While managed in Gio OS, only os_apply_grant changes members ─────
-- People signed in to Gio Docs can't change members or invitations; the
-- service role (edge functions) and os_apply_grant can. Accepting an
-- invitation sets the same flag (below), so it keeps working.
create or replace function public.os_members_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_ws uuid;
begin
  if auth.uid() is null or coalesce(current_setting('gio.os_provision', true), 'off') = 'on' then
    return coalesce(new, old);
  end if;
  v_ws := coalesce(new.workspace_id, old.workspace_id);
  if exists (select 1 from public.workspaces w where w.id = v_ws and w.members_managed_by_os) then
    raise exception 'Members are managed in Gio OS. Change access in People & Access.'
      using errcode = 'GOS20';
  end if;
  return coalesce(new, old);
end $function$;

create trigger workspace_members_os_guard
  before insert or update or delete on public.workspace_members
  for each row execute function public.os_members_guard();

create trigger workspace_invites_os_guard
  before insert or update or delete on public.workspace_invites
  for each row execute function public.os_members_guard();

-- Accepting an invitation: same body as before, marked as a provisioning write.
create or replace function public.accept_workspace_invite(p_token uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  inv public.workspace_invites;
  caller_email text;
begin
  select email into caller_email from auth.users where id = auth.uid();
  if caller_email is null then
    raise exception 'Sign in to accept an invite.' using errcode = '42501';
  end if;

  select * into inv from public.workspace_invites where token = p_token;
  if inv.id is null then
    raise exception 'Invite not found.' using errcode = 'P0002';
  end if;
  if inv.accepted_at is not null then
    -- Idempotent: already accepted is fine.
    return inv.workspace_id;
  end if;
  if inv.expires_at < now() then
    raise exception 'This invite has expired.' using errcode = '22023';
  end if;
  if lower(caller_email) <> inv.email then
    raise exception 'This invite is for a different email address.' using errcode = '42501';
  end if;

  -- NEW: an accepted invitation is allowed through the Gio OS guard.
  perform set_config('gio.os_provision', 'on', true);

  insert into public.workspace_members (workspace_id, user_id, role)
  values (inv.workspace_id, auth.uid(), inv.role)
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invites
     set accepted_at = now(), accepted_by = auth.uid()
   where id = inv.id;

  perform set_config('gio.os_provision', 'off', true);

  return inv.workspace_id;
end $function$;

-- ── 5. No joining by email domain while managed ──────────────────────────
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  ws uuid;
  tints text[] := array['#DCFBE9','#FCE7C8','#DCEAFE','#EDE4FF','#FBE0EE','#FAF4C4'];
  inks  text[] := array['#0B7A57','#B45309','#2563EB','#5B21B6','#BE185D','#7A6A10'];
  i int;
begin
  i := (abs(hashtext(new.id::text)) % 6) + 1;

  insert into public.profiles (id, full_name, email, avatar_tint, avatar_ink)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.email,
          tints[i], inks[i])
  on conflict (id) do nothing;

  -- NEW: a workspace managed in Gio OS doesn't take members by email domain.
  select d.workspace_id into ws from public.allowed_domains d
    join public.workspaces w on w.id = d.workspace_id and not w.members_managed_by_os
   where d.domain = lower(split_part(new.email,'@',2)) limit 1;

  if ws is not null then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (ws, new.id, 'member') on conflict do nothing;
  end if;

  return new;
end $function$;

create or replace function public.domain_status(p_email text)
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case when exists (
    select 1 from public.allowed_domains d
      join public.workspaces w on w.id = d.workspace_id and not w.members_managed_by_os
     where d.domain = lower(split_part(p_email,'@',2))
  ) then 'member' else 'invite_only' end;
$function$;
