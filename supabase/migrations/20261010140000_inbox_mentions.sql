-- Inbox: a notification when someone mentions you on a page.
--
-- The page save itself files it: an AFTER UPDATE trigger on pages compares
-- the people mentioned before and after, and for each person newly
-- mentioned (not the writer, and only if they can open the page) adds a
-- row to notifications. People read their own rows and mark them read;
-- nobody writes them from the browser. Email comes later, from these rows.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  -- Who it's for, and who did it.
  user_id uuid not null,
  actor_id uuid,
  -- 'page_mention' now; comments add their own kinds.
  kind text not null check (kind ~ '^[a-z_]{1,40}$'),
  page_id uuid not null references public.pages(id),
  -- The block the mention sits in, to scroll to it.
  block_id text,
  -- That block's text when it happened, as plain words.
  excerpt text not null default '' check (char_length(excerpt) <= 300),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index notifications_user_created on public.notifications (user_id, created_at desc);
create index notifications_user_unread on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

create policy notifications_read_own on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy notifications_mark_read on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.notifications to service_role;

-- New rows reach the inbox live (realtime applies the same RLS).
alter publication supabase_realtime add table public.notifications;

-- Can this person open this page? The pages_read rule, for someone other
-- than the caller. Only the trigger below uses it.
create or replace function public.user_can_read_page(p_page uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.pages p
     where p.id = p_page
       and p.deleted_at is null
       and ((p.access_type = 'workspace'
             and exists (select 1 from public.workspace_members m
                          where m.workspace_id = p.workspace_id and m.user_id = p_user))
         or exists (select 1 from public.page_access a
                     where a.page_id = p.id and a.user_id = p_user)));
$$;

revoke all on function public.user_can_read_page(uuid, uuid) from public, anon, authenticated;
grant execute on function public.user_can_read_page(uuid, uuid) to service_role;

-- Every person mention in a page's blocks (nested ones too), with its block.
create or replace function public.block_mentions(p_blocks jsonb)
returns table (block_id text, user_id uuid, body text)
language sql
immutable
as $$
  with recursive tree(b) as (
    select b from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) b
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
  select t.b->>'id', (m.arr[1])::uuid, coalesce(t.b->>'text', '')
    from tree t,
         lateral regexp_matches(
           coalesce(t.b->>'text', ''),
           '@\[[^]]*\]\(user:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)',
           'g') as m(arr);
$$;

revoke all on function public.block_mentions(jsonb) from public, anon;
grant execute on function public.block_mentions(jsonb) to authenticated;
grant execute on function public.block_mentions(jsonb) to service_role;

-- A block's text as plain words: mentions as names, links as their label,
-- no formatting marks, one line, at most 200 characters.
create or replace function public.mention_excerpt(p_text text)
returns text
language sql
immutable
as $$
  select left(btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(coalesce(p_text, ''),
              '@\[([^]]*)\]\(user:[0-9a-f-]{36}\)', '@\1', 'g'),
            '@\[[^]]*\]\(page:[0-9a-f-]{36}\)', 'a page', 'g'),
          '\[([^]]*)\]\([^)]*\)', '\1', 'g'),
        '[*~=`]|</?u>', '', 'g'),
      '\s+', ' ', 'g')), 200);
$$;

revoke all on function public.mention_excerpt(text) from public, anon;
grant execute on function public.mention_excerpt(text) to authenticated;
grant execute on function public.mention_excerpt(text) to service_role;

create or replace function public.notify_page_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  r record;
begin
  if actor is null then
    return new;
  end if;
  -- A notification must never cost anyone their edit: if anything here
  -- fails, the save still goes through and the failure is logged.
  begin
  -- People mentioned now who weren't mentioned anywhere on the page before.
  for r in
    select distinct on (n.user_id) n.user_id, n.block_id, n.body
      from public.block_mentions(new.blocks) n
     where n.user_id <> actor
       and not exists (select 1 from public.block_mentions(old.blocks) o
                        where o.user_id = n.user_id)
     order by n.user_id
  loop
    -- Only people who can open the page hear about it.
    continue when not public.user_can_read_page(new.id, r.user_id);
    -- Mentioned, removed and mentioned again while still unread: one row.
    continue when exists (
      select 1 from public.notifications x
       where x.user_id = r.user_id and x.page_id = new.id
         and x.kind = 'page_mention' and x.read_at is null
         and x.created_at > now() - interval '10 minutes');
    insert into public.notifications
      (workspace_id, user_id, actor_id, kind, page_id, block_id, excerpt)
    values
      (new.workspace_id, r.user_id, actor, 'page_mention', new.id, r.block_id,
       public.mention_excerpt(r.body));
  end loop;
  exception when others then
    raise warning 'notify_page_mentions skipped for page %: %', new.id, sqlerrm;
  end;
  return new;
end $$;

revoke all on function public.notify_page_mentions() from public, anon;
grant execute on function public.notify_page_mentions() to authenticated;
grant execute on function public.notify_page_mentions() to service_role;

create trigger pages_notify_mentions
  after update of blocks on public.pages
  for each row
  when (old.blocks is distinct from new.blocks)
  execute function public.notify_page_mentions();
