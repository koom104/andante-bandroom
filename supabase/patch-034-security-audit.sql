-- Restrict private schedule data and push delivery credentials.
-- Run once in Supabase Dashboard > SQL Editor before deploying this release.

begin;

create or replace function public.can_view_member_schedule(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_user_id = auth.uid()
    or public.is_admin(auth.uid())
    or exists (
      select 1
      from public.team_members requester_membership
      join public.team_members target_membership
        on target_membership.team_id = requester_membership.team_id
      where requester_membership.user_id = auth.uid()
        and target_membership.user_id = p_user_id
    );
$$;

drop policy if exists "schedules_select" on public.member_schedules;
create policy "schedules_select"
on public.member_schedules
for select
to authenticated
using (public.is_approved(auth.uid()) and public.can_view_member_schedule(user_id));

drop policy if exists "date_schedules_select" on public.member_schedule_date_slots;
create policy "date_schedules_select"
on public.member_schedule_date_slots
for select
to authenticated
using (public.is_approved(auth.uid()) and public.can_view_member_schedule(user_id));

revoke all on function public.check_signup_duplicate(text, text) from public, anon, authenticated;

drop function if exists public.claim_booking_push_targets(uuid[], text);

create or replace function public.claim_booking_push_targets(
  p_requester_id uuid,
  p_booking_ids uuid[],
  p_kind text
)
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
volatile
security definer
set search_path = public
as $$
  with allowed_bookings as (
    select b.*
    from public.bookings b
    where cardinality(p_booking_ids) between 1 and 20
      and b.id = any(p_booking_ids)
      and public.is_approved(p_requester_id)
      and (
        public.is_admin(p_requester_id)
        or public.is_team_leader(b.team_id, p_requester_id)
      )
      and (
        (p_kind = 'booking_created' and b.status = 'confirmed')
        or (p_kind = 'booking_cancelled' and b.status = 'cancelled')
      )
  ),
  candidate_targets as (
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
     and ps.disabled_at is null
  ),
  claimed as (
    insert into public.push_notification_logs (
      user_id,
      booking_id,
      kind,
      notification_date
    )
    select distinct
      candidate_targets.user_id,
      candidate_targets.booking_id,
      p_kind,
      candidate_targets.booking_date
    from candidate_targets
    on conflict do nothing
    returning user_id, booking_id
  )
  select
    candidate_targets.booking_id,
    candidate_targets.team_id,
    candidate_targets.booking_date,
    candidate_targets.day_of_week,
    candidate_targets.start_time,
    candidate_targets.duration,
    candidate_targets.purpose,
    candidate_targets.status,
    candidate_targets.team_name,
    candidate_targets.team_song,
    candidate_targets.user_id,
    candidate_targets.subscription_id,
    candidate_targets.endpoint,
    candidate_targets.p256dh,
    candidate_targets.auth_key
  from candidate_targets
  join claimed
    on claimed.user_id = candidate_targets.user_id
   and claimed.booking_id = candidate_targets.booking_id;
$$;

revoke all on function public.can_view_member_schedule(uuid) from public;
grant execute on function public.can_view_member_schedule(uuid) to authenticated;

revoke all on function public.claim_booking_push_targets(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.claim_booking_push_targets(uuid, uuid[], text) to service_role;

commit;
