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
  role text not null default 'member' check (role in ('member', 'admin')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'suspended')),
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

create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  session text not null check (session in ('보컬', '리드기타', '세컨기타', '어쿠스틱', '드럼', '피아노', '신디')),
  is_leader boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists public.member_schedules (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day_of_week text not null check (day_of_week in ('월', '화', '수', '목', '금', '토')),
  start_time text not null check (start_time in ('15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00')),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (user_id, day_of_week, start_time)
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  day_of_week text not null check (day_of_week in ('월', '화', '수', '목', '금', '토')),
  start_time text not null check (start_time in ('15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00')),
  duration integer not null check (duration in (1, 2)),
  purpose text not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_by uuid references public.profiles(id),
  cancelled_by uuid references public.profiles(id),
  cancel_reason text,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create table if not exists public.news_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  tag text not null default '공지',
  created_by uuid references public.profiles(id),
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

  if not exists (select 1 from public.profiles where id = p_leader_id and status = 'approved') then
    raise exception '승인된 팀장을 선택해 주세요.';
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
    if not exists (select 1 from public.profiles where id = member_row.user_id and status = 'approved') then
      raise exception '승인되지 않은 사용자는 팀에 추가할 수 없습니다.';
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

  if p_start_time not in ('15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00') then
    raise exception '예약 시간이 올바르지 않습니다.';
  end if;

  if p_duration not in (1, 2) then
    raise exception '예약 길이는 1시간 또는 2시간이어야 합니다.';
  end if;

  requested_start := split_part(p_start_time, ':', 1)::integer;
  requested_end := requested_start + p_duration;

  if requested_end > 22 then
    raise exception '22시 이후로 끝나는 예약은 만들 수 없습니다.';
  end if;

  if exists (
    select 1
    from public.bookings
    where day_of_week = p_day
      and status = 'confirmed'
      and split_part(start_time, ':', 1)::integer < requested_end
      and split_part(start_time, ':', 1)::integer + duration > requested_start
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
alter table public.team_members enable row level security;
alter table public.member_schedules enable row level security;
alter table public.bookings enable row level security;
alter table public.news_items enable row level security;
alter table public.audit_logs enable row level security;

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

drop policy if exists "schedules_delete" on public.member_schedules;
create policy "schedules_delete"
on public.member_schedules
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

drop policy if exists "news_select" on public.news_items;
create policy "news_select"
on public.news_items
for select
to authenticated
using (public.is_approved(auth.uid()));

drop policy if exists "news_admin_manage" on public.news_items;
create policy "news_admin_manage"
on public.news_items
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

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
grant execute on function public.create_booking(uuid, text, text, integer, text) to authenticated;
grant execute on function public.cancel_booking(uuid, text) to authenticated;

insert into public.news_items (title, body, tag)
select '금요일까지 축제 셋리스트 제출', '팀장은 최종 곡명, 러닝타임, 필요한 장비를 함께 등록해 주세요.', '공지'
where not exists (select 1 from public.news_items);

insert into public.news_items (title, body, tag)
select '드럼 페달 교체 완료', '새 페달은 A룸에 보관됩니다. 합주 후 장력은 기본값으로 돌려주세요.', '장비'
where not exists (select 1 from public.news_items where title = '드럼 페달 교체 완료');

insert into public.news_items (title, body, tag)
select '신입부원 잼데이', '토요일 15시에 자유 합주가 열립니다. 예약 없는 팀도 참관 가능합니다.', '행사'
where not exists (select 1 from public.news_items where title = '신입부원 잼데이');

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
