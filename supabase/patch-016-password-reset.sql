-- Admin-triggered temporary password reset support.
-- Run once in Supabase SQL Editor.

begin;

alter table public.profiles
  add column if not exists password_reset_required boolean not null default false;

create or replace function public.complete_password_reset()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  update public.profiles
  set password_reset_required = false
  where id = auth.uid();
end;
$$;

grant execute on function public.complete_password_reset() to authenticated;

commit;
