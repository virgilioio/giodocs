-- Public links (Allan, 2026-11-05): Notion's Share › Publish to web.
--
-- 1. A page can be published: page_public_links holds its link, a random
--    code (`/s/<code>`), never the page id. Anyone who can edit the page
--    (or a workspace owner) publishes or unpublishes it through
--    set_page_public; unpublishing stamps revoked_at, so the link dies at
--    once, and publishing again (or Reset link) makes a new code.
-- 2. Pages inside a published page are published with it when
--    include_children is on (the default), but only pages shared with the
--    whole workspace: a private page never goes public unless it is
--    published itself. Archived, deleted and template pages never show.
-- 3. Visitors (anon) read a published page only through
--    get_published_page(code, page): its title, icon and blocks, the path
--    from the published page, its published sub-pages, the titles of the
--    published pages it mentions and the custom emoji it uses. Nothing
--    else of the workspace opens to them: no table policy changes.
-- 4. Images and files of published pages (and the workspace's custom emoji
--    while it has a published page) may be signed by anyone, for the
--    public page's short-lived links (page_images_read_published). The
--    members' rule (page_images_read) now applies to signed-in people only.
-- 5. Owners can switch public links off for the workspace
--    (workspaces.public_links, set_workspace_public_links): every link
--    stops at once, and comes back if they switch it on again.
--    list_public_pages lists the published pages (owners see all).
--
-- No foreign keys to pages: a purged page simply never matches.

alter table public.workspaces add column if not exists public_links boolean not null default true;

create table public.page_public_links (
  page_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  token text not null unique check (token ~ '^[a-f0-9]{32}$'),
  include_children boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid
);

alter table public.page_public_links enable row level security;

-- Members see the link of a page they can open (the Share menu).
create policy page_public_links_read on public.page_public_links
  for select to authenticated
  using (public.can_read_page(page_id));

revoke all on public.page_public_links from anon, authenticated;
grant select on public.page_public_links to authenticated;
grant all on public.page_public_links to service_role;

