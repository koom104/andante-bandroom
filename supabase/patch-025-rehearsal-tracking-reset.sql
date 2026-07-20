-- Allow only the super admin to reset rehearsal-time counting without deleting bookings.
-- Run once in Supabase Dashboard > SQL Editor after patch-024.

begin;

create table if not exists public.rehearsal_tracking_settings (
  id integer primary key default 1 check (id = 1),
  count_from_date date not null default date '1970-01-01',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.rehearsal_tracking_settings enable row level security;

insert into public.rehearsal_tracking_settings (id, count_from_date)
values (1, date '1970-01-01')
on conflict (id) do nothing;

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

grant execute on function public.reset_rehearsal_tracking() to authenticated;
grant execute on function public.get_rehearsal_leaderboard() to authenticated;
grant execute on function public.get_team_rehearsal_totals() to authenticated;

commit;
