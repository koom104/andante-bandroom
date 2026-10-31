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
