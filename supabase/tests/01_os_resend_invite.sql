-- Run after 20261022162403_os_resend_invite inside a transaction that is rolled back.
-- Every row's ok is true.
create temp table t_results (check_name text, ok boolean);

do $$
declare
  r jsonb; r2 jsonb;
  req1 uuid := gen_random_uuid();
  tok1 uuid; tok2 uuid;
begin
  -- Someone with an account but no membership (Victoria): a fresh invitation.
  r := public.os_resend_invite(req1, 'victoria@virgilio.tech', 'member', 'allan@virgilio.tech');
  select token into tok1 from public.workspace_invites where email = 'victoria@virgilio.tech' and accepted_at is null;
  insert into t_results values ('no membership: invited with a token for the email',
    r->>'outcome' = 'invited' and r->>'token' is not null and tok1::text = r->>'token'
    and exists (select 1 from public.os_provision_log where request_id = req1 and outcome = 'invited'));

  -- The same request again is a repeat, not a second email.
  r2 := public.os_resend_invite(req1, 'victoria@virgilio.tech', 'member', 'allan@virgilio.tech');
  insert into t_results values ('the same request again is a repeat', (r2->>'repeat')::boolean and r2->>'token' is null);

  -- Asking again later refreshes the link.
  r2 := public.os_resend_invite(gen_random_uuid(), 'victoria@virgilio.tech', 'member', 'allan@virgilio.tech');
  select token into tok2 from public.workspace_invites where email = 'victoria@virgilio.tech' and accepted_at is null;
  insert into t_results values ('a later resend refreshes the link', r2->>'outcome' = 'invited' and tok2 <> tok1
    and (select count(*) from public.workspace_invites where email = 'victoria@virgilio.tech' and accepted_at is null) = 1);

  -- A member gets nothing.
  r := public.os_resend_invite(gen_random_uuid(), 'jurre@virgilio.tech', 'member', 'allan@virgilio.tech');
  insert into t_results values ('a member: unchanged, no invitation', r->>'outcome' = 'unchanged'
    and not exists (select 1 from public.workspace_invites where email = 'jurre@virgilio.tech' and accepted_at is null));

  -- Someone with no account at all: invited.
  r := public.os_resend_invite(gen_random_uuid(), 'new.person.test@example.com', 'member', 'allan@virgilio.tech');
  insert into t_results values ('no account: invited', r->>'outcome' = 'invited');

  -- Only a Gio Docs owner may ask, and never for themselves.
  r := public.os_resend_invite(gen_random_uuid(), 'victoria@virgilio.tech', 'member', 'jurre@virgilio.tech');
  insert into t_results values ('a non-owner is refused', r->>'outcome' = 'refused');
  r := public.os_resend_invite(gen_random_uuid(), 'allan@virgilio.tech', 'owner', 'allan@virgilio.tech');
  insert into t_results values ('nobody resends their own', r->>'outcome' = 'refused');

  -- Nobody but the service role can call it.
  insert into t_results values ('only the service role may call it',
    not has_function_privilege('authenticated', 'public.os_resend_invite(uuid, text, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.os_resend_invite(uuid, text, text, text)', 'execute'));
end $$;

select * from t_results;
