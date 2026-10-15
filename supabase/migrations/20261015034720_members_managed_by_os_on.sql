-- Members are managed in Gio OS from now on (Allan, 2026-10-14). Invitations,
-- role changes and removals come from People & Access through os-provision,
-- and joining by @virgilio.tech domain alone stops. Turn off by setting it
-- back to false.
update public.workspaces set members_managed_by_os = true;
