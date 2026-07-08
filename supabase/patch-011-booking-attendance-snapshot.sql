-- Booking attendance snapshots.
-- Run once in Supabase Dashboard > SQL Editor.
-- New bookings store the members who count as attending at reservation time.

begin;

create table if not exists public.booking_attendance (
  booking_id uuid not null references public.bookings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (booking_id, user_id)
);

alter table public.booking_attendance enable row level security;

create or replace function public.is_member_available_for_booking(
  p_user_id uuid,
  p_booking_date date,
  p_day text,
  p_start_time text,
  p_duration numeric
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_start integer;
  slot_count integer;
  slot_index integer;
  slot_minutes integer;
  slot_time text;
  has_date_override boolean := false;
begin
  requested_start := split_part(p_start_time, ':', 1)::integer * 60 + split_part(p_start_time, ':', 2)::integer;
  slot_count := (p_duration * 2)::integer;

  if p_booking_date is not null then
    select exists (
      select 1
      from public.member_schedule_date_slots
      where user_id = p_user_id
        and schedule_date = p_booking_date
    )
    into has_date_override;
  end if;

  for slot_index in 0..slot_count - 1 loop
    slot_minutes := requested_start + slot_index * 30;
    slot_time := lpad((slot_minutes / 60)::integer::text, 2, '0') || ':' || lpad((slot_minutes % 60)::text, 2, '0');

    if has_date_override then
      if exists (
        select 1
        from public.member_schedule_date_slots
        where user_id = p_user_id
          and schedule_date = p_booking_date
          and start_time = slot_time
          and is_busy
      ) then
        return false;
      end if;
    elsif exists (
      select 1
      from public.member_schedules
      where user_id = p_user_id
        and day_of_week = p_day
        and start_time = slot_time
    ) then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

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

  return new;
end;
$$;

drop trigger if exists bookings_snapshot_attendance on public.bookings;
create trigger bookings_snapshot_attendance
after insert on public.bookings
for each row execute function public.snapshot_booking_attendance();

drop policy if exists "booking_attendance_select" on public.booking_attendance;
create policy "booking_attendance_select"
on public.booking_attendance
for select
to authenticated
using (public.is_approved(auth.uid()));

drop policy if exists "booking_attendance_admin_insert" on public.booking_attendance;
create policy "booking_attendance_admin_insert"
on public.booking_attendance
for insert
to authenticated
with check (public.is_admin(auth.uid()));

grant select, insert on public.booking_attendance to authenticated;

insert into public.booking_attendance (booking_id, user_id)
select bookings.id, team_members.user_id
from public.bookings
join public.team_members on team_members.team_id = bookings.team_id
where bookings.status = 'confirmed'
  and public.is_member_available_for_booking(
    team_members.user_id,
    bookings.booking_date,
    bookings.day_of_week,
    bookings.start_time,
    bookings.duration
  )
on conflict (booking_id, user_id) do nothing;

commit;
