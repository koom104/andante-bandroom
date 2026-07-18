-- Add the summed attendance time for every session member to each team's rehearsal totals.
-- Run once in Supabase Dashboard > SQL Editor.

begin;

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
  select
    t.id as team_id,
    coalesce((
      select sum(b.duration)
      from public.bookings b
      where b.team_id = t.id
        and b.status = 'confirmed'
        and b.booking_date < current_date
    ), 0)::numeric as total_duration,
    coalesce((
      select sum(b.duration)
      from public.bookings b
      join public.booking_attendance ba on ba.booking_id = b.id
      where b.team_id = t.id
        and b.status = 'confirmed'
        and b.booking_date < current_date
    ), 0)::numeric as total_session_duration
  from public.teams t
  order by total_duration desc, t.name asc;
$$;

grant execute on function public.get_team_rehearsal_totals() to authenticated;

commit;
