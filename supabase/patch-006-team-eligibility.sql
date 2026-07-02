-- Enforce that teams are created by the member who will lead them,
-- and prevent admin accounts from being added as team leaders or members.

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

  if p_leader_id <> auth.uid() then
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