-- Is p_page shown by the link on p_root? It is the root, or (with
-- sub-pages included) under it with every page from it up to the root,
-- the root excluded, live and shared with the workspace. The root itself
-- must be live.
create or replace function public.public_path_ok(p_root uuid, p_include boolean, p_page uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive chain as (
    select p.id, p.parent_id, p.access_type::text as access,
           (p.deleted_at is null and p.archived_at is null and p.template_at is null) as live,
           0 as depth
      from public.pages p
     where p.id = p_page
    union all
    select q.id, q.parent_id, q.access_type::text,
           (q.deleted_at is null and q.archived_at is null and q.template_at is null),
           c.depth + 1
      from public.pages q
      join chain c on q.id = c.parent_id
     where c.depth < 50 and c.id <> p_root
  )
  select exists (select 1 from chain where id = p_root and live)
     and (p_page = p_root
          or (p_include and not exists (
                select 1 from chain where id <> p_root and (not live or access <> 'workspace'))));
$$;

revoke all on function public.public_path_ok(uuid, boolean, uuid) from public, anon, authenticated;

-- Is this page on the open web (through any live link of its workspace)?
create or replace function public.page_is_published(p_page uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.pages p
      join public.page_public_links l on l.workspace_id = p.workspace_id and l.revoked_at is null
      join public.workspaces w on w.id = l.workspace_id and w.public_links
     where p.id = p_page
       and public.public_path_ok(l.page_id, l.include_children, p_page)
  );
$$;

-- The storage policy below runs as the visitor, so they may ask (yes or
-- no, nothing more).
revoke all on function public.page_is_published(uuid) from public;
grant execute on function public.page_is_published(uuid) to anon, authenticated;

-- Does this workspace have a page on the open web?
create or replace function public.workspace_publishes(p_ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.page_public_links l
      join public.workspaces w on w.id = l.workspace_id and w.public_links
     where l.workspace_id = p_ws and l.revoked_at is null
  );
$$;

revoke all on function public.workspace_publishes(uuid) from public;
grant execute on function public.workspace_publishes(uuid) to anon, authenticated;

-- The members' rule is for signed-in people (it always was in effect: it
-- calls is_member and can_read_page, which visitors may not run, so a
-- visitor's read failed on it). Visitors get the published rule below.
alter policy page_images_read on storage.objects to authenticated;

-- A published page's images and files, and the workspace's custom emoji,
-- may be signed by anyone (the public page's short-lived links).
create policy page_images_read_published on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'page-images'
    and case
      when (storage.foldername(name))[2] = 'emoji'
        then public.workspace_publishes(public.safe_uuid((storage.foldername(name))[1]))
      else public.page_is_published(public.safe_uuid((storage.foldername(name))[2]))
    end
  );

-- The link of a page, as the Share menu shows it.
create or replace function public.page_public_link_json(p_page uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'token', l.token,
           'include_children', l.include_children,
           'created_by', l.created_by,
           'created_at', l.created_at)
    from public.page_public_links l
   where l.page_id = p_page and l.revoked_at is null;
$$;

revoke all on function public.page_public_link_json(uuid) from public, anon, authenticated;

-- Publish (p_on) or unpublish a page. p_reset makes a new code (the old
-- link stops). Returns the live link, or null when it's unpublished.
create or replace function public.set_page_public(
  p_page uuid, p_on boolean, p_include_children boolean default true, p_reset boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  p public.pages;
  fresh text := replace(gen_random_uuid()::text, '-', '');
begin
  if me is null then
    raise exception 'Sign in to publish a page.' using errcode = '42501';
  end if;
  select * into p from public.pages where id = p_page and deleted_at is null;
  if p.id is null or not (public.can_edit_page_row(p) or public.is_owner(p.workspace_id)) then
    raise exception 'Only people who can edit this page can publish it.' using errcode = '42501';
  end if;
  if not p_on then
    update public.page_public_links
       set revoked_at = now(), revoked_by = me
     where page_id = p_page and revoked_at is null;
    return null;
  end if;
  if not exists (select 1 from public.workspaces where id = p.workspace_id and public_links) then
    raise exception 'Public links are switched off for this workspace. A workspace owner can switch them on in Settings.'
      using errcode = '42501';
  end if;
  insert into public.page_public_links (page_id, workspace_id, token, include_children, created_by)
  values (p_page, p.workspace_id, fresh, coalesce(p_include_children, true), me)
  on conflict (page_id) do update
    set include_children = excluded.include_children,
        token = case
          when page_public_links.revoked_at is not null or p_reset then excluded.token
          else page_public_links.token
        end,
        created_by = case
          when page_public_links.revoked_at is not null then me
          else page_public_links.created_by
        end,
        created_at = case
          when page_public_links.revoked_at is not null then now()
          else page_public_links.created_at
        end,
        revoked_at = null,
        revoked_by = null;
  return public.page_public_link_json(p_page);
end $$;

revoke all on function public.set_page_public(uuid, boolean, boolean, boolean) from public, anon;
grant execute on function public.set_page_public(uuid, boolean, boolean, boolean) to authenticated;

-- Owners switch public links off (every link stops) or on (they come back).
create or replace function public.set_workspace_public_links(p_ws uuid, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner(p_ws) then
    raise exception 'Only workspace owners can change this.' using errcode = '42501';
  end if;
  update public.workspaces set public_links = p_on where id = p_ws;
  return p_on;
end $$;

revoke all on function public.set_workspace_public_links(uuid, boolean) from public, anon;
grant execute on function public.set_workspace_public_links(uuid, boolean) to authenticated;

-- The workspace's published pages (Settings): owners see all of them,
-- others the ones they can open.
create or replace function public.list_public_pages(p_ws uuid)
returns table (
  page_id uuid, title text, icon text, token text, include_children boolean,
  created_by uuid, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select l.page_id, p.title, p.icon, l.token, l.include_children, l.created_by, l.created_at
    from public.page_public_links l
    join public.pages p on p.id = l.page_id and p.deleted_at is null
   where l.workspace_id = p_ws
     and l.revoked_at is null
     and public.is_member(p_ws)
     and (public.is_owner(p_ws) or public.can_read_page(l.page_id))
   order by l.created_at desc;
$$;

revoke all on function public.list_public_pages(uuid) from public, anon;
grant execute on function public.list_public_pages(uuid) to authenticated;

-- What a visitor sees: the page at p_page (the published page itself when
-- null) if this link shows it, else null.
create or replace function public.get_published_page(p_token text, p_page uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l public.page_public_links;
  target uuid;
  pg public.pages;
  path jsonb;
  kids jsonb;
  mentioned jsonb;
  emoji jsonb;
  ws_name text;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{32}$' then
    return null;
  end if;
  select * into l from public.page_public_links where token = p_token and revoked_at is null;
  if l.page_id is null then
    return null;
  end if;
  select name into ws_name from public.workspaces where id = l.workspace_id and public_links;
  if ws_name is null then
    return null;
  end if;
  target := coalesce(p_page, l.page_id);
  if not public.public_path_ok(l.page_id, l.include_children, target) then
    return null;
  end if;
  select * into pg from public.pages where id = target;

  -- From the published page down to this one.
  with recursive up as (
    select p.id, p.parent_id, p.title, p.icon, 0 as depth from public.pages p where p.id = target
    union all
    select q.id, q.parent_id, q.title, q.icon, u.depth + 1
      from public.pages q join up u on q.id = u.parent_id
     where u.depth < 50 and u.id <> l.page_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'icon', icon) order by depth desc), '[]'::jsonb)
    into path from up;

  -- Its sub-pages this link shows.
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'icon', c.icon, 'is_database', c.is_database)
                            order by c.position nulls last, c.created_at), '[]'::jsonb)
    into kids
    from public.pages c
   where l.include_children
     and c.parent_id = target
     and c.deleted_at is null and c.archived_at is null and c.template_at is null
     and c.access_type::text = 'workspace';

  -- The pages it mentions that this link shows (others read "Private page").
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'icon', m.icon)), '[]'::jsonb)
    into mentioned
    from public.pages m
   where m.id in (
           select public.safe_uuid(x[1])
             from regexp_matches(coalesce(pg.blocks::text, ''), 'page:([0-9a-f-]{36})', 'g') as x)
     and public.public_path_ok(l.page_id, l.include_children, m.id);

  -- The workspace's custom emoji it uses.
  select coalesce(jsonb_agg(jsonb_build_object('name', e.name, 'path', e.path)), '[]'::jsonb)
    into emoji
    from public.custom_emoji e
   where e.workspace_id = l.workspace_id
     and (coalesce(pg.blocks::text, '') || ' ' || coalesce(pg.icon, '')) like '%:' || e.name || ':%';

  return jsonb_build_object(
    'workspace', ws_name,
    'root', l.page_id,
    'page', jsonb_build_object(
      'id', pg.id,
      'title', pg.title,
      'icon', pg.icon,
      'blocks', coalesce(pg.blocks, '[]'::jsonb),
      'is_database', pg.is_database,
      'edited_at', pg.edited_at),
    'path', path,
    'children', kids,
    'mentioned', mentioned,
    'emoji', emoji);
end $$;

revoke all on function public.get_published_page(text, uuid) from public;
grant execute on function public.get_published_page(text, uuid) to anon, authenticated;
