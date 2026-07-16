-- Booking push notification target RPC.
-- Run this after supabase/patch-019-web-push-rpc.sql if booking-created/cancelled notifications do not arrive.

begin;

create or replace function public.get_booking_push_targets(p_booking_ids uuid[])
returns table (
  booking_id uuid,
  team_id uuid,
  booking_date date,
  day_of_week text,
  start_time text,
  duration numeric,
  purpose text,
  status text,
  team_name text,
  team_song text,
  user_id uuid,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth_key text
)
language sql
stable
security definer
set search_path = public
as $$
  with allowed_bookings as (
    select b.*
    from public.bookings b
    where b.id = any(p_booking_ids)
      and public.is_approved(auth.uid())
      and (
        public.is_admin(auth.uid())
        or public.is_team_member(b.team_id, auth.uid())
      )
  )
  select
    b.id as booking_id,
    b.team_id,
    b.booking_date,
    b.day_of_week,
    b.start_time,
    b.duration,
    b.purpose,
    b.status,
    t.name as team_name,
    t.song as team_song,
    tm.user_id,
    ps.id as subscription_id,
    ps.endpoint,
    ps.p256dh,
    ps.auth_key
  from allowed_bookings b
  join public.teams t on t.id = b.team_id
  join public.team_members tm on tm.team_id = b.team_id
  join public.push_subscriptions ps
    on ps.user_id = tm.user_id
   and ps.disabled_at is null;
$$;

revoke all on function public.get_booking_push_targets(uuid[]) from public;
grant execute on function public.get_booking_push_targets(uuid[]) to authenticated;

commit;
