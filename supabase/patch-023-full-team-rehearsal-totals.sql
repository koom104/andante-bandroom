-- Count only rehearsals where every member in the booking-time roster could attend.
-- Existing bookings are backfilled from the current team roster because no historical roster snapshot exists.
-- Run once in Supabase Dashboard > SQL Editor after patch-011.

begin;

create table if not exists public.booking_roster (
  booking_id uuid not null references public.bookings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (booking_id, user_id)
);

alter table public.booking_roster enable row level security;

drop policy if exists "booking_roster_select" on public.booking_roster;
create policy "booking_roster_select"
on public.booking_roster
for select
to authenticated
using (public.is_approved(auth.uid()));

drop policy if exists "booking_roster_admin_insert" on public.booking_roster;
create policy "booking_roster_admin_insert"
on public.booking_roster
for insert
to authenticated
with check (public.is_admin(auth.uid()));

grant select, insert on public.booking_roster to authenticated;

create or replace function public.snapshot_booking_roster()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'confirmed' then
    return new;
  end if;

  insert into public.booking_roster (booking_id, user_id)
  select new.id, team_members.user_id
  from public.team_members
  where team_members.team_id = new.team_id
  on conflict (booking_id, user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists bookings_snapshot_roster on public.bookings;
create trigger bookings_snapshot_roster
after insert on public.bookings
for each row execute function public.snapshot_booking_roster();

insert into public.booking_roster (booking_id, user_id)
select bookings.id, team_members.user_id
from public.bookings
join public.team_members on team_members.team_id = bookings.team_id
where bookings.status = 'confirmed'
on conflict (booking_id, user_id) do nothing;

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
      where b.team_id = t.id
        and b.status = 'confirmed'
        and b.booking_date < current_date
        and (select count(*) from public.booking_roster br where br.booking_id = b.id) > 0
        and (select count(*) from public.booking_roster br where br.booking_id = b.id)
          = (select count(*) from public.booking_attendance ba where ba.booking_id = b.id)
    ), 0)::numeric as total_session_duration
  from public.teams t
  order by total_duration desc, t.name asc;
$$;

grant execute on function public.get_team_rehearsal_totals() to authenticated;

commit;
