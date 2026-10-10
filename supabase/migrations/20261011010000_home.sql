-- Home (Allan, 2026-10-10): a personal start page with Recently visited,
-- My tasks, pinned views and quick links.
--
-- page_visits: one row per person per page, the last time they opened it.
-- Written only through record_page_visit (which checks the page can be
-- opened); people read only their own rows.
--
-- home_prefs: each person's Home settings — the name and emoji the
-- greeting uses, where the app opens (Home or the last page), the sections
-- they've hidden and the views they've pinned. Their own row only.
--
-- pages.task_config: a database can be a task database ("Turn into task
-- database"): which of its properties says a task is done (a status, select
-- or checkbox, plus the values that count as done), who it's assigned to (a
-- person property) and when it's due (a date property). My tasks reads
-- every task database the person can open. Checked by a trigger: the
-- properties must be the database's own, live, and of the right type.

create table if not exists public.page_visits (
  user_id uuid not null references auth.users (id) on delete cascade,
  page_id uuid not null references public.pages (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  visited_at timestamptz not null default now(),
  primary key (user_id, page_id)
);

create index if not exists page_visits_recent_idx
  on public.page_visits (user_id, workspace_id, visited_at desc);

alter table public.page_visits enable row level security;

create policy page_visits_own_read on public.page_visits
  for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.record_page_visit(p_page uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare ws uuid;
begin
  select workspace_id into ws from public.pages where id = p_page and deleted_at is null;
  if ws is null or auth.uid() is null or not public.can_read_page(p_page) then
    return;
  end if;
  insert into public.page_visits (user_id, page_id, workspace_id, visited_at)
  values (auth.uid(), p_page, ws, now())
  on conflict (user_id, page_id) do update set visited_at = excluded.visited_at;
end $function$;

revoke all on function public.record_page_visit(uuid) from public, anon;
grant execute on function public.record_page_visit(uuid) to authenticated;

create table if not exists public.home_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nickname text check (nickname is null or char_length(nickname) <= 40),
  emoji text check (emoji is null or char_length(emoji) <= 64),
  start_page text not null default 'home' check (start_page in ('home', 'last')),
  hidden text[] not null default '{}',
  pinned_views uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.home_prefs enable row level security;

create policy home_prefs_own on public.home_prefs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table public.pages
  add column if not exists task_config jsonb;

create or replace function public.guard_task_config()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  c jsonb := new.task_config;
  dd public.property_defs;
  ad public.property_defs;
  ud public.property_defs;
begin
  if c is null then return new; end if;
  if not new.is_database then
    raise exception 'Only a database can be a task database.' using errcode = '23514';
  end if;
  if jsonb_typeof(c) <> 'object'
     or exists (select 1 from jsonb_object_keys(c) k where k not in ('done', 'done_values', 'assignee', 'due'))
     or jsonb_typeof(c -> 'done') is distinct from 'string'
     or jsonb_typeof(c -> 'assignee') is distinct from 'string'
     or jsonb_typeof(c -> 'due') is distinct from 'string'
     or (c ? 'done_values' and jsonb_typeof(c -> 'done_values') <> 'array') then
    raise exception 'A task database names its done, assignee and due properties.' using errcode = '23514';
  end if;
  select * into dd from public.property_defs
   where database_id = new.id and key = c ->> 'done' and archived_at is null;
  select * into ad from public.property_defs
   where database_id = new.id and key = c ->> 'assignee' and archived_at is null;
  select * into ud from public.property_defs
   where database_id = new.id and key = c ->> 'due' and archived_at is null;
  if dd.id is null or dd.type::text not in ('status', 'select', 'checkbox') then
    raise exception 'Done must be a status, select or checkbox property of this database.' using errcode = '23514';
  end if;
  if ad.id is null or ad.type::text <> 'person' then
    raise exception 'Assignee must be a person property of this database.' using errcode = '23514';
  end if;
  if ud.id is null or ud.type::text <> 'date' then
    raise exception 'Due must be a date property of this database.' using errcode = '23514';
  end if;
  return new;
end $function$;

create trigger pages_task_config
  before insert or update of task_config on public.pages
  for each row execute function public.guard_task_config();
