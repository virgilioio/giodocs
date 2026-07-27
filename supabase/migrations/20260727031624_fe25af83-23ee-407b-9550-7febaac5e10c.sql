create or replace function public.list_areas(p_workspace uuid)
returns table (area text, page_count bigint)
language sql stable security invoker set search_path = public as $$
  select props->>'area', count(*) from public.pages
   where workspace_id = p_workspace
     and deleted_at is null
     and archived_at is null
     and props ? 'area'
   group by 1 order by 1;
$$;