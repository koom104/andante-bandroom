-- BandRoom AI patch 002
-- Run this in Supabase Dashboard > SQL Editor for an existing database.
-- It adds team-leader booking cancellation support.

begin;

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

grant execute on function public.cancel_booking(uuid, text) to authenticated;

commit;
