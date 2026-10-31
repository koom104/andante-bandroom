-- BandRoom AI Supabase setup
-- Run this once in Supabase Dashboard > SQL Editor.

begin;

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  cohort text not null,
  student_no text not null,
  role text not null default 'member' check (role in ('member', 'manager', 'admin')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'suspended')),
  password_reset_required boolean not null default false,
  privacy_consent_at timestamptz,
  privacy_consent_version text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id)
);

alter table public.profiles
  add column if not exists privacy_consent_at timestamptz,
  add column if not exists privacy_consent_version text;

alter table public.profiles
  drop constraint if exists profiles_identity_length_check;
alter table public.profiles
  add constraint profiles_identity_length_check check (
    char_length(trim(email)) between 3 and 320
    and char_length(trim(name)) between 1 and 100
    and char_length(trim(cohort)) between 1 and 20
    and char_length(trim(student_no)) between 1 and 30
  ) not valid;

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  song text not null default '새 합주 준비',
  color_index integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.teams
  drop constraint if exists teams_text_length_check;
alter table public.teams
  add constraint teams_text_length_check check (
    char_length(trim(name)) between 1 and 100
    and char_length(trim(song)) between 1 and 100
  ) not valid;

create table if not exists public.rehearsal_goal_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.rehearsal_goal_categories
  drop constraint if exists rehearsal_goal_categories_name_length_check;
alter table public.rehearsal_goal_categories
  add constraint rehearsal_goal_categories_name_length_check check (
    char_length(trim(name)) between 1 and 100
  ) not valid;

