-- Page history: restoring a version keeps what it replaces.
--
-- restore_page_version (2026-08) overwrote the page in place, which had
-- three problems:
--   * Edits from the last two minutes are never in page_versions (the
--     snapshot trigger saves at most one version per editor every two
--     minutes), so a restore could silently throw them away.
--   * It put back old property values too, which may no longer be valid
--     and which people don't expect a content restore to change.
--   * Someone who can read but not edit the page got no error: the update
--     just matched no rows.
--
-- restore_page_from_version replaces it:
--   * Only someone who can edit the page restores it (the pages_update rule,
--     and a workspace page shared as view-only stays read-only).
--   * The page's current content is saved as a version first, and its id is
--     returned, so a restore can itself be undone.
--   * It restores the title, icon and blocks. Properties keep their current
--     values.
--
-- page_versions also gains edited_at: when the saved content was last
-- edited. The history list shows that time. Older versions don't have it
-- and show created_at instead.

alter table public.page_versions add column if not exists edited_at timestamptz;

-- Fill edited_at on every new version. The snapshot trigger runs BEFORE
-- UPDATE on pages, so at this point pages still holds the content being
-- saved and its edited_at is the right one.
create or replace function public.page_versions_fill_edited_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.edited_at is null then
    select p.edited_at into new.edited_at
      from public.pages p
     where p.id = new.page_id;
  end if;
  return new;
end $$;

revoke all on function public.page_versions_fill_edited_at() from public, anon;
grant execute on function public.page_versions_fill_edited_at() to authenticated;
grant execute on function public.page_versions_fill_edited_at() to service_role;

create trigger page_versions_edited_at
  before insert on public.page_versions
  for each row execute function public.page_versions_fill_edited_at();

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

  select * into cur
    from public.pages p
   where p.id = v.page_id
     and p.deleted_at is null
     and ((p.access_type = 'workspace'
           and p.ws_role = 'edit'
           and public.is_member(p.workspace_id))
       or exists (select 1 from public.page_access a
                   where a.page_id = p.id
                     and a.user_id = auth.uid()
                     and a.capability = 'write'))
   for update;
  if cur.id is null then
    raise exception 'You can''t edit this page.' using errcode = '42501';
  end if;

  -- Already looks like this version: nothing to do.
  if (cur.title, cur.icon, cur.blocks) is not distinct from (v.title, v.icon, v.blocks) then
    return null;
  end if;

  -- Keep what's there now. A version from the same editor in the last two
  -- minutes also stops the snapshot trigger from saving it a second time
  -- on the update below.
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

revoke all on function public.restore_page_from_version(uuid) from public, anon;
grant execute on function public.restore_page_from_version(uuid) to authenticated;
grant execute on function public.restore_page_from_version(uuid) to service_role;

-- The old function stays defined (removing it needs a desktop session) but
-- nobody can call it. No released app version calls it.
revoke execute on function public.restore_page_version(uuid) from public, anon, authenticated;
