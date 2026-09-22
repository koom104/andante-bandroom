-- Run in Supabase SQL Editor. No booking or schedule data is removed.
begin;

-- Only owner-executed booking triggers may inspect arbitrary member availability.
revoke all on function public.is_member_available_for_booking(uuid, date, text, text, numeric)
  from public, anon, authenticated;

drop policy if exists "schedules_require_approval" on public.member_schedules;
create policy "schedules_require_approval"
on public.member_schedules as restrictive for all to authenticated
using (public.is_approved(auth.uid()))
with check (public.is_approved(auth.uid()));

drop policy if exists "date_schedules_require_approval" on public.member_schedule_date_slots;
create policy "date_schedules_require_approval"
on public.member_schedule_date_slots as restrictive for all to authenticated
using (public.is_approved(auth.uid()))
with check (public.is_approved(auth.uid()));

create or replace function public.save_member_weekly_schedule(
  p_user_id uuid,
  p_slots jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  slot_row jsonb;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  if not public.is_approved(auth.uid())
    or not (public.is_admin(auth.uid()) or p_user_id = auth.uid()) then
    raise exception 'not allowed';
  end if;

  delete from public.member_schedules
  where user_id = p_user_id;

  for slot_row in
    select value from jsonb_array_elements(coalesce(p_slots, '[]'::jsonb))
  loop
    insert into public.member_schedules (user_id, day_of_week, start_time, updated_by)
    values (p_user_id, slot_row->>'day', slot_row->>'time', auth.uid())
    on conflict (user_id, day_of_week, start_time) do nothing;
  end loop;
end;
$$;

revoke all on function public.save_member_weekly_schedule(uuid, jsonb) from public, anon;
grant execute on function public.save_member_weekly_schedule(uuid, jsonb) to authenticated;

commit;
