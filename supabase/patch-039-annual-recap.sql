-- Recap covers every performance in the selected year, independently of leaderboard resets.
-- Existing booking attendance snapshots are preserved; no data is backfilled or removed.
begin;

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