create table if not exists public.club_room_status (
  id integer primary key default 1 check (id = 1),
  is_open boolean not null default false,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  session text not null check (session in ('보컬', '리드기타', '리듬기타', '어쿠스틱', '베이스', '드럼', '피아노', '신디')),
  is_leader boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists public.member_schedules (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day_of_week text not null check (day_of_week in ('월', '화', '수', '목', '금', '토', '일')),
  start_time text not null constraint member_schedules_start_time_range_check check (
    start_time ~ '^(1[0-9]|2[0-3]):(00|30)$'
    and (split_part(start_time, ':', 1)::integer * 60 + split_part(start_time, ':', 2)::integer) >= 600
    and (split_part(start_time, ':', 1)::integer * 60 + split_part(start_time, ':', 2)::integer) < 1440
  ),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (user_id, day_of_week, start_time)
);

create table if not exists public.member_schedule_date_slots (
  user_id uuid not null references public.profiles(id) on delete cascade,
  schedule_date date not null,
  start_time text not null constraint member_schedule_date_slots_start_time_range_check check (
    start_time ~ '^(1[0-9]|2[0-3]):(00|30)$'
    and (split_part(start_time, ':', 1)::integer * 60 + split_part(start_time, ':', 2)::integer) >= 600
    and (split_part(start_time, ':', 1)::integer * 60 + split_part(start_time, ':', 2)::integer) < 1440
  ),
  is_busy boolean not null default false,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (user_id, schedule_date, start_time)
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  booking_date date,
  day_of_week text not null check (day_of_week in ('월', '화', '수', '목', '금', '토', '일')),
  start_time text not null constraint bookings_start_time_range_check check (
    start_time ~ '^(1[0-9]|2[0-3]):(00|30)$'
    and (split_part(start_time, ':', 1)::integer * 60 + split_part(start_time, ':', 2)::integer) >= 600
    and (split_part(start_time, ':', 1)::integer * 60 + split_part(start_time, ':', 2)::integer) < 1440
  ),
  duration numeric(4,1) not null check (duration > 0 and duration * 2 = floor(duration * 2)),
  purpose text not null,
  booking_location text not null default 'club_room' check (booking_location in ('club_room', 'external')),
  booking_type text not null default 'rehearsal' check (
    (booking_type = 'rehearsal' and team_id is not null)
    or (booking_type = 'room_block' and team_id is null and booking_location = 'club_room')
  ),
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_by uuid references public.profiles(id),
  cancelled_by uuid references public.profiles(id),
  cancel_reason text,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint bookings_end_time_range_check check (
    (split_part(start_time, ':', 1)::integer * 60 + split_part(start_time, ':', 2)::integer) + duration * 60 <= 1440
  )
);

alter table public.bookings
  drop constraint if exists bookings_text_length_check;
alter table public.bookings
  add constraint bookings_text_length_check check (
    char_length(trim(purpose)) between 1 and 120
    and char_length(coalesce(cancel_reason, '')) <= 300
  ) not valid;

create table if not exists public.booking_attendance (
  booking_id uuid not null references public.bookings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (booking_id, user_id)
);

create table if not exists public.booking_roster (
  booking_id uuid not null references public.bookings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (booking_id, user_id)
);

create table if not exists public.booking_attendance_slots (
  booking_id uuid not null references public.bookings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  start_time text not null,
  created_at timestamptz not null default now(),
  primary key (booking_id, user_id, start_time)
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz
);

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_endpoint_security_check;
alter table public.push_subscriptions
  add constraint push_subscriptions_endpoint_security_check check (
    char_length(endpoint) between 16 and 2048
    and endpoint ~* '^https://(fcm[.]googleapis[.]com|push[.]services[.]mozilla[.]com|updates[.]push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com|([a-z0-9-]+[.])*notify[.]windows[.]com)(/|$)'
    and char_length(p256dh) between 40 and 256
    and p256dh ~ '^[A-Za-z0-9_-]+$'
    and char_length(auth_key) between 16 and 128
    and auth_key ~ '^[A-Za-z0-9_-]+$'
    and char_length(coalesce(user_agent, '')) <= 512
  ) not valid;

create table if not exists public.push_notification_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  kind text not null check (kind in ('daily_digest', 'booking_reminder', 'booking_created', 'booking_cancelled')),
  notification_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  target_type text not null,
  target_id uuid,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.audit_logs
  drop constraint if exists audit_logs_text_length_check;
alter table public.audit_logs
  add constraint audit_logs_text_length_check check (
    char_length(action) between 1 and 100
    and char_length(target_type) between 1 and 100
    and char_length(coalesce(reason, '')) <= 500
  ) not valid;

create table if not exists public.rehearsal_tracking_settings (
  id integer primary key default 1 check (id = 1),
  count_from_date date not null default date '1970-01-01',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

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

drop trigger if exists validate_booking_insert_trigger on public.bookings;
create trigger validate_booking_insert_trigger
before insert on public.bookings
for each row execute function public.validate_booking_insert();

create or replace function public.stamp_club_room_status_editor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists stamp_club_room_status_editor_trigger on public.club_room_status;
create trigger stamp_club_room_status_editor_trigger
before insert or update on public.club_room_status
for each row execute function public.stamp_club_room_status_editor();

drop trigger if exists teams_touch_updated_at on public.teams;
create trigger teams_touch_updated_at
before update on public.teams
for each row execute function public.touch_updated_at();

drop trigger if exists push_subscriptions_touch_updated_at on public.push_subscriptions;
create trigger push_subscriptions_touch_updated_at
before update on public.push_subscriptions
for each row execute function public.touch_updated_at();

create or replace function public.is_approved(user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = user_id
      and status = 'approved'
      and not password_reset_required
  );
$$;

create or replace function public.is_admin(user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = user_id
      and role in ('admin', 'manager')
      and status = 'approved'
      and not password_reset_required
  );
$$;

create or replace function public.is_super_admin(user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = user_id
      and role = 'admin'
      and status = 'approved'
      and not password_reset_required
  );
$$;

create or replace function public.is_team_member(p_team_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_members
    where team_id = p_team_id
      and user_id = p_user_id
  );
$$;

create or replace function public.is_team_leader(p_team_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_members
    where team_id = p_team_id
      and user_id = p_user_id
      and is_leader = true
  );
$$;

create or replace function public.can_view_member_schedule(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_user_id = auth.uid()
    or public.is_admin(auth.uid())
    or exists (
      select 1
      from public.team_members requester_membership
      join public.team_members target_membership
        on target_membership.team_id = requester_membership.team_id
      where requester_membership.user_id = auth.uid()
        and target_membership.user_id = p_user_id
    );
$$;

create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth_key text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_id uuid := auth.uid();
begin
  if requester_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = requester_id
      and status = 'approved'
  ) then
    raise exception '승인된 부원만 알림을 받을 수 있습니다.';
  end if;

  if char_length(p_endpoint) not between 16 and 2048
    or p_endpoint !~* '^https://(fcm[.]googleapis[.]com|push[.]services[.]mozilla[.]com|updates[.]push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com|([a-z0-9-]+[.])*notify[.]windows[.]com)(/|$)'
    or char_length(p_p256dh) not between 40 and 256
    or p_p256dh !~ '^[A-Za-z0-9_-]+$'
    or char_length(p_auth_key) not between 16 and 128
    or p_auth_key !~ '^[A-Za-z0-9_-]+$'
  then
    raise exception '푸시 구독 정보가 올바르지 않습니다.';
  end if;

  perform pg_advisory_xact_lock(hashtext(requester_id::text));

  update public.push_subscriptions
  set disabled_at = now()
  where user_id = requester_id
    and disabled_at is null
    and endpoint <> p_endpoint;

  insert into public.push_subscriptions (
    user_id,
    endpoint,
    p256dh,
    auth_key,
    user_agent,
    updated_at,
    disabled_at
  )
  values (
    requester_id,
    p_endpoint,
    p_p256dh,
    p_auth_key,
    left(coalesce(p_user_agent, ''), 512),
    now(),
    null
  )
  on conflict (endpoint) do update
  set user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth_key = excluded.auth_key,
      user_agent = excluded.user_agent,
      updated_at = now(),
      disabled_at = null;
end;
$$;

create or replace function public.get_my_push_subscriptions()
returns table (
  id uuid,
  user_id uuid,
  endpoint text,
  p256dh text,
  auth_key text
)
language sql
stable
security definer
set search_path = public
as $$
  select ps.id, ps.user_id, ps.endpoint, ps.p256dh, ps.auth_key
  from public.push_subscriptions ps
  where ps.user_id = auth.uid()
    and ps.disabled_at is null
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.status = 'approved'
    );
$$;

create or replace function public.disable_my_push_subscription(p_subscription_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.push_subscriptions
  set disabled_at = now()
  where id = p_subscription_id
    and user_id = auth.uid();
end;
$$;

create or replace function public.claim_booking_push_targets(
  p_requester_id uuid,
  p_booking_ids uuid[],
  p_kind text
)
returns table (
  booking_id uuid,
  team_id uuid,
  booking_date date,
  day_of_week text,
  start_time text,
  duration numeric,
  purpose text,
  status text,
  team_name text,
  team_song text,
  user_id uuid,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth_key text
)
language sql
volatile
security definer
set search_path = public
as $$
  with allowed_bookings as (
    select b.*
    from public.bookings b
    where cardinality(p_booking_ids) between 1 and 20
      and b.id = any(p_booking_ids)
      and public.is_approved(p_requester_id)
      and (
        public.is_admin(p_requester_id)
        or public.is_team_leader(b.team_id, p_requester_id)
      )
      and (
        (p_kind = 'booking_created' and b.status = 'confirmed')
        or (p_kind = 'booking_cancelled' and b.status = 'cancelled')
      )
  ),
  candidate_targets as (
    select
      b.id as booking_id,
      b.team_id,
      b.booking_date,
      b.day_of_week,
      b.start_time,
      b.duration,
      b.purpose,
      b.status,
      t.name as team_name,
      t.song as team_song,
      tm.user_id,
      ps.id as subscription_id,
      ps.endpoint,
      ps.p256dh,
      ps.auth_key
    from allowed_bookings b
    join public.teams t on t.id = b.team_id
    join public.team_members tm on tm.team_id = b.team_id
    join public.push_subscriptions ps
      on ps.user_id = tm.user_id
     and ps.disabled_at is null
  ),
  claimed as (
    insert into public.push_notification_logs (
      user_id,
      booking_id,
      kind,
      notification_date
    )
    select distinct
      candidate_targets.user_id,
      candidate_targets.booking_id,
      p_kind,
      candidate_targets.booking_date
    from candidate_targets
    on conflict do nothing
    returning user_id, booking_id
  )
  select
    candidate_targets.booking_id,
    candidate_targets.team_id,
    candidate_targets.booking_date,
    candidate_targets.day_of_week,
    candidate_targets.start_time,
    candidate_targets.duration,
    candidate_targets.purpose,
    candidate_targets.status,
    candidate_targets.team_name,
    candidate_targets.team_song,
    candidate_targets.user_id,
    candidate_targets.subscription_id,
    candidate_targets.endpoint,
    candidate_targets.p256dh,
    candidate_targets.auth_key
  from candidate_targets
  join claimed
    on claimed.user_id = candidate_targets.user_id
   and claimed.booking_id = candidate_targets.booking_id;
$$;

create or replace function public.protect_profile_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = new.id and not public.is_admin(auth.uid()) then
    new.role := 'member';
    new.status := 'pending';
    new.approved_at := null;
    new.approved_by := null;
  end if;

  if char_length(trim(new.name)) not between 1 and 100
    or char_length(trim(new.student_no)) not between 1 and 30
  then
    raise exception '이름 또는 학번 형식이 올바르지 않습니다.';
  end if;

  perform pg_advisory_xact_lock(hashtext('profile-name:' || lower(trim(new.name))));
  perform pg_advisory_xact_lock(hashtext('profile-student:' || trim(new.student_no)));

  if exists (
    select 1
    from public.profiles p
    where p.id <> new.id
      and lower(trim(p.name)) = lower(trim(new.name))
  ) then
    raise exception '이미 등록된 이름입니다.';
  end if;

  if exists (
    select 1
    from public.profiles p
    where p.id <> new.id
      and trim(p.student_no) = trim(new.student_no)
  ) then
    raise exception '이미 등록된 학번입니다.';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_insert_trigger on public.profiles;
create trigger protect_profile_insert_trigger
before insert on public.profiles
for each row execute function public.protect_profile_insert();

create or replace function public.protect_profile_role_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role is distinct from new.role and auth.uid() is not null then
    if old.role = 'admin' then
      raise exception '최고 관리자 계정의 등급은 앱에서 변경할 수 없습니다.';
    end if;

    if not public.is_super_admin(auth.uid()) then
      raise exception '최고 관리자만 집기 권한을 변경할 수 있습니다.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_role_update_trigger on public.profiles;
create trigger protect_profile_role_update_trigger
before update of role on public.profiles
for each row execute function public.protect_profile_role_update();

create or replace function public.protect_privileged_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
    and not public.is_super_admin(auth.uid())
    and old.role in ('admin', 'manager')
    and old.id <> auth.uid()
  then
    raise exception '상위 관리 계정은 최고 관리자만 변경할 수 있습니다.';
  end if;

  return new;
end;
$$;

create or replace function public.get_member_directory()
returns table (
  id uuid,
  name text,
  cohort text,
  role text,
  status text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, p.cohort, p.role, p.status
  from public.profiles p
  where public.is_approved(auth.uid())
    and p.status = 'approved'
  order by p.created_at asc;
$$;

create or replace function public.review_profile_signup(
  p_profile_id uuid,
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception '관리 권한이 필요합니다.';
  end if;

  if p_status not in ('approved', 'rejected') then
    raise exception '처리할 수 없는 가입 상태입니다.';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = p_profile_id
      and role = 'member'
      and status in ('pending', 'rejected')
  ) then
    raise exception '승인 대기 또는 거절 상태의 일반 부원만 처리할 수 있습니다.';
  end if;

  update public.profiles
  set status = p_status,
      approved_by = auth.uid(),
      approved_at = case when p_status = 'approved' then now() else null end
  where id = p_profile_id;

  insert into public.audit_logs (actor_id, action, target_type, target_id, reason)
  values (auth.uid(), 'review_signup', 'profile', p_profile_id, p_status);

  return p_profile_id;
end;
$$;

drop trigger if exists protect_privileged_profile_update_trigger on public.profiles;
create trigger protect_privileged_profile_update_trigger
before update on public.profiles
for each row execute function public.protect_privileged_profile_update();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_owner boolean := lower(coalesce(new.email, '')) = 'k91372960@gmail.com';
  has_privacy_consent boolean := coalesce(new.raw_user_meta_data ->> 'privacy_consent', '') = 'true';
begin
  if not is_owner and not has_privacy_consent then
    raise exception 'privacy consent required';
  end if;

  insert into public.profiles (
    id,
    email,
    name,
    cohort,
    student_no,
    role,
    status,
    approved_at,
    privacy_consent_at,
    privacy_consent_version
  )
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), '이름 미입력'),
    coalesce(nullif(new.raw_user_meta_data ->> 'cohort', ''), '-'),
    coalesce(nullif(new.raw_user_meta_data ->> 'student_no', ''), '-'),
    case when is_owner then 'admin' else 'member' end,
    case when is_owner then 'approved' else 'pending' end,
    case when is_owner then now() else null end,
    case when has_privacy_consent then now() else null end,
    case
      when has_privacy_consent
        then nullif(new.raw_user_meta_data ->> 'privacy_consent_version', '')
      else null
    end
  )
  on conflict (id) do update
    set email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.accept_privacy_consent()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  accepted_at timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  update public.profiles
  set privacy_consent_at = accepted_at,
      privacy_consent_version = '2026-07-31-v1'
  where id = auth.uid();

  if not found then
    raise exception 'profile not found';
  end if;

  return accepted_at;
