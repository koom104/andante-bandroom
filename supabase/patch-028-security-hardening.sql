-- Security hardening for push delivery, privileged profiles, and audit logs.
-- Run once in Supabase Dashboard > SQL Editor.

begin;

alter table public.profiles
  drop constraint if exists profiles_identity_length_check;
alter table public.profiles
  add constraint profiles_identity_length_check check (
    char_length(trim(email)) between 3 and 320
    and char_length(trim(name)) between 1 and 100
    and char_length(trim(cohort)) between 1 and 20
    and char_length(trim(student_no)) between 1 and 30
  ) not valid;

alter table public.teams
  drop constraint if exists teams_text_length_check;
alter table public.teams
  add constraint teams_text_length_check check (
    char_length(trim(name)) between 1 and 100
    and char_length(trim(song)) between 1 and 100
  ) not valid;

alter table public.rehearsal_goal_categories
  drop constraint if exists rehearsal_goal_categories_name_length_check;
alter table public.rehearsal_goal_categories
  add constraint rehearsal_goal_categories_name_length_check check (
    char_length(trim(name)) between 1 and 100
  ) not valid;

alter table public.bookings
  drop constraint if exists bookings_text_length_check;
alter table public.bookings
  add constraint bookings_text_length_check check (
    char_length(trim(purpose)) between 1 and 120
    and char_length(coalesce(cancel_reason, '')) <= 300
  ) not valid;

alter table public.audit_logs
  drop constraint if exists audit_logs_text_length_check;
alter table public.audit_logs
  add constraint audit_logs_text_length_check check (
    char_length(action) between 1 and 100
    and char_length(target_type) between 1 and 100
    and char_length(coalesce(reason, '')) <= 500
  ) not valid;

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

  perform pg_advisory_xact_lock(hashtext('booking:' || new.booking_date::text));

  if new.status = 'confirmed' and exists (
    select 1
    from public.bookings b
    where b.status = 'confirmed'
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

drop function if exists public.get_booking_push_targets(uuid[]);

create or replace function public.claim_booking_push_targets(
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
      and public.is_approved(auth.uid())
      and (
        public.is_admin(auth.uid())
        or public.is_team_leader(b.team_id, auth.uid())
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

drop trigger if exists protect_privileged_profile_update_trigger on public.profiles;
create trigger protect_privileged_profile_update_trigger
before update on public.profiles
for each row execute function public.protect_privileged_profile_update();

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
      and public.is_approved(auth.uid())
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

create or replace function public.get_team_rehearsal_totals()
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
  where public.is_approved(auth.uid())
  order by total_duration desc, t.name asc;
$$;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select"
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update"
on public.profiles
for update
to authenticated
using (public.is_super_admin(auth.uid()))
with check (public.is_super_admin(auth.uid()));

drop policy if exists "teams_admin_update" on public.teams;
create policy "teams_admin_update"
on public.teams
for update
to authenticated
using (false)
with check (false);

drop policy if exists "team_members_admin_manage" on public.team_members;
create policy "team_members_admin_manage"
on public.team_members
for all
to authenticated
using (false)
with check (false);

drop policy if exists "bookings_update" on public.bookings;
create policy "bookings_update"
on public.bookings
for update
to authenticated
using (false)
with check (false);

drop policy if exists "audit_insert_admin" on public.audit_logs;
revoke insert on public.audit_logs from authenticated;

drop policy if exists "push_subscriptions_insert_self" on public.push_subscriptions;
drop policy if exists "push_subscriptions_update_self" on public.push_subscriptions;
drop policy if exists "push_subscriptions_delete_self" on public.push_subscriptions;
revoke insert, update, delete on public.push_subscriptions from authenticated;
revoke insert, update, delete on public.teams from authenticated;
revoke insert, update, delete on public.team_members from authenticated;
revoke insert, update, delete on public.bookings from authenticated;

drop policy if exists "push_subscriptions_select_self" on public.push_subscriptions;
create policy "push_subscriptions_select_self"
on public.push_subscriptions
for select
to authenticated
using (user_id = auth.uid());

revoke all on function public.save_push_subscription(text, text, text, text) from public;
revoke all on function public.claim_booking_push_targets(uuid[], text) from public;
revoke all on function public.create_team(text, text, uuid, jsonb) from public;
revoke all on function public.update_team(uuid, text, text, uuid, jsonb) from public;
revoke all on function public.check_signup_duplicate(text, text) from public;
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
revoke all on function public.get_member_directory() from public;
revoke all on function public.review_profile_signup(uuid, text) from public;
revoke all on function public.get_my_push_subscriptions() from public;
revoke all on function public.disable_my_push_subscription(uuid) from public;
revoke all on function public.create_booking(uuid, text, text, numeric, text, date) from public;
revoke all on function public.create_bookings(uuid, text, date, text, jsonb) from public;
revoke all on function public.cancel_booking(uuid, text) from public;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.claim_booking_push_targets(uuid[], text) to authenticated;
grant execute on function public.get_member_directory() to authenticated;
grant execute on function public.review_profile_signup(uuid, text) to authenticated;
grant execute on function public.get_rehearsal_leaderboard() to authenticated;
grant execute on function public.get_team_rehearsal_totals() to authenticated;
grant execute on function public.is_approved(uuid) to authenticated;
grant execute on function public.is_team_member(uuid, uuid) to authenticated;
grant execute on function public.is_team_leader(uuid, uuid) to authenticated;

commit;
