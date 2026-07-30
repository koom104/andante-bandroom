-- Super-admin-only club-room blocks for maintenance, equipment issues, and operations.
-- Room blocks prevent overlapping club-room bookings but never count as rehearsals.

alter table public.bookings
  alter column team_id drop not null;

alter table public.bookings
  add column if not exists booking_type text;

update public.bookings
set booking_type = 'rehearsal'
where booking_type is null;

alter table public.bookings
  alter column booking_type set default 'rehearsal',
  alter column booking_type set not null;

alter table public.bookings
  drop constraint if exists bookings_booking_type_check;
alter table public.bookings
  add constraint bookings_booking_type_check
  check (
    (booking_type = 'rehearsal' and team_id is not null)
    or (booking_type = 'room_block' and team_id is null and booking_location = 'club_room')
  );

create or replace function public.snapshot_booking_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'confirmed' or new.booking_type <> 'rehearsal' then
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

create or replace function public.snapshot_booking_roster()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'confirmed' or new.booking_type <> 'rehearsal' then
    return new;
  end if;

  insert into public.booking_roster (booking_id, user_id)
  select new.id, team_members.user_id
  from public.team_members
  where team_members.team_id = new.team_id
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

create or replace function public.create_room_blocks(
  p_day text,
  p_booking_date date,
  p_reason text,
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
  date_day text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception '최고 관리자만 동아리방 사용 제한을 등록할 수 있습니다.';
  end if;

  if p_day not in ('월', '화', '수', '목', '금', '토', '일') then
    raise exception '예약 요일이 올바르지 않습니다.';
  end if;

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

  if char_length(trim(coalesce(p_reason, ''))) not between 1 and 120 then
    raise exception '사용 제한 사유를 120자 이내로 입력해 주세요.';
  end if;

  if p_groups is null or jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) = 0 then
    raise exception '사용을 제한할 시간대를 선택해 주세요.';
  end if;

  for group_item in select value from jsonb_array_elements(p_groups)
  loop
    group_start_time := group_item->>'start_time';
    group_duration := (group_item->>'duration')::numeric;

    if group_start_time !~ '^(1[0-9]|2[0-3]):(00|30)$'
      or group_duration is null
      or group_duration <= 0
      or group_duration * 2 <> floor(group_duration * 2)
    then
      raise exception '사용 제한 시간이 올바르지 않습니다.';
    end if;

    insert into public.bookings (
      team_id,
      booking_date,
      day_of_week,
      start_time,
      duration,
      purpose,
      booking_location,
      booking_type,
      created_by
    )
    values (
      null,
      p_booking_date,
      p_day,
      group_start_time,
      group_duration,
      trim(p_reason),
      'club_room',
      'room_block',
      auth.uid()
    )
    returning id into new_booking_id;

    new_booking_ids := array_append(new_booking_ids, new_booking_id);
  end loop;

  insert into public.audit_logs (actor_id, action, target_type, reason)
  values (
    auth.uid(),
    'create_room_blocks',
    'booking',
    p_booking_date::text || ' ' || trim(p_reason)
  );

  return new_booking_ids;
end;
$$;

create or replace function public.get_push_subscription_status()
returns table (
  user_id uuid,
  name text,
  cohort text,
  has_push boolean,
  registered_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.name,
    p.cohort,
    (active_subscription.updated_at is not null) as has_push,
    active_subscription.updated_at
  from public.profiles p
  left join lateral (
    select ps.updated_at
    from public.push_subscriptions ps
    where ps.user_id = p.id
      and ps.disabled_at is null
    order by ps.updated_at desc
    limit 1
  ) active_subscription on true
  where p.status = 'approved'
    and p.role <> 'admin'
    and public.is_super_admin(auth.uid())
  order by p.cohort asc, p.name asc;
$$;

create or replace function public.cancel_booking(
  p_booking_id uuid,
  p_reason text default '예약 취소'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_booking public.bookings%rowtype;
begin
  if not public.is_approved(auth.uid()) then
    raise exception '승인된 사용자만 예약을 취소할 수 있습니다.';
  end if;

  select *
  into target_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if target_booking.id is null then
    raise exception '예약을 찾을 수 없습니다.';
  end if;

  if target_booking.status = 'cancelled' then
    return target_booking.id;
  end if;

  if target_booking.booking_type = 'room_block' and not public.is_super_admin(auth.uid()) then
    raise exception '최고 관리자만 동아리방 사용 제한을 취소할 수 있습니다.';
  end if;

  if target_booking.booking_type <> 'room_block'
    and not (public.is_admin(auth.uid()) or public.is_team_leader(target_booking.team_id, auth.uid()))
  then
    raise exception '관리자 또는 해당 팀의 팀장만 예약을 취소할 수 있습니다.';
  end if;

  update public.bookings
  set status = 'cancelled',
      cancelled_by = auth.uid(),
      cancelled_at = now(),
      cancel_reason = coalesce(nullif(trim(p_reason), ''), '예약 취소')
  where id = p_booking_id;

  insert into public.audit_logs (actor_id, action, target_type, target_id, reason)
  values (auth.uid(), 'cancel_booking', 'booking', p_booking_id, coalesce(nullif(trim(p_reason), ''), '예약 취소'));

  return p_booking_id;
end;
$$;

revoke all on function public.create_room_blocks(text, date, text, jsonb) from public;
revoke all on function public.get_push_subscription_status() from public;
grant execute on function public.create_room_blocks(text, date, text, jsonb) to authenticated;
grant execute on function public.get_push_subscription_status() to authenticated;

notify pgrst, 'reload schema';
