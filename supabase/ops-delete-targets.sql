-- Andante manual delete script.
--
-- How to use:
-- 1. Fill the variables in the "EDIT HERE" area.
-- 2. Run once with v_confirm := 'DRY_RUN' and check the NOTICE output.
-- 3. If the targets are correct, change v_confirm to 'DELETE' and run again.
--
-- Examples:
-- - Delete accounts only:
--   v_account_names := array['구강민'];
--   v_account_cohorts := array['42기'];
--   v_team_names := array[]::text[];
--
-- - Delete teams only:
--   v_account_names := array[]::text[];
--   v_account_cohorts := array[]::text[];
--   v_team_names := array['히치콕'];
--
-- - Delete both:
--   Fill both account arrays and team names.

begin;

do $$
declare
  ---------------------------------------------------------------------------
  -- EDIT HERE
  ---------------------------------------------------------------------------

  -- Keep DRY_RUN for preview. Change to DELETE for real deletion.
  v_confirm text := 'DRY_RUN';

  -- Account deletion targets.
  -- Names and cohorts are matched by position:
  --   array['구강민', '가나다']
  --   array['42기', '43기']
  v_account_names text[] := array[]::text[];
  v_account_cohorts text[] := array[]::text[];

  -- Team deletion targets.
  v_team_names text[] := array[]::text[];

  -- Admin accounts are protected by default.
  v_allow_admin_account_delete boolean := false;

  ---------------------------------------------------------------------------
  -- DO NOT EDIT BELOW UNLESS YOU ARE CHANGING THE DELETE LOGIC
  ---------------------------------------------------------------------------

  v_account_count integer := coalesce(array_length(v_account_names, 1), 0);
  v_cohort_count integer := coalesce(array_length(v_account_cohorts, 1), 0);
  v_team_count integer := coalesce(array_length(v_team_names, 1), 0);
  v_missing text;
  v_duplicate text;
  v_deleted_accounts integer := 0;
  v_deleted_teams integer := 0;
  v_deleted_empty_led_teams integer := 0;
  v_preview_accounts text;
  v_preview_teams text;
  led_team record;
  replacement_user_id uuid;
