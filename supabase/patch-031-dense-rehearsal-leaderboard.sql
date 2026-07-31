-- Give members with the same rehearsal duration the same dense rank.
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
  with member_totals as (
    select
      p.id as user_id,
      p.name,
      p.cohort,
      (count(b.id) * 0.5)::numeric as total_duration
    from public.profiles p
    left join public.booking_attendance_slots bas
      on bas.user_id = p.id
    left join public.bookings b
      on b.id = bas.booking_id
      and b.status = 'confirmed'
      and b.booking_type = 'rehearsal'
      and b.booking_date < current_date
      and b.booking_date >= coalesce(
        (select count_from_date from public.rehearsal_tracking_settings where id = 1),
        date '1970-01-01'
      )
    where p.role <> 'admin'
      and p.status = 'approved'
      and public.is_approved(auth.uid())
    group by p.id, p.name, p.cohort
  )
  select
    member_totals.user_id,
    member_totals.name,
    member_totals.cohort,
    member_totals.total_duration,
    dense_rank() over (
      order by member_totals.total_duration desc
    ) as rank
  from member_totals
  order by rank asc, member_totals.cohort asc, member_totals.name asc;
$$;

revoke all on function public.get_rehearsal_leaderboard() from public;
grant execute on function public.get_rehearsal_leaderboard() to authenticated;
