alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.workspace_members enable row level security;
alter table public.allowed_domains enable row level security;
alter table public.property_defs enable row level security;
alter table public.pages enable row level security;
alter table public.page_access enable row level security;
alter table public.views enable row level security;
alter table public.page_verifications enable row level security;

create or replace function public.is_member(p_ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members
                  where workspace_id = p_ws and user_id = auth.uid());
$$;

create or replace function public.is_owner(p_ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members
                  where workspace_id = p_ws and user_id = auth.uid() and role = 'owner');
$$;

create or replace function public.can_read_page(p_page uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from pages p
     where p.id = p_page
       and ((p.access_type = 'workspace' and public.is_member(p.workspace_id))
         or exists (select 1 from page_access a
                     where a.page_id = p.id and a.user_id = auth.uid())));
$$;

create policy ws_read on public.workspaces for select using (public.is_member(id));
create policy ws_update on public.workspaces for update using (public.is_owner(id))
  with check (public.is_owner(id));

create policy profiles_read on public.profiles for select using (
  exists (select 1 from public.workspace_members m1
          join public.workspace_members m2 using (workspace_id)
          where m1.user_id = (select auth.uid()) and m2.user_id = profiles.id));
create policy profiles_self_write on public.profiles for update
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy members_read on public.workspace_members for select
  using (public.is_member(workspace_id));
create policy members_write on public.workspace_members for all
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));

create policy domains_read on public.allowed_domains for select
  using (public.is_member(workspace_id));
create policy domains_write on public.allowed_domains for all
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));

create policy propdefs_read on public.property_defs for select
  using (public.is_member(workspace_id));
create policy propdefs_write on public.property_defs for all
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

create policy pages_read on public.pages for select using (
  deleted_at is null and (
    (access_type = 'workspace' and public.is_member(workspace_id))
    or exists (select 1 from public.page_access a
                where a.page_id = pages.id and a.user_id = (select auth.uid()))));
create policy pages_insert on public.pages for insert
  with check (public.is_member(workspace_id) and created_by = (select auth.uid()));
create policy pages_update on public.pages for update using (
  (access_type = 'workspace' and public.is_member(workspace_id))
  or exists (select 1 from public.page_access a
              where a.page_id = pages.id and a.user_id = (select auth.uid())
                and a.capability = 'write'));

create policy access_read on public.page_access for select using (public.can_read_page(page_id));
create policy access_write on public.page_access for all
  using (public.can_read_page(page_id)) with check (public.can_read_page(page_id));

create policy views_read on public.views for select using (
  public.is_member(workspace_id) and (scope = 'team' or owner_id = (select auth.uid())));
create policy views_insert on public.views for insert with check (
  public.is_member(workspace_id) and owner_id = (select auth.uid()) and scope = 'personal');

create policy views_update on public.views for update
  using (
    (owner_id = (select auth.uid()) and scope = 'personal')
    or (scope = 'team' and public.is_owner(workspace_id))
  )
  with check (
    (owner_id = (select auth.uid()) and scope = 'personal')
    or (scope = 'team' and public.is_owner(workspace_id))
  );

create policy views_delete on public.views for delete using (
  owner_id = (select auth.uid()) or public.is_owner(workspace_id));

create policy verif_read on public.page_verifications for select
  using (public.can_read_page(page_id));
create policy verif_write on public.page_verifications for insert
  with check (public.can_read_page(page_id) and verified_by = (select auth.uid()));