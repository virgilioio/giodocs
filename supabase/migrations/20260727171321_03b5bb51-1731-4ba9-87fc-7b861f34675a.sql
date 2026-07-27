-- workspace_invites: real invitation records
create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role public.member_role not null default 'member',
  token uuid not null default gen_random_uuid(),
  invited_by uuid,
  invited_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid,
  email_status text not null default 'pending',
  email_error text,
  constraint workspace_invites_email_lower check (email = lower(email)),
  constraint workspace_invites_email_status_chk
    check (email_status in ('pending','sent','failed'))
);

create unique index workspace_invites_token_uniq on public.workspace_invites (token);
create unique index workspace_invites_ws_email_pending_uniq
  on public.workspace_invites (workspace_id, email)
  where accepted_at is null;

grant select, insert, update, delete on public.workspace_invites to authenticated;
grant all on public.workspace_invites to service_role;

alter table public.workspace_invites enable row level security;

create policy invites_read on public.workspace_invites
  for select to authenticated
  using (public.is_member(workspace_id));

create policy invites_insert on public.workspace_invites
  for insert to authenticated
  with check (public.is_owner(workspace_id) and invited_by = auth.uid());

create policy invites_update on public.workspace_invites
  for update to authenticated
  using (public.is_owner(workspace_id))
  with check (public.is_owner(workspace_id));

create policy invites_delete on public.workspace_invites
  for delete to authenticated
  using (public.is_owner(workspace_id));

-- Tokenless view for non-owners (members can see pending list without leaking tokens).
create view public.workspace_invites_public
with (security_invoker = true)
as
  select id, workspace_id, email, role, invited_by, invited_at,
         expires_at, accepted_at, accepted_by, email_status
    from public.workspace_invites;

grant select on public.workspace_invites_public to authenticated;

-- Realtime
alter publication supabase_realtime add table public.workspace_invites;

-- RPC used by the edge function (service role) to (re)generate an invite.
create or replace function public.create_workspace_invite(
  p_workspace uuid,
  p_email text,
  p_role public.member_role,
  p_invited_by uuid
) returns public.workspace_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.workspace_invites;
  clean_email text := lower(trim(p_email));
begin
  -- Caller must be an owner of the workspace.
  if not exists (
    select 1 from public.workspace_members
      where workspace_id = p_workspace and user_id = p_invited_by and role = 'owner'
  ) then
    raise exception 'Only workspace owners can invite.' using errcode = '42501';
  end if;

  insert into public.workspace_invites
    (workspace_id, email, role, invited_by, token, invited_at, expires_at, email_status)
  values
    (p_workspace, clean_email, p_role, p_invited_by,
     gen_random_uuid(), now(), now() + interval '7 days', 'pending')
  on conflict (workspace_id, email) where accepted_at is null
  do update set
    role = excluded.role,
    invited_by = excluded.invited_by,
    token = gen_random_uuid(),
    invited_at = now(),
    expires_at = now() + interval '7 days',
    email_status = 'pending',
    email_error = null
  returning * into r;

  return r;
end $$;

grant execute on function public.create_workspace_invite(uuid, text, public.member_role, uuid)
  to service_role;

-- RPC called by the signed-in invitee when they land on /accept-invite/{token}.
create or replace function public.accept_workspace_invite(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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

  insert into public.workspace_members (workspace_id, user_id, role)
  values (inv.workspace_id, auth.uid(), inv.role)
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invites
     set accepted_at = now(), accepted_by = auth.uid()
   where id = inv.id;

  return inv.workspace_id;
end $$;

grant execute on function public.accept_workspace_invite(uuid) to authenticated;
