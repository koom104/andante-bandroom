-- Allow weekly schedule upserts to update existing rows.
-- Run once in Supabase SQL Editor if a specific member's fixed weekly schedule cannot be saved.

begin;

drop policy if exists "schedules_update" on public.member_schedules;
create policy "schedules_update"
on public.member_schedules
for update
to authenticated
using (public.is_admin(auth.uid()) or user_id = auth.uid())
with check (public.is_admin(auth.uid()) or user_id = auth.uid());

grant select, insert, update, delete on public.member_schedules to authenticated;

commit;
