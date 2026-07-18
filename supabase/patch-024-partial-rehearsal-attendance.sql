-- Count rehearsal attendance in 30-minute slots so late arrivals and early departures are reflected.
-- Existing bookings keep their previous full-booking attendance result; new bookings get exact slot snapshots.
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

create table if not exists public.booking_attendance_slots (
  booking_id uuid not null references public.bookings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  start_time text not null,
  created_at timestamptz not null default now(),
  primary key (booking_id, user_id, start_time)
);

alter table public.booking_attendance_slots enable row level security;

drop policy if exists "booking_attendance_slots_select" on public.booking_attendance_slots;
create policy "booking_attendance_slots_select"
on public.booking_attendance_slots
for select
to authenticated
using (public.is_approved(auth.uid()));

drop policy if exists "booking_attendance_slots_admin_insert" on public.booking_attendance_slots;
create policy "booking_attendance_slots_admin_insert"
on public.booking_attendance_slots
for insert
to authenticated
with check (public.is_admin(auth.uid()));

grant select, insert on public.booking_attendance_slots to authenticated;

create or replace function public.snapshot_booking_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'confirmed' then
    return new;
  end if;

  insert into public.booking_attendance (booking_id, user_id)
  select new.id, team_members.user_id
  from public.team_members
  where team_members.team_id = new.team_id
    and public.is_member_available_for_booking(
      team_members.user_id,
      new.booking_date,
      new.day_of_week,
      new.start_time,
      new.duration
    )
  on conflict (booking_id, user_id) do nothing;

  insert into public.booking_attendance_slots (booking_id, user_id, start_time)
  select new.id, team_members.user_id, slot.slot_time
  from public.team_members
  cross join generate_series(0, (new.duration * 2)::integer - 1) as slot_index
  cross join lateral (
    select
      lpad(((split_part(new.start_time, ':', 1)::integer * 60
        + split_part(new.start_time, ':', 2)::integer
        + slot_index * 30) / 60)::integer::text, 2, '0')
      || ':' ||
      lpad(((split_part(new.start_time, ':', 1)::integer * 60
        + split_part(new.start_time, ':', 2)::integer
        + slot_index * 30) % 60)::integer::text, 2, '0') as slot_time
  ) slot
  where team_members.team_id = new.team_id
    and public.is_member_available_for_booking(
      team_members.user_id,
      new.booking_date,
      new.day_of_week,
      slot.slot_time,
      0.5
    )
  on conflict (booking_id, user_id, start_time) do nothing;

  return new;
end;
$$;

insert into public.booking_attendance_slots (booking_id, user_id, start_time)
select booking_attendance.booking_id, booking_attendance.user_id, slot.slot_time
from public.booking_attendance
join public.bookings on bookings.id = booking_attendance.booking_id
cross join generate_series(0, (bookings.duration * 2)::integer - 1) as slot_index
cross join lateral (
  select
    lpad(((split_part(bookings.start_time, ':', 1)::integer * 60
      + split_part(bookings.start_time, ':', 2)::integer
      + slot_index * 30) / 60)::integer::text, 2, '0')
    || ':' ||
    lpad(((split_part(bookings.start_time, ':', 1)::integer * 60
      + split_part(bookings.start_time, ':', 2)::integer
      + slot_index * 30) % 60)::integer::text, 2, '0') as slot_time
) slot
on conflict (booking_id, user_id, start_time) do nothing;

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
      select count(*) * 0.5
      from (
        select bas.booking_id, bas.start_time
        from public.booking_attendance_slots bas
        join public.bookings b on b.id = bas.booking_id
        where b.team_id = t.id
          and b.status = 'confirmed'
          and b.booking_date < current_date
        group by bas.booking_id, bas.start_time
        having count(*) = (
          select count(*)
          from public.booking_roster br
          where br.booking_id = bas.booking_id
        )
        and count(*) > 0
      ) full_team_slots
    ), 0)::numeric as total_session_duration
  from public.teams t
  order by total_duration desc, t.name asc;
$$;

grant execute on function public.get_rehearsal_leaderboard() to authenticated;
grant execute on function public.get_team_rehearsal_totals() to authenticated;

commit;
