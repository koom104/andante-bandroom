-- Reduce initial read latency as teams, schedules, and rehearsal history grow.
-- Run once in Supabase Dashboard > SQL Editor.

begin;

create index if not exists team_members_user_id_team_id_idx
  on public.team_members (user_id, team_id);

create index if not exists bookings_confirmed_date_start_idx
  on public.bookings (booking_date, start_time)
  where status = 'confirmed';

create index if not exists bookings_team_rehearsal_date_idx
  on public.bookings (team_id, booking_date)
  where status = 'confirmed' and booking_type = 'rehearsal';

create index if not exists booking_attendance_slots_user_booking_idx
  on public.booking_attendance_slots (user_id, booking_id);

create or replace function public.get_rehearsal_leaderboard()
returns table (
  user_id uuid,
  name text,
  cohort text,
  total_duration numeric,
  rank bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with tracking_window as (
    select coalesce(
      (select count_from_date from public.rehearsal_tracking_settings where id = 1),
      date '1970-01-01'
    ) as count_from_date
  ),
  slot_totals as (
    select
      bas.user_id,
      (count(*) * 0.5)::numeric as total_duration
    from public.booking_attendance_slots bas
    join public.bookings b on b.id = bas.booking_id
    cross join tracking_window tw
    where b.status = 'confirmed'
      and b.booking_type = 'rehearsal'
      and b.booking_date < current_date
      and b.booking_date >= tw.count_from_date
    group by bas.user_id
  ),
  member_totals as (
    select
      p.id as user_id,
      p.name,
      p.cohort,
      coalesce(slot_totals.total_duration, 0)::numeric as total_duration
    from public.profiles p
    left join slot_totals on slot_totals.user_id = p.id
    where p.role <> 'admin'
      and p.status = 'approved'
      and public.is_approved(auth.uid())
  )
  select
    member_totals.user_id,
    member_totals.name,
    member_totals.cohort,
    member_totals.total_duration,
    dense_rank() over (order by member_totals.total_duration desc) as rank
  from member_totals
  order by rank asc, member_totals.cohort asc, member_totals.name asc;
$$;

drop function if exists public.get_team_rehearsal_totals();

create function public.get_team_rehearsal_totals()
returns table (
  team_id uuid,
  total_duration numeric,
  total_session_duration numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with tracking_window as (
    select coalesce(
      (select count_from_date from public.rehearsal_tracking_settings where id = 1),
      date '1970-01-01'
    ) as count_from_date
  ),
  relevant_bookings as (
    select b.id, b.team_id, b.duration
    from public.bookings b
    cross join tracking_window tw
    where b.status = 'confirmed'
      and b.booking_type = 'rehearsal'
      and b.booking_date < current_date
      and b.booking_date >= tw.count_from_date
  ),
  booking_totals as (
    select relevant_bookings.team_id, sum(relevant_bookings.duration)::numeric as total_duration
    from relevant_bookings
    group by relevant_bookings.team_id
  ),
  roster_counts as (
    select br.booking_id, count(*) as member_count
    from public.booking_roster br
    join relevant_bookings rb on rb.id = br.booking_id
    group by br.booking_id
  ),
  full_team_slots as (
    select rb.team_id, bas.booking_id, bas.start_time
    from relevant_bookings rb
    join public.booking_attendance_slots bas on bas.booking_id = rb.id
    join roster_counts rc on rc.booking_id = rb.id
    group by rb.team_id, bas.booking_id, bas.start_time, rc.member_count
    having count(*) = rc.member_count and rc.member_count > 0
  ),
  full_team_totals as (
    select full_team_slots.team_id, (count(*) * 0.5)::numeric as total_session_duration
    from full_team_slots
    group by full_team_slots.team_id
  )
  select
    t.id as team_id,
    coalesce(booking_totals.total_duration, 0)::numeric as total_duration,
    coalesce(full_team_totals.total_session_duration, 0)::numeric as total_session_duration
  from public.teams t
  left join booking_totals on booking_totals.team_id = t.id
  left join full_team_totals on full_team_totals.team_id = t.id
  where public.is_approved(auth.uid())
  order by total_duration desc, t.name asc;
$$;

revoke all on function public.get_rehearsal_leaderboard() from public;
revoke all on function public.get_team_rehearsal_totals() from public;
grant execute on function public.get_rehearsal_leaderboard() to authenticated;
grant execute on function public.get_team_rehearsal_totals() to authenticated;

commit;
