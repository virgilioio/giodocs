-- Comments: threads on a page, or on a block and the words selected in it.
--
-- Anyone who can open a page can read and add comments on it (a view-only
-- reader can still comment). Writing goes through functions only, which
-- check the rules here, never the browser:
--   add_comment       a new thread, or a reply (a reply reopens a resolved thread)
--   edit_comment      your own comment
--   set_comment_removed  remove your own comment, or bring it back (Undo);
--                     removing the first comment of a thread hides the thread
--   resolve_comment_thread  anyone who can open the page
-- Removal is soft (removed_at), like pages.
--
-- Notifications: people mentioned in a comment, and the people already in a
-- thread when someone replies (never the writer, only people who can open
-- the page). A notification problem never stops the comment being saved.

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  page_id uuid not null references public.pages(id),
  -- null for the first comment of a thread; replies point at it.
  thread_id uuid references public.comments(id),
  -- What the thread is about: a block, and the words selected in it.
  block_id text,
  quote text check (quote is null or char_length(quote) <= 500),
  author_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  removed_at timestamptz
);

create index comments_page on public.comments (page_id, created_at);
create index comments_thread on public.comments (thread_id) where thread_id is not null;

alter table public.comments enable row level security;

-- Is the first comment of this thread still there? (A policy can't query
-- its own table, so this reads it as the owner.)
create or replace function public.comment_thread_open(p_thread uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.comments r
                  where r.id = p_thread and r.removed_at is null);
$$;

revoke all on function public.comment_thread_open(uuid) from public, anon;
grant execute on function public.comment_thread_open(uuid) to authenticated;
grant execute on function public.comment_thread_open(uuid) to service_role;

-- Read: the page is readable, the comment isn't removed, and neither is
-- the first comment of its thread.
create policy comments_read on public.comments
  for select to authenticated
  using (
    removed_at is null
    and public.can_read_page(page_id)
    and (thread_id is null or public.comment_thread_open(thread_id))
  );

revoke all on public.comments from anon, authenticated;
grant select on public.comments to authenticated;
grant all on public.comments to service_role;

alter publication supabase_realtime add table public.comments;

-- Notifications can point at a comment.
alter table public.notifications add column comment_id uuid references public.comments(id);

-- Person mentions in a comment body.
create or replace function public.text_mentions(p_text text)
returns setof uuid
language sql
immutable
as $$
  select distinct (m.arr[1])::uuid
    from regexp_matches(
           coalesce(p_text, ''),
           '@\[[^]]*\]\(user:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)',
           'g') as m(arr);
$$;

revoke all on function public.text_mentions(text) from public, anon;
grant execute on function public.text_mentions(text) to authenticated;
grant execute on function public.text_mentions(text) to service_role;

create or replace function public.add_comment(
  p_page uuid,
  p_body text,
  p_thread uuid default null,
  p_block text default null,
  p_quote text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  pg public.pages;
  root public.comments;
  new_id uuid;
  who uuid;
  told uuid[] := array[]::uuid[];
  excerpt text;
begin
  if me is null then
    raise exception 'Sign in to comment.' using errcode = '42501';
  end if;
  select * into pg from public.pages where id = p_page and deleted_at is null;
  if pg.id is null or not public.can_read_page(p_page) then
    raise exception 'You can''t open this page.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 5000 then
    raise exception 'A comment needs some text (at most 5,000 characters).' using errcode = '22023';
  end if;

  if p_thread is not null then
    select * into root from public.comments
     where id = p_thread and page_id = p_page and thread_id is null and removed_at is null;
    if root.id is null then
      raise exception 'That thread is gone.' using errcode = 'P0002';
    end if;
    -- Replying to a resolved thread reopens it.
    if root.resolved_at is not null then
      update public.comments set resolved_at = null, resolved_by = null where id = root.id;
    end if;
  end if;

  insert into public.comments (workspace_id, page_id, thread_id, block_id, quote, author_id, body)
  values (pg.workspace_id, p_page, p_thread,
          case when p_thread is null then nullif(btrim(p_block), '') end,
          case when p_thread is null then left(nullif(btrim(p_quote), ''), 500) end,
          me, btrim(p_body))
  returning id into new_id;

  begin
    excerpt := public.mention_excerpt(p_body);
    -- People mentioned.
    for who in select * from public.text_mentions(p_body) loop
      continue when who = me or not public.user_can_read_page(p_page, who);
      insert into public.notifications
        (workspace_id, user_id, actor_id, kind, page_id, block_id, comment_id, excerpt)
      values (pg.workspace_id, who, me, 'comment_mention', p_page,
              coalesce(root.block_id, nullif(btrim(p_block), '')), new_id, excerpt);
      told := told || who;
    end loop;
    -- Everyone already in the thread, on a reply.
    if p_thread is not null then
      for who in
        select distinct c.author_id from public.comments c
         where (c.id = p_thread or c.thread_id = p_thread) and c.removed_at is null
      loop
        continue when who = me or who = any(told) or not public.user_can_read_page(p_page, who);
        insert into public.notifications
          (workspace_id, user_id, actor_id, kind, page_id, block_id, comment_id, excerpt)
        values (pg.workspace_id, who, me, 'comment_reply', p_page, root.block_id, new_id, excerpt);
      end loop;
    end if;
  exception when others then
    raise warning 'add_comment notifications skipped for %: %', new_id, sqlerrm;
  end;

  return new_id;
end $$;

revoke all on function public.add_comment(uuid, text, uuid, text, text) from public, anon;
grant execute on function public.add_comment(uuid, text, uuid, text, text) to authenticated;
grant execute on function public.add_comment(uuid, text, uuid, text, text) to service_role;

create or replace function public.edit_comment(p_comment uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 5000 then
    raise exception 'A comment needs some text (at most 5,000 characters).' using errcode = '22023';
  end if;
  update public.comments
     set body = btrim(p_body), edited_at = now()
   where id = p_comment and author_id = auth.uid() and removed_at is null
     and public.can_read_page(page_id);
  if not found then
    raise exception 'You can only edit your own comments.' using errcode = '42501';
  end if;
end $$;

revoke all on function public.edit_comment(uuid, text) from public, anon;
grant execute on function public.edit_comment(uuid, text) to authenticated;
grant execute on function public.edit_comment(uuid, text) to service_role;

create or replace function public.set_comment_removed(p_comment uuid, p_removed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.comments
     set removed_at = case when p_removed then now() end
   where id = p_comment and author_id = auth.uid()
     and public.can_read_page(page_id);
  if not found then
    raise exception 'You can only remove your own comments.' using errcode = '42501';
  end if;
end $$;

revoke all on function public.set_comment_removed(uuid, boolean) from public, anon;
grant execute on function public.set_comment_removed(uuid, boolean) to authenticated;
grant execute on function public.set_comment_removed(uuid, boolean) to service_role;

create or replace function public.resolve_comment_thread(p_thread uuid, p_resolved boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.comments
     set resolved_at = case when p_resolved then now() end,
         resolved_by = case when p_resolved then auth.uid() end
   where id = p_thread and thread_id is null and removed_at is null
     and public.can_read_page(page_id);
  if not found then
    raise exception 'That thread is gone.' using errcode = 'P0002';
  end if;
end $$;

revoke all on function public.resolve_comment_thread(uuid, boolean) from public, anon;
grant execute on function public.resolve_comment_thread(uuid, boolean) to authenticated;
grant execute on function public.resolve_comment_thread(uuid, boolean) to service_role;
