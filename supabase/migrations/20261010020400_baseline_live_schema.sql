-- Baseline: the database as it actually is, written down.
--
-- Until now the repo could not rebuild the live project (fzbsautaxfuqnjkchske):
-- page history (page_versions), custom emoji, the sharing rules
-- (can_manage_page_access, set_page_access, the split page_access policies),
-- the image storage bucket and its policies, avatar and ws_role columns and
-- several functions were made directly in the database with no migration, and
-- other functions had changed since their migration was written.
--
-- Generated on 2026-10-10 from the live catalog. Every statement is
-- idempotent and states the live definition exactly, so running it on the
-- live project changes nothing, and running it after the earlier migrations
-- on a fresh project produces the same database. Function bodies were checked
-- byte-for-byte (md5 of pg_get_functiondef) against the live ones.
--
-- Not run on the live project: there it is a no-op by construction (and the
-- connector would need the whole file pasted in). A `supabase db push` would
-- run it harmlessly. Checked with libpg_query: 191 statements, 83 dynamic
-- statements, 47 DO blocks and all PL/pgSQL bodies parse.
--
-- The one repo-only leftover, policy access_write on page_access (replaced
-- live by access_insert/access_update/access_delete), is neutralised with
-- USING (false) rather than dropped.


-- 1. Columns added directly in the database.
alter table public.profiles add column if not exists avatar_face smallint not null default 0;
alter table public.profiles add column if not exists avatar_skin smallint not null default 0;
alter table public.pages add column if not exists ws_role text not null default 'edit'::text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_avatar_face_check') then
    alter table public.profiles add constraint profiles_avatar_face_check check (((avatar_face >= 0) AND (avatar_face <= 8)));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_avatar_skin_check') then
    alter table public.profiles add constraint profiles_avatar_skin_check check (((avatar_skin >= 0) AND (avatar_skin <= 4)));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pages'::regclass and pg_get_constraintdef(oid) like '%ws_role%') then
    alter table public.pages add constraint pages_ws_role_check check ((ws_role = ANY (ARRAY['edit'::text, 'view'::text])));
  end if;
end $$;

-- 2. Tables made directly in the database.
create table if not exists public.custom_emoji (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null constraint custom_emoji_name_check check ((name ~ '^[a-z0-9][a-z0-9-]{0,23}$'::text)),
  description text not null default ''::text,
  path text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  constraint custom_emoji_pkey primary key (workspace_id, name)
);
alter table public.custom_emoji enable row level security;

