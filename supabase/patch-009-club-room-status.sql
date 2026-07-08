-- Add member-editable club room open/closed status.
-- Run once in Supabase Dashboard > SQL Editor.

begin;

create table if not exists public.club_room_status (
  id integer primary key default 1 check (id = 1),
  is_open boolean not null default false,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.club_room_status enable row level security;

drop policy if exists "club_room_status_select" on public.club_room_status;
create policy "club_room_status_select"
on public.club_room_status
for select
to authenticated
using (public.is_approved(auth.uid()));

drop policy if exists "club_room_status_approved_insert" on public.club_room_status;
create policy "club_room_status_approved_insert"
on public.club_room_status
for insert
to authenticated
with check (public.is_approved(auth.uid()));

drop policy if exists "club_room_status_approved_update" on public.club_room_status;
create policy "club_room_status_approved_update"
on public.club_room_status
for update
to authenticated
using (public.is_approved(auth.uid()))
with check (public.is_approved(auth.uid()));

grant select, insert, update on public.club_room_status to authenticated;

insert into public.club_room_status (id, is_open)
values (1, false)
on conflict (id) do nothing;

commit;
