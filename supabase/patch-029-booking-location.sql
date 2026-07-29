-- Add club-room/external rehearsal locations.
-- Existing bookings remain club-room bookings.

alter table public.bookings
  add column if not exists booking_location text;

update public.bookings
set booking_location = 'club_room'
where booking_location is null;

alter table public.bookings
  alter column booking_location set default 'club_room',
  alter column booking_location set not null;

alter table public.bookings
  drop constraint if exists bookings_booking_location_check;
alter table public.bookings
  add constraint bookings_booking_location_check
  check (booking_location in ('club_room', 'external'));

create or replace function public.validate_booking_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kst_today date := (now() at time zone 'Asia/Seoul')::date;
  requested_start integer;
  requested_end integer;
begin
  if new.booking_date is null
    or new.booking_date < kst_today
    or new.booking_date > kst_today + 20
  then
    raise exception '예약은 오늘부터 3주 안의 날짜만 만들 수 있습니다.';
  end if;

  if char_length(trim(new.purpose)) not between 1 and 120 then
    raise exception '합주 목적은 120자 이내로 입력해 주세요.';
  end if;

  requested_start := split_part(new.start_time, ':', 1)::integer * 60
    + split_part(new.start_time, ':', 2)::integer;
  requested_end := requested_start + (new.duration * 60)::integer;

  if new.booking_location = 'club_room' then
    perform pg_advisory_xact_lock(hashtext('booking:' || new.booking_date::text));
  end if;

  if new.status = 'confirmed' and new.booking_location = 'club_room' and exists (
    select 1
    from public.bookings b
    where b.status = 'confirmed'
      and b.booking_location = 'club_room'
      and b.booking_date = new.booking_date
      and (split_part(b.start_time, ':', 1)::integer * 60 + split_part(b.start_time, ':', 2)::integer) < requested_end
      and (split_part(b.start_time, ':', 1)::integer * 60 + split_part(b.start_time, ':', 2)::integer)
        + (b.duration * 60)::integer > requested_start
  ) then
    raise exception '이미 예약된 시간과 겹칩니다.';
  end if;

  return new;
end;
$$;

create or replace function public.create_booking(
  p_team_id uuid,
  p_day text,
  p_start_time text,
  p_duration numeric,
  p_purpose text,
  p_booking_date date,
  p_location text
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
  date_day text;
begin
  if not public.is_approved(auth.uid()) then
    raise exception '승인된 사용자만 예약할 수 있습니다.';
  end if;

  if not (public.is_admin(auth.uid()) or public.is_team_leader(p_team_id, auth.uid())) then
    raise exception '팀장만 해당 팀 예약을 만들 수 있습니다.';
  end if;

  if p_location not in ('club_room', 'external') then
    raise exception '합주 장소가 올바르지 않습니다.';
  end if;

  if p_day not in ('월', '화', '수', '목', '금', '토', '일') then
    raise exception '예약 요일이 올바르지 않습니다.';
  end if;

  if p_booking_date is not null then
    date_day := case extract(dow from p_booking_date)::integer
      when 0 then '일'
      when 1 then '월'
      when 2 then '화'
      when 3 then '수'
      when 4 then '목'
      when 5 then '금'
      when 6 then '토'
    end;

    if date_day <> p_day then
      raise exception '예약 날짜와 요일이 일치하지 않습니다.';
    end if;
  end if;

  if p_start_time !~ '^(1[0-9]|2[0-3]):(00|30)$' then
    raise exception '예약 시간이 올바르지 않습니다.';
  end if;

  requested_start := split_part(p_start_time, ':', 1)::integer * 60
    + split_part(p_start_time, ':', 2)::integer;

  if requested_start < 600 or requested_start >= 1440 then
    raise exception '예약 시간은 10:00부터 24:00 사이여야 합니다.';
  end if;

  if p_duration is null or p_duration <= 0 or p_duration * 2 <> floor(p_duration * 2) then
    raise exception '예약 길이는 30분 단위여야 합니다.';
  end if;

  requested_end := requested_start + (p_duration * 60)::integer;

  if requested_end > 1440 then
    raise exception '24시 이후로 끝나는 예약은 만들 수 없습니다.';
  end if;

  if p_location = 'club_room' and exists (
    select 1
    from public.bookings
    where day_of_week = p_day
      and status = 'confirmed'
      and booking_location = 'club_room'
      and (p_booking_date is null or booking_date is null or booking_date = p_booking_date)
      and (split_part(start_time, ':', 1)::integer * 60 + split_part(start_time, ':', 2)::integer) < requested_end
      and (split_part(start_time, ':', 1)::integer * 60 + split_part(start_time, ':', 2)::integer)
        + (duration * 60)::integer > requested_start
  ) then
    raise exception '이미 예약된 시간과 겹칩니다.';
  end if;

  insert into public.bookings (
    team_id,
    booking_date,
    day_of_week,
    start_time,
    duration,
    purpose,
    booking_location,
    created_by
  )
  values (
    p_team_id,
    p_booking_date,
    p_day,
    p_start_time,
    p_duration,
    coalesce(nullif(trim(p_purpose), ''), '합주 예약'),
    p_location,
    auth.uid()
  )
  returning id into new_booking_id;

  insert into public.audit_logs (actor_id, action, target_type, target_id, reason)
  values (
    auth.uid(),
    'create_booking',
    'booking',
    new_booking_id,
    coalesce(p_booking_date::text, p_day) || ' ' || p_start_time || ' ' || p_location
  );

  return new_booking_id;
end;
$$;

create or replace function public.create_booking(
  p_team_id uuid,
  p_day text,
  p_start_time text,
  p_duration numeric,
  p_purpose text,
  p_booking_date date default null
)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.create_booking(
    p_team_id,
    p_day,
    p_start_time,
    p_duration,
    p_purpose,
    p_booking_date,
    'club_room'
  );
$$;

create or replace function public.create_bookings_with_location(
  p_team_id uuid,
  p_day text,
  p_booking_date date,
  p_purpose text,
  p_groups jsonb
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  group_item jsonb;
  new_booking_id uuid;
  new_booking_ids uuid[] := '{}';
  group_start_time text;
  group_duration numeric;
  group_location text;
begin
  if p_groups is null or jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) = 0 then
    raise exception '예약할 시간대가 없습니다.';
  end if;

  for group_item in select value from jsonb_array_elements(p_groups)
  loop
    group_start_time := group_item->>'start_time';
    group_duration := (group_item->>'duration')::numeric;
    group_location := coalesce(nullif(group_item->>'location', ''), 'club_room');

    new_booking_id := public.create_booking(
      p_team_id,
      p_day,
      group_start_time,
      group_duration,
      p_purpose,
      p_booking_date,
      group_location
    );
    new_booking_ids := array_append(new_booking_ids, new_booking_id);
  end loop;

  return new_booking_ids;
end;
$$;

revoke all on function public.create_booking(uuid, text, text, numeric, text, date) from public;
revoke all on function public.create_booking(uuid, text, text, numeric, text, date, text) from public;
revoke all on function public.create_bookings_with_location(uuid, text, date, text, jsonb) from public;

grant execute on function public.create_booking(uuid, text, text, numeric, text, date) to authenticated;
grant execute on function public.create_booking(uuid, text, text, numeric, text, date, text) to authenticated;
grant execute on function public.create_bookings_with_location(uuid, text, date, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