create table if not exists public.page_versions (
  id uuid not null default gen_random_uuid() constraint page_versions_pkey primary key,
  page_id uuid not null references public.pages(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  blocks jsonb not null,
  props jsonb not null,
  icon text,
  edited_by uuid references public.profiles(id) on delete set null,
  created_at timestamp with time zone not null default now()
);
alter table public.page_versions enable row level security;
create index if not exists page_versions_page_idx on public.page_versions using btree (page_id, created_at desc);

-- 3. Image storage: a private bucket, 25 MB per file.
insert into storage.buckets (id, name, public, file_size_limit)
values ('page-images', 'page-images', false, 26214400)
on conflict (id) do nothing;

-- 4. Invite state view (runs as the caller; read-only).
create or replace view public.workspace_invites_state with (security_invoker = true) as
 SELECT id,
    workspace_id,
    email,
    role,
    token,
    invited_by,
    invited_at,
    expires_at,
    accepted_at,
    accepted_by,
    email_status,
    email_error,
        CASE
            WHEN accepted_at IS NOT NULL THEN 'accepted'::text
            WHEN expires_at < now() THEN 'expired'::text
            ELSE 'pending'::text
        END AS state
   FROM workspace_invites i;
revoke all on public.workspace_invites_state from anon, authenticated;
grant select on public.workspace_invites_state to authenticated;


-- 5. Every public function, exactly as live, with its grants.

CREATE OR REPLACE FUNCTION public.accept_workspace_invite(p_token uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;
revoke all on function public.accept_workspace_invite(p_token uuid) from public, anon, authenticated;
grant execute on function public.accept_workspace_invite(p_token uuid) to authenticated;
grant execute on function public.accept_workspace_invite(p_token uuid) to service_role;


CREATE OR REPLACE FUNCTION public.can_manage_page_access(p_page uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from pages p
     where p.id = p_page
       and p.deleted_at is null
       and (
         -- workspace owners always
         public.is_owner(p.workspace_id)
         -- members may share pages the whole workspace can already see
         or (p.access_type = 'workspace' and public.is_member(p.workspace_id))
         -- on restricted pages, only someone who already has write
         or (p.access_type = 'restricted' and exists (
               select 1 from page_access a
                where a.page_id = p.id
                  and a.user_id = auth.uid()
                  and a.capability = 'write'))
       )
  );
$function$
;
revoke all on function public.can_manage_page_access(p_page uuid) from public, anon, authenticated;
grant execute on function public.can_manage_page_access(p_page uuid) to authenticated;
grant execute on function public.can_manage_page_access(p_page uuid) to service_role;


CREATE OR REPLACE FUNCTION public.can_read_page(p_page uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from pages p
     where p.id = p_page
       and ((p.access_type = 'workspace' and public.is_member(p.workspace_id))
         or exists (select 1 from page_access a
                     where a.page_id = p.id and a.user_id = auth.uid())));
$function$
;
revoke all on function public.can_read_page(p_page uuid) from public, anon, authenticated;
grant execute on function public.can_read_page(p_page uuid) to authenticated;
grant execute on function public.can_read_page(p_page uuid) to service_role;


CREATE OR REPLACE FUNCTION public.create_workspace_invite(p_workspace uuid, p_email text, p_role member_role, p_invited_by uuid)
 RETURNS workspace_invites
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.workspace_invites;
  clean_email text := lower(trim(p_email));
  caller uuid := auth.uid();
begin
  -- Identity resolution, in priority order:
  --  1. A real session (a signed-in user calling the RPC directly) — always wins,
  --     so p_invited_by can never be used to impersonate an owner from the client.
  --  2. No session at all: this can only be a service-role call, because EXECUTE
  --     was revoked from anon and public. The edge function `send-workspace-invite`
  --     runs there, so we accept the supplied p_invited_by — and still require it
  --     to be a genuine owner below. Anyone holding the service-role key already
  --     has full database access, so this is not a new surface.
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
                token = gen_random_uuid(), invited_at = now(),
                expires_at = now() + interval '7 days',
                email_status = 'pending', email_error = null
  returning * into r;
  return r;
end $function$
;
revoke all on function public.create_workspace_invite(p_workspace uuid, p_email text, p_role member_role, p_invited_by uuid) from public, anon, authenticated;
grant execute on function public.create_workspace_invite(p_workspace uuid, p_email text, p_role member_role, p_invited_by uuid) to authenticated;
grant execute on function public.create_workspace_invite(p_workspace uuid, p_email text, p_role member_role, p_invited_by uuid) to service_role;


CREATE OR REPLACE FUNCTION public.custom_emoji_usage(p_workspace uuid)
 RETURNS TABLE(name text, pages integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select e.name,
         (select count(*)::int from public.pages p
           where p.workspace_id = p_workspace
             and p.deleted_at is null
             and p.icon = ':' || e.name || ':')
    from public.custom_emoji e
   where e.workspace_id = p_workspace;
$function$
;
revoke all on function public.custom_emoji_usage(p_workspace uuid) from public, anon, authenticated;
grant execute on function public.custom_emoji_usage(p_workspace uuid) to authenticated;
grant execute on function public.custom_emoji_usage(p_workspace uuid) to service_role;


CREATE OR REPLACE FUNCTION public.delete_page(p_page uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  did_delete boolean := false;
begin
  -- Permission logic unchanged from the original SQL body.
  update public.pages p
     set deleted_at = now()
   where p.id = p_page
     and p.deleted_at is null
     and (
       (p.access_type = 'workspace' and public.is_member(p.workspace_id))
       or exists (
         select 1 from public.page_access a
          where a.page_id = p.id
            and a.user_id = auth.uid()
            and a.capability = 'write'
       )
     );

  get diagnostics did_delete = ROW_COUNT;

  -- Orphan, never cascade. Soft delete means the FK's ON DELETE SET NULL
  -- never fires, so children would otherwise keep pointing at an invisible
  -- parent. A page is never deleted as a side effect of tidying up its
  -- container; it simply becomes unplaced.
  if did_delete then
    update public.pages c
       set parent_id = null
     where c.parent_id = p_page
       and c.deleted_at is null;
  end if;
end;
$function$
;
revoke all on function public.delete_page(p_page uuid) from public, anon, authenticated;
grant execute on function public.delete_page(p_page uuid) to authenticated;
grant execute on function public.delete_page(p_page uuid) to service_role;


CREATE OR REPLACE FUNCTION public.domain_status(p_email text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when exists (
    select 1 from public.allowed_domains
     where domain = lower(split_part(p_email,'@',2))
  ) then 'member' else 'invite_only' end;
$function$
;
revoke all on function public.domain_status(p_email text) from public, anon, authenticated;
grant execute on function public.domain_status(p_email text) to anon;
grant execute on function public.domain_status(p_email text) to authenticated;
grant execute on function public.domain_status(p_email text) to service_role;


CREATE OR REPLACE FUNCTION public.fork_view(p_view uuid, p_name text, p_filter jsonb, p_sort jsonb, p_layout view_layout)
 RETURNS views
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  insert into public.views (workspace_id, owner_id, name, scope, layout, filter, sort)
  select workspace_id, auth.uid(), p_name, 'personal', p_layout, p_filter, p_sort
    from public.views where id = p_view returning *;
$function$
;
revoke all on function public.fork_view(p_view uuid, p_name text, p_filter jsonb, p_sort jsonb, p_layout view_layout) from public, anon, authenticated;
grant execute on function public.fork_view(p_view uuid, p_name text, p_filter jsonb, p_sort jsonb, p_layout view_layout) to authenticated;
grant execute on function public.fork_view(p_view uuid, p_name text, p_filter jsonb, p_sort jsonb, p_layout view_layout) to service_role;


CREATE OR REPLACE FUNCTION public.grant_creator_page_access()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.access_type = 'restricted' and new.created_by is not null then
    insert into page_access (page_id, user_id, capability)
    values (new.id, new.created_by, 'write')
    on conflict (page_id, user_id) where user_id is not null
    do update set capability = 'write';
  end if;
  return null;
end $function$
;
revoke all on function public.grant_creator_page_access() from public, anon, authenticated;
grant execute on function public.grant_creator_page_access() to service_role;


CREATE OR REPLACE FUNCTION public.guard_page_parent()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  hops int;
  same_ws boolean;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'A page cannot be placed inside itself'
      using errcode = 'check_violation';
  end if;

  select p.workspace_id = new.workspace_id into same_ws
  from pages p where p.id = new.parent_id;

  if same_ws is distinct from true then
    raise exception 'A page can only be placed inside a page in the same workspace'
      using errcode = 'check_violation';
  end if;

  -- Walk UPWARD from the proposed parent. If we meet this page, the edge
  -- would close a loop. Walking up is bounded by the depth ceiling, so it
  -- terminates even on data that is already cyclic.
  with recursive up as (
    select new.parent_id as id, 1 as hops
    union all
    select p.parent_id, up.hops + 1
    from pages p join up on p.id = up.id
    where p.parent_id is not null and up.hops < 50
  )
  select count(*) into hops from up where id = new.id;

  if hops > 0 then
    raise exception 'That page already sits inside this one'
      using errcode = 'check_violation';
  end if;

  -- Depth ceiling: root is depth 0, so an ancestor chain of 3 is the max.
  with recursive up as (
    select new.parent_id as id, 1 as depth
    union all
    select p.parent_id, up.depth + 1
    from pages p join up on p.id = up.id
    where p.parent_id is not null and up.depth < 50
  )
  select max(depth) into hops from up;

  if coalesce(hops, 1) > 3 then
    raise exception 'Pages can only be nested three levels deep'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$
;
revoke all on function public.guard_page_parent() from public, anon, authenticated;
grant execute on function public.guard_page_parent() to public;
grant execute on function public.guard_page_parent() to anon;
grant execute on function public.guard_page_parent() to authenticated;
grant execute on function public.guard_page_parent() to service_role;


CREATE OR REPLACE FUNCTION public.guard_property_def()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  in_use boolean;
begin
  if tg_op = 'DELETE' then
    select exists (
      select 1 from pages p
       where p.workspace_id = old.workspace_id
         and p.props ? old.key
         and p.props -> old.key <> 'null'::jsonb
    ) into in_use;
    if in_use then
      raise exception 'Pages still have values for "%". Archive it instead; the values stay.', old.label
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  -- UPDATE
  if new.key is distinct from old.key then
    raise exception 'A property''s key can''t change. Rename its label instead.'
      using errcode = 'check_violation';
  end if;
  if new.workspace_id is distinct from old.workspace_id
     or new.is_system is distinct from old.is_system
     -- created_by may only be cleared (its profile was deleted).
     or (new.created_by is distinct from old.created_by and new.created_by is not null) then
    raise exception 'That can''t change on a property.'
      using errcode = 'check_violation';
  end if;

  if new.archived_at is distinct from old.archived_at then
    if old.is_system then
      raise exception 'Built-in properties can''t be archived.'
        using errcode = 'check_violation';
    end if;
    if not public.is_owner(old.workspace_id) then
      raise exception 'Only workspace owners can archive or restore properties.'
        using errcode = '42501';
    end if;
  end if;

  if new.type is distinct from old.type then
    if old.is_system then
      raise exception 'Built-in properties keep their type.'
        using errcode = 'check_violation';
    end if;
    select exists (
      select 1 from pages p
       where p.workspace_id = old.workspace_id
         and p.props ? old.key
         and p.props -> old.key <> 'null'::jsonb
    ) into in_use;
    if in_use then
      raise exception 'Pages already have values for "%", so its type can''t change.', old.label
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $function$
;
revoke all on function public.guard_property_def() from public, anon, authenticated;
grant execute on function public.guard_property_def() to service_role;


CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  select d.workspace_id into ws from public.allowed_domains d
   where d.domain = lower(split_part(new.email,'@',2)) limit 1;

  if ws is not null then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (ws, new.id, 'member') on conflict do nothing;
  end if;

  return new;
end $function$
;
revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to authenticated;
grant execute on function public.handle_new_user() to service_role;


CREATE OR REPLACE FUNCTION public.invite_preview(p_token uuid)
 RETURNS TABLE(workspace_name text, workspace_icon text, invited_email text, inviter_name text, role text, state text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select w.name, w.icon, i.email,
         coalesce(p.full_name, 'A workspace owner'),
         i.role::text,
         case when i.id is null then 'not_found'
              when i.accepted_at is not null then 'accepted'
              when i.expires_at < now() then 'expired'
              else 'valid' end
    from public.workspace_invites i
    join public.workspaces w on w.id = i.workspace_id
    left join public.profiles p on p.id = i.invited_by
   where i.token = p_token;
$function$
;
revoke all on function public.invite_preview(p_token uuid) from public, anon, authenticated;
grant execute on function public.invite_preview(p_token uuid) to anon;
grant execute on function public.invite_preview(p_token uuid) to authenticated;
grant execute on function public.invite_preview(p_token uuid) to service_role;


CREATE OR REPLACE FUNCTION public.is_member(p_ws uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from workspace_members
                  where workspace_id = p_ws and user_id = auth.uid());
$function$
;
revoke all on function public.is_member(p_ws uuid) from public, anon, authenticated;
grant execute on function public.is_member(p_ws uuid) to authenticated;
grant execute on function public.is_member(p_ws uuid) to service_role;


CREATE OR REPLACE FUNCTION public.is_owner(p_ws uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from workspace_members
                  where workspace_id = p_ws and user_id = auth.uid() and role = 'owner');
$function$
;
revoke all on function public.is_owner(p_ws uuid) from public, anon, authenticated;
grant execute on function public.is_owner(p_ws uuid) to authenticated;
grant execute on function public.is_owner(p_ws uuid) to service_role;


CREATE OR REPLACE FUNCTION public.leave_workspace(p_workspace uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me        uuid := auth.uid();
  owned     int;
  my_role   public.member_role;
  owners    int;
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select role into my_role from public.workspace_members
   where workspace_id = p_workspace and user_id = me;
  if my_role is null then
    raise exception 'You are not a member of this workspace' using errcode = '42501';
  end if;

  -- Ownership keeps a page verifiable; it cannot be dropped by walking away.
  select count(*) into owned from public.pages
   where workspace_id = p_workspace
     and deleted_at is null
     and props->>'owner' = me::text;
  if owned > 0 then
    raise exception 'You own % page(s). Reassign them before you go.', owned
      using errcode = '23514';
  end if;

  -- A workspace must keep at least one owner, or nobody can invite or publish.
  if my_role = 'owner' then
    select count(*) into owners from public.workspace_members
     where workspace_id = p_workspace and role = 'owner';
    if owners <= 1 then
      raise exception 'You are the only owner. Make someone else an owner first.'
        using errcode = '23514';
    end if;
  end if;

  delete from public.workspace_members
   where workspace_id = p_workspace and user_id = me;
end $function$
;
revoke all on function public.leave_workspace(p_workspace uuid) from public, anon, authenticated;
grant execute on function public.leave_workspace(p_workspace uuid) to authenticated;
grant execute on function public.leave_workspace(p_workspace uuid) to service_role;


CREATE OR REPLACE FUNCTION public.list_areas(p_workspace uuid)
 RETURNS TABLE(area text, page_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select props->>'area', count(*) from public.pages
   where workspace_id = p_workspace
     and deleted_at is null
     and archived_at is null
     and props ? 'area'
   group by 1 order by 1;
$function$
;
revoke all on function public.list_areas(p_workspace uuid) from public, anon, authenticated;
grant execute on function public.list_areas(p_workspace uuid) to authenticated;
grant execute on function public.list_areas(p_workspace uuid) to service_role;


CREATE OR REPLACE FUNCTION public.page_images_gc(p_page uuid, p_paths text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage'
AS $function$
declare n int;
begin
  -- Only someone who can edit the page may remove its images.
  if not exists (
    select 1 from public.pages p
     where p.id = p_page
       and p.deleted_at is null
       and ((p.access_type = 'workspace' and public.is_member(p.workspace_id))
         or exists (select 1 from public.page_access a
                     where a.page_id = p.id and a.user_id = auth.uid()
                       and a.capability = 'write'))
  ) then
    raise exception 'You cannot modify images on this page' using errcode = '42501';
  end if;

  -- Only paths belonging to THIS page, so a caller cannot pass arbitrary keys.
  delete from storage.objects o
   where o.bucket_id = 'page-images'
     and o.name = any(p_paths)
     and (storage.foldername(o.name))[2] = p_page::text;
  get diagnostics n = row_count;
  return n;
end $function$
;
revoke all on function public.page_images_gc(p_page uuid, p_paths text[]) from public, anon, authenticated;
grant execute on function public.page_images_gc(p_page uuid, p_paths text[]) to authenticated;
grant execute on function public.page_images_gc(p_page uuid, p_paths text[]) to service_role;


CREATE OR REPLACE FUNCTION public.page_search_text(p_title text, p_blocks jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  with recursive tree(b) as (
    select b from jsonb_array_elements(p_blocks) b
    union all
    select nb
      from tree t,
           lateral (
             select nb from jsonb_array_elements(coalesce(t.b->'children','[]'::jsonb)) nb
             union all
             select nb from jsonb_array_elements(coalesce(t.b->'cols','[]'::jsonb)) col,
                            lateral jsonb_array_elements(col) nb
           ) x
  )
  select p_title || ' ' || coalesce((
    select string_agg(
      coalesce(b->>'text','')  || ' ' || coalesce(b->>'body','')  || ' ' ||
      coalesce(b->>'cap','')   || ' ' || coalesce(b->>'alt','')   || ' ' ||
      coalesce(b->>'fname','') || ' ' ||
      coalesce((select string_agg(cell,' ')
                  from jsonb_array_elements_text(
                    coalesce(jsonb_path_query_array(b,'$.rows[*][*]'),'[]'::jsonb)
                  ) as cell), '') || ' ' ||
      coalesce((select string_agg(cv,' ')
                  from jsonb_array_elements_text(
                    coalesce(jsonb_path_query_array(b,'$.cells[*][*].v'),'[]'::jsonb)
                  ) as cv), ''),
      ' ')
    from tree), '');
$function$
;
revoke all on function public.page_search_text(p_title text, p_blocks jsonb) from public, anon, authenticated;
grant execute on function public.page_search_text(p_title text, p_blocks jsonb) to authenticated;
grant execute on function public.page_search_text(p_title text, p_blocks jsonb) to service_role;


CREATE OR REPLACE FUNCTION public.pages_tsv_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.search_tsv := to_tsvector('english', public.page_search_text(new.title, new.blocks));
  return new;
end $function$
;
revoke all on function public.pages_tsv_trigger() from public, anon, authenticated;
grant execute on function public.pages_tsv_trigger() to authenticated;
grant execute on function public.pages_tsv_trigger() to service_role;


CREATE OR REPLACE FUNCTION public.publish_view(p_view uuid)
 RETURNS views
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare r public.views;
begin
  update public.views v set scope = 'team'
   where v.id = p_view and v.owner_id = auth.uid() and public.is_owner(v.workspace_id)
  returning * into r;
  if r.id is null then
    raise exception 'Only workspace owners can publish a view to the team.'
      using errcode = '42501';
  end if;
  return r;
end $function$
;
revoke all on function public.publish_view(p_view uuid) from public, anon, authenticated;
grant execute on function public.publish_view(p_view uuid) to authenticated;
grant execute on function public.publish_view(p_view uuid) to service_role;


CREATE OR REPLACE FUNCTION public.rename_custom_emoji(p_workspace uuid, p_old text, p_new text, p_desc text, p_path text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare touched int;
begin
  if p_new !~ '^[a-z0-9][a-z0-9-]{0,23}$' then
    raise exception 'Invalid emoji name %', p_new using errcode = '22023';
  end if;
  -- Uniqueness must EXCLUDE the row being edited, or saving without
  -- renaming reports a collision with itself.
  if p_new <> p_old and exists (
    select 1 from public.custom_emoji
     where workspace_id = p_workspace and name = p_new
  ) then
    raise exception ':%: is taken. Pick another name.', p_new using errcode = '23505';
  end if;

  update public.custom_emoji
     set name = p_new, description = coalesce(p_desc, ''), path = coalesce(p_path, path)
   where workspace_id = p_workspace and name = p_old;
  if not found then
    raise exception 'No such emoji :%:', p_old using errcode = '02000';
  end if;

  update public.pages
     set icon = ':' || p_new || ':'
   where workspace_id = p_workspace and icon = ':' || p_old || ':';
  get diagnostics touched = row_count;

  return touched;   -- the toast reports this; it is the surprising number
end $function$
;
revoke all on function public.rename_custom_emoji(p_workspace uuid, p_old text, p_new text, p_desc text, p_path text) from public, anon, authenticated;
grant execute on function public.rename_custom_emoji(p_workspace uuid, p_old text, p_new text, p_desc text, p_path text) to authenticated;
grant execute on function public.rename_custom_emoji(p_workspace uuid, p_old text, p_new text, p_desc text, p_path text) to service_role;


CREATE OR REPLACE FUNCTION public.restore_page(p_page uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.pages p set deleted_at = null
   where p.id = p_page and public.is_member(p.workspace_id);
$function$
;
revoke all on function public.restore_page(p_page uuid) from public, anon, authenticated;
grant execute on function public.restore_page(p_page uuid) to authenticated;
grant execute on function public.restore_page(p_page uuid) to service_role;


CREATE OR REPLACE FUNCTION public.restore_page_version(p_version uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v public.page_versions;
begin
  select * into v from public.page_versions where id = p_version;
  if v.id is null then
    raise exception 'Version not found';
  end if;
  update public.pages p
     set title = v.title, blocks = v.blocks, props = v.props, icon = v.icon
   where p.id = v.page_id;
end $function$
;
revoke all on function public.restore_page_version(p_version uuid) from public, anon, authenticated;
grant execute on function public.restore_page_version(p_version uuid) to authenticated;
grant execute on function public.restore_page_version(p_version uuid) to service_role;


CREATE OR REPLACE FUNCTION public.safe_uuid(t text)
 RETURNS uuid
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when t ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then t::uuid else null end;
$function$
;
revoke all on function public.safe_uuid(t text) from public, anon, authenticated;
grant execute on function public.safe_uuid(t text) to public;
grant execute on function public.safe_uuid(t text) to anon;
grant execute on function public.safe_uuid(t text) to authenticated;
grant execute on function public.safe_uuid(t text) to service_role;


CREATE OR REPLACE FUNCTION public.search_pages(p_workspace uuid, p_q text, p_limit integer DEFAULT 12)
 RETURNS TABLE(id uuid, title text, icon text, props jsonb, snippets jsonb, rank real)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select p.id, p.title, p.icon, p.props,
         coalesce((select jsonb_agg(jsonb_build_object('id', b->>'id', 'text', coalesce(b->>'text', b->>'body')))
                     from (select b from jsonb_array_elements(p.blocks) b
                            where (b->>'text') ilike '%' || p_q || '%'
                               or (b->>'body') ilike '%' || p_q || '%'
                            limit 2) s(b)), '[]'::jsonb),
         ts_rank(p.search_tsv, websearch_to_tsquery('simple', p_q))
    from public.pages p
   where p.workspace_id = p_workspace and p.deleted_at is null
     and (p.search_tsv @@ websearch_to_tsquery('simple', p_q) or p.title ilike '%'||p_q||'%')
   order by 6 desc, p.edited_at desc
   limit least(p_limit, 50);
$function$
;
revoke all on function public.search_pages(p_workspace uuid, p_q text, p_limit integer) from public, anon, authenticated;
grant execute on function public.search_pages(p_workspace uuid, p_q text, p_limit integer) to authenticated;
grant execute on function public.search_pages(p_workspace uuid, p_q text, p_limit integer) to service_role;


CREATE OR REPLACE FUNCTION public.set_page_access(p_page uuid, p_type text, p_ws_role text, p_people jsonb, p_guests jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner   uuid;
  v_people  jsonb := coalesce(p_people, '[]'::jsonb);
  v_guests  jsonb := coalesce(p_guests, '[]'::jsonb);
  v_count   int;
begin
  if not public.can_manage_page_access(p_page) then
    raise exception 'You do not have permission to change access on this page'
      using errcode = '42501';
  end if;
  if p_type not in ('workspace','restricted') then
    raise exception 'Invalid access type %', p_type using errcode = '22023';
  end if;
  if p_ws_role not in ('edit','view') then
    raise exception 'Invalid workspace role %', p_ws_role using errcode = '22023';
  end if;

  -- §6.1 — a restricted page always contains its owner. Enforced here so both
  -- entry points (picking "Only invited people", and §6.2's implicit flip) pass
  -- through the same floor.
  if p_type = 'restricted' then
    select coalesce((props->>'owner')::uuid, auth.uid())
      into v_owner from public.pages where id = p_page;

    if v_owner is not null and not exists (
      select 1 from jsonb_array_elements(v_people) e
       where (e->>'id')::uuid = v_owner
    ) then
      v_people := jsonb_build_array(
        jsonb_build_object('id', v_owner::text, 'role', 'edit')
      ) || v_people;
    end if;

    -- §6.3 — the member list can never be empty, and guests do not satisfy it.
    select count(*) into v_count from jsonb_array_elements(v_people);
    if v_count = 0 then
      raise exception 'Someone at the workspace has to keep access'
        using errcode = '23514';
    end if;
  end if;

  -- Replace grants atomically.
  delete from public.page_access where page_id = p_page;

  insert into public.page_access (page_id, user_id, capability)
  select p_page, (e->>'id')::uuid,
         case when e->>'role' = 'view' then 'read' else 'write' end
    from jsonb_array_elements(v_people) e
   where (e->>'id') is not null
  on conflict do nothing;

  insert into public.page_access (page_id, guest_email, capability)
  select p_page, lower(e->>'email'),
         case when e->>'role' = 'edit' then 'write' else 'read' end
    from jsonb_array_elements(v_guests) e
   where (e->>'email') is not null
  on conflict do nothing;

  update public.pages
     set access_type = p_type, ws_role = p_ws_role
   where id = p_page;
end $function$
;
revoke all on function public.set_page_access(p_page uuid, p_type text, p_ws_role text, p_people jsonb, p_guests jsonb) from public, anon, authenticated;
grant execute on function public.set_page_access(p_page uuid, p_type text, p_ws_role text, p_people jsonb, p_guests jsonb) to authenticated;
grant execute on function public.set_page_access(p_page uuid, p_type text, p_ws_role text, p_people jsonb, p_guests jsonb) to service_role;


CREATE OR REPLACE FUNCTION public.set_page_property(p_page uuid, p_key text, p_value jsonb)
 RETURNS pages
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare r public.pages;
begin
  update public.pages
     set props = case when p_value is null then props - p_key
                      else props || jsonb_build_object(p_key, p_value) end
   where id = p_page returning * into r;
  return r;
end $function$
;
revoke all on function public.set_page_property(p_page uuid, p_key text, p_value jsonb) from public, anon, authenticated;
grant execute on function public.set_page_property(p_page uuid, p_key text, p_value jsonb) to authenticated;
grant execute on function public.set_page_property(p_page uuid, p_key text, p_value jsonb) to service_role;


CREATE OR REPLACE FUNCTION public.snapshot_page_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (old.title, old.blocks, old.props, old.icon)
     is distinct from (new.title, new.blocks, new.props, new.icon) then
    if not exists (
      select 1 from public.page_versions v
       where v.page_id = old.id
         and v.created_at > now() - interval '2 minutes'
         and v.edited_by is not distinct from old.edited_by
    ) then
      insert into public.page_versions
        (page_id, workspace_id, title, blocks, props, icon, edited_by)
      values (old.id, old.workspace_id, old.title, old.blocks, old.props,
              old.icon, old.edited_by);
      -- Keep the 50 most recent per page.
      delete from public.page_versions v
       where v.page_id = old.id
         and v.id not in (
           select id from public.page_versions
            where page_id = old.id
            order by created_at desc
            limit 50);
    end if;
  end if;
  return new;
end $function$
;
revoke all on function public.snapshot_page_version() from public, anon, authenticated;
grant execute on function public.snapshot_page_version() to authenticated;
grant execute on function public.snapshot_page_version() to service_role;


CREATE OR REPLACE FUNCTION public.touch_page()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.edited_at := now();
  new.edited_by := auth.uid();
  return new;
end $function$
;
revoke all on function public.touch_page() from public, anon, authenticated;
grant execute on function public.touch_page() to authenticated;
grant execute on function public.touch_page() to service_role;


CREATE OR REPLACE FUNCTION public.validate_page_props()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare k text; d public.property_defs; v jsonb;
begin
  for k in select jsonb_object_keys(new.props) loop
    select * into d from public.property_defs
     where workspace_id = new.workspace_id and key = k;
    if d.id is null then
      raise exception 'Unknown property "%". Register it in property_defs first.', k
        using errcode='23514';
    end if;
    v := new.props -> k;
    if v = 'null'::jsonb then continue; end if;
    case d.type::text
      when 'multi_select' then
        if jsonb_typeof(v) <> 'array' then raise exception '% must be an array', k; end if;
      when 'checkbox' then
        if jsonb_typeof(v) <> 'boolean' then raise exception '% must be a boolean', k; end if;
      when 'number' then
        if jsonb_typeof(v) <> 'number' then raise exception '% must be a number', k; end if;
      when 'select' then
        if d.open_values then
          if jsonb_typeof(v) <> 'string' then
            raise exception '% must be a string', k;
          end if;
        elsif jsonb_array_length(d.options) > 0
           and not (d.options @> jsonb_build_array(jsonb_build_object('value', v #>> '{}')))
        then raise exception '% is not a legal value for %', v #>> '{}', k; end if;
      when 'status' then
        if jsonb_array_length(d.options) > 0
           and not (d.options @> jsonb_build_array(jsonb_build_object('value', v #>> '{}')))
        then raise exception '% is not a legal value for %', v #>> '{}', k; end if;
      when 'url' then
        if jsonb_typeof(v) <> 'string' or length(v #>> '{}') > 2048 then
          raise exception '% must be a link', k;
        end if;
      when 'email' then
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
          raise exception '% must be an email address', k;
        end if;
      when 'phone' then
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^\+?[0-9 ().-]{4,32}$' then
          raise exception '% must be a phone number', k;
        end if;
      else null;
    end case;
  end loop;
  return new;
end $function$
;
revoke all on function public.validate_page_props() from public, anon, authenticated;
grant execute on function public.validate_page_props() to authenticated;
grant execute on function public.validate_page_props() to service_role;


CREATE OR REPLACE FUNCTION public.verify_page(p_page uuid)
 RETURNS pages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.pages;
begin
  if not public.can_read_page(p_page) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into public.page_verifications(page_id, verified_by)
    values (p_page, auth.uid());
  update public.pages
     set verified_at = now(), verified_by = auth.uid()
   where id = p_page
   returning * into r;
  return r;
end $function$
;
revoke all on function public.verify_page(p_page uuid) from public, anon, authenticated;
grant execute on function public.verify_page(p_page uuid) to authenticated;
grant execute on function public.verify_page(p_page uuid) to service_role;


-- 6. Triggers.

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created') then
    execute $ddl$CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user()$ddl$;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.pages'::regclass and tgname = 'pages_grant_creator_access') then
    execute $ddl$CREATE TRIGGER pages_grant_creator_access AFTER INSERT ON public.pages FOR EACH ROW EXECUTE FUNCTION grant_creator_page_access()$ddl$;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.pages'::regclass and tgname = 'pages_snapshot') then
    execute $ddl$CREATE TRIGGER pages_snapshot BEFORE UPDATE ON public.pages FOR EACH ROW EXECUTE FUNCTION snapshot_page_version()$ddl$;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.pages'::regclass and tgname = 'pages_touch') then
    execute $ddl$CREATE TRIGGER pages_touch BEFORE UPDATE ON public.pages FOR EACH ROW WHEN (((((old.title IS DISTINCT FROM new.title) OR (old.blocks IS DISTINCT FROM new.blocks)) OR (old.props IS DISTINCT FROM new.props)) OR (old.icon IS DISTINCT FROM new.icon))) EXECUTE FUNCTION touch_page()$ddl$;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.pages'::regclass and tgname = 'pages_tsv') then
    execute $ddl$CREATE TRIGGER pages_tsv BEFORE INSERT OR UPDATE OF title, blocks ON public.pages FOR EACH ROW EXECUTE FUNCTION pages_tsv_trigger()$ddl$;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.pages'::regclass and tgname = 'pages_validate_props') then
    execute $ddl$CREATE TRIGGER pages_validate_props BEFORE INSERT OR UPDATE OF props ON public.pages FOR EACH ROW EXECUTE FUNCTION validate_page_props()$ddl$;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.pages'::regclass and tgname = 'trg_guard_page_parent') then
    execute $ddl$CREATE TRIGGER trg_guard_page_parent BEFORE INSERT OR UPDATE OF parent_id, workspace_id ON public.pages FOR EACH ROW EXECUTE FUNCTION guard_page_parent()$ddl$;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.property_defs'::regclass and tgname = 'property_defs_guard') then
    execute $ddl$CREATE TRIGGER property_defs_guard BEFORE DELETE OR UPDATE ON public.property_defs FOR EACH ROW EXECUTE FUNCTION guard_property_def()$ddl$;
  end if;
end $$;

-- 7. Row level security policies, as live: created when missing, otherwise
--    set to the live expression.

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'allowed_domains' and policyname = 'domains_read') then
    execute $ddl$ALTER POLICY domains_read ON public.allowed_domains TO public USING (is_member(workspace_id))$ddl$;
  else
    execute $ddl$CREATE POLICY domains_read ON public.allowed_domains AS PERMISSIVE FOR SELECT TO public USING (is_member(workspace_id))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'allowed_domains' and policyname = 'domains_write') then
    execute $ddl$ALTER POLICY domains_write ON public.allowed_domains TO public USING (is_owner(workspace_id)) WITH CHECK (is_owner(workspace_id))$ddl$;
  else
    execute $ddl$CREATE POLICY domains_write ON public.allowed_domains AS PERMISSIVE FOR ALL TO public USING (is_owner(workspace_id)) WITH CHECK (is_owner(workspace_id))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'custom_emoji' and policyname = 'custom_emoji_delete') then
    execute $ddl$ALTER POLICY custom_emoji_delete ON public.custom_emoji TO public USING ((is_member(workspace_id) AND ((created_by = auth.uid()) OR is_owner(workspace_id))))$ddl$;
  else
    execute $ddl$CREATE POLICY custom_emoji_delete ON public.custom_emoji AS PERMISSIVE FOR DELETE TO public USING ((is_member(workspace_id) AND ((created_by = auth.uid()) OR is_owner(workspace_id))))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'custom_emoji' and policyname = 'custom_emoji_insert') then
    execute $ddl$ALTER POLICY custom_emoji_insert ON public.custom_emoji TO public WITH CHECK ((is_member(workspace_id) AND (created_by = auth.uid())))$ddl$;
  else
    execute $ddl$CREATE POLICY custom_emoji_insert ON public.custom_emoji AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_member(workspace_id) AND (created_by = auth.uid())))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'custom_emoji' and policyname = 'custom_emoji_read') then
    execute $ddl$ALTER POLICY custom_emoji_read ON public.custom_emoji TO public USING (is_member(workspace_id))$ddl$;
  else
    execute $ddl$CREATE POLICY custom_emoji_read ON public.custom_emoji AS PERMISSIVE FOR SELECT TO public USING (is_member(workspace_id))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'custom_emoji' and policyname = 'custom_emoji_update') then
    execute $ddl$ALTER POLICY custom_emoji_update ON public.custom_emoji TO public USING ((is_member(workspace_id) AND ((created_by = auth.uid()) OR is_owner(workspace_id))))$ddl$;
  else
    execute $ddl$CREATE POLICY custom_emoji_update ON public.custom_emoji AS PERMISSIVE FOR UPDATE TO public USING ((is_member(workspace_id) AND ((created_by = auth.uid()) OR is_owner(workspace_id))))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'page_access' and policyname = 'access_delete') then
    execute $ddl$ALTER POLICY access_delete ON public.page_access TO public USING (can_manage_page_access(page_id))$ddl$;
  else
    execute $ddl$CREATE POLICY access_delete ON public.page_access AS PERMISSIVE FOR DELETE TO public USING (can_manage_page_access(page_id))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'page_access' and policyname = 'access_insert') then
    execute $ddl$ALTER POLICY access_insert ON public.page_access TO public WITH CHECK (can_manage_page_access(page_id))$ddl$;
  else
    execute $ddl$CREATE POLICY access_insert ON public.page_access AS PERMISSIVE FOR INSERT TO public WITH CHECK (can_manage_page_access(page_id))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'page_access' and policyname = 'access_read') then
    execute $ddl$ALTER POLICY access_read ON public.page_access TO public USING (can_read_page(page_id))$ddl$;
  else
    execute $ddl$CREATE POLICY access_read ON public.page_access AS PERMISSIVE FOR SELECT TO public USING (can_read_page(page_id))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'page_access' and policyname = 'access_update') then
    execute $ddl$ALTER POLICY access_update ON public.page_access TO public USING (can_manage_page_access(page_id)) WITH CHECK (can_manage_page_access(page_id))$ddl$;
  else
    execute $ddl$CREATE POLICY access_update ON public.page_access AS PERMISSIVE FOR UPDATE TO public USING (can_manage_page_access(page_id)) WITH CHECK (can_manage_page_access(page_id))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'page_verifications' and policyname = 'verif_read') then
    execute $ddl$ALTER POLICY verif_read ON public.page_verifications TO public USING (can_read_page(page_id))$ddl$;
  else
    execute $ddl$CREATE POLICY verif_read ON public.page_verifications AS PERMISSIVE FOR SELECT TO public USING (can_read_page(page_id))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'page_verifications' and policyname = 'verif_write') then
    execute $ddl$ALTER POLICY verif_write ON public.page_verifications TO public WITH CHECK ((can_read_page(page_id) AND (verified_by = ( SELECT auth.uid() AS uid))))$ddl$;
  else
    execute $ddl$CREATE POLICY verif_write ON public.page_verifications AS PERMISSIVE FOR INSERT TO public WITH CHECK ((can_read_page(page_id) AND (verified_by = ( SELECT auth.uid() AS uid))))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'page_versions' and policyname = 'page_versions_read') then
    execute $ddl$ALTER POLICY page_versions_read ON public.page_versions TO public USING (can_read_page(page_id))$ddl$;
  else
    execute $ddl$CREATE POLICY page_versions_read ON public.page_versions AS PERMISSIVE FOR SELECT TO public USING (can_read_page(page_id))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pages' and policyname = 'pages_insert') then
    execute $ddl$ALTER POLICY pages_insert ON public.pages TO public WITH CHECK ((is_member(workspace_id) AND (created_by = ( SELECT auth.uid() AS uid))))$ddl$;
  else
    execute $ddl$CREATE POLICY pages_insert ON public.pages AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_member(workspace_id) AND (created_by = ( SELECT auth.uid() AS uid))))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pages' and policyname = 'pages_read') then
    execute $ddl$ALTER POLICY pages_read ON public.pages TO public USING (((deleted_at IS NULL) AND (((access_type = 'workspace'::text) AND is_member(workspace_id)) OR (EXISTS ( SELECT 1
   FROM page_access a
  WHERE ((a.page_id = pages.id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))))$ddl$;
  else
    execute $ddl$CREATE POLICY pages_read ON public.pages AS PERMISSIVE FOR SELECT TO public USING (((deleted_at IS NULL) AND (((access_type = 'workspace'::text) AND is_member(workspace_id)) OR (EXISTS ( SELECT 1
   FROM page_access a
  WHERE ((a.page_id = pages.id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pages' and policyname = 'pages_update') then
    execute $ddl$ALTER POLICY pages_update ON public.pages TO public USING ((((access_type = 'workspace'::text) AND is_member(workspace_id)) OR (EXISTS ( SELECT 1
   FROM page_access a
  WHERE ((a.page_id = pages.id) AND (a.user_id = ( SELECT auth.uid() AS uid)) AND (a.capability = 'write'::text))))))$ddl$;
  else
    execute $ddl$CREATE POLICY pages_update ON public.pages AS PERMISSIVE FOR UPDATE TO public USING ((((access_type = 'workspace'::text) AND is_member(workspace_id)) OR (EXISTS ( SELECT 1
   FROM page_access a
  WHERE ((a.page_id = pages.id) AND (a.user_id = ( SELECT auth.uid() AS uid)) AND (a.capability = 'write'::text))))))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_read') then
    execute $ddl$ALTER POLICY profiles_read ON public.profiles TO public USING ((EXISTS ( SELECT 1
   FROM (workspace_members m1
     JOIN workspace_members m2 USING (workspace_id))
  WHERE ((m1.user_id = ( SELECT auth.uid() AS uid)) AND (m2.user_id = profiles.id)))))$ddl$;
  else
    execute $ddl$CREATE POLICY profiles_read ON public.profiles AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM (workspace_members m1
     JOIN workspace_members m2 USING (workspace_id))
  WHERE ((m1.user_id = ( SELECT auth.uid() AS uid)) AND (m2.user_id = profiles.id)))))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_self_write') then
    execute $ddl$ALTER POLICY profiles_self_write ON public.profiles TO public USING ((id = ( SELECT auth.uid() AS uid))) WITH CHECK ((id = ( SELECT auth.uid() AS uid)))$ddl$;
  else
    execute $ddl$CREATE POLICY profiles_self_write ON public.profiles AS PERMISSIVE FOR UPDATE TO public USING ((id = ( SELECT auth.uid() AS uid))) WITH CHECK ((id = ( SELECT auth.uid() AS uid)))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'property_defs' and policyname = 'propdefs_delete_owners') then
    execute $ddl$ALTER POLICY propdefs_delete_owners ON public.property_defs TO public USING ((is_owner(workspace_id) AND (is_system = false)))$ddl$;
  else
    execute $ddl$CREATE POLICY propdefs_delete_owners ON public.property_defs AS RESTRICTIVE FOR DELETE TO public USING ((is_owner(workspace_id) AND (is_system = false)))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'property_defs' and policyname = 'propdefs_insert_rules') then
    execute $ddl$ALTER POLICY propdefs_insert_rules ON public.property_defs TO public WITH CHECK (((is_system = false) AND (archived_at IS NULL) AND (created_by = ( SELECT auth.uid() AS uid))))$ddl$;
  else
    execute $ddl$CREATE POLICY propdefs_insert_rules ON public.property_defs AS RESTRICTIVE FOR INSERT TO public WITH CHECK (((is_system = false) AND (archived_at IS NULL) AND (created_by = ( SELECT auth.uid() AS uid))))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'property_defs' and policyname = 'propdefs_read') then
    execute $ddl$ALTER POLICY propdefs_read ON public.property_defs TO public USING (is_member(workspace_id))$ddl$;
  else
    execute $ddl$CREATE POLICY propdefs_read ON public.property_defs AS PERMISSIVE FOR SELECT TO public USING (is_member(workspace_id))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'property_defs' and policyname = 'propdefs_write') then
    execute $ddl$ALTER POLICY propdefs_write ON public.property_defs TO public USING (is_member(workspace_id)) WITH CHECK (is_member(workspace_id))$ddl$;
  else
    execute $ddl$CREATE POLICY propdefs_write ON public.property_defs AS PERMISSIVE FOR ALL TO public USING (is_member(workspace_id)) WITH CHECK (is_member(workspace_id))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'views' and policyname = 'views_delete') then
    execute $ddl$ALTER POLICY views_delete ON public.views TO public USING (((owner_id = ( SELECT auth.uid() AS uid)) OR is_owner(workspace_id)))$ddl$;
  else
    execute $ddl$CREATE POLICY views_delete ON public.views AS PERMISSIVE FOR DELETE TO public USING (((owner_id = ( SELECT auth.uid() AS uid)) OR is_owner(workspace_id)))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'views' and policyname = 'views_insert') then
    execute $ddl$ALTER POLICY views_insert ON public.views TO public WITH CHECK ((is_member(workspace_id) AND (owner_id = ( SELECT auth.uid() AS uid)) AND (scope = 'personal'::view_scope)))$ddl$;
  else
    execute $ddl$CREATE POLICY views_insert ON public.views AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_member(workspace_id) AND (owner_id = ( SELECT auth.uid() AS uid)) AND (scope = 'personal'::view_scope)))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'views' and policyname = 'views_read') then
    execute $ddl$ALTER POLICY views_read ON public.views TO public USING ((is_member(workspace_id) AND ((scope = 'team'::view_scope) OR (owner_id = ( SELECT auth.uid() AS uid)))))$ddl$;
  else
    execute $ddl$CREATE POLICY views_read ON public.views AS PERMISSIVE FOR SELECT TO public USING ((is_member(workspace_id) AND ((scope = 'team'::view_scope) OR (owner_id = ( SELECT auth.uid() AS uid)))))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'views' and policyname = 'views_update') then
    execute $ddl$ALTER POLICY views_update ON public.views TO public USING ((((owner_id = ( SELECT auth.uid() AS uid)) AND (scope = 'personal'::view_scope)) OR ((scope = 'team'::view_scope) AND is_owner(workspace_id)))) WITH CHECK ((((owner_id = ( SELECT auth.uid() AS uid)) AND (scope = 'personal'::view_scope)) OR ((scope = 'team'::view_scope) AND is_owner(workspace_id))))$ddl$;
  else
    execute $ddl$CREATE POLICY views_update ON public.views AS PERMISSIVE FOR UPDATE TO public USING ((((owner_id = ( SELECT auth.uid() AS uid)) AND (scope = 'personal'::view_scope)) OR ((scope = 'team'::view_scope) AND is_owner(workspace_id)))) WITH CHECK ((((owner_id = ( SELECT auth.uid() AS uid)) AND (scope = 'personal'::view_scope)) OR ((scope = 'team'::view_scope) AND is_owner(workspace_id))))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspace_invites' and policyname = 'invites_delete') then
    execute $ddl$ALTER POLICY invites_delete ON public.workspace_invites TO authenticated USING (is_owner(workspace_id))$ddl$;
  else
    execute $ddl$CREATE POLICY invites_delete ON public.workspace_invites AS PERMISSIVE FOR DELETE TO authenticated USING (is_owner(workspace_id))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspace_invites' and policyname = 'invites_insert') then
    execute $ddl$ALTER POLICY invites_insert ON public.workspace_invites TO authenticated WITH CHECK ((is_owner(workspace_id) AND (invited_by = auth.uid())))$ddl$;
  else
    execute $ddl$CREATE POLICY invites_insert ON public.workspace_invites AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_owner(workspace_id) AND (invited_by = auth.uid())))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspace_invites' and policyname = 'invites_read') then
    execute $ddl$ALTER POLICY invites_read ON public.workspace_invites TO authenticated USING (is_member(workspace_id))$ddl$;
  else
    execute $ddl$CREATE POLICY invites_read ON public.workspace_invites AS PERMISSIVE FOR SELECT TO authenticated USING (is_member(workspace_id))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspace_invites' and policyname = 'invites_update') then
    execute $ddl$ALTER POLICY invites_update ON public.workspace_invites TO authenticated USING (is_owner(workspace_id)) WITH CHECK (is_owner(workspace_id))$ddl$;
  else
    execute $ddl$CREATE POLICY invites_update ON public.workspace_invites AS PERMISSIVE FOR UPDATE TO authenticated USING (is_owner(workspace_id)) WITH CHECK (is_owner(workspace_id))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspace_members' and policyname = 'members_read') then
    execute $ddl$ALTER POLICY members_read ON public.workspace_members TO public USING (is_member(workspace_id))$ddl$;
  else
    execute $ddl$CREATE POLICY members_read ON public.workspace_members AS PERMISSIVE FOR SELECT TO public USING (is_member(workspace_id))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspace_members' and policyname = 'members_write') then
    execute $ddl$ALTER POLICY members_write ON public.workspace_members TO public USING (is_owner(workspace_id)) WITH CHECK (is_owner(workspace_id))$ddl$;
  else
    execute $ddl$CREATE POLICY members_write ON public.workspace_members AS PERMISSIVE FOR ALL TO public USING (is_owner(workspace_id)) WITH CHECK (is_owner(workspace_id))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspaces' and policyname = 'ws_read') then
    execute $ddl$ALTER POLICY ws_read ON public.workspaces TO public USING (is_member(id))$ddl$;
  else
    execute $ddl$CREATE POLICY ws_read ON public.workspaces AS PERMISSIVE FOR SELECT TO public USING (is_member(id))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspaces' and policyname = 'ws_update') then
    execute $ddl$ALTER POLICY ws_update ON public.workspaces TO public USING (is_owner(id)) WITH CHECK (is_owner(id))$ddl$;
  else
    execute $ddl$CREATE POLICY ws_update ON public.workspaces AS PERMISSIVE FOR UPDATE TO public USING (is_owner(id)) WITH CHECK (is_owner(id))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'page_images_delete') then
    execute $ddl$ALTER POLICY page_images_delete ON storage.objects TO public USING (((bucket_id = 'page-images'::text) AND is_member(safe_uuid((storage.foldername(name))[1]))))$ddl$;
  else
    execute $ddl$CREATE POLICY page_images_delete ON storage.objects AS PERMISSIVE FOR DELETE TO public USING (((bucket_id = 'page-images'::text) AND is_member(safe_uuid((storage.foldername(name))[1]))))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'page_images_insert') then
    execute $ddl$ALTER POLICY page_images_insert ON storage.objects TO public WITH CHECK (((bucket_id = 'page-images'::text) AND is_member(safe_uuid((storage.foldername(name))[1])) AND
CASE
    WHEN ((storage.foldername(name))[2] = 'emoji'::text) THEN true
    ELSE can_read_page(safe_uuid((storage.foldername(name))[2]))
END))$ddl$;
  else
    execute $ddl$CREATE POLICY page_images_insert ON storage.objects AS PERMISSIVE FOR INSERT TO public WITH CHECK (((bucket_id = 'page-images'::text) AND is_member(safe_uuid((storage.foldername(name))[1])) AND
CASE
    WHEN ((storage.foldername(name))[2] = 'emoji'::text) THEN true
    ELSE can_read_page(safe_uuid((storage.foldername(name))[2]))
END))$ddl$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'page_images_read') then
    execute $ddl$ALTER POLICY page_images_read ON storage.objects TO public USING (((bucket_id = 'page-images'::text) AND
CASE
    WHEN ((storage.foldername(name))[2] = 'emoji'::text) THEN is_member(safe_uuid((storage.foldername(name))[1]))
    ELSE can_read_page(safe_uuid((storage.foldername(name))[2]))
END))$ddl$;
  else
    execute $ddl$CREATE POLICY page_images_read ON storage.objects AS PERMISSIVE FOR SELECT TO public USING (((bucket_id = 'page-images'::text) AND
CASE
    WHEN ((storage.foldername(name))[2] = 'emoji'::text) THEN is_member(safe_uuid((storage.foldername(name))[1]))
    ELSE can_read_page(safe_uuid((storage.foldername(name))[2]))
END))$ddl$;
  end if;
end $$;

-- 8. Repo-only leftover: access_write (FOR ALL using can_read_page) was
--    replaced live by the three policies above. Neutralised, not dropped.
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'page_access' and policyname = 'access_write') then
    execute $ddl$ALTER POLICY access_write ON public.page_access USING (false) WITH CHECK (false)$ddl$;
  end if;
end $$;
