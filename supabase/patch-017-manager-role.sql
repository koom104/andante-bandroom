-- Manager role support.
-- Run once in Supabase SQL Editor.
-- admin = 최고 관리자, manager = 집기, member = 일반 부원

begin;

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('member', 'manager', 'admin'));

create or replace function public.is_super_admin(user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = user_id
      and role = 'admin'
      and status = 'approved'
  );
$$;

create or replace function public.is_admin(user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = user_id
      and role in ('admin', 'manager')
      and status = 'approved'
  );
$$;

create or replace function public.protect_profile_role_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role is distinct from new.role and auth.uid() is not null then
    if old.role = 'admin' then
      raise exception '최고 관리자 계정의 등급은 앱에서 변경할 수 없습니다.';
    end if;

    if not public.is_super_admin(auth.uid()) then
      raise exception '최고 관리자만 집기 권한을 변경할 수 있습니다.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_role_update_trigger on public.profiles;
create trigger protect_profile_role_update_trigger
before update of role on public.profiles
for each row execute function public.protect_profile_role_update();

grant execute on function public.is_super_admin(uuid) to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;

commit;
