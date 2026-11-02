-- Add the Other goal and reclassify graduation rehearsals without changing time or membership.
begin;

lock table public.rehearsal_goal_categories in share row exclusive mode;

do $$
declare
  target_id uuid;
  changed_teams integer;
  changed_bookings integer;
begin
  select id into target_id from public.rehearsal_goal_categories where name = '기타';

  if target_id is null then
    -- Keep the existing category identity when a graduation goal already exists.
    select id into target_id from public.rehearsal_goal_categories
      where regexp_replace(name, '[[:space:]]', '', 'g') = '졸업공연'
      order by id limit 1;
    if target_id is not null then
      update public.rehearsal_goal_categories set name = '기타' where id = target_id;
    else
      insert into public.rehearsal_goal_categories(name) values ('기타') returning id into target_id;
    end if;
  end if;

  update public.teams set song = '기타'
    where regexp_replace(song, '[[:space:]]', '', 'g') = '졸업공연';
  get diagnostics changed_teams = row_count;

  update public.bookings set purpose = '기타'
    where regexp_replace(purpose, '[[:space:]]', '', 'g') = '졸업공연';
  get diagnostics changed_bookings = row_count;

  if to_regclass('public.historical_rehearsal_sessions') is not null then
    update public.historical_rehearsal_sessions set purpose = '기타'
      where regexp_replace(purpose, '[[:space:]]', '', 'g') = '졸업공연';
  end if;

  -- An existing Other category wins; remove only redundant graduation category labels.
  delete from public.rehearsal_goal_categories
    where id <> target_id and regexp_replace(name, '[[:space:]]', '', 'g') = '졸업공연';

  raise notice 'Other goal ready; reclassified teams: %, bookings: %', changed_teams, changed_bookings;
end;
$$;

commit;
