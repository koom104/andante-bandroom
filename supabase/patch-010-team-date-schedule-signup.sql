-- Team editing, date-specific schedules, and signup duplicate checks.
-- Run once in Supabase Dashboard > SQL Editor.

begin;

alter table public.team_members
drop constraint if exists team_members_session_check;

alter table public.team_members
add constraint team_members_session_check
check (session in ('보컬', '리드기타', '세컨기타', '어쿠스틱', '베이스', '드럼', '피아노', '신디'));

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

alter table public.member_schedule_date_slots enable row level security;

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

grant execute on function public.update_team(uuid, text, text, uuid, jsonb) to authenticated;
grant execute on function public.check_signup_duplicate(text, text) to anon, authenticated;
grant select, insert, update, delete on public.member_schedule_date_slots to authenticated;

commit;