begin
  if v_confirm not in ('DRY_RUN', 'DELETE') then
    raise exception 'v_confirm은 DRY_RUN 또는 DELETE만 사용할 수 있습니다.';
  end if;

  if v_account_count <> v_cohort_count then
    raise exception 'v_account_names와 v_account_cohorts 개수가 다릅니다. 이름과 기수를 같은 순서로 넣어 주세요.';
  end if;

  if v_account_count = 0 and v_team_count = 0 then
    raise exception '삭제할 계정이나 팀을 하나 이상 입력해 주세요.';
  end if;

  create temp table _account_input(
    name text not null,
    cohort text not null,
    primary key (name, cohort)
  ) on commit drop;

  create temp table _team_input(
    name text primary key
  ) on commit drop;

  create temp table _target_profiles(
    id uuid primary key,
    email text,
    name text,
    cohort text,
    student_no text,
    role text
  ) on commit drop;

  create temp table _target_teams(
    id uuid primary key,
    name text,
    song text
  ) on commit drop;

  if v_account_count > 0 then
    insert into _account_input(name, cohort)
    select distinct trim(input.name), trim(input.cohort)
    from unnest(v_account_names, v_account_cohorts) as input(name, cohort)
    where nullif(trim(input.name), '') is not null
      and nullif(trim(input.cohort), '') is not null;

    if (select count(*) from _account_input) <> v_account_count then
      raise exception '계정 삭제 대상에 빈 이름, 빈 기수, 또는 중복된 이름+기수가 있습니다.';
    end if;

    select string_agg(input.name || ' / ' || input.cohort, ', ')
    into v_missing
    from _account_input input
    where not exists (
      select 1
      from public.profiles profile
      where profile.name = input.name
        and profile.cohort = input.cohort
    );

    if v_missing is not null then
      raise exception '찾을 수 없는 계정 이름+기수: %', v_missing;
    end if;

    select string_agg(input.name || ' / ' || input.cohort, ', ')
    into v_duplicate
    from _account_input input
    where (
      select count(*)
      from public.profiles profile
      where profile.name = input.name
        and profile.cohort = input.cohort
    ) > 1;

    if v_duplicate is not null then
      raise exception '이름+기수가 여러 계정과 일치합니다. SQL에서 더 구체적인 조건으로 삭제해야 합니다: %', v_duplicate;
    end if;

    insert into _target_profiles(id, email, name, cohort, student_no, role)
    select profile.id, profile.email, profile.name, profile.cohort, profile.student_no, profile.role
    from public.profiles profile
    join _account_input input
      on input.name = profile.name
     and input.cohort = profile.cohort;

    if exists (select 1 from _target_profiles where role = 'admin') and not v_allow_admin_account_delete then
      raise exception '관리자 계정은 기본적으로 삭제할 수 없습니다. 정말 필요하면 v_allow_admin_account_delete를 true로 바꿔 주세요.';
    end if;
  else
    raise notice '계정 삭제: 입력값이 없어 건너뜁니다.';
  end if;

  if v_team_count > 0 then
    insert into _team_input(name)
    select distinct trim(name)
    from unnest(v_team_names) as input(name)
    where nullif(trim(name), '') is not null;

    if (select count(*) from _team_input) <> v_team_count then
      raise exception '팀 삭제 대상에 빈 팀 이름이 있거나 중복된 팀 이름이 있습니다.';
    end if;

    select string_agg(input.name, ', ')
    into v_missing
    from _team_input input
    where not exists (
      select 1
      from public.teams team
      where team.name = input.name
    );

    if v_missing is not null then
      raise exception '찾을 수 없는 팀 이름: %', v_missing;
    end if;

    insert into _target_teams(id, name, song)
    select team.id, team.name, team.song
    from public.teams team
    join _team_input input
      on input.name = team.name;
  else
    raise notice '팀 삭제: 입력값이 없어 건너뜁니다.';
  end if;

  select coalesce(
    jsonb_pretty(jsonb_agg(jsonb_build_object(
      'name', name,
      'cohort', cohort,
      'student_no', student_no,
      'email', email,
      'role', role,
      'id', id
    ))),
    '[]'
  )
  into v_preview_accounts
  from _target_profiles;

  select coalesce(
    jsonb_pretty(jsonb_agg(jsonb_build_object(
      'name', name,
      'song', song,
      'id', id
    ))),
    '[]'
  )
  into v_preview_teams
  from _target_teams;

  raise notice '삭제 대상 계정: %', v_preview_accounts;
  raise notice '삭제 대상 팀: %', v_preview_teams;

  if v_confirm = 'DRY_RUN' then
    raise notice 'DRY_RUN입니다. 실제 삭제하려면 v_confirm을 DELETE로 바꿔 다시 실행하세요.';
    return;
  end if;

  -- Team deletion section.
  -- Runs only when v_team_names has at least one team name.
  if v_team_count > 0 then
    insert into public.audit_logs (actor_id, action, target_type, target_id, reason)
    select null, 'manual_delete_team', 'team', id, name
    from _target_teams;

    delete from public.teams
    where id in (select id from _target_teams);

    get diagnostics v_deleted_teams = row_count;
  end if;

  -- Account deletion section.
  -- Runs only when v_account_names and v_account_cohorts have at least one pair.
  if v_account_count > 0 then
    for led_team in
      select distinct team_members.team_id
      from public.team_members
      where team_members.user_id in (select id from _target_profiles)
        and team_members.is_leader = true
    loop
      select team_members.user_id
      into replacement_user_id
      from public.team_members
      where team_members.team_id = led_team.team_id
        and team_members.user_id not in (select id from _target_profiles)
      order by team_members.created_at asc
      limit 1;

      if replacement_user_id is null then
        insert into public.audit_logs (actor_id, action, target_type, target_id, reason)
        select null, 'manual_delete_empty_led_team', 'team', teams.id, teams.name
        from public.teams
        where teams.id = led_team.team_id;

        delete from public.teams
        where id = led_team.team_id;

        v_deleted_empty_led_teams := v_deleted_empty_led_teams + 1;
      else
        update public.team_members
        set is_leader = false
        where team_id = led_team.team_id;

        update public.team_members
        set is_leader = true
        where team_id = led_team.team_id
          and user_id = replacement_user_id;
      end if;
    end loop;

    update public.teams
    set created_by = null
    where created_by in (select id from _target_profiles);

    update public.member_schedules
    set updated_by = null
    where updated_by in (select id from _target_profiles);

    update public.bookings
    set created_by = null
    where created_by in (select id from _target_profiles);

    update public.bookings
    set cancelled_by = null
    where cancelled_by in (select id from _target_profiles);

    update public.profiles
    set approved_by = null
    where approved_by in (select id from _target_profiles);

    update public.audit_logs
    set actor_id = null
    where actor_id in (select id from _target_profiles);

    insert into public.audit_logs (actor_id, action, target_type, target_id, reason)
    select null, 'manual_delete_member_auth_user', 'profile', id, email || ' / ' || name
    from _target_profiles;

    delete from auth.users
    where id in (select id from _target_profiles);

    get diagnostics v_deleted_accounts = row_count;
  end if;

  raise notice '삭제 완료: 계정 %개, 직접 지정 팀 %개, 빈 팀 %개', v_deleted_accounts, v_deleted_teams, v_deleted_empty_led_teams;
end $$;

commit;
