-- Allow the Cloudflare scheduled Worker to read notification targets and
-- record delivery results. The service_role still bypasses RLS, but it also
-- needs PostgreSQL table privileges when the project has restrictive grants.

begin;

grant usage on schema public to service_role;

grant select on table public.bookings to service_role;
grant select on table public.teams to service_role;
grant select on table public.team_members to service_role;
grant select, update on table public.push_subscriptions to service_role;
grant select, insert on table public.push_notification_logs to service_role;

commit;
