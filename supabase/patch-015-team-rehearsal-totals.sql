-- Calculate total completed rehearsal time per team in Supabase.
-- Run once in Supabase SQL Editor.

begin;

create or replace function public.get_team_rehearsal_totals()
returns table (
  team_id uuid,
  total_duration numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id as team_id,
    coalesce(sum(b.duration), 0)::numeric as total_duration
  from public.teams t
  left join public.bookings b
    on b.team_id = t.id
    and b.status = 'confirmed'
    and b.booking_date < current_date
  group by t.id
  order by total_duration desc, t.name asc;
$$;

grant execute on function public.get_team_rehearsal_totals() to authenticated;

commit;