end;
$$;

create or replace function public.create_team(
  p_name text,
  p_song text,
  p_leader_id uuid,
  p_members jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_team_id uuid;
  member_row record;
begin
  if not public.is_approved(auth.uid()) then
    raise exception '승인된 사용자만 팀을 만들 수 있습니다.';
  end if;

  if not public.is_admin(auth.uid()) and p_leader_id <> auth.uid() then
    raise exception '팀장은 본인 계정만 지정할 수 있습니다.';
  end if;

  if not exists (select 1 from public.profiles where id = p_leader_id and status = 'approved' and role <> 'admin') then
    raise exception '승인된 일반 부원만 팀장으로 지정할 수 있습니다.';
  end if;

  insert into public.teams (name, song, color_index, created_by)
  values (
    trim(p_name),
    coalesce(nullif(trim(p_song), ''), '새 합주 준비'),
    floor(random() * 6)::integer,
    auth.uid()
  )
  returning id into new_team_id;

  insert into public.team_members (team_id, user_id, session, is_leader)
  values (
    new_team_id,
    p_leader_id,
    coalesce(nullif((p_members -> 0 ->> 'session'), ''), '보컬'),
    true
  )
  on conflict (team_id, user_id) do update
    set session = excluded.session,
        is_leader = true;

  for member_row in
    select *
    from jsonb_to_recordset(p_members) as x(user_id uuid, session text, is_leader boolean)
  loop
    if not exists (select 1 from public.profiles where id = member_row.user_id and status = 'approved' and role <> 'admin') then
      raise exception '승인된 일반 부원만 팀에 추가할 수 있습니다.';
    end if;

    insert into public.team_members (team_id, user_id, session, is_leader)
    values (
      new_team_id,
      member_row.user_id,
      member_row.session,
      coalesce(member_row.is_leader, false) or member_row.user_id = p_leader_id
    )
    on conflict (team_id, user_id) do update
      set session = excluded.session,
          is_leader = excluded.is_leader;
  end loop;

  insert into public.audit_logs (actor_id, action, target_type, target_id, reason)
  values (auth.uid(), 'create_team', 'team', new_team_id, trim(p_name));

  return new_team_id;
end;
$$;

create or replace function public.update_team(
  p_team_id uuid,
  p_name text,
  p_song text,
  p_leader_id uuid,
  p_members jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  member_row record;
  leader_session text := '보컬';
begin
  if not public.is_approved(auth.uid()) then
    raise exception '승인된 사용자만 팀을 수정할 수 있습니다.';
  end if;

  if not exists (select 1 from public.teams where id = p_team_id) then
    raise exception '팀을 찾을 수 없습니다.';
  end if;

  if not (public.is_admin(auth.uid()) or public.is_team_leader(p_team_id, auth.uid())) then
    raise exception '팀장 또는 관리자만 팀을 수정할 수 있습니다.';
  end if;

  if not public.is_admin(auth.uid()) and p_leader_id <> auth.uid() then
    raise exception '팀장은 본인 계정으로만 유지할 수 있습니다.';
  end if;

  if not exists (select 1 from public.profiles where id = p_leader_id and status = 'approved' and role <> 'admin') then
    raise exception '승인된 일반 부원만 팀장으로 지정할 수 있습니다.';
  end if;

  for member_row in
    select *
    from jsonb_to_recordset(p_members) as x(user_id uuid, session text, is_leader boolean)
  loop
    if member_row.user_id = p_leader_id then
      leader_session := coalesce(nullif(member_row.session, ''), '보컬');
    end if;

    if not exists (select 1 from public.profiles where id = member_row.user_id and status = 'approved' and role <> 'admin') then
      raise exception '승인된 일반 부원만 팀에 추가할 수 있습니다.';
    end if;
  end loop;

  update public.teams
  set name = trim(p_name),
      song = coalesce(nullif(trim(p_song), ''), '새 합주 준비')
  where id = p_team_id;

  delete from public.team_members
  where team_id = p_team_id;

  insert into public.team_members (team_id, user_id, session, is_leader)
  values (p_team_id, p_leader_id, leader_session, true);

  for member_row in
    select *
    from jsonb_to_recordset(p_members) as x(user_id uuid, session text, is_leader boolean)
  loop
    insert into public.team_members (team_id, user_id, session, is_leader)
    values (
      p_team_id,
      member_row.user_id,
      coalesce(nullif(member_row.session, ''), '보컬'),
      member_row.user_id = p_leader_id
    )
    on conflict (team_id, user_id) do update
      set session = excluded.session,
          is_leader = excluded.is_leader;
  end loop;

  insert into public.audit_logs (actor_id, action, target_type, target_id, reason)
  values (auth.uid(), 'update_team', 'team', p_team_id, trim(p_name));

  return p_team_id;
end;
$$;

create or replace function public.check_signup_duplicate(
  p_name text,
  p_student_no text
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'name_exists', exists (
      select 1
      from public.profiles
      where lower(trim(name)) = lower(trim(p_name))
    ),
    'student_no_exists', exists (
      select 1
      from public.profiles
      where trim(student_no) = trim(p_student_no)
    )
  );
$$;

create or replace function public.complete_password_reset()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Use the authenticated password reset API';
end;
$$;

create or replace function public.save_member_weekly_schedule(
  p_user_id uuid,
  p_slots jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  slot_row jsonb;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  if not public.is_approved(auth.uid())
    or not (public.is_admin(auth.uid()) or p_user_id = auth.uid()) then
    raise exception 'not allowed';
  end if;

  delete from public.member_schedules
  where user_id = p_user_id;

  for slot_row in
    select value from jsonb_array_elements(coalesce(p_slots, '[]'::jsonb))
  loop
    insert into public.member_schedules (user_id, day_of_week, start_time, updated_by)
    values (
      p_user_id,
      slot_row->>'day',
      slot_row->>'time',
      auth.uid()
    )
    on conflict (user_id, day_of_week, start_time) do nothing;
  end loop;
end;
$$;

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
  with tracking_window as (
    select coalesce(
      (select count_from_date from public.rehearsal_tracking_settings where id = 1),
      date '1970-01-01'
    ) as count_from_date
  ),
  slot_totals as (
    select
      bas.user_id,
      (count(*) * 0.5)::numeric as total_duration
    from public.booking_attendance_slots bas
    join public.bookings b on b.id = bas.booking_id
    cross join tracking_window tw
    where b.status = 'confirmed'
      and b.booking_type = 'rehearsal'
      and b.booking_date < current_date
      and b.booking_date >= tw.count_from_date
    group by bas.user_id
  ),
  member_totals as (
    select
      p.id as user_id,
      p.name,
      p.cohort,
      coalesce(slot_totals.total_duration, 0)::numeric as total_duration
    from public.profiles p
    left join slot_totals on slot_totals.user_id = p.id
    where p.role <> 'admin'
      and p.status = 'approved'
      and public.is_approved(auth.uid())
  )
  select
    member_totals.user_id,
    member_totals.name,
    member_totals.cohort,
    member_totals.total_duration,
    dense_rank() over (order by member_totals.total_duration desc) as rank
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
  with tracking_window as (
    select coalesce(
      (select count_from_date from public.rehearsal_tracking_settings where id = 1),
      date '1970-01-01'
    ) as count_from_date
  ),
  relevant_bookings as (
    select b.id, b.team_id, b.duration
    from public.bookings b
    cross join tracking_window tw
    where b.status = 'confirmed'
      and b.booking_type = 'rehearsal'
      and b.booking_date < current_date
      and b.booking_date >= tw.count_from_date
  ),
  booking_totals as (
    select relevant_bookings.team_id, sum(relevant_bookings.duration)::numeric as total_duration
    from relevant_bookings
    group by relevant_bookings.team_id
  ),
  roster_counts as (
    select br.booking_id, count(*) as member_count
    from public.booking_roster br
    join relevant_bookings rb on rb.id = br.booking_id
    group by br.booking_id
  ),
  full_team_slots as (
    select rb.team_id, bas.booking_id, bas.start_time
    from relevant_bookings rb
    join public.booking_attendance_slots bas on bas.booking_id = rb.id
    join roster_counts rc on rc.booking_id = rb.id
    group by rb.team_id, bas.booking_id, bas.start_time, rc.member_count
    having count(*) = rc.member_count and rc.member_count > 0
  ),
  full_team_totals as (
    select full_team_slots.team_id, (count(*) * 0.5)::numeric as total_session_duration
    from full_team_slots
    group by full_team_slots.team_id
  )
  select
    t.id as team_id,
    coalesce(booking_totals.total_duration, 0)::numeric as total_duration,
    coalesce(full_team_totals.total_session_duration, 0)::numeric as total_session_duration
  from public.teams t
  left join booking_totals on booking_totals.team_id = t.id
  left join full_team_totals on full_team_totals.team_id = t.id
  where public.is_approved(auth.uid())
  order by total_duration desc, t.name asc;
$$;

create or replace function public.reset_rehearsal_tracking()
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count_from_date date := current_date + 1;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception '최고 관리자만 합주시간을 초기화할 수 있습니다.';
  end if;

  insert into public.rehearsal_tracking_settings (id, count_from_date, updated_by, updated_at)
  values (1, next_count_from_date, auth.uid(), now())
  on conflict (id) do update
  set count_from_date = excluded.count_from_date,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;

  insert into public.audit_logs (actor_id, action, target_type, reason)
  values (auth.uid(), 'reset_rehearsal_tracking', 'rehearsal_tracking', '합주시간 누적 기준 초기화');

  return next_count_from_date;
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

  requested_start := split_part(p_start_time, ':', 1)::integer * 60 + split_part(p_start_time, ':', 2)::integer;

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
      and (split_part(start_time, ':', 1)::integer * 60 + split_part(start_time, ':', 2)::integer) + (duration * 60)::integer > requested_start
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

drop trigger if exists bookings_snapshot_attendance on public.bookings;
create trigger bookings_snapshot_attendance
after insert on public.bookings
for each row execute function public.snapshot_booking_attendance();

drop trigger if exists bookings_snapshot_roster on public.bookings;
create trigger bookings_snapshot_roster
after insert on public.bookings
for each row execute function public.snapshot_booking_roster();

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

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.rehearsal_goal_categories enable row level security;
alter table public.club_room_status enable row level security;
alter table public.team_members enable row level security;
alter table public.member_schedules enable row level security;
alter table public.member_schedule_date_slots enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_attendance enable row level security;
alter table public.booking_roster enable row level security;
alter table public.booking_attendance_slots enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_notification_logs enable row level security;
alter table public.audit_logs enable row level security;
alter table public.rehearsal_tracking_settings enable row level security;

create index if not exists team_members_user_id_team_id_idx
  on public.team_members (user_id, team_id);

create index if not exists bookings_confirmed_date_start_idx
  on public.bookings (booking_date, start_time)
  where status = 'confirmed';

create index if not exists bookings_team_rehearsal_date_idx
  on public.bookings (team_id, booking_date)
  where status = 'confirmed' and booking_type = 'rehearsal';

create index if not exists booking_attendance_slots_user_booking_idx
  on public.booking_attendance_slots (user_id, booking_id);

create unique index if not exists push_notification_logs_booking_once
on public.push_notification_logs (user_id, booking_id, kind)
where booking_id is not null;

create unique index if not exists push_notification_logs_daily_once
on public.push_notification_logs (user_id, notification_date, kind)
where booking_id is null;

create index if not exists push_subscriptions_user_id_idx
on public.push_subscriptions (user_id)
where disabled_at is null;

create unique index if not exists push_subscriptions_one_active_per_user
on public.push_subscriptions (user_id)
where disabled_at is null;

create index if not exists push_notification_logs_created_at_idx
on public.push_notification_logs (created_at);

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select"
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update"
on public.profiles
for update
to authenticated
using (public.is_super_admin(auth.uid()))
with check (public.is_super_admin(auth.uid()));

drop policy if exists "teams_select" on public.teams;
create policy "teams_select"
on public.teams
for select
to authenticated
using (public.is_approved(auth.uid()));

drop policy if exists "teams_admin_update" on public.teams;
create policy "teams_admin_update"
on public.teams
for update
to authenticated
using (false)
with check (false);

drop policy if exists "goal_categories_select" on public.rehearsal_goal_categories;
create policy "goal_categories_select"
on public.rehearsal_goal_categories
for select
to authenticated
using (public.is_approved(auth.uid()));

drop policy if exists "goal_categories_admin_insert" on public.rehearsal_goal_categories;
create policy "goal_categories_admin_insert"
on public.rehearsal_goal_categories
for insert
to authenticated
with check (public.is_admin(auth.uid()));

drop policy if exists "goal_categories_admin_delete" on public.rehearsal_goal_categories;
create policy "goal_categories_admin_delete"
on public.rehearsal_goal_categories
for delete
to authenticated
using (public.is_admin(auth.uid()));

drop policy if exists "club_room_status_select" on public.club_room_status;
create policy "club_room_status_select"
on public.club_room_status
for select
to authenticated
using (public.is_approved(auth.uid()));

drop policy if exists "club_room_status_approved_insert" on public.club_room_status;
create policy "club_room_status_approved_insert"
on public.club_room_status
for insert
to authenticated
with check (public.is_approved(auth.uid()));

drop policy if exists "club_room_status_approved_update" on public.club_room_status;
create policy "club_room_status_approved_update"
on public.club_room_status
for update
to authenticated
using (public.is_approved(auth.uid()))
with check (public.is_approved(auth.uid()));

drop policy if exists "team_members_select" on public.team_members;
create policy "team_members_select"
on public.team_members
for select
to authenticated
using (public.is_approved(auth.uid()));

drop policy if exists "team_members_admin_manage" on public.team_members;
create policy "team_members_admin_manage"
on public.team_members
for all
to authenticated
using (false)
with check (false);

drop policy if exists "schedules_require_approval" on public.member_schedules;
create policy "schedules_require_approval"
on public.member_schedules as restrictive for all to authenticated
using (public.is_approved(auth.uid()))
with check (public.is_approved(auth.uid()));

drop policy if exists "date_schedules_require_approval" on public.member_schedule_date_slots;
create policy "date_schedules_require_approval"
on public.member_schedule_date_slots as restrictive for all to authenticated
using (public.is_approved(auth.uid()))
with check (public.is_approved(auth.uid()));

drop policy if exists "schedules_select" on public.member_schedules;
create policy "schedules_select"
on public.member_schedules
for select
to authenticated
using (public.is_approved(auth.uid()) and public.can_view_member_schedule(user_id));

drop policy if exists "schedules_insert" on public.member_schedules;
create policy "schedules_insert"
on public.member_schedules
for insert
to authenticated
with check (public.is_admin(auth.uid()) or user_id = auth.uid());

drop policy if exists "schedules_update" on public.member_schedules;
create policy "schedules_update"
on public.member_schedules
for update
to authenticated
using (public.is_admin(auth.uid()) or user_id = auth.uid())
with check (public.is_admin(auth.uid()) or user_id = auth.uid());

drop policy if exists "schedules_delete" on public.member_schedules;
create policy "schedules_delete"
on public.member_schedules
for delete
to authenticated
using (public.is_admin(auth.uid()) or user_id = auth.uid());

drop policy if exists "date_schedules_select" on public.member_schedule_date_slots;
create policy "date_schedules_select"
on public.member_schedule_date_slots
for select
to authenticated
using (public.is_approved(auth.uid()) and public.can_view_member_schedule(user_id));

drop policy if exists "date_schedules_insert" on public.member_schedule_date_slots;
create policy "date_schedules_insert"
on public.member_schedule_date_slots
for insert
to authenticated
with check (public.is_admin(auth.uid()) or user_id = auth.uid());

drop policy if exists "date_schedules_update" on public.member_schedule_date_slots;
create policy "date_schedules_update"
on public.member_schedule_date_slots
for update
to authenticated
using (public.is_admin(auth.uid()) or user_id = auth.uid())
with check (public.is_admin(auth.uid()) or user_id = auth.uid());

drop policy if exists "date_schedules_delete" on public.member_schedule_date_slots;
create policy "date_schedules_delete"
on public.member_schedule_date_slots
for delete
to authenticated
using (public.is_admin(auth.uid()) or user_id = auth.uid());

drop policy if exists "bookings_select" on public.bookings;
create policy "bookings_select"
on public.bookings
for select
to authenticated
using (public.is_approved(auth.uid()));

drop policy if exists "bookings_insert" on public.bookings;
create policy "bookings_insert"
on public.bookings
for insert
to authenticated
with check (false);

drop policy if exists "bookings_update" on public.bookings;
create policy "bookings_update"
on public.bookings
for update
to authenticated
using (false)
with check (false);

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

drop policy if exists "push_subscriptions_select_self" on public.push_subscriptions;
create policy "push_subscriptions_select_self"
on public.push_subscriptions
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "push_subscriptions_insert_self" on public.push_subscriptions;
drop policy if exists "push_subscriptions_update_self" on public.push_subscriptions;
drop policy if exists "push_subscriptions_delete_self" on public.push_subscriptions;

drop policy if exists "push_notification_logs_select_admin" on public.push_notification_logs;
create policy "push_notification_logs_select_admin"
on public.push_notification_logs
for select
to authenticated
using (public.is_admin(auth.uid()));

drop policy if exists "audit_select_admin" on public.audit_logs;
create policy "audit_select_admin"
on public.audit_logs
for select
to authenticated
using (public.is_admin(auth.uid()));

drop policy if exists "audit_insert_admin" on public.audit_logs;

grant execute on function public.create_team(text, text, uuid, jsonb) to authenticated;
grant execute on function public.update_team(uuid, text, text, uuid, jsonb) to authenticated;
grant execute on function public.accept_privacy_consent() to authenticated;
revoke all on function public.complete_password_reset() from public, anon, authenticated;
grant execute on function public.save_member_weekly_schedule(uuid, jsonb) to authenticated;
grant execute on function public.get_rehearsal_leaderboard() to authenticated;
grant execute on function public.get_team_rehearsal_totals() to authenticated;
grant execute on function public.reset_rehearsal_tracking() to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.is_super_admin(uuid) to authenticated;
grant execute on function public.is_approved(uuid) to authenticated;
grant execute on function public.is_team_member(uuid, uuid) to authenticated;
grant execute on function public.is_team_leader(uuid, uuid) to authenticated;
grant execute on function public.can_view_member_schedule(uuid) to authenticated;
grant execute on function public.get_member_directory() to authenticated;
grant execute on function public.review_profile_signup(uuid, text) to authenticated;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.get_my_push_subscriptions() to authenticated;
grant execute on function public.disable_my_push_subscription(uuid) to authenticated;
grant execute on function public.claim_booking_push_targets(uuid, uuid[], text) to service_role;
grant execute on function public.create_booking(uuid, text, text, numeric, text, date) to authenticated;
grant execute on function public.create_booking(uuid, text, text, numeric, text, date, text) to authenticated;
grant execute on function public.create_bookings_with_location(uuid, text, date, text, jsonb) to authenticated;
grant execute on function public.create_room_blocks(text, date, text, jsonb) to authenticated;
grant execute on function public.get_push_subscription_status() to authenticated;
grant execute on function public.cancel_booking(uuid, text) to authenticated;
grant select, insert, update, delete on public.member_schedules to authenticated;
grant select, insert, update, delete on public.member_schedule_date_slots to authenticated;
grant select, insert on public.booking_attendance to authenticated;
grant select, insert on public.booking_roster to authenticated;
grant select, insert on public.booking_attendance_slots to authenticated;
grant select on public.push_subscriptions to authenticated;
grant select on public.push_notification_logs to authenticated;
revoke insert on public.audit_logs from authenticated;
revoke insert, update, delete on public.push_subscriptions from authenticated;
revoke insert, update, delete on public.teams from authenticated;
revoke insert, update, delete on public.team_members from authenticated;
revoke insert, update, delete on public.bookings from authenticated;

revoke all on function public.create_team(text, text, uuid, jsonb) from public;
revoke all on function public.update_team(uuid, text, text, uuid, jsonb) from public;
revoke all on function public.check_signup_duplicate(text, text) from public;
revoke all on function public.check_signup_duplicate(text, text) from anon, authenticated;
revoke all on function public.accept_privacy_consent() from public;
revoke all on function public.complete_password_reset() from public;
revoke all on function public.save_member_weekly_schedule(uuid, jsonb) from public;
revoke all on function public.get_rehearsal_leaderboard() from public;
revoke all on function public.get_team_rehearsal_totals() from public;
revoke all on function public.reset_rehearsal_tracking() from public;
revoke all on function public.is_admin(uuid) from public;
revoke all on function public.is_super_admin(uuid) from public;
revoke all on function public.is_approved(uuid) from public;
revoke all on function public.is_team_member(uuid, uuid) from public;
revoke all on function public.is_team_leader(uuid, uuid) from public;
revoke all on function public.can_view_member_schedule(uuid) from public;
revoke all on function public.is_member_available_for_booking(uuid, date, text, text, numeric)
  from public, anon, authenticated;
revoke all on function public.get_member_directory() from public;
revoke all on function public.review_profile_signup(uuid, text) from public;
revoke all on function public.save_push_subscription(text, text, text, text) from public;
revoke all on function public.get_my_push_subscriptions() from public;
revoke all on function public.disable_my_push_subscription(uuid) from public;
revoke all on function public.claim_booking_push_targets(uuid, uuid[], text) from public, anon, authenticated;
revoke all on function public.create_booking(uuid, text, text, numeric, text, date) from public;
revoke all on function public.create_booking(uuid, text, text, numeric, text, date, text) from public;
revoke all on function public.create_bookings_with_location(uuid, text, date, text, jsonb) from public;
revoke all on function public.create_room_blocks(text, date, text, jsonb) from public;
revoke all on function public.get_push_subscription_status() from public;
revoke all on function public.cancel_booking(uuid, text) from public;

grant usage on schema public to service_role;
grant select on table public.bookings to service_role;
grant select on table public.teams to service_role;
grant select on table public.team_members to service_role;
grant select, update on table public.push_subscriptions to service_role;
grant select, insert on table public.push_notification_logs to service_role;
grant select, insert, delete on public.rehearsal_goal_categories to authenticated;
grant select, insert, update on public.club_room_status to authenticated;

insert into public.rehearsal_goal_categories (name)
select distinct trim(song)
from public.teams
where nullif(trim(song), '') is not null
on conflict (name) do nothing;

insert into public.club_room_status (id, is_open)
values (1, false)
on conflict (id) do nothing;

insert into public.rehearsal_tracking_settings (id, count_from_date)
values (1, date '1970-01-01')
on conflict (id) do nothing;

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

insert into public.booking_roster (booking_id, user_id)
select bookings.id, team_members.user_id
from public.bookings
join public.team_members on team_members.team_id = bookings.team_id
where bookings.status = 'confirmed'
on conflict (booking_id, user_id) do nothing;

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

insert into public.profiles (
  id,
  email,
  name,
  cohort,
  student_no,
  role,
  status,
  approved_at
)
select
  id,
  email,
  coalesce(nullif(raw_user_meta_data ->> 'name', ''), '관리자'),
  coalesce(nullif(raw_user_meta_data ->> 'cohort', ''), '-'),
  coalesce(nullif(raw_user_meta_data ->> 'student_no', ''), '-'),
  'admin',
  'approved',
  now()
from auth.users
where lower(email) = 'k91372960@gmail.com'
on conflict (id) do update
  set role = 'admin',
      status = 'approved',
      approved_at = coalesce(public.profiles.approved_at, now());


create table if not exists public.member_recap_covers (
  user_id uuid not null references public.profiles(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  track_id bigint not null check (track_id > 0),
  track_name text not null check (char_length(track_name) between 1 and 200),
  artist_name text not null check (char_length(artist_name) between 1 and 200),
  artwork_url text not null check (
    char_length(artwork_url) <= 2048 and artwork_url ~ '^https://is[0-9]+(-ssl)?\.mzstatic\.com/'
  ),
  track_url text not null check (
    char_length(track_url) <= 2048 and track_url ~ '^https://(music|itunes)\.apple\.com/'
  ),
  primary key (user_id, team_id)
);

alter table public.member_recap_covers enable row level security;
drop policy if exists "recap_covers_select_self" on public.member_recap_covers;
create policy "recap_covers_select_self" on public.member_recap_covers for select to authenticated
using (user_id = auth.uid() and public.is_approved(auth.uid()));
drop policy if exists "recap_covers_insert_self" on public.member_recap_covers;
create policy "recap_covers_insert_self" on public.member_recap_covers for insert to authenticated
with check (user_id = auth.uid() and public.is_approved(auth.uid()) and exists (
  select 1 from public.booking_attendance_slots bas join public.bookings b on b.id = bas.booking_id
  where bas.user_id = auth.uid() and b.team_id = member_recap_covers.team_id
));
drop policy if exists "recap_covers_update_self" on public.member_recap_covers;
create policy "recap_covers_update_self" on public.member_recap_covers for update to authenticated
using (user_id = auth.uid() and public.is_approved(auth.uid()))
with check (user_id = auth.uid() and public.is_approved(auth.uid()) and exists (
  select 1 from public.booking_attendance_slots bas join public.bookings b on b.id = bas.booking_id
  where bas.user_id = auth.uid() and b.team_id = member_recap_covers.team_id
));
grant select, insert, update on public.member_recap_covers to authenticated;
revoke all on public.member_recap_covers from anon;

create index if not exists booking_attendance_slots_user_booking_idx
  on public.booking_attendance_slots (user_id, booking_id);

create or replace function public.get_my_rehearsal_recap(p_year integer default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_approved(auth.uid()) then
    raise exception 'approved account required';
  end if;
  if p_year is not null and (p_year < 2000 or p_year > extract(year from current_date)::integer + 1) then
    raise exception 'invalid recap year';
  end if;
  return (
    with personal_sessions as (
      select b.id, b.team_id, b.booking_date, b.purpose, count(*)::integer * 30 as minutes
      from public.booking_attendance_slots bas
      join public.bookings b on b.id = bas.booking_id
      where bas.user_id = auth.uid() and b.status = 'confirmed' and b.booking_type = 'rehearsal'
        and b.booking_date < current_date
      group by b.id, b.team_id, b.booking_date, b.purpose
    ),
    selected_sessions as (
      select * from personal_sessions
      where p_year is null or (booking_date >= make_date(p_year, 1, 1) and booking_date < make_date(p_year + 1, 1, 1))
    ),
    team_totals as (
      select team_id, sum(minutes) as minutes, count(*) as sessions,
        min(booking_date) as first_date, max(booking_date) as last_date,
        array_agg(distinct purpose order by purpose) as goals
      from selected_sessions group by team_id
    ),
    month_totals as (
      select to_char(booking_date, 'YYYY-MM') as month, sum(minutes) as minutes
      from selected_sessions group by to_char(booking_date, 'YYYY-MM')
    )
    select jsonb_build_object(
      'count_from_date', case when p_year is null then date '1970-01-01' else make_date(p_year, 1, 1) end,
      'years', coalesce((select jsonb_agg(year order by year desc) from (
        select distinct extract(year from booking_date)::integer as year from personal_sessions
      ) available_years), '[]'::jsonb),
      'goals', coalesce((select jsonb_agg(jsonb_build_object('name', goal_name, 'minutes', minutes, 'sessions', sessions) order by minutes desc, goal_name) from (
        select coalesce(nullif(trim(purpose), ''), '기타 합주') as goal_name, sum(minutes) as minutes, count(*) as sessions
        from selected_sessions group by coalesce(nullif(trim(purpose), ''), '기타 합주')
      ) goal_totals), '[]'::jsonb),
      'total_minutes', coalesce((select sum(minutes) from selected_sessions), 0),
      'sessions', (select count(*) from selected_sessions),
      'active_days', (select count(distinct booking_date) from selected_sessions),
      'teams', coalesce((select jsonb_agg(jsonb_build_object(
        'team_id', tt.team_id, 'team_name', t.name, 'minutes', tt.minutes, 'sessions', tt.sessions,
        'first_date', tt.first_date, 'last_date', tt.last_date, 'goals', tt.goals,
        'cover', case when c.track_id is null then null else jsonb_build_object(
          'track_id', c.track_id, 'track_name', c.track_name, 'artist_name', c.artist_name,
          'artwork_url', c.artwork_url, 'track_url', c.track_url
        ) end
      ) order by tt.minutes desc, t.name asc)
      from team_totals tt join public.teams t on t.id = tt.team_id
      left join public.member_recap_covers c on c.team_id = tt.team_id and c.user_id = auth.uid()), '[]'::jsonb),
      'months', coalesce((select jsonb_agg(jsonb_build_object('month', month, 'minutes', minutes) order by month)
        from month_totals), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.get_my_team_rehearsal_sessions(
  p_team_id uuid, p_year integer default null, p_offset integer default 0
)
returns table (
  booking_id uuid, booking_date date, start_time text, duration numeric,
  participated_minutes integer, purpose text, booking_location text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_approved(auth.uid()) then
    raise exception 'approved account required';
  end if;
  if p_offset < 0 or p_offset > 50000 or p_offset is null then raise exception 'invalid offset'; end if;
  if p_year is not null and (p_year < 2000 or p_year > extract(year from current_date)::integer + 1) then
    raise exception 'invalid recap year';
  end if;
  return query
  select b.id, b.booking_date, b.start_time, b.duration, count(*)::integer * 30, b.purpose, b.booking_location
  from public.booking_attendance_slots bas join public.bookings b on b.id = bas.booking_id
  where bas.user_id = auth.uid() and b.team_id = p_team_id and b.status = 'confirmed'
    and b.booking_type = 'rehearsal' and b.booking_date < current_date
    and (p_year is null or (b.booking_date >= make_date(p_year, 1, 1) and b.booking_date < make_date(p_year + 1, 1, 1)))
  group by b.id, b.booking_date, b.start_time, b.duration, b.purpose, b.booking_location
  order by b.booking_date desc, b.start_time desc, b.id desc limit 25 offset p_offset;
end;
$$;

revoke all on function public.get_my_rehearsal_recap(integer) from public, anon;
revoke all on function public.get_my_team_rehearsal_sessions(uuid, integer, integer) from public, anon;
grant execute on function public.get_my_rehearsal_recap(integer) to authenticated;
grant execute on function public.get_my_team_rehearsal_sessions(uuid, integer, integer) to authenticated;

commit;

-- Historical Notion rehearsals supplement recap only. Ordinary bookings, attendance
-- snapshots, availability, booking validation and leaderboard resets remain intact.
begin;

create table if not exists public.historical_rehearsal_team_sources (
  batch_key text not null,
  goal text not null,
  team_name text not null,
  team_id uuid not null references public.teams(id) on delete cascade,
  created_by_import boolean not null default false,
  primary key(batch_key,goal,team_name)
);
create table if not exists public.historical_rehearsal_roster (
  team_id uuid not null references public.teams(id) on delete cascade,
  member_name text not null,
  session text not null,
  user_id uuid references public.profiles(id) on delete set null,
  primary key(team_id,member_name)
);
create table if not exists public.historical_rehearsal_sessions (
  id uuid primary key,
  source_id text not null,
  source_url text not null,
  team_id uuid not null references public.teams(id) on delete cascade,
  booking_date date not null,
  start_time text not null check(start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  duration_minutes integer not null check(duration_minutes between 1 and 1440),
  credited_minutes integer not null check(credited_minutes > 0 and credited_minutes <= duration_minutes),
  purpose text not null,
  note text not null,
  created_at timestamptz not null default now(),
  unique(source_id,team_id)
);
create index if not exists historical_roster_user_idx on public.historical_rehearsal_roster(user_id,team_id);
create index if not exists historical_sessions_team_date_idx on public.historical_rehearsal_sessions(team_id,booking_date);

alter table public.historical_rehearsal_team_sources enable row level security;
alter table public.historical_rehearsal_roster enable row level security;
alter table public.historical_rehearsal_sessions enable row level security;
revoke all on public.historical_rehearsal_team_sources,public.historical_rehearsal_roster,public.historical_rehearsal_sessions from anon,authenticated;
grant select on public.historical_rehearsal_roster,public.historical_rehearsal_sessions to authenticated;
drop policy if exists historical_roster_self on public.historical_rehearsal_roster;
create policy historical_roster_self on public.historical_rehearsal_roster for select to authenticated
  using(user_id=auth.uid() and public.is_approved(auth.uid()));
drop policy if exists historical_sessions_self on public.historical_rehearsal_sessions;
create policy historical_sessions_self on public.historical_rehearsal_sessions for select to authenticated
  using(public.is_approved(auth.uid()) and exists(select 1 from public.historical_rehearsal_roster r where r.team_id=historical_rehearsal_sessions.team_id and r.user_id=auth.uid()));

-- Import is callable only from the SQL Editor / privileged service role. No client
-- is allowed to invent historical credit, edit other members, or bypass booking rules.
create or replace function public.import_rehearsal_history(p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare t jsonb; r jsonb; s jsonb; tid uuid; mapped uuid; profile_count integer;
  created_new boolean; batch text; target_name text; new_teams integer := 0;
begin
  if jsonb_typeof(p_payload->'teams') <> 'array' or jsonb_typeof(p_payload->'sessions') <> 'array'
     or jsonb_array_length(p_payload->'teams') > 100 or jsonb_array_length(p_payload->'sessions') > 2000
     or p_payload->>'source_url' not like 'https://app.notion.com/%' then raise exception 'Invalid historical payload'; end if;
  batch := p_payload->>'source_url';
  perform pg_advisory_xact_lock(hashtext('rehearsal-history:'||batch));
  insert into public.rehearsal_goal_categories(name) values('봄공연'),('대동제') on conflict(name) do nothing;
  for t in select value from jsonb_array_elements(p_payload->'teams') loop
    if char_length(trim(t->>'name')) not between 1 and 100 or t->>'goal' not in('봄공연','대동제')
      or jsonb_typeof(t->'roster')<>'array' or jsonb_array_length(t->'roster')>100 then raise exception 'Invalid historical team'; end if;
    select m.team_id,m.created_by_import into tid,created_new from public.historical_rehearsal_team_sources m
      where m.batch_key=batch and m.goal=t->>'goal' and m.team_name=t->>'name';
    if tid is null then
      target_name := case when t->>'kind'='ensemble' then '전체합주 · '||(t->>'goal')||' 2026' else t->>'name' end;
      select id into tid from public.teams where name=target_name and song=t->>'goal';
      created_new := false;
      if tid is null then
        if exists(select 1 from public.teams where name=target_name) then target_name:=target_name||' · '||(t->>'goal')||' 2026'; end if;
        select id into tid from public.teams where name=target_name and song=t->>'goal';
        if tid is null then
          insert into public.teams(name,song,color_index) values(target_name,t->>'goal',new_teams%8) returning id into tid;
          created_new:=true; new_teams:=new_teams+1;
        end if;
      end if;
      insert into public.historical_rehearsal_team_sources values(batch,t->>'goal',t->>'name',tid,created_new);
    end if;
    for r in select value from jsonb_array_elements(t->'roster') loop
      if char_length(trim(r->>'name')) not between 1 and 100
        or r->>'session' not in('보컬','리드기타','리듬기타','어쿠스틱','베이스','드럼','피아노','신디') then raise exception 'Invalid roster'; end if;
      select count(*) into profile_count from public.profiles p where trim(p.name)=trim(r->>'name') and p.status='approved';
      mapped:=null;
      if profile_count=1 then select p.id into mapped from public.profiles p where trim(p.name)=trim(r->>'name') and p.status='approved'; end if;
      insert into public.historical_rehearsal_roster(team_id,member_name,session,user_id) values(tid,r->>'name',r->>'session',mapped)
        on conflict(team_id,member_name) do update set user_id=coalesce(historical_rehearsal_roster.user_id,excluded.user_id);
      -- Do not rewrite a pre-existing team's current roster or assign a guessed leader.
      if created_new and t->>'kind'='song' and mapped is not null then
        insert into public.team_members(team_id,user_id,session,is_leader) values(tid,mapped,r->>'session',false) on conflict do nothing;
      end if;
    end loop;
  end loop;
  for s in select value from jsonb_array_elements(p_payload->'sessions') loop
    select m.team_id into tid from public.historical_rehearsal_team_sources m
      where m.batch_key=batch and m.goal=s->>'purpose' and m.team_name=s->>'team_name';
    if tid is null or (s->>'booking_date')::date >= (now() at time zone 'Asia/Seoul')::date then raise exception 'Invalid historical session'; end if;
    insert into public.historical_rehearsal_sessions(id,source_id,source_url,team_id,booking_date,start_time,duration_minutes,credited_minutes,purpose,note)
      values((s->>'id')::uuid,s->>'source_id','https://app.notion.com/p/'||replace(s->>'source_id','-',''),tid,
        (s->>'booking_date')::date,s->>'start_time',(s->>'duration_minutes')::integer,(s->>'credited_minutes')::integer,s->>'purpose',s->>'note')
      on conflict(id) do nothing;
  end loop;
  return jsonb_build_object('created_teams',new_teams,
    'history_sessions',(select count(*) from public.historical_rehearsal_sessions h join public.historical_rehearsal_team_sources m on m.team_id=h.team_id where m.batch_key=batch),
    'unresolved_names',coalesce((select jsonb_agg(member_name order by member_name) from (
      select distinct r.member_name from public.historical_rehearsal_roster r join public.historical_rehearsal_team_sources m on m.team_id=r.team_id
      where m.batch_key=batch and r.user_id is null) x),'[]'::jsonb));
end;
$$;
revoke all on function public.import_rehearsal_history(jsonb) from public,anon,authenticated;
grant execute on function public.import_rehearsal_history(jsonb) to service_role;

create or replace function public.get_my_rehearsal_recap(p_year integer default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_approved(auth.uid()) then
    raise exception 'approved account required';
  end if;
  if p_year is not null and (p_year < 2000 or p_year > extract(year from current_date)::integer + 1) then
    raise exception 'invalid recap year';
  end if;
  return (
    with personal_sessions as (
      select b.id, b.team_id, b.booking_date, b.purpose, count(*)::integer * 30 as minutes
      from public.booking_attendance_slots bas
      join public.bookings b on b.id = bas.booking_id
      where bas.user_id = auth.uid() and b.status = 'confirmed' and b.booking_type = 'rehearsal'
        and b.booking_date < current_date
      group by b.id, b.team_id, b.booking_date, b.purpose
      union all
      select h.id,h.team_id,h.booking_date,h.purpose,h.credited_minutes
      from public.historical_rehearsal_sessions h
      join public.historical_rehearsal_roster r on r.team_id=h.team_id and r.user_id=auth.uid()
      where h.booking_date < (now() at time zone 'Asia/Seoul')::date
        and not exists(select 1 from public.bookings existing where existing.team_id=h.team_id
          and existing.booking_date=h.booking_date and existing.start_time=h.start_time
          and existing.booking_type='rehearsal')
    ),
    selected_sessions as (
      select * from personal_sessions
      where p_year is null or (booking_date >= make_date(p_year, 1, 1) and booking_date < make_date(p_year + 1, 1, 1))
    ),
    team_totals as (
      select team_id, sum(minutes) as minutes, count(*) as sessions,
        min(booking_date) as first_date, max(booking_date) as last_date,
        array_agg(distinct purpose order by purpose) as goals
      from selected_sessions group by team_id
    ),
    month_totals as (
      select to_char(booking_date, 'YYYY-MM') as month, sum(minutes) as minutes
      from selected_sessions group by to_char(booking_date, 'YYYY-MM')
    )
    select jsonb_build_object(
      'count_from_date', case when p_year is null then date '1970-01-01' else make_date(p_year, 1, 1) end,
      'years', coalesce((select jsonb_agg(year order by year desc) from (
        select distinct extract(year from booking_date)::integer as year from personal_sessions
      ) available_years), '[]'::jsonb),
      'goals', coalesce((select jsonb_agg(jsonb_build_object('name', goal_name, 'minutes', minutes, 'sessions', sessions) order by minutes desc, goal_name) from (
        select coalesce(nullif(trim(purpose), ''), '기타 합주') as goal_name, sum(minutes) as minutes, count(*) as sessions
        from selected_sessions group by coalesce(nullif(trim(purpose), ''), '기타 합주')
      ) goal_totals), '[]'::jsonb),
      'historical_sessions', (select count(*) from selected_sessions s join public.historical_rehearsal_sessions h on h.id=s.id),
      'total_minutes', coalesce((select sum(minutes) from selected_sessions), 0),
      'sessions', (select count(*) from selected_sessions),
      'active_days', (select count(distinct booking_date) from selected_sessions),
      'teams', coalesce((select jsonb_agg(jsonb_build_object(
        'team_id', tt.team_id, 'team_name', t.name, 'minutes', tt.minutes, 'sessions', tt.sessions,
        'first_date', tt.first_date, 'last_date', tt.last_date, 'goals', tt.goals,
        'cover', case when c.track_id is null then null else jsonb_build_object(
          'track_id', c.track_id, 'track_name', c.track_name, 'artist_name', c.artist_name,
          'artwork_url', c.artwork_url, 'track_url', c.track_url
        ) end
      ) order by tt.minutes desc, t.name asc)
      from team_totals tt join public.teams t on t.id = tt.team_id
      left join public.member_recap_covers c on c.team_id = tt.team_id and c.user_id = auth.uid()), '[]'::jsonb),
      'months', coalesce((select jsonb_agg(jsonb_build_object('month', month, 'minutes', minutes) order by month)
        from month_totals), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.get_my_team_rehearsal_sessions(
  p_team_id uuid, p_year integer default null, p_offset integer default 0
)
returns table (
  booking_id uuid, booking_date date, start_time text, duration numeric,
  participated_minutes integer, purpose text, booking_location text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_approved(auth.uid()) then
    raise exception 'approved account required';
  end if;
  if p_offset < 0 or p_offset > 50000 or p_offset is null then raise exception 'invalid offset'; end if;
  if p_year is not null and (p_year < 2000 or p_year > extract(year from current_date)::integer + 1) then
    raise exception 'invalid recap year';
  end if;
  return query
  select combined.* from (
    select b.id,b.booking_date,b.start_time,b.duration,count(*)::integer*30 as participated_minutes,b.purpose,b.booking_location
    from public.booking_attendance_slots bas join public.bookings b on b.id=bas.booking_id
    where bas.user_id=auth.uid() and b.team_id=p_team_id and b.status='confirmed' and b.booking_type='rehearsal'
      and b.booking_date < current_date
      and (p_year is null or (b.booking_date >= make_date(p_year,1,1) and b.booking_date < make_date(p_year+1,1,1)))
    group by b.id,b.booking_date,b.start_time,b.duration,b.purpose,b.booking_location
    union all
    select h.id,h.booking_date,h.start_time,h.duration_minutes/60.0,h.credited_minutes,h.purpose,'notion_history'::text
    from public.historical_rehearsal_sessions h join public.historical_rehearsal_roster r on r.team_id=h.team_id and r.user_id=auth.uid()
    where h.team_id=p_team_id and h.booking_date < (now() at time zone 'Asia/Seoul')::date
      and (p_year is null or (h.booking_date >= make_date(p_year,1,1) and h.booking_date < make_date(p_year+1,1,1)))
      and not exists(select 1 from public.bookings existing where existing.team_id=h.team_id and existing.booking_date=h.booking_date
        and existing.start_time=h.start_time and existing.booking_type='rehearsal')
  ) combined order by combined.booking_date desc,combined.start_time desc,combined.id desc limit 25 offset p_offset;
end;
$$;

revoke all on function public.get_my_rehearsal_recap(integer) from public, anon;
revoke all on function public.get_my_team_rehearsal_sessions(uuid, integer, integer) from public, anon;
grant execute on function public.get_my_rehearsal_recap(integer) to authenticated;
grant execute on function public.get_my_team_rehearsal_sessions(uuid, integer, integer) to authenticated;



create or replace function public.get_rehearsal_calendar(p_start date,p_end date)
returns table(booking_id uuid,team_id uuid,team_name text,goal text,booking_date date,start_time text,
  duration numeric,booking_location text,status text,booking_type text,source_type text,credited_minutes integer,is_own_team boolean)
language plpgsql stable security definer set search_path=public as $$
begin
  if auth.uid() is null or not public.is_approved(auth.uid()) then raise exception 'approved account required'; end if;
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>62 or p_start<date '2000-01-01' then raise exception 'invalid calendar range'; end if;
  return query
  select c.* from (
    select b.id,b.team_id,coalesce(t.name,'사용 제한'),b.purpose,b.booking_date,b.start_time,b.duration,b.booking_location,
      b.status,b.booking_type,'booking'::text,null::integer,
      (exists(select 1 from public.team_members m where m.team_id=b.team_id and m.user_id=auth.uid())
        or exists(select 1 from public.booking_roster br where br.booking_id=b.id and br.user_id=auth.uid()))
    from public.bookings b left join public.teams t on t.id=b.team_id
    where b.status='confirmed' and b.booking_date between p_start and p_end
    union all
    select h.id,h.team_id,t.name,h.purpose,h.booking_date,h.start_time,h.duration_minutes/60.0,'club_room'::text,
      'confirmed'::text,'rehearsal'::text,'notion_history'::text,h.credited_minutes,
      exists(select 1 from public.historical_rehearsal_roster r where r.team_id=h.team_id and r.user_id=auth.uid())
    from public.historical_rehearsal_sessions h join public.teams t on t.id=h.team_id
    where h.booking_date between p_start and p_end
      and not exists(select 1 from public.bookings existing where existing.team_id=h.team_id and existing.booking_date=h.booking_date
        and existing.start_time=h.start_time and existing.booking_type='rehearsal')
  ) c order by c.booking_date,c.start_time,c.id;
end;
$$;
revoke all on function public.get_rehearsal_calendar(date,date) from public,anon;
grant execute on function public.get_rehearsal_calendar(date,date) to authenticated;


drop policy if exists recap_covers_insert_self on public.member_recap_covers;
create policy recap_covers_insert_self on public.member_recap_covers for insert to authenticated
with check(user_id=auth.uid() and public.is_approved(auth.uid()) and (
  exists(select 1 from public.booking_attendance_slots bas join public.bookings b on b.id=bas.booking_id where bas.user_id=auth.uid() and b.team_id=member_recap_covers.team_id)
  or exists(select 1 from public.historical_rehearsal_roster r join public.historical_rehearsal_sessions h on h.team_id=r.team_id where r.user_id=auth.uid() and h.team_id=member_recap_covers.team_id)
));
drop policy if exists recap_covers_update_self on public.member_recap_covers;
create policy recap_covers_update_self on public.member_recap_covers for update to authenticated
using(user_id=auth.uid() and public.is_approved(auth.uid()))
with check(user_id=auth.uid() and public.is_approved(auth.uid()) and (
  exists(select 1 from public.booking_attendance_slots bas join public.bookings b on b.id=bas.booking_id where bas.user_id=auth.uid() and b.team_id=member_recap_covers.team_id)
  or exists(select 1 from public.historical_rehearsal_roster r join public.historical_rehearsal_sessions h on h.team_id=r.team_id where r.user_id=auth.uid() and h.team_id=member_recap_covers.team_id)
));
commit;
