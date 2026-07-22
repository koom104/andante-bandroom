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
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id)
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  song text not null default '새 합주 준비',
  color_index integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rehearsal_goal_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.club_room_status (
  id integer primary key default 1 check (id = 1),
  is_open boolean not null default false,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
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
    coalesce(p_user_agent, ''),
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

create or replace function public.get_booking_push_targets(p_booking_ids uuid[])
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
stable
security definer
set search_path = public
as $$
  with allowed_bookings as (
    select b.*
    from public.bookings b
    where b.id = any(p_booking_ids)
      and public.is_approved(auth.uid())
      and (
        public.is_admin(auth.uid())
        or public.is_team_member(b.team_id, auth.uid())
      )
  )
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
   and ps.disabled_at is null;
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

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_owner boolean := lower(coalesce(new.email, '')) = 'k91372960@gmail.com';
begin
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
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), '이름 미입력'),
    coalesce(nullif(new.raw_user_meta_data ->> 'cohort', ''), '-'),
    coalesce(nullif(new.raw_user_meta_data ->> 'student_no', ''), '-'),
    case when is_owner then 'admin' else 'member' end,
    case when is_owner then 'approved' else 'pending' end,
    case when is_owner then now() else null end
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
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  update public.profiles
  set password_reset_required = false
  where id = auth.uid();
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

  if not (public.is_admin(auth.uid()) or p_user_id = auth.uid()) then
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
      and b.booking_date >= coalesce(
        (select count_from_date from public.rehearsal_tracking_settings where id = 1),
        date '1970-01-01'
      )
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
        and b.booking_date >= coalesce(
          (select count_from_date from public.rehearsal_tracking_settings where id = 1),
          date '1970-01-01'
        )
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
          and b.booking_date >= coalesce(
            (select count_from_date from public.rehearsal_tracking_settings where id = 1),
            date '1970-01-01'
          )
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
  p_booking_date date default null
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

  if exists (
    select 1
    from public.bookings
    where day_of_week = p_day
      and status = 'confirmed'
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
    created_by
  )
  values (
    p_team_id,
    p_booking_date,
    p_day,
    p_start_time,
    p_duration,
    coalesce(nullif(trim(p_purpose), ''), '합주 예약'),
    auth.uid()
  )
  returning id into new_booking_id;

  insert into public.audit_logs (actor_id, action, target_type, target_id, reason)
  values (auth.uid(), 'create_booking', 'booking', new_booking_id, coalesce(p_booking_date::text, p_day) || ' ' || p_start_time);

  return new_booking_id;
end;
$$;

create or replace function public.create_bookings(
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
begin
  if p_groups is null or jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) = 0 then
    raise exception '예약할 시간대가 없습니다.';
  end if;

  for group_item in select value from jsonb_array_elements(p_groups)
  loop
    group_start_time := group_item->>'start_time';
    group_duration := (group_item->>'duration')::numeric;

    new_booking_id := public.create_booking(
      p_team_id,
      p_day,
      group_start_time,
      group_duration,
      p_purpose,
      p_booking_date
    );
    new_booking_ids := array_append(new_booking_ids, new_booking_id);
  end loop;

  return new_booking_ids;
end;
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

  if not (public.is_admin(auth.uid()) or public.is_team_leader(target_booking.team_id, auth.uid())) then
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
using (id = auth.uid() or public.is_approved(auth.uid()) or public.is_admin(auth.uid()));

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
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

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
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

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
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists "schedules_select" on public.member_schedules;
create policy "schedules_select"
on public.member_schedules
for select
to authenticated
using (public.is_approved(auth.uid()));

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
using (public.is_approved(auth.uid()));

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
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

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
using (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "push_subscriptions_insert_self" on public.push_subscriptions;
create policy "push_subscriptions_insert_self"
on public.push_subscriptions
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "push_subscriptions_update_self" on public.push_subscriptions;
create policy "push_subscriptions_update_self"
on public.push_subscriptions
for update
to authenticated
using (user_id = auth.uid() or public.is_admin(auth.uid()))
with check (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "push_subscriptions_delete_self" on public.push_subscriptions;
create policy "push_subscriptions_delete_self"
on public.push_subscriptions
for delete
to authenticated
using (user_id = auth.uid() or public.is_admin(auth.uid()));

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
create policy "audit_insert_admin"
on public.audit_logs
for insert
to authenticated
with check (public.is_admin(auth.uid()) or actor_id = auth.uid());

grant execute on function public.create_team(text, text, uuid, jsonb) to authenticated;
grant execute on function public.update_team(uuid, text, text, uuid, jsonb) to authenticated;
grant execute on function public.check_signup_duplicate(text, text) to anon, authenticated;
grant execute on function public.complete_password_reset() to authenticated;
grant execute on function public.save_member_weekly_schedule(uuid, jsonb) to authenticated;
grant execute on function public.get_rehearsal_leaderboard() to authenticated;
grant execute on function public.get_team_rehearsal_totals() to authenticated;
grant execute on function public.reset_rehearsal_tracking() to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.is_super_admin(uuid) to authenticated;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.get_my_push_subscriptions() to authenticated;
grant execute on function public.disable_my_push_subscription(uuid) to authenticated;
grant execute on function public.get_booking_push_targets(uuid[]) to authenticated;
grant execute on function public.create_booking(uuid, text, text, numeric, text, date) to authenticated;
grant execute on function public.create_bookings(uuid, text, date, text, jsonb) to authenticated;
grant execute on function public.cancel_booking(uuid, text) to authenticated;
grant select, insert, update, delete on public.member_schedules to authenticated;
grant select, insert, update, delete on public.member_schedule_date_slots to authenticated;
grant select, insert on public.booking_attendance to authenticated;
grant select, insert on public.booking_roster to authenticated;
grant select, insert on public.booking_attendance_slots to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.push_notification_logs to authenticated;

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

commit;
