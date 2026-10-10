-- View-only means view-only.
--
-- A workspace page shared with "Everyone at the workspace can view"
-- (ws_role 'view') could still be edited by any member: pages_update and
-- the page functions only asked whether you're a member. From here, a page
-- can be changed only by someone who can edit it:
--   * on a workspace page: a member when it's shared to edit, or a
--     workspace owner (owners manage sharing, so they keep edit rights);
--   * anyone with edit access on the page itself (page_access 'write').
--
-- One guard on the table holds the rule for every path: the editor's
-- saves, properties, archiving, templates, moving to and back from the
-- trash, and the functions that run with elevated rights. It also closes
-- an older gap: any member could bring back any page from the trash, even
-- one shared only with others.
--
-- Not guarded: verifying ("still accurate" stays open to readers, as
-- before), sharing changes (set_page_access has its own check), and taking
-- a page out of its container (parent_id to null), which removing the
-- container does for its children.

create or replace function public.can_edit_page_row(p public.pages)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (p.access_type = 'workspace'
       and public.is_member(p.workspace_id)
       and (p.ws_role = 'edit' or public.is_owner(p.workspace_id)))
    or exists (select 1 from public.page_access a
                where a.page_id = p.id
                  and a.user_id = auth.uid()
                  and a.capability = 'write');
$$;

revoke all on function public.can_edit_page_row(public.pages) from public, anon, authenticated;
grant execute on function public.can_edit_page_row(public.pages) to service_role;

create or replace function public.guard_page_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- System work (no signed-in person) isn't a person editing.
  if auth.uid() is null then
    return new;
  end if;
  -- Only content and state changes need edit rights.
  if (old.title, old.blocks, old.props, old.icon,
      old.deleted_at, old.archived_at, old.template_at)
     is not distinct from
     (new.title, new.blocks, new.props, new.icon,
      new.deleted_at, new.archived_at, new.template_at)
     and (new.parent_id is not distinct from old.parent_id or new.parent_id is null) then
    return new;
  end if;
  if not public.can_edit_page_row(old) then
    raise exception 'You can view this page but not edit it.' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.guard_page_edit() from public, anon;
grant execute on function public.guard_page_edit() to authenticated;
grant execute on function public.guard_page_edit() to service_role;

create trigger pages_guard_edit
  before update on public.pages
  for each row
  execute function public.guard_page_edit();

-- Page history follows the same rule (owners could not restore a
-- view-only page before; now they can, like any other edit).
create or replace function public.restore_page_from_version(p_version uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.page_versions;
  cur public.pages;
  saved uuid;
begin
  select * into v from public.page_versions where id = p_version;
  if v.id is null then
    raise exception 'That version no longer exists.' using errcode = 'P0002';
  end if;

  select * into cur from public.pages p
   where p.id = v.page_id and p.deleted_at is null
   for update;
  if cur.id is null or not public.can_edit_page_row(cur) then
    raise exception 'You can''t edit this page.' using errcode = '42501';
  end if;

  if (cur.title, cur.icon, cur.blocks) is not distinct from (v.title, v.icon, v.blocks) then
    return null;
  end if;

  insert into public.page_versions
    (page_id, workspace_id, title, blocks, props, icon, edited_by, edited_at)
  values
    (cur.id, cur.workspace_id, cur.title, cur.blocks, cur.props, cur.icon,
     cur.edited_by, cur.edited_at)
  returning id into saved;

  update public.pages
     set title = v.title, icon = v.icon, blocks = v.blocks
   where id = cur.id;

  return saved;
end $$;
