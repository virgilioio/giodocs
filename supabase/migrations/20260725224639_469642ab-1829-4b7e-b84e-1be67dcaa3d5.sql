drop function if exists public.search_pages(uuid, text, int);

create function public.search_pages(p_workspace uuid, p_q text, p_limit int default 12)
returns table (id uuid, title text, icon text, props jsonb, snippets jsonb, rank real)
language sql stable security invoker set search_path = public as $$
  select p.id, p.title, p.icon, p.props,
         coalesce((select jsonb_agg(jsonb_build_object('id', b->>'id', 'text', coalesce(b->>'text', b->>'body')))
                     from (select b from jsonb_array_elements(p.blocks) b
                            where (b->>'text') ilike '%' || p_q || '%'
                               or (b->>'body') ilike '%' || p_q || '%'
                            limit 2) s(b)), '[]'::jsonb),
         ts_rank(p.search_tsv, websearch_to_tsquery('simple', p_q))
    from public.pages p
   where p.workspace_id = p_workspace and p.deleted_at is null
     and (p.search_tsv @@ websearch_to_tsquery('simple', p_q) or p.title ilike '%'||p_q||'%')
   order by 6 desc, p.edited_at desc
   limit least(p_limit, 50);
$$;

revoke all on function public.search_pages(uuid, text, int) from public, anon;
grant execute on function public.search_pages(uuid, text, int) to authenticated;