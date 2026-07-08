-- Replace a member's fixed weekly schedule in one database transaction.
-- This fixes cases where a specific member's weekly schedule cannot be edited
-- from either My Page or the admin page because of existing row conflicts.

begin;

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

  if not (public.is_admin(auth.uid()) or p_user_id = auth.uid()) then
    raise exception 'not allowed';
  end if;

  delete from public.member_schedules
  where user_id = p_user_id;

  for slot_row in
    select value from jsonb_array_elements(coalesce(p_slots, '[]'::jsonb))
  loop
    insert into public.member_schedules (user_id, day_of_week, start_time, updated_by)
    values (
      p_user_id,
      slot_row->>'day',
      slot_row->>'time',
      auth.uid()
    )
    on conflict (user_id, day_of_week, start_time) do nothing;
  end loop;
end;
$$;

grant execute on function public.save_member_weekly_schedule(uuid, jsonb) to authenticated;
grant select, insert, update, delete on public.member_schedules to authenticated;

commit;
