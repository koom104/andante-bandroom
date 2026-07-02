-- BandRoom AI patch 003
-- Run this in Supabase Dashboard > SQL Editor for an existing database.
-- It expands schedules and booking starts to 10:00-24:00 in 30-minute slots.

begin;

alter table public.member_schedules
  drop constraint if exists member_schedules_start_time_check,
  drop constraint if exists member_schedules_start_time_range_check;

alter table public.member_schedules
  add constraint member_schedules_start_time_range_check check (
    start_time ~ '^(1[0-9]|2[0-3]):(00|30)$'
    and (split_part(start_time, ':', 1)::integer * 60 + split_part(start_time, ':', 2)::integer) >= 600
    and (split_part(start_time, ':', 1)::integer * 60 + split_part(start_time, ':', 2)::integer) < 1440
  );

alter table public.bookings
  drop constraint if exists bookings_start_time_check,
  drop constraint if exists bookings_start_time_range_check,
  drop constraint if exists bookings_end_time_range_check;

alter table public.bookings
  add constraint bookings_start_time_range_check check (
    start_time ~ '^(1[0-9]|2[0-3]):(00|30)$'
    and (split_part(start_time, ':', 1)::integer * 60 + split_part(start_time, ':', 2)::integer) >= 600
    and (split_part(start_time, ':', 1)::integer * 60 + split_part(start_time, ':', 2)::integer) < 1440
  ),
  add constraint bookings_end_time_range_check check (
    (split_part(start_time, ':', 1)::integer * 60 + split_part(start_time, ':', 2)::integer) + duration * 60 <= 1440
  );

create or replace function public.create_booking(
  p_team_id uuid,
  p_day text,
  p_start_time text,
  p_duration integer,
  p_purpose text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_booking_id uuid;
  requested_start integer;
  requested_end integer;
begin
  if not public.is_approved(auth.uid()) then
    raise exception '승인된 사용자만 예약할 수 있습니다.';
  end if;

  if not (public.is_admin(auth.uid()) or public.is_team_member(p_team_id, auth.uid())) then
    raise exception '팀 멤버만 해당 팀 예약을 만들 수 있습니다.';
  end if;

  if p_day not in ('월', '화', '수', '목', '금', '토') then
    raise exception '예약 요일이 올바르지 않습니다.';
  end if;

  if p_start_time !~ '^(1[0-9]|2[0-3]):(00|30)$' then
    raise exception '예약 시간이 올바르지 않습니다.';
  end if;

  requested_start := split_part(p_start_time, ':', 1)::integer * 60 + split_part(p_start_time, ':', 2)::integer;

  if requested_start < 600 or requested_start >= 1440 then
    raise exception '예약 시간은 10:00부터 24:00 사이여야 합니다.';
  end if;

  if p_duration not in (1, 2) then
    raise exception '예약 길이는 1시간 또는 2시간이어야 합니다.';
  end if;

  requested_end := requested_start + p_duration * 60;

  if requested_end > 1440 then
    raise exception '24시 이후로 끝나는 예약은 만들 수 없습니다.';
  end if;

  if exists (
    select 1
    from public.bookings
    where day_of_week = p_day
      and status = 'confirmed'
      and (split_part(start_time, ':', 1)::integer * 60 + split_part(start_time, ':', 2)::integer) < requested_end
      and (split_part(start_time, ':', 1)::integer * 60 + split_part(start_time, ':', 2)::integer) + duration * 60 > requested_start
  ) then
    raise exception '이미 예약된 시간과 겹칩니다.';
  end if;

  insert into public.bookings (
    team_id,
    day_of_week,
    start_time,
    duration,
    purpose,
    created_by
  )
  values (
    p_team_id,
    p_day,
    p_start_time,
    p_duration,
    coalesce(nullif(trim(p_purpose), ''), '합주 예약'),
    auth.uid()
  )
  returning id into new_booking_id;

  insert into public.audit_logs (actor_id, action, target_type, target_id, reason)
  values (auth.uid(), 'create_booking', 'booking', new_booking_id, p_day || ' ' || p_start_time);

  return new_booking_id;
end;
$$;

grant execute on function public.create_booking(uuid, text, text, integer, text) to authenticated;

commit;
