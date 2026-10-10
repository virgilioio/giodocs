create or replace function guard_page_parent()
returns trigger
language plpgsql
as $$
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
$$;

drop trigger if exists trg_guard_page_parent on pages;
create trigger trg_guard_page_parent
  before insert or update of parent_id, workspace_id on pages
  for each row execute function guard_page_parent();
