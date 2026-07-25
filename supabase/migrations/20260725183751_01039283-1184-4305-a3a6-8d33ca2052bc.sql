create or replace function public.verify_page(p_page uuid)
returns public.pages language plpgsql security invoker set search_path = public as $$
declare r public.pages;
begin
  insert into public.page_verifications(page_id, verified_by) values (p_page, auth.uid());
  update public.pages set verified_at = now(), verified_by = auth.uid()
   where id = p_page returning * into r;
  return r;
end $$;

create or replace function public.set_page_property(p_page uuid, p_key text, p_value jsonb)
returns public.pages language plpgsql security invoker set search_path = public as $$
declare r public.pages;
begin
  update public.pages
     set props = case when p_value is null then props - p_key
                      else props || jsonb_build_object(p_key, p_value) end
   where id = p_page returning * into r;
  return r;
end $$;

create or replace function public.publish_view(p_view uuid)
returns public.views language plpgsql security invoker set search_path = public as $$
declare r public.views;
begin
  update public.views v set scope = 'team'
   where v.id = p_view and v.owner_id = auth.uid() and public.is_owner(v.workspace_id)
  returning * into r;
  if r.id is null then
    raise exception 'Only workspace owners can publish a view to the team.'
      using errcode = '42501';
  end if;
  return r;
end $$;

create or replace function public.fork_view(
  p_view uuid, p_name text, p_filter jsonb, p_sort jsonb, p_layout public.view_layout)
returns public.views language sql security invoker set search_path = public as $$
  insert into public.views (workspace_id, owner_id, name, scope, layout, filter, sort)
  select workspace_id, auth.uid(), p_name, 'personal', p_layout, p_filter, p_sort
    from public.views where id = p_view returning *;
$$;

create or replace function public.delete_page(p_page uuid)
returns void language sql security invoker set search_path = public as $$
  update public.pages set deleted_at = now() where id = p_page and deleted_at is null;
$$;

create or replace function public.restore_page(p_page uuid)
returns void language sql security definer set search_path = public as $$
  update public.pages p set deleted_at = null
   where p.id = p_page and public.is_member(p.workspace_id);
$$;

create or replace function public.search_pages(p_workspace uuid, p_q text, p_limit int default 12)
returns table (id uuid, title text, icon text, props jsonb, blocks jsonb, rank real)
language sql stable security invoker set search_path = public as $$
  select p.id, p.title, p.icon, p.props, p.blocks,
         ts_rank(p.search_tsv, websearch_to_tsquery('english', p_q)) as rank
    from public.pages p
   where p.workspace_id = p_workspace and p.deleted_at is null
     and (p.search_tsv @@ websearch_to_tsquery('english', p_q)
       or p.title ilike '%' || p_q || '%')
   order by rank desc, p.edited_at desc
   limit least(p_limit, 50);
$$;

create or replace function public.list_areas(p_workspace uuid)
returns table (area text, page_count bigint)
language sql stable security invoker set search_path = public as $$
  select props->>'area', count(*) from public.pages
   where workspace_id = p_workspace and deleted_at is null and props ? 'area'
   group by 1 order by 1;
$$;

revoke execute on function public.verify_page(uuid) from public, anon;
grant execute on function public.verify_page(uuid) to authenticated;

revoke execute on function public.set_page_property(uuid, text, jsonb) from public, anon;
grant execute on function public.set_page_property(uuid, text, jsonb) to authenticated;

revoke execute on function public.publish_view(uuid) from public, anon;
grant execute on function public.publish_view(uuid) to authenticated;

revoke execute on function public.fork_view(uuid, text, jsonb, jsonb, public.view_layout) from public, anon;
grant execute on function public.fork_view(uuid, text, jsonb, jsonb, public.view_layout) to authenticated;

revoke execute on function public.delete_page(uuid) from public, anon;
grant execute on function public.delete_page(uuid) to authenticated;

revoke execute on function public.restore_page(uuid) from public, anon;
grant execute on function public.restore_page(uuid) to authenticated;

revoke execute on function public.search_pages(uuid, text, int) from public, anon;
grant execute on function public.search_pages(uuid, text, int) to authenticated;

revoke execute on function public.list_areas(uuid) from public, anon;
grant execute on function public.list_areas(uuid) to authenticated;

revoke execute on function public.is_member(uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;

revoke execute on function public.is_owner(uuid) from public, anon;
grant execute on function public.is_owner(uuid) to authenticated;

revoke execute on function public.can_read_page(uuid) from public, anon;
grant execute on function public.can_read_page(uuid) to authenticated;