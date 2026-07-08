-- Calculate rehearsal time ranking in Supabase instead of downloading all past bookings.
-- Run once in Supabase SQL Editor.

begin;

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
      coalesce(sum(b.duration), 0)::numeric as total_duration
    from public.profiles p
    left join public.booking_attendance ba
      on ba.user_id = p.id
    left join public.bookings b
      on b.id = ba.booking_id
      and b.status = 'confirmed'
      and b.booking_date < current_date
    where p.role <> 'admin'
      and p.status = 'approved'
    group by p.id, p.name, p.cohort
  )
  select
    member_totals.user_id,
    member_totals.name,
    member_totals.cohort,
    member_totals.total_duration,
    rank() over (
      order by member_totals.total_duration desc, member_totals.cohort asc, member_totals.name asc
    ) as rank
  from member_totals
  order by rank asc, member_totals.cohort asc, member_totals.name asc;
$$;

grant execute on function public.get_rehearsal_leaderboard() to authenticated;

commit;
