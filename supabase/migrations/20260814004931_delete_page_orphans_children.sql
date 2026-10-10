create or replace function public.delete_page(p_page uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  did_delete boolean := false;
begin
  -- Permission logic unchanged from the original SQL body.
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

  get diagnostics did_delete = ROW_COUNT;

  -- Orphan, never cascade. Soft delete means the FK's ON DELETE SET NULL
  -- never fires, so children would otherwise keep pointing at an invisible
  -- parent. A page is never deleted as a side effect of tidying up its
  -- container; it simply becomes unplaced.
  if did_delete then
    update public.pages c
       set parent_id = null
     where c.parent_id = p_page
       and c.deleted_at is null;
  end if;
end;
$function$;
