-- Resend an invitation from Gio OS (People & Access, Allan 2026-10-22).
--
-- os_apply_grant leaves a live invitation with the same role alone, so asking
-- again sent nothing. os_resend_invite is the "send it again" request:
--   * already a member: nothing to send (outcome 'unchanged');
--   * otherwise: the invitation is created or refreshed (new token, 7 more
--     days) through create_workspace_invite, outcome 'invited', and the
--     os-provision edge function emails the new link.
-- Same rules as os_apply_grant: the admin who clicked must be a Gio Docs
-- owner, nobody resends their own, each request_id applies once.

create or replace function public.os_resend_invite(
  p_request_id uuid, p_email text, p_role text, p_actor_email text
) returns jsonb
language plpgsql security definer set search_path = 'public' as $$
declare
  v_ws        uuid;
  v_email     text := lower(trim(p_email));
  v_actor_em  text := lower(trim(p_actor_email));
  v_role      public.member_role;
  v_actor     uuid;
  v_user      uuid;
  v_outcome   text;
  v_detail    text;
  v_invite_id uuid;
  v_token     uuid;
  v_prev      public.os_provision_log%rowtype;
begin
  if p_request_id is null then raise exception 'request_id is required.' using errcode = 'GOS10'; end if;

  select * into v_prev from public.os_provision_log where request_id = p_request_id;
  if found then
    return jsonb_build_object('outcome', v_prev.outcome, 'detail', v_prev.detail,
      'invite_id', v_prev.invite_id, 'repeat', true);
  end if;

  select id into v_ws from public.workspaces order by created_at limit 1;
  if v_ws is null then raise exception 'No workspace.' using errcode = 'GOS10'; end if;
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'A valid email is required.' using errcode = 'GOS10';
  end if;
  if p_role is null or p_role not in ('member', 'owner') then
    raise exception 'Unknown Gio Docs role: %', coalesce(p_role, 'none') using errcode = 'GOS10';
  end if;
  v_role := p_role::public.member_role;

  perform set_config('gio.os_provision', 'on', true);

  select p.id into v_actor
  from public.profiles p
  join public.workspace_members m on m.user_id = p.id and m.workspace_id = v_ws and m.role = 'owner'
  where lower(p.email) = v_actor_em;

  if v_actor is null then
    v_outcome := 'refused';
    v_detail := 'The person who made this change isn''t an owner in Gio Docs.';
  elsif v_actor_em = v_email then
    v_outcome := 'refused';
    v_detail := 'Nobody changes their own Gio Docs access. Ask another owner.';
  else
    select id into v_user from public.profiles where lower(email) = v_email;
    if v_user is not null and exists (select 1 from public.workspace_members
                                      where workspace_id = v_ws and user_id = v_user) then
      v_outcome := 'unchanged';
      v_detail := 'Already in Gio Docs, so there is no invitation to send.';
    else
      select i.id, i.token into v_invite_id, v_token
      from public.create_workspace_invite(v_ws, v_email, v_role, v_actor) i;
      v_outcome := 'invited';
      v_detail := 'The invitation was sent again.';
    end if;
  end if;

  perform set_config('gio.os_provision', 'off', true);

  insert into public.os_provision_log
    (workspace_id, request_id, email, role, actor_email, outcome, detail, invite_id)
  values
    (v_ws, p_request_id, v_email, v_role, v_actor_em, v_outcome, v_detail, v_invite_id);

  return jsonb_build_object('outcome', v_outcome, 'detail', v_detail, 'invite_id', v_invite_id,
    'token', v_token, 'repeat', false);
end $$;

revoke execute on function public.os_resend_invite(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.os_resend_invite(uuid, text, text, text) to service_role;
