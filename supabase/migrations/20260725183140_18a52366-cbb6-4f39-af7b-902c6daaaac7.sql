create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 65),
  icon text not null default '🧭',
  slug text not null unique,
  stale_days int not null default 90 check (stale_days between 7 and 730),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null,
  avatar_tint text not null default '#DCEAFE',
  avatar_ink text not null default '#2563EB',
  created_at timestamptz not null default now()
);

create type public.member_role as enum ('owner','member');

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.allowed_domains (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  domain text not null check (domain = lower(domain)),
  primary key (workspace_id, domain)
);

create type public.property_type as enum
  ('text','select','multi_select','person','date','number','checkbox','status');

create table public.property_defs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,30}$'),
  label text not null,
  type public.property_type not null,
  options jsonb not null default '[]'::jsonb,
  position int not null default 0,
  is_system boolean not null default false,
  unique (workspace_id, key)
);

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null default '',
  icon text not null default '📄',
  props jsonb not null default '{}'::jsonb,
  blocks jsonb not null default '[]'::jsonb,
  access_type text not null default 'workspace'
    check (access_type in ('workspace','restricted')),
  verified_at timestamptz not null default now(),
  verified_by uuid references public.profiles(id) on delete set null,
  edited_at timestamptz not null default now(),
  edited_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  search_tsv tsvector
);

create table public.page_access (
  page_id uuid not null references public.pages(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  guest_email text,
  capability text not null default 'read' check (capability in ('read','write')),
  created_at timestamptz not null default now(),
  check (user_id is not null or guest_email is not null)
);
create unique index page_access_user_uq on public.page_access(page_id, user_id)
  where user_id is not null;
create unique index page_access_guest_uq on public.page_access(page_id, guest_email)
  where guest_email is not null;

create type public.view_scope as enum ('personal','team');
create type public.view_layout as enum ('table','board','list');

create table public.views (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  scope public.view_scope not null default 'personal',
  layout public.view_layout not null default 'table',
  group_by text,
  filter jsonb not null default '[]'::jsonb,
  sort jsonb not null default '{"prop":"edited","dir":"desc"}'::jsonb,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table public.page_verifications (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages(id) on delete cascade,
  verified_by uuid not null references public.profiles(id) on delete cascade,
  verified_at timestamptz not null default now()
);