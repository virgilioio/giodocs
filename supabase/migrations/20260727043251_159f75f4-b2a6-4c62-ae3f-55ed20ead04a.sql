create or replace function public.delete_page(p_page uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.pages p
     set deleted_at = now()
   where p.id = p_page
     and p.deleted_at is null
     and (
       (p.access_type = 'workspace' and public.is_member(p.workspace_id))
       or exists (
         select 1 from public.page_access a
          where a.page_id = p.id
            and a.user_id = auth.uid()
            and a.capability = 'write'
       )
     );
$$;

revoke all on function public.delete_page(uuid) from public;
grant execute on function public.delete_page(uuid) to authenticated;