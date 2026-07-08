-- Add admin-managed rehearsal goal categories.
-- Run once in Supabase Dashboard > SQL Editor.

begin;

create table if not exists public.rehearsal_goal_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.rehearsal_goal_categories enable row level security;

drop policy if exists "goal_categories_select" on public.rehearsal_goal_categories;
create policy "goal_categories_select"
on public.rehearsal_goal_categories
for select
to authenticated
using (public.is_approved(auth.uid()));

drop policy if exists "goal_categories_admin_insert" on public.rehearsal_goal_categories;
create policy "goal_categories_admin_insert"
on public.rehearsal_goal_categories
for insert
to authenticated
with check (public.is_admin(auth.uid()));

drop policy if exists "goal_categories_admin_delete" on public.rehearsal_goal_categories;
create policy "goal_categories_admin_delete"
on public.rehearsal_goal_categories
for delete
to authenticated
using (public.is_admin(auth.uid()));

grant select, insert, delete on public.rehearsal_goal_categories to authenticated;

insert into public.rehearsal_goal_categories (name)
select distinct trim(song)
from public.teams
where nullif(trim(song), '') is not null
on conflict (name) do nothing;

commit;
